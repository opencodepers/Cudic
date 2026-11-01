/* CudicScores — one-call leaderboards for published games.
 *   <script src="/cudic-scores.js?v=1"></script>
 *   CudicScores.submit(score);  // keeps the player's best, server-side
 *   CudicScores.top(10).then(function (rows) { ... });  // [{ name, score, at }]
 *
 * Security shape (same as CudicSave): the game frame is sandboxed and never
 * sees the login token. Submits go game -> parent page -> API via postMessage;
 * the parent (view.html) mediates with its own session, so a signed-out player
 * is told to sign in instead of being able to forge scores. top() is public —
 * the parent fetches it without any token at all.
 * Standalone (previews, file://): submit() reports guest, top() falls back to
 * a direct public GET when the API host is known from the parent page.
 */
(function () {
  if (window.CudicScores) return;
  var reqSeq = 0, pending = {};
  function inPlayer() { try { return window.parent && window.parent !== window; } catch (e) { return false; } }
  window.addEventListener('message', function (e) {
    var d = e.data || {};
    if (!d || (d.type !== 'cudic-scores-ack' && d.type !== 'cudic-scores-list')) return;
    try { if (e.source !== window.parent) return; } catch (err) { return; }
    var cb = pending[d.req];
    if (cb) { delete pending[d.req]; cb(d); }
  });
  function askParent(msg, timeoutMs) {
    return new Promise(function (resolve) {
      if (!inPlayer()) { resolve(null); return; }
      var id = 'r' + (++reqSeq) + Date.now().toString(36);
      msg.req = id;
      pending[id] = resolve;
      try { window.parent.postMessage(msg, '*'); } catch (e) { delete pending[id]; resolve(null); return; }
      setTimeout(function () { if (pending[id]) { delete pending[id]; resolve(null); } }, timeoutMs || 2500);
    });
  }
  // Submit the run's score. Resolves { ok, best, guest?, error? }: `guest`
  // means signed-out — show "sign in to save your score", not a failure.
  async function submit(score) {
    var n = Math.floor(Number(score));
    if (!Number.isFinite(n) || n < 0 || n > 2147483647) return { ok: false, error: 'bad-score' };
    var ans = await askParent({ type: 'cudic-score-submit', score: n });
    if (!ans) return { ok: false, guest: true, error: 'no-parent' };
    if (ans.ok === false && ans.error === 'signed-out') return { ok: false, guest: true, error: 'signed-out' };
    if (ans.ok === false && (ans.error === 'unverified' || ans.error === 'seat')) return { ok: false, error: ans.error === 'unverified' ? 'unverified' : 'seat', guest: true };
    return { ok: !!ans.ok, best: typeof ans.best === 'number' ? ans.best : n, kept: !!ans.kept, guest: false, error: ans.error || null };
  }
  // Top N (default 10, max 50). Public data — works signed out.
  async function top(limit) {
    var lim = Math.min(Math.max(Math.floor(Number(limit)) || 10, 1), 50);
    var ans = await askParent({ type: 'cudic-scores-top', limit: lim });
    if (ans && ans.scores) return ans.scores;
    // No mediating parent: try the public endpoint directly. In previews the
    // API lives where this page was served from; on file:// this just fails
    // quietly and the game shows its own local board.
    try {
      var r = await fetch('/api/games/' + encodeURIComponent(pageId()) + '/scores?limit=' + lim);
      if (r.ok) { var j = await r.json(); return j.scores || []; }
    } catch (e) {}
    return [];
  }
  // The game page owns the id (?id=...); the sandboxed frame reuses it.
  function pageId() {
    try {
      var p = new URLSearchParams(window.location.search).get('id');
      if (p) return p;
      return new URLSearchParams(window.parent.location.search).get('id') || '';
    } catch (e) { return ''; }
  }
  window.CudicScores = { submit: submit, top: top, version: 1 };
})();
