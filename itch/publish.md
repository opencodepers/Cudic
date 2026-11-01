# itch.io setup — what's done and what's left

## Already done (2026-11-01)
- **API key** stored as `ITCHIO_API_KEY` in `.env` (gitignored).
  Verified live: it's the `opencodepers` account — https://opencodepers.itch.io
- **butler v15.32.0** installed at `C:\Users\sophi\.local\bin\butler.exe`
  (that folder is already on PATH). Authenticated headlessly: the key is
  stored in `%USERPROFILE%\.config\itch\butler_creds`, which is exactly where
  butler looks by default. Verified with a `butler status` round-trip.
- **Page text + launch devlog post** written in this folder:
  - `page.md` — the project page content and settings to use
  - `devlog-1-announcement.md` — the announcement post (honest about the AI build)

## The one step the API can't do
itch.io has no public "create project" endpoint, so the page shell has to be
created by hand once (about 30 seconds):

1. Sign in as **opencodepers** on itch.io (in the browser)
2. https://opencodepers.itch.io/dashboard → **Create new project**
3. Title `Cudic`, slug `cudic` (the default from the title)
4. Kind of project: **Tool**; Privacy: Published; Pricing: No payments
5. Save (draft is fine for now)

## Once the page exists
- Paste in the description from `page.md`, set the tags, add a cover image
  (630×500) and a screenshot or two of the Studio + a published game page.
- Paste the devlog post from `devlog-1-announcement.md` → Devlog → New post.
- Publish the page.

## Pushing game builds later
Cudic games export as zips with `index.html` at the top level — that's
exactly what itch hosts as HTML5 builds. For each game create a (separate,
free) project on the dashboard, then:

```
itch/push.sh <game-slug> html5 <path-to-unzipped-build> v1.0
```

Butler diffs and only uploads what changed, so re-pushing a build after
re-exporting is fast.
