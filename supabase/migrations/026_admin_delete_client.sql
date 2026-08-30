-- =============================================================
-- ZE-POS 026 — superadmin: permanently delete an inactive client
--
-- Wipes every row scoped to a client's workspace_id across all
-- tenant tables, then deletes their actual auth.users account
-- (which cascades to profiles + payments automatically, since
-- those two have `on delete cascade` foreign keys already). This
-- is what makes their email available to register fresh again —
-- leaving the auth.users row behind would make Supabase reject a
-- second signup with "email already registered".
--
-- Restricted to is_super_admin(). Refuses to delete: yourself, any
-- other operator/super-admin account, or any client whose
-- subscription is currently 'active' (cancel it first) — this is a
-- permanent, unrecoverable action, so it's scoped to genuinely
-- inactive clients as requested, not a general-purpose delete
-- button.
--
-- Run after 024_order_void.sql and 025_fix_invite_join.sql.
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

    select id, business_name, is_super_admin, subscription_status
      into v_target
      from public.profiles
     where id = p_client_id;

    if v_target.id is null then
        raise exception 'Client not found';
    end if;

    if v_target.is_super_admin then
        raise exception 'Cannot delete another operator account — demote them first';
    end if;

    if v_target.subscription_status = 'active' then
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
