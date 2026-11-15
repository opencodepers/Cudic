/* file: server.js
 * what: The backend HTTP server — static files, auth, games, WebSocket, email,
 *   AI proxy. No framework; the remaining routes are one if-chain. The chat
 *   surface lives in lib/routes/: chat (conversations, friends, DMs), messages
 *   (history, reactions, pins, search), servers (servers, channels, roles),
 *   games (gallery through edits), github (connection through webhook) and mod
 *   (moderation, reports, changelog). Leaf concerns live in lib/ too: push,
 *   storage budget, share cards, awards, the cosmetic shop, the daily streak.
 *   Dispatch order still lives here.
 * invariants: specific paths sit ABOVE generic ones (/api/games/mine before :id);
 *   every authenticated write calls needVerified(user, res); a write that changes
 *   the gallery calls gamesListCacheClear(); a new AI host goes in AI_HOSTS.
 *   Nothing hot-reloads — kill the :3000 PID and restart.
 * see: AGENTS.md 5, 12b "A new endpoint or feature" */

require('dotenv').config();
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { WebSocketServer } = require('ws');
const { createClient } = require('@supabase/supabase-js');
const { Resend } = require('resend');
const JSZip = require('jszip');
const defaultThumb = require('./lib/default-thumb');

const discord = require('./lib/discord');
const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;

// ── Input validation ──────────────────────────────────────────
// Room-name allowlist: blocks tag injection at the source for every client,
// including stale cached pages. Colon allowed for internal chan:/dm: rooms.
function validName(s) {
  // Max 96: system room names run long (chan:<uuid>:<slug> is ~50,
  // dm:<uuid>-<uuid> is 76). User input is validated tighter at creation.
  return typeof s === 'string' && /^[A-Za-z0-9][A-Za-z0-9 _\-:]{0,95}$/.test(s);
}

// ── Rewarded-ad nonces (in-memory; single instance) ─────────────
// One nonce per watch attempt, single-use, 15 min TTL. A restart only
// drops pending sessions — nothing has been paid out at that point.
const adNonces = new Map();

// ── Rate limiting (in-memory; single instance, resets on restart) ──
const rateBuckets = new Map();
function rateLimit(key, max, windowMs) {
  const now = Date.now();
  let b = rateBuckets.get(key);
  if (!b || b.reset < now) {
    // Bound the map: HTTP-path keys (play:<ip>, report:…) never see the
    // WS cleanup, so a crawler could grow this map forever.
    if (rateBuckets.size > 10000) {
      for (const [k, v] of rateBuckets) if (v.reset < now) rateBuckets.delete(k);
      if (rateBuckets.size > 15000) rateBuckets.clear();
    }
    b = { n: 0, reset: now + windowMs };
    rateBuckets.set(key, b);
  }
  b.n++;
  return b.n <= max;
}
function clientIp(req) {
  const xff = req.headers['x-forwarded-for'];
  if (xff) {
    // Rightmost hop: the nearest trusted proxy's record of the real peer.
    // Leftmost hops are attacker-controlled (fake XFF defeats leftmost keying).
    const hops = String(xff).split(',');
    return hops[hops.length - 1].trim();
  }
  return (req.socket && req.socket.remoteAddress) || 'unknown';
}

// ── Bot gate (Cloudflare Turnstile) ────────────────────────────
// A solved widget proves a human filled the form; the server verifies the
// token before anything expensive happens — sending mail, creating an
// account, deleting one. Unset TURNSTILE_SECRET_KEY means every check
// passes, so local dev, the test suite and any deploy without Cloudflare
// keys behave exactly as before. Cloudflare errors fail closed: a blocked
// signup beats an open mail relay.
const TURNSTILE_SITE_KEY = (process.env.TURNSTILE_SITE_KEY || '').trim();
const TURNSTILE_SECRET = (process.env.TURNSTILE_SECRET_KEY || '').trim();
async function turnstileOk(req, body) {
  if (!TURNSTILE_SECRET) return true; // no keys = no gate
  // Body field for JSON posts; header for DELETE, which carries no body.
  const raw = (body && body.turnstileToken) || req.headers['cf-turnstile-response'] || '';
  const token = String(raw).trim().substring(0, 4096); // CF tokens are ~2KB
  if (!token) return false;
  try {
    const r = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ secret: TURNSTILE_SECRET, response: token, remoteip: clientIp(req) }),
    });
    const j = await r.json().catch(() => ({}));
    return !!(j && j.success === true);
  } catch (e) {
    console.error('turnstile verify error:', (e && e.message) || e);
    return false;
  }
}
// URL path segments are decoded in several pack/saves routes; a raw '%'
// would throw a URIError and kill the process (no global handler catches it).
function safeDecode(s) {
  try { return decodeURIComponent(s); } catch (e) { return String(s || ''); }
}
// Server icons render inside src="…" on every visitor's list; https only,
// no quote/markup chars that could break the attribute open.
function safeIconUrl(u) {
  const s = String(u || '').trim().substring(0, 500);
  if (!s) return '';
  if (!/^https:\/\//.test(s) || /[<>"'\\]/.test(s)) return '';
  return s;
}


// NOTE: SMTP (nodemailer) was removed — Render's free tier seals outbound
// SMTP ports (25/465/587), so no SMTP transport can dial out from
// production. Mail goes out over HTTPS only: Gmail API first, then
// Resend SDK, then Brevo API.

// ── Gmail API mail (primary sender) ────────────────────────────
// Our own Gmail account sends the codes over HTTPS. OAuth: Cloud
// project "Cudic Mail", Web client, scope gmail.send only (send-only,
// can't read mail). Needs GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET,
// GMAIL_REFRESH_TOKEN, GMAIL_SENDER env. No domain, no phone, no card.
let gmailToken = { access: '', exp: 0 };
async function sendViaGmail(to, subject, html) {
  // .trim(): dashboards smuggle trailing newlines into pasted values —
  // one ghost char makes Google report "client not found" (len73 vs 72).
  const cid = (process.env.GMAIL_CLIENT_ID || '').trim(), csec = (process.env.GMAIL_CLIENT_SECRET || '').trim(),
        rtok = (process.env.GMAIL_REFRESH_TOKEN || '').trim(), from = (process.env.GMAIL_SENDER || '').trim();
  if (!cid || !csec || !rtok || !from) return new Error('gmail not configured');
  try {
    if (Date.now() > gmailToken.exp - 60000) {
      const t = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ client_id: cid, client_secret: csec, refresh_token: rtok, grant_type: 'refresh_token' }),
      });
      const body = await t.text().catch(() => '');
      let j = {};
      try { j = JSON.parse(body); } catch (e) {}
      if (!t.ok || !j.access_token) {
        // Error bodies carry only codes like invalid_client/invalid_grant,
        // never secrets — safe to log, and it names the exact failure.
        console.error('Gmail token refresh failed:', t.status, String(body).substring(0, 200));
        return new Error('gmail token refresh failed');
      }
      gmailToken = { access: j.access_token, exp: Date.now() + (j.expires_in || 3600) * 1000 };
    }
    const raw = Buffer.from(
      `From: Cudic <${from}>\r\nTo: ${to}\r\nSubject: ${subject}\r\nContent-Type: text/html; charset=utf-8\r\n\r\n${html}`
    ).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    const r = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + gmailToken.access, 'content-type': 'application/json' },
      body: JSON.stringify({ raw }),
    });
    if (r.ok) return null;
    // Error bodies carry only codes/messages, never secrets — and the
    // message names the exact failure (mailbox vs request vs permission).
    let sbody = '';
    try { sbody = await r.text(); } catch (e) {}
    console.error('Gmail send failed:', r.status, String(sbody).substring(0, 300));
    return new Error('gmail send failed: ' + r.status);
  } catch (e) { return e instanceof Error ? e : new Error(String(e)); }
}

// ── Magic email codes (soft gate) ─────────────────────────────
// email_confirmed_at is the source of truth. Exempt: GitHub OAuth
// (GitHub proved the email) and accounts created before magic codes
// shipped (never asked to confirm — leave them alone).
const EMAIL_CODES_SINCE = new Date('2026-10-11T00:00:00Z').getTime();
function userUnconfirmed(u) {
  if (!u) return false;
  if (u.email_confirmed_at) return false;
  if (u.app_metadata && u.app_metadata.provider && u.app_metadata.provider !== 'email') return false;
  if (new Date(u.created_at || 0).getTime() < EMAIL_CODES_SINCE) return false;
  return true;
}
// 403s when the writer hasn't confirmed. Returns true when clear to go.
async function needVerified(user, res) {
  if (!userUnconfirmed(user)) return true;
  res.writeHead(403, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'email_unconfirmed', text: 'Confirm your email to do that.' }));
  return false;
}
function codeHash(email, code) {
  return crypto.createHash('sha256').update(email.toLowerCase() + ':' + code).digest('hex');
}
async function activeBan(userId, kind) {
  if (!userId) return null;
  try {
    const { data } = await supabase.from('user_bans').select('banned_until, reason').eq('user_id', userId).eq('kind', kind || 'chat').order('banned_until', { ascending: false }).limit(1);
    const row = data && data[0];
    if (!row) return null;
    if (new Date(row.banned_until).getTime() <= Date.now()) return null;
    return row;
  } catch { return null; }
}

// Route modules are instantiated at the bottom, after every helper and
// map they close over exists (they still run inside handleRequest).
let messageRoutes = null, serverRoutes = null, chatRoutes = null;
let githubRoutes = null, gamesRoutes = null, modRoutes = null;

const PORT = process.env.PORT || 3000;

// ── Supabase ─────────────────────────────────────────────────────
const supabase = createClient(
  process.env.SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY || ''
);

// Award + cosmetic catalogs live in lib/cosmetics.js: static data plus two
// Supabase reads, no HTTP. Injected here so the route chain keeps the names.
const {
  AWARDS, EQUIP_CAPS, EQ_KIND, COSMETIC_SLOTS, COSMETIC_SINGLE, COSMETICS,
  COSMETIC_BY_CODE, resolveCosmetics, ownedEquipCodes,
} = require('./lib/cosmetics')(supabase);

// Award a code once. A repeat insert fails on the (user_id, code) key —
// that's "already earned", not an error.
async function awardUser(userId, code) {
  const a = AWARDS[code];
  if (!a) return false;
  const { error } = await supabase.from('user_badges').insert({ user_id: userId, code });
  if (error) return false;
  // Flairs are free and common; earning them isn't feed-worthy.
  if (a.kind !== 'flair') {
    const line = 'Earned ' + (a.kind === 'title' ? 'the title ' : 'the badge ') + a.label;
    await logActivity(userId, 'award', line);
    notify(userId, 'award', (a.kind === 'title' ? 'New title: ' : 'New badge: ') + a.label, line);
  }
  return true;
}

// Feed line. Failures are swallowed — the feed is nice-to-have.
async function logActivity(userId, kind, text) {
  try { await supabase.from('activity').insert({ user_id: userId, kind, text: String(text).slice(0, 140) }); } catch {}
}

// Inbox row for /notifications. A same-(user, kind, ref) row inside the
// last day skips, so like-toggles and re-events can't pile up. The older
// comment / friend-accept senders long predating this kept their inline
// inserts — don't migrate them for its own sake.
// ── Playtest links ───────────────────────────────────────────────
// Stateless bearer links for drafts: `<exp>.<hmac>` over the game id and
// expiry. Nothing is stored, so there is no token at rest, and changing the
// secret invalidates every outstanding link at once.
const PLAYTEST_SECRET = process.env.PLAYTEST_SECRET || process.env.GITHUB_WEBHOOK_SECRET || process.env.SUPABASE_SERVICE_KEY || '';
function playtestSign(gid, days) {
  const exp = Math.floor(Date.now() / 1000) + Math.max(1, Math.min(30, Number(days) || 7)) * 86400;
  const sig = crypto.createHmac('sha256', PLAYTEST_SECRET).update('playtest|' + gid + '|' + exp).digest('base64url');
  return { token: exp + '.' + sig, exp };
}
function playtestValid(gid, token) {
  if (!PLAYTEST_SECRET || !token) return false;
  const m = /^(\d{10})\.([A-Za-z0-9_-]{43})$/.exec(String(token));
  if (!m) return false;
  const exp = Number(m[1]);
  const now = Math.floor(Date.now() / 1000);
  if (!Number.isFinite(exp) || exp < now || exp > now + 31 * 86400) return false;
  const want = crypto.createHmac('sha256', PLAYTEST_SECRET).update('playtest|' + gid + '|' + exp).digest('base64url');
  try { return crypto.timingSafeEqual(Buffer.from(m[2]), Buffer.from(want)); } catch (e) { return false; }
}
function siteOrigin(req) {
  const host = String((req && req.headers && req.headers.host) || '');
  if (/^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host)) return 'http://' + host;
  return (process.env.SITE_URL || 'https://cudic.vercel.app').replace(/\/$/, '');
}

async function notify(userId, kind, title, body, refType, refId) {
  if (!userId) return;
  try {
    if (refId) {
      const since = new Date(Date.now() - 86400000).toISOString();
      const { count } = await supabase.from('notifications').select('id', { count: 'exact', head: true })
        .eq('user_id', userId).eq('kind', kind).eq('ref_id', refId).gte('created_at', since);
      if (count) return;
    }
    const { error } = await supabase.from('notifications').insert({
      user_id: userId, kind, title: String(title).slice(0, 120), body: String(body || '').slice(0, 240),
      ref_type: refType || null, ref_id: refId || null
    });
    // Best-effort and unawaited: a slow push service must not stall the
    // request that caused the notification.
    if (!error) sendPush(userId, title, body).catch(() => {});
  } catch {}
}

// Push implementation lives in lib/push.js; one Supabase client, injected.
const { webpush, vapidKeys, sendPush } = require('./lib/push')(supabase);

// Free claim, on own-profile reads only: flairs and longevity badges
// arrive without effort, so they are granted lazily whenever the user
// opens their profile settings.
async function autoGrant(user, profile) {
  const codes = ['spark'];
  if (!userUnconfirmed(user)) codes.push('check');
  const [likes, built, rated] = await Promise.all([
    supabase.from('game_likes').select('user_id').eq('user_id', profile.id).limit(1),
    supabase.from('games').select('id').eq('owner_id', profile.id).limit(1),
    supabase.from('game_ratings').select('user_id').eq('user_id', profile.id).limit(1),
  ]);
  if (likes.data && likes.data.length) codes.push('heart');
  if (built.data && built.data.length) codes.push('cube');
  if (rated.data && rated.data.length) codes.push('gem');
  const days = (Date.now() - new Date(profile.created_at || 0).getTime()) / 86400000;
  if (days >= 365) codes.push('settler', 'veteran');
  else if (days >= 30) codes.push('settler');
  await Promise.all(codes.filter(Boolean).map(c => awardUser(profile.id, c)));
}

// A game just went live: feed line, first-publish badge, milestone title.
// Gallery list cache: GET /api/games hits Supabase 3+ times per call (the
// rows page, a 200-row published-games tag scan, like counts). Those three
// results are identical for every viewer, so they're memoized 30s per
// sort|q|tag|offset key; the viewer's own like markers stay per-request.
// Every write that can change what the gallery shows (create/update/delete/
// fork/feature/mod-unpublish/revision-restore) calls gamesListCacheClear()
// so published or edited games surface instantly instead of after the TTL.
const GAMES_LIST_TTL = 30000;
const gamesListCache = new Map(); // key -> { at, rows, counts, tags }
function gamesListCacheClear() { gamesListCache.clear(); }

async function onPublished(userId, gid, title) {
  await logActivity(userId, 'game', 'Published ' + (title || 'a game'));
  await awardUser(userId, 'first_game');
  const { count } = await supabase.from('games').select('id', { count: 'exact', head: true })
    .eq('owner_id', userId).eq('published', true);
  if (count >= 5) await awardUser(userId, 'worldbuilder');
}

// ── Static file server ───────────────────────────────────────────
const MIME = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'application/javascript',
  '.mjs': 'text/javascript',
  '.json': 'application/json',
  '.txt': 'text/plain; charset=utf-8',
  '.png': 'image/png',
  '.webmanifest': 'application/manifest+json',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
};

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  // X-Seat must be listed or the browser blocks the preflight for every
  // cross-origin call that identifies the session (likes, saves, heart).
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Seat');
}

// Copy every object under one game's storage prefix into another's. Used when a
// fork has to materialise shared bytes (old schema), and when deleting a game
// whose forks still point at its prefix: storage has no cheap way to share, so
// the only safe moment to pay for a copy is just before the original vanishes.
async function copyAssetPrefix(fromPrefix, toPrefix, pathsIn) {
  const bucket = supabase.storage.from('game-assets');
  const paths = Array.isArray(pathsIn) ? pathsIn : [];
  if (!Array.isArray(pathsIn)) {
    async function walk(prefix) {
      const { data: entries } = await bucket.list(prefix, { limit: 1000 });
      for (const e of entries || []) {
        const p = prefix ? prefix + '/' + e.name : e.name;
        if (e.metadata) paths.push(p);
        else await walk(p);
      }
    }
    await walk(fromPrefix);
  }
  const copied = new Set();
  for (const from of paths) {
    const to = toPrefix + from.substring(fromPrefix.length);
    try {
      const { error: cpErr } = await bucket.copy(from, to);
      if (cpErr) throw cpErr;
      copied.add(from);
    } catch {
      try {
        const { data: blob } = await bucket.download(from);
        // Never overwrite: an existing destination is the child's own file with
        // the same name, and the child's version wins. The skipped copy counts
        // as a failure, so the parent keeps its bytes instead of a fork losing.
        if (blob) { await bucket.upload(to, blob, { upsert: false }); copied.add(from); }
        else throw new Error('download returned empty');
      } catch {
        console.error('asset copy failed for', from, '->', to);
      }
    }
  }
  return { copied, total: paths.length };
}

// Storage accounting lives in lib/storage-budget.js — pure Supabase reads.
const { ACCOUNT_STORAGE_CAP, accountStorageBytes, forgetStorageUsage } = require('./lib/storage-budget')(supabase);

const server = http.createServer((req, res) => {
  handleRequest(req, res).catch((e) => {
    // One bug in any route must not kill the whole process (Node turns
    // unhandled async rejections into a process exit since v15).
    console.error('Request error:', (e && e.message) || e);
    try {
      if (!res.headersSent) res.writeHead((e && e.code === 'too_large') ? 413 : 500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: (e && e.code === 'too_large') ? 'Payload too large.' : 'Something went wrong.' }));
    } catch (e2) { /* socket already gone */ }
  });
});
// Report-Only CSP. Inline scripts and inline handlers are still the norm on
// these pages, so nothing here is enforced: the header collects violations
// (POSTed to /api/csp-report) and a strict policy gets written from evidence.
// Vercel sends the same header from vercel.json, since headers set here never
// reach the static pages.
const CSP_REPORT_ONLY = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval' https: blob:",
  "style-src 'self' 'unsafe-inline' https:",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data: https:",
  "connect-src 'self' https: wss:",
  "frame-src 'self' https:",
  "media-src 'self' data: blob: https:",
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "report-uri /api/csp-report"
].join('; ');

// ── Shared request helpers (hoisted from handleRequest for route modules) ──
    async function requireUser(req, res) {
      const t = (req.headers.authorization || '').replace('Bearer ', '');
      // Malformed tokens (e.g. ?token=undefined leaking into a header) die
      // here instead of burning a Supabase lookup and noisy 403s.
      if (!t || t.split('.').length !== 3) { res.writeHead(401, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'Sign in required.' })); return null; }
      const { data: { user }, error } = await supabase.auth.getUser(t);
      if (error || !user) { res.writeHead(401, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'Sign in required.' })); return null; }
      return user;
    }

    async function isModerator(uid) {
      if (!uid) return false;
      try {
        const { data } = await supabase.from('moderators').select('user_id').eq('user_id', uid).single();
        return !!data;
      } catch { return false; }
    }

    function readBody(req, cap) {
      const limit = cap || 1024 * 1024;
      return new Promise((resolve, reject) => {
        let body = '', size = 0, over = false;
        req.on('data', c => {
          if (over) return;
          size += c.length;
          if (size > limit) {
            over = true;
            const err = new Error('Payload too large.');
            err.code = 'too_large';
            reject(err);
            return;
          }
          body += c;
        });
        req.on('end', () => { if (!over) { try { resolve(JSON.parse(body)); } catch { reject(new Error('Invalid JSON')); } } });
        req.on('error', () => { if (!over) reject(new Error('Request stream failed.')); });
      });
    }

    function dmRoomName(a, b) { return 'dm:' + [a, b].sort().join('-'); }

    function chanRoomName(serverId, slug) { return 'chan:' + serverId + ':' + slug; }

    function chanSlug(s) { return String(s || '').toLowerCase().trim().replace(/[^a-z0-9-_]/g, '').substring(0, 30); }

    function chanDisplay(name) { var p = String(name || '').split(':'); return '#' + (p[p.length - 1] || name); }

    function isUuid(s) { return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(s || '')); }


// ── Shared route helpers ────────────────────────────────────────
// Used by more than one route module (GitHub, games, mod): GitHub tokens and
// repo reads, revision snapshots/releases, and the browser-or-API-key auth
// resolver. Kept here so the modules never own competing copies.
const GH_SCOPES_OK = ['repo', 'public_repo'];

function ghKey() {
  const raw = process.env.GITHUB_TOKEN_KEY || '';
  if (!raw) return null;
  // Any passphrase is fine: stretch it to a 32-byte key.
  return crypto.createHash('sha256').update('cudic-github:' + raw).digest();
}

function ghSeal(text, key) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', key, iv);
  const body = Buffer.concat([c.update(text, 'utf8'), c.final()]);
  // v1.<base64(iv | auth tag | ciphertext)> — the prefix leaves room to
  // rotate the scheme without guessing at old rows.
  return 'v1.' + Buffer.concat([iv, c.getAuthTag(), body]).toString('base64');
}

function ghNoTable(err) {
  const code = String((err && err.code) || '');
  const msg = String((err && err.message) || '');
  return code === 'PGRST205' || code === '42P01' || /does not exist|schema cache/i.test(msg);
}

const GH_SETUP_TEXT = 'GitHub connections are not set up on this server yet.';

function ghOpen(sealed, key) {
  const s = String(sealed || '');
  if (!s.startsWith('v1.')) return null;
  const buf = Buffer.from(s.slice(3), 'base64');
  if (buf.length < 29) return null; // iv(12) + tag(16) + at least 1 byte
  const d = crypto.createDecipheriv('aes-256-gcm', key, buf.subarray(0, 12));
  d.setAuthTag(buf.subarray(12, 28));
  return Buffer.concat([d.update(buf.subarray(28)), d.final()]).toString('utf8');
}

async function ghToken(user) {
  const key = ghKey();
  if (!key) return { error: 'github_not_configured' };
  const { data, error } = await supabase.from('github_connections')
    .select('login, token_enc').eq('user_id', user.id).maybeSingle();
  if (error) return { error: ghNoTable(error) ? 'github_not_configured' : 'github_read_failed' };
  if (!data) return { error: 'github_not_connected' };
  let token = null;
  try { token = ghOpen(data.token_enc, key); } catch (e) { token = null; }
  if (!token) return { error: 'github_reconnect' };
  supabase.from('github_connections').update({ last_used_at: new Date().toISOString() })
    .eq('user_id', user.id).then(() => {}, () => {});
  return { token, login: data.login || '' };
}

let ghDeployWarned = false;

const DEPLOY_MAX_FILES = 200;

const DEPLOY_MAX_FILE = 300 * 1024;

const DEPLOY_MAX_BYTES = 4 * 1024 * 1024;

async function repoTreeFiles(fullName, sha, token) {
  if (!/^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/.test(fullName)) return null;
  if (!/^[0-9a-f]{7,40}$/.test(String(sha || ''))) return null;
  let tree = null;
  try {
    const r = await ghApi('/repos/' + fullName + '/git/trees/' + sha + '?recursive=1', token);
    if (!r.ok) return null;
    tree = await r.json();
  } catch (e) {
    return null;
  }
  const nodes = (tree && Array.isArray(tree.tree) ? tree.tree : [])
    .filter((n) => n && n.type === 'blob' && typeof n.path === 'string' &&
      GH_PATH.test(n.path) && !n.path.includes('..') && !n.path.startsWith('.') &&
      Number(n.size || 0) <= DEPLOY_MAX_FILE)
    .slice(0, DEPLOY_MAX_FILES);
  const out = {};
  let total = 0;
  for (const node of nodes) {
    try {
      const r = await ghApi('/repos/' + fullName + '/git/blobs/' + node.sha, token, 'application/vnd.github.raw');
      if (!r.ok) continue;
      const text = await r.text();
      if (text.indexOf('\u0000') === 0) continue; // binary — releases are text
      total += text.length;
      if (total > DEPLOY_MAX_BYTES) break;
      out[node.path] = text;
    } catch (e) {
      /* one unreadable blob must not sink the deploy */
    }
  }
  return Object.keys(out).length > 0 ? out : null;
}

const GH_ERR_TEXT = {
  github_not_configured: 'GitHub connections are not set up on this server yet.',
  github_not_connected: 'Connect GitHub in Profile → Connections first.',
  github_reconnect: 'That GitHub token can no longer be read — reconnect GitHub in Profile → Connections.',
  github_read_failed: 'Could not read your GitHub connection.',
};

const GH_NAME = /^[A-Za-z0-9._-]{1,100}$/;

const GH_PATH = /^[A-Za-z0-9._\-/ ]{1,400}$/;

function ghApi(path, token, accept) {
  return fetch('https://api.github.com' + path, {
    headers: {
      'Authorization': 'Bearer ' + token,
      'Accept': accept || 'application/vnd.github+json',
      'User-Agent': 'cudic',
    },
  });
}

function ghFail(res, status, error, text) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error, text: text || GH_ERR_TEXT[error] || 'GitHub request failed.' }));
}

async function ghGate(req, res, bucket, limit) {
  cors(res);
  const user = await requireUser(req, res); if (!user) return null;
  const got = await ghToken(user);
  if (got.error) {
    ghFail(res, got.error === 'github_not_connected' ? 409 : got.error === 'github_reconnect' ? 401 : 503, got.error);
    return null;
  }
  if (!rateLimit('github:' + bucket + ':' + user.id, limit, 60 * 60 * 1000)) {
    ghFail(res, 429, 'slow_down', 'Too many GitHub requests just now. Try again in a few minutes.');
    return null;
  }
  return { ...got, user };
}

function ghSend(path, token, method, payload) {
  return fetch('https://api.github.com' + path, {
    method,
    headers: {
      'Authorization': 'Bearer ' + token,
      'Accept': 'application/vnd.github+json',
      'Content-Type': 'application/json',
      'User-Agent': 'cudic',
    },
    body: payload === undefined ? undefined : JSON.stringify(payload),
  });
}

const GIT_SNAP_PATH = /^(?:[A-Za-z0-9._-]+\/)*[A-Za-z0-9._-]+$/;

const GIT_SNAP_CAP = 8 * 1024 * 1024;

function weekStartISO(d) {
  // Monday 00:00 of the week containing d — the week boundary.
  const t = d ? new Date(d) : new Date();
  const day = (t.getDay() + 6) % 7;
  t.setDate(t.getDate() - day);
  t.setHours(0, 0, 0, 0);
  return t.toISOString().slice(0, 10);
}

async function revisionFilesOf(row) {
  if (!row) return {};
  if (!row.manifest) return row.files || {};
  const hashes = [...new Set(Object.values(row.manifest))];
  if (!hashes.length) return {};
  const { data: rows } = await supabase.from('revision_blobs')
    .select('hash, content').eq('game_id', row.game_id).in('hash', hashes);
  const byHash = new Map((rows || []).map((b) => [b.hash, b.content]));
  const out = {};
  for (const [path, h] of Object.entries(row.manifest)) {
    if (byHash.has(h)) out[path] = byHash.get(h);
  }
  return out;
}

const RELEASE_PREFIX = 'release v';

const RELEASE_FILE = '_release.json';

async function latestRelease(gameId) {
  const { data: rows } = await supabase.from('project_revisions')
    // game_id is not optional: revisionFilesOf filters revision_blobs by
    // row.game_id, and a select that omits it reads zero blobs — every
    // release then ships an empty file set to players. Caught in prod.
    .select('id, game_id, label, files, manifest, created_at')
    .eq('game_id', gameId).like('label', RELEASE_PREFIX + '%')
    .order('created_at', { ascending: false }).limit(1);
  const row = rows && rows[0];
  if (!row) return null;
  const files = await revisionFilesOf(row);
  let meta = {};
  try { meta = JSON.parse(files[RELEASE_FILE] || '{}'); } catch (e) { meta = {}; }
  delete files[RELEASE_FILE];
  const n = Number(String(row.label).replace(RELEASE_PREFIX, '')) || 1;
  return {
    version: Number(meta.version) || n,
    notes: String(meta.notes || ''),
    source: String(meta.source || 'studio'),
    commit: String(meta.commit || ''),
    tests: meta.tests || null,
    at: row.created_at || meta.at || null,
    revision: row.id,
    files,
  };
}

async function createRelease(gameId, ownerId, files, notes, source, commit, tests) {
  const prev = await latestRelease(gameId);
  const version = (prev ? prev.version : 0) + 1;
  const all = {};
  for (const [k, v] of Object.entries(files || {})) if (typeof v === 'string') all[k] = v;
  all[RELEASE_FILE] = JSON.stringify({
    version, notes: String(notes || '').slice(0, 500), source: source || 'studio',
    commit: String(commit || ''), at: new Date().toISOString(),
    tests: tests && typeof tests === 'object' ? { passed: Number(tests.passed) || 0, failed: Number(tests.failed) || 0 } : null,
  });
  const manifest = {};
  const fresh = new Map();
  for (const [path, text] of Object.entries(all)) {
    const hash = crypto.createHash('sha256').update(String(text)).digest('hex').slice(0, 32);
    manifest[path] = hash;
    if (!fresh.has(hash)) fresh.set(hash, text);
  }
  let addressed = false;
  if (fresh.size) {
    const up = await supabase.from('revision_blobs').upsert(
      [...fresh].map(([hash, content]) => ({ game_id: gameId, hash, content })),
      { onConflict: 'game_id,hash', ignoreDuplicates: true }
    );
    addressed = !up.error; // no blob table yet -> fall back to a plain copy
  }
  const { data, error } = await supabase.from('project_revisions').insert({
    game_id: gameId, owner_id: ownerId, label: RELEASE_PREFIX + version,
    files: addressed ? {} : all, manifest: addressed ? manifest : null,
  }).select('id, label, created_at').single();
  if (error) return null;
  return {
    version, notes: String(notes || ''), source: source || 'studio', commit: String(commit || ''),
    at: data.created_at, revision: data.id, files: all,
  };
}

async function userOf(req) {
  const bearer = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '').trim();
  const headerKey = String(req.headers['x-api-key'] || '').trim();
  const key = headerKey || (bearer.startsWith('cudic_') ? bearer : '');
  if (key) return await userFromApiKey(key);
  if (!bearer || bearer.split('.').length !== 3) return null;
  const { data: { user }, error } = await supabase.auth.getUser(bearer);
  return error ? null : (user || null);
}

async function userFromApiKey(raw) {
  const hash = crypto.createHash('sha256').update(String(raw)).digest('hex');
  const { data, error } = await supabase.from('api_keys')
    .select('id, user_id, scopes, revoked_at').eq('key_hash', hash).maybeSingle();
  if (error || !data || data.revoked_at) return null;
  // Usage telemetry must never fail the request.
  supabase.from('api_keys').update({ last_used_at: new Date().toISOString() }).eq('id', data.id)
    .then(() => {}, () => {});
  const { data: got } = await supabase.auth.admin.getUserById(data.user_id);
  const keyUser = got && got.user;
  if (!keyUser) return null;
  keyUser._scopes = Array.isArray(data.scopes) ? data.scopes : [];
  keyUser._viaKey = data.id;
  return keyUser;
}

function hasScope(user, scope) {
  if (!user || !user._viaKey) return true;
  const s = user._scopes || [];
  return s.includes('*') || s.includes(scope);
}

function scopeDenied(res, scope) {
  res.writeHead(403, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'This API key is missing the "' + scope + '" scope.' }));
}

