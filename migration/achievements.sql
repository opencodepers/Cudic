-- game_achievements — server-verified unlock records for the in-game
-- achievement shim (cudic-ach.js). Games call CudicAch.unlock('speedrun');
-- the request goes game frame -> view.html -> POST /api/games/:id/achievements
-- with the viewer's own session, same sandbox shape as scores and saves.
create table if not exists public.game_achievements (
  game_id uuid not null,
  user_id uuid not null,
  code text not null,
  awarded_at timestamptz default now(),
  primary key (game_id, user_id, code)
);
alter table public.game_achievements enable row level security;
-- Unlocks are written only through server.js (view.html mediates with the
-- viewer's session), so no RLS policies: same shape as game_scores —
-- the table is only reachable from the backend.
create index if not exists game_achievements_game_idx on public.game_achievements (game_id, code);
create index if not exists game_achievements_user_idx on public.game_achievements (user_id);
