-- file: 20261120120000_project_vote_fix.sql
-- what: replace cast_project_vote with qualified counter updates and parameter-scoped lookup.
-- invariants: lifetime counters stay atomic in one transaction; weekly sums still read only
--   project_votes rows for p_week; execute remains service-role only.
-- see: 20261119130000_projects.sql (base tables).

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
      update public.projects as p
         set upvotes = greatest(0, p.upvotes - (case when v_old = 1 then 1 else 0 end)),
             downvotes = greatest(0, p.downvotes - (case when v_old = -1 then 1 else 0 end)),
             updated_at = now()
       where p.id = p_project;
    end if;
  elsif v_old is null then
    insert into public.project_votes (project_id, user_id, vote, week_start)
    values (p_project, p_user, p_vote, p_week);
    update public.projects as p
       set upvotes = p.upvotes + (case when p_vote = 1 then 1 else 0 end),
           downvotes = p.downvotes + (case when p_vote = -1 then 1 else 0 end),
           updated_at = now()
     where p.id = p_project;
  else
    update public.project_votes
       set vote = p_vote, updated_at = now()
     where project_id = p_project and user_id = p_user and week_start = p_week;
    update public.projects as p
       set upvotes = greatest(0, p.upvotes
             + (case when p_vote = 1 then 1 else 0 end)
             - (case when v_old = 1 then 1 else 0 end)),
           downvotes = greatest(0, p.downvotes
             + (case when p_vote = -1 then 1 else 0 end)
             - (case when v_old = -1 then 1 else 0 end)),
           updated_at = now()
     where p.id = p_project;
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
         where pv2.project_id = p_project
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
