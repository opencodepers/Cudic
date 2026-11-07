# AGENTS.md — Cudic

Everything an agent needs to work in this repo without rediscovering it.
Read this before touching code. Section 12 (Gotchas) and §12b (what goes wrong
when shipping a page or feature) are the ones that save you.

---

## 1. What this is

**Cudic** (renamed from **Glox** in commit `5add766`) — a browser tool for building
and playing small games/sites: chat lobbies, a game gallery, a scene/game editor,
theme packs, and a VS Code workbench shell at `/studio`.

- **Not open source.** `README.md` is an all-rights-reserved notice. Don't publish,
  fork, or paste this code anywhere.
- Repo: `nathent2023-glitch/Cudic`. Primary branch **`master`**.
- Split deploy: static frontend on **Vercel**, Node API/WS on **Render**.

### Two editors, don't confuse them

| Route | What it is | Palette |
|---|---|---|
| `/editor` | The **classic** editor (legacy, still shipped). Design doc says it's exempt from the light theme. | dark |
| `/studio` | **Cudic Studio** — VS Code workbench via `@codingame/monaco-vscode-api`. This is where active work happens. | dark, IDE |

`design.md` v2 (asset-pack based, `public/cudic-assets/`) governs the classic pages;
editor/studio stay dark IDE chrome (see §11). Both routes exist and are served.

---

## 2. Stack

- **Node + `server.js`** — one hand-rolled HTTP server: static files, REST API,
  WebSocket, email verification, AI proxy. No Express; routes are `if (url.pathname === ...)`.
- **`ws`** for realtime; **`@supabase/supabase-js`** for auth + DB + storage;
  **`nodemailer` / `resend`** for verification mail; **`dotenv`**.
- **Frontend**: plain HTML/CSS/JS in `public/`. No framework, no bundler for the
  classic pages — vanilla script tags. Studio is the exception (Vite).
- **Studio**: Vite 6 → `public/studio/` (gitignored, built locally/on Vercel),
  monaco-vscode-api 37.x, `esbuild` for ad-hoc bundling.
- **Design system**: `design.md` is the single source of truth for color/type/spacing;
  the asset canon (`public/cudic-assets/` README + manifest.json) is the source for
  icons/emoji/cursors/logo recolors.

### Dependencies actually in use
`ws`, `@supabase/supabase-js`, `dotenv`, `nodemailer`, `resend` (root).
Studio: `@codingame/monaco-vscode-*` (~40 override packages), `monaco-editor`,
`vscode` (alias to the extension API), `gsap`, `jszip`, `mammoth`.
Classic pages: **Web Awesome 3.14.0** via pinned CDN (`sidebar.js` injects default
theme + `webawesome.loader.js`; components load on demand only when a `<wa-*>`
tag exists). No build step, no framework — do not add one. Hand-roll visuals to
`design.md`; use `wa-*` only for behavioural widgets (dialog, dropdown, tooltip,
toast, tabs). Dark mode is our own token block (`:root[data-theme="dark"]`,
`glox_theme` = dark/light, dark default) — `wa-dark` unused.

---

## 3. Commands

```powershell
# root
npm start            # node server.js  → http://localhost:3000
npm run dev          # same thing

# studio (REQUIRED before testing /studio changes — output is gitignored)
cd studio
npm run build        # vite build → ../public/studio/   (~1-2 min, 13MB bundle)
npm run dev          # vite dev server

# islands (React components inside classic pages — output is COMMITTED)
cd islands
npm run build        # vite build (lib IIFE) → ../public/islands/  (~5s, 657KB)
```

- Shell is **PowerShell 5.1**: use `;` not `&&`. Quote paths with spaces.
- **Restart `server.js` after editing it** — no hot reload.
- **Rebuild Studio after editing anything under `studio/src/`** — `public/studio/`
  is gitignored, so what you see in the browser is always the last build.
- **Rebuild islands after editing anything under `islands/src/`** — unlike
  Studio, `public/islands/` IS committed (Vercel builds no JS), so rebuild
  then commit the bundle. Bump `islands.js?v=N` + `cudic-islands.css?v=N`
  (currently **v7**) on using pages after rebuilding.
- Bump `sidebar.css?v=N` across all pages when editing `public/sidebar.css`
  (currently **v24**) — pages cache CSS aggressively. Same for
  `sidebar.js?v=N` (currently **v14**) / `client.js?v=N` (currently **v7**) after editing those.
  New shared scripts take `?v=1` (`ctheme.js`, `csel.js`).
- **Test suite exists**: `python tests/run_tests.py` (~130 stdlib tests; boots
  server.js itself on :3000, appends machine-readable history to
  `tests/results.json`). Run it after every server/page/library change —
  regression pins in `tests/test_regressions.py` re-read source files, so
  doc claims in AGENTS.md/CHANGELOG are load-bearing. `CUDIC_TEST_TOKEN` adds
  signed-in e2e. Playwright MCP is **disabled**; the browser tools that
  work here are `chrome-devtools` (screenshots return media inline when no
  `filePath` is given) and `public-browser`. Headless Chrome `--screenshot` is
  unreliable in this environment — do not use it to verify visuals.
- **Ship ritual — docs travel with the code**: every user-visible feature
  updates, in this order, before the work counts as done:
  1. the public help pages users actually read (mostly `public/docs.html`
     bullets, or a `public/cookbook/*.html` note when a code helper gains
     something — e.g. CudicScores under the clicker guide),
  2. `CHANGELOG.md` (Unreleased, user-facing wording),
  3. `AGENTS.md` §5 API rows + §6 table rows when server surface changes.
  A feature without docs is an unfinished feature — same bar as tests.
  (Internal-only changes still get CHANGELOG + AGENTS.md when they alter
  behavior an agent must not quietly re-break.)

---

## 4. Layout

**STANDARD PAGE SHELL — every main tab (`/shop`, `/race`, `/faq`, `/friends`, …) must use it.**
Body carries `data-page="<page>"` and renders `<div class="<page>-layout page-panel">
→ .topbar (h1 = page name + right-side utility link or pill) → .<page>-scroll
(overflow-y:auto) → content`. The sidebar rail comes free from sidebar.js/css.
NEVER build bespoke page scaffolds: no separate full-page body layouts, no
invented heroes/marquees/float columns, no missing rail, no page-side body
scroll. Style INSIDE the shell freely (flat/brand-kit looks are fine — see
shop.html + race.html), but the shell chrome is not optional and not
customizable per page.

```
server.js                 # ~4000 lines: HTTP + API + WS + AI proxy + email
cli/cudic.mjs             # terminal + agent client: login/whoami/list/new/push/publish/open
public/                   # the classic app (served at Vercel output root)
  index.html              # marketing landing (dark, animated, GSAP)
  login.html              # auth split screen (sign in / create / guest)
  chat.html  lobbies.html # chat
  server.html             # server space: /server/<id> — Discord-style channel sidebar
                          # + live stream in the site capsule (same WS protocol as chat;
                          # lean by design — no reporting/mod panel, use /chat for those)
  servers.html            # server list + comments
  games.html  view.html   # gallery + game view (GSAP motion)
  play.html  run.html     # play + run harness (document.write player)
  profile.html            # profile
  themes.html             # theme pack store
  editor.html             # classic editor (65KB, legacy)
  docs.html               # /docs knowledge base; docpage.js builds its section nav
  parents.html            # /parents (+ /teachers alias) teachers & parents landing — brand-kit style
  cudic-touch.js          # in-game on-screen D-pad/buttons for phones (CudicTouch)
  sidebar.css  sidebar.js # shared rail nav on every page
  theme-engine.js         # window.CudicTheme — pack boot/apply/install/clear
  config.js  auth.js  client.js   # shared client helpers
  cudic_sfsvg.svg         # C mark — favicon + rail badge  (NEVER DELETE)
  cudic_sfpng.png         # PNG version of same           (NEVER DELETE)
  cucid.svg               # full wordmark (user's logo)   (NEVER DELETE)
  fonts/                  # incl. "Nine Circles" (free commercial license)
  assets/kenney/          # 674 CC0 game/board-game/emote icons + manifest.json
                         # (served statically; picked by glox.insertIcon)
  packs/                 # static theme packs: index.json + <pack>/manifest.json
                         # (NOT themes/ — a /themes dir shadows the /themes rewrite on Vercel)
  studio/                 # ← GITIGNORED build output
studio/
  vite.config.js          # base '/studio/', outDir '../public/studio'
  src/main.ts             # workbench bootstrap, service overrides, title bar icon
  src/glox.ts             # Preview tab, Run, context menus, preview assembly   src/project.ts          # save/import/export/publish/delete project commands
                          # publish asks for ≤3 tags (showInputBox) and PUTs them

  src/cudic-ai/           # ← the AI panel (see §7)
  src/collab.ts           # ← collab editing panel: P2P co-edit, chat, names (see §7b)
supabase/
  schema.sql              # base schema
  migrations/             # 4 dated migrations
design.md                 # design system source of truth
PROJECT_MEMORY.md         # credentials index + user preferences
vercel.json               # rewrites + cache headers + build command
render.yaml               # Render service (PORT 10000)
```

### Pages & routes
Vercel rewrites (`vercel.json`) map extensionless paths → `.html`:
`/` → index (landing), `/login` → login.html, `/profile`, `/chat`, `/games`,
`/race` → race.html (creator race leaderboard), `/themes`, `/editor`, `/servers`,
`/server/:id` (server space), `/lobbies`, `/docs`,
`/faq`, `/teachers` → `/parents` (classroom landing), `/cookbook/` guides,
`/studio` → `studio/index.html`.
`server.js` mirrors all of these for local dev.

Cache rules: `.html` = `no-cache`; `.js`/`.css` = `max-age=0, must-revalidate`;
`/studio/assets/*` = `immutable, 1y`.

---

## 5. server.js map

| Lines (approx) | What |
|---|---|
| 15–30 | `validName`, `rateLimit(key,max,windowMs)`, `clientIp` |
| 34–100 | mail transport (Gmail API → Resend → Brevo, HTTPS-only), `MIME` map, `cors` |
| 685 | `readBody(req)` |
| 726–752 | **`AI_HOSTS` whitelist** + `/api/ai/fetch` proxy |
| 872 / 952 | `walk()` — studio project file tree + assets |
| 1080–1114 | `broadcast`, `getLobbyList`, `sendLobbyListToAll` |
| 1114 | `saveMessage(lobby, userId, displayName, text)` |
| 1333 | `server.listen(PORT)` — logs `Cudic is running → http://localhost:${PORT}` |

