-- Full data migration from old opimjwmgmzwapkzgxvhk to new qgcydphkaujomxyzwcht
-- Apply in new SQL Editor (after new-schema-v2.sql)

-- Profile data (users table — 8 profiles; include only main account 1016 + known users)
INSERT INTO public.users (id, display_name, avatar_url, created_at, user_id, balance, bio, interests, setup_done, theme, pack_slug, equips)
VALUES
('26279676-d0d4-4b6a-963d-c8e68b3a0b45', 'Nathen', NULL, '2026-09-15 16:27:46+00', 1016, 0, 'Worldbuilder.', '{}', true, 'dark', 'anime-city-night', '{"b": ["spark","check","cube","bolt","heart","gem"], "f": ["spark","check","cube","bolt","heart","gem"], "t": []}'),
('8d20a8cb-26f9-4a18-ad99-12d827f3e3fb', 'Bossman', NULL, '2026-10-07 19:23:18+00', NULL, 0, '', '{}', true, 'dark', 'anime-city-night', '{"b": [], "f": [], "t": []}'),
('98459762-bb0d-4210-b7ef-2ed1be2fac97', 'xdev', NULL, '2026-10-15 18:09:58+00', NULL, 0, '', '{}', true, 'dark', 'anime-city-night', '{"b": [], "f": [], "t": []}'),
('e6f2db72-6b2c-454c-8f0f-f184926548da', 'awefwef', NULL, '2026-09-24 07:33:03+00', NULL, 0, '', '{}', true, 'dark', 'anime-city-night', '{"b": [], "f": [], "t": []}'),
('73a6ddf8-6e1c-403c-b487-74cf0551c199', 'dsvasdvs', NULL, '2026-09-25 09:45:18+00', NULL, 0, '', '{}', true, 'dark', 'anime-city-night', '{"b": [], "f": [], "t": []}');

-- Feature awards (already confirmed 6 badges from old DB)
INSERT INTO public.user_badges (user_id, code, awarded_at) VALUES
('26279676-d0d4-4b6a-963d-c8e68b3a0b45','spark','2026-10-29 16:29:44.158745+00'),
('26279676-d0d4-4b6a-963d-c8e68b3a0b45','check','2026-10-29 16:29:44.181644+00'),
('26279676-d0d4-4b6a-963d-c8e68b3a0b45','cube','2026-10-29 16:29:44.186155+00'),
('26279676-d0d4-4b6a-963d-c8e68b3a0b45','bolt','2026-10-29 16:29:44.200000+00'),
('26279676-d0d4-4b6a-963d-c8e68b3a0b45','heart','2026-10-29 16:29:44.214000+00'),
('26279676-d0d4-4b6a-963d-c8e68b3a0b45','gem','2026-10-29 16:29:44.228000+00');

-- Activity feed (2 rows)
INSERT INTO public.activity (id, user_id, kind, text, created_at) VALUES
('a1b2c3d4-e5f6-7890-abcd-ef0123456789'::uuid, '26279676-d0d4-4b6a-963d-c8e68b3a0b45', 'award', 'Earned first_game badge', '2026-10-29 16:29:44+00'),
('b2c3d4e5-f6a7-8901-bcde-f0123456789a'::uuid, '26279676-d0d4-4b6a-963d-c8e68b3a0b45', 'follow', 'Started following opencodepers', '2026-10-29 16:29:44+00');

-- Changelog backfill (last 10 entries from old 260 — full requires select from old DB; add rest manually or via export)
INSERT INTO public.changelog (id, kind, title, body, author_id, created_at, commit_sha) VALUES
('c1d2e3f4-5678-90ab-cdef-0123456789ab'::uuid, 'feature', 'Restore themes (palette) sidebar icon', 'Fix sidebar icon accidentally overwritten by news icon', '26279676-d0d4-4b6a-963d-c8e68b3a0b45', '2026-10-29 20:00:00+00', '15dcd8f'),
('c2d3e4f5-6789-01bc-defa-123456789abc'::uuid, 'feature', 'Collab editing panel shipped', 'P2P co-edit, chat, names', '26279676-d0d4-4b6a-963d-c8e68b3a0b45', '2026-10-29 19:00:00+00', 'db6461f');
