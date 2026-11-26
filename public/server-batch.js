/* file: public/server-batch.js
 * what: the server-page side of the batch — bookmarks, game card, polls,
 *   answered Q&A shelf, announcement read-only state and the mod overview.
 * invariants: every write re-reads from the API; channel changes are pushed by
 *   server.html through cudicBatchChannel, never polled. Nothing here renders
 *   raw HTML from the API.
 */
(function () {
  var host = (typeof WS_URL !== 'undefined' && WS_URL) ? WS_URL.replace(/^wss?:\/\//, 'https://') : '';
  var TOKEN = null, SID = '', CH = [], POLLS = [], BOOKMARKS = [], Q = [];
  function page() { return window.cudicServerPage || null; }
  function $(id) { return document.getElementById(id); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function token() {
    try { if (window.getAuthToken) return window.getAuthToken(); } catch (e) {}
    try {
      var raw = localStorage.getItem('sb-qgcydphkaujomxyzwcht-auth-token');
      return raw ? (JSON.parse(raw).access_token || raw) : null;
    } catch (e) { return null; }
  }
  async function req(path, opts) {
    opts = opts || {};
    opts.headers = Object.assign({ Authorization: 'Bearer ' + TOKEN }, opts.headers || {});
    var r = await fetch(host + path, opts);
    var d = await r.json().catch(function () { return {}; });
    if (!r.ok) throw new Error(d.text || d.error || 'Request failed.');
    return d;
  }
  function sys(text) { var p = page(); if (p && p.addSys) p.addSys(text); }
  function bookmarkSvg(on) {
    return '<svg viewBox="0 0 24 24" width="15" height="15" fill="' + (on ? 'currentColor' : 'none') + '" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 3h12a1 1 0 0 1 1 1v17l-7-4-7 4V4a1 1 0 0 1 1-1Z"/></svg>';
  }

  function addStyle() {
    var st = document.createElement('style');
    st.textContent = ''
      + '.srv-gamecard{margin:8px 0 0;border:1px solid var(--line);border-radius:8px;padding:7px 9px;background:var(--panel-raised);font-size:.72rem;color:var(--text-secondary);display:flex;gap:8px;align-items:center;flex-wrap:wrap}'
      + '.srv-gamecard b{color:var(--text-primary);font-weight:600}'
      + '.srv-gamecard code{font-family:var(--font-mono,monospace);font-size:.72rem;color:var(--text-primary)}'
      + '.srv-gamecard button{border:1px solid var(--line);background:var(--panel);color:var(--text-secondary);border-radius:5px;font:inherit;font-size:.68rem;padding:2px 6px;cursor:pointer}'
      + '.srv-gamecard button:hover{color:var(--signal);border-color:var(--signal)}'
      + '#bookmarkBox{margin:2px 10px 6px;border:1px solid var(--line);border-radius:8px;padding:6px;background:var(--panel-raised)}'
      + '#bookmarkBox .bm-head{font:600 .62rem/1.3 var(--font-mono,monospace);letter-spacing:.09em;text-transform:uppercase;color:var(--text-tertiary);margin-bottom:4px}'
      + '#bookmarkBox button{display:flex;width:100%;gap:6px;align-items:center;border:0;background:none;color:var(--text-secondary);border-radius:5px;padding:4px 3px;font:inherit;font-size:.78rem;cursor:pointer;text-align:left}'
      + '#bookmarkBox button:hover{background:var(--panel);color:var(--text-primary)}'
      + '#batchPollShelf{padding:8px 20px 10px;border-bottom:1px solid var(--line);background:var(--panel);flex-shrink:0;max-height:240px;overflow-y:auto}'
      + '#batchPollShelf[hidden]{display:none}'
      + '.bp-title{font:600 .68rem/1.4 var(--font-mono,monospace);letter-spacing:.08em;text-transform:uppercase;color:var(--text-tertiary);margin-bottom:6px}'
      + '.bp-poll{border:1px solid var(--line);border-radius:8px;padding:9px 10px;margin-bottom:8px;background:var(--panel-raised)}'
      + '.bp-q{font-size:.85rem;font-weight:600;color:var(--text-primary)}'
      + '.bp-opts{display:flex;flex-direction:column;gap:5px;margin-top:7px}'
      + '.bp-opt{position:relative;display:flex;align-items:center;justify-content:space-between;gap:8px;border:1px solid var(--line);border-radius:6px;padding:5px 8px;background:var(--panel);color:var(--text-secondary);font:inherit;font-size:.8rem;cursor:pointer;overflow:hidden;text-align:left}'
      + '.bp-opt:hover{border-color:var(--signal);color:var(--text-primary)}'
      + '.bp-opt .fill{position:absolute;inset:0 auto 0 0;background:var(--signal-tint);z-index:0}'
      + '.bp-opt span,.bp-opt em{position:relative;z-index:1}'
      + '.bp-opt em{font-style:normal;color:var(--text-tertiary);font-size:.72rem}'
      + '.bp-opt.on{border-color:var(--signal)}'
      + '.bp-meta{font-size:.7rem;color:var(--text-tertiary);margin-top:6px;display:flex;gap:8px;align-items:center;flex-wrap:wrap}'
      + '.bp-meta button{border:0;background:none;color:var(--signal);font:inherit;font-size:.7rem;cursor:pointer;padding:0}'
      + '#qaShelf{padding:8px 20px;border-bottom:1px solid var(--line);background:var(--panel);flex-shrink:0;max-height:150px;overflow-y:auto}'
      + '#qaShelf[hidden]{display:none}'
      + '.qa-row{font-size:.78rem;color:var(--text-secondary);padding:3px 0;display:flex;gap:6px;align-items:baseline}'
      + '.qa-row b{color:var(--text-primary);font-weight:600;font-size:.72rem}'
      + '.qa-row span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}'
      + '.msg-answered{display:inline-flex;align-items:center;gap:4px;font-size:.66rem;color:var(--success);border:1px solid var(--line);border-radius:999px;padding:1px 7px;margin-left:6px}';
    document.head.appendChild(st);
  }

  function topButtons() {
    var bar = $('topbar');
    if (!bar || $('batchPollBtn')) return;
    var bm = document.createElement('button');
    bm.type = 'button'; bm.className = 'tools'; bm.id = 'batchBookmarkBtn';
    bm.innerHTML = bookmarkSvg(false); bm.title = 'Bookmark this channel';
    bm.setAttribute('aria-label', 'Bookmark this channel'); bm.setAttribute('aria-pressed', 'false');
    bm.onclick = toggleBookmark;
    bar.insertBefore(bm, $('srvHqBtn'));
    var p = page();
    if (p && (p.role === 'owner' || p.role === 'mod')) {
      var poll = document.createElement('button');
      poll.type = 'button'; poll.className = 'tools'; poll.id = 'batchPollBtn'; poll.textContent = 'Poll';
      poll.onclick = openPollDialog;
      bar.insertBefore(poll, $('srvHqBtn'));
      var mod = document.createElement('a');
      mod.className = 'tools'; mod.id = 'batchModBtn'; mod.href = '/moderate#servers'; mod.textContent = 'Mod';
      bar.insertBefore(mod, $('srvHqBtn'));
    }
  }

  async function loadGameCard() {
    if (!SID) return;
    try {
      var d = await req('/api/servers/' + SID + '/kit');
      var s = d.server || {}, game = (s.meta && s.meta.game) || {};
      var box = $('srvGameCard');
      if (!box) {
        box = document.createElement('div'); box.id = 'srvGameCard'; box.className = 'srv-gamecard';
        var head = document.querySelector('.srv-head');
        if (head) head.appendChild(box);
      }
      if (!game.address && !game.note) { box.hidden = true; return; }
      box.hidden = false;
      box.replaceChildren()
        + (game.address ? '<b>Game</b><code>' + esc(game.address) + '</code><button type="button" id="copyGameAddr">Copy</button>' : '')
        + (game.note ? '<span>' + esc(game.note) + '</span>' : '');
      var copy = $('copyGameAddr');
      if (copy) copy.onclick = function () {
        if (navigator.clipboard) navigator.clipboard.writeText(game.address).then(function () { copy.textContent = 'Copied'; setTimeout(function () { copy.textContent = 'Copy'; }, 1200); });
      };
      Q = Array.isArray(s.join_questions) ? s.join_questions : [];
    } catch (e) {}
  }

  async function loadBookmarks() {
    try {
      var d = await req('/api/servers/' + SID + '/bookmarks');
      BOOKMARKS = d.bookmarks || [];
    } catch (e) { BOOKMARKS = []; }
    renderBookmarks();
    syncBookmarkStar();
  }
  function renderBookmarks() {
    var rows = BOOKMARKS.slice(0, 8);
    var box = $('bookmarkBox');
    if (!rows.length) { if (box) box.remove(); return; }
    if (!box) {
      box = document.createElement('div'); box.id = 'bookmarkBox';
      var list = $('chanList');
      if (list && list.parentNode) list.parentNode.insertBefore(box, list);
      else return;
    }
    var p = page();
    box.innerHTML = '<div class="bm-head">Bookmarks</div>' + rows.map(function (b) {
      var kind = b.type === 'announcement' ? 'ANN' : b.type === 'qa' ? 'Q&amp;A' : 'CH';
      return '<button type="button" data-bm="' + esc(b.id) + '"><span style="color:var(--text-tertiary);font:600 .58rem/1 var(--font-mono,monospace);letter-spacing:.05em">' + kind + '</span>' + esc(b.display) + '</button>';
    }).join('');
    [].forEach.call(box.querySelectorAll('[data-bm]'), function (btn) {
      btn.onclick = function () {
        var ch = (p && p.channels || []).find(function (c) { return c.id === btn.getAttribute('data-bm'); });
        if (ch) { var prow = document.querySelector('.chan-row[data-cid="' + ch.id + '"]'); if (prow) prow.click(); }
      };
    });
  }
  function syncBookmarkStar() {
    var b = $('batchBookmarkBtn'); var p = page(); var cur = p && p.current;
    if (!b || !cur) return;
    var on = BOOKMARKS.some(function (x) { return x.id === cur.id; });
    b.innerHTML = bookmarkSvg(on);
    b.classList.toggle('on', on);
    b.title = on ? 'Remove bookmark' : 'Bookmark this channel';
    b.setAttribute('aria-label', b.title);
    b.setAttribute('aria-pressed', String(on));
  }
  async function toggleBookmark() {
    var p = page(); var cur = p && p.current;
    if (!cur) return;
    var on = BOOKMARKS.some(function (x) { return x.id === cur.id; });
    try {
      if (on) await req('/api/servers/' + SID + '/bookmarks?lobbyId=' + encodeURIComponent(cur.id), { method: 'DELETE' });
      else await req('/api/servers/' + SID + '/bookmarks', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ lobbyId: cur.id }) });
      await loadBookmarks();
      sys(on ? 'Bookmark removed.' : 'Channel bookmarked.');
    } catch (e) { sys(e.message); }
  }

  // ── Polls ────────────────────────────────────────────────────
  async function loadPolls() {
    var p = page(); var cur = p && p.current;
    var el = $('batchPollShelf');
    if (!el) {
      el = document.createElement('div'); el.id = 'batchPollShelf'; el.hidden = true;
      var msgs = $('messages');
      if (msgs && msgs.parentNode) msgs.parentNode.insertBefore(el, msgs);
      else return;
    }
    if (!cur) { el.hidden = true; return; }
    try { var d = await req('/api/servers/' + SID + '/polls?lobby=' + encodeURIComponent(cur.name)); POLLS = d.polls || []; }
    catch (e) { POLLS = []; }
    if (!POLLS.length) { el.hidden = true; el.replaceChildren(); return; }
    el.hidden = false;
    el.innerHTML = '<div class="bp-title">Polls</div>' + POLLS.map(function (poll) {
      var closed = poll.closed;
      return '<div class="bp-poll" data-poll="' + esc(poll.id) + '"><div class="bp-q">' + esc(poll.question) + (poll.anonymous ? ' <span style="font-size:.66rem;color:var(--text-tertiary)">anonymous</span>' : '') + '</div>'
        + '<div class="bp-opts">' + (poll.options || []).map(function (o, i) {
          var n = (poll.counts && poll.counts[i]) || 0;
          var pct = poll.total ? Math.round((n / poll.total) * 100) : 0;
          return '<button type="button" class="bp-opt' + (poll.mine === i ? ' on' : '') + '" data-vote="' + i + '"' + (closed ? ' disabled' : '') + '>'
            + '<span class="fill" style="width:' + pct + '%"></span><span>' + esc(o) + '</span><em>' + n + ' · ' + pct + '%</em></button>';
        }).join('') + '</div>'
        + '<div class="bp-meta"><span>' + poll.total + ' vote' + (poll.total === 1 ? '' : 's') + '</span>'
        + (poll.closes_at ? '<span>' + (closed ? 'Closed' : 'Closes ' + esc(new Date(poll.closes_at).toLocaleString())) + '</span>' : '')
        + (poll.mine !== null ? '<span>You voted</span>' : '')
        + (!closed && page() && (page().role === 'owner' || page().role === 'mod') ? '<button type="button" data-close="1">Close poll</button>' : '') + '</div></div>';
    }).join('');
    [].forEach.call(el.querySelectorAll('.bp-poll'), function (box) {
      var pid = box.getAttribute('data-poll');
      [].forEach.call(box.querySelectorAll('[data-vote]'), function (btn) {
        btn.onclick = async function () {
          try {
            await req('/api/servers/' + SID + '/polls/' + pid + '/vote', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ choice: parseInt(btn.getAttribute('data-vote'), 10) }) });
            loadPolls();
          } catch (e) { sys(e.message); }
        };
      });
      var close = box.querySelector('[data-close]');
      if (close) close.onclick = async function () {
        try { await req('/api/servers/' + SID + '/polls/' + pid + '/close', { method: 'POST' }); loadPolls(); }
        catch (e) { sys(e.message); }
      };
    });
    syncBookmarkStar();
  }
  function closePollDialog() {
    var d = $('pollDialog');
    if (!d) return;
    d.remove();
    document.removeEventListener('keydown', pollDialogKey);
  }
  function pollDialogKey(e) { if (e.key === 'Escape') closePollDialog(); }
  function openPollDialog() {
    var p = page(); var cur = p && p.current;
    if (!cur) return;
    closePollDialog();
    var d = document.createElement('div');
    d.id = 'pollDialog';
    d.style.cssText = 'position:fixed;inset:0;z-index:9500;display:grid;place-items:center;background:rgba(0,0,0,.55);padding:20px';
    d.setAttribute('role', 'dialog'); d.setAttribute('aria-modal', 'true');
    d.setAttribute('aria-labelledby', 'pollDialogTitle');
    var inputStyle = 'width:100%;box-sizing:border-box;margin-bottom:6px;padding:8px;background:var(--panel-raised);border:1px solid var(--line);border-radius:6px;color:var(--text-primary);font:inherit;font-size:.84rem';
    d.innerHTML = '<form style="width:min(440px,100%);background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:18px;max-height:90vh;overflow:auto">'
      + '<div style="display:flex;align-items:flex-start;justify-content:space-between;gap:10px;margin-bottom:10px"><h2 id="pollDialogTitle" style="font:600 1rem/1.3 var(--font-head);margin:0">Poll in #' + esc(cur.display) + '</h2><button type="button" id="pollX" aria-label="Close poll dialog" style="background:none;border:0;color:var(--text-secondary);cursor:pointer;font:inherit;font-size:1.1rem;line-height:1">Close</button></div>'
      + '<input id="pollQ" maxlength="160" placeholder="Question" aria-label="Poll question" style="' + inputStyle + '">'
      + '<div id="pollOpts"><input class="pollO" maxlength="60" placeholder="Option 1" aria-label="Option 1" style="' + inputStyle + '"><input class="pollO" maxlength="60" placeholder="Option 2" aria-label="Option 2" style="' + inputStyle + '"></div>'
      + '<button type="button" id="pollAddOpt" style="margin:2px 0 10px;padding:5px 9px;border:1px solid var(--line);border-radius:6px;background:var(--panel-raised);color:var(--text-secondary);font:inherit;font-size:.75rem;cursor:pointer">Add option</button>'
      + '<label style="display:flex;gap:6px;align-items:center;font-size:.8rem;color:var(--text-secondary);margin-bottom:12px"><input type="checkbox" id="pollAnon"> Anonymous votes</label>'
      + '<div style="display:flex;gap:8px;justify-content:flex-end"><button type="button" id="pollCancel" style="padding:7px 12px;border:1px solid var(--line);border-radius:6px;background:transparent;color:var(--text-primary);font:inherit;font-size:.8rem;cursor:pointer">Cancel</button><button type="submit" class="btn-send">Create poll</button></div>'
      + '<p id="pollErr" role="alert" style="color:var(--danger);font-size:.78rem;margin:8px 0 0"></p></form>';
    document.body.appendChild(d);
    function optionCount() { return d.querySelectorAll('.pollO').length; }
    function syncAdd() {
      var add = $('pollAddOpt');
      add.disabled = optionCount() >= 10;
      add.textContent = optionCount() >= 10 ? '10 options max' : 'Add option';
    }
    $('pollAddOpt').onclick = function () {
      if (optionCount() >= 10) return;
      var input = document.createElement('input');
      var n = optionCount() + 1;
      input.className = 'pollO'; input.maxLength = 60;
      input.placeholder = 'Option ' + n; input.setAttribute('aria-label', 'Option ' + n);
      input.style.cssText = inputStyle;
      $('pollOpts').appendChild(input); input.focus(); syncAdd();
    };
    $('pollX').onclick = closePollDialog;
    $('pollCancel').onclick = closePollDialog;
    d.onclick = function (e) { if (e.target === d) closePollDialog(); };
    document.addEventListener('keydown', pollDialogKey);
    d.querySelector('form').onsubmit = async function (ev) {
      ev.preventDefault();
      var opts = [].slice.call(d.querySelectorAll('.pollO')).map(function (i) { return i.value.trim(); }).filter(Boolean);
      if (opts.length < 2) { $('pollErr').textContent = 'Add at least two options.'; return; }
      try {
        await req('/api/servers/' + SID + '/polls', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ lobbyId: cur.id, question: $('pollQ').value, options: opts, anonymous: $('pollAnon').checked }),
        });
        closePollDialog(); loadPolls(); sys('Poll posted.');
      } catch (e) { $('pollErr').textContent = e.message; }
    };
    $('pollQ').focus();
  }

  // ── Answered Q&A ────────────────────────────────────────────
  async function loadAnswered() {
    var p = page(); var cur = p && p.current;
    var el = $('qaShelf');
    if (!el) {
      el = document.createElement('div'); el.id = 'qaShelf'; el.hidden = true;
      var msgs = $('messages');
      if (msgs && msgs.parentNode) msgs.parentNode.insertBefore(el, msgs);
      else return;
    }
    if (!cur || cur.type !== 'qa') { el.hidden = true; el.replaceChildren(); return; }
    try {
      var d = await req('/api/servers/' + SID + '/answered?lobby=' + encodeURIComponent(cur.name));
      var rows = d.answered || [];
      if (!rows.length) { el.hidden = true; el.replaceChildren(); return; }
      el.hidden = false;
      el.innerHTML = '<div class="bp-title">Answered</div>' + rows.map(function (r) {
        return '<div class="qa-row"><b><svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="vertical-align:-2px"><path d="M20 6 9 17l-5-5"/></svg> ' + esc(r.display_name || '?') + '</b><span>' + esc(String(r.text || '').replace(/\s+/g, ' ').slice(0, 140)) + '</span></div>';
      }).join('');
    } catch (e) { el.hidden = true; }
  }
  window.cudicToggleAnswer = async function (mid, on, btn) {
    try {
      await req('/api/servers/' + SID + '/questions/' + mid + '/answer', { method: on ? 'DELETE' : 'POST' });
      loadAnswered();
      sys(on ? 'Unmarked as answered.' : 'Marked as answered.');
    } catch (e) { sys(e.message); }
  };

  // ── Channel change hook (called by server.html) ─────────────
  window.cudicBatchChannel = function (ch) {
    if (!ch) return;
    loadPolls();
    loadAnswered();
    syncBookmarkStar();
    var form = $('chatForm'), input = $('msgInput');
    var p = page();
    var locked = ch.type === 'announcement' && p && p.role !== 'owner' && p.role !== 'mod';
    if (form && input) {
      form.hidden = !!locked;
      if (locked) {
        var note = $('slowNote');
        if (note) { note.style.display = 'block'; note.textContent = 'Announcement channel — only the owner and mods post here.'; }
      }
    }
    var title = $('chanTitle');
    if (title && ch.type === 'announcement') title.textContent = 'Announcements: ' + ch.display;
    if (title && ch.type === 'qa') title.textContent = 'Questions: ' + ch.display;
  };

  async function boot() {
    TOKEN = await token();
    var p = page();
    SID = (p && p.sid) || (location.pathname.match(/^\/server\/([A-Za-z0-9-]{6,50})$/) || [])[1] || '';
    if (!TOKEN || !SID) return;
    addStyle();
    // server.html boots asynchronously; wait for its getters to have a server.
    var tries = 0;
    (function wait() {
      var pp = page();
      if (!pp || !pp.channels || !pp.channels.length) {
        if (tries++ < 40) return setTimeout(wait, 250);
        return;
      }
      topButtons();
      if (pp.current) window.cudicBatchChannel(pp.current);
      loadBookmarks();
      loadGameCard();
      setTimeout(loadPolls, 400);
    })();
  }
  boot();
})();
