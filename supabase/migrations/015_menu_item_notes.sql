-- =============================================================
-- ZE-POS 015 — Menu Item Notes Column
-- Run AFTER 001_init.sql
--
-- The "Add/Edit Menu Item" form (js/menu.js) has always collected a
-- "Notes (visible to kitchen)" field and sent it as `notes` on every
-- menu_items insert/update. public.menu_items never had a `notes`
-- column (only order_items and shifts do), so every save was rejected
-- by PostgREST with "Could not find the 'notes' column of 'menu_items'
-- in the schema cache" (HTTP 400). Because DB.insert()/update() in
-- js/db.js write through to Supabase in the background and only
-- console.warn on failure, the UI showed "Menu item created" while the
-- write silently failed — the item existed only in the local cache and
-- disappeared on refresh once the cache was re-hydrated from Supabase.
-- =============================================================

alter table public.menu_items
    add column if not exists notes text;

-- Force PostgREST to pick up the new column immediately instead of
-- waiting for its next automatic schema cache refresh.
notify pgrst, 'reload schema';
