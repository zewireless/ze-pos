-- =============================================================
-- ZE-POS 008 — Fix missing store_id column grant on public.users
-- Run AFTER 007_webhook_reports.sql
-- Idempotent: safe to re-run.
--
-- Root cause: 003_trust_layer.sql revoked blanket SELECT on
-- public.users and replaced it with a column-level grant (to keep
-- the password hash out of client reach). 005_multi_store.sql later
-- added the store_id column to public.users but never widened that
-- column grant to include it. Every other tenant table only relies
-- on RLS (no column-level grant), so this gap only affects users.
--
-- Symptom: any authenticated client doing `select('*')` or filtering
-- on `store_id` against public.users gets:
--   403 permission denied for table users (Postgres 42501)
-- This fires in DB.init() (js/db.js) during the Promise.all TABLES
-- hydration loop, which bubbles up to "Could not load your
-- workspace" in app.js.
-- =============================================================

grant select (
    workspace_id, store_id, id, username, name, role, enabled,
    pay_type, hourly_rate, fixed_salary, created_at, auth_uid
) on public.users to anon, authenticated;
