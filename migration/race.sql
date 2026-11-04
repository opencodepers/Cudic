-- Weekly creator race: one point per unique player per published game per
-- week (Monday 00:00 UTC — same boundary as the jam and the weekly digest).
--
-- race_plays is the raw ledger: the play endpoint inserts one row per
-- counted play. The (week, game_id, viewer) primary key de-dupes replays
-- from the same viewer inside one week — points are UNIQUE PLAYERS, not
-- play events. viewer is a salted hash of the client IP, so it is not
-- personal data. RLS closed, service key only, like game_scores.
--
-- race_weeks is the settlement record: when a week finishes, the server
-- writes its top 3 once (the primary key is the idempotence lock — a row
-- can never be paid twice) then grants coins + Race awards through the
-- normal paths. Sections of past weeks without plays still get a row with
-- an empty array, so a finished week is never re-settled.
--
-- Run in Supabase SQL editor before deploying the race build.

create table if not exists public.race_plays (
  week text not null,
  game_id uuid not null,
  creator_id uuid not null,
  viewer text not null,
  played_at timestamptz default now()
);
alter table public.race_plays enable row level security;

do $$ begin
  alter table public.race_plays add constraint race_plays_pkey
    primary key (week, game_id, viewer);
exception when duplicate_object then null; end $$;

do $$ begin
  alter table public.race_plays add constraint race_plays_game_fk
    foreign key (game_id) references public.games(id) on delete cascade;
exception when duplicate_object then null; end $$;

do $$ begin
  alter table public.race_plays add constraint race_plays_creator_fk
    foreign key (creator_id) references public.users(id) on delete cascade;
exception when duplicate_object then null; end $$;

create index if not exists race_plays_creator_idx on public.race_plays (creator_id, week);

create table if not exists public.race_weeks (
  week text primary key,
  settled_at timestamptz not null default now(),
  top jsonb not null default '[]'::jsonb
);
alter table public.race_weeks enable row level security;

-- Race optional-join reads for profiles can use these; nothing else needed.
create index if not exists race_weeks_recent_idx on public.race_weeks (week desc);
