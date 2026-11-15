-- Clear the pack every row inherited from the old column default.
--
-- migration/new-schema*.sql declared users.pack_slug with
-- DEFAULT 'anime-city-night'. Removing the default (theme-pack-no-default.sql)
-- stopped new rows inheriting it, but accounts created before that still carry
-- the slug even though nobody picked the pack. Removing it in the UI sent the
-- right update, yet the pack returned on reload whenever the account row was
-- unchanged, so the stored value is cleared here once and for all.
--
-- Only the seeded value is touched: a pack someone actually installed under a
-- different slug stays.
UPDATE public.users
SET pack_slug = NULL
WHERE pack_slug = 'anime-city-night';
