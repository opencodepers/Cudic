-- Cudic new-schema for qgcydphkaujomxyzwcht (derived from old opimjwmgmzwapkzgxvhk)
-- Tables (no constraints yet; constraints added after)

CREATE TABLE IF NOT EXISTS public.users (
  id uuid NOT NULL,
  display_name text NOT NULL,
  avatar_url text,
  created_at timestamptz DEFAULT now(),
  user_id bigint,
  balance integer NOT NULL DEFAULT 0,
  bio text NOT NULL DEFAULT '',
  interests text[] NOT NULL DEFAULT '{}',
  setup_done boolean NOT NULL DEFAULT false,
  theme text DEFAULT 'dark',
  pack_slug text DEFAULT 'anime-city-night',
  equips jsonb NOT NULL DEFAULT '{"b": [], "f": [], "t": []}'::jsonb
);

CREATE TABLE IF NOT EXISTS public.servers (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  name text NOT NULL,
  created_by uuid,
  created_at timestamptz DEFAULT now(),
  persistent boolean DEFAULT false,
  server_id uuid,
  topic text NOT NULL DEFAULT '',
  is_private boolean NOT NULL DEFAULT false,
  kind text NOT NULL
);

CREATE TABLE IF NOT EXISTS public.messages (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  lobby_id uuid NOT NULL,
  user_id uuid,
  display_name text NOT NULL,
  text text NOT NULL,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.games (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL,
  title text NOT NULL,
  description text DEFAULT '',
  scene jsonb NOT NULL DEFAULT '[]',
  thumbnail text,
  published boolean DEFAULT false,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  credits text DEFAULT '',
  files jsonb,
  assets jsonb,
  forked_from uuid,
  forked_from_title text NOT NULL DEFAULT '',
  fork_chain jsonb NOT NULL DEFAULT '[]',
  tags text[] NOT NULL DEFAULT '{}',
  play_count bigint NOT NULL DEFAULT 0,
  slug text,
  featured boolean NOT NULL DEFAULT false,
  featured_until timestamptz
);

CREATE TABLE IF NOT EXISTS public.servers (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  name text NOT NULL,
  description text DEFAULT '',
  icon_url text,
  visibility text DEFAULT 'public',
  invite_code text NOT NULL DEFAULT substr(md5((random())::text), 1, 8),
  owner_id uuid NOT NULL,
  created_at timestamptz DEFAULT now(),
  rules text NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS public.server_members (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  server_id uuid NOT NULL,
  user_id uuid NOT NULL,
  joined_at timestamptz DEFAULT now(),
  role text NOT NULL DEFAULT 'member',
  rules_accepted_at timestamptz
);

CREATE TABLE IF NOT EXISTS public.game_comments (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  game_id uuid NOT NULL,
  user_id uuid,
  display_name text NOT NULL,
  text text NOT NULL,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.conversation_members (
  user_id uuid NOT NULL,
  lobby_id uuid NOT NULL,
  joined_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.conversation_state (
  user_id uuid NOT NULL,
  lobby_id uuid NOT NULL,
  last_read_at timestamptz
);

CREATE TABLE IF NOT EXISTS public.friendships (
  user_id uuid NOT NULL,
  friend_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.coin_ledger (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  delta integer NOT NULL,
  reason text NOT NULL,
  ref_id uuid,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.theme_packs (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  slug text NOT NULL,
  owner_id uuid NOT NULL,
  name text NOT NULL,
  description text NOT NULL DEFAULT '',
  manifest jsonb NOT NULL DEFAULT '{}',
  price integer NOT NULL DEFAULT 0,
  downloads integer NOT NULL DEFAULT 0,
  featured boolean NOT NULL DEFAULT false,
  published boolean NOT NULL DEFAULT false,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.pack_ownership (
  user_id uuid NOT NULL,
  pack_id uuid NOT NULL,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.reports (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  reporter_id uuid NOT NULL,
  content_type text NOT NULL,
  content_id uuid,
  reason text NOT NULL,
  details text NOT NULL DEFAULT '',
  evidence_url text,
  status text NOT NULL DEFAULT 'open',
  created_at timestamptz DEFAULT now(),
  content_slug text
);

CREATE TABLE IF NOT EXISTS public.active_sessions (
  user_id uuid NOT NULL,
  seat_id text NOT NULL,
  heartbeat_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.game_saves (
  user_id uuid NOT NULL,
  game_id uuid NOT NULL,
  data jsonb NOT NULL DEFAULT '{}',
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.game_likes (
  user_id uuid NOT NULL,
  game_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.email_codes (
  email text NOT NULL,
  code_hash text NOT NULL,
  expires_at timestamptz NOT NULL,
  attempts integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.moderators (
  user_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.moderation_actions (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  moderator_id uuid NOT NULL,
  report_id uuid,
  content_type text NOT NULL,
  content_id uuid,
  action text NOT NULL,
  reason text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.forum_threads (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  title text NOT NULL,
  body text NOT NULL DEFAULT '',
  pinned boolean NOT NULL DEFAULT false,
  comment_count integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  last_at timestamptz NOT NULL DEFAULT now(),
  category text NOT NULL DEFAULT 'help',
  game_id uuid
);

CREATE TABLE IF NOT EXISTS public.forum_comments (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  thread_id uuid NOT NULL,
  user_id uuid NOT NULL,
  display_name text NOT NULL DEFAULT 'Unknown',
  text text NOT NULL,
  label text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.music_tracks (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL,
  title text NOT NULL DEFAULT 'Untitled track',
  data jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.creator_comments (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  creator_id uuid NOT NULL,
  author_id uuid NOT NULL,
  body text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.creator_pages (
  user_id uuid NOT NULL,
  accent text,
  banner_url text NOT NULL DEFAULT '',
  pinned_game_id uuid,
  links jsonb NOT NULL DEFAULT '[]',
  show_games boolean NOT NULL DEFAULT true,
  show_packs boolean NOT NULL DEFAULT true,
  show_comments boolean NOT NULL DEFAULT true,
  custom_css text NOT NULL DEFAULT '',
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.game_ratings (
  game_id uuid NOT NULL,
  user_id uuid NOT NULL,
  rating integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.collections (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL,
  title text NOT NULL,
  description text NOT NULL DEFAULT '',
  visibility text NOT NULL DEFAULT 'public',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.collection_items (
  collection_id uuid NOT NULL,
  game_id uuid NOT NULL,
  position integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.notifications (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  kind text NOT NULL,
  title text NOT NULL,
  body text NOT NULL DEFAULT '',
  ref_type text,
  ref_id uuid,
  read_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.project_revisions (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  game_id uuid NOT NULL,
  owner_id uuid NOT NULL,
  label text NOT NULL DEFAULT '',
  files jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.follows (
  follower_id uuid NOT NULL,
  followed_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.user_badges (
  user_id uuid NOT NULL,
  code text NOT NULL,
  awarded_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.activity (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  kind text NOT NULL,
  text text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.user_bans (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  kind text NOT NULL,
  banned_until timestamptz NOT NULL,
  reason text NOT NULL DEFAULT '',
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.changelog (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  kind text NOT NULL DEFAULT 'feature',
  title text NOT NULL,
  body text NOT NULL DEFAULT '',
  author_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  commit_sha text
);

-- ---- constraints ----

ALTER TABLE public.users ADD CONSTRAINT users_pkey PRIMARY KEY (id);
ALTER TABLE public.users ADD CONSTRAINT users_user_id_key UNIQUE (user_id);
ALTER TABLE public.users ADD CONSTRAINT users_id_fkey FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE public.lobbies ADD CONSTRAINT lobbies_pkey PRIMARY KEY (id);
ALTER TABLE public.lobbies ADD CONSTRAINT lobbies_name_key UNIQUE (name);
ALTER TABLE public.lobbies ADD CONSTRAINT lobbies_created_by_fkey FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE public.lobbies ADD CONSTRAINT lobbies_server_id_fkey FOREIGN KEY (server_id) REFERENCES servers(id) ON DELETE CASCADE;

ALTER TABLE public.messages ADD CONSTRAINT messages_pkey PRIMARY KEY (id);
ALTER TABLE public.messages ADD CONSTRAINT messages_lobby_id_fkey FOREIGN KEY (lobby_id) REFERENCES lobbies(id) ON DELETE CASCADE;
ALTER TABLE public.messages ADD CONSTRAINT messages_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE public.games ADD CONSTRAINT games_pkey PRIMARY KEY (id);
ALTER TABLE public.games ADD CONSTRAINT games_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE CASCADE;
ALTER TABLE public.games ADD CONSTRAINT games_forked_from_fkey FOREIGN KEY (forked_from) REFERENCES games(id) ON DELETE SET NULL;

ALTER TABLE public.servers ADD CONSTRAINT servers_pkey PRIMARY KEY (id);
ALTER TABLE public.servers ADD CONSTRAINT servers_invite_code_key UNIQUE (invite_code);
ALTER TABLE public.servers ADD CONSTRAINT servers_name_key UNIQUE (name);
ALTER TABLE public.servers ADD CONSTRAINT servers_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE CASCADE;

ALTER TABLE public.server_members ADD CONSTRAINT server_members_pkey PRIMARY KEY (id);
ALTER TABLE public.server_members ADD CONSTRAINT server_members_server_id_user_id_key UNIQUE (server_id, user_id);
ALTER TABLE public.server_members ADD CONSTRAINT server_members_server_id_fkey FOREIGN KEY (server_id) REFERENCES servers(id) ON DELETE CASCADE;
ALTER TABLE public.server_members ADD CONSTRAINT server_members_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;

ALTER TABLE public.game_comments ADD CONSTRAINT game_comments_pkey PRIMARY KEY (id);
ALTER TABLE public.game_comments ADD CONSTRAINT game_comments_game_id_fkey FOREIGN KEY (game_id) REFERENCES games(id) ON DELETE CASCADE;
ALTER TABLE public.game_comments ADD CONSTRAINT game_comments_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE public.conversation_members ADD CONSTRAINT conversation_members_pkey PRIMARY KEY (user_id, lobby_id);
ALTER TABLE public.conversation_members ADD CONSTRAINT conversation_members_lobby_id_fkey FOREIGN KEY (lobby_id) REFERENCES lobbies(id) ON DELETE CASCADE;
ALTER TABLE public.conversation_members ADD CONSTRAINT conversation_members_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;

ALTER TABLE public.conversation_state ADD CONSTRAINT conversation_state_pkey PRIMARY KEY (user_id, lobby_id);
ALTER TABLE public.conversation_state ADD CONSTRAINT conversation_state_lobby_id_fkey FOREIGN KEY (lobby_id) REFERENCES lobbies(id) ON DELETE CASCADE;
ALTER TABLE public.conversation_state ADD CONSTRAINT conversation_state_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;

ALTER TABLE public.friendships ADD CONSTRAINT friendships_pkey PRIMARY KEY (user_id, friend_id);
ALTER TABLE public.friendships ADD CONSTRAINT friendships_friend_id_fkey FOREIGN KEY (friend_id) REFERENCES users(id) ON DELETE CASCADE;
ALTER TABLE public.friendships ADD CONSTRAINT friendships_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;

ALTER TABLE public.coin_ledger ADD CONSTRAINT coin_ledger_pkey PRIMARY KEY (id);
ALTER TABLE public.coin_ledger ADD CONSTRAINT coin_ledger_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;

ALTER TABLE public.theme_packs ADD CONSTRAINT theme_packs_pkey PRIMARY KEY (id);
ALTER TABLE public.theme_packs ADD CONSTRAINT theme_packs_slug_key UNIQUE (slug);
ALTER TABLE public.theme_packs ADD CONSTRAINT theme_packs_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE CASCADE;

ALTER TABLE public.pack_ownership ADD CONSTRAINT pack_ownership_pkey PRIMARY KEY (user_id, pack_id);
ALTER TABLE public.pack_ownership ADD CONSTRAINT pack_ownership_pack_id_fkey FOREIGN KEY (pack_id) REFERENCES theme_packs(id) ON DELETE CASCADE;
ALTER TABLE public.pack_ownership ADD CONSTRAINT pack_ownership_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;

ALTER TABLE public.reports ADD CONSTRAINT reports_pkey PRIMARY KEY (id);
ALTER TABLE public.reports ADD CONSTRAINT reports_reporter_id_fkey FOREIGN KEY (reporter_id) REFERENCES users(id) ON DELETE CASCADE;

ALTER TABLE public.active_sessions ADD CONSTRAINT active_sessions_pkey PRIMARY KEY (user_id);
ALTER TABLE public.active_sessions ADD CONSTRAINT active_sessions_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;

ALTER TABLE public.game_saves ADD CONSTRAINT game_saves_pkey PRIMARY KEY (user_id, game_id);
ALTER TABLE public.game_saves ADD CONSTRAINT game_saves_game_id_fkey FOREIGN KEY (game_id) REFERENCES games(id) ON DELETE CASCADE;
ALTER TABLE public.game_saves ADD CONSTRAINT game_saves_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;

ALTER TABLE public.game_likes ADD CONSTRAINT game_likes_pkey PRIMARY KEY (user_id, game_id);
ALTER TABLE public.game_likes ADD CONSTRAINT game_likes_game_id_fkey FOREIGN KEY (game_id) REFERENCES games(id) ON DELETE CASCADE;
ALTER TABLE public.game_likes ADD CONSTRAINT game_likes_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;

ALTER TABLE public.email_codes ADD CONSTRAINT email_codes_pkey PRIMARY KEY (email);

ALTER TABLE public.moderators ADD CONSTRAINT moderators_pkey PRIMARY KEY (user_id);
ALTER TABLE public.moderators ADD CONSTRAINT moderators_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;

ALTER TABLE public.moderation_actions ADD CONSTRAINT moderation_actions_pkey PRIMARY KEY (id);
ALTER TABLE public.moderation_actions ADD CONSTRAINT moderation_actions_moderator_id_fkey FOREIGN KEY (moderator_id) REFERENCES users(id) ON DELETE CASCADE;
ALTER TABLE public.moderation_actions ADD CONSTRAINT moderation_actions_report_id_fkey FOREIGN KEY (report_id) REFERENCES reports(id) ON DELETE SET NULL;

ALTER TABLE public.forum_threads ADD CONSTRAINT forum_threads_pkey PRIMARY KEY (id);
ALTER TABLE public.forum_threads ADD CONSTRAINT forum_threads_game_id_fkey FOREIGN KEY (game_id) REFERENCES games(id) ON DELETE SET NULL;
ALTER TABLE public.forum_threads ADD CONSTRAINT forum_threads_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;

ALTER TABLE public.forum_comments ADD CONSTRAINT forum_comments_pkey PRIMARY KEY (id);
ALTER TABLE public.forum_comments ADD CONSTRAINT forum_comments_thread_id_fkey FOREIGN KEY (thread_id) REFERENCES forum_threads(id) ON DELETE CASCADE;
ALTER TABLE public.forum_comments ADD CONSTRAINT forum_comments_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;

ALTER TABLE public.music_tracks ADD CONSTRAINT music_tracks_pkey PRIMARY KEY (id);
ALTER TABLE public.music_tracks ADD CONSTRAINT music_tracks_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE CASCADE;

ALTER TABLE public.creator_comments ADD CONSTRAINT creator_comments_pkey PRIMARY KEY (id);
ALTER TABLE public.creator_comments ADD CONSTRAINT creator_comments_author_id_fkey FOREIGN KEY (author_id) REFERENCES users(id) ON DELETE CASCADE;
ALTER TABLE public.creator_comments ADD CONSTRAINT creator_comments_creator_id_fkey FOREIGN KEY (creator_id) REFERENCES users(id) ON DELETE CASCADE;

ALTER TABLE public.creator_pages ADD CONSTRAINT creator_pages_pkey PRIMARY KEY (user_id);
ALTER TABLE public.creator_pages ADD CONSTRAINT creator_pages_pinned_game_id_fkey FOREIGN KEY (pinned_game_id) REFERENCES games(id) ON DELETE SET NULL;
ALTER TABLE public.creator_pages ADD CONSTRAINT creator_pages_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;

ALTER TABLE public.game_ratings ADD CONSTRAINT game_ratings_pkey PRIMARY KEY (game_id, user_id);
ALTER TABLE public.game_ratings ADD CONSTRAINT game_ratings_game_id_fkey FOREIGN KEY (game_id) REFERENCES games(id) ON DELETE CASCADE;
ALTER TABLE public.game_ratings ADD CONSTRAINT game_ratings_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;

ALTER TABLE public.collections ADD CONSTRAINT collections_pkey PRIMARY KEY (id);
ALTER TABLE public.collections ADD CONSTRAINT collections_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE CASCADE;

ALTER TABLE public.collection_items ADD CONSTRAINT collection_items_pkey PRIMARY KEY (collection_id, game_id);
ALTER TABLE public.collection_items ADD CONSTRAINT collection_items_collection_id_fkey FOREIGN KEY (collection_id) REFERENCES collections(id) ON DELETE CASCADE;
ALTER TABLE public.collection_items ADD CONSTRAINT collection_items_game_id_fkey FOREIGN KEY (game_id) REFERENCES games(id) ON DELETE CASCADE;

ALTER TABLE public.notifications ADD CONSTRAINT notifications_pkey PRIMARY KEY (id);
ALTER TABLE public.notifications ADD CONSTRAINT notifications_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;

ALTER TABLE public.project_revisions ADD CONSTRAINT project_revisions_pkey PRIMARY KEY (id);
ALTER TABLE public.project_revisions ADD CONSTRAINT project_revisions_game_id_fkey FOREIGN KEY (game_id) REFERENCES games(id) ON DELETE CASCADE;
ALTER TABLE public.project_revisions ADD CONSTRAINT project_revisions_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE CASCADE;

ALTER TABLE public.follows ADD CONSTRAINT follows_pkey PRIMARY KEY (follower_id, followed_id);
ALTER TABLE public.follows ADD CONSTRAINT follows_followed_fk FOREIGN KEY (followed_id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE public.follows ADD CONSTRAINT follows_follower_fk FOREIGN KEY (follower_id) REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE public.user_badges ADD CONSTRAINT user_badges_pkey PRIMARY KEY (user_id, code);
ALTER TABLE public.user_badges ADD CONSTRAINT user_badges_user_fk FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE public.activity ADD CONSTRAINT activity_pkey PRIMARY KEY (id);
ALTER TABLE public.activity ADD CONSTRAINT activity_user_fk FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE public.user_bans ADD CONSTRAINT user_bans_pkey PRIMARY KEY (id);
ALTER TABLE public.user_bans ADD CONSTRAINT user_bans_created_by_fkey FOREIGN KEY (created_by) REFERENCES users(id);
ALTER TABLE public.user_bans ADD CONSTRAINT user_bans_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;

ALTER TABLE public.changelog ADD CONSTRAINT changelog_pkey PRIMARY KEY (id);
ALTER TABLE public.changelog ADD CONSTRAINT changelog_author_id_fkey FOREIGN KEY (author_id) REFERENCES users(id);
CREATE UNIQUE INDEX IF NOT EXISTS changelog_commit_sha_key ON public.changelog (commit_sha) WHERE (commit_sha IS NOT NULL);

-- RLS enable (mirror old state; note 6 tables had RLS off)
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lobbies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.games ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.servers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.server_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.game_comments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.conversation_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.conversation_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.friendships ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.coin_ledger ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.theme_packs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pack_ownership ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.active_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.game_saves ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.game_likes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.email_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.moderators ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.moderation_actions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.forum_threads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.forum_comments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.music_tracks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.follows ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_badges ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.activity ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_bans ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.changelog ENABLE ROW LEVEL SECURITY;

-- RLS policies (mirror old)
CREATE POLICY "Anyone can read published games" ON public.games FOR SELECT USING ((published = true));
CREATE POLICY "Authenticated users can create games" ON public.games FOR INSERT WITH CHECK ((auth.uid() = owner_id));
CREATE POLICY "Owners can delete own games" ON public.games FOR DELETE USING ((auth.uid() = owner_id));
CREATE POLICY "Owners can read own games" ON public.games FOR SELECT USING ((auth.uid() = owner_id));
CREATE POLICY "Owners can update own games" ON public.games FOR UPDATE USING ((auth.uid() = owner_id)) WITH CHECK ((auth.uid() = owner_id));

CREATE POLICY "Anyone can read lobbies" ON public.lobbies FOR SELECT USING (true);
CREATE POLICY "Authenticated users can create lobbies" ON public.lobbies FOR INSERT WITH CHECK ((auth.role() = 'authenticated'::text));

CREATE POLICY "Anyone can insert messages" ON public.messages FOR INSERT WITH CHECK (true);
CREATE POLICY "Anyone can read messages" ON public.messages FOR SELECT USING (true);

CREATE POLICY "Anyone can read game comments" ON public.game_comments FOR SELECT USING (true);
CREATE POLICY "Authenticated can insert game comments" ON public.game_comments FOR INSERT WITH CHECK ((auth.role() = 'authenticated'::text));
CREATE POLICY "Game owners can delete comments on own games" ON public.game_comments FOR DELETE USING ((EXISTS ( SELECT 1 FROM games WHERE ((games.id = game_comments.game_id) AND (games.owner_id = auth.uid())))));
CREATE POLICY "Owners can delete own game comments" ON public.game_comments FOR DELETE USING ((auth.uid() = user_id));

CREATE POLICY "Members can read own membership" ON public.conversation_members FOR SELECT USING ((auth.uid() = user_id));
CREATE POLICY "Users can manage own membership" ON public.conversation_members FOR INSERT WITH CHECK ((auth.uid() = user_id));

CREATE POLICY "Users can read own read-state" ON public.conversation_state FOR SELECT USING ((auth.uid() = user_id));
CREATE POLICY "Users can write own read-state" ON public.conversation_state FOR INSERT WITH CHECK ((auth.uid() = user_id));

CREATE POLICY "Users can read own friendships" ON public.friendships FOR SELECT USING ((auth.uid() = user_id) OR (auth.uid() = friend_id));
CREATE POLICY "Users can request friendships" ON public.friendships FOR INSERT WITH CHECK ((auth.uid() = user_id));

CREATE POLICY "Users can read own ledger" ON public.coin_ledger FOR SELECT USING ((user_id = auth.uid()));

CREATE POLICY "Anyone can read published packs" ON public.theme_packs FOR SELECT USING ((published = true));
CREATE POLICY "Owners can read own packs" ON public.theme_packs FOR SELECT USING ((owner_id = auth.uid()));

CREATE POLICY "Users can read own pack ownership" ON public.pack_ownership FOR SELECT USING ((user_id = auth.uid()));
CREATE POLICY "Users can read own reports" ON public.reports FOR SELECT USING ((reporter_id = auth.uid()));
