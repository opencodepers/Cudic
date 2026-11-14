#!/usr/bin/env node
/* file: tools/discord-update.mjs
 * what: reads the commits in one push, writes a couple of sentences about what
 *       changed, and posts them to the Discord #updates webhook.
 * why: a CHANGELOG is for people who read changelogs. The channel is for people
 *       who just want to know what changed, so the message has to sound like a
 *       person typed it — no hashes, no file paths, no talk about how it shipped.
 * invariants: the message never mentions tooling (git, commits, branches, GitHub,
 *       webhooks, bots, AI, assistants) — offending sentences are dropped and, if
 *       nothing survives, the cleaned commit subjects stand in plainly; a missing
 *       or failing webhook never fails the run; a push with no commits posts
 *       nothing; the webhook is only posted to over the validated URL in
 *       lib/discord.js, and never with mentions enabled.
 * see: .github/workflows/discord-updates.yml, lib/discord.js
 */

import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const discord = require('../lib/discord');

const argv = process.argv.slice(2);
const DRY = argv.includes('--dry');
const RANGE = (() => {
  const i = argv.indexOf('--range');
  return i >= 0 ? String(argv[i + 1] || '') : '';
})();

const MODEL = process.env.UPDATE_MODEL || 'openai/gpt-4o-mini';
const TOKEN = String(process.env.GITHUB_TOKEN || process.env.GH_TOKEN || '').trim();
const BEFORE = String(process.env.BEFORE || '').trim();
const AFTER = String(process.env.AFTER || '').trim();

const HEADLINE_MAX = 80;
const BODY_MAX = 900;
const KEEP_MAX = 12;

// Anything that would read as "a machine wrote this from a commit log".
const TOOLING = /\b(codebuff|github|git|commit|commits|commitlog|webhook|webhooks|pull request|merge|repository|repo|branch|cherry-pick|rebase|ci|ai|llm|assistant|automation|automated|bot|generated|co-authored)\b/i;
const TRAILER = /^(co-authored-by|signed-off-by|reviewed-by|generated with|generated-by|🤖|\u{1F916}|ai:|assistant:)/iu;

const SYSTEM = [
  'You write short release notes for Cudic, a place where people build small browser games and share them.',
  'Voice: a maker typing a quick update to the people playing — warm, plain, concrete. No marketing, no exclamation marks, no emoji.',
  'Format: exactly two lines. Line 1 is a headline of at most six words, no full stop. Line 2 is one or two sentences, at most 300 characters.',
  'Describe what someone playing or building will notice. Skip anything only visible in the source.',
  'Never mention how the change was made or shipped: no git, commits, branches, pull requests, GitHub, deploys, webhooks, bots, automation, AI, assistants, or anyone\'s name.',
  'Never invent a feature that is not in the notes. Plain English.'
].join(' ');

function git(args) {
  try {
    return execFileSync('git', args, { encoding: 'utf8', maxBuffer: 8_000_000, stdio: ['ignore', 'pipe', 'ignore'] });
  } catch {
    return '';
  }
}

/** The commit range for this push, or '' when there is nothing sound to use. */
function rangeArg() {
  if (RANGE) return RANGE;
  if (BEFORE && AFTER && BEFORE !== AFTER && !/^0+$/.test(BEFORE)) return BEFORE + '..' + AFTER;
  return '';
}

function readCommits() {
  const fmt = ['log', '--no-merges', '--format=%x1e%s%x1f%b'];
  const range = rangeArg();
  let out = range ? git(fmt.concat(range)) : '';
  // A force push or a fresh branch leaves no usable range; a few recent commits
  // still say something truthful about what just landed.
  if (!out) out = git(fmt.concat(['-n', '6']));

  const seen = new Set();
  const commits = [];
  for (const chunk of out.split('\x1e')) {
    const [subjectRaw = '', bodyRaw = ''] = chunk.split('\x1f');
    const subject = subjectRaw.trim();
    if (!subject || /^(merge|revert)\b/i.test(subject)) continue;
    const clean = subject
      .replace(/^(feat|fix|chore|docs|test|tests|refactor|style|perf|build|ci)(\([^)]*\))?!?:\s*/i, '')
      .replace(/\s+/g, ' ')
      .trim();
    if (!clean || seen.has(clean.toLowerCase())) continue;
    seen.add(clean.toLowerCase());
    const body = bodyRaw
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l && !TRAILER.test(l))
      .join(' ')
      .replace(/\s+/g, ' ')
      .slice(0, 240);
    commits.push({ subject: clean.slice(0, 160), body });
    if (commits.length >= KEEP_MAX) break;
  }
  return commits;
}

