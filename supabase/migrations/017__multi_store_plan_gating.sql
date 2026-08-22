-- =============================================================
-- ZE-POS 017 — Gate Multi-Store behind a plan feature
-- Run AFTER 016_break_store_id.sql
--
-- Business rule: only the Trial plan and the 499 plan may add
-- additional stores. The 299 plan is limited to a single store.
--
-- Enforced in TWO places so it can't be bypassed by editing the
-- frontend or calling the API directly:
--   1. A BEFORE INSERT trigger on public.stores that blocks a 2nd+
--      store unless the workspace's current plan has the
--      'MultiStore' feature.
--   2. get_my_billing() now also returns plan_features so the
--      frontend can hide/disable the "+ Add Store" UI proactively
--      (nicer UX, not itself a security boundary).
--
-- Idempotent: safe to re-run.
-- =============================================================

-- -------------------------------------------------------------
-- 1. Tag the existing seeded plans with the 'MultiStore' feature.
--    Matched by name since these were created ad-hoc via the admin
--    dashboard (not the 001/009 migration seeds). Adjust the WHERE
--    patterns below if your plan names differ.
-- -------------------------------------------------------------

-- Trial plan → gets MultiStore
update public.plans
   set features = array(select distinct unnest(features || array['MultiStore']))
 where name ilike '%trial%'
   and not ('MultiStore' = any(features));

-- 499 plan → gets MultiStore
update public.plans
   set features = array(select distinct unnest(features || array['MultiStore']))
 where name ilike '%499%'
   and not ('MultiStore' = any(features));

-- 299 plan → explicitly does NOT get MultiStore (strip it if present,
-- e.g. if this migration is re-run after a manual edit)
update public.plans
   set features = array(select unnest(features) except select 'MultiStore')
 where name ilike '%299%'
   and 'MultiStore' = any(features);

-- -------------------------------------------------------------
-- 2. Helper: does the current workspace's active plan allow
--    multiple stores?
-- -------------------------------------------------------------
create or replace function public.current_plan_features()
returns text[]
language sql
security definer
set search_path = public
as $$
    select coalesce(pl.features, '{}'::text[])
    from public.profiles p
    left join public.plans pl on pl.id = p.plan_id
    where p.id = public.workspace_of();
$$;

create or replace function public.plan_allows_multi_store()
returns boolean
language sql
security definer
set search_path = public
as $$
    select 'MultiStore' = any(public.current_plan_features());
$$;

-- -------------------------------------------------------------
-- 3. Trigger: block creating a 2nd+ store unless the plan allows it.
--    The very first store (created by seed_workspace, id 's1') is
--    never blocked, so onboarding always works regardless of plan.
-- -------------------------------------------------------------
create or replace function public.enforce_store_plan_limit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
    v_existing_count integer;
begin
    select count(*) into v_existing_count
    from public.stores
    where workspace_id = new.workspace_id;

    if v_existing_count >= 1 and not public.plan_allows_multi_store() then
        raise exception 'Your current plan does not support multiple stores. Upgrade to the 499 plan (or use the Trial) to add more stores.'
            using errcode = 'P0001';
    end if;

    return new;
end;
$$;

drop trigger if exists trg_enforce_store_plan_limit on public.stores;
create trigger trg_enforce_store_plan_limit
    before insert on public.stores
    for each row
    execute function public.enforce_store_plan_limit();

-- -------------------------------------------------------------
-- 4. get_my_billing() — add plan_features so the client can show/
--    hide the "+ Add Store" button without waiting for a failed
--    insert. Same shape as migration 010's version otherwise.
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
        'plan_features', coalesce(plan.features, '{}'::text[]),
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
-- 5. Grants
-- -------------------------------------------------------------
grant execute on function public.current_plan_features() to authenticated;
grant execute on function public.plan_allows_multi_store() to authenticated;
grant execute on function public.get_my_billing() to anon, authenticated;
