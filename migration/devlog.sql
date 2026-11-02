-- game_posts — devlog entries for a published game. One game writes in its
-- own voice: GET is public on published games (view.html renders it), POST /
-- DELETE go through server.js with the creator's own session, same sandbox
-- shape as achievements. Bodies are markdown text, capped at 8000 chars and
-- 5 posts per game server-side.
create table if not exists public.game_posts (
  id uuid primary key default gen_random_uuid(),
  game_id uuid not null references public.games(id) on delete cascade,
  body text not null,
  created_at timestamptz default now()
);
alter table public.game_posts enable row level security;
-- Written only through server.js (the page mediates with the creator's
-- session), so no RLS policies: same shape as game_achievements — the
-- table is only reachable from the backend.
create index if not exists game_posts_game_idx on public.game_posts (game_id, created_at);
