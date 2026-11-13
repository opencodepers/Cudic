#!/usr/bin/env node
/**
 * Cudic CLI — make and publish Cudic projects without opening cudic.vercel.app.
 *
 *   node cli/cudic.mjs login --token <supabase access token>
 *   node cli/cudic.mjs new my-game
 *   node cli/cudic.mjs push my-game
 *   node cli/cudic.mjs publish my-game --tags puzzle,arcade
 *
 * It talks to the same public API the Studio and editor use, so a project
 * pushed here opens in Cudic Studio, plays on its /g/<id> page, and shows up
 * under the account's projects. Auth is an ordinary Cudic account:
 * `CUDIC_TOKEN` for one-shot agent runs, or `login` (email+password, stored in
 * ~/.cudic/config.json with mode 600, refreshed automatically).
 *
 * No dependencies — Node 18+ (global fetch) only.
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const DEFAULT_WEB = process.env.CUDIC_WEB || 'https://cudic.vercel.app';
const DEFAULT_API = process.env.CUDIC_API || 'https://glox-o7rr.onrender.com';
const HOME = process.env.CUDIC_HOME || path.join(os.homedir(), '.cudic');
const CONFIG = path.join(HOME, 'config.json');
const LINK = '.cudic.json'; // per-project: { id, title } written by push

// Directories that are never part of a project.
const SKIP_DIRS = new Set(['node_modules', '.git', '.svn', '.hg', '.freebuff', 'dist', 'build', '.next']);
// Extensions we can send as text files. Anything else is skipped with a note
// (binary assets need the Studio's storage upload path; CLI v1 is text-only).
const TEXT_EXT = new Set([
  '.html', '.htm', '.css', '.js', '.mjs', '.cjs', '.json', '.txt', '.md', '.svg',
  '.csv', '.ts', '.map', '.yml', '.yaml', '.xml', '.glsl', '.frag', '.vert', '.wav.txt', '.ini',
]);

function die(msg, code = 1) {
  console.error('cudic: ' + msg);
  process.exit(code);
}

// ── args ────────────────────────────────────────────────────────────────
function parse(argv) {
  const pos = [];
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '-h' || a === '--help') { flags.help = true; continue; }
    if (a.startsWith('--')) {
      const eq = a.indexOf('=');
      if (eq !== -1) { flags[a.slice(2, eq)] = a.slice(eq + 1); continue; }
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next == null || next.startsWith('--')) flags[key] = true;
      else { flags[key] = next; i++; }
    } else pos.push(a);
  }
  return { pos, flags };
}

// ── config ──────────────────────────────────────────────────────────────
function readConfig() {
  try { return JSON.parse(fs.readFileSync(CONFIG, 'utf8')); } catch { return {}; }
}
function writeConfig(patch) {
  const cfg = { ...readConfig(), ...patch };
  fs.mkdirSync(HOME, { recursive: true, mode: 0o700 });
  fs.writeFileSync(CONFIG, JSON.stringify(cfg, null, 2) + '\n', { mode: 0o600 });
  return cfg;
}
function clearConfig() {
  try { fs.unlinkSync(CONFIG); } catch {}
}

const webBase = () => readConfig().web || DEFAULT_WEB;
const apiBase = () => (readConfig().api || DEFAULT_API).replace(/\/+$/, '');

// Supabase project url + public anon key come from the deployment's own
// /config.js, so the CLI has no baked-in credentials.
let supaCache = null;
async function supa() {
  if (supaCache) return supaCache;
  const cfg = readConfig();
  if (cfg.supabaseUrl && cfg.anonKey) return (supaCache = { url: cfg.supabaseUrl, anon: cfg.anonKey });
  const res = await fetch(webBase() + '/config.js');
  if (!res.ok) die('could not read ' + webBase() + '/config.js (' + res.status + '). Set CUDIC_WEB.');
  const src = await res.text();
  const url = (src.match(/SUPABASE_URL\s*=\s*'([^']+)'/) || [])[1];
  const anon = (src.match(/SUPABASE_ANON_KEY\s*=\s*'([^']+)'/) || [])[1];
  if (!url || !anon) die('could not find the Supabase keys in the deployment config.');
  return (supaCache = { url, anon });
}

// ── auth ────────────────────────────────────────────────────────────────
function jwtExp(t) {
  try {
    const body = JSON.parse(Buffer.from(t.split('.')[1], 'base64url').toString('utf8'));
    return typeof body.exp === 'number' ? body.exp : 0;
  } catch { return 0; }
}

async function refresh(cfg) {
  if (!cfg.refresh_token) return null;
  const { url, anon } = await supa();
  const res = await fetch(url + '/auth/v1/token?grant_type=refresh_token', {
    method: 'POST',
    headers: { apikey: anon, 'Content-Type': 'application/json' },
    body: JSON.stringify({ refresh_token: cfg.refresh_token }),
  });
  const d = await res.json().catch(() => ({}));
  if (!res.ok || !d.access_token) return null;
  writeConfig({ access_token: d.access_token, refresh_token: d.refresh_token || cfg.refresh_token });
  return d.access_token;
}

function apiKeyCred() {
  const env = process.env.CUDIC_API_KEY;
  if (env) return env.trim();
  const cfg = readConfig();
  return cfg.api_key || null;
}

async function token() {
  const env = process.env.CUDIC_TOKEN;
  if (env) return env.trim();
  const key = apiKeyCred();
  if (key) return key;
  const cfg = readConfig();
  if (!cfg.access_token && !cfg.refresh_token) {
    die('not signed in. Run `cudic login --token <token>` or set CUDIC_TOKEN.');
  }
  if (cfg.access_token && jwtExp(cfg.access_token) - 60 > Date.now() / 1000) return cfg.access_token;
  const fresh = await refresh(cfg);
  if (fresh) return fresh;
  if (cfg.access_token) return cfg.access_token; // let the API decide
  die('your session expired and could not refresh. Run `cudic login` again.');
}

function hasCreds() {
  const cfg = readConfig();
  return !!(process.env.CUDIC_TOKEN || apiKeyCred() || cfg.access_token || cfg.refresh_token);
}

/**
 * Fetch a Cudic API path; refreshes once on 401. `auth: false` is for public
 * reads (gallery, forums, docs) so a fresh install can browse without a login.
 */
async function api(pathname, opts = {}) {
  const body = opts.body === undefined ? undefined : JSON.stringify(opts.body);
  const send = async (t) => fetch(apiBase() + pathname, {
    method: opts.method || 'GET',
    headers: {
      ...(t ? { Authorization: 'Bearer ' + t } : {}),
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    ...(body === undefined ? {} : { body }),
  });
  let t = null;
  if (opts.auth === false) { if (hasCreds()) t = await token().catch(() => null); }
  else t = await token();
  let res = await send(t);
  if (res.status === 401 && t && !process.env.CUDIC_TOKEN) {
    const fresh = await refresh(readConfig());
    if (fresh) { t = fresh; res = await send(fresh); }
  }
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text }; }
  if (!res.ok) {
    const msg = (data && (data.error || data.message)) || ('HTTP ' + res.status);
    die(msg);
  }
  return data;
}

