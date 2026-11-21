/* file: public/server-customize.js
 * what: Server appearance, nested folders, badges, welcome flow and commands.
 * invariants: the server enforces owner/mod; this page only hides what it can.
 */
(function () {
  var SID = new URLSearchParams(location.search).get('sid');
  var T = '', folders = [], channels = [], badges = [], members = [], commands = [];
  function $(id) { return document.getElementById(id); }
  function apiHost() { return (typeof WS_URL !== 'undefined' && WS_URL) ? WS_URL.replace(/^wss?:\/\//, 'https://') : ''; }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  async function token() { try { if (window.getAuthToken) { var t = await window.getAuthToken(); if (t) return t; } var raw = localStorage.getItem('sb-qgcydphkaujomxyzwcht-auth-token'); var s = JSON.parse(raw); return (s && s.access_token) || raw; } catch (e) { return null; } }
  async function req(path, opts) {
    opts = opts || {}; opts.headers = Object.assign({ Authorization: 'Bearer ' + T }, opts.headers || {});
    var r = await fetch(apiHost() + path, opts); var d = await r.json().catch(function () { return {}; });
    if (!r.ok) throw new Error(d.text || d.error || 'Request failed.'); return d;
  }
  function msg(id, text, bad) { var el = $(id); if (el) { el.textContent = text || ''; el.className = 'cz-msg' + (bad ? ' bad' : ''); } }
  function gate(text) { $('scBody').hidden = true; $('scGate').hidden = false; $('scGateText').textContent = text; }

  async function loadAll() {
    var results = await Promise.all([
      req('/api/servers/' + SID + '/appearance'),
      req('/api/servers/' + SID + '/channels'),
      req('/api/servers/' + SID + '/channel-folders'),
      req('/api/servers/' + SID + '/badges'),
      req('/api/servers/' + SID + '/commands'),
      req('/api/servers/' + SID + '/welcome'),
      req('/api/servers/' + SID + '/members').catch(function () { return { members: [] }; }),
    ]);
    var app = results[0], ch = results[1], fo = results[2], ba = results[3], cm = results[4], we = results[5], me = results[6];
    $('srvAccent').value = (app.theme && app.theme.accent) || '#FF8C1A';
    $('srvBanner').value = (app.theme && app.theme.background) || '';
    $('srvHeaderBanner').value = (app.theme && app.theme.banner) || '';
    paintPreview();
    channels = ch.channels || []; folders = fo.folders || []; badges = ba.badges || [];
    commands = cm.commands || []; members = me.members || [];
    var w = we.welcome || {};
    $('welcomeOn').checked = !!w.enabled;
    $('welcomeSteps').value = (w.steps || []).map(function (s) { return (s.title || '') + ' | ' + (s.body || ''); }).join('\n');
    paintFolders(); paintBadges(); paintCommands(); paintPickers();
  }
  function paintPreview() {
    var bg = $('srvBanner').value.trim();
    var header = $('srvHeaderBanner').value.trim();
    var accent = $('srvAccent').value;
    $('srvPreview').style.backgroundImage = bg ? 'linear-gradient(rgba(13,14,16,.68),rgba(13,14,16,.68)),url("' + bg.replace(/"/g, '') + '")' : 'linear-gradient(90deg,' + accent + ' 0 18%,var(--panel-raised) 18%)';
    $('srvHeaderPreview').style.backgroundImage = header
      ? 'linear-gradient(180deg,rgba(9,10,14,.12),rgba(9,10,14,.62)),url("' + header.replace(/"/g, '') + '")'
      : 'linear-gradient(105deg,' + accent + ' 0%,rgba(24,20,40,.92) 55%,rgba(13,14,16,.96) 100%)';
  }
  function paintFolders() {
    var roots = folders.filter(function (f) { return !f.parent_id; });
    $('folderList').innerHTML = roots.length ? roots.map(function (f) {
      var kids = folders.filter(function (k) { return k.parent_id === f.id; });
      return '<div class="cz-list-row"><span class="grow"><b>' + esc(f.name) + '</b>' + (kids.length ? ' · ' + kids.map(function (k) { return esc(k.name); }).join(', ') : '') + '</span><button type="button" data-fdel="' + f.id + '" aria-label="Delete folder"><svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"/></svg></button></div>';
    }).join('') : '<div style="color:var(--text-tertiary)">No folders yet.</div>';
    $('folderList').querySelectorAll('[data-fdel]').forEach(function (b) { b.onclick = function () { delFolder(b.getAttribute('data-fdel')); }; });
    $('folderParent').innerHTML = '<option value="">Top level</option>' + roots.map(function (f) { return '<option value="' + f.id + '">' + esc(f.name) + '</option>'; }).join('');
  }
  function paintPickers() {
    $('assignChannel').innerHTML = '<option value="">Choose a channel…</option>' + channels.map(function (c) { return '<option value="' + c.id + '"># ' + esc(c.display) + '</option>'; }).join('');
    $('assignFolder').innerHTML = '<option value="">No folder</option>' + folders.map(function (f) { return '<option value="' + f.id + '">' + esc(f.name) + '</option>'; }).join('');
    $('grantBadge').innerHTML = '<option value="">Badge…</option>' + badges.map(function (b) { return '<option value="' + b.id + '">' + esc(b.icon + ' ' + b.name) + '</option>'; }).join('');
    $('grantMember').innerHTML = '<option value="">Member…</option>' + members.filter(function (m) { return m.role !== 'owner'; }).map(function (m) { return '<option value="' + m.user_id + '">' + esc(m.display_name || m.user_id) + '</option>'; }).join('');
  }
  function paintBadges() {
    $('badgeList').innerHTML = badges.length ? badges.map(function (b) {
      return '<div class="cz-list-row"><span style="width:16px;height:16px;border-radius:50%;background:' + esc(b.colour) + ';display:inline-grid;place-items:center;font-size:10px">' + esc(b.icon) + '</span><span class="grow">' + esc(b.name) + '</span><button type="button" data-bdel="' + b.id + '" aria-label="Delete badge"><svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"/></svg></button></div>';
    }).join('') : '<div style="color:var(--text-tertiary)">No custom badges.</div>';
    $('badgeList').querySelectorAll('[data-bdel]').forEach(function (x) { x.onclick = function () { delBadge(x.getAttribute('data-bdel')); }; });
  }
  function paintCommands() {
    $('cmdList').innerHTML = commands.length ? commands.map(function (c) {
      return '<div class="cz-list-row"><b style="font-family:var(--font-mono,monospace)">' + esc(c.trigger) + '</b><span class="grow">' + esc(c.response) + ' · ' + c.cooldown + 's</span><button type="button" data-cdel="' + c.id + '" aria-label="Delete command"><svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"/></svg></button></div>';
    }).join('') : '<div style="color:var(--text-tertiary)">No commands.</div>';
    $('cmdList').querySelectorAll('[data-cdel]').forEach(function (x) { x.onclick = function () { delCmd(x.getAttribute('data-cdel')); }; });
  }
  async function delFolder(id) { if (!confirm('Delete this folder? Channels stay, unfiled.')) return; try { await req('/api/servers/' + SID + '/channel-folders?id=' + id, { method: 'DELETE' }); folders = (await req('/api/servers/' + SID + '/channel-folders')).folders || []; paintFolders(); paintPickers(); } catch (e) { msg('folderMsg', e.message, true); } }
  async function delBadge(id) { if (!confirm('Delete this badge from everyone?')) return; try { await req('/api/servers/' + SID + '/badges?id=' + id, { method: 'DELETE' }); badges = (await req('/api/servers/' + SID + '/badges')).badges || []; paintBadges(); paintPickers(); } catch (e) { msg('badgeMsg', e.message, true); } }
  async function delCmd(id) { try { await req('/api/servers/' + SID + '/commands?id=' + id, { method: 'DELETE' }); commands = (await req('/api/servers/' + SID + '/commands')).commands || []; paintCommands(); } catch (e) { msg('cmdMsg', e.message, true); } }

  async function boot() {
    T = await token();
    if (!T || !SID) { gate('Sign in and open this page from a server.'); return; }
    $('backServer').href = '/server/' + encodeURIComponent(SID);
    try { await loadAll(); $('scBody').hidden = false; }
    catch (e) { gate(e.message); return; }
    $('srvAccent').oninput = paintPreview; $('srvBanner').oninput = paintPreview; $('srvHeaderBanner').oninput = paintPreview;
    $('saveAppearance').onclick = async function () {
      try { await req('/api/servers/' + SID + '/appearance', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ accent: $('srvAccent').value, background: $('srvBanner').value.trim(), banner: $('srvHeaderBanner').value.trim() }) }); msg('appearanceMsg', 'Appearance saved.'); }
      catch (e) { msg('appearanceMsg', e.message, true); }
    };
    $('addFolder').onclick = async function () {
      try { await req('/api/servers/' + SID + '/channel-folders', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: $('folderName').value.trim(), parentId: $('folderParent').value || null }) }); $('folderName').value = ''; folders = (await req('/api/servers/' + SID + '/channel-folders')).folders || []; paintFolders(); paintPickers(); msg('folderMsg', 'Folder added.'); }
      catch (e) { msg('folderMsg', e.message, true); }
    };
    $('assign').onclick = async function () {
      try { await req('/api/servers/' + SID + '/channel-folders/assign', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ channelId: $('assignChannel').value, folderId: $('assignFolder').value || null }) }); msg('folderMsg', 'Channel filed.'); }
      catch (e) { msg('folderMsg', e.message, true); }
    };
    $('addBadge').onclick = async function () {
      try { await req('/api/servers/' + SID + '/badges', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: $('badgeName').value.trim(), icon: $('badgeIcon').value.trim() || '★', colour: $('badgeColour').value }) }); $('badgeName').value = ''; badges = (await req('/api/servers/' + SID + '/badges')).badges || []; paintBadges(); paintPickers(); msg('badgeMsg', 'Badge created.'); }
      catch (e) { msg('badgeMsg', e.message, true); }
    };
    $('grant').onclick = async function () {
      try { await req('/api/servers/' + SID + '/badges/grant', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ badgeId: $('grantBadge').value, userId: $('grantMember').value }) }); msg('badgeMsg', 'Badge granted.'); }
      catch (e) { msg('badgeMsg', e.message, true); }
    };
    $('saveWelcome').onclick = async function () {
      var steps = $('welcomeSteps').value.split(/\n+/).map(function (line) { var p = line.split('|'); return { title: (p[0] || '').trim(), body: (p.slice(1).join('|') || '').trim() }; }).filter(function (s) { return s.title || s.body; }).slice(0, 3);
      try { await req('/api/servers/' + SID + '/welcome', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ steps: steps, enabled: $('welcomeOn').checked }) }); msg('welcomeMsg', 'Welcome flow saved.'); }
      catch (e) { msg('welcomeMsg', e.message, true); }
    };
    $('addCmd').onclick = async function () {
      try { await req('/api/servers/' + SID + '/commands', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ trigger: $('cmdTrigger').value.trim(), response: $('cmdResponse').value.trim(), cooldown: parseInt($('cmdCooldown').value, 10) || 0 }) }); $('cmdTrigger').value = ''; $('cmdResponse').value = ''; commands = (await req('/api/servers/' + SID + '/commands')).commands || []; paintCommands(); msg('cmdMsg', 'Command added.'); }
      catch (e) { msg('cmdMsg', e.message, true); }
    };
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
