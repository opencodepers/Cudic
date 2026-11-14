/* file: lib/related.js
 * what: ranks the "More like this" picks for one game — shared tags, similar
 *       wording, and remix/ancestry kinship, with most-played as the floor.
 * why: the shelf existed but only as an exact tag-overlap query, so a game with
 *       no tags (or the only game with that tag) had an empty shelf, and there
 *       was one rule in the API and a different one on the static game pages.
 * invariants: the target never recommends itself, unpublished rows never rank,
 *       another creator's games stay out unless excludeCreator:false, order is
 *       stable (score, then plays, then id) so two hosts show the same shelf,
 *       `limit` is honoured, and `fill` only ever tops up with real rows.
 * see: server.js (/api/games/:id/related), tools/prerender-games.mjs, public/view.html
 */

// Words that say nothing about what a game is. Kept small on purpose: the
// wording signal is a tie-breaker, not a search index.
const STOP = new Set((
  'the and for with your you our their its this that from into onto over under ' +
  'game games play playing player players made make makes using use used free ' +
  'browser online new now can will just get got all any out off not but was ' +
  'are were has have had how what when where which who why too very more most ' +
  'about than then them they there here one two three first last time'
).split(/\s+/));

const words = (s) => String(s || '')
  .toLowerCase()
  .split(/[^a-z0-9]+/)
  .filter((w) => w.length > 2 && !STOP.has(w));

const tagList = (g) => (Array.isArray(g && g.tags) ? g.tags : [])
  .map((t) => String(t).toLowerCase().trim())
  .filter(Boolean);

const plays = (g) => Number(g && g.play_count) || 0;

function score(target, cand) {
  const reasons = [];
  let n = 0;

  // A shared tag is a stated intention ("puzzle", "platformer"), so it outranks
  // anything inferred from prose.
  const mine = new Set(tagList(target));
  const shared = tagList(cand).filter((t) => mine.has(t));
  if (shared.length) {
    n += 6 * shared.length;
    reasons.push('tags:' + shared.join(','));
  }

  // Mechanics live in the description far more often than in the tags: "jump",
  // "click", "wave", "build". Capped so a long description cannot drown the
  // tag signal.
  const tw = new Set(words([target.title, target.description, tagList(target).join(' ')].join(' ')));
  if (tw.size) {
    const cw = new Set(words([cand.title, cand.description, tagList(cand).join(' ')].join(' ')));
    let overlap = 0;
    for (const w of cw) if (tw.has(w)) overlap++;
    if (overlap) {
      n += Math.min(overlap, 5);
      reasons.push('words:' + overlap);
    }
  }

  // Kinship: a game built from this one, or the game this one was built from.
  const tId = String(target.id || '');
  if (cand.forked_from && String(cand.forked_from) === tId) {
    n += 8;
    reasons.push('remix');
  } else if (target.forked_from && String(cand.id) === String(target.forked_from)) {
    n += 10;
    reasons.push('parent');
  }

  return { n, reasons };
}

/**
 * @param {{id:string, owner_id?:string, title?:string, description?:string,
 *          tags?:string[], forked_from?:string|null}} target
 * @param {Array} pool published-ish rows (id, title, description, tags, play_count,
 *              owner_id, forked_from, published)
 * @param {{limit?:number, excludeCreator?:boolean, fill?:boolean}} [opts]
 * @returns {{game:object, score:number, reasons:string[]}[]}
 */
function rankRelated(target, pool, opts) {
  opts = opts || {};
  const limit = Math.max(0, Number(opts.limit) || 6);
  const excludeCreator = opts.excludeCreator !== false;
  const fill = opts.fill !== false;

  const self = String((target && target.id) || '');
  const seen = new Set(self ? [self] : []);
  const scored = [];
  const rest = [];

  for (const cand of Array.isArray(pool) ? pool : []) {
    if (!cand || !cand.id) continue;
    const id = String(cand.id);
    if (seen.has(id)) continue;
    seen.add(id);
    if (cand.published === false) continue;
    if (excludeCreator && target.owner_id && cand.owner_id
      && String(cand.owner_id) === String(target.owner_id)) continue;

    const { n, reasons } = score(target, cand);
    if (n > 0) scored.push({ game: cand, score: n, reasons });
    else rest.push(cand);
  }

  scored.sort((a, b) => b.score - a.score
    || plays(b.game) - plays(a.game)
    || String(a.game.id).localeCompare(String(b.game.id)));

  if (!fill || scored.length >= limit) return scored.slice(0, limit);

  // Nothing (or not enough) in common: fall back to the most played, so the
  // shelf is never a blank strip on a game with no tags.
  rest.sort((a, b) => plays(b) - plays(a) || String(a.id).localeCompare(String(b.id)));
  for (const game of rest) {
    if (scored.length >= limit) break;
    scored.push({ game, score: 0, reasons: [] });
  }
  return scored.slice(0, limit);
}

module.exports = { rankRelated, scoreRelated: score };
