-- =============================================================
-- ZE-POS 005 — Multi-Store Support
-- Run FIFTH in Supabase SQL Editor (after 001–004)
--
-- Transforms single-store workspaces into multi-store brands.
-- Each workspace gets a 'stores' table; all tenant tables add store_id.
-- Staff are assigned to specific stores via user_stores.
-- RLS enforces store-level isolation.
-- =============================================================

-- -------------------------------------------------------------
-- 0. Idempotency guards
-- -------------------------------------------------------------
do $$
declare
    t text;
    tables text[] := array['users','categories','menu_items','menu_sizes','condiments','taxes',
        'orders','order_items','shifts','shift_schedules','payrolls','settings'];
begin
    foreach t in array tables loop
        -- drop any 005 policies we might have created before
        execute format('drop policy if exists "tenant_read_%s" on public.%I;', t, t);
        execute format('drop policy if exists "tenant_write_%s" on public.%I;', t, t);
        execute format('drop policy if exists "tenant_insert_%s" on public.%I;', t, t);
        execute format('drop policy if exists "tenant_delete_%s" on public.%I;', t, t);
    end loop;
end $$;

drop function if exists public.current_store() cascade;
drop function if exists public.set_current_store(text) cascade;
drop function if exists public.assigned_stores() cascade;
drop function if exists public.is_store_admin() cascade;

-- -------------------------------------------------------------
-- 0a. CRITICAL: drop ALL 003 integrity policies.
--
-- Migration 003 created per-table policies (catalog_read_*, catalog_write_*,
-- catalog_update_*, catalog_delete_*, orders_read, orders_insert, …). Those
-- policies scope ONLY by workspace_id and have NO store_id check. If they are
-- left in place, Postgres ORs them with the new 005 store-scoped policies on
-- the same tables, and the 003 policies completely BYPASS store isolation —
-- any workspace member could read/write every store's data. We must remove
-- them so only the 005 tenant_read_/tenant_write_ policies remain.
-- -------------------------------------------------------------
do $$
declare
    t text;
begin
    -- Group A: catalog policies (categories, menu_items, menu_sizes, condiments, taxes, shift_schedules, payrolls, settings)
    foreach t in array array[
        'categories','menu_items','menu_sizes','condiments','taxes',
        'shift_schedules','payrolls','settings'
    ] loop
        execute format('drop policy if exists "catalog_read_%s" on public.%I;', t, t);
        execute format('drop policy if exists "catalog_write_%s" on public.%I;', t, t);
        execute format('drop policy if exists "catalog_update_%s" on public.%I;', t, t);
        execute format('drop policy if exists "catalog_delete_%s" on public.%I;', t, t);
    end loop;

    -- Group B: orders + order_items
    execute 'drop policy if exists "orders_read" on public.orders;';
    execute 'drop policy if exists "orders_insert" on public.orders;';
    execute 'drop policy if exists "orders_update_admin" on public.orders;';
    execute 'drop policy if exists "orders_delete_admin" on public.orders;';
    execute 'drop policy if exists "order_items_read" on public.order_items;';
    execute 'drop policy if exists "order_items_insert" on public.order_items;';
    execute 'drop policy if exists "order_items_update_admin" on public.order_items;';
    execute 'drop policy if exists "order_items_delete_admin" on public.order_items;';

    -- Group C: shifts
    execute 'drop policy if exists "shifts_read" on public.shifts;';
    execute 'drop policy if exists "shifts_insert" on public.shifts;';
    execute 'drop policy if exists "shifts_update" on public.shifts;';
    execute 'drop policy if exists "shifts_delete_admin" on public.shifts;';

    -- Group D: users
    execute 'drop policy if exists "users_read_members" on public.users;';
    execute 'drop policy if exists "users_write_admin" on public.users;';
    execute 'drop policy if exists "users_update_admin" on public.users;';
    execute 'drop policy if exists "users_delete_admin" on public.users;';

    -- Group E: workspace_invites
    execute 'drop policy if exists "invites_admin" on public.workspace_invites;';

    -- Audit log read policy (003) — replaced by 007-agnostic admin read; keep
    -- this drop idempotent in case 007 hasn't been applied yet.
    execute 'drop policy if exists "audit_read_admin" on public.audit_log;';
end $$;

-- -------------------------------------------------------------
-- 1. New table: stores
-- -------------------------------------------------------------
create table if not exists public.stores (
    workspace_id uuid not null,
    id text not null,                    -- friendly id: 's1', 's2'...
    name text not null,
    address text,
    phone text,
    enabled boolean not null default true,
    created_at timestamptz not null default now(),
    primary key (workspace_id, id)
);

