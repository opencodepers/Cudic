/* Consent gate — one file, every page.
 *
 * Google Tag Manager used to load straight from the <head> of forty pages,
 * before anyone had a say: AdSense was behind the `cudic_consent` cookie, the
 * analytics container was not, and a visitor landing on /docs or /chat never
 * saw a banner at all. Two rules now:
 *
 *   1. GTM is injected by this file, and only after `cudic_consent` allows
 *      analytics or advertising. Under UK PECR / EU GDPR non-essential
 *      storage needs opt-in before it is touched, not after.
 *   2. The answer is a cookie every page can read, and `cudic-consent` on
 *      window tells every listener (this file, the landing page's AdSense
 *      loader) that it changed.
 *
 * Pages that ship their own bar (the landing page) mark it
 * `data-cudic-consent-bar`, so no second banner is injected on top of it.
 * Frames are skipped: the top document owns the decision.
 */
(function () {
  if (window.cudicConsent) return;
  var GTM_ID = 'GTM-PSGJNQWB';
  var COOKIE = 'cudic_consent';
  var BAR_ID = 'cudicConsentBar';

  function read() {
    try {
      var m = document.cookie.match(/(?:^|; )cudic_consent=([^;]*)/);
      return m ? JSON.parse(decodeURIComponent(m[1])) : null;
    } catch (e) { return null; }
  }
  function write(c) {
    try {
      document.cookie = COOKIE + '=' + encodeURIComponent(JSON.stringify(c)) +
        ';path=/;max-age=31536000;SameSite=Lax';
    } catch (e) {}
  }
  function allowed(c) { return !!(c && (c.analytics === true || c.advertising === true)); }

  function loadGtm() {
    if (window.__cudicGtm) return;
    window.__cudicGtm = true;
    window.dataLayer = window.dataLayer || [];
    if (typeof window.gtag !== 'function') {
      window.gtag = function () { window.dataLayer.push(arguments); };
    }
    try { window.gtag('js', new Date()); } catch (e) {}
    var s = document.createElement('script');
    s.async = true;
    s.src = 'https://www.googletagmanager.com/gtm.js?id=' + GTM_ID;
    document.head.appendChild(s);
  }

  // AdSense obeys the advertising flag specifically (analytics-only is not ad
  // consent), and the shared __cudicAds guard keeps the landing page's own
  // loader from injecting the tag twice.
  function loadAds() {
    if (window.__cudicAds) return;
    window.__cudicAds = true;
    var s = document.createElement('script');
    s.async = true;
    s.crossOrigin = 'anonymous';
    s.src = 'https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-9483499851682563';
    document.head.appendChild(s);
  }

  function apply(c) {
    if (!c) return;
    if (allowed(c)) loadGtm();
    if (c.advertising === true) loadAds();
  }

  function fire(c) {
    try { window.dispatchEvent(new CustomEvent('cudic-consent', { detail: c })); } catch (e) {}
  }

  function closeBar() {
    var bar = document.getElementById(BAR_ID);
    if (bar) bar.remove();
  }

  function choose(c) {
    write(c);
    closeBar();
    apply(c);
    fire(c);
  }

  function showBar() {
    if (read() || document.getElementById(BAR_ID)) return;
    if (document.querySelector('[data-cudic-consent-bar]')) return;
    if (window.top !== window.self) return;   // embeds and the game frame defer to the page
    if (!document.body) return;
    var bar = document.createElement('div');
    bar.id = BAR_ID;
    bar.setAttribute('role', 'dialog');
    bar.setAttribute('aria-label', 'Cookie choices');
    bar.style.cssText = 'position:fixed;left:0;right:0;bottom:0;z-index:2147483000;' +
      'background:var(--panel,#14161b);border-top:1px solid var(--line,#262a33);' +
      'color:var(--text-primary,#f7f5ec);font:400 13px/1.5 system-ui,sans-serif;padding:14px 18px';
    bar.innerHTML =
      '<div style="max-width:1100px;margin:0 auto;display:flex;gap:16px;align-items:center;flex-wrap:wrap">' +
        '<p style="margin:0;flex:1;min-width:240px;color:var(--text-secondary,#9a9a94)">' +
          'Cookies keep you signed in and remember your settings. Analytics and ads run only if you accept. ' +
          '<a href="/privacy" style="color:var(--signal,#b8f23a)">Privacy policy</a>.' +
        '</p>' +
        '<div style="display:flex;gap:8px">' +
          // Reject carries the same weight and size as Accept: PECR wants the
          // refusal as easy as the consent, not a grey link beside a big button.
          '<button type="button" id="cudicConsentReject" style="padding:8px 14px;border:1px solid var(--line,#262a33);' +
            'background:var(--panel-raised,#1e1b4d);color:inherit;cursor:pointer;font:500 12px ui-monospace,monospace;' +
            'letter-spacing:.06em;text-transform:uppercase;border-radius:6px">Reject all</button>' +
          '<button type="button" id="cudicConsentAccept" style="padding:8px 14px;border:1px solid var(--signal,#b8f23a);' +
            'background:var(--signal,#b8f23a);color:#0d0e10;cursor:pointer;font:500 12px ui-monospace,monospace;' +
            'letter-spacing:.06em;text-transform:uppercase;border-radius:6px">Accept all</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(bar);
    var no = document.getElementById('cudicConsentReject');
    var yes = document.getElementById('cudicConsentAccept');
    if (no) no.addEventListener('click', function () { choose({ advertising: false, analytics: false }); });
    if (yes) yes.addEventListener('click', function () { choose({ advertising: true, analytics: true }); });
  }

  window.cudicConsent = {
    get: read,
    allowed: function () { return allowed(read()); },
    set: choose,
    open: showBar
  };

  // A page that changes consent (the landing's own bar) only has to fire the
  // event; the cookie is the single source of truth, so re-read it.
  window.addEventListener('cudic-consent', function () { apply(read()); });

  function boot() {
    var c = read();
    if (c) apply(c);
    else showBar();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
