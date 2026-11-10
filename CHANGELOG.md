# Changelog

All notable changes to Cudic are documented here. Releases are versioned
(`v1.0`, `v1.1`, `v1.2`) and each entry lists what was added, changed, or
fixed. Commits are referenced by short hash.

---

## Unreleased

**Playtests, RSS, gamepads and a site-wide palette**

- **Playtest links**: a game page now has an owner-only **Playtest link → Create 7-day link**. The server signs an expiring token, so anyone holding the URL can play the unpublished build without it appearing in the gallery, search or your profile. Testers get a feedback box; their notes land in the game's devlog card under **Playtest feedback**, visible only to the creator.
- **Update log RSS**: `/updlog` is now subscribable at `/updlog.xml` (RSS 2.0, newest 50 entries, anchors on every post). A Vercel rewrite points the feed at the API, so readers work without an account.
- **Gamepad support (`CudicPad`)**: every player frame now loads `cudic-pad.js`. Games can poll `CudicPad.get()` for axes/buttons or subscribe to `buttondown`, `buttonup`, `axischanged`, `connect` and `disconnect`; no parent-page mediation, and nothing leaves the sandboxed frame.
- **Ctrl+K command palette**: press `Ctrl+K` (or `⌘K`) on any main page to jump to a page or search games, creators and forum threads live. The palette loads with the rail, so no per-page setup; it is also on `/docs`, creator pages, `/faq` and `/parents`.

**Update log sync**

- **“Sync from GitHub” works in production again**: the button read `GITHUB_TOKEN`, an env var this project never sets, so every moderator got the red “Set GITHUB_TOKEN in Render env” error. It now accepts `GITHUB_TOKEN` or `GITHUB_PAT`, falls back to the signed-in moderator's connected GitHub account, and syncs the public repo with no token at all — so a moderator without a GitHub connection is not blocked. It also fetches `opencodepers/Cudic` instead of the old `nathent2023-glitch/Cudic` owner, which 404s even with a valid token. `GITHUB_REPO` can point a fork elsewhere.
- **Synced entries name their author**: the webhook and sync used to write `by Sophi` into `body`, so a card showed “by Sophi” and “team” at once. Commits now store `author_name` (migration plus a narrow backfill of the synthetic bodies), and the card shows `Sophi · time` with no duplicate line.

**Landing page polish**

- **The closed mobile menu is no longer a keyboard trap**: it sat at `right:-260px` but stayed tabbable, so Tab walked through invisible links; it is now `visibility:hidden` when closed and visible when open, the burger is 44×44 on mobile with hover/open states and `aria-controls`, its label flips to “Close menu”, and Escape closes the drawer and both dropdowns and puts focus back on the burger. A skip-to-content link now lands on `<main id="mainContent">`.
- **Signed-in nav keeps its icon**: the profile refresh wrote `textContent`, which deleted the user icon and made the follow-up `img` lookup dead; it now updates a `.navlabel` span, so the name and the icon both survive.
- **Motion and hover follow the user's settings**: reduced-motion now also stops the hero caret blink, the rocket fly, the mascot wave and the doodle hop, and drops the section fades; hover lifts are disabled on touch (`hover:none`), and headings and leads use `text-wrap:balance` / `pretty` so lines break deliberately instead of orphaning a word.

**Source Control**

