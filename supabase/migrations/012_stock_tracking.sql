-- =============================================================
-- ZE-POS 012 — Stock Tracking with Low Stock Alerts
-- Run AFTER 001_init.sql
-- =============================================================

-- Add stock tracking columns to menu_items
alter table public.menu_items
    add column if not exists track_stock boolean not null default false,
    add column if not exists stock_quantity numeric(12,3) not null default 0,
    add column if not exists low_stock_threshold numeric(12,3) not null default 10,
    add column if not exists unit text not null default 'pcs',
    add column if not exists cost_price numeric(12,2) not null default 0;

-- Add stock tracking columns to menu_sizes (for size-specific stock)
alter table public.menu_sizes
    add column if not exists track_stock boolean not null default false,
    add column if not exists stock_quantity numeric(12,3) not null default 0,
    add column if not exists low_stock_threshold numeric(12,3) not null default 10,
    add column if not exists cost_price numeric(12,2) not null default 0;

-- Create stock_movements table for audit trail
create table if not exists public.stock_movements (
    workspace_id uuid not null,
    id text not null,
    menu_item_id text not null,
    menu_size_id text, -- nullable for item-level stock
    movement_type text not null check (movement_type in ('sale','adjustment','restock','waste','return')),
    quantity_change numeric(12,3) not null, -- positive for restock, negative for sale/waste
    previous_quantity numeric(12,3) not null,
    new_quantity numeric(12,3) not null,
    reference_id text, -- order_id, adjustment_id, etc.
    reference_type text, -- 'order', 'adjustment', 'restock', 'waste'
    notes text,
    user_id text,
    user_name text,
    created_at timestamptz not null default now(),
    primary key (workspace_id, id)
);

-- Enable RLS on stock_movements
alter table public.stock_movements enable row level security;

-- Policy: users can read their workspace's stock movements
create policy "stock_movements_read" on public.stock_movements
    for select using (workspace_id = (select workspace_id from public.get_my_workspace()));

-- Policy: users can insert stock movements (for sales, adjustments)
create policy "stock_movements_insert" on public.stock_movements
    for insert with check (workspace_id = (select workspace_id from public.get_my_workspace()));

-- Create indexes for performance
create index if not exists idx_stock_movements_item on public.stock_movements (workspace_id, menu_item_id, created_at desc);
create index if not exists idx_stock_movements_type on public.stock_movements (workspace_id, movement_type, created_at desc);

-- Create low_stock_alerts view
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
  and ms.enabled = true
  and mi.enabled = true;

-- Function to record stock movement
create or replace function public.record_stock_movement(
    p_menu_item_id text,
    p_menu_size_id text default null,
    p_movement_type text,
    p_quantity_change numeric,
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
    v_item_id text;
begin
    -- Get workspace and user
    select workspace_id, id into v_workspace_id, v_user_id from public.get_my_workspace_and_user();
    select name into v_user_name from public.users where workspace_id = v_workspace_id and id = v_user_id;

    -- Determine which table to update and get current stock
    if p_menu_size_id is not null then
        -- Size-level stock
        select track_stock, stock_quantity into v_track_stock, v_previous_qty
        from public.menu_sizes
        where workspace_id = v_workspace_id and id = p_menu_size_id;

        if not v_track_stock then return; end if;

        v_new_qty = v_previous_qty + p_quantity_change;

        update public.menu_sizes
        set stock_quantity = v_new_qty
        where workspace_id = v_workspace_id and id = p_menu_size_id;

        v_item_id = p_menu_size_id;
    else
        -- Item-level stock
        select track_stock, stock_quantity into v_track_stock, v_previous_qty
        from public.menu_items
        where workspace_id = v_workspace_id and id = p_menu_item_id;

        if not v_track_stock then return; end if;

        v_new_qty = v_previous_qty + p_quantity_change;

        update public.menu_items
        set stock_quantity = v_new_qty
        where workspace_id = v_workspace_id and id = p_menu_item_id;

        v_item_id = p_menu_item_id;
    end if;

    -- Record the movement
    insert into public.stock_movements (
        workspace_id, id, menu_item_id, menu_size_id,
        movement_type, quantity_change, previous_quantity, new_quantity,
        reference_id, reference_type, notes, user_id, user_name
    ) values (
        v_workspace_id,
        'sm_' || encode(gen_random_bytes(8), 'hex'),
        p_menu_item_id,
        p_menu_size_id,
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

-- Function to deduct stock on order completion
create or replace function public.deduct_stock_on_order(p_order_id text) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
    v_workspace_id uuid;
    v_item record;
begin
    select workspace_id into v_workspace_id from public.orders where id = p_order_id;

    for v_item in
        select oi.menu_item_id, oi.size, oi.quantity, oi.id as order_item_id
        from public.order_items oi
        join public.menu_items mi on mi.workspace_id = oi.workspace_id and mi.id = oi.menu_item_id
        where oi.workspace_id = v_workspace_id and oi.order_id = p_order_id
    loop
        -- Try to find matching size
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
            -- Item-level stock
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
end;
$$;