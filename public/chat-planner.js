/* file: public/chat-planner.js
 * what: Additive Plan panel — schedule a message/announcement, create and
 *   browse private message collections, edit an own message and read its
 *   history. No existing chat markup is replaced.
 * invariants: schedules are cancelled by their owner; collections snapshot
 *   text; edit/history calls are author- and room-gated by the server.
 */
(function () {
  var panel = null, token = null, open = false, cols = [], items = [];
  var openCol = null;
  function cur() { return window.current || null; }
  function apiHost() { return (typeof WS_URL !== 'undefined' && WS_URL) ? WS_URL.replace(/^wss?:\/\//, 'https://') : ''; }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  async function getToken() {
    try {
      if (window.getAuthToken) return await window.getAuthToken();
      var raw = localStorage.getItem('sb-qgcydphkaujomxyzwcht-auth-token');
      if (!raw) return null;
      var s = JSON.parse(raw);
      return (s && s.access_token) || raw || null;
    } catch (e) { return null; }
  }
  async function req(path, opts) {
    opts = opts || {};
    opts.headers = Object.assign({ 'Authorization': 'Bearer ' + token }, opts.headers || {});
    var r = await fetch(apiHost() + path, opts);
    var d = await r.json().catch(function () { return {}; });
    if (!r.ok) throw new Error((d && d.text) || (d && d.error) || 'Request failed.');
    return d;
  }
  function say(text) { if (typeof window.addSystemMessage === 'function') window.addSystemMessage(text); }

  function render() {
    if (!panel) return;
    var c = cur();
    var server = c && c.kind !== 'dm' && c.server_id;
    var html = '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">'
      + '<b style="font-family:var(--font-head);font-size:0.9rem">Plan</b>'
      + '<button type="button" data-cp="close" style="padding:3px 8px;border:1px solid var(--line);border-radius:4px;background:var(--panel-raised);color:var(--text-primary);cursor:pointer;font-size:0.72rem">Close</button></div>';
    html += '<div style="border-top:1px solid var(--line);padding-top:7px;margin-bottom:8px">'
      + '<div style="font-size:0.74rem;color:var(--text-tertiary);margin-bottom:3px">Schedule a message</div>'
      + '<textarea id="cpText" maxlength="2000" rows="2" placeholder="' + (c ? 'Message ' + esc(c.display) : 'Open a conversation first') + '" style="width:100%;box-sizing:border-box;background:var(--panel-raised);border:1px solid var(--line);border-radius:4px;color:var(--text-primary);font:inherit;font-size:0.8rem;padding:6px 8px"></textarea>'
      + '<div style="display:flex;gap:5px;align-items:center;margin-top:4px;flex-wrap:wrap">'
      + '<label style="font-size:0.74rem">in <input id="cpMins" type="number" min="1" max="43200" value="60" style="width:64px;padding:3px 5px;border:1px solid var(--line);border-radius:4px;background:var(--panel-raised);color:var(--text-primary);font:inherit"> min</label>'
      + (server ? '<label style="font-size:0.74rem"><input id="cpAnnounce" type="checkbox"> announcement (owner)</label>' : '')
      + '<button type="button" data-cp="schedule" style="padding:3px 9px;font-size:0.74rem">Schedule</button></div>'
      + '<div id="cpScheduled" style="font-size:0.74rem;color:var(--text-secondary);margin-top:5px"></div></div>';
    html += '<div style="border-top:1px solid var(--line);padding-top:7px">'
      + '<div style="font-size:0.74rem;color:var(--text-tertiary);margin-bottom:3px">Collections</div>'
      + '<div style="display:flex;gap:4px;margin-bottom:4px"><input id="cpColName" maxlength="32" placeholder="New collection" style="flex:1;padding:4px 6px;border:1px solid var(--line);border-radius:4px;background:var(--panel-raised);color:var(--text-primary);font:inherit;font-size:0.76rem">'
      + '<button type="button" data-cp="colnew" style="padding:3px 8px;font-size:0.74rem">Add</button></div>'
      + '<div id="cpCols" style="display:flex;flex-wrap:wrap;gap:4px"></div>'
      + '<div id="cpColItems" style="font-size:0.74rem;color:var(--text-secondary);margin-top:4px"></div></div>';
    html += '<div id="cpStatus" style="font-size:0.74rem;color:var(--text-tertiary);margin-top:6px"></div>';
    panel.innerHTML = html;
    panel.querySelector('[data-cp="close"]').onclick = function () { open = false; panel.hidden = true; };
    panel.querySelector('[data-cp="schedule"]').onclick = schedule;
    panel.querySelector('[data-cp="colnew"]').onclick = newCollection;
    renderCols();
    loadScheduled();
  }

  async function schedule() {
    var c = cur();
    var text = (document.getElementById('cpText') || {}).value || '';
    var mins = parseInt((document.getElementById('cpMins') || {}).value || '0', 10);
    var ann = document.getElementById('cpAnnounce');
    if (!c || !text.trim()) { return status('Message and open conversation required.', true); }
    if (!(mins >= 1 && mins <= 43200)) { return status('Pick 1 to 43200 minutes.', true); }
    try {
      await req('/api/scheduled', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          lobby: c.name, text: text.trim(), sendAt: new Date(Date.now() + mins * 60000).toISOString(),
          announcement: !!(ann && ann.checked),
        }),
      });
      document.getElementById('cpText').value = '';
      status('Scheduled.');
      loadScheduled();
    } catch (e) { status(e.message, true); }
  }

  function status(text, bad) {
    var el = document.getElementById('cpStatus');
    if (!el) return;
    el.textContent = text || '';
    el.style.color = bad ? 'var(--danger)' : 'var(--text-tertiary)';
  }

  async function loadScheduled() {
    var box = document.getElementById('cpScheduled');
    if (!box) return;
    try {
      var d = await req('/api/scheduled');
      var rows = d.scheduled || [];
      box.innerHTML = rows.length ? rows.map(function (s) {
        return '<div style="display:flex;gap:5px;align-items:center;padding:2px 0"><span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">'
          + esc(s.text).substring(0, 50) + ' · ' + esc(new Date(s.send_at).toLocaleString()) + '</span>'
          + '<button type="button" data-cp-cancel="' + esc(s.id) + '" aria-label="Cancel scheduled message" style="background:none;border:0;color:var(--text-tertiary);cursor:pointer"><svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"/></svg></button></div>';
      }).join('') : '<div style="color:var(--text-tertiary)">Nothing scheduled.</div>';
      box.querySelectorAll('[data-cp-cancel]').forEach(function (b) {
        b.onclick = async function () {
          try { await req('/api/scheduled/' + b.getAttribute('data-cp-cancel'), { method: 'DELETE' }); loadScheduled(); }
          catch (e) { status(e.message, true); }
        };
      });
    } catch (e) { box.innerHTML = '<div style="color:var(--danger)">' + esc(e.message) + '</div>'; }
  }

  async function loadCollections() {
    try {
      var d = await req('/api/message-collections');
      cols = d.collections || [];
      renderCols();
    } catch (e) { status(e.message, true); }
  }

  function renderCols() {
    var box = document.getElementById('cpCols');
    if (!box) return;
    box.innerHTML = cols.length ? cols.map(function (c) {
      return '<span style="display:inline-flex;align-items:center;gap:1px">'
        + '<button type="button" data-cp-col="' + esc(c.id) + '" style="padding:3px 7px;font-size:0.73rem;border:1px solid var(--line);border-radius:4px;background:var(--panel-raised);color:var(--text-primary);cursor:pointer">'
        + esc(c.name) + ' ' + (c.count || 0) + '</button>'
        + '<button type="button" data-cp-coldel="' + esc(c.id) + '" aria-label="Delete collection" style="background:none;border:0;color:var(--text-tertiary);cursor:pointer"><svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"/></svg></button></span>';
    }).join('') : '<span style="font-size:0.74rem;color:var(--text-tertiary)">No collections yet.</span>';
    box.querySelectorAll('[data-cp-col]').forEach(function (b) {
      b.onclick = function () { openCol = b.getAttribute('data-cp-col'); loadColItems(); };
    });
    box.querySelectorAll('[data-cp-coldel]').forEach(function (b) {
      b.onclick = async function () {
        try { await req('/api/message-collections/' + b.getAttribute('data-cp-coldel'), { method: 'DELETE' }); loadCollections(); }
        catch (e) { status(e.message, true); }
      };
    });
  }

  async function newCollection() {
    var name = (document.getElementById('cpColName') || {}).value || '';
    if (!name.trim()) return;
    try {
      await req('/api/message-collections', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim() }),
      });
      document.getElementById('cpColName').value = '';
      loadCollections();
    } catch (e) { status(e.message, true); }
  }

  async function loadColItems() {
    var box = document.getElementById('cpColItems');
    if (!box || !openCol) return;
    try {
      var d = await req('/api/message-collections/' + openCol + '/items');
      items = d.items || [];
      box.innerHTML = items.length ? items.map(function (i) {
        return '<div style="display:flex;gap:4px;padding:2px 0"><span style="flex:1"><b>' + esc(i.display_name) + '</b>: ' + esc(i.text).substring(0, 70) + '</span>'
          + '<button type="button" data-cp-itemdel="' + esc(i.message_id) + '" aria-label="Remove saved message" style="background:none;border:0;color:var(--text-tertiary);cursor:pointer"><svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"/></svg></button></div>';
      }).join('') : '<div style="color:var(--text-tertiary)">Empty — use Collect on a message.</div>';
      box.querySelectorAll('[data-cp-itemdel]').forEach(function (b) {
        b.onclick = async function () {
          try {
            await req('/api/message-collections/' + openCol + '/items/' + b.getAttribute('data-cp-itemdel'), { method: 'DELETE' });
            loadColItems(); loadCollections();
          } catch (e) { status(e.message, true); }
        };
      });
    } catch (e) { box.innerHTML = '<div style="color:var(--danger)">' + esc(e.message) + '</div>'; }
  }

  async function collect(mid) {
    var name = prompt('Collection name (a new one is created if needed):', 'Saved messages');
    if (!name || !name.trim()) return;
    try {
      var d = await req('/api/message-collections');
      cols = d.collections || [];
      var found = cols.find(function (c) { return c.name.toLowerCase() === name.trim().toLowerCase(); });
      if (!found) {
        var made = await req('/api/message-collections', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: name.trim() }),
        });
        found = made.collection;
      }
      await req('/api/message-collections/' + found.id + '/items', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messageId: mid }),
      });
      say('Saved to ' + found.name + '.');
      loadCollections();
    } catch (e) { say(e.message); }
  }

  async function editMessage(mid) {
    var row = document.querySelector('.msg[data-mid="' + mid + '"] .msg-text');
    var next = prompt('Edit message:', row ? row.textContent : '');
    if (next == null) return;
    try {
      await req('/api/messages/' + mid + '/edit', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: next }),
      });
      say('Message edited.');
    } catch (e) { say(e.message); }
  }

  async function history(mid) {
    try {
      var d = await req('/api/messages/' + mid + '/edits');
      var rows = d.edits || [];
      alert(rows.length ? rows.map(function (e, i) {
        return 'v' + (rows.length - i) + ' · ' + new Date(e.edited_at).toLocaleString() + '\n' + e.body;
      }).join('\n\n') : 'No earlier versions.');
    } catch (e) { alert(e.message); }
  }

  async function boot() {
    token = await getToken();
    if (!token) return;
    var anchor = document.getElementById('organiseBtn') || document.getElementById('extrasBtn');
    var btn = document.createElement('button');
    btn.type = 'button'; btn.id = 'planBtn'; btn.className = 'btn btn-secondary';
    btn.textContent = 'Plan'; btn.title = 'Scheduled messages, collections and edit history';
    btn.style.cssText = 'padding:6px 12px;font-size:0.78rem';
    if (anchor && anchor.parentNode) anchor.parentNode.insertBefore(btn, anchor.nextSibling);
    panel = document.createElement('div');
    panel.id = 'chatPlannerPanel';
    panel.hidden = true;
    panel.style.cssText = 'padding:12px 20px;border-bottom:1px solid var(--line);background:var(--panel);max-height:48vh;overflow:auto';
    var after = document.getElementById('chatOrganisePanel') || document.getElementById('extrasPanel');
    if (after && after.parentNode) after.parentNode.insertBefore(panel, after.nextSibling);
    btn.onclick = function () {
      open = !open; panel.hidden = !open;
      if (open) { render(); loadCollections(); }
    };
    document.addEventListener('click', function (e) {
      var t = e.target;
      if (!t || !t.closest) return;
      var col = t.closest('.msg-collect');
      if (col) { e.preventDefault(); collect(col.getAttribute('data-mid')); return; }
      var ed = t.closest('.msg-edit');
      if (ed) { e.preventDefault(); editMessage(ed.getAttribute('data-mid')); return; }
      var hi = t.closest('.msg-history');
      if (hi) { e.preventDefault(); history(hi.getAttribute('data-mid')); return; }
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
