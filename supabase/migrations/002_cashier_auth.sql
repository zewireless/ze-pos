-- =============================================================
-- ZE-POS 002 — Direct cashier logins (invite-code provisioning)
--
-- Run this in the Supabase SQL Editor AFTER 001_init.sql.
-- Safe to run on an existing database (backfills + idempotent).
--
-- What this does:
--   * profiles.workspace_id  — the workspace each account belongs to.
--       Owner:  workspace_id = id (self).
--       Cashier: workspace_id = the owner's id.
--   * users.auth_uid         — links a Supabase account to its staff row.
--   * Tenant RLS re-keyed from `workspace_id = auth.uid()` to
--       `workspace_id = workspace_of()` (membership-based).
--   * Invite-code provisioning: owner generates a one-time code, the
--       cashier signs up on join.html and the account is linked to the
--       workspace. No edge functions / service_role needed.
-- =============================================================

-- -------------------------------------------------------------
-- 1. profiles: workspace membership
-- -------------------------------------------------------------
alter table public.profiles add column if not exists workspace_id uuid;
alter table public.profiles add column if not exists pending_join boolean not null default false;

-- Existing owners become self-owned workspaces.
update public.profiles set workspace_id = id where workspace_id is null;

alter table public.profiles alter column workspace_id set not null;
create index if not exists idx_profiles_workspace on public.profiles(workspace_id);

-- Rework the signup trigger: every new account self-owns a workspace.
-- (Never trust client-supplied metadata for membership — join_workspace()
-- below is the ONLY way an account is reassigned, and it requires a
-- pending_join flag + a valid single-use code.)
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
    insert into public.profiles (id, email, business_name, subscription_status, workspace_id, pending_join)
    values (
        new.id,
        new.email,
        coalesce(new.raw_user_meta_data->>'business_name', 'My Business'),
        'never',
        new.id,
        false
    );
    return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
    after insert on auth.users
    for each row execute function public.handle_new_user();

-- -------------------------------------------------------------
-- 2. users: link staff rows to their Supabase account
-- -------------------------------------------------------------
alter table public.users add column if not exists auth_uid uuid;

-- The owner row's id = workspace_id::text, so it maps to the owner's account.
update public.users u
   set auth_uid = u.workspace_id
 where u.auth_uid is null
   and u.id = u.workspace_id::text;

-- -------------------------------------------------------------
-- 3. Membership helpers
-- -------------------------------------------------------------

-- The workspace the current user belongs to.
create or replace function public.workspace_of()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
    select workspace_id from public.profiles where id = auth.uid();
$$;

-- Is the current user an admin in their workspace?
-- The owner's users row is role 'admin' with auth_uid = their own uid, so
-- this also covers the owner.
create or replace function public.is_workspace_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
    select exists (
        select 1 from public.users u
        where u.workspace_id = public.workspace_of()
          and u.auth_uid = auth.uid()
          and u.role = 'admin'
    );
$$;

-- -------------------------------------------------------------
-- 4. RLS rework — membership-based tenant isolation
-- -------------------------------------------------------------

-- Drop the old auth.uid()-based policies on all tenant tables.
do $$
declare t text;
begin
    foreach t in array array[
        'users','categories','menu_items','menu_sizes','condiments','taxes',
        'orders','order_items','shifts','shift_schedules','payrolls','settings'
    ] loop
        execute format('drop policy if exists "tenant_rw_%s" on public.%I;', t, t);
    end loop;
end $$;

