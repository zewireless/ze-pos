-- =============================================================
-- ZE-POS 000 — Full database reset
-- Run FIRST in Supabase SQL Editor (before 001_init.sql)
-- WARNING: DESTROYS ALL DATA — accounts, orders, menu, everything
-- =============================================================

-- Drop all tenant tables (cascade removes dependent objects)
drop table if exists public.workspace_invites cascade;
drop table if exists public.audit_log cascade;
drop table if exists public.shift_schedules cascade;
drop table if exists public.shifts cascade;
drop table if exists public.order_items cascade;
drop table if exists public.orders cascade;
drop table if exists public.taxes cascade;
drop table if exists public.condiments cascade;
drop table if exists public.menu_sizes cascade;
drop table if exists public.menu_items cascade;
drop table if exists public.categories cascade;
drop table if exists public.users cascade;
drop table if exists public.payrolls cascade;
drop table if exists public.settings cascade;

-- Drop SaaS tables
drop table if exists public.payments cascade;
drop table if exists public.profiles cascade;
drop table if exists public.plans cascade;

-- Drop all custom functions
drop function if exists public.handle_new_user() cascade;
drop function if exists public.is_super_admin() cascade;
drop function if exists public.admin_list_clients() cascade;
drop function if exists public.admin_list_payments(uuid) cascade;
drop function if exists public.admin_record_payment(uuid, numeric, text, text) cascade;
drop function if exists public.admin_set_subscription_status(uuid, text) cascade;
drop function if exists public.admin_extend_period(uuid, integer) cascade;
drop function if exists public.get_my_billing() cascade;
drop function if exists public.seed_workspace() cascade;

-- 002 functions
drop function if exists public.workspace_of() cascade;
drop function if exists public.is_workspace_admin() cascade;
drop function if exists public.create_workspace_invite(text) cascade;
drop function if exists public.mark_join_pending() cascade;
drop function if exists public.join_workspace(text) cascade;

-- 003 functions
drop function if exists public.workspace_subscription_active() cascade;
drop function if exists public.owns_row(text) cascade;
drop function if exists public.log_action(text, text, text, jsonb) cascade;
drop function if exists public.billing_paymongo_record(uuid, numeric, text, text) cascade;

-- 004 functions
drop function if exists public.admin_set_super_admin(uuid, boolean) cascade;
-- admin_list_clients() is redefined with a new return shape in 004; reset must
-- drop the 004 version (it's recreated lazily by re-running 001/002/004).
drop function if exists public.admin_list_clients() cascade;

-- 005 functions & tables
drop table if exists public.stores cascade;
drop table if exists public.user_stores cascade;
drop function if exists public.current_store() cascade;
drop function if exists public.set_current_store(text) cascade;
drop function if exists public.assigned_stores() cascade;
drop function if exists public.is_store_admin(text) cascade;
drop function if exists public.seed_workspace(text) cascade;

-- 006 functions & tables (auth lockout)
drop table if exists public.auth_lockout cascade;
drop function if exists public.check_auth_lock(text, text) cascade;
drop function if exists public.record_auth_failure(text, text) cascade;
drop function if exists public.clear_auth_lock(text, text) cascade;
drop function if exists public.cleanup_auth_lockout() cascade;

-- 007 functions
drop function if exists public.billing_log_webhook(uuid, text, jsonb) cascade;
drop function if exists public.report_orders(timestamptz, timestamptz, text, text, integer, integer) cascade;
drop function if exists public.report_shifts(timestamptz, timestamptz, text, text, integer, integer) cascade;

-- Drop trigger on auth.users
drop trigger if exists on_auth_user_created on auth.users;

-- NOTE: This does NOT delete auth.users (Supabase Auth accounts).
-- To also wipe auth accounts, go to Authentication → Users in the Dashboard
-- and delete them manually, OR run this in SQL Editor:
-- DELETE FROM auth.users;