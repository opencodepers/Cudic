-- file: 20261121120000_dm_polls.sql
-- what: allows a server_polls row to belong to a DM instead of a server.
-- invariants: additive only; channel polls keep their server_id and every
--   existing row is untouched. The API answers 503 for DM poll creation until
--   this runs. Membership is checked against conversation_members, never
--   trusted from the client.

alter table public.server_polls
  alter column server_id drop not null;

comment on column public.server_polls.server_id is
  'Set for a server channel poll; null for a DM poll (lobby_id is always set).';