async function whoami() {
  if (apiKeyCred()) {
    const p = await api('/api/profile');
    const u = (p && p.profile) || {};
    return (u.display_name || 'api key') + (p && p.email ? ' <' + p.email + '>' : '');
  }
  const { url, anon } = await supa();
  const res = await fetch(url + '/auth/v1/user', {
    headers: { apikey: anon, Authorization: 'Bearer ' + (await token()) },
  });
  if (!res.ok) die('token rejected by Supabase (' + res.status + ').');
  const u = await res.json();
  let name = u.email || u.id;
  try {
    const p = await api('/api/profile');
    const user = (p && (p.user || p.profile)) || {};
    if (user.display_name) name = user.display_name;
    if (typeof p.coins === 'number') name += ' (' + p.coins + ' coins)';
  } catch {}
  return name;
}

// ── project files ───────────────────────────────────────────────────────
function looksBinary(buf) {
  const n = Math.min(buf.length, 8000);
  for (let i = 0; i < n; i++) if (buf[i] === 0) return true;
  return false;
}

/** Read a project folder into the `files` map the game row stores (path → text). */
function collect(dir) {
  const files = {};
  const skipped = [];
  const walk = (abs, rel) => {
    for (const ent of fs.readdirSync(abs, { withFileTypes: true })) {
      if (ent.name.startsWith('.') && ent.name !== '.well-known') continue;
      const childAbs = path.join(abs, ent.name);
      const childRel = rel ? rel + '/' + ent.name : ent.name;
      if (ent.isDirectory()) {
        if (SKIP_DIRS.has(ent.name.toLowerCase())) continue;
        walk(childAbs, childRel);
        continue;
      }
      if (!ent.isFile()) continue;
      // The credit note `get` drops in a download is for the human, not the game.
      if (ent.name === 'CUDIC.md') continue;
      const ext = path.extname(ent.name).toLowerCase();
      if (!TEXT_EXT.has(ext)) { skipped.push(childRel); continue; }
      const buf = fs.readFileSync(childAbs);
      if (looksBinary(buf)) { skipped.push(childRel); continue; }
      files[childRel] = buf.toString('utf8');
    }
  };
  walk(dir, '');
  return { files, skipped };
}

function projectId(dir) {
  try {
    const link = JSON.parse(fs.readFileSync(path.join(dir, LINK), 'utf8'));
    return typeof link.id === 'string' ? link.id : null;
  } catch { return null; }
}
function remember(dir, id, title) {
  fs.writeFileSync(path.join(dir, LINK), JSON.stringify({ id, title, project: 'cudic' }, null, 2) + '\n');
}

const STARTER = {
  'index.html': `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>My game</title>
  <link rel="stylesheet" href="style.css">
</head>
<body>
  <canvas id="c" width="640" height="360"></canvas>
  <p id="hud">0 clicks</p>
  <script src="game.js"></script>
</body>
</html>
`,
  'style.css': `html, body { margin: 0; height: 100%; background: #0b0b0d; color: #e6e1d7;
  font: 15px/1.5 ui-monospace, monospace; display: grid; place-items: center; }
#c { background: #14141a; border: 1px solid #2a2a33; }
#hud { text-align: center; letter-spacing: 0.04em; }
`,
  'game.js': `const c = document.getElementById('c');
const ctx = c.getContext('2d');
const hud = document.getElementById('hud');
let clicks = 0, x = 320, y = 180;

c.addEventListener('pointerdown', (e) => {
  const r = c.getBoundingClientRect();
  x = e.clientX - r.left;
  y = e.clientY - r.top;
  clicks++;
  hud.textContent = clicks + (clicks === 1 ? ' click' : ' clicks');
});

function frame() {
  ctx.fillStyle = '#14141a';
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.fillStyle = '#e6e1d7';
  ctx.beginPath();
  ctx.arc(x, y, 12, 0, Math.PI * 2);
  ctx.fill();
  requestAnimationFrame(frame);
}
frame();
`,
};

