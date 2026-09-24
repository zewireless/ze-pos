-- =============================================================
-- ZE-POS 036 — Shift Expenses & Net Sales
-- Run AFTER 001_init.sql
--
-- Lets a cashier log expenses paid out of the till during their
-- shift (e.g. a supply run, a refund paid in cash) when they end
-- shift. Net Sales = Total Sales − Total Expenses is computed and
-- stored automatically so admins can see it at a glance on the
-- Shifts page without re-deriving it from raw orders each time.
-- =============================================================

alter table public.shifts
    add column if not exists expenses jsonb not null default '[]'::jsonb,
    add column if not exists total_expenses numeric(12,2) not null default 0,
    add column if not exists net_sales numeric(12,2);

comment on column public.shifts.expenses is
    'Array of {description, amount} objects the cashier logged during this shift, entered at end-of-shift.';
comment on column public.shifts.total_expenses is
    'Sum of expenses.amount, kept in sync whenever the shift is closed/updated.';
comment on column public.shifts.net_sales is
    'total_sales - total_expenses, computed when the shift is closed.';
