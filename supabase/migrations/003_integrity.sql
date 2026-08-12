-- =============================================================
-- ZE-POS 003 — Server-side trust layer
--
-- Run this in the Supabase SQL Editor AFTER 001_init.sql + 002_cashier_auth.sql.
-- Idempotent + backfill-safe (same pattern as 002). Safe on an existing database.
--
-- What this adds:
--   * SERVER-SIDE PAYWALL — tenant rows can no longer be written (insert/update/
--     delete) when the workspace subscription is not active. Reads stay open so
--     owners can still see historical data while overdue. Super admins exempt.
--   * ROLE-GATED WRITES — catalog / menu / settings / payroll / schedules become
--     admin-write + member-read; orders/order_items become member-insert +
--     admin-update/delete; shifts member-insert + self-update / admin-update.
--     Previously every workspace member could rewrite ANY row (incl. their own
--     pay rate and historical orders).
--   * audit_log table + log_action() RPC — who did what, when.
--   * Removed the owner's hardcoded 'cloud-login' credential; users.password is
--     cleared and no longer readable via the API.
--   * billing_paymongo_record() — service-role-only RPC for the PayMongo webhook
--     (fixes the is_super_admin-under-service-role failure of 002's webhook).
--   * Indexes for the hot query paths.
-- =============================================================

-- -------------------------------------------------------------
-- 0. Idempotency: drop any prior 003 policy/artifact names
-- -------------------------------------------------------------
do $$
declare t text;
begin
    foreach t in array array[
        'users','categories','menu_items','menu_sizes','condiments','taxes',
        'orders','order_items','shifts','shift_schedules','payrolls','settings'
    ] loop
        execute format('drop policy if exists "tenant_rw_%s" on public.%I;', t, t);
        execute format('drop policy if exists "catalog_read_%s" on public.%I;', t, t);
        execute format('drop policy if exists "catalog_write_%s" on public.%I;', t, t);
        execute format('drop policy if exists "catalog_update_%s" on public.%I;', t, t);
        execute format('drop policy if exists "catalog_delete_%s" on public.%I;', t, t);
    end loop;
end $$;

drop policy if exists "users_read_members" on public.users;
drop policy if exists "users_write_admin" on public.users;
drop policy if exists "users_update_admin" on public.users;
drop policy if exists "users_delete_admin" on public.users;
drop policy if exists "invites_admin" on public.workspace_invites;
drop policy if exists "orders_read" on public.orders;
drop policy if exists "orders_insert" on public.orders;
drop policy if exists "orders_update_admin" on public.orders;
drop policy if exists "orders_delete_admin" on public.orders;
drop policy if exists "order_items_read" on public.order_items;
drop policy if exists "order_items_insert" on public.order_items;
drop policy if exists "order_items_update_admin" on public.order_items;
drop policy if exists "order_items_delete_admin" on public.order_items;
drop policy if exists "shifts_read" on public.shifts;
drop policy if exists "shifts_insert" on public.shifts;
drop policy if exists "shifts_update" on public.shifts;
drop policy if exists "shifts_delete_admin" on public.shifts;
do $$
begin
    -- audit_log may not exist yet on a fresh database; guard the drop.
    if exists (select 1 from pg_tables where schemaname = 'public' and tablename = 'audit_log') then
        drop policy if exists "audit_read_admin" on public.audit_log;
    end if;
end $$;

-- -------------------------------------------------------------
-- 1. Helpers
-- -------------------------------------------------------------

-- True when the caller's workspace subscription is active. Super admins are
-- always exempt so the SaaS operator can keep using their own account.
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
                and (p.current_period_end is null or p.current_period_end > now()))
        from public.profiles p
        where p.id = public.workspace_of()
    ), false);
$$;

