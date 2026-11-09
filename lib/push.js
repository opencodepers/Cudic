/* file: lib/push.js
 * what: Web-push fan-out: VAPID keys stored in push_config, one notification per registered browser, dead endpoints pruned.
 * invariants: a missing web-push dependency or failed key read returns 0 sent, never throws; the inbox row is already written by the caller.
 * see: AGENTS.md 5, server.js (the route chain that calls it) */

module.exports = function createPush(supabase) {
// ── Web push ─────────────────────────────────────────────────────
// The VAPID pair is generated once and stored in `push_config`, so pushes
// work on Render with no env setup and keep working across restarts — a
// fresh keypair would invalidate every existing subscription.
let webpushLib;
let vapidCache = null;
function webpush() {
  if (webpushLib === undefined) {
    try { webpushLib = require('web-push'); } catch (e) { webpushLib = null; }
  }
  return webpushLib;
}
async function vapidKeys() {
  if (vapidCache) return vapidCache;
  const lib = webpush();
  if (!lib) return null;
  try {
    const { data } = await supabase.from('push_config').select('public_key, private_key').eq('id', 1).maybeSingle();
    if (data && data.public_key && data.private_key) return (vapidCache = data);
    const keys = lib.generateVAPIDKeys();
    const { error } = await supabase.from('push_config').insert({ id: 1, public_key: keys.publicKey, private_key: keys.privateKey });
    if (error) return null;
    return (vapidCache = { public_key: keys.publicKey, private_key: keys.privateKey });
  } catch (e) { return null; }
}
// Fan a notification out to every browser this user registered. Dead
// endpoints (404/410 from the push service) are pruned on the spot.
async function sendPush(userId, title, body) {
  const lib = webpush();
  const keys = await vapidKeys();
  if (!lib || !keys) return 0;
  let sent = 0;
  try {
    lib.setVapidDetails('mailto:team@cudic.vercel.app', keys.public_key, keys.private_key);
    const { data: subs } = await supabase.from('push_subscriptions').select('id, endpoint, p256dh, auth').eq('user_id', userId);
    for (const s of subs || []) {
      try {
        await lib.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, JSON.stringify({
          title: String(title || 'Cudic').slice(0, 120), body: String(body || '').slice(0, 240), url: '/notifications'
        }));
        sent++;
      } catch (e) {
        const code = e && (e.statusCode || e.status);
        if (code === 404 || code === 410) await supabase.from('push_subscriptions').delete().eq('id', s.id);
      }
    }
  } catch (e) { /* push is best-effort; the inbox row already exists */ }
  return sent;
}

  return { webpush, vapidKeys, sendPush };
};
