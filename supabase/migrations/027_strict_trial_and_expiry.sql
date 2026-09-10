-- =============================================================
-- ZE-POS 027 — Fix trial period stacking + strict expiry cutoff
-- Run AFTER 026_admin_delete_client.sql
--
-- Bug: admin_approve_payment() / admin_record_payment() /
--      admin_assign_plan() all extended a client from
--      greatest(current_period_end, now()) + duration_days. That's
--      correct for a RENEWAL of a paid plan (you keep remaining
--      paid time), but it means a "1-Day Trial" granted to a client
--      who still has time left on an existing paid plan gets tacked
--      onto the END of that remaining time — so the trial silently
--      lasts remaining_days + 1, not 1 day. It also meant a client
--      could resubmit the free trial claim repeatedly to keep
--      pushing their access out for free.
--
-- Fix:
--   1. A `duration_type = 'trial'` plan ALWAYS starts from now() —
--      it never stacks on top of an existing period_end. It behaves
--      exactly like any other plan in every other respect (same
--      status/period_end fields, same enforcement).
--   2. A workspace can only ever redeem the self-service trial once
--      (submit_payment_claim rejects a repeat trial claim). Admin-
--      initiated grants (admin_assign_plan / admin_record_payment)
--      are left to the super admin's discretion, since those are
--      trusted manual operations, not a self-service loophole.
--   3. workspace_subscription_active() no longer treats a null
--      current_period_end as "active forever" — access requires an
--      explicit, unexpired period_end. Cuts access the instant a
--      plan (trial or paid) expires, no grace/bypass.
--   4. get_my_billing() now reports the client's TRUE effective status
--      ('overdue' once current_period_end has passed) instead of
--      echoing a stale 'active' flag, and flags whether the trial
--      has already been used so the UI can grey it out.
-- Idempotent: safe to re-run.
-- =============================================================

-- -------------------------------------------------------------
-- 1. Helper: compute the (days, new period_end) for granting a
--    plan to a profile. Centralizes the trial-never-stacks rule so
--    every payment/grant path applies it identically.
-- -------------------------------------------------------------
create or replace function public.compute_period_end(
    p_profile uuid,
    p_plan_id uuid,
    p_default_days integer default 30
)
returns table(days integer, period_end timestamptz)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
    v_days integer;
    v_type text;
begin
    if p_plan_id is not null then
        select pl.duration_days, pl.duration_type into v_days, v_type
        from public.plans pl where pl.id = p_plan_id;
    end if;
    v_days := coalesce(v_days, p_default_days);

    if v_type = 'trial' then
        -- Trials never inherit remaining time from a prior plan and
        -- never stack on repeat grants — always exactly v_days from now.
        return query select v_days, now() + make_interval(days => v_days);
    else
        return query select v_days, greatest(coalesce(
            (select p.current_period_end from public.profiles p where p.id = p_profile),
            now()), now()) + make_interval(days => v_days);
    end if;
end;
$$;