async function freeGameSlug(title, keepId) {
const base = slugify(title || 'Untitled Game');
for (let n = 1; n < 100; n++) {
  const suffix = n === 1 ? '' : '-' + n;
  const candidate = base.slice(0, 40 - suffix.length) + suffix;
  const { data } = await supabase.from('games').select('id').eq('slug', candidate);
  if (!data || !data.some((row) => row.id !== keepId)) return candidate;
}
return base.slice(0, 31) + '-' + Date.now().toString(36);
}

function sanitizeTags(raw) {
const list = (Array.isArray(raw) ? raw : String(raw || '').split(','))
  .map((t) => String(t).toLowerCase().trim().replace(/[^a-z0-9-]/g, '').slice(0, 24))
  .filter(Boolean);
return [...new Set(list)].slice(0, 8);
}

var RESERVED_PACK_SLUGS = ['anime-city-night'];

try {
  const idx = JSON.parse(fs.readFileSync('public/packs/index.json', 'utf8'));
  (idx.packs || []).forEach(p => { if (p.slug) RESERVED_PACK_SLUGS.push(p.slug); });
} catch {}

async function packByKey(key) {
  const sel = 'id, slug, name, description, manifest, price, downloads, featured, published, owner_id, created_at';
  const q = isUuid(key)
    ? supabase.from('theme_packs').select(sel).eq('id', key)
    : supabase.from('theme_packs').select(sel).eq('slug', key);
  const { data } = await q.single();
  return data || null;
}

async function handleRequest(req, res) {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

  // Baseline security headers (no dep). SAMEORIGIN keeps the sandboxed preview working.
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  // Report-Only on purpose: the app still has inline scripts and inline
  // handlers on most pages, so an enforced policy would break it today. This
  // collects the violations (see /api/csp-report) so a strict policy can be
  // written from evidence instead of guesses. Vercel serves the same header
  // from vercel.json, because these headers only apply to Render-served pages.
  res.setHeader('Content-Security-Policy-Report-Only', CSP_REPORT_ONLY);
  // /embed.html is MEANT to be framed by other sites — framing it is the
  // feature, so it keeps no X-Frame-Options (checked pre-rewrite too).
  if (url.pathname !== '/embed.html' && url.pathname !== '/embed') {
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  }

  if (req.method === 'OPTIONS') {
    cors(res);
    res.writeHead(204);
    res.end();
    return;
  }

  // ── CSP violation reports (Report-Only: nothing is blocked yet) ─
  // Browsers POST these cross-origin, so no CORS body is needed and the
  // answer is always an empty 204. Logged once per minute per sender: a
  // noisy page must not turn the log into a firehose.
  if (url.pathname === '/api/csp-report' && req.method === 'POST') {
    try {
      const body = await readBody(req, 16 * 1024).catch(() => ({}));
      const r = (body && (body['csp-report'] || body)) || {};
      if (rateLimit('csp:' + (req.socket.remoteAddress || 'x'), 20, 60000)) {
        const directive = String(r['violated-directive'] || r['effective-directive'] || '').slice(0, 120);
        const blocked = String(r['blocked-uri'] || '').slice(0, 160);
        const doc = String(r['document-uri'] || '').slice(0, 160);
        console.warn('CSP report:', directive, '|', blocked, '|', doc);
      }
    } catch {}
    res.writeHead(204);
    res.end();
    return;
  }

  // ── API: public bot-check config ───────────────────────────────
  // Pages need the site key to render the widget; the secret never leaves
  // the server. siteKey:'' = no keys configured = no widget, no gate.
  if (url.pathname === '/api/turnstile' && req.method === 'GET') {
    cors(res);
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify({ siteKey: TURNSTILE_SITE_KEY }));
    return;
  }

    // ── API: magic codes (send + verify) ─────────────────────────
  // 6-digit codes over our own mail stack (Gmail API → Resend → Brevo).
  // Supabase's built-in mail caps at 2/hour site-wide, so it can't
  // carry verification. Codes live 10 minutes, 5 attempts max, and
  // verifying flips the same email_confirmed_at the old link flow set.
  async function sendCodeMail(email, code) {
    const mailHtml = `
      <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:40px 20px;background:#FFFFFF;color:#2E2A4B;border-radius:16px;border:1px solid #C9D5F0;text-align:center;">
        <h1 style="font-size:24px;margin-bottom:8px;">cudic<span style="color:#774DCB;">.</span></h1>
        <p style="color:#5C5878;font-size:14px;margin-top:0;">Your confirmation code</p>
        <p style="font-size:40px;font-weight:800;letter-spacing:12px;margin:24px 0;color:#2E2A4B;">${code}</p>
        <p style="font-size:13px;color:#9C97B8;">Expires in 10 minutes. If you didn't ask for this, ignore it.</p>
      </div>
    `;
    const gErr = await sendViaGmail(email, 'Your Cudic code: ' + code, mailHtml);
    if (!gErr) return null;
    if (gErr.message !== 'gmail not configured') console.error('Gmail error:', gErr.message);
    if (resend) {
      try {
        const { error } = await resend.emails.send({
          from: process.env.RESEND_FROM || 'Cudic <onboarding@resend.dev>',
          to: email,
          subject: 'Your Cudic code: ' + code,
          html: mailHtml,
        });
        if (!error) return null;
        console.error('Resend error:', error);
      } catch (e) { console.error('Resend error:', (e && e.message) || e); }
    }
    // Brevo over HTTPS (port 443): SMTP ports are sealed shut on Render's
    // free tier, so nodemailer can never dial out from production. Needs
    // a verified sender + BREVO_API_KEY env.
    if (process.env.BREVO_API_KEY) {
      try {
        const r = await fetch('https://api.brevo.com/v3/smtp/email', {
          method: 'POST',
          headers: { 'accept': 'application/json', 'content-type': 'application/json', 'api-key': process.env.BREVO_API_KEY },
          body: JSON.stringify({
            sender: { name: 'Cudic', email: process.env.BREVO_SENDER || 'cudic.codes@outlook.com' },
            to: [{ email: email }],
            subject: 'Your Cudic code: ' + code,
            htmlContent: mailHtml,
          }),
        });
        if (r.ok) return null;
        try { console.error('Brevo error:', r.status, await r.text()); } catch (e) { console.error('Brevo error:', r.status); }
      } catch (e) { console.error('Brevo error:', (e && e.message) || e); }
    }
    return new Error('mail unavailable');
  }

  if (url.pathname === '/auth/send-code' && req.method === 'POST') {
    cors(res);
    if (!process.env.GMAIL_REFRESH_TOKEN && !resend && !process.env.BREVO_API_KEY) {
      res.writeHead(503, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Email not configured (GMAIL_* / RESEND_API_KEY / BREVO_API_KEY env missing)' }));
      return;
    }
    const body = await readBody(req).catch(() => ({}));
    const email = String(body.email || '').toLowerCase().trim();
    if (!email || email.indexOf('@') === -1 || email.length > 254) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Valid email required' }));
      return;
    }
    // Abuse guard: codes are a spam vector (arbitrary recipient)
    const ip = clientIp(req);
    if (!rateLimit('code:ip:' + ip, 5, 10 * 60 * 1000) || !rateLimit('code:to:' + email, 3, 60 * 60 * 1000)) {
      res.writeHead(429, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Too many requests. Try again later.' }));
      return;
    }
    // Bot gate sits after the cheap validation/rate checks (a blank form
    // costs nothing) and before the code is minted, so no mail is ever
    // sent for a script that never solved the widget.
    if (!(await turnstileOk(req, body))) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Bot check failed. Reload the page and try again.', code: 'turnstile' }));
      return;
    }
    const code = String(Math.floor(100000 + Math.random() * 900000));
    const { error: dbErr } = await supabase.from('email_codes').upsert({
      email: email,
      code_hash: codeHash(email, code),
      expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
      attempts: 0,
    }, { onConflict: 'email' });
    if (dbErr) {
      console.error('send-code db error:', dbErr);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Server error' }));
      return;
    }
    const mailError = await sendCodeMail(email, code);
    if (mailError) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Failed to send email' }));
      return;
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true }));
    return;
  }

    if (url.pathname === '/auth/verify-code' && req.method === 'POST') {
    cors(res);
    const body = await readBody(req).catch(() => ({}));
    const email = String(body.email || '').toLowerCase().trim();
    const code = String(body.code || '').replace(/\D/g, '').substring(0, 6);
    const userId = String(body.userId || '').substring(0, 64);
    if (!email || code.length !== 6) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Email and 6-digit code required' }));
      return;
    }
    const { data: row } = await supabase.from('email_codes').select('*').eq('email', email).single();
    if (!row) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'No code for this email. Send a new one.' }));
      return;
    }
    if (new Date(row.expires_at).getTime() < Date.now()) {
      await supabase.from('email_codes').delete().eq('email', email);
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Code expired. Send a new one.' }));
      return;
    }
    if ((row.attempts || 0) >= 5) {
      await supabase.from('email_codes').delete().eq('email', email);
      res.writeHead(429, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Too many tries. Send a new code.' }));
      return;
    }
    let ok = false;
    try { ok = crypto.timingSafeEqual(Buffer.from(row.code_hash, 'utf8'), Buffer.from(codeHash(email, code), 'utf8')); } catch (e) { ok = false; }
    if (!ok) {
      await supabase.from('email_codes').update({ attempts: (row.attempts || 0) + 1 }).eq('email', email);
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Wrong code. Try again.' }));
      return;
    }
    // Bind the code to an account: explicit userId from signup, else the
    // caller's own session (profile path). Either way the account's email
    // must match the address the code went to.
    let targetId = '';
    if (userId) {
      try {
        const g = await supabase.auth.admin.getUserById(userId);
        if (g && g.data && g.data.user && ((g.data.user.email || '').toLowerCase() === email)) targetId = userId;
      } catch (e) {}
    } else {
      try {
        const t = String(req.headers.authorization || '').replace('Bearer ', '');
        if (t) {
          const me = await supabase.auth.getUser(t);
          if (me && me.data && me.data.user && ((me.data.user.email || '').toLowerCase() === email)) targetId = me.data.user.id;
        }
      } catch (e) {}
    }
    if (!targetId) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'That code went to a different address.' }));
      return;
    }
    await supabase.from('email_codes').delete().eq('email', email);
    try {
      await supabase.auth.admin.updateUserById(targetId, { email_confirm: true });
    } catch (err) { console.error('Verify confirm error:', err); }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, verified: true }));
    return;
  }

    // ── API: confirm a FRESH signup (deferred registration) ──────
    // No auth row exists until this runs: signup only sends the code,
    // and the account (already confirmed) is created here, so nobody is
    // ever registered without proving the inbox. Same code proof as
    // verify-code (hash, attempts, expiry, burn). Double submits return
    // exists:true and the client just signs in with the known password.
    if (url.pathname === '/api/auth/confirm-signup' && req.method === 'POST') {
    cors(res);
    const body = await readBody(req).catch(() => ({}));
    if (!(await turnstileOk(req, body))) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Bot check failed. Reload the page and try again.', code: 'turnstile' }));
      return;
    }
    const email = String(body.email || '').toLowerCase().trim();
    const code = String(body.code || '').replace(/\D/g, '').substring(0, 6);
    const npw = String(body.password || '');
    if (!email || code.length !== 6) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Email and 6-digit code required' }));
      return;
    }
    if (npw.length < 6 || npw.length > 72) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Password must be 6–72 characters.' }));
      return;
    }
    const { data: row } = await supabase.from('email_codes').select('*').eq('email', email).single();
    if (!row) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'No code for this email. Send a new one.' }));
      return;
    }
    if (new Date(row.expires_at).getTime() < Date.now()) {
      await supabase.from('email_codes').delete().eq('email', email);
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Code expired. Send a new one.' }));
      return;
    }
    if ((row.attempts || 0) >= 5) {
      await supabase.from('email_codes').delete().eq('email', email);
      res.writeHead(429, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Too many tries. Send a new code.' }));
      return;
    }
    let ok = false;
    try { ok = crypto.timingSafeEqual(Buffer.from(row.code_hash, 'utf8'), Buffer.from(codeHash(email, code), 'utf8')); } catch (e) { ok = false; }
    if (!ok) {
      await supabase.from('email_codes').update({ attempts: (row.attempts || 0) + 1 }).eq('email', email);
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Wrong code. Try again.' }));
      return;
    }
    await supabase.from('email_codes').delete().eq('email', email);
    try {
      const { error: createErr } = await supabase.auth.admin.createUser({
        email: email,
        password: npw,
        email_confirm: true,
      });
      if (createErr) {
        if (String(createErr.message || '').toLowerCase().includes('already')) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true, exists: true }));
          return;
        }
        throw createErr;
      }
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Account creation failed.' }));
      return;
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, verified: true }));
    return;
  }

// ── API: reset password via email code ─────────────────────────
// Same proof as verify-code (hashed code, 5 attempts, 10-minute expiry,
// burn on use) minus the signup binding: the account is found by email
// scan. Also flips email_confirm — proving the inbox proves the address,
// which rescues email-only signups whose tab closed before setup.
// shortcut: user lookup scans auth users (fine at current scale; add a
// dedicated index/lookup if the user table ever gets big).
  if (url.pathname === '/api/auth/reset-password' && req.method === 'POST') {
    cors(res);
    const body = await readBody(req).catch(() => ({}));
    if (!(await turnstileOk(req, body))) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Bot check failed. Reload the page and try again.', code: 'turnstile' }));
      return;
    }
    const email = String(body.email || '').toLowerCase().trim();
    const code = String(body.code || '').replace(/\D/g, '').substring(0, 6);
    const npw = String(body.newPassword || '');
    if (!email || code.length !== 6) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Email and 6-digit code required' }));
      return;
    }
    if (npw.length < 6 || npw.length > 72) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Password must be 6–72 characters.' }));
      return;
    }
    const { data: row } = await supabase.from('email_codes').select('*').eq('email', email).single();
    if (!row) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'No code for this email. Send a new one.' }));
      return;
    }
    if (new Date(row.expires_at).getTime() < Date.now()) {
      await supabase.from('email_codes').delete().eq('email', email);
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Code expired. Send a new one.' }));
      return;
    }
    if ((row.attempts || 0) >= 5) {
      await supabase.from('email_codes').delete().eq('email', email);
      res.writeHead(429, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Too many tries. Send a new code.' }));
      return;
    }
    let ok = false;
    try { ok = crypto.timingSafeEqual(Buffer.from(row.code_hash, 'utf8'), Buffer.from(codeHash(email, code), 'utf8')); } catch (e) { ok = false; }
    if (!ok) {
      await supabase.from('email_codes').update({ attempts: (row.attempts || 0) + 1 }).eq('email', email);
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Wrong code. Try again.' }));
      return;
    }
    let targetId = '';
    try {
      for (let page = 1; page <= 50 && !targetId; page++) {
        const { data: lu } = await supabase.auth.admin.listUsers({ page, perPage: 200 });
        const hit = (lu && lu.users || []).find(u => ((u.email || '').toLowerCase() === email));
        if (hit) targetId = hit.id;
        if (lu && lu.users && lu.users.length < 200) break;
      }
    } catch (e) {}
    if (!targetId) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'No account uses that email.' }));
      return;
    }
    await supabase.from('email_codes').delete().eq('email', email);
    try {
      const { error: upErr } = await supabase.auth.admin.updateUserById(targetId, { password: npw, email_confirm: true });
      if (upErr) throw upErr;
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Reset failed.' }));
      return;
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true }));
    return;
  }

// ── API: check verification status ─────────────────────────────
  if (url.pathname === '/auth/check-verified') {
    cors(res);
    const authHeader = req.headers.authorization || '';
    const token = authHeader.replace('Bearer ', '');
    if (!token) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ verified: false }));
      return;
    }

    const { data: { user }, error } = await supabase.auth.getUser(token);
    if (error || !user) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ verified: false }));
      return;
    }

    // Check if Supabase says email is confirmed
    const verified = !!user.email_confirmed_at;
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ verified }));
    return;
  }

