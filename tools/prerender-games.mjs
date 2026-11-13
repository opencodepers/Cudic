// Build-time prerender: crawlable landing pages for published games.
//
// Vercel frontend is static output, so /view.html?id=… renders nothing for
// crawlers. This script writes plain HTML for every published game into
// public/game/<id>/index.html (plus a fresh sitemap.xml). The files live only
// in the build output — public/game/ is gitignored, so nothing new lands in
// the repo.
//
// Real data check (2026-10-22): the anon key CAN read published games rows via
// REST, but users rows are RLS-blocked for anon (the author embed comes back
// null), so author names come from Render's public /api/games (service-side
// join, 50 newest) merged in by id. If Render is asleep or unreachable the
// pages still build — they just say "A Cudic creator". All failures are
// non-fatal: the deploy still ships, with the previous static sitemap intact.

import { readFileSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';

const SITE = 'https://cudic.vercel.app';
const RENDER = 'https://glox-o7rr.onrender.com';

const PUB = new URL('../public', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const GAME_DIR = join(PUB, 'game');
const LIMIT = 400;
// Shared with the Render server so /arcade is identical on both hosts.

function log(m) { console.log('[prerender-games] ' + m); }

function readConfig() {
  const src = readFileSync(join(PUB, 'config.js'), 'utf8');
  const url = /SUPABASE_URL\s*=\s*['"]([^'"]+)/.exec(src)?.[1] ?? '';
  const an = /SUPABASE_ANON_KEY\s*=\s*['"]([^'"]+)/.exec(src)?.[1] ?? '';
  if (!url || !an || an.length < 20) throw new Error('SUPABASE_URL / ANON_KEY not found in config.js');
  return { url: url.replace(/\/$/, ''), anon: an };
}

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
}[c]));

function escapeXml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;'
  }[c]));
}

async function fetchGames(cfg) {
  const qs = '?select=id,slug,title,description,credits,tags,play_count,updated_at,created_at&published=eq.true&order=updated_at.desc&limit=' + LIMIT;
  const res = await fetch(cfg.url + '/rest/v1/games' + qs, {
    headers: { apikey: cfg.anon, Authorization: 'Bearer ' + cfg.anon },
    signal: AbortSignal.timeout(30000)
  });
  if (!res.ok) throw new Error('games query ' + res.status + ': ' + (await res.text()).slice(0, 200));
  return await res.json();
}

// Author names are not readable with the anon key (users RLS is locked down),
// so they come from the public Render API — newest 50 — merged in by game id.
async function fetchAuthors() {
  const res = await fetch(RENDER + '/api/games', { signal: AbortSignal.timeout(90000) });
  if (!res.ok) throw new Error('render api ' + res.status);
  const body = await res.json();
  const list = Array.isArray(body) ? body : body.games || [];
  const names = {};
  for (const g of list) {
    const n = g && g.users && g.users.display_name;
    if (g && g.id && typeof n === 'string' && n) names[g.id] = n;
  }
  return names;
}

// Same rule as lib/slug.js: a slug more than one game claims cannot name a
// single game, so those share links fall back to the id.
function sharedSlugs(games) {
  const seen = new Set();
  const dup = new Set();
  for (const g of games || []) {
    const s = String((g && g.slug) || '').trim();
    if (!s) continue;
    if (seen.has(s)) dup.add(s); else seen.add(s);
  }
  return dup;
}

function relatedFor(g, games) {
  // Same tag first, newest others to fill — an internal link trail that
  // crawlers can follow between game pages.
  const pool = games.filter((x) => x && x.id && x.id !== g.id && /^[0-9a-f-]{36}$/i.test(x.id || ''));
  const tags = new Set((g.tags || []).filter((t) => typeof t === 'string'));
  const tagged = pool.filter((x) => (x.tags || []).some((t) => tags.has(t)));
  const rel = [];
  const seen = new Set();
  for (const x of [...tagged, ...pool]) {
    if (rel.length >= 4) break;
    if (seen.has(x.id)) continue;
    seen.add(x.id);
    rel.push(x);
  }
  return rel;
}

