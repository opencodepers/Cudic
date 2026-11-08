-- The insert policy only asked "is this an authenticated user", so any signed-in
-- account could write objects into any game's folder — including one it does not
-- own. Uploads always go to <game id>/… for a game the user just created or is
-- editing, so the folder itself can be the permission check.
drop policy if exists "Authenticated can upload game assets" on storage.objects;

create policy "Authenticated can upload own game assets" on storage.objects
  for insert with check (
    bucket_id = 'game-assets'
    and auth.role() = 'authenticated'
    and exists (
      select 1 from public.games g
      where g.owner_id = auth.uid()
        and (storage.foldername(name))[1] = g.id::text
    )
  );
