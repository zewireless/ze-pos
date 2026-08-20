-- =============================================================
-- ZE-POS 009 — Client-selectable plans + payment method, seamless
-- self-service billing flow.
-- Run AFTER 008_flexible_plans.sql
--
-- Adds a pending-approval flow: the client picks a plan + payment
-- method on the billing page and submits a claim (with an optional
-- reference number, e.g. a GCash transaction ID). This creates a
-- 'pending' payment row. The super admin reviews and approves (which
-- activates the client using that plan's exact duration_days) or
-- rejects it from the admin dashboard. This keeps the existing manual
-- admin_record_payment() flow intact for admin-initiated payments,
-- and adds a client-initiated path alongside it.
-- Idempotent: safe to re-run.
-- =============================================================

-- -------------------------------------------------------------
-- 1. payments needs to remember WHICH plan a claim was for, since
--    profiles.plan_id can change before an admin gets to approve it.
-- -------------------------------------------------------------
alter table public.payments add column if not exists plan_id uuid references public.plans(id);

-- -------------------------------------------------------------
-- 2. submit_payment_claim() — client-callable. Creates a 'pending'
--    payment row for the CALLER'S OWN workspace (never another
--    workspace — workspace_of() always resolves to the caller's own
--    membership, so this can't be used to submit a claim for someone
--    else's business).
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

    -- Only one pending claim at a time per workspace — resubmitting
    -- while one is already awaiting review would create duplicate
    -- payment rows an admin might double-approve.
    if exists (select 1 from public.payments where profile_id = v_profile and status = 'pending') then
        raise exception 'You already have a payment submission awaiting review.';
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
-- 3. cancel_payment_claim() — client-callable. Lets a client pull
--    back their own still-pending claim (e.g. picked the wrong plan).
-- -------------------------------------------------------------
create or replace function public.cancel_payment_claim(p_payment_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
    v_profile uuid := public.workspace_of();
begin
    delete from public.payments
    where id = p_payment_id
      and profile_id = v_profile
      and status = 'pending';

    if not found then
        raise exception 'No matching pending payment found';
    end if;
end;
$$;

grant execute on function public.cancel_payment_claim(uuid) to authenticated;

-- -------------------------------------------------------------
-- 4. admin_approve_payment() — marks a pending claim paid, activates
--    the client using the CLAIM'S plan (not whatever the profile's
--    plan_id happens to be now), and extends the period by that
--    plan's duration_days.
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
begin
    if not public.is_super_admin() then
        raise exception 'not authorized';
    end if;

    select * into v_payment from public.payments where id = p_payment_id and status = 'pending';
    if v_payment.id is null then
        raise exception 'pending payment not found';
    end if;

    v_days := 30;
    if v_payment.plan_id is not null then
        select duration_days into v_days from public.plans where id = v_payment.plan_id;
        v_days := coalesce(v_days, 30);
    end if;

    update public.payments
       set status = 'paid',
           period_start = now(),
           period_end = greatest(coalesce(
               (select current_period_end from public.profiles where id = v_payment.profile_id),
               now()), now()) + make_interval(days => v_days)
     where id = p_payment_id;

    update public.profiles
       set subscription_status = 'active',
           plan_id = coalesce(v_payment.plan_id, plan_id),
           current_period_end = greatest(coalesce(current_period_end, now()), now()) + make_interval(days => v_days)
     where id = v_payment.profile_id;

    perform public.log_action('payment_approve', 'payment', p_payment_id::text, jsonb_build_object(
        'profile_id', v_payment.profile_id, 'plan_id', v_payment.plan_id, 'days', v_days
    ));
end;
$$;

grant execute on function public.admin_approve_payment(uuid) to authenticated;

-- -------------------------------------------------------------
-- 5. admin_reject_payment() — marks a pending claim as failed with
--    an optional reason, so the client can see it wasn't approved
--    and try again.
-- -------------------------------------------------------------
create or replace function public.admin_reject_payment(p_payment_id uuid, p_reason text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
    if not public.is_super_admin() then
        raise exception 'not authorized';
    end if;

    update public.payments
       set status = 'failed',
           reference = coalesce(reference, '') ||
               case when p_reason is not null then ' [rejected: ' || p_reason || ']' else ' [rejected]' end
     where id = p_payment_id and status = 'pending';

    if not found then
        raise exception 'pending payment not found';
    end if;

    perform public.log_action('payment_reject', 'payment', p_payment_id::text, jsonb_build_object('reason', p_reason));
end;
$$;

grant execute on function public.admin_reject_payment(uuid, text) to authenticated;

-- -------------------------------------------------------------
-- 6. admin_list_payments() — extend to include plan_id/plan_name so
--    the admin can see what plan a pending claim is for.
-- -------------------------------------------------------------
drop function if exists public.admin_list_payments(uuid) cascade;

create function public.admin_list_payments(p_profile uuid)
returns table (
    id uuid,
    amount numeric,
    method text,
    status text,
    reference text,
    source text,
    plan_id uuid,
    plan_name text,
    created_at timestamptz
)
language sql
security definer
set search_path = public
as $$
    select pay.id, pay.amount, pay.method, pay.status, pay.reference, pay.source,
           pay.plan_id, pl.name, pay.created_at
    from public.payments pay
    left join public.plans pl on pl.id = pay.plan_id
    where pay.profile_id = p_profile and public.is_super_admin()
    order by pay.created_at desc;
$$;

-- -------------------------------------------------------------
-- 7. get_my_billing() — include the caller's own pending claim (if
--    any) so billing.js can show a "submitted, awaiting review"
--    screen instead of the plan picker again.
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
        'status', prof.subscription_status,
        'period_end', prof.current_period_end,
        'business_name', prof.business_name,
        'plan_id', prof.plan_id,
        'plan_name', plan.name,
        'price_monthly', plan.price_monthly,
        'currency', plan.currency,
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

-- -------------------------------------------------------------
-- 8. Client-facing plan listing already works via the existing
--    "plans read all" policy from 001 (readable by any authenticated
--    user). billing.js will just filter to active = true client-side
--    (or query with .eq('active', true) directly) — no new policy
--    needed here.
-- -------------------------------------------------------------