// ── API: must this account confirm a code before entering? ─────
  // Same userUnconfirmed() rule the write gates use (GitHub OAuth +
  // pre-code accounts exempt), so login can't drift from enforcement.
  // No token / dead token → false: nothing to hold at the door.
  if (url.pathname === '/auth/verification-required') {
    cors(res);
    const token = String(req.headers.authorization || '').replace('Bearer ', '');
    if (!token) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ required: false }));
      return;
    }
    try {
      const { data: { user }, error } = await supabase.auth.getUser(token);
      const required = !error && !!user && userUnconfirmed(user);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ required }));
    } catch (e) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ required: false }));
    }
    return;
  }

  // ── Auth callback (server-side fallback) ───────────────────────
  if (url.pathname === '/auth/callback') {
    const code = url.searchParams.get('code');
    if (code) {
      const { data, error } = await supabase.auth.exchangeCodeForSession(code);
      if (error) {
        console.error('Auth callback error:', error.message);
      }
      if (data && data.session) {
        const frontend = 'https://cudic.vercel.app';
        // No token in the redirect: nothing consumed `?token=` (the real
        // OAuth flow exchanges PKCE client-side via auth.js), and live JWTs
        // must not ride in history/logs.
        res.writeHead(302, { Location: frontend + '/chat' });
        res.end();
        return;
      }
    }
    const frontend = 'https://cudic.vercel.app';
    res.writeHead(302, { Location: frontend + '/' });
    res.end();
    return;
  }

  // ── API: get session ───────────────────────────────────────────
  // GET-only: DELETE /api/session (seat release) lives further below.
  if (url.pathname === '/api/session' && req.method === 'GET') {
    cors(res);
    const authHeader = req.headers.authorization || '';
    const token = authHeader.replace('Bearer ', '');

    if (!token) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ user: null }));
      return;
    }

    const { data: { user }, error } = await supabase.auth.getUser(token);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ user: error ? null : user }));
    return;
  }

  // ── API: get profile (user_id + display_name) ──────────────────
  if (url.pathname === '/api/profile' && req.method === 'GET') {
    cors(res);
    const user = await userOf(req);
    if (!user) { res.writeHead(401); res.end(); return; }
    if (!hasScope(user, 'profile:read')) { scopeDenied(res, 'profile:read'); return; }

    const { data: profile, error: profErr } = await supabase
      .from('users')
      .select('id, user_id, display_name, avatar_url, bio, interests, setup_done, theme, pack_slug, equips, created_at, streak_days')
      .eq('id', user.id)
      .single();

    if (profErr || !profile) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ profile: null }));
      return;
    }

    // Free flairs + longevity badges are claimed just by opening profile.
    try { await autoGrant(user, profile); } catch {}

    const [badgeRes, fRes, gRes, frRes, achRes] = await Promise.all([
      supabase.from('user_badges').select('code, awarded_at').eq('user_id', profile.id),
      supabase.from('follows').select('follower_id', { count: 'exact', head: true }).eq('followed_id', profile.id),
      supabase.from('follows').select('followed_id', { count: 'exact', head: true }).eq('follower_id', profile.id),
      supabase.from('friendships').select('user_id', { count: 'exact', head: true })
        .or('user_id.eq.' + profile.id + ',friend_id.eq.' + profile.id).eq('status', 'accepted'),
      // Recent in-game achievement unlocks, newest first, for the profile
      // shelf. Titles ride along via the FK join; an empty table is fine.
      supabase.from('game_achievements')
        .select('code, awarded_at, games!game_achievements_game_id_fkey(title, id)')
        .eq('user_id', profile.id)
        .order('awarded_at', { ascending: false })
        .limit(12)
    ]);

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      profile,
      // Client surfaces mod-only tools (feature button, weekly theme setter)
      // when this is true; server endpoints still re-check membership.
      is_moderator: await isModerator(profile.id),
      email: user.email || '',
      awards: badgeRes.data || [],
      followers: fRes.count || 0,
      following: gRes.count || 0,
      friends: frRes.count || 0,
      achievements: (achRes.data || []).map((a) => ({
        code: a.code,
        at: a.awarded_at,
        game_title: (a.games && a.games.title) || '',
        game_id: (a.games && a.games.id) || null
      }))
    }));
    return;
  }

  // ── Connect GitHub (profile → Connections) ─────────────────────
  // The public import in Studio needs no account. This is the other half:
  // link GitHub once and Cudic can read your repos, private ones included
  // (committing back comes later). Supabase's linkIdentity flow hands the
  // browser an OAuth token; it is POSTed here once, verified against
  // GitHub, then sealed with AES-256-GCM under GITHUB_TOKEN_KEY. No route
  // ever returns the token — only the GitHub login and granted scopes — so
  // the encrypted row has exactly one consumer: the server itself.



  // A missing table/column is a PostgREST error, not a SQL one. Server and
  // DB deploy separately, so the feature has to degrade, never 500.




  // ── github routes: lib/routes/github.js ─────────────────────────
  if (githubRoutes && githubRoutes.matches(url.pathname)) {
    await githubRoutes.handle(req, res, url);
    if (res.headersSent) return;
  }






  // ── Connected GitHub: what the sealed token is actually for ────────
  // Studio cannot read a private repo: jsDelivr only sees public code and
  // api.github.com allows 60 requests/hour per IP, an IP every visitor shares
  // on Render. So the work moves here, where the user's own token pays the
  // quota (5000/hour) and never leaves this process.

  // Encrypted row → token. A rotated key or an edited row throws, and that has
  // to read as "reconnect", never as a 500 with no way forward.

  // ── Push to deploy ──────────────────────────────────────────────
  // Warned once when the deploy columns have not been migrated yet, so a
  // missing column reads as one line of logs instead of noise on every push.

  // The files of one commit, path → text, read through the git-data API. This
  // is what a webhook deploys: the tree names the blobs, each blob is fetched
  // raw. Text only — a release snapshot stores strings, and a game's images
  // already live in the asset bucket.













  // POST — anything with a body needs a method GitHub accepts, and ghApi is
  // GET-only on purpose so a read path can never write by accident.






  // ── API: the project's Git repository, stored with the project ──
  // The browser keeps a real repository in IndexedDB, which is per browser and
  // per origin: a second device — or the same one after site data is cleared —
  // opened with no history. Storing the repository's own files next to the
  // project lets Source Control follow the account instead of the machine.
  // One JSON snapshot per project under game-git/<id>.json in the bucket the
  // assets already use keeps this additive: no schema change, no migration.









  if (url.pathname === '/api/user' && req.method === 'GET') {
    try {
      const q = new URL(req.url, 'http://localhost').searchParams;
      const userId = q.get('id') || q.get('user_id');
      if (!userId) { res.writeHead(400); res.end(JSON.stringify({ error: 'id required' })); return; }
      const [profileRes, gamesRes, packsRes, pageRes, badgeRes, folRes, achRes] = await Promise.all([
        supabase.from('users').select('id, user_id, display_name, avatar_url, bio, interests, created_at, pack_slug, equips').eq('id', userId).single(),
        supabase.from('games').select('id, title, play_count').eq('owner_id', userId).eq('published', true).order('updated_at', { ascending: false }).limit(20),
        supabase.from('theme_packs').select('slug, name').eq('owner_id', userId).eq('published', true).order('updated_at', { ascending: false }).limit(20),
        supabase.from('creator_pages').select('accent, banner_url, pinned_game_id, links, show_games, show_packs, show_comments, custom_css').eq('user_id', userId).maybeSingle(),
        supabase.from('user_badges').select('code').eq('user_id', userId),
        supabase.from('follows').select('follower_id', { count: 'exact', head: true }).eq('followed_id', userId),
        // Public achievement shelf: recent unlocks, newest first. Game titles
        // come from the FK join; ids of other games never ride along beyond
        // a published game's own id, which is already public.
        supabase.from('game_achievements')
          .select('code, awarded_at, games!game_achievements_game_id_fkey(title, id)')
          .eq('user_id', userId)
          .order('awarded_at', { ascending: false })
          .limit(12)
      ]);
      const data = profileRes.data;
      if (profileRes.error || !data) { res.writeHead(404); res.end(JSON.stringify({ error: 'Not found' })); return; }
      data.games = gamesRes.data || [];
      data.packs = packsRes.data || [];
      data.page = pageRes.data || {};
      data.followers = folRes.count || 0;
      data.achievements = (achRes.data || []).map((a) => ({
        code: a.code,
        at: a.awarded_at,
        game_title: (a.games && a.games.title) || '',
        game_id: (a.games && a.games.id) || null
      }));
      // Resolve only equipped codes into catalog rows; the client doesn't
      // need the whole catalog to draw the name line and badge row.
      const eq = data.equips && typeof data.equips === 'object' ? data.equips : {};
      const equipped = [...(Array.isArray(eq.t) ? eq.t : []), ...(Array.isArray(eq.b) ? eq.b : []), ...(Array.isArray(eq.f) ? eq.f : [])];
      const owned = new Set((badgeRes.data || []).map(r => r.code));
      data.awards = {};
      equipped.forEach(code => {
        const a = AWARDS[code];
        if (a) data.awards[code] = { label: a.label, kind: a.kind, icon: a.icon };
      });
      // Shop cosmetics: resolved to labels so the page never has to know
      // prices or slot rules. Everything worn is public by design.
      data.cosmetics = resolveCosmetics(data.equips);
      // The viewer shows Follow/Following only when they're signed in.
      const vtoken = (req.headers.authorization || '').replace('Bearer ', '');
      if (vtoken) {
        const { data: { user: viewer } } = await supabase.auth.getUser(vtoken).catch(() => ({ data: { user: null } }));
        if (viewer) {
          const { data: vf } = await supabase.from('follows').select('follower_id')
            .eq('follower_id', viewer.id).eq('followed_id', userId).maybeSingle();
          data.viewer_follows = !!vf;
        }
      }
      res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify({ profile: data }));
    } catch (e) { res.writeHead(500); res.end(JSON.stringify({ error: 'Server error' })); }
    return;
  }

  // ── API: creator page comments ──────────────────────────────────
  // GET: public list (auth not required). POST: signed-in + verified +
  // seat-checked, rate-limited. DELETE: author (or moderator) only.
  const creatorCommentsMatch = url.pathname.match(/^\/api\/creators\/([^/]+)\/comments(?:\/([^/]+))?$/);
  if (creatorCommentsMatch && req.method === 'GET') {
    cors(res);
    const creatorId = creatorCommentsMatch[1];
    const { data: comments } = await supabase.from('creator_comments')
      .select('id, author_id, body, created_at, users!creator_comments_author_id_fkey(display_name, avatar_url)')
      .eq('creator_id', creatorId)
      .order('created_at', { ascending: false })
      .limit(100);
    res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
    res.end(JSON.stringify({ comments: comments || [] }));
    return;
  }
  if (creatorCommentsMatch && creatorCommentsMatch[2] && req.method === 'DELETE') {
    cors(res);
    const user = await requireUser(req, res); if (!user) return;
    const commentId = creatorCommentsMatch[2];
    const { data: target } = await supabase.from('creator_comments').select('id, author_id').eq('id', commentId).single();
    if (!target) { res.writeHead(404, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'Comment not found.' })); return; }
    if (target.author_id !== user.id && !(await isModerator(user.id))) {
      res.writeHead(403, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'Not yours to delete.' })); return;
    }
    await supabase.from('creator_comments').delete().eq('id', commentId);
    res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
    res.end(JSON.stringify({ ok: true }));
    return;
  }
  if (creatorCommentsMatch && !creatorCommentsMatch[2] && req.method === 'POST') {
    cors(res);
    const user = await requireUser(req, res); if (!user) return;
    if (!(await seatAlive(user.id, seatFromReq(req)))) { seatDead(res); return; }
    if (!(await needVerified(user, res))) return;
    if (!rateLimit('ccom:' + user.id, 20, 3600000)) { res.writeHead(429, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'Slow down — 20 comments an hour max.' })); return; }
    const creatorId = creatorCommentsMatch[1];
    if (creatorId === user.id) { res.writeHead(400, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'You cannot comment on your own page.' })); return; }
    const { data: creator } = await supabase.from('users').select('id').eq('id', creatorId).single();
    if (!creator) { res.writeHead(404, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'Creator not found.' })); return; }
    const body = await readBody(req).catch(() => ({}));
    const text = String(body.body || '').trim().substring(0, 500);
    if (!text) { res.writeHead(400, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'Say something first.' })); return; }
    const { data, error } = await supabase.from('creator_comments').insert({ creator_id: creatorId, author_id: user.id, body: text }).select('id, body, created_at').single();
    if (error) { res.writeHead(500, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'Could not post.' })); return; }
    res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
    res.end(JSON.stringify({ comment: data }));
    return;
  }

  // ── API: save creator page customization ────────────────────────
  // Structured fields + custom CSS only — no scripts. Validation is strict
  // so a bad value can't break the public page or anyone viewing it.
  if (url.pathname === '/api/creator/custom' && req.method === 'PUT') {
    cors(res);
    const user = await requireUser(req, res); if (!user) return;
    if (!(await seatAlive(user.id, seatFromReq(req)))) { seatDead(res); return; }
    if (!(await needVerified(user, res))) return;
    const body = await readBody(req).catch(() => ({}));
    const updates = {};
    if (body.accent !== undefined) {
      const a = String(body.accent || '').trim();
      if (!/^#[0-9a-fA-F]{6}$/.test(a)) { res.writeHead(400, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'Accent must be a hex color like #b8f23a.' })); return; }
      updates.accent = a.toLowerCase();
    }
    if (body.banner_url !== undefined) {
      const b = String(body.banner_url || '').trim().substring(0, 500);
      const prefix = (process.env.SUPABASE_URL || '') + '/storage/v1/object/public/avatars/';
      if (b && (!b.startsWith(prefix) || /["'<>]/.test(b))) { res.writeHead(400, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'Invalid banner URL.' })); return; }
      updates.banner_url = b;
    }
    if (body.pinned_game_id !== undefined) {
      if (!body.pinned_game_id) updates.pinned_game_id = null;
      else {
        const { data: pg } = await supabase.from('games').select('id').eq('id', String(body.pinned_game_id)).eq('owner_id', user.id).eq('published', true).single();
        if (!pg) { res.writeHead(400, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'Pin a published game you own.' })); return; }
        updates.pinned_game_id = pg.id;
      }
    }
    if (body.links !== undefined) {
      const links = (Array.isArray(body.links) ? body.links : []).slice(0, 6).map(l => ({
        label: String((l && l.label) || '').trim().substring(0, 24),
        url: String((l && l.url) || '').trim().substring(0, 500)
      })).filter(l => l.label && /^https:\/\//i.test(l.url));
      updates.links = links;
    }
    if (body.show_games !== undefined) updates.show_games = !!body.show_games;
    if (body.show_packs !== undefined) updates.show_packs = !!body.show_packs;
    if (body.show_comments !== undefined) updates.show_comments = !!body.show_comments;
    if (body.custom_css !== undefined) {
      const css = String(body.custom_css || '').replace(/<\/style/gi, '<\\/style').substring(0, 20000);
      updates.custom_css = css;
    }
    updates.updated_at = new Date().toISOString();
    const { data, error } = await supabase.from('creator_pages').upsert({ user_id: user.id, ...updates }).select().single();
    if (error) { console.error('creator page save error:', error.message); res.writeHead(500, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'Could not save.' })); return; }
    res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
    res.end(JSON.stringify({ page: data }));
    return;
  }


  // ── games routes: lib/routes/games.js ─────────────────────────
  if (gamesRoutes && gamesRoutes.matches(url.pathname)) {
    await gamesRoutes.handle(req, res, url);
    if (res.headersSent) return;
  }


  // ── Weekly build theme (mods set one; otherwise auto-picked) ─────
  // State lives in a small JSON file next to the server. Ephemeral disk on
  // Render is fine: a fresh deploy just auto-picks a new theme. The theme
  // doubles as the gallery tag, so "view this week's entries" is simply
  // the games page filtered on it.
  const WEEKLY_FILE = path.join(__dirname, 'weekly.json');
  const WEEKLY_POOL = [
    'ocean', 'space', 'one-button', 'retro', 'food', 'cats', 'robots', 'night',
    'ice', 'jungle', 'fruit', 'maze', 'ninjas', 'gems', 'weather', 'tiny',
    'cozy', 'speedrun', 'pirates', 'farm'
  ];

  function loadWeekly() {
    const thisWeek = weekStartISO();
    let state = null;
    try { state = JSON.parse(fs.readFileSync(WEEKLY_FILE, 'utf8')); } catch {}
    if (state && state.week === thisWeek) return state;
    // New week: a mod-set theme carries within its week only; after that
    // the rotator picks again (never the same theme twice in a row).
    const prev = state && state.theme;
    let picked = prev;
    while (picked === prev) picked = WEEKLY_POOL[Math.floor(Math.random() * WEEKLY_POOL.length)];
    state = { week: thisWeek, theme: picked, set_by: null, manual: false };
    try { fs.writeFileSync(WEEKLY_FILE, JSON.stringify(state, null, 2)); }
    catch (e) { console.warn('weekly: could not persist theme state:', e.message); }
    return state;
  }
  if (url.pathname === '/api/weekly' && req.method === 'GET') {
    cors(res);
    const state = loadWeekly();
    // The rollover settle rides the first /api/weekly call of a new week:
    // top-3 payouts run once, then winners ride along in every response so
    // the homepage spotlight needs no second request.
    let winners = jamWinners;
    try { winners = await settleJam(weekStartISO(new Date(Date.now() - 7 * 86400000))); } catch {}
    res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify({ week_start: state.week, theme: state.theme, set_by: state.set_by || null, jam: { winners } }));
    return;
  }
  if (url.pathname === '/api/weekly' && req.method === 'POST') {
    cors(res);
    const user = await requireUser(req, res); if (!user) return;
    if (!(await isModerator(user.id))) { res.writeHead(403, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'Moderators only.' })); return; }
    if (!rateLimit('weekly:' + user.id, 10, 60000)) { res.writeHead(429, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'Slow down.' })); return; }
    const body = await readBody(req).catch(() => ({}));
    const theme = String(body.theme || '').trim().toLowerCase();
    if (/^[a-z0-9][a-z0-9 _\-]{1,23}$/.test(theme) === false) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Theme must be 2-24 letters, numbers, spaces, dashes.' }));
      return;
    }
    const state = { week: weekStartISO(), theme, set_by: user.user_id || user.id, manual: true };
    try { fs.writeFileSync(WEEKLY_FILE, JSON.stringify(state, null, 2)); }
    catch (e) { console.error('weekly: could not persist mod set:', e.message); res.writeHead(500, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'Could not save.' })); return; }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, week_start: state.week, theme: state.theme }));
    return;
  }

  // ── API: weekly creator race (standings; settles finished weeks lazily) ─
  // Same Monday-00:00-UTC weeks as the jam and the digest. No auth to view;
  // an optional Bearer token adds the viewer's own ranking in the payload.
  if (url.pathname === '/api/race' && req.method === 'GET') {
    cors(res);
    raceSettle().catch(() => {}); // finished weeks get settled on any view
    const week = digestWeekStart();
    const endsAt = new Date(week + 'T00:00:00.000Z');
    endsAt.setUTCDate(endsAt.getUTCDate() + 7);
    let meId = null;
    const authHeader = req.headers.authorization || '';
    const token = authHeader.replace('Bearer ', '');
    if (token) {
      try { const auth = await supabase.auth.getUser(token); if (auth.data && auth.data.user) meId = auth.data.user.id; } catch (e) {}
    }
    const [r, last] = await Promise.all([
      raceTop(week, 20, meId),
      supabase.from('race_weeks').select('week, top').lt('week', week).order('week', { ascending: false }).limit(1),
    ]);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      week,
      ends_at: endsAt.toISOString(),
      top: r ? r.top : [],
      me: r ? r.me : null,
      total_creators: r ? r.total : 0,
      last_winners: ((last.data && last.data[0]) || {}).top || [],
    }));
    return;
  }

  // ── Weekly jam (the build theme doubles as the jam) ─────────────
  // A signed-in player votes for published games tagged with this week's
  // theme; unlike / relieses a vote. Settling happens lazily at the week
  // rollover: top three games bank coins for their maker and a badge.
  var JAM_PRIZES = [
    { coins: 150, place: 1 }, { coins: 75, place: 2 }, { coins: 40, place: 3 }
  ];
  var jamSettledWeek = null, jamWinners = []; // per-process settle guard.
  // Pay out one week's winners. Failures are logged, never thrown — the
  // weekly endpoint must answer even if Supabase hiccups mid-settle.
  async function settleJam(prevWeek) {
    if (!prevWeek || jamSettledWeek === prevWeek) return jamWinners;
    const { data: votes } = await supabase.from('jam_votes').select('game_id, user_id').eq('week_start', prevWeek).limit(5000);
    if (!votes || !votes.length) { jamSettledWeek = prevWeek; jamWinners = []; return jamWinners; }
    const tally = {};
    for (const v of votes) tally[v.game_id] = (tally[v.game_id] || 0) + 1;
    const top = Object.keys(tally).map(id => ({ id, votes: tally[id] })).sort((a, b) => b.votes - a.votes).slice(0, 3);
    if (!top.length) { jamSettledWeek = prevWeek; jamWinners = []; return jamWinners; }
    const { data: rows } = await supabase.from('games')
      .select('id, title, slug, owner_id, users!owner_id(display_name, user_id)').in('id', top.map(t => t.id));
    const games = rows || [];
    jamWinners = [];
    for (const p of JAM_PRIZES) {
      const t = top[p.place - 1];
      const g = games.find(x => x && x.id === t.id);
      if (!g || !g.owner_id) continue;
      // Idempotent per (owner, week, place): a redeploy mid-week must not
      // double-pay checked via the ledger reason, not memory.
      const reason = 'jam:' + prevWeek + ':' + p.place;
      const { count: paid } = await supabase.from('coin_ledger')
        .select('id', { count: 'exact', head: true }).eq('user_id', g.owner_id).eq('reason', reason);
      if (!paid) {
        try {
          await supabase.rpc('grant_coins', { p_user: g.owner_id, p_delta: p.coins, p_reason: reason, p_ref: g.id });
          await notify(g.owner_id, 'jam', 'Jam place #' + p.place + ': ' + (g.title || 'your game'),
            'You won +' + p.coins + ' coins in last week\'s game jam.', 'game', g.id);
        } catch (e) { console.error('jam settle: payout failed:', e && e.message); }
      }
      try { await awardUser(g.owner_id, 'jam_champion'); } catch {}
      jamWinners.push({ place: p.place, game_id: g.id, title: g.title || 'Untitled', slug: g.slug, owner: (g.users && g.users.display_name) || 'Unknown', votes: t.votes });
    }
    jamSettledWeek = prevWeek;
    console.log('jam: settled', prevWeek, '—', jamWinners.length, 'winners');
    return jamWinners;
  }
  // Vote state for one game this week: entry check + tally + viewer's vote.
  // GET is public — the game page needs it signed out too; absent token
  // simply reports `voted: false`.
  const jamVoteMatch = url.pathname === '/api/jam/vote';
  if (jamVoteMatch && (req.method === 'GET' || req.method === 'POST' || req.method === 'DELETE')) {
    cors(res);
    const state = loadWeekly();
    const authHeader = req.headers.authorization || '';
    const token = authHeader.replace('Bearer ', '');
    let user = null;
    if (token) {
      const { data: { user: u } } = await supabase.auth.getUser(token);
      user = u || null;
    }
    if (req.method !== 'GET') {
      if (!user) { res.writeHead(401, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'Unauthorized' })); return; }
      if (!(await seatAlive(user.id, seatFromReq(req)))) { seatDead(res); return; }
      if (!(await needVerified(user, res))) return;
      if (!rateLimit('jamvote:' + user.id, 30, 3600000)) { res.writeHead(429, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'Slow down.' })); return; }
    }
    const body = req.method === 'GET' ? null : await readBody(req).catch(() => ({}));
    const gid = req.method === 'GET' ? String(url.searchParams.get('game_id') || '') : String(body.game_id || '');
    if (!isUuid(gid)) { res.writeHead(400, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'Invalid game.' })); return; }
    const { data: g } = await supabase.from('games').select('published, owner_id, tags').eq('id', gid).single();
    if (!g || !g.published) { res.writeHead(404, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'Not found' })); return; }
    const isEntry = Array.isArray(g.tags) && state.theme && g.tags.map(t => String(t).toLowerCase()).includes(state.theme);
    const { count } = await supabase.from('jam_votes').select('user_id', { count: 'exact', head: true }).eq('week_start', state.week).eq('game_id', gid);
    const votes = count || 0;
    let voted = false;
    if (user) {
      const { data: mine } = await supabase.from('jam_votes').select('user_id').eq('week_start', state.week).eq('game_id', gid).eq('user_id', user.id).maybeSingle();
      voted = !!mine;
    }
    if (req.method === 'GET') { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ week: state.week, theme: state.theme, entry: isEntry, votes, voted })); return; }
    if (!isEntry) { res.writeHead(400, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'This game is not in this week\'s jam.' })); return; }
    if (g.owner_id === user.id) { res.writeHead(400, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'You can\'t vote for your own game.' })); return; }
    if (req.method === 'POST') {
      // One vote per person per week: voting for a different game moves the
      // vote instead of stacking a second one (upsert keyed per game would
      // otherwise let one user back several entries at once).
      const { data: prior } = await supabase.from('jam_votes').select('game_id').eq('week_start', state.week).eq('user_id', user.id).maybeSingle();
      if (prior && prior.game_id && prior.game_id !== gid) {
        await supabase.from('jam_votes').delete().eq('week_start', state.week).eq('game_id', prior.game_id).eq('user_id', user.id);
      }
      await supabase.from('jam_votes').upsert({ week_start: state.week, game_id: gid, user_id: user.id }, { onConflict: 'week_start,game_id,user_id', ignoreDuplicates: true });
      const { count: now } = await supabase.from('jam_votes').select('user_id', { count: 'exact', head: true }).eq('week_start', state.week).eq('game_id', gid);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, voted: true, votes: now || votes + 1 }));
    } else {
      await supabase.from('jam_votes').delete().eq('week_start', state.week).eq('game_id', gid).eq('user_id', user.id);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, voted: false, votes: Math.max(0, votes - 1) }));
    }
    return;
  }
  // Public standings for the current week: entries ranked by votes. Small:
  // the vote table stays capped in practice, and the shelf shows the top
  // slice only.
  if (url.pathname === '/api/jam' && req.method === 'GET') {
    cors(res);
    const state = loadWeekly();
    const { data: votes } = await supabase.from('jam_votes').select('game_id').eq('week_start', state.week).limit(5000);
    const tally = {};
    for (const v of votes || []) tally[v.game_id] = (tally[v.game_id] || 0) + 1;
    const ids = Object.keys(tally);
    let games = [];
    if (ids.length) {
      const { data: rows } = await supabase.from('games')
        .select('id, title, slug, thumbnail, owner_id, users!owner_id(display_name, user_id)').eq('published', true).in('id', ids.slice(0, 50));
      games = (rows || []).map(({ thumbnail, ...x }) => ({ ...x, has_thumb: true, votes: tally[x.id] || 0 }))
        .sort((a, b) => b.votes - a.votes);
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ week_start: state.week, theme: state.theme, games }));
    return;
  }



  // ── API: follow feed shelf for the homepage ──────────────────
  // Recently published games from creators this viewer follows. Distinct
  // path from the activity feed (/api/feed, §follow/:id area): that one
  // serves activity lines, this one serves games to browse further.
  if (url.pathname === '/api/feed/games' && req.method === 'GET') {
    cors(res);
    const user = await requireUser(req, res); if (!user) return;
    const { data: subs } = await supabase.from('follows').select('followed_id').eq('follower_id', user.id);
    const ids = [...new Set((subs || []).map(s => s.followed_id))];
    if (!ids.length) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ games: [], following: 0 }));
      return;
    }
    // Same shape the gallery ships (thumbnails stripped, has_thumb flag):
    // the shelf cards are built by the same code as the picks row.
    const { data, error } = await supabase.from('games')
      .select('id, title, description, credits, thumbnail, tags, play_count, owner_id, forked_from, forked_from_title, created_at, updated_at, users!owner_id(display_name, user_id, avatar_url)')
      .in('owner_id', ids.slice(0, 200)).eq('published', true)
      .order('created_at', { ascending: false }).limit(12);
    if (error) console.error('feed list error:', error.message);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ games: (data || []).map(({ thumbnail, ...g }) => ({ ...g, has_thumb: true })), following: ids.length }));
    return;
  }

  // ── API: collections ────────────────────────────────────────────
  // GET /api/collections?mine=1 — my collections (auth)
  // GET /api/collections/:id — one collection + its games (public/unlisted, or owner)
  // POST /api/collections — create; PATCH /api/collections/:id — edit
  // DELETE /api/collections/:id — delete; POST/DELETE /api/collections/:id/items
  // PUBLIC shelf: one user's public collections (profile + creator pages).
  // Titles/counts only — the items live behind the existing :id GET.
  if (/^\/api\/users\/([^/]+)\/collections$/.test(url.pathname) && req.method === 'GET') {
    cors(res);
    const uid = url.pathname.split('/')[3];
    if (!isUuid(uid)) { res.writeHead(400, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'Invalid user.' })); return; }
    const { data: rows } = await supabase.from('collections').select('id, title, description, created_at').eq('owner_id', uid).eq('visibility', 'public').order('created_at', { ascending: false }).limit(50);
    const ids = (rows || []).map(c => c.id);
    const counts = {};
    if (ids.length) {
      const { data: items } = await supabase.from('collection_items').select('collection_id').in('collection_id', ids);
      (items || []).forEach(i => { counts[i.collection_id] = (counts[i.collection_id] || 0) + 1; });
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ collections: (rows || []).map(c => ({ ...c, count: counts[c.id] || 0 })) }));
    return;
  }

  if (url.pathname === '/api/collections' && req.method === 'GET') {
    cors(res);
    const me = await requireUser(req, res); if (!me) return;
    const { data: rows } = await supabase.from('collections').select('id, title, description, visibility, created_at').eq('owner_id', me.id).order('created_at', { ascending: false }).limit(100);
    const ids = (rows || []).map(c => c.id);
    const counts = {};
    const has = {};
    const gameId = String(url.searchParams.get('game_id') || '');
    if (ids.length) {
      const q = supabase.from('collection_items').select('collection_id').in('collection_id', ids);
      if (gameId) q.eq('game_id', gameId);
      const { data: items } = await q;
      (items || []).forEach(i => {
        counts[i.collection_id] = (counts[i.collection_id] || 0) + 1;
        if (gameId) has[i.collection_id] = true;
      });
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ collections: (rows || []).map(c => ({ ...c, count: counts[c.id] || 0, has_game: !!has[c.id] })) }));
    return;
  }
  if (url.pathname === '/api/collections' && req.method === 'POST') {
    cors(res);
    const user = await requireUser(req, res); if (!user) return;
    if (!(await seatAlive(user.id, seatFromReq(req)))) { seatDead(res); return; }
    if (!(await needVerified(user, res))) return;
    const body = await readBody(req).catch(() => ({}));
    const title = String(body.title || '').trim().substring(0, 80);
    if (!title) { res.writeHead(400, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'Name your collection.' })); return; }
    const visibility = ['public', 'unlisted', 'private'].includes(body.visibility) ? body.visibility : 'public';
    const { data, error } = await supabase.from('collections').insert({ owner_id: user.id, title, description: String(body.description || '').substring(0, 500), visibility }).select('id, title, description, visibility, created_at').single();
    if (error) { res.writeHead(500, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'Could not create.' })); return; }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ collection: { ...data, count: 0 } }));
    return;
  }
  const collMatch = url.pathname.match(/^\/api\/collections\/([^/]+)(?:\/items(?:\/([^/]+))?)?$/);
  if (collMatch && req.method === 'GET') {
    cors(res);
    const cid = collMatch[1];
    const authHeader = req.headers.authorization || '';
    const token = authHeader.replace('Bearer ', '');
    const { data: { user: viewer } } = token ? await supabase.auth.getUser(token) : { data: { user: null } };
    const { data: c } = await supabase.from('collections').select('*').eq('id', cid).single();
    if (!c) { res.writeHead(404, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'Not found' })); return; }
    if (c.visibility === 'private' && (!viewer || c.owner_id !== viewer.id)) { res.writeHead(404, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'Not found' })); return; }
    const { data: rows } = await supabase.from('collection_items').select('game_id, position').eq('collection_id', cid).order('position', { ascending: true }).limit(100);
    const gids = (rows || []).map(r => r.game_id);
    let games = [];
    if (gids.length) {
      const { data: gs } = await supabase.from('games').select('id, title, slug, play_count, thumbnail, published').in('id', gids);
      const byId = {};
      (gs || []).forEach(g => { byId[g.id] = g; });
      games = (rows || []).map(r => byId[r.game_id]).filter(Boolean);
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ collection: c, games, owner_view: !!(viewer && c.owner_id === viewer.id) }));
    return;
  }
  if (collMatch && !collMatch[2] && (req.method === 'PATCH' || req.method === 'DELETE')) {
    cors(res);
    const user = await requireUser(req, res); if (!user) return;
    const cid = collMatch[1];
    const { data: c } = await supabase.from('collections').select('owner_id').eq('id', cid).single();
    if (!c || c.owner_id !== user.id) { res.writeHead(404, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'Not found' })); return; }
    if (req.method === 'DELETE') {
      await supabase.from('collections').delete().eq('id', cid);
      res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ ok: true })); return;
    }
    const body = await readBody(req).catch(() => ({}));
    const updates = { updated_at: new Date().toISOString() };
    if (body.title !== undefined) { const t = String(body.title || '').trim().substring(0, 80); if (!t) { res.writeHead(400, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'Name your collection.' })); return; } updates.title = t; }
    if (body.description !== undefined) updates.description = String(body.description || '').substring(0, 500);
    if (body.visibility !== undefined) updates.visibility = ['public', 'unlisted', 'private'].includes(body.visibility) ? body.visibility : 'public';
    const { data, error } = await supabase.from('collections').update(updates).eq('id', cid).select('*').single();
    if (error) { res.writeHead(500, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'Could not save.' })); return; }
    res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ collection: data }));
    return;
  }
  if (collMatch && collMatch[2] && (req.method === 'POST' || req.method === 'DELETE')) {
    cors(res);
    const user = await requireUser(req, res); if (!user) return;
    const cid = collMatch[1], gid = collMatch[2];
    const { data: c } = await supabase.from('collections').select('owner_id').eq('id', cid).single();
    if (!c || c.owner_id !== user.id) { res.writeHead(404, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'Not found' })); return; }
    if (req.method === 'POST') {
      const { data: g } = await supabase.from('games').select('id').eq('id', gid).eq('published', true).single();
      if (!g) { res.writeHead(404, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'Game not found.' })); return; }
      const { data: existing } = await supabase.from('collection_items').select('position').eq('collection_id', cid).order('position', { ascending: false }).limit(1);
      const pos = (existing && existing[0] ? existing[0].position : -1) + 1;
      await supabase.from('collection_items').upsert({ collection_id: cid, game_id: gid, position: pos }, { onConflict: 'collection_id,game_id' });
    } else {
      await supabase.from('collection_items').delete().eq('collection_id', cid).eq('game_id', gid);
    }
    res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ ok: true }));
    return;
  }

  // ── API: notifications ──────────────────────────────────────────
  // ── API: ops status (moderators only) ───────────────────────────
  // One dashboard call, so the page never fires ten little requests. Counts
  // are head requests (no rows cross the wire); anything missing (an
  // un-run migration) reports 0 instead of failing the whole payload.
  if (url.pathname === '/api/ops/status' && req.method === 'GET') {
    cors(res);
    const user = await userOf(req);
    if (!user) { res.writeHead(401, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'Sign in first.' })); return; }
    if (!(await isModerator(user.id))) {
      res.writeHead(403, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Ops is moderators only.' }));
      return;
    }
    const count = async (table, build) => {
      try {
        let q = supabase.from(table).select('id', { count: 'exact', head: true });
        if (build) q = build(q);
        const { count: n, error } = await q;
        return error ? 0 : (n || 0);
      } catch (e) { return 0; }
    };
    const t0 = Date.now();
    const { error: dbErr } = await supabase.from('users').select('id', { head: true, count: 'exact' }).limit(1);
    const dbMs = Date.now() - t0;
    const mem = process.memoryUsage();
    const [users, games, published, threads, revisions, apiKeys, pushSubs, inbox] = await Promise.all([
      count('users'),
      count('games'),
      count('games', (q) => q.eq('published', true)),
      count('forum_threads'),
      count('project_revisions'),
      count('api_keys'),
      count('push_subscriptions'),
      count('notifications')
    ]);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      ok: !dbErr,
      uptime_s: Math.round(process.uptime()),
      node: process.version,
      memory: { rss: mem.rss, heapUsed: mem.heapUsed },
      sockets: wss ? wss.clients.size : 0,
      rate_buckets: rateBuckets.size,
      db_ok: !dbErr,
      db_ms: dbMs,
      counts: {
        users, games, published, threads, revisions,
        api_keys: apiKeys, push_subscriptions: pushSubs, notifications: inbox
      }
    }));
    return;
  }

  // ── API: web push (config / subscribe / unsubscribe / test) ─────
  if (url.pathname === '/api/push/config' && req.method === 'GET') {
    cors(res);
    const keys = await vapidKeys();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ enabled: !!keys, key: keys ? keys.public_key : '' }));
    return;
  }
  if (url.pathname === '/api/push/subscribe' && req.method === 'POST') {
    cors(res);
    const user = await requireUser(req, res); if (!user) return;
    const body = await readBody(req).catch(() => ({}));
    const sub = body && typeof body.subscription === 'object' && body.subscription ? body.subscription : {};
    const endpoint = String(sub.endpoint || '').slice(0, 900);
    const p256dh = String((sub.keys && sub.keys.p256dh) || '').slice(0, 200);
    const auth = String((sub.keys && sub.keys.auth) || '').slice(0, 200);
    if (!/^https:\/\//.test(endpoint) || !p256dh || !auth) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'A push subscription needs an https endpoint and both keys.' }));
      return;
    }
    const now = new Date().toISOString();
    const { error } = await supabase.from('push_subscriptions').upsert({
      user_id: user.id, endpoint, p256dh, auth,
      ua: String(req.headers['user-agent'] || '').slice(0, 200), last_seen: now
    }, { onConflict: 'endpoint' });
    if (error) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Could not save that subscription.' }));
      return;
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true }));
    return;
  }
  if (url.pathname === '/api/push/unsubscribe' && req.method === 'POST') {
    cors(res);
    const user = await requireUser(req, res); if (!user) return;
    const body = await readBody(req).catch(() => ({}));
    const endpoint = String((body && body.endpoint) || '').slice(0, 900);
    if (endpoint) await supabase.from('push_subscriptions').delete().eq('user_id', user.id).eq('endpoint', endpoint);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true }));
    return;
  }
  if (url.pathname === '/api/push/test' && req.method === 'POST') {
    cors(res);
    const user = await requireUser(req, res); if (!user) return;
    if (!rateLimit('pushtest:' + user.id, 3, 3600000)) {
      res.writeHead(429, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Three test pushes an hour is plenty.' }));
      return;
    }
    const sent = await sendPush(user.id, 'Cudic push test', 'If you can read this, notifications reach this device.');
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, devices: sent }));
    return;
  }

  // ── API: activity stream ────────────────────────────────────────
  // Public: it only ever contains lines like "Published <title>" that the
  // creator already chose to make public.
  if (url.pathname === '/api/activity' && req.method === 'GET') {
    cors(res);
    const limit = Math.min(50, Math.max(1, parseInt(String(url.searchParams.get('limit') || '20'), 10) || 20));
    const { data: rows } = await supabase.from('activity')
      .select('id, user_id, kind, text, created_at')
      .order('created_at', { ascending: false }).limit(limit);
    const list = rows || [];
    const ids = [...new Set(list.map(r => r.user_id).filter(Boolean))];
    let people = {};
    if (ids.length) {
      const { data: users } = await supabase.from('users').select('id, display_name, avatar_url').in('id', ids);
      for (const u of users || []) people[u.id] = { display_name: u.display_name, avatar_url: u.avatar_url };
    }
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=15' });
    res.end(JSON.stringify({
      activity: list.map(r => ({
        id: r.id, kind: r.kind, text: r.text, created_at: r.created_at,
        user: people[r.user_id] || null
      }))
    }));
    return;
  }

  if (url.pathname === '/api/notifications' && req.method === 'GET') {
    cors(res);
    const user = await requireUser(req, res); if (!user) return;
    const { data: rows, error } = await supabase.from('notifications').select('*').eq('user_id', user.id).order('created_at', { ascending: false }).limit(50);
    const unread = (rows || []).filter(n => !n.read_at).length;
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ notifications: rows || [], unread }));
    return;
  }
  if (url.pathname === '/api/notifications/read' && req.method === 'POST') {
    cors(res);
    const user = await requireUser(req, res); if (!user) return;
    const body = await readBody(req).catch(() => ({}));
    const now = new Date().toISOString();
    if (body.id) {
      await supabase.from('notifications').update({ read_at: now }).eq('id', String(body.id)).eq('user_id', user.id);
    } else {
      await supabase.from('notifications').update({ read_at: now }).eq('user_id', user.id).is('read_at', null);
    }
    res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ ok: true }));
    return;
  }

  // ── API: project revision history (owner only) ──────────────────
  // POST /api/games/:id/revisions — snapshot {label}
  // GET  /api/games/:id/revisions — list (id, label, created_at)
  // GET  /api/games/:id/revisions/:revId — full snapshot
  // POST /api/games/:id/revisions/:revId/restore — restore files
  // Snapshots are content-addressed now: `manifest` maps path → blob hash and
  // each unique file body lives once in revision_blobs. Legacy rows still
  // carry `files`, so both shapes hydrate to the same map for clients.

  // ── Releases ─────────────────────────────────────────────────────
  // Publishing used to be a boolean on the live row, so every save changed what
  // players got and there was no way to say what version they played. A publish
  // now snapshots the files into project_revisions labeled `release vN`, with a
  // synthetic _release.json carrying the notes and source. The play page serves
  // that snapshot; the row keeps being the working draft. No schema change.













  // ── API: update display name ───────────────────────────────────
  if (url.pathname === '/api/profile' && req.method === 'PUT') {
    cors(res);
    const authHeader = req.headers.authorization || '';
    const token = authHeader.replace('Bearer ', '');
    if (!token) { res.writeHead(401); res.end(); return; }

    const { data: { user }, error: authErr } = await supabase.auth.getUser(token);
    if (authErr || !user) { res.writeHead(401); res.end(); return; }
    if (!(await needVerified(user, res))) return;

    try {
      const parsed = await readBody(req, 64 * 1024);
      const { display_name, avatar_url, bio, interests, theme, pack_slug } = parsed;
        var updates = {};
        if (bio !== undefined) {
          // Plain text, trimmed and length-capped. Rendered as textContent
          // everywhere, so this is display-only.
          updates.bio = String(bio || '').replace(/\s+/g, ' ').trim().substring(0, 200);
        }
        if (interests !== undefined) {
          const list = (Array.isArray(interests) ? interests : [])
            .map((t) => String(t).toLowerCase().trim().replace(/[^a-z0-9-]/g, '').slice(0, 24))
            .filter(Boolean);
          updates.interests = [...new Set(list)].slice(0, 10);
        }
        if (display_name !== undefined) {
          if (!display_name || display_name.trim().length < 1) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Display name required' }));
            return;
          }
          updates.display_name = display_name.trim().substring(0, 24);
        }
        if (avatar_url !== undefined) {
          const a = String(avatar_url || '').trim().substring(0, 500);
          if (a) {
            // Only our own avatars bucket: no hotlinking, no data URLs in the row.
            const prefix = (process.env.SUPABASE_URL || '') + '/storage/v1/object/public/avatars/';
            if (!a.startsWith(prefix)) {
              res.writeHead(400, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ error: 'Invalid avatar URL.' }));
              return;
            }
            // No quote/markup chars past the bucket prefix: avatar_url gets
            // interpolated into <img src="…"> attributes on other users'
            // pages, so a stray quote would be stored XSS.
            if (/[<>"'\\]/.test(a.slice(prefix.length))) {
              res.writeHead(400, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ error: 'Invalid avatar URL.' }));
              return;
            }
            updates.avatar_url = a;
          } else {
            updates.avatar_url = null;
          }
        }
        if (theme !== undefined && (theme === 'light' || theme === 'dark')) {
          updates.theme = theme;
        }
        if (pack_slug !== undefined) {
          updates.pack_slug = (typeof pack_slug === 'string' && pack_slug.trim())
            ? pack_slug.trim().substring(0, 64)
            : null;
        }
        // Equipped awards: caps are 5 badges / 10 flairs / 2 titles, every
        // code must exist, match its slot, and be owned. Fails closed.
        if (parsed.equips !== undefined) {
          const in_ = parsed.equips && typeof parsed.equips === 'object' ? parsed.equips : {};
          const owned = await ownedEquipCodes(user.id);
          // Start from what is already worn so the cosmetics slots (fr/bn/ef/
          // ne/em), which this endpoint doesn't touch, survive an award toggle.
          const { data: prev } = await supabase.from('users').select('equips').eq('id', user.id).single();
          const before = (prev && prev.equips && typeof prev.equips === 'object') ? prev.equips : {};
          const eq = { b: [], f: [], t: [] };
          for (const k of ['fr', 'bn', 'ef', 'ne', 'em']) {
            eq[k] = typeof before[k] === 'string' ? before[k] : null;
          }
          let bad = null;
          for (const slot of ['b', 'f', 't']) {
            const list = Array.isArray(in_[slot]) ? in_[slot] : [];
            const seen = new Set();
            for (const raw of list) {
              const code = String(raw || '').trim();
              const a = AWARDS[code];
              const bought = COSMETIC_BY_CODE.get(code);
              // Titles can be earned (AWARDS) or bought (shop) — both live in
              // the `t` array, so accept either as long as the slot matches.
              const kindOk = a ? EQ_KIND[slot] === a.kind
                : !!(slot === 't' && bought && bought.slot === 'ti');
              if (!kindOk) { bad = 'Unknown ' + EQ_KIND[slot] + ' code.'; break; }
              if (!owned.has(code)) { bad = 'Not yours to equip.'; break; }
              if (seen.has(code)) continue;
              seen.add(code);
              eq[slot].push(code);
            }
            if (bad) break;
            if (eq[slot].length > EQUIP_CAPS[slot]) {
              bad = 'You can equip ' + EQUIP_CAPS[slot] + ' ' +
                (slot === 'b' ? 'badges' : slot === 'f' ? 'flairs' : 'titles') + ' at once.';
              break;
            }
          }
          if (bad) {
            res.writeHead(403, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: bad }));
            return;
          }
          updates.equips = eq;
        }
        // Onboarding completion is one-way: the welcome wizard flips it
        // true, and nothing flips it back.
        if (parsed.setup_done === true) updates.setup_done = true;
        if (!Object.keys(updates).length) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Nothing to update.' }));
          return;
        }
        const { error: updErr } = await supabase
          .from('users')
          .update(updates)
          .eq('id', user.id);
        if (updErr) throw updErr;
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(Object.assign({ ok: true }, updates)));
    } catch (e) {
      console.error('profile update error:', (e && e.message) || e);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Could not update the profile.' }));
    }
    return;
  }

  // ── API: export my account data ─────────────────────────────────
  // GDPR / UK GDPR right of access and portability without an inbox
  // round-trip: everything keyed to this account as one JSON file. A table
  // that is missing (unmigrated clone) is skipped and named in `omitted` — an
  // export must never 500 because a migration lags behind the code.
  if (url.pathname === '/api/account/export' && req.method === 'GET') {
    cors(res);
    const user = await requireUser(req, res); if (!user) return;
    const uid = user.id;
    const out = {};
    const omitted = [];
    const dump = async (name, build) => {
      try {
        const { data, error } = await build();
        if (error) { omitted.push(name); return; }
        out[name] = data == null ? [] : data;
      } catch { omitted.push(name); }
    };
    await dump('profile', () => supabase.from('users').select('*').eq('id', uid).maybeSingle());
    await dump('games', () => supabase.from('games').select('id, title, description, scene, files, tags, published, created_at, updated_at, play_count, forked_from, forked_from_title').eq('owner_id', uid).order('created_at'));
    await dump('theme_packs', () => supabase.from('theme_packs').select('id, slug, name, description, manifest, price, published, downloads, created_at, updated_at').eq('owner_id', uid).order('created_at'));
    await dump('messages', () => supabase.from('messages').select('id, lobby_id, text, created_at').eq('user_id', uid).order('created_at', { ascending: false }).limit(5000));
    await dump('forum_threads', () => supabase.from('forum_threads').select('id, title, body, category, created_at, last_at').eq('user_id', uid).order('created_at'));
    await dump('forum_comments', () => supabase.from('forum_comments').select('id, thread_id, body, created_at').eq('user_id', uid).order('created_at'));
    await dump('game_comments', () => supabase.from('game_comments').select('id, game_id, body, created_at').eq('user_id', uid).order('created_at'));
    await dump('creator_comments', () => supabase.from('creator_comments').select('id, body, created_at').eq('author_id', uid).order('created_at'));
    await dump('game_ratings', () => supabase.from('game_ratings').select('game_id, rating, created_at').eq('user_id', uid));
    await dump('game_likes', () => supabase.from('game_likes').select('game_id, created_at').eq('user_id', uid));
    await dump('game_saves', () => supabase.from('game_saves').select('game_id, state, updated_at').eq('user_id', uid));
    await dump('collections', () => supabase.from('collections').select('id, name, description, created_at').eq('owner_id', uid).order('created_at'));
    await dump('notifications', () => supabase.from('notifications').select('id, kind, body, created_at, read_at').eq('user_id', uid).order('created_at', { ascending: false }).limit(2000));
    await dump('follows', () => supabase.from('follows').select('followed_id, created_at').eq('follower_id', uid));
    await dump('badges', () => supabase.from('user_badges').select('code, created_at').eq('user_id', uid));
    await dump('achievements', () => supabase.from('game_achievements').select('code, awarded_at, game_id').eq('user_id', uid).order('awarded_at', { ascending: false }));
    await dump('coins', () => supabase.from('coin_ledger').select('id, amount, reason, created_at').eq('user_id', uid).order('created_at'));
    const body = JSON.stringify({ exported_at: new Date().toISOString(), user_id: uid, omitted, data: out }, null, 2);
    res.writeHead(200, {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Disposition': 'attachment; filename="cudic-account-export.json"',
      'Cache-Control': 'no-store',
    });
    res.end(body);
    return;
  }

  // ── API: delete my account ─────────────────────────────────────
  // Auth user delete cascades to public.users and owned rows (same path
  // as the unconfirmed-account purge). Storage cleanup is best-effort:
  // orphans cost nothing but space, and a failed delete must never trap
  // someone in an account they want gone.
  if (url.pathname === '/api/account' && req.method === 'DELETE') {
    cors(res);
    const user = await requireUser(req, res); if (!user) return;
    if (!(await seatAlive(user.id, seatFromReq(req)))) { seatDead(res); return; }
    // Bot gate after auth: anonymous callers still get 401, never a hint
    // that their account question is even reachable. Token rides a header
    // because DELETE has no body.
    if (!(await turnstileOk(req, {}))) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Bot check failed. Reload the page and try again.', code: 'turnstile' }));
      return;
    }
    try {
      const { data: prof } = await supabase.from('users').select('user_id').eq('id', user.id).single();
      const { data: games } = await supabase.from('games').select('id').eq('owner_id', user.id).limit(200);
      const bucket = supabase.storage.from('game-assets');
      for (const g of games || []) {
        try {
          const paths = [];
          async function walk(prefix) {
            const { data: entries } = await bucket.list(prefix, { limit: 1000 });
            for (const e of entries || []) {
              const p = prefix ? prefix + '/' + e.name : e.name;
              if (e.metadata) paths.push(p);
              else await walk(p);
            }
          }
          await walk(g.id);
          if (paths.length) await bucket.remove(paths);
        } catch {}
      }
      if (prof && prof.user_id) {
        try { await supabase.storage.from('avatars').remove([prof.user_id + '/avatar.jpg']); } catch {}
      }
    } catch {}
    const { error: delErr } = await supabase.auth.admin.deleteUser(user.id);
    if (delErr) { res.writeHead(500, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'Delete failed.' })); return; }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true }));
    return;
  }

  // ── API: get message history ───────────────────────────────────
  // ── messages routes: lib/routes/messages.js ─────────────────────────
  if (messageRoutes && messageRoutes.matches(url.pathname)) {
    await messageRoutes.handle(req, res, url);
    if (res.headersSent) return;
  }

  // ── Servers API ──────────────────────────────────────────────

  // List servers: public + owned/private where member
  // ── servers routes: lib/routes/servers.js ─────────────────────────
  if (serverRoutes && serverRoutes.matches(url.pathname)) {
    await serverRoutes.handle(req, res, url);
    if (res.headersSent) return;
  }

  // ── API: single-seat session claim / heartbeat / release ────
  // Claim always succeeds (it IS the takeover). Heartbeat doubles as a
  // claim refresh. Release deletes only the matching seat, best effort.
  if (url.pathname === '/api/session/claim' && req.method === 'POST') {
    cors(res);
    const user = await requireUser(req, res); if (!user) return;
    const body = await readBody(req).catch(() => ({}));
    const seat = String(body.seat || '').substring(0, 64);
    if (!seat) { res.writeHead(400, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'Missing seat.' })); return; }
    await claimSeatRow(user.id, seat);
    // Streak counts on claim too: a quick tab-then-close still counts as a day.
    try { await rollStreak(user.id); } catch {}
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true }));
    return;
  }
  if (url.pathname === '/api/session/heartbeat' && req.method === 'POST') {
    cors(res);
    const user = await requireUser(req, res); if (!user) return;
    const body = await readBody(req).catch(() => ({}));
    const seat = String(body.seat || '').substring(0, 64);
    if (!seat) { res.writeHead(400, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'Missing seat.' })); return; }
    // Unlike claim, heartbeat never takes over: if a different fresh seat
    // holds the row, this tab lost — tell it so it pauses instead of
    // fighting a silent takeover war one beat at a time.
    if (!(await seatAlive(user.id, seat))) { seatDead(res); return; }
    await claimSeatRow(user.id, seat);
    // Daily streak: riding the beats that already exist means no extra
    // client work and no new endpoint.
    try { await rollStreak(user.id); } catch {}
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true }));
    return;
  }
  if (url.pathname === '/api/session' && req.method === 'DELETE') {
    cors(res);
    const user = await requireUser(req, res); if (!user) return;
    const body = await readBody(req).catch(() => ({}));
    const seat = String(body.seat || '').substring(0, 64);
    if (seat) await supabase.from('active_sessions').delete().eq('user_id', user.id).eq('seat_id', seat);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true }));
    return;
  }

  // ── Chat rebuild: conversations, DMs, friends, channels ─────────
  // Every endpoint here requires a signed-in user. The WS layer below
  // enforces the same membership rules on join.

  // ── Account auth for browser sessions AND API keys ──────────────────
  // Browsers send a Supabase JWT. Agents (CLI, MCP, scripts) send a scoped
  // `cudic_...` key instead; it is hashed at rest in api_keys and resolved to
  // the owning account here, so every route that calls userOf() works for
  // both without a second code path.


  // Browser sessions keep full access; a key only gets what it was granted.



  // ── API keys: list / create / revoke (browser session only) ─────────
  // A key is shown once and stored as sha256. Keys can never mint keys.
  if (url.pathname === '/api/keys' && req.method === 'GET') {
    cors(res);
    const user = await requireUser(req, res); if (!user) return;
    const { data } = await supabase.from('api_keys')
      .select('id, label, scopes, created_at, last_used_at, revoked_at')
      .eq('user_id', user.id).order('created_at', { ascending: false });
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ keys: data || [] }));
    return;
  }
  if (url.pathname === '/api/keys' && req.method === 'POST') {
    cors(res);
    const user = await requireUser(req, res); if (!user) return;
    if (!(await needVerified(user, res))) return;
    const body = await readBody(req, 8 * 1024).catch(() => ({}));
    const label = String(body.label || '').trim().slice(0, 40) || 'agent key';
    const allowed = ['projects:read', 'projects:write', 'profile:read'];
    const asked = Array.isArray(body.scopes) ? body.scopes.map(String) : [];
    const picked = [...new Set(asked.filter((s) => allowed.includes(s)))];
    const scopes = picked.length ? picked : allowed.slice();
    const { count } = await supabase.from('api_keys').select('id', { count: 'exact', head: true })
      .eq('user_id', user.id).is('revoked_at', null);
    if ((count || 0) >= 12) {
      res.writeHead(429, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Too many active keys (12 max). Revoke one first.' }));
      return;
    }
    const raw = 'cudic_' + crypto.randomBytes(24).toString('base64url');
    const { data, error } = await supabase.from('api_keys').insert({
      user_id: user.id,
      label,
      scopes,
      key_hash: crypto.createHash('sha256').update(raw).digest('hex'),
      key_preview: raw.slice(0, 12) + '…',
    }).select('id, label, scopes, created_at').single();
    if (error) {
      const msg = String(error.message || '');
      const missing = /does not exist|Could not find the table/i.test(msg)
        || String(error.code || '') === '42P01' || String(error.code || '') === 'PGRST205';
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: missing ? 'API keys are not set up yet (run migration/api_keys.sql).' : 'Could not create the key.' }));
      return;
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ key: raw, ...data, note: 'Copy it now — it is not shown again.' }));
    return;
  }
  const keyDel = /^\/api\/keys\/([^/]+)$/.exec(url.pathname);
  if (keyDel && req.method === 'DELETE') {
    cors(res);
    const user = await requireUser(req, res); if (!user) return;
    await supabase.from('api_keys').update({ revoked_at: new Date().toISOString() })
      .eq('id', keyDel[1]).eq('user_id', user.id);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true }));
    return;
  }