### HTTP endpoints
```
POST /auth/send-code  POST /auth/verify-code    GET  /auth/check-verified
GET  /auth/verification-required (login hard gate — same rule as needVerified)
GET  /auth/callback (GitHub OAuth)
GET  /api/session               GET|PUT /api/profile
GET  /api/messages              (newest 100, oldest-first; lobby list runs over WS, not REST)
                                  ?before=<ts> paginates older rows; ?pinned=1 returns
                                  only pinned rows — powers the chat's pinned shelf
GET  /api/messages/reactions    ← per-room reaction counts (newest 200 messages)
POST /api/messages/:mid/pin     ← author or the channel's owner/mod toggles `pinned`
POST|DELETE /api/messages/:mid/react ← emoji reaction; one row per (msg, user, emoji),
                                  so re-reacting upserts, never double-counts
                                  (table: `message_reactions`, migration/pins-reactions-slowmode.sql)
GET  /api/servers/:sid/members  ← owner/mod roster incl. bans (chat mod panel)
PUT|DELETE /api/servers/:sid/members/:uid ← owner sets mod/member; kick (owner or mod)
POST|DELETE /api/servers/:sid/bans/:uid   ← ban (drops membership; JOIN refuses banned
                                  ids) / unban (migration/server-roles.sql). Channel
                                  PATCH also takes `slow_seconds` (0–600; 0 = off)
GET|POST /api/servers           GET /api/servers/mine
GET  /api/search?q=&type=        ← PUBLIC ranked games/threads/people search
GET  /api/activity?limit=         ← PUBLIC recent activity feed
GET  /api/ops/status              ← mod-only health counts (page: /ops)
GET  /api/push/config             ← PUBLIC push key + enabled flag
POST /api/push/subscribe|unsubscribe|test
GET  /api/games                 GET|POST /api/games     GET /api/games/mine
GET  /api/games/:id/thumbnail   ← card art as real image bytes (1-day cache)
GET  /api/games/:id/live        ← in-memory room head-count (`{playing}`) for the
                                  game page's pill; unauth, no-store, no DB
GET|POST /api/games/:id/scores  ← leaderboards: GET is public (top-N, names only,
                                  ?range=all|week — week filters on
                                  updated_at >= Monday 00:00 via weekStartISO),
                                  POST is signed-in+seat-checked and keeps the
                                  player's best run (read-then-write); rows live
                                  in `game_scores`
GET  /api/games/:id/related     ← PUBLIC: `{by_creator, similar}` for the game
                                  page's "More from this creator" / "More like
                                  this" shelves — same maker's other published
                                  games + tag overlaps, thumbnail-free rows,
                                  must stay above the generic :id GET
POST /api/games                 ← create: accepts tags via shared sanitizeTags
                                  (lowercase, [a-z0-9-], dedupe, ≤8) — same rules
                                  as the PUT edit path; editor publish modal +
                                  Studio publish prompt are the two tag UIs
GET|POST /api/music             ← Music Lab cloud saves (owner-scoped); browse-by-title
GET  /api/music/browse           ← PUBLIC: any user's track titles/owners, no data
GET  /api/music/:id/public       ← PUBLIC: one track's playable data (1-min cache);
                                  fetched by /cudic-music.js in the game frame
POST /api/ai/fetch              ← the AI proxy (see §7)
GET  /favicon.ico               → serves public/cudic_sfsvg.svg
GET  /themes                    theme pack store
POST /api/session/claim|heartbeat  DELETE /api/session
GET|PUT|DELETE /api/saves/:gameId  ← account-bound saves (100KB cap)
POST /api/scratch/import           ← .sb3 / Scratch URL → split player files
POST/DELETE /api/follow/:id        ← one-way follow (30/h). GET /api/feed (me+followed, 60)
                                    the game page's author row also follows via
                                    POST/DELETE /api/follow/<author id> (view.html)
GET  /api/badges                   ← public award catalog + equip caps
GET  /api/feed/games               ← follow feed SHELF: newest published games by
                                    who this viewer follows (distinct from /api/feed)
GET  /api/jam                      ← PUBLIC jam standings for this week
GET  /api/race                     ← PUBLIC creator-race standings (GET is
                                  authless; optional Bearer adds `me` {place,
                                  points}): `{week, ends_at, top20, me,
                                  total_creators, last_winners}`; any view
                                  lazily settles finished weeks (raceSettle)
GET|POST|DELETE /api/jam/vote      ← vote state / vote / unvote; one vote per
                                    account per week — a second vote MOVES it
                                    (prior row is deleted first); votes live
                                    in `jam_votes` (migration/jam-votes.sql)
GET  /api/friends                  ← also returns `following`/`followers` lists
GET  /api/notifications            ← per-user inbox; POST /api/notifications/read marks all
GET  /api/mod/*                    ← mod-only: users search, user-awards, grant/revoke, message, ban/unban/bans
+ static file serving from public/
```
WebSocket: `new WebSocketServer({ server })` — lobby presence, typing, broadcast,
lobby list fanout. Homepage listens as a watcher.

### Cudic CLI (`cli/cudic.mjs`)
Terminal + agent client for the project API (Node 18+, no deps, `bin` entry in
`package.json`). No new server surface — it calls `GET /api/games/mine`,
`POST /api/games` and `PUT /api/games/:id` exactly like Studio, so the
verified-email gate, `sanitizeTags`, publish hooks and `onPublished` behave
identically. Auth is a normal Supabase JWT: `CUDIC_TOKEN` for one-shot runs,
otherwise `login` (email+password grant) stores access+refresh tokens in
`~/.cudic/config.json` (mode 600) and refreshes on 401. Supabase url + anon key
are read from the deployment's `/config.js` — never baked into the CLI. Files
travel as text in `games.files` (html/css/js/json/svg/md); binaries are skipped
with a note since asset upload needs the Studio storage path. A pushed folder
keeps its id in `.cudic.json`, so `push`/`publish`/`open` need no id. `CUDIC_API`
/ `CUDIC_WEB` / `CUDIC_HOME` point it at another deployment.

Read paths use the public endpoints with `auth: false` (works signed out):
`games` → `GET /api/games`, `get <id>` → `GET /api/games/:id` (+ asset
objects from `game-assets` public storage; a `CUDIC.md` credit note is written
next to the source, and no `.cudic.json` so pushing makes a fresh project
rather than clobbering someone else's), `forums`/`thread` →
`/api/forums/threads`, `docs` scrapes `${CUDIC_WEB}/docs` into text, `shop`
reuses `/api/cosmetics` + `/buy` + `/equip`, and `snapshot`/`revisions`/`restore`
drive the owner-only `project_revisions` routes (snapshot sends the folder's
files map, same shape Studio stages). Never add a bespoke server endpoint for
the CLI: extend the client.

Editing paths: `pull` = `GET /api/games/:id` written over the folder after a
local backup; `ls`/`cat` read either the folder or `--id <game>`; `push` keeps
one local backup of the previous server copy before it PUTs; `unpublish` is
the `published:false` PUT and `rm` needs `--yes` (a bare `rm` prints the target
and exits 1). Local undo lives in `.cudic-backups/<timestamp>/` inside the
project folder, newest 10, dot-prefixed so `collect()` never pushes it —
`backups`/`recover` only touch that folder. `profile set` writes
`PUT /api/profile` (display_name/bio/interests/avatar_url) and inherits the
server's rules (24-char name, 200-char bio, avatar must be in the avatars
bucket). Avatar uploads stay browser-only.

### API keys + MCP (`migration/api_keys.sql`, `cli/cudic-mcp.mjs`)
Agents authorize with scoped `cudic_…` keys instead of a JWT. `userOf(req)`
resolves either credential (Bearer JWT, `X-Api-Key`, or a Bearer `cudic_…` key),
and `hasScope(user, scope)` restricts only key-backed users — browser sessions
stay unrestricted. Keep the guard on every route that touches account data:
`/api/games` POST/PUT/DELETE need `projects:write`; `/api/games/mine` and the
single-game GET need `projects:read`; `/api/profile` needs `profile:read`.
Keys are unique sha256 hashes, shown once, 12 active max, revoked by setting
`revoked_at`, and can never create keys (`/api/keys` stays `requireUser`, JWT
only). `last_used_at` updates are fire-and-forget and must never fail a
request. The MCP server is stdio newline-delimited JSON-RPC (no Content-Length
framing) and shells the same HTTP API — extend `TOOLS` + `callTool`, never add
a server endpoint for it.

### Auth pattern
Every gated route: pull `Authorization: Bearer <supabase jwt>` →
`supabase.auth.getUser(token)` → 401 `{"error":"Sign in to ..."}` if bad.

### Email verification (hard gate, total coverage)
`needVerified(user, res)` 403s `email_unconfirmed` for unconfirmed email
signups (GitHub OAuth + pre-2026-10-11 accounts exempt via
`userUnconfirmed()`). Invariant: **every authenticated state-changing
endpoint calls it** — the only ungated writes are the session/seat trio,
play counts (open by design), read receipts (read-path), and the auth
endpoints themselves. Login + chat boot bounce unconfirmed users to the
code screen (`GET /auth/verification-required`, same rule). A daily
`purgeUnconfirmed()` sweep deletes email accounts still unconfirmed after
24h (profile + owned rows cascade from `auth.users`), so the user list
holds real accounts only.

### Reports + moderation (plan.md 2.1–2.2)
`POST /api/reports` takes pack/game/message/user (reason required, 20/hour
per user). Message reports require seeing the room; user reports reject
self-reports. Chat Flag buttons arm from history ids + a `message_saved` WS
patch keyed by client `cid` — never await the insert before broadcast.
Mod-only: `GET /api/reports/queue|mine`, `POST /api/reports/:id/action`
(dismiss/reviewing/actioned/unpublish/delete_message, all in
`moderation_actions`), `/moderate` page. Moderators = `moderators` table
(auth UUIDs, service-role only); needs migration
`20261014120000_moderation.sql`. Pre-migration the queue safely 403s.

### Onboarding + account deletion
`/welcome` wizard (Username → Password for email accounts → Style accent),
non-skippable UI, fenced at login boot, post-auth routing, and chat OAuth
return — all on explicit `setup_done === false` only. `users.setup_done`
needs migration `20261015120000_profile_setup.sql` (grandfathered true).
`DELETE /api/account` (seat-checked) purges storage best-effort, then
deletes the auth user; rows cascade. Profile Security holds the delete
modal (typed random code + hold-to-confirm, no captcha provider).

