// ── Cudic ads ─────────────────────────────────────────────
// The `.ad-frame` slots are AdSense-only on the landing page.
// Gallery and docs carry three self-hosted network zones. No
// ad-network script runs before the visitor allows advertising
// in the shared consent bar, so this file — not the markup — is
// the only injector. A zone declares itself with data-ad-key
// (banner) or data-ad-script (native); until consent it stays
// hidden instead of leaving a hole. Slots that never fill
// collapse, so an ad-blocked visitor sees no gap.
(function () {
  if (window._cudicAds) return;
  window._cudicAds = true;

  var NETWORK = 'https://bellnewyork.org/';

  function consent() {
    try {
      var m = document.cookie.match(/(?:^|; )cudic_consent=([^;]*)/);
      return m ? JSON.parse(decodeURIComponent(m[1])) : null;
    } catch (e) { return null; }
  }

  function zones() {
    return Array.prototype.slice.call(document.querySelectorAll('[data-ad-key],[data-ad-script]'));
  }

  function inject(el) {
    if (!el || el.dataset.adLoaded === '1') return;
    var src = el.getAttribute('data-ad-script');
    if (!src) {
      var key = el.getAttribute('data-ad-key');
      if (!key) return;
      src = NETWORK + '22/' + key;
      window.atOptions = {
        key: key,
        format: el.getAttribute('data-ad-format') || 'iframe',
        height: Number(el.getAttribute('data-ad-height')) || 90,
        width: Number(el.getAttribute('data-ad-width')) || 728,
        params: {}
      };
    }
    el.dataset.adLoaded = '1';
    el.classList.remove('ad-empty');
    el.style.display = '';
    var s = document.createElement('script');
    s.async = true;
    s.src = src;
    el.appendChild(s);
  }

  function arm() {
    var allowed = (consent() || {}).advertising === true;
    zones().forEach(function (el) {
      if (allowed) inject(el);
      else if (el.dataset.adLoaded !== '1' && el.dataset.adArmed !== '1') {
        el.dataset.adArmed = '1';
        el.style.display = 'none';
      }
    });
  }

  function collapse() {
    try {
      document.querySelectorAll('.ad-frame:not(.ad-empty),#studioAd:not(.ad-empty)').forEach(function (el) {
        if (!el.querySelector('iframe')) el.classList.add('ad-empty');
      });
    } catch (e) {}
  }

  window.addEventListener('cudic-consent', arm);

  function init() {
    arm();
    // No early pass: slow fills must never be mistaken for blocked
    // slots (a collapsed slot can't earn). Two late passes catch
    // blockers, domain-locks and dead networks instead.
    setTimeout(collapse, 5000);
    setTimeout(collapse, 15000);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
