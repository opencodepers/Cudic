/* file: lib/discord.js
 * what: posts to the Cudic Discord server through channel webhooks — currently
 *       two things: a game's first publish, and a push's plain-English summary.
 * why: the server is where a publish becomes real (a release is cut, the card
 *       appears), so announcing from here needs no bot process and no gateway
 *       connection on a host that sleeps.
 * invariants: never throws at the caller; a missing/rejected webhook is a no-op
 *       with a log line, because Discord being down must not fail a publish;
 *       every request is time-boxed so a slow webhook cannot hold the response;
 *       nothing here touches Supabase or the wiki state.
 * see: server.js (PUT /api/games/:id, first-publish branch), tools/discord-status.mjs
 */

const DEFAULT_SITE = 'https://cudic.vercel.app';

const VAR = {
  games: 'DISCORD_WEBHOOK_GAMES',
  status: 'DISCORD_WEBHOOK_STATUS',
  updates: 'DISCORD_WEBHOOK_UPDATES'
};

/** A real channel webhook URL, or '' — anything else is treated as unset. */
function hookUrl(kind) {
  const url = String(process.env[VAR[kind] || ''] || '').trim();
  return /^https:\/\/(?:[\w-]+\.)?discord(?:app)?\.com\/api\/webhooks\/\d+\/[\w-]+$/.test(url) ? url : '';
}

/** Public origin, without a trailing slash: SITE_URL when set. */
function siteBase(base) {
  return String(base || process.env.SITE_URL || DEFAULT_SITE).replace(/\/+$/, '');
}

/** POST one webhook message. Resolves false when unset or failed. */
async function post(kind, payload, timeoutMs = 6000) {
  const url = hookUrl(kind);
  if (!url) return false;
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetch(url + '?wait=true', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
      signal: ctl.signal
    });
    if (!res.ok) console.warn('discord ' + kind + ' webhook:', res.status, (await res.text().catch(() => '')).slice(0, 200));
    return res.ok;
  } catch (e) {
    console.warn('discord ' + kind + ' webhook failed:', e.message);
    return false;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Announce a game that has just gone live for the first time.
 * The cover is the same /thumb route the cards use, so a game with no art still
 * posts the shared default cover instead of an empty embed.
 */
async function announcePublished(game, opts = {}) {
  if (!game || !game.id) return false;
  const base = siteBase(opts.base);
  const seg = String(game.slug || '').trim() || game.id;
  const pageUrl = base + '/g/' + encodeURIComponent(seg);
  const title = String(game.title || 'Untitled Game').slice(0, 100);
  // The card blurb is capped at 500 in the row; Discord's embed description
  // gets 280 so the message stays one glance tall.
  const blurb = String(game.description || '').trim().slice(0, 280)
    || 'Built in Cudic Studio — playable in the browser, no download.';
  return post('games', {
    username: 'Cudic',
    allowed_mentions: { parse: [] },
    embeds: [{
      title: 'New game: ' + title,
      url: pageUrl,
      description: blurb,
      color: 0x6c5ce7,
      image: { url: pageUrl + '/thumb' },
      footer: { text: 'Cudic · just published' },
      timestamp: new Date().toISOString()
    }]
  }, opts.timeoutMs);
}

module.exports = { announcePublished, post, hookUrl, siteBase, VAR };
