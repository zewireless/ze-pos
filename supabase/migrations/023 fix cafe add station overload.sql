-- =============================================================
-- ZE-POS 023 — hotfix: drop the stale 3-arg cafe_add_station
-- overload.
--
-- 018 created cafe_add_station(text, text, numeric). 020 needed to
-- add a p_store_id param, but used CREATE OR REPLACE with a
-- *different* argument list — in Postgres that creates a second,
-- separate overloaded function rather than replacing the first
-- one (a replace only matches on an identical signature). So the
-- database has carried both the 3-arg and 4-arg versions side by
-- side ever since, and any call that happens to omit p_store_id
-- (e.g. because it came through as JS `undefined`, which JSON.
-- stringify drops from the payload entirely) is ambiguous between
-- them — hence "could not choose the best candidate function".
--
-- Run AFTER 022_cafe_station_floor_plan.sql. Idempotent.
-- =============================================================

drop function if exists public.cafe_add_station(text, text, numeric);

-- Sanity check after running — should list exactly one row:
--   select oid::regprocedure from pg_proc where proname = 'cafe_add_station';
