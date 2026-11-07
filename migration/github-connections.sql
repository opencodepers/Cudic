-- Connect GitHub: one linked GitHub account per Cudic account.
--
-- Studio's public import needs no account at all (studio/src/github.ts reads
-- jsDelivr). This table is for the half that needs permission: private repos,
-- and later committing back. The OAuth token never leaves the server in
-- plaintext — server.js seals it with AES-256-GCM under GITHUB_TOKEN_KEY, and
-- no endpoint ever returns it, only `login` and the granted scopes.
--
-- Service-role only: RLS on with no policies, so the anon key cannot read a
-- single row even with a user's own JWT.
create table if not exists public.github_connections (
  user_id uuid primary key
    constraint github_connections_user_fk references auth.users(id) on delete cascade,
  login text not null default '',
  scopes text not null default '',
  token_enc text not null,
  connected_at timestamptz not null default now(),
  last_used_at timestamptz
);

alter table public.github_connections enable row level security;

-- PostgREST has its own schema cache: without this a brand-new table 404s
-- (PGRST205) until the cache expires. Harmless if already loaded.
notify pgrst, 'reload schema';