### Music tracks (account cloud saves)
`music_tracks` table (owner, title, data jsonb, service-role only) +
`/api/music` CRUD (verify-gated, seat-checked writes, 100KB cap).
`music.html` syncs signed-in users (debounced PUT/POST, localStorage
mirror); guests stay local. `?track=` deep link; switching reloads so
one-shot builders never double-bind. Needs migration
`20261014130000_music_tracks.sql`. Your Projects tab unifies Studio
projects + unpublished pack drafts (`/themes?edit=`) + tracks.
**No composing in Studio** — `cudic-music/extension.ts` adds the bottom-panel
Music tab, a read-only picker: `Yours` (authed `/api/music`, `?q=` title
filter) and `Everyone` (public `/api/music/browse`, no auth). Picking a
track writes `/workspace/music.json` `{id,title,from}`; games play it with
`public/cudic-music.js` → `CudicMusic.play(id)` (public
`/api/music/:id/public`, gesture-safe — waits for the first click if the
AudioContext can't start).

### Single-seat sessions (one live seat per account)
Client mints a random seat id at login (`cudic_seat` in localStorage; fresh
mint = takeover) and the leader tab heartbeats it every 30s
(`POST /api/session/heartbeat`; 90s expiry; no row = grandfathered free
pass). Page loads claim ONLY when minting fresh (no seat) or after Take
over; normal loads heartbeat (refresh-or-learn, never kicks). A real
takeover 403s the old seat (`{"error":"session_superseded"}` on checked
paths: WS join/send, AI proxy) → paused banner with Take over (fresh seat
+ claim + reload). Same-browser tabs share the seat and stand down
silently when another tab leads (no banner — they keep working).
Tabs elect a leader via `cudic_tab_lock` (10s stale, 5s refresh) —
the server can't tell tabs apart; only the leader beats. Seat travels as
`X-Seat` header / `msg.seat` / body field. Table: `active_sessions`
(RLS locked, service key only). Tested end-to-end (20 checks, temp user,
cleaned up) — see `/api/session/claim|heartbeat` + `seatAlive()`.

### Weekly digest email (Monday, verified accounts)
Module-level `weeklyDigest()` near the purge job: half-hourly interval,
sends once per week (marker = `digest.json`, same file trick as
`weekly.json`). Waits for a configured transport (GMAIL_* / RESEND_API_KEY /
BREVO_API_KEY) before spending the week — no config, no send, no marker.
Content: current jam theme (from weekly.json), last week's winner tally
(READ-ONLY `jam_votes` scan — payouts stay in settleJam), and up to 3
newest published games from creators the reader follows. Recipients:
confirmed auth accounts only (`userUnconfirmed` filter), 8×100 page cap,
250 ms between sends. Tests: `WeeklyDigestEmail` in test_regressions.py.

### Weekly creator race (`/race`, `race_plays` + `race_weeks`)
Habit loop: one point per **unique player** per published game per week
(Monday 00:00 UTC — same clock as the jam and digest; reuse
`digestWeekStart`, do not reinvent a week boundary). The play endpoint
inserts a `race_plays` row per counted play, viewer = sha256 of the IP,
salted with the literal `race|`; the (week, game_id, viewer) PK makes the
dedupe — points are unique players, never play events, and nothing
personal is stored. Leaderboard: `raceTop(week)` aggregates in JS, joins
names via users. Settlement (`raceSettle`, hourly timer + lazy on any
/api/race view + before the digest mail): insert the `race_weeks` row
FIRST (its PK is the double-pay lock), THEN `grant_coins` (reason
`race:<week>`) + `awardUser` (race_winner / race_top3) + `notify`. Weeks
with no plays still get an empty row so a finished week never re-settles.
Page: `public/race.html` (+ `/race` redirect), rail link in sidebar.js
(coin icon). Migration: `migration/race.sql` — the server degrades to an
empty race when the tables are missing. Digest: weeklyDigest now adds a
per-creator personal stat line using race_plays + game_likes + forked
games for the batch, and lists the settled race winners.

### In-game achievements (CudicAch shim)
Same sandbox shape as CudicScores/CudicSave: the game frame calls
`CudicAch.unlock('speedrun')` (public/cudic-ach.js), the request goes
game frame → view.html postMessage → `POST /api/games/:id/achievements`
with the viewer's own session. Server re-checks verified + seat + rate
limit (30/min) and locks the code charset (`[a-z0-9][a-z0-9_-]{0,31}`).
Table `game_achievements`, one row per (game, player, code) — the PK is
the dedupe; a lost insert race resolves `first:false`, never an error.
Signed-out/unverified players get a guest ack (`signed-out`), so the game
shows "sign in to earn achievements". `GET .../achievements` is public:
code + holder counts only, no ids. Profile shelf: `/api/profile` AND
public `/api/user` both ship recent unlocks (games.title via FK join,
limit 12) → profile.html `#sec-ach` card. Migration: `migration/achievements.sql`.

### Game devlog (game_posts)
`GET/POST/DELETE /api/games/:id/devlog(/:postId)`: GET is public on
published games, POST/DELETE are the creator only (seat + verified +
rate-limited 10/min, body ≤ 8000 chars, 5 posts per game server-side).
Posting pings the follow feed via `logActivity(user.id, 'devlog', …)`;
profile/notifications untouched. view.html renders the Devlog card as
DOM nodes (`textContent` — post bodies are text, never markup) and
reveals the composer to the owner via the `cudic-owner-yes` event
checkOwner already dispatches. Migration: `migration/devlog.sql`.

### Daily login streak (rides the session beats, no new endpoints)
`rollStreak(user.id)` fires on both `/api/session/claim` and
`/api/session/heartbeat`. UTC day; `last_active_day === today` no-ops, the
chain continues only when the last day was yesterday. The day update filters
on the previously-seen `last_active_day` so two racing tabs advance it at
most once; coins pay via `grant_coins` with reason `streak:<date>` (ledger
idempotent, `5 + days` capped at 25). Self-view `/api/profile` ships
`streak_days` (profile.html `#sec-streak` card); the public `/api/user`
projection omits it. Migration: `migration/streak.sql`.

### Project revisions (staged snapshots, `project_revisions` table)
`POST/GET /api/games/:id/revisions` (+ `/restore`, `DELETE /:revId`), owner
only, newest 20 kept (oldest row deleted when the ring overflows). **Save
snapshot is staged**: Studio diffs the workspace text files against the newest
snapshot's map and shows a QuickPick checklist (new/changed/deleted,
pre-checked); unchecked files are stored at their previous snapshot content so
the row is literally "last snapshot + what was staged" — restore is still a
plain full replacement of `games.files`. The POST accepts an owner-supplied
staged `files` map (strings only, path ≤300 chars, ≤500 files, 4MB readBody
cap) and falls back to the saved project row when absent/invalid. Staging
logic in `studio/src/revisions.ts` (mirrored test:
`.freebuff/dbgtest/stage-test.js` — keep in step if you edit it). Snapshots are
content-addressed: `revision_blobs` holds each unique file body once (PK
`(game_id, hash)`), the revision row stores `manifest` path → hash, and legacy
rows keep `files`. Read/restore must go through `revisionFilesOf(row)` — reading
`rev.files` directly returns empty for manifest rows. The cap is 100 snapshots;
a failed blob upsert falls back to a plain `files` copy so a missing migration
never breaks saving. Diff is owner-only
`GET /api/games/:id/revisions/:revId/diff?against=current|prev|<id>`, with
`?file=<path>` returning both bodies.

### Cloud game saves (progress follows the account)
Table `game_saves` (pk(user_id, game_id), `data` jsonb, RLS locked).
Endpoints above; all seat-checked (403 `session_superseded`). Games never
touch the token (sandboxed iframes) — `public/cudic-save.js` (`CudicSave.load/
save/clear`, local mirror + debounced cloud, legacy-key import) talks to the
parent via postMessage; `view.html` mediates with its own session and shows
guests a one-time sign-in nudge (no guest persistence). The Studio preview
mediates too (`registerPreviewSave` in `glox.ts`), but keeps testing **local**:
its own slot in the workbench's storage keyed by project id, never the cloud
row — a preview cannot overwrite a player's save (or the author's), and it
works signed out. A never-saved project shares the `draft` slot.
Last-write-wins by `updated_at`; mid-run boards don't sync (bests + full
clicker-style state only). Tested end-to-end (17 checks, temp user+games,
cleaned up).

### In-game multiplayer (rooms over the same WebSocket)
`public/cudic-multi.js` is the game-side API: `CudicMulti.join('code')` →
`net.send(obj)` / `net.on('open'|'peers'|'msg'|'error')` / `net.id` / `net.leave()`.
Same security shape as saves — the sandboxed frame holds neither the token nor a
socket; the host page mediates (`multi_join`/`multi_msg`/`multi_leave` over the
existing WS, one connection per room, `onclose` rejoins while the game still
wants the room). Two hosts: **`view.html`** for players, and **`glox.ts`
(`registerPreviewMulti`)** for the Studio preview, which joins `<project>:preview`
so a preview never collides with the published game's rooms. `embed.html` and
`play.html`/`run.html` do not mediate — `join()` reports a clear error there
instead of going quiet. Rooms are **anonymous on purpose** (guests must be able
to play along) and keyed `game:room`, room code defaulting to `'main'`.

Identity comes from the server, never the client: a join may carry the login
token, and if it verifies the peer is `users.display_name` with their account id
attached; otherwise the peer is `'Guest'` (a client-supplied name is ignored, and
a peer id already taken in the room is replaced, so nobody can clone a name or a
session). Caps live in `server.js`: 32 per room, 8 KB per message, **per
connection** 20 joins/min and 200 msgs/10s (the IP buckets — 400 joins/min, 8000
msgs/10s — are only a backstop against one host opening a socket fleet; per-IP
keying made a whole school share one budget). Each peer's account id stays on the
host page: the game frame receives names only.

"Playing now" is `liveCount(game)` over the in-memory rooms, served as `playing`
on `GET /api/games` and on the single-game `GET` (so the gallery badge needs no
extra request and the game page has a number before the game joins). Game rooms
are separate from `lobbies`/`clients`, so chat, seats and the lobby list are
untouched. Verified with a 30-check Node WS test (incl. shared-IP fairness,
name/id spoofing, live counts returning to 0) + a real browser frame relaying to
a Node peer both ways. **Restart `server.js` after editing this path**, and
remember a new mediator must stamp `req` on every reply it sends to the game or
the game-side router drops it.

Moderation: nothing in a room is stored, so a game's chat is not reviewable after
the fact. The game page's live strip therefore reports a **player by account**
(`content_type: 'user'` through the existing report modal — `window.CudicReport`
in `islands/src/islands/report-button.tsx`), and the copy tells the reporter to
write what happened because the note is the only evidence. Guests have no
account and cannot be reported by id; report the game there.

### Env (all in gitignored `.env`, never commit)
`SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_KEY`, `PORT`,
plus optional `GMAIL_CLIENT_ID/CLIENT_SECRET/REFRESH_TOKEN/SENDER`, `RESEND_API_KEY`, `GITHUB_CLIENT_SECRET`,
and `GITHUB_TOKEN_KEY` (seals the Connect-GitHub OAuth token at rest; unset turns
that one feature off, nothing else).
`.env.example` lists the core four. `PROJECT_MEMORY.md` indexes where secrets live
(it contains public IDs only — client ID, project ref — those are fine).

---

## 6. Database

Supabase project `opimjwmgmzwapkzgxvhk`.
Tables: `users`, `lobbies`, `messages`, `games`, `game_comments`, `servers`,
`server_members`, `active_sessions`, `game_saves`, `game_scores` (leaderboards;
migration/game-scores.sql, RLS closed — reached only through server.js),
`notifications`. Trigger `on_auth_user_created` creates the profile on signup.

**Chat history is permanent.** Nothing deletes `messages` except the moderator
`delete_message` action. `lobbies.persistent` is vestigial (the old 2h sweeper
that emptied `persistent = false` rooms was removed — do not bring it back); it
is written `true` on create and every existing row was backfilled to `true`.
`GET /api/messages` serves the **newest** 100, reversed to oldest-first, because
the client renders history top-down.

Migrations:
- `20260919181404_studio_files.sql` — `games.files jsonb` + storage policies
- `20260921182000_lobby_creator_set_null.sql` — FK `ON DELETE SET NULL`
- `20260923120000_studio_assets.sql` — `games.assets jsonb`
- `20260924120000_game_comments.sql` — comments table + RLS policies
- `20261003120000_chat_channels_dm.sql` — lobbies get `kind`/`server_id`/`topic`/`is_private`, `server_members.role`, `conversation_members` (access), `conversation_state` (read receipts), `friendships`; legacy rooms deleted
- `20261003130000_avatars.sql` — public `avatars` storage bucket + policies
- `20261003140000_server_rules.sql` — `servers.rules`, `server_members.rules_accepted_at` (grandfathered); server create endpoint reads channel bundles from the `SERVER_TEMPLATES` map in `server.js` (`GET /api/server-templates` serves the picker)
- `20261029120000_follows_badges.sql` — `follows`, `user_badges` (PK `(user_id, code)`), `activity` (feed, FK `activity_user_fk`), `users.equips jsonb` — all RLS-locked, **no policies** (service-role only, same shape as `active_sessions`)

### Awards (badges / flairs / titles — static catalog in `server.js`)

`AWARDS` (next to the supabase client) is the canon: **6 flairs** (spark/check/heart/cube/bolt/gem — free, granted lazily by `autoGrant()` on `GET /api/profile`), **5 badges** (first_game, host, settler 30d, veteran 1y, viral 100 plays), **2 titles** (worldbuilder = 5 games published, renowned = a game hits 100 plays). Codes are a stable API — never rename one, and the client renders icons from `/cudic-assets/icons/svg/<icon>.svg` paths baked in the catalog.

- Hooks: publish flip → `onPublished()` (feed line + first_game + worldbuilder); server create → `host`; scratch import → `bolt`; play bump ≥100 → `viral` + `renowned` (both fire-and-forget). `awardUser()` dedupes via the PK; feed lines only for badges/titles, never flairs.
- Equip caps **5 badges / 10 flairs / 2 titles**, validated server-side in `PUT /api/profile` (`equips` block) — codes must match their slot and be owned, else 403 "Not yours to equip." Client grid: profile `#sec-awards`, public display on `creator.html`, feed/follow lists on `friends.html`.

### Share clips (`public/cudic-clip.js`, in-frame recorder)

Game page `Clip` button → `{type:'cudic-clip-start', seconds, title, by,
score}` posted to the player frame → the frame composites the biggest game
canvas plus the overlay onto an offscreen canvas, records it with
MediaRecorder, and posts `{type:'cudic-clip-done', blob, ext}` back. **Why it
lives in the frame:** the player iframe is sandboxed `allow-scripts` with no
`allow-same-origin` (that's what keeps the account token away from published
games), so view.html cannot read the game canvas at all. Do not "simplify"
this into the page, and do not add `allow-same-origin` to fix it — both are
pinned by `tests/test_regressions.py::ShareClip`.

