-- Community tools: peer cards, channel descriptions/templates, DM folders,
-- friend activity, server audit/milestones and owner backups. Additive only;
-- every table is service-role only (RLS on, no policies) and every route
-- degrades to 503 when the migration has not run.
alter table public.lobbies
  add column if not exists description text not null default '';
alter table public.users
  add column if not exists share_activity boolean not null default false;
alter table public.users
  add column if not exists typing_previews boolean not null default true;

create table if not exists public.channel_templates (
  id uuid not null default gen_random_uuid() primary key,
  server_id uuid not null
    constraint channel_templates_server_fk references public.servers(id) on delete cascade,
  name text not null,
  config jsonb not null default '{}'::jsonb,
  created_by uuid
    constraint channel_templates_creator_fk references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (server_id, name)
);

create table if not exists public.conversation_folders (
  id uuid not null default gen_random_uuid() primary key,
  user_id uuid not null
    constraint conversation_folders_user_fk references auth.users(id) on delete cascade,
  name text not null,
  position integer not null default 0,
  created_at timestamptz not null default now(),
  unique (user_id, name)
);
create index if not exists conversation_folders_user_idx
  on public.conversation_folders (user_id, position);

create table if not exists public.conversation_folder_items (
  folder_id uuid not null
    constraint conversation_folder_items_folder_fk references public.conversation_folders(id) on delete cascade,
  user_id uuid not null
    constraint conversation_folder_items_user_fk references auth.users(id) on delete cascade,
  lobby_id uuid not null
    constraint conversation_folder_items_lobby_fk references public.lobbies(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (folder_id, lobby_id)
);
create index if not exists conversation_folder_items_user_idx
  on public.conversation_folder_items (user_id);

create table if not exists public.server_audit (
  id uuid not null default gen_random_uuid() primary key,
  server_id uuid not null
    constraint server_audit_server_fk references public.servers(id) on delete cascade,
  actor_id uuid
    constraint server_audit_actor_fk references auth.users(id) on delete set null,
  action text not null,
  target text not null default '',
  meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists server_audit_server_idx
  on public.server_audit (server_id, created_at desc);

create table if not exists public.server_milestones (
  server_id uuid not null
    constraint server_milestones_server_fk references public.servers(id) on delete cascade,
  code text not null,
  reached_at timestamptz not null default now(),
  primary key (server_id, code)
);

alter table public.channel_templates enable row level security;
alter table public.conversation_folders enable row level security;
alter table public.conversation_folder_items enable row level security;
alter table public.server_audit enable row level security;
alter table public.server_milestones enable row level security;