function gamePage(g, names, games) {
  const title = (g.title || '').trim() || 'Untitled game';
  const author = (names[g.id]) || 'A Cudic creator';
  const desc = (g.description || '').trim();
  const metaDesc = desc
    ? desc.slice(0, 160)
    : ('Play ' + title + ' — a browser game by ' + author + ', made with Cudic Studio.');
  const date = String(g.updated_at || g.created_at || '').slice(0, 10);
  const tags = Array.isArray(g.tags) ? g.tags.filter((t) => typeof t === 'string').slice(0, 6) : [];
  const play = '/view.html?id=' + encodeURIComponent(g.id);
  const shareUrl = SITE + '/g/' + (g.slug && !sharedSlugs(games).has(g.slug) ? g.slug : g.id);
  const playCount = Number(g.play_count) || 0;
  const jsonLd = JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'VideoGame',
    name: title,
    description: metaDesc,
    author: { '@type': 'Person', name: author },
    datePublished: date || undefined,
    url: SITE + '/game/' + g.id + '/',
    image: SITE + '/g/' + g.id + '/thumb',
    genre: tags.length ? tags : undefined,
    applicationCategory: 'Game',
    operatingSystem: 'Web'
  });
  const related = relatedFor(g, games);
  const shot = '<img src="/g/' + g.id + '/thumb" alt="' + esc(title) + ' cover art">';
  const relHtml = related.map((x) => {
    const t = (x.title || '').trim() || 'Untitled game';
    const a2 = names[x.id] || 'A Cudic creator';
    const thumb = '<img src="/g/' + x.id + '/thumb" alt="" loading="lazy">';
    return '<a class="tile" href="/game/' + x.id + '/">'
      + '<div class="thumb">' + thumb + '</div>'
      + '<div class="tb"><b>' + esc(t) + '</b><span class="mono">BY ' + esc(a2).toUpperCase() + '</span></div></a>';
  }).join('');
  const relBlock = relHtml
    ? '<section class="related"><div class="sh"><h2>More games</h2><span class="mono">' + related.length + ' PICKS</span></div>'
      + '<div class="grid">' + relHtml + '</div></section>'
    : '';
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<script>try{var t=localStorage.getItem('glox_theme');document.documentElement.dataset.theme=(t==='light'?'light':'dark');}catch(e){}</script>
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${esc(title)} — play free on Cudic</title>
<meta name="description" content="${esc(metaDesc)}">
<meta name="cudic-game-id" content="${g.id}">
<link rel="canonical" href="${SITE}/game/${g.id}/">
<meta property="og:type" content="website">
<meta property="og:site_name" content="Cudic">
<meta property="og:title" content="${esc(title)} — play free on Cudic">
<meta property="og:description" content="${esc(metaDesc)}">
<meta property="og:url" content="${SITE}/game/${g.id}/">
<meta property="og:image" content="${SITE}/g/${g.id}/thumb">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(title)} — play free on Cudic">
<meta name="twitter:description" content="${esc(metaDesc)}">
<meta name="twitter:image" content="${SITE}/g/${g.id}/thumb">
<link rel="icon" type="image/svg+xml" href="/cudic_sfsvg.svg">
<link href="https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600&family=Geist+Mono:wght@400;500&display=swap" rel="stylesheet">
<script type="application/ld+json">${jsonLd}</script>
<style>
:root{--bg:#0d0e10;--panel:#14161b;--line:#262a33;--ink:#f7f5ec;--mute:#9a9a94;--lime:#b8f23a;--blue:#3f7cff;--mark:url(/cudic-assets/brand/logo/cudic-mark-cream.svg)}
@media (prefers-color-scheme:light){:root:not([data-theme="dark"]){--bg:#f7f5ec;--panel:#efece0;--line:#d6d2c2;--ink:#0d0e10;--mute:#6b6a63;--blue:#1b3fb8;--mark:url(/cudic-assets/brand/logo/cudic-mark-ink.svg)}}
:root[data-theme="light"]{--bg:#f7f5ec;--panel:#efece0;--line:#d6d2c2;--ink:#0d0e10;--mute:#6b6a63;--blue:#1b3fb8;--mark:url(/cudic-assets/brand/logo/cudic-mark-ink.svg)}
*{box-sizing:border-box}
html{scroll-padding-top:env(safe-area-inset-top,0px)}
body{margin:0;background:var(--bg);color:var(--ink);font:400 16px/1.55 "Geist",system-ui,sans-serif}
a{color:var(--blue)}
.mono{font-family:"Geist Mono",ui-monospace,monospace;font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:var(--mute)}
.bar{display:flex;align-items:stretch;border-bottom:1px solid var(--line);overflow-x:auto}
.bar a{display:flex;align-items:center;gap:10px;padding:16px 20px;color:var(--ink);text-decoration:none;font-weight:500;font-size:15px;white-space:nowrap;border-right:1px solid var(--line)}
.bar a:hover{background:var(--panel)}
.bar .brand{font-weight:600}
.bar .brand img{display:block;width:18px;height:18px}
.bar .brand .mk-l{display:none}
:root[data-theme="light"] .bar .brand .mk-d{display:none}
:root[data-theme="light"] .bar .brand .mk-l{display:block}
.bar .sp{flex:1;border-right:0}
.wrap{max-width:1180px;margin:0 auto;border-left:1px solid var(--line);border-right:1px solid var(--line);min-height:100vh;display:flex;flex-direction:column}
.hero{display:grid;grid-template-columns:1.02fr .98fr;border-bottom:1px solid var(--line)}
.info{padding:56px 44px;display:flex;flex-direction:column;align-items:flex-start;gap:14px;border-right:1px solid var(--line);min-width:0}
.info .kick{color:var(--lime);margin:0}
h1{margin:0;font-weight:500;font-size:clamp(38px,5.4vw,68px);line-height:1.02;letter-spacing:-.035em;word-break:break-word}
.by{margin:0;color:var(--mute);font-size:15px}
.by b{color:var(--ink);font-weight:500}
.desc{margin:0;max-width:52ch;color:var(--ink);font-size:16px;line-height:1.65;white-space:pre-wrap}
.tags{display:flex;flex-wrap:wrap;gap:6px}
.tags span{font-family:"Geist Mono",ui-monospace,monospace;font-size:11px;letter-spacing:.04em;color:var(--ink);border:1px solid var(--line);padding:4px 10px}
.play{display:inline-flex;align-items:center;gap:14px;margin-top:6px;background:var(--lime);color:#0d0e10;border:1px solid var(--lime);padding:15px 22px;text-decoration:none;font-family:"Geist Mono",ui-monospace,monospace;font-size:12px;font-weight:500;letter-spacing:.08em;text-transform:uppercase;transition:background .12s steps(2),color .12s steps(2),border-color .12s steps(2)}
.play:after{content:"→";transition:transform .12s steps(2)}
.play:hover{background:var(--ink);color:var(--bg);border-color:var(--ink)}
.play:hover:after{transform:translateX(4px)}
.sub{margin:0}
.shot{position:relative;background:var(--line);display:flex;align-items:center;justify-content:center;min-height:280px}
.shot img{display:block;width:100%;height:100%;object-fit:cover}
.share{display:flex;flex-wrap:wrap;gap:6px;margin-top:2px}
.sbtn{appearance:none;background:transparent;color:var(--ink);border:1px solid var(--line);padding:9px 14px;font-family:"Geist Mono",ui-monospace,monospace;font-size:11px;letter-spacing:.06em;text-transform:uppercase;cursor:pointer;text-decoration:none}
.sbtn:hover{border-color:var(--ink)}
.build{margin-top:2px;color:var(--mute);font-size:13px;text-decoration:none;border-bottom:1px solid var(--line)}
.build:hover{color:var(--ink);border-color:var(--ink)}
.related{flex:1}
.sh{display:flex;justify-content:space-between;align-items:baseline;padding:20px 28px;border-bottom:1px solid var(--line)}
.sh h2{margin:0;font-weight:500;font-size:22px;letter-spacing:-.02em}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr))}
.tile{display:flex;flex-direction:column;color:var(--ink);text-decoration:none;border-right:1px solid var(--line);border-bottom:1px solid var(--line);min-width:0}
.tile:hover{background:var(--panel)}
.thumb{aspect-ratio:16/9;background:var(--panel);overflow:hidden;border-bottom:1px solid var(--line)}
.thumb img{display:block;width:100%;height:100%;object-fit:cover}
.tb{padding:14px 16px;display:flex;flex-direction:column;gap:6px}
.tb b{font-weight:500;font-size:15px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
footer{padding:20px 28px;display:flex;flex-wrap:wrap;gap:16px;align-items:center;border-top:1px solid var(--line);color:var(--mute);font-size:13px}
footer a{color:var(--ink);text-decoration:none;border-bottom:1px solid var(--line)}
footer a:hover{border-color:var(--ink)}
footer .sp{flex:1}
@media(max-width:820px){.hero{grid-template-columns:1fr}.info{border-right:0;border-bottom:1px solid var(--line);padding:40px 24px}.shot{min-height:220px;order:-1}.bar a{padding:14px 14px;font-size:14px}}
@media(prefers-reduced-motion:reduce){*{transition:none!important}}
</style>
</head>
<body>
<header class="bar">
  <a class="brand" href="/"><img class="mk-d" src="/cudic-assets/brand/logo/cudic-mark-cream.svg" alt=""><img class="mk-l" src="/cudic-assets/brand/logo/cudic-mark-ink.svg" alt="">Cudic</a>
  <a href="/games">Games</a>
  <a href="/studio">Studio</a>
  <span class="sp"></span>
  <a href="/login">Sign in</a>
</header>
<main class="wrap">
  <section class="hero">
    <div class="info">
      <p class="mono kick">Browser game · free</p>
      <h1>${esc(title)}</h1>
      <p class="by">by <b>${esc(author)}</b>${date ? ' · ' + esc(date) : ''}${playCount > 0 ? ' · ' + playCount + ' plays' : ''}</p>
      ${desc ? '<p class="desc">' + esc(desc) + '</p>' : ''}
      ${tags.length ? '<div class="tags">' + tags.map((t) => '<span>' + esc(t) + '</span>').join('') + '</div>' : ''}
      <a class="play" href="${play}" rel="nofollow">Play now</a>
      <p class="mono sub">Opens in the player · nothing to install</p>
      <div class="share">
        <button class="sbtn" id="nativeShare" type="button" data-share="native">Share</button>
        <a class="sbtn" id="xShare" data-share="x" href="https://x.com/intent/tweet?text=${encodeURIComponent(title + ' — play free on Cudic')}&url=${encodeURIComponent(shareUrl)}" target="_blank" rel="noopener">Post on X</a>
        <button class="sbtn" id="copyLink" type="button" data-share="copy">Copy link</button>
      </div>
      <a class="build" href="${SITE}/studio?utm_source=gamepage&utm_medium=cta&utm_campaign=build">Make your own game →</a>
    </div>
    <div class="shot">${shot}</div>
  </section>
  ${relBlock}
  <footer>
    <span>Made in <a href="/studio">Cudic Studio</a> — fork this game and make it yours.</span>
    <span class="sp"></span>
    <a href="/arcade">Browse all games</a>
  </footer>
</main>
<script src="/funnel.js?v=1" defer></script>
<script>
(function(){
  var url = ${JSON.stringify(shareUrl)};
  var copy = document.getElementById('copyLink');
  if (copy) copy.addEventListener('click', function(){
    var done = function(){ copy.textContent = 'Copied'; setTimeout(function(){ copy.textContent = 'Copy link'; }, 1600); };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(url).then(done, function(){ window.prompt('Copy this link', url); });
    else window.prompt('Copy this link', url);
  });
  var nat = document.getElementById('nativeShare');
  if (nat) nat.addEventListener('click', function(){
    if (navigator.share) navigator.share({ title: document.title, url: url }).catch(function(){});
    else if (copy) copy.click();
  });
})();
</script>
<script src="/auth-nav.js?v=1"></script>
</body>
</html>
`;
}

const CORE = [
  ['/', 'daily', '1.0'],
  ['/games', 'daily', '0.9'],
  ['/arcade', 'daily', '0.9'],
  ['/daily', 'daily', '0.9'],
  ['/five', 'weekly', '0.8'],
  ['/studio', 'weekly', '0.9'],
  ['/cookbook/', 'weekly', '0.8'],
  ['/cookbook/platformer.html', 'monthly', '0.7'],
  ['/cookbook/clicker.html', 'monthly', '0.7'],
  ['/cookbook/canvas-art.html', 'monthly', '0.7'],
  ['/cookbook/cloud-saves.html', 'monthly', '0.7'],
  ['/cookbook/multiplayer.html', 'monthly', '0.7'],
  ['/docs', 'weekly', '0.6'],
  ['/editor', 'weekly', '0.7'],
  ['/chat', 'daily', '0.7'],
  ['/servers', 'daily', '0.6'],
  ['/themes', 'weekly', '0.6'],
  ['/music', 'weekly', '0.7'],
  ['/login', 'monthly', '0.5'],
  ['/privacy', 'yearly', '0.3'],
  ['/terms', 'yearly', '0.3'],
  ['/profile', 'monthly', '0.3'],
];

function sitemap(games) {
  const urls = CORE.map(([path, freq, pri]) =>
    '  <url><loc>' + SITE + path + '</loc><changefreq>' + freq + '</changefreq><priority>' + pri + '</priority></url>');
  for (const g of games) {
    const d = String(g.updated_at || g.created_at || '').slice(0, 10);
    urls.push('  <url><loc>' + SITE + '/game/' + g.id + '/</loc>' +
      (d ? '<lastmod>' + d + '</lastmod>' : '') +
      '<changefreq>weekly</changefreq><priority>0.8</priority></url>');
  }
  return '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
    urls.join('\n') + '\n</urlset>\n';
}

try {
  const cfg = readConfig();
  const games = await fetchGames(cfg);
  log('fetched ' + games.length + ' published games');
  let names = {};
  try {
    names = await fetchAuthors();
    log('authors merged from Render API (' + Object.keys(names).length + ' named)');
  } catch (e) {
    log('author lookup skipped — ' + (e && e.message ? e.message : e));
  }
  rmSync(GAME_DIR, { recursive: true, force: true });
  mkdirSync(GAME_DIR, { recursive: true });
  for (const g of games) {
    if (!g || !/^[0-9a-f-]{36}$/i.test(g.id)) continue;
    mkdirSync(join(GAME_DIR, g.id), { recursive: true });
    writeFileSync(join(GAME_DIR, g.id, 'index.html'), gamePage(g, names, games));
  }
  writeFileSync(join(PUB, 'sitemap.xml'), sitemap(games));
  // /arcade is deliberately NOT written here. It is rendered per request by the
  // Render server (lib/arcade.js), so a game published after this build still
  // appears. A static copy would shadow that rewrite and freeze the list at
  // deploy time — publish ten minutes later and the game is invisible.
  log('wrote ' + games.length + ' game pages + sitemap (' + (CORE.length + games.length) + ' URLs)');
} catch (e) {
  log('SKIPPED — ' + (e && e.message ? e.message : e));
}
process.exit(0);
