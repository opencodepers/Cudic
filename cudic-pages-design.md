# Cudic app pages — design system · v1.0

The companion to `design.md`. That file governs the brand: the asset pack, the
landing front door, `/brand`, and the dark ink/cream/lime palette those pages
use. **This file governs the pages behind the rail** — `/games`, `/themes`,
`/chat`, `/shop`, `/friends`, `/profile`, `/notifications`, `/collections`,
`/race`, `/quests`, `/faq` — the app you use after the front page has done its
job.

Read order: `AGENTS.md` §4 (the non-negotiable shell) → this file (how the shell
is dressed) → `design.md` (palette source of truth for brand surfaces).

> **Why a second file.** The two surfaces are genuinely different products. The
> landing page is a dark editorial poster with a hairline grid, lime accents and
> `steps(4)` motion. The rail pages are a light, fast, data-dense workspace:
> white panels floating on ice-blue, orange for the one action that matters, and
> 6px/12px corners instead of hard 3px edges. Documenting them together made
> both sets of rules sound optional. They are not.

---

## 1. Shell anatomy (mandatory)

Every main tab renders the same four layers. `AGENTS.md` §4 pins this; a page
that invents its own scaffold is a bug, not a style choice.

```
body[data-page="<page>"]
└── .<page>-layout.page-panel        the floating card
    ├── .topbar                      h1 = page name, right side = one utility
    └── .<page>-scroll               flex:1; min-height:0; overflow-y:auto
        └── content
```

The rail is not part of the page: `sidebar.js` builds it, `sidebar.css` styles
it, both load on every one of these pages.

| Layer | Measure | Source |
|---|---|---|
| Rail | 60px wide, full height, transparent ground, `border-right: 1px` | `.sidebar`, `.sidebar-nav-card` |
| Panel | `margin: 16px`, `border-radius: 16px`, `1px var(--line)`, `background: var(--panel)`, `overflow: hidden` | `.page-panel` |
| Topbar | `padding: 18px 28px`, `border-bottom: 1px`, h1 `1.25rem / 600` | `.topbar` |
| Scroll area | `flex: 1; min-height: 0; overflow-y: auto` — the panel never scrolls, its body does | `.<page>-scroll` |
| Account row | `position: fixed`, `left: 76px`, `bottom: 16px`, radius 12, 40px avatar | `#accountRow` |

Two deliberate exceptions, both already in the CSS: the panel is **16px** radius
(the 12px container rule does not apply to it), and the rail has **no gaps and
no rounded corners** — it is a flush rectangle so it reads as chrome, not a card.

Rules:

- The rail is always collapsed. Labels never expand; hovering or focusing an item
  shows the `#railTip` pill. Do not add a hamburger that opens a labelled rail.
- No page-side body scroll. `body` is `height: 100%; overflow: hidden` and the
  scroll lives in `.<page>-scroll`.
- The topbar holds **one** primary utility on the right (a button, a balance
  pill, a filter). Every extra control there dilutes it; move the rest into the
  content or the rail tooltip.
- A page may put a hero **inside** the panel (`/games`: "Play something new."),
  but never a second full-bleed body, marquee, or floating column outside it.

---

## 2. Tokens

`sidebar.css` `:root` is the single source. These are mirrors for reference —
**never copy hex values into a page**, use the variables so theme packs and the
dark toggle keep working.

| Token | Light ("Scratch day") | Dark | Means |
|---|---|---|---|
| `--panel` | `#FFFFFF` | `#222222` | the panel and its cards' ground |
| `--panel-raised` | `#E2E9FA` | `#343434` | rows, chips, secondary button hover |
| `--line` | `#C9D5F0` | `#343434` | every hairline — borders and dividers |
| `--ink` | `#E8EEFA` | `#B0C4DE` | the page ground *behind* the panel |
| `--text-primary` | `#2E2A4B` | `#FFFFFF` | headings, values, labels |
| `--text-secondary` | `#5C5878` | `#A6A6A6` | body copy, captions |
| `--text-tertiary` | `#9C97B8` | `#808080` | metadata, placeholder, disabled |
| `--signal` | `#FF8C1A` | `#FF8C1A` | the one action, active state, focus |
| `--signal-tint` | `rgba(255,140,26,.12)` | `.14` | icon circles, selected row wash |
| `--success` / `--danger` | `#14965F` / `#E0442E` | `#3ECF8E` / `#E0442E` | status only |
| `--radius-sm` / `--radius-lg` | `6px` / `12px` | same | controls / cards |
| `--font-head` / `--font-body` / `--font-mono` | Geist / Geist / Geist Mono | same | |

