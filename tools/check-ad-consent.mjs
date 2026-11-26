/* file: tools/check-ad-consent.mjs
 * what: Browser gate for the cookie gate: loads every page carrying an ad slot
 *   in headless Chrome with no consent cookie and fails if the page makes a
 *   single ad-network request, then accepts advertising and proves the same
 *   detector fires.
 * invariants: the pre-consent half is a NETWORK assertion (Network.requestWillBeSent),
 *   never a source grep — the markup can look gated while a script still fetches.
 *   The post-consent control must never be skipped: without it a typo in
 *   AD_HOSTS makes "zero requests" pass forever. Slots must also be hidden and
 *   window._cudicAds set before consent, so a missing ads.js cannot pass by
 *   loading nothing at all.
 * see: AGENTS.md 0.6, public/ads.js, public/consent.js, tools/check-console.mjs */

import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// ── arguments ────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const flag = (name) => argv.includes(name);
const opt = (name, fallback) => {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] != null ? argv[i + 1] : fallback;
};

const PORT = Number(opt('--port', process.env.CHECK_PORT || 3021));
const EXTERNAL_URL = opt('--url', '');
const SETTLE_MS = Number(opt('--wait', 1800));
const CONTROL_MS = Number(opt('--control-wait', 15000));
const PAGES_ARG = opt('--pages', '');
const HEADFUL = flag('--headful');
const VERBOSE = flag('--verbose');
const ROOT = process.cwd();
const ORIGIN = EXTERNAL_URL ? EXTERNAL_URL.replace(/\/$/, '') : 'http://127.0.0.1:' + PORT;
const CHROME_PORT = Number(opt('--chrome-port', 9300)) + (process.pid % 400);

// Every host a Cudic page has ever pulled an ad from. Matching is on the
// request URL, so the list is the whole claim this file makes: keep it honest.
const AD_HOSTS = [
  ['Adsterra', /bellnewyork\.org/i],
  ['bauval ad zone', /bauval\.org/i],
  ['HighPerformanceFormat', /highperformanceformat\.com/i],
  ['Profitableratecpm', /profitableratecpm\.com/i],
  ['Adsterra network', /adsterra/i],
  ['Google AdSense', /googlesyndication\.com|googleadservices\.com|doubleclick\.net|adsbygoogle/i],
  ['Google ad serving', /googletagservices\.com/i]
];

// Not pages: old copies kept for reference, stubs, verification files.
const SKIP = new Set([
  'index-legacy.html',
  'login-legacy.html',
  'landing-backup.html',
  'hello.html',
  'google7e57250a9f1cfa2a.html'
]);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const oneLine = (s) => String(s).replace(/\s+/g, ' ').trim();
const shrink = (u) => oneLine(u).replace(ORIGIN, '').slice(0, 160);

