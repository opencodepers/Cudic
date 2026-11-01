-- game_scores — one best score per (game, player) for game leaderboards.
-- Reads and writes go through server.js with the service key; RLS stays
-- closed (no PostgREST path) like the hardened notifications table.

create table if not exists public.game_scores (
  game_id uuid not null,
  user_id uuid not null,
  score integer not null,
  updated_at timestamptz not null default now()
);
alter table public.game_scores enable row level security;

do $$ begin
  alter table public.game_scores add constraint game_scores_pkey primary key (game_id, user_id);
exception when duplicate_object then null; end $$;

do $$ begin
  alter table public.game_scores add constraint game_scores_game_id_fkey
    foreign key (game_id) references public.games(id) on delete cascade;
exception when duplicate_object then null; end $$;

do $$ begin
  alter table public.game_scores add constraint game_scores_user_id_fkey
    foreign key (user_id) references public.users(id) on delete cascade;
exception when duplicate_object then null; end $$;

create index if not exists game_scores_top_idx on public.game_scores (game_id, score desc);
