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

const { duplicateSlugs, slugFor } = require('./slug');

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
}[c]));

// A JSON value for an inline <script>: '<' is escaped so a title containing
// "</script>" cannot close the tag early. JSON.stringify alone does not do it.
const js = (v) => JSON.stringify(v).replace(/</g, '\\u003c');

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

const slugOf = (g, dup) => slugFor(g, dup) || String(g.id || '');
const hrefOf = (g, dup) => '/g/' + encodeURIComponent(slugOf(g, dup));
const titleOf = (g) => (g.title || '').trim() || 'Untitled game';

const ARROW = '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6"/></svg>';

function shell(opts) {
  const { base, title, description, canonical, body, jsonLd, page } = opts;
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta name="color-scheme" content="light dark">
<script src="/consent.js?v=1"></script>
<script>try{if(localStorage.getItem('glox_theme')!=='light')document.documentElement.dataset.theme='dark';}catch(e){}try{var _cudicScheme=document.querySelector('meta[name="color-scheme"]');if(_cudicScheme)_cudicScheme.setAttribute('content',document.documentElement.dataset.theme==='light'?'light':'dark');}catch(e){}</script>
<meta charset="UTF-8">
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
<link rel="apple-touch-icon" href="/icons/apple-touch-icon.png">
<link rel="stylesheet" href="/cudic-assets/cursors/css/fluid-cream.css">
<link href="https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600&family=Geist+Mono:wght@400;500&display=swap" rel="stylesheet">
<link rel="stylesheet" href="/docpage.css?v=7">
<link rel="stylesheet" href="/mobile.css?v=1">
<link rel="stylesheet" href="/docs-sheet.css?v=2">
${jsonLd ? '<script type="application/ld+json">' + jsonLd + '</script>' : ''}
</head>
<body data-page="${esc(page)}" data-no-rail>
${body}
<script src="/docpage.js?v=6"></script>
<script src="/theme-toggle.js?v=2"></script>
<script src="/sidebar.js?v=32"></script>
<script src="/cudic-modals.js?v=3"></script>
<script src="/funnel.js?v=1" defer></script>
</body>
</html>`;
}

/**
 * The docs sheet: window, brand rail, one scrolling main column.
 * No <section> elements on purpose — docpage.js only routes pages that ask
 * to be routed, and these read as one page with anchor links.
 */
function sheetBody(o) {
  const { tag, kicker, h1, lead, nav, body, footer } = o;
  return `<div class="wrap">
  <div class="docgrid no-subtoc">
    <aside class="docside">
      <a class="brandrow" href="/"><img class="mark" src="/cudic-assets/brand/logo/cudic-mark-cream.svg" width="20" height="24" alt="Cudic home"><span class="brand-name">Cudic</span><span class="h-tag">${esc(tag)}</span></a>
      <nav id="docNav" aria-label="${esc(tag)} navigation">${nav}</nav>
      <button id="backBtn" aria-label="Go back"><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="vertical-align:-2px;margin-right:6px"><path d="M19 12H5M11 18l-6-6 6-6"/></svg>Back</button>
    </aside>

    <main class="docmain">
      <header class="docHead">
        <p class="kick"><svg width="14" height="14" viewBox="0 0 8 8" fill="currentColor" shape-rendering="crispEdges" aria-hidden="true"><use href="/cudic-assets/icons/svg/social/star.svg"/></svg><span>›</span><span class="cur2">${esc(kicker)}</span></p>
        <h1>${h1}</h1>
        <p class="lead">${lead}</p>
      </header>
      <div class="docbody">
        <article>
${body}
        </article>
      </div>
      <footer class="mono">${footer}</footer>
    </main>
  </div>
</div>`;
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
        <div class="sect" id="today">
          <span class="kicker">Daily #${pick.number} · ${esc(prettyDate)}</span>
          <div class="dpick">
            <h2>${esc(titleOf(g))}</h2>
            <p class="by">By ${esc((g.author || 'a Cudic creator').toUpperCase())}</p>
            <p>${esc((g.description || '').trim().slice(0, 220) || 'Published in the Cudic gallery.')}</p>
            <div class="dpick-row">
              <a class="dpick-cta" href="${esc(hrefOf(g))}?utm_source=daily&amp;utm_medium=cta&amp;utm_campaign=daily_${pick.number}">Play today's game${ARROW}</a>
              <button class="dpick-ghost" id="shareCard" type="button">Share card</button>
              <a class="dpick-ghost" href="/arcade">Browse all games</a>
            </div>
            <p class="dpick-note" id="streakLine">Opening the game starts the streak. It is kept in this browser, not on a server.</p>
          </div>
        </div>` : `
        <div class="sect" id="today">
          <span class="kicker">Daily #${pick.number} · ${esc(prettyDate)}</span>
          <div class="dpick">
            <h2>No game published yet</h2>
            <p>The daily picks from published games. Publish a game to put it in the running.</p>
            <div class="dpick-row"><a class="dpick-cta" href="/studio">Make a game${ARROW}</a></div>
          </div>
        </div>`;

  const body = `${sheetBody({
    tag: 'daily',
    kicker: 'Daily',
    h1: "Today's game on Cudic",
    lead: 'One game from the gallery, the same for everyone, new at midnight UTC. No account needed. <a href="/five">Five more short games</a>.',
    nav: `<a href="#today"><span class="n">01</span><span>Today's pick</span></a>
        <a href="#how"><span class="n">02</span><span>How the daily works</span></a>
        <a href="#streak"><span class="n">03</span><span>The streak</span></a>
        <div class="toc-group">More</div>
        <a href="/five"><span>Five short games</span></a>
        <a href="/arcade"><span>All games</span></a>`,
    body: `${pickBlock}
        <div class="sect" id="how">
          <h2>How the daily works</h2>
          <p>The pick is a hash of the UTC date over the published games, sorted by id, so the order the database returns cannot change it. Daily #1 is 1 January 2026 and the number goes up by one each day. There is no schedule and no editor: the date alone picks the game.</p>
          <p>The pick is plain HTML, so it is there with JavaScript off. Only the streak and the share card need the script.</p>
        </div>
        <div class="sect" id="streak">
          <h2>The streak</h2>
          <p>Opening the game on two days in a row makes a streak of two. A missed day starts it again at one, and the page keeps your best. The count lives in this browser under <code>cudic_daily</code>; it is not attached to an account and nothing is uploaded.</p>
        </div>`,
    footer: `Cudic daily #${pick.number} · <a href="/">cudic.vercel.app</a> · <a href="/arcade">all games</a> · <a href="/studio">make your own</a>`
  })}
