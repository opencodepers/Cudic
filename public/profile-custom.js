/* file: public/profile-custom.js
 * what: Public profile extras — widgets, custom badges, banner focal point and
 *   a profile-only theme pack. Runs on /creator; self-management lives in
 *   /customize.
 * invariants: only published profile data is rendered; every value is escaped
 *   or validated as a URL before it reaches the DOM.
 */
(function () {
  var uid = new URLSearchParams(location.search).get('id');
  if (!uid) return;
  function apiHost() { return (typeof WS_URL !== 'undefined' && WS_URL) ? WS_URL.replace(/^wss?:\/\//, 'https://') : ''; }
  function esc(s) { var d = document.createElement('div'); d.textContent = s == null ? '' : s; return d.innerHTML; }
  function hex(v) { return /^#[0-9a-f]{6}$/i.test(String(v || '')) ? v : ''; }
  function url(v) { return /^https:\/\//i.test(String(v || '')) ? String(v) : ''; }
  function addSection(title, html) {
    var card = document.getElementById('creatorCard');
    if (!card || !html) return;
    var sec = document.createElement('div');
    sec.style.cssText = 'margin-top:18px;padding-top:14px;border-top:1px solid var(--line)';
    sec.innerHTML = '<div style="font:600 .85rem/1.2 var(--font-head);margin-bottom:7px">' + esc(title) + '</div>' + html;
    card.appendChild(sec);
  }
  function widgets(rows) {
    if (!rows || !rows.length) return;
    var html = rows.map(function (w) {
      var c = w.config || {};
      if (w.kind === 'text') return '<div style="font-size:.84rem;color:var(--text-secondary);white-space:pre-wrap;margin-bottom:6px">' + esc(c.text).substring(0, 300) + '</div>';
      if (w.kind === 'link') return '<a href="' + esc(url(c.url)) + '" target="_blank" rel="noopener" style="display:inline-block;border:1px solid var(--line);border-radius:999px;padding:3px 12px;margin:0 6px 6px 0;font-size:.78rem;color:var(--text-primary);text-decoration:none">' + esc(c.label) + '</a>';
      if (w.kind === 'achievement') return '<div style="font-size:.8rem;color:var(--text-secondary)">Achievement <b style="color:var(--signal)">' + esc(c.code) + '</b></div>';
      return '<div style="font-size:.8rem;color:var(--text-secondary)">Latest games widget (' + (c.limit || 3) + ')</div>';
    }).join('');
    addSection('About this profile', html);
  }
  function badges(rows) {
    if (!rows || !rows.length) return;
    var html = '<div style="display:flex;flex-wrap:wrap;gap:5px">' + rows.map(function (b) {
      return '<span title="' + esc(b.name) + '" style="display:inline-flex;align-items:center;gap:4px;border:1px solid ' + esc(hex(b.colour) || '#888') + ';border-radius:999px;padding:2px 9px;font-size:.74rem">' + esc(b.icon) + ' ' + esc(b.name) + '</span>';
    }).join('') + '</div>';
    addSection('Server badges', html);
  }
  async function pack(slug) {
    if (!slug) return;
    try {
      var r = await fetch(apiHost() + '/api/packs/' + encodeURIComponent(slug) + '/manifest');
      if (!r.ok) return;
      var d = await r.json(), m = d.manifest || {};
      var card = document.getElementById('creatorCard');
      if (!card || !m.colors) return;
      ['ink', 'panel', 'raised', 'line', 'tp', 'ts', 'tt'].forEach(function (k) {
        var map = { ink: '--ink', panel: '--panel', raised: '--panel-raised', line: '--line', tp: '--text-primary', ts: '--text-secondary', tt: '--text-tertiary' };
        if (m.colors[k]) card.style.setProperty(map[k], m.colors[k]);
      });
      if (m.colors.signal) card.style.setProperty('--signal', m.colors.signal);
    } catch (e) {}
  }
  async function boot() {
    try {
      var r = await fetch(apiHost() + '/api/customize/public/' + encodeURIComponent(uid));
      if (!r.ok) return;
      var d = await r.json();
      var p = d.profile || {};
      var banner = document.getElementById('creatorBanner');
      var hero = document.getElementById('creatorCard');
      var pos = p.banner_pos == null ? 50 : p.banner_pos;
      if (banner) banner.style.backgroundPosition = 'center ' + pos + '%';
      if (hero) {
        hero.style.backgroundPosition = 'center ' + pos + '%';
        if (p.banner_animated) {
          var reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
          if (!reduced) hero.classList.add('cz-banner-anim');
        }
      }
      widgets(d.widgets || []);
      badges(d.badges || []);
      pack(p.profile_pack_slug);
    } catch (e) {}
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { setTimeout(boot, 400); });
  else setTimeout(boot, 400);
})();
