-- Full-text search across games and forum threads.
--
-- `ilike('%q%')` cannot use an index and ranks nothing, so search was both
-- slow and arbitrary. These columns are maintained by triggers (array_to_string
-- is not immutable, so a generated column is not an option) and queried through
-- ranked SQL functions that the API calls.
alter table public.games add column if not exists search_tsv tsvector;
alter table public.forum_threads add column if not exists search_tsv tsvector;

create or replace function public.games_search_tsv() returns trigger
language plpgsql as $$
begin
  new.search_tsv := to_tsvector('english',
    coalesce(new.title, '') || ' ' || coalesce(new.description, '') || ' ' ||
    coalesce(array_to_string(new.tags, ' '), ''));
  return new;
end $$;

drop trigger if exists games_search_tsv on public.games;
create trigger games_search_tsv before insert or update of title, description, tags
  on public.games for each row execute function public.games_search_tsv();

create or replace function public.threads_search_tsv() returns trigger
language plpgsql as $$
begin
  new.search_tsv := to_tsvector('english', coalesce(new.title, '') || ' ' || coalesce(new.body, ''));
  return new;
end $$;

drop trigger if exists threads_search_tsv on public.forum_threads;
create trigger threads_search_tsv before insert or update of title, body
  on public.forum_threads for each row execute function public.threads_search_tsv();

create index if not exists games_search_tsv_idx on public.games using gin (search_tsv);
create index if not exists threads_search_tsv_idx on public.forum_threads using gin (search_tsv);

update public.games
   set search_tsv = to_tsvector('english', coalesce(title, '') || ' ' || coalesce(description, '') || ' ' || coalesce(array_to_string(tags, ' '), ''))
 where search_tsv is null;

update public.forum_threads
   set search_tsv = to_tsvector('english', coalesce(title, '') || ' ' || coalesce(body, ''))
 where search_tsv is null;

-- Ranked reads. `score` (not `rank`) so the output column never shadows the
-- rank() window function.
create or replace function public.search_games(q text, lim int default 10)
returns table (id uuid, title text, description text, tags text[], play_count int, owner_id uuid, score real)
language sql stable as $$
  select g.id, g.title, g.description, g.tags, g.play_count, g.owner_id,
         ts_rank(g.search_tsv, websearch_to_tsquery('english', q))::real as score
  from public.games g
  where g.published = true
    and g.search_tsv @@ websearch_to_tsquery('english', q)
  order by score desc, g.play_count desc
  limit least(coalesce(lim, 10), 50);
$$;

create or replace function public.search_threads(q text, lim int default 10)
returns table (id uuid, title text, category text, comment_count int, created_at timestamptz, score real)
language sql stable as $$
  select t.id, t.title, t.category, t.comment_count, t.created_at,
         ts_rank(t.search_tsv, websearch_to_tsquery('english', q))::real as score
  from public.forum_threads t
  where t.search_tsv @@ websearch_to_tsquery('english', q)
  order by score desc, t.last_at desc
  limit least(coalesce(lim, 10), 50);
$$;
