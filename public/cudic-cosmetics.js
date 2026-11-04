// ── Cudic cosmetics renderer ───────────────────────────────────────
// One shared painter for the shop, the profile page and public creator
// pages, so a frame looks the same everywhere it is worn.
//
// The server owns the catalogue (codes, prices, labels). This file owns
// the *look* of each code and the emoji glyphs each pack unlocks, and it
// fails soft: an unknown code draws nothing rather than breaking a page.
//
// Usage:
//   CudicCosmetics.paint({ avatar: el, name: el, card: el, titleHost: el },
//                        { frame: {code}, banner: {code}, effect: {code},
//                          name: {code}, title: {code, label} });
//   CudicCosmetics.clear(targets);
(function () {
  if (window.CudicCosmetics) return;

  var CSS = [
    /* ── frames ───────────────────────────────────────────────── */
    '.cx-fr{padding:3px;background-origin:padding-box;background-clip:padding-box;background-size:300% 300%;}',
    '@keyframes cxflow{0%{background-position:0% 50%}50%{background-position:100% 50%}100%{background-position:0% 50%}}',
    '@keyframes cxspin{to{background-position:200% 200%}}',
    '.cx-fr--frame_ring{background-image:linear-gradient(135deg,#b8f23a,#eaffc4,#b8f23a,#7d9c1f);animation:cxflow 7s linear infinite;}',
    '.cx-fr--frame_ice{background-image:linear-gradient(135deg,#9fd0ff,#eaf6ff,#3f7cff,#9fd0ff);animation:cxflow 8s linear infinite;box-shadow:0 0 14px rgba(120,180,255,.45);}',
    '.cx-fr--frame_ember{background-image:linear-gradient(135deg,#ff8c1a,#ffd9a8,#c2410c,#ff8c1a);animation:cxflow 7s linear infinite;box-shadow:0 0 14px rgba(255,140,26,.35);}',
    '.cx-fr--frame_void{background-image:linear-gradient(135deg,#7c52ff,#c4b0ff,#2a1060,#7c52ff);animation:cxflow 9s linear infinite;box-shadow:0 0 16px rgba(124,82,255,.5);}',
    '.cx-fr--frame_dash{background-image:repeating-linear-gradient(45deg,#b8f23a 0 6px,rgba(184,242,58,.12) 6px 12px),linear-gradient(#0d0d14,#0d0d14);animation:cxspin 9s linear infinite;}',
    '.cx-fr--frame_holo{background-image:conic-gradient(#ff5f6d,#ffc371,#7ee787,#5eb0ef,#b08cff,#ff5f6d);background-size:100% 100%;animation:cxhu 6s linear infinite;box-shadow:0 0 18px rgba(160,120,255,.45);}',
    '@keyframes cxhu{to{filter:hue-rotate(360deg)}}',
    '.cx-fr--frame_gold{background-image:linear-gradient(135deg,#f7d272,#fff6cf,#d19a27,#f7d272);animation:cxflow 10s linear infinite;box-shadow:0 0 20px rgba(240,200,90,.5);}',

    /* ── banners (header background) ───────────────────────────── */
    '.cx-bn{background-size:cover;background-position:center;}',
    '.cx-bn--banner_grid{background-image:linear-gradient(rgba(184,242,58,.14) 1px,transparent 1px),linear-gradient(90deg,rgba(184,242,58,.14) 1px,transparent 1px),linear-gradient(160deg,#11131a,#0b0b12);background-size:22px 22px,22px 22px,cover;}',
    '.cx-bn--banner_terminal{background-image:repeating-linear-gradient(0deg,rgba(120,255,170,.09) 0 1px,transparent 1px 3px),linear-gradient(160deg,#06210f,#06120c);}',
    '.cx-bn--banner_aurora{background-image:radial-gradient(60% 90% at 20% 0%,rgba(0,255,200,.35),transparent 60%),radial-gradient(70% 100% at 80% 10%,rgba(124,82,255,.45),transparent 65%),linear-gradient(160deg,#06101a,#0a0716);animation:cxflow 14s ease-in-out infinite;background-size:200% 200%;}',
    '.cx-bn--banner_sunset{background-image:linear-gradient(160deg,#2b1030,#7a1f3d 45%,#ff8c1a 92%);}',
    '.cx-bn--banner_stars{background-image:radial-gradient(1.2px 1.2px at 18% 26%,#fff,transparent),radial-gradient(1px 1px at 62% 14%,#dfe8ff,transparent),radial-gradient(1.4px 1.4px at 84% 62%,#fff,transparent),radial-gradient(1px 1px at 34% 78%,#c9d6ff,transparent),radial-gradient(1.6px 1.6px at 72% 88%,#fff,transparent),linear-gradient(160deg,#080b18,#0d0a1c);}',
    '.cx-bn--banner_prism{background-image:linear-gradient(115deg,#ff5f6d,#ffc371 25%,#7ee787 50%,#5eb0ef 72%,#b08cff 100%);}',

    /* ── profile effects (overlay layer on the card) ───────────── */
    '.cx-ef{position:relative;}',
    '.cx-ef::after{content:"";position:absolute;inset:0;pointer-events:none;border-radius:inherit;overflow:hidden;z-index:0;}',
    '.cx-ef>*{position:relative;z-index:1;}',
    '.cx-ef--effect_scan::after{background:repeating-linear-gradient(0deg,rgba(184,242,58,.07) 0 1px,transparent 1px 4px);animation:cxscan 8s linear infinite;}',
    '@keyframes cxscan{to{background-position:0 200px}}',
    '.cx-ef--effect_bubble::after{background-image:radial-gradient(circle at 20% 90%,rgba(160,200,255,.22) 0 6px,transparent 7px),radial-gradient(circle at 60% 80%,rgba(184,242,58,.16) 0 9px,transparent 10px),radial-gradient(circle at 82% 95%,rgba(255,255,255,.14) 0 4px,transparent 5px);animation:cxrise 12s linear infinite;}',
    '@keyframes cxrise{from{background-position:0 0,0 0,0 0}to{background-position:0 -320px,0 -420px,0 -380px}}',
    '.cx-ef--effect_spark::after{background-image:radial-gradient(2px 2px at 12% 18%,#fff,transparent),radial-gradient(2px 2px at 78% 26%,#d9ffb0,transparent),radial-gradient(1.5px 1.5px at 46% 74%,#fff,transparent),radial-gradient(2.5px 2.5px at 88% 82%,#bfe4ff,transparent);animation:cxtwinkle 5s ease-in-out infinite;}',
    '@keyframes cxtwinkle{0%,100%{opacity:.35}50%{opacity:1}}',
    '.cx-ef--effect_orb::after{background:conic-gradient(from 0deg,transparent 0 88%,rgba(184,242,58,.5) 92%,transparent 96%);animation:cxrot 10s linear infinite;}',
    '@keyframes cxrot{to{transform:rotate(360deg)}}',
    '.cx-ef--effect_drift::after{background-image:radial-gradient(circle at 30% 100%,rgba(255,140,26,.35) 0 3px,transparent 4px),radial-gradient(circle at 66% 90%,rgba(255,90,60,.28) 0 2px,transparent 3px),radial-gradient(circle at 86% 96%,rgba(255,200,90,.3) 0 2.5px,transparent 3.5px);animation:cxrise 9s linear infinite;}',

    /* ── name / text effects ──────────────────────────────────── */
    '.cx-ne--name_mono{font-family:"Geist Mono",ui-monospace,monospace;letter-spacing:-.01em;}',
    '.cx-ne--name_glow{color:#eaffc4;text-shadow:0 0 12px rgba(184,242,58,.75),0 0 28px rgba(184,242,58,.35);}',
    '.cx-ne--name_gradient{background-image:linear-gradient(92deg,#b8f23a,#5eb0ef 55%,#b08cff);-webkit-background-clip:text;background-clip:text;color:transparent;-webkit-text-fill-color:transparent;background-size:200% 100%;animation:cxflow 8s linear infinite;}',
    '.cx-ne--name_glitch{text-shadow:1.2px 0 rgba(255,60,120,.75),-1.2px 0 rgba(70,200,255,.75);animation:cxglitch 6s steps(1) infinite;}',
    '@keyframes cxglitch{0%,92%,100%{transform:none}94%{transform:translateX(-1px)}96%{transform:translateX(1.5px)}98%{transform:translateX(-.5px)}}',
    '.cx-ne--name_type::after{content:"";display:inline-block;width:2px;height:.95em;margin-left:3px;vertical-align:-.1em;background:currentColor;animation:cxcaret 1.1s steps(1) infinite;}',
    '@keyframes cxcaret{0%,50%{opacity:1}51%,100%{opacity:0}}',

    /* ── titles ───────────────────────────────────────────────── */
    '.cx-title{display:inline-flex;align-items:center;gap:5px;font-family:var(--font-head,inherit);font-size:.62rem;font-weight:700;letter-spacing:.1em;text-transform:uppercase;padding:3px 8px;border-radius:999px;color:#0d0e10;background:linear-gradient(135deg,#b8f23a,#d8ff8a);border:1px solid rgba(0,0,0,.15);white-space:nowrap;}',
    '.cx-title--title_legend{background:linear-gradient(135deg,#f7d272,#fff3c0 60%,#e0a72c);}',
    '.cx-title--title_architect{background:linear-gradient(135deg,#9fd0ff,#dbeaff);}',
    '.cx-title--title_speedrunner{background:linear-gradient(135deg,#ff9d5c,#ffd7b0);}',
    '.cx-title--title_gamejammer{background:linear-gradient(135deg,#c4b0ff,#e8e0ff);}',
    '.cx-title--title_tinkerer{background:linear-gradient(135deg,#7ee787,#d6ffdb);}',
    '.cx-title--title_maker{background:linear-gradient(135deg,#b8f23a,#e7ffbd);}',

    '@media (prefers-reduced-motion: reduce){.cx-fr,.cx-ne--name_gradient,.cx-ne--name_glitch,.cx-ef::after{animation:none!important}}'
  ].join('\n');

  function injectCss() {
    if (document.getElementById('cudic-cosmetics-css')) return;
    var s = document.createElement('style');
    s.id = 'cudic-cosmetics-css';
    s.textContent = CSS;
    document.head.appendChild(s);
  }

  function clear(targets) {
    var t = targets || {};
    ['avatar', 'name', 'card', 'banner'].forEach(function (k) {
      var el = t[k];
      if (!el) return;
      el.className = el.className.split(/\s+/).filter(function (c) { return c.indexOf('cx-') !== 0; }).join(' ');
    });
    if (t.titleHost) t.titleHost.innerHTML = '';
  }

  // → paint the worn cosmetics onto real elements. Unknown codes are
  // ignored, so a page can render with an empty or stale payload.
  function paint(targets, cosmetics) {
    if (!targets) return;
    injectCss();
    var c = cosmetics || {};
    clear(targets);
    var av = targets.avatar, nm = targets.name, card = targets.card;

    if (c.frame && c.frame.code) {
      if (av) av.classList.add('cx-fr', 'cx-fr--' + c.frame.code);
    }
    if (c.banner && c.banner.code && targets.banner) {
      targets.banner.classList.add('cx-bn', 'cx-bn--' + c.banner.code);
    }
    if (c.effect && c.effect.code && card) {
      card.classList.add('cx-ef', 'cx-ef--' + c.effect.code);
    }
    if (c.name && c.name.code && nm) {
      nm.classList.add('cx-ne--' + c.name.code);
    }
    if (c.title && c.title.code && targets.titleHost) {
      var chip = document.createElement('span');
      chip.className = 'cx-title cx-title--' + c.title.code;
      chip.textContent = c.title.label || 'Title';
      targets.titleHost.appendChild(chip);
    }
  }

  // ── Emoji packs ───────────────────────────────────────────────────
  // Codes are global (every client maps them, so a sent emoji reads the
  // same for everyone); a pack only unlocks its codes in YOUR picker.
  var EMOJI_PACKS = {
    pack_classic: {
      ':cx_heart:': '💚', ':cx_star:': '⭐', ':cx_fire:': '🔥', ':cx_rocket:': '🚀',
      ':cx_wave:': '🌊', ':cx_pixel:': '🟩', ':cx_bolt:': '⚡', ':cx_cube:': '🧊',
      ':cx_skull:': '💀', ':cx_crown:': '👑'
    },
    pack_cozy: {
      ':cozy_tea:': '🍵', ':cozy_cat:': '🐈', ':cozy_moon:': '🌙', ':cozy_book:': '📖',
      ':cozy_blanket:': '🧣', ':cozy_candle:': '🕯️', ':cozy_rain:': '🌧️', ':cozy_bed:': '🛏️'
    },
    pack_spooky: {
      ':spooky_bat:': '🦇', ':spooky_ghost:': '👻', ':spooky_pumpkin:': '🎃', ':spooky_web:': '🕸️',
      ':spooky_bone:': '🦴', ':spooky_moon:': '🌚', ':spooky_coffin:': '⚰️', ':spooky_candy:': '🍬'
    },
    pack_space: {
      ':space_rocket:': '🚀', ':space_comet:': '☄️', ':space_planet:': '🪐', ':space_alien:': '👽',
      ':space_star:': '🌟', ':space_sat:': '🛰️', ':space_milk:': '🌌', ':space_ufo:': '🛸'
    }
  };

  // Merge the glyphs of the packs a user owns. Anything unknown is skipped,
  // so a stale localStorage cache can never inject arbitrary keys.
  function emojiMap(packs) {
    var out = {};
    (packs || []).forEach(function (p) {
      var set = EMOJI_PACKS[p];
      if (!set) return;
      for (var k in set) if (Object.prototype.hasOwnProperty.call(set, k)) out[k] = set[k];
    });
    return out;
  }

  window.CudicCosmetics = {
    paint: paint,
    clear: clear,
    injectCss: injectCss,
    emojiMap: emojiMap,
    packs: EMOJI_PACKS,
    version: 1
  };
})();
