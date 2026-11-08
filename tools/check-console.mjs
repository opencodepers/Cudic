/* file: tools/check-console.mjs
 * what: The gate the test suite cannot be: it runs `tests/run_tests.py`, boots
 *   Cudic on a spare port, then loads Studio AND every top-level page in
 *   public/*.html in headless Chrome over the DevTools protocol, reporting each
 *   page's console messages, page exceptions and failed resource loads.
 * invariants: no npm dependency — Chrome is driven over the CDP WebSocket Node
 *   ships (24+), so this cannot rot when a driver package is missing. Console
 *   errors on ANY page fail the run; warnings do only with --strict. The server
 *   and the browser are killed in a finally block, including on failure, and the
 *   temp profile is removed — a leaked chrome.exe would poison the next run.
 *   The KNOWN baseline only ever silences platform noise, each entry carrying
 *   the reason it cannot be fixed here; it is printed, never hidden, and
 *   `--no-baseline` turns it off so an upstream fix can be verified. New errors
 *   always fail the gate — that is the whole point of the file.
 * see: AGENTS.md (Gate list), tests/run_tests.py, tools/check-docs.py */

import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// ── arguments ────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const flag = (name) => argv.includes(name);
const opt = (name, fallback) => {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] != null ? argv[i + 1] : fallback;
};
const ignores = [];
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === '--ignore' && argv[i + 1] != null) {
    try {
      ignores.push(new RegExp(argv[i + 1], 'i'));
    } catch {
      console.error('check-console: --ignore needs a valid regex, got ' + argv[i + 1]);
      process.exit(2);
    }
  }
}

const PORT = Number(opt('--port', process.env.CHECK_PORT || 3019));
const EXTERNAL_URL = opt('--url', '');
const PAGES_ARG = opt('--pages', '');
const SETTLE_MS = Number(opt('--wait', 2500));
const STRICT = flag('--strict');
const RUN_TESTS = !flag('--no-tests');
const HEADFUL = flag('--headful');
const CHROME_PORT = Number(opt('--chrome-port', 9200)) + (process.pid % 400);
const ROOT = process.cwd();
const ORIGIN = EXTERNAL_URL ? EXTERNAL_URL.replace(/\/$/, '') : 'http://127.0.0.1:' + PORT;

// Pages that are not pages: old copies kept for reference, an empty probe, and
// Google's site-verification stub. Everything else in public/*.html is scanned.
const SKIP = new Set([
  'index-legacy.html',
  'login-legacy.html',
  'landing-backup.html',
  'hello.html',
  'google7e57250a9f1cfa2a.html'
]);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Noise that comes with the platform, not from Cudic. Every entry says why it
// cannot be fixed in this repo, and the report prints it as KNOWN rather than
// dropping it — an ignored error that nobody can see is how real ones hide.
const KNOWN = flag('--no-baseline')
  ? []
  : [
      {
        re: /Cannot destructure property 'applyStateStackDiff'/,
        why: 'upstream @codingame/monaco-vscode-textmate-service-override 37.1.0: the background tokenizer worker resolves this helper as undefined in the browser build'
      },
      {
        // Pinned ports on purpose: a bare /localhost/ pattern would also match
        // Cudic's own origin and hide a real failure of the app under test.
        re: /localhost:(?:11434|1234)\//,
        why: 'the AI panel probing the local model servers it knows — Ollama :11434 and LM Studio :1234 — refused when neither is running'
      }
    ];

// ── which pages ──────────────────────────────────────────────────────────────
function discoverPages() {
  if (EXTERNAL_URL) return [EXTERNAL_URL];
  if (PAGES_ARG) {
    return PAGES_ARG.split(',')
      .map((p) => p.trim())
      .filter(Boolean)
      .map((p) => (p.startsWith('/') ? p : '/' + p));
  }
  let names = [];
  try {
    names = readdirSync(join(ROOT, 'public'))
      .filter((f) => f.endsWith('.html') && !SKIP.has(f))
      .sort();
  } catch (e) {
    console.log('pages: cannot read public/ — ' + e.message);
  }
  // Studio first: it is the page under active work, and when it fails the rest
  // of the report reads like a hang.
  return ['/studio', ...names.map((f) => '/' + f)];
}

