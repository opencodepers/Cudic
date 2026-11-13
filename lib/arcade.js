/* file: lib/arcade.js
 * what: renders /arcade — real HTML listing every published game, with a link per card.
 * why: /games is a JS shell (cards are fetched client-side), so a crawler sees an empty
 *      page and no game links. This page needs no JavaScript to be read or followed.
 * invariants: every card points at /g/<slug||id> (resolves on both Vercel and Render),
 *      and a slug claimed by more than one game is replaced by that game's id;
 *      thumbnails are referenced by URL, never inlined; no user input is interpolated raw.
 * see: tools/prerender-games.mjs (writes public/arcade.html at build),
 *      server.js (dynamic /arcade for the Render host) */

const SITE = 'https://cudic.vercel.app';

const { duplicateSlugs, slugFor } = require('./slug');

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
}[c]));

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function card(g, dup) {
  const slug = slugFor(g, dup);
  const href = '/g/' + encodeURIComponent(slug);
  const title = (g.title || '').trim() || 'Untitled game';
  const author = (g.author || '').trim() || 'A Cudic creator';
  const desc = (g.description || '').trim();
  const plays = Number(g.play_count) || 0;
  const tags = Array.isArray(g.tags) ? g.tags.filter((t) => typeof t === 'string').slice(0, 3) : [];
  // Always an <img>: /g/<slug>/thumb answers with the game's own art or the
  // shared default, so a card is never an empty box.
  const art = '<img src="/g/' + encodeURIComponent(slug) + '/thumb" alt="" loading="lazy" decoding="async">';
  return '<a class="card" href="' + esc(href) + '">'
    + '<div class="art">' + art
    + (plays > 0 ? '<span class="plays mono">' + plays + (plays === 1 ? ' play' : ' plays') + '</span>' : '')
    + '</div>'
    + '<div class="body">'
    + '<b>' + esc(title) + '</b>'
    + '<span class="mono by">BY ' + esc(author).toUpperCase() + '</span>'
    + (desc ? '<p>' + esc(desc.slice(0, 180)) + '</p>' : '')
    + (tags.length ? '<div class="tags">' + tags.map((t) => '<span>' + esc(t) + '</span>').join('') + '</div>' : '')
    + '</div></a>';
}

/**
 * @param {Array} games rows from Supabase (id, slug, title, description, tags,
 *              play_count, updated_at, created_at, author, has_thumb)
 * @param {{base?: string, now?: Date}} opts
 */
