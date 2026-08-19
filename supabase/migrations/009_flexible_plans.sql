-- =============================================================
-- ZE-POS 008 — Flexible subscription plans (super admin managed)
-- Run AFTER 007_billing_webhook_and_reports.sql
--
-- Lets the super admin create/edit/retire plans with ANY duration
-- (1-day trial, 1-week, custom N days, monthly, etc.) and any price,
-- instead of the single hardcoded "30 days" assumption from 001.
--
-- Design notes:
--   - `plans.price_monthly` is KEPT (not renamed) so existing frontend
--     code (billing.js, get_my_billing()) that reads plan.price_monthly
--     keeps working unchanged. It now means "price for this plan's
--     duration_days", not strictly "per calendar month".
--   - `duration_days` is the ONLY value period math uses — a "1 week"
--     plan is duration_days = 7, a "1 day trial" is duration_days = 1,
--     a "custom 45 days" plan is duration_days = 45. duration_type is
--     purely a UI label/category, never used in date arithmetic, so
--     there's exactly one source of truth for period length.
--   - admin_record_payment() now takes an optional p_plan_id. If given,
--     the client's profiles.plan_id is updated and the period extension
--     uses THAT plan's duration_days instead of the old hardcoded 30.
--   - admin_assign_plan() lets an operator hand a client a plan (e.g. a
--     free 1-day trial) without requiring a payment record.
-- Idempotent: safe to re-run.
-- =============================================================

-- -------------------------------------------------------------
-- 1. Extend plans table with duration + lifecycle fields
-- -------------------------------------------------------------
alter table public.plans add column if not exists duration_type text
    not null default 'months'
    check (duration_type in ('trial','days','weeks','months','custom'));

alter table public.plans add column if not exists duration_days integer
    not null default 30
    check (duration_days > 0);

alter table public.plans add column if not exists sort_order integer not null default 0;

-- Backfill duration_type/duration_days sensibly for the seeded 001 plan
-- (name 'ZE-POS Monthly', duration left at the column defaults already).

-- -------------------------------------------------------------
-- 2. Plans are readable by any authenticated user already
--    (migration 001: "plans read all"). Writes must go through the
--    SECURITY DEFINER RPCs below — add a deny-all write guard so a
--    compromised anon/authenticated key can't touch plans directly.
-- -------------------------------------------------------------
drop policy if exists "plans_write_deny" on public.plans;
create policy "plans_write_deny" on public.plans
    for insert to anon, authenticated
    with check (false);

drop policy if exists "plans_update_deny" on public.plans;
create policy "plans_update_deny" on public.plans
    for update to anon, authenticated
    using (false);

drop policy if exists "plans_delete_deny" on public.plans;
create policy "plans_delete_deny" on public.plans
    for delete to anon, authenticated
    using (false);

-- -------------------------------------------------------------
-- 3. admin_list_plans() — every plan, active + retired, for the
--    admin dashboard's plan management table.
-- -------------------------------------------------------------
drop function if exists public.admin_list_plans() cascade;

create function public.admin_list_plans()
returns table (
    id uuid,
    name text,
    price_monthly numeric,
    currency text,
    features text[],
    active boolean,
    duration_type text,
    duration_days integer,
    sort_order integer,
    created_at timestamptz,
    client_count bigint
)
language sql
security definer
set search_path = public
as $$
    select
        pl.id,
        pl.name,
        pl.price_monthly,
        pl.currency,
        pl.features,
        pl.active,
        pl.duration_type,
        pl.duration_days,
        pl.sort_order,
        pl.created_at,
        (select count(*) from public.profiles p where p.plan_id = pl.id) as client_count
    from public.plans pl
    where public.is_super_admin()
    order by pl.sort_order asc, pl.created_at asc;
$$;

