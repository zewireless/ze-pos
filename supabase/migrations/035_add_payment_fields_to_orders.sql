-- =============================================================
-- ZE-POS 035 — Add Payment Method Fields to Orders Table
-- Run AFTER 034_condiment_stock_tracking (1).sql
-- =============================================================

-- Add payment method and reference columns to orders table
alter table public.orders
    add column if not exists payment_method text,  -- 'cash' or 'gcash'
    add column if not exists payment_reference text;  -- reference number for gcash, or cash amount tendered for cash

-- Add helpful comments
comment on column public.orders.payment_method is 'Payment method used: cash or gcash';
comment on column public.orders.payment_reference is 'For gcash: reference number. For cash: amount tendered by customer';