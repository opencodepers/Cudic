# Changelog

All notable changes to Cudic are documented here. Releases are versioned
(`v1.0`, `v1.1`, `v1.2`) and each entry lists what was added, changed, or
fixed. Commits are referenced by short hash.

---

## Unreleased

**Server space page (`/server/<id>` — servers grow their own room)**

- **Servers now live at `/server/<id>`, separate from `/chat` and in the same visual capsule** as themes/quests/DMs (site sidebar rail, `page-panel`, same chat styling). Inside it: a Discord-style left rail (server icon + name + member count, back link, channel list with `#` rows and 🔒 privates) and the live message stream on the right — same message recipe as chat: own-message bubbles, markdown-lite + emoji shortcodes, reactions with the quick picker, pinned shelf, slow-mode note, typing indicator, and online count.
- Deep-link friendly: non-members hitting a public server URL auto-join; rules-required servers get the accept overlay inline before sending works. Private servers without membership point back to the browse page.
- Route wired twice: `vercel.json` rewrite (`/server`, `/server/:id` → server.html) and the mirrored redirect in server.js for local dev.
- The `/servers` browse page's "Open chat" buttons now open the server space; `/chat` keeps DMs (and still lists channels for unified access).
- Lean by design: reporting and the mod panel stay on `/chat` — this page is the room, not the admin desk.
- Tests: 202 pass (`python tests/run_tests.py`, run #53).

**Server-chat small features batch: pins, reactions, slow mode, owner/mod tools**

- **Pinned messages.** The author of a message (DMs included) and a server's owner/mods can pin/unpin any message in a server channel; `messages.pinned` rides the normal history select, so history rows show the pinned outline. A `?pinned=1` fetch on the GET messages endpoint powers the pinned shelf above the chat; shelf rows scroll to and flash the message. Live `pin` WS events repaint open rooms without a reload.
- **Emoji reactions.** A quick picker (👍 ❤️ 😂 🎉 🔥 👀 ✨ 👎) opens from the ＋ button on any message; one row per (message, user, emoji) in the new `message_reactions` table means re-reacting can't double-count. Chips show counts and flip to signal your own reaction; per-room `GET /api/messages/reactions` repaints reopened chats, and live `react` WS events keep open rooms in sync.
- **Slow mode.** Channel PATCH accepts `slow_seconds` (0–600, 0 = off); the server enforces the gap between a member's messages in server channels, and the chat shows a one-line hint when a channel has slow mode on.
- **Owner/mod tools in the chat.** The Mod button (owner/mods only) opens a roster panel: make/demote mods (owner-only), kick (owner or mods, mods can't kick each other), and ban/unban — bans remove membership and JOIN refuses banned ids. The server enforces every one of these rules; the panel just surfaces them.
- Migrations: `migration/pins-reactions-slowmode.sql` (pinned column, message_reactions, lobbies.slow_seconds) and `migration/server-roles.sql` (server_bans). No direct-PostgREST path; written only through server.js with the service key.
- Tests: 202 pass (`python tests/run_tests.py`, run #52).

**Tagging in the publish flow (gallery filter + "More like this" activation)**

- **Publish modal gains a tags row.** The editor's publish modal gets a tags input with one-tap suggestion chips (platformer, puzzle, clicker, horror, arcade, retro) — chips fill/clear the comma list, capped at 3; loading an existing game prefills its tags. Both the create (POST) and update (PUT) paths now send them.
- **Studio publishes ask for tags too.** The `Cudic: Publish project` command shows a one-line prompt (up to 3, comma-separated); Enter-to-skip publishes untagged and never blocks.
- **Server: one sanitizer, two call sites.** `sanitizeTags()` (lowercase, letters/digits/dashes, dedupe, ≤8) now runs on both create and edit, replacing the PUT-only inline copy — a new game's first publish is immediately gallery-filterable, and raw tag strings can never reach the column.
- **Docs updated:** the stale "tags come from Studio project fields" line is replaced with the publish-modal + Studio-prompt reality.
- Tests: new pin class `TaggingInPublishFlow` (server sanitizer single-source, editor chips + readModalTags, Studio prompt, docs mention).

**Game-page next-up shelves + week leaderboard (shelves feature batch)**

- **"More from this creator" + "More like this" shelves on every game page.** New public endpoint `GET /api/games/:id/related` returns the maker's other published games (by recency) plus published games sharing a tag (by plays, excluding the same maker). Rendered as two side cards below the leaderboard, thumbnail-free like the gallery list, titles/names as DOM text so a crafted title can't inject markup. Finishing a game now leads one click to the next.
- **"This week" leaderboard tab.** The game page board gains an All time / This week toggle; `GET .../scores?range=week` filters server-side on `updated_at >= Monday 00:00` (reuses the jam's `weekStartISO` rule). Tabs only appear once a game actually has scores.
- **Weekly digest email — audited, already built.** Confirmed the Monday digest job exists in server.js (`weeklyDigest`): theme + last week's jam winners + 3 newest games from followed creators, sent to confirmed accounts only, half-hourly check with a `digest.json` once-per-week marker so redeploys can't re-send. No code change; pinned by a regression test so it can't quietly vanish.
- Tests: new pin class (`RelatedShelvesAndWeekBoard`). Docs.html saves section updated.

**Joystick mode for CudicTouch (`J=on` / `{ joystick: true }`, version 2)**

- `CudicTouch` can now swap the D-pad cluster for a drag-anywhere analog-
  feel joystick: press anywhere in the square base and steer — the knob
  follows in clamped steps and the 8 compass sectors emit the right key
  pairs, so diagonals (up-right etc.) are first-class press combinations,
  not lucky multitouch.
- Key safety built in: a dead zone at the centre releases all direction
  keys, crossing sectors releases exactly the keys that dropped out of
  the pair (verified: left→down releases ArrowLeft before ArrowDown),
  pointerup/leave re-centres and releases everything, and `unmount()`
  flushes held stick keys too — a keyboard-driven game never sees a key
  stick down.
- Same key contract as the D-pad (document-level `keydown`/`keyup` with
  `key`, `code`, legacy `keyCode`/`which`), same pixel styling with lime
  knob/hints. Usage: `data-cudic-touch="auto:J=on"` on the script tag,
  or `CudicTouch.mount({ joystick: true })`. Version bumps to 2; docs,
  cookbook guide and example tags updated.

**On-screen touch controls for games (`CudicTouch`, `cudic-touch.js`)**

- The #1 reason players bounce off game links on phones is missing keys.
  One script tag (`<script src="/cudic-touch.js?v=1"
  data-cudic-touch="auto"></script>`) adds a pixel-styled on-screen D-pad
  (arrows; WASD via `D=wasd`) plus a lime A button (Space by default).
  Desktop never sees it — the pad mounts only on touch-first screens
  (`pointer: coarse`), so nothing changes for mouse/keyboard players.
- Buttons turn taps into ordinary document-level `keydown`/`keyup` events
  carrying `key`, `code` and a legacy `keyCode`/`which` (pinned on the
  instance, since KeyboardEvent constructors don't set them), so games
  that already listen for arrows/WASD/Space play unedited. One press =
  one keydown, one release = one keyup — no auto-repeat, matching real
  keys. Multitouch D-pad corners give diagonals. Short `navigator.vibrate`
  pulse on press where the phone allows it (skipped by the mount option).
- Works everywhere a game runs with no mediator: the pad lives inside
  the game's own document, so the sandboxed live player, Studio previews
  and file:// all behave the same (unlike the parent-mediated shims).
- API: `CudicTouch.auto()` (mount-if-touch), `mount({...})` (forced, with
  `{ dpad, keys, buttons: [{ key, label, accent }] }` options), `show()`,
  `hide()`, `unmount()`, `mounted`. Custom key mapping comes free via the
  `data-cudic-touch="auto:A=Space,B=z,D=wasd"` attribute.
- Docs: new "Touch controls for phones" section in docs.html; the
  Cookbook platformer guide gains a full "Play it on a phone" section.

**Teachers & parents landing page (`/parents`)**

- New static landing at `/parents` (aliased from `/teachers`) written for
  teachers and parents: what Cudic costs (nothing, no paid tier - copying
  the FAQ), school-laptop/browser-only story, Scratch `.sb3` import for
  existing lessons, one-click publishing as class-jam motivation, and an
  honest parents section (moderation + `/api/reports` reporting, usernames
  only, drafts unpublished by default).
- Fully brand-`brand.html` styled, not a sidebar.css page: ink/cream/lime/
  blue tokens with light-mode swap, hairline cell grid, section numbers,
  big mark on the blue stage, platform pixel icons from
  `/cudic-assets/icons/svg/` (`<use>` refs), and steps() micro-interactions
  (hero rise, reveal-on-scroll `.rv`, hop-on-hover icons, blinking cursor,
  check-ticker marquee). Reduced-motion honored.
- Routes wired in `vercel.json` + `server.js` local mirror; linked from
  the FAQ CTA row and a new docs.html FAQ item. No database, no backend
  changes - pure static page.

**In-game achievements shim** (uncommitted)

- Games can now award achievements: `CudicAch.unlock('speedrun')` (via
  `cudic-ach.js`) records each player's first unlock per game, verified
  server-side through the same mediated pass-through as scores and saves
  (the game frame never holds the session).
- New `game_achievements` table (`migration/achievements.sql`), one row
  per (game, player, code) — the primary key is the dedupe, so re-calling
  `unlock()` is a quiet no-op (`first: false`), never an error.
- `POST/GET /api/games/:id/achievements` in server.js: POST is gated by
  the same verified + seat + rate limits as scores (codes are locked to
  short slugs server-side); GET is public (code + holder counts only,
  no ids). Signed-out players get a guest ack so the game can show
  "sign in to earn achievements" instead of a failure.
- Earned achievements surface on profiles: both the self-view profile
  payload and the public creator profile ship the 12 most recent unlocks
  (with the game title), and profile.html has a Game achievements card.

**Game devlog posts** (uncommitted)

- A game can speak in its own voice: `GET/POST/DELETE
  /api/games/:id/devlog`, markdown text posts capped at 8000 chars and
  5 posts per game. Public to read on published games, writeable only by
  the game's creator (seat + verified + rate limited).
- Posting pings the follow feed (`logActivity 'devlog'`), so followers
  get notified patch-note-style.
- The game page has a Devlog card: posts render as plain text (never
  markup), the composer only appears for the owner, and owners can
  delete their own posts. New table `game_posts` (`migration/devlog.sql`).

**Weekly digest email** (uncommitted)

- Verified accounts get one email every Monday: the current jam theme,
  last week's winner tally, and up to 3 newest published games from
  creators they follow (the follow-shelf data, in your inbox).
- `weeklyDigest()` in server.js — module-level job next to the purge job,
  half-hourly interval, once-per-week marker in `digest.json` so a
  redeploy cannot re-send the week. waits for a configured mail transport
  (Gmail → Resend → Brevo, same chain the verification codes use) before
  spending the marker. Read-only by design: the winner tally never pays
  anything — settleJam stays the only payer. Confirmed accounts only
  (`userUnconfirmed` filter), 500 accounts/run cap, 250 ms between sends.
- Regression pins in `WeeklyDigestEmail` (once-per-week marker,
  confirmed-only, no `grant_coins`, three content sections); AGENTS.md +
  docs.html + changelog.

**AI playtester — /review before publishing** (uncommitted)

- New slash command in the Cudic AI panel: `/review` seeds a playtester task
  — boot the game with `run_preview()`, read its runtime errors through the
  new `get_preview_errors()` tool, read the entry file for context, then
  reply with a checklist only (runtime errors with file+line, broken
  file/asset references, controls wired to nothing, save flow) ending in a
  "ready to publish" / "fix first" verdict. The prompt forbids file edits —
  review is a report, not a rewrite.
- The errors feed is new plumbing in glox.ts: CAPTURE_SNIPPET (injected in
  every preview frame) forwards `error`, `unhandledrejection` and
  `console.error` up over the existing capture postMessage channel
  (`cudic:'perr'`); the host keeps a 20-entry buffer that `mount()` drains
  on every frame reload, so `get_preview_errors` always reports exactly the
  current run. Tool is agent/edit mode + openai-chat providers, like the
  rest of the toolbox.
- Studio build verified (`npm run build`); regression pins in
  `PlaytesterReview` (test_regressions.py) cover the command, the frame→host
  pipeline and the tool registration; docs.html, AGENTS.md, changelog.

**Login streak** (uncommitted)

- Every day your seat claims or heartbeats (i.e. any signed-in visit) counts
  a day in `users.streak_days`, server-side UTC. The chain continues when
  the last active day was yesterday and resets to 1 after a gap; a same-day
  revisit no-ops.
- Each new day pays bonus coins through `grant_coins` with the ledger reason
  `streak:<date>` — idempotent, so a redeploy can never double-pay a banked
  day. Bonus = 5 + streak days, capped at 25 (day 1 → 6 coins).
- Migration `migration/streak.sql`: `last_active_day date` +
  `streak_days integer not null default 0` on `public.users`.
- The self-view profile payload ships `streak_days`; the public `/api/user`
  projection deliberately omits it (login cadence is private). profile.html
  gains a **Login streak** tab card (`#sec-streak`) that reads the counter
  and hides itself when the field is absent.
- AGENTS.md documents the ride-on-session-beats design; regression pins
  cover claim/heartbeat wiring, race/double-pay safety, payload privacy and
  the shelf (`LoginStreak` in `test_regressions.py`).

**Follow from the game page** (uncommitted)

- The game page's author row now has the same Follow/Following ✓ toggle the
  creator page has — tap the name of anyone whose game you like and their
  future publishes land on your homepage “New from creators you follow”
  shelf. Guests get bounced to sign-in; owners are not offered the button
  for themselves. Initial state comes from the profile endpoint's
  `viewer_follows`, never a guessed default.

**Real share cards on the play link** (uncommitted)

- Sharing `/view.html?id=…` — the URL people copy from the address bar — used
  to unfurl with one generic Cudic card everywhere (`og.png`, static title).
  The static-file server now rewrites that page's head per game at serve
  time (`decorateViewHead` in server.js): real title + " by <creator>" in
  `<title>`, the game's description in og/twitter/description tags, and the
  game's card art via the stable `/g/<slug>/thumb` share URL when it has a
  thumbnail. No-thumbnail games keep the generic card (and honest 1200×630
  dimensions). Cached 60s per game so unfurl bursts don't hammer Supabase;
  unpublished or unknown games serve the file untouched. /g/:id remains for
  slug shares and scrapers.

**Weekly game jam + follow-feed shelf on the homepage** (uncommitted)

- **Game jams**: the weekly build theme now doubles as a jam. Signed-in
  players vote for published entries from the game page (⬆ button — one
  vote per person per week, and voting for another entry *moves* the vote),
  `GET /api/jam` serves public standings, and the Monday rollover pays the
  top three (150 / 75 / 40 coins via `grant_coins`, idempotent through the
  ledger reason `jam:<week>:<place>`) plus the **Jam Champion** badge, with
  notifications and the trio pinned to a homepage **winner spotlight** shim
  that rides `GET /api/weekly` (`jam.winners`). Migration:
  `migration/jam-votes.sql` (`jam_votes`, RLS-closed, server-only).
- **Follow-feed shelf**: `GET /api/feed/games` returns the newest published
  games from creators the viewer follows (thumbnail-free cards, same shape
  as the gallery) and the homepage renders a *New from creators you follow*
  shelf. Distinct path from the older activity feed `/api/feed`, whose
  route and consumer are untouched.
- Vote response now distinct for guests: the game-page button prompt-signs
  in rather than erroring.
- Docs: `docs.html` gains a **Game jams** section; AGENTS.md documents the
  jam endpoints, one-vote semantics and lazy settle; regression tests cover
  the swap rule (`test_jam_vote_endpoints_exist`) and shelf routing
  (`test_follow_feed_endpoint`, gates in `test_api_gates.py`).

**Cudic AI panel — user-tuned prompts + brand skin** (uncommitted)

- **System prompt addendum** (`AiSettings.sysExtra`, 4000-char cap): write what
  you want in the options screen's yellow-box editor (tone, formatting, project
  conventions), hit save, and the agent + autocompletion both follow it from
  the next message. It rides `systemPrompt()` right after the built-in
  discipline block, before any skill pack, so both halves read coherently.
  `/status` shows a bare `✎ override` whenever the addendum is non-empty.
- **Panel re-skinned to the Cudic brand kit** (Geist / Geist Mono, routes like
  `/brand.html`): square corners, no /active pill, status line now discloses
  the active mode instead of a session pill, loaded via Google Fonts in the
  options iframe (no float leaks — the iframe's sandbox keeps the rest of the
  Studio native).

**Cudic AI agent upgrade** (uncommitted)

- Multi-session chat: `/session` lists every transcript with a search bar, and
  switches, renames, creates or deletes them (20 max). Transcripts persist
  through panel reloads and sync to the signed-in account via the new
  `/api/ai/sessions` endpoint (migration: `migration/migration-ai-sessions.sql`
  adds `users.ai_sessions`).
- `/model` is now a searchable picker that only shows models from providers
  you've actually connected (key saved, free, or local engine), and
  `/connect` lists only the providers you haven't set up yet and jumps
  straight into key entry. Top bar shows the active session label.
- Run-preview fix: when the agent called `run_preview` with no Preview tab
  open, Studio threw a toast outside the panel ("pane not ready yet, reopen
  Cudic Preview") and the preview never came. `gloxRun`/`gloxRunPython` now
  open the pane themselves (`ensurePreviewPanes()` in glox.ts) and only warn
  if the pane truly cannot mount.
- The chat panel is now a real agent: tool budget raised 4 → 12 rounds and six
  new tools next to `save_file`/`read_file` — `list_files`,
  `search_project` (regex over the whole project), `delete_file`,
  `rename_file`, `run_preview` (opens/reloads the Cudic Preview pane), and
  `snapshot` (headless project checkpoint via the revisions feature, so risky
  rewrites are restorable).
- `ask_user` tool: the agent can ask a question mid-task and the chat renders
  the existing answer cards (this was the planned use — the message type
  already existed with no sender).
- Modes, persisted in settings and cycled with `/mode`: **agent** (default,
  everything above), **edit** (file writes only), **ask** (chat, no tools).
  `/status` shows the mode. Editing save/__delete__ guards: never deletes
  package-lock.json or the project's last HTML entry point.
- `revisions.createSnapshot(auto, label)` exports the snapshot command with a
  dialog-free headless path; the File-menu behaviour is unchanged.
- **MCP connector** (`studio/src/cudic-ai/mcp.ts`): external tool servers plug
  into the agent over Streamable HTTP. From the `/mcp` screen paste a server
  URL (+ optional bearer token); the handshake (initialize → notifications →
  tools/list) exposes up to 20 tools per server (6 servers) as
  `mcp_sN_<tool>` calls merged into the agent roster. Catalogs cache for 10
  min and refresh in the background; SSE and plain-JSON replies both parsed.
  Schema size is capped (4 KB) so one sloppy server can't blow the context,
  tools/call results flaten to text with images/resources surrogated, and keys
  ride only the Authorization header (never enter the chat). `/mcp` screen +
  composer chips show per-server tool counts; `edit` mode keeps MCP off.

**Studio Music tab (pick, don't compose)** (uncommitted)

- Studio gains a Music tab (bottom panel, command palette → “Cudic Music:
  Open library”). Composing stays in the Music Lab — the tab is a read-only
  picker: your saved tracks, or a search across every signed-in user's
  tracks, so games can soundtrack with someone else's beat too.
- Picking a track writes `music.json` into the project (id + title + author)
  and shows the one-line integration. No data leaves the two new public
  endpoints: `GET /api/music/browse?q=` (titles + authors, no owner ids) and
  `GET /api/music/:id/public` (one track's playable data, 1-min cache).
- New `public/cudic-music.js` game helper: `CudicMusic.play(trackId)` loops
  the track inside the game frame (no token involved), waits for the first
  click/keypress when autoplay blocks audio, `CudicMusic.stop()` /
  `.volume(0..1)` to control it.

**Game leaderboards** (uncommitted)

- One-call leaderboards for published games: `⟨script src="/cudic-scores.js?v=1"⟩` and
  `CudicScores.submit(score)` / `CudicScores.top(10)`. Same sandbox shape as
  CudicSave — the game frame never holds a token; view.html mediates, and
  signed-out players are told to sign in (guest ack) rather than being able to
  forge scores.
- Server: `GET /api/games/:id/scores` is public (top-50 max, rows carry names
  only, never ids); `POST` is signed-in + seat-checked + email-verified and
  keeps each player's best run — a replay never lowers it. Table
  `game_scores` (PK `game_id,user_id`) via `migration/game-scores.sql`, RLS
  closed; reads/writes go through server.js only.
- Game pages render a "Leaderboard" card once a game has scores (hidden
  otherwise), built as DOM nodes like the live-player strip.

**Weekly build theme + community spotlight shelf** (uncommitted)

- New weekly challenge: the homepage now carries a builder theme for the week
  (`/api/weekly`). Cudic auto-picks a random theme every Monday (never the same
  twice in a row); moderators can set one by hand from the mod tools page
  (`/grant` → "Weekly build theme"). A mod-set theme lasts exactly its week.
  The theme doubles as the gallery tag, so "see this week's entries" is just
  the games page filtered on it. State lives in `server/weekly.json`
  (gitignored; a fresh deploy simply auto-picks again).
- Homepage spotlight: a "Community picks" shelf built from the existing
  moderator feature mechanism (`games.featured`), served by a new public
  `GET /api/games/featured` (8 cards). Moderators feature/unfeature a game
  from its game page — the Feature button appears only after the profile
  endpoint reports `is_moderator`; the endpoints still re-check membership.
- Moderator access expanded: the two team Proton accounts are in the
  `moderators` table.

### Fixed
- Themes page showed "Install" on an already-active pack: the page painted
  its buttons before the theme engine's async boot finished, so it read no
  active slug. `applyPack`/`clearPack` now fire a `cudic:theme-changed`
  event and the page re-renders on it. Also fixed the "reset to default"
  button calling `refreshButtons()`, a function that never existed. (on `master` past `v1.2`)

**Staged snapshots in Studio** (uncommitted)

- `Cudic: Save snapshot` used to capture the saved project row wholesale. It
  now behaves like a commit: it diffs the workspace against the newest
  snapshot and opens a checklist (new / changed / deleted, all pre-checked).
  Unchecking a file keeps its previous snapshot's copy, so the stored state is
  always "last snapshot + exactly what was staged", and `Restore a previous
  version` still replaces the project wholesale — including unstaged deletions.
- First snapshot of a project, a "no changes since last snapshot" state, or a
  fetched-last-snapshot failure all skip the checklist and behave as before;
  accepting the dialog with nothing checked aborts.
- Server: `POST /api/games/:id/revisions` accepts an owner-supplied staged
  `files` map (string values only, path ≤ 300 chars, ≤ 500 files, 4MB body
  cap). Invalid/absent payload falls back to the saved project row. The 20-
  snapshots-per-project ring is unchanged.
- Staging algorithm unit-tested (stage-test: full stage = working tree,
  nothing staged = previous snapshot, partial = base + staged change,
  checked deletion deletes, unchecked deletion persists).

---

**Sandbox hardening: games can no longer see the parent's token** (uncommitted)

- It was stated everywhere that published games run `sandbox="allow-scripts"`
  (opaque origin), yet `view.html:619` and `embed.html:108` still passed
  `allow-same-origin` with that frame — so game code *could* reach the parent
  origin and read the Supabase auth token out of its `localStorage`. The flag is
  gone from both parents; `run.html`'s header comment already said it was never
  an option.
- A truly opaque frame throws `SecurityError` on any raw `localStorage` access,
  which killed games that read a "best score" at load. `public/run.html` now
  installs an in-memory `localStorage` shim, and installs it **two** places:
  once in run.html's own boot script (so `/theme-toggle.js`, which runs there
  before the game document is written and touches localStorage, no longer
  throws), and again inside the `fwd` payload as `lsShim` for the written game
  document. Both installs use `Object.defineProperty(window, 'localStorage', …)`
  — the old dotted assignment to that getter-only property silently did nothing,
  which was the "localStorage error in shim".
- The shim is memory only, per page load: a score kept in plain `localStorage`
  survives while the frame lives but not a reload. Games that want persistent
  progress still use `CudicSave` (and its Studio-preview host).
- Verified headlessly against the running server: game code runs, console
  relay works, parent `localStorage` and DOM are both blocked with
  `SecurityError`, and the shim itself round-trips values (`LS-TEST 42`).
- `public/profile.html` retries its token read once after 600ms before showing
  the "session may have expired" notice — a fresh login's session write can
  land after the page's first read.
- Cache-bust bumped to `run.html?v=9` in `view.html` / `embed.html`.

---

**Audit-fix + additions batch** (`1fa91dd`) — security, reliability, AI memory,
reconnect, save backup, related games.

### Added
- AI multi-turn memory (last 8 exchanges ride along in `ai:chat`).
- WebSocket reconnect with exponential backoff (5 tries) + auto re-join.
- Save backup/restore on the game page (JSON download + file restore).
- "You might also like" internal links on prerendered game pages.
- Studio `package.json` pins all `@codingame/*` deps to 37.1.0.

### Fixed
- XSS: chat avatar, servers icon, profile Liked list (escapeHtml now quotes;
  server-side avatar/icon URL validation).
- Unpublished drafts no longer leak via `/api/games/:id` or `/:id/thumbnail`
  (404 for non-owners; Studio `bootProject` sends the owner token).
- WS message listeners in view.html/editor.html check `e.source`.
- `?token=` scrubbed from URL after read on 4 pages; OAuth redirect no longer
  carries a live JWT.
- Malformed `%` in pack routes no longer crashes the process (`safeDecode`).
- `readBody` bounded (default 1MB; larger for projects/scratch/AI); oversized
  bodies answer 413.
- Outer try/catch on `handleRequest` so one route bug can't kill the process.
- Chat flood guard (60 msgs/10s per account) + typing cap; conversation-dirty
  fan-out throttled to 1/5s.
- Conversation sidebar parallelized; private servers beyond page-1 fetched for
  members; lobby list hides DM/channel names.
- Reset-code scan loop expanded 3 -> 50 pages.
- Game field caps (title/desc/credits/scene/thumbnail) + thumbnail size cap.
- Saves PUT errors now surface as 500 instead of silent success.
- Generic error strings (no internal Supabase details leaked).
- Model service override duplicate removed; baseOverride preserved on model
  switch; chat render throttled via rAF.

### Changed
- `client.js` bumped to v10 (quote-aware escapeHtml).

---

**AdSense verification · gallery + type refresh · magic email codes ·
embeddable games**

### Added

**Chat history stopped disappearing** (uncommitted)
- `cleanupNonPersistent()` ran at boot +1 min and every 2h, deleting every
  message older than 2h in any lobby with `persistent = false` — which was
  **every** channel and DM, since the chat rebuild defaulted that column to
  false while its own header promised "everything persistent". History was
  being emptied on a timer. The sweeper is gone; only the moderator
  `delete_message` action removes a message now, and every existing lobby was
  backfilled to `persistent = true` (the column is vestigial).
- That same query also returned the **oldest** 100 messages (`order asc` +
  `limit 100`), so a busy room showed its first 100 for ever and never the
  recent ones. `GET /api/messages` now takes the newest 100 and flips them
  back to oldest-first for the client — matching `client.js`'s "only ever
  holds the last 100".

**Preview saves are test saves** (uncommitted)
- `CudicSave` had no host inside Studio's preview: the sandboxed frame asked its
  parent, got no answer, fell back to a local mirror a sandboxed frame isn't
  allowed, and lost everything silently. `glox.ts` now mediates
  (`registerPreviewSave`, twin of the multiplayer bridge), giving the preview
  its own storage slot — keyed by project id, working signed out, and never
  touching the cloud row a player or the author has. Testing can't overwrite
  real progress; live saves are still tested on the game page.

**In-game multiplayer** (uncommitted)
- `public/cudic-multi.js` gives a published game a room: `CudicMulti.join('code')`
  → `net.send(obj)`, `net.on('open'|'peers'|'msg'|'error')`, `net.id`, `net.leave()`.
  Same security shape as `cudic-save.js`: the sandboxed game frame holds neither
  the login token nor a socket — the host page owns one connection per game room
  and relays. Room codes are optional (`'main'` by default), so private sessions
  come for free. The Studio preview hosts rooms too now
  (`registerPreviewMulti` in `studio/src/glox.ts`), joining `<project>:preview`
  so you can test multiplayer while building, without touching the published
  game's rooms.
- `server.js` serves anonymous game rooms over the existing WebSocket
  (`multi_join` / `multi_msg` / `multi_leave`) — guests can play along, unlike chat
  which gates on sign-in. Caps: 32 per room, 8 KB per message, and **per
  connection** 20 joins/min + 200 messages/10s, with a loose per-IP backstop
  (400 joins/min, 8000 msgs/10s) so one school NAT no longer shares one budget.
  A game room never touches `lobbies`/`clients`, so chat, seats and the lobby
  list are unaffected.
- Players are named by the server: a join may carry the login token, and a
  verified one shows `users.display_name` (plus the account id, kept on the host
  page for reporting). Guests are `'Guest'`, a client-supplied name is ignored,
  and a peer id already in the room is replaced — so a name or a session cannot
  be cloned.
- "Playing now" shows up for free: `liveCount()` over the in-memory rooms rides
  on the existing `GET /api/games` and single-game responses, so gallery cards
  get an ember badge and the game page gets a live pill that switches to the
  exact per-room peer list once the game joins. No polling, no new endpoint.
- Game chat is unreviewable after the fact (nothing is stored), so the game
  page's "playing now" strip reports a **player's account** through the existing
  report modal (`window.CudicReport.open`), with copy that asks for the details
  because the note is the only evidence a moderator gets. Guests have no account
  to report.
- Outside any host page (a local .html file, plain embed, `play.html`) there is
  nothing to relay through, so `join()` reports an error instead of going quiet —
  the host handshake is page-local, not a network timeout.
- Found while wiring the above: `view.html` sent cloud saves as
  `Bearer undefined` (a Supabase session has `access_token`, not `token`), so
  signed-in cloud saves silently never reached the server.

**Studio: guest guide + restore points** (uncommitted)
- Signed-out builders are told once, on Studio boot, that the project lives in
  this browser only — with "Export .zip" and "Sign in" buttons. The
  save-when-signed-out warning offers the same two exits instead of a dead end.
  New command `glox.restoreSnapshot` (palette + File menu) picks from a ring of
  10 restore points per project, most recent minute-by-minute, and reloads into
  the chosen one; the state left behind stays selectable.

**Multi-file ES modules in previews *and* published games** (uncommitted)
- A relative `import './x.js'` between project files is rewritten to an
  import-map id (`cudic~<path>`) targeting a `data:` URL of that file, gathered
  transitively including cycles — same algorithm in `studio/src/npmutil.ts`
  (preview) and `public/run.html` (player), so a published game matches what
  you tested. Merged into the project's own `<script type="importmap">` when
  present. Legacy single-file projects take the byte-identical old path.
- Limits: CSS `@import './y.css'` between files, and paths built in JS
  (`new URL('./a.png', import.meta.url)`); JSON imports need `with { type: 'json' }`.

**Game reporting** (plan.md 2.1, first slice — uncommitted)
- `POST /api/reports` accepts `content_type: 'game'`: published games by
  id (owners may also flag their own draft), same 5 reason values as packs,
  so both land in one review queue. Pack flow untouched, no migration.
- New `report-button` React island on game pages: Report button + modal
  (reason select, details, sign-in prompt for guests), revealed after the
  game loads. Sweep/send-state styling adapted from the `cudic-test`
  button library (`ShineButton`/`LoadingButton`) in `.isl-` CSS.
  Islands rebuilt, `games.html` + `view.html` pinned at `?v=5`.
- v1 omits evidence upload for game reports; `/themes` keeps picture upload.

**Message/user reporting + moderation queue** (plan.md 2.1–2.2 — uncommitted)
- `POST /api/reports` accepts `message` (reporter must see the room) and
  `user` (no self-reports); 20/hour rate limit. Chat gains a hover Flag
  button on others' messages with a message/sender report modal. Message
  ids flow via history select + a `message_saved` WS patch keyed by client
  `cid`, so broadcast latency is unchanged. `client.js` → `?v=6`.
- New mod-only endpoints (allowlist in `moderators` table):
  `GET /api/reports/mine`, `GET /api/reports/queue` (status/type filters,
  content previews), `POST /api/reports/:id/action` (dismiss, reviewing,
  actioned, unpublish game/pack, delete message — all audited in
  `moderation_actions`). Minimal `/moderate` page for the queue.
- Requires running `supabase/migrations/20261014120000_moderation.sql`
  and inserting your auth UUID into `moderators`; pre-migration the queue
  safely 403s. `docs.html` reports section updated.

**Music cloud tracks + unified Your Projects** (uncommitted)
- New `music_tracks` table + `/api/music` CRUD: signed-in users sync
  tracks to their account (debounced, localStorage mirror), guests stay
  local. Track title/picker/New/Delete/sync status in the Lab topbar,
  `?track=` deep links, track switching via reload.
- Your Projects tab now lists Studio projects, unpublished theme drafts
  (with `/themes?edit=` deep link into the builder), and music tracks.
- Pack rows grew up: all own packs listed under Theme packs with
  Published/Draft badges plus Edit, Publish/Unpublish, and Delete —
  same actions as Studio project cards.
- Button effects pass (ported library LiquidFillButton/ShineButton, no
  Tailwind on classic pages): danger-red liquid fill from the cursor on
  the Report island button, theme Delete buttons, and Studio card
  Delete/Unpublish; shine sweep on gallery Play buttons. Islands at `?v=6`.

**Cloud-save load race fix** (uncommitted)
- Fresh page loads raced the cloud-save fetch: the game asked before the
  parent had an answer, concluded "no save", and bests read 0. The parent
  now reports `loading` while fetching (8s safety cap) and the save
  library re-asks instead of giving up. (`view.html` mediator +
  `cudic-save.js`; embed's local-only path untouched and compatible.)

**Loading rings removed** (uncommitted)
- The shared page-loading veil and the player % gauge are gone again —
  pages are back to skeletons plus the plain "Loading…" player overlay.
  (`pring.css`/`pring.js` deleted, all hooks reverted.)

**GitHub-login double fix** (uncommitted)
- Fresh OAuth logins minted a seat then heartbeated instead of claiming,
  403ing as a phantom "signed in on another device" whenever any other
  live seat existed. `bootSeat(true)` now claims. (`auth.js`)
- Raw `atob()` on base64url JWT payloads throws on `-`/`_`, silently
  leaving signed-in users (GitHub metadata hits this ~1 in 14 tokens)
  showing as Guest. Sidebar rail and classic editor now decode
  base64url-safe. (`sidebar.js` → `?v=13` everywhere.)

**Email-only signup + password reset** (uncommitted)
- Signup asks for email only; a random placeholder holds the account
  until the wizard sets the real password. New "Forgot password?" flow
  (code + new password, `POST /api/auth/reset-password`) doubles as the
  rescue for closed tabs — it also confirms the email. No migration.
- Wizard password step keeps trimmed compare (no more phantom
  mismatches) and a plain-English same-as-current error.
- Every auth await (verify, reset, sign-in, session, code send) now races
  a 15–30s timeout: a dropped connection (e.g. a deploy restart mid-click)
  surfaces "taking too long — try again" instead of spinning forever.
- Verify/reset/profile fetches retry once on dropped connections, and the
  login + welcome pages pre-warm the sleeping host on load — the timeouts
  above are now a backstop that should never fire, not the fix.

**True deferred registration** (uncommitted)
- `POST /api/auth/confirm-signup` creates the auth row (pre-confirmed)
  only after the code proves the inbox — signup itself only sends mail,
  so nobody is ever registered without verifying. Returning logins keep
  the classic verify path; double submits return exists-and-sign-in.
  Verified end-to-end locally (wrong code/short pw/good code, row burn,
  profile trigger, cleanup).
- Fixed the wizard Finish "Nothing to update": the PUT handler read
  `setup_done` off the raw body string instead of the parsed JSON.
- Fixed the endless "Confirm email" spinner: `run()` set a "loading" status
  and never cleared it, so the code screen (reached from inside signup, or
  sign-in when verification is pending) rendered its button permanently
  `disabled` with a spinner — the click never even fired. Success paths now
  release the status unless they already moved it to "ok". This was the real
  cause of the "button circles forever" reports, not the deploy restarts.
- Login + welcome now follow `config.js`'s rule: on localhost they call the
  local backend, elsewhere Render. They previously hardcoded Render, so any
  brand-new endpoint 404'd (no CORS → "Failed to fetch") when testing locally.
  Full flow verified locally end-to-end: signup → code → account created →
  wizard (username/password/style) → chat, `setup_done` flipped true.

**Welcome wizard + delete-my-account** (uncommitted)
- New `/welcome` setup wizard (`cudic-test`, re-exported): Username for
  everyone, Password for email accounts, Style accent pick — non-skippable
  pages, no back doors in the UI. Display-name field removed from signup.
  Entry fenced at login boot, post-auth routing, and classic chat OAuth
  return (explicit `setup_done === false` only, so old rows and missing
  profiles fall through to chat).
- `users.setup_done` (migration `20261015120000_profile_setup.sql`,
  grandfathered true; new signups false), surfaced in GET /api/profile
  and flippable once via PUT.
- Profile Security gains Delete my account: leaving message, type-the-
  shown-code, press-and-hold confirm. `DELETE /api/account` (seat-checked)
  best-effort purges storage then deletes the auth user (rows cascade,
  same path as the purge). No captcha provider: the code + hold *is* the
  bot gate; Turnstile stays a follow-up needing Cloudflare keys.

**Creator avatars in gallery + game pages** (uncommitted)
- The games list and single-game endpoints now select the owner's
  `avatar_url`; cards and the game page show the picture with an initial
  fallback. (Cards showed initials because the API never asked for it.)

**Back navigation on railless pages** (uncommitted)
- Terms, Privacy, and Guide pages (all `data-no-rail`) gain a ← Back
  button (history-aware, falls back to home) plus a Cudic home link.

**Terms page + profile nav and analytics** (uncommitted)
- New long-form `/terms` page (routes in `server.js` + `vercel.json`,
  sitemap entry). Profile sticky nav gains an Analytics section (creator
  stat tiles + top games via `/api/creator/stats`) and a Site group
  linking Privacy, Guide, and Terms.

**Profile page rebuild** (uncommitted)
- Docs-style three-column layout: sticky tab nav (Profile, Security,
  Coins, Analytics, Liked, Appearance) showing one section at a time with
  the live "What others see" preview always visible, plus a Site group
  (Privacy, Guide, Terms). Email confirmation moved under Security; all
  existing IDs and flows untouched.

**Login spotlight fix** (uncommitted, `cudic-test` + re-export)
- The form card's MagicCard spotlight was permanently painted (inline
  opacity beat the hover gating) in dark `#262626` — invisible on dark,
  a dirty smudge on light. It now appears only on hover and follows the
  theme (graphite on dark, soft signal-tint on light). Rebuilt export
  copied to `public/` (`login.html`, `index.html`, `_next`).
- Follow-up: dark spotlight softened (0.45 opacity, 180px radius) after
  it read too intense on hover.

**Creator dashboard v1** (uncommitted, backend + Your Projects)
- `GET /api/creator/stats`: per-game plays/likes/comments/forks,
  per-pack downloads/sales/revenue, balance + receipts, open reports.
- Creator overview section with stat tiles and top-5 games. No migration.
- Requires running `supabase/migrations/20261014130000_music_tracks.sql`;
  pre-migration the music section stays empty without errors.

**Coin anti-abuse caps** (plan.md 2.3 — uncommitted, backend only)
- Ledger-read daily spend (1000), seller daily earnings (10000), and
  purchase velocity (10/hour) caps on pack buys, each a 429 with a plain
  message. Free/repeat buys exempt. No migration; tipping/paid-game rules
  arrive with those features.

**Google AdSense verification** (`f1bc10d`, `fb142d3`)
- Account-level `adsbygoogle.js` snippet site-wide (static heads + sidebar
  injection), `ads.txt` with the publisher ID, `/privacy` page + routes,
  ownership `<meta>` tag. Site verified; review requested with all
  sensitive categories blocked. Adsterra slots paused meanwhile.

**Magic email codes** (`15327eb`, migration `20261011120000_email_codes.sql`)
- 6-digit codes over our own mail stack replace the magic-link flow
  (in-memory tokens retired): `POST /auth/send-code` (hashed, 10-minute
  expiry, Resend → SMTP fallback, rate-limited) + `POST /auth/verify-code`
  (constant-time compare, 5 attempts then burn, flips `email_confirm`).
- Soft enforcement via `needVerified()`: publish/unpublish/delete games,
  comments, packs, reports, server create, and WS join/send 403 with
  `email_unconfirmed` for unconfirmed email signups. GitHub OAuth and
  pre-existing accounts exempt. Reads, playing, browsing stay open.
- Login card flips to a code screen after signup (resend + cooldown);
  profile gains a verify card for anyone who closes the tab mid-flow.
- Hard gate, total coverage: login + chat boot bounce unconfirmed accounts
  to the code screen (`GET /auth/verification-required`); **every**
  authenticated write (likes, DMs, friends, quests/coins, packs, saves,
  servers, channels, AI proxy, forks, imports) 403s `email_unconfirmed`
  via `needVerified()` — reads, play counts, and the session machinery
  stay open. A daily sweep deletes email accounts still unconfirmed after
  24h (GitHub + pre-code accounts exempt; everything cascades).
- Mail goes HTTPS-only: Gmail API first (own Gmail account, `gmail.send`
  scope, `GMAIL_*` env — no domain, phone, or card), Resend SDK second,
  Brevo API third (coded but unconfigured — its phone/address verification
  is a non-starter). Render's free tier seals outbound SMTP ports, so
  nodemailer's SMTP path was deleted.

**Embeddable games** (`embed.html`, `/embed` route)
- Chromeless player: cover (thumbnail/title/author + ember play button),
  sandboxed `run.html` boot on click, local-only saves (no sign-in nudge
  inside other sites' pages), one honest play-count per click, "Play on Cudic"
  return link. Unpublished games get a notice, never the player.
- `/embed.html` exempted from `X-Frame-Options` (everything else keeps
  `SAMEORIGIN`); `/embed` rewrites in `vercel.json` + `server.js`.
- Share modal on game pages: link row + fixed `485×402` and responsive
  `100%×400` iframe snippets with copy buttons; drafts see link-only.

**Gallery + type refresh** (`9c44757`)
- Tag chips removed everywhere (gallery toolbar, game page); toolbar
  rebuilt as one row (title removed, search grows, sort pinned).
- Satoshi body + Epilogue headings (theme-pack lists, engine map, server
  allowlist, and design docs updated to match).
- Global squircle corners (`corner-shape: squircle`, circles exempt).
- Docs remade as reference layout (section nav, breadcrumb, sub-TOC,
  hash routing); docs + privacy pages drop the rail (`data-no-rail`).
- Single-seat sessions: pages claim only when minting fresh, normal loads
  heartbeat (no more phantom "other instance" kicks); second tabs stand
  down silently with no banner.

**Next.js landing page** (built in `cudic-test`, shipped as static files)
- `/` replaced with the new landing: kinetic title, dock nav with hover
  labels, flying-in sections, tilt cards, magnetic buttons, and a fixed 3D
  backdrop streaming 7 Kenney CC0 models from the asset library.
- Static export (`out/`) copied to `public/` (`index.html`, `_next/`,
  `models/`); old page kept unrouted at `index-legacy.html`. No server,
  API, or other-page changes; immutable cache on `/_next/static/*` and
  `/models/*`, `index.html` stays no-store.
- Theme toggle reads/writes the site's own `glox_theme` preference
  (dark default) so packs and other pages keep working.
- Cookie consent: bottom banner (Reject / Choose / Accept) + full settings
  modal (Essential locked, Preferences, Advertising), choice in a
  `cudic_consent` cookie; AdSense script loads only after advertising
  consent; footer gains a Cookie settings link.

**Next.js login page** (same `cudic-test` static-export pipeline)
- `/` login replaced with a Magic UI + Canvas UI build: particle Kenney
  model stage (push-around particles, 7s rotation), meteor/particle
  backdrop, MagicCard spotlight form, shimmer submit, animated
  sign-in/create tabs, shake-on-error, confetti success burst.
- Real auth, not the demo: same Supabase project (sessions carry over),
  Render API for codes, hard email gate (unconfirmed lands on a matching
  6-box code screen with resend cooldown), GitHub OAuth → `/chat`,
  guest → `/chat`. Old page kept unrouted at `login-legacy.html`.

### Fixed

- `GET /api/games/liked` always 404'd — the route sat below the generic
  `/api/games/:id` handler, which swallowed it. Moved above; profile liked
  games list works again.
- Malformed `?token=` values no longer burn Supabase lookups (JWT shape
  check client + server; instant 401).
- Gallery script killed by a dangling `async` after the tag-listener
  removal — grid loads again.
- Embed cover bugs found in testing: gradient overlay swallowing Play
  clicks (`pointer-events: none`) and `display:flex` overriding `hidden`.

### Changed

- `sidebar.js` → v11, `sidebar.css` → v23, `theme-engine.js` → `?v=1`.
- Rail icons render at full `--text-primary` for contrast.
- `privacy.html` pins `sidebar.js?v=11` (was v8); sitemap gains `/login`
  and `/privacy`; endpoint docs drop the deleted `/auth/verify`,
  `/api/lobby` and `/api/lobby/persistent` routes.
- Rail brand is the raw C mark (no wordmark, no chip), linking `/` for
  guests and `/games` for signed-in users; `sidebar.css` → v24,
  `sidebar.js` → v12.

---

## v1.2 — 2026-10-09

**Studio file viewers · IndexedDB auto-save · searchable Kenney library**

The biggest release yet. Studio grows a real file-viewer pane (3D models,
PowerPoint, spreadsheets, zip), a browser-database auto-save so a frozen tab
no longer loses work, and a searchable Kenney asset library spanning 48,192
images and 4,812 3D models. Also lands the Glox → Cudic rename, the Cudic AI
panel, theme packs, Studio on Vercel, cloud saves, single-seat sessions,
virtual coins, a chat rebuild, and the Music Lab.

### Added

**Studio file viewers** (`studio/src/glox.ts`)
- `.glb` 3D model viewer — three.js `GLTFLoader`, camera auto-fit, grid,
  spin + wireframe toggles. Resolves Kenney's external textures (e.g.
  `Textures/colormap.png`) via the `parse()` base path, since a bare `blob:`
  URL cannot resolve relative texture URIs.
- `.pptx` viewer — `@aiden0z/pptx-renderer` (DOM rendering, selectable text,
  `RECOMMENDED_ZIP_LIMITS` guard for untrusted files).
- `.xlsx` / `.xls` viewer — SheetJS with clickable sheet tabs.
- `.zip` viewer — JSZip entry listing.
- `mimeOf()` returns real office types (docx/pptx/xlsx/xls) so published games
  serve and download them correctly.

**IndexedDB auto-save safety net** (`studio/src/project.ts`, `main.ts`)
- Snapshots the live editor state to IndexedDB every 15s, plus on tab-hide
  (`visibilitychange`) and tab-close (`beforeunload`).
- Restores on boot, so a frozen tab does not cost unsaved work.
- Clears on save/publish so a stale local copy cannot clobber a newer
  published version.
- Binary-safe: `Uint8Array` survives via structured clone (localStorage
  cannot hold assets). Unsaved text is read from the live Monaco models
  (`vscode.workspace.textDocuments`) overlaid on the provider's files.

**Searchable Kenney library** (`studio/src/kenney.ts`)
- Searchable picker over 48,192 images + 4,812 `.glb` models, fetched at
  runtime from the upstream repo — never committed to this codebase.
- Images insert an `<img>` at the cursor; `.glb` models land as project
  files.
- Pinned upstream tree SHA for the 3d index; images track the branch.

**Studio on Vercel** — build Studio on Vercel and serve `/studio`; binary
assets end-to-end with a `games/mine` endpoint and a Your Projects tab.

**Preview assembly** — project-aware preview assembly that inlines local
css/js, a native icon preview toolbar, canvas-bitmap thumbnail capture, and
canonical URLs switched to `cudic.vercel.app`.

**Cloud saves & sessions** — account-bound cloud game saves, single-seat
sessions (one live seat per account), X-Seat through CORS preflight.

**Cudic AI panel** — the Cudic AI panel in the workbench, premade AI skills,
project file tools, and a terminal AI panel with runtimes, pack builder,
seed games, and legacy scene conversion.

**Theme packs** — community theme packs with a builder and store, pack
reports, and a coins ledger + schema.

**Chat rebuild** — chat rebuilt on servers, channels, DMs, and friends;
lobbies removed; strict sign-in.

**Gallery** — findable gallery with tags, trending, likes, and play counts;
catalog heroes with sort; gallery cards; denser sidebars; a share loop with
share button and thumbnail endpoint.

**Sidebar & theme** — dark mode by default, collapsed rail with tooltips,
page panels, Web Awesome loader.

**Music Lab** — Music Lab at `/music`, plus accent persistence across
navigation and a custom accent color.

**Landing & auth** — marketing landing page, `/login` split, SEO foundations,
rebuilt login page with Fredoka/Nunito fonts, Baloo 2 rail wordmark, an
email-verification system (Resend + Supabase confirm, Gmail/SMTP/Supabase
fallbacks), and a user-ID system with publish modal.

**Scratch import** — import Scratch projects (`.sb3` or shared link) into
Studio.

**Kenney icon library** — Kenney CC0 icon library with a Studio insert
command (later superseded by the searchable library above).

**Seed games** — chess and tic-tac-toe seed games with a Stockfish service
(chess later archived).

**Docs** — docs page, `product.md`, refreshed `AGENTS.md`.

### Changed

- Renamed product **Glox → Cudic** (visible strings only; command IDs and
  storage keys unchanged).
- Cache-busted game loads; Studio/editor read the API base correctly on
  production; theme packs moved to `/packs` so `/themes` serves the store.

### Fixed

- `document.write` player, version handshake, cache discipline, asset-only
  guard; XML-invalid comments stripped from thumbnail capture; editor content
  no longer hidden behind the sidebar; OAuth callback flows finished; broken
  fluid.js/gsap references stripped; inline-script comments converted so
  pages parse; Supabase loader made a singleton.

### Commit log (v1.1 → v1.2)

- `8ad08f2` feat: Studio file viewers, IndexedDB auto-save, searchable Kenney library
- `3a5ccd4` chore: archive chess, remove from the main site
- `f36546f` fix: download Stockfish instead of apt, which cannot run on Render
- `1b7f777` feat: chess and tic-tac-toe seed games, Stockfish service
- `351ec10` feat: Kenney CC0 icon library with a Studio insert command
- `f844f15` fix: allow X-Seat through CORS preflight
- `300cfda` style: flatten tag filters and likes into text, not pills
- `a3767ca` feat: findable gallery with tags, trending, likes and play counts
- `b62ff27` feat: docs page, plus quest claim button fix
- `723453d` feat: import Scratch projects into Studio
- `a88f2f0` feat: minimal Baloo OG images plus transitive remix credit
- `aadd145` fix: Studio and editor read API base correctly on production
- `8e659f3` fix: cache-busted game loads plus button base classes
- `c7d8bd3` feat: unremovable remix credit plus single-game embed fix
- `70cda2c` feat: account-bound cloud game saves
- `8eba9c9` feat: single-seat sessions plus Duo-style seed games
- `37be268` chore: ignore local-only noise
- `8f9a871` feat: terminal AI panel in bottom bar, runtimes, pack builder, seed games, legacy scene conversion
- `ec81886` feat: virtual coins, community theme packs with builder and store, pack reports
- `d84b95c` feat: coins ledger plus theme-pack and report schema
- `a272fa1` feat: catalog heroes with sort, gallery cards, denser sidebars, custom accent picker
- `2d0b86d` feat: dark mode by default, collapsed rail with tooltips, page panels, Web Awesome loader
- `923a7c0` feat: rebuild chat on servers, channels, DMs and friends; remove lobbies; strict sign-in
- `e8d147b` docs: add product.md; update AGENTS.md
- `4c0128d` feat: Music Lab at /music; fix accent persistence
- `5958aa9` feat: rebuild login page, Fredoka/Nunito landing fonts, Baloo 2 rail wordmark
- `7a74296` feat: premade AI skills and project file tools in Cudic panel
- `d9492bd` fix: strip XML-invalid comments in thumbnail capture; switch canonical URLs
- `c6a2d3c` fix: refresh session for Your Projects tab; capture canvas bitmaps
- `5842287` feat: redesign landing page as light editorial layout
- `b7363c6` chore: refresh /studio screenshots
- `2949f79` fix: move theme packs to /packs
- `52fd7c5` add share loop: share button, thumbnail endpoint
- `06c86dd` docs: refresh AGENTS.md
- `d3cb2dc` feat: marketing landing page, /login split, SEO foundations
- `7de42e7` feat: project thumbnails, full model catalogs, rail brand animation
- `17b6043` feat: Cudic AI panel, theme packs store, sidebar push-aside, editor context menus, gallery motion
- `5add766` feat: rename product Glox to Cudic
- `ef7c1a5` fix: document.write player, version handshake, cache discipline
- `cde9d8c` feat: per-game comments + publish toggle
- `d90d474` feat: native icon preview toolbar, project-aware preview assembly
- `6c933f0` fix: preview assembly inlines local css/js
- `500c479` feat: build Studio on Vercel, serve /studio
- `0adf1de` fix: gallery Your Projects accepts ?token= URL sessions
- `bbe3be9` feat: studio binary assets end-to-end, games/mine endpoint
- `c690040` feat: owner-only editing
- `fe9f27c` fix: bake game id into card click handler
- `3fb83a0` fix: studio reads login session
- `32fdc2f` feat: studio run/import/markdown fixes, XSS + rate-limit hardening
- `e0520fa` fix: getSupabase always returns promise
- `df98e6c` fix: serve email from profile API
- `800bcf7` feat: generic SMTP fallback
- `77a4ce1` feat: Gmail SMTP fallback
- `76e24c2` feat: Supabase-native verification fallback
- `04cae32` fix: single client-first auth token source
- `bf7a8a4` fix: OAuth failure diagnostics toast
- `dfc4967` fix: handle both OAuth callback flows
- `61468c5` fix: finish GitHub OAuth
- `9ba802c` feat: studio IDE, profile page, auth routing cleanup
- `1d92b7c` Merge branch 'fix-inline-scripts'
- `e35dfd8` feat: Scratch-inspired palette, local route parity
- `af0e112` Merge branch 'fix-inline-scripts'
- `fc38bc9` feat: light-only sunny theme, single-card sidebar
- `3f6c004` chore: redact secrets into gitignored .env
- `90e28fe` chore: redact secrets into gitignored .env
- `c8fb2c7` one line 7.7kb fix
- `7f39547` fix: convert // comments to block comments in minified inline scripts
- `fc1bccb` fix: make Supabase loader singleton + error handling
- `b4b5ad9` fix: strip broken fluid.js/gsap references

---

## v1.1 — 2026-09-18

**Stable Split Sidebar**

A 57-commit push focused on the sidebar, chat, and publishing. The sidebar was
reworked into a split, theme-proof design; chat grew servers, group chats, and
history persistence; a user-ID system and publish modal landed; and the UI was
rebuilt per `design.md` with fluid GSAP motion.

### Added

- Split sidebar into two cards with a gap and rounded corners; top brand as a
  single theme-proof SVG.
- Chat rebuilt on servers — user-owned group chats (max 3), visibility,
  invites, a server page, and a sidebar.
- Chat history persistence (creator toggles persistent vs 24h auto-delete).
- User-ID system (unique numeric ID per user, editable display name, profile
  API).
- Publish modal with thumbnail, description, and credits; gallery shows
  thumbnails.
- Fluid GSAP animations — stagger, hover, sidebar expand, modals, chat.
- Full UI redesign per `design.md` — color tokens, Space Grotesk/Inter fonts,
  signal accent, SVG icons, two-panel auth, empty states, light mode.
- Google site-verification files.
- Nine Circles font for logo branding.

### Changed

- Sidebar made fixed-position overlay; content fills full width; labels hide
  cleanly when collapsed; icons center; widened to 72px.
- Home shows a lobby picker instead of auto-joining Welcome; logged-in users
  auto-join Welcome.
- Public servers join without a code (owner-only persists); guest messages can
  save (nullable user_id); welcome/hello persist by default.

### Fixed

- Brand always visible and high-contrast; GSAP fluid overlays removed; logo
  reverted to clear Space Grotesk; chat font/contrast; server lobbies hidden
  from Active; WebSocket closes on page leave (ghost lobbies); sidebar nav
  preserves URL params; content fills width; both PKCE and implicit OAuth
  flows; stale-CSS cache busts.

### Commit log (v1.0 → v1.1)

- `601791a` feat: split sidebar into 2 cards with gap + rounded corners
- `c4ba9d6` fix: force brand always visible, cache bust v5
- `ed9eef4` fix: brand shows on hover, stays solid white
- `beed8be` fix: force brand visible solid white, cache bust v4
- `6db5659` fix: remove all GSAP fluid overlays and effects
- `b40800a` fix: strip overlays - solid white logo
- `762ef7d` fix: keep brand visible when collapsed, boost contrast
- `88dd964` fix: make brand high-contrast white with black outline
- `fd93695` fix: logo back to clear Space Grotesk
- `f5ad57b` fix: revert headings to Space Grotesk
- `cf4a5f7` feat: logo always white with dark outline
- `ee01e3e` feat: stretch brand area
- `a2e41d7` fix: chat without lobby redirects; add Nine Circles font
- `f58d668` feat: dedicated lobbies panel
- `1b8e92d` fix: cube logo stroke visible when collapsed
- `ee5949b` fix: light mode text contrast, sidebar spacing
- `7cdba98` fix: clearer chat font
- `29a3b26` fix: hide server lobbies from Active; ws closes on page leave
- `aca139b` feat: google verification html file
- `bce3378` feat: google site verification meta tag
- `9f738ea` feat: fluid GSAP animations
- `a355f7b` feat: collapsed Your servers label becomes a divider
- `94f1e47` fix: prevent squish - hide collapsed labels
- `b3f3dd3` fix: remove Home/Editor from sidebar
- `2e3f3ed` fix: keep avatar + servers visible when collapsed
- `73e536c` fix: hide collapsed label so icon centers
- `0fe4972` fix: ensure icons perfectly centered when collapsed
- `93a814d` fix: center icons when collapsed
- `5661bd2` fix: widen collapsed sidebar 60->72px
- `408d591` fix: sidebar auto hover expand, public servers show
- `0e0e4ed` fix: public servers join without code, persist for owners
- `8ff937d` fix: persist welcome/hello by default
- `136f790` feat: servers - user-owned group chats, invites, server page
- `85f2411` feat: chat history persistence
- `ecd42ae` feat: game cards show creator name, avatar, user ID
- `8bcdabf` fix: modal buttons use addEventListener
- `c63542f` fix: Save = quick save, Publish = modal
- `276133a` feat: publish modal with thumbnail, description, credits
- `fd56836` feat: user ID system
- `84b4e62` fix: home shows lobby picker, add logout button
- `702d9ff` chore: cache bust CSS
- `e002964` fix: handle both PKCE and implicit OAuth flows
- `cdb866e` fix: cache bust stale CSS
- `2b17338` fix: editor content hidden behind sidebar
- `5941487` fix: sidebar nav preserves URL params
- `f044169` fix: chat/games fill full width
- `24f5825` feat: logged-in users auto-join Welcome lobby
- `f5cf26a` feat: full UI redesign per design.md
- `630d2b9` fix: sidebar is now fixed-position overlay
- `38b1169` fix: content fills full width
- `0d2a388` fix: sidebar layout - body is flex row
- `b491bdc` fix: hide chat sidebar by default
- `3ea3a58` feat: sidebar navigation + redesign all pages
- `2f3b953` fix: pass access_token from OAuth callback
- `1697c1d` refactor: remove Scripts/Material tabs
- `16c6178` feat: packages system - built-in materials, shaders, scripts
- `b9b6faa` feat: split panel layout system with draggable splitters

---

## v1.0 — 2026-09-16

**Full Editor (pre-panel refactor)**

The initial 40-commit release. Ships the Glox real-time chat product and a
Unity-style game editor with a Three.js 3D viewport, hierarchy, properties,
materials, scripting, save/publish, and a gallery. Auth is Supabase OAuth
with email verification.

### Added

- Initial product: Glox real-time chat lobbies (Vercel/Render split).
- Game editor — Three.js 3D viewport, hierarchy, properties panel, save/publish.
- Material system (Standard/Phong/Lambert/Toon/Custom Shader).
- Right-click context menus everywhere (hierarchy, viewport, file explorer);
  folders in the file tree.
- Undo/redo, file explorer, script attach/delete, console.
- Camera system — Directional/Spot/Ambient/Hemisphere lights,
  Gradient/Starfield/Solid skyboxes, camera preview, frustum visualization,
  play mode locked to scene camera, camera Attach-To dropdown.
- Sandboxed play mode with a `document.write` player and version handshake.
- Gallery page + nav tabs; games table schema + CRUD API.
- Sidebar navigation across all pages; dark/light mode toggle; lobby picker.
- Email verification (Resend + Supabase confirm); Supabase OAuth; persistent
  messages and message history; WebSocket heartbeat.

### Fixed

- Play-mode race condition; iframe srcdoc ordering; transform helper crash;
  inline `onclick` replaced with `addEventListener`; viewport sizing with
  ResizeObserver; context-menu stopPropagation; lobby user dedup; token=
  undefined in URL; CORS headers for verification email.

### Commit log (root → v1.0)

- `54cf2b7` release: pre-panel-refactor snapshot (v1.0)
- `b683e54` feat: play mode locked to scene camera
- `7cd0c3b` fix: clear iframe srcdoc before setting src
- `d68c0d6` fix: play mode race condition
- `6999616` feat: camera frustum visualization, camera preview
- `b1fd696` feat: lights, skyboxes, context menu, file tree
- `974e25d` fix: stopPropagation on contextmenu handlers
- `801701c` fix: restore .panel-tabs CSS
- `92ff35d` feat: right-click context menus, folders
- `aed2a76` feat: undo/redo, file explorer, material system
- `fc465af` fix: remove transform.getHelper() crash
- `6a2de4c` fix: buttons wired via addEventListener
- `5848509` feat: Unity-style editor — Monaco scripting, sandboxed play
- `0a1f26a` fix: brighter scene, visible grid, ground plane
- `e88b45d` feat: Game Editor + Gallery buttons to chat sidebar
- `85bd4c3` fix: add /games and /editor routes to vercel.json
- `37cdb37` feat: game editor + gallery page + nav tabs
- `81313b8` feat: games table schema + CRUD API
- `bdaa83d` fix: deduplicate lobby users + token=undefined
- `818f43e` fix: WebSocket heartbeat to kill ghost lobby connections
- `611b7f7` fix: re-check verification status when tab regains focus
- `7275134` fix: add CORS headers for verification email
- `f170283` fix: make Resend email failure non-blocking
- `21408cb` feat: email verification system
- `25297fd` feat: add 3D canvas background to chat page
- `a06f289` fix: lock card center with position fixed
- `0be681f` Remove tagline, keep panel centered
- `7924e58` Pixel art canvas UI with new color palette
- `454b8ef` Fix lobby count not updating on homepage
- `4409185` Show account created then auto-login after signup
- `36a9b13` Fix WS_URL, OAuth callback, client-side code exchange
- `52c7218` Restyle to clean zinc + blue palette, drop purple slop
- `a7e98ef` Merge login + lobby into single split-layout page
- `937ec13` Redesign login page with split layout and dark theme
- `b7899ae` Add rewrites for login and index pages
- `dd7a3a6` Add real Supabase credentials
- `ad64d03` Add Supabase: OAuth, persistent messages, message history
- `6f29bbc` Set WS_URL to Render backend
- `5cbd8c5` Add Vercel/Render split deployment configs
- `4d06379` Initial commit: Glox real-time chat lobbies