// ── the test suite, first: a red suite makes the console scan pointless ──────
let testsFailed = false;
if (RUN_TESTS) {
  const py = process.platform === 'win32' ? 'python' : 'python3';
  const run = spawnSync(py, ['tests/run_tests.py'], { cwd: ROOT, encoding: 'utf8' });
  const out = String(run.stdout || '') + String(run.stderr || '');
  const summary = out.split(/\r?\n/).filter((l) => /^run=\d+/.test(l.trim())).pop();
  console.log('tests: ' + (summary ? summary.trim() : 'no summary line — see python tests/run_tests.py'));
  if (run.status !== 0) {
    testsFailed = true;
    console.log(out.split(/\r?\n/).filter((l) => /^FAIL|^ERROR|AssertionError/.test(l.trim())).slice(0, 12).join('\n'));
  }
}

// ── chrome ───────────────────────────────────────────────────────────────────
const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  process.env.LOCALAPPDATA && join(process.env.LOCALAPPDATA, 'Google/Chrome/Application/chrome.exe'),
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser'
].filter(Boolean);
const chromePath = CHROME_CANDIDATES.find((p) => existsSync(p));

// ── tiny CDP client over the WebSocket Node already has ──────────────────────
class CDP {
  constructor(ws) {
    this.ws = ws;
    this.seq = 0;
    this.pending = new Map();
    this.handlers = new Map();
    ws.addEventListener('message', (ev) => {
      let msg;
      try {
        msg = JSON.parse(ev.data);
      } catch {
        return;
      }
      if (msg.id != null) {
        const p = this.pending.get(msg.id);
        if (p) {
          this.pending.delete(msg.id);
          msg.error ? p.reject(new Error(msg.error.message)) : p.resolve(msg.result);
        }
        return;
      }
      for (const fn of this.handlers.get(msg.method) || []) fn(msg.params || {});
    });
  }
  send(method, params) {
    const id = ++this.seq;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params: params || {} }));
    });
  }
  on(method, fn) {
    if (!this.handlers.has(method)) this.handlers.set(method, []);
    this.handlers.get(method).push(fn);
  }
}

async function waitFor(fn, timeoutMs, stepMs = 250) {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    try {
      if (await fn()) return true;
    } catch {
      /* not ready yet */
    }
    await sleep(stepMs);
  }
  return false;
}

// Console arguments are RemoteObjects: primitives carry a value, objects only a
// description/preview. Print what a human would see, never "[object Object]".
function describeArgument(a) {
  if (a == null) return String(a);
  if (a.unserializableValue != null) return String(a.unserializableValue);
  if (a.value !== undefined) return typeof a.value === 'string' ? a.value : JSON.stringify(a.value);
  if (a.preview && Array.isArray(a.preview.properties)) {
    const body = a.preview.properties.map((p) => p.name + ': ' + p.value).join(', ');
    return (a.description || a.className || 'object') + (body ? ' {' + body + '}' : '');
  }
  return a.description || a.className || a.type || '(unknown)';
}

const oneLine = (s) => String(s).replace(/\s+/g, ' ').trim();
const shrink = (u) => oneLine(u).replace(ORIGIN, '').slice(0, 120);

const spawned = [];
function killTree(child) {
  if (!child || child.exitCode != null || child.killed) return;
  if (process.platform === 'win32') {
    try {
      spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
      return;
    } catch {
      /* fall through to the signal path */
    }
  }
  try {
    child.kill('SIGKILL');
  } catch {
    /* already gone */
  }
}

let ws = null;
let profileDir = null;

