-- =====================================================================
--  ZERO PHONE POS  —  سیستەمی فرۆشتن و کۆگا
--  schema.sql  ·  Supabase (PostgreSQL 15+)
--
--  How to run: Supabase dashboard → SQL Editor → New query → paste this
--  whole file → Run.  It is safe to run again (nothing is dropped).
--
--  Design rules
--   * Every table is locked (RLS on, no policies, no grants). The web app
--     talks ONLY to the functions below; each function checks who is
--     calling (admin / cashier) before doing anything.
--   * Money is whole Iraqi dinar (bigint). No decimals anywhere.
--   * Cost is tracked as "value of stock on hand" so the average cost of
--     one unit is value / quantity, and every sale stores its own cost and
--     therefore its own profit at the moment of sale.
--   * Day boundaries use Asia/Baghdad (UTC+3).
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Tables
-- ---------------------------------------------------------------------

create table if not exists public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  username    text        not null check (length(btrim(username)) between 1 and 60),
  full_name   text        not null default '' check (length(full_name) <= 80),
  role        text        not null default 'cashier' check (role in ('admin', 'cashier')),
  active      boolean     not null default false,
  created_at  timestamptz not null default now()
);
create unique index if not exists profiles_username_key on public.profiles (lower(username));
-- set the first time an admin lets the person in; "never approved" = still waiting for the owner
alter table public.profiles add column if not exists approved_at timestamptz;
update public.profiles set approved_at = created_at where active and approved_at is null;

create table if not exists public.shop_settings (
  id                       smallint    primary key default 1 check (id = 1),
  shop_name                text        not null default 'ZERO PHONE 2',
  shop_phone               text        not null default '',
  shop_address             text        not null default '',
  receipt_footer           text        not null default 'سوپاس بۆ سەردانتان',
  cashier_max_discount_pct integer     not null default 0  check (cashier_max_discount_pct between 0 and 100),
  cashier_can_return       boolean     not null default true,
  return_window_days       integer     not null default 14 check (return_window_days between 0 and 3650),
  updated_at               timestamptz not null default now()
);
insert into public.shop_settings (id) values (1) on conflict (id) do nothing;

create table if not exists public.products (
  id           bigint generated always as identity primary key,
  name         text        not null check (length(btrim(name)) between 1 and 200),
  code         text        check (code is null or length(btrim(code)) between 1 and 64),
  category     text        check (category is null or length(btrim(category)) between 1 and 80),
  price        bigint      not null default 0 check (price >= 0),
  stock        integer     not null default 0 check (stock >= 0),
  stock_value  bigint      not null default 0 check (stock_value >= 0),
  min_stock    integer     not null default 0 check (min_stock >= 0),
  active       boolean     not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint products_value_zero_when_empty check (stock > 0 or stock_value = 0)
);
create unique index if not exists products_code_key on public.products (lower(code)) where code is not null;
create index if not exists products_name_idx on public.products (lower(name));

-- every arrival of goods; total_cost is the price paid for the WHOLE arrival
create table if not exists public.purchases (
  id          bigint generated always as identity primary key,
  product_id  bigint      not null references public.products (id) on delete cascade,
  qty         integer     not null check (qty > 0),
  total_cost  bigint      not null check (total_cost >= 0),
  supplier    text,
  note        text,
  kind        text        not null default 'purchase' check (kind in ('purchase', 'opening')),
  created_by  uuid        not null references public.profiles (id),
  created_at  timestamptz not null default now(),
  voided_at   timestamptz,
  client_id   uuid
);
create unique index if not exists purchases_client_id_key on public.purchases (client_id) where client_id is not null;
create index if not exists purchases_created_idx on public.purchases (created_at);
create index if not exists purchases_product_idx on public.purchases (product_id, id desc);

create table if not exists public.sales (
  id          bigint generated always as identity primary key,
  created_at  timestamptz not null default now(),
  cashier_id  uuid        not null references public.profiles (id),
  subtotal    bigint      not null check (subtotal >= 0),
  discount    bigint      not null default 0 check (discount >= 0),
  total       bigint      not null check (total >= 0),
  cost_total  bigint      not null default 0 check (cost_total >= 0),
  note        text,
  client_id   uuid,
  constraint sales_amounts_ok check (discount <= subtotal and total = subtotal - discount)
);
create unique index if not exists sales_client_id_key on public.sales (client_id) where client_id is not null;
create index if not exists sales_created_idx on public.sales (created_at);
create index if not exists sales_cashier_idx on public.sales (cashier_id, created_at);

create table if not exists public.sale_items (
  id             bigint generated always as identity primary key,
  sale_id        bigint  not null references public.sales (id) on delete cascade,
  product_id     bigint  not null references public.products (id),
  product_name   text    not null,
  qty            integer not null check (qty > 0),
  unit_price     bigint  not null check (unit_price >= 0),
  line_total     bigint  not null check (line_total >= 0),
  line_discount  bigint  not null default 0 check (line_discount >= 0),
  line_net       bigint  not null check (line_net >= 0),
  cost_total     bigint  not null default 0 check (cost_total >= 0),
  returned_qty   integer not null default 0 check (returned_qty >= 0),
  refunded       bigint  not null default 0 check (refunded >= 0),
  cost_returned  bigint  not null default 0 check (cost_returned >= 0),
  constraint sale_items_returned_ok check (returned_qty <= qty),
  constraint sale_items_net_ok      check (line_net = line_total - line_discount),
  constraint sale_items_refund_ok   check (refunded <= line_net and cost_returned <= cost_total)
);
create index if not exists sale_items_sale_idx    on public.sale_items (sale_id);
create index if not exists sale_items_product_idx on public.sale_items (product_id);

create table if not exists public.sale_returns (
  id            bigint generated always as identity primary key,
  sale_id       bigint      not null references public.sales (id) on delete cascade,
  sale_item_id  bigint      not null references public.sale_items (id) on delete cascade,
  product_id    bigint      not null references public.products (id),
  qty           integer     not null check (qty > 0),
  refund        bigint      not null check (refund >= 0),
  cost_back     bigint      not null default 0 check (cost_back >= 0),
  restocked     boolean     not null default true,
  reason        text        not null check (length(btrim(reason)) between 1 and 300),
  created_by    uuid        not null references public.profiles (id),
  created_at    timestamptz not null default now(),
  client_id     uuid
);
create unique index if not exists sale_returns_client_id_key on public.sale_returns (client_id) where client_id is not null;
create index if not exists sale_returns_created_idx on public.sale_returns (created_at);
create index if not exists sale_returns_sale_idx    on public.sale_returns (sale_id);
create index if not exists sale_returns_product_idx on public.sale_returns (product_id);

-- journal of every change to stock (audit trail)
create table if not exists public.stock_movements (
  id            bigint generated always as identity primary key,
  product_id    bigint      not null references public.products (id) on delete cascade,
  kind          text        not null check (kind in ('opening','purchase','sale','return','return_loss','adjust','void')),
  qty_change    integer     not null,
  value_change  bigint      not null default 0,
  stock_after   integer     not null,
  value_after   bigint      not null,
  ref_id        bigint,
  note          text,
  created_by    uuid references public.profiles (id),
  created_at    timestamptz not null default now()
);
create index if not exists stock_movements_product_idx on public.stock_movements (product_id, id desc);
create index if not exists stock_movements_created_idx on public.stock_movements (created_at);