Theme precedence is **pack > accent > dark > light**: packs write inline
variables, so a value hard-coded in a page will not follow the pack and will look
broken in exactly the themes a user chose deliberately.

All corners are squircle (`corner-shape: squircle`); true circles — avatars,
badges, toggles, 50% and 999px radii — are exempted in the CSS and must stay
round.

---

## 3. Page archetypes

Three shapes cover every rail page. Pick one before writing markup.

**A. List panel** — `/games`, `/collections`, `/notifications`, `/friends`
`topbar → filters row (optional) → grid or list → empty state`. The grid is the
point; the topbar does not repeat the count twice. Cards are links, hover is a
`--line` change, never a lift.

**B. Settings / catalogue panel** — `/themes`, `/shop`, `/quests`, `/race`
`topbar (name + balance/utility pill) → sections separated by hairlines → item
grid`. These may use the flat brand-kit look (`/shop`, `/race` do: mono
uppercase labels, 8px controls, invert-on-hover). That styling is allowed
*inside* the shell; the shell itself stays standard.

**C. Workspace** — `/chat`, `/server`
Two columns inside the panel: a channel/list column with its own scroll and a
`--line` divider, then the main column. The topbar appears once a room is open
(`#chatTopbar` starts `hidden`), because an empty topbar above an empty room is
dead chrome.

Outside these: `/docs`, `/faq`, `/privacy`, `/terms`, `/cookbook` use
`docpage.css` — a three-column sticky shell (238 / fluid / 212) with no rail.
That is the **brand** surface and belongs to `design.md`, not this file.

---

## 4. Components

| Component | Spec | Notes |
|---|---|---|
| `.topbar` | 18/28 padding, hairline bottom, h1 1.25rem 600 | page name, sentence case |
| `.page-title` | 1.25rem 600, `margin-bottom: 20px` | inside the scroll area, not the topbar |
| `.card` | `--panel-raised`, 1px line, radius 12, `padding: 24px` | content blocks; not for list rows |
| `.btn` | 0.9375rem 500, radius 6, `10px 16px`, gap 8 | see variants below |
| `.field` | label `.75rem` 600 secondary, input bg `--ink`, radius 6, `10px 12px`, focus = `--signal` border | one column, label above, no placeholder-as-label |
| `.empty-card` | max 320px, 56px `--signal-tint` circle, h2 1.125rem, p `.875rem` secondary, one button | an empty page still explains itself |
| `.sk` | `--panel-raised` block + shimmer, static under reduced motion | skeletons, never a spinner over content that has a known shape |
| `.status-msg` | `.875rem`; `.ok` = success, `.err` = danger, hidden until set | inline result of the action just taken |
| `.csel` | custom select, radius 6, menu radius 6 with shadow | behaviour in `csel.js`; use it instead of a bare `<select>` on these pages |

Button variants, in order of authority — **one primary per view**:

1. `.btn-primary` — `--signal` fill, `--on-signal` text. Publish, Save, Play.
2. `.btn-secondary` — transparent, 1px `--line`, text primary. The default.
3. `.btn-ghost` / `.btn-danger` — quiet and destructive: border stays neutral,
   only the text turns `--danger`. Never a red fill.

Focus: `2px solid var(--signal)`, offset 2px, keyboard only (`:focus-visible`).

---

## 5. Density, type and copy

- Type scale is the token set only: 12 / 14 / 16 / 20 / 26 / 32px
  (`--text-xs` … `--text-2xl`). A one-off `font-size: 13.5px` is drift.
- Headings 600, UI 500, body 400. Geist Mono for identifiers, counts, codes,
  timestamps and uppercase micro-labels — **not** for prose.
- Body copy is `--text-secondary` at `.875–.94rem`, line-height 1.5–1.65.
  `--text-primary` is for things you scan (titles, values, names).
