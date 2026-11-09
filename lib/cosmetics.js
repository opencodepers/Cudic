/* file: lib/cosmetics.js
 * what: The award and cosmetic catalogs — badges/flairs/titles, the coin shop,
 *   slot rules, code resolution and the union of earned + bought codes.
 * invariants: titles are the union of user_badges and user_cosmetics, so the
 *   two equips paths merge and never overwrite; a missing user_cosmetics table
 *   reads as "no purchases" instead of locking earned awards out.
 * see: AGENTS.md 5, server.js (/api/cosmetics, /api/equips call sites) */

module.exports = function createCosmetics(supabase) {
// ── Awards: badges, flairs, titles ───────────────────────────────
// Static catalog, no table — codes are a stable API. Flairs are free:
// they come from ordinary actions. Badges are earned long-time or hard.
// Titles are the rare ones, shown nearest the name. `icon` is a path
// under /cudic-assets/icons/svg/ (asset pack manifest is the canon).
const AWARDS = {
  spark:        { kind: 'flair', label: 'Spark', icon: 'studio/sparkle', how: 'Join Cudic' },
  check:        { kind: 'flair', label: 'Check', icon: 'navigation/check', how: 'Confirm your email' },
  heart:        { kind: 'flair', label: 'Heart', icon: 'social/heart', how: 'Like a game' },
  cube:         { kind: 'flair', label: 'Cube', icon: 'game/cube', how: 'Build something in Studio' },
  bolt:         { kind: 'flair', label: 'Bolt', icon: 'game/bolt', how: 'Import a Scratch project' },
  gem:          { kind: 'flair', label: 'Gem', icon: 'game/gem', how: 'Rate a game' },
  first_game:   { kind: 'badge', label: 'First Game', icon: 'studio/rocket', how: 'Publish your first game' },
  host:         { kind: 'badge', label: 'Host', icon: 'studio/flag', how: 'Create your own server' },
  settler:      { kind: 'badge', label: 'Settler', icon: 'social/pin', how: 'Be around for 30 days' },
  veteran:      { kind: 'badge', label: 'Veteran', icon: 'game/shield', how: 'Be around for a whole year' },
  viral:        { kind: 'badge', label: 'Viral', icon: 'social/star', how: 'One of your games reaches 100 plays' },
  worldbuilder: { kind: 'title', label: 'Worldbuilder', icon: 'social/crown', how: 'Publish five games' },
  renowned:     { kind: 'title', label: 'Renowned', icon: 'social/trophy', how: 'One of your games reaches 100 plays' },
  jam_champion: { kind: 'badge', label: 'Jam Champion', icon: 'social/crown', how: 'Win a weekly game jam' },
  race_top3:    { kind: 'badge', label: 'Race Podium', icon: 'social/trophy', how: 'Podium (top 3) in the weekly creator race' },
  race_winner:  { kind: 'title', label: 'Race Champion', icon: 'social/crown', how: 'Win the weekly creator race' },
};
// Equip caps per kind — b badges / f flairs / t titles.
const EQUIP_CAPS = { b: 5, f: 10, t: 2 };
const EQ_KIND = { b: 'badge', f: 'flair', t: 'title' };

// ── Cosmetics shop ────────────────────────────────────────────────
// Bought with coins, owned in user_cosmetics, worn from users.equips.
// Single-value slots: fr frame · bn banner · ef profile effect ·
// ne name effect · ti title · em emoji pack. Titles share the `t` array
// with earned award titles (ownership is the union of user_badges and
// user_cosmetics), so both equips paths have to merge, never overwrite.
// Prices live here only — the client reads them from /api/cosmetics.
const COSMETIC_SLOTS = { fr: 'frame', bn: 'banner', ef: 'effect', ne: 'name', ti: 'title', em: 'emoji' };
const COSMETIC_SINGLE = { fr: 1, bn: 1, ef: 1, ne: 1, em: 1 };
const COSMETICS = [
  { code: 'frame_ring',      slot: 'fr', label: 'Leaf Ring',    price: 80,  blurb: 'A clean lime ring around your avatar.' },
  { code: 'frame_ice',       slot: 'fr', label: 'Ice Ring',     price: 140, blurb: 'Cold blue edge, subtle inner glow.' },
  { code: 'frame_ember',     slot: 'fr', label: 'Ember Ring',   price: 140, blurb: 'Warm orange rim for night owls.' },
  { code: 'frame_void',      slot: 'fr', label: 'Void Ring',    price: 220, blurb: 'Deep violet with a bright edge.' },
  { code: 'frame_dash',      slot: 'fr', label: 'Circuit',      price: 260, blurb: 'Dashed ring that rotates on hover.' },
  { code: 'frame_holo',      slot: 'fr', label: 'Holo',         price: 380, blurb: 'Full colour wheel, always spinning.' },
  { code: 'frame_gold',      slot: 'fr', label: 'Champion',     price: 600, blurb: 'Jam-winner gold with a slow shine.' },

  { code: 'banner_grid',     slot: 'bn', label: 'Blueprint',    price: 90,  blurb: 'Faint graph paper behind your header.' },
  { code: 'banner_terminal', slot: 'bn', label: 'Terminal',     price: 150, blurb: 'Green-on-black scanline wash.' },
  { code: 'banner_aurora',   slot: 'bn', label: 'Aurora',       price: 180, blurb: 'Slow teal and violet northern light.' },
  { code: 'banner_sunset',   slot: 'bn', label: 'Sunset',       price: 180, blurb: 'Dusk gradient, ember at the edge.' },
  { code: 'banner_stars',    slot: 'bn', label: 'Starfield',    price: 240, blurb: 'A quiet field of drifting stars.' },
  { code: 'banner_prism',    slot: 'bn', label: 'Prism',        price: 320, blurb: 'Hard light refracted across the header.' },

  { code: 'effect_scan',     slot: 'ef', label: 'Scanlines',    price: 120, blurb: 'CRT lines drifting down your card.' },
  { code: 'effect_bubble',   slot: 'ef', label: 'Bubbles',      price: 160, blurb: 'Slow rising bubbles.' },
  { code: 'effect_spark',    slot: 'ef', label: 'Sparks',       price: 180, blurb: 'Occasional twinkles in the corners.' },
  { code: 'effect_orb',      slot: 'ef', label: 'Orbit',        price: 240, blurb: 'A ring of dots circling your card.' },
  { code: 'effect_drift',    slot: 'ef', label: 'Drift',        price: 260, blurb: 'Embers floating up the page.' },

  { code: 'name_mono',       slot: 'ne', label: 'Mono',         price: 60,  blurb: 'Monospace name — toolmaker energy.' },
  { code: 'name_glow',       slot: 'ne', label: 'Glow',         price: 120, blurb: 'Soft luminous name.' },
  { code: 'name_type',       slot: 'ne', label: 'Typing',       price: 180, blurb: 'A blinking caret after your name.' },
  { code: 'name_gradient',   slot: 'ne', label: 'Gradient',     price: 200, blurb: 'Lime-to-sky sweep across the letters.' },
  { code: 'name_glitch',     slot: 'ne', label: 'Glitch',       price: 300, blurb: 'RGB split that twitches now and then.' },

  { code: 'title_maker',     slot: 'ti', label: 'Maker',        price: 100, blurb: 'For people who ship things.' },
  { code: 'title_tinkerer',  slot: 'ti', label: 'Tinkerer',     price: 140, blurb: 'Always mid-edit.' },
  { code: 'title_speedrunner', slot: 'ti', label: 'Speedrunner', price: 200, blurb: 'Wear it on your leaderboard games.' },
  { code: 'title_gamejammer', slot: 'ti', label: 'Game Jammer', price: 200, blurb: 'Every week, a new build.' },
  { code: 'title_architect', slot: 'ti', label: 'Architect',    price: 300, blurb: 'Systems, engines, worlds.' },
  { code: 'title_legend',    slot: 'ti', label: 'Legend',       price: 900, blurb: 'The long-save cosmetic.' },

  { code: 'pack_classic',    slot: 'em', label: 'Classic Mix',  price: 100, blurb: 'Ten extra chat emojis — the house set.' },
  { code: 'pack_cozy',       slot: 'em', label: 'Cozy',         price: 140, blurb: 'Tea, blankets, and warm light.' },
  { code: 'pack_spooky',     slot: 'em', label: 'Spooky',       price: 160, blurb: 'Bats, bones, and bad ideas.' },
  { code: 'pack_space',      slot: 'em', label: 'Space',        price: 180, blurb: 'Rockets, comets, and quiet void.' },
];
const COSMETIC_BY_CODE = (() => { const m = new Map(); for (const c of COSMETICS) m.set(c.code, c); return m; })();

// Equipped codes → human labels for any page that has to draw them.
function resolveCosmetics(equips) {
  const eq = equips && typeof equips === 'object' ? equips : {};
  const out = { frame: null, banner: null, effect: null, name: null, title: null, emoji: null };
  for (const slot of Object.keys(COSMETIC_SLOTS)) {
    const kind = COSMETIC_SLOTS[slot];
    const picked = slot === 'ti'
      ? (Array.isArray(eq.t) ? eq.t.find(c => COSMETIC_BY_CODE.has(c)) : null)
      : (typeof eq[slot] === 'string' ? eq[slot] : null);
    if (!picked) continue;
    const item = COSMETIC_BY_CODE.get(picked);
    if (item) out[kind] = { code: item.code, label: item.label };
    else if (slot === 'ti' && AWARDS[picked]) out.title = { code: picked, label: AWARDS[picked].label };
  }
  return out;
}

// Every code a user is allowed to equip, across awards and purchases.
async function ownedEquipCodes(userId) {
  const { data: badges } = await supabase.from('user_badges').select('code').eq('user_id', userId);
  // A missing user_cosmetics table (migration not run yet) must not lock
  // anyone out of their earned awards — treat it as "no purchases".
  let bought = [];
  try {
    const { data } = await supabase.from('user_cosmetics').select('code').eq('user_id', userId);
    bought = data || [];
  } catch (e) {}
  const set = new Set((badges || []).map(r => r.code));
  for (const r of bought) set.add(r.code);
  return set;
}

  return {
    AWARDS, EQUIP_CAPS, EQ_KIND, COSMETIC_SLOTS, COSMETIC_SINGLE, COSMETICS,
    COSMETIC_BY_CODE, resolveCosmetics, ownedEquipCodes,
  };
};
