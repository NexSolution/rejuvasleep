-- RejuvaSleep shop: products, orders with tracking, and a private admin area
-- Orders are only created and paid through the shop-checkout edge function (service role),
-- so prices are always worked out on the server.

-- ── Admins ─────────────────────────────────────────────
create table if not exists public.admins (
  email text primary key,
  created_at timestamptz not null default now()
);
alter table public.admins enable row level security;
-- no policies: only the service role and SQL editor can read or change admins

insert into public.admins (email) values ('calisa201@gmail.com'), ('rejuvasleep.help@gmail.com')
on conflict do nothing;

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.admins where lower(email) = lower(auth.jwt() ->> 'email'));
$$;
revoke all on function public.is_admin() from public;
grant execute on function public.is_admin() to anon, authenticated;

-- ── Shop settings (one row) ────────────────────────────
create table if not exists public.shop_settings (
  id int primary key default 1 check (id = 1),
  currency text not null default 'USD',
  shipping_cents int not null default 599 check (shipping_cents >= 0),
  free_over_cents int check (free_over_cents is null or free_over_cents > 0),   -- null = never free
  open boolean not null default true,
  notice text,                                       -- optional banner, e.g. "Holiday delays"
  updated_at timestamptz not null default now()
);
insert into public.shop_settings (id) values (1) on conflict do nothing;
alter table public.shop_settings enable row level security;
drop policy if exists "shop settings readable" on public.shop_settings;
create policy "shop settings readable" on public.shop_settings for select using (true);
drop policy if exists "admins edit shop settings" on public.shop_settings;
create policy "admins edit shop settings" on public.shop_settings for update using (public.is_admin()) with check (public.is_admin());

-- ── Products ───────────────────────────────────────────
create table if not exists public.products (
  id uuid primary key default gen_random_uuid(),
  slug text unique not null check (slug ~ '^[a-z0-9-]+$'),
  name text not null,
  category text not null default 'sleep',            -- sleep | eyes | gua-sha | skin | supplements | other
  summary text not null default '',
  details text not null default '',                  -- plain text, line breaks kept
  price_cents int not null check (price_cents > 0),
  compare_cents int check (compare_cents is null or compare_cents > 0),
  image_url text,
  is_supplement boolean not null default false,      -- shows the supplement notice at checkout
  blocked_countries text[] not null default '{}',    -- ISO country codes this product can't ship to
  active boolean not null default false,             -- hidden until you switch it on
  sort int not null default 100,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.products enable row level security;
drop policy if exists "active products readable" on public.products;
create policy "active products readable" on public.products for select using (active or public.is_admin());
drop policy if exists "admins manage products" on public.products;
create policy "admins manage products" on public.products for all using (public.is_admin()) with check (public.is_admin());

-- Supplier details stay private (never shown to customers)
create table if not exists public.product_suppliers (
  product_id uuid primary key references public.products(id) on delete cascade,
  supplier text,
  supplier_url text,
  cost_cents int,
  notes text
);
alter table public.product_suppliers enable row level security;
drop policy if exists "admins manage suppliers" on public.product_suppliers;
create policy "admins manage suppliers" on public.product_suppliers for all using (public.is_admin()) with check (public.is_admin());

-- ── Orders ─────────────────────────────────────────────
create sequence if not exists public.order_number_seq start 1001;

create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(),
  number int unique not null default nextval('public.order_number_seq'),
  view_token text not null default replace(gen_random_uuid()::text, '-', ''),   -- lets a guest open their own order
  user_id uuid references auth.users(id) on delete set null,
  email text not null,
  status text not null default 'pending'
    check (status in ('pending','paid','ordered','shipped','delivered','cancelled','refunded')),
  items jsonb not null,                -- [{product_id, slug, name, price_cents, qty, image_url}]
  subtotal_cents int not null,
  shipping_cents int not null,
  total_cents int not null,
  currency text not null default 'USD',
  ship_to jsonb not null,              -- {name, phone, line1, line2, city, region, postal, country}
  paypal_order_id text unique,
  paypal_capture_id text unique,
  supplier_ref text,                   -- your order number with the supplier (private)
  carrier text,
  tracking_number text,
  tracking_url text,
  customer_note text,                  -- message the customer sees on their order
  admin_note text,                     -- private note
  created_at timestamptz not null default now(),
  paid_at timestamptz,
  ordered_at timestamptz,
  shipped_at timestamptz,
  delivered_at timestamptz,
  updated_at timestamptz not null default now()
);
create index if not exists orders_user_idx on public.orders (user_id);
create index if not exists orders_email_idx on public.orders (lower(email));
create index if not exists orders_status_idx on public.orders (status, created_at desc);
alter table public.orders enable row level security;

drop policy if exists "customers read own orders" on public.orders;
create policy "customers read own orders" on public.orders for select
  using (status <> 'pending' and (user_id = auth.uid() or lower(email) = lower(auth.jwt() ->> 'email')));
drop policy if exists "admins read orders" on public.orders;
create policy "admins read orders" on public.orders for select using (public.is_admin());
drop policy if exists "admins update orders" on public.orders;
create policy "admins update orders" on public.orders for update using (public.is_admin()) with check (public.is_admin());

-- Customers must never see private columns through the API
revoke select, insert, update, delete on public.orders from anon, authenticated;
grant select (id, number, user_id, email, status, items, subtotal_cents, shipping_cents, total_cents, currency,
  ship_to, carrier, tracking_number, tracking_url, customer_note, created_at, paid_at, ordered_at, shipped_at, delivered_at)
  on public.orders to authenticated;
