/* file: public/server-tools.js
 * what: Owner/mod tools for one server — edit the open channel's description,
 *   save/apply channel templates, read the audit log and export/import a
 *   backup. Additive to the channel page; every write is re-checked server-side.
 * invariants: the panel only appears for owner/mod; a missing migration shows a
 *   readable message instead of an empty panel.
 */
(function () {
  var panel = null, page = null, role = null;

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function apiHost() {
    if (!page) return '';
    return typeof page.apiHost === 'function' ? page.apiHost() : (page.apiHost || '');
  }
  function headers(extra) { return page ? page.headers(extra) : (extra || {}); }

  async function req(path, opts) {
    opts = opts || {};
    opts.headers = headers(opts.headers || {});
    var r = await fetch(apiHost() + path, opts);
    var d = await r.json().catch(function () { return {}; });
    if (!r.ok) throw new Error((d && d.text) || (d && d.error) || 'Request failed.');
    return d;
  }

  function status(text, bad) {
    var el = document.getElementById('srvToolsStatus');
    if (!el) return;
    el.textContent = text || '';
    el.style.color = bad ? 'var(--danger)' : 'var(--text-secondary)';
  }

  function renderShell() {
    var cur = page.current;
    var owner = role === 'owner';
    var html = '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">'
      + '<b style="font-family:var(--font-head);font-size:0.9rem">Server tools</b>'
      + '<button type="button" data-st="close" style="background:none;border:1px solid var(--line);border-radius:4px;color:var(--text-secondary);cursor:pointer;padding:3px 8px">Close</button></div>';
    if (owner && cur) {
      html += '<div style="font-size:0.74rem;color:var(--text-tertiary);margin-bottom:2px">Description for #' + esc(cur.display) + '</div>'
        + '<textarea id="stDesc" maxlength="500" rows="2" style="width:100%;box-sizing:border-box;background:var(--panel-raised);border:1px solid var(--line);border-radius:4px;color:var(--text-primary);font:inherit;font-size:0.8rem;padding:6px 8px">' + esc(cur.description || '') + '</textarea>'
        + '<button type="button" data-st="desc" style="margin:4px 0 10px;padding:4px 9px;font-size:0.75rem;border:1px solid var(--line);border-radius:4px;background:var(--panel-raised);color:var(--text-primary);cursor:pointer">Save description</button>'
        + '<div style="display:flex;gap:5px;align-items:center;flex-wrap:wrap;margin:0 0 10px"><label style="font-size:0.74rem;color:var(--text-tertiary)" for="stType">Channel type</label>'
        + '<select id="stType" style="padding:4px 6px;border:1px solid var(--line);border-radius:4px;background:var(--panel-raised);color:var(--text-primary);font:inherit;font-size:0.76rem">'
        + ['chat', 'announcement', 'qa'].map(function (t) { return '<option value="' + t + '"' + ((cur.type || 'chat') === t ? ' selected' : '') + '>' + (t === 'chat' ? 'Chat' : t === 'announcement' ? 'Announcement — mods post' : 'Q&A — answers can be marked') + '</option>'; }).join('')
        + '</select><button type="button" data-st="ctype" style="padding:4px 9px;font-size:0.75rem;border:1px solid var(--line);border-radius:4px;background:var(--panel-raised);color:var(--text-primary);cursor:pointer">Save type</button></div>';
    }
    // Events are member-visible: anyone in the server can RSVP or take the
    // .ics; only owner/mod sees the create fields.
    html += '<div style="border-top:1px solid var(--line);padding-top:8px;margin-bottom:8px">'
      + '<div style="font-size:0.74rem;color:var(--text-tertiary);margin-bottom:3px">Events</div>';
    if (owner || role === 'mod') {
      html += '<div style="display:flex;gap:4px;flex-wrap:wrap;margin-bottom:4px">'
        + '<input id="stEventTitle" maxlength="100" placeholder="Event title" style="flex:1;min-width:120px;padding:4px 6px;border:1px solid var(--line);border-radius:4px;background:var(--panel-raised);color:var(--text-primary);font:inherit;font-size:0.76rem">'
        + '<input id="stEventStart" type="datetime-local" style="padding:3px 5px;border:1px solid var(--line);border-radius:4px;background:var(--panel-raised);color:var(--text-primary);font:inherit;font-size:0.74rem">'
        + '<button type="button" data-st="eventcreate" style="padding:3px 8px;font-size:0.74rem">Add</button></div>';
    }
    html += '<div id="stEvents" style="font-size:0.74rem;color:var(--text-secondary);max-height:150px;overflow:auto"></div></div>';
    if (owner || role === 'mod') {
      html += '<div style="border-top:1px solid var(--line);padding-top:8px;margin-bottom:8px">'
        + '<div style="font-size:0.74rem;color:var(--text-tertiary);margin-bottom:3px">Game update feeds</div>'
        + '<div style="font-size:0.7rem;color:var(--text-tertiary);margin-bottom:5px">When a followed game publishes, Cudic posts a link in the chosen channel.</div>'
        + '<div id="stFeeds" style="font-size:0.74rem;color:var(--text-secondary);max-height:120px;overflow:auto;margin-bottom:5px"></div>'
        + '<div style="display:flex;gap:4px;flex-wrap:wrap"><input id="stFeedGame" maxlength="36" placeholder="Game ID (from its page URL)" aria-label="Game ID" style="flex:1;min-width:140px;padding:4px 6px;border:1px solid var(--line);border-radius:4px;background:var(--panel-raised);color:var(--text-primary);font:inherit;font-size:0.76rem">'
        + '<select id="stFeedChannel" aria-label="Feed channel" style="max-width:150px;padding:3px 5px;border:1px solid var(--line);border-radius:4px;background:var(--panel-raised);color:var(--text-primary);font-size:0.76rem"></select>'
        + '<button type="button" data-st="feedadd" style="padding:3px 8px;font-size:0.74rem">Follow</button></div></div>';
    }
    if (owner) {
      html += '<div style="border-top:1px solid var(--line);padding-top:8px;margin-bottom:8px">'
        + '<div style="font-size:0.74rem;color:var(--text-tertiary);margin-bottom:3px">Channel templates</div>'
        + '<div style="display:flex;gap:4px;margin-bottom:4px"><input id="stTplName" maxlength="32" placeholder="Template name" style="flex:1;padding:4px 6px;border:1px solid var(--line);border-radius:4px;background:var(--panel-raised);color:var(--text-primary);font:inherit;font-size:0.76rem">'
        + '<button type="button" data-st="tplsave" style="padding:3px 8px;font-size:0.74rem">Save current</button></div>'
        + '<div style="display:flex;gap:4px"><select id="stTplList" style="flex:1;padding:3px 5px;border:1px solid var(--line);border-radius:4px;background:var(--panel-raised);color:var(--text-primary);font-size:0.76rem"></select>'
        + '<button type="button" data-st="tplapply" style="padding:3px 8px;font-size:0.74rem">Apply</button>'
        + '<button type="button" data-st="tpldel" style="padding:3px 8px;font-size:0.74rem">Delete</button></div></div>';
    }
    if (owner || role === 'mod') {
      html += '<div style="border-top:1px solid var(--line);padding-top:8px;margin-bottom:8px">'
        + '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:3px"><span style="font-size:0.74rem;color:var(--text-tertiary)">Audit log</span><button type="button" data-st="audit" style="padding:3px 8px;font-size:0.74rem">Refresh</button></div>'
        + '<div id="stAudit" style="max-height:120px;overflow:auto;font-size:0.74rem;color:var(--text-secondary)"></div></div>';
    }
    if (owner) {
      html += '<div style="border-top:1px solid var(--line);padding-top:8px">'
        + '<div style="font-size:0.74rem;color:var(--text-tertiary);margin-bottom:3px">Backup</div>'
        + '<div style="display:flex;gap:4px;flex-wrap:wrap"><button type="button" data-st="backup" style="padding:3px 8px;font-size:0.74rem">Download</button>'
        + '<label style="padding:3px 8px;font-size:0.74rem;border:1px solid var(--line);border-radius:4px;cursor:pointer">Restore<input id="stRestore" type="file" accept="application/json,.json" hidden></label></div></div>';
    }
    html += '<div id="srvToolsStatus" style="font-size:0.74rem;margin-top:6px"></div>';
    panel.innerHTML = html;

    panel.querySelectorAll('[data-st]').forEach(function (b) {
      b.onclick = function () {
        var act = b.getAttribute('data-st');
        if (act === 'close') { panel.hidden = true; return; }
        if (act === 'desc') saveDesc();
        if (act === 'ctype') saveChannelType();
        if (act === 'feedadd') addFeed();
        if (act === 'tplsave') saveTemplate();
        if (act === 'tplapply') applyTemplate();
        if (act === 'tpldel') deleteTemplate();
        if (act === 'audit') loadAudit();
        if (act === 'backup') downloadBackup();
        if (act === 'eventcreate') createEvent();
      };
    });
    var file = document.getElementById('stRestore');
    if (file) file.onchange = restoreBackup;
    if (owner && cur) {
      var ta = document.getElementById('stDesc');
      // A channel switch while the panel is open should not save to the old one.
      ta.dataset.cid = cur.id;
    }
    loadTemplates();
    loadAudit();
    loadEvents();
    loadFeeds();
  }

  function fillFeedChannels() {
    var sel = document.getElementById('stFeedChannel');
    if (!sel) return;
    var chans = (page && page.channels) || [];
    sel.innerHTML = chans.map(function (c) {
      return '<option value="' + esc(c.id) + '"' + (page.current && c.id === page.current.id ? ' selected' : '') + '>#' + esc(c.display) + '</option>';
    }).join('');
  }

  async function loadFeeds() {
    var box = document.getElementById('stFeeds');
    if (!box) return;
    fillFeedChannels();
    try {
      var d = await req('/api/servers/' + page.sid + '/game-feeds');
      var rows = d.feeds || [];
      box.innerHTML = rows.length ? rows.map(function (f) {
        return '<div style="display:flex;gap:5px;align-items:center;padding:3px 0;border-bottom:1px solid var(--line)"><span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap"><b style="color:var(--text-primary)">' + esc(f.title) + '</b> to #' + esc(f.channel) + '</span>'
          + '<button type="button" data-feed-del="' + esc(f.id) + '" style="padding:1px 6px;font-size:0.7rem;border:1px solid var(--line);border-radius:4px;background:transparent;color:var(--text-secondary);cursor:pointer">Remove</button></div>';
      }).join('') : '<div style="color:var(--text-tertiary)">No game feeds yet.</div>';
      box.querySelectorAll('[data-feed-del]').forEach(function (b) {
        b.onclick = function () { removeFeed(b.getAttribute('data-feed-del')); };
      });
    } catch (e) { box.innerHTML = '<div style="color:var(--danger)">' + esc(e.message) + '</div>'; }
  }

  async function addFeed() {
    var game = (document.getElementById('stFeedGame') || {}).value || '';
    var channel = (document.getElementById('stFeedChannel') || {}).value || '';
    if (!game.trim()) { status('Paste the game ID first.', true); return; }
    if (!channel) { status('Pick a channel.', true); return; }
    try {
      await req('/api/servers/' + page.sid + '/game-feeds', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ gameId: game.trim(), channelId: channel }),
      });
      status('Game feed added.');
      document.getElementById('stFeedGame').value = '';
      await loadFeeds();
    } catch (e) { status(e.message, true); }
  }

  async function removeFeed(id) {
    try {
      await req('/api/servers/' + page.sid + '/game-feeds?id=' + encodeURIComponent(id), { method: 'DELETE' });
      status('Game feed removed.');
      await loadFeeds();
    } catch (e) { status(e.message, true); }
  }

  async function saveChannelType() {
    var sel = document.getElementById('stType');
    var cur = page.current;
    if (!sel || !cur) return;
    try {
      await req('/api/channels/' + cur.id, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: sel.value }),
      });
      cur.type = sel.value;
      if (page.reloadChannels) await page.reloadChannels();
      if (window.cudicBatchChannel && page.current) window.cudicBatchChannel(page.current);
      status('Channel type saved.');
    } catch (e) { status(e.message, true); }
  }

  async function loadEvents() {
    var box = document.getElementById('stEvents');
    if (!box) return;
    try {
      var d = await req('/api/servers/' + page.sid + '/events');
      var rows = d.events || [];
      box.innerHTML = rows.length ? rows.map(function (ev) {
        return '<div style="padding:3px 0;border-bottom:1px solid var(--line)">'
          + '<b style="color:var(--text-primary)">' + esc(ev.title) + '</b> · ' + esc(new Date(ev.starts_at).toLocaleString())
          + ' · ' + (ev.going || 0) + ' going'
          + '<div style="display:flex;gap:3px;margin-top:2px">'
          + '<button type="button" data-ev-rsvp="' + esc(ev.id) + '" data-ev-state="' + (ev.mine === 'going' ? 'not_going' : 'going') + '" style="padding:1px 6px;font-size:0.7rem">' + (ev.mine === 'going' ? 'Going <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="vertical-align:-2px;margin-left:3px"><path d="M20 6 9 17l-5-5"/></svg>' : 'Going') + '</button>'
          + '<button type="button" data-ev-ics="' + esc(ev.id) + '" style="padding:1px 6px;font-size:0.7rem">Calendar</button></div></div>';
      }).join('') : '<div style="color:var(--text-tertiary)">No upcoming events.</div>';
      box.querySelectorAll('[data-ev-rsvp]').forEach(function (b) {
        b.onclick = function () { rsvp(b.getAttribute('data-ev-rsvp'), b.getAttribute('data-ev-state')); };
      });
      box.querySelectorAll('[data-ev-ics]').forEach(function (b) {
        b.onclick = function () { calendar(b.getAttribute('data-ev-ics')); };
      });
    } catch (e) { box.innerHTML = '<div style="color:var(--danger)">' + esc(e.message) + '</div>'; }
  }

  async function createEvent() {
    var title = (document.getElementById('stEventTitle') || {}).value || '';
    var start = (document.getElementById('stEventStart') || {}).value || '';
    if (!title.trim() || !start) { status('Event title and start time required.', true); return; }
    try {
      await req('/api/servers/' + page.sid + '/events', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: title.trim(), startsAt: new Date(start).toISOString(), channelId: page.current && page.current.id }),
      });
      status('Event added.');
      loadEvents();
    } catch (e) { status(e.message, true); }
  }

  async function rsvp(eid, state) {
    try {
      await req('/api/events/' + eid + '/rsvp', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ state: state }),
      });
      loadEvents();
      if (window.cudicServerPage) window.cudicServerPage.addSys(state === 'going' ? 'You are going.' : 'RSVP removed.');
    } catch (e) { status(e.message, true); }
  }

  async function calendar(eid) {
    try {
      var r = await fetch(apiHost() + '/api/events/' + eid + '/ics', { headers: headers() });
      if (!r.ok) throw new Error('Could not download the calendar file.');
      var blob = await r.blob();
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'cudic-event.ics';
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(function () { URL.revokeObjectURL(a.href); }, 2000);
    } catch (e) { status(e.message, true); }
  }

  async function saveDesc() {
    var ta = document.getElementById('stDesc');
    var cur = page.current;
    if (!ta || !cur) return;
    try {
      await req('/api/channels/' + cur.id, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ description: ta.value }),
      });
      page.setDescription(ta.value);
      status('Description saved.');
    } catch (e) { status(e.message, true); }
  }

  async function loadTemplates() {
    var list = document.getElementById('stTplList');
    if (!list || role !== 'owner') return;
    try {
      var d = await req('/api/servers/' + page.sid + '/templates');
      list.innerHTML = '<option value="">Choose a template…</option>' + (d.templates || []).map(function (t) {
        return '<option value="' + esc(t.id) + '">' + esc(t.name) + '</option>';
      }).join('');
    } catch (e) { status(e.message, true); }
  }

  async function saveTemplate() {
    var name = (document.getElementById('stTplName') || {}).value || '';
    var cur = page.current;
    if (!cur || !name.trim()) { status('Name the template first.', true); return; }
    try {
      await req('/api/servers/' + page.sid + '/templates', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), channelId: cur.id }),
      });
      status('Template saved.');
      loadTemplates();
    } catch (e) { status(e.message, true); }
  }

  async function applyTemplate() {
    var sel = document.getElementById('stTplList');
    var tid = sel && sel.value;
    if (!tid) { status('Pick a template.', true); return; }
    var name = prompt('New channel name (letters, numbers, - or _):', '');
    if (!name) return;
    try {
      await req('/api/servers/' + page.sid + '/templates/' + tid + '/apply', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name }),
      });
      status('Channel created — reload to see it.');
    } catch (e) { status(e.message, true); }
  }

  async function deleteTemplate() {
    var sel = document.getElementById('stTplList');
    var tid = sel && sel.value;
    if (!tid) { status('Pick a template.', true); return; }
    if (!confirm('Delete this template?')) return;
    try {
      await req('/api/servers/' + page.sid + '/templates/' + tid, { method: 'DELETE' });
      status('Template deleted.');
      loadTemplates();
    } catch (e) { status(e.message, true); }
  }

  async function loadAudit() {
    var box = document.getElementById('stAudit');
    if (!box) return;
    try {
      var d = await req('/api/servers/' + page.sid + '/audit');
      var rows = d.audit || [];
      box.innerHTML = rows.length ? rows.map(function (a) {
        return '<div style="padding:2px 0;border-bottom:1px solid var(--line)">'
          + '<b style="color:var(--text-primary)">' + esc(a.actor_name || 'Cudic') + '</b> '
          + esc(a.action) + (a.target ? ' · ' + esc(a.target) : '')
          + '<span style="color:var(--text-tertiary)"> · ' + esc(new Date(a.created_at).toLocaleString()) + '</span></div>';
      }).join('') : '<div style="color:var(--text-tertiary)">Nothing recorded yet.</div>';
    } catch (e) { box.innerHTML = '<div style="color:var(--danger)">' + esc(e.message) + '</div>'; }
  }

  async function downloadBackup() {
    try {
      var d = await req('/api/servers/' + page.sid + '/backup');
      var blob = new Blob([JSON.stringify(d, null, 2)], { type: 'application/json' });
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'cudic-server-backup-' + page.sid.slice(0, 8) + '.json';
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(function () { URL.revokeObjectURL(a.href); }, 2000);
      status('Backup downloaded.');
    } catch (e) { status(e.message, true); }
  }

  async function restoreBackup(ev) {
    var file = ev.target.files && ev.target.files[0];
    if (!file) return;
    try {
      var parsed = JSON.parse(await file.text());
      var d = await req('/api/servers/' + page.sid + '/backup', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ backup: parsed.backup || parsed }),
      });
      status('Restored: ' + (d.channels_created || 0) + ' channel(s), ' + (d.roles_restored || 0) + ' role(s).');
    } catch (e) { status(e.message, true); }
    ev.target.value = '';
  }

  async function boot() {
    page = window.cudicServerPage;
    if (!page) { setTimeout(boot, 100); return; }
    var btn = document.getElementById('srvToolsBtn');
    if (!btn) return;
    try {
      var r = await fetch(apiHost() + '/api/servers/' + page.sid + '/membership', { headers: page.headers() });
      var m = await r.json();
      role = (m && m.role) || null;
    } catch (e) { role = null; }
    if (!role) return;
    btn.hidden = false;
    panel = document.createElement('div');
    panel.id = 'srvToolsPanel';
    panel.hidden = true;
    panel.style.cssText = 'padding:10px 16px;border-bottom:1px solid var(--line);background:var(--panel);flex-shrink:0;max-height:50vh;overflow:auto';
    var main = document.getElementById('serverMain');
    var topbar = document.getElementById('topbar');
    if (main && topbar && topbar.nextSibling) main.insertBefore(panel, topbar.nextSibling);
    else if (main) main.appendChild(panel);
    btn.onclick = function () {
      panel.hidden = !panel.hidden;
      if (!panel.hidden) renderShell();
    };
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
