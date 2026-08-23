-- =============================================================
-- ZE-POS 019 — hotfix: agent_pair used gen_random_bytes() (pgcrypto,
-- not enabled by default on Supabase). Replaced with gen_random_uuid(),
-- which is built into core Postgres — no extension needed.
--
-- Run this AFTER 018_cyber_cafe.sql. Idempotent (create or replace).
-- =============================================================

create or replace function public.agent_pair(p_pairing_code text)
returns table (workspace_id uuid, station_id text, agent_token text)
language plpgsql
security definer
set search_path = public
as $$
declare
    v_station record;
    v_token text := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
begin
    select * into v_station from public.stations
     where pairing_code = p_pairing_code
       and pairing_expires_at > now()
     limit 1;

    if not found then
        raise exception 'invalid or expired pairing code';
    end if;

    update public.stations st
       set agent_token = v_token, pairing_code = null, pairing_expires_at = null,
           status = 'available', last_heartbeat = now()
     where st.workspace_id = v_station.workspace_id and st.id = v_station.id;

    return query select v_station.workspace_id, v_station.id, v_token;
end;
$$;

grant execute on function public.agent_pair(text) to anon, authenticated;
