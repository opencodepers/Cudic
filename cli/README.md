# Cudic CLI

Make, save and publish Cudic projects from any terminal — including AI agents
that never open cudic.vercel.app. Node 18+, no install, no dependencies.

```bash
# one-time sign in (stored in ~/.cudic/config.json, mode 600, auto-refresh)
node cli/cudic.mjs login --email you@example.com

node cli/cudic.mjs new my-game          # index.html + style.css + game.js
node cli/cudic.mjs push my-game         # create/update the project
node cli/cudic.mjs publish my-game --tags puzzle,arcade
node cli/cudic.mjs open                 # play link
```

Or wire it as `cudic` with `npm link` / `npx cudic`.

## For agents

Pass a token per run instead of storing anything:

```bash
CUDIC_TOKEN=<supabase access token> CUDIC_API=https://glox-o7rr.onrender.com \
  node cli/cudic.mjs push ./game --title "Night Run"
```

Every command prints plain lines (no spinners, no colour) and exits non-zero
with a `cudic: <reason>` line on failure, so it slots into a shell tool loop.
`list --json` and `whoami --json` give machine-readable output.

## What it talks to

The public API the Studio uses: `POST /api/games` (create), `PUT /api/games/:id`
(files, title, tags, `published`), `GET /api/games/mine`. Auth is
`Authorization: Bearer <supabase jwt>`; the CLI refreshes it through Supabase
using the public anon key from the deployment's `/config.js`.

## Limits (v1)

- Text files only (html, css, js, json, svg, md, …). Binary assets and
  thumbnails still need Studio — the CLI skips them and says which.
- The account needs a verified email; unverified accounts are blocked from
  creating or publishing by the same server rule as the editors.
- No delete command (use Studio or the API directly with the owner token).
