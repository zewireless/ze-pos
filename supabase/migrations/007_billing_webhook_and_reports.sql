-- =============================================================
-- ZE-POS 007 — Webhook audit + server-side report queries
-- Run AFTER 006_auth_lockout_rpc.sql
-- Idempotent: uses create or replace / if not exists.
-- =============================================================

-- -------------------------------------------------------------
-- 1. Webhook audit-logging helper (service-role only)
--
-- The standard log_action() RPC resolves the workspace via
-- auth.uid(), which is NULL when this edge function runs as the
-- service role. This variant resolves the workspace from the
-- profile_id so the webhook can still write an audit row, and
-- uses insert ... on conflict to make logging itself idempotent.
-- -------------------------------------------------------------
create or replace function public.billing_log_webhook(
    p_profile_id uuid,
    p_event_id text,
    p_details jsonb default '{}'
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
    v_ws uuid;
begin
    if auth.role() <> 'service_role' then
        raise exception 'not authorized';
    end if;

    select workspace_id into v_ws
    from public.profiles
    where id = p_profile_id;

    if v_ws is null then
        return; -- unknown profile — nothing to log against
    end if;

    insert into public.audit_log
        (workspace_id, actor_uid, action, entity_type, entity_id, details)
    values
        (v_ws, p_profile_id, 'paymongo_webhook', 'checkout_session', p_event_id, p_details)
    on conflict do nothing;
end;
$$;

-- -------------------------------------------------------------
-- 2. Server-side paginated order query for reports
--
-- Filters by date range + optional cashier, scoped to the
-- current workspace + a store the caller is assigned to. The
-- store is passed explicitly (NOT current_store()) because
-- Supabase uses transaction-pooled connections where the
-- set_config session var from set_current_store() does not
-- carry across rpc() calls. The caller must pass a store_id
-- from assigned_stores() (enforced below) so this can't be
-- used to read another store's data.
-- Returns at most p_limit + 1 rows so the client can detect
-- "has more". Sorted oldest → newest.
-- -------------------------------------------------------------
create or replace function public.report_orders(
    p_from timestamptz default null,
    p_to   timestamptz default null,
    p_user_id text default null,
    p_store_id text default null,
    p_limit integer default 100,
    p_offset integer default 0
)
returns setof public.orders
language sql
stable
security definer
set search_path = public
as $$
    select o.*
    from public.orders o
    where o.workspace_id = public.workspace_of()
      and (p_store_id is null or o.store_id = p_store_id)
      and o.store_id = any(public.assigned_stores())
      and (p_from is null or o.created_at >= p_from)
      and (p_to   is null or o.created_at <= p_to)
      and (p_user_id is null or o.user_id = p_user_id)
    order by o.created_at asc, o.id asc
    limit (p_limit + 1)
    offset p_offset;
$$;

-- -------------------------------------------------------------
-- 3. Server-side paginated shift query for reports
--
-- Filters by date range + optional cashier, scoped to the
-- current workspace + an assigned store, closed shifts only.
-- Returns at most p_limit + 1 rows for "has more" detection.
-- -------------------------------------------------------------
create or replace function public.report_shifts(
    p_from timestamptz default null,
    p_to   timestamptz default null,
    p_user_id text default null,
    p_store_id text default null,
    p_limit integer default 100,
    p_offset integer default 0
)
returns setof public.shifts
language sql
stable
security definer
set search_path = public
as $$
    select s.*
    from public.shifts s
    where s.workspace_id = public.workspace_of()
      and (p_store_id is null or s.store_id = p_store_id)
      and s.store_id = any(public.assigned_stores())
      and s.status = 'closed'
      and s.end_time is not null
      and (p_from is null or s.start_time >= p_from)
      and (p_to   is null or s.start_time <= p_to)
      and (p_user_id is null or s.user_id = p_user_id)
    order by s.start_time asc, s.id asc
    limit (p_limit + 1)
    offset p_offset;
$$;

-- Grants (authenticated role can call; scoping via workspace_of/assigned_stores)
grant execute on function public.billing_log_webhook(uuid, text, jsonb) to service_role;
grant execute on function public.report_orders(timestamptz, timestamptz, text, text, integer, integer) to anon, authenticated;
grant execute on function public.report_shifts(timestamptz, timestamptz, text, text, integer, integer) to anon, authenticated;

-- Index to back the report date-range scans
create index if not exists idx_orders_workspace_store_created
    on public.orders (workspace_id, store_id, created_at desc);
create index if not exists idx_shifts_workspace_store_start
    on public.shifts (workspace_id, store_id, start_time desc);