create index if not exists idx_stores_workspace on public.stores(workspace_id);

-- -------------------------------------------------------------
-- 2. New table: user_stores (many-to-many staff ↔ store)
-- -------------------------------------------------------------
create table if not exists public.user_stores (
    workspace_id uuid not null,
    user_id text not null,
    store_id text not null,
    assigned_at timestamptz not null default now(),
    primary key (workspace_id, user_id, store_id)
);

create index if not exists idx_user_stores_user on public.user_stores(workspace_id, user_id);
create index if not exists idx_user_stores_store on public.user_stores(workspace_id, store_id);

-- -------------------------------------------------------------
-- 3. Add store_id column to all tenant tables (nullable first)
-- -------------------------------------------------------------
alter table public.users          add column if not exists store_id text;
alter table public.categories     add column if not exists store_id text;
alter table public.menu_items     add column if not exists store_id text;
alter table public.menu_sizes     add column if not exists store_id text;
alter table public.condiments     add column if not exists store_id text;
alter table public.taxes          add column if not exists store_id text;
alter table public.orders         add column if not exists store_id text;
alter table public.order_items    add column if not exists store_id text;
alter table public.shifts         add column if not exists store_id text;
alter table public.shift_schedules add column if not exists store_id text;
alter table public.payrolls       add column if not exists store_id text;
alter table public.settings       add column if not exists store_id text;

-- -------------------------------------------------------------
-- 4. Create default store 's1' for every workspace that lacks one
-- -------------------------------------------------------------
insert into public.stores (workspace_id, id, name, created_at)
select
    p.id as workspace_id,
    's1' as id,
    coalesce(p.business_name, 'Main Store') as name,
    now() as created_at
from public.profiles p
where p.id = p.workspace_id               -- only workspace owners
  and not exists (
      select 1 from public.stores s
      where s.workspace_id = p.id
  );

-- -------------------------------------------------------------
-- 5. Backfill store_id = 's1' into all existing tenant rows
-- -------------------------------------------------------------
update public.users           set store_id = 's1' where store_id is null;
update public.categories      set store_id = 's1' where store_id is null;
update public.menu_items      set store_id = 's1' where store_id is null;
update public.menu_sizes      set store_id = 's1' where store_id is null;
update public.condiments      set store_id = 's1' where store_id is null;
update public.taxes           set store_id = 's1' where store_id is null;
update public.orders          set store_id = 's1' where store_id is null;
update public.order_items     set store_id = 's1' where store_id is null;
update public.shifts          set store_id = 's1' where store_id is null;
update public.shift_schedules set store_id = 's1' where store_id is null;
update public.payrolls        set store_id = 's1' where store_id is null;
update public.settings        set store_id = 's1' where store_id is null;

-- -------------------------------------------------------------
-- 6. Link all existing staff to store 's1' in user_stores
--    (admins/owners get implicit access via is_store_admin(), no row needed)
-- -------------------------------------------------------------
insert into public.user_stores (workspace_id, user_id, store_id)
select u.workspace_id, u.id, 's1'
from public.users u
where u.workspace_id is not null
  and not exists (
      select 1 from public.user_stores us
      where us.workspace_id = u.workspace_id
        and us.user_id = u.id
        and us.store_id = 's1'
  );

-- -------------------------------------------------------------
-- 7. Make store_id NOT NULL and extend primary keys
-- -------------------------------------------------------------
do $$
declare t text;
begin
    foreach t in array array[
        'users','categories','menu_items','menu_sizes','condiments','taxes',
        'orders','order_items','shifts','shift_schedules','payrolls','settings'
    ] loop
        -- set NOT NULL
        execute format('alter table public.%I alter column store_id set not null;', t);
        -- drop old PK and create new composite PK (workspace_id, store_id, id)
        execute format('alter table public.%I drop constraint if exists %I_pkey;', t, t);
        execute format('alter table public.%I add primary key (workspace_id, store_id, id);', t);
        -- index for store-scoped queries
        execute format('create index if not exists idx_%s_store on public.%I(workspace_id, store_id);', t, t);
    end loop;
end $$;

-- stores and user_stores already have correct PKs

-- -------------------------------------------------------------
-- 8. Helper functions for store context
-- -------------------------------------------------------------