- Spacing rides 4px: 4 / 8 / 12 / 16 / 24 / 28. Panel padding is 28px horizontal;
  card padding 24; row padding 10–14.
- Hairlines do the dividing. A shadow means "floating above the page" (menus,
  modals, the account row) and nothing else.
- Copy states the outcome and names the object: "Publish game", "Copy embed",
  "Create 7-day link". Empty states say what would fill them and offer the one
  action that does it. Errors say what failed and what to do next — never a bare
  "Something went wrong."

---

## 6. Responsive

The shell is fluid: `.page-panel` takes whatever the 60px rail leaves and the
scroll area absorbs the rest. **`sidebar.css` has no width breakpoints** — only
reduced-motion rules — so a page that needs to stack declares its own media
queries inside the panel, and the shell keeps working underneath.

`/view` (the player) is the exception and now has an explicit phone mode:
`viewport-fit=cover`, a `100dvh` player that becomes the whole screen,
safe-area padding, `touch-action: manipulation`, `overscroll-behavior: contain`,
and a landscape rule that hides the chrome. If a new page is meant for thumbs,
copy that approach rather than inventing a second one.

Minimum bar for any rail page: usable at 360px wide, no horizontal scroll on the
body, tap targets ≥ 40px, and nothing important hidden behind hover.

---

## 7. Motion

| Need | Value |
|---|---|
| hover, focus, chip | 120–150ms |
| panel/row reveal, dropdown | 160–180ms `ease` |
| state collapse | instant (`steps(1)` equivalent) |
| skeletons | shimmer, disabled under `prefers-reduced-motion` |

One motion moment per screen, and it must not be load-bearing: a dropdown that
animates but does not open, or a card that lifts on hover on a touch screen, is
worse than no motion. Everything decorative sits behind
`@media (prefers-reduced-motion: reduce)`.

---

## 8. Do / don't

**Do**

- Start from `.page-panel` + `.topbar` + `.<page>-scroll`; name the layout
  `.<page>-layout` so a page's own CSS has a scope.
- Reach for a token or an existing class before writing a new rule.
- Let the panel clip its corners (`overflow: hidden`) and let the inner area
  scroll.
- Keep the rail icon-only and rely on `#railTip` for names.
- Test both themes and one theme pack before calling a page done.

**Don't**

- Don't add a second scroll container, a body-scroll page, or a full-width
  header outside the panel.
- Don't hard-code hex, radius or font sizes into a page.
- Don't use lime/`--signal` as a background for a row or tab — it is a marker
  (2px inset edge, underline, or the one filled button).
- Don't invent a hero, a marquee, or a floating column on a tab page.
- Don't add a spinner where a `.sk` skeleton already describes the layout.
- Don't put the page name in both the topbar and an `<h1>` in the body.

---

## 9. Known drift (fix when touched, don't copy)

- `design.md` v2 documents a dark `#0d0e10` / cream / lime brand palette. The
  rail pages default to the light "Scratch day" palette above and opt into dark
  via `data-theme="dark"`. Both are intentional, but a page must not mix them:
  if it is behind the rail, it takes `--panel`/`--text-*`, not `#14161b`/`#f7f5ec`.
- `docpage.css` (docs, FAQ, legal) keeps the brand palette and its own three
  column shell with no rail. That is not a violation of §1 — those pages are
  brand surfaces, linked from the rail but not inside it.
- `sidebar.css` has no app-wide width breakpoints. Pages that stack do it
  locally; there is no shared rule to inherit, which is why two tabs can behave
  differently at 700px. Adding one shared breakpoint would be a shell change.

---

## 10. Adding a page (checklist)

1. `body data-page="<page>"`, root `.<page>-layout page-panel`.
2. `.topbar` with the page name and at most one utility.
3. `.<page>-scroll` → content; the scroll lives there.
4. `<script src="/sidebar.js?v=N">` (and `sidebar.css`) so the rail appears.
5. States: loading (` .sk`), empty (`.empty-card`), error (`.status-msg.err`).
6. Both themes + one pack checked; keyboard pass with visible focus; 360px pass.
7. Rail entry in `sidebar.js` for a main tab; `vercel.json` rewrite if the URL is
   pretty.
8. If the shell itself changed, update `AGENTS.md` §4 and this file — not just
   the page.
