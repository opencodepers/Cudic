-- Cosmetics shop: things you buy with coins and wear on your profile.
--
-- The catalogue itself lives in server.js (COSMETICS) — prices and labels
-- must be server-authoritative, so there is no catalogue table to drift.
-- This table only records who owns what; equipping is the existing
-- users.equips jsonb, extended with the new single-value slots:
--   fr frame · bn banner · ef profile effect · ne name effect
--   ti title  · em emoji pack
-- Award badges/flairs/titles still use the b/f/t arrays, untouched.
--
-- RLS closed: written only through server.js with the service key, same as
-- coin_ledger and game_scores.

create table if not exists public.user_cosmetics (
  user_id uuid not null,
  code text not null,
  bought_at timestamptz default now()
);
alter table public.user_cosmetics enable row level security;

do $$ begin
  alter table public.user_cosmetics add constraint user_cosmetics_pkey primary key (user_id, code);
exception when duplicate_object then null; end $$;

do $$ begin
  alter table public.user_cosmetics add constraint user_cosmetics_user_fk
    foreign key (user_id) references public.users(id) on delete cascade;
exception when duplicate_object then null; end $$;

create index if not exists user_cosmetics_user_idx on public.user_cosmetics (user_id);
