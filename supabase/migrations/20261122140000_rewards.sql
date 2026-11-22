-- Growth rewards, part 1: two small tables the hooks need.
--
-- storage_grants lets a reward other than an invite link raise an account's
-- cap, without turning the cap into a stored balance that can drift. One row
-- per (account, source), so a retried claim inserts nothing the second time.
--
-- daily_plays is the server's own record of which days an account actually
-- played something. The browser-side daily-game streak cannot be trusted for
-- a 100-coin payout; this can, because only the play route writes it.
--
-- Run after 20261122130000_referral_abuse.sql. Additive only.
-- Until this runs the rewards endpoint answers 503 and the quests page simply
-- shows no bonus cards; plays, publishing and every existing quest still work.

create table if not exists public.storage_grants (
  id         bigserial primary key,
  user_id    uuid not null references public.users(id) on delete cascade,
  source     text not null,
  bytes      bigint not null check (bytes > 0 and bytes <= 104857600),
  created_at timestamptz not null default now(),
  unique (user_id, source)
);

create index if not exists storage_grants_user_idx on public.storage_grants (user_id);

create table if not exists public.daily_plays (
  user_id    uuid not null references public.users(id) on delete cascade,
  day        date not null,
  created_at timestamptz not null default now(),
  primary key (user_id, day)
);

create index if not exists daily_plays_day_idx on public.daily_plays (day);

-- Server-only, like the referral tables: these describe one account's rewards.
alter table public.storage_grants enable row level security;
alter table public.daily_plays   enable row level security;
revoke all on public.storage_grants from anon, authenticated;
revoke all on public.daily_plays   from anon, authenticated;
