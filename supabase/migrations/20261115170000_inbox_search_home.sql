-- file: 20261115170000_inbox_search_home.sql
-- what: supports the inbox / cross-server search / home dashboard batch.
--   A trigram index makes "contains" search over messages affordable on the
--   free tier; home_cards remembers which dashboard cards a person hid.
-- invariants: additive only. Every statement is safe to re-run, the column has
--   a default so existing rows never read as NULL, and the routes that need the
--   column degrade to "cards always visible" when it is absent.

create extension if not exists pg_trgm;

create index if not exists messages_text_trgm_idx
  on public.messages using gin (text gin_trgm_ops);

alter table public.users
  add column if not exists home_cards jsonb not null default '{}'::jsonb;