function slugify(s) {
  return String(s || '').toLowerCase()
    .normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'game';
}

// Public game URLs are /g/<slug>, but titles are not unique: two games called
// "Untitled Project" both slugify to "untitled-project" and one of them becomes
// unreachable. Claim the first free slug — appending -2, -3 … — instead.


// Game tags: lowercased, letters/numbers/dashes only, deduped, capped.
// One column on `games`, so the gallery can filter and the "More like
// this" shelf can match without a join. Shared by POST (create) and PUT
// (edit) so the two can never drift apart.


  // ── API: my conversations (chat sidebar) ───────────────────────
  // ── chat routes: lib/routes/chat.js ─────────────────────────
  if (chatRoutes && chatRoutes.matches(url.pathname)) {
    await chatRoutes.handle(req, res, url);
    if (res.headersSent) return;
  }

  // ── API: follow a creator ──────────────────────────────────────
  // One-way, no approval: the poster always decides who they see.
  const followMatch = /^\/api\/follow\/([^/]+)$/.exec(url.pathname);
  if (followMatch && req.method === 'POST') {
    cors(res);
    const user = await requireUser(req, res); if (!user) return;
    if (!(await needVerified(user, res))) return;
    if (!rateLimit('follow:' + user.id, 30, 3600000)) { res.writeHead(429, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'Slow down — 30 follows an hour max.' })); return; }
    const targetId = followMatch[1];
    if (!isUuid(targetId) || targetId === user.id) { res.writeHead(400, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'Invalid user.' })); return; }
    const { data: target } = await supabase.from('users').select('id').eq('id', targetId).single();
    if (!target) { res.writeHead(404, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'User not found.' })); return; }
    // A repeat insert fails on the (follower, followed) key — already following.
    await supabase.from('follows').insert({ follower_id: user.id, followed_id: targetId });
    const { data: fn } = await supabase.from('users').select('display_name').eq('id', user.id).single();
    notify(targetId, 'follow', (fn ? fn.display_name : 'Someone') + ' started following you', '', 'user', user.id);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ following: true }));
    return;
  }
  if (followMatch && req.method === 'DELETE') {
    cors(res);
    const user = await requireUser(req, res); if (!user) return;
    const targetId = followMatch[1];
    if (!isUuid(targetId)) { res.writeHead(400, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'Invalid user.' })); return; }
    await supabase.from('follows').delete().eq('follower_id', user.id).eq('followed_id', targetId);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ following: false }));
    return;
  }

  // ── API: activity feed (mine + everyone I follow) ──────────────
  if (url.pathname === '/api/feed' && req.method === 'GET') {
    cors(res);
    const user = await requireUser(req, res); if (!user) return;
    const { data: outs } = await supabase.from('follows').select('followed_id').eq('follower_id', user.id);
    const ids = [user.id, ...((outs || []).map(r => r.followed_id))];
    const { data: feed } = await supabase.from('activity')
      .select('id, user_id, kind, text, created_at, users!activity_user_fk(display_name, avatar_url, user_id)')
      .in('user_id', ids)
      .order('created_at', { ascending: false })
      .limit(60);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ feed: feed || [] }));
    return;
  }

  // ── API: award catalog (public — the page needs it to draw any name) ──
  if (url.pathname === '/api/badges' && req.method === 'GET') {
    cors(res);
    res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
    res.end(JSON.stringify({ awards: AWARDS, caps: EQUIP_CAPS }));
    return;
  }


  // ── mod routes: lib/routes/mod.js ─────────────────────────
  if (modRoutes && modRoutes.matches(url.pathname)) {
    await modRoutes.handle(req, res, url);
    if (res.headersSent) return;
  }
























  // ── API: list a server's channels ──────────────────────────────

  // ── API: mark a conversation read ─────────────────────────────

  // ── Virtual coins: balance, quests, daily, trickle ─────────────
  // Play money only (no cash-out). Every movement lands in coin_ledger
  // through the atomic grant/spend RPCs; quest and daily claims check
  // the ledger first, and a partial unique index backs the once-only
  // rule against double-clicks from two tabs.
  var QUESTS = {
    publish_first:     { coins: 100, label: 'Publish your first game' },
    first_dm:          { coins: 25,  label: 'Send your first DM' },
    profile_complete:  { coins: 25,  label: 'Complete your profile' },
    join_first_server: { coins: 25,  label: 'Join your first server' },
    first_friend:      { coins: 25,  label: 'Add your first friend' },
  };
  async function coinBalance(me) {
    const { data } = await supabase.from('users').select('balance').eq('id', me).single();
    return (data && data.balance) || 0;
  }
  async function earnCount(me, reason) {
    const { count } = await supabase.from('coin_ledger').select('id', { count: 'exact', head: true }).eq('user_id', me).eq('reason', reason);
    return count || 0;
  }
  // ── Anti-abuse caps (plan.md 2.3): daily earn/spend limits + purchase
  // velocity, all read from the append-only ledger so no new state can
  // drift. Quests/daily/trickle need no caps — they're fixed-schedule by
  // construction (once-only / once-per-day / 10-per-day). Pack buying is
  // the only open-ended value mover, so caps bite there. Tune in one place.
  var COIN_LIMITS = { dailyEarn: 10000, dailySpend: 1000, buysPerHour: 10 };
  function dayStartIso() { return new Date().toISOString().slice(0, 10) + 'T00:00:00.000Z'; }
  function hourAgoIso() { return new Date(Date.now() - 3600000).toISOString(); }
  async function coinFlow(me, dir, sinceIso) {
    const { data } = await supabase.from('coin_ledger').select('delta').eq('user_id', me).gte('created_at', sinceIso);
    let sum = 0;
    for (const r of data || []) {
      if (dir === 'in' && r.delta > 0) sum += r.delta;
      if (dir === 'out' && r.delta < 0) sum -= r.delta;
    }
    return sum;
  }

  // ── Engagement score for dynamic coin cap ─────────────────────
  // Community actions feed a score that lifts the weekly coin ceiling.
  // Chat must have a reply — "test" one-way messages don't count.
  async function getEngagementScore(uid) {
    let score = 0;
    const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
    // Chat messages with reply verification (last 24h): count message only if another user replied in same lobby within 2 h
    const { data: myMsgs } = await supabase.from('messages').select('id, lobby_id, created_at, user_id').eq('user_id', uid).gte('created_at', since);
    let replyMsgCount = 0;
    if (myMsgs && myMsgs.length) {
      const lobbyIds = [...new Set(myMsgs.map(m => m.lobby_id))];
      const { data: others } = await supabase.from('messages').select('lobby_id, created_at, user_id').in('lobby_id', lobbyIds).neq('user_id', uid).gte('created_at', since);
      for (const m of myMsgs) {
        const replied = (others || []).some(o => o.lobby_id === m.lobby_id && new Date(o.created_at) > new Date(m.created_at) && (new Date(o.created_at) - new Date(m.created_at)) < 2 * 3600 * 1000);
        if (replied) replyMsgCount++;
      }
    }
    score += replyMsgCount * 3;
    // Other interactions from the ledger arechequests completed, ad claims, messages, etc
    const { data: ledger } = await supabase.from('coin_ledger').select('reason, created_at').eq('user_id', uid).order('created_at', { ascending: false }).limit(500);
    const reQuest = /quest:/;
    const reAd = /ad:/;
    for (const r of ledger || []) { if (reQuest.test(r.reason)) score += 5; else if (reAd.test(r.reason)) score += 1; }
    // Servers joined / members invited (seed + current)
    const { data: servers } = await supabase.from('servers').select('id').eq('owner_id', uid);
    const { data: members } = await supabase.from('server_members').select('server_id').in('user_id', [uid]);
    score += servers.length * 4 + members.length * 2;
    // Games played/published
    const { data: games } = await supabase.from('games').select('id').eq('owner_id', uid);
    score += games.length * 3;
    // Friends / DMs (conversation access seeded by friends acceptance)
    const { data: conversations } = await supabase.from('conversation_members').select('lobby_id').eq('user_id', uid);
    const uniqueConvos = new Set((conversations || []).map(function (r) { return r.lobby_id; }));
    score += Math.min(10, uniqueConvos.size * 2);
    return score;
  }

  async function getCoinsMax(uid) {
    const s = await getEngagementScore(uid);
    return 50 + Math.min(200, Math.floor(s / 5) * 10);
  }

  // ── API: coin balance + recent receipts ────────────────────────
  if (url.pathname === '/api/coins' && req.method === 'GET') {
    cors(res);
    const user = await requireUser(req, res); if (!user) return;
    const coinsMax = await getCoinsMax(user.id);
    const { data: rows } = await supabase.from('coin_ledger').select('delta, reason, created_at').eq('user_id', user.id).order('created_at', { ascending: false }).limit(20);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ balance: await coinBalance(user.id), coinsMax, receipts: rows || [] }));
    return;
  }

  // ── API: cosmetics shop (browse · buy · equip) ────────────────
  // Catalogue prices are server-side only; the browser just draws what it
  // is handed. Ownership lives in user_cosmetics, what is worn lives in
  // users.equips (single-value slots fr/bn/ef/ne/em, titles in `t`).
  async function ownedCosmeticSet(uid) {
    try {
      const { data } = await supabase.from('user_cosmetics').select('code').eq('user_id', uid);
      return new Set((data || []).map(r => r.code));
    } catch (e) { return new Set(); }
  }
  async function equipsOf(uid) {
    const { data } = await supabase.from('users').select('equips').eq('id', uid).single();
    const raw = (data && data.equips && typeof data.equips === 'object') ? data.equips : {};
    return {
      b: Array.isArray(raw.b) ? raw.b : [],
      f: Array.isArray(raw.f) ? raw.f : [],
      t: Array.isArray(raw.t) ? raw.t : [],
      fr: typeof raw.fr === 'string' ? raw.fr : null,
      bn: typeof raw.bn === 'string' ? raw.bn : null,
      ef: typeof raw.ef === 'string' ? raw.ef : null,
      ne: typeof raw.ne === 'string' ? raw.ne : null,
      em: typeof raw.em === 'string' ? raw.em : null,
    };
  }
  if (url.pathname === '/api/cosmetics' && req.method === 'GET') {
    cors(res);
    const user = await requireUser(req, res); if (!user) return;
    const [owned, worn, balance] = await Promise.all([
      ownedCosmeticSet(user.id),
      equipsOf(user.id),
      coinBalance(user.id),
    ]);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      catalog: COSMETICS,
      slots: COSMETIC_SLOTS,
      single: Object.keys(COSMETIC_SINGLE),
      owned: [...owned],
      worn,
      balance,
    }));
    return;
  }

  if (url.pathname === '/api/cosmetics/buy' && req.method === 'POST') {
    cors(res);
    const user = await requireUser(req, res); if (!user) return;
    if (!(await needVerified(user, res))) return;
    const body = await readBody(req).catch(() => ({}));
    const item = COSMETIC_BY_CODE.get(String(body.code || '').trim());
    if (!item) { res.writeHead(404, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'Unknown cosmetic.' })); return; }
    const already = await ownedCosmeticSet(user.id);
    if (already.has(item.code)) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, already: true, balance: await coinBalance(user.id) }));
      return;
    }
    // Same anti-farm shape as theme-pack buying: bound daily spend and
    // purchase velocity from the ledger rather than a new counter.
    const spentToday = await coinFlow(user.id, 'out', dayStartIso());
    if (spentToday + item.price > COIN_LIMITS.dailySpend) {
      res.writeHead(429, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Daily spending cap reached — try tomorrow.' }));
      return;
    }
    const { count: recentBuys } = await supabase.from('coin_ledger').select('id', { count: 'exact', head: true })
      .eq('user_id', user.id).eq('reason', 'cosmetic_buy').gte('created_at', hourAgoIso());
    if ((recentBuys || 0) >= COIN_LIMITS.buysPerHour) {
      res.writeHead(429, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Too many purchases — slow down.' }));
      return;
    }
    // Claim first: a second tab hits the primary key and gets "already"
    // instead of being charged twice.
    const { error: ownErr } = await supabase.from('user_cosmetics').insert({ user_id: user.id, code: item.code });
    if (ownErr) {
      const dup = String(ownErr.message || '').includes('duplicate key');
      const missing = String(ownErr.message || '').includes('does not exist') || String(ownErr.code || '') === '42P01';
      res.writeHead(dup ? 200 : 500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(dup
        ? { ok: true, already: true, balance: await coinBalance(user.id) }
        : { error: missing ? 'Shop is not set up yet (cosmetics migration missing).' : 'Buy failed.' }));
      return;
    }
    const { data: balance, error: spendErr } = await supabase.rpc('spend_coins', { p_user: user.id, p_delta: item.price, p_reason: 'cosmetic_buy', p_ref: null });
    if (spendErr) {
      await supabase.from('user_cosmetics').delete().eq('user_id', user.id).eq('code', item.code);
      const short = String(spendErr.message || '').includes('insufficient funds');
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(short
        ? { error: 'Not enough coins.', need: Math.max(0, item.price - (await coinBalance(user.id))) }
        : { error: 'Buy failed.' }));
      return;
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, balance, code: item.code }));
    return;
  }

  if (url.pathname === '/api/cosmetics/equip' && req.method === 'POST') {
    cors(res);
    const user = await requireUser(req, res); if (!user) return;
    const body = await readBody(req).catch(() => ({}));
    const slot = String(body.slot || '');
    if (!COSMETIC_SLOTS[slot]) { res.writeHead(400, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'Unknown slot.' })); return; }
    const raw = body.code == null ? '' : String(body.code).trim();
    const owned = await ownedEquipCodes(user.id);
    const eq = await equipsOf(user.id);

    if (!raw) {
      // Take it off.
      if (slot === 'ti') {
        const worn = resolveCosmetics(eq);
        if (worn.title) eq.t = eq.t.filter(c => c !== worn.title.code);
      } else eq[slot] = null;
    } else {
      const item = COSMETIC_BY_CODE.get(raw);
      const isAwardTitle = slot === 'ti' && AWARDS[raw] && AWARDS[raw].kind === 'title';
      const kindOk = item ? item.slot === slot : isAwardTitle;
      if (!kindOk) { res.writeHead(400, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'That does not fit this slot.' })); return; }
      if (!owned.has(raw)) { res.writeHead(403, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'Not yours to equip.' })); return; }
      if (slot === 'ti') {
        // Titles are a capped list — replace whatever cosmetic title sits
        // there, awards picked on the profile page stay put.
        const prev = resolveCosmetics(eq);
        if (prev.title && prev.title.code !== raw) eq.t = eq.t.filter(c => c !== prev.title.code);
        if (!eq.t.includes(raw)) eq.t.push(raw);
        if (eq.t.length > EQUIP_CAPS.t) {
          res.writeHead(403, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'You can equip ' + EQUIP_CAPS.t + ' titles at once.' }));
          return;
        }
      } else eq[slot] = raw;
    }
    const { error: eqErr } = await supabase.from('users').update({ equips: eq }).eq('id', user.id);
    if (eqErr) { res.writeHead(500, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'Could not save.' })); return; }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, worn: eq, cosmetics: resolveCosmetics(eq) }));
    return;
  }

  // ── API: quest list (done state read from the ledger) ─────────
  if (url.pathname === '/api/quests' && req.method === 'GET') {
    cors(res);
    const user = await requireUser(req, res); if (!user) return;
    const { data: rows } = await supabase.from('coin_ledger').select('reason').eq('user_id', user.id).like('reason', 'quest:%');
    const done = {};
    (rows || []).forEach(r => { done[String(r.reason).slice(6)] = true; });
    const quests = Object.keys(QUESTS).map(k => ({ id: k, label: QUESTS[k].label, coins: QUESTS[k].coins, done: !!done[k] }));
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ quests }));
    return;
  }

  // ── API: claim a quest (verifies the deed, once-only) ─────────
  if (url.pathname === '/api/quests/claim' && req.method === 'POST') {
    cors(res);
    const user = await requireUser(req, res); if (!user) return;
    const me = user.id;
    const body = await readBody(req).catch(() => ({}));
    const q = QUESTS[body && body.quest];
    if (!(await needVerified(user, res))) return;
    if (!q) { res.writeHead(400, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'Unknown quest.' })); return; }
    if (await earnCount(me, 'quest:' + body.quest)) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, already: true, balance: await coinBalance(me) }));
      return;
    }
    var earned = false;
    if (body.quest === 'publish_first') {
      const { count } = await supabase.from('games').select('id', { count: 'exact', head: true }).eq('owner_id', me).eq('published', true);
      earned = (count || 0) > 0;
    } else if (body.quest === 'first_dm') {
      const { data: dmRows } = await supabase.from('conversation_members').select('lobby_id, lobbies!inner(kind)').eq('user_id', me).eq('lobbies.kind', 'dm');
      if (dmRows && dmRows.length) {
        const { count } = await supabase.from('messages').select('id', { count: 'exact', head: true }).eq('user_id', me).in('lobby_id', dmRows.map(r => r.lobby_id));
        earned = (count || 0) > 0;
      }
    } else if (body.quest === 'profile_complete') {
      const { data: prof } = await supabase.from('users').select('display_name, avatar_url').eq('id', me).single();
      earned = !!(prof && prof.display_name && prof.avatar_url);
    } else if (body.quest === 'join_first_server') {
      const { count: m } = await supabase.from('server_members').select('server_id', { count: 'exact', head: true }).eq('user_id', me);
      const { count: o } = await supabase.from('servers').select('id', { count: 'exact', head: true }).eq('owner_id', me);
      earned = ((m || 0) + (o || 0)) > 0;
    } else if (body.quest === 'first_friend') {
      const { count } = await supabase.from('friendships').select('user_id', { count: 'exact', head: true }).eq('status', 'accepted').or('user_id.eq.' + me + ',friend_id.eq.' + me);
      earned = (count || 0) > 0;
    }
    if (!earned) { res.writeHead(400, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'Quest not completed yet.' })); return; }
    try {
      const { data: bal, error } = await supabase.rpc('grant_coins', { p_user: me, p_delta: q.coins, p_reason: 'quest:' + body.quest, p_ref: null });
      if (error) throw error;
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, balance: bal }));
    } catch (e) {
      if (String((e && e.message) || '').includes('duplicate key')) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, already: true, balance: await coinBalance(me) }));
        return;
      }
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Claim failed.' }));
    }
    return;
  }

  // ── API: daily login claim (10 coins, once per UTC day) ────────
  if (url.pathname === '/api/daily/claim' && req.method === 'POST') {
    cors(res);
    const user = await requireUser(req, res); if (!user) return;
    const me = user.id;
    const reason = 'daily:' + new Date().toISOString().slice(0, 10);
    if (!(await needVerified(user, res))) return;
    if (await earnCount(me, reason)) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, already: true, balance: await coinBalance(me) }));
      return;
    }
    try {
      const { data: bal, error } = await supabase.rpc('grant_coins', { p_user: me, p_delta: 10, p_reason: reason, p_ref: null });
      if (error) throw error;
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, balance: bal }));
    } catch (e) {
      if (String((e && e.message) || '').includes('duplicate key')) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, already: true, balance: await coinBalance(me) }));
        return;
      }
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Claim failed.' }));
    }
    return;
  }

  // ── Rewarded ads: 10 slots / 50 coins per UTC week ─────────────
  // The ad network's completion callback is client-side, so the grant is
  // best-effort gated: a server nonce per watch, a minimum elapsed time,
  // one claim per nonce, and the week's ledger rows. Swap the elapsed
  // check for AppLixir's server-to-server webhook when the live key ships.
  var AD_CAP = { slotsPerWeek: 10, coinsPerWeek: 50 };
  var AD_TIERS = [[45, 75], [30, 40], [15, 20]]; // [min seconds watched, coins] — min 75/coin
  function adWeekStart() {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7)); // Monday
    return d.toISOString().slice(0, 10) + 'T00:00:00.000Z';
  }
  function adTier(seconds) { for (const [s, c] of AD_TIERS) if (seconds >= s) return c; return 0; }
  async function adWeek(me) {
    const { data } = await supabase.from('coin_ledger').select('delta').eq('user_id', me).like('reason', 'ad:%').gte('created_at', adWeekStart());
    let coins = 0, slots = 0;
    for (const r of data || []) { slots++; coins += Math.max(0, r.delta || 0); }
    return { slots, coins };
  }
  function adState(w, extra) {
    return Object.assign({
      slots: w.slots, slotsMax: AD_CAP.slotsPerWeek,
      coins: w.coins, coinsMax: AD_CAP.coinsPerWeek,
      tiers: AD_TIERS.map(t => ({ seconds: t[0], coins: t[1] })),
    }, extra || {});
  }

  // ── API: ad status + dynamic cap ───────────────────────────────
  if (url.pathname === '/api/ads/status' && req.method === 'GET') {
    cors(res);
    const user = await requireUser(req, res); if (!user) return;
    const coinsMax = await getCoinsMax(user.id);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(adState(await adWeek(user.id), { coinsMax })));
    return;
  }

  if (url.pathname === '/api/ads/start' && req.method === 'POST') {
    cors(res);
    const user = await requireUser(req, res); if (!user) return;
    if (!(await needVerified(user, res))) return;
    if (!rateLimit('ads:' + user.id, 30, 3600000)) {
      res.writeHead(429, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Too many ad sessions. Try again later.' }));
      return;
    }
    const w = await adWeek(user.id);
    const coinsMax = await getCoinsMax(user.id);
    if (w.slots >= AD_CAP.slotsPerWeek || w.coins >= coinsMax) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(adState(w, { capped: true, coinsMax })));
      return;
    }
    const now = Date.now();
    for (const [k, v] of adNonces) if (now - v.at > 900000) adNonces.delete(k);
    const nonce = crypto.randomUUID();
    adNonces.set(nonce, { user: user.id, at: now });
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(adState(w, { nonce, coinsMax })));
    return;
  }

  if (url.pathname === '/api/ads/claim' && req.method === 'POST') {
    cors(res);
    const user = await requireUser(req, res); if (!user) return;
    const body = await readBody(req).catch(() => ({}));
    const nonce = body && typeof body.nonce === 'string' ? body.nonce : '';
    const session = nonce ? adNonces.get(nonce) : null;
    if (!session || session.user !== user.id) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Ad session expired.' }));
      return;
    }
    adNonces.delete(nonce); // consume before any await: one claim per nonce
    const seconds = Math.floor((Date.now() - session.at) / 1000);
    const tier = adTier(seconds);
    const w = await adWeek(user.id);
    if (!tier) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Ad ended too soon — no coins.', seconds, minSeconds: 15 }));
      return;
    }
    const coinsMax = await getCoinsMax(user.id);
    if (w.coins >= coinsMax) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(adState(w, { capped: true, awarded: 0, balance: await coinBalance(user.id), coinsMax })));
      return;
    }
    const awarded = Math.min(tier, Math.max(0, coinsMax - w.coins));
    try {
      const { data: bal, error } = await supabase.rpc('grant_coins', { p_user: user.id, p_delta: awarded, p_reason: 'ad:' + nonce, p_ref: null });
      if (error) throw error;
      const after = { slots: w.slots + 1, coins: w.coins + awarded };
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(adState(after, { awarded, balance: bal, seconds, coinsMax })));
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Reward failed.' }));
    }
    return;
  }

  // ── Community theme packs ─────────────────────────────────────
  // Manifests are pure data (see theme-engine.js): the server validates
  // every field against the engine's allowlists and serves manifests
  // only to entitled users — that gate is the purchase enforcement.
  var PACK_FONTS = ['Satoshi', 'Epilogue', 'Inter', 'Space Grotesk', 'Sora', 'Manrope', 'Outfit', 'DM Sans', 'JetBrains Mono'];
  var PACK_SCENES = ['city-night', 'ember-field'];
  var PACK_COLOR_KEYS = ['ink', 'panel', 'raised', 'line', 'signal', 'tp', 'ts', 'tt'];


  function validatePack(name, description, price, m) {
    if (!name || String(name).trim().length < 2 || String(name).trim().length > 40) return 'Pack name must be 2–40 characters.';
    if (String(description || '').length > 500) return 'Description is too long (500 max).';
    if (!Number.isInteger(price) || price < 0 || price > 100000) return 'Price must be 0–100000 coins.';
    if (!m || typeof m !== 'object' || Array.isArray(m)) return 'Invalid manifest.';
    const top = ['colors', 'fonts', 'background', 'icons', 'motion', 'radius', 'tags', 'sidebar', 'custom'];
    for (const k of Object.keys(m)) if (!top.includes(k)) return 'Unknown manifest section: ' + k + '.';
    const c = m.colors || {};
    if (typeof c !== 'object') return 'Invalid colors.';
    for (const k of Object.keys(c)) {
      if (!PACK_COLOR_KEYS.includes(k)) return 'Unknown color: ' + k + '.';
      if (!/^#[0-9a-fA-F]{6}$/.test(String(c[k]))) return 'Color ' + k + ' must be #rrggbb.';
    }
    if (m.fonts !== undefined) {
      if (!m.fonts || typeof m.fonts !== 'object') return 'Invalid fonts.';
      if (m.fonts.head !== undefined && !PACK_FONTS.includes(m.fonts.head)) return 'Unknown head font.';
      if (m.fonts.body !== undefined && !PACK_FONTS.includes(m.fonts.body)) return 'Unknown body font.';
    }
    if (m.background !== undefined) {
      const bg = m.background;
      if (!bg || typeof bg !== 'object') return 'Invalid background.';
      if (!['none', 'image', 'scene'].includes(bg.type)) return 'Unknown background type.';
      if (bg.type === 'scene' && !PACK_SCENES.includes(bg.scene)) return 'Unknown scene.';
      if (bg.type === 'image' && (typeof bg.src !== 'string' || !bg.src.startsWith('https://') || bg.src.length > 500)) return 'Background image must be an https URL.';
      if (bg.opacity !== undefined && (typeof bg.opacity !== 'number' || bg.opacity < 0 || bg.opacity > 1)) return 'Opacity must be 0–1.';
      if (bg.params !== undefined) {
        if (!bg.params || typeof bg.params !== 'object') return 'Invalid scene params.';
        const ks = Object.keys(bg.params);
        if (ks.length > 8) return 'Too many scene params.';
        for (const k of ks) if (typeof bg.params[k] !== 'number') return 'Scene params must be numbers.';
      }
    }
    if (m.icons !== undefined && !['default', 'neon'].includes(m.icons)) return 'Unknown icon set.';
    if (m.motion !== undefined) {
      if (!m.motion || typeof m.motion !== 'object') return 'Invalid motion.';
      if (m.motion.preset !== undefined && !['calm', 'playful'].includes(m.motion.preset)) return 'Unknown motion preset.';
    }
    if (m.radius !== undefined && (!Number.isInteger(m.radius) || m.radius < 0 || m.radius > 24)) return 'Radius must be 0–24.';
    if (m.tags !== undefined) {
      if (!Array.isArray(m.tags) || m.tags.length > 8) return 'Up to 8 tags.';
      for (const t of m.tags) if (typeof t !== 'string' || !t.trim() || t.length > 24) return 'Tags must be short text.';
    }
    if (m.sidebar !== undefined) {
      if (!m.sidebar || typeof m.sidebar !== 'object') return 'Invalid sidebar.';
      if (m.sidebar.background !== undefined && (typeof m.sidebar.background !== 'string' || !m.sidebar.background.startsWith('https://') || m.sidebar.background.length > 500)) return 'Sidebar background must be an https URL.';
    }
    // Custom author layer (Advanced tab): stored raw, sanitized at render
    // time by the theme engine. Length-capped only — never executed.
    if (m.custom !== undefined) {
      if (!m.custom || typeof m.custom !== 'object') return 'Invalid custom layer.';
      if (m.custom.css !== undefined && (typeof m.custom.css !== 'string' || m.custom.css.length > 8000)) return 'Custom CSS is too long (8000 max).';
      if (m.custom.html !== undefined && (typeof m.custom.html !== 'string' || m.custom.html.length > 8000)) return 'Custom HTML is too long (8000 max).';
    }
    return null;
  }
  function packSlug(name) {
    const base = String(name).toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').substring(0, 24) || 'pack';
    return base + '-' + Math.random().toString(36).slice(2, 6);
  }

  async function ownsPack(me, packId) {
    if (!me) return false;
    const { data } = await supabase.from('pack_ownership').select('pack_id').eq('user_id', me).eq('pack_id', packId).single();
    return !!data;
  }

  // ── API: list published packs (public; owned flag when signed in)
  // ?mine=1 returns the caller's own packs, drafts included.
  if (url.pathname === '/api/packs' && req.method === 'GET') {
    cors(res);
    const t = (req.headers.authorization || '').replace('Bearer ', '');
    var me = null;
    if (t) { const { data: { user } } = await supabase.auth.getUser(t); if (user) me = user.id; }
    const mineOnly = url.searchParams.get('mine') === '1';
    if (mineOnly && !me) { res.writeHead(401, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'Sign in required.' })); return; }
    var pq = supabase.from('theme_packs').select('id, slug, name, description, price, downloads, featured, published, owner_id, created_at');
    pq = mineOnly ? pq.eq('owner_id', me) : pq.eq('published', true);
    const { data: packs } = await pq.order('featured', { ascending: false }).order('created_at', { ascending: false }).limit(100);
    var owned = {};
    if (me && packs && packs.length) {
      const { data: rows } = await supabase.from('pack_ownership').select('pack_id').eq('user_id', me).in('pack_id', packs.map(p => p.id));
      (rows || []).forEach(r => { owned[r.pack_id] = true; });
    }
    var authorById = {};
    const ownerIds = [...new Set((packs || []).map(p => p.owner_id))];
    if (ownerIds.length) {
      const { data: users } = await supabase.from('users').select('id, display_name').in('id', ownerIds);
      (users || []).forEach(u => { authorById[u.id] = u.display_name; });
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ packs: (packs || []).map(p => ({
      id: p.id, slug: p.slug, name: p.name, description: p.description,
      price: p.price, downloads: p.downloads, featured: p.featured,
      published: p.published,
      author: authorById[p.owner_id] || 'unknown',
      mine: me === p.owner_id,
      owned: p.price === 0 || me === p.owner_id || !!owned[p.id],
    })) }));
    return;
  }

  // ── API: fetch a pack manifest (gated: free, owned, or owner) ──
  if (url.pathname.startsWith('/api/packs/') && url.pathname.endsWith('/manifest') && req.method === 'GET') {
    cors(res);
    const key = safeDecode(url.pathname.split('/')[3] || '');
    const pack = await packByKey(key);
    if (!pack || !pack.published) { res.writeHead(404, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'Pack not found.' })); return; }
    const t = (req.headers.authorization || '').replace('Bearer ', '');
    var me = null;
    if (t) { const { data: { user } } = await supabase.auth.getUser(t); if (user) me = user.id; }
    const entitled = pack.price === 0 || me === pack.owner_id || await ownsPack(me, pack.id);
    if (!entitled) { res.writeHead(403, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'This pack costs ' + pack.price + ' coins.', price: pack.price })); return; }
    if (url.searchParams.get('install') === '1') {
      await supabase.from('theme_packs').update({ downloads: (pack.downloads || 0) + 1 }).eq('id', pack.id);
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ slug: pack.slug, name: pack.name, description: pack.description, manifest: pack.manifest, price: pack.price }));
    return;
  }

  // ── API: create a pack (draft or published) ────────────────────
  if (url.pathname === '/api/packs' && req.method === 'POST') {
    cors(res);
    const user = await requireUser(req, res); if (!user) return;
    if (!(await needVerified(user, res))) return;
    const body = await readBody(req).catch(() => ({}));
    const price = body.price === undefined ? 0 : body.price;
    const err = validatePack(body.name, body.description || '', price, body.manifest);
    if (err) { res.writeHead(400, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: err })); return; }
    var slug = packSlug(body.name);
    for (let i = 0; i < 3; i++) {
      if (RESERVED_PACK_SLUGS.includes(slug)) { slug = packSlug(body.name); continue; }
      const { data: clash } = await supabase.from('theme_packs').select('id').eq('slug', slug).single();
      if (!clash) break;
      slug = packSlug(body.name);
    }
    if (RESERVED_PACK_SLUGS.includes(slug)) { res.writeHead(500, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'Try a different name.' })); return; }
    const { data: pack, error } = await supabase.from('theme_packs').insert({
      slug, owner_id: user.id,
      name: String(body.name).trim(),
      description: String(body.description || '').trim().substring(0, 500),
      manifest: body.manifest, price, published: !!body.published,
    }).select('id, slug, name, description, price, published').single();
    if (error) { res.writeHead(500, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'Create failed.' })); return; }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ pack }));
    return;
  }

  // ── API: update a pack (owner only) ────────────────────────────
  if (url.pathname.startsWith('/api/packs/') && !url.pathname.endsWith('/manifest') && !url.pathname.endsWith('/buy') && req.method === 'PATCH') {
    cors(res);
    const user = await requireUser(req, res); if (!user) return;
    const key = safeDecode(url.pathname.split('/')[3] || '');
    const pack = await packByKey(key);
    if (!pack || pack.owner_id !== user.id) { res.writeHead(404, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'Pack not found.' })); return; }
    if (!(await needVerified(user, res))) return;
    const body = await readBody(req).catch(() => ({}));
    const name = body.name === undefined ? pack.name : body.name;
    const description = body.description === undefined ? pack.description : body.description;
    const price = body.price === undefined ? pack.price : body.price;
    const manifest = body.manifest === undefined ? pack.manifest : body.manifest;
    const err = validatePack(name, description, price, manifest);
    if (err) { res.writeHead(400, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: err })); return; }
    const updates = {
      name: String(name).trim(),
      description: String(description || '').trim().substring(0, 500),
      manifest, price, updated_at: new Date().toISOString(),
    };
    if (body.published !== undefined) updates.published = !!body.published;
    const { error } = await supabase.from('theme_packs').update(updates).eq('id', pack.id);
    if (error) { res.writeHead(500, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'Update failed.' })); return; }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true }));
    return;
  }

  // ── API: delete a pack (owner only; ownership rows cascade) ───
  if (url.pathname.startsWith('/api/packs/') && !url.pathname.endsWith('/manifest') && !url.pathname.endsWith('/buy') && req.method === 'DELETE') {
    cors(res);
    const user = await requireUser(req, res); if (!user) return;
    const key = safeDecode(url.pathname.split('/')[3] || '');
    const pack = await packByKey(key);
    if (!pack || pack.owner_id !== user.id) { res.writeHead(404, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'Pack not found.' })); return; }
    if (!(await needVerified(user, res))) return;
    await supabase.from('theme_packs').delete().eq('id', pack.id);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true }));
    return;
  }

  // ── API: buy a pack (buyer pays, creator gets 100%) ────────────
  if (url.pathname.startsWith('/api/packs/') && url.pathname.endsWith('/buy') && req.method === 'POST') {
    cors(res);
    const user = await requireUser(req, res); if (!user) return;
    const me = user.id;
    const key = safeDecode(url.pathname.split('/')[3] || '');
    const pack = await packByKey(key);
    if (!pack || !pack.published) { res.writeHead(404, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'Pack not found.' })); return; }
    if (!(await needVerified(user, res))) return;
    if (pack.owner_id === me) { res.writeHead(400, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'You own this pack.' })); return; }
    // Anti-farm caps (plan.md 2.3): bound daily spend, purchase velocity,
    // and seller-side daily earnings so colluding accounts can't funnel
    // unbounded coins. Free/repeat buys skip the caps (no value moves).
    if (pack.price > 0) {
      const [spentToday, earnedToday] = await Promise.all([
        coinFlow(me, 'out', dayStartIso()),
        coinFlow(pack.owner_id, 'in', dayStartIso()),
      ]);
      if (spentToday + pack.price > COIN_LIMITS.dailySpend) { res.writeHead(429, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'Daily spending cap reached — try tomorrow.' })); return; }
      if (earnedToday + pack.price > COIN_LIMITS.dailyEarn) { res.writeHead(429, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'This creator has hit today\u2019s earnings cap — try tomorrow.' })); return; }
      const { count: recentBuys } = await supabase.from('coin_ledger').select('id', { count: 'exact', head: true }).eq('user_id', me).eq('reason', 'pack_buy').gte('created_at', hourAgoIso());
      if ((recentBuys || 0) >= COIN_LIMITS.buysPerHour) { res.writeHead(429, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'Too many purchases — slow down.' })); return; }
    }
    if (pack.price === 0 || await ownsPack(me, pack.id)) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, already: true, manifest: pack.manifest, slug: pack.slug }));
      return;
    }
    // Claim ownership first: a concurrent second buy hits the PK and
    // gets the manifest free instead of charging twice.
    const { error: ownErr } = await supabase.from('pack_ownership').insert({ user_id: me, pack_id: pack.id });
    if (ownErr) {
      if (String(ownErr.message || '').includes('duplicate key')) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, already: true, manifest: pack.manifest, slug: pack.slug }));
        return;
      }
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Buy failed.' }));
      return;
    }
    const { data: bal, error: spendErr } = await supabase.rpc('spend_coins', { p_user: me, p_delta: pack.price, p_reason: 'pack_buy', p_ref: pack.id });
    if (spendErr) {
      await supabase.from('pack_ownership').delete().eq('user_id', me).eq('pack_id', pack.id);
      const short = String(spendErr.message || '').includes('insufficient funds');
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(short ? { error: 'Not enough coins.', need: pack.price - (await coinBalance(me)) } : { error: 'Buy failed.' }));
      return;
    }
    const { error: grantErr } = await supabase.rpc('grant_coins', { p_user: pack.owner_id, p_delta: pack.price, p_reason: 'pack_sale', p_ref: pack.id });
    if (grantErr) {
      await supabase.rpc('grant_coins', { p_user: me, p_delta: pack.price, p_reason: 'pack_refund', p_ref: pack.id });
      await supabase.from('pack_ownership').delete().eq('user_id', me).eq('pack_id', pack.id);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Buy failed.' }));
      return;
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, manifest: pack.manifest, slug: pack.slug, balance: bal }));
    return;
  }





  // ── Moderation (plan.md 2.2): allowlisted moderators only ──────
  // Membership lives in the moderators table (service-role reads); never
  // inferred from coins, purchases, or profile fields. Missing table (pre-
  // migration) reads as "no moderators", so this is deploy-safe.










  // ── Helper: parse JSON body ───────────────────────────────────
  // Bounded: a socket that dribbles forever can't balloon memory. Routes
  // that legitimately carry MB-scale payloads (projects, scratch imports,
  // AI chat context) pass a larger limit; the .catch wrapper answers 413.





  // ── API: my games (Studio "Your Projects" tab) ───────────────────
  // ── API: cross-entity search (games, forum threads, creators) ──────
  // Ranked by Postgres full-text search (migration/search.sql). Missing
  // functions degrade to a title ilike instead of failing the request.
  if (url.pathname === '/api/search' && req.method === 'GET') {
    cors(res);
    const q = String(url.searchParams.get('q') || '').trim().slice(0, 80);
    const type = String(url.searchParams.get('type') || 'all').toLowerCase();
    const limit = Math.min(25, Math.max(1, parseInt(String(url.searchParams.get('limit') || '10'), 10) || 10));
    if (q.length < 2) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Search needs at least 2 characters.' }));
      return;
    }
    const out = { q, games: [], threads: [], people: [] };
    const want = (t) => type === 'all' || type === t || type === t + 's';
    if (want('game')) {
      const { data, error } = await supabase.rpc('search_games', { q, lim: limit });
      if (!error && data) out.games = data;
      else {
        const { data: rows } = await supabase.from('games')
          .select('id, title, description, tags, play_count, owner_id')
          .eq('published', true).ilike('title', '%' + q + '%').limit(limit);
        out.games = (rows || []).map((g) => ({ ...g, score: 0 }));
      }
    }
    if (want('thread')) {
      const { data, error } = await supabase.rpc('search_threads', { q, lim: limit });
      if (!error && data) out.threads = data;
      else {
        const { data: rows } = await supabase.from('forum_threads')
          .select('id, title, category, comment_count, created_at')
          .ilike('title', '%' + q + '%').limit(limit);
        out.threads = (rows || []).map((t) => ({ ...t, score: 0 }));
      }
    }
    if (want('person') || (type === 'all' && q.length >= 2)) {
      const { data } = await supabase.from('users')
        .select('id, display_name, avatar_url').ilike('display_name', '%' + q + '%').limit(limit);
      out.people = data || [];
    }
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=30' });
    res.end(JSON.stringify(out));
    return;
  }





  // ── API: AI fetch proxy (Cudic AI panel) ────────────────────────
  // Browsers block cross-origin calls to most LLM providers (no CORS), so
  // the Studio panel routes cloud calls through here. Login required (no
  // open relay); only whitelisted AI hosts, https only, loopback rejected
  // (local engines like Ollama are called direct from the browser).
  const AI_HOSTS = new Set([
    'api.openai.com', 'api.anthropic.com', 'generativelanguage.googleapis.com',
    'api.x.ai', 'api.deepseek.com', 'api.mistral.ai', 'api.groq.com',
    'api.together.xyz', 'api.fireworks.ai', 'api.cerebras.ai', 'api.deepinfra.com',
    'api.cohere.com', 'api.perplexity.ai', 'api.minimax.io', 'api.moonshot.ai',
    'api.zhipu.ai', 'open.bigmodel.cn', 'dashscope.aliyuncs.com', 'api.stepfun.com',
    'api.01.ai', 'api.sarvam.ai', 'api.upstage.ai', 'api.ai21.com', 'api.writer.com',
    'api.hyperbolic.xyz', 'api.nebius.ai', 'api.sambanova.ai', 'api.novita.ai',
    'siliconflow.cn', 'api.siliconflow.cn', 'api.infermatic.ai', 'api.kluster.ai',
    'api.chutes.ai', 'llm.chutes.ai', 'api.featherless.ai', 'api.targon.com', 'api.friendli.ai',
    'api.nscale.com', 'api.parasail.io', 'api.lambda.ai', 'api.endpoints.anyscale.com',
    'api.baseten.co', 'api.cloudflare.com', 'api.venice.ai', 'api.z.ai',
    'api.hunyuan.cloud.tencent.com', 'qianfan.baidubce.com', 'openrouter.ai',
    'opencode.ai', 'api.aimlapi.com', 'api.zeroone.ai',
    'ark.cn-beijing.volces.com', 'api.studio.nebius.com'  // Doubao + Nebius presets (providers.ts)
  ]);
  if (url.pathname === '/api/ai/fetch' && req.method === 'POST') {
    cors(res);
    const authHeader = req.headers.authorization || '';
    const token = authHeader.replace('Bearer ', '');
    if (!token) { res.writeHead(401, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'Sign in to use cloud models.' })); return; }
    const { data: { user }, error: authErr } = await supabase.auth.getUser(token);
    if (authErr || !user) { res.writeHead(401, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'Sign in to use cloud models.' })); return; }
    if (!(await seatAlive(user.id, seatFromReq(req)))) { seatDead(res); return; }
    if (!(await needVerified(user, res))) return;
    const body = await readBody(req, 10 * 1024 * 1024); // chat context (files + skills) can reach MBs
    let target;
    try { target = new URL(String(body.url || '')); } catch { target = null; }
    const hostOk = target && target.protocol === 'https:' &&
      (AI_HOSTS.has(target.hostname) || target.hostname.endsWith('.openai.azure.com'));
    const loopback = target && /^(localhost|127\.|0\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|::1|fc00:|fe80:)/i.test(target.hostname);
    if (!hostOk || loopback) { res.writeHead(403, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'Target not allowed.' })); return; }
    const fwdHeaders = {};
    for (const [k, v] of Object.entries(body.headers || {})) {
      if (typeof v === 'string' && v.length < 8192 &&
        /^(authorization|content-type|x-api-key|x-goog-api-key|anthropic-version|openai-organization|openai-project|http-referer|x-title)$/i.test(k)) fwdHeaders[k] = v;
    }
    let upstream;
    try {
      upstream = await fetch(target.toString(), {
        method: body.method === 'GET' ? 'GET' : 'POST',
        headers: fwdHeaders,
        body: body.method === 'GET' ? undefined : (typeof body.body === 'string' ? body.body : JSON.stringify(body.body ?? {}))
      });
    } catch (e) { res.writeHead(502, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'Upstream unreachable.' })); return; }
    res.writeHead(upstream.status, { 'Content-Type': upstream.headers.get('content-type') || 'application/json', 'Cache-Control': 'no-store' });
    try {
      for await (const chunk of upstream.body) { res.write(chunk); }
    } catch (e) {}
    res.end();
    return;
  }

  // ── API: AI chat sessions (Studio panel transcripts) ──────────
  // Multi-session chat state saved with the account so sessions survive
  // panels, machines, and logins. Bounded blob: 20 sessions max, plain text.
  if (url.pathname === '/api/ai/sessions' && req.method === 'GET') {
    cors(res);
    const authHeader = req.headers.authorization || '';
    const token = authHeader.replace('Bearer ', '');
    if (!token) { res.writeHead(401); res.end(); return; }
    const { data: { user }, error: authErr } = await supabase.auth.getUser(token);
    if (authErr || !user) { res.writeHead(401, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'Sign in to sync AI sessions.' })); return; }
    const { data } = await supabase.from('users').select('ai_sessions').eq('id', user.id).single();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ sessions: Array.isArray(data?.ai_sessions) ? data.ai_sessions : [] }));
    return;
  }
  if (url.pathname === '/api/ai/sessions' && req.method === 'PUT') {
    cors(res);
    const authHeader = req.headers.authorization || '';
    const token = authHeader.replace('Bearer ', '');
    if (!token) { res.writeHead(401); res.end(); return; }
    const { data: { user }, error: authErr } = await supabase.auth.getUser(token);
    if (authErr || !user) { res.writeHead(401, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'Sign in to sync AI sessions.' })); return; }
    let parsed;
    try { parsed = await readBody(req, 512 * 1024); } catch { res.writeHead(400, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'Payload too large.' })); return; }
    const incoming = Array.isArray(parsed.sessions) ? parsed.sessions : [];
    // Strict shape: plain-text label + q/a transcript pairs only.
    const sessions = incoming.slice(0, 20).map((s) => ({
      id: String((s && s.id) || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 40),
      label: String((s && s.label) || '').replace(/\s+/g, ' ').trim().slice(0, 60),
      created: Math.min(Math.max(Number((s && s.created) || 0), 0), 4102444800000),
      msgs: (Array.isArray(s && s.msgs) ? s.msgs : []).slice(0, 80).map((mm) => ({
        q: String((mm && mm.q) || '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').slice(0, 4000),
        a: String((mm && mm.a) || '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').slice(0, 12000)
      })).filter((mm) => mm.q)
    })).filter((s) => s.id);
    // Update by auth id — users.id mirrors auth.users.id in this schema.
    const { error: upErr } = await supabase.from('users').update({ ai_sessions: sessions }).eq('id', user.id);
    if (upErr) { res.writeHead(500, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'Could not save sessions.' })); return; }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, sessions: sessions.length }));
    return;
  }

  // ── API: creator stats ───────────────────────────────────────
  // What a maker can honestly know today. game_plays keeps one row per account
  // per game and overwrites played_at on every return, so this can count
  // players and how many of them played in the last week — it cannot draw a
  // daily history or an average session, because neither is stored. Those two
  // numbers are left out rather than estimated; adding them means logging each
  // play, which is a table and a write, not a query.
  if (url.pathname === '/api/creator/stats' && req.method === 'GET') {
    cors(res);
    const user = await userOf(req);
    if (!user) { res.writeHead(401, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'Unauthorized' })); return; }
    const { data: gameRows } = await supabase.from('games')
      .select('id, title, play_count')
      .eq('owner_id', user.id)
      .limit(200);
    const rows = gameRows || [];
    const ids = rows.map(g => g.id);
    if (!ids.length) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ totals: { plays: 0, players: 0, week: 0, likes: 0, comments: 0, forks: 0 }, top: [] }));
      return;
    }
    const [playsRes, likeRes, commentRes, forkRes] = await Promise.all([
      supabase.from('game_plays').select('game_id, played_at').in('game_id', ids).limit(5000),
      supabase.from('game_likes').select('game_id').in('game_id', ids).limit(5000),
      supabase.from('game_comments').select('game_id').in('game_id', ids).limit(5000),
      supabase.from('games').select('forked_from').in('forked_from', ids).limit(5000),
    ]);
    const plays = playsRes.error ? [] : (playsRes.data || []);
    const weekAgo = Date.now() - 7 * 86400000;
    const per = {};
    for (const p of plays) {
      const k = p.game_id;
      if (!per[k]) per[k] = { players: 0, week: 0 };
      per[k].players++;
      if (Date.parse(p.played_at) >= weekAgo) per[k].week++;
    }
    const totals = {
      plays: rows.reduce((s, g) => s + (g.play_count || 0), 0),
      players: plays.length,
      week: Object.keys(per).reduce((s, k) => s + per[k].week, 0),
      likes: (likeRes.data || []).length,
      comments: (commentRes.data || []).length,
      forks: (forkRes.data || []).length,
    };
    const top = rows
      .map(g => ({ id: g.id, title: g.title || 'Untitled game', plays: g.play_count || 0, players: (per[g.id] || {}).players || 0 }))
      .sort((a, b) => b.plays - a.plays)
      .slice(0, 5);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ totals, top }));
    return;
  }





  // ── API: forums — threads and replies ─────────────────────────
  // Public to read (same stance as the gallery), sign-in to write. The OP of
  // a thread can stamp each reply with a short label ("answered", "solved") —
  // that is the feature the forum exists for: a question thread that tells
  // you the answer at a glance. Writes are seat-checked like everything else.
  const forumName = async (uid) => {
    const { data } = await supabase.from('users').select('display_name').eq('id', uid).single();
    return (data && data.display_name) || 'Unknown';
  };
  const FORUM_CATEGORIES = ['help', 'showcase', 'bug'];
  const forumCategory = (v) => {
    const c = String(v || '').toLowerCase();
    return FORUM_CATEGORIES.includes(c) ? c : 'help';
  };
  const forumGame = (row) => {
    const g = Array.isArray(row.games) ? row.games[0] : row.games;
    return g && g.id ? { id: g.id, title: g.title || 'Untitled game', has_thumb: true } : null;
  };
  if (url.pathname === '/api/forums/threads' && req.method === 'GET') {
    cors(res);
    const sort = String(url.searchParams.get('sort') || 'active');
    const q = String(url.searchParams.get('q') || '').trim().slice(0, 60);
    const category = String(url.searchParams.get('category') || '').toLowerCase();
    let query = supabase.from('forum_threads')
      .select('id, title, body, category, pinned, comment_count, created_at, last_at, user_id, users!forum_threads_user_id_fkey(display_name, user_id, avatar_url), games!forum_threads_game_id_fkey(id, title, thumbnail)')
      .order('pinned', { ascending: false })
      .limit(60);
    if (q) query = query.or(`title.ilike.%${q.replace(/[%_\\,()]/g, '')}%,body.ilike.%${q.replace(/[%_\\,()]/g, '')}%`);
    if (FORUM_CATEGORIES.includes(category)) query = query.eq('category', category);
    query = sort === 'new' ? query.order('created_at', { ascending: false }) : query.order('last_at', { ascending: false });
    const { data, error } = await query;
    if (error) console.error('forums list error:', error.message);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      threads: (data || []).map((t) => {
        const { games, ...rest } = t;
        return { ...rest, body: String(t.body || '').slice(0, 160), game: forumGame(t) };
      }),
      error: error ? 'Could not load threads.' : undefined
    }));
    return;
  }
  if (url.pathname === '/api/forums/threads' && req.method === 'POST') {
    cors(res);
    const user = await requireUser(req, res); if (!user) return;
    if (!(await seatAlive(user.id, seatFromReq(req)))) { seatDead(res); return; }
    if (!(await needVerified(user, res))) return;
    if (!rateLimit('fthread:' + user.id, 5, 3600000)) { res.writeHead(429, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'Five threads an hour is plenty — slow down.' })); return; }
    const body = await readBody(req).catch(() => ({}));
    const title = String(body.title || '').trim().replace(/[\u0000-\u001f<>]/g, '').substring(0, 90);
    const text = String(body.body || '').trim().substring(0, 5000);
    if (title.length < 4) { res.writeHead(400, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'Give the thread a title (at least 4 characters).' })); return; }
    const category = forumCategory(body.category);
    let gameId = null;
    const gameRef = String(body.game || '').trim().slice(0, 500);
    if (gameRef) {
      const m = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i.exec(gameRef);
      if (!m) { res.writeHead(400, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'Paste a published Cudic game link.' })); return; }
      gameId = m[0].toLowerCase();
      const { data: game } = await supabase.from('games').select('id, published').eq('id', gameId).single();
      if (!game || !game.published) { res.writeHead(400, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'That game is not published.' })); return; }
    }
    const { data, error } = await supabase.from('forum_threads').insert({ user_id: user.id, title, body: text, category, game_id: gameId }).select('id, title, category, game_id').single();
    if (error) { res.writeHead(500, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: error.message })); return; }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ thread: data }));
    return;
  }
  const labelMatch = /^\/api\/forums\/threads\/([^/]+)\/comments\/([^/]+)\/label$/.exec(url.pathname);
  if (labelMatch && req.method === 'POST') {
    cors(res);
    const user = await requireUser(req, res); if (!user) return;
    if (!(await seatAlive(user.id, seatFromReq(req)))) { seatDead(res); return; }
    if (!(await needVerified(user, res))) return;
    const [, tid, cid] = labelMatch;
    if (!isUuid(tid) || !isUuid(cid)) { res.writeHead(400, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'Bad id.' })); return; }
    const { data: th } = await supabase.from('forum_threads').select('user_id').eq('id', tid).single();
    if (!th) { res.writeHead(404, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'Thread not found.' })); return; }
    // Labels belong to the thread's author — that is what makes them an
    // answer rather than a popularity vote.
    if (th.user_id !== user.id) { res.writeHead(403, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'Only the thread author labels replies.' })); return; }
    const body = await readBody(req).catch(() => ({}));
    const label = String(body.label || '').replace(/[\u0000-\u001f<>]/g, '').trim().substring(0, 24);
    const { data: upd } = await supabase.from('forum_comments').update({ label: label || null }).eq('id', cid).eq('thread_id', tid).select('id, label');
    if (!(upd || []).length) { res.writeHead(404, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'Reply not found.' })); return; }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, label: upd[0].label }));
    return;
  }
  const threadMatch = /^\/api\/forums\/threads\/([^/]+)$/.exec(url.pathname);
  if (threadMatch && req.method === 'GET') {
    cors(res);
    const tid = threadMatch[1];
    if (!isUuid(tid)) { res.writeHead(400, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'Bad id.' })); return; }
    const [{ data: thread }, { data: comments }] = await Promise.all([
      supabase.from('forum_threads').select('id, title, body, category, pinned, comment_count, created_at, last_at, user_id, users!forum_threads_user_id_fkey(display_name, user_id, avatar_url), games!forum_threads_game_id_fkey(id, title, thumbnail)').eq('id', tid).single(),
      supabase.from('forum_comments').select('id, user_id, display_name, text, label, created_at').eq('thread_id', tid).order('created_at', { ascending: true }).limit(500)
    ]);
    if (!thread) { res.writeHead(404, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'Thread not found.' })); return; }
    const { games, ...rest } = thread;
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ thread: { ...rest, game: forumGame(thread) }, comments: comments || [] }));
    return;
  }
  if (threadMatch && req.method === 'DELETE') {
    cors(res);
    const user = await requireUser(req, res); if (!user) return;
    if (!(await seatAlive(user.id, seatFromReq(req)))) { seatDead(res); return; }
    if (!(await needVerified(user, res))) return;
    const tid = threadMatch[1];
    if (!isUuid(tid)) { res.writeHead(400, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'Bad id.' })); return; }
    const { data: th } = await supabase.from('forum_threads').select('user_id').eq('id', tid).single();
    if (!th) { res.writeHead(404, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'Thread not found.' })); return; }
    if (th.user_id !== user.id && !(await isModerator(user.id))) { res.writeHead(403, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'Only the author can delete a thread.' })); return; }
    await supabase.from('forum_threads').delete().eq('id', tid);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true }));
    return;
  }
  const replyMatch = /^\/api\/forums\/threads\/([^/]+)\/comments$/.exec(url.pathname);
  if (replyMatch && req.method === 'POST') {
    cors(res);
    const user = await requireUser(req, res); if (!user) return;
    if (!(await seatAlive(user.id, seatFromReq(req)))) { seatDead(res); return; }
    if (!(await needVerified(user, res))) return;
    if (!rateLimit('fcomment:' + user.id, 30, 3600000)) { res.writeHead(429, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'Too many replies — slow down.' })); return; }
    const tid = replyMatch[1];
    if (!isUuid(tid)) { res.writeHead(400, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'Bad id.' })); return; }
    const body = await readBody(req).catch(() => ({}));
    const text = String(body.text || '').trim().substring(0, 2000);
    if (!text) { res.writeHead(400, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'Write something first.' })); return; }
    const { data: th } = await supabase.from('forum_threads').select('id, comment_count').eq('id', tid).single();
    if (!th) { res.writeHead(404, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'Thread not found.' })); return; }
    const name = await forumName(user.id);
    const { data, error } = await supabase.from('forum_comments').insert({ thread_id: tid, user_id: user.id, display_name: name, text }).select().single();
    if (error) { res.writeHead(500, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: error.message })); return; }
    // Non-atomic on purpose: a lost increment is cosmetic here, and the reply
    // itself is the thing that must not be lost.
    await supabase.from('forum_threads').update({ comment_count: (th.comment_count || 0) + 1, last_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq('id', tid);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ comment: data }));
    return;
  }
  const commentDelMatch = /^\/api\/forums\/comments\/([^/]+)$/.exec(url.pathname);
  if (commentDelMatch && req.method === 'DELETE') {
    cors(res);
    const user = await requireUser(req, res); if (!user) return;
    if (!(await seatAlive(user.id, seatFromReq(req)))) { seatDead(res); return; }
    if (!(await needVerified(user, res))) return;
    const cid = commentDelMatch[1];
    if (!isUuid(cid)) { res.writeHead(400, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'Bad id.' })); return; }
    const { data: c } = await supabase.from('forum_comments').select('id, user_id, thread_id').eq('id', cid).single();
    if (!c) { res.writeHead(404, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'Reply not found.' })); return; }
    const { data: th } = await supabase.from('forum_threads').select('user_id, comment_count').eq('id', c.thread_id).single();
    const owner = th && th.user_id === user.id;
    if (c.user_id !== user.id && !owner && !(await isModerator(user.id))) { res.writeHead(403, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'Not yours to delete.' })); return; }
    await supabase.from('forum_comments').delete().eq('id', cid);
    if (th) await supabase.from('forum_threads').update({ comment_count: Math.max(0, (th.comment_count || 1) - 1) }).eq('id', c.thread_id);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true }));
    return;
  }
















































  // ── API: import Scratch (.sb3) → split game files ───────────────
  // POST /api/scratch/import {sb3?: base64, scratchUrl?: string, scratchId?: string|number, title?: string}
  // Server-side only: the packager/scaffolding Node module explicitly does
  // not run in browsers. We unpack here and emit editable split files plus
  // a Scaffolding player shell (CDN, pinned) — the existing preview /
  // publish / gallery pipeline handles the rest untouched. Auth + seat +
  // rate limited. No DB writes: files go back to Studio, the user saves.
  // ponytail: whole upload lives in memory as base64 (25MB cap). If imports
  // get big, stream the .sb3 to storage and pass a key instead.
  const SCRATCH_MAX_BYTES = 25 * 1024 * 1024;
  const SCAFFOLD_CDN = 'https://cdn.jsdelivr.net/npm/@turbowarp/packager@3.13.0/dist/scaffolding/';
  function scratchFail(res, status, error) {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error }));
  }
  async function fetchUrl(url, ms) {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), ms);
    try {
      const r = await fetch(url, { signal: ctl.signal });
      if (!r.ok) return null;
      const ab = await r.arrayBuffer();
      return Buffer.from(ab);
    } catch {
      return null;
    } finally {
      clearTimeout(t);
    }
  }
  async function fetchScratchProject(pid) {
    // Scratch 403s server-side /<id> downloads, so the documented token dance
    // (trampoline metadata → ?token=) is the only path. That API rate-limits
    // bursts, hence one retry.
    const metaFor = async () => {
      const b = await fetchUrl('https://trampoline.turbowarp.org/api/projects/' + pid, 15000);
      if (!b) return null;
      try { return JSON.parse(b.toString('utf8')); } catch { return null; }
    };
    let meta = await metaFor();
    if (meta == null || !meta.project_token) {
      await new Promise((r) => setTimeout(r, 1500));
      meta = await metaFor();
    }
    if (meta == null || !meta.project_token) return null;
    const buf = await fetchUrl('https://projects.scratch.mit.edu/' + pid + '?token=' + encodeURIComponent(meta.project_token), 30000);
    return buf && buf.length > 0 ? { buf, title: typeof meta.title === 'string' ? meta.title : '' } : null;
  }
  function scratchMime(name) {
    const ext = String(name.split('.').pop() || '').toLowerCase();
    if (ext === 'svg') return 'image/svg+xml';
    if (ext === 'png') return 'image/png';
    if (ext === 'jpg' || ext === 'jpeg') return 'image/jpeg';
    if (ext === 'gif') return 'image/gif';
    if (ext === 'wav') return 'audio/wav';
    if (ext === 'mp3') return 'audio/mpeg';
    return 'application/octet-stream';
  }
  function escHtml(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
  if (url.pathname === '/api/scratch/import' && req.method === 'POST') {
    cors(res);
    const authHeader = req.headers.authorization || '';
    const token = authHeader.replace('Bearer ', '');
    if (!token) { res.writeHead(401, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'Unauthorized' })); return; }
    const { data: { user }, error: authErr } = await supabase.auth.getUser(token);
    if (authErr || !user) { res.writeHead(401, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'Unauthorized' })); return; }
    if (!(await seatAlive(user.id, seatFromReq(req)))) { seatDead(res); return; }
    if (!(await needVerified(user, res))) return;
    if (!rateLimit('scratch:' + user.id, 5, 3600000)) { scratchFail(res, 429, 'Too many imports, slow down.'); return; }
    const body = await readBody(req, 45 * 1024 * 1024); // .sb3 base64 rides inside the JSON (34MB check below)
    let title = String(body.title || '').trim().slice(0, 80);
    let buf = null;
    try {
      if (typeof body.sb3 === 'string' && body.sb3.length > 0) {
        if (body.sb3.length > 34 * 1024 * 1024) { scratchFail(res, 413, 'That file is over 25MB.'); return; }
        if (!/^[A-Za-z0-9+/=\r\n]+$/.test(body.sb3)) { scratchFail(res, 400, 'That upload is not valid base64.'); return; }
        buf = Buffer.from(body.sb3, 'base64');
      } else {
        let pid = '';
        if (body.scratchId != null) pid = String(body.scratchId).trim();
        else if (typeof body.scratchUrl === 'string') {
          let u = null;
          try { u = new URL(body.scratchUrl.trim()); } catch { u = null; }
          const m = u && u.hostname === 'scratch.mit.edu' ? u.pathname.match(/\/projects\/(\d+)/) : null;
          if (!m) { scratchFail(res, 400, 'Give a Scratch project link like https://scratch.mit.edu/projects/123456.'); return; }
          pid = m[1];
        }
        if (!/^\d+$/.test(pid)) { scratchFail(res, 400, 'Give a numeric Scratch project id or a .sb3 file.'); return; }
        const got = await fetchScratchProject(pid);
        if (!got) { scratchFail(res, 502, 'Scratch would not hand over that project. It has to be shared (not private), and Scratch rate-limits downloads — try importing the .sb3 file instead.'); return; }
        buf = got.buf;
        if (title === '') title = got.title.substring(0, 80);
      }
      if (title === '') title = 'Scratch import';
      if (!buf || buf.length === 0 || buf.length > SCRATCH_MAX_BYTES) { scratchFail(res, 413, 'That file is over 25MB.'); return; }
      // Scratch hands back either an .sb3 zip or bare project.json depending on
      // the project. A JSON body carries no assets, so pull each one from the
      // Scratch asset CDN by the md5ext project.json references.
      const warnings = [];
      // Assets ship as real workspace files (assets/<md5ext>) so saving uploads
      // them to storage instead of stuffing megabytes of base64 into the row;
      // assets.js only maps md5ext -> that path.
      const assets = {};
      const binaries = {};
      let assetBytes = 0, assetCount = 0;
      const addAsset = (key, bytes) => {
        const path = 'assets/' + key;
        assets[key] = path;
        binaries[path] = bytes.toString('base64');
        assetBytes += bytes.length; assetCount++;
      };
      let proj = null, zip = null;
      if (buf[0] === 0x7b) {
        try { proj = JSON.parse(buf.toString('utf8')); } catch { proj = null; }
        if (proj == null) { scratchFail(res, 422, 'That project could not be read.'); return; }
        const need = [];
        for (const t of (Array.isArray(proj.targets) ? proj.targets : [])) {
          for (const c of [...(t.costumes || []), ...(t.sounds || [])]) {
            if (c && typeof c.md5ext === 'string' && need.indexOf(c.md5ext) === -1) need.push(c.md5ext);
          }
        }
        let missing = 0;
        for (const md5 of need) {
          const b = await fetchUrl('https://assets.scratch.mit.edu/internalapi/asset/' + encodeURIComponent(md5) + '/get/', 15000);
          if (b == null) { missing++; continue; }
          addAsset(md5, b);
        }
        if (missing > 0) warnings.push(missing + ' costume/sound(s) Scratch would not serve, so those will not show.');
      } else {
        try { zip = await JSZip.loadAsync(buf); } catch { scratchFail(res, 422, 'That file is not a Scratch project.'); return; }
        const pjFile = zip.file('project.json');
        if (!pjFile) { scratchFail(res, 422, 'No project.json inside — not a Scratch project.'); return; }
        try { proj = JSON.parse(await pjFile.async('string')); } catch { scratchFail(res, 422, 'project.json would not parse.'); return; }
      }
      if (!proj || !Array.isArray(proj.targets)) { scratchFail(res, 422, 'project.json is not a Scratch project.'); return; }
      // Fidelity scan: extensions + opcode prefixes + cloud variables.
      const exts = new Set(Array.isArray(proj.extensions) ? proj.extensions : []);
      const hasOp = (pre) => {
        for (const t of proj.targets) {
          const bl = (t && t.blocks) || {};
          for (const k of Object.keys(bl)) {
            const b = bl[k];
            if (b && typeof b.opcode === 'string' && b.opcode.indexOf(pre) === 0) return true;
          }
        }
        return false;
      };
      const fullPlayer = exts.has('music') || hasOp('music.');
      if (fullPlayer) warnings.push('Uses the music extension: playing with the full-size player.');
      if (exts.has('text2speech') || hasOp('text2speech.') || exts.has('translate') || hasOp('translate.')) warnings.push('Text-to-speech/translate blocks need API keys and will stay silent.');
      if (exts.has('videoSensing') || hasOp('videoSensing.')) warnings.push('Video sensing needs camera access, which the game sandbox blocks.');
      const clouds = [];
      for (const t of proj.targets) {
        const vars = (t && t.variables) || {};
        for (const k of Object.keys(vars)) {
          const v = vars[k];
          const nm = Array.isArray(v) ? v[0] : v && v.name;
          if (typeof nm === 'string' && nm.charAt(0) === '☁' && clouds.indexOf(nm) === -1) clouds.push(nm);
        }
      }
      if (clouds.length) warnings.push('Cloud variables (' + clouds.slice(0, 5).join(', ') + (clouds.length > 5 ? ' +' + (clouds.length - 5) + ' more' : '') + ') are stored locally per player, not synced.');
      if (zip != null) {
        const names = Object.keys(zip.files).filter((n) => n !== 'project.json' && !zip.files[n].dir);
        for (const n of names) addAsset(n, await zip.files[n].async('nodebuffer'));
      }
      if (assetBytes > 5 * 1024 * 1024) warnings.push('Heavy project: ' + Math.round(assetBytes / 1048576) + 'MB of costumes/sounds, so saving can be slow.');
      // Dynamic mode: for projects imported from Scratch (not .sb3 uploads) whose
      // assets exceed the threshold, skip storing binaries and point at Scratch's
      // CDN instead. Keeps the game row small and lets huge projects save.
      const isRemote = (buf[0] === 0x7b);
      const SCRATCH_DYNAMIC_THRESHOLD = 2 * 1024 * 1024;
      const dynamicAssets = isRemote && assetBytes > SCRATCH_DYNAMIC_THRESHOLD;
      if (dynamicAssets) {
        for (const key of Object.keys(assets)) {
          assets[key] = 'https://assets.scratch.mit.edu/internalapi/asset/' + encodeURIComponent(key) + '/get/';
        }
        for (const k of Object.keys(binaries)) delete binaries[k];
        warnings.push('Large project: assets load from Scratch on demand (needs a connection).');
      }
      const projJson = JSON.stringify(proj);
      const safeAssets = JSON.stringify(assets).replace(/<\//g, '<\\/');
      const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').substring(0, 40) || 'scratch-game';
      const shell =
        '<!DOCTYPE html>\n<html>\n<head>\n<meta charset="UTF-8">\n' +
        '<meta name="viewport" content="width=device-width, initial-scale=1.0">\n' +
        '<title>' + escHtml(title) + ' — Cudic</title>\n' +
        '<style>html,body{margin:0;height:100%;background:transparent;overflow:hidden}' +
        '#stage{width:100%;height:100%}' +
        // Overlay, not a flow child: never shifts the canvas, just removed on start.
        '#loading{position:fixed;top:10px;left:12px;color:#8b8b96;font:12px monospace}</style>\n' +
        '<script src="' + SCAFFOLD_CDN + (fullPlayer ? 'scaffolding-full.js' : 'scaffolding-min.js') + '"><\/script>\n' +
        '</head>\n<body>\n<div id="stage"><div id="loading">Loading…</div></div>\n' +
        '<script src="assets.js"><\/script>\n<script src="scratch.js"><\/script>\n</body>\n</html>\n';
      const boot =
        '// Generated by Cudic Scratch import. Scaffolding player (c) TurboWarp,\n' +
        '// MPL-2.0 — see https://github.com/TurboWarp/packager. project.json is\n' +
        '// the editable source; the copies below are what actually runs\n' +
        '// (re-import, or hand-sync both, after editing project.json).\n' +
        '// Cloud variables below use per-player local storage (see import notes).\n' +
        '(function () {\n' +
        'var mount = document.getElementById(\'stage\');\n' +
        'function fail(msg) { var l = document.getElementById(\'loading\'); if (l) l.textContent = msg; }\n' +
        'if (!window.Scaffolding) return fail(\'Player library failed to load — check connection and reload.\');\n' +
        'var scaffolding = new window.Scaffolding.Scaffolding();\n' +
        'scaffolding.width = 480; scaffolding.height = 360;\n' +
        'scaffolding.resizeMode = \'preserve-ratio\';\n' +
        'scaffolding.setup();\n' +
        'scaffolding.appendTo(mount);\n' +
        'try { scaffolding.setAccentColor(\'#855CD6\'); } catch (e) {}\n' +
        'try {\n' +
        '  var store = scaffolding.storage;\n' +
        '  store.addWebStore([store.AssetType.ImageVector, store.AssetType.ImageBitmap, store.AssetType.Sound], function (asset) {\n' +
        '    var key = asset.assetId + \'.\' + asset.dataFormat;\n' +
        '    var p = (window.__SCRATCH_ASSETS__ || {})[key];\n' +
        '    if (!p) throw new Error(\'missing asset \' + key);\n' +
        '    // Dynamic (large project): p is a Scratch CDN URL, fetch it.\n' +
        '    if (typeof p === \'string\' && /^https?:\\/\\//.test(p)) {\n' +
        '      return fetch(p).then(function (r) { if (!r.ok) throw new Error(\'asset fetch \' + r.status); return r.arrayBuffer(); }).then(function (b) { return new Uint8Array(b); });\n' +
        '    }\n' +
        '    // __CUDIC_BIN__ is injected by the Studio preview and the Cudic player\n' +
        '    // so this sandboxed frame resolves the file without fetching it.\n' +
        '    return (window.__CUDIC_BIN__ || {})[p] || p;\n' +
        '  });\n' +
        '} catch (e) {}\n' +
        'try { scaffolding.addCloudProvider(new window.Scaffolding.Cloud.LocalStorageProvider(\'cudic-' + slug.replace(/'/g, '') + '\')); } catch (e) {}\n' +
        'function __start(proj) {\n' +
        '  scaffolding.loadProject(JSON.stringify(proj))\n' +
        '    .then(function () {\n' +
        '      var l = document.getElementById(\'loading\'); if (l) l.remove();\n' +
        '      scaffolding.start();\n' +
        '    })\n' +
        '    .catch(function (err) { fail(\'Could not start this project: \' + ((err && err.message) || err)); });\n' +
        '}\n' +
        'if (window.__SCRATCH_PROJECT__) { __start(window.__SCRATCH_PROJECT__); }\n' +
        'else {\n' +
        '  var __projUrl = (window.__CUDIC_BIN__ || {})[\'project.json\'];\n' +
        '  if (!__projUrl) {\n' +
        '    var __projPath2 = (window.__SCRATCH_ASSETS__ || {})[\'project.json\'];\n' +
        '    __projUrl = __projPath2 ? ((window.__CUDIC_BIN__ || {})[__projPath2] || __projPath2) : null;\n' +
        '  }\n' +
        '  if (__projUrl && /^https?:\\/\\//.test(__projUrl)) {\n' +
        '    fetch(__projUrl).then(function (r) { if (!r.ok) throw new Error(\'project fetch \' + r.status); return r.text(); })\n' +
        '      .then(function (t) { __start(JSON.parse(t)); })\n' +
        '      .catch(function (err) { fail(\'Could not load project data: \' + ((err && err.message) || err)); });\n' +
        '  } else { fail(\'Project data missing.\'); }\n' +
        '}\n' +
        '})();\n';
      const files = {
        'index.html': shell,
        'scratch.js': boot,
        'project.json': JSON.stringify(proj, null, 2),
        'assets.js': 'window.__SCRATCH_ASSETS__ = ' + safeAssets + ';\n'
      };
      await awardUser(user.id, 'bolt');
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        files, binaries, warnings,
        meta: { sprites: proj.targets.length, assets: assetCount, assetBytes, fullPlayer, title, dynamicAssets }
      }));
      return;
    } catch (e) {
      scratchFail(res, 500, 'Import failed while converting.');
      return;
    }
  }

  // ── API: account-bound game saves (one row per user+game) ────
  // Progress follows the login across days and devices. Seat-checked:
  // a kicked device gets 403 session_superseded, never a silent overwrite.
  // Games never call these directly (sandboxed iframes can't hold the
  // token) — view.html mediates via postMessage. 100KB cap per save.
  function playableGame(g, userId) {
    return !!g && (!!g.published || g.owner_id === userId);
  }
  if (url.pathname.startsWith('/api/saves/') && req.method === 'GET') {
    cors(res);
    const user = await requireUser(req, res); if (!user) return;
    if (!(await seatAlive(user.id, seatFromReq(req)))) { seatDead(res); return; }
    const gid = url.pathname.split('/')[3] || '';
    if (!isUuid(gid)) { res.writeHead(400, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'Invalid game.' })); return; }
    const { data: g } = await supabase.from('games').select('id, published, owner_id').eq('id', gid).single();
    if (!playableGame(g, user.id)) { res.writeHead(404, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'Not found.' })); return; }
    const { data: row } = await supabase.from('game_saves').select('data, updated_at').eq('user_id', user.id).eq('game_id', gid).single();
    if (!row) { res.writeHead(404, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'No save.' })); return; }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ data: row.data, updated_at: row.updated_at }));
    return;
  }
  if (url.pathname.startsWith('/api/saves/') && req.method === 'PUT') {
    cors(res);
    const user = await requireUser(req, res); if (!user) return;
    if (!(await seatAlive(user.id, seatFromReq(req)))) { seatDead(res); return; }
    if (!(await needVerified(user, res))) return;
    const gid = url.pathname.split('/')[3] || '';
    if (!isUuid(gid)) { res.writeHead(400, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'Invalid game.' })); return; }
    const { data: g } = await supabase.from('games').select('id, published, owner_id').eq('id', gid).single();
    if (!playableGame(g, user.id)) { res.writeHead(404, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'Not found.' })); return; }
    const body = await readBody(req).catch(() => ({}));
    const data = body.data;
    if (!data || typeof data !== 'object' || Array.isArray(data)) { res.writeHead(400, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'Save must be an object.' })); return; }
    if (JSON.stringify(data).length > 100 * 1024) { res.writeHead(400, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'Save too large (100KB max).' })); return; }
    const now = new Date().toISOString();
    const { error } = await supabase.from('game_saves').upsert(
      { user_id: user.id, game_id: gid, data, updated_at: now },
      { onConflict: 'user_id,game_id' }
    );
    // Ignoring this error told the client "saved" while the row was gone —
    // silent progress loss on any transient Supabase outage.
    if (error) {
      console.error('game_saves upsert error:', error.message);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Could not save — it stays on this device.' }));
      return;
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, updated_at: now }));
    return;
  }
  if (url.pathname.startsWith('/api/saves/') && req.method === 'DELETE') {
    cors(res);
    const user = await requireUser(req, res); if (!user) return;
    if (!(await seatAlive(user.id, seatFromReq(req)))) { seatDead(res); return; }
    if (!(await needVerified(user, res))) return;
    const gid = url.pathname.split('/')[3] || '';
    if (!isUuid(gid)) { res.writeHead(400, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'Invalid game.' })); return; }
    await supabase.from('game_saves').delete().eq('user_id', user.id).eq('game_id', gid);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true }));
    return;
  }

  // ── API: music tracks (Music Lab cloud saves — no downloads) ──
  // Same shape as game_saves: guests keep localStorage only, signed-in
  // users sync tracks to their account. 100KB cap per track.
  function musicData(body) {
    const title = String(body.title || '').trim().substring(0, 60) || 'Untitled track';
    const data = body.data;
    if (!data || typeof data !== 'object' || Array.isArray(data)) return { error: 'Track data must be an object.' };
    if (JSON.stringify(data).length > 100 * 1024) return { error: 'Track too large (100KB max).' };
    return { title, data };
  }
  // ── API: public music browse/search (no auth) ──────────────
  // Studio's Music tab and the CudicMusic game helper need other people's
  // tracks without a token. Names + titles only in the list; the per-track
  // endpoint is what players actually fetch. Never exposes owner ids.
  if (url.pathname === '/api/music/browse' && req.method === 'GET') {
    cors(res);
    const q = String(url.searchParams.get('q') || '').trim().replace(/[%_\\]/g, '').substring(0, 60);
    let limit = parseInt(url.searchParams.get('limit') || '30', 10); if (!(limit > 0)) limit = 30; if (limit > 40) limit = 40;
    let sel = supabase.from('music_tracks').select('id, title, updated_at, users(display_name)').order('updated_at', { ascending: false }).limit(limit);
    if (q) sel = sel.ilike('title', '%' + q + '%');
    const { data } = await sel;
    const tracks = (data || []).map(t => ({ id: t.id, title: t.title, owner: (t.users && t.users.display_name) || 'Cudic user', updated_at: t.updated_at }));
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ tracks }));
    return;
  }
  const musicPublicMatch = /^\/api\/music\/([^/]+)\/public$/.exec(url.pathname);
  if (musicPublicMatch && req.method === 'GET') {
    cors(res);
    const tid = musicPublicMatch[1];
    if (!isUuid(tid)) { res.writeHead(400, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'Invalid track.' })); return; }
    const { data: tr } = await supabase.from('music_tracks').select('id, title, data').eq('id', tid).single();
    if (!tr) { res.writeHead(404, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'Not found.' })); return; }
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=60' });
    res.end(JSON.stringify({ track: tr }));
    return;
  }
  if (url.pathname === '/api/music' && req.method === 'GET') {
    cors(res);
    const user = await requireUser(req, res); if (!user) return;
    const q = String(url.searchParams.get('q') || '').trim().replace(/[%_\\]/g, '').substring(0, 60);
    let limit = parseInt(url.searchParams.get('limit') || '50', 10); if (!(limit > 0)) limit = 50; if (limit > 50) limit = 50;
    let sel = supabase.from('music_tracks').select('id, title, updated_at').eq('owner_id', user.id).order('updated_at', { ascending: false }).limit(limit);
    if (q) sel = sel.ilike('title', '%' + q + '%');
    const { data } = await sel;
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ tracks: data || [] }));
    return;
  }
  if (url.pathname === '/api/music' && req.method === 'POST') {
    cors(res);
    const user = await requireUser(req, res); if (!user) return;
    if (!(await seatAlive(user.id, seatFromReq(req)))) { seatDead(res); return; }
    if (!(await needVerified(user, res))) return;
    const body = await readBody(req).catch(() => ({}));
    const m = musicData(body);
    if (m.error) { res.writeHead(400, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: m.error })); return; }
    const { data, error } = await supabase.from('music_tracks').insert({ owner_id: user.id, title: m.title, data: m.data }).select('id, title, updated_at').single();
    if (error || !data) { res.writeHead(500, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'Save failed.' })); return; }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ track: data }));
    return;
  }
  const musicMatch = /^\/api\/music\/([^/]+)$/.exec(url.pathname);
  if (musicMatch && ['GET', 'PUT', 'DELETE'].includes(req.method)) {
    cors(res);
    const user = await requireUser(req, res); if (!user) return;
    const tid = musicMatch[1];
    if (!isUuid(tid)) { res.writeHead(400, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'Invalid track.' })); return; }
    const { data: tr } = await supabase.from('music_tracks').select('*').eq('id', tid).single();
    if (!tr || tr.owner_id !== user.id) { res.writeHead(404, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'Not found.' })); return; }
    if (req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ track: { id: tr.id, title: tr.title, data: tr.data, updated_at: tr.updated_at } }));
      return;
    }
    if (!(await seatAlive(user.id, seatFromReq(req)))) { seatDead(res); return; }
    if (!(await needVerified(user, res))) return;
    if (req.method === 'DELETE') {
      await supabase.from('music_tracks').delete().eq('id', tid);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
      return;
    }
    const body = await readBody(req).catch(() => ({}));
    const updates = { updated_at: new Date().toISOString() };
    if (body.title !== undefined) updates.title = String(body.title).trim().substring(0, 60) || 'Untitled track';
    if (body.data !== undefined) {
      const m = musicData({ title: updates.title, data: body.data });
      if (m.error) { res.writeHead(400, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: m.error })); return; }
      updates.data = m.data;
    }
    const { data: nu, error } = await supabase.from('music_tracks').update(updates).eq('id', tid).select('id, title, updated_at').single();
    if (error || !nu) { res.writeHead(500, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'Save failed.' })); return; }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ track: nu }));
    return;
  }

  // ── API: creator dashboard stats (own projects only) ───────
  // One call powers the Your Projects overview: per-game plays/likes/
  // comments/forks, per-pack downloads/sales/revenue, coin balance +
  // recent receipts, and open reports against own content. Follow-up
  // queries stay scoped to the caller's own ids (never whole tables).
  // shortcut: like/comment/fork/sale lists cap at 5000 rows and counts
  // saturate there. Move to a count RPC if any creator ever passes that.
  if (url.pathname === '/api/creator/stats' && req.method === 'GET') {
    cors(res);
    const user = await requireUser(req, res); if (!user) return;
    const me = user.id;
    const [gamesRes, packsRes] = await Promise.all([
      supabase.from('games').select('id, title, published, play_count, updated_at').eq('owner_id', me).order('updated_at', { ascending: false }).limit(100),
      supabase.from('theme_packs').select('id, name, price, published, downloads').eq('owner_id', me).order('updated_at', { ascending: false }).limit(100),
    ]);
    const games = gamesRes.data || [], packs = packsRes.data || [];
    const gids = games.map(g => g.id), pids = packs.map(p => p.id);
    const [likeRows, commentRows, forkRows, ownRows, saleRows, ledgerRows, repRows] = await Promise.all([
      gids.length ? supabase.from('game_likes').select('game_id').in('game_id', gids).limit(5000) : Promise.resolve({ data: [] }),
      gids.length ? supabase.from('game_comments').select('game_id').in('game_id', gids).limit(5000) : Promise.resolve({ data: [] }),
      gids.length ? supabase.from('games').select('forked_from').in('forked_from', gids).limit(5000) : Promise.resolve({ data: [] }),
      pids.length ? supabase.from('pack_ownership').select('pack_id').in('pack_id', pids).limit(5000) : Promise.resolve({ data: [] }),
      supabase.from('coin_ledger').select('delta, ref_id').eq('user_id', me).eq('reason', 'pack_sale').limit(5000),
      supabase.from('coin_ledger').select('delta, reason, created_at').eq('user_id', me).order('created_at', { ascending: false }).limit(10),
      (gids.length || pids.length) ? supabase.from('reports').select('content_type').eq('status', 'open').in('content_id', [...gids, ...pids]).limit(200) : Promise.resolve({ data: [] }),
    ]);
    const countBy = (rows, key) => { const m = {}; for (const r of rows || []) { const k = r[key]; if (k) m[k] = (m[k] || 0) + 1; } return m; };
    const likes = countBy(likeRows.data, 'game_id'), comments = countBy(commentRows.data, 'game_id'),
      forks = countBy(forkRows.data, 'forked_from'), sales = countBy(ownRows.data, 'pack_id');
    const revenueBy = {};
    let packRevenue = 0;
    for (const r of saleRows.data || []) { if (r.ref_id) revenueBy[r.ref_id] = (revenueBy[r.ref_id] || 0) + (r.delta || 0); packRevenue += r.delta || 0; }
    const gameStats = games.map(g => ({ id: g.id, title: g.title, published: g.published, plays: g.play_count || 0, likes: likes[g.id] || 0, comments: comments[g.id] || 0, forks: forks[g.id] || 0, updated_at: g.updated_at }));
    const packStats = packs.map(p => ({ id: p.id, name: p.name, price: p.price, published: p.published, downloads: p.downloads || 0, sales: sales[p.id] || 0, revenue: revenueBy[p.id] || 0 }));
    const totals = {
      plays: gameStats.reduce((a, g) => a + g.plays, 0),
      likes: gameStats.reduce((a, g) => a + g.likes, 0),
      comments: gameStats.reduce((a, g) => a + g.comments, 0),
      forks: gameStats.reduce((a, g) => a + g.forks, 0),
      packDownloads: packStats.reduce((a, p) => a + p.downloads, 0),
      packSales: packStats.reduce((a, p) => a + p.sales, 0),
      packRevenue,
      openReports: (repRows.data || []).length,
    };
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ totals, games: gameStats, packs: packStats, coins: { balance: await coinBalance(me), receipts: ledgerRows.data || [] } }));
    return;
  }





  // ── API: delete comment (author or game owner) ────────────────
  if (url.pathname.startsWith('/api/comments/') && req.method === 'DELETE') {
    cors(res);
    const authHeader = req.headers.authorization || '';
    const token = authHeader.replace('Bearer ', '');
    if (!token) { res.writeHead(401, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'Unauthorized' })); return; }
    const { data: { user }, error: authErr } = await supabase.auth.getUser(token);
    if (authErr || !user) { res.writeHead(401, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'Unauthorized' })); return; }
    if (!(await needVerified(user, res))) return;
    const cid = url.pathname.split('/')[3];
    const { data: c } = await supabase.from('game_comments').select('id, user_id, game_id').eq('id', cid).single();
    if (!c) { res.writeHead(404, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'Not found' })); return; }
    let allowed = c.user_id === user.id;
    if (!allowed) {
      const { data: g } = await supabase.from('games').select('owner_id').eq('id', c.game_id).single();
      allowed = !!(g && g.owner_id === user.id);
    }
    if (!allowed) { res.writeHead(403, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'Forbidden' })); return; }
    await supabase.from('game_comments').delete().eq('id', cid);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true }));
    return;
  }

  // ── Favicon (inline SVG — one route covers every page, no 404 noise) ──
  if (url.pathname === '/favicon.ico') {
    fs.readFile(path.join(__dirname, 'public', 'cudic_sfsvg.svg'), (err, data) => {
      if (err) { res.writeHead(404); res.end(); return; }
      res.writeHead(200, { 'Content-Type': 'image/svg+xml', 'Cache-Control': 'public, max-age=86400' });
      res.end(data);
    });
    return;
  }

  // ── Redirect /chat to /chat.html ───────────────────────────────
  if (url.pathname === '/chat') {
    url.pathname = '/chat.html';
  }

  // ── Redirect /login to the sign-in screen (vanilla build; the
  // Next.js login export has a hydration bug that kills its handlers) ──
  if (url.pathname === '/login') {
    url.pathname = '/login.html';
  }

  // ── Redirect /welcome to the setup wizard ──────────────────────
  if (url.pathname === '/welcome') {
    url.pathname = '/welcome.html';
  }

  // ── Redirect /signup ──────────────────────────────────────────────
  if (url.pathname === '/signup') {
    url.pathname = '/signup.html';
  }

  // ── Redirect /profile to /profile.html ─────────────────────────
  if (url.pathname === '/profile') {
    url.pathname = '/profile.html';
  }

  // ── Phase 0: workbench scaffold (Vite build output, local-only for now)
  if (url.pathname === '/studio') {
    url.pathname = '/studio/index.html';
  }

  // ── Redirect /servers to /servers.html ─────────────────────────
  if (url.pathname === '/servers') {
    url.pathname = '/servers.html';
  }

  // ── Server space: /server/<id> → server.html (reads the id from the
  // path; ?id= also works). Same WS/lobby protocol as /chat underneath.
  if (url.pathname === '/server' || url.pathname.startsWith('/server/')) {
    url.pathname = '/server.html';
  }

  // ── Redirect /moderate to /moderate.html ───────────────────────
  if (url.pathname === '/moderate') {
    url.pathname = '/moderate.html';
  }
  if (url.pathname === '/grant') {
    url.pathname = '/grant.html';
  }
  if (url.pathname === '/updlog') {
    url.pathname = '/updlog.html';
  }

  // ── Redirect /forums to /forums.html ───────────────────────────
  if (url.pathname === '/forums') {
    url.pathname = '/forums.html';
  }
  // Thread permalinks: /forums/<id> is the shareable thread link.
  if (url.pathname.startsWith('/forums/')) {
    url.pathname = '/forums.html';
  }

  // ── Redirect /kit to /kit.html ─────────────────────────────────
  if (url.pathname === '/kit') {
    url.pathname = '/kit.html';
  }

  // ── Redirect /start to /start.html ─────────────────────────────
  if (url.pathname === '/start') {
    url.pathname = '/start.html';
  }

  // ── /lobbies is gone: send everyone to chat ────────────────────
  if (url.pathname === '/lobbies') {
    res.writeHead(302, { Location: '/chat' });
    res.end();
    return;
  }

  // ── Redirect /view to /view.html ──────────────────────────────
  // Share cards (/g/<slug>) bounce here; without this the player 404s.
  if (url.pathname === '/view') {
    url.pathname = '/view.html';
  }

  // ── Redirect /race to /race.html ──────────────────────────────
  if (url.pathname === '/race') {
    url.pathname = '/race.html';
  }

  // ── Redirect /games to /games.html ────────────────────────────
  if (url.pathname === '/games') {
    url.pathname = '/games.html';
  }

  // ── Redirect /creator to /creator.html ─────────────────────────
  if (url.pathname === '/creator') {
    url.pathname = '/creator.html';
  }

  // ── Redirect /friends to /friends.html ─────────────────────────
  if (url.pathname === '/friends') {
    url.pathname = '/friends.html';
  }

  // ── Redirect /ops to /ops.html ────────────────────────────────
  if (url.pathname === '/ops') {
    url.pathname = '/ops.html';
  }

  // ── Redirect /notifications to /notifications.html ────────────
  if (url.pathname === '/notifications') {
    url.pathname = '/notifications.html';
  }

  // ── Redirect /collections to /collections.html ────────────────
  if (url.pathname === '/collections') {
    url.pathname = '/collections.html';
  }

  // ── Redirect /themes to /themes.html ──────────────────────────
  if (url.pathname === '/themes') {
    url.pathname = '/themes.html';
  }

  // ── Redirect /quests to /quests.html ──────────────────────────
  if (url.pathname === '/quests') {
    url.pathname = '/quests.html';
  }

  // ── Redirect /shop to /shop.html (cosmetics) ────────────────
  if (url.pathname === '/shop') {
    url.pathname = '/shop.html';
  }

  // ── Redirect /docs to /docs.html ──────────────────────────────
  if (url.pathname === '/docs') {
    url.pathname = '/docs.html';
  }

  // ── Redirect /privacy to /privacy.html ─────────────────────────
  if (url.pathname === '/privacy') {
    url.pathname = '/privacy.html';
  }

  // ── Redirect /accessibility to /accessibility.html ─────────────
  if (url.pathname === '/accessibility') {
    url.pathname = '/accessibility.html';
  }

  // ── Redirect /faq to /faq.html ─────────────────────────────────
  if (url.pathname === '/faq') {
    url.pathname = '/faq.html';
  }

  // ── Redirect /parents and /teachers to the classroom landing ──
  if (url.pathname === '/parents' || url.pathname === '/teachers') {
    url.pathname = '/parents.html';
  }

  // ── Redirect /terms to /terms.html ─────────────────────────────
  if (url.pathname === '/terms') {
    url.pathname = '/terms.html';
  }

  // ── Redirect /embed to /embed.html ─────────────────────────────
  // (frameable cross-origin — see the X-Frame-Options exemption above)
  if (url.pathname === '/embed') {
    url.pathname = '/embed.html';
  }

  // ── Redirect /editor to /editor.html ──────────────────────────
  if (url.pathname === '/editor') {
    url.pathname = '/editor.html';
  }

  // ── Redirect /music to /music.html ───────────────────────────
  if (url.pathname === '/music') {
    url.pathname = '/music.html';
  }

  // ── /g/:id — the short shareable game link ────────────────────
  // Link scrapers (Discord, Slack, iMessage, X) run no JavaScript, so the
  // preview has to be real HTML served from here — /view is a static page and
  // cannot vary its og tags per game. Humans get bounced to the player.
  // /g/:id/thumb is the same bytes as the thumbnail endpoint, at a stable
  // share-host URL (the Vercel rewrite proxies both paths to this server).
  // ── /arcade — the crawlable index of every published game ────
  // /games is a JS shell, so a crawler that lands there sees no games and no
  // links. This page is plain HTML with one real link per card. It shares its
  // renderer with the Vercel build (lib/arcade.js) so both hosts agree.
  if (url.pathname === '/arcade' || url.pathname === '/arcade.html') {
    const host = String(req.headers['x-forwarded-host'] || req.headers.host || '').split(',')[0].trim();
    const isLocal = /^(localhost|127\.)/.test(host);
    const base = isLocal
      ? (req.socket.encrypted ? 'https://' : 'http://') + host
      : (process.env.PUBLIC_ORIGIN || 'https://cudic.vercel.app');
    const { data } = await supabase.from('games')
      .select('id, slug, title, description, tags, play_count, created_at, updated_at, thumbnail, users!owner_id(display_name)')
      .eq('published', true)
      .order('updated_at', { ascending: false })
      .limit(200);
    const html = renderArcade((data || []).map((g) => ({
      ...g,
      author: g.users && g.users.display_name,
      has_thumb: true
    })), { base });
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'public, max-age=300' });
    res.end(req.method === 'HEAD' ? undefined : html);
    return;
  }

  // ── /api/daily, /daily, /five ────────────────────────────────
  // The daily pick is a hash of the UTC date over the published games, so it
  // needs no rotation table and every host agrees. /five names five games
  // instead of showing a grid and hoping something catches.
  if (url.pathname === '/api/daily' || url.pathname === '/daily' || url.pathname === '/daily.html'
      || url.pathname === '/five' || url.pathname === '/five.html') {
    const host = String(req.headers['x-forwarded-host'] || req.headers.host || '').split(',')[0].trim();
    const isLocal = /^(localhost|127\.)/.test(host);
    const base = isLocal
      ? (req.socket.encrypted ? 'https://' : 'http://') + host
      : (process.env.PUBLIC_ORIGIN || 'https://cudic.vercel.app');
    const { data } = await supabase.from('games')
      .select('id, slug, title, description, tags, play_count, created_at, updated_at, thumbnail, users!owner_id(display_name)')
      .eq('published', true)
      .order('play_count', { ascending: false })
      .limit(500);
    const rows = (data || []).map((g) => ({
      ...g,
      author: g.users && g.users.display_name,
      has_thumb: true
    }));
    if (url.pathname === '/api/daily') {
      const pick = pickDaily(rows);
      const game = pick.game ? {
        id: pick.game.id,
        slug: pick.game.slug || null,
        title: pick.game.title || null,
        description: pick.game.description || null,
        url: '/g/' + encodeURIComponent(pick.game.slug || pick.game.id)
      } : null;
      res.writeHead(200, {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'public, max-age=60',
        'Access-Control-Allow-Origin': '*'
      });
      res.end(JSON.stringify({ date: dayKey(), number: pick.number, game }));
      return;
    }
    const html = url.pathname.indexOf('/five') === 0 ? renderFive(rows, { base }) : renderDaily(rows, { base });
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'public, max-age=300' });
    res.end(req.method === 'HEAD' ? undefined : html);
    return;
  }

  if (url.pathname.startsWith('/g/')) {
    const parts = url.pathname.slice(3).split('/');
    const raw = parts[0];
    // Resolve by slug (/g/snake) or id (/g/<uuid>); keep the URL as-is so
    // share cards and canonicals show the prettier slug when present.
    const isId = isUuid(raw);
    const query = supabase.from('games')
      .select('id, slug, title, description, thumbnail, published, users!games_owner_id_fkey(display_name)');
    // Slugs come from titles and are not unique in older rows ("untitled-project"
    // is claimed by nine games). .single() errors when a slug matches twice, and
    // that 404 used to take the share page *and* the card art down with it, so
    // take one published row deterministically instead.
    const { data: hits } = isId
      ? await query.eq('id', raw).limit(1)
      : await query.eq('slug', raw).order('published', { ascending: false }).order('created_at', { ascending: true }).limit(1);
    const g = hits && hits[0];
    if (!g || !g.published) {
      res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end('<!DOCTYPE html><meta charset="utf-8"><title>Game not found — Cudic</title><body style="font-family:sans-serif;background:#141414;color:#fff;display:grid;place-items:center;height:100vh;margin:0"><p>That game is not on Cudic. <a href="/games" style="color:#FF8C1A">Browse the gallery</a>.</p></body>');
      return;
    }
    const gid = g.slug || g.id;
    const attr = (s) => escHtml(s).replace(/"/g, '&quot;');
    if (parts[1] === 'thumb') {
      const m = typeof g.thumbnail === 'string' ? /^data:(image\/[a-z0-9.+-]+);base64,([A-Za-z0-9+/=]+)$/i.exec(g.thumbnail) : null;
      // Same fallback as /api/games/:id/thumbnail: this is the URL every card
      // and share preview points at, so it must never 404 for a live game.
      const buf = m ? Buffer.from(m[2], 'base64') : defaultThumb();
      res.writeHead(200, { 'Content-Type': m ? m[1] : defaultThumb.TYPE, 'Content-Length': buf.length, 'Cache-Control': 'public, max-age=86400' });
      res.end(buf);
      return;
    }
    const host = String(req.headers['x-forwarded-host'] || req.headers.host || '').split(',')[0].trim();
    // Share pages are proxied from Vercel, so the request host is the Render
    // host — canonical/OG URLs must name the public site instead. Locally the
    // request host is already right.
    const isLocal = /^(localhost|127\.)/.test(host);
    const base = isLocal
      ? (req.socket.encrypted ? 'https://' : 'http://') + host
      : (process.env.PUBLIC_ORIGIN || 'https://cudic.vercel.app');
    const viewUrl = '/view?id=' + g.id;
    const title = String(g.title || 'Untitled');
    const by = g.users && g.users.display_name ? ' by ' + g.users.display_name : '';
    const desc = String(g.description || '').trim().slice(0, 180) ||
      'Play ' + title + ' online — it opens immediately, no download. Made with Cudic Studio.';
    const titleShort = title.slice(0, 70);
    const img = g.thumbnail ? base + '/g/' + gid + '/thumb' : base + '/og.png?v=2';
    const page = '<!DOCTYPE html><html lang="en"><head><meta charset="utf-8">'
      + '<meta name="viewport" content="width=device-width,initial-scale=1">'
      + '<script async src="https://www.googletagmanager.com/gtm.js?id=GTM-PSGJNQWB"><\/script>'
      + '<script>window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}gtag("js",new Date());<\/script>'
      + '<title>' + escHtml(titleShort) + ' — play on Cudic</title>'
      + '<meta name="description" content="' + attr(desc) + '">'
      + '<link rel="canonical" href="' + attr(base + '/g/' + gid) + '">'
      + '<meta property="og:type" content="website">'
      + '<meta property="og:site_name" content="Cudic">'
      + '<meta property="og:url" content="' + attr(base + '/g/' + gid) + '">'
      + '<meta property="og:title" content="' + attr(titleShort + ' — play on Cudic') + '">'
      + '<meta property="og:description" content="' + attr(desc) + '">'
      + '<meta property="og:image" content="' + attr(img) + '">'
      + '<meta name="twitter:card" content="summary_large_image">'
      + '<meta name="twitter:title" content="' + attr(titleShort + ' — play on Cudic') + '">'
      + '<meta name="twitter:description" content="' + attr(desc) + '">'
      + '<meta name="twitter:image" content="' + attr(img) + '">'
      + '<script>location.replace(' + JSON.stringify(viewUrl) + ')</script>'
      + '<noscript><meta http-equiv="refresh" content="0;url=' + attr(viewUrl) + '"></noscript>'
      + '<style>body{font-family:system-ui,sans-serif;background:#141414;color:#fff;margin:0;display:grid;place-items:center;min-height:100vh}'
      + 'main{text-align:center;padding:24px;max-width:420px}img{max-width:100%;border-radius:10px;border:1px solid #343434;margin-bottom:16px}'
      + 'h1{font-size:1.3rem;margin:0 0 6px}p{color:#a6a6a6;font-size:.9rem;margin:0 0 18px}'
      + 'a{display:inline-block;background:#FF8C1A;color:#141414;font-weight:700;text-decoration:none;padding:10px 18px;border-radius:8px}</style>'
      + '</head><body><main>'
      + (g.thumbnail ? '<img src="/g/' + gid + '/thumb" alt="">' : '')
      + '<h1>' + escHtml(title) + '</h1><p>' + escHtml(desc) + ' Opening the player…</p>'
      + '<a href="' + attr(viewUrl) + '">Play ' + escHtml(titleShort) + by + '</a>'
      + '</main></body></html>';
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'public, max-age=120' });
    res.end(page);
    return;
  }
  let filePath = path.join(__dirname, 'public', url.pathname === '/' ? 'index.html' : url.pathname);
  // Directory URLs (/cookbook/, /game/<id>/) resolve to their index.html on
  // Vercel; mirror that here so local testing sees the same pages.
  if (url.pathname !== '/' && url.pathname.endsWith('/')) filePath = path.join(filePath, 'index.html');
  const ext = path.extname(filePath);

  fs.readFile(filePath, (err, data) => {
    if (err) {
      // Missing pages get the 404 screen; missing assets/APIs keep their plain/JSON reply.
      const isApi = url.pathname.startsWith('/api/');
      const wantsPage = (!ext || ext === '.html') && (req.method === 'GET' || req.method === 'HEAD');
      if (!isApi && wantsPage) {
        fs.readFile(path.join(__dirname, 'public', '404.html'), (e2, page) => {
          if (e2) { res.writeHead(404, { 'Content-Type': 'text/plain' }); res.end('Not found'); return; }
          res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
          res.end(req.method === 'HEAD' ? undefined : page);
        });
        return;
      }
      res.writeHead(404, { 'Content-Type': isApi ? 'application/json' : 'text/plain' });
      res.end(isApi ? JSON.stringify({ error: 'Not found.' }) : 'Not found');
      return;
    }
    const headers = { 'Content-Type': MIME[ext] || 'application/octet-stream' };
    if (ext === '.html') headers['Cache-Control'] = 'no-store';
    // ── Share cards on the normal play link ──────────────────────
    // /g/:id serves scraper-friendly HTML, but the URL people copy from
    // the address bar is /view.html?id=…, whose static head unfurled with
    // the generic Cudic card. Rewrite the per-game meta tags at serve
    // time so Discord/X see the real title, description and card art.
    // Best-effort: bad id / unpublished / a slip in decorateViewHead →
    // the file is served untouched.
    if (url.pathname === '/view.html' && (req.method === 'GET' || req.method === 'HEAD')) {
      decorateViewHead(req, url, data)
        .then((html) => { res.writeHead(200, headers); res.end(req.method === 'HEAD' ? undefined : html); })
        .catch(() => { res.writeHead(200, headers); res.end(req.method === 'HEAD' ? undefined : data); });
      return;
    }
    // Hashed studio bundles are content-addressed — safe to cache forever.
    // (index.html itself stays no-store: it points at the latest hashes.)
    // Same for the exported landing (_next) and its 3D models.
    if (ext !== '.html' && (filePath.includes(`${path.sep}studio${path.sep}`) || filePath.includes(`${path.sep}_next${path.sep}`) || filePath.includes(`${path.sep}models${path.sep}`))) {
      headers['Cache-Control'] = 'public, max-age=31536000, immutable';
    }
    res.writeHead(200, headers);
    res.end(data);
  });
}
// Share-card meta lives in lib/share-card.js; 60s cache stays per-process.
const { decorateViewHead } = require('./lib/share-card')(supabase);
const renderArcade = require('./lib/arcade');
// "More like this" ranking, shared with tools/prerender-games.mjs.
const { rankRelated } = require('./lib/related');
// Daily challenge and the curated five share one renderer (lib/daily.js).
const { renderDaily, renderFive, pickDaily, dayKey } = require('./lib/daily');

