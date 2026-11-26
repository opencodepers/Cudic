/* Signal Lost — pure tuning + progression rules.
   Loaded by the page and by tests through node, so no DOM, no deps. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.SL = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var XP_BASE = 5;
  var XP_GROWTH = 1.34;

  var ENEMIES = {
    ghost:   { hp: 3,   speed: 58, radius: 13, score: 10,  touch: 1, label: '404' },
    toast:   { hp: 4,   speed: 40, radius: 14, score: 14,  touch: 1, label: '!' },
    spinner: { hp: 6,   speed: 74, radius: 15, score: 18,  touch: 1, label: '' },
    bloat:   { hp: 15,  speed: 28, radius: 24, score: 30,  touch: 1, label: 'AD' },
    boss:    { hp: 150, speed: 34, radius: 58, score: 500, touch: 2, label: 'COOKIES' }
  };

  var SPAWNS = [
    { type: 'ghost',   from: 1, weight: 6 },
    { type: 'toast',   from: 2, weight: 4 },
    { type: 'spinner', from: 3, weight: 3 },
    { type: 'bloat',   from: 4, weight: 2 }
  ];

  var UPGRADES = [
    { id: 'dmg',    name: 'HOT PATCH',   desc: '+1 damage per shot',            max: 5 },
    { id: 'rate',   name: 'DEBOUNCE',    desc: '15% faster fire rate',          max: 5 },
    { id: 'multi',  name: 'FORK BOMB',   desc: '+1 projectile per shot',        max: 4 },
    { id: 'speed',  name: 'TURBO SCROLL',desc: '+8% movement speed',            max: 4 },
    { id: 'hull',   name: 'SAFE MODE',   desc: '+1 max HP, and heal 1',         max: 3 },
    { id: 'pierce', name: 'REGEX',       desc: 'Shots pierce +1 enemy',         max: 3 },
    { id: 'dash',   name: 'CTRL+Z',      desc: '20% shorter dash cooldown',     max: 3 },
    { id: 'shield', name: 'SANDBOX',     desc: '+1 hit absorbed before damage', max: 2 }
  ];

  var BOSS_EVERY = 4;

  function clamp(n, lo, hi) { return n < lo ? lo : n > hi ? hi : n; }

  function mulberry32(seed) {
    var a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      var t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function xpForLevel(level) {
    return Math.round(XP_BASE * Math.pow(XP_GROWTH, Math.max(1, level) - 1));
  }

  function enemyStats(type, sector) {
    var base = ENEMIES[type];
    if (!base) throw new Error('unknown enemy: ' + type);
    var s = Math.max(1, sector) - 1;
    return {
      type: type,
      label: base.label,
      hp: Math.round(base.hp * (1 + s * 0.32)),
      speed: Math.round(base.speed * (1 + s * 0.035)),
      radius: base.radius,
      score: Math.round(base.score * (1 + s * 0.25)),
      touch: base.touch
    };
  }

  function spawnTable(sector) {
    return SPAWNS.filter(function (s) { return s.from <= sector; });
  }

  function pickSpawn(sector, rng) {
    var table = spawnTable(sector);
    var total = table.reduce(function (n, s) { return n + s.weight; }, 0);
    var roll = rng() * total;
    for (var i = 0; i < table.length; i++) {
      roll -= table[i].weight;
      if (roll <= 0) return table[i].type;
    }
    return table[table.length - 1].type;
  }

  function upgradeChoices(up, rng) {
    var pool = UPGRADES.filter(function (u) { return (up[u.id] || 0) < u.max; });
    for (var i = pool.length - 1; i > 0; i--) {
      var j = Math.floor(rng() * (i + 1));
      var tmp = pool[i]; pool[i] = pool[j]; pool[j] = tmp;
    }
    return pool.slice(0, 3).map(function (u) { return u.id; });
  }

  function applyUpgrade(up, id) {
    var u = UPGRADES.filter(function (x) { return x.id === id; })[0];
    if (!u) return up;
    up[id] = clamp((up[id] || 0) + 1, 0, u.max);
    return up;
  }

  function stats(up) {
    var u = up || {};
    return {
      damage: 1 + (u.dmg || 0),
      fireDelay: Math.max(0.07, 0.26 * Math.pow(0.85, u.rate || 0)),
      shots: 1 + (u.multi || 0),
      speed: Math.round(250 * (1 + 0.08 * (u.speed || 0))),
      maxHp: 5 + (u.hull || 0),
      pierce: u.pierce || 0,
      dashCd: Math.max(0.5, 1.6 * Math.pow(0.8, u.dash || 0)),
      shield: u.shield || 0
    };
  }

  function sectorQuota(sector) {
    return 6 + Math.max(1, sector) * 2;
  }

  function isBossSector(sector) {
    return sector % BOSS_EVERY === 0;
  }

  return {
    XP_BASE: XP_BASE,
    XP_GROWTH: XP_GROWTH,
    BOSS_EVERY: BOSS_EVERY,
    ENEMIES: ENEMIES,
    SPAWNS: SPAWNS,
    UPGRADES: UPGRADES,
    clamp: clamp,
    mulberry32: mulberry32,
    xpForLevel: xpForLevel,
    enemyStats: enemyStats,
    spawnTable: spawnTable,
    pickSpawn: pickSpawn,
    upgradeChoices: upgradeChoices,
    applyUpgrade: applyUpgrade,
    stats: stats,
    sectorQuota: sectorQuota,
    isBossSector: isBossSector
  };
});