-- Session variable to hold the current store_id (per transaction)
-- Uses pg_setting namespace 'app.current_store_id'
create or replace function public.set_current_store(p_store_id text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
    -- Validate the store exists in the caller's workspace
    if not exists (
        select 1 from public.stores s
        where s.workspace_id = public.workspace_of()
          and s.id = p_store_id
          and s.enabled
    ) then
        raise exception 'store % not found or not enabled in your workspace', p_store_id;
    end if;
    perform set_config('app.current_store_id', p_store_id, false);
end;
$$;

create or replace function public.current_store()
returns text
language sql
stable
security definer
set search_path = public
as $$
    select current_setting('app.current_store_id', true);
$$;

-- All stores the current user is assigned to (or all if workspace admin).
-- Returns a SINGLE array. The previous UNION ALL version returned two rows
-- (member stores + all workspace stores) but the function is scalar
-- (RETURNS text[]), so Postgres discarded all but the first row — for admins
-- that was the (often empty) user_stores row, yielding [] and zero visible
-- data. We now merge both sources into one array via a subquery.
create or replace function public.assigned_stores()
returns text[]
language sql
stable
security definer
set search_path = public
as $$
    select coalesce(array_agg(distinct store_id), array[]::text[])
    from (
        -- stores this user is explicitly assigned to
        select us.store_id
        from public.user_stores us
        join public.users u
          on u.workspace_id = us.workspace_id and u.id = us.user_id
        where us.workspace_id = public.workspace_of()
          and u.auth_uid = auth.uid()
        union
        -- admins/owners/super-admins implicitly get every workspace store
        select s.id as store_id
        from public.stores s
        where s.workspace_id = public.workspace_of()
          and (
              exists (
                  select 1 from public.profiles p
                  where p.id = public.workspace_of()
                    and p.is_super_admin
              )
              or exists (
                  select 1 from public.users u2
                  where u2.workspace_id = public.workspace_of()
                    and u2.auth_uid = auth.uid()
                    and u2.role = 'admin'
              )
          )
    ) t;
$$;

-- True if current user can manage the given store (workspace admin or assigned admin)
create or replace function public.is_store_admin(p_store_id text default public.current_store())
returns boolean
language sql
stable
security definer
set search_path = public
as $$
    select (
        -- workspace owner / super-admin
        exists (
            select 1 from public.profiles p
            where p.id = public.workspace_of()
              and (p.is_super_admin or p.id = auth.uid())
        )
        or
        -- workspace admin role in users table
        exists (
            select 1 from public.users u
            where u.workspace_id = public.workspace_of()
              and u.auth_uid = auth.uid()
              and u.role = 'admin'
        )
        or
        -- explicitly assigned as admin to this store (future: add role column to user_stores)
        false
    );
$$;

-- -------------------------------------------------------------
-- 9. RLS Policies — store-scoped isolation
-- Pattern: workspace_id = workspace_of() AND store_id = ANY(assigned_stores())
-- Admins (is_store_admin) bypass store check for writes.
-- -------------------------------------------------------------

-- stores: members read all workspace stores; admins write
alter table public.stores enable row level security;

create policy "stores_read_members"
on public.stores for select
using (
    workspace_id = public.workspace_of()
    and exists (
        select 1 from public.profiles p
        where p.id = public.workspace_of()
          and p.id = auth.uid()  -- owner
        union all
        select 1 from public.users u
        where u.workspace_id = public.workspace_of()
          and u.auth_uid = auth.uid()
    )
);

create policy "stores_write_admin"
on public.stores for all
using (
    workspace_id = public.workspace_of()
    and public.is_store_admin()
)
with check (
    workspace_id = public.workspace_of()
    and public.is_store_admin()
);

-- user_stores: members read own assignments; admins manage all
alter table public.user_stores enable row level security;

create policy "user_stores_read_own"
on public.user_stores for select
using (
    workspace_id = public.workspace_of()
    and user_id in (
        select id from public.users
        where workspace_id = public.workspace_of()
          and auth_uid = auth.uid()
    )
);

create policy "user_stores_write_admin"
on public.user_stores for all
using (
    workspace_id = public.workspace_of()
    and public.is_store_admin()
)
with check (
    workspace_id = public.workspace_of()
    and public.is_store_admin()
);

-- Tenant tables: unified read/write policies
do $$
declare t text;
begin
    foreach t in array array[
        'users','categories','menu_items','menu_sizes','condiments','taxes',
        'orders','order_items','shifts','shift_schedules','payrolls','settings'
    ] loop
        execute format($pol$
            alter table public.%I enable row level security;

            -- Read: workspace member + store in assigned_stores()
            create policy "tenant_read_%I"
            on public.%I for select
            using (
                workspace_id = public.workspace_of()
                and store_id = any(public.assigned_stores())
            );

            -- Insert: any workspace member with an active subscription (cashiers included)
            create policy "tenant_insert_%I"
            on public.%I for insert
            with check (
                workspace_id = public.workspace_of()
                and store_id = any(public.assigned_stores())
                and public.workspace_subscription_active()
            );

            -- Update/Delete: store admin OR owns own row (shift/user)
            create policy "tenant_write_%I"
            on public.%I for update using (
                workspace_id = public.workspace_of()
                and store_id = any(public.assigned_stores())
                and public.workspace_subscription_active()
                and (
                    public.is_store_admin(store_id)
                    or public.owns_row(id)
                )
            );

            create policy "tenant_delete_%I"
            on public.%I for delete using (
                workspace_id = public.workspace_of()
                and store_id = any(public.assigned_stores())
                and public.workspace_subscription_active()
                and (
                    public.is_store_admin(store_id)
                    or public.owns_row(id)
                )
            );
        $pol$, t, t, t, t, t, t, t, t, t);
    end loop;
end $$;

-- -------------------------------------------------------------
-- 10. Update seed_workspace to create default store (or seed a specific store)
-- -------------------------------------------------------------
-- Must DROP first because CREATE OR REPLACE cannot change function arity.
drop function if exists public.seed_workspace() cascade;

create or replace function public.seed_workspace(p_store_id text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
    v_ws uuid := public.workspace_of();
    v_store_id text := coalesce(p_store_id, 's1');
    owner_name text;
begin
    select business_name into owner_name from public.profiles where id = v_ws;

    -- Create default store if missing
    insert into public.stores (workspace_id, id, name, created_at)
    values (v_ws, v_store_id, coalesce(owner_name, 'Main Store'), now())
    on conflict (workspace_id, id) do nothing;

    -- Owner admin user (id = workspace id; auth_uid links to the owner account)
    insert into public.users (workspace_id, store_id, id, username, name, role, enabled, pay_type, hourly_rate, fixed_salary, auth_uid)
    values (v_ws, v_store_id, v_ws::text, coalesce((select email from auth.users where id = v_ws), 'owner'), coalesce(owner_name, 'Owner'), 'admin', true, 'hourly', 0, 0, v_ws)
    on conflict (workspace_id, store_id, id) do nothing;

    -- Seed core tables scoped to that store
    -- settings
    insert into public.settings (workspace_id, store_id, id, key, value, created_at)
    select v_ws, v_store_id, 'currency', 'currency', 'PHP', now()
    where not exists (select 1 from public.settings where workspace_id = v_ws and store_id = v_store_id and key = 'currency');

    insert into public.settings (workspace_id, store_id, id, key, value, created_at)
    select v_ws, v_store_id, 'currency_symbol', 'currency_symbol', '₱', now()
    where not exists (select 1 from public.settings where workspace_id = v_ws and store_id = v_store_id and key = 'currency_symbol');

    insert into public.settings (workspace_id, store_id, id, key, value, created_at)
    select v_ws, v_store_id, 'tax_name', 'tax_name', 'VAT', now()
    where not exists (select 1 from public.settings where workspace_id = v_ws and store_id = v_store_id and key = 'tax_name');

    insert into public.settings (workspace_id, store_id, id, key, value, created_at)
    select v_ws, v_store_id, 'tax_percentage', 'tax_percentage', '12', now()
    where not exists (select 1 from public.settings where workspace_id = v_ws and store_id = v_store_id and key = 'tax_percentage');

    -- default tax row
    insert into public.taxes (workspace_id, store_id, id, name, percentage, enabled, created_at)
    select v_ws, v_store_id, 'vat12', 'VAT 12%', 12, true, now()
    where not exists (select 1 from public.taxes where workspace_id = v_ws and store_id = v_store_id and id = 'vat12');

    -- default category
    insert into public.categories (workspace_id, store_id, id, name, enabled, created_at)
    select v_ws, v_store_id, 'food', 'Food', true, now()
    where not exists (select 1 from public.categories where workspace_id = v_ws and store_id = v_store_id and id = 'food');

    -- default condiment group
    insert into public.condiments (workspace_id, store_id, id, name, price, enabled, created_at)
    select v_ws, v_store_id, 'rice', 'Extra Rice', 15.00, true, now()
    where not exists (select 1 from public.condiments where workspace_id = v_ws and store_id = v_store_id and id = 'rice');
end;
$$;

-- -------------------------------------------------------------
-- 11. Grant execute on new functions to anon/authenticated
-- -------------------------------------------------------------
grant execute on function public.set_current_store(text) to anon, authenticated;
grant execute on function public.current_store() to anon, authenticated;
grant execute on function public.assigned_stores() to anon, authenticated;
grant execute on function public.is_store_admin(text) to anon, authenticated;
grant execute on function public.seed_workspace(text) to anon, authenticated;