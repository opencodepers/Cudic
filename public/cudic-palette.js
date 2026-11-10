/* file: public/cudic-palette.js
 * what: Ctrl/Cmd+K palette for the classic pages — page jumps plus live game, creator and forum search.
 * invariants: builds once and stays hidden until opened; result labels use textContent; API base falls back to Render when config.js is absent.
 * see: public/docs.html#palette, public/sidebar.js
 */
(function () {
  if (window.CudicPalette) return;

  var API = (typeof WS_URL !== 'undefined' && WS_URL)
    ? WS_URL.replace(/^wss?:\/\//, 'https://')
    : ((location.hostname === 'localhost' || location.hostname === '127.0.0.1') ? '' : 'https://glox-o7rr.onrender.com');
  var PAGES = [
    ['Games', '/games', 'G'], ['Studio', '/studio', 'S'], ['Update log', '/updlog', 'U'],
    ['Docs', '/docs', '?'], ['Themes', '/themes', 'T'], ['Shop', '/shop', '$'],
    ['Quests', '/quests', 'Q'], ['Friends', '/friends', 'F'], ['Notifications', '/notifications', 'N'],
    ['Profile', '/profile', 'P'], ['Race', '/race', 'R'], ['Servers', '/servers', 'V'],
    ['Forums', '/forums', 'D'], ['Chat', '/chat', 'C'], ['Music', '/music', 'M'],
    ['Collections', '/collections', 'L'], ['FAQ', '/faq', '?'], ['Home', '/', 'H']
  ];

  var overlay = null, input = null, list = null, status = null;
  var rows = [], active = -1, open = false, seq = 0, timer = 0, lastFocus = null;

  function node(tag, cls, text) {
    var el = document.createElement(tag);
    if (cls) el.className = cls;
    if (text != null) el.textContent = text;
    return el;
  }

  function injectStyle() {
    var s = document.createElement('style');
    s.textContent = [
      '.cp-overlay{position:fixed;inset:0;z-index:2147483200;display:flex;align-items:flex-start;justify-content:center;padding:12vh 16px 16px;background:rgba(8,10,14,.62);backdrop-filter:blur(3px)}',
      '.cp-overlay[hidden]{display:none}',
      '.cp-panel{width:min(680px,100%);max-height:min(72vh,640px);display:flex;flex-direction:column;background:var(--panel,#fff);color:var(--text-primary,#1b1b1f);border:1px solid var(--line,#d8d8e0);border-radius:14px;box-shadow:0 24px 80px rgba(0,0,0,.45);overflow:hidden;font-family:var(--font-body,system-ui,-apple-system,"Segoe UI",sans-serif)}',
      '.cp-head{display:flex;align-items:center;gap:10px;padding:14px 16px;border-bottom:1px solid var(--line,#d8d8e0)}',
      '.cp-head input{flex:1;min-width:0;border:0;outline:0;background:transparent;color:inherit;font:inherit;font-size:1.02rem}',
      '.cp-kbd{font:600 10px/1 ui-monospace,monospace;letter-spacing:.08em;text-transform:uppercase;color:var(--text-tertiary,#888);border:1px solid var(--line,#d8d8e0);border-radius:5px;padding:5px 7px;white-space:nowrap}',
      '.cp-list{overflow-y:auto;padding:6px}',
      '.cp-group{font:600 10px/1 ui-monospace,monospace;letter-spacing:.12em;text-transform:uppercase;color:var(--text-tertiary,#888);padding:10px 10px 5px}',
      '.cp-item{width:100%;display:flex;align-items:center;gap:10px;padding:9px 10px;border:0;border-radius:8px;background:transparent;color:inherit;text-align:left;cursor:pointer;font:inherit}',
      '.cp-item[aria-selected="true"]{background:var(--panel-raised,#ececf4)}',
      '.cp-ico{width:24px;height:24px;flex:none;display:grid;place-items:center;border:1px solid var(--line,#d8d8e0);border-radius:6px;font:700 10px/1 ui-monospace,monospace;color:var(--signal,#3a6b00)}',
      '.cp-main{min-width:0;flex:1}',
      '.cp-label{display:block;font-size:.9rem;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.cp-sub{display:block;font-size:.72rem;color:var(--text-secondary,#666);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.cp-status{padding:0 16px 8px;font-size:.72rem;color:var(--text-tertiary,#888);min-height:1.2em}',
      '.cp-foot{display:flex;gap:14px;padding:9px 16px;border-top:1px solid var(--line,#d8d8e0);font-size:.7rem;color:var(--text-tertiary,#888);flex-wrap:wrap}',
      '.cp-foot b{color:var(--text-primary,#1b1b1f);font-weight:600}',
      '@media (prefers-reduced-motion: no-preference){.cp-panel{animation:cpIn .12s ease-out}@keyframes cpIn{from{transform:translateY(-6px);opacity:.6}}}'
    ].join('');
    document.head.appendChild(s);
  }

  function build() {
    if (overlay) return;
    injectStyle();
    overlay = node('div', 'cp-overlay');
    overlay.hidden = true;
    var panel = node('div', 'cp-panel');
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-modal', 'true');
    panel.setAttribute('aria-label', 'Search Cudic');

    var head = node('div', 'cp-head');
    input = document.createElement('input');
    input.type = 'text';
    input.placeholder = 'Search games, creators, forums, pages…';
    input.setAttribute('aria-label', 'Search Cudic');
    input.setAttribute('aria-controls', 'cpList');
    input.autocomplete = 'off';
    input.spellcheck = false;
    head.appendChild(input);
    head.appendChild(node('span', 'cp-kbd', 'esc'));

    list = node('div', 'cp-list');
    list.id = 'cpList';
    list.setAttribute('role', 'listbox');
    status = node('div', 'cp-status');
    status.setAttribute('aria-live', 'polite');

    var foot = node('div', 'cp-foot');
    [['↑↓', 'Navigate'], ['↵', 'Open'], ['esc', 'Close']].forEach(function (h) {
      var item = document.createElement('span');
      item.appendChild(node('b', '', h[0]));
      item.appendChild(document.createTextNode(' ' + h[1]));
      foot.appendChild(item);
    });

    panel.append(head, list, status, foot);
    overlay.appendChild(panel);
    document.body.appendChild(overlay);
    overlay.addEventListener('mousedown', function (e) { if (e.target === overlay) close(); });
    input.addEventListener('input', refresh);
    input.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowDown') { e.preventDefault(); move(1); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); move(-1); }
      else if (e.key === 'Enter') { e.preventDefault(); choose(); }
      else if (e.key === 'Escape') { e.preventDefault(); close(); }
    });
    document.addEventListener('keydown', function (e) {
      var key = String(e.key || '').toLowerCase();
      if ((e.ctrlKey || e.metaKey) && key === 'k' && !e.altKey) {
        e.preventDefault();
        if (open) close(); else show();
      } else if (key === 'escape' && open) {
        e.preventDefault();
        close();
      }
    }, true);
  }

  function show() {
    build();
    lastFocus = document.activeElement;
    open = true;
    overlay.hidden = false;
    document.documentElement.style.overflow = 'hidden';
    input.value = '';
    refresh();
    setTimeout(function () { try { input.focus(); } catch (e) {} }, 0);
  }

  function close() {
    if (!overlay) return;
    open = false;
    overlay.hidden = true;
    document.documentElement.style.overflow = '';
    if (lastFocus && lastFocus.focus) { try { lastFocus.focus(); } catch (e) {} }
  }

  function move(step) {
    if (!rows.length) return;
    active = (active + step + rows.length) % rows.length;
    paintActive();
  }

  function paintActive() {
    var items = list.querySelectorAll('.cp-item');
    for (var i = 0; i < items.length; i++) {
      items[i].setAttribute('aria-selected', i === active ? 'true' : 'false');
    }
    if (items[active] && items[active].scrollIntoView) {
      try { items[active].scrollIntoView({ block: 'nearest' }); } catch (e) {}
    }
  }

  function choose() {
    var r = rows[active];
    if (!r) return;
    close();
    if (r.href) location.href = r.href;
  }

  function setRows(next, q, loading) {
    rows = next.slice(0, 30);
    active = rows.length ? 0 : -1;
    list.textContent = '';
    var lastGroup = '';
    rows.forEach(function (r, i) {
      if (r.group && r.group !== lastGroup) {
        lastGroup = r.group;
        list.appendChild(node('div', 'cp-group', r.group));
      }
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'cp-item';
      btn.setAttribute('role', 'option');
      btn.setAttribute('aria-selected', i === active ? 'true' : 'false');
      btn.appendChild(node('span', 'cp-ico', r.icon || '·'));
      var main = node('span', 'cp-main');
      main.appendChild(node('span', 'cp-label', r.label));
      if (r.sub) main.appendChild(node('span', 'cp-sub', r.sub));
      btn.appendChild(main);
      btn.addEventListener('mousemove', function () { active = i; paintActive(); });
      btn.addEventListener('click', function () { active = i; choose(); });
      list.appendChild(btn);
    });
    if (!rows.length) list.appendChild(node('div', 'cp-group', loading ? 'Searching…' : 'No matches'));
    status.textContent = loading
      ? 'Searching…'
      : (rows.length ? rows.length + ' result' + (rows.length === 1 ? '' : 's') : 'Try a game title, creator or page name.');
  }

  function pageItems(q) {
    var needle = q.toLowerCase();
    return PAGES.filter(function (p) {
      return !needle || p[0].toLowerCase().indexOf(needle) !== -1;
    }).map(function (p) {
      return { group: 'Pages', label: p[0], sub: p[1], href: p[1], icon: p[2] };
    });
  }

  function apiItems(d, q) {
    var out = [];
    ((d && d.games) || []).forEach(function (g) {
      out.push({ group: 'Games', label: g.title || 'Untitled', sub: (g.play_count || 0) + ' plays', href: '/view.html?id=' + encodeURIComponent(g.id), icon: 'G' });
    });
    ((d && d.people) || []).forEach(function (p) {
      out.push({ group: 'People', label: p.display_name || 'Player', sub: 'Creator profile', href: '/creator?id=' + encodeURIComponent(p.id), icon: 'P' });
    });
    ((d && d.threads) || []).forEach(function (t) {
      out.push({ group: 'Forums', label: t.title || 'Thread', sub: t.category || 'Forum thread', href: '/forums/' + encodeURIComponent(t.id), icon: 'F' });
    });
    out.push({ group: 'Search', label: 'Search games for “' + q + '”', sub: 'Open the gallery with this query', href: '/games?q=' + encodeURIComponent(q), icon: '→' });
    return out;
  }

  function refresh() {
    var q = input.value.trim();
    var pages = pageItems(q);
    clearTimeout(timer);
    if (q.length < 2) {
      seq++;
      setRows(pages, q, false);
      return;
    }
    var my = ++seq;
    setRows(pages, q, true);
    timer = setTimeout(function () {
      fetch(API + '/api/search?q=' + encodeURIComponent(q) + '&limit=6', { headers: { Accept: 'application/json' } })
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (d) {
          if (my === seq && open) setRows(pages.concat(apiItems(d, q)), q, false);
        })
        .catch(function () {
          if (my !== seq || !open) return;
          setRows(pages, q, false);
          status.textContent = 'Search is unavailable right now — page jumps still work.';
        });
    }, 150);
  }

  function ready() { build(); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', ready);
  else ready();

  window.CudicPalette = { open: show, close: close };
})();
