-- =============================================================
-- ZE-POS 013 — Break Tracking & Shift Notes
-- Run AFTER 001_init.sql
-- =============================================================

-- Add break tracking to shifts table
alter table public.shifts
    add column if not exists total_break_minutes integer not null default 0,
    add column if not exists notes text,
    add column if not exists handover_notes text;

-- Create breaks table for detailed break tracking
create table if not exists public.breaks (
    workspace_id uuid not null,
    id text not null,
    shift_id text not null,
    user_id text not null,
    break_type text not null check (break_type in ('meal','rest','personal')),
    start_time timestamptz not null,
    end_time timestamptz,
    duration_minutes integer,
    created_at timestamptz not null default now(),
    primary key (workspace_id, id)
);

-- Enable RLS on breaks
alter table public.breaks enable row level security;

-- Policy: users can read their own breaks
create policy "breaks_read" on public.breaks
    for select using (workspace_id = (select workspace_id from public.get_my_workspace()));

-- Policy: users can insert their own breaks
create policy "breaks_insert" on public.breaks
    for insert with check (workspace_id = (select workspace_id from public.get_my_workspace())
        and user_id = (select id from public.get_my_workspace_and_user()));

-- Policy: users can update their own breaks (to end them)
create policy "breaks_update" on public.breaks
    for update using (workspace_id = (select workspace_id from public.get_my_workspace())
        and user_id = (select id from public.get_my_workspace_and_user()));

-- Index for performance
create index if not exists idx_breaks_shift on public.breaks (workspace_id, shift_id, start_time);
create index if not exists idx_breaks_user on public.breaks (workspace_id, user_id, start_time desc);

-- Function to start a break
create or replace function public.start_break(
    p_shift_id text,
    p_break_type text default 'rest'
) returns table (id text, start_time timestamptz)
language plpgsql
security definer
set search_path = public
as $$
declare
    v_workspace_id uuid;
    v_user_id text;
    v_break_id text;
    v_open_break record;
begin
    -- Get workspace and user
    select workspace_id, id into v_workspace_id, v_user_id from public.get_my_workspace_and_user();

    -- Check if shift exists and is open
    if not exists (select 1 from public.shifts where workspace_id = v_workspace_id and id = p_shift_id and status = 'open') then
        raise exception 'Shift not found or not open';
    end if;

    -- Check if user already has an active break
    select * into v_open_break
    from public.breaks
    where workspace_id = v_workspace_id
      and shift_id = p_shift_id
      and user_id = v_user_id
      and end_time is null
    limit 1;

    if v_open_break is not null then
        raise exception 'You already have an active break';
    end if;

    -- Create break record
    v_break_id := 'brk_' || encode(gen_random_bytes(8), 'hex');
    insert into public.breaks (workspace_id, id, shift_id, user_id, break_type, start_time)
    values (v_workspace_id, v_break_id, p_shift_id, v_user_id, p_break_type, now());

    return query select v_break_id, now();
end;
$$;

-- Function to end a break
create or replace function public.end_break(p_break_id text) returns table (id text, duration_minutes integer)
language plpgsql
security definer
set search_path = public
as $$
declare
    v_workspace_id uuid;
    v_user_id text;
    v_break record;
    v_duration integer;
begin
    select workspace_id, id into v_workspace_id, v_user_id from public.get_my_workspace_and_user();

    select * into v_break
    from public.breaks
    where workspace_id = v_workspace_id and id = p_break_id and end_time is null;

    if v_break is null then
        raise exception 'Break not found or already ended';
    end if;

    v_duration := floor(extract(epoch from (now() - v_break.start_time)) / 60);

    update public.breaks
    set end_time = now(),
        duration_minutes = v_duration
    where workspace_id = v_workspace_id and id = p_break_id;

    -- Update total break minutes on shift
    update public.shifts
    set total_break_minutes = (
        select coalesce(sum(duration_minutes), 0)
        from public.breaks
        where workspace_id = v_workspace_id and shift_id = v_break.shift_id
    )
    where workspace_id = v_workspace_id and id = v_break.shift_id;

    return query select p_break_id, v_duration;
end;
$$;

-- Function to get active break for current user
create or replace function public.get_active_break(p_shift_id text) returns setof public.breaks
language plpgsql
security definer
set search_path = public
as $$
declare
    v_workspace_id uuid;
    v_user_id text;
begin
    select workspace_id, id into v_workspace_id, v_user_id from public.get_my_workspace_and_user();

    return query
    select * from public.breaks
    where workspace_id = v_workspace_id
      and shift_id = p_shift_id
      and user_id = v_user_id
      and end_time is null
    order by start_time desc;
end;
$$;

-- Function to get all breaks for a shift
create or replace function public.get_shift_breaks(p_shift_id text) returns setof public.breaks
language plpgsql
security definer
set search_path = public
as $$
declare
    v_workspace_id uuid;
begin
    select workspace_id into v_workspace_id from public.get_my_workspace();

    return query
    select * from public.breaks
    where workspace_id = v_workspace_id and shift_id = p_shift_id
    order by start_time;
end;
$$;