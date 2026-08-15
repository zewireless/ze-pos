-- =============================================================
-- ZE-POS 006 — Server-side auth lockout (brute-force protection)
-- Run SIXTH in Supabase SQL Editor (after 001–005)
--
-- The client-side Lockout module (js/auth.js) keys on email only and can be
-- bypassed by clearing localStorage. This migration adds TRUE server-side
-- protection keyed on BOTH the request IP (per-IP, which the browser can't
-- see) AND the target identifier (email). Three RPCs are exposed to the
-- anon/auth roles so the client wrapper (Supabase.checkAuthLock /
-- recordAuthFailure / clearAuthLock) can call them safely:
--
--   check_auth_lock(p_ns, p_id)        -> { locked bool, ms_remaining int8 }
--   record_auth_failure(p_ns, p_id)    -> { locked bool, ms_remaining int8,
--                                            attempts int }
--   clear_auth_lock(p_ns, p_id)        -> void
--
-- Lockout tiers (mirrors js/auth.js):
--   5  failures -> 15 min  lock (TIER1)
--   10 failures -> 60 min  lock (TIER2)
-- A failed check/failure ALSO counts attempts against the IP (IP is the
-- empty string for non-network contexts, which never trips the per-IP tier
-- but stays out of the way). Successful auth calls clear_auth_lock.
--
-- Idempotent: safe to re-run.
-- =============================================================

-- -------------------------------------------------------------
-- 0. Idempotency guards
-- -------------------------------------------------------------
drop function if exists public.check_auth_lock(text, text) cascade;
drop function if exists public.record_auth_failure(text, text) cascade;
drop function if exists public.clear_auth_lock(text, text) cascade;

-- -------------------------------------------------------------
-- 1. Lockout state table (IP + namespace + id keyed)
-- -------------------------------------------------------------
create table if not exists public.auth_lockout (
    key          text primary key,             -- namespace + ':' + id-or-ip
    namespace    text not null,
    id           text not null,
    ip           text not null default '',
    attempts     int  not null default 0,
    locked_until timestamptz not null default now(),
    updated_at   timestamptz not null default now()
);

create index if not exists idx_auth_lockout_namespace_id
    on public.auth_lockout (namespace, id);
create index if not exists idx_auth_lockout_ip
    on public.auth_lockout (namespace, ip) where ip <> '';

-- The RPCs run SECURITY DEFINER, so they bypass RLS. We still enable RLS with a
-- deny-all policy so the table can NEVER be read/written directly via the
-- anon/auth roles — only the SECURITY DEFINER RPCs below can touch it.
alter table public.auth_lockout enable row level security;
drop policy if exists "auth_lockout_self_only" on public.auth_lockout;
create policy "auth_lockout_self_only" on public.auth_lockout
    for all to anon, authenticated
    using (false)  -- never directly readable/writable; only via RPCs
    with check (false);

-- -------------------------------------------------------------
-- 2. Helpers
-- -------------------------------------------------------------
create or replace function public._lockout_tier(p_attempts int)
returns int  -- 0 = none, 1 = TIER1 (15m), 2 = TIER2 (60m)
language sql
immutable
as $$
    select case
        when p_attempts >= 10 then 2
        when p_attempts >= 5  then 1
        else 0
    end;
$$;

create or replace function public._lockout_ms(p_tier int)
returns bigint
language sql
immutable
as $$
    select case
        when p_tier = 2 then 60 * 60 * 1000      -- 1 hour
        when p_tier = 1 then 15 * 60 * 1000      -- 15 minutes
        else 0
    end;
$$;

-- Builds the caller IP from request headers (set by Supabase edge/postgres).
create or replace function public._caller_ip()
returns text
language sql
stable
security definer
set search_path = public
as $$
    select coalesce(
        nullif(current_setting('request.headers', true)::json ->> 'x-forwarded-for', ''),
        nullif(current_setting('request.headers', true)::json ->> 'x-real-ip', ''),
        ''
    );
$$;

-- -------------------------------------------------------------
-- 3. check_auth_lock(p_ns, p_id)
--    Returns whether the given id OR the caller IP is currently locked.
-- -------------------------------------------------------------
create or replace function public.check_auth_lock(
    p_ns text,
    p_id text
)
returns table (locked boolean, ms_remaining bigint)
language plpgsql
security definer
set search_path = public
as $$
declare
    v_ip      text := public._caller_ip();
    v_now     timestamptz := now();
    v_id_until  timestamptz;
    v_ip_until  timestamptz;
    v_until   timestamptz;
begin
    -- The id row (may not exist yet).
    select locked_until into v_id_until
      from public.auth_lockout
     where namespace = p_ns and id = p_id
     limit 1;

    -- The IP row (only if we have an IP).
    if v_ip <> '' then
        select locked_until into v_ip_until
          from public.auth_lockout
         where namespace = p_ns and ip = v_ip and id = '__ip__'
         limit 1;
    end if;

    v_until := greatest(v_id_until, v_ip_until);

    if v_until is null or v_until <= v_now then
        return query select false, 0::bigint;
        return;
    end if;

    return query select true, extract(epoch from (v_until - v_now))::bigint * 1000;
