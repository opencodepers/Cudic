-- Forks used to copy every storage object into a new prefix, so storage grew
-- per fork instead of per game. asset_owner names the game whose prefix holds
-- this row's assets: a fork points at its parent's prefix and the delete handler
-- materialises the bytes into the children before the parent's prefix goes away.
-- null means "my own prefix" (every game created before this migration).
alter table public.games
  add column if not exists asset_owner uuid references public.games(id) on delete set null;

-- Partial: the vast majority of rows never fork, and a full index would be
-- almost entirely nulls.
create index if not exists games_asset_owner_idx
  on public.games (asset_owner)
  where asset_owner is not null;
