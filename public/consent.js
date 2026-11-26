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

  // Material 3 "bottom sheet" anatomy (handle, headline, supporting text,
  // filled + text actions), drawn with the brand sheet's parts: flat surfaces,
  // hairline borders, 3px corners, Geist, and the signal as the one accent.
  // Tokens come from the page, so ink/cream/lime pages and the orange brand
  // sheet both get their own palette without this file knowing either.
  var BAR_CSS = 'cudicConsentCss';
  var COOKIE_ICON =
    '<svg class="cc-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">' +
      '<path d="M12 2a10 10 0 1 0 10 10 4 4 0 0 1-5-5 4 4 0 0 1-5-5"/>' +
      '<path d="M8.5 8.5v.01M16 15.5v.01M12 12v.01M11 17v.01M7 14v.01"/>' +
    '</svg>';

  function barCss() {
    if (document.getElementById(BAR_CSS)) return;
    var st = document.createElement('style');
    st.id = BAR_CSS;
    st.textContent =
      '.cudic-consent{position:fixed;left:0;right:0;bottom:0;z-index:2147483000;' +
        'background:var(--panel,#14161b);color:var(--text-primary,#f7f5ec);' +
        'border-top:1px solid var(--line,#262a33);' +
        'font:400 13.5px/1.5 "Geist",system-ui,sans-serif;' +
        'padding:0 0 max(10px,env(safe-area-inset-bottom));' +
        'animation:cc-rise 240ms cubic-bezier(.2,0,0,1)}' +
      '@keyframes cc-rise{from{opacity:0;transform:translateY(12px)}}' +
      '.cudic-consent .cc-handle{width:32px;height:4px;margin:8px auto 0;border-radius:2px;' +
        'background:var(--line,#262a33)}' +
      '.cudic-consent .cc-inner{display:flex;align-items:center;gap:24px;flex-wrap:wrap;' +
        'max-width:1100px;margin:0 auto;padding:10px 24px 6px}' +
      '.cudic-consent .cc-head{display:flex;align-items:center;gap:12px;flex:1;min-width:260px}' +
      '.cudic-consent .cc-icon{flex:none;width:24px;height:24px;margin-top:2px;' +
        'color:var(--signal,#b8f23a);fill:none;stroke:currentColor;stroke-width:1.7;' +
        'stroke-linecap:round;stroke-linejoin:round}' +
      '.cudic-consent h2{margin:0 0 2px;font:600 16px/1.3 "Geist",system-ui,sans-serif;' +
        'letter-spacing:-.01em;color:inherit}' +
      '.cudic-consent p{margin:0;color:var(--text-secondary,#9a9a94);' +
        'font-size:13.5px;line-height:1.5}' +
      '.cudic-consent a{color:inherit;text-decoration:underline;text-underline-offset:2px}' +
      '.cudic-consent .cc-actions{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-left:auto}' +
      '.cudic-consent button{min-height:44px;padding:0 18px;border:1px solid var(--line,#262a33);' +
        'border-radius:3px;background:transparent;color:inherit;' +
        'font:500 13px/1 "Geist",system-ui,sans-serif;letter-spacing:.01em;cursor:pointer;' +
        'transition:background-color 120ms steps(4),border-color 120ms steps(4)}' +
      '.cudic-consent button:hover{background:rgba(127,127,127,.14)}' +
      '.cudic-consent button:active{background:rgba(127,127,127,.22)}' +
      '.cudic-consent button:focus-visible{outline:2px solid var(--signal,#b8f23a);outline-offset:2px}' +
      '.cudic-consent .cc-primary{border-color:var(--signal,#b8f23a);background:var(--signal,#b8f23a);' +
        'color:#0d0e10}' +
      '.cudic-consent .cc-primary:hover{background:color-mix(in srgb,var(--signal,#b8f23a) 88%,#0d0e10)}' +
      '.cudic-consent .cc-primary:active{background:color-mix(in srgb,var(--signal,#b8f23a) 80%,#0d0e10)}' +
      '.cudic-consent button[aria-pressed="true"]{box-shadow:inset 0 0 0 2px currentColor}' +
      '.cudic-consent .cc-close{border-color:transparent;color:var(--text-secondary,#9a9a94)}' +
      '@media (max-width:640px){' +
        '.cudic-consent .cc-inner{flex-direction:column;align-items:stretch;gap:12px;padding:8px 16px 4px}' +
        '.cudic-consent .cc-actions{margin:0;width:100%}' +
        '.cudic-consent .cc-actions button{flex:1 1 0;min-height:48px;padding:0 12px}}' +
      '@media (prefers-reduced-motion:reduce){' +
        '.cudic-consent{animation:none}.cudic-consent button{transition:none}}';
    document.head.appendChild(st);
  }

  function closeBar() {
    var bar = document.getElementById(BAR_ID);
    if (bar) bar.remove();
  }

  function choose(c) {
    var before = read();
    write(c);
    closeBar();
    apply(c);
    fire(c);
    // Nothing unloads a script that has already run, so switching ads off only
    // takes effect on a fresh page. Switching them on needs no reload — ads.js
    // and this file both listen for cudic-consent.
    if (before && before.advertising === true && c.advertising !== true &&
        (window.__cudicAds || window._cudicAds)) {
      try { window.location.reload(); } catch (e) {}
    }
  }

  function showBar(force) {
    // The landing page ships its own bar and marks it; never stack a second one.
    var own = document.querySelector('[data-cudic-consent-bar]');
    if (own) { if (force) own.style.display = 'block'; return; }
    var existing = document.getElementById(BAR_ID);
    if (existing) existing.remove();
    var saved = read();
    if (saved && !force) return;
    if (window.top !== window.self) return;   // embeds and the game frame defer to the page
    if (!document.body) return;
    barCss();
    var bar = document.createElement('div');
    bar.id = BAR_ID;
    bar.className = 'cudic-consent';
    bar.setAttribute('role', 'dialog');
    bar.setAttribute('aria-labelledby', 'cudicConsentTitle');
    bar.setAttribute('aria-describedby', 'cudicConsentBody');
    // Reopened from a page control: say what the answer is now, so opening it
    // is not a blind first choice. The current button carries the ring.
    var current = saved ? (saved.advertising === true ? 'accept' : 'reject') : '';
    bar.innerHTML =
      '<div class="cc-handle" aria-hidden="true"></div>' +
      '<div class="cc-inner">' +
        '<div class="cc-head">' +
          COOKIE_ICON +
          '<div>' +
            '<h2 id="cudicConsentTitle">Your cookie choice</h2>' +
            '<p id="cudicConsentBody">Cookies keep you signed in and remember your settings. ' +
              'Analytics and ads run only if you accept. ' +
              (saved ? 'Advertising is currently ' + (saved.advertising === true ? 'on' : 'off') + '. ' : '') +
              '<a href="/privacy">Privacy policy</a></p>' +
          '</div>' +
        '</div>' +
        '<div class="cc-actions">' +
          // Reject carries the same weight and size as Accept: PECR wants the
          // refusal as easy as the consent, not a grey link beside a big button.
          '<button type="button" id="cudicConsentReject" aria-pressed="' + (current === 'reject') + '">Reject all</button>' +
          '<button type="button" id="cudicConsentAccept" class="cc-primary" aria-pressed="' + (current === 'accept') + '">Accept all</button>' +
          (saved ? '<button type="button" id="cudicConsentClose" class="cc-close">Close</button>' : '') +
        '</div>' +
      '</div>';
    document.body.appendChild(bar);
    var no = document.getElementById('cudicConsentReject');
    var yes = document.getElementById('cudicConsentAccept');
    var closeBtn = document.getElementById('cudicConsentClose');
    if (no) no.addEventListener('click', function () { choose({ advertising: false, analytics: false }); });
    if (yes) yes.addEventListener('click', function () { choose({ advertising: true, analytics: true }); });
    if (closeBtn) closeBtn.addEventListener('click', closeBar);
  }

  // One control for the whole site: anything marked data-consent-settings opens
  // this bar again. The rail's cookie button and the privacy policy both use it.
  document.addEventListener('click', function (e) {
    var t = e.target && e.target.closest ? e.target.closest('[data-consent-settings]') : null;
    if (!t) return;
    e.preventDefault();
    showBar(true);
  });

  window.cudicConsent = {
    get: read,
    allowed: function () { return allowed(read()); },
    set: choose,
    open: function () { showBar(true); }
  };

  // A page that changes consent (the landing's own bar) only has to fire the
  // event; the cookie is the single source of truth, so re-read it.
  window.addEventListener('cudic-consent', function () { apply(read()); });

  function boot() {
    barCss();   // the landing page draws its own bar with the same classes
    var c = read();
    if (c) apply(c);
    else showBar();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
