-- file: 20261115180000_server_kit.sql
-- what: the server-kit batch — channel icons, order, tags and welcome lines,
--   category icons, server tags, a free-form game card, and named theme presets.
-- invariants: additive only, every statement re-runnable, and each column has a
--   default so existing rows read as "not set" instead of NULL. The routes that
--   need any of it degrade to the old behaviour before this runs.

alter table public.lobbies
  add column if not exists icon text not null default '';
alter table public.lobbies
  add column if not exists position integer not null default 0;
alter table public.lobbies
  add column if not exists tags text[] not null default '{}';
alter table public.lobbies
  add column if not exists welcome text not null default '';

alter table public.channel_folders
  add column if not exists icon text not null default '';

alter table public.servers
  add column if not exists tags text[] not null default '{}';
alter table public.servers
  add column if not exists meta jsonb not null default '{}'::jsonb;

create index if not exists lobbies_server_position_idx
  on public.lobbies (server_id, position);

create table if not exists public.server_theme_presets (
  id uuid not null default gen_random_uuid() primary key,
  server_id uuid not null
    constraint server_theme_presets_server_fk references public.servers(id) on delete cascade,
  name text not null,
  theme jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (server_id, name)
);
create index if not exists server_theme_presets_server_idx
  on public.server_theme_presets (server_id, created_at);

alter table public.server_theme_presets enable row level security;
