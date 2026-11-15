/* file: public/chat-community.js
 * what: Additive chat tools — DM peer card, per-user folders and extra
 *   message-search filters. Everything is built beside the existing shell;
 *   no existing class or layout is replaced.
 * invariants: folders are private to the signed-in account; the peer card
 *   renders public profile fields only; typing previews never leave channels.
 */
(function () {
  var current = function () { return window.current || null; };
  var folders = [], items = [], token = null, panel = null, open = false;
  window.cudicFolderItems = null;
  window.cudicTypingPreviews = true;

  function apiHost() {
    return (typeof WS_URL !== 'undefined' && WS_URL) ? WS_URL.replace(/^wss?:\/\//, 'https://') : '';
  }
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

  function folderSet(id) {
    if (!id) { window.cudicFolderItems = null; return; }
    window.cudicFolderItems = new Set(items.filter(function (i) { return i.folder_id === id; }).map(function (i) { return i.lobby_id; }));
  }

  function render() {
    if (!panel) return;
    var cur = current();
    var dm = cur && cur.kind === 'dm';
    var active = window.cudicFolderFilter || '';
    var html = '<div style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:8px">'
      + '<b style="font-family:var(--font-head);font-size:0.9rem">Your chat</b>'
      + '<button type="button" class="btn btn-secondary" data-cc="close" style="padding:4px 9px;font-size:0.72rem">Close</button></div>';
    html += '<div style="display:flex;gap:6px;margin-bottom:8px"><input id="ccFolderName" maxlength="24" placeholder="New folder" '
      + 'style="flex:1;padding:6px 8px;border:1px solid var(--line);border-radius:var(--radius-sm);background:var(--panel-raised);color:var(--text-primary);font:inherit;font-size:0.8rem">'
      + '<button type="button" class="btn btn-secondary" data-cc="new" style="padding:5px 10px;font-size:0.75rem">Add</button></div>';
    html += '<div style="display:flex;flex-wrap:wrap;gap:4px;margin-bottom:8px">'
      + '<button type="button" class="btn btn-secondary" data-cc-filter="" style="padding:3px 8px;font-size:0.72rem' + (!active ? ';border-color:var(--signal)' : '') + '">All DMs</button>';
    folders.forEach(function (f) {
      var n = items.filter(function (i) { return i.folder_id === f.id; }).length;
      html += '<span style="display:inline-flex;align-items:center;gap:2px">'
        + '<button type="button" class="btn btn-secondary" data-cc-filter="' + esc(f.id) + '" style="padding:3px 8px;font-size:0.72rem' + (active === f.id ? ';border-color:var(--signal)' : '') + '">'
        + esc(f.name) + ' ' + n + '</button>'
        + '<button type="button" title="Delete folder" data-cc-del="' + esc(f.id) + '" style="background:none;border:0;color:var(--text-tertiary);cursor:pointer;font-size:0.7rem">×</button></span>';
    });
    html += '</div>';
    if (dm) {
      html += '<div style="font-size:0.76rem;color:var(--text-secondary);margin-bottom:6px">File <b>' + esc(cur.display || 'this DM') + '</b> into a folder:</div>'
        + '<div style="display:flex;flex-wrap:wrap;gap:4px;margin-bottom:8px">';
      if (!folders.length) html += '<span style="font-size:0.76rem;color:var(--text-tertiary)">Create one above.</span>';
      folders.forEach(function (f) {
        var inside = items.some(function (i) { return i.folder_id === f.id && i.lobby_id === cur.id; });
        html += '<button type="button" class="btn btn-secondary" data-cc-file="' + esc(f.id) + '" data-cc-in="' + (inside ? '1' : '0') + '" style="padding:3px 8px;font-size:0.72rem">'
          + (inside ? '✓ ' : '+ ') + esc(f.name) + '</button>';
      });
      html += '</div>';
      html += '<button type="button" class="btn btn-secondary" data-cc="card" style="padding:4px 9px;font-size:0.74rem">Open profile card</button>';
    }
    html += '<div id="ccCard" style="margin-top:8px"></div>';
    panel.innerHTML = html;
    panel.hidden = false;

    panel.querySelectorAll('[data-cc-filter]').forEach(function (b) {
      b.onclick = function () {
        var id = b.getAttribute('data-cc-filter') || '';
        window.cudicFolderFilter = id || null;
        folderSet(id);
        render();
        if (window.renderConvs) window.renderConvs();
      };
    });
    panel.querySelectorAll('[data-cc-del]').forEach(function (b) {
      b.onclick = async function () {
        try {
          await req('/api/folders/' + b.getAttribute('data-cc-del'), { method: 'DELETE' });
          if (window.cudicFolderFilter === b.getAttribute('data-cc-del')) {
            window.cudicFolderFilter = null; window.cudicFolderItems = null;
          }
          await loadFolders();
        } catch (e) { alert(e.message); }
      };
    });
    panel.querySelectorAll('[data-cc-file]').forEach(function (b) {
      b.onclick = async function () {
        var cur2 = current(); if (!cur2) return;
        var fid = b.getAttribute('data-cc-file');
        try {
          if (b.getAttribute('data-cc-in') === '1') {
            await req('/api/folders/' + fid + '/items/' + cur2.id, { method: 'DELETE' });
          } else {
            await req('/api/folders/' + fid + '/items', {
              method: 'POST', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ lobbyId: cur2.id }),
            });
          }
          await loadFolders();
        } catch (e) { alert(e.message); }
      };
    });
    var newBtn = panel.querySelector('[data-cc="new"]');
    if (newBtn) newBtn.onclick = async function () {
      var input = document.getElementById('ccFolderName');
      var name = (input && input.value || '').trim();
      if (!name) return;
      try {
        await req('/api/folders', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: name }),
        });
        await loadFolders();
      } catch (e) { alert(e.message); }
    };
    var cardBtn = panel.querySelector('[data-cc="card"]');
    if (cardBtn) cardBtn.onclick = showCard;
  }

  async function showCard() {
    var cur = current();
    var box = document.getElementById('ccCard');
    if (!cur || !cur.peer || !box) return;
    box.innerHTML = '<div style="font-size:0.78rem;color:var(--text-tertiary)">Loading card…</div>';
    try {
      var d = await req('/api/users/' + encodeURIComponent(cur.peer.id) + '/card');
      var c = d.card || {};
      var bits = [];
      if (c.status_text) bits.push('<div style="font-size:0.82rem;margin-bottom:4px">' + esc((c.status_emoji || '') + ' ' + c.status_text) + '</div>');
      if (c.intro) bits.push('<div style="font-size:0.8rem;color:var(--text-secondary);margin-bottom:4px">' + esc(c.intro) + '</div>');
      if (c.bio) bits.push('<div style="font-size:0.8rem;color:var(--text-secondary);margin-bottom:6px">' + esc(c.bio) + '</div>');
      if (c.shared_interests && c.shared_interests.length) {
        bits.push('<div style="font-size:0.76rem;margin-bottom:4px"><b>Shared interests:</b> ' + esc(c.shared_interests.join(', ')) + '</div>');
      }
      if (c.mutual_servers && c.mutual_servers.length) {
        bits.push('<div style="font-size:0.76rem;margin-bottom:4px"><b>Mutual servers:</b> ' + esc(c.mutual_servers.map(function (s) { return s.name; }).join(', ')) + '</div>');
      }
      if (c.games && c.games.length) {
        bits.push('<div style="font-size:0.76rem;margin-bottom:2px"><b>Games:</b></div>'
          + c.games.map(function (g) {
            return '<a href="/view.html?id=' + encodeURIComponent(g.id) + '" style="display:block;font-size:0.76rem;color:var(--signal)">' + esc(g.title) + '</a>';
          }).join(''));
      }
      if (!bits.length) bits.push('<div style="font-size:0.78rem;color:var(--text-tertiary)">Nothing public yet.</div>');
      box.innerHTML = '<div style="border:1px solid var(--line);border-radius:var(--radius-sm);padding:9px">'
        + '<div style="font-family:var(--font-head);font-weight:600;font-size:0.86rem;margin-bottom:5px">' + esc(c.display_name || cur.display || 'Profile') + '</div>'
        + bits.join('') + '</div>';
    } catch (e) {
      box.innerHTML = '<div style="font-size:0.76rem;color:var(--danger)">' + esc(e.message) + '</div>';
    }
  }

  async function loadFolders() {
    try {
      var d = await req('/api/folders');
      folders = d.folders || [];
      items = d.items || [];
      folderSet(window.cudicFolderFilter);
      render();
      if (window.renderConvs) window.renderConvs();
    } catch (e) {
      if (panel) {
        panel.hidden = false;
        panel.innerHTML = '<div style="font-size:0.78rem;color:var(--text-secondary)">Folders need the community-tools migration. ' + esc(e.message) + '</div>';
      }
    }
  }

  async function boot() {
    token = await getToken();
    if (!token) return;
    var extras = document.getElementById('extrasBtn');
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.id = 'organiseBtn';
    btn.className = 'btn btn-secondary';
    btn.textContent = 'Organise';
    btn.title = 'DM folders, peer cards and search filters';
    btn.style.cssText = 'padding:6px 12px;font-size:0.78rem';
    if (extras && extras.parentNode) extras.parentNode.insertBefore(btn, extras.nextSibling);
    panel = document.createElement('div');
    panel.id = 'chatOrganisePanel';
    panel.hidden = true;
    panel.style.cssText = 'padding:12px 20px;border-bottom:1px solid var(--line);background:var(--panel);max-height:46vh;overflow:auto';
    var anchor = document.getElementById('extrasPanel');
    if (anchor && anchor.parentNode) anchor.parentNode.insertBefore(panel, anchor.nextSibling);
    btn.onclick = function () { open = !open; panel.hidden = !open; if (open) loadFolders(); };
    document.addEventListener('click', function (e) {
      if (!open) return;
      if (panel.contains(e.target) || btn.contains(e.target)) return;
      if (e.target.closest && e.target.closest('#chatOrganisePanel')) return;
    });
    try {
      var p = await req('/api/profile');
      if (p && p.profile && p.profile.typing_previews === false) window.cudicTypingPreviews = false;
    } catch (e) {}
    // Extra search filters, injected beside the existing search box.
    var sp = document.getElementById('msgSearchPanel');
    if (sp && !document.getElementById('msgSearchFilters')) {
      var row = document.createElement('div');
      row.id = 'msgSearchFilters';
      row.style.cssText = 'display:flex;flex-wrap:wrap;gap:6px;align-items:center;margin-top:8px;font-size:0.76rem;color:var(--text-secondary)';
      row.innerHTML = '<label>From <input id="msgSearchFrom" maxlength="24" placeholder="name" style="width:90px;padding:4px 6px;border:1px solid var(--line);border-radius:4px;background:var(--panel);color:var(--text-primary);font:inherit"></label>'
        + '<label>After <input id="msgSearchAfter" type="date" style="padding:3px 5px;border:1px solid var(--line);border-radius:4px;background:var(--panel);color:var(--text-primary);font:inherit"></label>'
        + '<label>Before <input id="msgSearchBefore" type="date" style="padding:3px 5px;border:1px solid var(--line);border-radius:4px;background:var(--panel);color:var(--text-primary);font:inherit"></label>'
        + '<label><input id="msgSearchLinks" type="checkbox"> links only</label>';
      sp.appendChild(row);
    }
  }

  window.cudicChatCommunity = { onConv: function () { if (open) render(); } };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