-- lock every table: no policies = nobody (except the functions below) can read or write
alter table public.profiles        enable row level security;
alter table public.shop_settings   enable row level security;
alter table public.products        enable row level security;
alter table public.purchases       enable row level security;
alter table public.sales           enable row level security;
alter table public.sale_items      enable row level security;
alter table public.sale_returns    enable row level security;
alter table public.stock_movements enable row level security;

revoke all on all tables    in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
alter default privileges in schema public revoke all on tables    from anon, authenticated;
alter default privileges in schema public revoke all on sequences from anon, authenticated;
alter default privileges in schema public revoke execute on functions from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 2. Internal helpers (not callable from the web app)
-- ---------------------------------------------------------------------

create or replace function public._role() returns text
language sql stable security definer set search_path = public, pg_temp
as $$ select p.role from public.profiles p where p.id = auth.uid() and p.active $$;

create or replace function public._need_staff() returns text
language plpgsql stable security definer set search_path = public, pg_temp
as $$
declare v_role text;
begin
  select p.role into v_role from public.profiles p where p.id = auth.uid() and p.active;
  if v_role is null then
    raise exception 'NOT_AUTHORIZED' using errcode = 'PT403';
  end if;
  return v_role;
end $$;

create or replace function public._need_admin() returns void
language plpgsql stable security definer set search_path = public, pg_temp
as $$
begin
  if coalesce(public._role(), '') <> 'admin' then
    raise exception 'ADMIN_ONLY' using errcode = 'PT403';
  end if;
end $$;

-- [start of day p_from, start of the day after p_to] in Asia/Baghdad
create or replace function public._bounds(p_from date, p_to date) returns timestamptz[]
language plpgsql stable set search_path = public, pg_temp
as $$
begin
  if p_from is null or p_to is null or p_to < p_from then
    raise exception 'BAD_RANGE';
  end if;
  if p_to - p_from > 800 then
    raise exception 'RANGE_TOO_LONG';
  end if;
  return array[
    (p_from::timestamp        at time zone 'Asia/Baghdad'),
    ((p_to + 1)::timestamp    at time zone 'Asia/Baghdad')
  ];
end $$;

create or replace function public._today() returns date
language sql stable set search_path = public, pg_temp
as $$ select (now() at time zone 'Asia/Baghdad')::date $$;

-- share of p_total that belongs to the first p_k of p_n units; exact when p_k = p_n
create or replace function public._prorate(p_total bigint, p_k integer, p_n integer) returns bigint
language sql immutable
as $$
  select case when p_k >= p_n then p_total
              else floor(p_total::numeric * p_k / p_n)::bigint end
$$;

create or replace function public._product_json(p public.products) returns jsonb
language sql stable security definer set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'id', p.id, 'name', p.name, 'code', p.code, 'category', p.category,
    'price', p.price, 'min_stock', p.min_stock, 'active', p.active,
    'stock', p.stock, 'stock_value', p.stock_value,
    'avg_cost', case when p.stock > 0 then round(p.stock_value::numeric / p.stock) end,
    'created_at', p.created_at,
    'last_sold_at', (select max(s.created_at)
                       from public.sale_items i join public.sales s on s.id = i.sale_id
                      where i.product_id = p.id),
    'last_purchase_at', (select max(pu.created_at) from public.purchases pu
                          where pu.product_id = p.id and pu.voided_at is null)
  )
$$;

-- one receipt, shaped for the caller's role (cashiers never see cost or profit)
create or replace function public._sale_json(p_sale_id bigint, p_role text) returns jsonb
language sql stable security definer set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'id', s.id,
    'created_at', s.created_at,
    'cashier_id', s.cashier_id,
    'cashier_name', coalesce(nullif(pr.full_name, ''), pr.username),
    'subtotal', s.subtotal, 'discount', s.discount, 'total', s.total,
    'note', s.note,
    'refunded', coalesce((select sum(r.refund) from public.sale_returns r where r.sale_id = s.id), 0),
    'cost_total', case when p_role = 'admin' then s.cost_total end,
    'cost_back',  case when p_role = 'admin'
                       then coalesce((select sum(r.cost_back) from public.sale_returns r where r.sale_id = s.id), 0) end,
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', i.id, 'product_id', i.product_id, 'name', i.product_name, 'qty', i.qty,
               'unit_price', i.unit_price, 'line_total', i.line_total,
               'line_discount', i.line_discount, 'line_net', i.line_net,
               'returned_qty', i.returned_qty, 'refunded', i.refunded,
               'cost_total',    case when p_role = 'admin' then i.cost_total end,
               'cost_returned', case when p_role = 'admin' then i.cost_returned end
             ) order by i.id)
        from public.sale_items i where i.sale_id = s.id), '[]'::jsonb),
    'returns', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', r.id, 'sale_item_id', r.sale_item_id, 'qty', r.qty, 'refund', r.refund,
               'restocked', r.restocked, 'reason', r.reason, 'created_at', r.created_at,
               'by', coalesce(nullif(rp.full_name, ''), rp.username)
             ) order by r.id)
        from public.sale_returns r join public.profiles rp on rp.id = r.created_by
       where r.sale_id = s.id), '[]'::jsonb)
  )
  from public.sales s
  join public.profiles pr on pr.id = s.cashier_id
  where s.id = p_sale_id
$$;

-- stock coming in (used by "new goods" and by the opening stock of a new product)
create or replace function public._apply_purchase(
  p_product_id bigint, p_qty integer, p_total_cost bigint,
  p_supplier text, p_note text, p_kind text, p_uid uuid, p_client_id uuid
) returns bigint
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_id    bigint;
  v_stock integer;
  v_value bigint;
begin
  if p_qty is null or p_qty < 1 or p_qty > 1000000 then
    raise exception 'QTY_INVALID';
  end if;
  if p_total_cost is null or p_total_cost < 0 or p_total_cost > 1000000000000 then
    raise exception 'COST_INVALID';
  end if;
  select stock, stock_value into v_stock, v_value
    from public.products where id = p_product_id for update;
  if not found then
    raise exception 'PRODUCT_NOT_FOUND';
  end if;
  insert into public.purchases (product_id, qty, total_cost, supplier, note, kind, created_by, client_id)
  values (p_product_id, p_qty, p_total_cost, left(nullif(btrim(p_supplier), ''), 120),
          left(nullif(btrim(p_note), ''), 300), p_kind, p_uid, p_client_id)
  returning id into v_id;
  update public.products
     set stock = stock + p_qty, stock_value = stock_value + p_total_cost, updated_at = now()
   where id = p_product_id;
  insert into public.stock_movements (product_id, kind, qty_change, value_change, stock_after, value_after, ref_id, note, created_by)
  values (p_product_id, p_kind, p_qty, p_total_cost, v_stock + p_qty, v_value + p_total_cost, v_id,
          left(nullif(btrim(p_note), ''), 300), p_uid);
  return v_id;
