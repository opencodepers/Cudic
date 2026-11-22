/* file: lib/referrals.js
 * what: invite codes and what they earn — 10 MB of storage plus 100 coins per verified account that arrives through a link, capped at 10 invites.
 * invariants: a code only resolves through referral_codes (never by hashing an id at claim time); the storage bonus is counted from referrals rows, never stored as a balance, and coins are keyed by (inviter, invitee) in the ledger so a retry cannot pay twice.
 * see: AGENTS.md 5 (referrals), supabase/migrations/20261122120000_referrals.sql */

module.exports = function createReferrals(supabase, notify) {
// ── Invite links ────────────────────────────────────────────────
// The reward is storage, because that is the thing a creator actually runs out
// of — but storage is also the only real per-byte cost, so it is paid for
// verified accounts only, capped, and counted from the rows instead of kept in
// a balance someone can drift from the truth.
const BONUS_BYTES = 10 * 1024 * 1024;      // 10 MB per credited invite
const MAX_INVITES = 10;                    // …and never more than 100 MB
const MAX_BONUS_BYTES = BONUS_BYTES * MAX_INVITES;
const COINS_PER_INVITE = 100;              // the same payout as "publish your first game"
const MAX_COINS = COINS_PER_INVITE * MAX_INVITES;
const NEW_ACCOUNT_MS = 7 * 864e5;          // only a genuinely new account can claim
const CODE_LEN = 8;
// Crockford-ish: no i, l, o or u, so a code survives being read aloud or typed
// from a screenshot. 32 symbols × 8 chars is ~40 bits — plenty for an invite.
const ALPHABET = '0123456789abcdefghjkmnpqrstvwxyz';
const CODE_RE = new RegExp('^[' + ALPHABET + ']{' + CODE_LEN + '}$');
const bonusCache = new Map();

// Deterministic, so ensureCode can upsert without a read-first race.
function codeForUserId(id) {
  const h = require('crypto').createHash('sha256').update('cudic-ref|' + String(id || '')).digest();
  let out = '';
  for (let i = 0; i < CODE_LEN; i++) out += ALPHABET[h[i] % ALPHABET.length];
  return out;
}

function isValidCode(code) {
  return typeof code === 'string' && CODE_RE.test(code);
}

// ── Signals: who is behind an account? ─────────────────────────
// The first line of defence cannot be the account id — that is exactly what a
// second email changes. So compare people: the mailbox with aliases collapsed,
// the device that opened the link, and the connection it came from. Both of the
// last two are hashed before they are stored, and nothing here is user-facing.
function emailNorm(email) {
  const raw = String(email || '').toLowerCase().trim();
  const at = raw.lastIndexOf('@');
  if (at < 1) return '';
  let local = raw.slice(0, at).split('+')[0];
  const domain = raw.slice(at + 1);
  // Gmail ignores dots as well as +tags, so m.e@gmail.com is me@gmail.com.
  if (domain === 'gmail.com' || domain === 'googlemail.com') local = local.replace(/\./g, '');
  return local + '@' + domain;
}

function signalHash(value) {
  const v = String(value || '').trim();
  if (!v || v === 'unknown') return null;
  return require('crypto').createHash('sha256').update('cudic-sig|' + v).digest('hex');
}

function bonusBytesFor(invites) {
  const n = Math.max(0, Math.min(MAX_INVITES, Math.floor(Number(invites) || 0)));
  return n * BONUS_BYTES;
}

function coinsFor(invites) {
  const n = Math.max(0, Math.min(MAX_INVITES, Math.floor(Number(invites) || 0)));
  return n * COINS_PER_INVITE;
}

function linkFor(origin, code) {
  return String(origin || '').replace(/\/+$/, '') + '/login?ref=' + code;
}

// A code has to exist in referral_codes to resolve, so one is created the first
// time an account asks for its link — never lazily at claim time.
async function ensureCode(userId) {
  const mine = await supabase.from('referral_codes').select('code').eq('user_id', userId).maybeSingle();
  if (mine && mine.data && mine.data.code) return mine.data.code;
  const code = codeForUserId(userId);
  const { error } = await supabase.from('referral_codes').upsert({ user_id: userId, code }, { onConflict: 'user_id' });
  if (!error) return code;
  // Only a unique-code collision lands here; fall back to a random code once.
  const random = Array.from({ length: CODE_LEN }, () => ALPHABET[Math.floor(Math.random() * ALPHABET.length)]).join('');
  const retry = await supabase.from('referral_codes').upsert({ user_id: userId, code: random }, { onConflict: 'user_id' });
  if (retry.error) throw retry.error;
  return random;
}

async function countInvites(userId) {
  const { count } = await supabase.from('referrals').select('id', { count: 'exact', head: true }).eq('inviter_id', userId);
  return Number(count) || 0;
}

// Recorded when the owner fetches their link, so a later claim has something to
// compare. Best effort: a failed fingerprint must never break the invite card.
async function rememberSignals(userId, s) {
  if (!s) return;
  const patch = {};
  const email = emailNorm(s.email);
  if (email) patch.email_norm = email;
  const ip = signalHash(s.ip);
  if (ip) patch.ip_hash = ip;
  const device = signalHash(s.device);
  if (device) patch.device_hash = device;
  if (!Object.keys(patch).length) return;
  try { await supabase.from('referral_codes').update(patch).eq('user_id', userId); } catch {}
}

async function stats(userId, signals) {
  const code = await ensureCode(userId);
  await rememberSignals(userId, signals);
  const invites = await countInvites(userId);
  return {
    code,
    invites,
    bonus_bytes: bonusBytesFor(invites),
    bonus_per_invite: BONUS_BYTES,
    max_invites: MAX_INVITES,
    max_bonus_bytes: MAX_BONUS_BYTES,
    coins: coinsFor(invites),
    coins_per_invite: COINS_PER_INVITE,
    max_coins: MAX_COINS
  };
}

// Cached because the save path asks on every asset write, and the answer only
// changes when a claim lands (which calls forget()).
async function bonusBytes(userId) {
  const hit = bonusCache.get(userId);
  if (hit && Date.now() - hit.at < 60_000) return hit.bytes;
  const bytes = bonusBytesFor(await countInvites(userId));
  bonusCache.set(userId, { bytes, at: Date.now() });
  return bytes;
}

function forget(userId) {
  bonusCache.delete(userId);
}

// The ledger row is the receipt, keyed by the invitee, so a claim retried after
// a dropped response finds it and does not pay the same invite twice.
async function grantInviteCoins(inviter, inviteeId) {
  const led = await supabase.from('coin_ledger').select('id')
    .eq('user_id', inviter).eq('reason', 'referral').eq('ref_id', String(inviteeId)).limit(1);
  if (led && led.data && led.data.length) return COINS_PER_INVITE;
  const { error } = await supabase.rpc('grant_coins', {
    p_user: inviter, p_delta: COINS_PER_INVITE, p_reason: 'referral', p_ref: String(inviteeId)
  });
  if (error) throw error;
  return COINS_PER_INVITE;
}

// Returns { ok, bonus_bytes, coins } or { error, status, text }. The caller has already
// authenticated; everything that decides whether the claim counts happens here.
async function claim(userId, code, opts) {
  const o = opts || {};
  if (!o.verified) {
    return { error: 'email_unconfirmed', status: 403, text: 'Confirm your email first, then this invite will count.' };
  }
  if (!isValidCode(code)) return { error: 'bad_code', status: 400, text: 'That invite link is not valid.' };
  const created = o.createdAt ? new Date(o.createdAt).getTime() : Date.now();
  if (Date.now() - created > NEW_ACCOUNT_MS) {
    return { error: 'account_too_old', status: 400, text: 'Invite links are for new accounts.' };
  }
  // `*` so a database without the signals migration still resolves codes.
  const found = await supabase.from('referral_codes').select('*').eq('code', code).maybeSingle();
  if (found.error) throw found.error;
  if (!found.data) return { error: 'unknown_code', status: 404, text: 'That invite link has expired.' };
  const inviter = found.data.user_id;
  if (inviter === userId) return { error: 'self_referral', status: 400, text: 'You cannot use your own invite link.' };

  // Same person, second email: the ids differ, the fingerprint does not.
  const mine = found.data;
  const email = emailNorm(o.email);
  if (email && mine.email_norm && email === mine.email_norm) {
    return { error: 'same_email', status: 409, text: 'This link belongs to your own account — it only counts for someone else.' };
  }
  const device = signalHash(o.device);
  if (device && mine.device_hash && device === mine.device_hash) {
    return { error: 'same_device', status: 409, text: 'You opened this link on the same browser that created it, so it does not count.' };
  }
  const ip = signalHash(o.ip);
  if (ip && mine.ip_hash && ip === mine.ip_hash) {
    return { error: 'same_network', status: 409, text: 'Invite links do not count when both accounts join from the same connection.' };
  }

  let ins = await supabase.from('referrals').insert({
    inviter_id: inviter, invitee_id: userId, code,
    invitee_email_norm: email || null,
    invitee_ip_hash: ip || null,
    invitee_device_hash: device || null
  });
  // Part 1 of the migration can be applied without part 2; the claim still
  // counts, it just has no fingerprint to review later.
  if (ins.error && /column|schema cache/i.test(String(ins.error.message || ''))) {
    ins = await supabase.from('referrals').insert({ inviter_id: inviter, invitee_id: userId, code });
  }
  if (ins.error) {
    // 23505 = this account already claimed a link. Same answer as success, so a
    // retry after a dropped response is harmless — but only the inviter on the
    // existing row earns anything, not whoever's code was retried last.
    if (String(ins.error.code) === '23505') {
      const { data: existing } = await supabase.from('referrals').select('inviter_id').eq('invitee_id', userId).maybeSingle();
      const owner = existing && existing.inviter_id;
      const ours = owner === inviter;
      let coins = 0;
      if (ours) {
        try { coins = await grantInviteCoins(inviter, userId); }
        catch (e) { console.error('referral coins (retry):', e && e.message ? e.message : e); }
      }
      return { ok: true, already: true, bonus_bytes: await bonusBytes(owner || inviter), coins };
    }
    throw ins.error;
  }
  forget(inviter);
  const bonus = await bonusBytes(inviter);
  let coins = COINS_PER_INVITE;
  try { await grantInviteCoins(inviter, userId); }
  catch (e) { coins = 0; console.error('referral coins:', e && e.message ? e.message : e); }
  try {
    if (typeof notify === 'function') {
      const mb = Math.round(bonus / (1024 * 1024));
      await notify(inviter, 'referral', 'Someone joined from your link',
        'You now have ' + mb + ' MB of extra storage' + (coins ? ' and ' + coins + ' coins.' : '.'), 'profile', null);
    }
  } catch { /* a notification is never worth failing the claim */ }
  return { ok: true, bonus_bytes: bonus, coins };
}

return {
  BONUS_BYTES,
  MAX_INVITES,
  MAX_BONUS_BYTES,
  COINS_PER_INVITE,
  MAX_COINS,
  codeForUserId,
  isValidCode,
  emailNorm,
  signalHash,
  bonusBytesFor,
  coinsFor,
  linkFor,
  ensureCode,
  stats,
  bonusBytes,
  forget,
  claim
};
};
