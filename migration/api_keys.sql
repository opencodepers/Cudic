-- Scoped API keys for agents (CLI, MCP server, scripts).
--
-- A key is shown once and stored only as a sha256 hash, exactly like a
-- password. `key_preview` keeps the first characters so the owner can tell
-- keys apart. Scopes gate what a key can touch: projects:read,
-- projects:write, profile:read. RLS is on with NO policies — server.js reads
-- this table with the service role only (same shape as active_sessions), so
-- a leaked anon key can never enumerate hashes.
create table if not exists public.api_keys (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  label text not null default 'agent key',
  key_hash text not null unique,
  key_preview text not null default '',
  scopes text[] not null default '{}',
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at timestamptz
);

create index if not exists api_keys_user_idx on public.api_keys (user_id);

alter table public.api_keys enable row level security;