end $$;

-- ---------------------------------------------------------------------
-- 3. New accounts: the very first account becomes the admin; everyone
--    after that is created as an inactive cashier until an admin approves.
-- ---------------------------------------------------------------------

create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_first    boolean;
  v_local    text;
  v_username text;
begin
  perform pg_advisory_xact_lock(7001);
  select not exists (select 1 from public.profiles) into v_first;
  v_local := lower(split_part(coalesce(new.email, new.id::text), '@', 1));
  -- the app signs people up as  owner+sara@gmail.com  (every login shares the owner's real mailbox):
  -- the part after the plus sign is the user name; a plain "sara@shop.com" keeps its local part
  v_username := case when position('+' in v_local) > 0 then substr(v_local, position('+' in v_local) + 1) else v_local end;
  if v_username = '' or exists (select 1 from public.profiles p where lower(p.username) = v_username) then
    v_username := left(v_username, 50) || '_' || substr(new.id::text, 1, 4);
  end if;
  insert into public.profiles (id, username, full_name, role, active, approved_at)
  values (new.id, v_username,
          left(coalesce(nullif(btrim(new.raw_user_meta_data ->> 'full_name'), ''), v_username), 80),
          case when v_first then 'admin' else 'cashier' end,
          v_first,
          case when v_first then now() end)
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------
-- 4. Session / settings
-- ---------------------------------------------------------------------

create or replace function public.needs_setup() returns boolean
language sql stable security definer set search_path = public, pg_temp
as $$ select not exists (select 1 from public.profiles) $$;

create or replace function public.my_profile() returns jsonb
language sql stable security definer set search_path = public, pg_temp
as $$
  select jsonb_build_object('id', p.id, 'username', p.username, 'full_name', p.full_name,
                            'role', p.role, 'active', p.active)
    from public.profiles p where p.id = auth.uid()
$$;

create or replace function public.get_settings() returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp
as $$
begin
  perform public._need_staff();
  return (select to_jsonb(s) - 'id' - 'updated_at' from public.shop_settings s where s.id = 1);
end $$;

create or replace function public.save_settings(p jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $$
begin
  perform public._need_admin();
  update public.shop_settings set
    shop_name                = coalesce(nullif(btrim(p ->> 'shop_name'), ''), shop_name),
    shop_phone               = coalesce(btrim(p ->> 'shop_phone'), shop_phone),
    shop_address             = coalesce(btrim(p ->> 'shop_address'), shop_address),
    receipt_footer           = coalesce(btrim(p ->> 'receipt_footer'), receipt_footer),
    cashier_max_discount_pct = coalesce((p ->> 'cashier_max_discount_pct')::integer, cashier_max_discount_pct),
    cashier_can_return       = coalesce((p ->> 'cashier_can_return')::boolean, cashier_can_return),
    return_window_days       = coalesce((p ->> 'return_window_days')::integer, return_window_days),
    updated_at               = now()
  where id = 1;
  return public.get_settings();
end $$;

-- ---------------------------------------------------------------------
-- 5. Products and stock (admin)
-- ---------------------------------------------------------------------

-- what the cashier sees when selling: no cost, no value
create or replace function public.pos_products() returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp
as $$
begin
  perform public._need_staff();
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', p.id, 'name', p.name, 'code', p.code, 'category', p.category,
             'price', p.price, 'stock', p.stock))
      from public.products p where p.active), '[]'::jsonb);
end $$;

create or replace function public.admin_products() returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp
as $$
begin
  perform public._need_admin();
  return coalesce((select jsonb_agg(public._product_json(p) order by p.id desc) from public.products p), '[]'::jsonb);
end $$;

