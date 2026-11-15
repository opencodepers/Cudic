-- Planner batch: scheduled messages/announcements, message edit history,
-- private message collections, server events + RSVPs/reminders, quiet hours
-- and member introductions. Additive only; all new tables are service-role
-- only (RLS on, no policies) and routes degrade to 503 if this has not run.
alter table public.messages
  add column if not exists edited_at timestamptz;

create table if not exists public.message_edits (
  id uuid not null default gen_random_uuid() primary key,
  message_id uuid not null
    constraint message_edits_message_fk references public.messages(id) on delete cascade,
  body text not null,
  edited_at timestamptz not null default now(),
  editor_id uuid
    constraint message_edits_editor_fk references auth.users(id) on delete set null
);
create index if not exists message_edits_message_idx
  on public.message_edits (message_id, edited_at desc);

create table if not exists public.scheduled_messages (
  id uuid not null default gen_random_uuid() primary key,
  user_id uuid not null
    constraint scheduled_messages_user_fk references auth.users(id) on delete cascade,
  lobby_id uuid not null
    constraint scheduled_messages_lobby_fk references public.lobbies(id) on delete cascade,
  text text not null,
  send_at timestamptz not null,
  sent_at timestamptz,
  error text,
  announcement boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists scheduled_messages_due_idx
  on public.scheduled_messages (send_at) where sent_at is null;
create index if not exists scheduled_messages_user_idx
  on public.scheduled_messages (user_id, created_at desc);

create table if not exists public.message_collections (
  id uuid not null default gen_random_uuid() primary key,
  user_id uuid not null
    constraint message_collections_user_fk references auth.users(id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now(),
  unique (user_id, name)
);

create table if not exists public.message_collection_items (
  collection_id uuid not null
    constraint message_collection_items_collection_fk references public.message_collections(id) on delete cascade,
  message_id uuid not null,
  user_id uuid not null
    constraint message_collection_items_user_fk references auth.users(id) on delete cascade,
  text text not null default '',
  display_name text not null default '',
  lobby_id uuid,
  created_at timestamptz not null default now(),
  primary key (collection_id, message_id)
);

create table if not exists public.server_events (
  id uuid not null default gen_random_uuid() primary key,
  server_id uuid not null
    constraint server_events_server_fk references public.servers(id) on delete cascade,
  channel_id uuid,
  title text not null,
  description text not null default '',
  starts_at timestamptz not null,
  ends_at timestamptz,
  created_by uuid
    constraint server_events_creator_fk references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists server_events_server_idx
  on public.server_events (server_id, starts_at);

create table if not exists public.event_rsvps (
  event_id uuid not null
    constraint event_rsvps_event_fk references public.server_events(id) on delete cascade,
  user_id uuid not null
    constraint event_rsvps_user_fk references auth.users(id) on delete cascade,
  state text not null default 'going',
  reminded_15 boolean not null default false,
  reminded_1 boolean not null default false,
  created_at timestamptz not null default now(),
  primary key (event_id, user_id)
);

alter table public.users
  add column if not exists intro text not null default '';
alter table public.users
  add column if not exists quiet_start integer;
alter table public.users
  add column if not exists quiet_end integer;

alter table public.message_edits enable row level security;
alter table public.scheduled_messages enable row level security;
alter table public.message_collections enable row level security;
alter table public.message_collection_items enable row level security;
alter table public.server_events enable row level security;
alter table public.event_rsvps enable row level security;
