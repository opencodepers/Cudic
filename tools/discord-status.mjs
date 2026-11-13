#!/usr/bin/env node
/* file: tools/discord-status.mjs
 * what: probes the live site and posts to the Discord #website-status webhook
 *       when the state changes (up → down, down → up, degraded).
 * why: the app lives on a host that sleeps and a proxy that can be up while the
 *       app is not, so "is it up" has to be checked from outside, on a timer.
 *       A GitHub Actions cron does that; posting only on change keeps the
 *       channel readable instead of posting "still up" 144 times a day.
 * invariants: never exits non-zero because the site is down (that is the thing
 *       being reported, not a workflow failure); writes the state file even when
 *       it cannot post, so the next run still knows what happened; no webhook
 *       configured = log and exit 0.
 * see: .github/workflows/discord-status.yml, lib/discord.js
 */

import fs from 'node:fs';

const SITE = (process.env.SITE_URL || 'https://cudic.vercel.app').replace(/\/+$/, '');
const HOOK = String(process.env.DISCORD_STATUS_WEBHOOK || '').trim();
const argv = process.argv.slice(2);
const argOf = (flag, fallback) => (argv.includes(flag) ? argv[argv.indexOf(flag) + 1] : fallback);
const STATE_PATH = argOf('--state', '.discord-status.json');
const DRY = argv.includes('--dry');
const FORCE = argv.includes('--force');

// /arcade is served by the app itself (rewritten through Vercel), so it is the
// real signal. / is static on Vercel and catches "the whole domain is broken".
const TARGETS = [
  { label: 'Arcade (app)', path: '/arcade', timeout: 15000 },
  { label: 'Homepage', path: '/', timeout: 10000 }
];

const COLORS = { up: 0x2ecc71, degraded: 0xe67e22, down: 0xe74c3c };
const TITLES = {
  up: 'Cudic is up',
  degraded: 'Cudic is reachable, but something is off',
  down: 'Cudic is down'
};

async function probe(target) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), target.timeout);
  const started = Date.now();
  try {
    const res = await fetch(SITE + target.path, {
      signal: ctl.signal,
      redirect: 'follow',
      headers: { 'user-agent': 'cudic-status/1.0 (+' + SITE + ')' }
    });
    // Drain the body so the timing covers a real response, not just headers.
    await res.arrayBuffer().catch(() => {});
    return { label: target.label, path: target.path, ok: res.ok, code: res.status, ms: Date.now() - started };
  } catch (e) {
    return {
      label: target.label,
      path: target.path,
      ok: false,
      code: e.name === 'AbortError' ? 'timeout' : 'error',
      ms: Date.now() - started,
      error: e.message
    };
  } finally {
    clearTimeout(timer);
  }
}

function readPrev() {
  try {
    const raw = JSON.parse(fs.readFileSync(STATE_PATH, 'utf8'));
    return { state: String(raw.state || ''), since: Number(raw.since) || 0 };
  } catch {
    return { state: '', since: 0 };
  }
}

function fieldFor(check) {
  const value = check.ok
    ? 'HTTP ' + check.code + ' · ' + check.ms + ' ms'
    : String(check.code) + ' · ' + check.ms + ' ms';
  return { name: check.label, value, inline: true };
}

function describe(state, checks) {
  if (state === 'up') return 'Both the arcade and the homepage answered normally.';
  if (state === 'down') return 'The app is not answering, so the arcade, game pages and thumbnails are unreachable.';
  const broken = checks.filter((c) => !c.ok).map((c) => c.label.toLowerCase()).join(' and ');
  return broken + ' failed while the rest of the site answered.';
}

const checks = await Promise.all(TARGETS.map(probe));
// "down" means the app itself failed; a partial failure is reported as degraded.
const state = checks.every((c) => c.ok) ? 'up' : (checks[0].ok ? 'degraded' : 'down');
const prev = readPrev();
const changed = state !== prev.state;
const now = Date.now();
const since = changed ? now : prev.since;
const downMinutes = state === 'up' && prev.state && prev.state !== 'up' && prev.since
  ? Math.max(1, Math.round((now - prev.since) / 60000))
  : 0;

const summary = checks.map((c) => c.label + '=' + (c.ok ? 'ok' : String(c.code)) + '/' + c.ms + 'ms').join(' ');
console.log('site ' + SITE + ': ' + state + (changed ? ' (changed from ' + (prev.state || 'unknown') + ')' : '') + ' — ' + summary);

const embed = {
  title: TITLES[state] + (state === 'up' && downMinutes ? ' — back after ' + downMinutes + ' min' : ''),
  description: describe(state, checks),
  color: COLORS[state],
  fields: checks.map(fieldFor),
  footer: { text: SITE + ' · checked every 10 minutes' },
  timestamp: new Date()
};

const body = { username: 'Cudic Status', allowed_mentions: { parse: [] }, embeds: [embed] };

// Write state before posting: a webhook failure must not make the next run
// announce the same transition again.
fs.writeFileSync(STATE_PATH, JSON.stringify({ state, since, at: new Date(now).toISOString(), checks }, null, 2));

if (DRY) {
  console.log('--dry: would post\n' + JSON.stringify(body, null, 2));
  process.exit(0);
}
if (!HOOK) {
  console.log('DISCORD_STATUS_WEBHOOK not set — state recorded, nothing posted.');
  process.exit(0);
}
if (!changed && !FORCE) {
  console.log('No change since last run — staying quiet.');
  process.exit(0);
}

const ctl = new AbortController();
const timer = setTimeout(() => ctl.abort(), 8000);
try {
  const res = await fetch(HOOK + '?wait=true', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal: ctl.signal
  });
  if (!res.ok) {
    console.error('status webhook:', res.status, (await res.text().catch(() => '')).slice(0, 200));
    process.exit(1);
  }
  console.log('Posted "' + embed.title + '" to Discord.');
} catch (e) {
  console.error('status webhook failed:', e.message);
  process.exit(1);
} finally {
  clearTimeout(timer);
}
