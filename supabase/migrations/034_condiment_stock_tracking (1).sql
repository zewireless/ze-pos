-- =============================================================
-- ZE-POS 034 — Stock Tracking for Condiments / Add-ons
-- Run AFTER 012_stock_tracking.sql
--
-- Extends the same stock-tracking model menu_items already has
-- (track_stock / stock_quantity / low_stock_threshold / unit) to
-- condiments, so add-ons like a "22oz cup" can be tracked in
-- Stock & Inventory, show low/out-of-stock in the POS, and get
-- deducted automatically when sold — exactly like menu items.
-- =============================================================

-- Add stock tracking columns to condiments (same shape as menu_items)
alter table public.condiments
    add column if not exists track_stock boolean not null default false,
    add column if not exists stock_quantity numeric(12,3) not null default 0,
    add column if not exists low_stock_threshold numeric(12,3) not null default 10,
    add column if not exists unit text not null default 'pcs',
    add column if not exists cost_price numeric(12,2) not null default 0;

-- stock_movements rows were menu-item-only (menu_item_id not null). Allow a
-- row to reference a condiment instead: menu_item_id becomes nullable and a
-- new condiment_id column is added, with exactly one of the two set.
alter table public.stock_movements
    alter column menu_item_id drop not null,
    add column if not exists condiment_id text;

alter table public.stock_movements
    drop constraint if exists chk_stock_movements_one_target;

alter table public.stock_movements
    add constraint chk_stock_movements_one_target
    check (
        (menu_item_id is not null and condiment_id is null)
        or (menu_item_id is null and condiment_id is not null)
    );

create index if not exists idx_stock_movements_condiment on public.stock_movements (workspace_id, condiment_id, created_at desc);

-- Function to record a condiment stock movement (mirrors record_stock_movement,
-- kept separate so the existing menu_item/menu_size function signature and
-- call sites are untouched).
create or replace function public.record_condiment_stock_movement(
    p_condiment_id text,
    p_movement_type text default 'adjustment',
    p_quantity_change numeric default 0,
    p_reference_id text default null,
    p_reference_type text default null,
    p_notes text default null
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
    v_workspace_id uuid;
    v_previous_qty numeric;
    v_new_qty numeric;
    v_user_id text;
    v_user_name text;
    v_track_stock boolean;
begin
    select workspace_id, id into v_workspace_id, v_user_id from public.get_my_workspace_and_user();
    select name into v_user_name from public.users where workspace_id = v_workspace_id and id = v_user_id;

    select track_stock, stock_quantity into v_track_stock, v_previous_qty
    from public.condiments
    where workspace_id = v_workspace_id and id = p_condiment_id;

    if v_track_stock is null or not v_track_stock then return; end if;

    v_new_qty = v_previous_qty + p_quantity_change;

    update public.condiments
    set stock_quantity = v_new_qty
    where workspace_id = v_workspace_id and id = p_condiment_id;

    insert into public.stock_movements (
        workspace_id, id, condiment_id,
        movement_type, quantity_change, previous_quantity, new_quantity,
        reference_id, reference_type, notes, user_id, user_name
    ) values (
        v_workspace_id,
        'sm_' || encode(gen_random_bytes(8), 'hex'),
        p_condiment_id,
        p_movement_type,
        p_quantity_change,
        v_previous_qty,
        v_new_qty,
        p_reference_id,
        p_reference_type,
        p_notes,
        v_user_id,
        v_user_name
    );
end;
$$;

-- Extend deduct_stock_on_order (previously menu-items-only) to also deduct
-- tracked condiments attached to each order_item's condiments jsonb array,
-- same 22oz-cup-style add-ons the POS lets a customer pick.
create or replace function public.deduct_stock_on_order(p_order_id text) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
    v_workspace_id uuid;
    v_item record;
    v_cond record;
begin
    select workspace_id into v_workspace_id from public.orders where id = p_order_id;

    for v_item in
        select oi.menu_item_id, oi.size, oi.quantity, oi.id as order_item_id
        from public.order_items oi
        join public.menu_items mi on mi.workspace_id = oi.workspace_id and mi.id = oi.menu_item_id
        where oi.workspace_id = v_workspace_id and oi.order_id = p_order_id
    loop
        if v_item.size is not null then
            perform public.record_stock_movement(
                v_item.menu_item_id,
                (select id from public.menu_sizes
                 where workspace_id = v_workspace_id
                   and menu_item_id = v_item.menu_item_id
                   and name = v_item.size
                 limit 1),
                'sale',
                -v_item.quantity,
                p_order_id,
                'order',
                'Auto-deducted from order #' || (select order_number from public.orders where id = p_order_id)
            );
        else
            perform public.record_stock_movement(
                v_item.menu_item_id,
                null,
                'sale',
                -v_item.quantity,
                p_order_id,
                'order',
                'Auto-deducted from order #' || (select order_number from public.orders where id = p_order_id)
            );
        end if;
    end loop;

    for v_cond in
        select (c->>'id')::text as condiment_id, oi.quantity as quantity
        from public.order_items oi,
        lateral jsonb_array_elements(oi.condiments) as c
        where oi.workspace_id = v_workspace_id
          and oi.order_id = p_order_id
          and oi.condiments is not null
          and oi.condiments <> '[]'::jsonb
    loop
        perform public.record_condiment_stock_movement(
            v_cond.condiment_id,
            'sale',
            -v_cond.quantity,
            p_order_id,
            'order',
            'Auto-deducted from order #' || (select order_number from public.orders where id = p_order_id)
        );
    end loop;
end;
$$;

-- low_stock_items now also surfaces tracked, low/out-of-stock condiments.
-- NOTE: menu_sizes has no `enabled` column (only menu_items/condiments do),
-- so the size branch below gates on the parent menu_item's `enabled` only.
create or replace view public.low_stock_items as
select
    mi.workspace_id,
    mi.id as item_id,
    mi.name as item_name,
    mi.track_stock as item_track_stock,
    mi.stock_quantity as item_stock,
    mi.low_stock_threshold as item_threshold,
    mi.unit as item_unit,
    null::text as size_id,
    null::text as size_name,
    mi.stock_quantity as current_stock,
    mi.low_stock_threshold as threshold
from public.menu_items mi
where mi.track_stock = true
  and mi.stock_quantity <= mi.low_stock_threshold
  and mi.enabled = true

union all

select
    ms.workspace_id,
    ms.menu_item_id as item_id,
    mi.name as item_name,
    ms.track_stock as item_track_stock,
    ms.stock_quantity as item_stock,
    ms.low_stock_threshold as size_threshold,
    mi.unit as item_unit,
    ms.id as size_id,
    ms.name as size_name,
    ms.stock_quantity as current_stock,
    ms.low_stock_threshold as threshold
from public.menu_sizes ms
join public.menu_items mi on mi.workspace_id = ms.workspace_id and mi.id = ms.menu_item_id
where ms.track_stock = true
  and ms.stock_quantity <= ms.low_stock_threshold
  and mi.enabled = true

union all

select
    c.workspace_id,
    c.id as item_id,
    c.name as item_name,
    c.track_stock as item_track_stock,
    c.stock_quantity as item_stock,
    c.low_stock_threshold as item_threshold,
    c.unit as item_unit,
    null::text as size_id,
    null::text as size_name,
    c.stock_quantity as current_stock,
    c.low_stock_threshold as threshold
from public.condiments c
where c.track_stock = true
  and c.stock_quantity <= c.low_stock_threshold
  and c.enabled = true;
