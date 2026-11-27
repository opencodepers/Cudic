# Cudic design system — v3.0 (orange on steel) · 2026-11-27

Canon: **`public/brand-app.html`** — the brand sheet, issue 01. It is the live artefact, not a
description of one, so if a screenshot of the product and a part of the sheet disagree, the
product wins and the sheet gets fixed.

This file replaces v2.0 (ink canvas, lime/blue accents, `steps(4)` motion). **Orange on steel is
now the identity for every surface**: a steel-blue desk, one floating charcoal window, a 60 px
rail, and a single orange that means "you can press this". The v2 palette is retired as colour
canon, not deleted — the icon, emoji and cursor pack still ships (§8) and `/editor` and
`/studio` keep their IDE-dark chrome.

Still to migrate: the landing page and the older marketing pages. Until they are rebuilt on this
sheet they are not references for new work; the sheet is.

---

## 1. The window

Everything Cudic makes sits on the desk as **one floating charcoal window**, never full-bleed.

| Part | Value | Rule |
|---|---|---|
| Desk | `#B0C4DE` | Always behind. Never a gradient, never animated, never a section background. |
| Underground | `#E8EEFA` | Only when a card or an icon stage has to lift out of the desk. |
| Window | `#222222`, r 16, 16 px inset | The window floats; the desk does not move or fade. |
| Shadow | `0 26px 70px -34px` at 55% | One shadow, reused. To separate two objects, add a 1 px line first. |
| Rail | 60 px column, flush left | Charcoal, one hairline on its right, Lucide at 20 px / 1.6 stroke. Icons only; labels on hover. |
| Panel header | 60 px, 1 px bottom line | Name 20/600 −0.02em, mono stamp on the right. |
| Sections | 46 px top · 22 px sides · 52 px bottom | Divided by one horizontal hairline each. |

- **Radii:** 6 px controls (`r-sm`), 12 px cards and layers (`r-lg`), 16 px the window and dialogs.
  Nothing is a pill except the prompt pill and the presence chip.
- **No glow, no gradient, no glass, no colour-blocked sections.** Depth is the one shadow and the
  hairlines.
- **Focus:** `2px solid #FF8C1A`, offset 2 px, keyboard only — same ring on the desk and inside
  the window. Selection is orange on `#1B1712`; `accent-color` and `caret-color` are orange.

## 2. Colour

Orange is a **signal, not a decoration**: it means *you can press this*, *this is active*, *this
is where you are*. In the product it marks one primary action per view; utility controls and the
active rail borrow it; everything else is a grey that gets out of the way.

| Token | Hex | Role | Contrast |
|---|---|---|---|
| `--desk` | `#B0C4DE` | Steel behind the window | 8.9 : 1 vs panel |
| `--underground` | `#E8EEFA` | Light lifts: icon stages, print | pairs with `#222` |
| `--panel` | `#222222` | The window — ~90% of the product | base surface |
| `--raised` | `#343434` | Cards, inputs, controls, the one line colour | 1 px lines |
| `--line` | `#343434` | Hairline borders | — |
| `--line-soft` | `#2E2E2E` | Inner rules that should whisper | — |
| `--white` | `#FFFFFF` | Titles, prices, the thing you came for | 15.9 : 1 |
| `--ash` | `#A6A6A6` | Explanations, metadata, the second sentence | 6.5 : 1 |
| `--mute` | `#8C8C8C` | Labels, counts, timestamps — never a sentence | 4.7 : 1 (AA labels) |
| `--signal` | `#FF8C1A` | Primary action, active tab, active rail, the dot | 6.8 : 1 — readable as text |
| `--signal-hover` | `#E67A00` | Hover and press on orange only, one step | no third step |
| `--tint` | `rgba(255,140,26,.14)` | Selected rows and the active rail — a wash, not a colour | never a new hex |
| `--on-signal` | `#1B1712` | Text on orange. Warmer than black on purpose | 7.7 : 1 on signal |
| cover lime | `#A3E635` | **Covers only.** A game without art should not look broken | no UI use |

Rules:

- **One orange per view.** A second orange element is a bug, not emphasis.
- **Lime is not a brand colour.** `#A3E635` is confined to game covers and their glow — never
  buttons, never charts, never a status dot.
- **Links do not get orange.** Links underline; the active tab owns the only orange underline on
  the screen. Tabs carry their count: “Browse (14)”.
- Mute (`#8C8C8C`) is the floor for small text — don't dim it further, and don't set prose in it.
- Build the tint as `rgba()` of the one orange; never introduce a second orange hex.

## 3. Type

**Geist** for everything read; **Geist Mono** for everything that is a label.

| Role | Spec | Notes |
|---|---|---|
| Display | Geist 600, clamp 38→58 px, −0.035em, line-height 0.98 | Sentence case, `text-wrap: balance` |
| Heading | Geist 600, 20 px, −0.025em | Section headings 26 px |
| Body | Geist 400, 16 / 1.55 | Primary text is `--white` or `--ash`, never orange |
| Secondary | Geist 400, 15 px, `--ash` | The second sentence |
| Micro-label | Mono 400, 11 px, +0.12em, uppercase, `--mute` | **The signature** — how Cudic points at something without raising its voice |
| Figures | Mono 400, tabular | `16:17 · 14 games · 4 servers` |
| Buttons | Geist 500, 14 px, −0.01em | 15 px icon, 7 px gap |