create or replace function public.save_product(p jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_uid    uuid    := auth.uid();
  v_id     bigint  := nullif(p ->> 'id', '')::bigint;
  v_name   text    := btrim(coalesce(p ->> 'name', ''));
  v_code   text    := nullif(btrim(coalesce(p ->> 'code', '')), '');
  v_cat    text    := nullif(btrim(coalesce(p ->> 'category', '')), '');
  v_price  bigint  := coalesce(nullif(p ->> 'price', '')::bigint, 0);
  v_min    integer := coalesce(nullif(p ->> 'min_stock', '')::integer, 0);
  v_active boolean := coalesce((p ->> 'active')::boolean, true);
  v_qty    integer := coalesce(nullif(p ->> 'opening_qty', '')::integer, 0);
  v_cost   bigint  := nullif(p ->> 'opening_cost', '')::bigint;
  v_row    public.products;
begin
  perform public._need_admin();
  if v_name = '' then raise exception 'NAME_REQUIRED'; end if;
  if v_price < 0 or v_price > 1000000000000 then raise exception 'PRICE_INVALID'; end if;
  if v_min < 0 or v_min > 1000000 then raise exception 'MIN_STOCK_INVALID'; end if;
  begin
    if v_id is null then
      if v_qty < 0 then raise exception 'QTY_INVALID'; end if;
      if v_qty > 0 and v_cost is null then raise exception 'COST_REQUIRED'; end if;
      insert into public.products (name, code, category, price, min_stock, active)
      values (v_name, v_code, v_cat, v_price, v_min, v_active)
      returning id into v_id;
      if v_qty > 0 then
        perform public._apply_purchase(v_id, v_qty, v_cost, null, null, 'opening', v_uid, null);
      end if;
    else
      update public.products
         set name = v_name, code = v_code, category = v_cat, price = v_price,
             min_stock = v_min, active = v_active, updated_at = now()
       where id = v_id;
      if not found then raise exception 'PRODUCT_NOT_FOUND'; end if;
    end if;
  exception when unique_violation then
    raise exception 'CODE_TAKEN' using detail = jsonb_build_object('code', v_code)::text;
  end;
  select * into v_row from public.products where id = v_id;
  return public._product_json(v_row);
end $$;

create or replace function public.set_product_active(p_id bigint, p_active boolean) returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_row public.products;
begin
  perform public._need_admin();
  update public.products set active = coalesce(p_active, true), updated_at = now() where id = p_id
  returning * into v_row;
  if not found then raise exception 'PRODUCT_NOT_FOUND'; end if;
  return public._product_json(v_row);
end $$;

-- only products that were never sold can be erased; the rest can be hidden (active = false)
create or replace function public.delete_product(p_id bigint) returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $$
begin
  perform public._need_admin();
  if exists (select 1 from public.sale_items i where i.product_id = p_id) then
    raise exception 'PRODUCT_HAS_SALES';
  end if;
  delete from public.products where id = p_id;
  if not found then raise exception 'PRODUCT_NOT_FOUND'; end if;
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.add_stock(
  p_product_id bigint, p_qty integer, p_total_cost bigint,
  p_supplier text default null, p_note text default null, p_client_id uuid default null
) returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_pur bigint;
  v_row public.products;
begin
  perform public._need_admin();
  if p_client_id is not null then
    select pu.id into v_pur from public.purchases pu where pu.client_id = p_client_id;
    if found then
      select * into v_row from public.products where id = p_product_id;
      return jsonb_build_object('purchase_id', v_pur, 'product', public._product_json(v_row), 'duplicate', true);
    end if;
  end if;
  v_pur := public._apply_purchase(p_product_id, p_qty, p_total_cost, p_supplier, p_note, 'purchase', auth.uid(), p_client_id);
  select * into v_row from public.products where id = p_product_id;
  return jsonb_build_object('purchase_id', v_pur, 'product', public._product_json(v_row));
end $$;

-- fix a wrong count: the average cost stays the same
create or replace function public.adjust_stock(p_product_id bigint, p_new_stock integer, p_note text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_p       public.products;
  v_delta   integer;
  v_unit    numeric;
  v_vchange bigint;
  v_row     public.products;
begin
  perform public._need_admin();
  if p_new_stock is null or p_new_stock < 0 or p_new_stock > 1000000 then raise exception 'QTY_INVALID'; end if;
  if btrim(coalesce(p_note, '')) = '' then raise exception 'REASON_REQUIRED'; end if;
  select * into v_p from public.products where id = p_product_id for update;
  if not found then raise exception 'PRODUCT_NOT_FOUND'; end if;
  v_delta := p_new_stock - v_p.stock;
  if v_delta = 0 then raise exception 'NO_CHANGE'; end if;
  if v_delta > 0 then
    if v_p.stock > 0 then
      v_unit := v_p.stock_value::numeric / v_p.stock;
    else
      select round(pu.total_cost::numeric / pu.qty) into v_unit
        from public.purchases pu
       where pu.product_id = p_product_id and pu.voided_at is null
       order by pu.id desc limit 1;
      v_unit := coalesce(v_unit, 0);
    end if;
    v_vchange := round(v_unit * v_delta)::bigint;
  elsif p_new_stock = 0 then
    v_vchange := -v_p.stock_value;
  else
    v_vchange := -round(v_p.stock_value::numeric * (-v_delta) / v_p.stock)::bigint;
  end if;
  update public.products
     set stock = p_new_stock, stock_value = stock_value + v_vchange, updated_at = now()
   where id = p_product_id
  returning * into v_row;
  insert into public.stock_movements (product_id, kind, qty_change, value_change, stock_after, value_after, note, created_by)
  values (p_product_id, 'adjust', v_delta, v_vchange, v_row.stock, v_row.stock_value, left(btrim(p_note), 300), auth.uid());
  return public._product_json(v_row);
end $$;

-- undo an arrival typed by mistake (only while nothing else happened to that product since)
create or replace function public.void_purchase(p_purchase_id bigint) returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_pu   public.purchases;
  v_p    public.products;
  v_last bigint;
  v_mine bigint;
  v_row  public.products;
begin
  perform public._need_admin();
  select * into v_pu from public.purchases where id = p_purchase_id for update;
  if not found then raise exception 'PURCHASE_NOT_FOUND'; end if;
  if v_pu.voided_at is not null then raise exception 'ALREADY_VOIDED'; end if;
  select * into v_p from public.products where id = v_pu.product_id for update;
  select max(m.id) into v_last from public.stock_movements m where m.product_id = v_pu.product_id;
  select max(m.id) into v_mine from public.stock_movements m
   where m.product_id = v_pu.product_id and m.kind in ('purchase', 'opening') and m.ref_id = v_pu.id;
  if v_last is distinct from v_mine then
    raise exception 'PURCHASE_NOT_LAST';
  end if;
  update public.products
     set stock = stock - v_pu.qty, stock_value = stock_value - v_pu.total_cost, updated_at = now()
   where id = v_p.id
  returning * into v_row;
  update public.purchases set voided_at = now() where id = v_pu.id;
  insert into public.stock_movements (product_id, kind, qty_change, value_change, stock_after, value_after, ref_id, created_by)
  values (v_p.id, 'void', -v_pu.qty, -v_pu.total_cost, v_row.stock, v_row.stock_value, v_pu.id, auth.uid());
  return public._product_json(v_row);
end $$;

create or replace function public.list_movements(
  p_from date, p_to date, p_product_id bigint default null, p_kind text default null,
  p_limit integer default 200, p_offset integer default 0
) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp
as $$
declare
  v_b     timestamptz[];
  v_rows  jsonb;
  v_count bigint;
begin
  perform public._need_admin();
  v_b := public._bounds(p_from, p_to);
  p_limit  := least(greatest(coalesce(p_limit, 200), 1), 1000);
  p_offset := greatest(coalesce(p_offset, 0), 0);
  select count(*) into v_count
    from public.stock_movements m
   where m.created_at >= v_b[1] and m.created_at < v_b[2]
     and (p_product_id is null or m.product_id = p_product_id)
     and (p_kind is null or m.kind = p_kind);
  select coalesce(jsonb_agg(t.j order by t.id desc), '[]'::jsonb) into v_rows
    from (
      select m.id,
             jsonb_build_object(
               'id', m.id, 'created_at', m.created_at, 'product_id', m.product_id, 'product_name', p.name,
               'kind', m.kind, 'qty_change', m.qty_change, 'value_change', m.value_change,
               'stock_after', m.stock_after, 'value_after', m.value_after, 'ref_id', m.ref_id, 'note', m.note,
               'by', coalesce(nullif(pr.full_name, ''), pr.username),
               'purchase_voided', case when m.kind in ('purchase', 'opening')
                                       then (select pu.voided_at is not null from public.purchases pu where pu.id = m.ref_id) end,
               'supplier', case when m.kind in ('purchase', 'opening')
                                then (select pu.supplier from public.purchases pu where pu.id = m.ref_id) end
             ) as j
        from public.stock_movements m
        join public.products p on p.id = m.product_id
        left join public.profiles pr on pr.id = m.created_by
       where m.created_at >= v_b[1] and m.created_at < v_b[2]
         and (p_product_id is null or m.product_id = p_product_id)
         and (p_kind is null or m.kind = p_kind)
       order by m.id desc
       limit p_limit offset p_offset
    ) t;
  return jsonb_build_object('rows', v_rows, 'count', v_count);
end $$;

-- ---------------------------------------------------------------------
-- 6. Selling and returns (cashier + admin)
-- ---------------------------------------------------------------------

-- p_items: [{"product_id": 5, "qty": 2}, ...]. Prices and costs come from the
-- database, never from the browser. p_client_id makes a retry safe: the same
-- id returns the receipt that was already saved instead of selling twice.
create or replace function public.create_sale(
  p_items jsonb, p_discount bigint default 0, p_note text default null, p_client_id uuid default null
) returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_uid       uuid := auth.uid();
  v_role      text;
  v_set       public.shop_settings;
  v_ids       bigint[];
  v_qtys      integer[];
  v_n         integer;
  v_i         integer;
  v_p         public.products;
  v_names     text[]    := '{}';
  v_prices    bigint[]  := '{}';
  v_stocks    integer[] := '{}';
  v_values    bigint[]  := '{}';
  v_subtotal  bigint    := 0;
  v_discount  bigint    := coalesce(p_discount, 0);
  v_max_disc  bigint;
  v_sale_id   bigint;
  v_cum_gross bigint    := 0;
  v_cum_disc  bigint;
  v_prev_disc bigint    := 0;
  v_gross     bigint;
  v_line_disc bigint;
  v_cost      bigint;
  v_cost_sum  bigint    := 0;
  v_new       public.products;
begin
  v_role := public._need_staff();

  if p_client_id is not null then
    select s.id into v_sale_id from public.sales s where s.client_id = p_client_id;
    if found then
      return public._sale_json(v_sale_id, v_role);
    end if;
  end if;

  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'EMPTY_CART';
  end if;
  if jsonb_array_length(p_items) > 300 then
    raise exception 'TOO_MANY_LINES';
  end if;

  -- merge duplicate products, keep the cart order
  select array_agg(t.pid order by t.ord), array_agg(t.qty order by t.ord)
    into v_ids, v_qtys
    from (
      select (e.value ->> 'product_id')::bigint as pid,
             sum((e.value ->> 'qty')::integer)  as qty,
             min(e.ord)                         as ord
        from jsonb_array_elements(p_items) with ordinality as e(value, ord)
       group by 1
    ) t;
  v_n := coalesce(array_length(v_ids, 1), 0);
  if v_n = 0 or exists (select 1 from unnest(v_ids) x where x is null)
     or exists (select 1 from unnest(v_qtys) q where q is null or q < 1 or q > 100000) then
    raise exception 'BAD_ITEMS';
  end if;

  -- lock the products in a fixed order so two cashiers can never deadlock
  perform 1 from public.products where id = any (v_ids) order by id for update;

  for v_i in 1 .. v_n loop
    select * into v_p from public.products where id = v_ids[v_i];
    if not found or not v_p.active then
      raise exception 'PRODUCT_UNAVAILABLE' using detail = jsonb_build_object('product_id', v_ids[v_i])::text;
    end if;
    if v_p.stock < v_qtys[v_i] then
      raise exception 'STOCK_INSUFFICIENT'
        using detail = jsonb_build_object('product_id', v_p.id, 'name', v_p.name,
                                          'available', v_p.stock, 'requested', v_qtys[v_i])::text;
    end if;
    v_names[v_i]  := v_p.name;
    v_prices[v_i] := v_p.price;
    v_stocks[v_i] := v_p.stock;
    v_values[v_i] := v_p.stock_value;
    v_subtotal    := v_subtotal + v_p.price * v_qtys[v_i];
  end loop;

  if v_discount < 0 then raise exception 'DISCOUNT_INVALID'; end if;
  if v_discount > v_subtotal then raise exception 'DISCOUNT_TOO_HIGH'; end if;
  if v_role = 'cashier' and v_discount > 0 then
    select * into v_set from public.shop_settings where id = 1;
    v_max_disc := floor(v_subtotal::numeric * v_set.cashier_max_discount_pct / 100)::bigint;
    if v_discount > v_max_disc then
      raise exception 'DISCOUNT_NOT_ALLOWED'
        using detail = jsonb_build_object('max', v_max_disc, 'pct', v_set.cashier_max_discount_pct)::text;
    end if;
  end if;

  insert into public.sales (cashier_id, subtotal, discount, total, cost_total, note, client_id)
  values (v_uid, v_subtotal, v_discount, v_subtotal - v_discount, 0,
          left(nullif(btrim(p_note), ''), 500), p_client_id)
  returning id into v_sale_id;

  for v_i in 1 .. v_n loop
    v_gross     := v_prices[v_i] * v_qtys[v_i];
    v_cum_gross := v_cum_gross + v_gross;
    -- discount is shared between the lines in proportion; the shares add up exactly
    v_cum_disc  := case when v_subtotal = 0 then 0
                        else floor(v_discount::numeric * v_cum_gross / v_subtotal)::bigint end;
    v_line_disc := v_cum_disc - v_prev_disc;
    v_prev_disc := v_cum_disc;

    -- cost of the units sold = their share of the value of the stock
    -- (the last units on the shelf take whatever value is left, so nothing is lost to rounding)
    if v_qtys[v_i] >= v_stocks[v_i] then
      v_cost := v_values[v_i];
    else
      v_cost := least(round(v_values[v_i]::numeric * v_qtys[v_i] / v_stocks[v_i])::bigint, v_values[v_i]);
    end if;

    update public.products
       set stock = stock - v_qtys[v_i], stock_value = stock_value - v_cost, updated_at = now()
     where id = v_ids[v_i]
    returning * into v_new;

    insert into public.sale_items (sale_id, product_id, product_name, qty, unit_price, line_total,
                                   line_discount, line_net, cost_total)
    values (v_sale_id, v_ids[v_i], v_names[v_i], v_qtys[v_i], v_prices[v_i], v_gross,
            v_line_disc, v_gross - v_line_disc, v_cost);

    insert into public.stock_movements (product_id, kind, qty_change, value_change, stock_after, value_after, ref_id, created_by)
    values (v_ids[v_i], 'sale', -v_qtys[v_i], -v_cost, v_new.stock, v_new.stock_value, v_sale_id, v_uid);

    v_cost_sum := v_cost_sum + v_cost;
  end loop;

  update public.sales set cost_total = v_cost_sum where id = v_sale_id;
  return public._sale_json(v_sale_id, v_role);
end $$;

create or replace function public.get_sale(p_sale_id bigint) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp
as $$
declare
  v_role  text := public._need_staff();
  v_sale  public.sales;
  v_set   public.shop_settings;
  v_day   date;
begin
  select * into v_sale from public.sales where id = p_sale_id;
  if not found then raise exception 'SALE_NOT_FOUND'; end if;
  if v_role = 'cashier' then
    select * into v_set from public.shop_settings where id = 1;
    v_day := (v_sale.created_at at time zone 'Asia/Baghdad')::date;
    if not (v_sale.cashier_id = auth.uid() and v_day = public._today()) then
      if not v_set.cashier_can_return or v_day < public._today() - v_set.return_window_days then
        raise exception 'NOT_AUTHORIZED' using errcode = 'PT403';
      end if;
    end if;
  end if;
  return public._sale_json(v_sale.id, v_role);
end $$;

create or replace function public.list_sales(
  p_from date, p_to date, p_cashier uuid default null, p_search text default null,
  p_limit integer default 100, p_offset integer default 0
) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp
as $$
declare
  v_role   text := public._need_staff();
  v_b      timestamptz[];
  v_search text  := nullif(btrim(coalesce(p_search, '')), '');
  v_like   text;
  v_sid    bigint;
  v_rows   jsonb;
  v_count  bigint;
begin
  if v_role = 'cashier' then
    -- a cashier only ever sees the receipts he made today
    v_b := public._bounds(public._today(), public._today());
    p_cashier := auth.uid();
  else
    v_b := public._bounds(p_from, p_to);
  end if;
  p_limit  := least(greatest(coalesce(p_limit, 100), 1), 500);
  p_offset := greatest(coalesce(p_offset, 0), 0);
  if v_search is not null then
    v_like := '%' || regexp_replace(v_search, '([\\%_])', '\\\1', 'g') || '%';
    if v_search ~ '^#?[0-9]{1,15}$' then
      v_sid := regexp_replace(v_search, '^#', '')::bigint;
    end if;
  end if;

  select count(*) into v_count
    from public.sales s
   where s.created_at >= v_b[1] and s.created_at < v_b[2]
     and (p_cashier is null or s.cashier_id = p_cashier)
     and (v_search is null or s.id = v_sid
          or exists (select 1 from public.sale_items i where i.sale_id = s.id and i.product_name ilike v_like));

  select coalesce(jsonb_agg(t.j order by t.created_at desc, t.id desc), '[]'::jsonb) into v_rows
    from (
      select s.id, s.created_at,
             jsonb_build_object(
               'id', s.id, 'created_at', s.created_at, 'cashier_id', s.cashier_id,
               'cashier_name', coalesce(nullif(pr.full_name, ''), pr.username),
               'qty',   (select coalesce(sum(i.qty), 0) from public.sale_items i where i.sale_id = s.id),
               'lines', (select count(*) from public.sale_items i where i.sale_id = s.id),
               'subtotal', s.subtotal, 'discount', s.discount, 'total', s.total,
               'refunded', coalesce((select sum(r.refund) from public.sale_returns r where r.sale_id = s.id), 0),
               'cost_total', case when v_role = 'admin' then s.cost_total end,
               'cost_back',  case when v_role = 'admin'
                                  then coalesce((select sum(r.cost_back) from public.sale_returns r where r.sale_id = s.id), 0) end,
               'note', s.note
             ) as j
        from public.sales s
        join public.profiles pr on pr.id = s.cashier_id
       where s.created_at >= v_b[1] and s.created_at < v_b[2]
         and (p_cashier is null or s.cashier_id = p_cashier)
         and (v_search is null or s.id = v_sid
              or exists (select 1 from public.sale_items i where i.sale_id = s.id and i.product_name ilike v_like))
       order by s.created_at desc, s.id desc
       limit p_limit offset p_offset
    ) t;
  return jsonb_build_object('rows', v_rows, 'count', v_count);
end $$;

-- take back p_qty units of one receipt line. The refund is the customer's real
-- price for those units (after any discount); the cost goes back into stock
-- only when p_restock is true (false = damaged, written off).
create or replace function public.process_return(
  p_sale_item_id bigint, p_qty integer, p_reason text,
  p_restock boolean default true, p_client_id uuid default null
) returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_uid      uuid := auth.uid();
  v_role     text;
  v_set      public.shop_settings;
  v_item     public.sale_items;
  v_sale     public.sales;
  v_p        public.products;
  v_reason   text := btrim(coalesce(p_reason, ''));
  v_restock  boolean := coalesce(p_restock, true);
  v_after    integer;
  v_refund   bigint;
  v_share    bigint;
  v_cost_back bigint;
  v_ret_id   bigint;
  v_new      public.products;
  v_prev_sale bigint;
begin
  v_role := public._need_staff();

  if p_client_id is not null then
    select r.sale_id into v_prev_sale from public.sale_returns r where r.client_id = p_client_id;
    if found then
      return public._sale_json(v_prev_sale, v_role);
    end if;
  end if;

  if v_reason = '' then raise exception 'REASON_REQUIRED'; end if;

  select * into v_item from public.sale_items where id = p_sale_item_id for update;
  if not found then raise exception 'ITEM_NOT_FOUND'; end if;
  select * into v_sale from public.sales where id = v_item.sale_id;

  if v_role = 'cashier' then
    select * into v_set from public.shop_settings where id = 1;
    if not v_set.cashier_can_return then
      raise exception 'RETURNS_DISABLED' using errcode = 'PT403';
    end if;
    if (v_sale.created_at at time zone 'Asia/Baghdad')::date < public._today() - v_set.return_window_days then
      raise exception 'RETURN_WINDOW_EXPIRED' using detail = jsonb_build_object('days', v_set.return_window_days)::text;
    end if;
  end if;

  if p_qty is null or p_qty < 1 or p_qty > v_item.qty - v_item.returned_qty then
    raise exception 'RETURN_QTY_INVALID' using detail = jsonb_build_object('max', v_item.qty - v_item.returned_qty)::text;
  end if;

  -- cumulative shares: the pieces always add up to exactly the line total
  v_after  := v_item.returned_qty + p_qty;
  v_refund := public._prorate(v_item.line_net, v_after, v_item.qty)
            - public._prorate(v_item.line_net, v_item.returned_qty, v_item.qty);
  v_share  := public._prorate(v_item.cost_total, v_after, v_item.qty)
            - public._prorate(v_item.cost_total, v_item.returned_qty, v_item.qty);
  v_cost_back := case when v_restock then v_share else 0 end;

  select * into v_p from public.products where id = v_item.product_id for update;

  update public.sale_items
     set returned_qty = v_after, refunded = refunded + v_refund, cost_returned = cost_returned + v_cost_back
   where id = v_item.id;

  insert into public.sale_returns (sale_id, sale_item_id, product_id, qty, refund, cost_back, restocked, reason, created_by, client_id)
  values (v_item.sale_id, v_item.id, v_item.product_id, p_qty, v_refund, v_cost_back, v_restock,
          left(v_reason, 300), v_uid, p_client_id)
  returning id into v_ret_id;

  if v_restock then
    update public.products
       set stock = stock + p_qty, stock_value = stock_value + v_cost_back, updated_at = now()
     where id = v_p.id
    returning * into v_new;
    insert into public.stock_movements (product_id, kind, qty_change, value_change, stock_after, value_after, ref_id, note, created_by)
    values (v_p.id, 'return', p_qty, v_cost_back, v_new.stock, v_new.stock_value, v_ret_id, left(v_reason, 300), v_uid);
  else
    insert into public.stock_movements (product_id, kind, qty_change, value_change, stock_after, value_after, ref_id, note, created_by)
    values (v_p.id, 'return_loss', 0, 0, v_p.stock, v_p.stock_value, v_ret_id, left(v_reason, 300), v_uid);
  end if;

  return public._sale_json(v_item.sale_id, v_role);
end $$;

create or replace function public.list_returns(p_from date, p_to date) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp
as $$
declare v_b timestamptz[];
begin
  perform public._need_admin();
  v_b := public._bounds(p_from, p_to);
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', r.id, 'created_at', r.created_at, 'sale_id', r.sale_id,
             'product_name', i.product_name, 'qty', r.qty, 'refund', r.refund, 'cost_back', r.cost_back,
             'restocked', r.restocked, 'reason', r.reason,
             'by', coalesce(nullif(pr.full_name, ''), pr.username)
           ) order by r.id desc)
      from public.sale_returns r
      join public.sale_items i on i.id = r.sale_item_id
      join public.profiles pr on pr.id = r.created_by
     where r.created_at >= v_b[1] and r.created_at < v_b[2]), '[]'::jsonb);
