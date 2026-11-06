-- Content-addressed project history.
--
-- Snapshots used to store a full copy of every file in every revision row and
-- keep only 20 of them, so one-line edits burned a whole slot. Now each unique
-- file body is stored once per game (hash = sha256 prefix) and the revision row
-- keeps a `manifest` of path → hash. Old rows keep `files` and still read fine.
alter table public.project_revisions add column if not exists manifest jsonb;

create table if not exists public.revision_blobs (
  game_id uuid not null references public.games(id) on delete cascade,
  hash text not null,
  content text not null,
  created_at timestamptz not null default now(),
  primary key (game_id, hash)
);

alter table public.revision_blobs enable row level security;
