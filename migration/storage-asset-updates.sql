-- Re-saving a project overwrites assets at the same storage path. The bucket
-- had INSERT only, so Supabase rejected every overwrite (Studio showed
-- "asset upload 400"). Allow UPDATE, but keep the same ownership rule as INSERT:
-- the first path segment must be a game owned by the signed-in user.

drop policy if exists "Authenticated can update own game assets" on storage.objects;

create policy "Authenticated can update own game assets"
on storage.objects for update
to authenticated
using (
  bucket_id = 'game-assets'
  and exists (
    select 1 from games g
    where g.owner_id = auth.uid()
      and (storage.foldername(objects.name))[1] = g.id::text
  )
)
with check (
  bucket_id = 'game-assets'
  and exists (
    select 1 from games g
    where g.owner_id = auth.uid()
      and (storage.foldername(objects.name))[1] = g.id::text
  )
);
