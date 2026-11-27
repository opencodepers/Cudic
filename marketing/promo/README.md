# Promo set

Real captures of the live site plus one vertical cut. Nothing here is a mockup:
every frame is the running app from `node server.js` at `localhost:3100`, signed
out, with the consent sheet suppressed via the `cudic_consent` cookie.

| File | What it is |
| --- | --- |
| `gallery-2880x1800.png` | `/games` — 14 real games, real covers, real creators |
| `studio-2880x1800.png` | `/studio` — the studio on the starter-template step |
| `themes-2880x1800.png` | `/themes` — theme pack list (one published pack) |
| `cudic-promo-9x16.mp4` | 1080×1920, 30fps, 13.2s, H.264 high, no audio |
| `poster-9x16.png` | Cover frame from the 1.4s mark |

Shots are 2× of a 1440×900 window. `/editor` is legacy — kept for memory, not a
product — so it is deliberately absent here and in the brand sheet.

## The clip

Three scenes, each a slow zoom on a real screenshot with the brand pixel cursor
moving and clicking a real control:

1. **Gallery** — click on the IronStorm card
2. **Studio** — the starter palette, then the editor
3. **Theme packs** — click Install

Cut is a 0.2s dissolve; panel clears before the end card fades in (~10.1s), so
there is no double exposure. The cursor is the mark from
`public/cudic-assets/brand/` rendered at 6× with its lime hotspot intact.

## Missing on purpose

`/chat` and `/shop` are behind the login wall — signed out, chat redirects to
`/login` and cosmetics shows "Sign in to buy". Capturing them needs a session
token.

## Regenerating

Sources live in `.freebuff/` (gitignored):

```
node .freebuff/brand-shots.mjs  # re-capture /games, /themes, /studio into .freebuff/shots/current-*.png
node .freebuff/clip.mjs         # frames + encode into this folder
```

`shots.mjs` needs the local server on port 3100; `clip.mjs` needs
`.freebuff/tools/node_modules/ffmpeg-static` and the Geist woff2 in
`.freebuff/brand-tmp/fonts/`.