// One entry file for hosts that only accept a single HTML upload (itch.io,
// CrazyGames). Local scripts and stylesheets are inlined in place; assets stay
// absolute URLs because base64 would turn a 2MB game into a 3MB one.
function singleFileBuild(files, meta) {
  meta = meta || {};
  const bodies = files || {};
  const norm = (p) => String(p || '').replace(/^\.?\//, '').split('?')[0];
  let entry = bodies['index.html'] || bodies['game.html'];
  if (typeof entry !== 'string') {
    const scripts = Object.keys(bodies).filter((p) => /\.js$/i.test(p));
    entry = '<!DOCTYPE html><meta charset="utf-8"><title>' + String(meta.title || 'Game').replace(/[<>&]/g, '') + '</title>'
      + '<canvas id="game"></canvas>'
      + scripts.map((p) => '<script src="' + norm(p) + '"><\/script>').join('');
  }
  let out = String(entry);
  out = out.replace(/<script\b([^>]*?)\bsrc\s*=\s*["']([^"']+)["']([^>]*)><\/script>/gi, (m, pre, src, post) => {
    const key = norm(src);
    if (!Object.prototype.hasOwnProperty.call(bodies, key)) return m;
    return '<script' + pre + post + '>\n' + String(bodies[key]).replace(/<\/script>/gi, '<\\/script>') + '\n</script>';
  });
  out = out.replace(/<link\b([^>]*?)href\s*=\s*["']([^"']+)["']([^>]*)>/gi, (m, pre, href, post) => {
    if (!/stylesheet/i.test(pre + post)) return m;
    const key = norm(href);
    if (!Object.prototype.hasOwnProperty.call(bodies, key)) return m;
    return '<style>\n' + String(bodies[key]) + '\n</style>';
  });
  const credit = '<!-- ' + (meta.title || 'A game') + (meta.author ? ' by ' + meta.author : '')
    + ' — built on Cudic (cudic.vercel.app). Keep this credit if you repost it. -->\n'
    + '<meta name="generator" content="Cudic">\n';
  out = out.replace(/<head([^>]*)>/i, (m) => m + '\n' + credit);
  return out;
}

// ── WebSocket server ─────────────────────────────────────────────
const wss = new WebSocketServer({ server });

// lobby name → Set of { username, ws, userId }
const lobbies = new Map();

// ws → { username, lobby, userId }
const clients = new Map();

// All connected WebSocket connections (including homepage watchers)
const allConnections = new Set();

// ── In-game multiplayer rooms ─────────────────────────────────────
// `game:room` → Set of { ws, id, name }. Deliberately anonymous: anyone
// playing a published game can join, same stance as play counts. The caps
// below are what keep it from being a free relay between strangers.
const gameRooms = new Map();
const gameMulti = new Map(); // ws → { room, id }
const GAME_ROOM_MAX = 32;
const GAME_PAYLOAD_MAX = 8 * 1024;
let wsSeq = 0;

// `userId` is the account behind a peer when they are signed in (the game page
// reports players by account, so it needs a real target). Guests have none.
function gamePeers(room) {
  return [...room].map((e) => ({ id: e.id, name: e.name, userId: e.userId || null }));
}

// How many people are in this game right now, across every room code. Reads
// the live relay map — nothing stored, nothing to expire.
function liveCount(game) {
  let n = 0;
  for (const [key, room] of gameRooms) {
    if (key.startsWith(game + ':')) n += room.size;
  }
  return n;
}

function broadcastGame(roomKey, msg, excludeWs = null) {
  const room = gameRooms.get(roomKey);
  if (!room) return;
  const data = JSON.stringify(msg);
  for (const e of room) {
    if (e.ws !== excludeWs && e.ws.readyState === 1) e.ws.send(data);
  }
}

function leaveGame(ws) {
  const cur = gameMulti.get(ws);
  if (!cur) return;
  gameMulti.delete(ws);
  const room = gameRooms.get(cur.room);
  if (!room) return;
  for (const e of room) {
    if (e.ws === ws) { room.delete(e); break; }
  }
  if (room.size === 0) gameRooms.delete(cur.room);
  else broadcastGame(cur.room, { type: 'multi_peers', peers: gamePeers(room) });
}

function broadcast(lobbyName, msg, excludeWs = null) {
  const room = lobbies.get(lobbyName);
  if (!room) return;
  const data = JSON.stringify(msg);
  for (const client of room) {
    if (client.ws !== excludeWs && client.ws.readyState === 1) {
      client.ws.send(data);
    }
  }
}

function getLobbyList() {
  const list = [];
  for (const [name, users] of lobbies) {
    // Hide server lobbies, DMs and private channels from public Active
    // lobbies: dm:/chan: names carry user UUIDs — never broadcast them.
    if (name.startsWith('server:') || name.startsWith('dm:') || name.startsWith('chan:')) continue;
    // Hide empty and ghost lobbies
    if (!users || users.size === 0) { lobbies.delete(name); continue; }
    list.push({ name, count: users.size });
  }
  return list.filter(l => l.count > 0);
}

function sendLobbyListToAll() {
  const list = getLobbyList();
  const data = JSON.stringify({ type: 'lobby_list', lobbies: list });
  for (const ws of allConnections) {
    if (ws.readyState === 1) {
      ws.send(data);
    }
  }
}

// ── Single-seat sessions ──────────────────────────────────────────
// One live seat per account. The client mints a random seat id at login
// (localStorage `cudic_seat`) and heartbeats it; a different fresh seat
// means another device took over. No row = grandfathered free pass, so the
// rollout never surprise-kicks anyone. Tabs share one login and elect a
// leader client-side; the server can't tell tabs apart.
const SEAT_TTL_MS = 90 * 1000;
function seatFromReq(req) {
  return String(req.headers['x-seat'] || '').substring(0, 64);
}
// Daily streak lives in lib/streak.js — two user-row reads and one coin grant.
const { rollStreak } = require('./lib/streak')(supabase);

async function claimSeatRow(userId, seatId) {
  await supabase.from('active_sessions').upsert(
    { user_id: userId, seat_id: seatId, heartbeat_at: new Date().toISOString() },
    { onConflict: 'user_id' }
  );
}
async function seatAlive(userId, seatId) {
  if (!seatId) return true;
  const { data: row } = await supabase.from('active_sessions')
    .select('seat_id, heartbeat_at').eq('user_id', userId).single();
  if (!row) return true;
  if (row.seat_id !== seatId) {
    return (Date.now() - new Date(row.heartbeat_at).getTime()) > SEAT_TTL_MS;
  }
  return true;
}
function seatDead(res) {
  res.writeHead(403, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'session_superseded' }));
}