/** Keep the sentences that would not read as machine output. */
function scrub(text) {
  return String(text || '')
    .split(/\r?\n/)
    .map((line) => line.replace(/^\s*(?:[#>*\-\u2022]+\s*)+/, '').replace(/\*\*/g, '').trim())
    .filter(Boolean)
    .flatMap((line) => line.split(/(?<=[.!?])\s+/))
    .map((s) => s.trim())
    .filter((s) => s && !TOOLING.test(s) && !/https?:\/\/github\.com/i.test(s))
    .join(' ')
    .trim();
}

function fallback(commits) {
  const lines = commits.slice(0, 6).map((c) => '\u2022 ' + c.subject.replace(/[.\s]+$/, ''));
  return { headline: 'What changed', body: lines.join('\n') };
}

async function writeNotes(commits) {
  const notes = commits
    .map((c) => '- ' + c.subject + (c.body ? ' — ' + c.body : ''))
    .join('\n')
    .slice(0, 3000);

  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 25000);
  try {
    const res = await fetch('https://models.github.ai/inference/chat/completions', {
      method: 'POST',
      headers: { authorization: 'Bearer ' + TOKEN, 'content-type': 'application/json' },
      body: JSON.stringify({
        model: MODEL,
        temperature: 0.6,
        max_tokens: 300,
        messages: [
          { role: 'system', content: SYSTEM },
          { role: 'user', content: 'What changed (internal notes, do not quote):\n' + notes }
        ]
      }),
      signal: ctl.signal
    });
    if (!res.ok) {
      console.error('model:', res.status, (await res.text().catch(() => '')).slice(0, 200));
      return fallback(commits);
    }
    const data = await res.json();
    const raw = String((((data.choices || [])[0] || {}).message || {}).content || '').trim();
    if (!raw) return fallback(commits);

    const lines = raw.split(/\r?\n/).map((l) => l.replace(/^\s*(?:[#>*\-\u2022]+\s*)+/, '').replace(/\*\*/g, '').replace(/^["'“]|["'”]$/g, '').trim()).filter(Boolean);
    const body = scrub(lines.slice(1).join(' ')) || scrub(lines.join(' '));
    if (!body) {
      console.error('model wrote only tooling-speak; falling back to the subjects');
      return fallback(commits);
    }
    const headline = scrub(lines[0]) || 'What changed';
    return {
      headline: (lines.length > 1 ? headline : 'What changed').slice(0, HEADLINE_MAX),
      body: body.slice(0, BODY_MAX)
    };
  } catch (e) {
    console.error('model failed:', e.message);
    return fallback(commits);
  } finally {
    clearTimeout(timer);
  }
}

const commits = readCommits();
if (!commits.length) {
  console.log('No commits in this push — nothing to say.');
  process.exit(0);
}

const { headline, body } = await writeNotes(commits);
const embed = {
  title: headline,
  description: body,
  color: 0x6c5ce7,
  timestamp: new Date().toISOString()
};
const payload = { username: 'Cudic', allowed_mentions: { parse: [] }, embeds: [embed] };

console.log(headline + '\n' + body);

if (DRY) {
  console.log('\n--dry: would post\n' + JSON.stringify(payload, null, 2));
  process.exit(0);
}
if (!discord.hookUrl('updates')) {
  console.log('DISCORD_WEBHOOK_UPDATES not set — nothing posted.');
  process.exit(0);
}

const posted = await discord.post('updates', payload, 8000);
if (!posted) process.exit(0); // Discord being down is not a failed build.
console.log('Posted to #updates.');
