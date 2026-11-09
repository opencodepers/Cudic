-- /api/games/:id/play calls supabase.rpc('bump_play_count') on every play.
-- The function was never created in production, so the counter never moved
-- and the 100-play 'viral'/'renowned' awards could never trigger.
create or replace function public.bump_play_count(p_game uuid)
returns integer
language sql
security definer
set search_path = public
as $$
  update public.games
     set play_count = coalesce(play_count, 0) + 1
   where id = p_game
  returning play_count;
$$;

revoke all on function public.bump_play_count(uuid) from public;
grant execute on function public.bump_play_count(uuid) to anon, authenticated, service_role;
