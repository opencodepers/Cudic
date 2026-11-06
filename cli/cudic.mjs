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

async function token() {
  const env = process.env.CUDIC_TOKEN;
  if (env) return env.trim();
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

/** Fetch a Cudic API path with the account token; refreshes once on 401. */
async function api(pathname, opts = {}) {
  const body = opts.body === undefined ? undefined : JSON.stringify(opts.body);
  const send = async (t) => fetch(apiBase() + pathname, {
    method: opts.method || 'GET',
    headers: {
      Authorization: 'Bearer ' + t,
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    ...(body === undefined ? {} : { body }),
  });
  let t = await token();
  let res = await send(t);
  if (res.status === 401 && !process.env.CUDIC_TOKEN) {
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

const HELP = `Cudic CLI — make and publish Cudic projects from a terminal.

Usage
  cudic login --email you@example.com [--password <pw>]   sign in, store + refresh the token
  cudic login --token <supabase access token>             one-shot token (also CUDIC_TOKEN=)
  cudic logout                                            forget stored credentials
  cudic whoami [--json]                                   who the token belongs to
  cudic list [--json]                                     your projects (id, title, state)
  cudic new <dir> [--title "Name"]                        scaffold a starter project
  cudic push [dir] [--title T] [--description D] [--tags a,b]   create or update the project
  cudic publish [dir] [--tags a,b] [--description D]      publish (needs a pushed project)
  cudic open [id|dir] [--studio]                          print the play (or Studio) link

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
    case 'list':
    case 'projects': return cmdList(pos, flags);
    case 'new':
    case 'init': return cmdNew(pos, flags);
    case 'push':
    case 'save': return cmdPush(pos, flags);
    case 'publish': return cmdPublish(pos, flags);
    case 'open':
    case 'url': return cmdOpen(pos, flags);
    default: die('unknown command "' + cmd + '". Try `cudic help`.');
  }
}

main().catch((e) => die((e && e.message) || String(e)));