end $$;

-- ---------------------------------------------------------------------
-- 7. Reports (admin).  Sales count on the day they were made; refunds on the
--    day they were paid back, so every figure matches the cash drawer.
-- ---------------------------------------------------------------------

create or replace function public.report_summary(p_from date, p_to date) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp
as $$
declare
  v_b  timestamptz[];
  v_s  record;
  v_r  record;
  v_pu bigint;
  v_st record;
begin
  perform public._need_admin();
  v_b := public._bounds(p_from, p_to);
  select count(*) as receipts, coalesce(sum(s.subtotal), 0) as gross, coalesce(sum(s.discount), 0) as discount,
         coalesce(sum(s.total), 0) as sales_net, coalesce(sum(s.cost_total), 0) as cogs,
         coalesce(sum((select sum(i.qty) from public.sale_items i where i.sale_id = s.id)), 0) as items
    into v_s
    from public.sales s where s.created_at >= v_b[1] and s.created_at < v_b[2];
  select count(*) as refund_count, coalesce(sum(r.refund), 0) as refunds, coalesce(sum(r.cost_back), 0) as cost_back,
         coalesce(sum(r.qty), 0) as qty
    into v_r
    from public.sale_returns r where r.created_at >= v_b[1] and r.created_at < v_b[2];
  select coalesce(sum(pu.total_cost), 0) into v_pu
    from public.purchases pu
   where pu.created_at >= v_b[1] and pu.created_at < v_b[2] and pu.voided_at is null;
  select coalesce(sum(p.stock_value), 0) as stock_value, coalesce(sum(p.stock), 0) as stock_units,
         count(*) filter (where p.active) as products_active,
         count(*) filter (where p.active and p.stock = 0) as out_of_stock,
         count(*) filter (where p.active and p.stock > 0 and p.stock <= p.min_stock) as low_stock
    into v_st
    from public.products p;
  return jsonb_build_object(
    'receipts', v_s.receipts, 'items', v_s.items,
    'gross', v_s.gross, 'discount', v_s.discount, 'sales_net', v_s.sales_net,
    'refund_count', v_r.refund_count, 'refund_qty', v_r.qty, 'refunds', v_r.refunds,
    'revenue', v_s.sales_net - v_r.refunds,
    'cogs', v_s.cogs, 'cost_back', v_r.cost_back,
    'cost', v_s.cogs - v_r.cost_back,
    'profit', (v_s.sales_net - v_r.refunds) - (v_s.cogs - v_r.cost_back),
    'purchases_spent', v_pu,
    'stock_value', v_st.stock_value, 'stock_units', v_st.stock_units,
    'products_active', v_st.products_active, 'out_of_stock', v_st.out_of_stock, 'low_stock', v_st.low_stock
  );
