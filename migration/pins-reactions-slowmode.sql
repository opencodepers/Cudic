-- Server-chat small features: pins, reactions, slow mode.
-- Written only through server.js (service key), RLS closed like
-- game_scores/notifications — there is no direct-PostgREST path.

-- Pinned messages: a channel can hold any number; the pinned shelf is
-- fetched with ?pinned=1 and the flag rides the normal history select.
do $$ begin
  alter table public.messages add column if not exists pinned boolean not null default false;
exception when duplicate_column then null; end $$;

-- Reactions: one row per (message, user, emoji) — the primary key is the
-- dedupe, so re-reacting upserts instead of double-counting. Emoji strings
-- are validated server-side against the existing emoji map family (≤8 chars).
create table if not exists public.message_reactions (
  message_id uuid not null,
  user_id uuid not null,
  emoji text not null,
  created_at timestamptz default now()
);
alter table public.message_reactions enable row level security;

do $$ begin
  alter table public.message_reactions add constraint message_reactions_pkey
    primary key (message_id, user_id, emoji);
exception when duplicate_object then null; end $$;

do $$ begin
  alter table public.message_reactions add constraint message_reactions_message_fk
    foreign key (message_id) references public.messages(id) on delete cascade;
exception when duplicate_object then null; end $$;

do $$ begin
  alter table public.message_reactions add constraint message_reactions_user_fk
    foreign key (user_id) references public.users(id) on delete cascade;
exception when duplicate_object then null; end $$;

-- Slow mode lives on the channel lobby row itself; 0 = off.
do $$ begin
  alter table public.lobbies add column if not exists slow_seconds integer not null default 0;
exception when duplicate_object then null; end $$;