- **An import is now a connection, not a copy**: importing a repository used to leave the project tracking nothing, so the repo could move on and the game never knew. Saving a project that came from GitHub now sends its source, the server verifies it can read the repository with your token, and records the repo, its default branch and its owner as the login allowed to deploy. That repo's next commit on that branch deploys a release — with no push from Studio. Repos that cannot be read with your token are ignored, and a database without the deploy columns saves normally by dropping them and retrying.
- **Forks share their assets instead of copying them**: a fork used to duplicate every stored object into a new prefix, so one 40MB game forked 500 times meant 20GB of storage. A fork now records `asset_owner` — the game whose prefix holds the bytes — and points its manifest there. Deleting a game copies its prefix into each child and rewrites that child's manifest before the bytes go away; if a copy fails, the bytes stay. Databases without the column still fork by copying, so the old path remains correct, just expensive.
- **The asset picker fails soft**: it made two network calls to the upstream Kenney repo and an empty result was the only failure mode. It now degrades per half — a rate-limited 3D index no longer costs you the image library — and falls back to the 679 icons committed under `/assets/kenney`, which are served from this site and carry their own URLs. Cards say `CC0 1.0 · Kenney`, and the bundled manifest finally records its license and author.
- **Game outline**: `Cudic: Game outline` writes `outline.json` (loop, scenes with goal/win/lose/next, mechanics, what to add after) and a matching `DESIGN.md`, then regenerates the markdown from the JSON on request. It is the one file the AI panel can read to know what you are building.
- **[/start](https://cudic.vercel.app/start)**: the five-step path — template, run, remember, art, ship — each step linking the single page that covers it, instead of handing a beginner the whole docs page and hoping.
- **Fixed: AI sessions never saved**. `/api/ai/sessions` selected and updated `users.ai_sessions`, a column no table had — the select errored into an empty list and every save was rejected. The column now exists as `jsonb not null default '[]'`.
- **Fixed: play counts never moved and asset storage pointed at a missing bucket**. `/api/games/:id/play` called `bump_play_count`, an RPC no migration ever created, so `games.play_count` stayed frozen and the 100-play `viral`/`renowned` awards could never fire; the function now exists and returns the new count. Every asset read/write, GitHub snapshot and fork copy uses `storage.from('game-assets')`, but production only had a stray upload policy and no bucket — Supabase answered `NoSuchBucket`. Both buckets are now declared in `migration/storage-buckets.sql`, and a test refuses an RPC or bucket that no migration declares.
- **Fixed: sidebar initials fallback and a sticky auto-scroll bug**. `sidebar.js` called `initials(...)` inside `fetchProfile`, where no such function existed — the only `initials` was a string in another callback — so the throw was swallowed and anyone without an avatar kept the JWT-derived letters instead of their display name. There's now one `initialsOf(name)` helper for both paths. In `client.js`, older-message pagination swapped `scrollToBottom` for a no-op and restored it after the loop; a throw mid-insert left it disabled for the rest of the session, so the restore now lives in `finally`.
- **Fixed: saves failed after the split**. The storage-usage cache moved into `lib/storage-budget.js`, but the save handler still referenced the old module-scope name. Every save wrote correctly and then threw while building the response: HTTP 200 with `{"error":"Something went wrong."}` and no game payload, since 19:45 UTC. The module now owns invalidation via `forgetStorageUsage(userId)`, and a test refuses a bare cache reference in `server.js`. Found by exercising a real publish in production.
- **Fixed: published releases served no files**. `latestRelease` selected `id, label, files, manifest, created_at` and dropped `game_id`, but `revisionFilesOf` filters `revision_blobs` by `row.game_id` — so the blob lookup matched nothing and every release handed players an empty project. Publishing a probe game against production exposed it; the select now carries `game_id`, and a test pins that column so a narrower select cannot regress into blank games.
- **The server split, second cut**: the award catalog, the cosmetic shop and the daily login streak moved into `lib/cosmetics.js` and `lib/streak.js`, both factories over the Supabase client. Shop prices, slot caps and the earned-or-bought title union now live in one file with the resolution logic that reads them; the streak keeps its race-safe optimistic update and ledger-idempotent `streak:<date>` payout. `server.js` is down to 8,177 lines, and its route chain still owns every handler.
- **The server split, first cut**: `server.js` no longer owns everything. Web push, the per-account storage budget and the `/view.html` share-card rewrite moved into `lib/push.js`, `lib/storage-budget.js` and `lib/share-card.js` — each a factory that takes the Supabase client, so no module reaches for a global. The route chain, ordering invariants and startup stay in `server.js`, now 8,279 lines; the modules keep the same behaviour and their own file notes.
- **Polish and structure pass**: rail pages finally have a keyboard focus ring (`:focus-visible`, theme-aware `--signal`) instead of none; docs deep links land below the sticky rails (`scroll-margin-top` on anchored sections and headings); `docpage.css` is one version everywhere (`?v=7`) instead of docs on v6 and the rest on v4, and the shared-asset gate now covers it so it cannot drift again. The docs sidebar groups its 31 sections into Build / Ship / Play / Community / Shop / Account rather than one flat list. Structurally, the preview document builder left `glox.ts`: `studio/src/preview.ts` now owns inlining, multi-file module mapping, `package.json` pins, TypeScript and asset URLs, so the editor shell is just shell.
- **Publishing is gated on tests**: `Ship` and `Publish project` run the project's tests first and refuse a red build, naming the failing tests (or the file that would not load); a run that cannot finish also blocks, because silence is not a pass. The publish request carries the counts, and `PUT /api/games/:id` rejects a release that reports failures with `tests_failed` before it flips `published` — so a stale Studio build cannot ship red either. `_release.json` records the counts the build shipped with.
- **TypeScript build step**: `.ts` / `.tsx` files compile to a sibling `.js` (marked `// generated from …`) on Save, with `index.html` and import specifiers repointed at the output; the preview does the same build in memory, so an unsaved edit still runs. `.d.ts` is never compiled, a hand-written `.js` is never replaced, and a compile failure stops the save instead of shipping broken code.
- **Project tests**: `Cudic: Run project tests` runs `*.test.js` (or anything under `tests/`) in a sandboxed frame with `test()`, `assert()` and `assert.equal()`, awaits async tests, reports in a `Cudic tests` output channel, and kills a hung run after 30s. Tests build through the same step as preview and publish.
- **Types on by default**: new projects get `cudic.d.ts` in the workspace, so `CudicSave` and `CudicMulti` are typed from the first file.
- **npm deps are pinned by `package.json`**: a project that declares `dependencies` now gets an import map built from that file at the version the author wrote (`"react": "^18.3.1"` → `esm.sh/react@18.3.1`), in the preview and in the published game, with `react-dom/client`-style subpaths resolving through the same pin. Ranges that cannot be pinned (`"*"`, `"latest"`) fall back to the CDN default, and a hand-written importmap still wins. Plain parse/pin helpers live in `npmutil.ts`; `run.html` mirrors them.
- **Typed runtime SDK**: `public/cudic.d.ts` declares `CudicSave` and `CudicMulti` (rooms, peers, events, queued sends) so projects get real signatures in the editor instead of `any`. Documented under npm packages.
- **Landing page is no longer themed**: packs restyle the app pages, not `/`. `sidebar.js` doesn't inject the engine there and the engine itself bails on `.landing`, so an installed pack can't repaint the front door, swap its fonts or its icons. The light/dark toggle still works everywhere. Docs copy updated from "restyle the whole site" to match.
- **Ownership holes closed**: a revision id was being treated as permission. Restore checked that the revision was yours but not that the game in the path was, so your snapshot could be written into somebody else's project; delete had no ownership check at all, so any signed-in account could drop another creator's history — live releases included. Restore now requires the revision *and* the game to be yours, delete is owner-scoped, and the storage insert policy no longer lets any authenticated account upload into any game's folder: the first path segment has to be a game you own.
- **See inside**: a published game now has a read-only view of its code alongside Fork. `?readonly=1` boots Studio with the real files, the real preview and no way to save, publish, ship, delete or change the thumbnail, with the label in the title bar instead of a surprise when Ctrl+S does nothing. Nothing new is stored and no project is created — looking is free and leaves no trace, and the write guards on the server stay the real fence.
- **Insert asset links images instead of copying them**: the picker used to download the CC0 file and register its bytes in the project, so every sprite was storage that also got duplicated by every fork. It now inserts an `<img>` pointing at the asset — the copy this site ships, or jsDelivr for the rest — and copies nothing. The project, the fork of the project, and the storage budget all stay unchanged. 3D models still copy: a `.glb` resolves its textures relative to itself.
- **A storage budget per account**: nothing stopped a creator from filling the bucket one game at a time. Saving now counts every distinct prefix the account owns and refuses a save that would cross 250MB (`STORAGE_CAP_BYTES` overrides it), with the used and total numbers in the message. Shared prefixes count once, so the cost of a fork is zero here too — and the Studio save toast says how much of the budget is gone.
- **Push to deploy**: a published game now names the repository it ships from (`games.github_repo`, plus the publish branch and the GitHub login that pushed it), so a commit to that repository becomes the next release. The webhook reads the pushed commit's tree through the git-data API — blobs raw, text only, capped — and ships it with the commit subject as the release notes and the sha as the source. Three guards keep it honest: the game must be published, the push must be to the publish branch, and the pusher must be the GitHub login that pushed from that project, so a fork or a pull request cannot release under your name. Until the `20261108120000_game_github_deploy` migration is applied the mapping write logs once and pushes carry on working exactly as before.
- **Publishing is a release, not a switch**: publish used to flip a boolean on the live row, so every save silently changed what players got and nothing could say which build they were on. A publish now snapshots the files into `project_revisions` labeled `release vN` with a `_release.json` carrying the notes and source, and the play page serves that snapshot while the row stays the working draft — save freely, ship on purpose. No schema change: it rides the revision tables that already exist, and a game published before releases existed keeps serving its row. The game page shows a `vN` chip, when it updated, and the notes, and **Ship** in Studio does save → notes → publish → link in one action. Source Control also reports how many commits are ahead of the last push and asks before a push, naming the files it will send.
- **The IDE is called CIDE**: Cudic + IDE. The window title, the workbench's title-bar indicator and the browser tab all read CIDE, and the top-left corner of the title bar carries Cudic's mark next to the name — the old purple Glox cube is gone from the chrome.
- **The activity bar emptied itself**: the previous pass appended Cudic's tabs into the workbench's own `ul.actions-container`. The workbench keeps that list and its action objects one-for-one, so a foreign row desyncs it; the next re-render fails part-way and takes Explorer, Search and the rest of the column with it, leaving only account and settings. Collab and Source Control now live in their own strip directly under the workbench's icons — sibling, never child — one 48px row each, so nothing VS Code re-renders can remove them, and they cannot corrupt its bookkeeping.
- **Collab and Source Control were missing from the bar**: the strip that holds them was mounted beside `.content`, which is `height:100%` — so it sat below a full-height box, off the bottom of the activity bar, and both icons were simply not on screen. It now mounts inside `.content`, directly after `.composite-bar` and under the workbench's own icons, which is where the 48px rhythm puts them.
- **Top-bar buttons did nothing, and the Collab panel hid every other tab**: the title bar is a window drag region, so Preview / Save / Exit rendered there looking finished while swallowing every click. They are mounted in the workbench's own `.titlebar-right` cluster with pointer events re-enabled, and a command that fails now says which one failed instead of dying in a rejected promise. The Collab and Source Control panels are overlays on the sidebar, so picking Explorer, Search or anything else below them looked like a dead tab; selecting another activity-bar tab now hides them. A tab that the workbench dropped while rebuilding the bar is also re-attached, which is why Source Control could be missing from the bar entirely.
- **Studio chrome, from review**: the browser tab has Cudic's icon; the Collab and Source Control tabs are now real activity-bar action items instead of `bottom:76px`/`bottom:128px` guesses, so they are spaced with the built-in icons and no longer sit on top of the account avatar; the activity bar uses the site palette (`#0d0e10` ground, `#b8f23a` accent) through the workbench's own theme variables; and **Preview / Save / Exit** sit in the title bar, where the review said people look for them.
- **Source Control** in the activity bar (branch icon, above Collab) is real Git, not a stand-in for it: `isomorphic-git` writes actual objects and refs, so commits have real SHA-1s and parents, history is the commit graph, branches are refs, and checking one out replaces the workspace files with that commit's tree.
- Every project gets its own repository, found by project id (or the draft key) and never by title — renaming a project keeps its history. A GitHub import records `origin`, so the panel initialises the repository and points it at the repo it came from the first time it opens; a project with neither a repository nor a source gets an explicit **Initialise repository** button and **Set GitHub remote…**.
- **"Sign in required" while clearly signed in**: Studio sent the raw `access_token` from localStorage, and a Supabase access token expires an hour after sign-in, so a tab left open kept sending a valid-looking JWT the server rejected. Repository reads and writes now refresh the session with the stored refresh token (and save the new session back) before asking for anything, so an old tab or a woken-up machine no longer looks signed out.
- **The repository now travels with the project.** IndexedDB is per browser and per origin, so history made on one machine was invisible on the next — a second device (or the same one after clearing site data) offered "Initialise local repository" again. Signed in, the repository's own files (`objects`, `refs`, `HEAD`) are stored with the project and restored before the panel decides there is no repository, so history, branches and `origin` follow the account. One JSON snapshot per project, kept in the assets bucket under `game-git/<project id>.json` — no schema change. Signed out, or an unsaved draft, stays local-only.
- The panel reports a real status matrix (`U`/`M`/`D`), the current branch (click to switch or create), and `origin`.
- **Push to GitHub** is a real write: the server builds blobs, a tree, a commit whose parent is the branch tip, then moves the ref — fast-forward only, and `base_tree` means an imported subfolder never deletes the rest of the repository. **Create GitHub repository…** makes the remote on the connected account and pushes the first commit itself (`Initial commit from Cudic`), because a repository made without `auto_init` shows GitHub's empty "Quick setup" page and reads like a failure. One click now leaves a repository that already holds the project.
- The first push to an empty repository failed with "GitHub answered 409 while reading the branch": GitHub answers **409** ("Git Repository is empty") rather than 404 for a branch that does not exist yet. Both now mean "no parent", so the commit is created without parents and the ref is created instead of updated.
- **Push to GitHub** still failed on a repository with no commits, now with "GitHub answered 409 while uploading index.html". Reading the branch was only the first half: GitHub refuses every git-data write (blob, tree, commit) on an empty repository, because there is no object database yet. The first push now creates that first commit through the **Contents API**, which does work on an empty repository, and then pushes the rest of the project as one normal commit; a 409 anywhere else says what GitHub actually refused instead of quoting a status code.
- **Commit looked broken while Push worked**: the two buttons asked different questions — Commit wanted a change, Push wanted only a remote — so a clean tree left Commit greyed and Push clickable, and pushing there uploaded the same files to GitHub again as a second commit. Push is now disabled when the remote already holds the commit HEAD points at (the tooltip names that commit), the Changes list re-reads itself on every file save instead of waiting for the refresh button, and a push records the files it published as a commit in the local repository, so HISTORY stops saying "No commits yet" right after a successful push.
- **`node tools/check-console.mjs`** is the gate the suite could not be: it runs `tests/run_tests.py`, boots Cudic on a spare port and walks Studio plus every top-level page in `public/` — 38 pages in about two minutes — in headless Chrome over the DevTools protocol, failing on console errors, uncaught page exceptions or failed loads and naming the page that produced them. `--pages /a,/b` narrows the sweep; one page's errors never hide another's. No npm dependency: Node's own WebSocket speaks the protocol, and the server and browser are killed on the way out. Its first run found two: the textmate worker destructuring `applyStateStackDiff` from undefined inside `@codingame/monaco-vscode-textmate-service-override` 37.1.0 (upstream — reported under KNOWN with that reason), and the AI panel probing the local model servers it knows (`localhost:11434` Ollama, `localhost:1234` LM Studio) when neither is running. `--strict` fails on warnings too, `--no-baseline` enforces the KNOWN list, `--all` prints every message.
- **New tagline**: *Write a game. Send a link.* The old line named the category; this one names the two moves Cudic makes — you write, you ship — and says in six words what the product is for. Updated on the landing page (title, social cards, meta description, hero line and structured data) and in the brand kit.
- **Signed-out pages asked for account data anyway**: `/collections` fetched `/api/collections?mine=1`, and `/shop` fetched `/api/profile` and `/api/cosmetics`, all with no session — a 401 in the console for a list that could only ever be empty. Each now checks for a session first and shows its empty state, and collections says *Sign in to keep collections.* instead of requesting nothing useful.
- **Exit** landed on the 404 page. The button went to `/account`, and the account page is `/profile` — the site has no `/account` route. It now goes where every other link in the app points.
- **Initialise local repository** and **Create GitHub repository…** are different things and the panel now says so: the first makes a Git repository inside this browser, the second makes one on your GitHub account. Neither is a step the other implies.
- **Creating a repository** failed with "Failed to fetch" while GitHub was never called: Studio sent `credentials: 'include'`, and the API answers `Access-Control-Allow-Origin: *` — a pair browsers refuse outright. Auth rides the `Authorization` header, so the credentials flag is gone from every Studio call, and a real network failure now names the API host it tried.
- **Initialise repository** no longer looks dead: the browser filesystem (`lightning-fs`) is a CommonJS class, so `import { FS }` was `undefined` and the constructor threw into a message that was rendered inside the hidden half of the panel. It is resolved from either export now, and any failure is shown in the panel and as a notification.

**A New menu that opens**

- **New** in the gallery did nothing, and neither did the gallery: the menu is a React island, and the page's own script grabbed its button before the island had rendered, so `newDropBtn.addEventListener` threw on `null` and took the rest of that script with it — the cards stayed on their skeletons and the sort control was never wired either. The handler is delegated from `document` and looks the elements up per click, so mount order cannot break the page again.

**Connect GitHub**

- **Profile → Connections → Connect GitHub** links a GitHub account for the repo access public import can't have: private repos, and later committing back. Signing in with GitHub and connecting it are separate — one proves who you are, the other grants read access to your repositories, and the card says so before you approve anything.
- The OAuth token is sealed with AES-256-GCM under `GITHUB_TOKEN_KEY` and no endpoint ever returns it: `/api/github/connection` answers with the GitHub username and the scopes you granted, and the read route does not even select the sealed column. **Disconnect GitHub** deletes the row.
- A token without repo scope is rejected with a sentence that says what to do, because a token left over from GitHub sign-in looks perfectly valid until you try to read a repo with it. Without `GITHUB_TOKEN_KEY`, or before the migration is applied, the card shows a plain notice instead of an error and public import keeps working untouched.

**Connecting when you signed in with GitHub**

- **Connect GitHub** no longer goes quiet for the accounts most likely to use it. Supabase will not link a GitHub identity that already exists, so a user who signed in with GitHub got an error with no token, no stored row and a card still reading "Not connected". That case now takes the sign-in-with-repo-scope path instead — same GitHub consent screen, nothing to link — and the card repaints to *Connected as …* the moment the token is saved rather than on the next reload.
- The card also stops lying about three states: a guest is asked to sign in instead of being offered a Connect button that cannot work, a 401 reads as "your session expired" instead of "not connected", and a return from GitHub that arrives without a token says so rather than looking like the click did nothing.

**Opening one game out of a repo**

- The folder picker shows every folder with its own entry page and how many files it holds, and you can type a path as the answer. Typing a name that is not there no longer looks like Esc: the import says which folder it could not find and names the closest real one — `seedgames/snake` now gets "did you mean seed-games/snake?".
- A folder the branch does not have is reported as a missing folder with the folders that do exist, instead of "only CI config or lockfiles". Enter on a highlighted row now accepts in the repo picker as well as the folder picker.

**Private repos in Studio asked the wrong host**

- Studio is served from the static site, where `/api/*` is a 404, but the connected-repo calls (repo picker, folder tree, file download) used relative paths and so asked the static host for them. The picker therefore failed every time and fell back to the paste box, which only knows public repos — the reason a connected repo could not be opened. They now go through the same `apiBase()` as every other call.

**Picking a folder in a repo**

- Pressing Enter on the highlighted folder used to close the picker and import nothing: the accept handler read `selectedItems`, which only fills once a row has been clicked, instead of `activeItems`. Enter on the highlighted row is an accept now, as it looks.
- The confirmation names the folder that was opened (`owner/repo@main → games/snake — 12 file(s)`) and the entry page is revealed in the explorer, so an import cannot land invisibly while the tree still shows the old files.

**Private repos in Studio**

- Once GitHub is connected, **Cudic: Open from GitHub** reads private repos too. jsDelivr only sees public code, so the listing and the bytes come from Cudic's own server — `GET /api/github/repos`, `/api/github/tree` and `/api/github/file` — which spends the connected account's GitHub quota instead of the deployment's shared 60 requests an hour, and returns file paths and bytes only, never the token.
- `ghOpen()` is the decryption half of the seal: the sealed row is opened inside the request, `last_used_at` is stamped, and a row that no longer decrypts (rotated key) answers "reconnect GitHub" instead of a server error.
- With GitHub connected, **Cudic: Open from GitHub** now opens a picker of the account's repositories — private ones first, with fork/archived and the description beside each name — instead of asking you to type a repo you can only half-remember. **Paste a link instead… (any public repo)** sits at the bottom of the list — someone else's public repo is one pasted URL away, connection or not — and a signed-out or unconnected user still gets the paste box directly, so public import is untouched. The listing comes from `/api/github/repos` with a session cookie; a failed listing falls back to the paste box rather than showing an error.
- The picker passes the repo's default branch to the importer, so the server no longer spends a request discovering it for the repos it lists.
- Public repos are unchanged: the CDN path is tried first, so an anonymous import still makes no authenticated request and only failures fall through to the server. Budgets and the file-selection heuristics are the same for both paths.


**Open a project from GitHub**

- **Cudic: Open from GitHub** (command palette, File menu, right-click in the Explorer or editor) pulls a public repo into Studio as a normal project: `owner/repo`, a full `github.com/...` link, or a `/tree/<branch>/<subfolder>` link for repos holding more than one game. A `/blob/` link imports the folder that holds the file. `/studio?github=owner/repo` does the same from a shared link, so a README can point straight at a working Studio session.
- **Folder picker for monorepos.** A repo holding several demos used to import whichever folder had the shallowest `index.html` — arbitrary, and silent. Cudic now reads the file list first and, when more than one folder has an entry page, asks which one to open (`(repo root)` included, junk directories excluded). A single candidate skips the question, a `/tree/…/subfolder` link is treated as the answer, and Esc imports nothing rather than guessing.
- The listing behind the picker is the same public-then-connected path the import uses (`resolveListing`), so a private monorepo gets the picker too — one extra listing request, the same `/api/github/tree` call the import makes anyway.
- Imported files are a snapshot — nothing is written back to GitHub, and the next Save stores your own Cudic copy. Public repos need no sign-in, no token and no OAuth, which is why this ships before the Connect GitHub setting.
- The file list comes from jsDelivr rather than the GitHub API: GitHub allows 60 requests an hour per IP and the Render deployment egresses from one IP for every user, so a GitHub-API import would stop working within minutes. jsDelivr has no such cap and is the same CDN published games load from. The GitHub API is used once, only to find the default branch of a repo that has neither `main` nor `master`.
- Budgets match Import files (400 files, 8MB each, 25MB total); `node_modules`, dot-folders and lockfiles are skipped, and the folder holding the shallowest `index.html` is preferred so a monorepo still opens something runnable. Repos over the CDN's 50MB limit fail with a message pointing at the subfolder route. Private repos wait for the GitHub connection — the error says that rather than failing silently.
- Docs gained a section; checks: full suite green, `studio` build green.


**The CLI is installable with npm**

- `cli/` is now its own publishable package with `bin` entries for `cudic` and `cudic-mcp`, `engines: node >=18`, MIT licence, keywords and a README written for the npm page. It still has zero runtime dependencies, so one global install is the whole setup.
- The package ships as **`cudic-cli`**: npm rejects the bare name `cudic` with *“Package name too similar to existing package cuid”*. The commands are unchanged (`cudic`, `cudic-mcp`), so `npm i -g cudic-cli` and `npx cudic-cli games` are what users type.
- v1.0.1 also registers a `cudic-cli` bin. With only `cudic` and `cudic-mcp`, `npx cudic-cli` failed with *“could not determine executable to run”* — npx can only infer a bin when one matches the package name. Installed users still get the short `cudic` command.
- The root package is marked `private: true` so the server can never be published to the registry by accident — only `cli/` ships.
- Docs gained an install paragraph (npm, npx, `npm i -g ./cli` from a clone); verified by packing the tarball, installing it globally into a temp prefix and running both bins.

**Ops console**

- `/ops` (moderators only) is a single-page health view: uptime, memory (rss + heap), database latency and reachability, live WebSocket clients, in-memory rate-limit buckets, and counts for users, games/published, forum threads, project snapshots, API keys, push devices and inbox rows. It self-refreshes every 15s, and has Copy report for pasting into an incident thread.
- Backed by `GET /api/ops/status` (moderator-gated, counts are `head` requests so no rows cross the wire), so the same numbers are available to curl. Un-run migrations report 0 rather than breaking the payload.
- Checks: full suite green; e2e unchanged and passing.

**Web push notifications and a public activity stream**

- Real Web Push on top of the existing inbox: every `notify()` now also fans out to the user's browsers via a VAPID-signed message, so comments, replies, friend requests and awards arrive as notifications even with the tab closed. `migration/push.sql` adds `push_subscriptions` (pruned automatically when a push service answers 404/410) and a single-row `push_config` holding the VAPID keypair — generated once in the database, so pushes work on Render with no new env vars and subscriptions survive restarts.
- `public/sw.js` is a deliberately cache-free service worker: it renders pushes and focuses (or opens) `/notifications` on click.
- Routes: `GET /api/push/config` (public key, `enabled`), `POST /api/push/subscribe`, `POST /api/push/unsubscribe`, `POST /api/push/test` (3/hour). The Notifications page gains an “Enable push” button.
- `GET /api/activity?limit=` exposes the existing `activity` feed publicly (kind, text, time, creator name) — only lines creators already made public.
- Checks: full suite green; the service worker, migration and both endpoint families are pinned by tests.

**Ranked full-text search across games, threads and creators**

- `migration/search.sql` adds `search_tsv` to `games` and `forum_threads`, maintained by triggers (title/description/tags and title/body), GIN indexes, a backfill, and ranked SQL functions `search_games(q, lim)` / `search_threads(q, lim)` returning a `score`. This replaces `ilike('%q%')`, which could not use an index and ranked nothing.
- `GET /api/search?q=&type=all|games|threads|people&limit=` returns the three lists in one call (games ranked by relevance then plays; creators by name), degrades to a title `ilike` if the migration is missing, and caches for 30s. CLI: `cudic search "<text>" [--type …] [--json]`.
- Checks: full suite green; e2e asserts a freshly published game is findable through ranked search.

**Deep, content-addressed project history with diffs**

- Snapshots no longer store a full copy of every file. Each distinct file body is stored once in `revision_blobs` (migration/revision_blobs.sql) and the revision row keeps a `manifest` of path → hash, so a one-line edit costs a few bytes instead of a whole project copy. The retention cap moved from 20 snapshots to 100 because history is cheap now. Legacy rows keep `files` and hydrate exactly as before; if the blob table is missing the server falls back to plain copies.
- New `GET /api/games/:id/revisions/:revId/diff?against=current|prev|<revId>` returns added/removed/changed files with sizes (`?file=<path>` returns both bodies), and `restore` now rehydrates a manifest snapshot back into `games.files`.
- CLI: `cudic diff [dir] [rev] [--against …]` and `cudic log` (alias for `revisions`). Docs updated.
- Checks: full suite green; e2e asserts the snapshot row carries a manifest (no whole-copy `files`) and that `diff` names the edited file.

**Scoped API keys and a Cudic MCP server**

- `api_keys` (migration/api_keys.sql) holds sha256-hashed keys with labels, scopes (`projects:read`, `projects:write`, `profile:read`), last-used and revocation; 12 active per account; keys can never mint keys. `GET/POST /api/keys` and `DELETE /api/keys/:id` manage them from a browser session only, and the new `userOf(req)` resolver accepts either a Supabase JWT or a `cudic_…` key so `/api/games` (create/save/delete/mine/read) and `/api/profile` work for both — browser sessions keep full access, keys are checked against their scopes (403 names the missing one).
- CLI: `cudic key create "label" [--scopes …]` prints the key once, `cudic key list` shows last use/revocation, `cudic key revoke <id>`; `cudic login --key cudic_…` and `CUDIC_API_KEY=` let agents run with no password and no hourly expiry.
- `cli/cudic-mcp.mjs` is a dependency-free MCP server over stdio: `cudic_list_projects`, `cudic_get_game`, `cudic_push_project`, `cudic_publish_project`, `cudic_search`, wired to the same API key. Docs: new "Agents & API keys" section.
- Checks: full suite green; end-to-end key create → push with only the key → read-only key refused a push → revoke → 401, plus an MCP initialize/tools handshake.

**Cudic CLI: edit existing projects, read code, profile edits, local backups**

- Round-trip editing: `pull` brings the saved project down (backing up your local files first), `ls` lists files with sizes, `cat <path>` prints one file's code, `push` sends the edits back. `unpublish` hides a project again and `rm --yes` deletes it — a bare `rm` prints what it would delete and exits 1.
- Local undo: every `push`/`pull`/`recover` copies the version about to be overwritten into `.cudic-backups/<timestamp>/` (newest 10, never uploaded). `backups` lists them, `recover latest` puts one back. Separate from the server-side `snapshot`/`revisions`/`restore` that Studio also uses.
- Profile edits from the terminal: `profile` prints name, bio, avatar, follower/following/friend counts and awards; `profile set --name/--bio/--interests/--avatar/--avatar-clear` writes through `PUT /api/profile` (same validation as the site, including the avatars-bucket-only avatar rule).
- No server changes. Checks: e2e covers profile, ls/cat, pull, backups/recover, unpublish and rm; suite green.

**Cudic CLI grows browsing, downloads, forums, shop, docs and snapshots**

- Beyond create/push/publish, the CLI now reads the rest of Cudic from a terminal: `games` (gallery search/sort/tag), `get <id>` (downloads a game's text files, pulls its binary assets from public storage and writes a `CUDIC.md` naming the author and source), `forums` + `thread <id>`, `docs [section|--search]` (the help pages rendered as plain text), and `shop` / `shop buy <code>` / `shop equip <slot> <code>|--off` with balance and owned markers. Studio parity: `snapshot`, `revisions` and `restore` drive the same `project_revisions` endpoints Studio's Save-snapshot uses. Gallery, forums, threads and docs work signed out (`--json` available on all of them); shop and snapshots need the account. No server changes — these are the existing public endpoints. Checks: 221+ tests pass.

**Cudic CLI: build and publish projects from a terminal**

- `cli/cudic.mjs` is a dependency-free (Node 18+) client for the project API, so agents and terminals can work without a browser: `login` (email+password → refreshable token in `~/.cudic/config.json`, or `CUDIC_TOKEN` for one-shot runs), `whoami`, `list`, `new` (starter index.html/style.css/game.js), `push` (create or update from a folder), `publish` (with `--tags`), `open`. Project ids live in `.cudic.json` inside the folder, so later pushes don't repeat them. It reuses `POST /api/games` and `PUT /api/games/:id` exactly as Studio does — no new server surface, so verification gates, tags and publish hooks all behave the same. Docs: new "Building from a terminal" section in `public/docs.html` plus `cli/README.md`. Checks: 216/216 tests pass.

**Google tag on every page**

- The Google tag (`GTM-PSGJNQWB`) is now in the `<head>` of all 40 HTML pages under `public/` and in the server-rendered `/g/:id` page, so page views and events report to the container without a per-page wrapper. Legacy/backup pages carry it too; the Google verification file is untouched (it has no `<head>`). Checks: 216/216 tests pass.

**Race loads on Vercel; the weekly digest stops re-sending + bounce storm**

- `/race` now imports `config.js` and derives its API base from `WS_URL`: pages served as static files (Vercel) call `/api/race` on the Render host, while localhost still uses same-origin. Before this the deployed page hit `/api/race` on Vercel (which has no API) and printed "Could not load the race just now".
- The weekly digest's "already sent this week" marker now also lives in Supabase (one sentinel `email_codes` row), because Render's free tier wakes a fresh container with an empty disk — every wake re-sent the whole week's mail, and every fake address bounced a delivery failure back to the sender. Current week is seeded so the deployed build skips it.
- The digest never mails test/harness addresses (example.*/examp1e.dev/freebuff.dev, test/probe/buffy local parts), the 8 stray probe accounts were deleted from Supabase, and `vercel.json` gained the missing `/race` rewrite. Checks: 216/216 tests pass (run #79).

**Shop and race get the standard tab shell**

- `/shop` and `/race` now use the same chrome every tab has: rail on the left, the floating page panel, a plain topbar (page name + utility), and normal content scrolling inside the panel. `/shop` gets the coin balance pill in the topbar and one hairline item grid with flat mono buttons and mono per-item labels (the brand-kit look); `/race` keeps its week strip, podium, board, winners and rules cards inside the shell and gets a rail entry highlight via `data-page="race"`. No invented heroes, no promo fluff on either.
- JS logic untouched on both pages (buy/equip flows and the race loader are byte-identical); visual layout only. New AGENTS.md §4 rule pins the standard page shell so bespoke page scaffolds don't creep back in. Checks: 216/216 tests pass (run #72).

**Creator race + a personal weekly digest**

- Two habit-formers, sharing one stats pipe. The **creator race** (`/race`, also in the rail) scores every creator on the thing jams don't measure: whether people keep playing what you ship. One point per *unique* player per published game per week — Monday 00:00 UTC, the same clock as the jam and the digest. The page shows the live top 20, medal podium, a countdown to the reset, last week's winners, and your own position when signed in.
- Week rollover pays out **automatically** (lazy, idempotent per `race_weeks` row so it can never double-pay): #1 — 500 coins + the **Race Champion** title, #2 — 300 coins + **Race Podium** badge, #3 — 150 coins + **Race Podium**. Winners also get an inbox notification.
- The **Monday digest email** now leads with the creator's own numbers — "your games got N race points, M new hearts, K remixes last week" — followed by the race winners and the existing theme/jam/follows sections. That's the pull-back notification that works without the site open.
- Scoring ledger: new `race_plays` table (play endpoint inserts one row per counted play, deduped per week/game/salted-IP-hash; settlement in `race_weeks`). **Requires `migration/race.sql` in Supabase before deploying.** Anti-gaming: replays dedupe, plays stay rate-limited per IP+game per hour, no personal data stored.
- Checks: 216/216 tests pass (5 new: /api/race shape, /race page + pretty route).
**Faster gallery: cached /api/games list — on the server and in the browser**

- Each gallery hit was doing three sequential Supabase roundtrips (the rows page, a 200-row published-games tag scan for the chips, and like counts for the visible cards) before it could answer. Those three results are identical for every viewer, so the list now serves from an in-memory cache (`server.js`): 30s TTL keyed by `sort|q|tag|offset`. Measured on the dev server: 0.56s cold → 0.006s warm with a byte-identical payload. Entries stay bounded (max 100 keys, ~50 rows each, thumbnails already stripped), so a gallery of hundreds of games costs a few MB of server memory at the absolute worst — pages stay 50 games however big it grows.
- The page also paints from the browser: `/games` repaints instantly from a `localStorage` snapshot of the last view for the exact same sort/tag/search page (kept 10 minutes), then fetches fresh data behind it and swaps in only if something changed — like hearts and live player counts always refresh. First-ever visit still pays the full load.
- Fresh content is never held back: every gallery-affecting write (create, update/publish, delete, fork, feature-toggle, moderator unpublish, revision restore) calls `gamesListCacheClear()` immediately, so the TTL is only a safety net for changes the server doesn't witness (e.g. direct DB edits). The signed-in viewer's own like hearts are still computed per request — never cached server-side.
- Checks: 211/211 tests pass.
**Fixed: Ctrl+S in the Studio now actually saves the project**

- A Discord member reported saving failing with "Null extension description" (Oct 29, still broken after the Nov 2 updates). Root cause on the current build: `Ctrl+S` was **not bound to anything Cudic** — the built-in `workbench.action.files.save` runs instead, and since the studio never wires up the files service that verb is a silent no-op (and on the older deployed bundle its extension-host save path surfaced the "Null extension description" toast). The palette command `Cudic: Save project` (Ctrl+Shift+P → save) always worked, which is why saved projects kept succeeding once users found the menu.
- Fix: `initUserKeybindings` in `studio/src/main.ts` now also binds `ctrl+s` → `glox.saveProject`, so the keystroke runs the real Cudic save instead of the dead built-in. Verified end-to-end in headless Chrome: typing in the editor and pressing Ctrl+S fires `POST /api/games` (200) + `PUT /api/games/:id` (200) and shows the `Cudic: Saved "..."` toast.
- Checks: 211/211 tests pass; docs Studio tables now note `Ctrl+S` for Save project.

**Share clips — a "Clip" button on every game page**

- **Record ~8 seconds of any canvas game** straight from the game page: no screen-recorder, no editing. The clip is 30fps, capped at 1280px on the long edge, and lands in the browser as WebM (MP4 where the browser can encode it) with the game's title, its creator, the Cudic address, a score chip and a lime progress bar drawn on top.
- **The recorder lives inside the player frame** (`public/cudic-clip.js`, injected into the game document by `run.html`). The player iframe is sandboxed without `allow-same-origin` — deliberately, so games can't reach the account token — which means the game page can't touch the canvas. The frame records its own canvas onto a composite buffer, then posts the finished Blob back over the existing postMessage bridge, so no game needs to change a line.
- **Score overlay comes from the real leaderboard:** the page remembers the last value a game submitted through `CudicScores` (dispatched as a `cudic-score` event) and asks for it in the clip header; games that never submit scores simply get no chip.
- **Honest fallbacks:** no `MediaRecorder` → the Clip button never appears (the frame acks capability first via `cudic-clip-ready`); a DOM-only game with no `<canvas>` → an explicit "nothing to record" line instead of a silent no-op; a frame that never answers → a 14-second backstop message. Nothing is uploaded, the blob URL is revoked on the next clip, and the panel asks sharers to credit the creator.
- Checks: 211/211 tests pass, including a page-sweep entry for `/cudic-clip.js` and `ShareClip` regression pins (recorder stays in the frame, sandbox stays closed, object URLs released).

**Cosmetics shop — coins that buy a look (`/shop`)**

- **Six cosmetic slots, no gameplay effect:** frames around the avatar (7), profile banners (6), profile-wide effects (5), name effects (5), titles (6) and chat emoji packs (4). Everything is bought with existing coins and nothing touches gameplay or costs real money — this is what quest, streak and jam coins now have to spend on once theme packs are owned.
- **Server-authoritative catalogue:** `COSMETICS` in `server.js` holds every price and label (`GET /api/cosmetics` serves it), so the page can't be tricked into a cheaper buy. Ownership is `user_cosmetics` (`migration/cosmetics.sql`), and worn items reuse the existing `users.equips` jsonb with six new single-value slots (`fr/tn/ef/ne/em`, plus `ti` which merges with earned award titles into the same two-title cap).
- **Buying is bounded like theme packs:** verified accounts only, daily-spend and buys-per-hour limits read from the coin ledger, the ownership row is claimed before `spend_coins('cosmetic_buy')` (a second tab gets `already:true` — never a double charge) and is rolled back if funds fall short.
- **One renderer, two pages:** new `public/cudic-cosmetics.js` draws frames, banners, effects, name styles and titles; profile.html uses it for the live preview in the new `#sec-cosmetics` equip card, and creator.html uses the same `CudicCosmetics.paint()` for what visitors see — no drift between the preview and the public page.
- **Nav + routes:** Shop in the rail (bag icon), `/shop` served from `server.js` and rewritten on Vercel, docs gained a **Shop — cosmetics** section and the Coins page now names both sinks.
- Checks: 207/207 tests pass (`/shop` and `/shop.html` in the page-sweep test); server render route and Vercel rewrite verified.

**Site-wide popups (`cudic-modals.js`): external-link gate + media lightbox**

- **External-link gate:** on all 31 content pages, clicking a link to another origin opens a "You're leaving Cudic" check — it names the destination host, explains that outside Cudic the moderation team doesn't check what's there ("at your own risk"), and offers "Visit" / "Stay on Cudic" plus a per-host "don't warn me this session" checkbox (sessionStorage). Ctrl/Shift- and middle-clicks and downloads bypass the gate, as do links inside the site.
- **Media lightbox:** same-origin links to image/video files (and standalone images ≥220px that aren't inside links) open the file inside an overlay instead of navigating — video gets a controls player, pictures get a zoom with an error line if the file is gone.
Foreign-origin image/video links go through the gate instead of in-page loading, and third-party embeds are never auto-mounted.
- **Video-element clicks open the modal too:** clicking an inline `<video>` (not inside a link) pauses it and opens the lightbox instead of the native surface play/pause — one consistent click target per page. The parents-page player reflects this: native controls came off, the frame is a click-to-open preview wrapped in a keyboard-reachable link, and playback happens in the modal player.
- **Motion now follows brand.html:** steps() easing only — overlay fades in over 0.24s steps(5) and out over 0.16s steps(4); the card rises 16px in steps(7); a 4px lime **progress swoosh** draws under the header on every open (0.5s steps(7)); a one-shot lime **ring bloom** steps around the card (0.8s steps(5)); body lines rise 14px in staggered steps(5) at 60/120/180ms; the header kicker carries the brand's blinking lime caret; buttons fill-flip with a `→` that steps 4px on hover and never lift or glow; ✕ steps up 2px on hover. Everything stops under `prefers-reduced-motion`.
- **Build:** one shared script `public/cudic-modals.js` (delegated capture-phase listener, idempotent), injected before `</body>` on every user-facing page — game runners (`/run`, `/play`), the Studio (`editor.html`), auth/setup pages, the game iframe (`embed.html`) and legacy/verify files are intentionally left out. Escape, ✕ and outside-click all close; focus returns to the trigger.
- Checks: script + tag verified served on `/view` and `/faq`; 203/203 tests pass.

**YouTube Short embedded on the parents/teachers page**

- **Video section added to `/parents`:** a new "See it in 30 seconds" section between "What it is" and "For teachers" — the 0:30 brand Short (Scratch import → Studio → saves/multiplayer/publish → live link) in a framed 9:16 player, next to a scene-by-scene breakdown with timestamp captions and Studio/play CTAs.
- **Asset:** `public/parents-short.mp4` (12 MB) — a real mp4 file; the section was deliberately not placed on the homepage.
- **Dev-server mime fix:** `server.js` static map gained `.mp4 → video/mp4` and `.webm → video/webm` (previously `application/octet-stream`); production (Vercel) already served video correctly.

**Fix: template servers showed "no channels" (silent select error)**

- **Root cause:** `migration/pins-reactions-slowmode.sql` had never been applied to the current Supabase project, so `lobbies.slow_seconds` didn't exist. Every channels query errored on the unknown column — and the `/api/servers/:id/channels` GET discarded the error (`const { data }`), rendering `{channels: []}`. A freshly created Gaming-template server had all four channels in the DB but displayed none.
- **Fix:** the migration is applied to the live project (verified: general, clips, lfg, off-topic now return), and the endpoint fails loudly — a `500 {error}` + console log instead of an innocent-looking empty list, so the next missing-column bug can't hide again.
- Migration run via the Supabase Management API against project `qgcydphkaujomxyzwcht`.

**Fix: owned public servers rendered twice on /servers**

- **Cause:** `loadServers()` pushed every public server (owned ones included) into the “Public servers” grid, and owners also got their server in “Your servers” via `/api/servers/mine` — one server, two cards. Verified the same fetch sequence with a throwaway account before/after: `dup present: false` now.
- **Fix:** the public grid skips ids already in the own list (`mineSet`), so a server shows once — in “Your servers” for its owner, in “Public servers” for everyone else. Joined-but-not-owned servers stay in Public.
- Also removed the leftover `probetest` server (debug probe artifact) from the live DB, channels and members included.

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
