-- =============================================================
-- ZE-POS 037 — Fix: cashiers cannot end their own shift
-- Run AFTER 001_init.sql (and after 005_multi_store.sql)
--
-- BUG: migration 005_multi_store.sql rewrote every tenant table's
-- update/delete RLS policy with one generic template that checks
-- `public.owns_row(id)` — i.e. "does this row's own primary key
-- match my user id?". That's correct for `users` (id = the user's
-- own id) but wrong for `shifts`, where `id` is the shift's own
-- randomly generated id, never a user id. So `owns_row(id)` is
-- always false there, and only an admin (`is_store_admin()`) has
-- actually been able to close a shift since multi-store shipped.
-- A cashier's "End Shift" looked like it worked (optimistic local
-- update) but silently failed to sync and retried forever.
--
-- FIX: recreate the shifts update/delete policies checking
-- `owns_row(user_id)` — the shift's owner — same as the original
-- single-store policy in 003_integrity.sql, restoring a cashier's
-- ability to close their own shift while store admins can still
-- manage every shift in their store(s).
-- =============================================================

drop policy if exists "tenant_write_shifts" on public.shifts;
drop policy if exists "tenant_delete_shifts" on public.shifts;

create policy "tenant_write_shifts"
on public.shifts for update using (
    workspace_id = public.workspace_of()
    and store_id = any(public.assigned_stores())
    and public.workspace_subscription_active()
    and (
        public.is_store_admin(store_id)
        or public.owns_row(user_id)
    )
);

create policy "tenant_delete_shifts"
on public.shifts for delete using (
    workspace_id = public.workspace_of()
    and store_id = any(public.assigned_stores())
    and public.workspace_subscription_active()
    and (
        public.is_store_admin(store_id)
        or public.owns_row(user_id)
    )
);
