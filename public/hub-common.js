/* file: public/hub-common.js
 * what: the four things every hub page needs — escaping, the API host, the
 *   signed-in token, and a relative time. Kept in one file so inbox, search and
 *   home cannot drift apart in how they talk to /api.
 * invariants: no token is written anywhere; every request carries the same
 *   Supabase access token auth.js already exposes, and a signed-out page goes to
 *   /login instead of rendering an empty list.
 */
(function () {
  function esc(value) {
    var d = document.createElement('div');
    d.textContent = value == null ? '' : String(value);
    return d.innerHTML;
  }

  function host() {
    return (typeof WS_URL !== 'undefined' && WS_URL) ? WS_URL.replace(/^wss?:\/\//, 'https://') : '';
  }

  function token() {
    try {
      if (window.getAuthToken) return window.getAuthToken().then(function (t) { return t || null; });
      var raw = localStorage.getItem('sb-qgcydphkaujomxyzwcht-auth-token');
      var parsed = raw ? JSON.parse(raw) : null;
      return Promise.resolve((parsed && parsed.access_token) || null);
    } catch (e) { return Promise.resolve(null); }
  }

  function api(path, options) {
    return token().then(function (t) {
      if (!t) { window.location.href = '/login'; return Promise.reject(new Error('Signed out')); }
      var opts = options || {};
      return fetch(host() + path, {
        method: opts.method || 'GET',
        headers: { Authorization: 'Bearer ' + t, 'Content-Type': 'application/json' },
        body: opts.body ? JSON.stringify(opts.body) : undefined,
      }).then(function (r) {
        return r.json().catch(function () { return {}; }).then(function (data) {
          if (!r.ok) throw new Error((data && (data.text || data.error)) || 'Request failed');
          return data;
        });
      });
    });
  }

  function when(iso) {
    var t = Date.parse(iso || '');
    if (!Number.isFinite(t)) return '';
    var diff = Math.round((Date.now() - t) / 1000);
    if (diff < 45) return 'just now';
    if (diff < 3600) return Math.round(diff / 60) + 'm ago';
    if (diff < 86400) return Math.round(diff / 3600) + 'h ago';
    if (diff < 7 * 86400) return Math.round(diff / 86400) + 'd ago';
    return new Date(t).toLocaleDateString();
  }

  function date(iso) {
    var t = Date.parse(iso || '');
    if (!Number.isFinite(t)) return '';
    return new Date(t).toLocaleString(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' });
  }

  function hour() {
    var h = new Date().getHours();
    return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
  }

  window.hub = { esc: esc, host: host, token: token, api: api, when: when, date: date, hour: hour };
})();
