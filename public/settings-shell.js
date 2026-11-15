/* file: public/settings-shell.js
 * what: Turns a .czx block into Discord-style settings — left nav, one visible
 *   pane, and a sticky unsaved-changes bar whose Save clicks the pane's primary
 *   button.
 * invariants: markup owns the panes and the buttons; this file only switches
 *   and shows/hides. No data is saved here.
 */
(function () {
  var root = document.querySelector('.czx');
  if (!root) return;
  var panes = [].slice.call(root.querySelectorAll('.czx-pane'));
  var items = [].slice.call(root.querySelectorAll('.czx-item'));
  var footer = root.querySelector('.czx-footer');
  if (!panes.length) return;

  function show(name) {
    var ok = panes.some(function (p) { return p.dataset.pane === name; });
    if (!ok) name = panes[0].dataset.pane;
    panes.forEach(function (p) { p.classList.toggle('on', p.dataset.pane === name); });
    items.forEach(function (b) { b.classList.toggle('on', b.dataset.pane === name); });
    if (footer) footer.classList.remove('show');
    try { history.replaceState(null, '', '#' + name); } catch (e) {}
  }

  items.forEach(function (b) {
    b.addEventListener('click', function () { show(b.dataset.pane); });
  });
  ['input', 'change'].forEach(function (ev) {
    root.addEventListener(ev, function (e) {
      if (footer && e.target.closest && e.target.closest('.czx-pane')) footer.classList.add('show');
    });
  });
  root.addEventListener('click', function (e) {
    if (e.target.closest('[data-czx-save]')) {
      var pane = root.querySelector('.czx-pane.on');
      var btn = pane && pane.querySelector('button.primary');
      if (btn) btn.click();
      if (footer) footer.classList.remove('show');
    } else if (e.target.closest('[data-czx-reset]')) {
      location.reload();
    }
  });

  show((location.hash || '').replace('#', ''));
})();