grant update (status, supplier_ref, carrier, tracking_number, tracking_url, customer_note, admin_note,
  ordered_at, shipped_at, delivered_at, updated_at) on public.orders to authenticated;

-- Admins read everything (including private columns) through this function
create or replace function public.admin_orders(p_status text default null)
returns setof public.orders language sql stable security definer set search_path = public as $$
  select * from public.orders
  where public.is_admin() and status <> 'pending' and (p_status is null or status = p_status)
  order by created_at desc limit 500;
$$;
revoke all on function public.admin_orders(text) from public;
grant execute on function public.admin_orders(text) to authenticated;

-- Stamp the dates when the status moves forward
create or replace function public.orders_touch()
returns trigger language plpgsql set search_path = public as $$
begin
  new.updated_at := now();
  if new.status <> old.status then
    if new.status = 'ordered'   and new.ordered_at   is null then new.ordered_at   := now(); end if;
    if new.status = 'shipped'   and new.shipped_at   is null then new.shipped_at   := now(); end if;
    if new.status = 'delivered' and new.delivered_at is null then new.delivered_at := now(); end if;
  end if;
  return new;
end $$;
drop trigger if exists orders_touch on public.orders;
create trigger orders_touch before update on public.orders for each row execute function public.orders_touch();

create or replace function public.products_touch()
returns trigger language plpgsql set search_path = public as $$ begin new.updated_at := now(); return new; end $$;
drop trigger if exists products_touch on public.products;
create trigger products_touch before update on public.products for each row execute function public.products_touch();

-- ── Product photos ─────────────────────────────────────
insert into storage.buckets (id, name, public) values ('products', 'products', true)
on conflict (id) do update set public = true;
drop policy if exists "admins upload product photos" on storage.objects;
create policy "admins upload product photos" on storage.objects for insert to authenticated
  with check (bucket_id = 'products' and public.is_admin());
drop policy if exists "admins change product photos" on storage.objects;
create policy "admins change product photos" on storage.objects for update to authenticated
  using (bucket_id = 'products' and public.is_admin());
drop policy if exists "admins delete product photos" on storage.objects;
create policy "admins delete product photos" on storage.objects for delete to authenticated
  using (bucket_id = 'products' and public.is_admin());

-- ── Draft products (hidden until you add a photo, set the price and switch them on) ──
insert into public.products (slug, name, category, summary, details, price_cents, compare_cents, is_supplement, blocked_countries, sort) values
 ('silk-eye-mask', 'Mulberry silk sleep mask', 'eyes', 'Blocks light completely and glides over skin, so no creases around your eyes.',
  E'100% mulberry silk on both sides\nAdjustable soft strap\nHand wash cold, air dry', 1999, 2999, false, '{}', 10),
 ('silk-pillowcase', 'Mulberry silk pillowcase', 'sleep', 'Less friction on skin and hair, so fewer sleep creases and less frizz.',
  E'22 momme mulberry silk\nHidden zip closure\nStandard / queen size', 3499, 4999, false, '{}', 20),
 ('rose-quartz-gua-sha', 'Rose quartz gua sha', 'gua-sha', 'The stone used in your evening gua sha ritual. Cool, smooth and easy to hold.',
  E'Natural rose quartz\nComes with a pouch\nWash with warm soapy water after use', 1799, 2499, false, '{}', 30),
 ('gua-sha-set', 'Gua sha and face roller set', 'gua-sha', 'A roller for the morning de-puff and a stone for evening gua sha.',
  E'Rose quartz roller and stone\nGift box\nKeep the roller in the fridge for extra cooling', 2999, 3999, false, '{}', 40),
 ('cooling-eye-patches', 'Cooling under-eye patches', 'eyes', 'Chill in the fridge and use with your morning cucumber eye reset.',
  E'30 pairs\nHydrogel patches\nKeep refrigerated after opening', 1499, null, false, '{}', 50),
 ('sleep-patches', 'Natural sleep patches', 'sleep', 'Plant-based patches you put on before bed as part of your wind-down.',
  E'30 patches\nCheck the ingredients list before use', 1999, null, false, '{}', 60),
 ('mouth-tape', 'Gentle sleep mouth tape', 'sleep', 'Encourages nose breathing at night. Not for anyone with a blocked nose or breathing problems.',
  E'60 strips\nSkin-safe adhesive\nDo not use if you have sleep apnea or trouble breathing through your nose', 1299, null, false, '{}', 70),
 ('magnesium-glycinate', 'Magnesium glycinate', 'supplements', 'A popular evening supplement many people take as part of their wind-down.',
  E'Follow the dose on the label\nThese statements have not been evaluated by the FDA. This product is not intended to diagnose, treat, cure or prevent any disease.\nTalk to your doctor before use if you are pregnant, nursing, take medication or have a medical condition.', 2499, null, true, '{}', 80),
 ('melatonin-gummies', 'Melatonin sleep gummies', 'supplements', 'Low-dose melatonin gummies for occasional sleeplessness.',
  E'Follow the dose on the label\nNot for children, or if pregnant or nursing\nThese statements have not been evaluated by the FDA. This product is not intended to diagnose, treat, cure or prevent any disease.\nTalk to your doctor before use if you take medication or have a medical condition.', 1999, null, true,
  -- Melatonin is prescription-only or restricted in these places. Check with your supplier before shipping anywhere new.
  '{GB,IE,AU,NZ,JP,AT,BE,BG,HR,CY,CZ,DK,EE,FI,FR,DE,GR,HU,IT,LV,LT,LU,MT,NL,PL,PT,RO,SK,SI,ES,SE,NO,CH,IS,ZA,SG,HK,CN,KR,AE,SA}', 90)
on conflict (slug) do nothing;
