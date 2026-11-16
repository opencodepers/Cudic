/* file: public/moderate-servers.js
 * what: the server-moderation half of /moderate — one card per server the viewer
 *   owns or moderates, with members, warnings, bans, slow channels, recent
 *   actions and join answers.
 * invariants: reads only; every endpoint is owner/mod gated server-side. A
 *   server whose overview fails is skipped, never rendered as zeroes.
 */
(function () {
  var host = (typeof WS_URL !== 'undefined' && WS_URL) ? WS_URL.replace(/^wss?:\/\//, 'https://') : '';
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function token() {
    try { if (window.getAuthToken) return window.getAuthToken(); } catch (e) {}
    try { var raw = localStorage.getItem('sb-qgcydphkaujomxyzwcht-auth-token'); return raw ? (JSON.parse(raw).access_token || raw) : null; } catch (e) { return null; }
  }
  var st = document.createElement('style');
  st.textContent = '.msrv-wrap{margin:26px 0 10px}.msrv-wrap h2{font:600 1rem/1.3 var(--font-head);margin:0 0 10px}'
    + '.msrv-card{background:var(--panel-raised);border:1px solid var(--line);border-radius:var(--radius-lg);padding:14px 16px;margin-bottom:12px}'
    + '.msrv-top{display:flex;align-items:center;gap:8px;margin-bottom:8px}.msrv-top b{font:600 .9rem/1.3 var(--font-head)}'
    + '.msrv-top a{margin-left:auto;font-size:.75rem;color:var(--signal);text-decoration:none}'
    + '.msrv-nums{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:8px}'
    + '.msrv-num{border:1px solid var(--line);border-radius:8px;padding:5px 9px;font-size:.72rem;color:var(--text-secondary)}'
    + '.msrv-num b{display:block;font-size:1rem;color:var(--text-primary)}'
    + '.msrv-list{font-size:.76rem;color:var(--text-secondary);line-height:1.6;margin-top:6px}'
    + '.msrv-list em{font-style:normal;color:var(--text-tertiary)}';
  document.head.appendChild(st);

  async function boot() {
    var t = await token();
    if (!t) return;
    var content = document.querySelector('.mod-content');
    if (!content) return;
    var wrap = document.getElementById('msrvWrap');
    if (!wrap) {
      wrap = document.createElement('div'); wrap.id = 'msrvWrap'; wrap.className = 'msrv-wrap';
      wrap.innerHTML = '<h2>Server moderation</h2><div id="msrvList"></div>';
      content.appendChild(wrap);
    }
    var list = document.getElementById('msrvList');
    var servers = [];
    try {
      var r = await fetch(host + '/api/mod/my-servers', { headers: { Authorization: 'Bearer ' + t } });
      if (r.ok) servers = (await r.json()).servers || [];
    } catch (e) {}
    if (!servers.length) { list.innerHTML = '<p class="mod-sub">No servers you own or moderate.</p>'; return; }
    var cards = await Promise.all(servers.slice(0, 12).map(async function (s) {
      try {
        var rr = await fetch(host + '/api/servers/' + s.id + '/mod-overview', { headers: { Authorization: 'Bearer ' + t } });
        if (!rr.ok) return '';
        var d = await rr.json();
        var lastActions = (d.audit || []).slice(0, 5).map(function (a) {
          return '<div><b>' + esc(a.actor) + '</b> ' + esc(a.action) + (a.target ? ' <em>' + esc(a.target) + '</em>' : '') + ' · ' + esc(new Date(a.created_at).toLocaleDateString()) + '</div>';
        }).join('');
        var warns = (d.warnings || []).slice(0, 5).map(function (w) {
          return '<div><b>' + esc(w.name) + '</b> ' + esc(w.reason) + (w.acknowledged ? ' <em>(seen)</em>' : ' <em>(unseen)</em>') + '</div>';
        }).join('');
        var joins = (d.joins || []).slice(0, 5).map(function (j) {
          return '<div><b>' + esc(j.name) + '</b> ' + esc((j.answers || []).join(' · ')).slice(0, 160) + '</div>';
        }).join('');
        return '<div class="msrv-card"><div class="msrv-top"><b>' + esc(s.name) + '</b><span class="msrv-num" style="border:0;padding:0">' + esc(s.role) + '</span><a href="/server/' + esc(s.id) + '">Open</a></div>'
          + '<div class="msrv-nums">'
          + '<span class="msrv-num"><b>' + (d.members || 0) + '</b>members</span>'
          + '<span class="msrv-num"><b>' + (d.warnings || []).length + '</b>warnings</span>'
          + '<span class="msrv-num"><b>' + (d.bans || []).length + '</b>bans</span>'
          + '<span class="msrv-num"><b>' + (d.slow || []).length + '</b>slow channels</span>'
          + '<span class="msrv-num"><b>' + (d.joins || []).length + '</b>join answers</span>'
          + '</div>'
          + (lastActions ? '<div class="msrv-list"><em>Recent actions</em>' + lastActions + '</div>' : '')
          + (warns ? '<div class="msrv-list"><em>Warnings</em>' + warns + '</div>' : '')
          + (joins ? '<div class="msrv-list"><em>Join answers</em>' + joins + '</div>' : '')
          + (d.slow && d.slow.length ? '<div class="msrv-list"><em>Slow mode</em> ' + d.slow.map(function (c) { return '#' + esc(c.name) + ' ' + c.slow_seconds + 's'; }).join(' · ') + '</div>' : '')
          + '</div>';
      } catch (e) { return ''; }
    }));
    var html = cards.filter(Boolean).join('');
    list.innerHTML = html || '<p class="mod-sub">Could not load server overviews.</p>';
  }
  boot();
})();
