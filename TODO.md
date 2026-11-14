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

## Carried over from `PROJECT_MEMORY.md` → Remaining Work (Nov 8, untouched since)

- [ ] **Turn the GitHub provider ON in Supabase.** The client ID and secret are
      already pasted (`PROJECT_MEMORY.md` → GitHub OAuth App); Authentication →
      Providers → GitHub still needs the toggle saved. The code side is done:
      `public/auth.js` calls `signInWithOAuth({ provider: 'github' })` and
      `/profile` carries the Connect GitHub card. This is a dashboard switch.
- [ ] **Test GitHub OAuth end to end.** Sign in with GitHub from `/login`,
      approve, land back signed in; then Connect GitHub from `/profile` (a
      separate grant, not the same thing) and open the repo picker.
- [ ] **Replace "potentially add more polish/features".** The line names
      nothing, so nothing can ever be finished. Pick real items or delete it.

## Still open inside `CHANGELOG.md` → `## Unreleased`

- [ ] **Cloudflare Turnstile on signup and account deletion.** The delete flow
      deliberately ships without a captcha — "the code + hold *is* the bot gate;
      Turnstile stays a follow-up needing Cloudflare keys" (Welcome wizard
      entry). Needs a Turnstile site key and secret.
- [ ] **Adsterra ad slots.** Paused when AdSense verification shipped
      ("Adsterra slots paused meanwhile"); `public/ads.js` still documents the
      `.ad-frame` slots. Decide whether they come back — AdSense is the live ad
      path today.
- [ ] **Tipping and paid games.** The coin anti-abuse caps cover pack buys for
      now and say their "tipping/paid-game rules arrive with those features", so
      those rules are still unwritten.

## Blocked outside this repo

- Supabase dashboard — the GitHub provider toggle above.
- Cloudflare account — Turnstile keys.
- `plans/plan.md` phases 1–4 are the long-range roadmap and are not tracked here
  line by line; this file only carries what the shipping docs call open.

## Not open work

The `(uncommitted)` labels on old `CHANGELOG.md` entries describe how a feature
arrived, not something left to do. `AGENTS.md` §16 is a snapshot and rots by
design. Neither belongs in this file.
