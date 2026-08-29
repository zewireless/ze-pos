-- =============================================================
-- ZE-POS 024 — order void support
--
-- Adds the columns needed to void a completed order without
-- deleting it: who voided it, who authorized it (for cashier-
-- initiated voids requiring an admin's Manager PIN), when, and
-- why. Status itself is already a free-text column (no CHECK
-- constraint), so 'Voided' needs no separate migration — only
-- these new columns are required.
--
-- Run any time. Idempotent (safe to re-run).
-- =============================================================

alter table public.orders
    add column if not exists voided_at timestamptz,
    add column if not exists voided_by text,
    add column if not exists void_authorized_by text,
    add column if not exists void_reason text;

-- Manager PIN for admins, used to authorize a cashier's order void.
-- Stored per-user; blank/null means that admin can't authorize voids.
alter table public.users
    add column if not exists manager_pin text;
