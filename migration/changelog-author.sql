-- Synced commits store their author in author_name. Before this, the sync and
-- webhook put "by Sophi" into body, so the card showed "by Sophi" and the
-- generic "team" meta at the same time.
alter table public.changelog add column if not exists author_name text;

-- Only the exact synthetic shape becomes an author; real commit bodies are
-- left alone. The regex matches "by Sophi" and "by Jane Doe", not prose.
update public.changelog
   set author_name = substring(body from 4), body = ''
 where author_name is null
   and body ~ '^by [A-Za-z0-9_. -]{1,80}$';

notify pgrst, 'reload schema';
