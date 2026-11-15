-- Chat extras: read-receipt opt-out, custom statuses, private notes, message
-- reminders and per-user DM pins. All service-role only (RLS on, no policies);
-- the browser goes through server.js.
alter table public.users
  add column if not exists read_receipts boolean not null default true;
alter table public.users
  add column if not exists status_emoji text not null default '';
alter table public.users
  add column if not exists status_text text not null default '';
alter table public.users
  add column if not exists status_expires_at timestamptz;

create table if not exists public.contact_notes (
  user_id uuid not null
    constraint contact_notes_user_fk references auth.users(id) on delete cascade,
  target_id uuid not null
    constraint contact_notes_target_fk references auth.users(id) on delete cascade,
  note text not null default '',
  updated_at timestamptz not null default now(),
  primary key (user_id, target_id),
  constraint contact_notes_not_self check (user_id <> target_id)
);

create table if not exists public.message_reminders (
  id uuid not null default gen_random_uuid() primary key,
  user_id uuid not null
    constraint message_reminders_user_fk references auth.users(id) on delete cascade,
  message_id uuid,
  lobby_id uuid,
  text text not null default '',
  remind_at timestamptz not null,
  sent_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists message_reminders_due_idx
  on public.message_reminders (remind_at) where sent_at is null;
create index if not exists message_reminders_user_idx
  on public.message_reminders (user_id, created_at desc);

create table if not exists public.message_pins (
  user_id uuid not null
    constraint message_pins_user_fk references auth.users(id) on delete cascade,
  message_id uuid not null,
  created_at timestamptz not null default now(),
  primary key (user_id, message_id)
);

alter table public.contact_notes enable row level security;
alter table public.message_reminders enable row level security;
alter table public.message_pins enable row level security;
