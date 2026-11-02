-- jam_votes — one vote per player per game per jam week. The weekly build
-- theme doubles as the game jam; votes rank the entries, and the server
-- pays out the top three at the weekly rollover (see server.js settleJam).
create table if not exists public.jam_votes (
  week_start date not null,
  game_id uuid not null,
  user_id uuid not null,
  created_at timestamptz default now(),
  primary key (week_start, game_id, user_id)
);
alter table public.jam_votes enable row level security;
-- Vote / unvote is a toggle through server.js, so no RLS policies: same
-- shape as game_scores — the table is only reachable from the backend.
create index if not exists jam_votes_week_idx on public.jam_votes (week_start, game_id);