- Frame acks capability first (`cudic-clip-ready` → `can`); the button only
  appears when the browser can record. No canvas → `cudic-clip-error
  no-canvas`. No audio track (canvas streams have none).
- Score overlay: view.html keeps the last `CudicScores.submit()` value (a
  `cudic-score` CustomEvent on window) and passes it in at start; games that
  never submit get no chip.
- Injected in `run.html`'s `fwd` string next to the localStorage shim. Bump
  `?v=` there and the `V` in the clip script on protocol changes.
- Nothing is uploaded: a blob URL + `<a download>`; the previous URL is
  revoked on each new clip.

### Cosmetics shop (`/shop`, `user_cosmetics`, `users.equips`)

Coins second sink after theme packs. The catalogue is `COSMETICS` in `server.js
(prices are server-authoritative — the page never sends a price); ownership is
`user_cosmetics(user_id, code)` (migration/cosmetics.sql), wearing reuses the
existing `users.equips` jsonb with six new single-value slots: `fr` frame,
`bn` banner, `ef` profile effect, `ne` name effect, `ti` title, `em` emoji pack.
The old award arrays `b`/`f`/`t` are untouched —**titles merge**, they are not
a separate field, so equip/un-equip on `ti` has to filter the previous
cosmetic title out of `t` and re-check the 2-title cap (`EQUIP_CAPS.t`).

- Endpoints: `GET /api/cosmetics` (catalog + owned + worn + balance),
  `POST /api/cosmetics/buy {code}`, `POST /api/cosmetics/equip {slot, code}`
  (`code:null` = take it off). Buy is verified-only, daily-spend and
  buys/hour capped from the ledger, and claims the row first so a second tab
  hits the PK and gets `already:true` instead of a double charge; the spend
  is `spend_coins('cosmetic_buy')` and rolls the row back on insufficient
  funds. Equip validates slot-kind match + ownership (403 otherwise).
- Renderer: `public/cudic-cosmetics.js` (`CudicCosmetics.paint({avatar,card,
  name…}, cosmetics)`) is the single implementation used by profile.html
  (live preview) and creator.html (public page) — never draw a frame inline
  somewhere else, or the two will drift. Effects honour
  `prefers-reduced-motion`. Emoji packs extend the chat emoji map client-side
  for the signed-in user only.
- Profile equip UI: `#sec-cosmetics` card, hidden for signed-out visitors.

### Notifications (inbox, `notifications` table)

`public/notifications` + `/notifications` page + sidebar bell already existed; the
platform uses them as the canonical inbox. New senders wired in this batch:
**like** (game owner), **follow** (followed user), **friend request** (target),
**award** (you earned a badge/title — flairs stay quiet), plus the pre-existing
**comment** and **friend accepted**. `notify()` (next to `logActivity`) writes
them, deduping same-(user,kind,ref) within 24h. RLS enabled, no policies
(service-key only) — `20261029130000_notifications_rls.sql`.

### Changelog (update log, `/updlog`)

`public.changelog` backs `/updlog`. Seeded from git history (256 commits);
future commits auto-post via `POST /api/webhooks/github` (HMAC-verified with
`GITHUB_WEBHOOK_SECRET`) and a mod fallback `POST /api/mod/changelog/sync`
(needs `GITHUB_TOKEN`). Mod-only `POST /api/changelog` for hand-written entries.
RLS on, no policies — `20261029150000_changelog.sql` +
`20261029160000_changelog_commit_sha.sql`.

RLS: read-for-all on most, insert for authenticated, delete for owner.
Storage policies let anyone read game assets, authenticated upload, owners manage/delete.

MCP Supabase tools are available (`supabase_list_tables`, `supabase_execute_sql`,
`supabase_get_advisories`, …). Prefer **read-only** inspection; run DDL only when
asked, and check advisors after schema changes.

---

## 7. Cudic AI panel (the big recent feature)

### Architecture — this is the part that surprises people
**There is no WebviewViewPane in this build**, so sidebar view contributions
(`contributes.viewsContainers` / `views`) **cannot render**. Anything that tries
to open as a sidebar view will silently do nothing.

Instead the panel is a **direct DOM mount**:
1. `registerCudicAi(shadowRoot)` in `extension.ts` builds `#cudic-ai-panel` and
   appends it to the workbench's `.part.auxiliarybar` (the right bar).
2. Header bar + a **sandboxed iframe** (`sandbox="allow-scripts"`, no `allow-same-origin`,
   `srcdoc`) loads `chat.html` — all UI lives there, isolated from the workbench.
3. Toggle: a ✦ button inserted next to `#glox-title-icon` in the title bar
   (`mountTitleBarCudicIcon()` in `main.ts`).
4. Open via palette command **`Cudic AI: Open chat`** (`registerAction2`) —
   keybind `ctrl+shift+alt+p` opens the command palette itself.

Bridge: `postMessage` / `message` events between parent and iframe.
Parent handlers (`handlePanelMessage`): `ai:ready`, `ai:saveSettings`,
`ai:mode`, `ai:mcp`, `ai:models`, `ai:test`, `ai:chat`, `ai:stop`, `ai:apply`.
Outbound: `postToPanel(...)`.

### Agent tool loop (rival-clause: this is the opencode/codex shape)
`withTools` = openai-chat format AND `st.mode !== 'ask'`; loops up to **12
rounds** (`for (let round = 0; round < 12; ...)`) executing tool calls between
rounds until the model stops calling tools. Tools: `save_file`, `read_file`,
`list_files`, `search_project` (regex, ≤60 hits), `delete_file`,
`rename_file`, `run_preview` (→ `gloxRun()` from glox.ts — no import cycle,
glox never imports cudic-ai; when no Preview tab exists it opens one itself
via `ensurePreviewPanes()` instead of erroring — used to be a toast telling
the user to reopen the preview), `get_preview_errors` (→ glox.ts
`drainPreviewErrors()` — runtime errors thrown since the last Preview run:
uncaught errors, unhandled rejections and console.error posted up from the
sandboxed frame by the CAPTURE_SNIPPET `cudic:'perr'` channel; `mount()`
drains the buffer on every reload so the feed is always "this run"),
`snapshot` (→ `revisions.createSnapshot(true,
label)` headless), `ask_user` (posts `ai:ask`, awaits `askResolvers`, 120s
timeout fallback string). Deletes are guarded: never `package-lock.json`,
never the project's last HTML entry. Modes cycle in chat via `/mode`
(ask → edit → agent); `ask` sends no tools, `edit` gets file-write tools only.

### AI playtester (/review)
`/review` in the panel seeds a fixed playtester prompt (`REVIEW_PROMPT` in
chat.html): `run_preview()` → `get_preview_errors()` → read the entry file →
reply with a checklist only (runtime errors, broken references, controls
wired to nothing, save flow, verdict "ready to publish" / "fix first"). It
edits nothing — the prompt forbids file changes. The whole loop rides the
normal agent machinery (12 tool rounds); works only for providers with the
openai-chat tool format in agent/edit mode, same as the other tools.

Multi-session chat (`/session` screen): transcripts are host-side —
`AiSettings.sessions` (capped 20, `msg {q,a}` pairs) plus `activeSession`. The
panel posts `ai:saveHistory` after each completed turn and `/clear`; handlers
for `ai:session` (op `create|switch|rename|delete`) edit the archive, and
`syncSessions()` PUTs the blob to **`/api/ai/sessions`** (Bearer token,
fire-and-forget) so it follows the account; `pullSessions()` unions it back
once per boot, longer transcript wins. `publicSettings()` ships
`sessionsMeta` + the active session's transcript as `history` — the panel
rebuilds scrollback from it (`restoreHistory()`), skipped mid-stream so
tokens keep painting. `/model` = searchable picker over connected providers
only (`keyed` ∪ keyOptional ∪ loopback); `/connect` = renderPlist in
connectMode (only providers without a saved key, row taps key entry).