-- Non-user tenant tables: all members read + write their workspace's rows.
do $$
declare t text;
begin
    foreach t in array array[
        'categories','menu_items','menu_sizes','condiments','taxes',
        'orders','order_items','shifts','shift_schedules','payrolls','settings'
    ] loop
        execute format(
            'create policy "tenant_rw_%s" on public.%I for all
             using (workspace_id = public.workspace_of())
             with check (workspace_id = public.workspace_of());', t, t);
    end loop;
end $$;

-- users: everyone may READ the roster (needed for shifts/schedules), but only
-- workspace admins may create / edit / delete staff accounts.
create policy "users_read_members" on public.users
    for select using (workspace_id = public.workspace_of());

create policy "users_write_admin" on public.users
    for insert with check (workspace_id = public.workspace_of() and public.is_workspace_admin());

create policy "users_update_admin" on public.users
    for update using (workspace_id = public.workspace_of() and public.is_workspace_admin())
    with check (workspace_id = public.workspace_of() and public.is_workspace_admin());

create policy "users_delete_admin" on public.users
    for delete using (workspace_id = public.workspace_of() and public.is_workspace_admin());

-- -------------------------------------------------------------
-- 5. Invite codes
-- -------------------------------------------------------------
create table if not exists public.workspace_invites (
    id uuid primary key default gen_random_uuid(),
    workspace_id uuid not null,
    user_id text not null,                 -- the users row this code activates
    code text not null unique,
    used_by uuid,
    expires_at timestamptz not null default (now() + interval '7 days'),
    created_at timestamptz not null default now()
);

alter table public.workspace_invites enable row level security;

create policy "invites_admin" on public.workspace_invites
    for all using (workspace_id = public.workspace_of() and public.is_workspace_admin())
    with check (workspace_id = public.workspace_of() and public.is_workspace_admin());

-- Owner/admin generates a one-time code for a staff member.
create or replace function public.create_workspace_invite(p_user_id text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
    v_code text;
begin
    if not public.is_workspace_admin() then
        raise exception 'Not authorized';
    end if;
    if not exists (
        select 1 from public.users
        where workspace_id = public.workspace_of() and id = p_user_id
    ) then
        raise exception 'Staff member not found';
    end if;
    if exists (
        select 1 from public.users
        where workspace_id = public.workspace_of() and id = p_user_id
          and auth_uid is not null
    ) then
        raise exception 'This staff member already has an account';
    end if;

    v_code := upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10));
    insert into public.workspace_invites (workspace_id, user_id, code)
    values (public.workspace_of(), p_user_id, v_code);
    return v_code;
end;
$$;

-- Marks the current account as "fresh, waiting to join a workspace".
create or replace function public.mark_join_pending()
returns void
language sql
security definer
set search_path = public
as $$
    update public.profiles set pending_join = true where id = auth.uid();
$$;