module.exports = function renderArcade(games, opts) {
  opts = opts || {};
  const base = (opts.base || SITE).replace(/\/$/, '');
  const list = (games || []).filter((g) => g && UUID.test(String(g.id || '')));
  const totalPlays = list.reduce((n, g) => n + (Number(g.play_count) || 0), 0);
  // "untitled-project" is claimed by nine rows: those cards must link by id.
  const dup = duplicateSlugs(list);
  // '<' is escaped so a game named "</script>" cannot close the tag early.
  const jsonLd = JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    name: 'Games on Cudic',
    numberOfItems: list.length,
    itemListElement: list.slice(0, 100).map((g, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      url: base + '/g/' + encodeURIComponent(slugFor(g, dup)),
      name: (g.title || '').trim() || 'Untitled game'
    }))
  }).replace(/</g, '\\u003c');
  const cards = list.map((g) => card(g, dup)).join('');
  const empty = '<p class="empty">No published games yet. <a href="' + base + '/studio">Make the first one</a>.</p>';

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<script>try{var t=localStorage.getItem('glox_theme');document.documentElement.dataset.theme=(t==='light'?'light':'dark');}catch(e){}</script>
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>All games on Cudic — ${list.length} browser games to play free</title>
<meta name="description" content="Every game published on Cudic: ${list.length} browser games made in Cudic Studio. Play instantly, no download, then fork any game and make your own.">
<link rel="canonical" href="${base}/arcade">
<meta property="og:type" content="website">
<meta property="og:site_name" content="Cudic">
<meta property="og:title" content="All games on Cudic">
<meta property="og:description" content="${list.length} browser games you can play instantly — each one built in Cudic Studio.">
<meta property="og:url" content="${base}/arcade">
<meta property="og:image" content="${base}/og.png?v=2">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="All games on Cudic">
<meta name="twitter:description" content="${list.length} browser games you can play instantly — each one built in Cudic Studio.">
<meta name="twitter:image" content="${base}/og.png?v=2">
<link rel="icon" type="image/svg+xml" href="/cudic_sfsvg.svg">
<link rel="manifest" href="/manifest.webmanifest">
<link href="https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600&family=Geist+Mono:wght@400;500&display=swap" rel="stylesheet">
<script type="application/ld+json">${jsonLd}</script>
<style>
:root{--bg:#0d0e10;--panel:#14161b;--line:#262a33;--ink:#f7f5ec;--mute:#9a9a94;--lime:#b8f23a;--blue:#3f7cff}
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
.wrap{max-width:1180px;margin:0 auto;border-left:1px solid var(--line);border-right:1px solid var(--line);min-height:100vh}
.head{padding:52px 40px 34px;border-bottom:1px solid var(--line)}
.head .mono{display:block;margin-bottom:14px;color:var(--lime)}
h1{margin:0 0 12px;font-weight:500;font-size:clamp(32px,4.6vw,56px);line-height:1.03;letter-spacing:-.035em}
.head p{margin:0;max-width:60ch;color:var(--mute);font-size:16px}
.head p a{color:var(--ink);text-decoration:none;border-bottom:1px solid var(--line)}
.head p a:hover{border-color:var(--ink)}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(250px,1fr))}
.card{display:flex;flex-direction:column;color:var(--ink);text-decoration:none;border-right:1px solid var(--line);border-bottom:1px solid var(--line);min-width:0}
.card:hover{background:var(--panel)}
.art{position:relative;aspect-ratio:16/9;background:var(--panel);border-bottom:1px solid var(--line);overflow:hidden}
.art img{display:block;width:100%;height:100%;object-fit:cover}
.plays{position:absolute;right:10px;bottom:8px;background:rgba(13,14,16,.72);color:#f7f5ec;padding:3px 8px;font-size:10px}
.body{padding:14px 16px 18px;display:flex;flex-direction:column;gap:6px;min-width:0}
.body b{font-weight:500;font-size:16px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.body .by{font-size:10px}
.body p{margin:0;color:var(--mute);font-size:13px;line-height:1.55;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden}
.tags{display:flex;flex-wrap:wrap;gap:5px;margin-top:2px}
.tags span{font-family:"Geist Mono",ui-monospace,monospace;font-size:10px;letter-spacing:.04em;border:1px solid var(--line);padding:2px 7px;color:var(--mute)}
.empty{padding:40px;color:var(--mute)}
footer{padding:22px 40px;display:flex;flex-wrap:wrap;gap:16px;align-items:center;border-top:1px solid var(--line);color:var(--mute);font-size:13px}
footer a{color:var(--ink);text-decoration:none;border-bottom:1px solid var(--line)}
footer a:hover{border-color:var(--ink)}
footer .sp{flex:1}
@media(max-width:640px){.head{padding:36px 20px 26px}.bar a{padding:14px 14px;font-size:14px}footer{padding:20px}}
</style>
</head>
<body>
<header class="bar">
  <a class="brand" href="/">Cudic</a>
  <a href="/games">Games</a>
  <a href="/studio">Studio</a>
  <span class="sp"></span>
  <a href="/login">Sign in</a>
</header>
<main class="wrap">
  <div class="head">
    <span class="mono">${list.length} game${list.length === 1 ? '' : 's'} · ${totalPlays} play${totalPlays === 1 ? '' : 's'}</span>
    <h1>Every game on Cudic</h1>
    <p>Play any of these in your browser — nothing to install. Each one was built in <a href="${base}/studio">Cudic Studio</a>, and every game can be forked, so you can start from someone else's work.</p>
  </div>
  <div class="grid">${cards || empty}</div>
  <footer>
    <span>Built in <a href="${base}/studio">Cudic Studio</a> — make your own in a browser tab.</span>
    <span class="sp"></span>
    <a href="/games">Play something random</a>
  </footer>
</main>
<script src="/funnel.js?v=1" defer></script>
</body>
</html>
`;
};

module.exports.SITE = SITE;
