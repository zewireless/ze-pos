-- =============================================================
-- ZE-POS 016 — Breaks Table Store Scoping
-- Run AFTER 013_breaks_and_shift_notes.sql
--
-- Migration 005 added store_id to every tenant table (shifts, orders,
-- menu_items, etc.) so DB.js's generic insert/update/cache layer can
-- store-scope everything uniformly. Migration 013 (which shipped later)
-- introduced the `breaks` table but never gave it a store_id column or
-- updated its RLS to the store-scoped pattern the rest of the schema
-- uses. js/db.js unconditionally injects a store_id on every insert/
-- update for every table, so every "Rest"/"Meal" break click failed
-- with "Could not find the 'breakType'/'store_id' column of 'breaks'".
-- This backfills store_id from each break's parent shift and brings
-- RLS in line with the tenant_read_/tenant_insert_/tenant_write_
-- pattern from 005_multi_store.sql.
-- =============================================================

-- 1. Add store_id (nullable first, so we can backfill)
alter table public.breaks add column if not exists store_id text;

-- 2. Backfill from the parent shift's store_id
update public.breaks b
set store_id = s.store_id
from public.shifts s
where b.shift_id = s.id
  and b.workspace_id = s.workspace_id
  and b.store_id is null;

-- Any orphaned breaks with no matching shift fall back to the default store
update public.breaks set store_id = 's1' where store_id is null;

-- 3. Make NOT NULL and extend the primary key
alter table public.breaks alter column store_id set not null;
alter table public.breaks drop constraint if exists breaks_pkey;
alter table public.breaks add primary key (workspace_id, store_id, id);

create index if not exists idx_breaks_store on public.breaks (workspace_id, store_id);

-- 4. Replace the old workspace-only policies with the store-scoped
--    pattern used by every other tenant table (see 005_multi_store.sql).
drop policy if exists "breaks_read" on public.breaks;
drop policy if exists "breaks_insert" on public.breaks;
drop policy if exists "breaks_update" on public.breaks;

create policy "tenant_read_breaks"
on public.breaks for select
using (
    workspace_id = public.workspace_of()
    and store_id = any(public.assigned_stores())
);

create policy "tenant_insert_breaks"
on public.breaks for insert
with check (
    workspace_id = public.workspace_of()
    and store_id = any(public.assigned_stores())
    and public.workspace_subscription_active()
);

create policy "tenant_write_breaks"
on public.breaks for update using (
    workspace_id = public.workspace_of()
    and store_id = any(public.assigned_stores())
    and public.workspace_subscription_active()
    and (
        public.is_store_admin(store_id)
        or user_id = (select id from public.get_my_workspace_and_user())
    )
);

-- Force PostgREST to pick up the new column immediately.
notify pgrst, 'reload schema';