### MCP connector ( §7c )
`src/cudic-ai/mcp.ts` — Streamable HTTP ONLY (browser can't do stdio). Runtime:
`initialize` → `notifications/initialized` → `tools/list` per server, then
`tools/call` per invocation; JSON-RPC over POST with 15 s timeouts, SSE
replies parsed defensively. Every tool surfaces as `mcp_sN_<tool>` (server
order index N, tool name sanitized) in `AiSettings.mcp`.
Hard caps: **6 servers, 20 tools/server, 4 KB input schema** (oversized
schemas are replaced by a one-line description). Catalogs cache in module
state (`mcpTools`/`mcpFetchedAt`, 10 min TTL) and refresh via
`refreshMcpCatalogs()` → posts `ai:mcpState` lines to the panel. Keys are
stored in settings and sent only as the `Authorization: Bearer` header;
`publicSettings()` exposes url + `hasKey` + live toolCount only. Panel: `/mcp`
screen (add/remove/re-check per server) + `[m]` chips in the composer (green
signature when the server reports tools). Failure mode of a dead server is
graceful: errors aggregate per-server, tools from living servers still merge
into the roster.
(intentional ambiguity: every TOOL_DEFS entry still reaches the model in edit
mode — server-side filtering by mode is a TODO if it ever matters).
Settings key `mode` persists in `AiSettings` and `publicSettings()`.

Manifest registration is **import-time** and manifest-only (`registerExtension`
with `LocalWebWorker`, `icon: '$(sparkle)'`) — it exists so the extension host is
happy, not because views are used.

### Files
| File | Role |
|---|---|
| `studio/src/cudic-ai/extension.ts` | main side: mount, message handlers, `resolveModel`, `friendlyError`, `gatherContext`/`systemPrompt`, **agent tool loop** (see below), autocomplete, `setSupaToken`, `publicSettings` |
| `studio/src/cudic-ai/chat.html` | all UI: gate / providers / key / options / chat screens, ASCII noise, motion CSS |
| `studio/src/cudic-ai/providers.ts` | **53 provider presets**, `publicModels` flag, `isLoopbackUrl` |
| `studio/src/cudic-ai/llm.ts` | `streamChat` (openai-chat / anthropic / gemini SSE), `fetchModels`, `routedFetch`, `friendlyError`, `suggestModels`, tool-call defs + OAI tool delta parsing |
| `studio/src/cudic-ai/skills.ts` | `SKILLS` — premade prompt packs (`cudic` on by default, `taste` opt-in), condensed from design docs |
| `studio/src/cudic-ai/mcp.ts` | MCP connector: Streamable-HTTP client (`rpc`, `fetchCatalog`, `callTool`, `aggregateCatalog`) + `mcp_sN_<tool>` naming, caps |

### Settings & keys
- Stored in page `localStorage['cudic-ai']` as
  `AiSettings { provider, model, baseOverride, completeOn, completeModel, keys, modelLists, skills, mode, sysExtra, mcp }`.
- **`sysExtra`** = user's custom system-prompt addendum (options screen, cursor
  in a 4 000-char textarea with a live counter before #sysExtra in the DOM).
  Appends right after the built-in discipline block, before the premade skill
  packs, as "Additional instructions from the user (treat as first-party)".
- **UI skin: Geist / Geist Mono** (design.md / `brand.html` vibes) — the panel
  loads both from Google Fonts and treats terminal.font the fallback. Mono
  for `small`, `.tbtn`, `.chev`, `.sess`. Vibe = Codex CLI / opencode terminal,
  echoing `--cudic-ink #0d0e10` / `--cudic-cream #f7f5ec` with `#b8f23a` lime
  accents and zero rounded corners.
- `publicSettings()` returns a **safe projection**: `hasKey` boolean + `keyed[]`
  (which providers have keys — **presence only, never values**). Keys never leave
  the page except as an `Authorization` header on the outbound request.
- Supabase JWT pushed into the panel by `pushSupaToken()` (`main.ts`, every 60s)
  reading `sb-opimjwmgmzwapkzgxvhk-auth-token`.

### Model catalogs — how "all models" works
`canList(p, pid)` in `chat.html` is the gate:
```js
if (p.publicModels || p.loopback) return true;        // keyless catalogs
return keyed.indexOf(pid) !== -1;                     // or you have that key
```
- **Keyless/live**: OpenCode (`opencode.ai/zen/v1/models`, 82→84 IDs),
  OpenRouter (`openrouter.ai/api/v1/models`, 458 IDs), local Ollama/LM Studio.
  Expand the company row → list fetches and the full lineup renders inline.
- **Keyed**: expanding pulls the live catalog once a key for that company is saved.
  Saving a key clears `fetchedFor`/`FETCHERR` so the catalog refreshes.
- **No endpoint** (Anthropic, Perplexity…): curated `models[]` + note "curated".
- Results merge into `LISTS[pid]`; errors land in `FETCHERR[pid]` and render
  inline as `⚠ <provider> says: …` — they used to vanish silently.
- Lists persist in settings with fetch timestamps (`fetchedAt`); eligible
  catalogs (public/local/keyed) auto-refresh in the background when older
  than 24h (`refreshModels`, staggered 800ms). `ai:saveSettings` preserves
  both maps — it used to wipe them.
- `fetchModels` (`llm.ts`) handles shapes: `j.data ?? j.models`, string-or-object
  entries, and Google's `models/gemini-…` prefix stripping.

### The proxy — `/api/ai/fetch`
Cloud LLM calls **must** go through the server (browsers can't hold provider keys
safely and CORS blocks it). Loopback (Ollama/LM Studio) is deliberately **rejected
by the proxy** and called directly from the browser instead.

Rules, in order:
1. No `Authorization: Bearer <supabase jwt>` → **401** `Sign in to use cloud models.`
2. `supabase.auth.getUser(token)` fails → **401** same message.
3. Target must parse, be `https:`, and have `hostname ∈ AI_HOSTS`
   (or `*.openai.azure.com`) → else **403** `Target not allowed.`
4. Loopback/private-range hostnames (`localhost|127.|0.|10.|192.168.|172.16-31.|::1|fc00:|fe80:`)
   → **403** (SSRF guard).
5. Otherwise forwards a whitelisted header subset.

`AI_HOSTS` (~50 entries) lives at `server.js:726`. **Adding a provider whose host
isn't in that set will 403 at runtime** — that's the #1 integration bug here.

### Autocomplete
Monaco `registerInlineCompletionsProvider` — ghost text, gated on `completeOn`
and an active key.

### Skills & tools
- **Skills** are composer chips (`📄 active file` + `✦ <skill>`); selection
  persists in `AiSettings.skills`, sent with every `ai:chat`, appended to the
  system prompt. `cudic` (platform/design rules) defaults on, `taste` (design
  mode) defaults off. Catalog ships in `ai:init`.
- **Tools** (`save_file` / `read_file`) run as a ≤4-round loop inside `ai:chat`;
  each call posts `ai:tool` → a `.toolnote` line in the streaming bubble.
  `save_file` reuses `normalizeApplyPath` (same guard as Apply) + `TEXT_EXT`.
- Tools are sent **only when `preset.format === 'openai-chat'`** (~50 presets);
  anthropic/gemini get skills but no tool loop. Check `useTools` in `extension.ts`.
- **Setup-screen navigation gotcha**: `decide()` early-returns while on
  providers/key/options (by design — don't yank mid-setup), so those screens'
  Back buttons route through `exitSetup()`, not `decide()` directly.

### UI design direction (user taste — follow it)
- **Monochrome zinc/white, Codex-style.** The user explicitly rejected purple:
  *"WHY DO U HAVE TO PUT PURPLE EVERYTHING"*. Also rejected an earlier shadcn-ish
  pass as *"no taste"*. Do not reintroduce purple gradients or generic AI styling.
- Gate: ASCII FBM noise backdrop (canvas, 4-octave value noise, glyph ramp
  `' .·:;=+x#%@'`, ~90ms frames, radial vignette, static frame under
  `prefers-reduced-motion`), centered ✦ brand, bottom pill stack
  (white "Add a provider" / dark "Use API key" / text "More options").
- Screens: providers (searchable, **expandable company → model rows**, current
  model gets ✓) → key (model + key + Save/Test) → options (ghost autocomplete,
  completion model, custom endpoint) → chat (bubbles, avatar, typing dots, code
  blocks with Apply/Copy, error bubbles with Retry, suggestion chips).
- Motion: gate rise/stagger, screen fades, message slide-in, streaming avatar
  pulse, pill hover lift, send scale — **all `prefers-reduced-motion` guarded.**

---

## 7b. Collab editing (P2P, `studio/src/collab.ts`)

Live co-edit, Live Share style, with **no server load** — everything runs
browser↔browser over WebRTC; Cudic's servers do nothing.

- **Mount**: same shadow-root pattern as the AI panel — `registerCollabCommands(shadowRoot)`
  from `main.ts` (the §7 webview-rule applies here too). The panel is an absolute
  overlay (`inset:0`) in `.part.sidebar`; a permanent people-icon tab at
  `bottom:76px` in `.part.activitybar` toggles it, or starts/joins a room when
  none is active.
- **Sync**: Yjs — `Y.Map('files')` (string per text file) + `Y.Array('chat')`,
  `WebrtcProvider` on public signaling (`wss://signaling.yjs.dev`,
  `wss://y-webrtc-signaling-eu.herokuapp.com`; community-run — first suspect if
  rooms won't connect). Local edits broadcast via a 400ms full-rescan **plus an
  instant keystroke fast-path**; awareness carries names/colors/cursors; ~20
  peers (default mesh cap — add a `maxConns` provider option only if a cap is
  wanted).
- **Remote apply is a partial diff**: common prefix/suffix trimmed, only the
  changed middle replaced, full-replace fallback — two people typing in one file
  don't yank each other's cursors.
- **Names**: signed-in = real `display_name` via `/api/profile`; guests = a
  two-word alias persisted in `localStorage['cudic_collab_name']`. The room code
  lives in `localStorage['cudic_collab_room']` → auto-rejoin on reload. Chat
  echoes locally and surfaces send failures as `!` on the status dot.
- **Commands**: `glox.startCollab` / `glox.joinCollab` / `glox.stopCollab`.
  User-facing doc: `/docs` §Collab editing; plan.md row 14 = Shipped.

---

## 8. Studio (`studio/`)

- `vite.config.js`: `base: '/studio/'`, `outDir: '../public/studio'`,
  `emptyOutDir: true`, `target: 'esnext'` (top-level await; school Chrome is current),
  `chunkSizeWarningLimit: 20000`, `worker.format: 'es'`.
- **Custom plugin `loadVscodeCssAsString`** — forces VS Code `.css` under
  `node_modules/@codingame/*` to load as `?inline` strings so they can be injected
  into the shadow root. It **normalizes Windows backslashes** before matching;
  the upstream regex assumes POSIX. Don't "simplify" it away.
- Workbench mounts in `#workbench` as a **ShadowRoot** — all VS Code CSS goes
  through it. Style leakage goes both ways; test both editors if you touch CSS.
- 40+ `getServiceOverride` imports in `main.ts` — these are load-bearing; removing
  one typically kills a workbench part silently.
- Workers: editor, extensionHost, textmate, search, outputLink.
- `main.ts` also: `registerProjectCommands()`, `registerCudicAi(shadowRoot)`,
  `registerCollabCommands(shadowRoot)`, `pushSupaToken()`, `mountTitleBarCudicIcon()`.

### Commands
```
glox.saveProject | glox.importFiles | glox.importFolder | glox.exportProject
glox.publishProject | glox.unpublishProject | glox.deleteProject
glox.setThumbnail | glox.openPreview | glox.run | glox.leaveStudio | glox.toggleSidebar
glox.runPython | glox.installPythonPackage | glox.addPackage
glox.importScratch   (.sb3 file or shared Scratch link → playable project)
glox.importGitHub    (public repo → project snapshot; also /studio?github=owner/repo)
glox.insertIcon       (Kenney CC0 icon library → assets/icons + <img> at cursor)
glox.restoreSnapshot  (restore points: ring of 10 per project, minute-by-minute;
                      pick one + reload — palette + File menu, §16 “guest guide”)
glox.startCollab | glox.joinCollab | glox.stopCollab   (P2P collab rooms, §7b)
cudic ai:  Cudic AI: Open chat
```
Note the **`glox.` prefix is intentional and kept** — command IDs and storage keys
were not renamed during the Cudic rename (only visible strings were). Same reason
the Supabase anon key storage key still says `sb-opimjwmgmzwapkzgxvhk-…`.

`glox.ts` builds a preview by **assembling project files**: inlining local CSS/JS
into the HTML, resolving `data:`/relative refs against the project map, wrapping
legacy single-file games. `assemble()` / `injectAssetUrls()` / `previewHtmlFor()`.

### Runtimes (no terminal, no backend exec — browsers can't run OS programs)
- **Python**: `glox.runPython` (Run routes `.py` files here too) executes the open
  file with Pyodide 0.26.4 (WASM, jsdelivr CDN, ~10MB first load) inside the
  preview frame; `micropip` preloaded. `glox.installPythonPackage` inserts
  `import micropip` + `await micropip.install("name")` at the top of the file.
- **npm packages**: preview `assemble()` rewrites bare imports to `esm.sh` URLs
  (`rewriteBareImports`), skipping names the project's own importmap pins.
  Static CSS imports (`import 'pkg/style.css'`) lift to `<link>` tags;
  dynamic `import('*.css')` can't lift and fails at runtime (documented).
  `glox.addPackage` inserts a full `https://esm.sh/<pkg>` import (works in
  previews AND published games — publish pipeline untouched by design).
  Inline scripts carrying static import/export get `type="module"` automatically
  (`scriptTag`); the legacy single-file preview hoists imports above its console
  shim (`splitImports`). Pure helpers live in `src/npmutil.ts` (zero imports);
  unit-test with `esbuild src/npmutil.ts --format=cjs` + node assertions.
  Limits (physics, not missing features): no Node built-ins (`fs`, `net`,
  `child_process`), no native binaries, no `require()`, no build scripts.
- **Multi-file ES modules** run in the preview *and* in published games: a
  relative `import './x.js'` between project files is rewritten to an import-map
  id (`cudic~<path>`) whose target is a `data:` URL of that file — transitively,
  cycles included. Preview side: `mapModuleImports` / `drainModuleSlots` /
  `finishModuleMap` in `studio/src/npmutil.ts`. Player side: the same algorithm,
  mirrored in `public/run.html`. The map is merged into the project's own
  `<script type="importmap">` when it has one (a second map tag is
  newer-Chrome-only and older Chrome then drops both). Two limits stay: CSS
  `@import './y.css'` between files, and paths built in JS
  (`new URL('./a.png', import.meta.url)` — the base is a data: URL).
- **`fwd` in `public/run.html` is two `<script>` tags** (console shim, then
  `__CUDIC_BIN__`), not one. A missing `<\/script>` between them made Chrome
  throw on every `document.write` *and* left `window.__CUDIC_BIN__` undefined,
  so runtime-fetched assets silently had no map — keep them separate.
- **Game frames are opaque-origin on purpose — never re-add `allow-same-origin`.**
  `view.html:619` and `embed.html:108` sandbox their iframes `allow-scripts`
  only; that flag would let published game code read the parent origin's
  Supabase auth token. Because an opaque frame throws `SecurityError` on raw
  `localStorage`, `run.html` installs an in-memory localStorage shim **twice**:
  in its own boot script (covers `/theme-toggle.js`, which runs before the game
  document is written and touches localStorage) and again inside `fwd` as
  `lsShim` for the written game. Both use
  `Object.defineProperty(window, 'localStorage', {configurable:true, value:…})` —
  a plain `window.localStorage = …` assignment silently fails in that frame
  (getter-only, script not strict) and was the “localStorage error in shim”.
  The shim is per-load memory; values do not survive a reload (persistence is
  `CudicSave`'s job). Bump `run.html?v=N` in view.html/embed.html after editing
  run.html (currently **v9**).
- **Legacy scene games**: classic-editor rows carry code in `scene` with no
  `files`; Studio `bootProject` converts them on the fly via `sceneToFiles`
  (same module) into an editable single-file game — saving persists it.

### Scratch import (`glox.importScratch`)
`POST /api/scratch/import` unpacks `.sb3` (base64) or a shared Scratch project
and returns 4 files Studio drops into the workspace: `index.html` (player shell),
`scratch.js` (TurboWarp Scaffolding loader), `project.json` (the editable source),
`assets.js` (assets as data: URLs). Root dep: `jszip`.
- **Scratch 403s direct server-side `projects.scratch.mit.edu/<id>` downloads.**
  The token dance (trampoline metadata → `?token=`) is the only working path and
  its token API rate-limits bursts → one 1.5s retry. `.sb3` upload is the reliable
  route when a link fails.
- **The token endpoint returns either an `.sb3` zip or bare `project.json`**,
  depending on the project. JSON bodies carry no assets, so they're rebuilt by
  fetching every referenced `md5ext` from `assets.scratch.mit.edu/internalapi/asset/…`.
  Both shapes are handled; a heavy project (Geometry Dash = 104 assets, 10MB) works.
- Scaffolding is loaded from a pinned jsDelivr URL; `window.Scaffolding` exposes
  `{Scaffolding, Cloud, VM, Renderer, Storage, AudioEngine, JSZip}` — verified
  against 3.13.0. `addCloudProvider` must run **before** `loadProject`.
- Cloud variables map to `Cloud.LocalStorageProvider` (per-player, not synced);
  music projects use `scaffolding-full.js`, everything else `-min.js`.
- Known gaps: editing `project.json` alone does not change what runs (the loader
  holds its own copy — re-import or hand-sync both); TTS/translate stay silent,
  video sensing is blocked. Blocks are **not** translated to hand-written JS.

### GitHub import (`glox.importGitHub`, `/studio?github=owner/repo`)
`studio/src/github.ts` reads a **public** repo straight into the workspace: no
token, no OAuth, nothing written back. Files land as a snapshot and the next
Save makes it an ordinary Cudic project. Entry points: the command (palette,
File menu, both right-click menus) and a shareable `/studio?github=owner/repo`.
- **Listing comes from `data.jsdelivr.com/v1/packages/gh/<o>/<r>@<ref>`, not
  api.github.com.** The GitHub API is 60 req/hour per IP and Render egresses
  from one IP for everybody, so an import button on it dies in minutes. jsDelivr
  has no such ceiling and accepts `main`/`master`/a tag as the version. The API
  is called **once** only when neither `main` nor `master` resolves (exotic
  default branch) — that is the whole 60/hr exposure.
- **`codeload.github.com/.../zip/...` cannot be used from the browser**: it sends
  `Access-Control-Allow-Origin: https://render.githubusercontent.com`, not `*`.
  Bytes therefore come from `cdn.jsdelivr.net/gh/<o>/<r>@<ref>/<path>` (`*`).
- **jsDelivr 403s repos over 50MB** ("Package size exceeded"). That error is
  translated into "open a subfolder instead", which works because
  `/tree/<ref>/<subdir>` and `/blob/` links are parsed down to a folder.
- Budget mirrors Import files: 400 files, 8MB/file, 25MB total. `node_modules`,
  dot-dirs and lockfiles are skipped, and the folder holding the shallowest
  `index.html` is preferred — a 2000-file monorepo still yields a runnable page.
- **Private repos are deliberately out of scope** until the Connect GitHub
  setting ships; the error says so instead of failing cryptically.

### Private repos (`/api/github/repos`, `/api/github/tree`, `/api/github/file`)
The sealed token has exactly one consumer: these three routes. Each one requires
a signed-in user, decrypts that user's row with `ghOpen()` (the other half of
`ghSeal()`), and calls GitHub with **the user's** token — so the 5000/hour limit
is theirs, not the deployment's shared 60/hour. The token never crosses the
wire: `/api/github/file` streams raw bytes as `application/octet-stream` and no
JSON in the group has a token field.

- `ghOpen()` returns `null`/throws on anything that is not `v1.<b64(iv|tag|body)>`.
  A rotated `GITHUB_TOKEN_KEY` or an edited row must surface as `github_reconnect`
  (HTTP 401) so the user's fix is "reconnect in Profile → Connections", never a
  500 that leaves them stuck. `last_used_at` is stamped best-effort on every read.
- `/api/github/repos` lists repos including private ones, private first, capped at
  100. `/api/github/tree?owner&repo&ref` uses the git trees API (`recursive=1`),
  resolves the default branch when `ref` is omitted, and drops directories.
  `/api/github/file` proxies one blob via the contents API with
  `Accept: application/vnd.github.raw` and refuses files over 8MB.
- Owner/repo/ref/path are validated with `GH_NAME` / `GH_PATH` before they reach a
  URL, and per-user hourly buckets (`ghGate`) keep one account from burning its
  quota in a loop.
- Studio's `github.ts` tries the public jsDelivr path **first** and only falls back
  to these routes, so a public repo stays anonymous and CDN-fast. Missing sign-in
  or connection re-throws the public error, which is the honest one. Budgets
  (400 files / 8MB / 25MB) and the file-selection heuristics are shared.

### Connect GitHub (`github_connections`)
Profile → Connections links a GitHub account for the repo access the public
import cannot have: private repos, and later committing back. The browser gets
the OAuth token from Supabase `linkIdentity({provider:'github', scopes:'repo'})`,
captures it the moment it comes back (a token refresh drops `provider_token`),
and POSTs it once to `/api/github/connect`. That route verifies it with a single
`GET https://api.github.com/user`, checks the `X-OAuth-Scopes` response header
contains `repo` or `public_repo` (a sign-in token never does — that is the case
the check exists for), then seals it with AES-256-GCM under `GITHUB_TOKEN_KEY`
(sha256-stretched, random IV, `v1.` prefix so the scheme can rotate).

No route returns the token. `GET /api/github/connection` answers `{enabled,
connected, login, scopes, connected_at}` and does not even select `token_enc`;
`DELETE` removes the row. Unset `GITHUB_TOKEN_KEY` → `{enabled:false}` and the
card turns into a plain notice; a missing table degrades the same way (PGRST205)
instead of 500ing. Both writes call `needVerified()` and the connect route is
rate-limited per account. The table is service-role only — RLS on, no policies —
so a user's own anon-key JWT cannot read it (`migration/github-connections.sql`).
Sign-in and connection stay separate concepts: OAuth login proves identity,
connecting grants repo scope, and the UI says so.

The GitHub OAuth app must keep **Expire user access tokens** off. With it on,
GitHub returns an 8-hour token plus a refresh token; only `provider_token` is
stored today, so a connection made that way dies overnight. Turning expiry on
later means sealing `provider_refresh_token` too and refreshing before a repo
read — do both together, never just the checkbox.

### Weekly theme + community spotlight
- `GET /api/weekly` (public): current week's build theme. State lives in
  `weekly.json` next to `server.js` — gitignored, regenerated if missing.
  Week boundary is Monday (`weekStartISO`). A mod-set theme (`manual: true`)
  survives across restarts within its week; after roll-over the rotator picks
  a random pool theme (never the previous one). A `/weekly.json` write failure
  is logged, never fatal.
- `POST /api/weekly {theme}` — moderators only (via the `moderators` table).
  Theme doubles as the gallery tag; entries are `/games?tag=<theme>`.
- `GET /api/games/featured` (public): up to 8 published + featured games for
  the homepage shelf. Featuring a game is `POST /api/games/:id/feature`
  (mod-only, exists since the featured-games migration) — the button on
  `/view.html?id=…` shows only when `/api/profile` reports `is_moderator`.
- Mod membership is by account (auth UUID), never by display name.

### Game jams (weekly)
- `GET /api/jam` (public): this week's standings — `theme` plus the ranked
  published games that carry votes; cards ship `has_thumb`, never the data
  URL (same shape as the gallery list).
- Votes are rows in `jam_votes` (PK `(week_start, game_id, user_id)`,
  RLS-closed — server-only, like `game_scores`; migration/jam-votes.sql).
- `GET|POST|DELETE /api/jam/vote {game_id}`: GET is public (the game page
  needs the pill signed out too); POST/DELETE are auth + verified +
  seat-checked + rate-limited. **One vote per account per week**: POSTing
  for a different game deletes the prior row, it never stacks. Entry check:
  the game must be published and its `tags` must include the current theme;
  self-voting is 400'd.
- **Monday rollover** settles lazily: `settleJam(prevWeek)` runs on the
  first `/api/weekly` call of a new week, pays the top-3 by vote count
  (150/75/40 coins via `grant_coins`), grants the `jam_champion` badge,
  and notifies each maker. Double-pays are blocked by the ledger `reason`
  (`jam:<week>:<place>`), not by memory — a redeploy mid-settle is safe.
  `GET /api/weekly` always ships `jam.winners` (the in-memory settle result)
  for the homepage spotlight; settle failures are logged and never stall
  the response.

### Thumbnails & share cards
`games.thumbnail` (text, data-URL) — column, PUT field, and both `/api/games`
list endpoints already supported it; **only Studio lacked a control**.
`glox.setThumbnail` offers Upload / Capture-from-preview / Remove → `PUT`.
- Gallery card renders card art from `GET /api/games/:id/thumbnail` (fallback: cube SVG). The list endpoints (`/api/games`, `/api/games/mine`, `/api/games/liked`) send `has_thumb`, never the data URL — one 266KB list became 4KB. Single-game GETs still carry `thumbnail`.
- Images are downscaled to ≤1000px JPEG before saving (keeps rows small).
- **Share cards on the normal play link**: `/g/:id` is the SSR page for
  scrapers, but users copy `/view.html?id=…` from the address bar — so the
  static-file server runs `decorateViewHead(req, url, data)` on that page
  and rewrites `<title>` + og/twitter/description meta per game (title,
  description slug, card image `…/g/<slug>/thumb`, canonical
  `/view.html?id=<id>`). 60s module cache (`viewOgCache`) so unfurl bursts
  don't query Supabase per hit. Best-effort by design: unknown id,
  unpublished game, or any error inside the rewrite just serves the file
  with the generic card. width/height are only removed when the real
  thumbnail ships (og.png really is 1200×630; user art is not).
- **Capture is best-effort**: the preview iframe is `sandbox="allow-scripts"`
  (opaque origin) so the parent can't read it. Instead `mount()` appends
  `CAPTURE_SNIPPET`, which rasterizes its own DOM via SVG `foreignObject` and
  `postMessage`s the dataURL up; blank/tainted results are rejected.
- `project.ts` declares `previewBridge`, `glox.ts` fills it — **do not import
  glox.ts from project.ts** (glox already imports project; that's a cycle).

### Known benign console noise (do NOT "fix")
- `applyStateStackDiff` destructuring warning
- `Canceled: Canceled` (expected on tab/editor close)
- iframe sandbox warning
- `401` on `/api/profile`, `/api/servers`, `/api/mine` **when signed out** — expected

---

## 9. Sidebar (shared chrome)

- `public/sidebar.css` + `public/sidebar.js` on every page.
- **Fixed 60px icon rail, always collapsed**: flush full-height rectangle
  (no gaps, no rounded corners, `border-right` only). Labels never expand —
  hovering/focusing an item shows a `#railTip` tooltip pill (JS-positioned
  `fixed`, delegated so later-added server rows get tips too).
- Rail brand `.rail-brand`: **no white chip** (user removed it — wants raw art).
  Logo fetched as inline SVG via `[data-svg]` so per-path `--d` stagger can animate:
  `railIn` (slide from C) + `railGlow` (pulse). `<img>` fallback.
- Nav items: Chat, Servers, Games, Themes (`sbItem(href,key,icon,label)`), plus
  per-lobby links and an account row → `/profile`.
- Theme pack loader lives at the end of `sidebar.js`.

---

## 9b. React islands (`islands/` → `public/islands/`)

- Mount React components inside classic pages **without converting them**:
  `islands/src/loader.ts` scans `[data-island]` containers and
  `createRoot`-mounts the registry entry (`REGISTRY` name → component).
- New island: add `src/islands/foo.tsx` + registry line → `npm run build`
  → drop `<div data-island="foo">` + `<script src="/islands/islands.js?v=N">`
  (+ CSS link) in the page. Live examples: `new-menu` (New dropdown with
  Lucide icons) in the games topbar (mounts synchronously during parsing —
  the page's inline script grabs `#newDropBtn` by id, so deferred mounting
  throws and kills the rest of its script block); `report-button` (Report
  button + modal) on game pages (`view.html`, shown after the game loads).
  Button sweep/send-state styling in islands is adapted from the
  `cudic-test` button library (`ShineButton`/`LoadingButton`) restyled in
  `.isl-` CSS — islands ship no Tailwind, so library components are ported,
  never imported directly.
- Interop is read-only from host globals (`islands/src/cudic.ts`):
  `WS_URL` → `apiBase()`, `window.getAuthToken()`, `seatHeaders()` for
  writes. Never duplicate auth/config.
- Styles: hand-rolled `.isl-`-prefixed CSS using site vars
  (`--signal`, `--panel`, …) so islands follow light/dark + packs.
  No Tailwind in islands (collides with `sidebar.css`), no global selectors.
- React 19 self-contained in the bundle — independent of `editor.html`'s
  esm.sh React 18 pin. One bundle (~657KB/199KB gzip, cached) serves all islands.

---

## 10. Theme packs

- Store page `public/themes.html` at route `/themes`.
- Engine `public/theme-engine.js` → `window.CudicTheme`:
  `boot()`, `applyPack(id)`, `installPack(files)`, `clearPack()`, `previewScene(id)`.
- Static registry `public/packs/index.json`; packs in `public/packs/<id>/`
  (`manifest.json`, art). Shipped pack: **`anime-city-night`**
  (`sidebar.background` under a scrim, scene `city-night`, icons `neon`, motion `playful`).
- A pack's background outranks a plain CSS background (apply order matters).
- Backend `theme_packs` table was **deliberately deferred** — v1 is static files.
  Don't add it unless asked.
- **Theme lab is gone.** `theme-lab.js` and `logo-cucid.*` were deleted because the
  user said *"remove all the lab features"*. Do not resurrect it.

---

## 11. Design system (`design.md`)

**v2 (2026-10-27), asset-pack based** — `public/cudic-assets/` is the asset canon
(`README.md` = pack manual, `manifest.json` = machine-readable icon/cursor source,
`brand/colors.json` + `brand/tokens.css` = palette/tokens to import). Ink-dark,
grid-led, Geist everywhere. Read it before building any public surface. Headlines:

- **Palette (8 tokens)**: ink `#0d0e10` canvas, cream `#f7f5ec` text, lime `#b8f23a`,
  blue `#3f7cff`, sky `#9fd0ff`, panel `#14161b`, line `#262a33`, mute `#9a9a94`.
  Never pure `#000` / `#fff`.
- **Light mode (derived)**: cream `#f7f5ec` canvas, ink text, near-white panels
  `#fffdf6`, deep-blue `#1b3fb8` links (≈ 7.8:1); lime works as fills-with-ink-text
  only on light. Paired assets flip with the mode: `png/dark` icon PNGs,
  `pixel-ink`/`fluid-ink` cursor sheets, `cudic-mark-ink` logo (design.md §2).
- **Contrast on ink**: cream 17.7:1 (AAA), lime 14.5:1, blue 5.1:1 = the AA body-text
  floor (don't dim further), mute 6.8:1 (captions only).
- **Type**: **Geist** for everything — 600 headings, 500 buttons/UI, 400 body.
  **Geist Mono** only for code/identifiers/hexes/numeric readouts
  (Epilogue/Satoshi/JetBrains Mono are retired).
- **Hard edges**: radius ≤ 3px, flat fills — no glass, no glow, no gradients, no
  drop shadows (except the fluid cursor's baked-in one).
- **Accents are small-dose only**: never large background fills. Lime = marker
  dots / selected states / active nav / the one primary CTA; blue = links, 2px
  focus rings, destructive (the pack has no red — icon + copy carry danger).
- **Icons (83, 8×8)**: whole-step scaling only 16/24/32/48/64; inline SVG +
  `currentColor` to recolor (lime/blue spark cells are baked); PNG needs
  `image-rendering: pixelated`; `png/dark` = ink **for light backgrounds** /
  `png/light` = cream **for dark backgrounds** (inverted naming).
- **Cursors**: 10 shapes × pixel/fluid × cream/ink sheets in `cursors/css/` —
  the sheets set `cursor:` on `html, body`: link one per page (or use the
  per-element `.cursor-*` classes), never per section.
- **Motion**: 120 / 240 / 600ms tokens, `steps(4)` ease is the signature; one
  deliberate moment per screen, hover only on activatables, reduced-motion guarded.
- Empty states keep the 4-step pattern (icon in soft signal circle → specific
  heading → one-line instruction → one primary button).
- Voice: sentence case, active, buttons state the outcome ("Publish game", not "Submit").
- Anti-patterns: purple anywhere (user hard-no — *"WHY DO U HAVE TO PUT PURPLE
  EVERYTHING"*), emoji as UI icons, ALL-CAPS micro-labels as hierarchy, generic
  "No X selected" empty states.
- **Scope**: `/editor` + `/studio` keep dark IDE chrome with their own accent set —
  v2 governs the **public pages and the `/brand` kit**.

---

## 12. Gotchas — read twice

1. **NEVER delete the user's logo files.** `public/cucid.svg`, `public/cudic_sfsvg.svg`,
   `public/cudic_sfpng.png` — they were deleted once by mistake and the user was
   very upset. Same for `agora.db*` (Live Share) per `PROJECT_MEMORY.md`.
2. **The test browser shares the user's real session.** `localStorage` is shared —
   a real Gemini key has been observed in `cudic-ai` storage.
   **Never wipe `localStorage`. Never click "Send" in automated tests.**
   Verify by rendering/screenshots/reading only.
3. **Do NOT commit unless explicitly asked.** Push = Vercel + Render auto-deploy.
4. **Working tree should be clean** — the last batch (landing page, `/login`
   split, SEO files, screenshot crops) was committed as `d3cb2dc` and pushed to
   both branches. If you see modified `public/*.html` or `server.js`, something
   new is in flight: confirm with `git status` before assuming it is stale.
5. **The OneDrive copy** (`C:\Users\sophi\OneDrive\Desktop\Glox`) is a *separate*
   worktree parked on a **detached HEAD** (it used to hold `master`). It's only
   a mirror — do real work in `C:\Users\sophi\Glox`, directly on `master`.
6. **Branch**: `master` only (local = origin). `fix-inline-scripts` was
   merged and deleted on 2026-10-03; `fix-live-auth` still exists. Pushing
   `master` deploys Vercel + Render.
7. **New AI provider ⇒ add its host to `AI_HOSTS`** (`server.js:726`) or the proxy
   403s. Loopback hosts are intentionally *blocked* there and called directly.
8. **`public/studio/` is gitignored** — a fresh clone has no `/studio` until
   `cd studio && npm run build` (or Vercel's `buildCommand` runs).
9. **No `&&`** — PowerShell 5.1. Use `;` and `if ($?) { }`.
10. **CSS/JS cache** — bump `sidebar.css?v=N` (v24) on every page after editing it;
  same for versioned `sidebar.js` (v14) / `client.js` (v10).
11. **Restart the server** after any `server.js` edit; **rebuild Studio** after any
    `studio/src` edit. Neither auto-reloads.
12. **Command IDs keep the `glox.` prefix** — storage keys and IDs were not renamed.
    Only user-visible strings say "Cudic".
13. **No webview sidebar views** — see §7. This is the most common wrong turn.
14. **Never re-add `allow-same-origin` to a game iframe** (`view.html`,
  `embed.html`) — it re-opens the auth-token leak; see §8 Runtimes bullet.
15. **Never log or commit keys.** Keys live in `localStorage` and `.env` only.
16. **Copyright**: `README.md` forbids distribution. Don't push code to new remotes.
17. **Ctrl+S must stay bound via `initUserKeybindings`** (`studio/src/main.ts`)
  → `glox.saveProject`. The built-in `workbench.action.files.save` is not wired
  up (no files-service override), so an unbound Ctrl+S is a silent no-op — and
  its extension-host save path surfaced "Null extension description" on the
  deployed build (Discord report, Nov 2026). Don't remove that entry; new Cudic
  command keybindings go in the same `initUserKeybindings` array. Desktop VS Code
  swallows Ctrl+Shift+P, which is why the palette chord is `ctrl+shift+alt+p`.
18. **Gallery list is cached server-side** (`gamesListCache` in `server.js`,
  30s TTL, keyed `sort|q|tag|offset`, capped at 100 keys) **and browser-side**
  (stale-while-revalidate in `public/games.html`, `cudic-gal-v1` in
  `localStorage`, 10 min — the page paints the snapshot then revalidates). If
  you add ANY new write that can change what GET /api/games shows, call
  `gamesListCacheClear()` after it succeeds or the gallery serves stale rows
  for up to 30s. Viewer likes are never cached.
19. **The creator race settles lazily and pays through `race_weeks`**
  (week text PK + top jsonb). Order is strict: insert the week row FIRST,
  then grant coins/badges — the insert error is the double-pay guard.
  Scoring writes only live in the POST /play path (`race_plays`),
  best-effort, never awaited. Reuse `digestWeekStart()` for the week
  boundary; a second week-calcuation helper would drift from the jam.

---

## 12b. Shipping a page or a feature — the failure list

Every line below has already bitten this repo at least once. Read it before
starting and again before saying "done".

### A new page — the wiring checklist
A page is not "a file". Every line below is a different file, edited in a
different place, and skipping one yields a page nobody can reach. `/ops` shipped
with the file and the Render redirect but no Vercel rewrite, and 404'd on the
site while working perfectly in local testing.

1. **`public/<name>.html`** — the file itself.
2. **`vercel.json` → `rewrites`** —
   `{ "source": "/<name>", "destination": "/<name>.html" }`. The site is static
   output; without this the clean URL falls through to `404.html`.
3. **`server.js` → the redirect block** (~line 6120, next to
   `if (url.pathname === '/notifications')`) — without it Render 404s while
   Vercel works, so `npm start` and every local probe lie about it.
4. **An entry point** — an `sbItem('/<name>',…)` row in `public/sidebar.js` for a
   main tab, or a real `href="/<name>"` from a page that already exists. Be able
   to name the link. "They can type the URL" is not shipping; a page with no
   inbound link is dead code that still passes its own tests.
5. **`public/docs.html`** — a `<section id="…">` for a main tab; `docpage.js`
   builds the in-page nav from those sections. No section means no docs, and a
   feature nobody can read about is a feature nobody uses.
6. **Asset versions** — bump `sidebar.css?v=`, `sidebar.js?v=`, `client.js?v=`
   on *every* page when those shared files change (a new shared script starts
   at `?v=1`).

Pages that are iframe targets or fragments (`/embed`, `/view`, `/editor`,
`/play`, `/run`) still need 2 and 3 — only the rail row and docs section are
optional, because something else links to them from script.

Known route-less files — no rewrite and no redirect is only correct for these:
`404`, `index`, `index-legacy`, `login-legacy`, `landing-backup`, `brand`,
`font-pick`, `hello`, `play`, `run`, and `google<hex>.html`. A new file that is
not on that list and has no rewrite is a 404 waiting to be reported.

**Symptoms of a half-wired page** — all four have happened here:

| Missing | What you see instead of an error |
|---|---|
| file only | 404 everywhere; usually caught |
| rewrite only | works on `cudic.vercel.app`, 404 on Render and locally — "it works!" |
| redirect only | works locally and on Render, 404 on the site |
| rail/docs only | a menu item that 404s, or a page with no way in |

**Audit before saying done — do not eyeball it:**

```bash
for f in public/*.html; do p=$(basename "$f" .html); v=no; s=no; r=no
  grep -q "\"/$p\"" vercel.json && v=yes
  grep -q "'/$p'" server.js && s=yes
  grep -q "'/$p'" public/sidebar.js && r=yes
  printf '%-22s vercel:%s server:%s rail:%s\n' "$p" "$v" "$s" "$r"
 done
```

Every new page must print `vercel:yes server:yes`; a main tab must also print
`rail:yes`. If it does not, the page is not finished no matter how good it looks
at `localhost:3000/<name>.html`.

Then the page itself still has to look and behave like the others:

- **Shell**: a main tab gets `data-page="<page>"` + `.page-panel` + the rail from
  `sidebar.js/css` (§4). Login/marketing/legacy pages are the exception, not the
  template. Never invent a bespoke hero or a page-side body scroll.
- **Never name a directory after a route** under `public/` — `/themes` shadows the
  `/themes` rewrite (that's why packs live in `public/packs/`).
- **Head**: Google tag `GTM-PSGJNQWB` (every page except the Google verification
  file), the inline `glox_theme` bootstrap *before* CSS (no theme flash), and the
  cursor sheet.
- **Script order**: `config.js` → `auth.js` → `sidebar.js` → page script. Derive
  the API host from `WS_URL` like `notifications.html`'s `apiHost()`; a hardcoded
  host breaks local dev and previews.
- **Vercel's edge caches HTML even though the header says no-cache.** Verify a
  deploy with `?cb=$RANDOM` *and* `gh api repos/…/deployments`; a plain URL once
  served a HIT from before the deploy and looked like nothing had shipped.

### A new endpoint or feature
- Routes are one `if` chain in `server.js`: specific paths must sit **above**
  generic ones (`/api/games/mine`, `/api/games/:id/related` precede the `:id`
  match), or they are unreachable code.
- `cors(res)` first, then auth; errors are still `{ "error": "…" }` with a status.
- **`userOf(req)` + `hasScope(user, '…')`** for anything an API key may reach;
  `requireUser` for session-only routes (`/api/keys`). A new account-touching
  route without a scope check silently re-opens what keys were meant to fence.
- Writes also need `needVerified()` and the seat check where the page has one.
- **A missing migration must degrade, not 500.** Wrap the new table/RPC and fall
  back (search → title `ilike`, revisions → plain `files`, push → inbox only).
  Server and DB deploy separately, so the gap is real.
- Fire-and-forget side effects (`notify`, `sendPush`, `awardUser`, race points,
  `logActivity`) never sit in the awaited response path.
- Any write that changes what the gallery shows → `gamesListCacheClear()` (§12.18).
- Rate-limit new writes with `rateLimit('<feature>:<user|ip>', n, windowMs)`.
- **Never add an endpoint for the CLI or MCP** — extend `cli/cudic.mjs` /
  `cli/cudic-mcp.mjs` against the existing API (§5).
- **Name the caller.** A new endpoint needs a named consumer (a page script, the
  CLI, an MCP tool); a new page needs a named inbound link (checklist step 4).
  Code with no caller is untested by definition — nobody has ever hit it.
- **Docs and CHANGELOG are part of the feature**, not follow-up work: bullets in
  `public/docs.html` and an entry in `CHANGELOG.md`. Tests string-match source,
  docs and install lines, so half-written docs fail the suite later, on someone
  else's change.
- New client asset must live in `public/` and be served by both hosts; a push
  handler only works from root scope (`/sw.js`).
- New env var → Render dashboard + `.env.example`, and absent config turns the
  feature off cleanly (`/api/push/config` → `{enabled:false}`).
- Restart `server.js`; rebuild studio/islands when their sources change.

### Database
- **Check the column before writing `null`.** `project_revisions.files` is NOT
  NULL, so manifest snapshots store `{}` there and the content in
  `revision_blobs`; wrong guesses fail at runtime, not in review.
- PostgREST is a separate process: after DDL run `notify pgrst, 'reload schema'`
  or new columns/tables 404 until the cache expires.
- A missing table arrives as a PostgREST error (PGRST205), not a SQL error —
  that's precisely why new features try/catch and fall back.
- `onConflict` upserts need a full unique constraint; PostgREST cannot use a
  partial index.
- Generated columns require immutable expressions — `array_to_string(tags,' ')`
  is not, so search uses a trigger (`migration/search.sql`).
- Don't name an output column `rank` (it shadows `rank()`); `score` is the alias.
- Embedded joins need the exact FK constraint name
  (`users!creator_comments_author_id_fkey`); a renamed constraint becomes a
  silent null, not an error.
- Private tables: `enable row level security` with **no policies** (service key
  only). RLS off means the anon key can read it.
- DDL is idempotent (`if not exists`, `create or replace`) with a backfill for
  existing rows, and goes through the management API (`SUPABASE_ACCESS_TOKEN`).
  Never re-apply a migration you aren't sure about — check the table first.
- Migrations live in `migration/*.sql` (newer) and
  `supabase/migrations/YYYYMMDDHHMMSS_*.sql` (older); follow the newer convention.

### Verifying, packaging, deploying
- `node --check server.js` (and the CLI) before running anything.
- `python tests/run_tests.py` after the change. **`tests/` is gitignored**: a test
  edit is local proof, never a shipped change. Pins string-match source and docs,
  so renaming a route/table/installer line breaks them.
- `.freebuff/cli_e2e.js` drives the real CLI against a temp account on :3101;
  `.freebuff/` is gitignored too.
- Windows quirks: log under `.freebuff/`, not `/tmp` (bash `/tmp` ≠ `C:\tmp`);
  file tools want absolute `C:/…` paths with forward slashes.
- Never end a check with `| tail` without `set -o pipefail` — a green tail over a
  failed exit code is how "it works" becomes a lie.
- npm: the CLI ships from `cli/` only (root is `private: true`), every publish
  needs a version bump, a name that isn't "too similar" to an existing package
  (`cudic` → `cudic-cli`), and a bin matching the package name or `npx <pkg>`
  cannot resolve it. Publishing needs 2FA or a bypass-2FA token, and such a
  token cannot be scoped to a package that does not exist yet — that failure is
  a **404**, not a 403.
- **Deploy targets differ**: Render builds `master`; Vercel production builds
  `main`. Push both (`git push origin master main`) or the site keeps serving the
  previous build while the API is current. Confirm with `gh api …/deployments`
  (`environment: Production`) plus a cache-busted fetch.

---

## 13. Deployment

| | |
|---|---|
| Frontend | Vercel → `https://cudic.vercel.app` |
| Backend | Render → `https://glox-o7rr.onrender.com` (service `glox-server`, `PORT=10000`) |
| Build | `cd studio && npm ci && npm run build`, output `public/` |
| Install | `null` (Vercel default) |

Render env vars are set in the dashboard, not files:
`SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_KEY`, `PORT`.

Render builds `master`. **Vercel production builds `main`** — pushes to
`master` alone only create Preview deployments, so the site silently keeps the
old build while Render is current. Push both branches, verify locally first, and
confirm the production deploy before claiming a page is live.

---

## 14. Supabase MCP / tooling

- Supabase MCP tools are wired: list tables, run SQL, query logs, advisors,
  edge functions, migrations, generate TS types.
- Use `supabase_list_tables` before any schema change; `supabase_get_advisories`
  (security + performance) after DDL.
- CLI: `supabase` for local dev if present. `SUPABASE_ACCESS_TOKEN` is a
  read-only user env var.
- A **shadcn MCP** entry exists in `~/.config/opencode/opencode.jsonc`
  (`cmd /c npx -y shadcn@latest mcp`) — needs an opencode restart, and is mostly
  reference-only since this project has no React.

---

## 15. User preferences (from `PROJECT_MEMORY.md` + session history)

- **Beginner at web dev** — prefer simple explanations over jargon.
- **PowerShell** — `;` not `&&`.
- **No Google OAuth** — GitHub + email/password only.
- Wants **impressive UI**: dark IDE chrome, split layouts, grid-led editorial
  surfaces (glass/gradients now explicit anti-patterns per design.md v2).
- **Taste is opinionated and will push back hard** — see §7 UI direction.
  Purple in the AI panel is a hard no. "No taste" feedback means redo, not tweak.
- Product voice: sentence case, outcome-stating buttons.

---

## 16. Work state at time of writing

**Clean tree.** `master` = `origin` = `ea76000`, pushed 2026-10-29.
Verify with `git status` before assuming this still holds.

**Shipped in `ea76000`** (collab + docs batch):
- Studio: P2P collab panel (`collab.ts` — Yjs/y-webrtc room codes, partial-diff
  co-editing in one file, live chat, guest aliases, auto-rejoin), mounted as a
  sidebar tab via `registerCollabCommands(shadowRoot)`. Architecture: §7b.
- `/docs`: new "Command palette" guide (all Cudic commands grouped) and
  "Collab editing" sections; plan.md row 14 marked Shipped.

**Shipped local, uncommitted** (follows + awards — applies to rows 7 and 9):
Migration `20261029120000_follows_badges.sql` **already applied to the remote
Supabase**. server.js: `AWARDS` catalog + `awardUser`/`autoGrant`/`onPublished`,
`PUT /api/profile` equips validation, follow/follow-unfollow/feed/badges
endpoints, hooks on server create / scratch import / play bump / publish flip.
Pages: profile `#sec-awards` equip grid (5/10/2 caps, brand-styled), friends
Following + Followers + Activity cards, creator page title/flairs/badges +
Follow button. Server probes pass locally (`/api/badges` public catalog,
401s on feed/follow unauth). plan.md rows 7/9 flipped. Do not re-apply the
migration — check `follows` exists first.

**Shipped earlier**: `1fa91dd` audit-fix + reliability batch (XSS fixes, WS
message guards, rightmost-XFF rate-limit keying, readBody caps, AI multi-turn
memory, WS reconnect w/ backoff, save backup/restore — details in git history);
`d3cb2dc` marketing landing + `/login` split + SEO;
`7de42e7` thumbnails + model catalogs + rail animation; `17b6043` Cudic AI
panel, theme packs, sidebar push-aside, editor context menus, gallery motion.

**Live and verified after push**: server probes pass (malformed `%` → 404 not
crash, oversized body bounded, server stays alive); Studio build ✓ 56.64s.

**Deferred**: pack atomicity (needs migration), preview zombie timers,
`public/3d_models/` deletion (confirm first), `public/_next/` must stay
(live landing).

**Blocked / needs the user**: manual two-window collab test (chat display,
same-file co-edit, guest aliases); real end-to-end AI inference call (sign in,
add key, hit Test). AdSense resubmission needs custom domain + 2–3 weeks.

## Releasing the CLI

`cli/` is its own npm package (`cudic-cli`, bins `cudic` + `cudic-mcp`, zero
dependencies). The package name is not `cudic`: npm rejects that as "too similar
to existing package cuid" (403), so renaming it back will fail. The root package is `private: true` — never publish from the
repo root. Release: bump `cli/package.json` version, `npm publish ./cli`, then
smoke it with `npm i -g --prefix /tmp/x ./cli/cudic-<ver>.tgz && cudic --help`.

Publishing is gated by npm, not by this repo: since August 2026 every package
requires 2FA or a granular access token with **Bypass 2FA** enabled (npm docs,
"Requiring 2FA for package publishing"). Without either, `npm publish` fails
`E403` even on a brand-new unscoped package. Interactive route: enable TOTP or
a security key, then `npm publish ./cli --otp=<code>`. Non-interactive route:
create a granular token (write, package `cudic`, bypass 2FA on) and publish
with `NODE_AUTH_TOKEN=... npm publish ./cli` — note npm is deprecating
direct publishing with bypass-2FA tokens in January 2027, staged publishing
(`npm stage publish` + browser approval) is the successor.

The publish token lives in `.env` as `NPM_TOKEN` (gitignored — never commit it).
Publish with
`NODE_AUTH_TOKEN=$(grep '^NPM_TOKEN=' .env | cut -d= -f2-) npm publish ./cli`,
and revoke/rotate it at npmjs.com/settings/<user>/tokens if it ever leaks.
