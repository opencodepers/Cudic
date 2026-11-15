/* file: public/friend-activity.js
 * what: The Friends page's activity shelf — recent public activity from
 *   accepted friends who opted in, newest first.
 * invariants: reads only /api/activity/friends; never invents rows for people
 *   who did not share, and renders text with textContent.
 */
(function () {
  function apiHost() {
    return (typeof WS_URL !== 'undefined' && WS_URL) ? WS_URL.replace(/^wss?:\/\//, 'https://') : '';
  }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  async function token() {
    try {
      if (window.getAuthToken) return await window.getAuthToken();
      var raw = localStorage.getItem('sb-qgcydphkaujomxyzwcht-auth-token');
      if (!raw) return null;
      var s = JSON.parse(raw);
      return (s && s.access_token) || raw || null;
    } catch (e) { return null; }
  }
  async function boot() {
    var box = document.getElementById('friendActivityList');
    if (!box) return;
    var t = await token();
    if (!t) return;
    try {
      var r = await fetch(apiHost() + '/api/activity/friends', { headers: { 'Authorization': 'Bearer ' + t } });
      var d = await r.json();
      var rows = d.activity || [];
      if (!rows.length) {
        box.innerHTML = '<div class="empty">No friend activity yet. Friends can share theirs from Profile.</div>';
        return;
      }
      box.innerHTML = rows.map(function (a) {
        var avatar = a.avatar_url
          ? '<div class="avatar"><img src="' + esc(a.avatar_url) + '" alt=""></div>'
          : '<div class="avatar">' + esc(String(a.display_name || '?').substring(0, 2).toUpperCase()) + '</div>';
        return '<div class="row">' + avatar
          + '<div class="grow"><b>' + esc(a.display_name) + '</b><span>' + esc(a.text) + ' · '
          + esc(new Date(a.created_at).toLocaleDateString()) + '</span></div>'
          + '<div class="acts"><a class="btn" href="/creator?id=' + encodeURIComponent(a.user_id) + '">View →</a></div></div>';
      }).join('');
    } catch (e) {
      box.innerHTML = '<div class="empty">Could not load friend activity.</div>';
    }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
