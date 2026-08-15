-- =============================================================
-- ZE-POS 004 — Embedded super-admin + operator promote/demote
-- Run FOURTH in Supabase SQL Editor (after 001–003)
--
-- 1) Claims the platform operator account by email (must already
--    exist in Supabase Auth — create it in the Dashboard first:
--    Authentication → Add User → your email, password, auto-confirm).
-- 2) Re-exports admin_list_clients with an is_super_admin column
--    (needed for the operator toggle in the admin dashboard).
-- 3) Adds admin_set_super_admin RPC so any signed-in operator can
--    promote or demote other accounts from admin.html.
-- =============================================================

-- ── 1. Claim the embedded operator ─────────────────────────────
-- Idempotent: safe to re-run.

do $$
declare
    v_email text := 'ev.lounel4195@gmail.com';
    v_uid   uuid;
begin
    select id
      into v_uid
      from auth.users
     where lower(email) = lower(v_email)
     limit 1;

    if v_uid is null then
        raise exception
            'No auth account found for %%. '
            'Create it in the Supabase Dashboard first '
            '(Authentication → Add User) then re-run this migration.', v_email;
    end if;

    -- If the profile was already created by the handle_new_user() trigger,
    -- just flip the flag. If it doesn't exist yet (e.g. trigger was removed
    -- or hasn't fired), insert it. Both paths are idempotent.
    insert into public.profiles (
        id, email, business_name, is_super_admin,
        subscription_status, workspace_id, pending_join
    )
    values (
        v_uid, v_email, 'ZE-POS Admin', true,
        'active', v_uid, false
    )
    on conflict (id) do update
       set is_super_admin       = true,
           subscription_status  = 'active',
           email                = excluded.email;
end $$;

-- ── 2. Redefine admin_list_clients (add is_super_admin) ────────
-- The existing function was created in 001 / 002. Postgres won't
-- let CREATE OR REPLACE change the return shape, so we drop + recreate.

drop function if exists public.admin_list_clients() cascade;

create function public.admin_list_clients()
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
        p.subscription_status,
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

-- ── 3. Promote / demote operators ──────────────────────────────
-- Any signed-in operator can toggle another account's is_super_admin.
-- Self-demotion is blocked; the last remaining operator can never
-- be demoted (prevents lockout).

create or replace function public.admin_set_super_admin(
    p_profile uuid,
    p_make    boolean
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
    v_target_email text;
begin
    if not public.is_super_admin() then
        raise exception 'not authorized';
    end if;

    if p_profile = auth.uid() then
        raise exception 'you cannot change your own operator status';
    end if;

    select email into v_target_email
      from public.profiles
     where id = p_profile;

    if v_target_email is null then
        raise exception 'account not found';
    end if;

    -- Prevent demoting the last remaining operator.
    if p_make = false
       and (select count(*) from public.profiles where is_super_admin = true) <= 1
    then
        raise exception 'cannot demote the last remaining operator';
    end if;

    update public.profiles
       set is_super_admin = p_make
     where id = p_profile;

    -- Append an audit entry in the actor's own workspace log.
    perform public.log_action(
        'super_admin_set',
        'profile',
        p_profile::text,
        jsonb_build_object(
            'target_email', v_target_email,
            'make_operator', p_make
        )
    );
end;
$$;
