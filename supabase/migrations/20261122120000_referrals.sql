-- Invite links: a code per account, and one row per account that arrived
-- through one. The bonus is counted from these rows, never stored as a
-- balance, so revoking a row takes the storage back with it.
--
-- Run in the Supabase SQL editor. The server answers 503 referrals_unavailable
-- until this exists, and the profile card stays hidden.

create table if not exists public.referral_codes (
  user_id    uuid primary key references public.users(id) on delete cascade,
  code       text not null unique,
  created_at timestamptz not null default now()
);

create table if not exists public.referrals (
  id         bigserial primary key,
  inviter_id uuid not null references public.users(id) on delete cascade,
  invitee_id uuid not null unique references public.users(id) on delete cascade,
  code       text not null,
  created_at timestamptz not null default now(),
  constraint referrals_no_self check (inviter_id <> invitee_id)
);

create index if not exists referrals_inviter_idx on public.referrals (inviter_id);

-- RLS closed: reached only through server.js with the service key. An open
-- table would let anyone read which account invited which.
alter table public.referral_codes enable row level security;
alter table public.referrals     enable row level security;
revoke all on public.referral_codes from anon, authenticated;
revoke all on public.referrals     from anon, authenticated;