// ── commands ────────────────────────────────────────────────────────────
async function cmdLogin(pos, flags) {
  const given = flags.token || process.env.CUDIC_TOKEN;
  const patch = {};
  if (typeof flags.api === 'string') patch.api = flags.api;
  if (typeof flags.web === 'string') patch.web = flags.web;

  // API keys are the durable credential for agents: no password, no expiry.
  if (typeof flags.key === 'string') {
    const key = flags.key.trim();
    if (!key.startsWith('cudic_')) die('that is not a Cudic API key (keys start with cudic_).');
    const res = await fetch(apiBase() + '/api/profile', { headers: { Authorization: 'Bearer ' + key } });
    if (!res.ok) die('that key was rejected (' + res.status + ') — revoked, wrong host, or the API is down.');
    writeConfig({ ...patch, api_key: key, access_token: null, refresh_token: null });
    console.log('Signed in with an API key. Saved to ' + CONFIG + '.');
    return;
  }

  if (given) {
    const exp = jwtExp(given);
    if (!exp) die('that does not look like a Supabase access token.');
    patch.access_token = given;
    writeConfig(patch);
    console.log('Signed in with token' + (exp ? ' (expires ' + new Date(exp * 1000).toISOString() + ')' : '') + '.');
    console.log('This token is short-lived — for lasting access use `login --email you@example.com`.');
    return;
  }

  const email = flags.email || process.env.CUDIC_EMAIL;
  if (!email) die('give an email: `cudic login --email you@example.com` (or --token <jwt>).');
  let password = flags.password || process.env.CUDIC_PASSWORD;
  if (!password) {
    if (!process.stdin.isTTY) die('no password. Pass --password, set CUDIC_PASSWORD, or run interactively.');
    const rl = (await import('node:readline/promises')).createInterface({ input: process.stdin, output: process.stdout });
    password = await rl.question('Password for ' + email + ': ');
    rl.close();
  }
  const { url, anon } = await supa();
  const res = await fetch(url + '/auth/v1/token?grant_type=password', {
    method: 'POST',
    headers: { apikey: anon, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const d = await res.json().catch(() => ({}));
  if (!res.ok || !d.access_token) {
    die((d && (d.error_description || d.msg || d.error)) || 'sign-in failed (' + res.status + ').');
  }
  writeConfig({ ...patch, email, access_token: d.access_token, refresh_token: d.refresh_token || null });
  console.log('Signed in as ' + email + '. Credentials saved to ' + CONFIG + '.');
}

async function cmdWhoami(pos, flags) {
  const name = await whoami();
  if (flags.json) console.log(JSON.stringify({ name, api: apiBase(), web: webBase() }));
  else console.log(name + '  ·  ' + apiBase());
}

// ── account: password reset (email code) + change while signed in ──────
// A reset is two steps on purpose: the first call mails a 6-digit code to the
// account's inbox, the second trades that code for the new password. The
// server hashes the code, expires it in 10 minutes and burns it on use, so the
// code never travels back to us. `change` is the signed-in path and skips the
// code because the session already proves the account.
const configEmail = () => String(readConfig().email || process.env.CUDIC_EMAIL || '').toLowerCase().trim();

async function ask(question) {
  if (!process.stdin.isTTY) return null;
  const rl = (await import('node:readline/promises')).createInterface({ input: process.stdin, output: process.stdout });
  const v = await rl.question(question);
  rl.close();
  return v;
}

async function newPassword(flags) {
  let pw = flags.password || flags.new;
  if (!pw) {
    if (!process.stdin.isTTY) die('pass --password <new password> (6-72 characters).');
    pw = await ask('New password: ');
  }
  if (!pw || pw.length < 6 || pw.length > 72) die('password must be 6-72 characters.');
  return pw;
}

async function cmdPassword(pos, flags) {
  const sub = (pos.shift() || 'reset').toLowerCase();

  if (sub === 'change' || sub === 'set') {
    if (apiKeyCred()) die('an API key cannot change a password. Run `cudic login --email you@example.com` first.');
    const pw = await newPassword(flags);
    const { url, anon } = await supa();
    const res = await fetch(url + '/auth/v1/user', {
      method: 'PUT',
      headers: { apikey: anon, Authorization: 'Bearer ' + (await token()), 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: pw }),
    });
    const d = await res.json().catch(() => ({}));
    if (!res.ok) die((d && (d.msg || d.error_description || d.error)) || 'change failed (' + res.status + ').');
    console.log('Password changed. Run `cudic login --email ' + (configEmail() || 'you@example.com') + '` again if a token refresh is rejected.');
    return;
  }

  if (sub !== 'reset' && sub !== 'forgot') die('usage: cudic password reset [--email you@example.com]  |  cudic password change --password <new>');

  const email = String(flags.email || configEmail()).toLowerCase().trim();
  if (!email || email.indexOf('@') === -1) die('give the account email: `cudic password reset --email you@example.com`');
  const code = String(flags.code || '').replace(/\D/g, '');

  if (!code) {
    await api('/auth/send-code', { method: 'POST', auth: false, body: { email } });
    console.log('Reset code sent to ' + email + '. It expires in 10 minutes (5 tries).');
    console.log('Next: cudic password reset --email ' + email + ' --code <code> --password <new password>');
    return;
  }

  if (code.length !== 6) die('the code is 6 digits.');
  const pw = await newPassword(flags);
  await api('/api/auth/reset-password', { method: 'POST', auth: false, body: { email, code, newPassword: pw } });
  console.log('Password reset for ' + email + '. Sign in: cudic login --email ' + email);
}

async function cmdVerify(pos, flags) {
  const email = String(flags.email || configEmail()).toLowerCase().trim();
  if (!email || email.indexOf('@') === -1) die('give the email: `cudic verify --email you@example.com`');
  const code = String(flags.code || '').replace(/\D/g, '');
  if (!code) {
    await api('/auth/send-code', { method: 'POST', auth: false, body: { email } });
    console.log('Confirmation code sent to ' + email + '. It expires in 10 minutes (5 tries).');
    console.log('Next: cudic verify --email ' + email + ' --code <code>');
    return;
  }
  if (code.length !== 6) die('the code is 6 digits.');
  const d = await api('/auth/verify-code', { method: 'POST', auth: false, body: { email, code, userId: typeof flags.user === 'string' ? flags.user : '' } });
  console.log(d && d.verified ? 'Email confirmed for ' + email + '.' : 'Code accepted.');
}

async function cmdList(pos, flags) {
  const d = await api('/api/games/mine');
  const games = (d && d.games) || [];
  if (flags.json) { console.log(JSON.stringify(games, null, 2)); return; }
  if (games.length === 0) { console.log('No projects yet. `cudic new my-game` then `cudic push my-game`.'); return; }
  const rows = games.map((g) => ({
    id: g.id.slice(0, 8),
    title: (g.title || 'Untitled').slice(0, 32),
    state: g.published ? 'published' : 'draft',
    updated: (g.updated_at || '').slice(0, 10),
  }));
  const w = Math.max(...rows.map((r) => r.title.length), 5);
  for (const r of rows) console.log(r.id + '  ' + r.title.padEnd(w) + '  ' + r.state.padEnd(9) + '  ' + r.updated);
  console.log('\n`cudic open <id>` prints the play link.');
}

async function cmdNew(pos, flags) {
  const dir = path.resolve(pos[0] || 'my-game');
  if (fs.existsSync(dir) && fs.readdirSync(dir).length > 0) die(dir + ' already has files. Pick an empty folder.');
  fs.mkdirSync(dir, { recursive: true });
  for (const [name, text] of Object.entries(STARTER)) fs.writeFileSync(path.join(dir, name), text);
  const title = typeof flags.title === 'string' ? flags.title : path.basename(dir);
  console.log('Created ' + dir + ' (' + Object.keys(STARTER).join(', ') + ').');
  console.log('Next: `cudic push ' + path.relative(process.cwd(), dir) + '` to save it as "' + title + '".');
}

async function cmdPush(pos, flags) {
  const dir = path.resolve(pos[0] || '.');
  if (!fs.existsSync(dir)) die('no such folder: ' + dir);
  const { files, skipped } = collect(dir);
  if (Object.keys(files).length === 0) die('no text files to push in ' + dir);
  if (skipped.length) console.log('Skipped (binary/unsupported): ' + skipped.join(', '));

  const id = flags.id || projectId(dir);
  const title = typeof flags.title === 'string' ? flags.title : undefined;
  const description = typeof flags.description === 'string' ? flags.description : undefined;
  const tags = typeof flags.tags === 'string' ? flags.tags : undefined;
  const body = { files, ...(title ? { title } : {}), ...(description !== undefined ? { description } : {}), ...(tags ? { tags } : {}) };

  if (id) {
    // Local recovery point: the copy that is about to be replaced.
    try {
      const cur = await api('/api/games/' + encodeURIComponent(id));
      let prev = cur && cur.game && cur.game.files;
      if (typeof prev === 'string') { try { prev = JSON.parse(prev); } catch { prev = null; } }
      const keys = new Set([...Object.keys(prev || {}), ...Object.keys(files)]);
      const changed = [...keys].some((k) => (prev || {})[k] !== files[k]);
      if (prev && Object.keys(prev).length && changed) {
        console.log('Backup: ' + path.relative(dir, saveBackup(dir, prev, 'before push')) + '  (cudic recover)')
      }
    } catch {}
  }

  let game;
  if (id) {
    const d = await api('/api/games/' + encodeURIComponent(id), { method: 'PUT', body });
    game = d && d.game;
    if (!game) die('save failed.');
    console.log('Updated "' + game.title + '" (' + Object.keys(files).length + ' files).');
  } else {
    if (!title) body.title = path.basename(dir);
    const d = await api('/api/games', { method: 'POST', body });
    game = d && d.game;
    if (!game) die((d && d.error) || 'could not create the project.');
    remember(dir, game.id, game.title);
    console.log('Created "' + game.title + '" (' + Object.keys(files).length + ' files) as a draft.');
  }
  console.log('Open in Studio: ' + webBase() + '/studio?id=' + game.id);
}

async function cmdPublish(pos, flags) {
  const dir = path.resolve(pos[0] || '.');
  const id = flags.id || projectId(dir);
  if (!id) die('no project id. Push the folder first, or pass --id <game id>.');
  const body = { published: true };
  if (typeof flags.title === 'string') body.title = flags.title;
  if (typeof flags.description === 'string') body.description = flags.description;
  if (typeof flags.tags === 'string') body.tags = flags.tags;
  const d = await api('/api/games/' + encodeURIComponent(id), { method: 'PUT', body });
  const game = d && d.game;
  if (!game) die('publish failed.');
  if (flags.id == null) remember(dir, game.id, game.title);
  console.log('Published "' + game.title + '".');
  console.log('Play: ' + webBase() + '/g/' + game.id);
}

async function cmdOpen(pos, flags) {
  const arg = flags.id || pos[0];
  let id = null;
  // A uuid is an id; anything else is a folder to read .cudic.json from.
  if (arg && /^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(arg)) id = arg;
  else if (arg) id = projectId(path.resolve(arg));
  if (!id) id = projectId(path.resolve('.'));
  if (!id) die('no project id. Pass a game id, run inside a pushed folder, or push first.');
  console.log(webBase() + (flags.studio ? '/studio?id=' : '/g/') + id);
}

// ── browsing, downloads, forums, shop, docs, snapshots ──────────────────
function slugify(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48) || 'game';
}
function qs(params) {
  const u = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v != null && v !== '' && v !== true) u.set(k, String(v));
  const s = u.toString();
  return s ? '?' + s : '';
}

