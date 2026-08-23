-- =============================================================
-- ZE-POS 022 — Cyber Café: free-form floor-plan positions
-- Run AFTER 021_cafe_station_delete_reorder.sql.
--
-- 021 gave stations a linear sort_order (a list). That's not
-- enough to "find PC-07 by looking at the dashboard" in a real
-- café where machines sit in an L-shape, two rows facing each
-- other, an island in the middle, etc. This migration replaces
-- linear ordering with free (x, y) coordinates on a canvas, so
-- the dashboard can mirror the actual floor plan and an admin can
-- drop each station wherever the physical PC actually sits.
--
-- pos_x / pos_y are percentages (0-100) of the floor-plan canvas,
-- not pixels, so the layout holds up across screen sizes.
--
-- sort_order (from 021) is kept as a fallback for any place that
-- still wants a stable list order (e.g. reports); it's no longer
-- what the dashboard renders from.
--
-- Idempotent: safe to re-run.
-- =============================================================

alter table public.stations
    add column if not exists pos_x numeric(6,2),
    add column if not exists pos_y numeric(6,2);

-- Backfill existing stations into a loose grid so nothing starts
-- stacked at the same spot — admins can then drag them to match
-- the real floor plan at their own pace.
with ranked as (
    select workspace_id, id,
           row_number() over (
               partition by workspace_id
               order by sort_order, name
           ) - 1 as rn
    from public.stations
    where pos_x is null or pos_y is null
)
update public.stations s
   set pos_x = 10 + (ranked.rn % 4) * 26,
       pos_y = 12 + (ranked.rn / 4) * 30
  from ranked
 where s.workspace_id = ranked.workspace_id
   and s.id = ranked.id;

-- -------------------------------------------------------------
-- cafe_update_station_position — move a single station on the
-- floor-plan canvas. Separate from a full reorder because dragging
-- one PC shouldn't touch any other station's row.
-- -------------------------------------------------------------
create or replace function public.cafe_update_station_position(
    p_station_id text, p_x numeric, p_y numeric
)
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
    if p_x is null or p_y is null or p_x < 0 or p_x > 100 or p_y < 0 or p_y > 100 then
        raise exception 'position must be between 0 and 100';
    end if;

    update public.stations
       set pos_x = p_x, pos_y = p_y
     where workspace_id = v_ws and id = p_station_id;

    if not found then raise exception 'station not found'; end if;
end;
$$;

grant execute on function public.cafe_update_station_position(text, numeric, numeric) to authenticated;

-- -------------------------------------------------------------
-- cafe_add_station — give new stations a sane starting spot
-- (loose grid, same formula as the backfill above) instead of
-- landing at (0,0) on top of whatever's already there.
-- -------------------------------------------------------------
create or replace function public.cafe_add_station(
    p_name text,
    p_zone text default null,
    p_hourly_rate numeric default 0,
    p_store_id text default null
)
returns table (station_id text, pairing_code text)
language plpgsql
security definer
set search_path = public
as $$
declare
    v_id text := 'stn_' || substr(md5(random()::text || clock_timestamp()::text), 1, 9);
    v_code text := lpad((floor(random() * 1000000))::int::text, 6, '0');
    v_store_id text := coalesce(p_store_id, public.current_store());
    v_ws uuid := public.workspace_of();
    v_next_rn integer;
    v_next_sort integer;
begin
    if not public.workspace_has_feature('CyberCafe') then
        raise exception 'CyberCafe is not included in your current plan';
    end if;
    if not public.is_store_admin() then
        raise exception 'not authorized';
    end if;
    if v_store_id is null then
        raise exception 'no store selected — pass p_store_id explicitly';
    end if;

    select count(*) into v_next_rn from public.stations where workspace_id = v_ws;
    select coalesce(max(sort_order), 0) + 1 into v_next_sort from public.stations where workspace_id = v_ws;

    insert into public.stations (
        workspace_id, store_id, id, name, zone, hourly_rate, status,
        pairing_code, pairing_expires_at, sort_order, pos_x, pos_y
    )
    values (
        v_ws, v_store_id, v_id, trim(p_name), p_zone, coalesce(p_hourly_rate,0), 'offline',
        v_code, now() + interval '30 minutes', v_next_sort,
        10 + (v_next_rn % 4) * 26, 12 + (v_next_rn / 4) * 30
    );

    return query select v_id, v_code;
end;
$$;

grant execute on function public.cafe_add_station(text, text, numeric, text) to authenticated;

-- -------------------------------------------------------------
-- cafe_dashboard_state — surface pos_x/pos_y. New output columns,
-- so (per the earlier 42P13 error) the function has to be dropped
-- before it can be recreated with a different return shape.
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
    sort_order integer,
    pos_x numeric,
    pos_y numeric
)
language sql
security definer
set search_path = public
as $$
    select
        s.id, s.name, s.zone, s.hourly_rate, s.status,
        cs.id, cs.customer_name, cs.user_name, cs.rate_per_hour,
        cs.start_time, cs.expires_at, cs.planned_minutes, cs.extended_minutes,
        s.last_heartbeat, s.sort_order, s.pos_x, s.pos_y
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
