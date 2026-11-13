# Cudic landing page — design spec · v3.0

The front door (`public/index.html`) and the kit it is measured against
(`public/brand.html`). Written from those two files on 2026-11-13, not from a
brief: every value below is in the shipped CSS, and the section order is the
order the sections appear in.

Companions: `design.md` (the asset pack behind `public/cudic-assets/`),
`cudic-pages-design.md` (the rail pages behind the front door). This file
governs `/` only.

> **What changed from v2.** The light paper / Instrument Serif / vermilion
> exploration is gone — it never shipped. The live landing is the dark brand
> build: ink canvas, cream text, lime and blue as flat blocks, Geist + Geist
> Mono + Geist Pixel, square corners, hairline cells, and a scroll-reveal system
> built on `IntersectionObserver` and CSS `steps()` transitions. There is no
> animation library on the page.

---

## 1. Where the styles actually live

| Layer | File | Holds |
|---|---|---|
| Tokens | `public/docpage.css?v=7` | `:root` palette + light overrides (shared with docs, FAQ, legal) |
| Parallax | `landing-parralex/cudic-studio-parallax/snippets/parallax.css` | `.px-stage` + layer positioning |
| Landing | inline `<style>` in `public/index.html` | nav, hero, blocks, cards, doodles, pick cards, breakpoints |
| Kit | inline `<style>` in `public/brand.html` | logo/palette/type/icon/cursor/UI/motion/voice specs |
| Fonts | Google Fonts | Geist 400–600, Geist Mono 400–600, **Geist Pixel** |

The landing imports `docpage.css` for its palette, so a token change there
reaches the front page. Do not redeclare `:root` in `index.html`.

The page loads `sidebar.js` but carries `data-page="home" data-no-rail`, so the
rail never mounts. There is no app shell on `/`.

---

## 2. Palette

| Token | Hex | Role |
|---|---|---|
| `--bg` | `#0d0e10` | canvas — also the browser `theme-color` |
| `--panel` | `#14161b` | nav ground, cards, tiles, code blocks |
| `--line` | `#262a33` | every hairline: borders, cells, dividers |
| `--ink` | `#f7f5ec` | headings, body, the mark on light blocks |
| `--mute` | `#9a9a94` | leads, captions, secondary links |
| `--lime` | `#b8f23a` | the accent: primary button, active letter, icon spark |
| `--blue` | `#3f7cff` | brand block colour: hero stage, feature edge, links, cursor pack |
| `--sky` | `#9fd0ff` | icon detail only |
| `--red` | `#d9381e` | destructive text in the kit, never a fill |

Light mode swaps `--bg`/`--ink` (`#f7f5ec` / `#0d0e10`), lightens `--panel` to
`#efece0`, `--line` to `#d6d2c2` and darkens `--mute` to `#6b6a63`. Lime and
blue keep their values and always sit with ink text — never cream.

**Ratio (from `brand.html`):** 70% ink, 20% cream, 10% lime + blue combined.
Colour arrives in flat blocks. No gradients anywhere on the page (the one
`linear-gradient` in the kit is a dot-grid `repeating` pattern, not a wash).

Calculated contrast on `#0d0e10`: cream ≈ 17.3:1, mute ≈ 6.4:1, ink-on-lime
≈ 14.4:1, ink-on-blue ≈ 5.0:1, cream-on-blue ≈ 3.4:1. Hence: **ink text on lime
and blue, cream text on ink, never cream on a colour block**, and mute never on
a colour block.

---

## 3. Type

| Role | Face | Spec |
|---|---|---|
| Hero `CUDIC` | Geist Mono 600 | `clamp(96px, 22vw, 260px)`, `line-height: .9`, `letter-spacing: -.04em` |
| Hero accent letter | **Geist Pixel** 600 | lime, `translateY(-2px)` |
| Display / section h2 | Geist 500 | `2rem`, `letter-spacing: -.02em`, `text-wrap: balance` |
| Lead | Geist 400 | `1rem / 1.6`, mute, `max-width: 70ch`, `text-wrap: pretty` |
| Tagline | Geist 400 | `1.05rem / 1.6`, mute, `max-width: 62ch`, centred, `<strong>` in ink |
| Buttons / nav | Geist 500 | 13–14px |
| Kicker, mono labels | Geist Mono | 11px, uppercase, `letter-spacing: .08em`, mute |
| Kit display | Geist 500 | `clamp(44px, 8vw, 104px)`, `-.035em` |

