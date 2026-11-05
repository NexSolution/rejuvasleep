-- Settings, pausing and cancelling

alter table public.profiles
  add column if not exists last_name text,
  add column if not exists bed_time time;

alter table public.memberships
  add column if not exists next_billing_at timestamptz,
  add column if not exists cancelled_at timestamptz;

-- Days off: plan days don't count between start_date (inclusive) and end_date (exclusive).
-- end_date null = open-ended (a cancelled plan, or a pause the member will end by hand).
create table if not exists public.pauses (
  id bigint generated always as identity primary key,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  start_date date not null,
  end_date date,
  kind text not null default 'pause' check (kind in ('pause','stop')),
  created_at timestamptz not null default now(),
  check (end_date is null or end_date > start_date)
);
alter table public.pauses enable row level security;
drop policy if exists "own rows" on public.pauses;
create policy "own rows" on public.pauses for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Access: active, paying (or lifetime) and not cancelled / ended
create or replace function public.is_member()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.memberships
    where lower(email) = lower(auth.jwt() ->> 'email')
      and status not in ('cancelled','suspended','expired','refunded')
      and (plan = 'lifetime' or paid_until > now())
  );
$$;
revoke execute on function public.is_member() from public, anon;
grant execute on function public.is_member() to authenticated;

-- Members can always see their history, but only add new entries while their plan is active
do $$
declare t text;
begin
  foreach t in array array['sleep_logs','water_logs','ritual_logs','routine_checks'] loop
    execute format('drop policy if exists "own rows" on public.%I', t);
    execute format('drop policy if exists "read own" on public.%I', t);
    execute format('drop policy if exists "write while active" on public.%I', t);
    execute format('drop policy if exists "update while active" on public.%I', t);
    execute format('drop policy if exists "delete own" on public.%I', t);
    execute format('create policy "read own" on public.%I for select using (user_id = auth.uid())', t);
    execute format('create policy "write while active" on public.%I for insert with check (user_id = auth.uid() and public.is_member())', t);
    execute format('create policy "update while active" on public.%I for update using (user_id = auth.uid() and public.is_member()) with check (user_id = auth.uid())', t);
    execute format('create policy "delete own" on public.%I for delete using (user_id = auth.uid() and public.is_member())', t);
  end loop;
end $$;

-- Keep the membership attached when someone changes their login email
create or replace function public.sync_membership_email()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.email is distinct from old.email and old.email is not null and new.email is not null then
    update public.memberships set email = lower(new.email) where lower(email) = lower(old.email);
  end if;
  return new;
end $$;
revoke execute on function public.sync_membership_email() from public, anon, authenticated;

drop trigger if exists on_auth_user_email_changed on auth.users;
create trigger on_auth_user_email_changed
  after update of email on auth.users
  for each row execute function public.sync_membership_email();
