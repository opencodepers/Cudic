/* file: public/server-favourites.js
 * what: the favourite star on each directory card, plus a Favourites filter.
 *   Favourites are private to the account and survive re-renders of the grid.
 * invariants: the card's data-sid comes from the same row that built it; a
 *   failed read leaves the directory exactly as it was.
 */
(function () {
  var host = (typeof WS_URL !== 'undefined' && WS_URL) ? WS_URL.replace(/^wss?:\/\//, 'https://') : '';
  var token = null, favs = null, onlyFavs = false;
  function $(id) { return document.getElementById(id); }
  function authToken() {
    try {
      if (window.currentToken) return window.currentToken;
      if (window.getAuthToken) return window.getAuthToken();
      var raw = localStorage.getItem('sb-qgcydphkaujomxyzwcht-auth-token');
      return raw ? JSON.parse(raw).access_token : null;
    } catch (e) { return null; }
  }
  var style = document.createElement('style');
  style.textContent = '.server-card{position:relative}.srv-fav{position:absolute;top:10px;right:10px;z-index:3;width:28px;height:28px;padding:0;display:grid;place-items:center;border-radius:999px;border:1px solid var(--line);background:var(--panel);color:var(--text-tertiary);font-size:13px;line-height:1;cursor:pointer}'
    + '.srv-fav:hover{color:var(--signal);border-color:var(--signal)}.srv-fav.on{color:var(--signal);border-color:var(--signal);background:var(--signal-tint)}'
    + '.srv-favfilter{margin-left:6px}.srv-favfilter[aria-pressed="true"]{background:var(--signal-tint);border-color:var(--signal);color:var(--signal)}';
  document.head.appendChild(style);

  function decorate() {
    if (!favs) return;
    document.querySelectorAll('.server-card[data-sid]').forEach(function (card) {
      var sid = card.getAttribute('data-sid');
      var star = card.querySelector('.srv-fav');
      if (!star) {
        star = document.createElement('button');
        star.type = 'button';
        star.className = 'srv-fav';
        star.setAttribute('aria-label', 'Favourite this server');
        star.textContent = '★';
        star.onclick = function (ev) { ev.preventDefault(); ev.stopPropagation(); toggle(sid, star); };
        card.appendChild(star);
      }
      star.classList.toggle('on', favs.has(sid));
      star.setAttribute('aria-pressed', favs.has(sid) ? 'true' : 'false');
      card.hidden = onlyFavs && !favs.has(sid);
    });
    var chip = $('srvFavFilter');
    if (chip) chip.textContent = '★ Favourites (' + favs.size + ')';
  }

  async function toggle(sid, star) {
    if (!token) { location.href = '/login?next=' + encodeURIComponent('/servers'); return; }
    var on = favs.has(sid);
    try {
      var r = await fetch(host + '/api/servers/' + sid + '/favourite', {
        method: on ? 'DELETE' : 'POST',
        headers: { Authorization: 'Bearer ' + token },
      });
      if (!r.ok) return;
      if (on) favs.delete(sid); else favs.add(sid);
      decorate();
    } catch (e) {}
  }

  async function boot() {
    token = await authToken();
    if (!token) return;
    try {
      var r = await fetch(host + '/api/servers/favourites', { headers: { Authorization: 'Bearer ' + token } });
      if (!r.ok) return;
      var d = await r.json();
      favs = new Set(d.favourites || []);
    } catch (e) { return; }
    var tools = document.querySelector('.sec-head .srv-tools');
    if (tools && !$('srvFavFilter')) {
      var chip = document.createElement('button');
      chip.type = 'button';
      chip.id = 'srvFavFilter';
      chip.className = 'srv-favfilter';
      chip.setAttribute('aria-pressed', 'false');
      chip.textContent = '★ Favourites (' + favs.size + ')';
      chip.onclick = function () {
        onlyFavs = !onlyFavs;
        chip.setAttribute('aria-pressed', onlyFavs ? 'true' : 'false');
        decorate();
      };
      tools.appendChild(chip);
    }
    decorate();
    ['ownGrid', 'publicGrid'].forEach(function (id) {
      var el = $(id);
      if (!el) return;
      new MutationObserver(function () { decorate(); }).observe(el, { childList: true });
    });
    window.addEventListener('glox:auth', function () { boot(); });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