-- True when the current Supabase account is linked (auth_uid) to the given
-- workspace "users" row id. Lets a cashier update their own shift.
create or replace function public.owns_row(p_user_id text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
    select exists (
        select 1
        from public.users u
        where u.workspace_id = public.workspace_of()
          and u.id = p_user_id
          and u.auth_uid = auth.uid()
    );
$$;

-- -------------------------------------------------------------
-- 2. Role-gated + subscription-gated tenant RLS
-- -------------------------------------------------------------

-- Group A — catalog / schedules / payroll / settings:
-- member read, admin write, writes require an active subscription.
do $$
declare t text;
begin
    foreach t in array array[
        'categories','menu_items','menu_sizes','condiments','taxes',
        'shift_schedules','payrolls','settings'
    ] loop
        execute format(
            'create policy "catalog_read_%s" on public.%I for select
             using (workspace_id = public.workspace_of());', t, t);
        execute format(
            'create policy "catalog_write_%s" on public.%I for insert
             with check (workspace_id = public.workspace_of()
                 and public.is_workspace_admin()
                 and public.workspace_subscription_active());', t, t);
        execute format(
            'create policy "catalog_update_%s" on public.%I for update
             using (workspace_id = public.workspace_of() and public.is_workspace_admin())
             with check (workspace_id = public.workspace_of()
                 and public.is_workspace_admin()
                 and public.workspace_subscription_active());', t, t);
        execute format(
            'create policy "catalog_delete_%s" on public.%I for delete
             using (workspace_id = public.workspace_of()
                 and public.is_workspace_admin()
                 and public.workspace_subscription_active());', t, t);
    end loop;
end $$;

-- Group B — orders + order_items: members insert (that's the cashier's job),
-- admins update/delete. All writes require an active subscription.
create policy "orders_read" on public.orders
    for select using (workspace_id = public.workspace_of());
create policy "orders_insert" on public.orders
    for insert with check (workspace_id = public.workspace_of() and public.workspace_subscription_active());
create policy "orders_update_admin" on public.orders
    for update using (workspace_id = public.workspace_of() and public.is_workspace_admin())
    with check (workspace_id = public.workspace_of() and public.is_workspace_admin() and public.workspace_subscription_active());
create policy "orders_delete_admin" on public.orders
    for delete using (workspace_id = public.workspace_of() and public.is_workspace_admin() and public.workspace_subscription_active());

create policy "order_items_read" on public.order_items
    for select using (workspace_id = public.workspace_of());
create policy "order_items_insert" on public.order_items
    for insert with check (workspace_id = public.workspace_of() and public.workspace_subscription_active());
create policy "order_items_update_admin" on public.order_items
    for update using (workspace_id = public.workspace_of() and public.is_workspace_admin())
    with check (workspace_id = public.workspace_of() and public.is_workspace_admin() and public.workspace_subscription_active());
create policy "order_items_delete_admin" on public.order_items
    for delete using (workspace_id = public.workspace_of() and public.is_workspace_admin() and public.workspace_subscription_active());

-- Group C — shifts: member insert; a member may update their OWN shift (open /
-- end it), admins may update/delete anything.
create policy "shifts_read" on public.shifts
    for select using (workspace_id = public.workspace_of());
create policy "shifts_insert" on public.shifts
    for insert with check (workspace_id = public.workspace_of() and public.workspace_subscription_active());
create policy "shifts_update" on public.shifts
    for update using (workspace_id = public.workspace_of()
        and (public.is_workspace_admin() or public.owns_row(user_id)))
    with check (workspace_id = public.workspace_of()
        and (public.is_workspace_admin() or public.owns_row(user_id))
        and public.workspace_subscription_active());
create policy "shifts_delete_admin" on public.shifts
    for delete using (workspace_id = public.workspace_of() and public.is_workspace_admin() and public.workspace_subscription_active());

-- Group D — users roster: member read, admin write, active subscription.
create policy "users_read_members" on public.users
    for select using (workspace_id = public.workspace_of());
create policy "users_write_admin" on public.users
    for insert with check (workspace_id = public.workspace_of() and public.is_workspace_admin() and public.workspace_subscription_active());
create policy "users_update_admin" on public.users
    for update using (workspace_id = public.workspace_of() and public.is_workspace_admin())
    with check (workspace_id = public.workspace_of() and public.is_workspace_admin() and public.workspace_subscription_active());
create policy "users_delete_admin" on public.users
    for delete using (workspace_id = public.workspace_of() and public.is_workspace_admin() and public.workspace_subscription_active());

-- Group E — workspace invites: admin all (write requires active subscription).
create policy "invites_admin" on public.workspace_invites
    for all using (workspace_id = public.workspace_of() and public.is_workspace_admin())
    with check (workspace_id = public.workspace_of() and public.is_workspace_admin() and public.workspace_subscription_active());

-- -------------------------------------------------------------
-- 3. Audit log
-- -------------------------------------------------------------
create table if not exists public.audit_log (
    id uuid primary key default gen_random_uuid(),
    workspace_id uuid not null,
    actor_uid uuid,
    actor_name text,
    action text not null,
    entity_type text,
    entity_id text,
    details jsonb not null default '{}',
    created_at timestamptz not null default now()
);

create index if not exists idx_audit_workspace_created
    on public.audit_log (workspace_id, created_at desc);

alter table public.audit_log enable row level security;

-- Only workspace admins can READ the audit log.
create policy "audit_read_admin" on public.audit_log
    for select using (workspace_id = public.workspace_of() and public.is_workspace_admin());

-- Append-only: no insert/update/delete policies — writes go through log_action().
create or replace function public.log_action(
    p_action text,
    p_entity_type text default null,
    p_entity_id text default null,
    p_details jsonb default '{}'
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
    v_actor_name text;
begin
    if public.workspace_of() is null then
        raise exception 'no workspace';
    end if;

    select name into v_actor_name
    from public.users
    where workspace_id = public.workspace_of()
      and auth_uid = auth.uid()
    limit 1;

    insert into public.audit_log
        (workspace_id, actor_uid, actor_name, action, entity_type, entity_id, details)
    values
        (public.workspace_of(), auth.uid(), v_actor_name, p_action, p_entity_type, p_entity_id, p_details);
end;
$$;

-- -------------------------------------------------------------
-- 4. Owner credential cleanup — no more 'cloud-login'
-- -------------------------------------------------------------

-- Backfill: clear any stored password (owner seed was the literal 'cloud-login').
update public.users set password = null where password is not null;

-- Re-seed function without a password. auth_uid still links the account.
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
    -- No password column value: the owner signs in with their Supabase password.
    insert into public.users (workspace_id, id, username, name, role, enabled, pay_type, hourly_rate, fixed_salary, auth_uid)
    values (ws, ws::text, coalesce((select email from auth.users where id = ws), 'owner'),
            coalesce(owner_name, 'Owner'), 'admin', true, 'hourly', 0, 0, ws)
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

-- Stop shipping the password column to the browser. Column-level grant: select
-- on the API roles but only the columns the app actually uses. service_role is
-- untouched, so the owner (or admin) can still maintain data via SQL tooling.
revoke select on public.users from anon, authenticated;
grant select (workspace_id, id, username, name, role, enabled, pay_type, hourly_rate, fixed_salary, created_at, auth_uid)
    on public.users to anon, authenticated;

-- -------------------------------------------------------------
-- 5. PayMongo webhook RPC (service-role only)
-- -------------------------------------------------------------
create unique index if not exists idx_payments_ref_unique
    on public.payments (profile_id, reference) where reference is not null;

create or replace function public.billing_paymongo_record(
    p_profile_id uuid,
    p_amount numeric,
    p_method text default 'paymongo',
    p_reference text default null
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
    v_period_end timestamptz;
begin
    -- Service-role only: the PayMongo webhook runs as the service role. The
    -- anon key can never call this.
    if auth.role() <> 'service_role' then
        raise exception 'not authorized';
    end if;
    if p_amount <= 0 then
        raise exception 'invalid amount';
    end if;

    select coalesce(current_period_end, now()) + interval '30 days'
    into v_period_end
    from public.profiles
    where id = p_profile_id;

    if v_period_end is null then
        return false; -- unknown profile
    end if;

    -- Idempotency: skip when this reference was already recorded.
    if p_reference is not null and exists (
        select 1 from public.payments where profile_id = p_profile_id and reference = p_reference
    ) then
        return true;
    end if;

    update public.profiles
    set subscription_status = 'active', current_period_end = v_period_end
    where id = p_profile_id;

    insert into public.payments (profile_id, amount, method, status, reference, source, period_start, period_end)
    values (p_profile_id, p_amount, p_method, 'paid', p_reference, 'paymongo', now(), v_period_end);

    return true;
end;
$$;

-- -------------------------------------------------------------
-- 6. Indexes for hot query paths
-- -------------------------------------------------------------
create index if not exists idx_orders_workspace_created on public.orders (workspace_id, created_at desc);
create index if not exists idx_orders_workspace_user on public.orders (workspace_id, user_id);
create index if not exists idx_orders_workspace_status on public.orders (workspace_id, status);
create index if not exists idx_order_items_workspace_order on public.order_items (workspace_id, order_id);
create index if not exists idx_menu_items_category on public.menu_items (workspace_id, category_id);
create index if not exists idx_menu_sizes_item on public.menu_sizes (workspace_id, menu_item_id);
create index if not exists idx_payments_profile_created on public.payments (profile_id, created_at desc);
