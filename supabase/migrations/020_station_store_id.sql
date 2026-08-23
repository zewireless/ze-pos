-- =============================================================
-- ZE-POS 020 — hotfix: cafe_add_station trusted public.current_store(),
-- a Postgres session-level setting (set via set_current_store RPC on
-- login) that doesn't reliably survive across requests under Supabase's
-- connection pooling — the rest of this codebase already works around
-- that by passing p_store_id explicitly (see db.js's calls that pass
-- `p_store_id: currentStoreId`). cafe_add_station didn't, so stations
-- got created with store_id = NULL, which cascaded into cafe_sessions
-- and then failed the NOT NULL constraint on orders.store_id at
-- cafe_stop_session time.
--
-- Run this AFTER 019_agent_pair_hotfix.sql. Idempotent.
-- =============================================================

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

    insert into public.stations (workspace_id, store_id, id, name, zone, hourly_rate, status, pairing_code, pairing_expires_at)
    values (public.workspace_of(), v_store_id, v_id, trim(p_name), p_zone, coalesce(p_hourly_rate,0), 'offline', v_code, now() + interval '30 minutes');

    return query select v_id, v_code;
end;
$$;

grant execute on function public.cafe_add_station(text, text, numeric, text) to authenticated;

-- -------------------------------------------------------------
-- Data repair: fix any stations (and their sessions) already created
-- with a NULL store_id before this fix. Run the SELECT first to see
-- what you're about to change — this UPDATE guesses 's1' (the
-- original default single-store id seeded by 005_multi_store.sql).
-- If your workspace uses a different store id, replace 's1' below
-- with the correct one before running, or just delete the test
-- station from the dashboard and re-add it now that the fix is live.
-- -------------------------------------------------------------

-- Inspect first:
--   select id, name, store_id from public.stations where store_id is null;

update public.stations
   set store_id = 's1'
 where store_id is null;

update public.cafe_sessions
   set store_id = 's1'
 where store_id is null;
