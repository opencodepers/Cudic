-- /api/ai/sessions selects and updates users.ai_sessions, and the column was
-- never created: the select errored (so the UI always saw an empty list) and
-- every save failed. Stored as a JSON array of session objects.
alter table public.users
  add column if not exists ai_sessions jsonb not null default '[]'::jsonb;

comment on column public.users.ai_sessions is
  'Per-user AI chat sessions, newest last; read/written by /api/ai/sessions.';
