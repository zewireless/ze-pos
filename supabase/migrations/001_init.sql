-- =============================================================
-- ZE-POS 001 — Base schema (multi-tenant subscription + POS)
-- Run FIRST in Supabase SQL Editor (after 000_reset.sql on fresh DB)
-- =============================================================

create extension if not exists "pgcrypto";

-- -------------------------------------------------------------
-- SaaS-level tables
-- -------------------------------------------------------------

-- Subscription plans
create table if not exists public.plans (
    id uuid primary key default gen_random_uuid(),
    name text not null,
    price_monthly numeric(12,2) not null default 999.00,
    currency text not null default 'PHP',
    features text[] not null default '{}',
    active boolean not null default true,
    created_at timestamptz not null default now()
);

insert into public.plans (name, price_monthly, currency, features, active)
select 'ZE-POS Monthly', 999.00, 'PHP', '{POS, Menu, Categories, Orders, Reports, Shifts, Payroll}', true
where not exists (select 1 from public.plans where name = 'ZE-POS Monthly');

-- Client accounts (one row per Supabase auth user)
create table if not exists public.profiles (
    id uuid primary key references auth.users(id) on delete cascade,
    business_name text not null default 'My Business',
    email text,
    is_super_admin boolean not null default false,
    plan_id uuid references public.plans(id),
    subscription_status text not null default 'never'
        check (subscription_status in ('never','active','overdue','cancelled')),
    current_period_end timestamptz,
    created_at timestamptz not null default now()
);

-- Payment records (manual + PayMongo)
create table if not exists public.payments (
    id uuid primary key default gen_random_uuid(),
    profile_id uuid not null references public.profiles(id) on delete cascade,
    amount numeric(12,2) not null default 0,
    method text not null default 'gcash' check (method in ('gcash','maya','bank','card','paymongo')),
    status text not null default 'pending' check (status in ('pending','paid','failed')),
    reference text,
    source text not null default 'manual' check (source in ('manual','paymongo')),
    period_start timestamptz,
    period_end timestamptz,
    created_at timestamptz not null default now()
);

