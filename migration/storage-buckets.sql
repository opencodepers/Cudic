-- storage.from('game-assets') is used for every asset object, GitHub snapshot
-- and fork copy, but the bucket only existed in production as a stray policy:
-- the bucket itself was missing, so uploads and downloads failed with
-- NoSuchBucket. Avatars is redeclared so a fresh project gets both buckets.
-- Game assets are read through the API (service key), never by public URL, so
-- they stay private; avatars are pinned and served directly.
insert into storage.buckets (id, name, public)
values ('avatars', 'avatars', true),
       ('game-assets', 'game-assets', false)
on conflict (id) do nothing;
