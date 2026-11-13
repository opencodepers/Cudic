/* file: public/funnel.js
 * what: five GTM funnel events so acquisition is measurable (page view, game view,
 *       play start, share click, signup start/complete).
 * why: the site loads GTM on every page but pushed no custom events, so there was no
 *      way to see where visitors stop.
 * invariants: no dependencies, no network calls, never throws (every block is guarded);
 *       event names are the contract documented in docs.html.
 * see: public/view.html, public/login.html, public/start.html, lib/arcade.js,
 *      tools/prerender-games.mjs */

(function () {
  window.dataLayer = window.dataLayer || [];
  function track(name, params) {
    try {
      var payload = params || {};
      payload.event = name;
      window.dataLayer.push(payload);
    } catch (e) {}
  }
  if (!window.cudicTrack) window.cudicTrack = track;

  var q = null;
  try { q = new URL(location.href).searchParams; } catch (e) {}
  var meta = document.querySelector('meta[name="cudic-game-id"]');
  var gameId = (q && q.get('id')) || (meta && meta.getAttribute('content')) || null;
  if (gameId && !/^[0-9a-z-]{3,64}$/i.test(gameId)) gameId = null;
  function withGame(extra) {
    var p = extra || {};
    if (gameId && !p.game_id) p.game_id = gameId;
    return p;
  }

  track('cudic_page_view', { page: location.pathname, referrer: document.referrer || '' });
  if (gameId) track('game_view', withGame({}));

  // play_start: any click that starts a game (player button, Play now, a card)
  document.addEventListener('click', function (e) {
    var el = e.target && e.target.closest ? e.target.closest('a.play, [data-play], #playBtn') : null;
    if (el) track('play_start', withGame({}));
  }, true);

  // share_click: the share kit on game pages and the player's own Share button
  document.addEventListener('click', function (e) {
    var el = e.target && e.target.closest ? e.target.closest('[data-share], #shareBtn') : null;
    if (el) track('share_click', withGame({ channel: el.getAttribute('data-share') || 'button' }));
  }, true);

  // signup_start: the create-account form actually being submitted
  document.addEventListener('submit', function (e) {
    var f = e.target;
    if (f && (f.id === 'formUp' || f.id === 'signupForm')) track('signup_start', { method: 'email' });
  }, true);

  // signup_complete: landing on the post-signup page with a Supabase session.
  // Storage key shape is sb-<project-ref>-auth-token, so this needs no config.
  try {
    var p = location.pathname.replace(/\.html$/, '');
    if (p === '/start' || p === '/welcome') {
      for (var i = 0; i < localStorage.length; i++) {
        var k = localStorage.key(i) || '';
        if (k.indexOf('sb-') === 0 && k.indexOf('-auth-token') > 0) {
          track('signup_complete', {});
          break;
        }
      }
    }
  } catch (e) {}
})();
