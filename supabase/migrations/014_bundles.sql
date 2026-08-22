-- =============================================================
-- ZE-POS 014 — Bundles / Combo Meals
-- Run AFTER 001–013 (needs workspace_of(), assigned_stores(),
-- is_store_admin(), owns_row(), workspace_subscription_active()
-- from 005_multi_store.sql).
--
-- js/bundles.js and js/db.js have referenced a `bundles` and
-- `bundle_items` table since they were added to the app, but no
-- migration ever created them — hence:
--   "Could not find the table 'public.bundle_items' in the schema cache"
-- This migration creates both tables, store-scoped like every other
-- catalog table (menu_items, condiments, etc).
-- =============================================================

create table if not exists public.bundles (
    workspace_id uuid not null,
    store_id text not null,
    id text not null,
    name text,
    description text,
    price numeric(12,2) not null default 0,
    image text,
    enabled boolean not null default true,
    created_at timestamptz not null default now(),
    primary key (workspace_id, store_id, id)
);

create table if not exists public.bundle_items (
    workspace_id uuid not null,
    store_id text not null,
    id text not null,
    bundle_id text not null,
    menu_item_id text not null,
    quantity integer not null default 1,
    created_at timestamptz not null default now(),
    primary key (workspace_id, store_id, id)
);

create index if not exists idx_bundles_store on public.bundles(workspace_id, store_id);
create index if not exists idx_bundle_items_bundle on public.bundle_items(workspace_id, store_id, bundle_id);

-- Same read/insert/write/delete pattern as the other tenant tables
-- added in 005_multi_store.sql.
do $$
declare t text;
begin
    foreach t in array array['bundles','bundle_items'] loop
        execute format('drop policy if exists "tenant_read_%s" on public.%I;', t, t);
        execute format('drop policy if exists "tenant_insert_%s" on public.%I;', t, t);
        execute format('drop policy if exists "tenant_write_%s" on public.%I;', t, t);
        execute format('drop policy if exists "tenant_delete_%s" on public.%I;', t, t);

        execute format($pol$
            alter table public.%I enable row level security;

            create policy "tenant_read_%I"
            on public.%I for select
            using (
                workspace_id = public.workspace_of()
                and store_id = any(public.assigned_stores())
            );

            create policy "tenant_insert_%I"
            on public.%I for insert
            with check (
                workspace_id = public.workspace_of()
                and store_id = any(public.assigned_stores())
                and public.workspace_subscription_active()
            );

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
        $pol$, t, t, t, t, t, t, t, t, t, t);
    end loop;
end $$;

-- Make PostgREST pick up the new tables immediately instead of
-- waiting for its next automatic schema-cache refresh.
notify pgrst, 'reload schema';
