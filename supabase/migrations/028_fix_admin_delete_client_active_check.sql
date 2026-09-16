-- =============================================================
-- ZE-POS 028 — fix admin_delete_client() blocking on stale
-- subscription_status
--
-- Bug: 026_admin_delete_client.sql refuses to delete a client
-- whenever profiles.subscription_status = 'active', but
-- 027_strict_trial_and_expiry.sql changed admin_list_clients()
-- to DISPLAY a client as 'overdue' once current_period_end has
-- passed, without ever updating the underlying column. Result: a
-- client the dashboard shows as "Overdue" can still have
-- subscription_status = 'active' in the row, so clicking Delete
-- raises "This client has an active subscription — cancel it
-- first, then delete" -> PostgREST 400.
--
-- Fix: block deletion only when the client is TRULY active (same
-- definition as workspace_subscription_active() / admin_list_clients()):
-- status = 'active' AND current_period_end is set AND in the future.
-- Run after 027_strict_trial_and_expiry.sql.
-- =============================================================

create or replace function public.admin_delete_client(p_client_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
    v_target record;
begin
    if not public.is_super_admin() then
        raise exception 'Only an operator can delete a client';
    end if;

    if p_client_id = auth.uid() then
        raise exception 'You cannot delete your own account';
    end if;

    select id, business_name, is_super_admin, subscription_status, current_period_end
      into v_target
      from public.profiles
     where id = p_client_id;

    if v_target.id is null then
        raise exception 'Client not found';
    end if;

    if v_target.is_super_admin then
        raise exception 'Cannot delete another operator account — demote them first';
    end if;

    -- Match the same "truly active" definition used by
    -- workspace_subscription_active()/admin_list_clients(), so a
    -- client the dashboard shows as 'overdue' (expired period_end)
    -- is deletable even though the raw column still says 'active'.
    if v_target.subscription_status = 'active'
       and v_target.current_period_end is not null
       and v_target.current_period_end > now() then
        raise exception 'This client has an active subscription — cancel it first, then delete';
    end if;

    -- Children before parents, to avoid FK violations between tenant
    -- tables (none of these have a FK back to profiles/auth.users, so
    -- they don't cascade automatically — each must be cleared explicitly).
    delete from public.order_items where workspace_id = p_client_id;
    delete from public.stock_movements where workspace_id = p_client_id;
    delete from public.bundle_items where workspace_id = p_client_id;
    delete from public.breaks where workspace_id = p_client_id;
    delete from public.agent_commands where workspace_id = p_client_id;
    delete from public.agent_events where workspace_id = p_client_id;
    delete from public.cafe_sessions where workspace_id = p_client_id;

    delete from public.orders where workspace_id = p_client_id;
    delete from public.bundles where workspace_id = p_client_id;
    delete from public.menu_sizes where workspace_id = p_client_id;
    delete from public.menu_items where workspace_id = p_client_id;
    delete from public.categories where workspace_id = p_client_id;
    delete from public.condiments where workspace_id = p_client_id;
    delete from public.taxes where workspace_id = p_client_id;
    delete from public.payrolls where workspace_id = p_client_id;
    delete from public.shift_schedules where workspace_id = p_client_id;
    delete from public.shifts where workspace_id = p_client_id;
    delete from public.stations where workspace_id = p_client_id;
    delete from public.settings where workspace_id = p_client_id;
    delete from public.workspace_invites where workspace_id = p_client_id;
    delete from public.user_stores where workspace_id = p_client_id;
    delete from public.audit_log where workspace_id = p_client_id;

    delete from public.users where workspace_id = p_client_id;
    delete from public.stores where workspace_id = p_client_id;

    -- Finally, remove the actual auth account. This cascades to
    -- public.profiles and public.payments automatically (both have
    -- `on delete cascade` foreign keys to auth.users/profiles), and is
    -- what frees up the email for a fresh registration.
    delete from auth.users where id = p_client_id;
end;
$$;

grant execute on function public.admin_delete_client(uuid) to authenticated;