-- -------------------------------------------------------------
-- 4. admin_create_plan()
-- -------------------------------------------------------------
create or replace function public.admin_create_plan(
    p_name text,
    p_price numeric,
    p_duration_type text,
    p_duration_days integer,
    p_currency text default 'PHP',
    p_features text[] default '{}',
    p_active boolean default true,
    p_sort_order integer default 0
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
    v_id uuid;
begin
    if not public.is_super_admin() then
        raise exception 'not authorized';
    end if;
    if p_duration_type not in ('trial','days','weeks','months','custom') then
        raise exception 'invalid duration_type: %', p_duration_type;
    end if;
    if p_duration_days is null or p_duration_days <= 0 then
        raise exception 'duration_days must be a positive integer';
    end if;
    if p_price is null or p_price < 0 then
        raise exception 'price must be zero or a positive number';
    end if;
    if p_name is null or length(trim(p_name)) = 0 then
        raise exception 'plan name is required';
    end if;

    insert into public.plans (name, price_monthly, currency, features, active, duration_type, duration_days, sort_order)
    values (trim(p_name), p_price, coalesce(p_currency, 'PHP'), coalesce(p_features, '{}'), coalesce(p_active, true), p_duration_type, p_duration_days, coalesce(p_sort_order, 0))
    returning id into v_id;

    perform public.log_action('plan_create', 'plan', v_id::text, jsonb_build_object(
        'name', p_name, 'price', p_price, 'duration_type', p_duration_type, 'duration_days', p_duration_days
    ));

    return v_id;
end;
$$;

-- -------------------------------------------------------------
-- 5. admin_update_plan() — edit price/duration/name/etc. of an
--    existing plan. Does NOT retroactively change periods already
--    granted to clients (those were computed at payment time).
-- -------------------------------------------------------------
create or replace function public.admin_update_plan(
    p_plan_id uuid,
    p_name text,
    p_price numeric,
    p_duration_type text,
    p_duration_days integer,
    p_currency text default 'PHP',
    p_features text[] default null,
    p_active boolean default null,
    p_sort_order integer default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
    if not public.is_super_admin() then
        raise exception 'not authorized';
    end if;
    if not exists (select 1 from public.plans where id = p_plan_id) then
        raise exception 'plan not found';
    end if;
    if p_duration_type not in ('trial','days','weeks','months','custom') then
        raise exception 'invalid duration_type: %', p_duration_type;
    end if;
    if p_duration_days is null or p_duration_days <= 0 then
        raise exception 'duration_days must be a positive integer';
    end if;
    if p_price is null or p_price < 0 then
        raise exception 'price must be zero or a positive number';
    end if;
    if p_name is null or length(trim(p_name)) = 0 then
        raise exception 'plan name is required';
    end if;

    update public.plans
       set name          = trim(p_name),
           price_monthly = p_price,
           currency      = coalesce(p_currency, currency),
           duration_type = p_duration_type,
           duration_days = p_duration_days,
           features      = coalesce(p_features, features),
           active        = coalesce(p_active, active),
           sort_order    = coalesce(p_sort_order, sort_order)
     where id = p_plan_id;

    perform public.log_action('plan_update', 'plan', p_plan_id::text, jsonb_build_object(
        'name', p_name, 'price', p_price, 'duration_type', p_duration_type, 'duration_days', p_duration_days
    ));
end;
$$;

-- -------------------------------------------------------------
-- 6. admin_set_plan_active() — retire/restore a plan without
--    deleting it (clients already on it are unaffected; it just
--    stops showing up as an offer for NEW subscribers).
-- -------------------------------------------------------------
create or replace function public.admin_set_plan_active(p_plan_id uuid, p_active boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
    if not public.is_super_admin() then
        raise exception 'not authorized';
    end if;
    update public.plans set active = p_active where id = p_plan_id;
    perform public.log_action('plan_set_active', 'plan', p_plan_id::text, jsonb_build_object('active', p_active));
end;
$$;

-- -------------------------------------------------------------
-- 7. admin_delete_plan() — hard delete, only allowed if no client
--    currently references it (keeps profiles.plan_id FK intact and
--    avoids silently orphaning a client's billing history/plan_name).
-- -------------------------------------------------------------
create or replace function public.admin_delete_plan(p_plan_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
    v_in_use integer;
begin
    if not public.is_super_admin() then
        raise exception 'not authorized';
    end if;

    select count(*) into v_in_use from public.profiles where plan_id = p_plan_id;
    if v_in_use > 0 then
        raise exception 'cannot delete: % client(s) are currently on this plan — retire it instead', v_in_use;
    end if;

    delete from public.plans where id = p_plan_id;
    perform public.log_action('plan_delete', 'plan', p_plan_id::text, '{}'::jsonb);
end;
$$;

-- -------------------------------------------------------------
-- 8. admin_record_payment() — extended to accept an optional
--    p_plan_id. When given, the client's plan is (re)assigned and
--    the period extension uses THAT plan's duration_days. When
--    omitted, falls back to the client's already-assigned plan's
--    duration_days, and finally to 30 days if the client has no
--    plan at all (keeps old behavior for pre-008 data).
--    Must DROP first: adding a new parameter changes arity, and
--    CREATE OR REPLACE cannot append a non-defaulted-position param
--    in front of existing ones — this signature adds p_plan_id at
--    the END with a default, so existing callers with the old
--    4-arg signature keep working unchanged.
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
    v_days integer;
    v_plan_id uuid;
begin
    if not public.is_super_admin() then
        raise exception 'not authorized';
    end if;

    v_plan_id := coalesce(p_plan_id, (select plan_id from public.profiles where id = p_profile));

    if v_plan_id is not null then
        select duration_days into v_days from public.plans where id = v_plan_id;
    end if;
    v_days := coalesce(v_days, 30);

    insert into public.payments (profile_id, amount, method, status, reference, source, period_start, period_end)
    values (
        p_profile, p_amount, p_method, 'paid', p_reference, 'manual',
        now(),
        greatest(coalesce(
            (select current_period_end from public.profiles where id = p_profile),
            now()), now()) + make_interval(days => v_days)
    );

    update public.profiles
    set subscription_status = 'active',
        plan_id = coalesce(v_plan_id, plan_id),
        current_period_end = greatest(coalesce(current_period_end, now()), now()) + make_interval(days => v_days)
    where id = p_profile;

    perform public.log_action('payment_record', 'profile', p_profile::text, jsonb_build_object(
        'amount', p_amount, 'method', p_method, 'plan_id', v_plan_id, 'days', v_days
    ));
end;
$$;

-- -------------------------------------------------------------
-- 9. admin_assign_plan() — hand a client a plan directly (e.g. a
--    free trial) without a payment record. Extends their period by
--    the plan's duration_days from now (or from their current
--    period_end if it's still in the future, so an active client
--    given a bonus doesn't lose remaining time).
-- -------------------------------------------------------------
create or replace function public.admin_assign_plan(p_profile uuid, p_plan_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
    v_days integer;
begin
    if not public.is_super_admin() then
        raise exception 'not authorized';
    end if;

    select duration_days into v_days from public.plans where id = p_plan_id;
    if v_days is null then
        raise exception 'plan not found';
    end if;

    update public.profiles
    set plan_id = p_plan_id,
        subscription_status = 'active',
        current_period_end = greatest(coalesce(current_period_end, now()), now()) + make_interval(days => v_days)
    where id = p_profile;

    perform public.log_action('plan_assign', 'profile', p_profile::text, jsonb_build_object('plan_id', p_plan_id, 'days', v_days));
end;
$$;

-- -------------------------------------------------------------
-- 10. Seed a couple of example flexible plans (idempotent — only
--     inserted if a plan with that exact name doesn't already exist).
--     Feel free to edit/delete these from the admin dashboard after.
-- -------------------------------------------------------------
insert into public.plans (name, price_monthly, currency, features, active, duration_type, duration_days, sort_order)
select '1-Day Trial', 0, 'PHP', '{POS, Menu, Categories, Orders, Reports, Shifts, Payroll}', true, 'trial', 1, 1
where not exists (select 1 from public.plans where name = '1-Day Trial');

insert into public.plans (name, price_monthly, currency, features, active, duration_type, duration_days, sort_order)
select '1-Week Plan', 250, 'PHP', '{POS, Menu, Categories, Orders, Reports, Shifts, Payroll}', true, 'weeks', 7, 2
where not exists (select 1 from public.plans where name = '1-Week Plan');

update public.plans set duration_type = 'months', duration_days = 30, sort_order = 3
where name = 'ZE-POS Monthly' and duration_days = 30 and duration_type = 'months';

-- -------------------------------------------------------------
-- 11. Grants
-- -------------------------------------------------------------
grant execute on function public.admin_list_plans() to authenticated;
grant execute on function public.admin_create_plan(text, numeric, text, integer, text, text[], boolean, integer) to authenticated;
grant execute on function public.admin_update_plan(uuid, text, numeric, text, integer, text, text[], boolean, integer) to authenticated;
grant execute on function public.admin_set_plan_active(uuid, boolean) to authenticated;
grant execute on function public.admin_delete_plan(uuid) to authenticated;
grant execute on function public.admin_record_payment(uuid, numeric, text, text, uuid) to authenticated;
grant execute on function public.admin_assign_plan(uuid, uuid) to authenticated;
