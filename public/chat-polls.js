/* file: public/chat-polls.js
 * what: inline polls for a DM on chat.html — create 2–10 options, one vote per
 *   account, live counts and a close action. Server channels keep their poll
 *   shelf on the server page; this file deliberately does nothing outside a DM.
 * invariants: the lobby id comes from the open conversation, the API checks
 *   conversation_members on every read and write, and the voter identity is
 *   never rendered. Every label is escaped; a failed request leaves the poll
 *   visible with an inline error instead of pretending it worked.
 * see: lib/routes/batch.js, public/chat.html, public/client.js.
 */
(function () {
  if (window.cudicChatPolls) return;
  var btn = document.getElementById('pollBtn');
  var shelf = document.getElementById('pollShelf');
  if (!btn || !shelf) return;

  var polls = [];
  var styleReady = false;

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function host() {
    return (typeof apiHost === 'function') ? apiHost()
      : ((typeof WS_URL !== 'undefined' && WS_URL) ? WS_URL.replace(/^wss?:\/\//, 'https://') : '');
  }
  function conv() { return window.current || null; }
  function isDM() { return !!(conv() && conv().kind === 'dm' && conv().id); }
  function token() { return (typeof TOKEN === 'string' && TOKEN) ? TOKEN : ''; }

  async function req(path, opts) {
    opts = opts || {};
    var headers = Object.assign({ Authorization: 'Bearer ' + token() }, opts.headers || {});
    if (opts.body) headers['Content-Type'] = 'application/json';
    var r = await fetch(host() + path, Object.assign({}, opts, { headers: headers }));
    var d = await r.json().catch(function () { return {}; });
    if (!r.ok) throw new Error(d.text || d.error || 'Request failed.');
    return d;
  }

  function addStyle() {
    if (styleReady) return;
    styleReady = true;
    var st = document.createElement('style');
    st.textContent = ''
      + '#pollShelf{padding:8px 20px 10px;border-bottom:1px solid var(--line);background:var(--panel);flex-shrink:0;max-height:240px;overflow-y:auto}'
      + '#pollShelf[hidden]{display:none}'
      + '.cp-title{font:600 .68rem/1.4 var(--font-mono,monospace);letter-spacing:.08em;text-transform:uppercase;color:var(--text-tertiary);margin-bottom:6px}'
      + '.cp-poll{border:1px solid var(--line);border-radius:8px;padding:9px 10px;margin-bottom:8px;background:var(--panel-raised)}'
      + '.cp-q{font-size:.85rem;font-weight:600;color:var(--text-primary)}'
      + '.cp-opts{display:flex;flex-direction:column;gap:5px;margin-top:7px}'
      + '.cp-opt{position:relative;display:flex;align-items:center;justify-content:space-between;gap:8px;border:1px solid var(--line);border-radius:6px;padding:5px 8px;background:var(--panel);color:var(--text-secondary);font:inherit;font-size:.8rem;cursor:pointer;overflow:hidden;text-align:left}'
      + '.cp-opt:hover{border-color:var(--signal);color:var(--text-primary)}'
      + '.cp-opt .fill{position:absolute;inset:0 auto 0 0;background:var(--signal-tint);z-index:0}'
      + '.cp-opt span,.cp-opt em{position:relative;z-index:1}'
      + '.cp-opt em{font-style:normal;color:var(--text-tertiary);font-size:.72rem}'
      + '.cp-opt.on{border-color:var(--signal)}'
      + '.cp-meta{font-size:.7rem;color:var(--text-tertiary);margin-top:6px;display:flex;gap:8px;align-items:center;flex-wrap:wrap}'
      + '.cp-meta button{border:0;background:none;color:var(--signal);font:inherit;font-size:.7rem;cursor:pointer;padding:0}'
      + '.cp-dialog{position:fixed;inset:0;z-index:9500;display:grid;place-items:center;background:rgba(0,0,0,.55);padding:20px}'
      + '.cp-card{width:min(440px,100%);background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:18px;max-height:90vh;overflow:auto}'
      + '.cp-card h2{font:600 1rem/1.3 var(--font-head);margin:0 0 10px}'
      + '.cp-input{width:100%;box-sizing:border-box;margin-bottom:6px;padding:8px;background:var(--panel-raised);border:1px solid var(--line);border-radius:6px;color:var(--text-primary);font:inherit;font-size:.84rem}'
      + '.cp-actions{display:flex;gap:8px;justify-content:flex-end;margin-top:10px}'
      + '.cp-actions button{padding:7px 12px;border:1px solid var(--line);border-radius:6px;background:var(--panel-raised);color:var(--text-primary);font:inherit;font-size:.8rem;cursor:pointer}'
      + '.cp-actions .primary{background:var(--signal);color:var(--on-signal,#fff);border-color:var(--signal)}'
      + '.cp-err{color:var(--danger);font-size:.78rem;margin:8px 0 0;min-height:1em}';
    document.head.appendChild(st);
  }

  function render() {
    if (!isDM() || !polls.length) { shelf.hidden = true; shelf.innerHTML = ''; return; }
    shelf.hidden = false;
    shelf.innerHTML = '<div class="cp-title">Polls</div>' + polls.map(function (poll) {
      return '<div class="cp-poll" data-poll="' + esc(poll.id) + '"><div class="cp-q">' + esc(poll.question)
        + (poll.anonymous ? ' <span style="font-size:.66rem;color:var(--text-tertiary)">anonymous</span>' : '')
        + '</div><div class="cp-opts">' + (poll.options || []).map(function (o, i) {
          var n = (poll.counts && poll.counts[i]) || 0;
          var pct = poll.total ? Math.round((n / poll.total) * 100) : 0;
          return '<button type="button" class="cp-opt' + (poll.mine === i ? ' on' : '') + '" data-cp-vote="' + i + '"' + (poll.closed ? ' disabled' : '') + '>'
            + '<span class="fill" style="width:' + pct + '%"></span><span>' + esc(o) + '</span><em>' + n + ' · ' + pct + '%</em></button>';
        }).join('') + '</div><div class="cp-meta"><span>' + poll.total + ' vote' + (poll.total === 1 ? '' : 's') + '</span>'
        + (poll.mine !== null ? '<span>You voted</span>' : '')
        + (!poll.closed ? '<button type="button" data-cp-close="1">Close poll</button>' : '<span>Closed</span>')
        + '</div></div>';
    }).join('');

    [].forEach.call(shelf.querySelectorAll('.cp-poll'), function (box) {
      var pid = box.getAttribute('data-poll');
      [].forEach.call(box.querySelectorAll('[data-cp-vote]'), function (vote) {
        vote.onclick = async function () {
          try {
            await req('/api/lobbies/' + encodeURIComponent(conv().id) + '/polls/' + encodeURIComponent(pid) + '/vote', {
              method: 'POST', body: JSON.stringify({ choice: parseInt(vote.getAttribute('data-cp-vote'), 10) }),
            });
            await load();
          } catch (e) { addSys(e.message); }
        };
      });
      var close = box.querySelector('[data-cp-close]');
      if (close) close.onclick = async function () {
        try {
          await req('/api/lobbies/' + encodeURIComponent(conv().id) + '/polls/' + encodeURIComponent(pid) + '/close', { method: 'POST' });
          await load();
        } catch (e) { addSys(e.message); }
      };
    });
  }

  function addSys(text) {
    if (typeof window.addSystemMessage === 'function') { try { window.addSystemMessage(text); return; } catch (e) {} }
    var d = document.createElement('div');
    d.className = 'system';
    d.textContent = text;
    var messages = document.getElementById('messages');
    if (messages) messages.appendChild(d);
  }

  async function load() {
    if (!isDM()) { polls = []; render(); return; }
    try {
      var d = await req('/api/lobbies/' + encodeURIComponent(conv().id) + '/polls');
      polls = d.polls || [];
    } catch (e) { polls = []; }
    render();
  }

  function closeDialog() {
    var old = document.getElementById('cpDialog');
    if (old) old.remove();
    document.removeEventListener('keydown', onKey);
  }
  function onKey(e) { if (e.key === 'Escape') closeDialog(); }

  function openDialog() {
    if (!isDM()) return;
    addStyle();
    closeDialog();
    var cid = conv().id;
    var d = document.createElement('div');
    d.id = 'cpDialog';
    d.className = 'cp-dialog';
    d.setAttribute('role', 'dialog');
    d.setAttribute('aria-modal', 'true');
    d.setAttribute('aria-labelledby', 'cpTitle');
    d.innerHTML = '<form class="cp-card"><div style="display:flex;justify-content:space-between;gap:10px;align-items:flex-start"><h2 id="cpTitle">Poll in this DM</h2><button type="button" id="cpX" style="border:0;background:none;color:var(--text-secondary);font:inherit;cursor:pointer">Close</button></div>'
      + '<input class="cp-input" id="cpQ" maxlength="160" placeholder="Question" aria-label="Poll question">'
      + '<div id="cpOpts"><input class="cp-input cp-option" maxlength="60" placeholder="Option 1" aria-label="Option 1"><input class="cp-input cp-option" maxlength="60" placeholder="Option 2" aria-label="Option 2"></div>'
      + '<button type="button" id="cpAdd" style="margin:2px 0 10px;padding:5px 9px;border:1px solid var(--line);border-radius:6px;background:var(--panel-raised);color:var(--text-secondary);font:inherit;font-size:.75rem;cursor:pointer">Add option</button>'
      + '<label style="display:flex;gap:6px;align-items:center;font-size:.8rem;color:var(--text-secondary)"><input type="checkbox" id="cpAnon"> Anonymous votes</label>'
      + '<div class="cp-actions"><button type="button" id="cpCancel">Cancel</button><button type="submit" class="primary">Create poll</button></div>'
      + '<p class="cp-err" id="cpErr" role="alert"></p></form>';
    document.body.appendChild(d);

    function count() { return d.querySelectorAll('.cp-option').length; }
    function syncAdd() {
      var add = document.getElementById('cpAdd');
      add.disabled = count() >= 10;
      add.textContent = count() >= 10 ? '10 options max' : 'Add option';
    }
    document.getElementById('cpAdd').onclick = function () {
      if (count() >= 10) return;
      var input = document.createElement('input');
      var n = count() + 1;
      input.className = 'cp-input cp-option';
      input.maxLength = 60;
      input.placeholder = 'Option ' + n;
      input.setAttribute('aria-label', 'Option ' + n);
      document.getElementById('cpOpts').appendChild(input);
      input.focus();
      syncAdd();
    };
    document.getElementById('cpX').onclick = closeDialog;
    document.getElementById('cpCancel').onclick = closeDialog;
    d.onclick = function (e) { if (e.target === d) closeDialog(); };
    document.addEventListener('keydown', onKey);
    d.querySelector('form').onsubmit = async function (ev) {
      ev.preventDefault();
      var opts = [].slice.call(d.querySelectorAll('.cp-option')).map(function (i) { return i.value.trim(); }).filter(Boolean);
      if (opts.length < 2) { document.getElementById('cpErr').textContent = 'Add at least two options.'; return; }
      try {
        await req('/api/lobbies/' + encodeURIComponent(cid) + '/polls', {
          method: 'POST',
          body: JSON.stringify({ question: document.getElementById('cpQ').value, options: opts, anonymous: document.getElementById('cpAnon').checked }),
        });
        closeDialog();
        await load();
        addSys('Poll posted.');
      } catch (e) { document.getElementById('cpErr').textContent = e.message; }
    };
    document.getElementById('cpQ').focus();
  }

  btn.onclick = openDialog;
  window.cudicChatPolls = {
    onConv: function () {
      btn.hidden = !isDM();
      if (!isDM()) { polls = []; render(); return; }
      load();
    },
  };
  if (isDM()) { addStyle(); load(); }
})();