async function cmdGames(pos, flags) {
  const d = await api('/api/games' + qs({ q: flags.q || flags.search, tag: flags.tag, sort: flags.sort }), { auth: false });
  const games = (d && d.games) || [];
  if (flags.json) { console.log(JSON.stringify(games, null, 2)); return; }
  if (!games.length) { console.log('No games matched.'); return; }
  for (const g of games) {
    const by = (g.users && (g.users.display_name || g.users.user_name)) || 'unknown';
    const tags = g.tags && g.tags.length ? '  [' + g.tags.join(',') + ']' : '';
    console.log(g.id + '  ' + String(g.title || 'Untitled').slice(0, 30).padEnd(30) + '  by ' + by + tags);
  }
  console.log('\n`cudic get <id>` downloads a game\'s source.');
}

// ── local backups (`.cudic-backups/` inside the project folder) ─────────
function backupRoot(dir) { return path.join(dir, '.cudic-backups'); }
function listBackups(dir) {
  const root = backupRoot(dir);
  let names = [];
  try { names = fs.readdirSync(root); } catch { return []; }
  return names
    .filter((n) => { try { return fs.statSync(path.join(root, n)).isDirectory(); } catch { return false; } })
    .sort()
    .map((n) => {
      let meta = {};
      try { meta = JSON.parse(fs.readFileSync(path.join(root, n, 'backup.json'), 'utf8')); } catch {}
      return { name: n, at: meta.at || '', files: typeof meta.files === 'number' ? meta.files : 0, why: meta.why || '' };
    });
}
/** Keep the newest 10 copies of a file map on disk before it gets overwritten. */
function saveBackup(dir, files, why) {
  const root = backupRoot(dir);
  const name = new Date().toISOString().replace(/[:.]/g, '-');
  const dest = path.join(root, name);
  for (const [rel, text] of Object.entries(files || {})) {
    if (typeof text !== 'string' || !rel || rel.includes('..')) continue;
    const file = path.join(dest, rel);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, text);
  }
  fs.mkdirSync(dest, { recursive: true });
  fs.writeFileSync(path.join(dest, 'backup.json'),
    JSON.stringify({ at: new Date().toISOString(), why: why || '', files: Object.keys(files || {}).length }, null, 2) + '\n');
  for (const old of listBackups(dir).slice(0, Math.max(0, listBackups(dir).length - 10))) {
    fs.rmSync(path.join(root, old.name), { recursive: true, force: true });
  }
  return dest;
}

/** Write a game row's text files and storage assets into a folder. */
async function writeProject(game, out) {
  let files = game.files;
  if (typeof files === 'string') { try { files = JSON.parse(files); } catch { files = null; } }
  let written = 0;
  for (const [rel, text] of Object.entries(files || {})) {
    if (typeof text !== 'string' || !rel || rel.includes('..')) continue;
    const dest = path.join(out, rel);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, text);
    written++;
  }
  const { url } = await supa();
  let assets = 0, missed = 0;
  for (const [rel, key] of Object.entries(game.assets || {})) {
    const obj = String(key).replace(/^game-assets\//, '');
    const src = url + '/storage/v1/object/public/game-assets/' + obj.split('/').map(encodeURIComponent).join('/');
    try {
      const r = await fetch(src);
      if (!r.ok) { missed++; continue; }
      const dest = path.join(out, rel);
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.writeFileSync(dest, Buffer.from(await r.arrayBuffer()));
      assets++;
    } catch { missed++; }
  }
  return { written, assets, missed };
}

async function cmdPull(pos, flags) {
  const dir = path.resolve(pos[0] || '.');
  const id = flags.id || projectId(dir);
  if (!id) die('no project id. Run inside a pushed folder or pass --id <game id>.');
  const d = await api('/api/games/' + encodeURIComponent(id));
  const game = d && d.game;
  if (!game) die('project not found.');
  if (flags.force !== true) {
    const local = collect(dir).files;
    if (Object.keys(local).length) {
      console.log('Backup of your files: ' + path.relative(dir, saveBackup(dir, local, 'before pull')) + ' (cudic recover)');
    }
  }
  const { written, assets, missed } = await writeProject(game, dir);
  remember(dir, game.id, game.title);
  console.log('Pulled "' + game.title + '" (' + written + ' files' +
    (assets ? ', ' + assets + ' assets' : '') + (missed ? ', ' + missed + ' missing' : '') + ').');
}

