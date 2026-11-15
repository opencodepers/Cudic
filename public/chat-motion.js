/* file: public/chat-motion.js
 * what: Motion (motion.dev) for the chat page — messages and system lines rise
 *   in as they are painted, including history that arrives after boot.
 * invariants: classic script with a dynamic import, so node --check and older
 *   browsers are happy; skipped entirely under prefers-reduced-motion; the
 *   page works unchanged if the CDN is unreachable.
 */
(function () {
  var reduce = false;
  try { reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) {}
  if (reduce) {
    window.CudicMotion = { reduce: true };
    return;
  }

  import('https://cdn.jsdelivr.net/npm/motion@12/+esm').then(function (motion) {
    var animate = motion.animate;
    var stagger = motion.stagger;
    if (typeof animate !== 'function') return;

    // The right-click menu reads this and animates itself when present.
    window.CudicMotion = { animate: animate, stagger: stagger, reduce: false };

    var host = document.getElementById('messages');
    if (!host) return;

    var seen = new WeakSet();
    function isLine(el) {
      return el && el.nodeType === 1 && el.classList &&
        (el.classList.contains('msg') || el.classList.contains('system'));
    }
    function pop(el) {
      if (!isLine(el) || seen.has(el)) return;
      seen.add(el);
      try {
        animate(el, { opacity: [0, 1], y: [8, 0] }, {
          duration: 0.26,
          easing: [0.22, 1, 0.36, 1]
        });
      } catch (e) {}
    }

    var initial = host.querySelectorAll('.msg, .system');
    if (initial.length) {
      try {
        animate(initial, { opacity: [0, 1], y: [8, 0] }, {
          duration: 0.28,
          delay: stagger(0.015, { start: 0.03 }),
          easing: [0.22, 1, 0.36, 1]
        });
        for (var i = 0; i < initial.length; i++) seen.add(initial[i]);
      } catch (e) {}
    }

    try {
      new MutationObserver(function (mutations) {
        for (var m = 0; m < mutations.length; m++) {
          var added = mutations[m].addedNodes;
          for (var n = 0; n < added.length; n++) pop(added[n]);
        }
      }).observe(host, { childList: true });
    } catch (e) {}
  }).catch(function () {});
})();
