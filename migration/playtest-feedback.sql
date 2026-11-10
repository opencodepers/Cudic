-- Playtest feedback shares game_posts with creator devlog posts. `kind` keeps
-- the two feeds apart (public devlog reads only 'post'; the owner reads
-- 'feedback'), and `author_name` carries the tester's optional name because a
-- playtester has no account id to join.
alter table public.game_posts add column if not exists kind text not null default 'post';
alter table public.game_posts add column if not exists author_name text;
create index if not exists game_posts_game_kind_idx on public.game_posts (game_id, kind, created_at desc);

notify pgrst, 'reload schema';