async function cmdGet(pos, flags) {
  const id = pos[0];
  if (!id) die('usage: cudic get <game id> [--out dir]');
  const d = await api('/api/games/' + encodeURIComponent(id), { auth: hasCreds() });
  const game = d && d.game;
  if (!game) die('game not found (drafts are only visible to their owner).');
  const out = path.resolve(typeof flags.out === 'string' ? flags.out : slugify(game.title));
  if (fs.existsSync(out) && fs.readdirSync(out).length > 0 && !flags.force) {
    die(out + ' already has files. Pass --out <dir> or --force.');
  }
  fs.mkdirSync(out, { recursive: true });
  const { written, assets, missed } = await writeProject(game, out);

  const author = (game.users && (game.users.display_name || game.users.user_name)) || 'unknown';
  fs.writeFileSync(path.join(out, 'CUDIC.md'), [
    '# ' + (game.title || 'Untitled'),
    '',
    (game.description || '').trim(),
    '',
    '- By: ' + author,
    '- Source: ' + webBase() + (game.published ? '/g/' : '/studio?id=') + game.id,
    '- Downloaded: ' + new Date().toISOString().slice(0, 10),
    '',
    'This is a copy taken with `cudic get`. Pushing it creates a new project',
    'under your account; the site\'s Remix button is what records the credit',
    'link back to the original.',
    '',
  ].join('\n'));

  console.log('Downloaded "' + game.title + '" into ' + path.relative(process.cwd(), out) +
    ' (' + written + ' file' + (written === 1 ? '' : 's') +
    (assets ? ', ' + assets + ' asset' + (assets === 1 ? '' : 's') : '') +
    (missed ? ', ' + missed + ' missing' : '') + ').');
  console.log(game.published
    ? 'Play: ' + webBase() + '/g/' + game.id
    : 'Draft (yours): ' + webBase() + '/studio?id=' + game.id);
}

async function cmdForums(pos, flags) {
  const d = await api('/api/forums/threads' + qs({
    q: flags.q || flags.search, sort: flags.sort, category: flags.category,
  }), { auth: false });
  const threads = (d && d.threads) || [];
  if (flags.json) { console.log(JSON.stringify(threads, null, 2)); return; }
  if (!threads.length) { console.log('No threads matched.'); return; }
  for (const t of threads) {
    const by = (t.users && t.users.display_name) || 'unknown';
    console.log(t.id + '  [' + (t.category || '?') + '] ' + String(t.title || '').slice(0, 42).padEnd(42) +
      '  ' + (t.comment_count || 0) + ' replies  by ' + by + (t.pinned ? '  pinned' : ''));
  }
  console.log('\n`cudic thread <id>` reads one with its replies.');
}

async function cmdThread(pos, flags) {
  const id = pos[0];
  if (!id) die('usage: cudic thread <id>');
  const d = await api('/api/forums/threads/' + encodeURIComponent(id), { auth: false });
  const t = d && d.thread;
  if (!t) die('thread not found.');
  if (flags.json) { console.log(JSON.stringify(d, null, 2)); return; }
  const by = (t.users && t.users.display_name) || 'someone';
  console.log('[' + (t.category || '?') + '] ' + t.title);
  console.log('by ' + by + ' · ' + String(t.created_at || '').slice(0, 10) +
    (t.game ? ' · game: ' + t.game.title : ''));
  console.log('');
  console.log(t.body || '(no body)');
  const comments = d.comments || [];
  if (comments.length) {
    console.log('\n' + comments.length + ' repl' + (comments.length === 1 ? 'y' : 'ies') + ':');
    for (const c of comments) {
      console.log('  ' + (c.display_name || 'someone') + ' · ' + String(c.created_at || '').slice(0, 10) +
        (c.label ? ' [' + c.label + ']' : ''));
      console.log('    ' + String(c.text || '').replace(/\n/g, '\n    '));
    }
  }
  console.log('\n' + webBase() + '/forums/' + t.id);
}

async function cmdShop(pos, flags) {
  const sub = (pos[0] || 'list').toLowerCase();
  if (sub === 'list' || sub === 'catalog' || sub === 'show') {
    const d = await api('/api/cosmetics');
    if (flags.json) { console.log(JSON.stringify(d, null, 2)); return; }
    const owned = new Set(d.owned || []);
    console.log('Balance: ' + d.balance + ' coins\n');
    const bySlot = {};
    for (const item of d.catalog || []) (bySlot[item.slot] = bySlot[item.slot] || []).push(item);
    for (const [key, label] of Object.entries(d.slots || {})) {
      const items = bySlot[key] || [];
      if (!items.length) continue;
      console.log(label + ' (' + key + ')');
      for (const it of items) {
        console.log('  ' + String(it.code).padEnd(16) + String(it.name || '').slice(0, 24).padEnd(26) +
          (it.price ? it.price + ' coins' : 'free').padEnd(10) + (owned.has(it.code) ? 'owned' : ''));
      }
    }
    console.log('\n`cudic shop buy <code>` buys, `cudic shop equip <slot> <code>` wears it.');
    return;
  }
  if (sub === 'buy') {
    const code = pos[1];
    if (!code) die('usage: cudic shop buy <code>');
    const d = await api('/api/cosmetics/buy', { method: 'POST', body: { code } });
    console.log(d.already ? 'You already own ' + code + '.' : 'Bought ' + code + '.');
    if (d.balance != null) console.log('Balance: ' + d.balance + ' coins');
    return;
  }
  if (sub === 'equip') {
    const slot = pos[1];
    if (!slot) die('usage: cudic shop equip <slot> <code>   (or --off to clear it)');
    const code = flags.off ? null : pos[2];
    if (code == null && !flags.off) die('give a code, or --off to take it off.');
    await api('/api/cosmetics/equip', { method: 'POST', body: { slot, code } });
    console.log(code ? 'Equipped ' + code + ' in ' + slot + '.' : 'Cleared the ' + slot + ' slot.');
    return;
  }
  die('unknown shop command "' + sub + '". Try `cudic shop`, `shop buy <code>`, `shop equip <slot> <code> --off`.');
}

function htmlToText(fragment) {
  return fragment
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<h2[^>]*>/gi, '\n## ').replace(/<\/h2>/gi, '\n')
    .replace(/<h3[^>]*>/gi, '\n### ').replace(/<\/h3>/gi, '\n')
    .replace(/<li[^>]*>/gi, '- ').replace(/<\/li>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|ul|ol|div|section)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ')
    .replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

async function cmdDocs(pos, flags) {
  const res = await fetch(webBase() + '/docs');
  if (!res.ok) die('could not fetch the docs (' + res.status + '). Set CUDIC_WEB.');
  const html = await res.text();
  const secs = [...html.matchAll(/<section id="([^"]+)">([\s\S]*?)<\/section>/g)]
    .map((m) => ({ id: m[1], text: htmlToText(m[2]) }));
  if (!secs.length) die('the docs page had no sections (did it change shape?).');

  const want = String(pos[0] || '').toLowerCase();
  const q = String(flags.search || flags.q || '').toLowerCase();
  let picked = secs;
  if (want) {
    picked = secs.filter((s) => s.id === want);
    if (!picked.length) picked = secs.filter((s) => s.id.includes(want));
    if (!picked.length) die('no docs section "' + want + '". Sections: ' + secs.map((s) => s.id).join(', '));
  } else if (q) {
    picked = secs
      .map((s) => ({ id: s.id, text: s.text.split('\n').filter((l) => l.toLowerCase().includes(q)).join('\n').trim() }))
      .filter((s) => s.text);
    if (!picked.length) die('nothing in the docs matches "' + q + '".');
  } else {
    console.log('Sections: ' + secs.map((s) => s.id).join(', ') + '\n');
    picked = secs.slice(0, 1);
  }
  if (flags.json) { console.log(JSON.stringify(picked, null, 2)); return; }
  for (const s of picked) console.log(s.text + '\n');
}

