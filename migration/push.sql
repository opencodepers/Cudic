-- Web push: browser subscriptions + the VAPID keypair.
--
-- The keypair lives in the database (not env) so pushes work on Render
-- without anyone pasting secrets: the first request generates it once and
-- every later boot reads the same pair, which is what keeps existing
-- subscriptions valid across restarts and deploys.
create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  ua text,
  created_at timestamptz not null default now(),
  last_seen timestamptz not null default now()
);
create index if not exists push_subscriptions_user_idx on public.push_subscriptions (user_id);

create table if not exists public.push_config (
  id int primary key default 1,
  public_key text not null,
  private_key text not null,
  created_at timestamptz not null default now()
);
-- Single row, single keypair: nothing may insert a second one.
alter table public.push_config drop constraint if exists push_config_single;
alter table public.push_config add constraint push_config_single check (id = 1);

-- Deny-all for anon/authenticated: only the service role (server.js) reads
-- endpoints and private keys. RLS stays on even though the API bypasses it.
alter table public.push_subscriptions enable row level security;
alter table public.push_config enable row level security;
