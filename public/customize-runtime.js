/* file: public/customize-runtime.js
 * what: Applies account appearance prefs on every classic page — font, size,
 *   density, rail mode, glass, motion, channel layout, chat layout and
 *   per-type notification tones. Also applies a DM/channel accent.
 * invariants: prefs are cached in localStorage so pages never flash defaults;
 *   a failed API read keeps the cached copy; every field is clamped.
 */
(function () {
  if (window.CudicCustomize) return;
  var KEY = 'cudic_prefs_v1';
  var prefs = {};
  try { prefs = JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch (e) { prefs = {}; }
  var chatTheme = null;

  function apiHost() {
    if (typeof WS_URL !== 'undefined' && WS_URL) return WS_URL.replace(/^wss?:\/\//, 'https://');
    return (location.hostname === 'localhost' || location.hostname === '127.0.0.1') ? '' : 'https://glox-o7rr.onrender.com';
  }
  function token() {
    try {
      var raw = localStorage.getItem('sb-qgcydphkaujomxyzwcht-auth-token');
      if (!raw) return '';
      var s = JSON.parse(raw);
      return (s && s.access_token) || raw;
    } catch (e) { return ''; }
  }
  function shade(hex, amt) {
    var h = String(hex || '').replace('#', '');
    if (h.length !== 6) return '';
    var n = parseInt(h, 16), c = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
    return '#' + c.map(function (v) { return Math.max(0, Math.min(255, v + amt)).toString(16).padStart(2, '0'); }).join('');
  }
  function applyThemeVars(el, theme) {
    if (!el) return;
    if (theme && theme.accent) {
      el.style.setProperty('--signal', theme.accent);
      el.style.setProperty('--signal-hover', shade(theme.accent, -22) || theme.accent);
      var n = parseInt(theme.accent.slice(1), 16), c = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
      el.style.setProperty('--signal-tint', 'rgba(' + c.join(',') + ',0.14)');
    } else {
      el.style.removeProperty('--signal');
      el.style.removeProperty('--signal-hover');
      el.style.removeProperty('--signal-tint');
    }
    if (theme && theme.background) {
      el.style.backgroundImage = 'linear-gradient(rgba(13,14,16,.86), rgba(13,14,16,.86)), url("' + theme.background.replace(/"/g, '') + '")';
      el.style.backgroundSize = 'cover';
      el.style.backgroundPosition = 'center';
    } else {
      el.style.backgroundImage = '';
    }
  }
  function applyProfileExtras() {
    var pos = prefs.banner_pos == null ? 50 : prefs.banner_pos;
    ['publicBanner', 'creatorBanner'].forEach(function (id) {
      var el = document.getElementById(id);
      if (el) el.style.backgroundPosition = 'center ' + pos + '%';
    });
    var img = document.getElementById('cpBannerImg');
    if (img) img.style.objectPosition = 'center ' + pos + '%';
    if (prefs.profile_pack_slug) document.documentElement.dataset.profilePack = String(prefs.profile_pack_slug);
  }
  function applyLayout() {
    var host = document.querySelector('.chat-layout');
    if (!host) return;
    var order = (prefs.layout && prefs.layout.order) || ['sidebar', 'main'];
    var side = host.querySelector('.chat-sidebar'), main = host.querySelector('.chat-main');
    if (!side || !main) return;
    var nodes = { sidebar: side, main: main };
    var current = Array.prototype.filter.call(host.children, function (el) {
      return el === side || el === main;
    }).map(function (el) { return el === side ? 'sidebar' : 'main'; });
    if (current.join(',') === order.join(',')) return;
    order.forEach(function (k) { if (nodes[k]) host.appendChild(nodes[k]); });
  }
  function apply(p) {
    prefs = Object.assign({}, prefs, p || {});
    try { localStorage.setItem(KEY, JSON.stringify(prefs)); } catch (e) {}
    var r = document.documentElement, b = document.body;
    if (!b) return;
    r.dataset.density = prefs.density === 'compact' ? 'compact' : 'comfortable';
    r.dataset.chanLayout = ['compact', 'grid', 'grouped'].indexOf(prefs.chan_layout) !== -1 ? prefs.chan_layout : 'list';
    r.classList.toggle('glass-on', prefs.glass === true);
    r.classList.toggle('reduce-motion', prefs.reduce_motion === true);
    r.classList.remove('rail-icon', 'rail-labels', 'rail-floating');
    r.classList.add('rail-' + (['labels', 'floating'].indexOf(prefs.rail_mode) !== -1 ? prefs.rail_mode : 'icon'));
    if (prefs.font_family) r.style.setProperty('--font-body', '"' + String(prefs.font_family).replace(/"/g, '') + '", sans-serif');
    else r.style.removeProperty('--font-body');
    b.style.fontSize = (prefs.font_size >= 12 && prefs.font_size <= 22) ? prefs.font_size + 'px' : '';
    b.style.lineHeight = (prefs.line_height >= 1.1 && prefs.line_height <= 2.2) ? String(prefs.line_height) : '';
    applyProfileExtras();
    applyLayout();
  }
  async function refresh() {
    var t = token();
    if (!t) { apply(prefs); return prefs; }
    try {
      var r = await fetch(apiHost() + '/api/customize/prefs', { headers: { Authorization: 'Bearer ' + t } });
      if (!r.ok) throw 0;
      var d = await r.json();
      if (d.prefs) apply(d.prefs);
    } catch (e) { apply(prefs); }
    return prefs;
  }
  function soundAllowed(kind) {
    var sounds = prefs.notify_sounds || {};
    if (sounds[kind] === false) return false;
    try { if (localStorage.getItem('cudic_sound') === '0') return false; } catch (e) {}
    return true;
  }
  function playSound(kind) {
    if (!soundAllowed(kind)) return;
    try {
      var Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return;
      var ctx = new Ctx();
      var notes = { dm: [660], mention: [880, 1040], event: [520, 660], call: [980, 980, 780] }[kind] || [660];
      notes.forEach(function (hz, i) {
        var o = ctx.createOscillator(), g = ctx.createGain();
        o.type = 'sine'; o.frequency.value = hz;
        g.gain.value = 0.025;
        o.connect(g); g.connect(ctx.destination);
        var at = ctx.currentTime + i * 0.11;
        o.start(at);
        g.gain.setValueAtTime(0.025, at);
        g.gain.exponentialRampToValueAtTime(0.0001, at + 0.1);
        o.stop(at + 0.11);
      });
      setTimeout(function () { try { ctx.close(); } catch (e) {} }, 600);
    } catch (e) {}
  }
  async function applyConversation(name) {
    var main = document.querySelector('.chat-main');
    if (!main || !name) return;
    applyThemeVars(main, null);
    var t = token();
    if (!t) return;
    try {
      var r = await fetch(apiHost() + '/api/customize/conversation-theme?lobby=' + encodeURIComponent(name), { headers: { Authorization: 'Bearer ' + t } });
      if (!r.ok) return;
      var d = await r.json();
      chatTheme = d.theme || {};
      applyThemeVars(main, chatTheme);
    } catch (e) {}
  }
  function boot() {
    apply(prefs);
    refresh();
    // Re-check once after the page's own boot has built the chat shell.
    setTimeout(applyLayout, 250);
  }
  window.CudicCustomize = {
    get prefs() { return prefs; },
    apply: apply, refresh: refresh, playSound: playSound,
    applyConversation: applyConversation,
    applyThemeVars: applyThemeVars,
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