- Type scale: 11, 13, 15, 16, 20, 26, 38–58 px. Weights 400 / 500 / 600 only.
- Uppercase lives in Geist Mono micro-labels. Never uppercase a Geist word.
- Fonts are not bundled — Geist and Geist Mono come from Google Fonts (SIL OFL), weights
  400 / 500 / 600.

## 4. Motion

Motion is the only decoration the product allows, built with **motion.dev**. Things are thrown and
they settle.

| Move | Value | Use |
|---|---|---|
| Touch spring | `stiffness 320 · damping 32` | Anything under the cursor. Release is the same spring, reversed. |
| Follow spring | `stiffness 170 · damping 18` | Panels, sheets, the rail indicator — things the eye tracks. |
| Reveal | 12 px below, 400 ms, stops | Ordinary content arriving. No blur, no scale. |
| Overlay | 0.94 → 1 scale + blur | Layers only; ordinary content does neither. |
| Hover/press | 160–180 ms ease-out | Colour, border, background — not position. |

- **One overshoot.** Two bounces is a toy; never settling is a bug. Both get fixed before merge.
- Every animation answers one question — where did this come from, did the press land, or how do I
  get out of the way. If it answers none, delete it.
- Guard decorative motion behind `prefers-reduced-motion` and hold the still frame.
- No parallax, no scroll-jacking, no infinite loops longer than a pulsing dot.

## 5. Layers

| Layer | Width | Spec |
|---|---|---|
| Dialog | 480 px | Max 80vh, r 16, 24 px padding, 58% backdrop, one primary action |
| Menu | 220 px | 6 px padding, 32 px rows, r 12, anchored to the pointer and clamped |
| Popover | 300 px | 8 px gap, r 12, anchored to its trigger |
| Order | 40 · 50 · 55 | Menu/popover · dialog · toast |

- **One layer deep.** A dialog never opens a dialog; a popover closes before its dialog opens.
- Escape, outside click and a visible close all work; focus returns to the trigger, and scrolling
  closes the layer rather than leaving it floating.
- A menu points at the pointer, a popover at its trigger. Measure, flip, clamp, keep an 8 px gap —
  never centre a context menu.
- Modal means modal: trapped focus, locked background scroll, visible close.

## 6. Parts

Everything here is a component from the product, not a library of effects.

- **Primary button** — signal fill, `--on-signal` text, r 6, 38 px high, 15 px padding, one per
  view. Hover goes to `--signal-hover`.
- **Ghost button** — transparent, 1 px `--line`, white text; hover fills `--raised` and the border
  goes to `#4A4A4A`. Small variant: 32 px high, 13 px text.
- **Rail item** — 44 px row, 20 px icon; active is a 3 px orange left edge plus the 14% tint,
  never a pill, never an orange background.
- **Tabs** — text plus a count in mute; active owns an orange 2 px underline. No pill tabs.
- **Card** — `--panel` or `--raised`, 1 px line, r 12, 16 px padding; a game card lifts 4 px on
  hover, nothing else lifts.
- **Composer** — input on `#262626`, r 6; Send is the only orange in the row.
- **Prompt pill** — 1 px signal border, r 999, Mono 11 caps with an 11 px icon.
- **Badge** — Mono 11 caps, hairline border; counts go in `()` after the noun.
- Hover states belong to activatable things only. No lift, border flash or shadow on a static row.

## 7. Marks

- The mark is **one letter**: a C with rounded shoulders and a soft notch. Never redraw it, never
  re-letterspace it, never put a wordmark or an outline inside it.
- `#010100` on `#FDFDFD` for the rail and favicon; `#FDFDFD` on `#0D0E10` for the install icon.
  24 px minimum.
- Protected files: `public/cudic_sfsvg.svg` and `public/cucid.svg` — never delete them.
- The **cube is a cover motif, not a logo**. It belongs to a game with no art yet: lime wireframe,
  CUDIC in mono, “no preview yet”. It never leaves the card, and if space is tight you drop the
  square before you redraw the letter.

## 8. Assets, and the pack (icons, emoji, cursors)

The shipped screenshots and the 9:16 cut live in **`public/brand-shots/`** and are shown in
sections 12 and 13 of the sheet:

| File | What |
|---|---|
| `gallery.webp`, `themes.webp`, `studio.webp` | 2880 × 1800 (2× of 1440 × 900) from `/games`, `/themes`, `/studio` |
| `poster-9x16.webp` | 1080 × 1920 poster for the cut |
| `cudic-promo-9x16.mp4` | 1080 × 1920, 13.2 s, H.264, 1.9 MB — `preload="none"` in the sheet |

Shots are captured from the running product, never mocked, and always at 2× so they stay sharp on
a retina screen. Re-capture rather than upscale; a shot that no longer matches the product is a bug
in the sheet. **`/editor` is legacy** and is not a subject for shots.

