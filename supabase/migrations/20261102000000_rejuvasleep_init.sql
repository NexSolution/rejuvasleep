-- RejuvaSleep database setup
-- Safe to run more than once.

-- ── Profiles: one row per user ─────────────────────────────
create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  name text,
  quiz jsonb,
  quiz_score int,
  wake_time time not null default '06:30',
  sleep_goal_hours numeric(3,1) not null default 7.5,
  water_goal int not null default 8,
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

drop policy if exists "profiles: read own" on public.profiles;
create policy "profiles: read own" on public.profiles
  for select using (id = auth.uid());

drop policy if exists "profiles: update own" on public.profiles;
create policy "profiles: update own" on public.profiles
  for update using (id = auth.uid()) with check (id = auth.uid());

-- Create a profile automatically when someone signs up
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, name)
  values (new.id, coalesce(new.raw_user_meta_data->>'name', ''))
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ── Memberships: who has paid ──────────────────────────────
-- Keyed by email so you can add a buyer before or after they sign up.
-- Only you (dashboard) or the PayPal webhook can add rows. Users can only read their own.
create table if not exists public.memberships (
  email text primary key,
  plan text not null default 'lifetime',
  source text not null default 'manual',
  paypal_ref text,
  created_at timestamptz not null default now()
);

alter table public.memberships enable row level security;

drop policy if exists "memberships: read own" on public.memberships;
create policy "memberships: read own" on public.memberships
  for select using (lower(email) = lower(auth.jwt() ->> 'email'));

create or replace function public.is_member()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.memberships
    where lower(email) = lower(auth.jwt() ->> 'email')
  );
$$;

-- ── Sleep log: one entry per night ─────────────────────────
create table if not exists public.sleep_logs (
  id bigint generated always as identity primary key,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  log_date date not null,
  bedtime time not null,
  wake_time time not null,
  hours numeric(4,2) not null,
  quality int check (quality between 1 and 5),
  note text,
  created_at timestamptz not null default now(),
  unique (user_id, log_date)
);

-- ── Water log: one entry per day ───────────────────────────
create table if not exists public.water_logs (
  id bigint generated always as identity primary key,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  log_date date not null,
  glasses int not null default 0 check (glasses between 0 and 30),
  coconut int not null default 0 check (coconut between 0 and 10),
  unique (user_id, log_date)
);

-- ── Ritual log: face rituals done each day ─────────────────
create table if not exists public.ritual_logs (
  id bigint generated always as identity primary key,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  log_date date not null,
  ritual text not null,
  unique (user_id, log_date, ritual)
);

-- Same rule for all three logs: you only ever see and change your own rows
do $$
declare t text;
begin
  foreach t in array array['sleep_logs','water_logs','ritual_logs'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists "own rows" on public.%I', t);
    execute format(
      'create policy "own rows" on public.%I for all using (user_id = auth.uid()) with check (user_id = auth.uid())', t);
  end loop;
end $$;
