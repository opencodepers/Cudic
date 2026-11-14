# TODO — what is actually open

<!-- file: TODO.md
     what: the open work in one place, each line carrying where it came from.
     why: nothing in the repo listed open work; PROJECT_MEMORY.md's
          "Remaining Work" was last touched 2026-11-08 while CHANGELOG.md moved
          on 2026-11-14, so the only todo-shaped list was six days stale.
     invariants: every item names its source; shipped work is deleted here and
          recorded in CHANGELOG.md; nothing speculative is added. -->

Last checked **2026-11-14** against `CHANGELOG.md` (`## Unreleased`) and
`PROJECT_MEMORY.md` (`## Remaining Work`). Add items with a source. When one
ships, delete the line — `CHANGELOG.md` is the record, this file is the queue.

## Answered 2026-11-14 — the GitHub provider is already on

"Turn the GitHub provider ON in Supabase" was the first item here. Checked
through the Supabase Management API against the live project, so it is off the
list:

- `external_github_enabled = true`, and `external_github_client_id` matches
  `GITHUB_CLIENT_ID` in `.env` exactly.
- `/auth/v1/authorize?provider=github` answers **302** to
  `github.com/login/oauth/authorize`, with `redirect_uri` back to
  `…/auth/v1/callback` and `redirect_to` pointing at `cudic.vercel.app`.
- Redirect allowlist covers `cudic.vercel.app`, `glox-o7rr.onrender.com`,
  `localhost:3000` and `127.0.0.1:3000`.
- The one field that cannot be checked this way: `external_github_secret` comes
  back as 64 hex chars and PATCH leaves it unchanged even though other fields in
  the same endpoint do change (flipped `external_github_email_optional` to prove
  it). So it is not readable as a plaintext secret. If a real sign-in fails with
  `incorrect_client_credentials`, re-paste the secret from the GitHub OAuth app.

## Carried over from `PROJECT_MEMORY.md` → Remaining Work (Nov 8, untouched since)

- [ ] **Test GitHub OAuth end to end.** Sign in with GitHub from `/login`,
      approve, land back signed in; then Connect GitHub from `/profile` (a
      separate grant, not the same thing) and open the repo picker. Everything
      up to GitHub's consent screen is verified; only a real GitHub login can
      close this, and no headless run can supply one.
- [ ] **Replace "potentially add more polish/features".** The line names
      nothing, so nothing can ever be finished. Pick real items or delete it.

## Still open inside `CHANGELOG.md` → `## Unreleased`

- [ ] **Cloudflare Turnstile is keyed but unproven in a browser.** Keys are in
      `.env` and in Render's environment for `glox`, and the server-side gate is
      live: code sends, signup confirm, password reset and account deletion all
      verify a token first, and the delete flow keeps its typed code and hold.
      What has never been exercised is the widget itself passing a real
      challenge on `cudic.vercel.app` — no browser harness here. Next: sign up
      and delete a throwaway account from a browser and watch the network tab.
- [ ] **Adsterra ad slots.** Paused when AdSense verification shipped
      ("Adsterra slots paused meanwhile"); `public/ads.js` still documents the
      `.ad-frame` slots. Decide whether they come back — AdSense is the live ad
      path today.
- [ ] **Tipping and paid games.** The coin anti-abuse caps cover pack buys for
      now and say their "tipping/paid-game rules arrive with those features", so
      those rules are still unwritten.

## Found on 2026-11-14 while checking Supabase

- [ ] **The docs name the retired project.** `AGENTS.md:715`, `README.md:65` and
      `PROJECT_MEMORY.md:16/17/29` all call `opimjwmgmzwapkzgxvhk` the current
      project (URL, callback, CLI access). The app talks to
      `qgcydphkaujomxyzwcht` — `public/config.js:9`, and the deployed
      `/config.js` agrees. Fix the three files; leave `AGENTS.md:949` and
      `AGENTS.md:1086` alone, where the old ref appears only as the historical
      `sb-…-auth-token` localStorage key prefix that must not be renamed.

## Service ownership (checked 2026-11-14)

Every account the site runs on, so a lost login is a known cost and not a
surprise:

- **GitHub** — `opencodepers` (user "cudic", id 325691870). Owns the repo, is
  the sole collaborator, and owns `GITHUB_PAT`.
- **Supabase** — orgs `cudic` and `cudic-lab`, each with one member, Owner
  `opencodepers@proton.me`. Live project `qgcydphkaujomxyzwcht`.
- **Vercel** — project `cudic`, team `team_52CBMFzhMQVmWdkvdOd3lUB4`, owner
  `nathent2023-glitch` / `nathen.t2023@gmail.com`. Domains `cudic.vercel.app`
  and `glox-two.vercel.app`, git-linked to `opencodepers/Cudic`. The team record
  lists its linked GitHub as `opencodepers`, so "Continue with GitHub" as that
  login may be the way back in.
- **Render** — workspace `My Workspace` (`tea-d6bmrld6ubrc73ess27g`,
  `nathen.t2023@gmail.com`). Service `glox` (`srv-dako8mad0e5s73a5e9u0`,
  `https://glox-o7rr.onrender.com`) auto-deploys `opencodepers/Cudic` `master`.
  `RENDER_API_KEY` in `.env` reads this; `server.js` never does.
- **Mail** — Gmail API as `nathen.t2023@gmail.com`, `gmail.send` scope only, so
  it can send but not read the inbox.

Vercel, Render and mail all sit on `nathen.t2023@gmail.com`, which the owner
confirmed on 2026-11-14 is still accessible — so they are not open work, only a
record of which login keeps the site alive. Also on that Render workspace and
unrelated to Cudic: `tank-arena` (live), `cudic-chess`, `Voxel` and `Voxels`
(suspended).

## Blocked outside this repo

- Supabase dashboard — re-pasting the OAuth client secret, only if a real
  sign-in fails. The Management API will neither show it nor rewrite it.
- Cloudflare account — Turnstile keys (in `.env` and Render).
- `plans/plan.md` phases 1–4 are the long-range roadmap and are not tracked here
  line by line; this file only carries what the shipping docs call open.

## Not open work

The `(uncommitted)` labels on old `CHANGELOG.md` entries describe how a feature
arrived, not something left to do. `AGENTS.md` §16 is a snapshot and rots by
design. Neither belongs in this file.