async function cmdRevisions(pos, flags) {
  const dir = path.resolve(pos[0] || '.');
  const id = flags.id || projectId(dir);
  if (!id) die('no project id. Push the folder first, or pass --id <game id>.');
  const d = await api('/api/games/' + encodeURIComponent(id) + '/revisions');
  const revs = (d && d.revisions) || [];
  if (flags.json) { console.log(JSON.stringify(revs, null, 2)); return; }
  if (!revs.length) { console.log('No snapshots yet. `cudic snapshot` saves one.'); return; }
  for (const r of revs) {
    console.log(r.id + '  ' + String(r.created_at || '').slice(0, 16).replace('T', ' ') + '  ' + (r.label || ''));
  }
  console.log('\n`cudic restore <revision id>` puts one back into the project.');
}

async function cmdSnapshot(pos, flags) {
  const dir = path.resolve(pos[0] || '.');
  const id = flags.id || projectId(dir);
  if (!id) die('no project id. Push the folder first, or pass --id <game id>.');
  const { files } = collect(dir);
  if (Object.keys(files).length === 0) die('no text files to snapshot in ' + dir);
  const body = { files };
  if (typeof flags.label === 'string') body.label = flags.label;
  const d = await api('/api/games/' + encodeURIComponent(id) + '/revisions', { method: 'POST', body });
  const rev = d && d.revision;
  if (!rev) die('snapshot failed.');
  console.log('Snapshot saved: ' + (rev.label || rev.id) + ' (' + Object.keys(files).length + ' files).');
}

async function cmdRestore(pos, flags) {
  const revId = pos[0];
  if (!revId) die('usage: cudic restore <revision id> [--id game id]');
  const id = flags.id || projectId(path.resolve('.'));
  if (!id) die('need the project: pass --id <game id> or run inside a pushed folder.');
  await api('/api/games/' + encodeURIComponent(id) + '/revisions/' + encodeURIComponent(revId) + '/restore', { method: 'POST' });
  console.log('Restored ' + revId.slice(0, 8) + ' into the project. `cudic get ' + id + ' --out .` pulls it down.');
}

async function cmdLs(pos, flags) {
  if (flags.id) {
    const d = await api('/api/games/' + encodeURIComponent(flags.id));
    const game = d && d.game;
    if (!game) die('project not found.');
    let files = game.files;
    if (typeof files === 'string') { try { files = JSON.parse(files); } catch { files = null; } }
    for (const [rel, text] of Object.entries(files || {})) console.log(String(rel).padEnd(38) + String(String(text).length) + ' bytes');
    for (const [rel, key] of Object.entries(game.assets || {})) console.log(String(rel).padEnd(38) + 'asset  ' + key);
    return;
  }
  const dir = path.resolve(pos[0] || '.');
  const { files } = collect(dir);
  const names = Object.keys(files).sort();
  if (!names.length) die('no text files in ' + dir);
  for (const n of names) console.log(n.padEnd(38) + files[n].length + ' bytes');
}