// Save message to Supabase (fire and forget)
async function saveMessage(lobbyName, userId, displayName, text) {
  try {
    // Get or create lobby
    let { data: lobby, error: lobbyErr } = await supabase
      .from('lobbies')
      .select('id')
      .eq('name', lobbyName)
      .maybeSingle();
    if (lobbyErr) console.error('saveMessage lobby lookup:', lobbyErr.message);

    if (!lobby) {
      // Chat history is permanent everywhere — nothing sweeps messages.
      const kind = lobbyName.startsWith('dm:') ? 'dm' : 'channel';
      const { data: newLobby, error: createErr } = await supabase
        .from('lobbies')
        .upsert({ name: lobbyName, persistent: true, kind, created_by: userId || null }, { onConflict: 'name' })
        .select('id')
        .single();
      if (createErr) console.error('saveMessage lobby create:', createErr.message);
      lobby = newLobby;
    }

    if (lobby) {
      const { data: saved, error: msgErr } = await supabase.from('messages').insert({
        lobby_id: lobby.id,
        user_id: userId || null,
        display_name: displayName,
        text,
      }).select('id').single();
      if (msgErr) console.error('saveMessage insert:', msgErr.message, { lobbyName, userId });
      if (saved) return saved;
      // Activity trickle: first 10 messages each UTC day earn 1 coin.
      // Best-effort only — never blocks or breaks the save above.
      if (userId) {
        try {
          const dayStart = new Date().toISOString().slice(0, 10) + 'T00:00:00.000Z';
          const { count } = await supabase.from('coin_ledger').select('id', { count: 'exact', head: true }).eq('user_id', userId).eq('reason', 'activity').gte('created_at', dayStart);
          if ((count || 0) < 10) await supabase.rpc('grant_coins', { p_user: userId, p_delta: 1, p_reason: 'activity', p_ref: null });
        } catch {}
      }
    }
  } catch (err) {
    console.error('Failed to save message:', err.message);
  }
}

