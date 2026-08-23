-- =============================================================
-- ZE-POS 021 — Cyber Café: delete station + drag-to-reorder grid
-- Run AFTER 020_station_store_id.sql.
--
-- 1. stations.sort_order — lets the dashboard grid match the
--    physical café floor plan. Persisted via cafe_reorder_stations
--    so the layout survives refresh / other devices.
-- 2. cafe_delete_station — removes a station. Deliberately does
--    NOT touch cafe_sessions: that table already denormalizes
--    user_name/customer_name (see 018) specifically so historical
--    records survive after the source row is gone, same pattern
--    used for staff/users elsewhere in this schema. A station with
--    an active session can't be deleted (must be stopped first).
-- 3. cafe_dashboard_state — now orders by sort_order instead of
--    zone/name so the grid reflects the saved layout.
--
-- Idempotent: safe to re-run.
-- =============================================================

-- -------------------------------------------------------------
-- 1. sort_order column + backfill from current display order
-- -------------------------------------------------------------
alter table public.stations
    add column if not exists sort_order integer not null default 0;

with ranked as (
    select workspace_id, id,
           row_number() over (
               partition by workspace_id
               order by zone nulls last, name
           ) as rn
    from public.stations
)
update public.stations s
   set sort_order = ranked.rn
  from ranked
 where s.workspace_id = ranked.workspace_id
   and s.id = ranked.id
   and s.sort_order = 0;

-- -------------------------------------------------------------
-- 2. cafe_delete_station
-- -------------------------------------------------------------
create or replace function public.cafe_delete_station(p_station_id text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
    v_ws uuid := public.workspace_of();
    v_station record;
begin
    if not public.is_store_admin() then
        raise exception 'not authorized';
    end if;

    select * into v_station from public.stations
     where workspace_id = v_ws and id = p_station_id;
    if not found then raise exception 'station not found'; end if;

    if v_station.status = 'in_use' then
        raise exception 'station has an active session — stop it before deleting';
    end if;

    -- Clean up station-scoped queue/log rows; cafe_sessions is left
    -- untouched on purpose (historical record, see header note).
    delete from public.agent_commands
     where workspace_id = v_ws and station_id = p_station_id;

    delete from public.agent_events
     where workspace_id = v_ws and station_id = p_station_id;

    delete from public.stations
     where workspace_id = v_ws and id = p_station_id;
end;
$$;

grant execute on function public.cafe_delete_station(text) to authenticated;

-- -------------------------------------------------------------
-- 3. cafe_reorder_stations — takes the full station-id list in the
--    new display order and rewrites sort_order to match (1-based).
--    Ignores any id that isn't actually one of the caller's
--    stations, so a stale/tampered array can't touch other rows.
-- -------------------------------------------------------------
create or replace function public.cafe_reorder_stations(p_station_ids text[])
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
    v_ws uuid := public.workspace_of();
begin
    if not public.is_store_admin() then
        raise exception 'not authorized';
    end if;

    update public.stations s
       set sort_order = x.rn
      from unnest(p_station_ids) with ordinality as x(id, rn)
     where s.workspace_id = v_ws
       and s.id = x.id;
end;
$$;

grant execute on function public.cafe_reorder_stations(text[]) to authenticated;

-- -------------------------------------------------------------
-- 4. cafe_dashboard_state — order by saved layout instead of
--    zone/name so drag-and-drop actually sticks. Adds a new
--    output column (sort_order), which Postgres won't allow via
--    CREATE OR REPLACE on a function with OUT-param return type —
--    it has to be dropped and recreated.
-- -------------------------------------------------------------
drop function if exists public.cafe_dashboard_state();

create or replace function public.cafe_dashboard_state()
returns table (
    station_id text,
    name text,
    zone text,
    hourly_rate numeric,
    status text,
    session_id text,
    customer_name text,
    user_name text,
    rate_per_hour numeric,
    start_time timestamptz,
    expires_at timestamptz,
    planned_minutes integer,
    extended_minutes integer,
    last_heartbeat timestamptz,
    sort_order integer
)
language sql
security definer
set search_path = public
as $$
    select
        s.id, s.name, s.zone, s.hourly_rate, s.status,
        cs.id, cs.customer_name, cs.user_name, cs.rate_per_hour,
        cs.start_time, cs.expires_at, cs.planned_minutes, cs.extended_minutes,
        s.last_heartbeat, s.sort_order
    from public.stations s
    left join public.cafe_sessions cs
        on cs.workspace_id = s.workspace_id
       and cs.id = s.current_session_id
       and cs.status = 'active'
    where s.workspace_id = public.workspace_of()
      and (s.store_id is null or s.store_id = any(public.assigned_stores()))
    order by s.sort_order, s.name;
$$;

grant execute on function public.cafe_dashboard_state() to authenticated;