async function cmdCat(pos, flags) {
  const rel = pos[0];
  if (!rel) die('usage: cudic cat <path> [--id game id]');
  if (flags.id) {
    const d = await api('/api/games/' + encodeURIComponent(flags.id));
    const game = d && d.game;
    if (!game) die('project not found.');
    let files = game.files;
    if (typeof files === 'string') { try { files = JSON.parse(files); } catch {} }
    const text = files && files[String(rel).replace(/^\.\//, '')];
    if (typeof text !== 'string') die('no such file in that project: ' + rel + '  (cudic ls --id ...)');
    process.stdout.write(text);
    return;
  }
  const full = path.resolve(rel);
  if (!fs.existsSync(full)) die('no such file: ' + rel);
  process.stdout.write(fs.readFileSync(full, 'utf8'));
}

async function cmdProfile(pos, flags) {
  const sub = (pos[0] || 'show').toLowerCase();
  if (sub === 'show' || sub === 'me') {
    const d = await api('/api/profile');
    if (flags.json) { console.log(JSON.stringify(d, null, 2)); return; }
    const p = (d && d.profile) || {};
    console.log((p.display_name || '(no name)') + (d.email ? '  <' + d.email + '>' : ''));
    if (p.bio) console.log(p.bio);
    if (p.avatar_url) console.log('avatar: ' + p.avatar_url);
    const stats = [];
    if (typeof d.followers === 'number') stats.push(d.followers + ' followers');
    if (typeof d.following === 'number') stats.push(d.following + ' following');
    if (typeof d.friends === 'number') stats.push(d.friends + ' friends');
    if (stats.length) console.log(stats.join(' · '));
    const awards = (d.awards || []).map((a) => a.code);
    if (awards.length) console.log('awards: ' + awards.join(', '));
    if ((d.achievements || []).length) console.log('recent achievements: ' + d.achievements.length);
    return;
  }
  if (sub === 'set' || sub === 'edit') {
    const body = {};
    if (typeof flags.name === 'string') body.display_name = flags.name;
    if (typeof flags.bio === 'string') body.bio = flags.bio;
    if (flags['avatar-clear']) body.avatar_url = '';
    else if (typeof flags.avatar === 'string') body.avatar_url = flags.avatar;
    if (typeof flags.interests === 'string') body.interests = flags.interests.split(',');
    if (!Object.keys(body).length) {
      die('nothing to change. Try --name, --bio, --avatar <bucket url>, --avatar-clear or --interests a,b.');
    }
    await api('/api/profile', { method: 'PUT', body });
    console.log('Profile updated: ' + Object.keys(body).join(', ') + '.');
    return;
  }
  die('unknown profile command "' + sub + '". Try `cudic profile` or `cudic profile set --bio "..."`.');
}

async function cmdUnpublish(pos, flags) {
  const dir = path.resolve(pos[0] || '.');
  const id = flags.id || projectId(dir);
  if (!id) die('no project id. Push the folder first, or pass --id <game id>.');
  const d = await api('/api/games/' + encodeURIComponent(id), { method: 'PUT', body: { published: false } });
  const game = d && d.game;
  if (!game) die('unpublish failed.');
  console.log('Unpublished "' + game.title + '" — still yours, hidden from everyone else.');
}

async function cmdRm(pos, flags) {
  const dir = path.resolve(pos[0] || '.');
  const id = flags.id || projectId(dir);
  if (!id) die('no project id. Pass --id <game id> or run inside a pushed folder.');
  const d = await api('/api/games/' + encodeURIComponent(id));
  const game = d && d.game;
  if (!game) die('project not found.');
  if (!flags.yes) {
    console.log('Would delete "' + game.title + '" (' + game.id + ').');
    console.log('Nothing was deleted. Re-run with --yes to remove it for good.');
    process.exitCode = 1;
    return;
  }
  await api('/api/games/' + encodeURIComponent(id), { method: 'DELETE' });
  try { fs.unlinkSync(path.join(dir, LINK)); } catch {}
  console.log('Deleted "' + game.title + '". Local files are untouched (cudic backups still has copies).');
}

async function cmdBackups(pos, flags) {
  const dir = path.resolve(typeof flags.dir === 'string' ? flags.dir : (pos[0] || '.'));
  const snaps = listBackups(dir);
  if (flags.json) { console.log(JSON.stringify(snaps, null, 2)); return; }
  if (!snaps.length) { console.log('No local backups yet — `push` and `pull` keep one before they overwrite files.'); return; }
  for (const s of snaps) console.log(s.name + '  ' + String(s.files) + ' files  ' + s.at + (s.why ? '  ' + s.why : ''));
  console.log('\n`cudic recover latest` puts the newest one back on disk.');
}

async function cmdRecover(pos, flags) {
  const dir = path.resolve(typeof flags.dir === 'string' ? flags.dir : '.');
  const snaps = listBackups(dir);
  if (!snaps.length) die('no local backups in ' + dir);
  const want = pos[0] || 'latest';
  const pick = want === 'latest' ? snaps[snaps.length - 1] : snaps.filter((s) => s.name === want || s.name.startsWith(want)).pop();
  if (!pick) die('no backup matching "' + want + '". `cudic backups` lists them.');
  const src = path.join(backupRoot(dir), pick.name);

  const current = collect(dir).files;
  if (Object.keys(current).length) saveBackup(dir, current, 'before recover');

  let restored = 0;
  const walk = (abs, rel) => {
    for (const ent of fs.readdirSync(abs, { withFileTypes: true })) {
      if (ent.name === 'backup.json') continue;
      const childAbs = path.join(abs, ent.name);
      const childRel = rel ? rel + '/' + ent.name : ent.name;
      if (ent.isDirectory()) { walk(childAbs, childRel); continue; }
      if (!ent.isFile()) continue;
      const dest = path.join(dir, childRel);
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.copyFileSync(childAbs, dest);
      restored++;
    }
  };
  walk(src, '');
  console.log('Recovered ' + pick.name + ' (' + restored + ' file' + (restored === 1 ? '' : 's') + ').');
}

async function cmdKey(pos, flags) {
  const sub = (pos[0] || 'list').toLowerCase();
  if (sub === 'list' || sub === 'ls') {
    const d = await api('/api/keys');
    const keys = (d && d.keys) || [];
    if (flags.json) { console.log(JSON.stringify(keys, null, 2)); return; }
    if (!keys.length) { console.log('No keys yet. `cudic key create "my agent"` makes one.'); return; }
    for (const k of keys) {
      console.log(k.id + '  ' + String(k.label).padEnd(18) + '  ' + (k.scopes || []).join(',') +
        (k.revoked_at ? '  REVOKED' : '') + '  ' + (k.last_used_at ? 'used ' + String(k.last_used_at).slice(0, 10) : 'never used'));
    }
    return;
  }
  if (sub === 'create' || sub === 'new') {
    const label = typeof pos[1] === 'string' ? pos[1]
      : (typeof flags.label === 'string' ? flags.label : 'agent key');
    const body = { label };
    if (typeof flags.scopes === 'string') body.scopes = flags.scopes.split(',');
    const d = await api('/api/keys', { method: 'POST', body });
    if (!d || !d.key) die('could not create a key.');
    console.log(d.key);
    console.log('Copy it now — it is not shown again. Use it as CUDIC_API_KEY=... or `cudic login --key <key>`.');
    return;
  }
  if (sub === 'revoke' || sub === 'rm') {
    const id = pos[1];
    if (!id) die('usage: cudic key revoke <key id>');
    await api('/api/keys/' + encodeURIComponent(id), { method: 'DELETE' });
    console.log('Revoked ' + id + '.');
    return;
  }
  die('unknown key command "' + sub + '". Try `cudic key`, `cudic key create <label>`, `cudic key revoke <id>`.');
}

async function cmdDiff(pos, flags) {
  const dir = path.resolve(pos[0] || '.');
  const id = flags.id || projectId(dir);
  if (!id) die('no project id. Run inside a pushed folder or pass --id <game id>.');
  let revId = pos[1] || flags.rev;
  if (!revId) {
    const d = await api('/api/games/' + encodeURIComponent(id) + '/revisions');
    const list = (d && d.revisions) || [];
    if (!list.length) die('no snapshots yet — `cudic snapshot` saves one first.');
    revId = list[0].id;
  }
  const against = pos[2] || flags.against || 'current';
  // Support a local folder as `against` too, since that is what people compare.
  const d = await api('/api/games/' + encodeURIComponent(id) + '/revisions/' + encodeURIComponent(revId) +
    '/diff?against=' + encodeURIComponent(against));
  if (flags.json) { console.log(JSON.stringify(d, null, 2)); return; }
  const files = (d && d.files) || [];
  if (!files.length) { console.log('No changes between ' + against + ' and ' + revId.slice(0, 8) + '.'); return; }
  for (const f of files) {
    const mark = f.status === 'added' ? '+' : f.status === 'removed' ? '-' : '~';
    const size = f.status === 'added' ? f.after_bytes + 'B'
      : f.status === 'removed' ? f.before_bytes + 'B'
      : f.before_bytes + 'B → ' + f.after_bytes + 'B';
    console.log(mark + ' ' + f.path + '  ' + size);
  }
  console.log('\n' + d.counts.added + ' added, ' + d.counts.changed + ' changed, ' + d.counts.removed +
    ' removed. `cudic diff --json` for detail.');
}

async function cmdSearch(pos, flags) {
  const q = pos.join(' ').trim() || (typeof flags.q === 'string' ? flags.q : '');
  if (!q) die('usage: cudic search <text> [--type all|games|threads|people] [--json]');
  const type = typeof flags.type === 'string' ? flags.type : 'all';
  const limit = typeof flags.limit === 'string' ? flags.limit : '10';
  const d = await api('/api/search?q=' + encodeURIComponent(q) + '&type=' + encodeURIComponent(type) +
    '&limit=' + encodeURIComponent(limit), { auth: false });
  if (flags.json) { console.log(JSON.stringify(d, null, 2)); return; }
  const games = d.games || [], threads = d.threads || [], people = d.people || [];
  if (!games.length && !threads.length && !people.length) { console.log('Nothing found for "' + q + '".'); return; }
  if (games.length) {
    console.log('Games');
    for (const g of games) {
      console.log('  ' + g.id + '  ' + String(g.title || '').slice(0, 34).padEnd(34) + '  ' + (g.play_count || 0) + ' plays');
    }
  }
  if (threads.length) {
    console.log('Forum');
    for (const t of threads) console.log('  ' + t.id + '  [' + (t.category || '?') + '] ' + String(t.title || '').slice(0, 40));
  }
  if (people.length) {
    console.log('Creators');
    for (const p of people) console.log('  ' + p.id + '  ' + (p.display_name || '(no name)'));
  }
  console.log('\n`cudic get <id>` downloads a game, `cudic thread <id>` reads a thread.');
}

const HELP = `Cudic CLI — make and publish Cudic projects from a terminal.

Usage
  cudic login --email you@example.com [--password <pw>]   sign in, store + refresh the token
  cudic login --token <supabase access token>             one-shot token (also CUDIC_TOKEN=)
  cudic login --key <cudic_...>                           durable agent key (also CUDIC_API_KEY=)
  cudic logout                                            forget stored credentials
  cudic whoami [--json]                                   who the token belongs to
  cudic password reset --email you@example.com            email a 6-digit reset code
  cudic password reset --email ... --code 123456 --password <new>   set the new password
  cudic password change --password <new>                  change it while signed in (no code)
  cudic verify --email you@example.com [--code 123456]    send / enter a signup confirmation code
  cudic list [--json]                                     your projects (id, title, state)
  cudic new <dir> [--title "Name"]                        scaffold a starter project
  cudic push [dir] [--title T] [--description D] [--tags a,b]   create or update the project
  cudic publish [dir] [--tags a,b] [--description D]      publish (needs a pushed project)
  cudic open [id|dir] [--studio]                          print the play (or Studio) link
  cudic revisions [dir] [--json]                          list snapshots of a project
  cudic snapshot [dir] [--label text]                     snapshot the folder's files
  cudic restore <revision id> [--id game]                 restore a snapshot
  cudic diff [dir] [rev] [--against current|prev|<rev>]   what changed since a snapshot
  cudic log [dir]                                         alias for revisions

Browsing and downloads (no login needed for public things)
  cudic search <text> [--type all|games|threads|people] [--json]   ranked search everywhere
  cudic games [--q text] [--tag t] [--sort new|trending|plays|old|az] [--json]
                                                          browse the gallery
  cudic get <game id> [--out dir]                         download a game's source + assets
  cudic forums [--q text] [--sort active|new] [--category help|showcase|bug] [--json]
                                                          read the forums
  cudic thread <id> [--json]                              one thread with its replies
  cudic docs [section] [--search text] [--json]           the docs as plain text

Shop (account)
  cudic shop [list] [--json]                              catalog, prices, balance, what you own
  cudic shop buy <code>                                   buy a cosmetic
  cudic shop equip <slot> <code> | --off                  wear it (slots: fr bn ef ne ti em)

Editing what already exists
  cudic pull [dir] [--id game]                            bring the server copy down (backs up first)
  cudic ls [dir] / cudic ls --id <game>                   list project files with sizes
  cudic cat <path> [--id game]                            print one file's code to stdout
  cudic unpublish [dir]                                   hide a published project again
  cudic rm [dir] --id <game> --yes                        delete a project (dry run without --yes)

Your profile
  cudic profile [--json]                                  name, bio, avatar, follower counts, awards
  cudic profile set --name N --bio B --interests a,b --avatar <url>|--avatar-clear

Agent keys (durable, scoped; browser session required to manage)
  cudic key [list]                                        keys on the account
  cudic key create "label" [--scopes projects:read,projects:write]   print a new key once
  cudic key revoke <id>                                   revoke a key

Local backups (.cudic-backups/, newest 10)
  cudic backups [dir] [--json]                            what push/pull/recover saved before overwriting
  cudic recover [backup|latest] [--dir folder]            put a local backup back on disk

Environment
  CUDIC_TOKEN                account token, skips stored credentials
  CUDIC_API                  API host (default ${DEFAULT_API})
  CUDIC_WEB                  site host (default ${DEFAULT_WEB})
  CUDIC_HOME                 config directory (default ~/.cudic)

Projects keep their id in .cudic.json inside the folder, so \`push\`/\`publish\`
work without repeating the id. Files travel as text (html/css/js/json/svg/md);
binary assets still need Studio. The account must have a verified email.
`;

async function main() {
  const { pos, flags } = parse(process.argv.slice(2));
  const cmd = (pos.shift() || '').toLowerCase();
  if (flags.help || cmd === '' || cmd === 'help') { console.log(HELP); return; }
  switch (cmd) {
    case 'login': return cmdLogin(pos, flags);
    case 'logout': clearConfig(); console.log('Signed out.'); return;
    case 'whoami': return cmdWhoami(pos, flags);
    case 'password':
    case 'passwd': return cmdPassword(pos, flags);
    case 'verify': return cmdVerify(pos, flags);
    case 'list':
    case 'projects': return cmdList(pos, flags);
    case 'new':
    case 'init': return cmdNew(pos, flags);
    case 'push':
    case 'save': return cmdPush(pos, flags);
    case 'publish': return cmdPublish(pos, flags);
    case 'open':
    case 'url': return cmdOpen(pos, flags);
    case 'games':
    case 'browse': return cmdGames(pos, flags);
    case 'get':
    case 'download': return cmdGet(pos, flags);
    case 'search':
    case 'find': return cmdSearch(pos, flags);
    case 'forums': return cmdForums(pos, flags);
    case 'thread': return cmdThread(pos, flags);
    case 'shop':
    case 'cosmetics': return cmdShop(pos, flags);
    case 'docs':
    case 'doc': return cmdDocs(pos, flags);
    case 'revisions':
    case 'history': return cmdRevisions(pos, flags);
    case 'snapshot': return cmdSnapshot(pos, flags);
    case 'restore': return cmdRestore(pos, flags);
    case 'diff': return cmdDiff(pos, flags);
    case 'log': return cmdRevisions(pos, flags);
    case 'pull': return cmdPull(pos, flags);
    case 'ls':
    case 'files': return cmdLs(pos, flags);
    case 'cat':
    case 'code': return cmdCat(pos, flags);
    case 'profile':
    case 'me': return cmdProfile(pos, flags);
    case 'unpublish': return cmdUnpublish(pos, flags);
    case 'rm':
    case 'delete': return cmdRm(pos, flags);
    case 'backups':
    case 'backup': return cmdBackups(pos, flags);
    case 'recover': return cmdRecover(pos, flags);
    case 'key':
    case 'keys': return cmdKey(pos, flags);
    default: die('unknown command "' + cmd + '". Try `cudic help`.');
  }
}

main().catch((e) => die((e && e.message) || String(e)));