// owner | member | mod | null for a server (module scope: used by HTTP + WS)
// Channel context for the WS chat path: slow seconds + server id, key
// by room name. 30s TTL — setting a new slow mode lands within a breath.
const chanCtxCache = new Map();
const lastSay = Object.create(null);
async function channelContext(name) {
  if (!name) return null;
  const hit = chanCtxCache.get(name);
  if (hit && (Date.now() - hit.ts < 30000)) return hit.v;
  let v = null;
  try {
    const { data: lob } = await supabase.from('lobbies').select('id, kind, server_id, slow_seconds').eq('name', name).single();
    if (lob) v = lob;
  } catch {}
  chanCtxCache.set(name, { v, ts: Date.now() });
  return v;
}

// owner | member | null for a server (module scope: used by HTTP + WS)
async function serverRole(me, serverId) {
  const { data: srv } = await supabase.from('servers').select('id, visibility, owner_id, rules').eq('id', serverId).single();
  if (!srv) return { server: null, role: null };
  if (srv.owner_id === me) return { server: srv, role: 'owner' };
  const { data: m } = await supabase.from('server_members').select('role').eq('server_id', serverId).eq('user_id', me).single();
  return { server: srv, role: m ? m.role : null };
}

// can this user open this conversation? (module scope: used by HTTP + WS)
async function canSeeLobby(me, lobby) {
  if (!lobby) return false;
  if (lobby.kind === 'dm') {
    const { data } = await supabase.from('conversation_members').select('user_id').eq('lobby_id', lobby.id).eq('user_id', me).single();
    return !!data;
  }
  if (lobby.kind === 'channel') {
    const { server, role } = await serverRole(me, lobby.server_id);
    if (!server) return false;
    if (role === 'owner') return true;
    // Rules screening: members who haven't accepted see nothing until they do.
    if (server.rules) {
      const { data: mem } = await supabase.from('server_members').select('rules_accepted_at').eq('server_id', server.id).eq('user_id', me).single();
      if (!mem || !mem.rules_accepted_at) return false;
    }
    if (!lobby.is_private) {
      if (server.visibility === 'public') return true;
      return !!role;
    }
    const { data } = await supabase.from('conversation_members').select('user_id').eq('lobby_id', lobby.id).eq('user_id', me).single();
    return !!data;
  }
  return true;
}

// Does this user owe a rules-accept for this conversation's server?
// (module scope: lets the WS join reply with a actionable code, not just 404)
async function needsRulesAccept(me, lobby) {
  if (!lobby || lobby.kind !== 'channel' || !lobby.server_id) return false;
  const { data: srv } = await supabase.from('servers').select('id, rules, owner_id').eq('id', lobby.server_id).single();
  if (!srv || !srv.rules || srv.owner_id === me) return false;
  const { data: mem } = await supabase.from('server_members').select('rules_accepted_at').eq('server_id', srv.id).eq('user_id', me).single();
  return !mem || !mem.rules_accepted_at;
}

// Tell every open client its conversation list may be stale.
// Trailing throttle: bursts of joins/leaves fan out at most one message
// per 5s instead of one per event.
let convDirtyLast = 0, convDirtyTimer = null;
function sendConversationsDirty() {
  const now = Date.now();
  if (now - convDirtyLast < 5000) {
    if (!convDirtyTimer) convDirtyTimer = setTimeout(() => { convDirtyTimer = null; sendConversationsDirty(); }, 5000 - (now - convDirtyLast));
    return;
  }
  convDirtyLast = now;
  const data = JSON.stringify({ type: 'conversation_dirty' });
  for (const ws of allConnections) {
    if (ws.readyState === 1) { try { ws.send(data); } catch (e) {} }
  }
}

