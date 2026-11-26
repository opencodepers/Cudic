# Cudic Asset Pack v1.0

```
cudic-asset-pack/
  README.md
  manifest.json            every asset, with pixel data for icons and cursor hotspots
  brand/
    logo/                  cudic-mark-{ink,cream,lime,blue}.svg
      png/{ink,cream,lime,blue}/  16, 32, 48, 64, 128, 256, 512, 1024px squares
      wordmark/png/        the name in Geist 600, 720 and 1440 wide
      lockup/png/          mark + name side by side, 480, 960 and 1440 wide
    social/                avatar-{256,512}.png, tile-{lime,blue,cream,ink}-1080.png
    colors.json
    tokens.css             colors, fonts and motion timing as CSS variables
  icons/
    icon-sheet.png         preview of every icon
    svg/<category>/        83 icons, 8x8 grid, recolorable with currentColor
    png/{dark,light}/{16,32,64}/<category>/
  emoji/
    emoji-sheet.png
    svg/                   30 emoji, 32x32 (16x16 art at 2x)
    png/{32,64,128}/
  cursors/
    pixel/{cream,ink}/{svg,png,cur}/
    fluid/{cream,ink}/svg/
    css/                   drop-in stylesheets, one per style and variant
```

## Logo exports (48 PNGs)
The mark is a vector (`logo/cudic-mark-*.svg`); every PNG is a browser render of
that vector at its exact pixel size, so nothing is resampled twice.
- `logo/png/<colour>/<size>.png` — 16, 32, 48, 64, 128, 256, 512 and 1024px
  squares on transparency, mark at 82% of the box. `cream` is for dark surfaces,
  `ink` for light ones, `lime` and `blue` for brand-coloured tiles.
- `logo/wordmark/png/` — the name on its own, Geist 600 at -.03em, transparent.
- `logo/lockup/png/` — mark and name side by side, the ratio used on the site.
- `social/` — a 512 and 256 avatar on ink, and four 1080² tiles (lime, blue,
  cream, ink) with the mark at 56% of the frame.

## Icons (83)
Drawn on a strict 8x8 grid: chunky 2-cell strokes, notched corners, and one lime or blue spark per icon.
The ink parts use `currentColor`, so set `color:` in CSS to recolor them. Scale only in whole steps: 16, 24, 32, 48, 64px, and use `image-rendering: pixelated` for PNGs.
`png/dark` has ink-colored icons for light backgrounds, and `png/light` has cream icons for dark backgrounds.
Categories: navigation, status, files, studio, social, media, game.

## Emoji (30)
20 faces and 10 objects at 32x32. They are 16x16 pixel art shown at 2x, with an ink outline and automatic highlight and shadow tones for consistency. The PNGs at 64 and 128 are nearest-neighbor scales of the same art.

## Cursors (10 each)
default, link, text, crosshair, plus, move, resize-h, resize-v, not-allowed, wait.
- `cream` has a cream fill with an ink edge for dark UIs. `ink` is the reverse, for light UIs.
- `pixel` ships as SVG, PNG and Windows `.cur` files. `fluid` is smooth vector SVG; the main pointer there is a black arrow with a thick white outline and a soft shadow.
- Use the stylesheets in `cursors/css/`, for example `<link rel="stylesheet" href="cursors/css/fluid-cream.css">`. The hotspot is baked into each rule.
- Browsers do not animate image cursors, so the wait cursor is a still frame.

## Fonts
Geist and Geist Mono (Google Fonts, SIL OFL). Not bundled.
