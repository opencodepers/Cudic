-- Push to deploy: a published game can name the repository it ships from, so a
-- push to that repo's publish branch creates the next release instead of the
-- commit disappearing into GitHub. Three columns rather than a join table: the
-- mapping is one repo per project, and the guard needs the login and branch
-- next to it.
--
-- Nullable on purpose. Every game published before this keeps serving its
-- snapshot, and a game with no repository simply has no deploy hook.
alter table public.games add column if not exists github_repo text;
alter table public.games add column if not exists github_branch text;
alter table public.games add column if not exists github_login text;

-- The webhook looks a repository up by name on every push.
create index if not exists games_github_repo_idx
  on public.games (lower(github_repo))
  where github_repo is not null;
