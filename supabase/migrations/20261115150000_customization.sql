-- Customisation batch: layout/density/font/rail/glass/motion/sound prefs,
-- per-conversation and per-server themes, nested channel folders, profile
-- widgets/themes, custom badges, welcome flows and declarative server
-- commands. Additive only; all tables are service-role only (RLS on).
alter table public.users
  add column if not exists layout jsonb not null default '{}'::jsonb;
alter table public.users
  add column if not exists font_family text not null default '';
alter table public.users
  add column if not exists font_size integer not null default 0;
alter table public.users
  add column if not exists line_height numeric(4,2) not null default 0;
alter table public.users
  add column if not exists density text not null default 'comfortable';
alter table public.users
  add column if not exists rail_mode text not null default 'icon';
alter table public.users
  add column if not exists glass boolean not null default false;
alter table public.users
  add column if not exists reduce_motion boolean not null default false;
alter table public.users
  add column if not exists notify_sounds jsonb not null default '{}'::jsonb;
alter table public.users
  add column if not exists profile_pack_slug text;
alter table public.users
  add column if not exists banner_pos integer not null default 50;
alter table public.users
  add column if not exists banner_animated boolean not null default false;
alter table public.users
  add column if not exists chan_layout text not null default 'list';

alter table public.lobbies
  add column if not exists theme jsonb not null default '{}'::jsonb;
alter table public.lobbies
  add column if not exists folder_id uuid;
alter table public.servers
  add column if not exists theme jsonb not null default '{}'::jsonb;

create table if not exists public.channel_folders (
  id uuid not null default gen_random_uuid() primary key,
  server_id uuid not null
    constraint channel_folders_server_fk references public.servers(id) on delete cascade,
  parent_id uuid
    constraint channel_folders_parent_fk references public.channel_folders(id) on delete cascade,
  name text not null,
  position integer not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists channel_folders_server_idx
  on public.channel_folders (server_id, position);

create table if not exists public.conversation_themes (
  user_id uuid not null
    constraint conversation_themes_user_fk references auth.users(id) on delete cascade,
  lobby_id uuid not null
    constraint conversation_themes_lobby_fk references public.lobbies(id) on delete cascade,
  theme jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (user_id, lobby_id)
);

create table if not exists public.custom_themes (
  id uuid not null default gen_random_uuid() primary key,
  user_id uuid not null
    constraint custom_themes_user_fk references auth.users(id) on delete cascade,
  name text not null,
  manifest jsonb not null default '{}'::jsonb,
  published boolean not null default false,
  created_at timestamptz not null default now(),
  unique (user_id, name)
);

create table if not exists public.profile_widgets (
  id uuid not null default gen_random_uuid() primary key,
  user_id uuid not null
    constraint profile_widgets_user_fk references auth.users(id) on delete cascade,
  kind text not null,
  config jsonb not null default '{}'::jsonb,
  position integer not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists profile_widgets_user_idx
  on public.profile_widgets (user_id, position);

create table if not exists public.custom_badges (
  id uuid not null default gen_random_uuid() primary key,
  server_id uuid not null
    constraint custom_badges_server_fk references public.servers(id) on delete cascade,
  name text not null,
  icon text not null default '★',
  colour text not null default '#FF8C1A',
  created_by uuid
    constraint custom_badges_creator_fk references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (server_id, name)
);

create table if not exists public.user_custom_badges (
  user_id uuid not null
    constraint user_custom_badges_user_fk references auth.users(id) on delete cascade,
  badge_id uuid not null
    constraint user_custom_badges_badge_fk references public.custom_badges(id) on delete cascade,
  granted_by uuid
    constraint user_custom_badges_grantor_fk references auth.users(id) on delete set null,
  granted_at timestamptz not null default now(),
  primary key (user_id, badge_id)
);

create table if not exists public.server_welcome (
  server_id uuid not null primary key
    constraint server_welcome_server_fk references public.servers(id) on delete cascade,
  steps jsonb not null default '[]'::jsonb,
  enabled boolean not null default false,
  updated_at timestamptz not null default now()
);

create table if not exists public.server_commands (
  id uuid not null default gen_random_uuid() primary key,
  server_id uuid not null
    constraint server_commands_server_fk references public.servers(id) on delete cascade,
  trigger text not null,
  response text not null,
  cooldown integer not null default 30,
  created_by uuid
    constraint server_commands_creator_fk references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (server_id, trigger)
);

alter table public.channel_folders enable row level security;
alter table public.conversation_themes enable row level security;
alter table public.custom_themes enable row level security;
alter table public.profile_widgets enable row level security;
alter table public.custom_badges enable row level security;
alter table public.user_custom_badges enable row level security;
alter table public.server_welcome enable row level security;
alter table public.server_commands enable row level security;
