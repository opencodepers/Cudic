/* file: lib/slug.js
 * what: decides which path segment a listed game links to — its slug, or its id
 *       when more than one game claims that slug.
 * why: slugs are built from titles with no uniqueness check, so nine games called
 *      "Untitled Project" all saved slug "untitled-project". /g/<slug> can only
 *      resolve to one of them, and every other card pointed at the same game (or,
 *      before the resolver tolerated duplicates, at a 404 with no cover art).
 * invariants: never returns an empty string for a row that has an id; a shared
 *      slug is never used as a link target; no user input is interpolated raw.
 * see: lib/arcade.js, lib/daily.js, tools/prerender-games.mjs, server.js (/g route)
 */

function cleanSlug(g) {
  return String((g && g.slug) || '').trim();
}

/** Slugs claimed by more than one row — unusable as a link to a single game. */
function duplicateSlugs(rows) {
  const seen = new Set();
  const dup = new Set();
  for (const g of rows || []) {
    const s = cleanSlug(g);
    if (!s) continue;
    if (seen.has(s)) dup.add(s); else seen.add(s);
  }
  return dup;
}

/** The path segment for one row: the slug when it is unique, the id otherwise. */
function slugFor(g, dup) {
  const s = cleanSlug(g);
  return (!s || (dup && dup.has(s))) ? String((g && g.id) || '') : s;
}

module.exports = { duplicateSlugs, slugFor };
