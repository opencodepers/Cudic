/* CudicAch — in-game achievements for published games.
 *   <script src="/cudic-ach.js?v=1"></script>
 *   CudicAch.unlock('speedrun');   // { ok, first, guest?, error? }
 *
 * Security shape (same as CudicScores/CudicSave): the game frame is sandboxed
 * and never sees the login token. Unlocks go game -> parent page -> API via
 * postMessage; the parent (view.html) mediates with its own session, so a
 * signed-out player is told to sign in instead of being able to forge
 * achievements. Codes are short slugs (lowercase letters, numbers, dash,
 * underscore, max 32 chars) — the server re-checks and rate-limits.
 * Standalone (previews, file://): unlock() reports guest — nothing to forge,
 * nothing to persist.
 */
(function () {
  if (window.CudicAch) return;
  var reqSeq = 0, pending = {};
  function inPlayer() { try { return window.parent && window.parent !== window; } catch (e) { return false; } }
  window.addEventListener('message', function (e) {
    var d = e.data || {};
    if (!d || d.type !== 'cudic-ach-ack') return;
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
  // Unlock a named achievement. Resolves { ok, first, guest?, error? }:
  // `first` is true only the first time this player earns it in this game;
  // `guest` means signed-out — show "sign in to earn achievements", not a
  // failure. Repeats resolve ok with first:false, never an error.
  async function unlock(code) {
    var c = String(code || '').trim();
    if (!/^[a-z0-9][a-z0-9_-]{0,31}$/.test(c)) return { ok: false, error: 'bad-code' };
    var ans = await askParent({ type: 'cudic-ach-unlock', code: c });
    if (!ans) return { ok: false, guest: true, error: 'no-parent' };
    if (ans.ok === false && (ans.error === 'signed-out' || ans.error === 'unverified' || ans.error === 'seat')) {
      return { ok: false, guest: true, error: ans.error };
    }
    return { ok: !!ans.ok, first: !!ans.first, at: ans.at || null, guest: false, error: ans.error || null };
  }
  window.CudicAch = { unlock: unlock, version: 1 };
})();
