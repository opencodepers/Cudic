-- Server HQ: temporary channels and member introductions. Additive only;
-- both tables/columns are optional, so an unmigrated deploy hides the feature
-- instead of breaking the channel list. Service-role access only (RLS on, no
-- browser policies); every read and write goes through server.js.
alter table public.lobbies
  add column if not exists expires_at timestamptz;

create table if not exists public.server_intros (
  server_id uuid not null
    constraint server_intros_server_fk references public.servers(id) on delete cascade,
  user_id uuid not null
    constraint server_intros_user_fk references auth.users(id) on delete cascade,
  body text not null default '',
  updated_at timestamptz not null default now(),
  primary key (server_id, user_id)
);

create index if not exists server_intros_recent_idx
  on public.server_intros (server_id, updated_at desc);

alter table public.server_intros enable row level security;
