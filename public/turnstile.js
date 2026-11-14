// ── Bot check (Cloudflare Turnstile) ──────────────────────────────
// Shared by login (signup codes) and profile (account deletion). The
// server decides whether the gate exists: /api/turnstile returns
// {siteKey:''} when no keys are configured, and everything here becomes a
// no-op, so a keyless deploy behaves exactly as it did before.
//   CudicTurnstile.token(container) -> Promise<string>  ('' when inert)
//   CudicTurnstile.reset(container) -> void            (after use/expiry)
(function () {
  var siteKey = null, loading = null, widgets = {}, tokens = {}, waiters = {};

  function config() {
    if (siteKey !== null) return Promise.resolve(siteKey);
    return fetch('/api/turnstile', { cache: 'no-store' })
      .then(function (r) { return r.json(); })
      .then(function (d) { siteKey = (d && d.siteKey) || ''; return siteKey; })
      .catch(function () { siteKey = ''; return siteKey; });
  }

  function loadScript() {
    if (window.turnstile) return Promise.resolve();
    if (loading) return loading;
    loading = new Promise(function (res, rej) {
      var s = document.createElement('script');
      s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
      s.async = true; s.defer = true;
      s.onload = function () { res(); };
      s.onerror = function () { rej(new Error('turnstile unavailable')); };
      document.head.appendChild(s);
    });
    return loading;
  }

  function settle(el, value) {
    tokens[el.id] = value || '';
    var list = waiters[el.id] || [];
    waiters[el.id] = [];
    list.forEach(function (fn) { fn(tokens[el.id]); });
  }

  // One widget per container, rendered lazily on first use.
  function mount(el) {
    if (!el) return Promise.resolve(false);
    if (widgets[el.id] != null) return Promise.resolve(true);
    return config().then(function (key) {
      if (!key) { el.hidden = true; return false; }
      return loadScript().then(function () {
        if (widgets[el.id] != null) return true;
        widgets[el.id] = window.turnstile.render(el, {
          sitekey: key,
          appearance: 'interaction-only', // humans normally see nothing
          callback: function (t) { settle(el, t); },
          'expired-callback': function () { tokens[el.id] = ''; },
          'error-callback': function () { settle(el, ''); },
        });
        return true;
      }).catch(function () { el.hidden = true; return false; });
    });
  }

  function token(el) {
    return mount(el).then(function (ok) {
      if (!ok) return '';
      if (tokens[el.id]) return tokens[el.id];
      // A token is single-use: wait for the widget to hand us the next one.
      return new Promise(function (res) {
        waiters[el.id] = waiters[el.id] || [];
        waiters[el.id].push(res);
      });
    });
  }

  function reset(el) {
    if (!el || widgets[el.id] == null) return;
    tokens[el.id] = '';
    try { window.turnstile.reset(widgets[el.id]); } catch (e) {}
  }

  window.CudicTurnstile = { token: token, reset: reset, mount: mount };
})();
