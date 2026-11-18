/* file: public/server-community.js
 * what: one page for the community pack — prompts, spotlight, suggestions and
 *   votes, LFG, game nights/public events, member cards with nicknames, titles,
 *   status and intro tags, warnings, and the owner's inactivity read.
 * invariants: the API decides who may write; this page only renders the forms
 *   the role allows. Everything user-written is escaped before it reaches HTML.
 *   With no explicit sid, the page picks one of the signed-in user's servers and
 *   rewrites the URL, so /server-community is a usable direct link.
 */
(function () {
  function urlSid() {
    try {
      var q = new URLSearchParams(location.search);
      var direct = q.get('sid') || q.get('id') || q.get('server');
      if (direct) return direct;
      var fromPath = /^\/server\/([A-Za-z0-9-]{6,50})\/?$/.exec(location.pathname);
      if (fromPath) return fromPath[1];
      var fromRef = /\/server\/([A-Za-z0-9-]{6,50})(?:[/?#]|$)/.exec(document.referrer || '');
      if (fromRef) return fromRef[1];
      var last = localStorage.getItem('cudic_last_server');
      return last || '';
    } catch (e) { return ''; }
  }
  var SID = urlSid();
  var T = '', D = null;
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
  function msg(id, text, bad) { var el = $(id); if (el) { el.textContent = text || ''; el.className = 'cm-msg' + (bad ? ' bad' : ''); } }
  function ago(iso) {
    if (!iso) return 'never';
    var s = Math.floor((Date.now() - Date.parse(iso)) / 1000);
    if (s < 60) return 'just now';
    if (s < 3600) return Math.floor(s / 60) + 'm ago';
    if (s < 86400) return Math.floor(s / 3600) + 'h ago';
    if (s < 2592000) return Math.floor(s / 86400) + 'd ago';
    if (s < 31536000) return Math.floor(s / 2592000) + 'mo ago';
    return Math.floor(s / 31536000) + 'y ago';
  }
  function joined(iso) {
    if (!iso) return '';
    var d = new Date(iso), now = new Date();
    var years = now.getFullYear() - d.getFullYear();
    var today = now.getMonth() === d.getMonth() && now.getDate() === d.getDate();
    return (years > 0 ? years + 'y' : Math.max(0, Math.floor((Date.now() - Date.parse(iso)) / 2592000000)) + 'mo') + (today && years > 0 ? ' · anniversary today' : '');
  }

  function renderWarnings() {
    var box = $('cmWarnings');
    var rows = (D && D.warnings) || [];
    if (!rows.length) { box.innerHTML = ''; return; }
    box.innerHTML = rows.map(function (w) {
      return '<div class="cm-warn"><b>Warning from the owner</b><p class="cm-muted" style="margin:4px 0 8px;color:var(--text-primary)">' + esc(w.reason) + '</p>'
        + '<button type="button" class="small" data-ack="' + esc(w.id) + '">I understand</button></div>';
    }).join('');
    box.querySelectorAll('[data-ack]').forEach(function (b) {
      b.onclick = async function () {
        try { await req('/api/servers/' + SID + '/warnings/' + b.getAttribute('data-ack') + '/ack', { method: 'POST' }); await load(); }
        catch (e) { alert(e.message); }
      };
    });
  }

  function renderOverview() {
    var p = D.prompts || {};
    var html = '';
    html += '<div class="cm-card"><h2>Prompt of the day</h2>'
      + (p.daily ? '<div class="cm-prompt">' + esc(p.daily.body) + '</div><div class="cm-muted">Set for ' + esc(p.daily.active_on) + '</div>'
        : '<div class="cm-empty">No prompt yet today.</div>')
      + (D.owner ? '<div class="cm-row" style="margin-top:10px"><input id="dailyPrompt" maxlength="300" placeholder="What should the server talk about today?"><button type="button" class="primary" id="saveDaily">Set prompt</button></div><div class="cm-msg" id="dailyMsg"></div>' : '')
      + '</div>';
    html += '<div class="cm-card"><h2>Weekly topic</h2>'
      + (p.weekly ? '<div class="cm-prompt">' + esc(p.weekly.body) + '</div><div class="cm-muted">Week of ' + esc(p.weekly.active_on) + '</div>'
        : '<div class="cm-empty">No topic for this week.</div>')
      + (D.owner ? '<div class="cm-row" style="margin-top:10px"><input id="weeklyPrompt" maxlength="300" placeholder="A topic for the whole week"><button type="button" class="primary" id="saveWeekly">Set topic</button></div><div class="cm-msg" id="weeklyMsg"></div>' : '')
      + '</div>';
    var spot = D.spotlight;
    html += '<div class="cm-card"><h2>Spotlight</h2>'
      + (spot ? '<h3>' + esc(spot.name) + '</h3><p class="cm-muted" style="color:var(--text-secondary);font-size:.88rem">' + esc(spot.blurb || 'A member worth knowing.') + '</p>'
        : '<div class="cm-empty">No spotlight right now.</div>')
      + (D.owner ? '<div class="cm-row" style="margin-top:10px"><select id="spotUser"><option value="">Choose a member…</option>'
        + D.roster.map(function (m) { return '<option value="' + esc(m.user_id) + '">' + esc(m.nickname || m.name) + '</option>'; }).join('')
        + '</select><input id="spotBlurb" maxlength="240" placeholder="Why them?"><button type="button" class="primary" id="saveSpot">Spotlight</button>'
        + (spot ? '<button type="button" id="clearSpot">Clear</button>' : '') + '</div><div class="cm-msg" id="spotMsg"></div>' : '')
      + '</div>';
    var next = (D.nights || [])[0];
    html += '<div class="cm-card"><h2>Next up</h2>'
      + (next ? '<div class="cm-night"><div><h3>' + esc(next.title) + '</h3><div class="cm-muted">' + (next.game ? esc(next.game) + ' · ' : '') + (next.is_public ? 'Public' : 'Members only') + (next.note ? ' · ' + esc(next.note) : '') + '</div></div><time>' + esc(new Date(next.starts_at).toLocaleString()) + '</time></div>'
        : '<div class="cm-empty">Nothing scheduled yet. Owners and mods can add a game night.</div>')
      + '<div class="cm-row" style="margin-top:10px"><button type="button" data-tabjump="suggestions">Suggestions (' + D.suggestions.length + ')</button><button type="button" data-tabjump="lfg">LFG (' + D.lfg.length + ')</button><button type="button" data-tabjump="members">Members (' + D.roster.length + ')</button></div>'
      + '</div>';
    $('cmOverview').innerHTML = html;
    $('cmOverview').querySelectorAll('[data-tabjump]').forEach(function (b) {
      b.onclick = function () { showTab(b.getAttribute('data-tabjump')); };
    });
    if (D.owner) {
      $('saveDaily').onclick = function () { savePrompt('daily', $('dailyPrompt').value, 'dailyMsg'); };
      $('saveWeekly').onclick = function () { savePrompt('weekly', $('weeklyPrompt').value, 'weeklyMsg'); };
      $('saveSpot').onclick = async function () {
        try {
          await req('/api/servers/' + SID + '/spotlight', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ user_id: $('spotUser').value, blurb: $('spotBlurb').value }) });
          await load();
        } catch (e) { msg('spotMsg', e.message, true); }
      };
      if ($('clearSpot')) $('clearSpot').onclick = async function () {
        try { await req('/api/servers/' + SID + '/spotlight', { method: 'DELETE' }); await load(); } catch (e) { msg('spotMsg', e.message, true); }
      };
    }
  }

  async function savePrompt(kind, body, id) {
    try {
      await req('/api/servers/' + SID + '/prompts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ kind: kind, body: body }) });
      await load();
    } catch (e) { msg(id, e.message, true); }
  }

  function renderSuggestions() {
    var rows = D.suggestions.slice().sort(function (a, b) { return (b.votes - a.votes) || String(b.created_at).localeCompare(String(a.created_at)); });
    var html = '<div class="cm-card"><h2>New suggestion</h2><div class="cm-row"><input id="sugTitle" maxlength="80" placeholder="A short title"><button type="button" class="primary" id="sugPost">Post</button></div>'
      + '<textarea id="sugBody" rows="2" maxlength="600" placeholder="Why it would help (optional)" style="width:100%;margin-top:8px"></textarea><div class="cm-msg" id="sugMsg"></div></div>';
    html += '<div class="cm-card"><h2>' + rows.length + ' suggestion' + (rows.length === 1 ? '' : 's') + '</h2><div class="cm-list">'
      + (rows.length ? rows.map(function (s) {
        return '<div class="cm-item"><div class="cm-row" style="align-items:flex-start"><button type="button" class="small' + (s.mine ? ' primary' : '') + '" data-vote="' + esc(s.id) + '">▲ ' + s.votes + '</button>'
          + '<div style="flex:1"><b>' + esc(s.title) + '</b><div class="cm-muted">' + esc(s.body || '') + '</div>'
          + '<div class="cm-muted" style="font-size:.72rem;margin-top:4px">' + esc(s.name) + ' · ' + ago(s.created_at) + ' · ' + esc(s.status) + '</div></div>'
          + (D.mod ? '<select data-status="' + esc(s.id) + '">' + ['open', 'planned', 'done', 'declined'].map(function (v) { return '<option value="' + v + '"' + (s.status === v ? ' selected' : '') + '>' + v + '</option>'; }).join('') + '</select>' : '')
          + '</div></div>';
      }).join('') : '<div class="cm-empty">No suggestions yet — be the first.</div>') + '</div></div>';
    $('cmSuggestions').innerHTML = html;
    $('sugPost').onclick = async function () {
      try {
        await req('/api/servers/' + SID + '/suggestions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: $('sugTitle').value, body: $('sugBody').value }) });
        await load();
      } catch (e) { msg('sugMsg', e.message, true); }
    };
    $('cmSuggestions').querySelectorAll('[data-vote]').forEach(function (b) {
      b.onclick = async function () {
        try { await req('/api/servers/' + SID + '/suggestions/' + b.getAttribute('data-vote') + '/vote', { method: 'POST' }); await load(); } catch (e) { msg('sugMsg', e.message, true); }
      };
    });
    $('cmSuggestions').querySelectorAll('[data-status]').forEach(function (s) {
      s.onchange = async function () {
        try { await req('/api/servers/' + SID + '/suggestions/' + s.getAttribute('data-status'), { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: s.value }) }); await load(); } catch (e) { msg('sugMsg', e.message, true); }
      };
    });
  }

  function renderLfg() {
    var html = '<div class="cm-card"><h2>Looking for group</h2><div class="cm-row"><input id="lfgGame" maxlength="60" placeholder="Game"><input id="lfgWhen" type="datetime-local"><input id="lfgSlots" type="number" min="2" max="20" value="4" style="max-width:80px" title="Slots"><button type="button" class="primary" id="lfgPost">Post</button></div>'
      + '<input id="lfgNote" maxlength="200" placeholder="Rank, region, what you need (optional)" style="width:100%;margin-top:8px"><div class="cm-msg" id="lfgMsg"></div></div>';
    html += '<div class="cm-card"><h2>' + D.lfg.length + ' open</h2><div class="cm-list">'
      + (D.lfg.length ? D.lfg.map(function (l) {
        var owner = l.user_id === D.me_id || D.mod;
        return '<div class="cm-item"><div class="cm-night"><div><b>' + esc(l.game) + '</b>' + (l.note ? ' <span class="cm-muted">· ' + esc(l.note) + '</span>' : '')
          + '<div class="cm-muted" style="font-size:.72rem">' + (l.starts_at ? new Date(l.starts_at).toLocaleString() : 'any time') + ' · ' + l.slots + ' slots</div></div>'
          + (owner ? '<button type="button" class="small danger" data-lfgdel="' + esc(l.id) + '">Remove</button>' : '') + '</div></div>';
      }).join('') : '<div class="cm-empty">No open posts.</div>') + '</div></div>';
    $('cmLfg').innerHTML = html;
    $('lfgPost').onclick = async function () {
      try {
        await req('/api/servers/' + SID + '/lfg', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ game: $('lfgGame').value, note: $('lfgNote').value, slots: $('lfgSlots').value, starts_at: $('lfgWhen').value || null }) });
        await load();
      } catch (e) { msg('lfgMsg', e.message, true); }
    };
    $('cmLfg').querySelectorAll('[data-lfgdel]').forEach(function (b) {
      b.onclick = async function () {
        try { await req('/api/servers/' + SID + '/lfg/' + b.getAttribute('data-lfgdel'), { method: 'DELETE' }); await load(); } catch (e) { msg('lfgMsg', e.message, true); }
      };
    });
  }

  function renderNights() {
    var html = '';
    if (D.mod) {
      html += '<div class="cm-card"><h2>Schedule a night</h2><div class="cm-row"><input id="nightTitle" maxlength="80" placeholder="Friday Minecraft"><input id="nightGame" maxlength="60" placeholder="Game"><input id="nightWhen" type="datetime-local"><button type="button" class="primary" id="nightPost">Add</button></div>'
        + '<div class="cm-row" style="margin-top:8px"><input id="nightNote" maxlength="240" placeholder="Note (optional)" style="flex:1"><label class="cm-muted" style="display:flex;gap:6px;align-items:center"><input type="checkbox" id="nightPublic" checked style="min-width:0"> Public</label></div><div class="cm-msg" id="nightMsg"></div></div>';
    }
    html += '<div class="cm-card"><h2>Upcoming</h2><div class="cm-list">'
      + (D.nights.length ? D.nights.map(function (n) {
        return '<div class="cm-item"><div class="cm-night"><div><b>' + esc(n.title) + '</b><div class="cm-muted">' + (n.game ? esc(n.game) + ' · ' : '') + (n.is_public ? 'Public event' : 'Members only') + (n.note ? ' · ' + esc(n.note) : '') + '</div></div>'
          + '<span class="cm-row"><time>' + esc(new Date(n.starts_at).toLocaleString()) + '</time>' + (D.mod ? '<button type="button" class="small danger" data-nightdel="' + esc(n.id) + '">×</button>' : '') + '</span></div></div>';
      }).join('') : '<div class="cm-empty">No nights scheduled.</div>') + '</div></div>';
    $('cmNights').innerHTML = html;
    if (D.mod) {
      $('nightPost').onclick = async function () {
        try {
          await req('/api/servers/' + SID + '/nights', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: $('nightTitle').value, game: $('nightGame').value, note: $('nightNote').value, starts_at: $('nightWhen').value, is_public: $('nightPublic').checked }) });
          await load();
        } catch (e) { msg('nightMsg', e.message, true); }
      };
      $('cmNights').querySelectorAll('[data-nightdel]').forEach(function (b) {
        b.onclick = async function () {
          try { await req('/api/servers/' + SID + '/nights/' + b.getAttribute('data-nightdel'), { method: 'DELETE' }); await load(); } catch (e) { msg('nightMsg', e.message, true); }
        };
      });
    }
  }

  function renderMembers() {
    var html = '<div class="cm-card"><h2>Members</h2><div class="cm-row"><input id="memberSearch" placeholder="Search name, nickname, title or tag"><span class="cm-muted" id="memberCount">' + D.roster.length + '</span></div></div>'
      + '<div class="cm-grid" id="memberGrid">' + D.roster.map(memberCard).join('') + '</div>';
    if (D.owner) html += '<div class="cm-card" style="margin-top:14px"><h2>Inactivity</h2><p class="cm-muted">Members with no message in the window. Nobody is removed automatically.</p><div class="cm-row" style="margin-top:8px"><select id="inactiveDays"><option value="30">30 days</option><option value="60">60 days</option><option value="90">90 days</option><option value="180">180 days</option></select><button type="button" id="loadInactive">Check</button></div><div id="inactiveList" style="margin-top:10px"></div></div>';
    $('cmMembers').innerHTML = html;
    var search = $('memberSearch');
    search.oninput = function () {
      var q = search.value.toLowerCase();
      $('memberGrid').querySelectorAll('.cm-member').forEach(function (el) {
        el.hidden = q && el.textContent.toLowerCase().indexOf(q) < 0;
      });
    };
    $('cmMembers').querySelectorAll('[data-title]').forEach(function (b) {
      b.onclick = async function () {
        var uid = b.getAttribute('data-title');
        var val = $('title-' + uid).value;
        try { await req('/api/servers/' + SID + '/community/members/' + uid, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: val }) }); await load(); } catch (e) { alert(e.message); }
      };
    });
    $('cmMembers').querySelectorAll('[data-warn]').forEach(function (b) {
      b.onclick = async function () {
        var reason = prompt('Reason for the warning:');
        if (!reason) return;
        try { await req('/api/servers/' + SID + '/warnings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ user_id: b.getAttribute('data-warn'), reason: reason }) }); alert('Warning issued.'); } catch (e) { alert(e.message); }
      };
    });
    $('cmMembers').querySelectorAll('[data-spot]').forEach(function (b) {
      b.onclick = async function () {
        var blurb = prompt('Spotlight blurb for this member:');
        if (blurb === null) return;
        try { await req('/api/servers/' + SID + '/spotlight', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ user_id: b.getAttribute('data-spot'), blurb: blurb }) }); await load(); } catch (e) { alert(e.message); }
      };
    });
    if (D.owner) {
      $('loadInactive').onclick = async function () {
        var box = $('inactiveList');
        box.innerHTML = '<div class="cm-empty">Checking…</div>';
        try {
          var d = await req('/api/servers/' + SID + '/inactive?days=' + $('inactiveDays').value);
          box.innerHTML = d.inactive.length ? '<div class="cm-list">' + d.inactive.map(function (m) {
            return '<div class="cm-item cm-row"><span style="flex:1"><b>' + esc(m.name) + '</b> <span class="cm-muted">· ' + esc(m.role) + '</span></span><span class="cm-muted">' + (m.last_message_at ? ago(m.last_message_at) : 'never posted') + '</span></div>';
          }).join('') + '</div>' : '<div class="cm-empty">Everyone has posted inside ' + d.days + ' days.</div>';
        } catch (e) { box.innerHTML = '<div class="cm-empty">' + esc(e.message) + '</div>'; }
      };
    }
  }

  function memberCard(m) {
    var name = m.nickname || m.name;
    var ava = m.avatar ? '<img src="' + esc(m.avatar) + '" alt="" loading="lazy" onerror="this.remove()">' : esc(String(name).slice(0, 2).toUpperCase());
    return '<div class="cm-member"><div class="cm-member-head"><span class="cm-ava">' + ava + '</span><div style="min-width:0"><div class="cm-member-name">' + esc(name) + (m.title ? ' <span class="cm-member-role" style="border:1px solid var(--line);border-radius:999px;padding:2px 6px">' + esc(m.title) + '</span>' : '') + '</div>'
      + '<div class="cm-member-role">' + esc(m.role) + (m.joined_at ? ' · ' + esc(joined(m.joined_at)) : '') + '</div></div></div>'
      + (m.status ? '<p class="cm-muted" style="margin:7px 0 0">' + esc(m.status) + '</p>' : '')
      + (m.intro ? '<p class="cm-muted" style="margin:6px 0 0;color:var(--text-secondary)">' + esc(m.intro) + '</p>' : '')
      + ((m.intro_tags || []).length ? '<div class="cm-tags">' + m.intro_tags.map(function (t) { return '<span>' + esc(t) + '</span>'; }).join('') + '</div>' : '')
      + (D.owner && m.role !== 'owner' ? '<div class="cm-row" style="margin-top:8px"><input id="title-' + esc(m.user_id) + '" maxlength="32" value="' + esc(m.title) + '" placeholder="Title"><button type="button" class="small" data-title="' + esc(m.user_id) + '">Title</button><button type="button" class="small" data-warn="' + esc(m.user_id) + '">Warn</button><button type="button" class="small" data-spot="' + esc(m.user_id) + '">Spotlight</button></div>' : '')
      + '</div>';
  }

  function renderMe() {
    var me = D.me || {};
    $('cmMe').innerHTML = '<div class="cm-card"><h2>Your card in ' + esc(D.server.name) + '</h2>'
      + '<p class="cm-muted">Only members of this server see the card. Your account name and avatar stay as they are.</p>'
      + '<div class="cm-row" style="margin-top:10px"><input id="meNick" maxlength="24" placeholder="Nickname" value="' + esc(me.nickname) + '"><input id="meStatus" maxlength="80" placeholder="Status — what are you working on?" value="' + esc(me.status) + '"></div>'
      + '<textarea id="meIntro" rows="4" maxlength="400" placeholder="Intro card: who you are, what you build, what you want to play" style="width:100%;margin-top:8px">' + esc(me.intro) + '</textarea>'
      + '<div class="cm-row" style="margin-top:8px"><input id="meTags" maxlength="120" placeholder="Tags, comma separated" value="' + esc((me.intro_tags || []).join(', ')) + '"><button type="button" class="primary" id="meSave">Save card</button></div>'
      + (me.title ? '<p class="cm-muted" style="margin-top:8px">Title from the owner: <b style="color:var(--text-primary)">' + esc(me.title) + '</b></p>' : '')
      + '<div class="cm-msg" id="meMsg"></div></div>';
    $('meSave').onclick = async function () {
      try {
        await req('/api/servers/' + SID + '/me', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ nickname: $('meNick').value, status: $('meStatus').value, intro: $('meIntro').value, intro_tags: $('meTags').value.split(',').map(function (s) { return s.trim(); }).filter(Boolean) }) });
        await load();
      } catch (e) { msg('meMsg', e.message, true); }
    };
  }

  function showTab(name) {
    document.querySelectorAll('.cm-tab').forEach(function (b) { b.classList.toggle('active', b.getAttribute('data-tab') === name); });
    document.querySelectorAll('.cm-pane').forEach(function (s) { s.hidden = s.getAttribute('data-pane') !== name; });
  }

  function renderAll() {
    $('cmName').textContent = D.server.name || 'Community';
    $('cmSub').textContent = D.roster.length + ' member' + (D.roster.length === 1 ? '' : 's') + ' · ' + D.suggestions.length + ' suggestion' + (D.suggestions.length === 1 ? '' : 's') + ' · ' + D.nights.length + ' upcoming';
    $('cmRole').hidden = false;
    $('cmRole').textContent = D.role + ' view';
    $('cmServerLink').href = '/server/' + encodeURIComponent(SID);
    renderWarnings(); renderOverview(); renderSuggestions(); renderLfg(); renderNights(); renderMembers(); renderMe();
  }

  async function load() {
    try {
      if (!SID) { $('cmSub').textContent = 'No server yet — join or create one first.'; return; }
      D = await req('/api/servers/' + SID + '/community');
      renderAll();
    } catch (e) { $('cmSub').textContent = e.message; }
  }

  async function start() {
    T = (await token()) || '';
    if (!T) { $('cmSub').textContent = 'Sign in to open a server community.'; return; }
    if (!SID) {
      $('cmSub').textContent = 'Choosing one of your servers…';
      try {
        var home = await req('/api/home');
        var list = (home && home.servers) || [];
        if (list.length) {
          SID = list[0].id;
          var here = new URL(location.href);
          here.searchParams.set('sid', SID);
          history.replaceState(null, '', here.pathname + '?' + here.searchParams.toString());
        }
      } catch (e) {}
    }
    await load();
  }

  document.querySelectorAll('.cm-tab').forEach(function (b) { b.onclick = function () { showTab(b.getAttribute('data-tab')); }; });
  start();
})();
