/* file: public/server-next.js
 * what: the inline Community dock on a server page — member cards, my server
 *   card, spotlight, daily/weekly prompts, suggestions, LFG, game nights,
 *   warnings, inactivity and channel labels.
 * invariants: every write goes through the existing server API; the dock only
 *   shows forms the API role allows, all member text is escaped, and the server
 *   id is read from the page object or the URL so a refreshed server page works.
 * see: public/server-community.js, lib/routes/pack.js, AGENTS.md.
 */
(function () {
  'use strict';

  var TABS = [
    ['members', 'Members'],
    ['me', 'My card'],
    ['spotlight', 'Spotlight'],
    ['prompts', 'Prompts'],
    ['suggestions', 'Suggestions'],
    ['lfg', 'LFG'],
    ['nights', 'Nights'],
    ['warnings', 'Warnings'],
    ['inactive', 'Inactive'],
    ['labels', 'Labels']
  ];
  var D = null;
  var tab = 'members';
  var dock = null;
  var backdrop = null;
  var body = null;
  var tabs = null;
  var warnBox = null;
  var statusBox = null;
  var launchBtn = null;
  var busy = false;
  var bootTries = 0;

  function page() { return window.cudicServerPage || null; }
  function sid() {
    var p = page();
    if (p && p.sid) return String(p.sid);
    var fromPath = /^\/server\/([A-Za-z0-9-]{6,50})\/?$/.exec(location.pathname);
    if (fromPath) return fromPath[1];
    try {
      var q = new URLSearchParams(location.search);
      return q.get('sid') || q.get('id') || q.get('server') || '';
    } catch (e) { return ''; }
  }
  function syncFull() {
    var full = document.getElementById('snFull');
    if (!full) return;
    full.href = sid() ? '/server-community?sid=' + encodeURIComponent(sid()) : '/server-community';
  }
  function host() {
    var p = page();
    if (!p) return '';
    return typeof p.apiHost === 'function' ? p.apiHost() : (p.apiHost || '');
  }
  function auth(extra) {
    var p = page();
    if (p && typeof p.headers === 'function') return p.headers(extra || {});
    return extra || {};
  }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function val(id) {
    var el = document.getElementById(id);
    return el ? el.value : '';
  }
  function isoWhen(v) {
    if (!v) return null;
    var d = new Date(v);
    return isNaN(d.getTime()) ? null : d.toISOString();
  }
  function when(iso) {
    if (!iso) return '';
    var d = new Date(iso);
    return isNaN(d.getTime()) ? '' : d.toLocaleString();
  }
  function joined(iso) {
    if (!iso) return '';
    var d = new Date(iso);
    var months = Math.max(0, Math.floor((Date.now() - d.getTime()) / 2592000000));
    var years = Math.floor(months / 12);
    var label = years ? years + (years === 1 ? ' year' : ' years') : months + (months === 1 ? ' month' : ' months');
    var now = new Date();
    if (d.getMonth() === now.getMonth() && d.getDate() === now.getDate()) label += ' · anniversary today';
    return label;
  }
  function status(text, bad) {
    if (!statusBox) return;
    statusBox.textContent = text || '';
    statusBox.className = 'sn-status' + (bad ? ' bad' : '');
  }

  async function authReady() {
    var p = page();
    if (!p || !p.ready || typeof p.ready.then !== 'function') return true;
    try { return !!(await p.ready); } catch (e) { return false; }
  }

  async function req(path, opts) {
    opts = opts || {};
    opts.headers = auth(opts.headers || {});
    if (opts.body && !opts.headers['Content-Type'] && !opts.headers['content-type']) {
      opts.headers['Content-Type'] = 'application/json';
    }
    var r = await fetch(host() + path, opts);
    var d = await r.json().catch(function () { return {}; });
    if (!r.ok) throw new Error(d.text || d.error || 'Request failed.');
    return d;
  }

  function avatar(m) {
    if (m.avatar) return '<img src="' + esc(m.avatar) + '" alt="">';
    return esc((m.nickname || m.name || '?').slice(0, 1).toUpperCase());
  }

  function roleName(role) {
    return role === 'owner' ? 'Owner' : role === 'mod' ? 'Mod' : 'Member';
  }

  function renderWarnings() {
    if (!warnBox || !D) return;
    var rows = (D.warnings || []);
    warnBox.innerHTML = rows.length ? rows.map(function (w) {
      return '<div class="sn-warning"><b>Warning from the owner</b><p>' + esc(w.reason) + '</p>'
        + '<button type="button" data-sn="ack" data-id="' + esc(w.id) + '">I understand</button></div>';
    }).join('') : '';
  }

  function renderMembers() {
    if (!D.roster.length) return '<p class="sn-empty">No members loaded.</p>';
    return '<div class="sn-grid">' + D.roster.map(function (m) {
      return '<article class="sn-member"><div class="sn-member-head"><span class="sn-ava">' + avatar(m) + '</span>'
        + '<div><b>' + esc(m.nickname || m.name) + '</b>'
        + (m.nickname ? '<small>' + esc(m.name) + '</small>' : '')
        + '<span class="sn-role">' + roleName(m.role) + '</span></div></div>'
        + (m.status ? '<p class="sn-note">' + esc(m.status) + '</p>' : '')
        + (m.title ? '<span class="sn-title-pill">' + esc(m.title) + '</span>' : '')
        + (m.intro ? '<p class="sn-intro">' + esc(m.intro) + '</p>' : '')
        + ((m.intro_tags || []).length ? '<div class="sn-tags">' + m.intro_tags.map(function (t) { return '<span>' + esc(t) + '</span>'; }).join('') + '</div>' : '')
        + '<div class="sn-meta">Joined ' + esc(joined(m.joined_at) || 'recently') + '</div>'
        + (D.owner ? '<div class="sn-title-form"><input data-title-for="' + esc(m.user_id) + '" maxlength="32" value="' + esc(m.title || '') + '" placeholder="Member title" aria-label="Title for ' + esc(m.nickname || m.name) + '">'
          + '<button type="button" data-sn="title-save" data-id="' + esc(m.user_id) + '">Set</button></div>' : '')
        + '</article>';
    }).join('') + '</div>';
  }

  function renderMe() {
    var me = D.me || {};
    return '<div class="sn-card"><h3>Your card in ' + esc(D.server.name) + '</h3>'
      + '<p class="sn-note">This name and card are only shown inside this server.</p>'
      + '<label class="sn-field">Nickname<input id="snNick" maxlength="24" value="' + esc(me.nickname || '') + '" placeholder="Leave blank to use your account name"></label>'
      + '<label class="sn-field">Status<input id="snStatus" maxlength="80" value="' + esc(me.status || '') + '" placeholder="What are you up to?"></label>'
      + '<label class="sn-field">Intro<textarea id="snIntro" maxlength="400" rows="3" placeholder="A short introduction">' + esc(me.intro || '') + '</textarea></label>'
      + '<label class="sn-field">Interest tags<input id="snTags" maxlength="80" value="' + esc((me.intro_tags || []).join(', ')) + '" placeholder="co-op, level design, pixel art"></label>'
      + '<button type="button" class="sn-primary" data-sn="me-save">Save my card</button></div>';
  }

  function renderSpotlight() {
    var s = D.spotlight;
    var html = '<div class="sn-card"><h3>Member spotlight</h3>'
      + (s ? '<p class="sn-spot-name">' + esc(s.name || 'Member') + '</p><p class="sn-note">' + esc(s.blurb || 'A member worth knowing.') + '</p>'
        : '<p class="sn-empty">No spotlight right now.</p>');
    if (D.owner) {
      html += '<div class="sn-row"><select id="snSpotUser" aria-label="Spotlight member"><option value="">Choose a member</option>'
        + D.roster.map(function (m) { return '<option value="' + esc(m.user_id) + '">' + esc(m.nickname || m.name) + '</option>'; }).join('')
        + '</select><button type="button" data-sn="spot-set">Spotlight</button>'
        + (s ? '<button type="button" data-sn="spot-clear">Clear</button>' : '') + '</div>'
        + '<input id="snSpotBlurb" maxlength="240" placeholder="Why them?">';
    }
    return html + '</div>';
  }

  function promptPostRow(prompt) {
    if (!D.owner || !prompt) return '';
    var cur = page() && page().current;
    return '<div class="sn-row" style="margin-top:6px">'
      + '<button type="button" data-sn="prompt-post" data-id="' + esc(prompt.id) + '"' + (cur ? '' : ' disabled') + '>Post to ' + (cur ? '#' + esc(cur.display) : 'a channel') + '</button>'
      + '<button type="button" data-sn="prompt-pin" data-id="' + esc(prompt.id) + '"' + (cur ? '' : ' disabled') + '>Post &amp; pin</button></div>';
  }

  function renderPrompts() {
    var p = D.prompts || {};
    var html = '<div class="sn-card"><h3>Prompt of the day</h3>'
      + (p.daily ? '<p class="sn-prompt">' + esc(p.daily.body) + '</p><p class="sn-meta">' + esc(p.daily.active_on) + '</p>' + promptPostRow(p.daily) : '<p class="sn-empty">No prompt today.</p>');
    if (D.owner) html += '<div class="sn-row"><input id="snDaily" maxlength="300" placeholder="What should the server talk about today?"><button type="button" data-sn="prompt-daily">Set</button></div>';
    html += '</div><div class="sn-card"><h3>Weekly topic</h3>'
      + (p.weekly ? '<p class="sn-prompt">' + esc(p.weekly.body) + '</p><p class="sn-meta">Week of ' + esc(p.weekly.active_on) + '</p>' + promptPostRow(p.weekly) : '<p class="sn-empty">No topic this week.</p>');
    if (D.owner) html += '<div class="sn-row"><input id="snWeekly" maxlength="300" placeholder="A topic for the whole week"><button type="button" data-sn="prompt-weekly">Set</button></div>';
    return html + '</div>';
  }

  function renderSuggestions() {
    var rows = D.suggestions.toSorted(function (a, b) { return (b.votes - a.votes) || String(b.created_at).localeCompare(String(a.created_at)); });
    var html = '<div class="sn-card"><h3>New suggestion</h3><div class="sn-row"><input id="snSugTitle" maxlength="80" placeholder="A short title"><button type="button" data-sn="sugg-post">Post</button></div>'
      + '<textarea id="snSugBody" maxlength="600" rows="2" placeholder="Why it would help (optional)"></textarea></div>';
    html += '<div class="sn-card"><h3>' + rows.length + ' suggestion' + (rows.length === 1 ? '' : 's') + '</h3>';
    html += rows.length ? rows.map(function (s) {
      return '<div class="sn-item"><div class="sn-row"><button type="button" class="sn-vote' + (s.mine ? ' on' : '') + '" data-sn="vote" data-id="' + esc(s.id) + '">' + s.votes + ' votes</button>'
        + '<div class="sn-grow"><b>' + esc(s.title) + '</b><p class="sn-note">' + esc(s.body || '') + '</p>'
        + '<div class="sn-meta">' + esc(s.name) + ' · ' + esc(s.status) + '</div></div>'
        + (D.mod ? '<select data-sn-change="sugg-status" data-id="' + esc(s.id) + '" aria-label="Suggestion status">'
          + ['open', 'planned', 'done', 'declined'].map(function (v) { return '<option value="' + v + '"' + (s.status === v ? ' selected' : '') + '>' + v + '</option>'; }).join('')
          + '</select>' : '') + '</div></div>';
    }).join('') : '<p class="sn-empty">No suggestions yet.</p>';
    return html + '</div>';
  }

  function renderLfg() {
    var html = '<div class="sn-card"><h3>Looking for group</h3><div class="sn-row"><input id="snLfgGame" maxlength="60" placeholder="Game"><input id="snLfgWhen" type="datetime-local" aria-label="Start time"><input id="snLfgSlots" type="number" min="2" max="20" value="4" aria-label="Slots"><button type="button" data-sn="lfg-post">Post</button></div>'
      + '<input id="snLfgNote" maxlength="200" placeholder="Rank, region, what you need (optional)"></div>';
    html += '<div class="sn-card"><h3>' + D.lfg.length + ' open</h3>';
    html += D.lfg.length ? D.lfg.map(function (l) {
      return '<div class="sn-item"><div class="sn-row"><div class="sn-grow"><b>' + esc(l.game) + '</b>'
        + (l.note ? '<p class="sn-note">' + esc(l.note) + '</p>' : '')
        + '<div class="sn-meta">' + (l.starts_at ? esc(when(l.starts_at)) : 'Any time') + ' · ' + l.slots + ' slots</div></div>'
        + ((l.user_id === D.me_id || D.mod) ? '<button type="button" data-sn="lfg-del" data-id="' + esc(l.id) + '">Remove</button>' : '') + '</div></div>';
    }).join('') : '<p class="sn-empty">No open posts.</p>';
    return html + '</div>';
  }

  function renderNights() {
    var html = '';
    if (D.mod) {
      html += '<div class="sn-card"><h3>Schedule a night</h3><div class="sn-row"><input id="snNightTitle" maxlength="80" placeholder="Friday Minecraft"><input id="snNightGame" maxlength="60" placeholder="Game"><input id="snNightWhen" type="datetime-local" aria-label="Start time"><button type="button" data-sn="night-post">Add</button></div>'
        + '<input id="snNightNote" maxlength="240" placeholder="Note (optional)"><label class="sn-check"><input id="snNightPublic" type="checkbox" checked> Public event</label></div>';
    }
    html += '<div class="sn-card"><h3>Upcoming</h3>';
    html += D.nights.length ? D.nights.map(function (n) {
      return '<div class="sn-item"><div class="sn-row"><div class="sn-grow"><b>' + esc(n.title) + '</b>'
        + '<div class="sn-meta">' + (n.game ? esc(n.game) + ' · ' : '') + (n.is_public ? 'Public event' : 'Members only') + (n.note ? ' · ' + esc(n.note) : '') + '</div>'
        + '<time>' + esc(when(n.starts_at)) + '</time></div>'
        + (D.mod ? '<button type="button" data-sn="night-del" data-id="' + esc(n.id) + '">Remove</button>' : '') + '</div></div>';
    }).join('') : '<p class="sn-empty">No nights scheduled.</p>';
    return html + '</div>';
  }

  function renderWarningsTab() {
    var rows = D.warnings || [];
    return '<div class="sn-card"><h3>Warnings</h3>'
      + (rows.length ? rows.map(function (w) {
        return '<div class="sn-item"><b>From the owner</b><p class="sn-note">' + esc(w.reason) + '</p>'
          + '<button type="button" data-sn="ack" data-id="' + esc(w.id) + '">I understand</button></div>';
      }).join('') : '<p class="sn-empty">No unread warnings.</p>')
      + '</div>';
  }

  function renderInactive() {
    if (!D.owner) return '<div class="sn-card"><p class="sn-empty">Only the owner can read inactivity.</p></div>';
    if (!D._inactive) return '<div class="sn-card"><h3>Inactive members</h3><p class="sn-note">Members who have not posted in the last 30 days. Nothing is removed automatically.</p><button type="button" data-sn="inactive">Read inactivity</button></div>';
    var rows = D._inactive.inactive || [];
    return '<div class="sn-card"><h3>Inactive for ' + D._inactive.days + ' days</h3>'
      + (rows.length ? rows.map(function (r) {
        return '<div class="sn-item"><b>' + esc(r.name) + '</b><div class="sn-meta">' + roleName(r.role) + ' · ' + (r.last_message_at ? 'Last posted ' + esc(when(r.last_message_at)) : 'No posts yet') + '</div></div>';
      }).join('') : '<p class="sn-empty">Everyone has posted recently.</p>')
      + '</div>';
  }

  function renderLabels() {
    var cur = page() && page().current;
    if (!cur) return '<div class="sn-card"><p class="sn-empty">Open a channel first.</p></div>';
    if (!D.owner) return '<div class="sn-card"><p class="sn-empty">Only the owner can label channels.</p></div>';
    var allowed = D.labels || [];
    var mine = cur.labels || [];
    return '<div class="sn-card"><h3>Content labels for #' + esc(cur.display) + '</h3>'
      + '<p class="sn-note">Labels appear in the channel sidebar and warn before a spoiler channel opens.</p>'
      + allowed.map(function (l) {
        return '<label class="sn-check"><input type="checkbox" data-label="' + esc(l) + '"' + (mine.indexOf(l) >= 0 ? ' checked' : '') + '> ' + esc(l) + '</label>';
      }).join('')
      + '<button type="button" class="sn-primary" data-sn="labels-save">Save labels</button></div>';
  }

  function render() {
    if (!D) return;
    var title = document.getElementById('snTitle');
    var sub = document.getElementById('snSub');
    if (title) title.textContent = D.server.name || 'Community';
    if (sub) sub.textContent = D.roster.length + ' members · ' + roleName(D.role);
    syncFull();
    Array.prototype.forEach.call(tabs.querySelectorAll('[data-tab]'), function (b) {
      var on = b.getAttribute('data-tab') === tab;
      b.classList.toggle('on', on);
      b.setAttribute('aria-selected', String(on));
    });
    renderWarnings();
    if (tab === 'members') body.innerHTML = renderMembers();
    else if (tab === 'me') body.innerHTML = renderMe();
    else if (tab === 'spotlight') body.innerHTML = renderSpotlight();
    else if (tab === 'prompts') body.innerHTML = renderPrompts();
    else if (tab === 'suggestions') body.innerHTML = renderSuggestions();
    else if (tab === 'lfg') body.innerHTML = renderLfg();
    else if (tab === 'nights') body.innerHTML = renderNights();
    else if (tab === 'warnings') body.innerHTML = renderWarningsTab();
    else if (tab === 'inactive') body.innerHTML = renderInactive();
    else body.innerHTML = renderLabels();
  }

  async function load() {
    if (!sid()) { status('Could not read this server. Reload the page and try again.', true); return false; }
    status('Loading community…');
    if (!(await authReady())) {
      status('Session expired — reload the page and sign in again.', true);
      return false;
    }
    try {
      D = await req('/api/servers/' + encodeURIComponent(sid()) + '/community');
      status('');
      render();
      return true;
    } catch (e) {
      status(e.message, true);
      if (body) body.innerHTML = '<div class="sn-card"><p class="sn-empty">' + esc(e.message) + '</p></div>';
      return false;
    }
  }

  function open() {
    if (!dock) return;
    syncFull();
    dock.hidden = false;
    backdrop.hidden = false;
    if (launchBtn) launchBtn.setAttribute('aria-expanded', 'true');
    load();
  }
  function close() {
    if (!dock) return;
    dock.hidden = true;
    backdrop.hidden = true;
    if (launchBtn) launchBtn.setAttribute('aria-expanded', 'false');
  }

  function action(act, el) {
    if (busy) return;
    busy = true;
    setBusy(true);
    var p = '/api/servers/' + encodeURIComponent(sid());
    var run = async function () {
      if (act === 'ack') {
        await req(p + '/warnings/' + encodeURIComponent(el.getAttribute('data-id')) + '/ack', { method: 'POST' });
      } else if (act === 'me-save') {
        var tags = String(val('snTags') || '').split(',').map(function (t) { return t.trim(); }).filter(Boolean).slice(0, 4);
        await req(p + '/me', { method: 'PUT', body: JSON.stringify({ nickname: val('snNick'), status: val('snStatus'), intro: val('snIntro'), intro_tags: tags }) });
      } else if (act === 'spot-set') {
        await req(p + '/spotlight', { method: 'POST', body: JSON.stringify({ user_id: val('snSpotUser'), blurb: val('snSpotBlurb') }) });
      } else if (act === 'spot-clear') {
        await req(p + '/spotlight', { method: 'DELETE' });
      } else if (act === 'prompt-daily' || act === 'prompt-weekly') {
        await req(p + '/prompts', { method: 'POST', body: JSON.stringify({ kind: act === 'prompt-weekly' ? 'weekly' : 'daily', body: val(act === 'prompt-weekly' ? 'snWeekly' : 'snDaily') }) });
      } else if (act === 'prompt-post' || act === 'prompt-pin') {
        var curCh = page() && page().current;
        if (!curCh) throw new Error('Open a channel first.');
        await req(p + '/prompts/' + encodeURIComponent(el.getAttribute('data-id')) + '/post', {
          method: 'POST', body: JSON.stringify({ channelId: curCh.id, pin: act === 'prompt-pin' }),
        });
      } else if (act === 'sugg-post') {
        await req(p + '/suggestions', { method: 'POST', body: JSON.stringify({ title: val('snSugTitle'), body: val('snSugBody') }) });
      } else if (act === 'vote') {
        await req(p + '/suggestions/' + encodeURIComponent(el.getAttribute('data-id')) + '/vote', { method: 'POST' });
      } else if (act === 'lfg-post') {
        await req(p + '/lfg', { method: 'POST', body: JSON.stringify({ game: val('snLfgGame'), note: val('snLfgNote'), slots: val('snLfgSlots'), starts_at: isoWhen(val('snLfgWhen')) }) });
      } else if (act === 'lfg-del') {
        await req(p + '/lfg/' + encodeURIComponent(el.getAttribute('data-id')), { method: 'DELETE' });
      } else if (act === 'night-post') {
        await req(p + '/nights', { method: 'POST', body: JSON.stringify({ title: val('snNightTitle'), game: val('snNightGame'), note: val('snNightNote'), starts_at: isoWhen(val('snNightWhen')), is_public: document.getElementById('snNightPublic').checked }) });
      } else if (act === 'night-del') {
        await req(p + '/nights/' + encodeURIComponent(el.getAttribute('data-id')), { method: 'DELETE' });
      } else if (act === 'title-save') {
        var input = document.querySelector('[data-title-for="' + el.getAttribute('data-id') + '"]');
        await req(p + '/community/members/' + encodeURIComponent(el.getAttribute('data-id')), { method: 'PUT', body: JSON.stringify({ title: input ? input.value : '' }) });
      } else if (act === 'inactive') {
        D._inactive = await req(p + '/inactive');
        render();
      } else if (act === 'labels-save') {
        var cur = page() && page().current;
        if (!cur) throw new Error('Open a channel first.');
        var labels = [].slice.call(body.querySelectorAll('[data-label]:checked')).map(function (b) { return b.getAttribute('data-label'); });
        await req('/api/channels/' + encodeURIComponent(cur.id) + '/labels', { method: 'PUT', body: JSON.stringify({ labels: labels }) });
        cur.labels = labels;
        if (page().reloadChannels) await page().reloadChannels();
        status('Labels saved.');
      } else if (act === 'close') {
        close();
      }
      if (act !== 'close' && act !== 'inactive' && act !== 'labels-save') {
        if (await load()) status(act === 'prompt-post' ? 'Prompt posted.' : act === 'prompt-pin' ? 'Prompt posted and pinned.' : 'Saved.');
      } else if (act === 'inactive') {
        status('');
      } else if (act === 'labels-save') {
        render();
      }
    };
    run().catch(function (e) { status(e.message, true); }).then(function () {
      busy = false;
      setBusy(false);
    });
  }

  function setBusy(on) {
    if (!dock) return;
    Array.prototype.forEach.call(dock.querySelectorAll('button'), function (b) { b.disabled = on; });
  }

  function boot() {
    // The page's inline script publishes `cudicServerPage` after it parses.
    // Wait for it so headers and the active channel are never half-built.
    if (!page()) {
      if (bootTries++ < 100) setTimeout(boot, 100);
      return;
    }
    launchBtn = document.getElementById('srvCommunityBtn');
    if (launchBtn) {
      launchBtn.hidden = false;
      launchBtn.addEventListener('click', function (e) { e.preventDefault(); if (dock && !dock.hidden) close(); else open(); });
    }

    dock = document.createElement('aside');
    dock.id = 'snDock';
    dock.className = 'sn-dock';
    dock.hidden = true;
    dock.setAttribute('aria-label', 'Server community');
    dock.innerHTML = '<div class="sn-head"><div><h2 id="snTitle">Community</h2><p id="snSub"></p></div>'
      + '<button type="button" data-sn="close">Close</button></div>'
      + '<div class="sn-top"><a id="snFull" href="/server-community">Open full page</a><span>Live server data</span></div>'
      + '<nav class="sn-tabs" id="snTabs" role="tablist" aria-label="Community sections">'
      + TABS.map(function (t) { return '<button type="button" role="tab" data-tab="' + t[0] + '" aria-selected="false">' + t[1] + '</button>'; }).join('')
      + '</nav><div id="snWarn"></div><div class="sn-body" id="snBody"></div><div class="sn-status" id="snStatus"></div>';
    document.body.appendChild(dock);

    backdrop = document.createElement('div');
    backdrop.className = 'sn-backdrop';
    backdrop.hidden = true;
    backdrop.addEventListener('click', close);
    document.body.appendChild(backdrop);

    body = document.getElementById('snBody');
    tabs = document.getElementById('snTabs');
    warnBox = document.getElementById('snWarn');
    statusBox = document.getElementById('snStatus');
    syncFull();

    tabs.addEventListener('click', function (e) {
      var b = e.target.closest('[data-tab]');
      if (!b) return;
      tab = b.getAttribute('data-tab') || 'members';
      if (D) D._inactive = null;
      render();
    });
    dock.addEventListener('click', function (e) {
      var b = e.target.closest('[data-sn]');
      if (b) action(b.getAttribute('data-sn'), b);
    });
    dock.addEventListener('change', function (e) {
      var s = e.target.closest('[data-sn-change]');
      if (!s || s.getAttribute('data-sn-change') !== 'sugg-status') return;
      req('/api/servers/' + encodeURIComponent(sid()) + '/suggestions/' + encodeURIComponent(s.getAttribute('data-id')), {
        method: 'PATCH', body: JSON.stringify({ status: s.value })
      }).then(load).catch(function (err) { status(err.message, true); });
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && dock && !dock.hidden) close();
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
