-- file: 20261115190000_community_pack.sql
-- what: member identity (nickname, status, title, intro card, tags), anniversaries
--   via membership rows, spotlights, daily/weekly prompts, suggestions + votes,
--   LFG posts, game nights/public events, warnings, favourites, channel labels.
-- invariants: additive only; every table cascades from its server or user; RLS on
--   with no public policies, so only the service role (the API) reads them.

alter table public.lobbies
  add column if not exists labels text[] not null default '{}';

create table if not exists public.server_member_profiles (
  server_id uuid not null references public.servers(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  nickname text not null default '',
  status text not null default '',
  title text not null default '',
  intro text not null default '',
  intro_tags text[] not null default '{}',
  updated_at timestamptz not null default now(),
  primary key (server_id, user_id)
);

create table if not exists public.server_prompts (
  id uuid not null default gen_random_uuid() primary key,
  server_id uuid not null references public.servers(id) on delete cascade,
  kind text not null,
  body text not null,
  active_on date not null,
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (server_id, kind, active_on)
);

create table if not exists public.server_suggestions (
  id uuid not null default gen_random_uuid() primary key,
  server_id uuid not null references public.servers(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  title text not null,
  body text not null default '',
  status text not null default 'open',
  created_at timestamptz not null default now()
);
create index if not exists server_suggestions_server_idx
  on public.server_suggestions (server_id, created_at desc);

create table if not exists public.server_suggestion_votes (
  suggestion_id uuid not null references public.server_suggestions(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (suggestion_id, user_id)
);

create table if not exists public.server_lfg (
  id uuid not null default gen_random_uuid() primary key,
  server_id uuid not null references public.servers(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  game text not null,
  note text not null default '',
  slots integer not null default 2,
  starts_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists server_lfg_server_idx
  on public.server_lfg (server_id, created_at desc);

create table if not exists public.server_nights (
  id uuid not null default gen_random_uuid() primary key,
  server_id uuid not null references public.servers(id) on delete cascade,
  created_by uuid references public.users(id) on delete set null,
  title text not null,
  game text not null default '',
  note text not null default '',
  starts_at timestamptz not null,
  is_public boolean not null default true,
  created_at timestamptz not null default now()
);
create index if not exists server_nights_server_idx
  on public.server_nights (server_id, starts_at);

create table if not exists public.server_warnings (
  id uuid not null default gen_random_uuid() primary key,
  server_id uuid not null references public.servers(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  issued_by uuid references public.users(id) on delete set null,
  reason text not null,
  acknowledged_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists server_warnings_user_idx
  on public.server_warnings (server_id, user_id, created_at desc);

create table if not exists public.server_favourites (
  user_id uuid not null references public.users(id) on delete cascade,
  server_id uuid not null references public.servers(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, server_id)
);

create table if not exists public.server_spotlights (
  id uuid not null default gen_random_uuid() primary key,
  server_id uuid not null references public.servers(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  blurb text not null default '',
  active boolean not null default true,
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists server_spotlights_server_idx
  on public.server_spotlights (server_id, active, created_at desc);

alter table public.server_member_profiles enable row level security;
alter table public.server_prompts enable row level security;
alter table public.server_suggestions enable row level security;
alter table public.server_suggestion_votes enable row level security;
alter table public.server_lfg enable row level security;
alter table public.server_nights enable row level security;
alter table public.server_warnings enable row level security;
alter table public.server_favourites enable row level security;
alter table public.server_spotlights enable row level security;
