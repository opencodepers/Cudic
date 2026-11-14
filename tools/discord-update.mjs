#!/usr/bin/env node
/* file: tools/discord-update.mjs
 * what: posts the hand-written `Updates:` line from each commit in a push into
 *       the Discord #updates channel, as one short message.
 * why: a channel that reads like a person needs a person's words. The line is
 *       written when the change is committed, so there is no model, no API key
 *       and nothing to rewrite — and the message cannot drift into build-log
 *       speak, because nobody wrote that in the first place.
 * invariants: the message never mentions tooling (git, commits, branches, GitHub,
 *       deploys, webhooks, bots, AI) — offending sentences are dropped; a push
 *       with no line says nothing unless --fallback is passed;
 *       a push with no commits posts nothing; a missing or failing webhook never
 *       fails the run; mentions stay disabled and the URL is validated by
 *       lib/discord.js.
 * see: .github/workflows/discord-updates.yml, lib/discord.js
 */

import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const discord = require('../lib/discord');

const argv = process.argv.slice(2);
const DRY = argv.includes('--dry');
const FALLBACK = argv.includes('--fallback');
const RANGE = (() => {
  const i = argv.indexOf('--range');
  return i >= 0 ? String(argv[i + 1] || '') : '';
})();

const BEFORE = String(process.env.BEFORE || '').trim();
const AFTER = String(process.env.AFTER || '').trim();

// The convention: a commit body line starting "Updates:" is the message itself.
const NOTE = /^updates?:\s*(.+)$/i;
const TRAILER = /^(co-authored-by|signed-off-by|reviewed-by|generated with|generated-by|🤖|ai:|assistant:)/iu;
const TOOLING = /\b(codebuff|github|git|commit|commits|webhook|webhooks|pull request|merge|repository|repo|branch|rebase|ci|ai|llm|assistant|automation|automated|bot|generated)\b/i;

const MAX_NOTES = 4;
const MAX_SUBJECTS = 3;
const MAX_CHARS = 1500;

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

/** Same sentence, minus anything that would read as machine output. */
function scrub(text) {
  return String(text || '')
    .replace(/https?:\/\/\S*github\.com\S*/gi, '')
    .replace(/\s+/g, ' ')
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s && !TOOLING.test(s))
    .join(' ')
    .trim();
}

function readCommits() {
  const fmt = ['log', '--no-merges', '--format=%x1e%s%x1f%b'];
  const range = rangeArg();
  let out = range ? git(fmt.concat(range)) : '';
  // A force push or a fresh branch leaves no usable range; a few recent commits
  // still say something truthful about what just landed.
  if (!out) out = git(fmt.concat(['-n', '6']));

  const notes = [];
  const subjects = [];
  for (const chunk of out.split('\x1e')) {
    const [subjectRaw = '', bodyRaw = ''] = chunk.split('\x1f');
    const subject = subjectRaw.trim();
    if (!subject || /^(merge|revert)\b/i.test(subject)) continue;

    for (const line of bodyRaw.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || TRAILER.test(trimmed)) continue;
      const hit = trimmed.match(NOTE);
      if (hit) notes.push(hit[1].replace(/^["'“`]+|["'”`]+$/g, '').trim());
    }

    const clean = subject
      .replace(/^(feat|fix|chore|docs|test|tests|refactor|style|perf|build|ci)(\([^)]*\))?!?:\s*/i, '')
      .replace(/\s+/g, ' ')
      .replace(/[.\s]+$/, '')
      .trim();
    if (clean) subjects.push(clean);
  }
  return { notes, subjects };
}

function compose({ notes, subjects }) {
  const said = [...new Set(notes.map(scrub).filter(Boolean))].slice(0, MAX_NOTES);
  if (said.length) return said.join(' ');
  // Nothing was written for this push, so there is nothing worth saying. A chore
  // commit should not announce itself in a channel people read for features.
  if (!FALLBACK) return '';
  // --fallback: reword the subjects as sentences rather than a bullet list, so the
  // channel still reads like a line of text.
  const sentences = [...new Set(subjects.map(scrub).filter(Boolean))]
    .slice(0, MAX_SUBJECTS)
    .map((s) => s.charAt(0).toUpperCase() + s.slice(1));
  return sentences.length ? sentences.join('. ') + '.' : '';
}

const text = compose(readCommits()).slice(0, MAX_CHARS);
if (!text) {
  console.log('Nothing in this push to talk about.');
  process.exit(0);
}

// #updates is a forum channel, so a post has to be named; Discord ignores the
// field on an ordinary text channel. The first sentence doubles as the name.
function threadName(value) {
  const first = (value.split(/(?<=[.!?])\s+/)[0] || value).replace(/[.!?\s]+$/, '').trim();
  if (first.length <= 90) return first || 'Update';
  return first.slice(0, 87).replace(/[\s,;:]+$/, '') + '...';
}

const payload = {
  username: 'Cudic',
  allowed_mentions: { parse: [] },
  content: text,
  thread_name: threadName(text)
};

console.log(text);

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