try {
  // ── server ─────────────────────────────────────────────────────────────────
  if (!EXTERNAL_URL) {
    const serverProcess = spawn(process.execPath, ['server.js'], {
      cwd: ROOT,
      env: { ...process.env, PORT: String(PORT) },
      stdio: ['ignore', 'pipe', 'pipe']
    });
    spawned.push(serverProcess);
    let serverLog = '';
    serverProcess.stdout.on('data', (d) => (serverLog += d));
    serverProcess.stderr.on('data', (d) => (serverLog += d));
    const up = await waitFor(async () => {
      const res = await fetch('http://127.0.0.1:' + PORT + '/studio', { redirect: 'manual' });
      return res.status < 500;
    }, 30000);
    if (!up) {
      console.log('server: did not answer on port ' + PORT + ' within 30s');
      console.log(serverLog.split(/\r?\n/).slice(-12).join('\n'));
      throw new Error('no server');
    }
    console.log('server: up on port ' + PORT);
  }

  // ── browser ────────────────────────────────────────────────────────────────
  if (!chromePath) throw new Error('chrome: not found — set CHROME_PATH to a Chrome/Edge binary');
  profileDir = mkdtempSync(join(tmpdir(), 'cudic-console-'));
  const chrome = spawn(
    chromePath,
    [
      ...(HEADFUL ? [] : ['--headless=new']),
      '--disable-gpu',
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-extensions',
      '--mute-audio',
      '--hide-scrollbars',
      '--window-size=1440,900',
      '--remote-debugging-port=' + CHROME_PORT,
      '--user-data-dir=' + profileDir,
      'about:blank'
    ],
    { stdio: ['ignore', 'ignore', 'ignore'] }
  );
  spawned.push(chrome);

  let pageTarget = null;
  const ready = await waitFor(async () => {
    const res = await fetch('http://127.0.0.1:' + CHROME_PORT + '/json/list');
    const list = await res.json();
    pageTarget = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
    return pageTarget != null;
  }, 20000);
  if (!ready) throw new Error('chrome: DevTools never came up on port ' + CHROME_PORT);

  ws = new WebSocket(pageTarget.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve, { once: true });
    ws.addEventListener('error', () => reject(new Error('websocket failed')), { once: true });
  });
  const cdp = new CDP(ws);

  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  await cdp.send('Log.enable');

  // Messages are buffered per page and reset before each navigation, so an
  // error is always attributed to the page that produced it.
  let messages = [];
  cdp.on('Runtime.consoleAPICalled', (p) => {
    const level = p.type === 'warning' ? 'warning' : p.type;
    const frame = p.stackTrace && p.stackTrace.callFrames && p.stackTrace.callFrames[0];
    messages.push({
      kind: 'console.' + level,
      level: level === 'warn' ? 'warning' : level,
      text: (p.args || []).map(describeArgument).join(' '),
      url: (frame && frame.url) || ''
    });
  });
  cdp.on('Runtime.exceptionThrown', (p) => {
    const d = p.exceptionDetails || {};
    messages.push({
      kind: 'exception',
      level: 'error',
      text: (d.exception && (d.exception.description || d.exception.value)) || d.text || 'uncaught exception',
      url: d.url || ''
    });
  });
  cdp.on('Log.entryAdded', (p) => {
    const e = p.entry || {};
    const level = e.level === 'warning' ? 'warning' : e.level;
    messages.push({ kind: 'log.' + (e.source || 'other'), level, text: e.text || '', url: e.url || '' });
  });

  // ── the sweep ──────────────────────────────────────────────────────────────
  const pages = discoverPages();
  if (!pages.length) throw new Error('pages: nothing to scan (no public/*.html?)');
  console.log('pages: ' + pages.length + ' to scan\n');

  let loaded = false;
  cdp.on('Page.loadEventFired', () => (loaded = true));

  const results = [];
  const started = Date.now();
  for (let i = 0; i < pages.length; i++) {
    const path = pages[i];
    const url = /^https?:\/\//.test(path) ? path : ORIGIN + path;
    messages = [];
    loaded = false;
    const pageStart = Date.now();

    let loadTimedOut = false;
    try {
      await cdp.send('Page.navigate', { url });
      const gotLoad = await waitFor(() => loaded, 15000, 100);
      if (!gotLoad) {
        loadTimedOut = true;
        messages.push({ kind: 'gate', level: 'error', text: 'page did not fire load within 15s', url });
      }
    } catch (e) {
      messages.push({ kind: 'gate', level: 'error', text: 'navigation failed: ' + e.message, url });
    }
    // Studio boots asynchronously (workers, extensions, layout) and needs the
    // longer window; a static page has said everything it is going to say by
    // the time its load event plus the settle window is over.
    const settle = SETTLE_MS + (path === '/studio' ? 4500 : 0);
    if (!loadTimedOut) await sleep(settle);

    let title = '';
    if (!loadTimedOut) {
      try {
        const r = await cdp.send('Runtime.evaluate', { expression: 'document.title', returnByValue: true });
        title = String((r.result && r.result.value) || '');
      } catch {
        /* title is a nicety, not a gate */
      }
    }

    const kept = [];
    const known = [];
    for (const m of messages) {
      if (ignores.some((re) => re.test(m.text) || re.test(m.url))) continue;
      if (!m.text && !m.url) continue;
      const hitKnown = KNOWN.find((k) => k.re.test(m.text) || k.re.test(m.url));
      if (hitKnown) known.push({ ...m, why: hitKnown.why });
      else kept.push(m);
    }
    const errors = kept.filter((m) => m.level === 'error');
    const warnings = kept.filter((m) => m.level === 'warning' || m.level === 'warn');
    const rest = kept.filter((m) => m.level !== 'error' && !warnings.includes(m));
    results.push({ path, title, errors, warnings, rest, known, ms: Date.now() - pageStart });

    const flagText = errors.length ? ' — ' + errors.length + ' error(s)' : warnings.length ? ' — ' + warnings.length + ' warning(s)' : '';
    console.log(
      '[' + String(i + 1).padStart(2) + '/' + pages.length + '] ' + path.padEnd(24) +
      String(Date.now() - pageStart + 'ms').padStart(7) + flagText
    );
  }

  // ── report ─────────────────────────────────────────────────────────────────
  const dedupe = (rows) => {
    const out = new Map();
    for (const m of rows) {
      const key = m.level + '|' + m.kind + '|' + m.text;
      const hit = out.get(key);
      if (hit) hit.count += 1;
      else out.set(key, { ...m, count: 1 });
    }
    return [...out.values()];
  };
  const print = (m) => {
    const times = m.count > 1 ? ' (×' + m.count + ')' : '';
    console.log('  [' + m.kind + '] ' + oneLine(m.text).slice(0, 280) + times + (m.url ? '  ← ' + shrink(m.url) : ''));
  };

  const failing = results.filter((p) => p.errors.length);
  const warningPages = results.filter((p) => p.warnings.length);
  const knownRows = results.flatMap((p) => p.known.map((k) => ({ ...k, page: p.path })));
  const totalErrors = results.reduce((n, p) => n + p.errors.length, 0);
  const totalWarnings = results.reduce((n, p) => n + p.warnings.length, 0);

  for (const page of failing) {
    console.log('\nERRORS on ' + page.path + (page.title ? ' — "' + oneLine(page.title).slice(0, 80) + '"' : '') + ':');
    const rows = dedupe(page.errors);
    for (const m of rows.slice(0, 15)) print(m);
    if (rows.length > 15) console.log('  … ' + (rows.length - 15) + ' more');
  }
  for (const page of warningPages) {
    console.log('\nWARNINGS on ' + page.path + ':');
    for (const m of dedupe(page.warnings).slice(0, 10)) print(m);
  }
  if (flag('--all')) {
    for (const page of results.filter((p) => p.rest.length)) {
      console.log('\nMESSAGES on ' + page.path + ':');
      for (const m of dedupe(page.rest).slice(0, 20)) print(m);
    }
  }
  if (knownRows.length) {
    console.log('\nKNOWN (baseline, not failing — --no-baseline to enforce):');
    const byWhy = new Map();
    for (const k of knownRows) {
      const hit = byWhy.get(k.why);
      if (hit) {
        hit.count += 1;
        if (!hit.pages.includes(k.page)) hit.pages.push(k.page);
      } else byWhy.set(k.why, { ...k, count: 1, pages: [k.page] });
    }
    for (const k of byWhy.values()) {
      const where = k.pages.length > 3 ? k.pages.slice(0, 3).join(', ') + ' +' + (k.pages.length - 3) : k.pages.join(', ');
      console.log('  [' + k.kind + '] ' + oneLine(k.text).slice(0, 180) + ' (×' + k.count + ' on ' + where + ')');
      console.log('      why: ' + k.why);
    }
  }

  const secs = ((Date.now() - started) / 1000).toFixed(1);
  console.log(
    '\nsummary: ' + results.length + ' page(s) in ' + secs + 's — ' +
    failing.length + ' with errors, ' + warningPages.length + ' with warnings'
  );
  console.log(
    'console: ' + totalErrors + ' error(s) across ' + failing.length + ' page(s), ' +
    totalWarnings + ' warning(s), ' + knownRows.length + ' known'
  );

  if (totalErrors) {
    process.exitCode = 1;
    console.log('FAIL — console errors above (' + failing.map((p) => p.path).join(', ') + ')');
  } else if (STRICT && totalWarnings) {
    process.exitCode = 1;
    console.log('FAIL — --strict and warnings above');
  } else if (testsFailed) {
    process.exitCode = 1;
    console.log('FAIL — test suite above');
  } else {
    console.log('OK — suite green, no console errors on any page');
  }
} catch (e) {
  if (e && e.message) console.log('check-console: ' + e.message);
  process.exitCode = 1;
} finally {
  try {
    if (ws && ws.readyState === 1) ws.close();
  } catch {
    /* closing a dead socket is fine */
  }
  spawned.reverse().forEach(killTree);
  if (profileDir) {
    try {
      rmSync(profileDir, { recursive: true, force: true });
    } catch {
      /* chrome may still hold a file; the OS temp cleaner gets it */
    }
  }
}
