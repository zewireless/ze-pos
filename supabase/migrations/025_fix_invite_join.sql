-- =============================================================
-- ZE-POS 025 — fix: staff joining via invite code become an
-- admin/owner of a brand-new workspace instead of joining yours,
-- whenever Supabase email confirmation is required.
--
-- Root cause: handle_new_user() always created a fresh profile with
-- pending_join = false. The only thing that ever flipped it to true
-- was mark_join_pending(), which join.html could only call once a
-- session existed — i.e. only on the immediate-session path (email
-- confirmation OFF). When confirmation is required (no session at
-- signup time), pending_join stays false forever, join_workspace()
-- refuses to run ("not awaiting a workspace invite"), and the user
-- ends up logging in as a normal, never-joined account —
-- seed_workspace() then auto-provisions them a brand-new workspace
-- with themselves as its admin/owner.
--
-- Fix: handle_new_user() now reads a `joining` flag from the
-- signup's own metadata (set by join.html at signUp() time — see
-- js/supabase-client.js — present immediately regardless of
-- confirmation timing) and sets pending_join accordingly right
-- there. No session or follow-up client call required.
--
-- Run AFTER 024_order_void.sql. Idempotent.
-- =============================================================

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
    insert into public.profiles (id, email, business_name, subscription_status, workspace_id, pending_join)
    values (
        new.id,
        new.email,
        coalesce(new.raw_user_meta_data->>'business_name', 'My Business'),
        'never',
        new.id,
        coalesce((new.raw_user_meta_data->>'joining')::boolean, false)
    );
    return new;
end;
$$;