end;
$$;

-- -------------------------------------------------------------
-- 4. record_auth_failure(p_ns, p_id)
--    Increments attempts for the id AND the caller IP, applies the
--    appropriate lock tier, and returns the resulting state.
-- -------------------------------------------------------------
create or replace function public.record_auth_failure(
    p_ns text,
    p_id text
)
returns table (locked boolean, ms_remaining bigint, attempts int)
language plpgsql
security definer
set search_path = public
as $$
declare
    v_ip        text := public._caller_ip();
    v_now       timestamptz := now();
    v_id_att    int;
    v_ip_att    int;
    v_id_until  timestamptz;
    v_ip_until  timestamptz;
    v_tier      int;
    v_until     timestamptz;
    v_ms        bigint;
begin
    -- Idempotent upsert of the per-id row. Start at 1 so the first failure
    -- records exactly one attempt (conflict path increments from there).
    insert into public.auth_lockout (key, namespace, id, ip, attempts, locked_until, updated_at)
    values (p_ns || ':' || p_id, p_ns, p_id, '', 1, v_now, v_now)
    on conflict (key) do update
       set attempts   = public.auth_lockout.attempts + 1,
           updated_at = v_now
    returning attempts, locked_until into v_id_att, v_id_until;

    -- Idempotent upsert of the per-IP row (only when we have an IP).
    if v_ip <> '' then
        insert into public.auth_lockout (key, namespace, id, ip, attempts, locked_until, updated_at)
        values (p_ns || ':ip:' || v_ip, p_ns, '__ip__', v_ip, 1, v_now, v_now)
        on conflict (key) do update
           set attempts   = public.auth_lockout.attempts + 1,
               updated_at = v_now
        returning attempts into v_ip_att;
    else
        v_ip_att := 0;
    end if;

    -- Recompute lock for the id row (it may have been locked by a previous
    -- failure; keep the longer remaining lock).
    v_id_until := greatest(
        coalesce(v_id_until, v_now),
        v_now + (public._lockout_ms(public._lockout_tier(v_id_att))::text || ' milliseconds')::interval
    );
    update public.auth_lockout
       set locked_until = v_id_until
     where key = p_ns || ':' || p_id;

    -- Same for the IP row.
    if v_ip <> '' then
        select locked_until into v_ip_until
          from public.auth_lockout
         where key = p_ns || ':ip:' || v_ip;
        v_ip_until := greatest(
            coalesce(v_ip_until, v_now),
            v_now + (public._lockout_ms(public._lockout_tier(v_ip_att))::text || ' milliseconds')::interval
        );
        update public.auth_lockout
           set locked_until = v_ip_until
         where key = p_ns || ':ip:' || v_ip;
    else
        v_ip_until := v_now;
    end if;

    v_until := greatest(v_id_until, v_ip_until);
    v_tier  := case
        when v_until > v_now then 1 else 0 end;  -- any active lock counts as locked
    v_ms    := extract(epoch from (v_until - v_now))::bigint * 1000;

    return query select (v_until > v_now), v_ms, v_id_att;
end;
$$;

-- -------------------------------------------------------------
-- 5. clear_auth_lock(p_ns, p_id)
--    Called on successful auth. Clears the id row and (best-effort)
--    the caller IP row.
-- -------------------------------------------------------------
create or replace function public.clear_auth_lock(
    p_ns text,
    p_id text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
    v_ip text := public._caller_ip();
begin
    delete from public.auth_lockout
     where key = p_ns || ':' || p_id;

    if v_ip <> '' then
        delete from public.auth_lockout
         where key = p_ns || ':ip:' || v_ip;
    end if;
end;
$$;

-- -------------------------------------------------------------
-- 6. Periodic cleanup (optional manual maintenance)
--    Run occasionally to stop the table growing unbounded:
--      select public.cleanup_auth_lockout();
-- -------------------------------------------------------------
create or replace function public.cleanup_auth_lockout()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
    v_deleted int;
begin
    delete from public.auth_lockout
     where locked_until <= now()
       and updated_at <= now() - interval '1 hour';
    get diagnostics v_deleted = row_count;
    return v_deleted;
end;
$$;

-- -------------------------------------------------------------
-- 7. Grant RPC access to anon + authenticated (callers are the
--    browser via the anon key during register/join/sign-in).
-- -------------------------------------------------------------
grant execute on function public.check_auth_lock(text, text)        to anon, authenticated;
grant execute on function public.record_auth_failure(text, text)    to anon, authenticated;
grant execute on function public.clear_auth_lock(text, text)        to anon, authenticated;
grant execute on function public.cleanup_auth_lockout()             to authenticated;

-- The auth_lockout table itself stays RLS-locked; only the SECURITY DEFINER
-- RPCs can touch it, satisfying least privilege.
