-- =============================================================
-- ZE-POS 018 — Internet Café Management module
-- Run AFTER 017__multi_store_plan_gating.sql
--
-- Adds a "Cyber Café" module gated behind the CyberCafe plan
-- feature (added to the existing ₱499 plan, same pattern as
-- MultiStore in 017). Three moving parts:
--
--   1. stations        — one row per client PC. Paired to a
--                         Windows agent app via a short-lived
--                         pairing code, then holds a long-lived
--                         agent_token the agent authenticates with
--                         on every call (the agent has no Supabase
--                         Auth session — it's a headless machine).
--   2. cafe_sessions    — one row per timer session on a station.
--                         On stop, an `orders` row (type =
--                         'cafe_session') is written so the sale
--                         rolls into the EXISTING shifts/reports/
--                         leaderboards machinery with zero changes
--                         to shifts.js / reports.js / pos.js.
--   3. agent_commands   — a tiny outbox the dashboard writes to
--                         (lock/unlock/extend/message/logoff) and
--                         the agent drains on each heartbeat.
--
-- Agent-facing RPCs (agent_register_station, agent_heartbeat,
-- agent_report_event) are SECURITY DEFINER and granted to `anon`
-- because the agent authenticates with a station token it holds
-- locally, not a Supabase user session — the function body checks
-- the token itself, the same "gated SECURITY DEFINER" pattern used
-- elsewhere in this schema (e.g. is_super_admin() checks).
--
-- Idempotent: safe to re-run.
-- =============================================================

-- -------------------------------------------------------------
-- 1. stations
-- -------------------------------------------------------------
create table if not exists public.stations (
    workspace_id uuid not null,
    store_id text,
    id text not null,
    name text not null,
    zone text,
    hourly_rate numeric(12,2) not null default 0,
    status text not null default 'available'
        check (status in ('available','in_use','locked','offline','maintenance')),
    current_session_id text,
    pairing_code text,
    pairing_expires_at timestamptz,
    agent_token text,
    last_heartbeat timestamptz,
    last_agent_ip text,
    created_at timestamptz not null default now(),
    primary key (workspace_id, id)
);

create unique index if not exists stations_agent_token_idx
    on public.stations (agent_token) where agent_token is not null;

alter table public.stations enable row level security;

-- Stations are managed exclusively through the cafe_*/agent_* RPCs
-- above (SECURITY DEFINER), which already check workspace/store
-- membership and pairing tokens themselves. Direct table access is
-- read-only for workspace members assigned to the station's store;
-- all writes go through the RPCs.
drop policy if exists "stations_tenant_read" on public.stations;
create policy "stations_tenant_read" on public.stations
    for select to authenticated
    using (
        workspace_id = public.workspace_of()
        and (store_id is null or store_id = any(public.assigned_stores()))
    );

drop policy if exists "stations_write_deny" on public.stations;
create policy "stations_write_deny" on public.stations
    for insert to authenticated
    with check (false);

-- -------------------------------------------------------------
-- 2. cafe_sessions
-- -------------------------------------------------------------
create table if not exists public.cafe_sessions (
    workspace_id uuid not null,
    store_id text,
    id text not null,
    station_id text not null,
    user_id text,          -- cashier who opened it
    user_name text,
    customer_name text,
    shift_id text,
    order_id text,         -- filled in on stop, links to public.orders
    rate_per_hour numeric(12,2) not null default 0,
    planned_minutes integer not null default 0,
    extended_minutes integer not null default 0,
    start_time timestamptz not null default now(),
    expires_at timestamptz,
    end_time timestamptz,
    status text not null default 'active'
        check (status in ('active','ended','cancelled')),
    amount numeric(12,2),
    created_at timestamptz not null default now(),
    primary key (workspace_id, id)
);

create index if not exists cafe_sessions_station_idx
    on public.cafe_sessions (workspace_id, station_id, status);

alter table public.cafe_sessions enable row level security;

-- Same story: read-only for workspace/store members, writes go
-- through cafe_start_session / cafe_extend_session / cafe_stop_session.
drop policy if exists "cafe_sessions_tenant_read" on public.cafe_sessions;
create policy "cafe_sessions_tenant_read" on public.cafe_sessions
    for select to authenticated
    using (
        workspace_id = public.workspace_of()
        and (store_id is null or store_id = any(public.assigned_stores()))
    );

drop policy if exists "cafe_sessions_write_deny" on public.cafe_sessions;
create policy "cafe_sessions_write_deny" on public.cafe_sessions
    for insert to authenticated
    with check (false);

-- -------------------------------------------------------------
-- 3. agent_commands — outbox drained by the agent's heartbeat poll
-- -------------------------------------------------------------
create table if not exists public.agent_commands (
    workspace_id uuid not null,
    id bigint generated always as identity,
    station_id text not null,
    command text not null
        check (command in ('unlock','lock','extend','logoff','message','reset')),
    payload jsonb not null default '{}',
    created_at timestamptz not null default now(),
    delivered_at timestamptz,
    primary key (workspace_id, id)
);

create index if not exists agent_commands_pending_idx
    on public.agent_commands (workspace_id, station_id) where delivered_at is null;

alter table public.agent_commands enable row level security;

drop policy if exists "agent_commands_tenant_read" on public.agent_commands;
create policy "agent_commands_tenant_read" on public.agent_commands
    for select to authenticated
    using (workspace_id = public.workspace_of());

-- Writes to agent_commands only happen through the cafe_* RPCs below
-- (SECURITY DEFINER), so deny direct table writes from clients.
drop policy if exists "agent_commands_write_deny" on public.agent_commands;
create policy "agent_commands_write_deny" on public.agent_commands
    for insert to authenticated
    with check (false);

-- -------------------------------------------------------------
-- 4. Optional event log (agent → server), handy for support/audit
-- -------------------------------------------------------------
create table if not exists public.agent_events (
    workspace_id uuid not null,
    id bigint generated always as identity,
    station_id text not null,
    event text not null,
    payload jsonb not null default '{}',
    created_at timestamptz not null default now(),
    primary key (workspace_id, id)
);

alter table public.agent_events enable row level security;

drop policy if exists "agent_events_tenant_read" on public.agent_events;
create policy "agent_events_tenant_read" on public.agent_events
    for select to authenticated
    using (workspace_id = public.workspace_of());

-- -------------------------------------------------------------
-- 4b. Server-side feature gate. app.js's hasFeature() only hides
--     UI — this is the actual enforcement so a client that never
--     paid for CyberCafe can't call the RPCs directly.
-- -------------------------------------------------------------
create or replace function public.workspace_has_feature(p_feature text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
    select coalesce((
        select p.is_super_admin or (pl.features is not null and p_feature = any(pl.features))
        from public.profiles p
        left join public.plans pl on pl.id = p.plan_id
        where p.id = public.workspace_of()
    ), false);
$$;

-- -------------------------------------------------------------
-- 5. dashboard-side RPCs (called by authenticated cashier/admin)
-- -------------------------------------------------------------

-- Snapshot of every station + its active session, one round trip.
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
    last_heartbeat timestamptz
)
language sql
security definer
set search_path = public
as $$
    select
        s.id, s.name, s.zone, s.hourly_rate, s.status,
        cs.id, cs.customer_name, cs.user_name, cs.rate_per_hour,
        cs.start_time, cs.expires_at, cs.planned_minutes, cs.extended_minutes,
        s.last_heartbeat
    from public.stations s
    left join public.cafe_sessions cs
        on cs.workspace_id = s.workspace_id
       and cs.id = s.current_session_id
       and cs.status = 'active'
    where s.workspace_id = public.workspace_of()
      and (s.store_id is null or s.store_id = any(public.assigned_stores()))
    order by s.zone nulls last, s.name;
$$;

-- Add a station + generate a 6-digit pairing code (shown in the
-- dashboard, entered once into the agent app during setup).
create or replace function public.cafe_add_station(
    p_name text,
    p_zone text default null,
    p_hourly_rate numeric default 0
)
returns table (station_id text, pairing_code text)
language plpgsql
security definer
set search_path = public
as $$
declare
    v_id text := 'stn_' || substr(md5(random()::text || clock_timestamp()::text), 1, 9);
    v_code text := lpad((floor(random() * 1000000))::int::text, 6, '0');
begin
    if not public.workspace_has_feature('CyberCafe') then
        raise exception 'CyberCafe is not included in your current plan';
    end if;
    if not public.is_store_admin() then
        raise exception 'not authorized';
    end if;

    insert into public.stations (workspace_id, store_id, id, name, zone, hourly_rate, status, pairing_code, pairing_expires_at)
    values (public.workspace_of(), public.current_store(), v_id, trim(p_name), p_zone, coalesce(p_hourly_rate,0), 'offline', v_code, now() + interval '30 minutes');

    return query select v_id, v_code;
end;
$$;

-- Regenerate a pairing code for an existing station (re-pairing a
-- replaced PC, or the agent needs re-installing).
create or replace function public.cafe_repair_station(p_station_id text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
    v_code text := lpad((floor(random() * 1000000))::int::text, 6, '0');
begin
    if not public.is_store_admin() then
        raise exception 'not authorized';
    end if;

    update public.stations
       set pairing_code = v_code,
           pairing_expires_at = now() + interval '30 minutes',
           agent_token = null,
           status = 'offline'
     where workspace_id = public.workspace_of() and id = p_station_id;

    if not found then raise exception 'station not found'; end if;
    return v_code;
end;
$$;

-- Start a timer session on a station. Fires an 'unlock' + minute
-- budget down to the agent so it can start its local countdown.
create or replace function public.cafe_start_session(
    p_station_id text,
    p_planned_minutes integer,
    p_rate_per_hour numeric,
    p_customer_name text default null,
    p_shift_id text default null,
    p_user_id text default null,
    p_user_name text default null
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
    v_ws uuid := public.workspace_of();
    v_session_id text := 'cfs_' || substr(md5(random()::text || clock_timestamp()::text), 1, 9);
    v_expires timestamptz;
    v_station record;
begin
    if not public.workspace_has_feature('CyberCafe') then
        raise exception 'CyberCafe is not included in your current plan';
    end if;
    if not public.workspace_subscription_active() then
        raise exception 'subscription is not active';
    end if;

    select * into v_station from public.stations where workspace_id = v_ws and id = p_station_id;
    if not found then raise exception 'station not found'; end if;
    if v_station.status = 'in_use' then raise exception 'station already in use'; end if;
    if p_planned_minutes is null or p_planned_minutes <= 0 then raise exception 'planned_minutes must be positive'; end if;

    v_expires := now() + make_interval(mins => p_planned_minutes);

    insert into public.cafe_sessions (
        workspace_id, store_id, id, station_id, user_id, user_name, customer_name,
        shift_id, rate_per_hour, planned_minutes, start_time, expires_at, status
    ) values (
        v_ws, v_station.store_id, v_session_id, p_station_id, p_user_id, p_user_name, p_customer_name,
        p_shift_id, coalesce(p_rate_per_hour, v_station.hourly_rate), p_planned_minutes, now(), v_expires, 'active'
    );

    update public.stations
       set status = 'in_use', current_session_id = v_session_id
     where workspace_id = v_ws and id = p_station_id;

    insert into public.agent_commands (workspace_id, station_id, command, payload)
    values (v_ws, p_station_id, 'unlock', jsonb_build_object(
        'session_id', v_session_id, 'expires_at', v_expires, 'customer_name', p_customer_name
    ));

    return v_session_id;
end;
$$;

-- Add minutes to a running session (walk-up "extend my time").
create or replace function public.cafe_extend_session(p_session_id text, p_extra_minutes integer)
returns timestamptz
language plpgsql
security definer
set search_path = public
as $$
declare
    v_ws uuid := public.workspace_of();
    v_session record;
    v_new_expires timestamptz;
begin
    select * into v_session from public.cafe_sessions
     where workspace_id = v_ws and id = p_session_id and status = 'active';
    if not found then raise exception 'active session not found'; end if;
    if p_extra_minutes is null or p_extra_minutes <= 0 then raise exception 'extra minutes must be positive'; end if;

    v_new_expires := v_session.expires_at + make_interval(mins => p_extra_minutes);

    update public.cafe_sessions
       set extended_minutes = extended_minutes + p_extra_minutes,
           expires_at = v_new_expires
     where workspace_id = v_ws and id = p_session_id;

    insert into public.agent_commands (workspace_id, station_id, command, payload)
    values (v_ws, v_session.station_id, 'extend', jsonb_build_object(
        'session_id', p_session_id, 'expires_at', v_new_expires
    ));

    return v_new_expires;
end;
$$;

-- Stop a session now (walk-in leaves early, or staff force-ends it).
-- Prorates to the minute, writes a real `orders` row so it counts
-- toward shift totals / cashier sales / reports exactly like a POS
-- sale, and locks the station.
create or replace function public.cafe_stop_session(p_session_id text)
returns numeric
language plpgsql
security definer
set search_path = public
as $$
declare
    v_ws uuid := public.workspace_of();
    v_session record;
    v_minutes numeric;
    v_amount numeric;
    v_order_id text := 'ord_cafe_' || substr(md5(random()::text || clock_timestamp()::text), 1, 9);
    v_order_number integer;
begin
    select * into v_session from public.cafe_sessions
     where workspace_id = v_ws and id = p_session_id and status = 'active';
    if not found then raise exception 'active session not found'; end if;

    v_minutes := greatest(1, ceil(extract(epoch from (now() - v_session.start_time)) / 60.0));
    v_amount := round((v_minutes / 60.0) * v_session.rate_per_hour, 2);

    -- order_number is a per-store running counter maintained client-side
    -- (DB.nextOrderNumber() = max+1); mirror that convention here so cafe
    -- sales interleave with POS sales in the same numbering sequence.
    select coalesce(max(order_number), 0) + 1 into v_order_number
      from public.orders
     where workspace_id = v_ws
       and store_id is not distinct from v_session.store_id;

    update public.cafe_sessions
       set status = 'ended', end_time = now(), amount = v_amount, order_id = v_order_id
     where workspace_id = v_ws and id = p_session_id;

    insert into public.orders (
        workspace_id, id, order_number, type, status, subtotal, tax_name, tax_percentage,
        tax_amount, total, user_id, user_name, shift_id, store_id, created_at
    ) values (
        v_ws, v_order_id, v_order_number,
        'cafe_session', 'completed', v_amount, null, 0, 0, v_amount,
        v_session.user_id, v_session.user_name, v_session.shift_id, v_session.store_id, now()
    );

    update public.stations
       set status = 'available', current_session_id = null
     where workspace_id = v_ws and id = v_session.station_id;

    insert into public.agent_commands (workspace_id, station_id, command, payload)
    values (v_ws, v_session.station_id, 'lock', jsonb_build_object('reason', 'session_ended'));

    return v_amount;
end;
$$;

-- Manual override: lock a station immediately regardless of timer.
create or replace function public.cafe_force_lock(p_station_id text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
    v_ws uuid := public.workspace_of();
begin
    insert into public.agent_commands (workspace_id, station_id, command, payload)
    values (v_ws, p_station_id, 'lock', jsonb_build_object('reason', 'manual'));
end;
$$;

-- Push a message overlay to a station ("5 mins left", "please queue up").
create or replace function public.cafe_send_message(p_station_id text, p_message text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
    v_ws uuid := public.workspace_of();
begin
    insert into public.agent_commands (workspace_id, station_id, command, payload)
    values (v_ws, p_station_id, 'message', jsonb_build_object('text', p_message));
end;
$$;

-- -------------------------------------------------------------
-- 6. Agent-facing RPCs — token-authenticated, no Supabase Auth
--    session. Granted to `anon`; every function validates the
--    token against stations.agent_token itself.
-- -------------------------------------------------------------

-- Called once during setup: agent has a pairing code, exchanges it
-- for a permanent token.
create or replace function public.agent_pair(p_pairing_code text)
returns table (workspace_id uuid, station_id text, agent_token text)
language plpgsql
security definer
set search_path = public
as $$
declare
    v_station record;
    v_token text := encode(gen_random_bytes(24), 'hex');
begin
    select * into v_station from public.stations
     where pairing_code = p_pairing_code
       and pairing_expires_at > now()
     limit 1;

    if not found then
        raise exception 'invalid or expired pairing code';
    end if;

    update public.stations
       set agent_token = v_token, pairing_code = null, pairing_expires_at = null,
           status = 'available', last_heartbeat = now()
     where workspace_id = v_station.workspace_id and id = v_station.id;

    return query select v_station.workspace_id, v_station.id, v_token;
end;
$$;

-- Called every few seconds by the agent. Reports liveness, gets
-- back the current session (if any) plus any undelivered commands,
-- which are marked delivered in the same call.
create or replace function public.agent_heartbeat(
    p_station_id text, p_token text, p_local_status text default null
)
returns table (
    session_id text, expires_at timestamptz, customer_name text,
    commands jsonb
)
language plpgsql
security definer
set search_path = public
as $$
declare
    v_station record;
    v_session record;
    v_cmds jsonb;
begin
    select * into v_station from public.stations
     where id = p_station_id and agent_token = p_token;
    if not found then raise exception 'unauthorized station'; end if;

    update public.stations
       set last_heartbeat = now(),
           status = coalesce(nullif(p_local_status,''), status)
     where workspace_id = v_station.workspace_id and id = p_station_id;

    select * into v_session from public.cafe_sessions
     where workspace_id = v_station.workspace_id
       and station_id = p_station_id and status = 'active';

    select coalesce(jsonb_agg(jsonb_build_object('command', command, 'payload', payload) order by created_at), '[]'::jsonb)
      into v_cmds
      from public.agent_commands
     where workspace_id = v_station.workspace_id
       and station_id = p_station_id
       and delivered_at is null;

    update public.agent_commands
       set delivered_at = now()
     where workspace_id = v_station.workspace_id
       and station_id = p_station_id
       and delivered_at is null;

    return query select v_session.id, v_session.expires_at, v_session.customer_name, v_cmds;
end;
$$;

-- Agent reports something happened locally (locked itself on
-- expiry, blocked an app, user tried to kill the agent, etc.)
create or replace function public.agent_report_event(
    p_station_id text, p_token text, p_event text, p_payload jsonb default '{}'
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
    v_station record;
begin
    select * into v_station from public.stations
     where id = p_station_id and agent_token = p_token;
    if not found then raise exception 'unauthorized station'; end if;

    insert into public.agent_events (workspace_id, station_id, event, payload)
    values (v_station.workspace_id, p_station_id, p_event, coalesce(p_payload, '{}'));
end;
$$;

-- -------------------------------------------------------------
-- 7. Feature gate: add CyberCafe to the existing ₱499 plan (the
--    same plan MultiStore already lives on — see 017). Also
--    seed a dedicated ₱499 "Internet Café" plan for operators who
--    want the module on its own without the multi-store add-on.
--    Both are idempotent no-ops if already present.
-- -------------------------------------------------------------
update public.plans
   set features = array(select distinct unnest(features || array['CyberCafe']))
 where price_monthly = 499
   and not ('CyberCafe' = any(features));

insert into public.plans (name, price_monthly, currency, features, active, duration_type, duration_days, sort_order)
select 'Internet Café ₱499', 499, 'PHP',
       '{POS, Menu, Categories, Orders, Reports, Shifts, Payroll, CyberCafe}',
       true, 'months', 30, 4
where not exists (select 1 from public.plans where name = 'Internet Café ₱499');

-- -------------------------------------------------------------
-- 8. Grants
-- -------------------------------------------------------------
grant execute on function public.cafe_dashboard_state() to authenticated;
grant execute on function public.cafe_add_station(text, text, numeric) to authenticated;
grant execute on function public.cafe_repair_station(text) to authenticated;
grant execute on function public.cafe_start_session(text, integer, numeric, text, text, text, text) to authenticated;
grant execute on function public.cafe_extend_session(text, integer) to authenticated;
grant execute on function public.cafe_stop_session(text) to authenticated;
grant execute on function public.cafe_force_lock(text) to authenticated;
grant execute on function public.cafe_send_message(text, text) to authenticated;

grant execute on function public.agent_pair(text) to anon, authenticated;
grant execute on function public.agent_heartbeat(text, text, text) to anon, authenticated;
grant execute on function public.agent_report_event(text, text, text, jsonb) to anon, authenticated;
