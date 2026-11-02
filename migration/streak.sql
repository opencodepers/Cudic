-- login streak: one column pair on users, bumped by server.js rollStreak
-- when the session claim/heartbeat sees a new UTC day. The chain continues
-- only when yesterday was active; any gap resets it to 1.
alter table public.users add column if not exists last_active_day date;
alter table public.users add column if not exists streak_days integer not null default 0;
