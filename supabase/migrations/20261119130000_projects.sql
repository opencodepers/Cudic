-- file: 20261119130000_projects.sql
-- what: public project board — external sites/apps, weekly up/down votes and comments.
-- invariants: additive only; reads and writes happen through the API, lifetime
--   counters update atomically in cast_project_vote, and weekly ranking reads
--   only project_votes rows for the current Monday UTC week.

create table if not exists public.projects (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.users(id) on delete cascade,
  slug text not null unique,
  name text not null,
  tagline text not null default '',
  description text not null default '',
  url text not null unique,
  image_url text,
  category text not null default 'other',
  tags text[] not null default '{}'::text[],
  upvotes integer not null default 0 check (upvotes >= 0),
  downvotes integer not null default 0 check (downvotes >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint projects_slug_format check (slug ~ '^[a-z0-9][a-z0-9-]{1,59}$'),
  constraint projects_name_length check (char_length(name) between 2 and 80),
  constraint projects_tagline_length check (char_length(tagline) <= 140),
  constraint projects_description_length check (char_length(description) <= 2800),
  constraint projects_url_http check (url ~ '^https?://'),
  constraint projects_image_http check (image_url is null or image_url ~ '^https?://'),
  constraint projects_category_check check (category in ('game', 'tool', 'site', 'app', 'art', 'writing', 'music', 'other')),
  constraint projects_tags_count check (cardinality(tags) <= 5)
);

create index if not exists projects_created_idx on public.projects (created_at desc);
create index if not exists projects_upvotes_idx on public.projects (upvotes desc);
create index if not exists projects_category_idx on public.projects (category);

create table if not exists public.project_votes (
  project_id uuid not null references public.projects(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  vote smallint not null check (vote in (-1, 1)),
  week_start date not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (project_id, user_id, week_start)
);

create index if not exists project_votes_week_idx
  on public.project_votes (week_start, project_id);
create index if not exists project_votes_user_idx
  on public.project_votes (user_id, week_start);

create table if not exists public.project_comments (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  author_id uuid not null references public.users(id) on delete cascade,
  body text not null check (char_length(body) between 1 and 600),
  created_at timestamptz not null default now()
);

create index if not exists project_comments_project_idx
  on public.project_comments (project_id, created_at desc);
create index if not exists project_comments_author_idx
  on public.project_comments (author_id, created_at desc);

alter table public.projects enable row level security;
alter table public.project_votes enable row level security;
alter table public.project_comments enable row level security;

-- One atomic write changes the caller's weekly vote and the lifetime counters.
-- The API verifies the caller and passes their id; execute is restricted to
-- the service role so a browser cannot forge another account's vote.
create or replace function public.cast_project_vote(
  p_project uuid,
  p_user uuid,
  p_vote smallint,
  p_week date
)
returns table (
  week_upvotes integer,
  week_downvotes integer,
  week_score integer,
  upvotes integer,
  downvotes integer,
  my_vote smallint
)
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_old smallint;
begin
  if p_vote is null or p_vote not in (-1, 0, 1) then
    raise exception 'vote must be -1, 0, or 1' using errcode = '22023';
  end if;

  perform 1 from public.projects where id = p_project for update;
  if not found then
    raise exception 'project not found' using errcode = 'P0002';
  end if;

  select pv.vote into v_old
    from public.project_votes pv
   where pv.project_id = p_project
     and pv.user_id = p_user
     and pv.week_start = p_week
   for update;

  if p_vote = 0 or v_old = p_vote then
    if v_old is not null then
      delete from public.project_votes
       where project_id = p_project and user_id = p_user and week_start = p_week;
      update public.projects
         set upvotes = greatest(0, upvotes - (case when v_old = 1 then 1 else 0 end)),
             downvotes = greatest(0, downvotes - (case when v_old = -1 then 1 else 0 end)),
             updated_at = now()
       where id = p_project;
    end if;
  elsif v_old is null then
    insert into public.project_votes (project_id, user_id, vote, week_start)
    values (p_project, p_user, p_vote, p_week);
    update public.projects
       set upvotes = upvotes + (case when p_vote = 1 then 1 else 0 end),
           downvotes = downvotes + (case when p_vote = -1 then 1 else 0 end),
           updated_at = now()
     where id = p_project;
  else
    update public.project_votes
       set vote = p_vote, updated_at = now()
     where project_id = p_project and user_id = p_user and week_start = p_week;
    update public.projects
       set upvotes = greatest(0, upvotes
             + (case when p_vote = 1 then 1 else 0 end)
             - (case when v_old = 1 then 1 else 0 end)),
           downvotes = greatest(0, downvotes
             + (case when p_vote = -1 then 1 else 0 end)
             - (case when v_old = -1 then 1 else 0 end)),
           updated_at = now()
     where id = p_project;
  end if;

  return query
    select
      coalesce(sum(case when pv.vote = 1 then 1 else 0 end), 0)::integer,
      coalesce(sum(case when pv.vote = -1 then 1 else 0 end), 0)::integer,
      coalesce(sum(pv.vote), 0)::integer,
      p.upvotes,
      p.downvotes,
      coalesce((
        select pv2.vote
          from public.project_votes pv2
         where pv2.project_id = p.id
           and pv2.user_id = p_user
           and pv2.week_start = p_week
      ), 0)::smallint
    from public.projects p
    left join public.project_votes pv
      on pv.project_id = p.id and pv.week_start = p_week
    where p.id = p_project
    group by p.id, p.upvotes, p.downvotes;
end;
$$;

revoke all on function public.cast_project_vote(uuid, uuid, smallint, date) from public;
grant execute on function public.cast_project_vote(uuid, uuid, smallint, date) to service_role;

grant select, insert, update, delete on public.projects to service_role;
grant select, insert, update, delete on public.project_votes to service_role;
grant select, insert, update, delete on public.project_comments to service_role;
