-- =============================================================
-- ZE-POS 033 — condiment usage tracking RPC
--
-- Adds report_condiments(): aggregates condiment usage from the
-- order_items.condiments JSONB column (which stores each selected
-- add-on as { id, name, price }). Returns one row per condiment
-- with total times added and total revenue generated, scoped to
-- the calling user's workspace + assigned stores + date range.
--
-- Zero-price condiments (e.g. "22oz cup") are included — that's
-- the whole point. Revenue for free add-ons shows as 0, but the
-- usage count still tells you how many times they were selected.
--
-- Voided orders are excluded (status != 'Voided') so the numbers
-- match what the sales report shows.
-- =============================================================

create or replace function public.report_condiments(
    p_from     timestamptz default null,
    p_to       timestamptz default null,
    p_store_id text        default null
)
returns table (
    condiment_id   text,
    condiment_name text,
    times_added    bigint,
    revenue        numeric(12,2)
)
language sql
stable
security definer
set search_path = public
as $$
    select
        (c->>'id')::text                              as condiment_id,
        (c->>'name')::text                            as condiment_name,
        count(*)                                      as times_added,
        sum( (c->>'price')::numeric * oi.quantity )   as revenue
    from public.orders o
    join public.order_items oi
        on oi.workspace_id = o.workspace_id
        and oi.order_id = o.id,
    lateral jsonb_array_elements(oi.condiments) as c
    where o.workspace_id = public.workspace_of()
      and o.store_id = any(public.assigned_stores())
      and (p_store_id is null or o.store_id = p_store_id)
      and o.status <> 'Voided'
      and (p_from is null or o.created_at >= p_from)
      and (p_to   is null or o.created_at <= p_to)
      and oi.condiments <> '[]'::jsonb
      and oi.condiments is not null
    group by (c->>'id'), (c->>'name')
    order by count(*) desc;
$$;

grant execute on function public.report_condiments(timestamptz, timestamptz, text) to anon, authenticated;
