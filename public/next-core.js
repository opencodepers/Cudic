/* file: public/next-core.js
 * what: Shared model, seed state, formatting helpers and feature registry for the Next workspace.
 * invariants: every feature reads NX.state at render time (never captures it), and every write goes through NX.commit so the model persists.
 * see: public/next.html, public/next.css.
 */
(function () {
  'use strict';

  var NX = window.CudicNext = window.CudicNext || {};
  NX.features = NX.features || [];
  NX.add = function (feature) { NX.features.push(feature); };
  NX.byId = function (id) {
    for (var i = 0; i < NX.features.length; i++) if (NX.features[i].id === id) return NX.features[i];
    return null;
  };

  var $ = NX.$ = function (sel, root) { return (root || document).querySelector(sel); };
  var $$ = NX.$$ = function (sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); };

  NX.esc = function (value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  };
  var esc = NX.esc;

  NX.clone = function (value) { return JSON.parse(JSON.stringify(value)); };
  NX.uid = function () { return Date.now().toString(36) + Math.random().toString(36).slice(2, 6); };

  NX.toast = function (message) {
    var el = document.getElementById('nxToast');
    if (!el) return;
    el.textContent = message || '';
    el.classList.add('show');
    clearTimeout(NX._toastTimer);
    NX._toastTimer = setTimeout(function () { el.classList.remove('show'); }, 2600);
  };

  NX.setPath = function (path, value) {
    var parts = String(path || '').split('.');
    var obj = NX.state;
    for (var i = 0; i < parts.length - 1; i++) {
      if (!obj[parts[i]] || typeof obj[parts[i]] !== 'object') obj[parts[i]] = {};
      obj = obj[parts[i]];
    }
    obj[parts[parts.length - 1]] = value;
  };

  NX.save = function () {
    try {
      localStorage.setItem('cudic_next_v1', JSON.stringify({ v: 1, state: NX.state }));
    } catch (e) {
      try { NX.toast('This browser could not save the model.'); } catch (x) {}
    }
  };

  NX.commit = function (message, focusAct) {
    NX.save();
    if (typeof NX.rerender === 'function') NX.rerender();
    if (focusAct && NX.stage) {
      var el = NX.$$('[data-act]', NX.stage).filter(function (node) { return node.getAttribute('data-act') === focusAct; })[0];
      if (el) el.focus();
    }
    if (message) NX.toast(message);
  };

  NX.domainOf = function (value) {
    try { return new URL(value).hostname.replace(/^www\./, ''); } catch (e) { return ''; }
  };

  NX.hexLum = function (hex) {
    var m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(String(hex || ''));
    if (!m) return 0;
    var rgb = [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)].map(function (n) {
      n /= 255;
      return n <= 0.03928 ? n / 12.92 : Math.pow((n + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2];
  };

  NX.contrast = function (a, b) {
    var l1 = NX.hexLum(a), l2 = NX.hexLum(b);
    return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
  };

  NX.readImage = function (file) {
    return new Promise(function (resolve, reject) {
      if (!file || !/^image\//.test(file.type || '')) return reject(new Error('Choose an image file.'));
      var reader = new FileReader();
      reader.onerror = function () { reject(new Error('That file could not be read.')); };
      reader.onload = function () {
        var img = new Image();
        img.onerror = function () { reject(new Error('That image could not be decoded.')); };
        img.onload = function () {
          var max = 560;
          var scale = Math.min(1, max / Math.max(img.width, img.height));
          var canvas = document.createElement('canvas');
          canvas.width = Math.max(1, Math.round(img.width * scale));
          canvas.height = Math.max(1, Math.round(img.height * scale));
          var ctx = canvas.getContext('2d');
          if (!ctx) return reject(new Error('This browser cannot resize that image.'));
          ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
          resolve(canvas.toDataURL('image/jpeg', 0.68));
        };
        img.src = String(reader.result || '');
      };
      reader.readAsDataURL(file);
    });
  };

  /* ── Reusable markup ─────────────────────────────────────── */
  var ICON_PATHS = {
    check: '<path d="M20 6 9 17l-5-5"/>',
    x: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
    plus: '<path d="M5 12h14"/><path d="M12 5v14"/>',
    'arrow-left': '<path d="m12 19-7-7 7-7"/><path d="M19 12H5"/>',
    'arrow-right': '<path d="M5 12h14"/><path d="m12 5 7 7-7 7"/>',
    alert: '<path d="m21.73 18-8-14a2 2 0 0 0-3.46 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4"/><path d="M12 17h.01"/>',
    grip: '<path d="M9 5h.01"/><path d="M9 12h.01"/><path d="M9 19h.01"/><path d="M15 5h.01"/><path d="M15 12h.01"/><path d="M15 19h.01"/>'
  };
  NX.icon = function (name) {
    var path = ICON_PATHS[name];
    if (!path) return '';
    return '<svg class="nx-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">' + path + '</svg>';
  };
  NX.action = function (label, act, data, cls) {
    return '<button type="button" class="nx-action ' + (cls || '') + '" data-act="' + esc(act) + '"' + (data ? ' ' + data : '') + '>' + label + '</button>';
  };

  NX.msg = function (name, initials, when, text, actions, cls) {
    return '<div class="nx-msg ' + (cls || '') + '">'
      + '<span class="nx-ava">' + esc(initials) + '</span>'
      + '<div class="nx-msg-main"><div class="nx-msg-head"><span class="nx-msg-name">' + esc(name) + '</span>'
      + '<span class="nx-msg-time">' + esc(when) + '</span></div>'
      + '<p class="nx-msg-text">' + text + '</p>'
      + (actions ? '<div class="nx-msg-actions">' + actions + '</div>' : '')
      + '</div></div>';
  };

  NX.toggle = function (path, checked, label) {
    return '<label class="nx-switch"><input type="checkbox" data-change="' + esc(path) + '"'
      + (checked ? ' checked' : '') + ' aria-label="' + esc(label) + '"><span class="nx-track"></span></label>';
  };

  NX.field = function (label, id, value, placeholder, type) {
    return '<div class="nx-field"><label class="nx-label" for="' + esc(id) + '">' + esc(label) + '</label>'
      + '<input class="nx-input" id="' + esc(id) + '" type="' + esc(type || 'text') + '" value="' + esc(value == null ? '' : value) + '" placeholder="' + esc(placeholder || '') + '"></div>';
  };

  var EMOJI_FACES = { pixelheart: '❤️', partyblob: '🎉', tinycrown: '👑', spark: '✨', bug: '🐛', gg: '✅' };
  NX.face = function (emoji) {
    return EMOJI_FACES[String(emoji || '').replace(/^:|:$/g, '')] || emoji;
  };

  /* ── Seed data ───────────────────────────────────────────── */
  NX.members = [
    { id: 1, name: 'Maya Chen', initials: 'MC', role: 'Owner', joined: 'Mar 2024', status: 'online' },
    { id: 2, name: 'Jon Bell', initials: 'JB', role: 'Mod', joined: 'Jun 2024', status: 'playing' },
    { id: 3, name: 'Priya Shah', initials: 'PS', role: 'Member', joined: 'Jan 2025', status: 'online' },
    { id: 4, name: 'Theo Park', initials: 'TP', role: 'Member', joined: 'Sep 2025', status: 'idle' },
    { id: 5, name: 'Lena Ortiz', initials: 'LO', role: 'Member', joined: 'Nov 2025', status: 'offline' }
  ];
  NX.tags = ['Art', 'Minecraft', 'Cosy', 'Competitive', 'Beginner-friendly', 'Roleplay', 'Game jams'];
  NX.ages = [
    { label: 'All ages', hint: 'Open to everyone' },
    { label: '13+', hint: 'Teen-safe default' },
    { label: '16+', hint: 'Mature themes' },
    { label: '18+', hint: 'Adults only' }
  ];
  NX.translations = {
    en: 'Does anyone want to test my game tonight?',
    fr: 'Quelqu’un veut tester mon jeu ce soir ?',
    es: '¿Alguien quiere probar mi juego esta noche?'
  };
  NX.codeText = {
    js: '// keep the jump honest\nconst jump = (dt) => {\n  velocity -= 540 * dt;\n  if (grounded) velocity = -620;\n  return velocity;\n};',
    py: '# keep the jump honest\ndef jump(dt, grounded):\n    velocity -= 540 * dt\n    if grounded:\n        velocity = -620\n    return velocity'
  };
  NX.codeHtml = {
    js: '<span class="tok-c">// keep the jump honest</span>\n'
      + '<span class="tok-k">const</span> jump = (dt) =&gt; {\n'
      + '  velocity -= <span class="tok-n">540</span> * dt;\n'
      + '  <span class="tok-k">if</span> (grounded) velocity = -<span class="tok-n">620</span>;\n'
      + '  <span class="tok-k">return</span> velocity;\n'
      + '};',
    py: '<span class="tok-c"># keep the jump honest</span>\n'
      + '<span class="tok-k">def</span> jump(dt, grounded):\n'
      + '    velocity -= <span class="tok-n">540</span> * dt\n'
      + '    <span class="tok-k">if</span> grounded:\n'
      + '        velocity = -<span class="tok-n">620</span>\n'
      + '    <span class="tok-k">return</span> velocity'
  };

  var DEFAULTS = {
    threads: {
      open: true,
      replies: [
        { by: 'Maya', initials: 'MC', when: '2m', text: 'The jump feels floaty — try 620 instead of 540.' },
        { by: 'You', initials: 'Y', when: '1m', text: 'Good catch. I’ll tune it after this round.' }
      ]
    },
    link: { url: 'https://cudic.vercel.app/games/neon-drift', removed: false },
    interactive: { vote: '', form: false, counts: { in: 12, maybe: 4, out: 1 } },
    reactions: { mine: ['🔥'], picker: false, counts: { '🔥': 8, '🎮': 4, ':pixelheart:': 3 } },
    typing: { enabled: true, text: 'I found a bug in the jump — one sec.', visible: true },
    polls: {
      selected: ['Neon Drift'], voted: false, closed: false,
      options: [
        { label: 'Neon Drift', votes: 9 },
        { label: 'Mosslight', votes: 6 },
        { label: 'Rook & Roll', votes: 4 },
        { label: 'Tidepool', votes: 2 }
      ]
    },
    syntax: { lang: 'js' },
    summary: { shown: false },
    notify: { mentions: true, digest: false, quiet: true },
    smartreplies: { variant: 0, chosen: '', sent: false },
    translation: { lang: 'en', shown: false },
    perms: {
      Member: { view: 'allow', post: 'allow', attach: 'inherit', pin: 'deny' },
      Mod: { view: 'allow', post: 'allow', attach: 'allow', pin: 'allow' },
      Guest: { view: 'inherit', post: 'deny', attach: 'deny', pin: 'deny' }
    },
    sim: { role: 'Mod', channel: '#staff', action: 'attach' },
    roles: { inherit: true, parent: 'Member' },
    mod: {
      rules: [
        { id: 'r1', when: 'a message contains a link', then: 'flag for review' },
        { id: 'r2', when: 'a new account mentions 5+ people', then: 'hold the message' }
      ],
      test: 'hey come play https://example.com',
      result: ''
    },
    bg: { color: '#20334d', url: '' },
    forums: {
      openId: 0,
      composing: false,
      threads: [
        {
          id: 1, title: 'Show your current project', tags: ['Showcase', 'Art'], author: 'Maya Chen', when: '12m',
          body: 'One screenshot and one sentence. No pitch decks.',
          replies: [
            { by: 'Priya', initials: 'PS', text: 'A tiny train station with too many clocks.', when: '8m' }
          ]
        },
        {
          id: 2, title: 'How do you keep a 2D camera from juddering?', tags: ['Help', 'Code'], author: 'Theo Park', when: '1h',
          body: 'I round the camera to whole pixels, but diagonal movement still shimmers.',
          replies: []
        },
        {
          id: 3, title: 'Friday playtest roster', tags: ['Event'], author: 'Jon Bell', when: '3h',
          body: 'Three slots left. Drop a build and the control scheme.',
          replies: []
        }
      ]
    },
    gallery: {
      items: [
        { id: 'g1', label: 'Neon Drift', color: '#20334d', src: '' },
        { id: 'g2', label: 'Mosslight', color: '#143327', src: '' },
        { id: 'g3', label: 'Rook & Roll', color: '#3a2a12', src: '' }
      ]
    },
    directory: { q: '', filter: 'all', opted: true },
    mc: { online: true, players: 7, checked: '12s ago' },
    tags: { selected: ['Art', 'Minecraft'] },
    age: { label: '13+' },
    status: { emoji: '🎮', text: 'Building a tiny platformer' },
    favs: { ids: [2] },
    activity: { shown: true },
    colors: { Owner: '#FF8C1A', Mod: '#6EA8FF', Member: '#3ECF8E' },
    comp: {
      voted: '', submitted: false,
      entries: [
        { id: 'c1', title: 'A garden on a dead moon', author: 'Priya', votes: 14 },
        { id: 'c2', title: 'One room, four seasons', author: 'Theo', votes: 9 },
        { id: 'c3', title: 'The last bus home', author: 'Lena', votes: 6 }
      ]
    },
    teams: {
      joined: ['moss'],
      teams: [
        { id: 'neon', name: 'Neon Drift', mark: 'ND', members: 4, games: 2 },
        { id: 'moss', name: 'Mosslight', mark: 'MS', members: 3, games: 1 },
        { id: 'rook', name: 'Rook & Roll', mark: 'RR', members: 5, games: 3 }
      ]
    },
    tour: { semi1: '', semi2: '', winner: '' },
    emoji: {
      selected: 'pixelheart',
      custom: '',
      pack: [
        { code: 'pixelheart', glyph: '❤️' },
        { code: 'partyblob', glyph: '🎉' },
        { code: 'tinycrown', glyph: '👑' },
        { code: 'spark', glyph: '✨' },
        { code: 'bug', glyph: '🐛' },
        { code: 'gg', glyph: '✅' }
      ]
    },
    preview: { joined: false, triedPrivate: false, banner: '#20334d' },
    welcome: { banner: '#143327', rules: true },
    joinq: { why: '', games: 'Mosslight', sent: false, modView: false },
    order: {
      list: ['#general', '#build-log', '#art', '#staff', '#off-topic'],
      last: ''
    },
    chantags: { on: ['build', 'help'] },
    lfg: {
      game: 'Neon Drift',
      slots: '2',
      joined: [],
      posts: [
        { id: 'l1', game: 'Neon Drift', when: 'Tonight · 20:00 GMT', have: 2, need: 4, by: 'Theo' },
        { id: 'l2', game: 'Mosslight SMP', when: 'Sat · 18:00 GMT', have: 3, need: 3, by: 'Priya' }
      ]
    },
    spotlight: { picked: '', posted: false, optedIn: true },
    conn: { address: 'play.mosslight.gg', port: '25565', owner: true, listed: false },
    nights: { rsvp: false, cancelled: false },
    dash: {
      slow: false,
      open: [
        { id: 'd1', kind: 'Link', target: '#general', by: 'auto-rule r1', age: '2m' },
        { id: 'd2', kind: 'Spam', target: '#build-log', by: 'auto-rule r3', age: '9m' },
        { id: 'd3', kind: 'Report', target: 'message · #art', by: 'Priya', age: '31m' }
      ],
      resolved: []
    }
  };
  NX.defaults = DEFAULTS;

  function load() {
    try {
      var raw = JSON.parse(localStorage.getItem('cudic_next_v1') || 'null');
      if (!raw || raw.v !== 1 || !raw.state) return NX.clone(DEFAULTS);
      var merged = NX.clone(DEFAULTS);
      Object.keys(raw.state).forEach(function (key) {
        if (raw.state[key] !== undefined) merged[key] = raw.state[key];
      });
      if (merged.emoji && merged.emoji.pack) {
        merged.emoji.pack.forEach(function (item) {
          if (item && EMOJI_FACES[item.code]) item.glyph = EMOJI_FACES[item.code];
        });
      }
      return merged;
    } catch (e) {
      return NX.clone(DEFAULTS);
    }
  }

  NX.state = load();
})();