Scale, from the kit: display 76/76, heading 28/32, body 16/24, label mono 12
caps. Geist Mono is for labels, tags, code, counts and identifiers — not prose.
Geist Pixel exists **only** in the hero accent; it is not a body or UI face.

---

## 4. Page structure

```
body[data-page="home"][data-no-rail]
├── a.skip → #mainContent
├── nav.topnav (fixed, 48px)
├── .doodles (8 floating icons, aria-hidden)
├── .heroWrap (100vh)  h1.hero + p.tag + .ctas
├── .px-stage (7 parallax SVG layers + clickable mascot)
├── main.landing (max 1180px, 48px gutters)
│   ├── #community   "What's happening"  weekly card + picks + jam + follow
│   ├── .block       "What Cudic is"     4 cards
│   ├── .block       "How it works"      ol.steps ×3
│   ├── .block       "Built in"          6 .feat rows
│   ├── .block       "Learn"             3 cards
│   ├── .block       "About Cudic"       3 paragraphs
│   ├── .block       "Frequently asked"  8 Q cards
│   └── .ad-frame.ad-leaderboard
└── footer.mono
```

Each section is `<section class="block">` with the same three parts: a
`.kick` (14px pixel icon + mono uppercase label), an `h2`, and a `.lead2`.
That repetition is the page's rhythm; a section that skips the kick reads as a
different page. `h2[data-n]` attributes (`00`–`06`) are present but nothing
renders them on `/` — the numbered chips belong to `brand.html`.

---

## 5. Hero (the signature)

- `h1.hero` is filled by script with one `<span>` per letter (`C U D I C`), so a
  single letter can be styled at a time. `aria-label="Cudic"` keeps the heading
  readable to assistive tech.
- One letter at a time becomes `.px`: Geist Pixel, lime, lifted 2px. The cycle
  advances every **700ms**.
- Hovering the hero **stops** the cycle and pins the highlight to the hovered
  letter; leaving restarts it. This is the page's one interactive showpiece —
  do not add a second.
- A lime block caret (`::after`, 1.1s `steps(2)`) blinks after the word.
- `.heroWrap` is 100vh with a masked dot grid (20px pitch, 35% opacity, radial
  mask) behind the type.
- `prefers-reduced-motion: reduce`: the cycle never starts, letters stay Geist
  Mono in ink, the caret stops. Content identical, motion gone.

CTAs, in order: mascot (56px pixel mark, floats `4s steps(8)`, waves on hover,
cycles 9 faces on click), **Open Studio** (lime primary), Play a random game
(script resolves a real `/view.html?id=`), Browse games, Read the docs.

---

## 6. Components

| Component | Spec |
|---|---|
| `.topnav` | fixed 48px, `--bg`, 1px line below; brand = `cudic-mark-cream.svg` 18×22 + "Cudic" |
| Nav links | 13px Geist 500, mute; 16px pixel icon each; hover = `--panel` + ink |
| `.primary` link | lime fill, `#0d0e10` text, lime border; hover inverts to ink; rocket icon animates on hover |
| Docs / Cookbook | button + `.dropmenu` panel (180px min, `--panel`, 1px line), Escape and outside-click close |
| `.btn` | square, 1px `--line`, `--panel` fill, ink text, 12×20 padding; hover inks the fill and lifts 2px |
| `.btn.primary` | lime fill, ink text; hover inks the fill |
| `.cards .card` | 1px cells on a `--line` grid (`auto-fit minmax(215px)`), `--bg` fill, 14–16 padding, `.mono` label then h3 + p; hover lifts 3px and turns the border lime |
| `.features .feat` | same 1px grid (`minmax(230px)`), `--bg` fill, **2px left edge in `--blue`**, lime `.mono` label; hover shifts 4px right and the edge turns lime |
| `.weekly-card` | `--panel`, 1px line, **3px lime left edge**, title + theme + two buttons |
| `.picks .pick-card` | `--panel`, 16/10 thumbnail, mono author + plays; hover lifts 3px, border lime |
| `ol.steps` | numbered list from `docpage.css`, mono numerals in lime boxes |
| `.ad-frame` | 1px line, `--panel`, mono "Advertisement" caption, leaderboard 728×90 slot |
| `footer.mono` | 24/48 padding, mute, links to docs, cookbook, privacy, terms |
| Cookie banner | fixed bottom, `--panel`, 13px; Reject = hairline ghost, Accept = lime; AdSense only loads after consent |