<canvas id="card" width="1200" height="630" style="display:none"></canvas>
<script>
(function(){
  var DAY = ${js(pick.key)};
  var NUM = ${pick.number};
  var TITLE = ${js(g ? titleOf(g) : 'Cudic daily')};
  var AUTHOR = ${js(g ? (g.author || '') : '')};
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
    x.fillStyle = '#222222'; x.fillRect(0, 0, 1200, 630);
    x.fillStyle = '#FF8C1A'; x.font = '600 26px "Geist Mono", monospace';
    x.fillText('CUDIC DAILY #' + NUM, 80, 150);
    x.fillStyle = '#FFFFFF'; x.font = '500 74px "Geist", sans-serif';
    var words = String(TITLE).split(' ');
    var lines = [''], li = 0;
    words.forEach(function(w){
      var t = lines[li] ? lines[li] + ' ' + w : w;
      if (x.measureText(t).width > 1040 && lines[li]) { li++; lines[li] = w; } else lines[li] = t;
    });
    lines.slice(0, 3).forEach(function(l, i){ x.fillText(l, 80, 250 + i * 88); });
    x.fillStyle = '#A6A6A6'; x.font = '400 30px "Geist", sans-serif';
    if (AUTHOR) x.fillText('by ' + AUTHOR, 80, 520);
    x.fillStyle = '#FF8C1A'; x.fillRect(80, 566, 240, 6);
    x.fillStyle = '#A6A6A6'; x.font = '400 26px "Geist Mono", monospace';
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

  return shell({ base, title, description, canonical: base + '/daily', body, jsonLd, page: 'daily' });
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
  const dup = duplicateSlugs(list);
  const items = list.map((g, i) => {
    const slug = slugOf(g, dup);
    const desc = (g.description || '').trim();
    const plays = Number(g.play_count) || 0;
    return `<li>
          <span class="n">${String(i + 1).padStart(2, '0')}</span>
          <div class="thumb"><img src="/g/${encodeURIComponent(slug)}/thumb" alt="" loading="lazy" decoding="async"></div>
          <div class="fx">
            <h2><a href="${esc(hrefOf(g, dup))}?utm_source=five&amp;utm_medium=cta">${esc(titleOf(g))}</a></h2>
            <p>${esc(desc.slice(0, 200) || 'No description yet.')}</p>
            <span class="plays">${plays} play${plays === 1 ? '' : 's'}</span>
          </div>
        </li>`;
  }).join('');

  const body = `${sheetBody({
    tag: 'five',
    kicker: 'Five',
    h1: 'Five games worth five minutes',
    lead: 'Five published games, most played first. <a href="/daily">Or play today\'s pick</a>.',
    nav: `<a href="#five"><span class="n">01</span><span>The five</span></a>
        <a href="#how"><span class="n">02</span><span>How the five is picked</span></a>
        <div class="toc-group">More</div>
        <a href="/daily"><span>Today's pick</span></a>
        <a href="/arcade"><span>All games</span></a>`,
    body: items
      ? `<p class="updated">Most played first.</p>
        <ol class="five" id="five">${items}</ol>
        <div class="sect" id="how">
          <h2>How the five is picked</h2>
          <p>The list is the five published games with the most plays, read from the database on each request and cached for five minutes. It follows plays without an editor or a queue, and the number under each game is its all-time play count.</p>
        </div>`
      : `<div class="sect" id="five"><p>No published games yet. <a href="/studio">Make the first one</a>.</p></div>`,
    footer: 'Cudic five · <a href="/arcade">every game</a> · <a href="/studio">make your own</a>'
  })}`;

  return shell({
    base,
    title: 'Five games worth five minutes — Cudic',
    description: 'Five browser games from Cudic, picked by play count, with no download and no sign-up.',
    canonical: base + '/five',
    body,
    jsonLd: '',
    page: 'five'
  });
}

module.exports = { pickDaily, renderDaily, renderFive, dayKey, dayNumber, hash, SITE };
