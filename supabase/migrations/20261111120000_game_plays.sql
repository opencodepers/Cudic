-- Recently played: one row per (user, game) holding the last time that account
-- opened the game, so the gallery can offer "Continue playing".
-- play_count stays the public counter (guests included, one bump per browser
-- per hour); this table is account-bound and private, and it is what makes the
-- shelf follow the login across devices instead of the browser.
-- No backfill: rows appear as people play.
create table if not exists public.game_plays (
  user_id uuid not null references public.users(id) on delete cascade,
  game_id uuid not null references public.games(id) on delete cascade,
  played_at timestamptz not null default now(),
  primary key (user_id, game_id)
);

-- The shelf asks for one account's rows newest-first, so that is the index.
create index if not exists game_plays_recent_idx
  on public.game_plays (user_id, played_at desc);

alter table public.game_plays enable row level security;
-- Deliberately no policies: every read and write goes through server.js with
-- the service key and its own auth check, exactly like game_saves. A per-user
-- select policy would be the textbook shape, but it would also let a browser
-- read the table directly with an anon token, which is not the path here.
