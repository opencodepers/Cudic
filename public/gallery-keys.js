// file: public/gallery-keys.js
// what: Keyboard browsing for /games — j/k or the arrow keys move a visible
//   selection through the cards, Enter opens the selected game, / jumps to the
//   search box, Escape drops the selection. The gallery is the first page a
//   keyboard user meets, and a card that cannot be reached without a mouse is a
//   game they cannot play.
// invariants: never steals a key while the person is typing (search, select,
//   textarea, contenteditable) and never traps focus — it only toggles a class,
//   so Tab order and screen-reader order stay exactly as they were.
// see: public/games.html (cardHtml adds tabindex), AGENTS.md 12.10
(function () {
  var grid = document.getElementById('gameGrid');
  if (!grid || window._galKeys) return;
  window._galKeys = true;
  var at = -1;

  // A polite live region so the selection is announced, not just outlined.
  var say = document.createElement('div');
  say.id = 'galKeysSay';
  say.setAttribute('aria-live', 'polite');
  say.style.cssText = 'position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap';
  document.body.appendChild(say);

  function cards() { return Array.prototype.slice.call(grid.querySelectorAll('.game-card')); }

  function typing(el) {
    if (!el) return false;
    var tag = (el.tagName || '').toLowerCase();
    return tag === 'input' || tag === 'textarea' || tag === 'select' || el.isContentEditable;
  }

  function inDialog() {
    return !!document.querySelector('.modal-overlay.open, dialog[open]');
  }

  function paint() {
    var list = cards();
    list.forEach(function (c, i) { c.classList.toggle('kb', i === at); });
    if (at >= 0 && list[at]) {
      list[at].scrollIntoView({ block: 'nearest' });
      var title = list[at].querySelector('.game-title');
      say.textContent = (title ? title.textContent : 'Game') + ', ' + (at + 1) + ' of ' + list.length;
    }
  }

  function move(step) {
    var list = cards();
    if (!list.length) return;
    at = at < 0 ? (step > 0 ? 0 : list.length - 1) : (at + step + list.length) % list.length;
    paint();
  }

  function openSelected() {
    var list = cards();
    if (at >= 0 && list[at]) list[at].click();
  }

  document.addEventListener('keydown', function (e) {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (typing(e.target)) {
      if (e.key === 'Escape') e.target.blur();
      return;
    }
    if (inDialog()) return;

    if (e.key === '/') {
      var box = document.getElementById('galSearch');
      if (!box) return;
      e.preventDefault();
      box.focus();
      if (box.select) box.select();
      return;
    }
    if (e.key === 'j' || e.key === 'ArrowDown') { e.preventDefault(); move(1); return; }
    if (e.key === 'k' || e.key === 'ArrowUp') { e.preventDefault(); move(-1); return; }
    if (e.key === 'Enter') {
      if (at >= 0) { e.preventDefault(); openSelected(); return; }
      // A card focused with Tab is still a card: Enter has to work on it too.
      if (e.target && e.target.classList && e.target.classList.contains('game-card')) {
        e.preventDefault();
        e.target.click();
      }
      return;
    }
    if (e.key === 'Escape') {
      at = -1;
      cards().forEach(function (c) { c.classList.remove('kb'); });
    }
  });

  // A repaint (search, sort, load more) can leave the index past the end.
  new MutationObserver(function () {
    var n = cards().length;
    if (at >= n) at = n - 1;
  }).observe(grid, { childList: true });
})();
