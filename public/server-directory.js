/* file: public/server-directory.js
 * what: featured artwork and the next public event on each /servers card, read
 *   from one public-meta request and applied after the existing grid paints.
 * invariants: never replaces the card builder; only adds a cover image and a
 *   small event line. Missing metadata leaves the card exactly as it was.
 */
(function () {
  var host = (typeof WS_URL !== 'undefined' && WS_URL) ? WS_URL.replace(/^wss?:\/\//, 'https://') : '';
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  var st = document.createElement('style');
  st.textContent = '.srv-featured{display:block;width:100%;height:86px;object-fit:cover;border-bottom:1px solid var(--line)}'
    + '.srv-next{display:inline-flex;align-items:center;gap:5px;font-size:.66rem;color:var(--text-secondary);border:1px solid var(--line);border-radius:999px;padding:2px 8px;margin-top:6px}'
    + '.srv-next b{color:var(--signal);font-weight:600}';
  document.head.appendChild(st);
  fetch(host + '/api/servers/public-meta')
    .then(function (r) { return r.ok ? r.json() : null; })
    .then(function (d) {
      var meta = (d && d.meta) || {};
      function paint() {
        document.querySelectorAll('.server-card[data-sid]').forEach(function (card) {
          var sid = card.getAttribute('data-sid');
          var m = meta[sid];
          if (!m) return;
          if (m.featured && !card.querySelector('.srv-featured')) {
            var img = document.createElement('img');
            img.className = 'srv-featured'; img.src = m.featured; img.alt = ''; img.loading = 'lazy';
            img.onerror = function () { img.remove(); };
            card.insertBefore(img, card.firstChild);
          }
          if (m.next_event && !card.querySelector('.srv-next')) {
            var body = card.querySelector('.server-card-body') || card;
            var chip = document.createElement('span');
            chip.className = 'srv-next';
            chip.innerHTML = '<b>Next</b> ' + esc(m.next_event.title) + ' · ' + esc(new Date(m.next_event.starts_at).toLocaleDateString());
            body.appendChild(chip);
          }
        });
      }
      paint();
      // Cards are re-rendered on filter/sort; catch the next paint.
      var grid = document.getElementById('serverGrid') || document.body;
      new MutationObserver(paint).observe(grid, { childList: true, subtree: true });
    })
    .catch(function () {});
})();