end $$;

create or replace function public.report_daily(p_from date, p_to date) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp
as $$
declare v_b timestamptz[];
begin
  perform public._need_admin();
  v_b := public._bounds(p_from, p_to);
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'day', d.day, 'receipts', coalesce(s.receipts, 0), 'items', coalesce(s.items, 0),
             'gross', coalesce(s.gross, 0), 'discount', coalesce(s.discount, 0), 'sales_net', coalesce(s.sales_net, 0),
             'refunds', coalesce(r.refunds, 0),
             'revenue', coalesce(s.sales_net, 0) - coalesce(r.refunds, 0),
             'cost', coalesce(s.cogs, 0) - coalesce(r.cost_back, 0),
             'profit', (coalesce(s.sales_net, 0) - coalesce(r.refunds, 0)) - (coalesce(s.cogs, 0) - coalesce(r.cost_back, 0))
           ) order by d.day)
      from (select (p_from + g)::date as day from generate_series(0, p_to - p_from) g) d
      left join (
        select (s.created_at at time zone 'Asia/Baghdad')::date as day,
               count(*) as receipts, sum(s.subtotal) as gross, sum(s.discount) as discount,
               sum(s.total) as sales_net, sum(s.cost_total) as cogs,
               sum((select sum(i.qty) from public.sale_items i where i.sale_id = s.id)) as items
          from public.sales s where s.created_at >= v_b[1] and s.created_at < v_b[2]
         group by 1) s on s.day = d.day
      left join (
        select (r.created_at at time zone 'Asia/Baghdad')::date as day,
               sum(r.refund) as refunds, sum(r.cost_back) as cost_back
          from public.sale_returns r where r.created_at >= v_b[1] and r.created_at < v_b[2]
         group by 1) r on r.day = d.day
  ), '[]'::jsonb);
