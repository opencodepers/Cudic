-- file: 20261115200000_server_batch.sql
-- what: announcement/QA channel types, private channel bookmarks, server polls and
--   votes, answered messages, join questions and answers, game-update feeds,
--   weekly server backups and a featured directory image.
-- invariants: additive only and re-runnable; every table cascades from its server
--   or user, has RLS on with no public policy, and the routes answer 503 rather
--   than writing half a feature before this has run.

alter table public.lobbies
  add column if not exists type text not null default 'chat';
alter table public.messages
  add column if not exists answered_at timestamptz;
alter table public.messages
  add column if not exists answered_by uuid references public.users(id) on delete set null;
alter table public.servers
  add column if not exists join_questions jsonb not null default '[]'::jsonb;
alter table public.servers
  add column if not exists backup_weekly boolean not null default false;

create table if not exists public.channel_bookmarks (
  user_id uuid not null references public.users(id) on delete cascade,
  lobby_id uuid not null references public.lobbies(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, lobby_id)
);
create index if not exists channel_bookmarks_user_idx
  on public.channel_bookmarks (user_id, created_at desc);

create table if not exists public.server_polls (
  id uuid not null default gen_random_uuid() primary key,
  server_id uuid not null references public.servers(id) on delete cascade,
  lobby_id uuid not null references public.lobbies(id) on delete cascade,
  message_id uuid references public.messages(id) on delete set null,
  created_by uuid references public.users(id) on delete set null,
  question text not null,
  options jsonb not null default '[]'::jsonb,
  anonymous boolean not null default false,
  closes_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists server_polls_lobby_idx
  on public.server_polls (lobby_id, created_at desc);

create table if not exists public.server_poll_votes (
  poll_id uuid not null references public.server_polls(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  choice integer not null,
  created_at timestamptz not null default now(),
  primary key (poll_id, user_id)
);

create table if not exists public.server_join_answers (
  server_id uuid not null references public.servers(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  answers jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  primary key (server_id, user_id)
);

create table if not exists public.server_game_feeds (
  id uuid not null default gen_random_uuid() primary key,
  server_id uuid not null references public.servers(id) on delete cascade,
  game_id uuid not null references public.games(id) on delete cascade,
  channel_id uuid not null references public.lobbies(id) on delete cascade,
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (server_id, game_id)
);

create table if not exists public.server_backups (
  id uuid not null default gen_random_uuid() primary key,
  server_id uuid not null references public.servers(id) on delete cascade,
  payload jsonb not null default '{}'::jsonb,
  reason text not null default 'manual',
  created_at timestamptz not null default now()
);
create index if not exists server_backups_server_idx
  on public.server_backups (server_id, created_at desc);

alter table public.channel_bookmarks enable row level security;
alter table public.server_polls enable row level security;
alter table public.server_poll_votes enable row level security;
alter table public.server_join_answers enable row level security;
alter table public.server_game_feeds enable row level security;
alter table public.server_backups enable row level security;
