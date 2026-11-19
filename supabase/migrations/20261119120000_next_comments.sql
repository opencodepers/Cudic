-- file: 20261119120000_next_comments.sql
-- what: feedback comments on the /next product models, one thread per feature.
-- invariants: additive only; reads happen through the API, writes are
--   signed-in and rate-limited there, and RLS stays closed to direct clients.

create table if not exists public.next_comments (
  id uuid primary key default gen_random_uuid(),
  feature_id text not null check (feature_id ~ '^[a-z][a-z0-9-]{0,39}$'),
  author_id uuid not null references public.users(id) on delete cascade,
  body text not null check (char_length(body) between 1 and 600),
  created_at timestamptz not null default now()
);

create index if not exists next_comments_feature_idx
  on public.next_comments (feature_id, created_at desc);

create index if not exists next_comments_author_idx
  on public.next_comments (author_id, created_at desc);

alter table public.next_comments enable row level security;