end $$;

create or replace function public.report_products(p_from date, p_to date) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp
as $$
declare v_b timestamptz[];
begin
  perform public._need_admin();
  v_b := public._bounds(p_from, p_to);
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', p.id, 'name', p.name, 'category', p.category, 'stock', p.stock, 'price', p.price,
             'qty_sold', coalesce(s.qty, 0), 'qty_returned', coalesce(r.qty, 0),
             'net_qty', coalesce(s.qty, 0) - coalesce(r.qty, 0),
             'receipts', coalesce(s.receipts, 0),
             'sales_net', coalesce(s.net, 0), 'refunds', coalesce(r.refunds, 0),
             'revenue', coalesce(s.net, 0) - coalesce(r.refunds, 0),
             'cost', coalesce(s.cogs, 0) - coalesce(r.cost_back, 0),
             'profit', (coalesce(s.net, 0) - coalesce(r.refunds, 0)) - (coalesce(s.cogs, 0) - coalesce(r.cost_back, 0))
           ) order by (coalesce(s.net, 0) - coalesce(r.refunds, 0)) desc, p.name)
      from public.products p
      left join (
        select i.product_id, sum(i.qty) as qty, sum(i.line_net) as net, sum(i.cost_total) as cogs,
               count(distinct i.sale_id) as receipts
          from public.sale_items i join public.sales sa on sa.id = i.sale_id
         where sa.created_at >= v_b[1] and sa.created_at < v_b[2]
         group by i.product_id) s on s.product_id = p.id
      left join (
        select r.product_id, sum(r.qty) as qty, sum(r.refund) as refunds, sum(r.cost_back) as cost_back
          from public.sale_returns r
         where r.created_at >= v_b[1] and r.created_at < v_b[2]
         group by r.product_id) r on r.product_id = p.id
     where s.product_id is not null or r.product_id is not null
  ), '[]'::jsonb);
end $$;

-- products that did NOT sell at all in the period (capital sitting on the shelf)
create or replace function public.report_unsold(p_from date, p_to date) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp
as $$
declare v_b timestamptz[];
begin
  perform public._need_admin();
  v_b := public._bounds(p_from, p_to);
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', p.id, 'name', p.name, 'category', p.category, 'price', p.price,
             'stock', p.stock, 'stock_value', p.stock_value, 'created_at', p.created_at,
             'last_sold_at', ls.last_sold_at, 'last_purchase_at', lp.last_purchase_at
           ) order by p.stock_value desc, p.name)
      from public.products p
      left join lateral (
        select max(sa.created_at) as last_sold_at
          from public.sale_items i join public.sales sa on sa.id = i.sale_id
         where i.product_id = p.id) ls on true
      left join lateral (
        select max(pu.created_at) as last_purchase_at
          from public.purchases pu where pu.product_id = p.id and pu.voided_at is null) lp on true
     where p.active
       and not exists (
         select 1 from public.sale_items i join public.sales sa on sa.id = i.sale_id
          where i.product_id = p.id and sa.created_at >= v_b[1] and sa.created_at < v_b[2])
  ), '[]'::jsonb);
