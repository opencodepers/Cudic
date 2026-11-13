/* file: lib/daily.js
 * what: picks the game of the day and renders /daily and /five as real HTML.
 * why: a daily pick gives people a reason to come back that does not need a
 *      login, an email or a notification, and /five answers "what do I play?"
 *      with five named games instead of a grid of thirteen.
 * invariants: the pick is a pure function of the UTC date and the published
 *      game list, so every host and every visitor agrees with no stored state;
 *      both pages are links-and-text first, readable with JavaScript off;
 *      no user input is interpolated raw.
 * see: server.js (/daily, /five, /api/daily), tools/prerender-games.mjs
 */

const SITE = 'https://cudic.vercel.app';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
}[c]));

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** UTC day key, e.g. 2026-11-13. */
function dayKey(now) {
  const d = now instanceof Date ? now : new Date();
  return d.toISOString().slice(0, 10);
}

/** Days since 2026-01-01, 1-based — the daily's number. */
function dayNumber(key) {
  const start = Date.UTC(2026, 0, 1);
  const at = Date.parse(key + 'T00:00:00Z');
  if (!Number.isFinite(at)) return 1;
  return Math.floor((at - start) / 86400000) + 1;
}

/** FNV-1a, 32-bit. Small, stable, and not worth a dependency. */
function hash(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/**
 * The same game for everyone on the same UTC day.
 * @param {Array} games published rows (needs id, slug, title)
 * @param {Date|string} [now]
 * @returns {{key: string, number: number, game: object|null}}
 */
function pickDaily(games, now) {
  const list = (games || []).filter((g) => g && UUID.test(String(g.id || '')));
  const key = typeof now === 'string' ? now : dayKey(now);
  const number = dayNumber(key);
  if (!list.length) return { key, number, game: null };
  // Sorted by id so a different query order cannot change the answer.
  const sorted = list.slice().sort((a, b) => String(a.id).localeCompare(String(b.id)));
  const game = sorted[hash(key) % sorted.length];
  return { key, number, game };
}

const slugOf = (g) => String(g.slug || '').trim() || g.id;
const hrefOf = (g) => '/g/' + encodeURIComponent(slugOf(g));
const titleOf = (g) => (g.title || '').trim() || 'Untitled game';

function shell(opts) {
  const { base, title, description, canonical, body, jsonLd } = opts;
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<script>try{var t=localStorage.getItem('glox_theme');document.documentElement.dataset.theme=(t==='light'?'light':'dark');}catch(e){}</script>
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<link rel="canonical" href="${esc(canonical)}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="Cudic">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:url" content="${esc(canonical)}">
<meta property="og:image" content="${base}/og.png?v=2">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(title)}">
<meta name="twitter:description" content="${esc(description)}">
<meta name="twitter:image" content="${base}/og.png?v=2">
<link rel="icon" type="image/svg+xml" href="/cudic_sfsvg.svg">
<link rel="manifest" href="/manifest.webmanifest">
<link href="https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600&family=Geist+Mono:wght@400;500&display=swap" rel="stylesheet">
${jsonLd ? '<script type="application/ld+json">' + jsonLd + '</script>' : ''}
<style>
:root{--bg:#0d0e10;--panel:#14161b;--line:#262a33;--ink:#f7f5ec;--mute:#9a9a94;--lime:#b8f23a;--ember:#FF8C1A;--blue:#3f7cff}
@media (prefers-color-scheme:light){:root:not([data-theme="dark"]){--bg:#f7f5ec;--panel:#efece0;--line:#d6d2c2;--ink:#0d0e10;--mute:#6b6a63;--blue:#1b3fb8}}
:root[data-theme="light"]{--bg:#f7f5ec;--panel:#efece0;--line:#d6d2c2;--ink:#0d0e10;--mute:#6b6a63;--blue:#1b3fb8}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);font:400 16px/1.55 "Geist",system-ui,sans-serif}
a{color:var(--blue)}
.mono{font-family:"Geist Mono",ui-monospace,monospace;font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:var(--mute)}
.bar{display:flex;align-items:stretch;border-bottom:1px solid var(--line);overflow-x:auto}
.bar a{display:flex;align-items:center;padding:16px 20px;color:var(--ink);text-decoration:none;font-weight:500;font-size:15px;white-space:nowrap;border-right:1px solid var(--line)}
.bar a:hover{background:var(--panel)}
.bar .brand{font-weight:600}
.bar .sp{flex:1;border-right:0}
.wrap{max-width:900px;margin:0 auto;border-left:1px solid var(--line);border-right:1px solid var(--line);min-height:100vh}
.head{padding:46px 40px 30px;border-bottom:1px solid var(--line)}
.head .mono{display:block;margin-bottom:14px;color:var(--lime)}
h1{margin:0 0 12px;font-weight:500;font-size:clamp(30px,4.4vw,52px);line-height:1.05;letter-spacing:-.035em}
.head p{margin:0;max-width:60ch;color:var(--mute);font-size:16px}
.pick{padding:32px 40px;border-bottom:1px solid var(--line)}
.pick h2{margin:0 0 6px;font-size:clamp(22px,3vw,32px);font-weight:500;letter-spacing:-.02em}
.pick .by{display:block;margin-bottom:14px}
.pick p{margin:0 0 20px;color:var(--mute);max-width:62ch}
.cta{display:inline-flex;align-items:center;gap:10px;background:var(--ember);color:#141414;text-decoration:none;font-weight:600;padding:14px 26px;border-radius:999px;font-size:16px;border:0;cursor:pointer}
.cta:hover{filter:brightness(1.06)}
.row{display:flex;flex-wrap:wrap;gap:10px;align-items:center}
.ghost{display:inline-flex;align-items:center;gap:8px;background:transparent;color:var(--ink);border:1px solid var(--line);padding:11px 18px;border-radius:999px;font:inherit;font-size:14px;cursor:pointer;text-decoration:none}
.ghost:hover{border-color:var(--ink)}
.note{margin-top:18px;color:var(--mute);font-size:13px}
.sect{padding:28px 40px;border-bottom:1px solid var(--line)}
.sect h3{margin:0 0 10px;font-size:13px;letter-spacing:.08em;text-transform:uppercase;color:var(--mute);font-family:"Geist Mono",ui-monospace,monospace;font-weight:500}
.sect p{margin:0;color:var(--mute);font-size:14px}
.sect a{color:var(--ink)}
ol.five{list-style:none;counter-reset:f;margin:0;padding:0}
ol.five li{counter-increment:f;padding:26px 40px;border-bottom:1px solid var(--line);display:flex;gap:20px;align-items:flex-start}
ol.five li:before{content:counter(f,decimal-leading-zero);font-family:"Geist Mono",ui-monospace,monospace;font-size:13px;color:var(--lime);padding-top:6px;min-width:34px}
ol.five h2{margin:0 0 6px;font-size:22px;font-weight:500;letter-spacing:-.02em}
ol.five h2 a{color:var(--ink);text-decoration:none}
ol.five h2 a:hover{border-bottom:1px solid var(--ink)}
ol.five p{margin:0;color:var(--mute);font-size:14px;max-width:60ch}
.thumb{width:132px;aspect-ratio:16/10;background:var(--panel);border:1px solid var(--line);flex-shrink:0;overflow:hidden}
.thumb img{width:100%;height:100%;object-fit:cover;display:block}
footer{padding:22px 40px;display:flex;flex-wrap:wrap;gap:16px;align-items:center;color:var(--mute);font-size:13px}
footer .sp{flex:1}
@media(max-width:640px){.head,.pick,.sect{padding-left:20px;padding-right:20px}ol.five li{padding:22px 20px;gap:14px}.thumb{width:88px}.bar a{padding:14px}}
</style>
</head>
<body>
${body}
<script src="/funnel.js?v=1" defer></script>
</body>
</html>`;
}

/** Shared bar so both pages feel like the rest of the site. */
function bar(base) {
  return `<header class="bar">
  <a class="brand" href="/">Cudic</a>
  <a href="/games">Games</a>
  <a href="/daily">Daily</a>
  <a href="/five">Five</a>
  <a href="/arcade">All games</a>
  <span class="sp"></span>
  <a href="/studio">Make one</a>
</header>`;
}

/**
 * /daily — today's game, the streak, and a share card.
 * @param {Array} games published rows
 * @param {{base?: string, now?: Date}} opts
 */
function renderDaily(games, opts) {
  opts = opts || {};
  const base = (opts.base || SITE).replace(/\/$/, '');
  const pick = pickDaily(games, opts.now);
  const g = pick.game;
  const prettyDate = new Date(pick.key + 'T00:00:00Z').toLocaleDateString('en-GB', {
    day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC'
  });
  const title = g ? `Cudic daily #${pick.number} — ${titleOf(g)}` : 'Cudic daily';
  const description = g
    ? `Today's game on Cudic: ${titleOf(g)}. The same game for everyone, one tap to play, no sign-up.`
    : 'One game a day on Cudic — the same game for everyone, no sign-up.';

  const jsonLd = JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'VideoGame',
    name: g ? titleOf(g) : 'Cudic daily',
    url: g ? base + hrefOf(g) : base + '/daily',
    applicationCategory: 'Game',
    operatingSystem: 'Web browser',
    gamePlatform: 'Web browser',
    playMode: 'SinglePlayer',
    offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' }
  }).replace(/</g, '\\u003c');

  const pickBlock = g ? `
  <div class="pick">
    <span class="mono">Daily #${pick.number} · ${esc(prettyDate)}</span>
    <h2>${esc(titleOf(g))}</h2>
    <span class="by mono">By ${esc((g.author || 'a Cudic creator').toUpperCase())}</span>
    <p>${esc((g.description || '').trim().slice(0, 220) || 'Today\'s pick from the Cudic gallery.')}</p>
    <div class="row">
      <a class="cta" href="${esc(hrefOf(g))}?utm_source=daily&amp;utm_medium=cta&amp;utm_campaign=daily_${pick.number}">Play today's game →</a>
      <button class="ghost" id="shareCard" type="button">Share card</button>
      <a class="ghost" href="/arcade">Browse all games</a>
    </div>
    <p class="note" id="streakLine">Play it and the streak starts. Nothing is uploaded — the streak lives in this browser.</p>
  </div>
  <canvas id="card" width="1200" height="630" style="display:none"></canvas>` : `
  <div class="pick">
    <span class="mono">Daily #${pick.number} · ${esc(prettyDate)}</span>
    <h2>No game published yet</h2>
    <p>The daily picks from published games. Be the first one in the gallery.</p>
    <div class="row"><a class="cta" href="/studio">Make a game</a></div>
  </div>`;

  const body = `${bar(base)}
<main class="wrap">
  <div class="head">
    <span class="mono">One game a day</span>
    <h1>Today's game on Cudic</h1>
    <p>Everyone gets the same game on the same day. It changes at midnight UTC, it takes minutes, and you never have to sign up. <a href="/five">Five more worth five minutes →</a></p>
  </div>
  ${pickBlock}
  <div class="sect">
    <h3>How the daily works</h3>
    <p>The pick is a hash of the date over the published games, so it needs no schedule and no editor: the same date gives the same game on every server. Miss a day and nothing is lost — the streak only counts days you played, and it never punishes a gap by more than a reset.</p>
  </div>
  <div class="sect">
    <h3>Why a daily</h3>
    <p>A game you have to remember is a game you stop playing. One page, one pick, one tap: that is the whole loop, and it is the same reason a crossword gets opened on a train.</p>
  </div>
  <footer>
    <span class="mono">Cudic daily #${pick.number}</span>
    <span class="sp"></span>
    <a href="/arcade">All games</a>
    <a href="/studio">Make your own</a>
  </footer>
</main>
<script>
(function(){
  var DAY = ${JSON.stringify(pick.key)};
  var NUM = ${pick.number};
  var TITLE = ${JSON.stringify(g ? titleOf(g) : 'Cudic daily')};
  var AUTHOR = ${JSON.stringify(g ? (g.author || '') : '')};
  var KEY = 'cudic_daily';
  function read(){ try { return JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch(e){ return {}; } }
  function write(v){ try { localStorage.setItem(KEY, JSON.stringify(v)); } catch(e){} }
  function yesterday(key){ var d = new Date(key + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() - 1); return d.toISOString().slice(0,10); }
  var st = read();
  // The play link is the proof: landing on the game page is the play.
  document.querySelectorAll('a[href^="/g/"]').forEach(function(a){
    a.addEventListener('click', function(){
      var cur = read();
      var n = 1;
      if (cur.last === DAY) n = cur.streak || 1;
      else if (cur.last === yesterday(DAY)) n = (cur.streak || 0) + 1;
      write({ last: DAY, streak: n, best: Math.max(n, cur.best || 0) });
    });
  });
  var line = document.getElementById('streakLine');
  if (line) {
    if (st.last === DAY) line.textContent = 'Played today ✓ — streak ' + (st.streak || 1) + ' day' + ((st.streak || 1) === 1 ? '' : 's') + '.';
    else if (st.streak) line.textContent = 'Streak ' + st.streak + ' day' + (st.streak === 1 ? '' : 's') + ' — play today to keep it.';
  }
  var btn = document.getElementById('shareCard');
  if (!btn) return;
  btn.addEventListener('click', function(){
    var c = document.getElementById('card');
    var x = c.getContext('2d');
    x.fillStyle = '#0d0e10'; x.fillRect(0, 0, 1200, 630);
    x.fillStyle = '#b8f23a'; x.font = '600 26px "Geist Mono", monospace';
    x.fillText('CUDIC DAILY #' + NUM, 80, 150);
    x.fillStyle = '#f7f5ec'; x.font = '500 74px "Geist", sans-serif';
    var words = String(TITLE).split(' ');
    var lines = [''], li = 0;
    words.forEach(function(w){
      var t = lines[li] ? lines[li] + ' ' + w : w;
      if (x.measureText(t).width > 1040 && lines[li]) { li++; lines[li] = w; } else lines[li] = t;
    });
    lines.slice(0, 3).forEach(function(l, i){ x.fillText(l, 80, 250 + i * 88); });
    x.fillStyle = '#9a9a94'; x.font = '400 30px "Geist", sans-serif';
    if (AUTHOR) x.fillText('by ' + AUTHOR, 80, 520);
    x.fillStyle = '#FF8C1A'; x.fillRect(80, 566, 240, 6);
    x.fillStyle = '#9a9a94'; x.font = '400 26px "Geist Mono", monospace';
    x.fillText('cudic.vercel.app/daily', 80, 614);
    c.toBlob(function(blob){
      if (!blob) return;
      var file = new File([blob], 'cudic-daily-' + NUM + '.png', { type: 'image/png' });
      var text = 'Cudic daily #' + NUM + ' — ' + TITLE;
      if (navigator.canShare && navigator.canShare({ files: [file] }) && navigator.share) {
        navigator.share({ files: [file], text: text, title: text }).catch(function(){});
        return;
      }
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = file.name;
      a.click();
      setTimeout(function(){ URL.revokeObjectURL(a.href); }, 4000);
    }, 'image/png');
    try { if (window.cudicTrack) window.cudicTrack('share_click', { surface: 'daily', method: 'card' }); } catch(e){}
  });
})();
</script>`;

  return shell({ base, title, description, canonical: base + '/daily', body, jsonLd });
}

/**
 * /five — five named games with a reason to open each one.
 * @param {Array} games published rows (already ordered best-first)
 * @param {{base?: string}} opts
 */
function renderFive(games, opts) {
  opts = opts || {};
  const base = (opts.base || SITE).replace(/\/$/, '');
  const list = (games || []).filter((g) => g && UUID.test(String(g.id || ''))).slice(0, 5);
  const items = list.map((g) => {
    const slug = slugOf(g);
    const desc = (g.description || '').trim();
    const plays = Number(g.play_count) || 0;
    return `<li>
      <span class="mono" style="min-width:34px;padding-top:6px;color:var(--mute)">${plays || 0} play${plays === 1 ? '' : 's'}</span>
      <div class="thumb"><img src="/g/${encodeURIComponent(slug)}/thumb" alt="" loading="lazy" decoding="async"></div>
      <div>
        <h2><a href="${esc(hrefOf(g))}?utm_source=five&amp;utm_medium=cta">${esc(titleOf(g))}</a></h2>
        <p>${esc(desc.slice(0, 200) || 'A short game you can finish in one sitting.')}</p>
      </div>
    </li>`;
  }).join('');

  const body = `${bar(base)}
<main class="wrap">
  <div class="head">
    <span class="mono">Five games · five minutes each</span>
    <h1>Five games worth five minutes</h1>
    <p>No grid, no infinite scroll, no autoplay. Five games, each one short enough to finish before your tea goes cold. <a href="/daily">Or play today's pick →</a></p>
  </div>
  ${items ? '<ol class="five">' + items + '</ol>' : '<div class="sect"><p>No published games yet. <a href="/studio">Make the first one</a>.</p></div>'}
  <footer>
    <span class="mono">Updated as people play</span>
    <span class="sp"></span>
    <a href="/arcade">Every game</a>
    <a href="/studio">Make your own</a>
  </footer>
</main>`;

  return shell({
    base,
    title: 'Five games worth five minutes — Cudic',
    description: 'Five short browser games from Cudic, each one playable in about five minutes with no download and no sign-up.',
    canonical: base + '/five',
    body,
    jsonLd: ''
  });
}

module.exports = { pickDaily, renderDaily, renderFive, dayKey, dayNumber, hash, SITE };
