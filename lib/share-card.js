/* file: lib/share-card.js
 * what: OG/Twitter head rewrite for /view.html: resolves slug or id, caches meta 60s, swaps title/description/image.
 * invariants: unpublished or missing games keep the generic card; only real thumbnails claim og:image dimensions.
 * see: AGENTS.md 5, server.js (the route chain that calls it) */

module.exports = function createShareCard(supabase) {
// ── Share-card head rewrite for /view.html ───────────────────────
// Module scope, self-contained (the /g/:id helpers are nested inside the
// request handler and unreachable from here). 60s cache keeps a Discord
// unfurl burst from hitting Supabase for the same game repeatedly.
const viewOgCache = new Map(); // game id → { meta, at }; capped + cleared wholesale when large
const viewOgEscape = (s) => String(s)
  .replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

async function decorateViewHead(req, url, data) {
  const raw = String(url.searchParams.get('id') || '');
  if (!raw) return data;

  const now = Date.now();
  let meta = viewOgCache.get(raw);
  if (!meta || now - meta.at > 60000) {
    // Accept slug or id in ?id=, mirroring /g/:id — cards must resolve the
    // same way no matter which link style got shared.
    let query = supabase.from('games')
      .select('id, slug, title, description, thumbnail, published, users!games_owner_id_fkey(display_name)');
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(raw)) query = query.eq('id', raw);
    else query = query.eq('slug', raw);
    const { data: g } = await query.single();
    if (!g || !g.published) return data; // unpublished/missing game keeps the generic card
    const title = String(g.title || 'Untitled');
    meta = {
      id: g.id,
      slug: g.slug || g.id,
      titleShort: title.slice(0, 70),
      desc: String(g.description || '').trim().slice(0, 170) ||
        'Play ' + title + ' instantly in your browser — built with Cudic Studio, fork it and make your own version.',
      byline: g.users && g.users.display_name ? ' by ' + g.users.display_name : '',
      hasThumb: !!g.thumbnail,
      at: now,
    };
    if (viewOgCache.size > 300) viewOgCache.clear();
    viewOgCache.set(raw, meta);
  }

  const host = String(req.headers['x-forwarded-host'] || req.headers.host || '').split(',')[0].trim();
  const isLocal = /^(localhost|127\.)/.test(host);
  const base = isLocal
    ? (req.socket.encrypted ? 'https://' : 'http://') + host
    : (process.env.PUBLIC_ORIGIN || 'https://cudic.vercel.app');
  const playTitle = meta.titleShort + ' — play on Cudic';
  const card = meta.hasThumb ? base + '/g/' + meta.slug + '/thumb' : null;
  const map = {
    'og:title': playTitle,
    'og:description': meta.desc,
    'og:url': base + '/view.html?id=' + meta.id,
    'twitter:title': playTitle,
    'twitter:description': meta.desc,
    description: meta.desc,
  };
  let html = String(data)
    // <title> first: scrapers prefer it, humans see it in the tab.
    .replace(/<title>[^<]*<\/title>/, () => '<title>' + viewOgEscape(playTitle + meta.byline) + '</title>')
    .replace(/<meta\s+(property|name)="(og:title|og:description|og:url|og:image|twitter:title|twitter:description|twitter:image)"\s+content="[^"]*"/gi,
      (m, kind, key) => map[key.toLowerCase()] ? '<meta ' + kind + '="' + key + '" content="' + viewOgEscape(map[key.toLowerCase()]) + '"' : m)
    .replace(/<meta\s+name="description"\s+content="[^"]*"/i,
      () => '<meta name="description" content="' + viewOgEscape(map.description) + '"');
  if (card) {
    // Only claim the dimensions when shipping the real card — og.png?v=2
    // is exactly 1200×630, user thumbnails are not, and lying to scrapers
    // crops the image. Both width and height go, not just the first.
    html = html
      .replace(/(<meta\s+property="og:image")\s+content="[^"]*"/i, (m, tag) => tag + ' content="' + viewOgEscape(card) + '"')
      .replace(/(<meta\s+name="twitter:image")\s+content="[^"]*"/i, (m, tag) => tag + ' content="' + viewOgEscape(card) + '"')
      .replace(/<meta\s+property="og:image:(?:width|height)"[^>]*>/gi, '');
  }
  return html;
}

  return { decorateViewHead };
};