end $$;

create or replace function public.report_cashiers(p_from date, p_to date) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp
as $$
declare v_b timestamptz[];
begin
  perform public._need_admin();
  v_b := public._bounds(p_from, p_to);
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', pr.id, 'name', coalesce(nullif(pr.full_name, ''), pr.username), 'role', pr.role,
             'receipts', coalesce(s.receipts, 0), 'sales_net', coalesce(s.net, 0), 'discount', coalesce(s.discount, 0),
             'returns', coalesce(r.cnt, 0), 'refunds', coalesce(r.refunds, 0)
           ) order by coalesce(s.net, 0) desc, pr.created_at)
      from public.profiles pr
      left join (
        select sa.cashier_id, count(*) as receipts, sum(sa.total) as net, sum(sa.discount) as discount
          from public.sales sa where sa.created_at >= v_b[1] and sa.created_at < v_b[2]
         group by sa.cashier_id) s on s.cashier_id = pr.id
      left join (
        select r.created_by, count(*) as cnt, sum(r.refund) as refunds
          from public.sale_returns r where r.created_at >= v_b[1] and r.created_at < v_b[2]
         group by r.created_by) r on r.created_by = pr.id
     where s.cashier_id is not null or r.created_by is not null
  ), '[]'::jsonb);
end $$;

-- ---------------------------------------------------------------------
-- 8. Staff (admin)
-- ---------------------------------------------------------------------

create or replace function public.list_staff() returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp
as $$
begin
  perform public._need_admin();
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', p.id, 'username', p.username, 'full_name', p.full_name, 'role', p.role,
             'active', p.active, 'created_at', p.created_at, 'approved_at', p.approved_at,
             'last_sign_in_at', u.last_sign_in_at,
             'sales_count', (select count(*) from public.sales s where s.cashier_id = p.id)
           ) order by p.created_at)
      from public.profiles p left join auth.users u on u.id = p.id), '[]'::jsonb);
end $$;

create or replace function public.update_staff(p_id uuid, p_full_name text, p_role text, p_active boolean) returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_cur public.profiles;
begin
  perform public._need_admin();
  select * into v_cur from public.profiles where id = p_id for update;
  if not found then raise exception 'STAFF_NOT_FOUND'; end if;
  if p_role not in ('admin', 'cashier') then raise exception 'ROLE_INVALID'; end if;
  if p_id = auth.uid() and (p_role <> 'admin' or p_active is not true) then
    raise exception 'CANNOT_CHANGE_SELF';
  end if;
  update public.profiles
     set full_name = left(coalesce(nullif(btrim(p_full_name), ''), username), 80),
         role = p_role, active = coalesce(p_active, false),
         approved_at = case when coalesce(p_active, false) then coalesce(approved_at, now()) else approved_at end
   where id = p_id;
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.delete_staff(p_id uuid) returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $$
begin
  perform public._need_admin();
  if p_id = auth.uid() then raise exception 'CANNOT_CHANGE_SELF'; end if;
  begin
    delete from auth.users where id = p_id;
  exception when foreign_key_violation then
    raise exception 'STAFF_HAS_HISTORY';
  end;
  if not found then raise exception 'STAFF_NOT_FOUND'; end if;
  return jsonb_build_object('ok', true);
end $$;

-- reset a forgotten password (needs the pgcrypto extension, which Supabase has)
create or replace function public.admin_set_password(p_id uuid, p_password text) returns jsonb
language plpgsql security definer set search_path = public, extensions, pg_temp
as $$
begin
  perform public._need_admin();
  if p_password is null or length(p_password) < 6 or length(p_password) > 72 then
    raise exception 'PASSWORD_INVALID';
  end if;
  update auth.users
     set encrypted_password = extensions.crypt(p_password, extensions.gen_salt('bf')), updated_at = now()
   where id = p_id;
  if not found then raise exception 'STAFF_NOT_FOUND'; end if;
  return jsonb_build_object('ok', true);
end $$;

-- ---------------------------------------------------------------------
-- 9. Who may call what
-- ---------------------------------------------------------------------

do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure as sig
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.prokind = 'f'
  loop
    execute format('revoke all on function %s from public, anon, authenticated', r.sig);
  end loop;
end $$;

grant execute on function public.needs_setup() to anon, authenticated;

grant execute on function
  public.my_profile(), public.get_settings(), public.pos_products(),
  public.create_sale(jsonb, bigint, text, uuid), public.get_sale(bigint),
  public.list_sales(date, date, uuid, text, integer, integer),
  public.process_return(bigint, integer, text, boolean, uuid)
to authenticated;

-- admin-only (each of these also checks the caller's role itself)
grant execute on function
  public.save_settings(jsonb), public.admin_products(), public.save_product(jsonb),
  public.set_product_active(bigint, boolean), public.delete_product(bigint),
  public.add_stock(bigint, integer, bigint, text, text, uuid),
  public.adjust_stock(bigint, integer, text), public.void_purchase(bigint),
  public.list_movements(date, date, bigint, text, integer, integer),
  public.list_returns(date, date),
  public.report_summary(date, date), public.report_daily(date, date),
  public.report_products(date, date), public.report_unsold(date, date),
  public.report_cashiers(date, date),
  public.list_staff(), public.update_staff(uuid, text, text, boolean),
  public.delete_staff(uuid), public.admin_set_password(uuid, text)
to authenticated;

-- ---------------------------------------------------------------------
-- 10. If the project already had users before this file ran, make the oldest
--     one the admin so nobody is locked out.
-- ---------------------------------------------------------------------

do $$
begin
  if not exists (select 1 from public.profiles) and exists (select 1 from auth.users) then
    insert into public.profiles (id, username, full_name, role, active, approved_at)
    select u.id,
           case when row_number() over (partition by lower(split_part(coalesce(u.email, u.id::text), '@', 1)) order by u.created_at) = 1
                then lower(split_part(coalesce(u.email, u.id::text), '@', 1))
                else lower(split_part(coalesce(u.email, u.id::text), '@', 1)) || '_' || substr(u.id::text, 1, 4) end,
           coalesce(nullif(btrim(u.raw_user_meta_data ->> 'full_name'), ''), split_part(coalesce(u.email, u.id::text), '@', 1)),
           case when u.created_at = (select min(created_at) from auth.users) then 'admin' else 'cashier' end,
           u.created_at = (select min(created_at) from auth.users),
           case when u.created_at = (select min(created_at) from auth.users) then now() end
      from auth.users u
     order by u.created_at
    on conflict do nothing;
  end if;
end $$;

notify pgrst, 'reload schema';