// ── which pages ──────────────────────────────────────────────────────────────
function discoverPages() {
  if (PAGES_ARG) {
    return PAGES_ARG.split(',')
      .map((p) => p.trim())
      .filter(Boolean)
      .map((p) => (p.startsWith('/') ? p : '/' + p));
  }
  let names = [];
  try {
    names = readdirSync(join(ROOT, 'public')).filter((f) => f.endsWith('.html') && !SKIP.has(f));
  } catch (e) {
    console.log('pages: cannot read public/ — ' + e.message);
  }
  return names
    .filter((f) => {
      try {
        return /data-ad-key|data-ad-script/.test(readFileSync(join(ROOT, 'public', f), 'utf8'));
      } catch {
        return false;
      }
    })
    .sort()
    .map((f) => '/' + f);
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

async function waitFor(fn, timeoutMs, stepMs = 150) {
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

const spawned = [];
function killTree(child) {
  if (!child || child.exitCode != null || child.killed) return;
  if (process.platform === 'win32') {
    try {
      spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
      return;
    } catch {
      /* fall through */
    }
  }
  try {
    child.kill('SIGKILL');
  } catch {
    /* already gone */
  }
}

const failures = [];
const fail = (msg) => failures.push(msg);

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
      const res = await fetch(ORIGIN + '/', { redirect: 'manual' });
      return res.status < 500;
    }, 40000, 300);
    if (!up) {
      console.log(serverLog.split(/\r?\n/).slice(-12).join('\n'));
      throw new Error('server: did not answer on port ' + PORT + ' within 40s');
    }
    console.log('server: up on port ' + PORT);
  }

  // ── browser ────────────────────────────────────────────────────────────────
  if (!chromePath) throw new Error('chrome: not found — set CHROME_PATH to a Chrome/Edge binary');
  profileDir = mkdtempSync(join(tmpdir(), 'cudic-adconsent-'));
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
  }, 25000, 250);
  if (!ready) throw new Error('chrome: DevTools never came up on port ' + CHROME_PORT);

  ws = new WebSocket(pageTarget.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve, { once: true });
    ws.addEventListener('error', () => reject(new Error('websocket failed')), { once: true });
  });
  const cdp = new CDP(ws);

  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  await cdp.send('Network.enable');

  // One list per page: a request is always attributed to the page that made it.
  let requests = [];
  cdp.on('Network.requestWillBeSent', (p) => {
    const r = p.request || {};
    const initiator = p.initiator || {};
    const frame = (initiator.stack && initiator.stack.callFrames && initiator.stack.callFrames[0]) || {};
    requests.push({
      url: r.url || '',
      method: r.method || 'GET',
      type: p.type || '',
      from: frame.url || initiator.url || initiator.type || ''
    });
  });

  let loaded = false;
  cdp.on('Page.loadEventFired', () => (loaded = true));

  const clearCookies = () => cdp.send('Network.clearBrowserCookies');

  async function goto(path) {
    requests = [];
    loaded = false;
    await cdp.send('Page.navigate', { url: /^https?:\/\//.test(path) ? path : ORIGIN + path });
    const ok = await waitFor(() => loaded, 20000, 100);
    if (!ok) throw new Error('page did not fire load within 20s');
    await sleep(SETTLE_MS);
  }

  const SNAPSHOT = `(() => {
    const slots = Array.from(document.querySelectorAll('[data-ad-key],[data-ad-script]')).map((el) => ({
      id: el.getAttribute('data-ad-key') || el.getAttribute('data-ad-script') || '',
      display: getComputedStyle(el).display,
      armed: el.dataset.adArmed || '',
      loaded: el.dataset.adLoaded || '',
      scripts: Array.from(el.querySelectorAll('script')).map((s) => s.src)
    }));
    return {
      path: location.pathname,
      consent: (document.cookie.match(/(?:^|; )cudic_consent=([^;]*)/) || [])[1] || '',
      adsScriptRan: !!window._cudicAds,
      slots,
      scriptSrcs: Array.from(document.scripts).map((s) => s.src).filter(Boolean)
    };
  })()`;

  async function snapshot() {
    const r = await cdp.send('Runtime.evaluate', { expression: SNAPSHOT, returnByValue: true });
    return r.result && r.result.value ? r.result.value : {};
  }

  const adHits = (urls) => {
    const hits = [];
    for (const url of urls) {
      const host = AD_HOSTS.find(([, re]) => re.test(url));
      if (host) hits.push({ host: host[0], url });
    }
    return hits;
  };

  // ── 1. before consent: not one ad request ─────────────────────────────────
  const pages = discoverPages();
  if (!pages.length) throw new Error('pages: nothing to scan (no page has data-ad-key/data-ad-script?)');
  console.log('pages: ' + pages.length + ' with an ad slot\n');

  await clearCookies();
  let checked = 0;

  for (const path of pages) {
    let state;
    try {
      await goto(path);
      state = await snapshot();
    } catch (e) {
      fail(path + ' — ' + e.message);
      console.log('[FAIL] ' + path + ' — ' + e.message);
      continue;
    }
    checked++;
    if (VERBOSE) {
      console.log('       ' + requests.length + ' request(s), ads.js ran: ' + (state.adsScriptRan ? 'yes' : 'NO'));
      for (const r of requests) console.log('       ← ' + shrink(r.url) + (r.from ? '   from ' + shrink(r.from) : ''));
      console.log('       slots: ' + JSON.stringify(state.slots));
    }

    // Signed-out pages bounce to /login from client.js, so the slots above were
    // in the document that navigated away. The network assertion still covers
    // the whole trip; the slot/DOM assertions only make sense on the page we
    // actually landed on.
    const landed = String(state.path || '').replace(/\/$/, '');
    const redirected = landed !== '' && landed !== path.split('?')[0];
    const slots = state.slots || [];

    const netHits = adHits(requests.map((r) => r.url));
    const domHits = adHits(state.scriptSrcs || []);
    const slotScripts = (state.slots || []).flatMap((s) => s.scripts || []);
    const slotHits = adHits(slotScripts);

    const problems = [];
    if (netHits.length) {
      problems.push(
        'made ' + netHits.length + ' ad request(s) before consent: ' +
          netHits.map((h) => h.host + ' ' + shrink(h.url)).join(' | ')
      );
      if (VERBOSE) {
        const byInitiator = [...new Set(
          requests.filter((r) => AD_HOSTS.some(([, re]) => re.test(r.url))).map((r) => r.from || '(unknown)')
        )];
        for (const from of byInitiator) console.log('       initiated by: ' + shrink(from));
      }
    }
    if (domHits.length) {
      problems.push('loaded an ad script before consent: ' + domHits.map((h) => shrink(h.url)).join(' | '));
    }
    if (slotHits.length) {
      problems.push('injected an ad script into a slot before consent: ' + slotHits.map((h) => shrink(h.url)).join(' | '));
    }
    if (state.consent) problems.push('a consent cookie was already set, so the run proves nothing');
    if (!redirected && slots.length && !state.adsScriptRan) {
      problems.push('ads.js never ran (window._cudicAds is unset) — nothing was gated');
    }
    for (const slot of slots) {
      if (slot.armed !== '1' && slot.display !== 'none') {
        problems.push('slot ' + slot.id.slice(0, 16) + '… was visible without consent (display: ' + slot.display + ')');
      }
      if (slot.loaded === '1') problems.push('slot ' + slot.id.slice(0, 16) + '… was injected without consent');
    }

    if (problems.length) {
      console.log('[FAIL] ' + path);
      for (const p of problems) {
        console.log('       ' + p);
        fail(path + ' — ' + p);
      }
    } else {
      const note = redirected ? ' redirected to ' + landed + ' (no slot there)' : '';
      console.log('[ ok ] ' + path.padEnd(18) + slots.length + ' slot(s) hidden, 0 ad requests' + note);
    }
  }

  // ── 2. after consent: the detector still sees the network ────────────────
  const controlPath = pages.includes('/index.html') ? '/index.html' : pages[0];
  const consent = encodeURIComponent(JSON.stringify({ advertising: true, analytics: false }));
  const set = await cdp.send('Network.setCookie', {
    name: 'cudic_consent',
    value: consent,
    url: ORIGIN + '/',
    path: '/'
  });
  if (!set || set.success === false) fail('control — could not set cudic_consent, so the detector is unproven');

  let controlState = {};
  let controlHit = null;
  try {
    requests = [];
    loaded = false;
    await cdp.send('Page.navigate', { url: ORIGIN + controlPath });
    await waitFor(() => loaded, 20000, 100);
    const found = await waitFor(() => {
      controlHit = adHits(requests.map((r) => r.url))[0] || null;
      return controlHit != null;
    }, CONTROL_MS, 200);
    if (found) await sleep(400);
    controlState = await snapshot();
  } catch (e) {
    fail('control — ' + e.message);
  }

  if (controlHit) {
    console.log('\n[ ok ] control: with advertising accepted, ' + controlPath + ' requested ' + controlHit.host);
  } else {
    fail(
      'control — after accepting advertising, ' + controlPath + ' made no request matching AD_HOSTS, ' +
        'so the pre-consent result above cannot be trusted'
    );
    console.log('\n[FAIL] control: no ad request after consent on ' + controlPath);
  }
  if (!controlState.adsScriptRan) console.log('       note: ads.js did not run on the control page');

  // ── 3. the settings control reopens the bar and can withdraw ──────────────
  // Clicked through the real control, not by writing the cookie here: a button
  // that exists but does nothing has to fail, not pass.
  let settingsOk = false;
  let withdrawOk = false;
  try {
    await goto('/privacy.html');
    const opened = await cdp.send('Runtime.evaluate', {
      expression:
        "(() => { const b = document.querySelector('[data-consent-settings]'); if (!b) return 'no control';" +
        " b.click(); const bar = document.getElementById('cudicConsentBar');" +
        " return bar && getComputedStyle(bar).display !== 'none' ? 'bar' : 'no bar'; })()",
      returnByValue: true
    });
    settingsOk = (opened.result && opened.result.value) === 'bar';
    if (!settingsOk) {
      fail('settings — the Cookie settings control did not reopen the consent bar on /privacy.html');
    } else {
      console.log('[ ok ] settings: Cookie settings reopened the bar on /privacy.html');
      const mark = requests.length;
      loaded = false;
      const rejected = await cdp
        .send('Runtime.evaluate', {
          expression:
            "(() => { const hadAds = !!(window.__cudicAds || window._cudicAds);" +
            " window.__consentProbe = 'before';" +
            " const b = document.getElementById('cudicConsentReject'); if (!b) return 'no button';" +
            " b.click(); return hadAds ? 'had-ads' : 'no-ads'; })()",
          returnByValue: true
        })
        .catch(() => null);
      const hadAds = rejected && rejected.result && rejected.result.value === 'had-ads';
      // Withdrawing reloads on purpose, so the ad scripts that already ran stop.
      await waitFor(() => loaded, 8000, 150);
      await sleep(1000);
      const after = await snapshot();
      let choice = null;
      try {
        choice = after.consent ? JSON.parse(decodeURIComponent(after.consent)) : null;
      } catch {
        choice = null;
      }
      withdrawOk = !!(choice && choice.advertising !== true);
      if (!withdrawOk) {
        fail('settings — rejecting in the reopened bar did not clear advertising consent');
      } else {
        console.log('[ ok ] settings: Reject all in the reopened bar cleared advertising consent');
      }
      // The page marker only disappears on a real reload, which is what stops
      // a script that already ran. When ads had loaded, it must be gone.
      if (hadAds) {
        const probe = await cdp
          .send('Runtime.evaluate', { expression: "typeof window.__consentProbe", returnByValue: true })
          .catch(() => null);
        const reloaded = probe && probe.result && probe.result.value === 'undefined';
        if (reloaded) {
          console.log('[ ok ] settings: withdrawing ads reloaded the page, so the loaded ad script stopped');
        } else {
          fail('settings — withdrawing ads did not reload the page, so the ad script keeps running');
        }
      }
      const lateHits = adHits(requests.slice(mark).map((r) => r.url));
      if (lateHits.length) {
        fail(
          'settings — ' + lateHits.length + ' ad request(s) after withdrawing consent: ' +
            lateHits.map((h) => h.host).join(', ')
        );
      }
    }
  } catch (e) {
    fail('settings — ' + e.message);
  }

  // ── report ────────────────────────────────────────────────────────────────
  console.log('');
  if (failures.length) {
    console.log('summary: ' + checked + ' page(s) checked before consent, ' + failures.length + ' failure(s)');
    process.exitCode = 1;
    console.log('FAIL — ad requests escaped the consent gate');
  } else {
    console.log(
      'summary: ' + checked + ' page(s) with an ad slot — 0 ad-network requests before consent, ' +
        'control fired after accepting'
    );
    console.log('OK — advertising is gated by the cookie everywhere it is defined');
  }
} catch (e) {
  if (e && e.message) console.log('check-ad-consent: ' + e.message);
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
