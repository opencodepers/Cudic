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

## Reading Cudic from a terminal

```bash
node cli/cudic.mjs games --q puzzle --sort trending   # gallery (no login)
node cli/cudic.mjs get <game id> --out ./that-game    # source + assets + CUDIC.md
node cli/cudic.mjs forums --category showcase         # forum threads (no login)
node cli/cudic.mjs thread <thread id>                 # one thread with its replies
node cli/cudic.mjs docs cli                           # docs as plain text
node cli/cudic.mjs docs --search thumbnail            # search every section
node cli/cudic.mjs shop                               # catalog, prices, balance, owned
node cli/cudic.mjs shop buy sparkle_ring
node cli/cudic.mjs shop equip fr sparkle_ring         # slots: fr bn ef ne ti em
node cli/cudic.mjs shop equip ti --off                # clear a slot
```

Studio's snapshots too: `snapshot [dir] --label`, `revisions [dir]`, `restore <rev id>`.

`get` writes text files to disk, pulls binary assets from public storage and
leaves a `CUDIC.md` naming the author and source. Pushing that folder creates a
new project — the site's Remix button is what records the credit link.

## What it talks to

The public API the Studio uses: `POST /api/games` (create), `PUT /api/games/:id`
(files, title, tags, `published`), `GET /api/games/mine`. Auth is
`Authorization: Bearer <supabase jwt>`; the CLI refreshes it through Supabase
using the public anon key from the deployment's `/config.js`.

## Limits (v1)

- Pushing is text-files only (html, css, js, json, svg, md, …). Binary assets
  and thumbnails still need Studio — `push` skips them and says which. `get`
  does download existing assets.
- `get` only sees published games, plus your own drafts.
- The account needs a verified email; unverified accounts are blocked from
  creating or publishing by the same server rule as the editors.
- No delete command (use Studio or the API directly with the owner token).