-- Links the current (freshly signed-up) account to the workspace that owns
-- the code, activates its staff row, and marks the code used.
create or replace function public.join_workspace(p_code text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
    v_invite record;
begin
    -- Only a freshly signed-up account that explicitly asked to join may do so
    -- (prevents an existing owner/admin from being reassigned by a stray code).
    if not exists (
        select 1 from public.profiles
        where id = auth.uid() and pending_join = true
    ) then
        raise exception 'This account is not awaiting a workspace invite';
    end if;

    select * into v_invite from public.workspace_invites
    where code = upper(p_code)
      and used_by is null
      and expires_at > now()
    limit 1;

    if v_invite is null then
        raise exception 'Invalid, used, or expired invite code';
    end if;

    -- Reassign the account to the workspace and adopt its business name.
    update public.profiles
       set workspace_id = v_invite.workspace_id,
           pending_join = false,
           business_name = coalesce(
               (select business_name from public.profiles where id = v_invite.workspace_id),
               business_name
           )
     where id = auth.uid();

    -- Link the account to its staff row.
    update public.users
       set auth_uid = auth.uid()
     where workspace_id = v_invite.workspace_id
       and id = v_invite.user_id;

    -- Mark the code used (single-use).
    update public.workspace_invites
       set used_by = auth.uid()
     where id = v_invite.id;

    return true;
end;
$$;

-- -------------------------------------------------------------
-- 6. seed_workspace — resolve the workspace from membership
-- -------------------------------------------------------------
create or replace function public.seed_workspace()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
    ws uuid;
    owner_name text;
    existing_settings integer;
begin
    select workspace_id into ws from public.profiles where id = auth.uid();
    if ws is null then
        ws := auth.uid();
    end if;

    select business_name into owner_name from public.profiles where id = ws;

    -- Owner admin user (id = workspace id; auth_uid links to the owner account).
    insert into public.users (workspace_id, id, username, password, name, role, enabled, pay_type, hourly_rate, fixed_salary, auth_uid)
    values (ws, ws::text, coalesce((select email from auth.users where id = ws), 'owner'), 'cloud-login', coalesce(owner_name, 'Owner'), 'admin', true, 'hourly', 0, 0, ws)
    on conflict (workspace_id, id) do nothing;

    -- Default settings (restaurant info + overtime rules)
    select count(*) into existing_settings from public.settings where workspace_id = ws;
    if existing_settings = 0 then
        insert into public.settings (workspace_id, id, key, value) values
        (ws, 'st1', 'restaurant_name', coalesce(owner_name, 'My Business')),
        (ws, 'st2', 'restaurant_address', ''),
        (ws, 'st3', 'restaurant_phone', ''),
        (ws, 'st4', 'currency_symbol', '₱'),
        (ws, 'st5', 'overtime_enabled', '0'),
        (ws, 'st6', 'overtime_daily_threshold', '8'),
        (ws, 'st7', 'overtime_weekly_threshold', '40'),
        (ws, 'st8', 'overtime_multiplier', '1.5');
    end if;

    -- Starter categories + menu (only if the workspace is empty)
    if not exists (select 1 from public.categories where workspace_id = ws) then
        insert into public.categories (workspace_id, id, name, description, enabled) values
        (ws, 'c1', 'Burgers', 'Flame-grilled burgers', true),
        (ws, 'c2', 'Pizza', 'Wood-fired pizzas', true),
        (ws, 'c3', 'Drinks', 'Refreshing beverages', true),
        (ws, 'c4', 'Desserts', 'Sweet treats', true),
        (ws, 'c5', 'Sides', 'Crispy sides', true);

        insert into public.menu_items (workspace_id, id, name, description, category_id, enabled) values
        (ws, 'm1', 'Zinger Burger', 'Crispy chicken fillet with mayo', 'c1', true),
        (ws, 'm2', 'Classic Burger', 'Beef patty with lettuce & tomato', 'c1', true),
        (ws, 'm3', 'Chicken Pizza', 'Grilled chicken & mozzarella', 'c2', true),
        (ws, 'm4', 'Pepperoni Pizza', 'Classic pepperoni & cheese', 'c2', true),
        (ws, 'm5', 'Coke', 'Chilled Coca-Cola', 'c3', true),
        (ws, 'm6', 'Pepsi', 'Chilled Pepsi', 'c3', true),
        (ws, 'm7', 'Chocolate Cake', 'Rich chocolate layer cake', 'c4', true),
        (ws, 'm8', 'French Fries', 'Golden crispy fries', 'c5', true),
        (ws, 'm9', 'Onion Rings', 'Battered onion rings', 'c5', true),
        (ws, 'm10', 'Ice Cream Sundae', 'Vanilla ice cream with toppings', 'c4', true);
    end if;
end;
$$;

-- -------------------------------------------------------------
-- 7. Billing / admin RPCs — resolve membership, not auth.uid()
-- -------------------------------------------------------------

-- Billing snapshot for the signed-in user's WORKSPACE (so a cashier sees the
-- business's subscription, not their own stub profile — otherwise every
-- cashier would be locked behind the paywall).
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
        'plan_name', plan.name,
        'price_monthly', plan.price_monthly,
        'currency', plan.currency,
        'payments', coalesce((
            select jsonb_agg(jsonb_build_object(
                'amount', pay.amount, 'method', pay.method, 'status', pay.status,
                'reference', pay.reference, 'source', pay.source, 'created_at', pay.created_at
            ) order by pay.created_at desc)
            from public.payments pay where pay.profile_id = prof.id
        ), '[]'::jsonb)
    ) into result
    from public.profiles prof
    left join public.plans plan on plan.id = prof.plan_id
    where prof.id = public.workspace_of();

    return coalesce(result, '{}'::jsonb);
end;
$$;

-- Admin dashboard: only list OWNER profiles as clients (a profile is an owner
-- when workspace_id = id; cashier stub profiles are members, not clients).
create or replace function public.admin_list_clients()
returns table (
    id uuid,
    business_name text,
    email text,
    plan_id uuid,
    plan_name text,
    subscription_status text,
    current_period_end timestamptz,
    last_payment_at timestamptz,
    created_at timestamptz
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
        (select max(pay.created_at) from public.payments pay where pay.profile_id = p.id),
        p.created_at
    from public.profiles p
    left join public.plans pl on pl.id = p.plan_id
    where public.is_super_admin()
      and p.id = p.workspace_id
    order by p.created_at desc;
$$;
