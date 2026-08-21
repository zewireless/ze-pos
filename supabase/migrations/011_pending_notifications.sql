-- =============================================================
-- ZE-POS 010 — Instant pending-subscription visibility + email
-- notification to the super admin when a client submits a payment.
-- Run AFTER 009_client_plan_selection.sql
--
-- Part A: admin_list_pending_payments() — every pending claim across
--         ALL clients in one call, for a dashboard panel.
-- Part B: a `payments` SELECT policy scoped to super admins, so
--         Supabase Realtime can push INSERT events to the admin
--         dashboard live (no polling / manual refresh needed).
-- Part C: admin_notification_settings table + RPCs to configure a
--         Brevo API key + notify email from the admin dashboard.
-- Part D: a trigger that fires on every new pending payment and
--         sends an email via Brevo's transactional API using pg_net
--         (async HTTP straight from Postgres — no edge function
--         deploy needed).
--
-- SMS is NOT included here — it needs a separate SMS provider (e.g.
-- Semaphore for PH numbers) with its own API key, which isn't set up
-- yet. The settings table below has room to add it later.
-- Idempotent: safe to re-run.
-- =============================================================

-- -------------------------------------------------------------
-- A. admin_list_pending_payments() — dashboard feed of every
--    pending claim, newest first, with client + plan context.
-- -------------------------------------------------------------
drop function if exists public.admin_list_pending_payments() cascade;

create function public.admin_list_pending_payments()
returns table (
    id uuid,
    profile_id uuid,
    business_name text,
    email text,
    plan_id uuid,
    plan_name text,
    amount numeric,
    method text,
    reference text,
    created_at timestamptz
)
language sql
security definer
set search_path = public
as $$
    select
        pay.id, pay.profile_id, prof.business_name, prof.email,
        pay.plan_id, pl.name, pay.amount, pay.method, pay.reference, pay.created_at
    from public.payments pay
    join public.profiles prof on prof.id = pay.profile_id
    left join public.plans pl on pl.id = pay.plan_id
    where pay.status = 'pending'
      and public.is_super_admin()
    order by pay.created_at desc;
$$;

grant execute on function public.admin_list_pending_payments() to authenticated;

-- -------------------------------------------------------------
-- B. Allow super admins to SELECT payments directly (needed for
--    Supabase Realtime — it evaluates RLS per-subscriber, so without
--    a matching SELECT policy the admin dashboard would never
--    receive live INSERT events). Everyone else stays denied, same
--    as before (no policy = no access, since RLS is enabled).
-- -------------------------------------------------------------
drop policy if exists "payments_read_admin" on public.payments;
create policy "payments_read_admin" on public.payments
    for select to authenticated
    using (public.is_super_admin());

-- -------------------------------------------------------------
-- C. Notification settings (single row, super-admin managed).
--    Deny-all direct table access; only the RPCs below and the
--    trigger (SECURITY DEFINER / runs as table owner) can touch it.
-- -------------------------------------------------------------
create table if not exists public.admin_notification_settings (
    id boolean primary key default true,      -- singleton row (always id = true)
    enabled boolean not null default false,
    notify_email text,
    brevo_api_key text,
    sender_email text,
    updated_at timestamptz not null default now(),
    check (id = true)
);

insert into public.admin_notification_settings (id, enabled)
select true, false
where not exists (select 1 from public.admin_notification_settings);

alter table public.admin_notification_settings enable row level security;
drop policy if exists "notif_settings_deny" on public.admin_notification_settings;
create policy "notif_settings_deny" on public.admin_notification_settings
    for all to anon, authenticated
    using (false)
    with check (false);

create or replace function public.admin_get_notification_settings()
returns table (enabled boolean, notify_email text, sender_email text, has_api_key boolean)
language sql
security definer
set search_path = public
as $$
    select s.enabled, s.notify_email, s.sender_email, (s.brevo_api_key is not null and s.brevo_api_key <> '')
    from public.admin_notification_settings s
    where public.is_super_admin();
$$;

grant execute on function public.admin_get_notification_settings() to authenticated;

-- p_api_key is optional (null = leave existing key unchanged) so the
-- admin dashboard never has to re-display or re-submit a stored key.
create or replace function public.admin_set_notification_settings(
    p_enabled boolean,
    p_notify_email text,
    p_sender_email text,
    p_api_key text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
    if not public.is_super_admin() then
        raise exception 'not authorized';
    end if;

    update public.admin_notification_settings
       set enabled = p_enabled,
           notify_email = p_notify_email,
           sender_email = p_sender_email,
           brevo_api_key = coalesce(nullif(p_api_key, ''), brevo_api_key),
           updated_at = now()
     where id = true;
end;
$$;

grant execute on function public.admin_set_notification_settings(boolean, text, text, text) to authenticated;

-- -------------------------------------------------------------
-- D. Trigger: on every new pending payment, fire an async HTTP call
--    to Brevo's transactional email API via pg_net.
-- -------------------------------------------------------------
create extension if not exists pg_net;

create or replace function public.notify_pending_payment()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
    v_settings public.admin_notification_settings%rowtype;
    v_business text;
    v_client_email text;
    v_plan_name text;
    v_subject text;
    v_html text;
begin
    if new.status <> 'pending' then
        return new;
    end if;

    select * into v_settings from public.admin_notification_settings where id = true;
    if v_settings is null or not v_settings.enabled
       or v_settings.brevo_api_key is null or v_settings.brevo_api_key = ''
       or v_settings.notify_email is null or v_settings.notify_email = '' then
        return new; -- notifications not configured/enabled — skip silently
    end if;

    select business_name, email into v_business, v_client_email
    from public.profiles where id = new.profile_id;

    select name into v_plan_name from public.plans where id = new.plan_id;

    v_subject := 'New pending subscription — ' || coalesce(v_business, 'a client');
    v_html := '<p><strong>' || coalesce(v_business, 'A client') || '</strong> (' || coalesce(v_client_email, 'no email') || ') submitted a payment awaiting your approval.</p>'
        || '<ul>'
        || '<li><strong>Plan:</strong> ' || coalesce(v_plan_name, '—') || '</li>'
        || '<li><strong>Amount:</strong> ' || new.amount::text || ' ' || coalesce((select currency from public.plans where id = new.plan_id), '') || '</li>'
        || '<li><strong>Method:</strong> ' || coalesce(new.method, '—') || '</li>'
        || '<li><strong>Reference:</strong> ' || coalesce(new.reference, '—') || '</li>'
        || '</ul>'
        || '<p>Review it in the ZE-POS admin dashboard.</p>';

    perform net.http_post(
        url := 'https://api.brevo.com/v3/smtp/email',
        headers := jsonb_build_object(
            'Content-Type', 'application/json',
            'api-key', v_settings.brevo_api_key
        ),
        body := jsonb_build_object(
            'sender', jsonb_build_object('name', 'ZE-POS', 'email', coalesce(v_settings.sender_email, v_settings.notify_email)),
            'to', jsonb_build_array(jsonb_build_object('email', v_settings.notify_email)),
            'subject', v_subject,
            'htmlContent', v_html
        )
    );

    return new;
end;
$$;

drop trigger if exists on_payment_pending_notify on public.payments;
create trigger on_payment_pending_notify
    after insert on public.payments
    for each row execute function public.notify_pending_payment();
