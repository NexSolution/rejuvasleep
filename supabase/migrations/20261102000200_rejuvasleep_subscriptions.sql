-- Monthly subscriptions: access lasts until paid_until (a few days past the next billing date)
alter table public.memberships
  add column if not exists subscription_id text,
  add column if not exists status text not null default 'active',
  add column if not exists paid_until timestamptz;

create unique index if not exists memberships_subscription_id_key
  on public.memberships (subscription_id) where subscription_id is not null;

create or replace function public.is_member()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.memberships
    where lower(email) = lower(auth.jwt() ->> 'email')
      and (plan = 'lifetime' or paid_until > now())
  );
$$;