-- -------------------------------------------------------------
-- 2. admin_approve_payment() — use compute_period_end() instead of
--    always stacking, so approving a trial claim grants exactly the
--    trial's duration_days regardless of any remaining paid time.
-- -------------------------------------------------------------
create or replace function public.admin_approve_payment(p_payment_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
    v_payment public.payments%rowtype;
    v_days integer;
    v_period_end timestamptz;
begin
    if not public.is_super_admin() then
        raise exception 'not authorized';
    end if;

    select * into v_payment from public.payments where id = p_payment_id and status = 'pending';
    if v_payment.id is null then
        raise exception 'pending payment not found';
    end if;

    select c.days, c.period_end into v_days, v_period_end
    from public.compute_period_end(v_payment.profile_id, v_payment.plan_id) c;

    update public.payments
       set status = 'paid',
           period_start = now(),
           period_end = v_period_end
     where id = p_payment_id;

    update public.profiles
       set subscription_status = 'active',
           plan_id = coalesce(v_payment.plan_id, plan_id),
           current_period_end = v_period_end
     where id = v_payment.profile_id;

    perform public.log_action('payment_approve', 'payment', p_payment_id::text, jsonb_build_object(
        'profile_id', v_payment.profile_id, 'plan_id', v_payment.plan_id, 'days', v_days
    ));
end;
$$;

grant execute on function public.admin_approve_payment(uuid) to authenticated;

-- -------------------------------------------------------------
-- 3. admin_record_payment() — same fix for the admin's manual
--    payment-recording path.
-- -------------------------------------------------------------
create or replace function public.admin_record_payment(
    p_profile uuid,
    p_amount numeric,
    p_method text,
    p_reference text default null,
    p_plan_id uuid default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
    v_plan_id uuid;
    v_days integer;
    v_period_end timestamptz;
begin
    if not public.is_super_admin() then
        raise exception 'not authorized';
    end if;

    v_plan_id := coalesce(p_plan_id, (select plan_id from public.profiles where id = p_profile));

    select c.days, c.period_end into v_days, v_period_end
    from public.compute_period_end(p_profile, v_plan_id) c;

    insert into public.payments (profile_id, amount, method, status, reference, source, period_start, period_end)
    values (p_profile, p_amount, p_method, 'paid', p_reference, 'manual', now(), v_period_end);

    update public.profiles
    set subscription_status = 'active',
        plan_id = coalesce(v_plan_id, plan_id),
        current_period_end = v_period_end
    where id = p_profile;

    perform public.log_action('payment_record', 'profile', p_profile::text, jsonb_build_object(
        'amount', p_amount, 'method', p_method, 'plan_id', v_plan_id, 'days', v_days
    ));
end;
$$;

-- -------------------------------------------------------------
-- 4. admin_assign_plan() — same fix for handing a client a plan
--    (e.g. a comp trial) with no payment record.
-- -------------------------------------------------------------
create or replace function public.admin_assign_plan(p_profile uuid, p_plan_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
    v_days integer;
    v_period_end timestamptz;
begin
    if not public.is_super_admin() then
        raise exception 'not authorized';
    end if;

    if not exists (select 1 from public.plans where id = p_plan_id) then
        raise exception 'plan not found';
    end if;

    select c.days, c.period_end into v_days, v_period_end
    from public.compute_period_end(p_profile, p_plan_id) c;

    update public.profiles
    set plan_id = p_plan_id,
        subscription_status = 'active',
        current_period_end = v_period_end
    where id = p_profile;

    perform public.log_action('plan_assign', 'profile', p_profile::text, jsonb_build_object('plan_id', p_plan_id, 'days', v_days));
end;
$$;

-- -------------------------------------------------------------
-- 5. submit_payment_claim() — a workspace may only ever redeem the
--    self-service free trial once. Paid plans are unaffected and can
--    still be resubmitted/renewed any time.
-- -------------------------------------------------------------
create or replace function public.submit_payment_claim(
    p_plan_id uuid,
    p_method text,
    p_reference text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
    v_profile uuid := public.workspace_of();
    v_plan public.plans%rowtype;
    v_id uuid;
begin
    if v_profile is null then
        raise exception 'no workspace found for current user';
    end if;

    select * into v_plan from public.plans where id = p_plan_id and active = true;
    if v_plan.id is null then
        raise exception 'plan not found or no longer available';
    end if;

    if p_method not in ('gcash','maya','bank','card','paymongo') then
        raise exception 'invalid payment method';
    end if;

    if exists (select 1 from public.payments where profile_id = v_profile and status = 'pending') then
        raise exception 'You already have a payment submission awaiting review.';
    end if;

    if v_plan.duration_type = 'trial' and exists (
        select 1
        from public.payments pay
        join public.plans pl on pl.id = pay.plan_id
        where pay.profile_id = v_profile
          and pay.status = 'paid'
          and pl.duration_type = 'trial'
    ) then
        raise exception 'The free trial has already been used for this workspace.';
    end if;

    insert into public.payments (profile_id, plan_id, amount, method, status, reference, source)
    values (v_profile, v_plan.id, v_plan.price_monthly, p_method, 'pending', p_reference, 'manual')
    returning id into v_id;

    perform public.log_action('payment_claim_submit', 'payment', v_id::text, jsonb_build_object(
        'plan_id', v_plan.id, 'plan_name', v_plan.name, 'method', p_method, 'amount', v_plan.price_monthly
    ));

    return v_id;
end;
$$;

grant execute on function public.submit_payment_claim(uuid, text, text) to authenticated;

-- -------------------------------------------------------------
-- 6. workspace_subscription_active() — strict cutoff: a null
--    current_period_end no longer grants unlimited access. Access
--    requires status = 'active' AND an unexpired current_period_end.
-- -------------------------------------------------------------
create or replace function public.workspace_subscription_active()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
    select coalesce((
        select p.is_super_admin
            or (p.subscription_status = 'active'
                and p.current_period_end is not null
                and p.current_period_end > now())
        from public.profiles p
        where p.id = public.workspace_of()
    ), false);
$$;

-- -------------------------------------------------------------
-- 7. get_my_billing() — report the TRUE effective status (an
--    'active' row whose current_period_end has already passed reads
--    as 'overdue', matching what workspace_subscription_active()
--    actually enforces) and flag whether the trial's been used.
-- -------------------------------------------------------------
create or replace function public.get_my_billing()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    result jsonb;
begin
    select jsonb_build_object(
        'status', case
            when prof.subscription_status = 'active'
                 and (prof.current_period_end is null or prof.current_period_end <= now())
            then 'overdue'
            else prof.subscription_status
        end,
        'period_end', prof.current_period_end,
        'business_name', prof.business_name,
        'plan_id', prof.plan_id,
        'plan_name', plan.name,
        'plan_features', coalesce(plan.features, '{}'::text[]),
        'price_monthly', plan.price_monthly,
        'currency', plan.currency,
        'trial_used', exists (
            select 1
            from public.payments pay
            join public.plans pl on pl.id = pay.plan_id
            where pay.profile_id = prof.id
              and pay.status = 'paid'
              and pl.duration_type = 'trial'
        ),
        'payments', coalesce((
            select jsonb_agg(jsonb_build_object(
                'amount', pay.amount, 'method', pay.method, 'status', pay.status,
                'reference', pay.reference, 'source', pay.source, 'created_at', pay.created_at
            ) order by pay.created_at desc)
            from public.payments pay where pay.profile_id = prof.id
        ), '[]'::jsonb),
        'pending_payment', (
            select jsonb_build_object(
                'id', pay.id, 'amount', pay.amount, 'method', pay.method,
                'plan_name', pl.name, 'created_at', pay.created_at
            )
            from public.payments pay
            left join public.plans pl on pl.id = pay.plan_id
            where pay.profile_id = prof.id and pay.status = 'pending'
            order by pay.created_at desc
            limit 1
        )
    ) into result
    from public.profiles prof
    left join public.plans plan on plan.id = prof.plan_id
    where prof.id = public.workspace_of();

    return coalesce(result, '{}'::jsonb);
end;
$$;

grant execute on function public.get_my_billing() to anon, authenticated;

-- -------------------------------------------------------------
-- 8. admin_list_clients() — same truthful-status fix for the admin
--    dashboard: a lapsed client shows as 'overdue' there too, instead
--    of a stale 'active' badge (this also drives the dashboard's
--    Cancel/Delete button logic, which keys off this same column).
-- -------------------------------------------------------------
create or replace function public.admin_list_clients()
returns table (
    id                  uuid,
    business_name       text,
    email               text,
    plan_id             uuid,
    plan_name           text,
    subscription_status text,
    current_period_end  timestamptz,
    last_payment_at     timestamptz,
    created_at          timestamptz,
    is_super_admin      boolean
)
language sql
security definer
set search_path = public
as $$
    select
        p.id,
        p.business_name,
        p.email,
        p.plan_id,
        pl.name,
        case
            when p.subscription_status = 'active'
                 and (p.current_period_end is null or p.current_period_end <= now())
            then 'overdue'
            else p.subscription_status
        end,
        p.current_period_end,
        (select max(pay.created_at)
           from public.payments pay
          where pay.profile_id = p.id),
        p.created_at,
        p.is_super_admin
    from public.profiles p
    left join public.plans pl on pl.id = p.plan_id
    where public.is_super_admin()
      and p.id = p.workspace_id
    order by p.created_at desc;
$$;