### The pack

`public/cudic-assets/` still ships and its `manifest.json` stays the machine-readable record.
**It is no longer the colour canon** — it was cut for the retired v2 palette.

```
cudic-assets/
  README.md             pack manual
  manifest.json         per-icon pixel strings + cursor hotspots/fallbacks
  brand/
    colors.json         v2 palette (retired as colour canon)
    tokens.css          --cudic-* variables (retired; do not import for new pages)
    logo/               cudic-mark-*.svg — ink, cream, lime, blue recolors
  icons/svg/<category>/ 83 pixel icons, 8×8 grid; png/{dark,light}/16|32|64
  emoji/{svg,png}       30 emoji, 16×16 art at 2×
  cursors/              pixel + fluid, cream + ink, 10 types, with CSS sheets
```

What this means in practice:

- **UI icons are Lucide** at 20 px (rail), 15 px (buttons) and 11 px (micro-labels), stroke 1.6.
  The 83 pixel icons are game/legacy art; don't mix the two sets on one surface.
- **Emoji yes, typed symbols no.** A real emoji belongs in reactions, playful copy and game
  surfaces; keep it out of chrome and button labels, which state their outcome in Geist
  ("Publish", "Open Studio", "Copy link").
- **Never type a character and call it an icon.** No `✓` for a check, `→` for an arrow, `×` for
  close, `★` for favourite, `•` or `▸` for a bullet or caret, `…` for a loader. At UI sizes those
  characters come from whatever fallback font the OS happens to have, so they render at the wrong
  weight and go pixelated next to real UI. Reach for the Lucide icon (check, arrow-right, x, star,
  chevron-right) at a documented size, or say it in Geist text. The only exception is punctuation
  inside a sentence or a mono metadata line — the middot in `16:17 · 14 games` is a separator, not
  an icon.
- **The pack's baked sparks are lime `#b8f23a` and blue `#3f7cff`** — the one place v2 colour
  survives. Never let them carry meaning, and recolour the `a`/`o`/`s`/`r`/`y` letters to signal
  and greys the next time the pack is regenerated (that is a v3.1 job, not done yet).

### Cursors

| Variant | Look | Ships |
|---|---|---|
| `pixel-cream` | cream fill + ink edge, 8×8 cells | `.svg` + `.png` + `.cur` |
| `pixel-ink` | ink fill + cream edge, for light pages | `.svg` + `.png` + `.cur` |
| `fluid-cream` / `fluid-ink` | smooth vector, black arrow, thick white outline, soft shadow | `.svg` only |

| Cursor | pixel hot (x,y) | size | fluid hot | fallback |
|---|---|---|---|---|
| default | 2,2 | 20×28 | 6,4 | `auto` |
| link | 2,2 | 20×28 | 6,4 | `pointer` |
| text | 8,14 | 16×28 | 16,16 | `text` |
| crosshair / plus / move / not-allowed / wait | 16,16 | 32×32 | 16,16 | keyword |
| resize-h | 16,8 | 32×16 | 16,16 | `ew-resize` |
| resize-v | 8,16 | 16×32 | 16,16 | `ns-resize` |

- Fine pointers only; touch keeps the platform cursor.
- Cream on the charcoal window, ink on light pages. Never a cream pointer on cream.
- Every custom cursor ends in a CSS fallback keyword. Inputs and textareas keep the text cursor
  and the native menu, so paste and selection never break.
- The sheets set `cursor:` on `html, body` — one per page. Use the `.cursor-*` classes for
  one-off elements.

## 9. Copy

- **Name the noun.** A game, a link, a profile, an editor. If the line survives a product swap, it
  is not copy yet.
- **One idea per sentence.** Two clauses are fine; three is a pitch. Cut the third, read it aloud.
- **Sentence case, full stop.** Buttons say what happens next: Publish, Copy link, Open Studio. No
  exclamation marks, no all-caps words.
- **A claim needs a number or a date.** "Faster" is not a fact; "loads in under a second" is.
- Labels over instructions; errors say what happened and what to do next, in the same calm voice.

## 10. Governance & migration

- **The sheet is the source of truth.** New work starts from `public/brand-app.html` — copy its
  tokens, not the v2 pack's.
- **Migration:** the landing page and the older marketing pages still wear the previous skin. Port
  them to the sheet before citing them as examples of anything.
- `/studio` keeps its IDE-dark chrome and its own blue accent. This system governs the public
  surfaces: landing, galleries, store, profile, chat, and the `/brand` kit.
- `/editor` is **legacy** — kept for memory, not a product. It gets no new work and no shots: a
  screenshot of `/editor` is not a screenshot of Studio, so never caption one as the other.
- Adding an icon: add the Lucide icon at the documented sizes — don't hand-draw a replacement, and
  don't patch the generated pack files.
- Recolouring the pack's spark letters to signal, or replacing the pack's icons with Lucide in
  game surfaces, are v3.1 jobs. Palette or grid changes are a major version bump here.
