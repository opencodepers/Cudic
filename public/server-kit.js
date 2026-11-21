/* file: public/server-kit.js
 * what: the Server Kit pane inside /server-customize — channel icons, order,
 *   tags and welcome lines, category icons, server tags, the game card, named
 *   theme presets and the invite link.
 * invariants: the API enforces owner-only writes; this page only hides what it
 *   can. Every id it sends back came from the same server's kit read.
 */
(function () {
  var SID = new URLSearchParams(location.search).get('sid');
  var T = '', K = null, CH = [], FO = [], PR = [];
  function $(id) { return document.getElementById(id); }
  function apiHost() { return (typeof WS_URL !== 'undefined' && WS_URL) ? WS_URL.replace(/^wss?:\/\//, 'https://') : ''; }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  async function token() { try { if (window.getAuthToken) { var t = await window.getAuthToken(); if (t) return t; } var raw = localStorage.getItem('sb-qgcydphkaujomxyzwcht-auth-token'); var s = JSON.parse(raw); return (s && s.access_token) || raw; } catch (e) { return null; } }
  async function req(path, opts) {
    opts = opts || {};
    opts.headers = Object.assign({ Authorization: 'Bearer ' + T }, opts.headers || {});
    var r = await fetch(apiHost() + path, opts);
    var d = await r.json().catch(function () { return {}; });
    if (!r.ok) throw new Error(d.text || d.error || 'Request failed.');
    return d;
  }
  function note(text, bad) { var el = $('kitMsg'); if (el) { el.textContent = text || ''; el.style.color = bad ? 'var(--danger)' : 'var(--text-tertiary)'; } }

  // The pane's own nav button: server-customize.js wires its original five, so
  // this one shows the kit pane and steps aside when another is chosen.
  function wireNav() {
    var btn = document.querySelector('.czx-item[data-pane="kit"]');
    if (!btn) return;
    btn.addEventListener('click', function () {
      document.querySelectorAll('.czx-pane').forEach(function (p) { p.hidden = p.getAttribute('data-pane') !== 'kit'; });
      document.querySelectorAll('.czx-item').forEach(function (b) { b.classList.toggle('active', b === btn); });
    });
    document.querySelectorAll('.czx-item:not([data-pane="kit"])').forEach(function (b) {
      b.addEventListener('click', function () { var p = document.querySelector('.czx-pane[data-pane="kit"]'); if (p) p.hidden = true; });
    });
  }

  function channelRow(c, i) {
    var dis = K.owner ? '' : ' disabled';
    return '<div class="kit-chan" data-i="' + i + '" style="display:grid;grid-template-columns:44px 1fr 1fr 1fr 1.2fr 1fr auto;gap:8px;align-items:center;padding:8px 0;border-top:1px solid var(--line)">'
      + '<input data-f="icon" maxlength="4" value="' + esc(c.icon) + '" aria-label="Icon for ' + esc(c.name) + '" placeholder="#" style="text-align:center"' + dis + '>'
      + '<b style="font-weight:500;font-size:.85rem;overflow:hidden;text-overflow:ellipsis">#' + esc(c.name) + '</b>'
      + '<select data-f="type" aria-label="Type for ' + esc(c.name) + '" style="font-size:.78rem"' + dis + '>'
      + ['chat', 'announcement', 'qa'].map(function (t) { return '<option value="' + t + '"' + ((c.type || 'chat') === t ? ' selected' : '') + '>' + (t === 'qa' ? 'Q&A' : t) + '</option>'; }).join('')
      + '</select>'
      + '<input data-f="tags" value="' + esc((c.tags || []).join(', ')) + '" placeholder="tags, comma separated" maxlength="60" style="font-size:.8rem"' + dis + '>'
      + '<input data-f="welcome" value="' + esc(c.welcome) + '" placeholder="Line shown when the channel opens" maxlength="300" style="font-size:.8rem"' + dis + '>'
      + '<input data-f="labels" value="' + esc((c.labels || []).join(', ')) + '" placeholder="spoiler, nsfw" maxlength="60" style="font-size:.8rem"' + dis + '>'
      + '<span style="display:flex;gap:4px">'
      + '<button type="button" data-move="-1" title="Move up" aria-label="Move up"' + (i === 0 || !K.owner ? ' disabled' : '') + '><svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 19V5M6 11l6-6 6 6"/></svg></button>'
      + '<button type="button" data-move="1" title="Move down" aria-label="Move down"' + (i === CH.length - 1 || !K.owner ? ' disabled' : '') + '><svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 5v14M6 13l6 6 6-6"/></svg></button>'
      + '</span></div>';
  }

  function paint() {
    var pane = $('kitPane');
    if (!pane || !K) return;
    var s = K.server || {};
    var game = (s.meta && s.meta.game) || {};
    var dis = K.owner ? '' : ' disabled';
    var invite = s.invite_code ? (location.origin + '/join/' + s.invite_code) : '';
    pane.innerHTML = ''
      + '<div class="czx-cols">'
      + '<div><div class="cz-row"><label for="kitTags">Server tags</label><input id="kitTags" maxlength="120" placeholder="art, minecraft, friendly" value="' + esc((s.tags || []).join(', ')) + '"' + dis + '></div>'
      + '<div class="cz-row"><label for="kitFont">Interface font</label><select id="kitFont"' + dis + '>'
      + ['default', 'geist', 'mono', 'serif', 'rounded'].map(function (f) { return '<option value="' + f + '"' + ((s.theme && s.theme.font) === f || (f === 'default' && !(s.theme && s.theme.font)) ? ' selected' : '') + '>' + (f === 'default' ? 'Site default' : f) + '</option>'; }).join('')
      + '</select></div>'
      + '<div class="cz-row"><label for="kitGame">Game address</label><input id="kitGame" maxlength="120" placeholder="play.example.net" value="' + esc(game.address || '') + '"' + dis + '></div>'
      + '<div class="cz-row"><label for="kitGameNote">Game note</label><input id="kitGameNote" maxlength="200" placeholder="Season 4, whitelist on" value="' + esc(game.note || '') + '"' + dis + '></div>'
      + '<div class="cz-row"><label for="kitFeatured">Directory artwork</label><input id="kitFeatured" maxlength="500" placeholder="https://… (falls back to the banner)" value="' + esc((s.theme && s.theme.featured) || '') + '"' + dis + '></div>'
      + '<div class="cz-row"><label>Join questions</label><input class="kitJq" maxlength="120" placeholder="Question 1 (optional)" value="' + esc((s.join_questions || [])[0] || '') + '"' + dis + '><input class="kitJq" maxlength="120" placeholder="Question 2" value="' + esc((s.join_questions || [])[1] || '') + '"' + dis + ' style="margin-top:5px"><input class="kitJq" maxlength="120" placeholder="Question 3" value="' + esc((s.join_questions || [])[2] || '') + '"' + dis + ' style="margin-top:5px"></div>'
      + '<label style="display:flex;gap:7px;align-items:center;font-size:.82rem;margin:8px 0"><input type="checkbox" id="kitWeekly"' + (s.backup_weekly ? ' checked' : '') + dis + '> Weekly backup</label>'
      + '<div class="cz-line"><button class="primary" type="button" id="kitSaveIdentity"' + dis + '>Save server details</button><button type="button" id="kitBackupNow"' + dis + '>Back up now</button></div>'
      + '<div id="kitBackups" style="font-size:.76rem;color:var(--text-tertiary);margin-top:6px"></div>'
      + '</div>'
      + '<div><div class="cz-row"><label>Invite page</label><input value="' + esc(invite) + '" readonly></div>'
      + '<div class="cz-line"><button type="button" id="kitCopyInvite">Copy invite link</button><a class="cz-btn" href="' + esc(invite || '#') + '" target="_blank" rel="noopener">Preview</a></div>'
      + '<p class="sub" style="font-size:.76rem">The invite page shows the server name, rules, tags and a Join button. Anyone with the code can read it; joining still follows the server rules gate.</p>'
      + '</div></div>'
      + '<h3 style="margin:22px 0 4px;font:600 .8rem/1.4 var(--font-mono,monospace);letter-spacing:.08em;text-transform:uppercase;color:var(--text-tertiary)">Channels</h3>'
      + '<p class="sub" style="font-size:.76rem">Icon, tags, welcome line, labels and order. Four characters for an icon; three tags and three labels per channel.</p>'
      + '<div id="kitChannels">' + (CH.length ? CH.map(channelRow).join('') : '<p class="sub">No channels yet.</p>') + '</div>'
      + '<div class="cz-line" style="margin-top:8px"><button class="primary" type="button" id="kitSaveChannels"' + dis + '>Save channels</button></div>'
      + '<h3 style="margin:22px 0 4px;font:600 .8rem/1.4 var(--font-mono,monospace);letter-spacing:.08em;text-transform:uppercase;color:var(--text-tertiary)">Categories</h3>'
      + '<div id="kitFolders">' + (FO.length ? FO.map(function (f) {
        return '<div style="display:flex;gap:8px;align-items:center;padding:6px 0;border-top:1px solid var(--line)"><input data-fid="' + esc(f.id) + '" maxlength="4" value="' + esc(f.icon) + '" aria-label="Icon for ' + esc(f.name) + '" placeholder="—" style="width:44px;text-align:center"' + dis + '><span style="font-size:.85rem">' + esc(f.name) + '</span></div>';
      }).join('') : '<p class="sub">No categories yet.</p>') + '</div>'
      + '<div class="cz-line" style="margin-top:8px"><button type="button" id="kitSaveFolders"' + dis + '>Save category icons</button></div>'
      + '<h3 style="margin:22px 0 4px;font:600 .8rem/1.4 var(--font-mono,monospace);letter-spacing:.08em;text-transform:uppercase;color:var(--text-tertiary)">Theme presets</h3>'
      + '<p class="sub" style="font-size:.76rem">A preset stores an accent, a background image and a font. Applying one replaces the server theme; members keep their own pack.</p>'
      + '<div class="czx-cols"><div>'
      + '<div class="cz-row"><label for="preName">Name</label><input id="preName" maxlength="32" placeholder="Event night"' + dis + '></div>'
      + '<div class="cz-row"><label for="preAccent">Accent</label><input id="preAccent" type="color" value="#FF8C1A"' + dis + '></div>'
      + '<div class="cz-row"><label for="preBg">Background</label><input id="preBg" maxlength="300" placeholder="https://…"' + dis + '></div>'
      + '<div class="cz-row"><label for="preFont">Font</label><select id="preFont"' + dis + '><option value="">Site default</option><option value="geist">geist</option><option value="mono">mono</option><option value="serif">serif</option><option value="rounded">rounded</option></select></div>'
      + '<div class="cz-line"><button type="button" id="preSave"' + dis + '>Save preset</button></div>'
      + '</div><div id="preList">' + (PR.length ? PR.map(function (p) {
        var th = p.theme || {};
        return '<div style="display:flex;gap:8px;align-items:center;padding:8px 0;border-top:1px solid var(--line)"><span style="width:14px;height:14px;border-radius:3px;background:' + esc(th.accent || '#888') + '"></span><b style="flex:1;font-weight:500;font-size:.85rem">' + esc(p.name) + '</b><button type="button" data-apply="' + esc(p.id) + '"' + dis + '>Apply</button><button type="button" data-del="' + esc(p.id) + '"' + dis + '>Delete</button></div>';
      }).join('') : '<p class="sub">No presets yet.</p>') + '</div></div>'
      + '<p id="kitMsg" class="cz-msg" style="margin-top:10px;color:var(--text-tertiary)"></p>';
    bind();
  }

  function collectChannels() {
    var rows = [].slice.call(document.querySelectorAll('#kitChannels .kit-chan'));
    return rows.map(function (row) {
      var c = CH[+row.getAttribute('data-i')];
      return {
        id: c.id,
        icon: row.querySelector('[data-f="icon"]').value.trim(),
        tags: row.querySelector('[data-f="tags"]').value.split(',').map(function (s) { return s.trim(); }).filter(Boolean),
        welcome: row.querySelector('[data-f="welcome"]').value.trim(),
        type: row.querySelector('[data-f="type"]').value,
        labels: row.querySelector('[data-f="labels"]').value.split(',').map(function (x) { return x.trim().toLowerCase(); }).filter(Boolean),
      };
    });
  }

  function bind() {
    if (!K || !K.owner) return;
    var saveIdentity = $('kitSaveIdentity');
    if (saveIdentity) saveIdentity.onclick = async function () {
      try {
        await req('/api/servers/' + SID + '/kit', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
          tags: $('kitTags').value.split(',').map(function (s) { return s.trim(); }).filter(Boolean),
          font: $('kitFont').value,
          game: { address: $('kitGame').value, note: $('kitGameNote').value },
          featured: $('kitFeatured') ? $('kitFeatured').value : '',
          joinQuestions: [].slice.call(document.querySelectorAll('.kitJq')).map(function (i) { return i.value.trim(); }).filter(Boolean),
          backupWeekly: $('kitWeekly') ? $('kitWeekly').checked : false,
        }) });
        note('Server details saved.');
        await load();
      } catch (e) { note(e.message, true); }
    };
    var backupNow = $('kitBackupNow');
    if (backupNow) backupNow.onclick = async function () {
      try {
        var b = await req('/api/servers/' + SID + '/backups', { method: 'POST' });
        note('Backup saved: ' + (b.counts ? b.counts.channels + ' channels, ' + b.counts.members + ' members' : 'done') + '.');
        loadBackups();
      } catch (e) { note(e.message, true); }
    };
    var copy = $('kitCopyInvite');
    if (copy) copy.onclick = function () {
      var v = (location.origin + '/join/' + ((K.server && K.server.invite_code) || ''));
      if (navigator.clipboard) navigator.clipboard.writeText(v).then(function () { note('Invite link copied.'); });
    };
    var saveCh = $('kitSaveChannels');
    if (saveCh) saveCh.onclick = async function () {
      try {
        await req('/api/servers/' + SID + '/kit/channels', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
          channels: collectChannels(), order: CH.map(function (c) { return c.id; }),
        }) });
        note('Channels saved.');
        await load();
      } catch (e) { note(e.message, true); }
    };
    var saveFo = $('kitSaveFolders');
    if (saveFo) saveFo.onclick = async function () {
      try {
        var folders = [].slice.call(document.querySelectorAll('#kitFolders [data-fid]')).map(function (el) {
          return { id: el.getAttribute('data-fid'), icon: el.value.trim() };
        });
        await req('/api/servers/' + SID + '/kit/channels', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ folders: folders }) });
        note('Category icons saved.');
        await load();
      } catch (e) { note(e.message, true); }
    };
    var preSave = $('preSave');
    if (preSave) preSave.onclick = async function () {
      try {
        await req('/api/servers/' + SID + '/kit/presets', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
          name: $('preName').value, accent: $('preAccent').value,
          background: $('preBg').value, font: $('preFont').value,
        }) });
        note('Preset saved.');
        await load();
      } catch (e) { note(e.message, true); }
    };
    document.querySelectorAll('#preList [data-apply]').forEach(function (b) {
      b.onclick = async function () {
        try {
          await req('/api/servers/' + SID + '/kit/presets/' + b.getAttribute('data-apply') + '/apply', { method: 'POST' });
          note('Preset applied. Reload the server page to see it.');
          await load();
        } catch (e) { note(e.message, true); }
      };
    });
    document.querySelectorAll('#preList [data-del]').forEach(function (b) {
      b.onclick = async function () {
        try {
          await req('/api/servers/' + SID + '/kit/presets/' + b.getAttribute('data-del'), { method: 'DELETE' });
          note('Preset removed.');
          await load();
        } catch (e) { note(e.message, true); }
      };
    });
    document.querySelectorAll('#kitChannels [data-move]').forEach(function (b) {
      b.onclick = function () {
        var row = b.closest('.kit-chan');
        var i = +row.getAttribute('data-i');
        var j = i + +b.getAttribute('data-move');
        if (j < 0 || j >= CH.length) return;
        var tmp = CH[i]; CH[i] = CH[j]; CH[j] = tmp;
        paint();
      };
    });
  }

  async function loadBackups() {
    var box = $('kitBackups');
    if (!box || !K || !K.owner) return;
    try {
      var d = await req('/api/servers/' + SID + '/backups');
      var rows = d.backups || [];
      box.innerHTML = rows.length
        ? 'Backups: ' + rows.map(function (b) { return '<a href="' + apiHost() + '/api/servers/' + SID + '/backups/' + b.id + '" download style="color:var(--signal);margin-right:8px">' + esc(new Date(b.created_at).toLocaleDateString()) + '</a>'; }).join('')
        : (d.weekly ? 'Weekly backups are on; the first one is being written.' : 'No backups yet.');
    } catch (e) { box.textContent = ''; }
  }

  async function load() {
    try {
      T = (await token()) || '';
      if (!T) { note('Sign in to use the server kit.', true); return; }
      K = await req('/api/servers/' + SID + '/kit');
      CH = K.channels || []; FO = K.folders || []; PR = K.presets || [];
      paint();
      loadBackups();
    } catch (e) { note(e.message, true); }
  }

  wireNav();
  if (SID) load();
})();
