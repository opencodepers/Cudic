-- Replies on game comments.
--
-- Comments were a flat wall: a player could ask "how does the double jump
-- work?" and the maker had no way to answer it in place. One nullable self
-- reference is the whole change — a reply is a comment like any other, with
-- the comment it answers named.
--
-- One level is intended (a reply to a reply is reparented to the top of its
-- thread in the client), but the column allows any depth so the database does
-- not have to enforce a presentation choice. Deleting a comment takes its
-- replies with it, which is what the game page's Delete button promises.
alter table public.game_comments
  add column if not exists parent_id uuid references public.game_comments(id) on delete cascade;

-- The page loads every comment for one game, then nests in the browser, so the
-- index that matters is by parent for the delete cascade.
create index if not exists game_comments_parent_idx
  on public.game_comments (parent_id);

-- Existing rows are top-level comments: parent_id null is exactly right.