-- -------------------------------------------------------------
-- Tenant tables (one workspace per client = owner's auth uid)
-- Composite PK (workspace_id, id) lets existing friendly ids
-- (e.g. 'm1', 'c1') be reused independently per workspace.
-- -------------------------------------------------------------

create table if not exists public.users (
    workspace_id uuid not null,
    id text not null,
    username text,
    password text,
    name text,
    role text not null default 'cashier' check (role in ('admin','cashier')),
    enabled boolean not null default true,
    pay_type text not null default 'hourly' check (pay_type in ('hourly','fixed')),
    hourly_rate numeric(12,2) not null default 0,
    fixed_salary numeric(12,2) not null default 0,
    created_at timestamptz not null default now(),
    primary key (workspace_id, id)
);

create table if not exists public.categories (
    workspace_id uuid not null,
    id text not null,
    name text,
    description text,
    enabled boolean not null default true,
    created_at timestamptz not null default now(),
    primary key (workspace_id, id)
);

create table if not exists public.menu_items (
    workspace_id uuid not null,
    id text not null,
    name text,
    description text,
    image text,
    category_id text,
    enabled boolean not null default true,
    created_at timestamptz not null default now(),
    primary key (workspace_id, id)
);

create table if not exists public.menu_sizes (
    workspace_id uuid not null,
    id text not null,
    menu_item_id text,
    name text,
    price numeric(12,2) not null default 0,
    created_at timestamptz not null default now(),
    primary key (workspace_id, id)
);

create table if not exists public.condiments (
    workspace_id uuid not null,
    id text not null,
    name text,
    price numeric(12,2) not null default 0,
    enabled boolean not null default true,
    created_at timestamptz not null default now(),
    primary key (workspace_id, id)
);

create table if not exists public.taxes (
    workspace_id uuid not null,
    id text not null,
    name text,
    percentage numeric(6,2) not null default 0,
    enabled boolean not null default true,
    created_at timestamptz not null default now(),
    primary key (workspace_id, id)
);

create table if not exists public.orders (
    workspace_id uuid not null,
    id text not null,
    order_number integer,
    type text,
    status text,
    subtotal numeric(12,2) not null default 0,
    tax_name text,
    tax_percentage numeric(6,2) not null default 0,
    tax_amount numeric(12,2) not null default 0,
    total numeric(12,2) not null default 0,
    user_id text,
    user_name text,
    shift_id text,
    created_at timestamptz not null default now(),
    primary key (workspace_id, id)
);

create table if not exists public.order_items (
    workspace_id uuid not null,
    id text not null,
    order_id text,
    menu_item_id text,
    name text,
    size text,
    quantity integer not null default 1,
    unit_price numeric(12,2) not null default 0,
    condiments jsonb not null default '[]',
    notes text,
    line_total numeric(12,2) not null default 0,
    created_at timestamptz not null default now(),
    primary key (workspace_id, id)
);

create table if not exists public.shifts (
    workspace_id uuid not null,
    id text not null,
    user_id text,
    user_name text,
    start_time timestamptz,
    end_time timestamptz,
    status text not null default 'open' check (status in ('open','closed')),
    starting_cash numeric(12,2) not null default 0,
    ending_cash numeric(12,2),
    cash_difference numeric(12,2),
    total_sales numeric(12,2),
    order_count integer,
    schedule_id text,
    pay_rate numeric(12,2),
    created_at timestamptz not null default now(),
    primary key (workspace_id, id)
);

create table if not exists public.shift_schedules (
    workspace_id uuid not null,
    id text not null,
    user_id text,
    type text not null default 'weekly' check (type in ('weekly','date')),
    day_of_week integer,
    date date,
    start_time text,
    end_time text,
    enabled boolean not null default true,
    created_at timestamptz not null default now(),
    primary key (workspace_id, id)
);

create table if not exists public.payrolls (
    workspace_id uuid not null,
    id text not null,
    from_date text,
    to_date text,
    status text not null default 'unpaid',
    total_pay numeric(12,2) not null default 0,
    items jsonb not null default '[]',
    created_at timestamptz not null default now(),
    paid_at timestamptz,
    primary key (workspace_id, id)
);

create table if not exists public.settings (
    workspace_id uuid not null,
    id text not null,
    key text,
    value text,
    created_at timestamptz not null default now(),
    primary key (workspace_id, id)
);

-- -------------------------------------------------------------
-- Row-Level Security (auth.uid()-based — will be upgraded in 002)
-- -------------------------------------------------------------

-- Auto-create a profile row whenever a user signs up
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
    insert into public.profiles (id, email, business_name, subscription_status)
    values (
        new.id,
        new.email,
        coalesce(new.raw_user_meta_data->>'business_name', 'My Business'),
        'never'
    );
    return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
    after insert on auth.users
    for each row execute function public.handle_new_user();

-- profiles: clients may read ONLY their own row
alter table public.profiles enable row level security;
create policy "profiles read own" on public.profiles
    for select using (id = auth.uid());

-- plans: readable by any authenticated user (needed for billing page)
alter table public.plans enable row level security;
create policy "plans read all" on public.plans
    for select using (true);

-- payments: only accessible via SECURITY DEFINER admin RPCs / service role
alter table public.payments enable row level security;

-- Tenant tables: strict isolation by workspace (auth.uid() = workspace owner)
do $$
declare t text;
begin
    foreach t in array array[
        'users','categories','menu_items','menu_sizes','condiments','taxes',
        'orders','order_items','shifts','shift_schedules','payrolls','settings'
    ] loop
        execute format('alter table public.%I enable row level security;', t);
        execute format(
            'create policy "tenant_rw_%s" on public.%I for all
             using (workspace_id = auth.uid())
             with check (workspace_id = auth.uid());', t, t);
    end loop;
end $$;

-- -------------------------------------------------------------
-- Admin RPCs (SECURITY DEFINER → bypass RLS, but gate on is_super_admin)
-- -------------------------------------------------------------

create or replace function public.is_super_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
    select exists (
        select 1 from public.profiles
        where id = auth.uid() and is_super_admin = true
    );
$$;

-- List every client for the admin dashboard
create or replace function public.admin_list_clients()
returns table (
    id uuid,
    business_name text,
    email text,
    plan_id uuid,
    plan_name text,
    subscription_status text,
    current_period_end timestamptz,
    last_payment_at timestamptz,
    created_at timestamptz
)
language sql
security definer
set search_path = public
as $$
    select
        p.id,
        p.business_name,
        p.email,
        p.plan_id,
        pl.name,
        p.subscription_status,
        p.current_period_end,
        (select max(pay.created_at) from public.payments pay where pay.profile_id = p.id),
        p.created_at
    from public.profiles p
    left join public.plans pl on pl.id = p.plan_id
    where public.is_super_admin()
    order by p.created_at desc;
$$;

-- Payment history for one client
create or replace function public.admin_list_payments(p_profile uuid)
returns table (
    id uuid,
    amount numeric,
    method text,
    status text,
    reference text,
    source text,
    created_at timestamptz
)
language sql
security definer
set search_path = public
as $$
    select pay.id, pay.amount, pay.method, pay.status, pay.reference, pay.source, pay.created_at
    from public.payments pay
    where pay.profile_id = p_profile and public.is_super_admin()
    order by pay.created_at desc;
$$;

-- Record a manual payment → activate + extend the period by 30 days
create or replace function public.admin_record_payment(
    p_profile uuid,
    p_amount numeric,
    p_method text,
    p_reference text default null
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

    insert into public.payments (profile_id, amount, method, status, reference, source, period_start, period_end)
    values (
        p_profile, p_amount, p_method, 'paid', p_reference, 'manual',
        now(),
        greatest(coalesce(
            (select current_period_end from public.profiles where id = p_profile),
            now()), now()) + interval '30 days'
    );

    update public.profiles
    set subscription_status = 'active',
        current_period_end = greatest(coalesce(current_period_end, now()), now()) + interval '30 days'
    where id = p_profile;
end;
$$;

-- Cancel / reactivate / mark overdue
create or replace function public.admin_set_subscription_status(p_profile uuid, p_status text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
    if not public.is_super_admin() then
        raise exception 'not authorized';
    end if;
    if p_status not in ('never','active','overdue','cancelled') then
        raise exception 'invalid status';
    end if;
    update public.profiles set subscription_status = p_status where id = p_profile;
end;
$$;

-- Extend a period by N days (manual adjustment)
create or replace function public.admin_extend_period(p_profile uuid, p_days integer)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
    if not public.is_super_admin() then
        raise exception 'not authorized';
    end if;
    update public.profiles
    set current_period_end = greatest(coalesce(current_period_end, now()), now()) + make_interval(days => p_days)
    where id = p_profile;
end;
$$;

-- One-call billing snapshot for the signed-in client (status + plan + history)
create or replace function public.get_my_billing()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    result jsonb;
begin
    select jsonb_build_object(
        'status', prof.subscription_status,
        'period_end', prof.current_period_end,
        'business_name', prof.business_name,
        'plan_name', plan.name,
        'price_monthly', plan.price_monthly,
        'currency', plan.currency,
        'payments', coalesce((
            select jsonb_agg(jsonb_build_object(
                'amount', pay.amount, 'method', pay.method, 'status', pay.status,
                'reference', pay.reference, 'source', pay.source, 'created_at', pay.created_at
            ) order by pay.created_at desc)
            from public.payments pay where pay.profile_id = prof.id
        ), '[]'::jsonb)
    ) into result
    from public.profiles prof
    left join public.plans plan on plan.id = prof.plan_id
    where prof.id = auth.uid();

    return coalesce(result, '{}'::jsonb);
end;
$$;

-- -------------------------------------------------------------
-- Workspace seeding (starter menu + owner admin user + settings)
-- Called client-side after first login.
-- -------------------------------------------------------------

create or replace function public.seed_workspace()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
    ws uuid := auth.uid();
    owner_name text;
    existing_settings integer;
begin
    select business_name into owner_name from public.profiles where id = ws;

    -- Owner admin user (id = their auth uid so it maps cleanly)
    insert into public.users (workspace_id, id, username, password, name, role, enabled, pay_type, hourly_rate, fixed_salary)
    values (ws, ws::text, coalesce((select email from auth.users where id = ws), 'owner'), 'cloud-login', coalesce(owner_name, 'Owner'), 'admin', true, 'hourly', 0, 0)
    on conflict (workspace_id, id) do nothing;

    -- Default settings (restaurant info + overtime rules)
    select count(*) into existing_settings from public.settings where workspace_id = ws;
    if existing_settings = 0 then
        insert into public.settings (workspace_id, id, key, value) values
        (ws, 'st1', 'restaurant_name', coalesce(owner_name, 'My Business')),
        (ws, 'st2', 'restaurant_address', ''),
        (ws, 'st3', 'restaurant_phone', ''),
        (ws, 'st4', 'currency_symbol', '��'),
        (ws, 'st5', 'overtime_enabled', '0'),
        (ws, 'st6', 'overtime_daily_threshold', '8'),
        (ws, 'st7', 'overtime_weekly_threshold', '40'),
        (ws, 'st8', 'overtime_multiplier', '1.5');
    end if;

    -- Starter categories + menu (only if the workspace is empty)
    if not exists (select 1 from public.categories where workspace_id = ws) then
        insert into public.categories (workspace_id, id, name, description, enabled) values
        (ws, 'c1', 'Burgers', 'Flame-grilled burgers', true),
        (ws, 'c2', 'Pizza', 'Wood-fired pizzas', true),
        (ws, 'c3', 'Drinks', 'Refreshing beverages', true),
        (ws, 'c4', 'Desserts', 'Sweet treats', true),
        (ws, 'c5', 'Sides', 'Crispy sides', true);

        insert into public.menu_items (workspace_id, id, name, description, category_id, enabled) values
        (ws, 'm1', 'Zinger Burger', 'Crispy chicken fillet with mayo', 'c1', true),
        (ws, 'm2', 'Classic Burger', 'Beef patty with lettuce & tomato', 'c1', true),
        (ws, 'm3', 'Chicken Pizza', 'Grilled chicken & mozzarella', 'c2', true),
        (ws, 'm4', 'Pepperoni Pizza', 'Classic pepperoni & cheese', 'c2', true),
        (ws, 'm5', 'Coke', 'Chilled Coca-Cola', 'c3', true),
        (ws, 'm6', 'Pepsi', 'Chilled Pepsi', 'c3', true),
        (ws, 'm7', 'Chocolate Cake', 'Rich chocolate layer cake', 'c4', true),
        (ws, 'm8', 'French Fries', 'Golden crispy fries', 'c5', true),
        (ws, 'm9', 'Onion Rings', 'Battered onion rings', 'c5', true),
        (ws, 'm10', 'Ice Cream Sundae', 'Vanilla ice cream with toppings', 'c4', true);
    end if;
end;
$$;