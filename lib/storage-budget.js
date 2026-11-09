/* file: lib/storage-budget.js
 * what: Per-account storage accounting: sums bytes across each distinct storage prefix a game owns or shares, 60s cache, hard cap.
 * invariants: prefixes are unioned (own id + asset_owner) so forks count shared bytes once; the cap is refused, never truncated.
 * see: AGENTS.md 5, server.js (the route chain that calls it) */

module.exports = function createStorageBudget(supabase) {
// ── Per-account storage budget ─────────────────────────────────
// Uploads go straight from the browser to Supabase storage, so save time is the
// one place that can see the whole account. Usage is counted per distinct
// storage prefix, which is what makes fork sharing pay off: 500 forks of one
// game count once, because they all point at the same prefix. A save that would
// land over the cap is refused, and the message names both numbers instead of
// "upload failed".
const ACCOUNT_STORAGE_CAP = Number(process.env.STORAGE_CAP_BYTES) || 250 * 1024 * 1024;
const storageUsageCache = new Map();

async function accountStorageBytes(userId) {
  const hit = storageUsageCache.get(userId);
  if (hit && Date.now() - hit.at < 60_000) return hit.bytes;
  const { data: rows } = await supabase.from('games').select('id, asset_owner').eq('owner_id', userId);
  const prefixes = new Set();
  // Union, not either/or: a fork that uploaded its own files has bytes in its
  // own prefix *and* in the prefix it shares, so the ledger must count both.
  for (const r of rows || []) {
    prefixes.add(r.id);
    if (r.asset_owner) prefixes.add(r.asset_owner);
  }
  let bytes = 0;
  const bucket = supabase.storage.from('game-assets');
  for (const prefix of prefixes) {
    const pending = [prefix];
    while (pending.length) {
      const dir = pending.pop();
      const { data: entries } = await bucket.list(dir, { limit: 1000 });
      for (const e of entries || []) {
        if (e.metadata) bytes += Number(e.metadata.size || 0);
        else pending.push(dir + '/' + e.name);
      }
    }
  }
  storageUsageCache.set(userId, { bytes, at: Date.now() });
  return bytes;
}

  return { ACCOUNT_STORAGE_CAP, accountStorageBytes };
};
