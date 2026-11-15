/* file: public/server-hq.js
 * what: One panel for a server's pulse — 7-day analytics, a 30-day member
 *   leaderboard, member introductions, temporary channels and owner bulk edits.
 * invariants: reads only what the page can already open; owner-only controls
 *   are hidden for members and the server re-checks every write.
 */
(function () {
  var page = null, panel = null, btn = null, data = null, statusEl = null;
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function apiHost() { return page ? (typeof page.apiHost === 'function' ? page.apiHost() : page.apiHost) : ''; }
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
    if (!statusEl) return;
    statusEl.textContent = text || '';
    statusEl.style.color = bad ? 'var(--danger)' : 'var(--text-tertiary)';
  }
  function stat(label, value) {
    return '<div style="border:1px solid var(--line);border-radius:7px;padding:9px 10px;background:var(--panel-raised)">'
      + '<div style="font:600 1.05rem/1.1 var(--font-head);color:var(--text-primary)">' + esc(value) + '</div>'
      + '<div style="font:500 0.66rem/1.3 var(--font-mono,monospace);letter-spacing:.08em;text-transform:uppercase;color:var(--text-tertiary);margin-top:4px">' + esc(label) + '</div></div>';
  }
  function section(title, body) {
    return '<section style="border-top:1px solid var(--line);padding-top:10px;margin-top:10px">'
      + '<div style="font:600 0.66rem/1.3 var(--font-mono,monospace);letter-spacing:.1em;text-transform:uppercase;color:var(--text-tertiary);margin-bottom:7px">' + esc(title) + '</div>'
      + body + '</section>';
  }
  function render() {
    if (!data) return;
    var a = data.analytics || {};
    var owner = data.role === 'owner';
    var html = '<div style="display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:9px">'
      + '<div><b style="font-family:var(--font-head);font-size:0.95rem">Server HQ</b>'
      + '<div style="font-size:0.72rem;color:var(--text-tertiary);margin-top:2px">Last 7 days, plus the last 30 for the board.</div></div>'
      + '<button type="button" data-hq="close" style="background:none;border:1px solid var(--line);border-radius:5px;color:var(--text-secondary);cursor:pointer;padding:4px 9px;font:inherit;font-size:0.74rem">Close</button></div>';

    html += '<div style="display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:6px">'
      + stat('Members', a.members || 0) + stat('Channels', a.channels || 0)
      + stat('Messages · 7d', a.messages_7d || 0) + stat('Active channels', a.active_channels_7d || 0)
      + '</div>';

    html += section('Leaderboard · 30 days', data.leaderboard && data.leaderboard.length
      ? '<div style="display:grid;gap:4px">' + data.leaderboard.map(function (m, i) {
          return '<div style="display:flex;align-items:center;gap:8px;padding:4px 0;border-bottom:1px solid var(--line);font-size:0.8rem">'
            + '<span style="width:18px;color:var(--text-tertiary);font:600 0.72rem/1 var(--font-mono,monospace)">' + (i + 1) + '</span>'
            + '<span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--text-primary)">' + esc(m.display_name) + '</span>'
            + '<span style="color:var(--text-secondary);font:500 0.72rem/1 var(--font-mono,monospace)">' + m.count + '</span></div>';
        }).join('') + '</div>'
      : '<div style="font-size:0.78rem;color:var(--text-tertiary)">No messages in the last 30 days yet.</div>');

    if (data.capabilities && data.capabilities.intros) {
      var mine = (data.intros || []).find(function (x) { return x.user_id === data.me; });
      html += section('Introductions', '<textarea id="hqIntro" maxlength="400" rows="2" placeholder="What are you building or into?" style="width:100%;box-sizing:border-box;background:var(--bg);border:1px solid var(--line);border-radius:5px;color:var(--text-primary);font:inherit;font-size:0.8rem;padding:7px 9px;resize:vertical">' + esc(mine ? mine.body : '') + '</textarea>'
        + '<div style="display:flex;justify-content:flex-end;margin-top:5px"><button type="button" data-hq="intro" style="padding:4px 10px;border:1px solid var(--line);border-radius:5px;background:var(--panel-raised);color:var(--text-primary);cursor:pointer;font:inherit;font-size:0.74rem">Save intro</button></div>'
        + '<div style="display:grid;gap:5px;margin-top:7px;max-height:140px;overflow:auto">'
        + (data.intros || []).slice(0, 12).map(function (x) {
            return '<div style="font-size:0.76rem;line-height:1.45;padding:5px 0;border-top:1px solid var(--line)"><b style="color:var(--text-primary)">' + esc(x.display_name) + '</b> <span style="color:var(--text-secondary)">' + esc(x.body) + '</span></div>';
          }).join('') + '</div>');
    } else {
      html += section('Introductions', '<div style="font-size:0.76rem;color:var(--text-tertiary)">Run the chat-HQ migration to turn on member introductions.</div>');
    }

    if (owner && data.capabilities && data.capabilities.temporary) {
      html += section('Temporary channel', '<div style="display:flex;gap:5px;flex-wrap:wrap"><input id="hqTempName" maxlength="30" placeholder="channel-name" style="flex:1;min-width:130px;padding:6px 8px;border:1px solid var(--line);border-radius:5px;background:var(--bg);color:var(--text-primary);font:inherit;font-size:0.78rem"><input id="hqTempHours" type="number" min="1" max="168" value="24" aria-label="Hours" style="width:64px;padding:6px 7px;border:1px solid var(--line);border-radius:5px;background:var(--bg);color:var(--text-primary);font:inherit;font-size:0.78rem"><button type="button" data-hq="temp" style="padding:5px 10px;border:1px solid var(--line);border-radius:5px;background:var(--panel-raised);color:var(--text-primary);cursor:pointer;font:inherit;font-size:0.74rem">Create</button></div>');
    }

    if (owner) {
      var channels = data.channels || [];
      html += section('Bulk edit', channels.length
        ? '<div style="display:flex;gap:4px;flex-wrap:wrap;margin-bottom:6px">'
            + '<input id="hqBulkTopic" maxlength="200" placeholder="New topic (blank keeps each)" style="flex:1;min-width:140px;padding:5px 7px;border:1px solid var(--line);border-radius:5px;background:var(--bg);color:var(--text-primary);font:inherit;font-size:0.76rem">'
            + '<select id="hqBulkSlow" aria-label="Slow mode" style="padding:5px 6px;border:1px solid var(--line);border-radius:5px;background:var(--bg);color:var(--text-primary);font:inherit;font-size:0.76rem"><option value="">Slow: keep</option><option value="0">Off</option><option value="5">5s</option><option value="10">10s</option><option value="30">30s</option><option value="60">60s</option></select>'
            + '<select id="hqBulkPrivate" aria-label="Privacy" style="padding:5px 6px;border:1px solid var(--line);border-radius:5px;background:var(--bg);color:var(--text-primary);font:inherit;font-size:0.76rem"><option value="">Privacy: keep</option><option value="false">Public</option><option value="true">Private</option></select></div>'
            + '<div style="display:grid;gap:2px;max-height:130px;overflow:auto">' + channels.map(function (c) {
                return '<label style="display:flex;align-items:center;gap:6px;font-size:0.76rem;color:var(--text-secondary);padding:2px 0"><input type="checkbox" class="hqChan" value="' + esc(c.id) + '"> #' + esc(c.display_name) + '</label>';
              }).join('') + '</div>'
            + '<div style="display:flex;justify-content:flex-end;margin-top:5px"><button type="button" data-hq="bulk" style="padding:4px 10px;border:1px solid var(--line);border-radius:5px;background:var(--panel-raised);color:var(--text-primary);cursor:pointer;font:inherit;font-size:0.74rem">Apply to selected</button></div>'
        : '<div style="font-size:0.78rem;color:var(--text-tertiary)">No channels to edit.</div>');
    }

    html += '<div id="hqStatus" style="font-size:0.74rem;margin-top:8px;min-height:1em"></div>';
    panel.innerHTML = html;
    statusEl = document.getElementById('hqStatus');
    panel.querySelectorAll('[data-hq]').forEach(function (b) {
      b.onclick = function () {
        var act = b.getAttribute('data-hq');
        if (act === 'close') panel.hidden = true;
        if (act === 'intro') saveIntro();
        if (act === 'temp') createTemp();
        if (act === 'bulk') bulkEdit();
      };
    });
  }

  async function load() {
    try {
      data = await req('/api/servers/' + page.sid + '/hq');
      render();
    } catch (e) { panel.innerHTML = '<div style="color:var(--danger);font-size:0.8rem">' + esc(e.message) + '</div>'; }
  }

  async function saveIntro() {
    var ta = document.getElementById('hqIntro');
    if (!ta) return;
    try {
      await req('/api/servers/' + page.sid + '/intros', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body: ta.value }),
      });
      status('Introduction saved.');
      await load();
      status('Introduction saved.');
    } catch (e) { status(e.message, true); }
  }

  async function createTemp() {
    var name = (document.getElementById('hqTempName') || {}).value || '';
    var hours = parseInt((document.getElementById('hqTempHours') || {}).value, 10);
    if (!name.trim() || !(hours >= 1 && hours <= 168)) { status('Name it and pick 1–168 hours.', true); return; }
    try {
      var made = await req('/api/servers/' + page.sid + '/channels', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), expiresInHours: hours }),
      });
      status(made.temporary ? 'Temporary channel created.' : 'Channel created without an expiry — the chat-HQ migration has not run.');
      if (page.reloadChannels) await page.reloadChannels();
      await load();
      status('Temporary channel created.');
    } catch (e) { status(e.message, true); }
  }

  async function bulkEdit() {
    var ids = [].map.call(panel.querySelectorAll('.hqChan:checked'), function (c) { return c.value; });
    if (!ids.length) { status('Select at least one channel.', true); return; }
    var body = { ids: ids };
    var topic = (document.getElementById('hqBulkTopic') || {}).value || '';
    var slow = (document.getElementById('hqBulkSlow') || {}).value || '';
    var priv = (document.getElementById('hqBulkPrivate') || {}).value || '';
    if (topic.trim()) body.topic = topic.trim();
    if (slow !== '') body.slow_seconds = Number(slow);
    if (priv !== '') body.is_private = priv === 'true';
    if (!body.topic && body.slow_seconds === undefined && body.is_private === undefined) {
      status('Choose a topic, slow mode or privacy change.', true); return;
    }
    try {
      var d = await req('/api/servers/' + page.sid + '/channels/bulk', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      status('Updated ' + d.updated + ' channel' + (d.updated === 1 ? '' : 's') + '.');
      if (page.reloadChannels) await page.reloadChannels();
      await load();
      status('Updated ' + d.updated + ' channel' + (d.updated === 1 ? '' : 's') + '.');
    } catch (e) { status(e.message, true); }
  }

  async function boot() {
    page = window.cudicServerPage;
    if (!page) { setTimeout(boot, 100); return; }
    btn = document.getElementById('srvHqBtn');
    if (!btn) return;
    try {
      var r = await fetch(apiHost() + '/api/servers/' + page.sid + '/membership', { headers: page.headers() });
      var m = await r.json();
      if (!m || !m.role) return;
    } catch (e) { return; }
    btn.hidden = false;
    panel = document.createElement('div');
    panel.id = 'serverHqPanel';
    panel.hidden = true;
    panel.style.cssText = 'padding:11px 16px;border-bottom:1px solid var(--line);background:var(--panel);flex-shrink:0;max-height:58vh;overflow:auto';
    var main = document.getElementById('serverMain');
    var topbar = document.getElementById('topbar');
    if (main && topbar && topbar.nextSibling) main.insertBefore(panel, topbar.nextSibling);
    else if (main) main.appendChild(panel);
    btn.onclick = function () {
      panel.hidden = !panel.hidden;
      if (!panel.hidden) load();
    };
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
