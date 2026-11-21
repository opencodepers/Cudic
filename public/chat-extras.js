/* file: public/chat-extras.js
 * what: The "Extras" panel on chat.html — custom status, read-receipt
 *   sharing, private notes, message reminders, personal DM pins, mutual
 *   interests and a quiet notification sound.
 * invariants: every write goes through the authenticated API; labels are
 *   textContent (never innerHTML from user data); the panel is additive and
 *   the chat shell keeps working when the migration has not run.
 */
(function () {
  if (window.cudicExtras) return;

  var panel = document.getElementById('extrasPanel');
  var openBtn = document.getElementById('extrasBtn');
  if (!panel || !openBtn) return;

  var peer = null;
  var openedAt = 0;
  var soundOn = false;
  try { soundOn = localStorage.getItem('cudic_sound') === '1'; } catch (e) {}

  function apiH() {
    return (typeof apiHost === 'function') ? apiHost()
      : ((typeof WS_URL !== 'undefined' && WS_URL) ? WS_URL.replace(/^wss?:\/\//, 'https://') : '');
  }

  function esc(s) {
    var d = document.createElement('div');
    d.textContent = (s == null ? '' : String(s));
    return d.innerHTML;
  }

  function msg(text, ok) {
    var el = document.getElementById('xStatusMsg');
    if (!el) return;
    el.textContent = text || '';
    el.style.color = ok ? 'var(--signal, #3a6b00)' : 'var(--danger, #b3261e)';
  }

  async function req(path, opts) {
    opts = opts || {};
    var headers = Object.assign({ 'Authorization': 'Bearer ' + TOKEN }, opts.headers || {});
    if (opts.body) headers['Content-Type'] = 'application/json';
    var r = await fetch(apiH() + path, Object.assign({}, opts, { headers: headers }));
    var d = await r.json().catch(function () { return {}; });
    if (!r.ok) throw new Error(d.text || d.error || 'Request failed.');
    return d;
  }

  function build() {
    panel.innerHTML =
      '<div style="display:flex;align-items:center;gap:8px;padding:10px 14px;border-bottom:1px solid var(--line)">' +
        '<b style="flex:1;font-size:0.9rem">Chat extras</b>' +
        '<button type="button" id="xClose" class="btn btn-secondary" style="padding:4px 10px" aria-label="Close extras"><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"/></svg></button>' +
      '</div>' +
      '<div style="padding:12px 14px;overflow-y:auto;max-height:min(60vh,520px);display:grid;gap:14px;font-size:0.82rem">' +
        '<section><h3 style="margin:0 0 6px;font-size:0.78rem;text-transform:uppercase;letter-spacing:.08em">Your status</h3>' +
          '<div style="display:flex;gap:6px;margin-bottom:6px">' +
            '<input id="xEmoji" maxlength="8" placeholder="🚀" aria-label="Status emoji" style="width:64px;padding:6px 8px;border:1px solid var(--line);border-radius:6px;background:var(--panel);color:inherit">' +
            '<input id="xText" maxlength="60" placeholder="building a tank game" aria-label="Status text" style="flex:1;min-width:0;padding:6px 8px;border:1px solid var(--line);border-radius:6px;background:var(--panel);color:inherit">' +
          '</div>' +
          '<label style="display:flex;align-items:center;gap:6px;margin:6px 0"><input type="checkbox" id="xReceipts"> Share read receipts</label>' +
          '<button type="button" id="xSaveStatus" class="btn btn-primary" style="padding:5px 10px">Save</button>' +
          '<div id="xStatusMsg" class="status-msg" style="min-height:1em"></div>' +
        '</section>' +
        '<section><h3 style="margin:0 0 6px;font-size:0.78rem;text-transform:uppercase;letter-spacing:.08em">This conversation</h3>' +
          '<div id="xPeer" style="color:var(--text-secondary);margin-bottom:4px"></div>' +
          '<div id="xMutual" style="color:var(--text-secondary);margin-bottom:6px"></div>' +
          '<div id="xNoteWrap"><textarea id="xNote" maxlength="1000" rows="3" placeholder="Private note about this person — only you can read it" style="width:100%;box-sizing:border-box;padding:7px 8px;border:1px solid var(--line);border-radius:6px;background:var(--panel);color:inherit;font:inherit"></textarea>' +
          '<button type="button" id="xSaveNote" class="btn btn-secondary" style="padding:5px 10px;margin-top:4px">Save note</button></div>' +
        '</section>' +
        '<section><h3 style="margin:0 0 6px;font-size:0.78rem;text-transform:uppercase;letter-spacing:.08em">Reminders</h3><div id="xReminders"></div></section>' +
        '<section><h3 style="margin:0 0 6px;font-size:0.78rem;text-transform:uppercase;letter-spacing:.08em">Personal pins</h3><div id="xPins"></div></section>' +
        '<section><h3 style="margin:0 0 6px;font-size:0.78rem;text-transform:uppercase;letter-spacing:.08em">Sound</h3>' +
          '<label style="display:flex;align-items:center;gap:6px"><input type="checkbox" id="xSound"> Play a soft sound for incoming messages</label>' +
        '</section>' +
      '</div>';
    panel.style.cssText = 'position:fixed;right:16px;top:70px;bottom:16px;width:min(380px,calc(100vw - 32px));z-index:2147483000;background:var(--panel,#fff);color:var(--text-primary,#1b1b1f);border:1px solid var(--line,#d8d8e0);border-radius:12px;box-shadow:0 18px 50px rgba(0,0,0,.35);display:none;flex-direction:column;overflow:hidden';
    panel.hidden = false;

    document.getElementById('xClose').onclick = function () { panel.style.display = 'none'; };
    document.getElementById('xSaveStatus').onclick = saveStatus;
    document.getElementById('xSaveNote').onclick = saveNote;
    var sound = document.getElementById('xSound');
    sound.checked = soundOn;
    sound.onchange = function () {
      soundOn = !!sound.checked;
      try { localStorage.setItem('cudic_sound', soundOn ? '1' : '0'); } catch (e) {}
      if (soundOn) beep();
    };
  }

  async function loadOwn() {
    try {
      var d = await req('/api/profile');
      var p = (d && d.profile) || {};
      document.getElementById('xEmoji').value = p.status_emoji || '';
      document.getElementById('xText').value = p.status_text || '';
      document.getElementById('xReceipts').checked = p.read_receipts !== false;
    } catch (e) {}
  }

  async function saveStatus() {
    var btn = document.getElementById('xSaveStatus');
    btn.disabled = true;
    msg('Saving…', true);
    try {
      await req('/api/profile', {
        method: 'PUT',
        body: JSON.stringify({
          status_emoji: document.getElementById('xEmoji').value,
          status_text: document.getElementById('xText').value,
          read_receipts: document.getElementById('xReceipts').checked,
        }),
      });
      msg('Saved.', true);
      if (current && current.kind === 'dm') applyPeerStatus();
    } catch (e) { msg(e.message || 'Could not save.', false); }
    btn.disabled = false;
  }

  async function loadConversation() {
    peer = current && current.kind === 'dm' ? (current.peer || null) : null;
    var noteWrap = document.getElementById('xNoteWrap');
    var note = document.getElementById('xNote');
    var peerEl = document.getElementById('xPeer');
    var mutualEl = document.getElementById('xMutual');
    note.value = '';
    peerEl.textContent = '';
    mutualEl.textContent = '';
    noteWrap.style.display = peer ? 'block' : 'none';
    if (!peer) {
      peerEl.textContent = current ? 'Private notes and personal pins are for DMs; reminders work anywhere.' : 'Open a conversation first.';
    }
    if (peer) {
      try {
        var n = await req('/api/extras/notes/' + encodeURIComponent(peer.id));
        note.value = n.note || '';
      } catch (e) {}
      try {
        var m = await req('/api/extras/mutual/' + encodeURIComponent(peer.id));
        if (m.status_emoji || m.status_text) peerEl.textContent = (m.status_emoji || '') + ' ' + (m.status_text || '');
        mutualEl.textContent = (m.shared && m.shared.length)
          ? 'You both like ' + m.shared.join(', ') + '.'
          : 'No shared interests listed yet.';
      } catch (e) {}
    }
    loadReminders();
    loadPins();
  }

  async function applyPeerStatus() {
    if (!peer) return;
    try {
      var m = await req('/api/extras/mutual/' + encodeURIComponent(peer.id));
      if (!m.status_emoji && !m.status_text) return;
      var base = (current && current.topic) ? current.topic + ' · ' : '';
      document.getElementById('chatTopic').textContent = base + (m.status_emoji || '') + ' ' + (m.status_text || '');
    } catch (e) {}
  }

  async function saveNote() {
    if (!peer) return;
    var b = document.getElementById('xSaveNote');
    b.disabled = true;
    try {
      await req('/api/extras/notes/' + encodeURIComponent(peer.id), {
        method: 'PUT',
        body: JSON.stringify({ note: document.getElementById('xNote').value }),
      });
      msg('Note saved.', true);
    } catch (e) { msg(e.message || 'Could not save the note.', false); }
    b.disabled = false;
  }

  async function loadReminders() {
    var box = document.getElementById('xReminders');
    try {
      var d = await req('/api/extras/reminders');
      var rows = d.reminders || [];
      if (!rows.length) { box.innerHTML = '<div style="color:var(--text-tertiary)">No reminders. Use <b>Remind</b> on any message.</div>'; return; }
      box.innerHTML = rows.map(function (r) {
        return '<div style="display:flex;gap:6px;align-items:flex-start;padding:4px 0;border-bottom:1px solid var(--line)">' +
          '<div style="flex:1;min-width:0"><div style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + esc(r.text || 'Reminder') + '</div>' +
          '<div style="font-size:0.72rem;color:var(--text-tertiary)">' + esc(new Date(r.remind_at).toLocaleString()) + (r.sent_at ? ' · sent' : '') + '</div></div>' +
          '<button type="button" class="x-del-rem" data-id="' + esc(r.id) + '" aria-label="Delete reminder" style="border:0;background:transparent;color:var(--text-tertiary);cursor:pointer"><svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"/></svg></button></div>';
      }).join('');
      box.querySelectorAll('.x-del-rem').forEach(function (b) {
        b.onclick = function () {
          req('/api/extras/reminders/' + encodeURIComponent(b.getAttribute('data-id')), { method: 'DELETE' })
            .then(loadReminders).catch(function () {});
        };
      });
    } catch (e) {
      box.innerHTML = '<div style="color:var(--text-tertiary)">Reminders need the chat-extras migration.</div>';
    }
  }

  async function loadPins() {
    var box = document.getElementById('xPins');
    if (!current || current.kind !== 'dm') { box.innerHTML = '<div style="color:var(--text-tertiary)">Personal pins are for DMs.</div>'; return; }
    try {
      var d = await req('/api/extras/pins?lobby=' + encodeURIComponent(current.name));
      var rows = d.pins || [];
      if (!rows.length) { box.innerHTML = '<div style="color:var(--text-tertiary)">No pins yet. Use <b>Keep</b> on a message.</div>'; return; }
      box.innerHTML = rows.map(function (p) {
        return '<div style="display:flex;gap:6px;align-items:flex-start;padding:4px 0;border-bottom:1px solid var(--line)">' +
          '<div style="flex:1;min-width:0"><div style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + esc(p.text || '') + '</div>' +
          '<div style="font-size:0.72rem;color:var(--text-tertiary)">' + esc(p.display_name || '') + ' · ' + esc(new Date(p.created_at).toLocaleString()) + '</div></div>' +
          '<button type="button" class="x-del-pin" data-id="' + esc(p.message_id) + '" aria-label="Unpin" style="border:0;background:transparent;color:var(--text-tertiary);cursor:pointer"><svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"/></svg></button></div>';
      }).join('');
      box.querySelectorAll('.x-del-pin').forEach(function (b) {
        b.onclick = function () {
          req('/api/extras/pins/' + encodeURIComponent(b.getAttribute('data-id')), { method: 'DELETE' })
            .then(loadPins).catch(function () {});
        };
      });
    } catch (e) {
      box.innerHTML = '<div style="color:var(--text-tertiary)">Pins need the chat-extras migration.</div>';
    }
  }

  function open() {
    if (!TOKEN) { setTimeout(open, 800); return; }
    panel.style.display = 'flex';
    loadOwn();
    loadConversation();
  }

  openBtn.onclick = function () {
    if (panel.style.display === 'none' || !panel.style.display) open();
    else panel.style.display = 'none';
  };

  // Message actions added by client.js: Remind and Keep.
  var msgHost = document.getElementById('messages');
  if (msgHost) {
    msgHost.addEventListener('click', function (e) {
      var rem = e.target.closest && e.target.closest('.msg-remind');
      if (rem) {
        var mins = prompt('Remind me in how many minutes?', '60');
        if (mins == null) return;
        var n = parseInt(mins, 10);
        if (!(n >= 1 && n <= 525600)) { alert('Pick between 1 minute and a year.'); return; }
        req('/api/extras/reminders', { method: 'POST', body: JSON.stringify({ messageId: rem.getAttribute('data-mid'), remindAt: new Date(Date.now() + n * 60000).toISOString() }) })
          .then(function () { if (typeof addSystemMessage === 'function') addSystemMessage('Reminder set for ' + n + ' minute' + (n === 1 ? '' : 's') + ' from now.'); loadReminders(); })
          .catch(function (err) { if (typeof addSystemMessage === 'function') addSystemMessage(err.message || 'Could not set the reminder.'); });
        return;
      }
      var keep = e.target.closest && e.target.closest('.msg-keep');
      if (keep) {
        req('/api/extras/pins', { method: 'POST', body: JSON.stringify({ messageId: keep.getAttribute('data-mid') }) })
          .then(function () { if (typeof addSystemMessage === 'function') addSystemMessage('Pinned for you.'); loadPins(); })
          .catch(function (err) { if (typeof addSystemMessage === 'function') addSystemMessage(err.message || 'Could not pin.'); });
      }
    });

    // Quiet incoming-message sound. History painted right after opening a
    // conversation is skipped by the 1.5s grace period.
    var seen = new WeakSet();
    try {
      new MutationObserver(function (list) {
        if (!soundOn) return;
        if (Date.now() - openedAt < 1500) return;
        for (var i = 0; i < list.length; i++) {
          for (var j = 0; j < list[i].addedNodes.length; j++) {
            var n = list[i].addedNodes[j];
            if (!n || n.nodeType !== 1 || !n.classList || !n.classList.contains('msg')) continue;
            if (n.classList.contains('mine') || seen.has(n)) continue;
            seen.add(n);
            beep();
            return;
          }
        }
      }).observe(msgHost, { childList: true });
    } catch (e) {}
  }

  function beep() {
    try {
      if (window.CudicCustomize) {
        var dm = false;
        try { dm = !!(window.current && window.current.kind === 'dm'); } catch (e) {}
        CudicCustomize.playSound(dm ? 'dm' : 'mention');
        return;
      }
      var Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return;
      var ctx = new Ctx();
      var o = ctx.createOscillator(), g = ctx.createGain();
      o.type = 'sine';
      o.frequency.value = 660;
      g.gain.value = 0.03;
      o.connect(g); g.connect(ctx.destination);
      o.start();
      g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.12);
      o.stop(ctx.currentTime + 0.13);
      setTimeout(function () { try { ctx.close(); } catch (e) {} }, 300);
    } catch (e) {}
  }

  function onConv(conv) {
    openedAt = Date.now();
    peer = conv && conv.kind === 'dm' ? (conv.peer || null) : null;
    applyPeerStatus();
    if (panel.style.display !== 'none' && panel.style.display) loadConversation();
  }

  build();
  window.cudicExtras = { onConv: onConv };
  try {
    if (new URLSearchParams(location.search).get('extras') === '1') open();
  } catch (e) {}
})();
