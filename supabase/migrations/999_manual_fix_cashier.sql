-- =============================================================
-- ONE-TIME MANUAL FIX for a staff member already stuck as the
-- admin/owner of their own accidental workspace (see 025_fix_invite_join.sql
-- for the underlying bug and permanent fix for future signups).
--
-- Run 024_order_void.sql and 025_fix_invite_join.sql FIRST.
--
-- ⚠️ Step 3 below deletes data. Only proceed if the cashier hasn't
-- already added real menu items, made real sales, etc. inside their
-- accidental workspace — if they have and you want that data
-- preserved or migrated instead of discarded, stop here and ask
-- first rather than running this.
--
-- ── Step A: find the two values you need ──────────────────────
-- Run this first to get your own workspace_id (you're logged in as
-- the admin/owner, so this is your account's own id):
--
--   select id as your_workspace_id, business_name
--   from public.profiles
--   where email = 'PASTE_YOUR_OWN_ADMIN_EMAIL_HERE';
--
-- Then, using that workspace_id, find the staff row you originally
-- created for the cashier in Staff Management (the one with no
-- linked sign-in yet):
--
--   select id as staff_row_id, name, username
--   from public.users
--   where workspace_id = 'PASTE_YOUR_WORKSPACE_ID_FROM_ABOVE'
--     and auth_uid is null;
--
-- Paste both results into v_staff_row_id below (v_your_workspace_id
-- is looked up automatically from it, you don't need to paste that
-- one). Then run Step B.
-- =============================================================

-- ── Step B: the actual fix ─────────────────────────────────────
do $$
declare
    v_cashier_email text := 'PASTE_CASHIERS_EMAIL_HERE';
    v_staff_row_id text := 'PASTE_STAFF_ROW_ID_HERE';

    v_cashier_uid uuid;
    v_your_workspace_id uuid;
begin
    -- Find the cashier's actual auth account (created when they signed up
    -- via the invite link).
    select id into v_cashier_uid from auth.users where email = v_cashier_email;
    if v_cashier_uid is null then
        raise exception 'No auth account found for %', v_cashier_email;
    end if;

    -- Find the intended staff row and confirm it belongs to your workspace.
    select workspace_id into v_your_workspace_id
    from public.users where id = v_staff_row_id;
    if v_your_workspace_id is null then
        raise exception 'No staff row found with id %', v_staff_row_id;
    end if;

    -- 1. Move their profile off the accidental self-owned workspace and
    --    onto yours.
    update public.profiles
       set workspace_id = v_your_workspace_id,
           pending_join = false,
           business_name = (select business_name from public.profiles where id = v_your_workspace_id)
     where id = v_cashier_uid;

    -- 2. Link the auth account to the staff row you originally created.
    update public.users
       set auth_uid = v_cashier_uid
     where id = v_staff_row_id and workspace_id = v_your_workspace_id;

    -- 3. Clean up the orphaned workspace they were accidentally
    --    auto-provisioned as owner of (their profile no longer points to
    --    it after step 1, so this data is now unreachable garbage —
    --    the store, their auto-created "admin" user row, and any
    --    default settings/tax/category/condiment rows seed_workspace()
    --    created for it). Safe to run even if some of these have nothing
    --    to delete.
    delete from public.condiments where workspace_id = v_cashier_uid;
    delete from public.categories where workspace_id = v_cashier_uid;
    delete from public.taxes where workspace_id = v_cashier_uid;
    delete from public.settings where workspace_id = v_cashier_uid;
    delete from public.users where workspace_id = v_cashier_uid;
    delete from public.stores where workspace_id = v_cashier_uid;

    raise notice 'Done. % is now linked to workspace %', v_cashier_email, v_your_workspace_id;
end $$;