Everything is square. There are no pills, no rounded cards, no shadows on
content — the only depth cues are hairline cells and the `--panel`/`--bg`
difference.

---

## 7. Motion

| Thing | Value |
|---|---|
| Hero letter cycle | 700ms interval, `steps(6)` on colour/transform |
| Hero caret | 1.1s `steps(2)` blink |
| Section reveal | `opacity` + `translateY(20px)` → none, **520ms `steps(6)`** |
| Card / feature reveal | 420ms `steps(6)`, 16px rise |
| Stagger | cards 60/120/180/240ms, features 40→240ms |
| Hover | 120ms `steps(4)`; card lift 3px, feature slide 4px, button lift 2px |
| Doodles | `float` 6s `ease-in-out`, 8 icons, 35% opacity; click = 500ms hop |
| Parallax | `parallax(stage, { strength: 24 })`, 7 layers at depths 0–0.65 |

Reveal plumbing: `body.js` hides the reveal targets, an `IntersectionObserver`
(threshold `.12`, `rootMargin '0px 0px -40px 0px'`) adds `.in` once per element,
and a 1200ms failsafe adds `.in` to everything so a broken observer can never
leave the page blank. Without JS (`body:not(.js)`) everything is visible.

`prefers-reduced-motion: reduce` turns off: the hero cycle and caret, the
mascot float/wave, doodles, parallax (script-skipped), every transition, and
`scroll-behavior`. `@media (hover: none)` removes all hover lifts, so a tap
never leaves a card floating.

---

## 8. Responsive

| Breakpoint | Behaviour |
|---|---|
| > 1180px | `.landing` centred at 1180px |
| ≤ 1180px | `.subtoc` hides (docs shell rule); landing unaffected |
| ≤ 720px | `.landing` gutters 48 → 16px; hero `clamp(64px, 18vw, 128px)`; `.heroWrap` 70vh; doodles hidden; nav 52px with 44×44 burger; links become a 240px right drawer (`100dvh`, backdrop, Escape closes, focus returns to the burger); `.px-stage` 21/9, max 180px; features lose the 2px edge; cards pad 12/14; sections pad 40px 0 |
| ≤ 820 / 520px (kit) | kit grids collapse 4→2→1 |

The drawer is `visibility: hidden` when closed (not just off-screen), so its
links are not tabbable. Keep that if the nav changes.

---

## 9. Copy

- Tagline: **Write a game. Send a link.**
- Sentence case everywhere except mono kickers and nav labels.
- Short sentences, verbs first; credit authors; no hype adjectives; no
  real-money language around coins; no exclamation marks (brand kit §Voice).
- Buttons name the outcome: "Open Studio", "Play a random game", "Read the docs".
- Mute is for supporting text; a whole section of mute means nothing is leading.

---

## 10. Deliberate deviations & drift

Recorded rather than hidden, so the next person does not "fix" a choice or copy
a mistake:

- **Hover lift.** The kit says square, flat, no lift; the landing lifts cards
  3px, features 4px and buttons 2px. This is the landing's one deviation —
  decide once whether to keep it or strip it, but do not add a third behaviour.
- **`h2[data-n]`** is emitted but unrendered on `/`; the numbered chip is a
  `brand.html` motif (`.sh h2:before`).
- **`section.block::after { display: none }`** switches off the doc-page corner
  pips on the landing. Intentional.
- **Cookie banner** carries inline styles with token fallbacks (`var(--panel,
  #14161b)`) so it survives on pages without the token sheet. Keep the fallbacks.
- **`--red`** is declared but only the kit's destructive text uses it; the
  landing uses blue for emphasis. Do not introduce red fills.
- **Fonts**: the landing adds Geist Pixel to the Google Fonts request; the kit
  does not. Pixel is a landing-only accent.

---

## 11. Checklist for a landing change

1. Use tokens (`--bg`, `--ink`, `--lime`, `--line`); no new hex.
2. New section = `.block` + `.kick` + `h2` + `.lead2`, in that shape.
3. One showpiece per view. The hero letter cycle is it.
4. Square corners, 1px hairlines, flat fills; colour blocks carry ink text.
5. Reveal targets go in the `body.js` selector list, or they will sit visible
   while everything else animates.
6. Check reduced motion (nothing moves, everything readable) and `hover: none`
   (no stuck lifts).
7. Check 360px: no horizontal scroll, nav drawer opens, hero does not clip.
8. Both themes: dark is the default; light must stay legible on cream.
9. If a token changed, confirm `docpage.css` is still the only declaration.
