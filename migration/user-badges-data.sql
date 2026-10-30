-- User badges data (from old DB opimjwmgmzwapkzgxvhk — 6 rows)
INSERT INTO public.user_badges (user_id, code, awarded_at) VALUES
('26279676-d0d4-4b6a-963d-c8e68b3a0b45', 'spark', '2026-10-29 16:29:44.158745+00'),
('26279676-d0d4-4b6a-963d-c8e68b3a0b45', 'check', '2026-10-29 16:29:44.181644+00'),
('26279676-d0d4-4b6a-963d-c8e68b3a0b45', 'cube', '2026-10-29 16:29:44.186155+00'),
('26279676-d0d4-4b6a-963d-c8e68b3a0b45', 'bolt', '2026-10-29 16:29:44'),
('26279676-d0d4-4b6a-963d-c8e68b3a0b45', 'heart', '2026-10-29 16:29:44'),
('26279676-d0d4-4b6a-963d-c8e68b3a0b45', 'gem', '2026-10-29 16:29:44');

-- Activity feed (from old DB — 2 rows)
INSERT INTO public.activity (id, user_id, kind, text, created_at) VALUES
(gen_random_uuid(), '26279676-d0d4-4b6a-963d-c8e68b3a0b45', 'follow', 'Started following opencodepers', '2026-10-29 16:29:44'),
(gen_random_uuid(), '26279676-d0d4-4b6a-963d-c8e68b3a0b45', 'award', 'Earned first_game badge', '2026-10-29 16:29:44');
