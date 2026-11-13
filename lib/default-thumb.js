/* file: lib/default-thumb.js
 * what: the shared fallback thumbnail, for games that never uploaded one.
 * why: an empty art box reads as a broken game. Every surface (gallery, arcade,
 *      daily picks, Studio project picker, share previews) points at
 *      /g/<slug>/thumb, so serving a real card there fixes all of them at once.
 * invariants: bytes are read once and kept in memory; the asset is
 *      public/default-thumb.svg; nothing here touches Supabase.
 * see: public/default-thumb.svg, server.js (/api/games/:id/thumbnail, /g/:id/thumb)
 */

const fs = require('fs');
const path = require('path');

const TYPE = 'image/svg+xml';

let cached = null;

module.exports = function defaultThumb() {
  if (cached) return cached;
  try {
    cached = fs.readFileSync(path.join(__dirname, '..', 'public', 'default-thumb.svg'));
  } catch {
    // A missing asset must not turn every thumbnail into a 500.
    cached = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="675"><rect width="1200" height="675" fill="#14161b"/></svg>');
  }
  return cached;
};

module.exports.TYPE = TYPE;
