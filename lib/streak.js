/* file: lib/streak.js
 * what: The daily login streak — UTC day roll, chain length, and the once-per-day
 *   coin bonus, driven by the session claim/heartbeat beats that already exist.
 * invariants: the optimistic `.eq('last_active_day', old)` update means two tabs
 *   racing pay at most once; the grant_coins reason is `streak:<date>`, so a
 *   redeploy can never double-pay a banked day.
 * see: AGENTS.md 5, migration/streak.sql, server.js session handlers */

module.exports = function createStreak(supabase) {
// ── Daily login streak ───────────────────────────────────────────
// Rides the session endpoints that already fire on every tab. The day is
// UTC; the streak continues when the last active day was yesterday, resets
// to 1 after any gap, and no-ops when today was already counted. The
// optimistic `.eq('last_active_day', …)` filter makes two tabs racing make
// at most one payout: the loser's update matches zero rows. Bonus coins
// are ledger-idempotent (`streak:<date>` reason), same shape as jam
// payouts — a redeploy cannot double-pay an already-banked day.
async function rollStreak(userId) {
  const today = new Date().toISOString().slice(0, 10);
  const { data: row } = await supabase.from('users')
    .select('last_active_day, streak_days').eq('id', userId).single();
  if (row && row.last_active_day === today) return;
  const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  const chain = row && row.last_active_day === yesterday ? (row.streak_days || 0) + 1 : 1;
  let up = supabase.from('users')
    .update({ last_active_day: today, streak_days: chain })
    .eq('id', userId);
  if (row) up = up.eq('last_active_day', row.last_active_day || '');
  else up = up.is('last_active_day', null);
  const { data: won, error } = await up;
  if (error || !won || !won.length) return; // raced × already-banked this day
  const days = typeof chain === 'number' ? Math.max(1, chain) : 1;
  const bonus = Math.min(5 + days, 25); // day 1 → 6 coins; caps at 25
  await supabase.rpc('grant_coins', { p_user: userId, p_delta: bonus, p_reason: 'streak:' + today, p_ref: null });
}

  return { rollStreak };
};