wss.on('connection', (ws, req) => {
  // Track all connections for lobby list broadcasts
  allConnections.add(ws);
  const ip = clientIp(req);
  // Per-connection rate-limit key: a game room's fair-use budget belongs to the
  // player, not to everyone sharing their IP.
  ws._mid = 'w' + (++wsSeq);

  // Send current lobby list immediately
  ws.send(JSON.stringify({ type: 'lobby_list', lobbies: getLobbyList() }));

  ws.on('message', async (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }

    // ── Join a lobby ──────────────────────────────────────────────
    if (msg.type === 'join') {
      const lobby = (msg.lobby || '').trim();
      if (!lobby || !validName(lobby)) {
        ws.send(JSON.stringify({ type: 'error', text: 'Invalid conversation.' }));
        return;
      }
      // Strict sign-in: verify the session, then derive identity server-side.
      // Client-supplied username/userId are ignored (no impersonation).
      var authed = null;
      try {
        const tok = String(msg.token || '').replace('Bearer ', '');
        if (tok) {
          const { data: { user: u }, error: uerr } = await supabase.auth.getUser(tok);
          if (!uerr && u) {
            const { data: prof } = await supabase.from('users').select('display_name, avatar_url').eq('id', u.id).single();
            authed = { id: u.id, name: (prof && prof.display_name) || String(u.email || 'Someone').split('@')[0], avatar: (prof && prof.avatar_url) || null, confirmed: !userUnconfirmed(u) };
          }
        }
      } catch (e) {}
      if (!authed) {
        ws.send(JSON.stringify({ type: 'error', text: 'Sign in required.' }));
        return;
      }
      const wseat = String(msg.seat || '').substring(0, 64);
      if (!(await seatAlive(authed.id, wseat))) {
        ws.send(JSON.stringify({ type: 'superseded' }));
        return;
      }
      if (!authed.confirmed) {
        ws.send(JSON.stringify({ type: 'error', code: 'email_unconfirmed', text: 'Confirm your email to chat.' }));
        return;
      }
      const { data: lobbyRow } = await supabase.from('lobbies').select('id, name, kind, server_id, is_private').eq('name', lobby).single();
      if (!lobbyRow || !(await canSeeLobby(authed.id, lobbyRow))) {
        if (lobbyRow && await needsRulesAccept(authed.id, lobbyRow)) {
          ws.send(JSON.stringify({ type: 'error', code: 'rules_required', serverId: lobbyRow.server_id, text: 'Accept the server rules first.' }));
        } else {
          ws.send(JSON.stringify({ type: 'error', text: 'Conversation not found.' }));
        }
        return;
      }
      const username = authed.name;
      const userId = authed.id;

      // Leave current lobby if any
      const prev = clients.get(ws);
      if (prev) {
        const prevRoom = lobbies.get(prev.lobby);
        if (prevRoom) {
          for (const client of prevRoom) {
            if (client.ws === ws) {
              prevRoom.delete(client);
              break;
            }
          }
                    if (prevRoom.size === 0) lobbies.delete(prev.lobby);
        }
      }

      // Join new lobby — remove any existing entries with same username first
      if (!lobbies.has(lobby)) {
        lobbies.set(lobby, new Set());
      }
      const room = lobbies.get(lobby);
      for (const existing of room) {
        if (existing.username.toLowerCase() === username.toLowerCase()) {
          room.delete(existing);
          try { existing.ws.close(); } catch {}
        }
      }
      const entry = { username, ws, userId, avatar: authed.avatar };
      room.add(entry);
      clients.set(ws, { username, lobby, userId, avatar: authed.avatar, seat: wseat, confirmed: authed.confirmed });

      // Confirm join to this client
      ws.send(JSON.stringify({ type: 'joined', lobby, username }));

      // Notify others in lobby
      broadcast(lobby, { type: 'user_join', username }, ws);

      // Send user list to everyone in lobby
      const users = [...lobbies.get(lobby)].map(c => c.username);
      broadcast(lobby, { type: 'user_list', users });

      // Update lobby list for everyone
      sendLobbyListToAll();
      return;
    }

    // ── Chat message ─────────────────────────────────────────────
    if (msg.type === 'message') {
      const info = clients.get(ws);
      if (!info) return;
      if (!(await seatAlive(info.userId, info.seat))) {
        ws.send(JSON.stringify({ type: 'superseded' }));
        return;
      }
      if (!info.confirmed) {
        ws.send(JSON.stringify({ type: 'error', code: 'email_unconfirmed', text: 'Confirm your email to chat.' }));
        return;
      }
      const chatBanRow = await activeBan(info.userId, 'chat');
      if (chatBanRow) {
        ws.send(JSON.stringify({ type: 'error', code: 'chat_banned', text: 'You are muted from chat until ' + new Date(chatBanRow.banned_until).toLocaleString() + (chatBanRow.reason ? ' — ' + chatBanRow.reason : '') + '.' }));
        return;
      }
      const text = (msg.text || '').trim();
      if (!text) return;
      // Flood guard per account: 60 msgs/10s is room-window, not machine-gun.
      if (!rateLimit('chat:' + info.userId, 60, 10 * 1000)) {
        ws.send(JSON.stringify({ type: 'error', code: 'chat_slow', text: 'Slow down — too many messages at once.' }));
        return;
      }

      // Channel context (slow mode + server gate), TTL-cached per room name
      // — one small query per 30s per active room, not per message.
      if (typeof channelContext === 'function') {
        const ctx = await channelContext(info.lobby);
        if (ctx) {
          if (ctx.kind === 'channel' && ctx.server_id) {
            const { role: wsRole } = await serverRole(info.userId, ctx.server_id);
            if (!wsRole) {
              ws.send(JSON.stringify({ type: 'error', code: 'not_member', text: 'You are no longer in this server.' }));
              return;
            }
          }
          const slow = ctx.slow_seconds || 0;
          if (slow > 0) {
            const skey = info.userId + '|' + info.lobby;
            const now = Date.now();
            const last = (typeof lastSay === 'object' && lastSay[skey]) || 0;
            if (now - last < slow * 1000) {
              ws.send(JSON.stringify({ type: 'error', code: 'slow_mode', text: 'Slow mode on — wait ' + Math.ceil((slow * 1000 - (now - last)) / 1000) + 's before sending again.' }));
              return;
            }
            lastSay[skey] = now;
          }
        }
      }

      const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

      // Client correlation id (safe chars only): lets every viewer patch
      // the live message with its saved row id for reporting, without
      // awaiting the insert before broadcast (chat latency unchanged).
      const cid = (typeof msg.cid === 'string' ? msg.cid : '').replace(/[^A-Za-z0-9-]/g, '').substring(0, 32) || null;
      broadcast(info.lobby, {
        type: 'message',
        lobby: info.lobby,
        username: info.username,
        user_id: info.userId,
        avatar_url: info.avatar || null,
        text,
        time,
        ts: new Date().toISOString(),
        cid,
      });

      // Persist to database, then tell the room the saved row id.
      saveMessage(info.lobby, info.userId, info.username, text).then((row) => {
        if (row && row.id && cid) broadcast(info.lobby, { type: 'message_saved', lobby: info.lobby, cid, id: row.id });
      }).catch((e) => { console.error('saveMessage failed:', e && e.message); });
      // Everyone else's sidebar (previews, unread, order) may be stale
      sendConversationsDirty();
      return;
    }

    // ── Typing indicator ─────────────────────────────────────────
    if (msg.type === 'typing') {
      const info = clients.get(ws);
      if (!info) return;
      // Light cap on typing churn: it is a pure fan-out broadcast.
      if (rateLimit('typ:' + info.userId, 30, 10000)) broadcast(info.lobby, { type: 'typing', lobby: info.lobby, username: info.username }, ws);
      return;
    }

    // ── In-game multiplayer ───────────────────────────────────────
    // No token required: a room only carries game traffic, so guests may play
    // along (chat's sign-in gate exists to keep messages attributable). A token
    // is optional and only upgrades you from 'Guest' to your profile name.
    if (msg.type === 'multi_join') {
      const game = String(msg.game || '').replace(/[^A-Za-z0-9_-]/g, '').substring(0, 48);
      const roomName = String(msg.room || 'main').replace(/[^A-Za-z0-9_-]/g, '').substring(0, 24) || 'main';
      if (!game) return;
      // Fair-use limits are per connection; the IP buckets are just a backstop
      // against one host opening a fleet of sockets. Keying only by IP made a
      // whole school (one NAT address) share one budget.
      if (!rateLimit('mj:' + ws._mid, 20, 60000) || !rateLimit('gj:' + ip, 400, 60000)) {
        ws.send(JSON.stringify({ type: 'multi_error', text: 'Too many joins — slow down.' }));
        return;
      }
      leaveGame(ws); // one room per socket
      const roomKey = game + ':' + roomName;
      let room = gameRooms.get(roomKey);
      if (!room) { room = new Set(); gameRooms.set(roomKey, room); }
      if (room.size >= GAME_ROOM_MAX) {
        ws.send(JSON.stringify({ type: 'multi_error', text: 'This game is full right now.' }));
        return;
      }
      // A requested id is honoured unless it is already taken in this room, so
      // a peer cannot clone someone else's identity to confuse their client.
      // (A reconnect reuses its own id: the old socket is gone by then.)
      let id = String(msg.id || '').replace(/[^A-Za-z0-9]/g, '').substring(0, 24);
      if (!id || [...room].some((e) => e.id === id)) id = 'p' + Math.random().toString(36).slice(2, 10);
      // Name and account come from the token, never from the client, so a
      // signed-in player is their real profile name and cannot be impersonated.
      let userId = null, name = 'Guest';
      if (msg.token) {
        const { data: { user: mu } } = await supabase.auth.getUser(String(msg.token));
        if (mu) {
          const { data: prof } = await supabase.from('users').select('display_name').eq('id', mu.id).single();
          userId = mu.id;
          name = (prof && prof.display_name) || String(mu.email || '').split('@')[0] || 'Guest';
        }
      }
      name = name.replace(/[\u0000-\u001f<>]/g, '').trim().substring(0, 24) || 'Guest';
      room.add({ ws, id, name, userId });
      gameMulti.set(ws, { room: roomKey, id });
      ws.send(JSON.stringify({ type: 'multi_joined', game, room: roomName, id, name, peers: gamePeers(room) }));
      broadcastGame(roomKey, { type: 'multi_peers', peers: gamePeers(room) }, ws);
      return;
    }

    if (msg.type === 'multi_msg') {
      const cur = gameMulti.get(ws);
      if (!cur) return;
      // 20 messages/second per connection covers ~10Hz state updates with
      // headroom; the IP bucket only catches many-socket floods.
      if (!rateLimit('mm:' + ws._mid, 200, 10000) || !rateLimit('gm:' + ip, 8000, 10000)) return;
      const payload = JSON.stringify(msg.data === undefined ? null : msg.data);
      if (payload == null || payload.length > GAME_PAYLOAD_MAX) return;
      broadcastGame(cur.room, { type: 'multi_msg', from: cur.id, data: msg.data }, ws);
      return;
    }

    if (msg.type === 'multi_leave') {
      leaveGame(ws);
      return;
    }

    // ── Request lobby list refresh ────────────────────────────────
    if (msg.type === 'get_lobbies') {
      ws.send(JSON.stringify({ type: 'lobby_list', lobbies: getLobbyList() }));
      return;
    }
  });

  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });

  ws.on('close', () => {
    allConnections.delete(ws);
    leaveGame(ws);
    // Per-connection buckets die with the connection: their keys are unique per
    // socket, so they would pile up forever otherwise.
    rateBuckets.delete('mj:' + ws._mid);
    rateBuckets.delete('mm:' + ws._mid);
    const info = clients.get(ws);
    if (info) {
      const room = lobbies.get(info.lobby);
      if (room) {
        for (const client of room) {
          if (client.ws === ws) {
            room.delete(client);
            break;
          }
        }
        
        const users = [...room].map(c => c.username);
        broadcast(info.lobby, { type: 'user_list', users });

        if (room.size === 0) lobbies.delete(info.lobby);
      }
      clients.delete(ws);
      sendLobbyListToAll();
    }
  });
});

// ── Heartbeat: kill dead connections every 5s ─────────────────────
setInterval(() => {
  for (const ws of allConnections) {
    if (ws.isAlive === false) {
      allConnections.delete(ws);
      leaveGame(ws);
      rateBuckets.delete('mj:' + ws._mid);
      rateBuckets.delete('mm:' + ws._mid);
      const info = clients.get(ws);
      if (info) {
        const room = lobbies.get(info.lobby);
        if (room) {
          for (const client of room) {
            if (client.ws === ws) {
              room.delete(client);
              break;
            }
          }
                    const users = [...room].map(c => c.username);
          broadcast(info.lobby, { type: 'user_list', users });
          if (room.size === 0) lobbies.delete(info.lobby);
        }
        clients.delete(ws);
      }
      ws.terminate();
      continue;
    }
    ws.isAlive = false;
    try { ws.ping(); } catch {}
  }
  sendLobbyListToAll();
}, 5000);

// ── Weekly creator race ──────────────────────────────────────────
// One point per unique player per published game per week (Monday 00:00
// UTC — the same boundary the jam and this digest use). Viewers are
// salted IP hashes. Settlement is lazy + idempotent: the race_weeks row
// (its primary key IS the week) is written FIRST, then coins/badges — a
// repeated settle can never double-pay.
const RACE_PRIZES = { 1: 500, 2: 300, 3: 150 };
async function raceTop(week, limit, meId) {
  let data;
  try { ({ data } = await supabase.from('race_plays').select('creator_id, game_id, viewer').eq('week', week).limit(20000)); } catch (e) { return null; }
  const counts = new Map();
  for (const r of data || []) counts.set(r.creator_id, (counts.get(r.creator_id) || 0) + 1);
  const ids = [...counts.keys()];
  if (!ids.length) return { top: [], me: null, total: 0 };
  const { data: users } = await supabase.from('users').select('id, display_name, user_id').in('id', ids);
  const byId = new Map((users || []).map(u => [u.id, u]));
  const scored = ids.map(id => ({ id, points: counts.get(id), u: byId.get(id) }))
    .sort((a, b) => b.points - a.points || String(a.id).localeCompare(String(b.id)));
  const top = scored.slice(0, limit || 20).map((x, i) => ({ place: i + 1, uid: x.id, name: (x.u && x.u.display_name) || 'Unknown', num: (x.u && x.u.user_id) || null, points: x.points }));
  const mine = meId ? scored.findIndex(x => x.id === meId) : -1;
  return { top, me: mine === -1 ? null : { place: mine + 1, points: scored[mine].points }, total: scored.length };
}
async function raceSettleWeek(week) {
  try {
    const r = await raceTop(week, 3);
    const top = r ? r.top : [];
    const ins = await supabase.from('race_weeks').insert({ week, top });
    if (ins.error) return; // already settled, or no table (migration pending)
    for (const t of top) {
      const coins = RACE_PRIZES[t.place];
      if (coins) {
        try { await supabase.rpc('grant_coins', { p_user: t.uid, p_delta: coins, p_reason: 'race:' + week, p_ref: null }); }
        catch (e) { console.error('race payout:', e && e.message); }
      }
      await awardUser(t.uid, t.place === 1 ? 'race_winner' : 'race_top3').catch(() => {});
      notify(t.uid, 'race', 'Creator race: #' + t.place + ' last week' + (coins ? ' — +' + coins + ' coins' : ''),
        'The creator race settled: you finished #' + t.place + ' with ' + t.points + ' point' + (t.points === 1 ? '' : 's') + '.', 'race', week);
    }
  } catch (e) { console.error('race settle:', e && e.message); }
}
async function raceSettle() {
  const now = digestWeekStart();
  let rows = null;
  try { ({ data: rows } = await supabase.from('race_plays').select('week').limit(1000)); } catch (e) {}
  const weeks = [];
  for (const r of rows || []) if (r.week < now && weeks.indexOf(r.week) === -1) weeks.push(r.week);
  for (const w of weeks) await raceSettleWeek(w);
}
setInterval(() => { raceSettle(); }, 3600000); // hourly settle sweep
setTimeout(raceSettle, 40 * 1000); // first sweep 40s after start

// ── Weekly digest email (Monday, verified users) ─────────────
// One email a week: this week's build theme, last week's jam winners, and
// up to 3 newest games from creators the reader follows (the follow-shelf
// data, in your inbox). Recipients = confirmed accounts only, page-scanned
// from auth like purgeUnconfirmed below. Nothing here mutates game state:
// the winner tally is only ever read — settleJam's payouts stay untouched.
// The "already sent this week" marker is digest.json (same file trick as
// weekly.json), so a redeploy re-runs the job but cannot re-send the week.
const DIGEST_FILE = path.join(__dirname, 'digest.json');
// Render's free tier wakes a fresh container with an empty disk, so
// digest.json alone lets every wake mail the whole week again (each
// bounce lands back in the sender's inbox). Mirror the marker into
// Supabase and prefer that copy; the file stays as a local fast path.
const DIGEST_STATE_EMAIL = 'digest-state@cudic.invalid';
async function readDigestState() {
  try {
    const { data } = await supabase.from('email_codes').select('code_hash').eq('email', DIGEST_STATE_EMAIL).limit(1);
    if (data && data[0] && data[0].code_hash) return JSON.parse(data[0].code_hash);
  } catch (e) { console.warn('digest: could not read state:', (e && e.message) || e); }
  return null;
}
async function writeDigestState(st) {
  try {
    await supabase.from('email_codes').upsert({ email: DIGEST_STATE_EMAIL, code_hash: JSON.stringify(st), expires_at: '2099-01-01T00:00:00.000Z' });
  } catch (e) { console.warn('digest: could not persist state:', (e && e.message) || e); }
}
// Test/harness addresses never receive mail — they bounce straight back
// into the sender's inbox. Never hand them to a transport.
function digestMailOk(email) {
  const e = String(email || '').toLowerCase();
  if (e.indexOf('@') < 1) return false;
  const local = e.split('@')[0];
  if (/^(test|probe|buffy|buffytest|dupcheck)/.test(local)) return false;
  return !/@(.*\.)?(example\.(com|dev|org|net)|example|examp1e\.dev|test|invalid|localhost|freebuff\.dev)$/.test(e);
}
function digestWeekStart(d) {
  // Monday 00:00 UTC of the week containing d — same rule as weekStartISO.
  const t = d ? new Date(d) : new Date();
  const day = (t.getUTCDay() + 6) % 7;
  t.setUTCDate(t.getUTCDate() - day);
  t.setUTCHours(0, 0, 0, 0);
  return t.toISOString().slice(0, 10);
}
function mailTransportReady() {
  return !!(process.env.GMAIL_CLIENT_ID && process.env.GMAIL_CLIENT_SECRET && process.env.GMAIL_REFRESH_TOKEN && process.env.GMAIL_SENDER) ||
    !!process.env.RESEND_API_KEY || !!process.env.BREVO_API_KEY;
}
async function sendDigestMail(email, subject, html) {
  const gErr = await sendViaGmail(email, subject, html);
  if (!gErr) return null;
  if (gErr.message !== 'gmail not configured') console.error('Digest gmail error:', gErr.message);
  if (resend) {
    try {
      const { error } = await resend.emails.send({
        from: process.env.RESEND_FROM || 'Cudic <onboarding@resend.dev>',
        to: email, subject, html,
      });
      if (!error) return null;
      console.error('Digest resend error:', error);
    } catch (e) { console.error('Digest resend error:', (e && e.message) || e); }
  }
  if (process.env.BREVO_API_KEY) {
    try {
      const r = await fetch('https://api.brevo.com/v3/smtp/email', {
        method: 'POST',
        headers: { 'accept': 'application/json', 'content-type': 'application/json', 'api-key': process.env.BREVO_API_KEY },
        body: JSON.stringify({
          sender: { name: 'Cudic', email: process.env.BREVO_SENDER || 'cudic.codes@outlook.com' },
          to: [{ email: email }],
          subject: subject,
          htmlContent: html,
        }),
      });
      if (r.ok) return null;
      try { console.error('Digest brevo error:', r.status, await r.text()); } catch (e) { console.error('Digest brevo error:', r.status); }
    } catch (e) { console.error('Digest brevo error:', (e && e.message) || e); }
  }
  return new Error('mail unavailable');
}
async function weeklyDigest() {
  const week = digestWeekStart();
  const prevWeek = digestWeekStart(new Date(Date.now() - 7 * 86400000));
  try { await raceSettle(); } catch (e) {} // make sure race prizes are banked before the mail reads them
  // Creator race winners (settled top-3 with points) — read-only here.
  let raceWinners = [];
  try { const { data: rw } = await supabase.from('race_weeks').select('top').eq('week', prevWeek).limit(1); raceWinners = ((rw && rw[0]) || {}).top || []; } catch (e) {}
  let state = null;
  try { state = JSON.parse(fs.readFileSync(DIGEST_FILE, 'utf8')); } catch {}
  if (!state || state.week !== week) state = await readDigestState();
  if (state && state.week === week) return; // this week already went out
  if (!mailTransportReady()) return; // wait until mail exists; retry next tick
  // This week's theme lives in weekly.json; may still be last week's file
  // if nobody has hit /api/weekly yet this week — fine for a digest.
  let theme = '';
  try { const w = JSON.parse(fs.readFileSync(path.join(__dirname, 'weekly.json'), 'utf8')); if (w && w.theme) theme = String(w.theme); } catch {}
  // Read-only winner tally for last week (payouts stay in settleJam).
  const winners = [];
  try {
    const { data: votes } = await supabase.from('jam_votes').select('game_id, user_id').eq('week_start', prevWeek).limit(5000);
    if (votes && votes.length) {
      const tally = {};
      for (const v of votes) tally[v.game_id] = (tally[v.game_id] || 0) + 1;
      const top = Object.keys(tally).map(id => ({ id, votes: tally[id] })).sort((a, b) => b.votes - a.votes).slice(0, 3);
      const { data: rows } = await supabase.from('games')
        .select('id, title, slug, owner_id, users!owner_id(display_name, user_id)').in('id', top.map(t => t.id));
      const games = rows || [];
      for (const t of top) {
        const g = games.find(x => x && x.id === t.id);
        if (g) winners.push({ title: g.title || 'Untitled', owner: (g.users && g.users.display_name) || 'Unknown', votes: t.votes });
      }
    }
  } catch (e) { console.error('digest winners:', e && e.message); }
  let sent = 0, skipped = 0;
  try {
    for (let page = 1; page <= 8; page++) { // 8×100 = 500 accounts/run cap
      const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 100 });
      if (error) break;
      const batch = (data && data.users) || [];
      if (!batch.length) break;
      // Batch-level stats for the personal paragraph: race points (unique
      // players last week), hearts received, remixes received. One query
      // each per page batch, joined in JS — no per-user queries.
      const batchIds = batch.map(u => (u && u.id)).filter(Boolean);
      const statPlays = new Map(), statLikes = new Map(), statForks = new Map();
      try {
        const { data: rp } = await supabase.from('race_plays').select('creator_id').in('creator_id', batchIds).eq('week', prevWeek).limit(20000);
        for (const r of rp || []) statPlays.set(r.creator_id, (statPlays.get(r.creator_id) || 0) + 1);
      } catch (e) {}
      try {
        const { data: gl } = await supabase.from('game_likes').select('games!inner(owner_id)')
          .in('games.owner_id', batchIds).gte('created_at', prevWeek + 'T00:00:00.000Z').lt('created_at', week + 'T00:00:00.000Z').limit(5000);
        for (const r of gl || []) if (r.games && r.games.owner_id) statLikes.set(r.games.owner_id, (statLikes.get(r.games.owner_id) || 0) + 1);
      } catch (e) {}
      try {
        const { data: bg } = await supabase.from('games').select('id, owner_id').in('owner_id', batchIds).limit(3000);
        const parentOwner = new Map((bg || []).map(g => [g.id, g.owner_id]));
        if (parentOwner.size) {
          const { data: fr } = await supabase.from('games').select('forked_from').in('forked_from', [...parentOwner.keys()])
            .gte('created_at', prevWeek + 'T00:00:00.000Z').lt('created_at', week + 'T00:00:00.000Z').limit(5000);
          for (const f of fr || []) { const owner = parentOwner.get(f.forked_from); if (owner) statForks.set(owner, (statForks.get(owner) || 0) + 1); }
        }
      } catch (e) {}
      for (const u of batch) {
        if (!u || !u.email || userUnconfirmed(u) || !digestMailOk(u.email)) continue;
        // Three newest published games from creators this reader follows.
        let picks = [];
        try {
          const { data: fw } = await supabase.from('follows').select('followed_id').eq('follower_id', u.id).limit(200);
          const ids = (fw || []).map(f => f.followed_id);
          if (ids.length) {
            const { data: gs } = await supabase.from('games')
              .select('id, title, slug, users!owner_id(display_name)')
              .in('owner_id', ids).eq('published', true)
              .order('created_at', { ascending: false }).limit(3);
            picks = gs || [];
          }
        } catch (e) { console.error('digest picks:', e && e.message); }
        const rows = [];
        if (theme) rows.push('<p style="font-size:15px;margin:0 0 12px">This week\'s jam theme: <b style="text-transform:capitalize">' + theme.replace(/[<>&]/g, '') + '</b> — one week to build something around it.</p>');
        if (winners.length) {
          rows.push('<p style="font-size:13px;color:#5C5878;margin:0 0 6px">Last week\'s jam winners</p>');
          winners.forEach((w, i) => rows.push('<p style="font-size:14px;margin:0 0 4px">#' + (i + 1) + ' ' + String(w.title).replace(/[<>&]/g, '') + ' by ' + String(w.owner).replace(/[<>&]/g, '') + ' (' + w.votes + ')</p>'));
        }
        if (raceWinners.length) {
          rows.push('<p style="font-size:13px;color:#5C5878;margin:10px 0 6px">Creator race prize winners</p>');
          raceWinners.forEach(w => rows.push('<p style="font-size:14px;margin:0 0 4px">' + (w.place === 1 ? '🥇 ' : w.place === 2 ? '🥈 ' : '🥉 ') + String(w.name || 'someone').replace(/[<>&]/g, '') + ' — ' + (w.points == null ? 0 : w.points) + ' point' + (w.points === 1 ? '' : 's') + '</p>'));
        }
        if (picks.length) {
          rows.push('<p style="font-size:13px;color:#5C5878;margin:10px 0 6px">New from creators you follow</p>');
          picks.forEach(g => rows.push('<p style="font-size:14px;margin:0 0 4px">' + String(g.title || 'A new game').replace(/[<>&]/g, '') + (' by ' + ((g.users && g.users.display_name) || 'someone')) + '</p>'));
        }
        // Personal paragraph: last week's plays (race points), hearts,
        // remixes — the pull that brings the creator back in to build.
        const pp = statPlays.get(u.id) || 0, pl2 = statLikes.get(u.id) || 0, pf = statForks.get(u.id) || 0;
        if (pp || pl2 || pf) rows.unshift('<p style="font-size:15px;margin:0 0 12px">Last week your games got <b>' + pp + '</b> race point' + (pp === 1 ? '' : 's') + ', <b>' + pl2 + '</b> new heart' + (pl2 === 1 ? '' : 's') + (pf ? ' and <b>' + pf + '</b> remix' + (pf === 1 ? '' : 'es') : '') + '.</p>');
        if (!rows.length) rows.push('<p style="font-size:14px;margin:0">A quiet week — maybe yours to change. The Cudic Studio is one click away.</p>');
        const html =
          '<div style="font-family:sans-serif;max-width:520px;margin:0 auto;padding:28px 24px;background:#FFFFFF;color:#2E2A4B;border-radius:16px;border:1px solid #C9D5F0">' +
          '<h1 style="font-size:22px;margin:0 0 4px">cudic<span style="color:#774DCB;">.</span> weekly</h1>' +
          '<p style="font-size:12px;color:#9C97B8;margin:0 0 18px">Week of ' + week + '</p>' +
          rows.join('') +
          '<p style="font-size:12px;color:#9C97B8;margin-top:18px">You get this because you verified your email at Cudic — one a week, that\'s all.</p>' +
          '</div>';
        const err = await sendDigestMail(u.email, 'Cudic weekly: ' + (theme ? theme : 'new week') + (winners.length ? ' + jam winners' : '') + (raceWinners.length ? ' + race winners' : ''), html);
        if (err) { skipped++; } else { sent++; }
        await new Promise(r => setTimeout(r, 250)); // gentle on the transports
      }
      if (batch.length < 100) break;
    }
  } catch (e) { console.error('digest run:', (e && e.message) || e); }
  const stamp = { week, sent_at: new Date().toISOString(), sent, skipped };
  try { fs.writeFileSync(DIGEST_FILE, JSON.stringify(stamp, null, 2)); }
  catch (e) { console.warn('digest: could not persist state:', e.message); }
  await writeDigestState(stamp);
  console.log('digest: week', week, '— sent', sent, 'skipped', skipped);
}
setInterval(weeklyDigest, 30 * 60 * 1000); // half-hourly check, sends once per week
setTimeout(weeklyDigest, 3 * 60 * 1000); // first check 3 min after start

// ── Purge: delete email accounts that never confirmed (24h grace) ──
// Drive-by signups vanish instead of rotting in the user list. Reuses
// userUnconfirmed(), so GitHub OAuth + pre-code accounts are exempt by
// construction. public.users and everything under it cascade from
// auth.users, so one delete erases the whole footprint.
async function purgeUnconfirmed(){
  try{
    const before = new Date(Date.now() - 24*3600*1000).toISOString();
    let page = 1;
    for (;;) {
      const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 100 });
      const batch = (data && data.users) || [];
      if (error || !batch.length) break;
      for (const u of batch) {
        if (!u || !userUnconfirmed(u)) continue;
        if (!u.created_at || u.created_at > before) continue;
        try { await supabase.auth.admin.deleteUser(u.id); console.log('[purge] removed unconfirmed', u.id); }
        catch (e) { console.error('[purge] delete failed:', u.id, (e && e.message) || e); }
      }
      if (batch.length < 100) break;
      page++;
    }
  }catch(e){ console.error('[purge] error:', (e && e.message) || e); }
}
setInterval(purgeUnconfirmed, 24*3600*1000); // daily
setTimeout(purgeUnconfirmed, 5*60*1000); // first run 5 min after start

// ── Start ────────────────────────────────────────────────────────
// ── Route modules ────────────────────────────────────────────────
// Built once, after Supabase, the helper functions and the lobby map exist.
// Each one owns its route bodies; server.js only decides when to call it.
messageRoutes = require('./lib/routes/messages')({
  supabase, cors, requireUser, needVerified, readBody, isUuid, validName,
  canSeeLobby, serverRole, broadcast, rateLimit,
});
serverRoutes = require('./lib/routes/servers')({
  supabase, cors, requireUser, needVerified, readBody, isUuid, serverRole,
  chanSlug, chanRoomName, chanDisplay, sendConversationsDirty, safeIconUrl,
  awardUser, crypto, lobbies,
});
chatRoutes = require('./lib/routes/chat')({
  supabase, cors, requireUser, needVerified, readBody, isUuid, dmRoomName,
  chanDisplay, sendConversationsDirty, canSeeLobby, serverRole, notify,
  logActivity, isModerator, rateLimit, lobbies,
});
githubRoutes = require('./lib/routes/github')({
  cors, userOf, ghKey, GH_SETUP_TEXT, supabase, ghNoTable, requireUser, needVerified, rateLimit, readBody, GH_SCOPES_OK, ghSeal, ghGate, ghApi, ghFail, ghSend, GH_PATH, ghDeployWarned, GIT_SNAP_PATH, GIT_SNAP_CAP, GH_NAME, crypto, ghToken, repoTreeFiles, createRelease,
});
gamesRoutes = require('./lib/routes/games')({
  cors, requireUser, isModerator, supabase, gamesListCacheClear, seatAlive, seatFromReq, seatDead, readBody, crypto, revisionFilesOf, gamesListCache, GAMES_LIST_TTL, liveCount, userOf, hasScope, scopeDenied, needVerified, activeBan, isUuid, notify, playtestValid, defaultThumb, rankRelated, rateLimit, weekStartISO, PLAYTEST_SECRET, playtestSign, siteOrigin, clientIp, logActivity, singleFileBuild, latestRelease, digestWeekStart, awardUser, freeGameSlug, sanitizeTags, copyAssetPrefix, ghToken, ghApi, accountStorageBytes, ACCOUNT_STORAGE_CAP, onPublished, discord, createRelease, forgetStorageUsage,
});
modRoutes = require('./lib/routes/mod')({
  cors, requireUser, needVerified, isModerator, supabase, isUuid, readBody, AWARDS, awardUser, notify, ghToken, rateLimit, canSeeLobby, packByKey, RESERVED_PACK_SLUGS, gamesListCacheClear,
});

server.listen(PORT, () => {
  console.log(`\n  Cudic is running → http://localhost:${PORT}\n`);
  // Boot fingerprint: proves which Gmail values the running deploy sees.
  // Safe — client IDs are public by design; secrets are never printed.
  try {
    const gid = process.env.GMAIL_CLIENT_ID || '';
    console.log('Gmail sender:', process.env.GMAIL_REFRESH_TOKEN ? 'configured' : 'missing',
      '| client:', gid ? gid.substring(0, 12) + '…len' + gid.length : '(none)');
  } catch (e) {}
});
