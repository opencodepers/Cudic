-- Per-server roles & moderation: extend the role model beyond owner/member
-- with 'mod', and add server bans. server_members.role already exists from
-- the chat_channels_dm migration; this only documents the new value and adds
-- the bans table. RLS closed — service key only, same as everything else.

create table if not exists public.server_bans (
  server_id uuid not null,
  user_id uuid not null,
  banned_by uuid,
  reason text,
  created_at timestamptz default now()
);
alter table public.server_bans enable row level security;

do $$ begin
  alter table public.server_bans add constraint server_bans_pkey primary key (server_id, user_id);
exception when duplicate_object then null; end $$;

do $$ begin
  alter table public.server_bans add constraint server_bans_server_fk
    foreign key (server_id) references public.servers(id) on delete cascade;
exception when duplicate_object then null; end $$;

do $$ begin
  alter table public.server_bans add constraint server_bans_user_fk
    foreign key (user_id) references public.users(id) on delete cascade;
exception when duplicate_object then null; end $$;
