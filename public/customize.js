/* file: public/customize.js
 * what: Studio controls for look/feel, layouts, tones, conversation themes,
 *   custom theme packs and profile extras/widgets.
 * invariants: saves go through /api/customize; the local cache updates only
 *   after a successful save; preview never changes another account.
 */
(function () {
  var TOKEN = '', prefs = {}, convs = [], order = ['sidebar', 'main'];
  function $(id) { return document.getElementById(id); }
  function apiHost() { return (typeof WS_URL !== 'undefined' && WS_URL) ? WS_URL.replace(/^wss?:\/\//, 'https://') : ''; }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  async function getToken() {
    try { if (window.getAuthToken) { var t = await window.getAuthToken(); if (t) return t; } } catch (e) {}
    try { var raw = localStorage.getItem('sb-qgcydphkaujomxyzwcht-auth-token'); var s = JSON.parse(raw); return (s && s.access_token) || raw; } catch (e) { return null; }
  }
  async function req(path, opts) {
    opts = opts || {};
    opts.headers = Object.assign({ Authorization: 'Bearer ' + TOKEN }, opts.headers || {});
    var r = await fetch(apiHost() + path, opts);
    var d = await r.json().catch(function () { return {}; });
    if (!r.ok) throw new Error(d.text || d.error || 'Request failed.');
    return d;
  }
  function msg(el, text, bad) { if (!el) return; el.textContent = text || ''; el.className = 'cz-msg' + (bad ? ' bad' : ''); }
  function cache() {
    try { localStorage.setItem('cudic_prefs_v1', JSON.stringify(prefs)); } catch (e) {}
    if (window.CudicCustomize) window.CudicCustomize.apply(prefs);
  }

  function fill() {
    $('fontFamily').value = prefs.font_family || '';
    $('fontSize').value = prefs.font_size || 15;
    $('lineHeight').value = prefs.line_height || 1.5;
    $('density').value = prefs.density || 'comfortable';
    $('railMode').value = prefs.rail_mode || 'icon';
    $('chanLayout').value = prefs.chan_layout || 'list';
    $('glass').checked = prefs.glass === true;
    $('motion').checked = prefs.reduce_motion === true;
    $('bannerPos').value = prefs.banner_pos == null ? 50 : prefs.banner_pos;
    $('bannerAnim').checked = prefs.banner_animated === true;
    $('profilePack').value = prefs.profile_pack_slug || '';
    var s = prefs.notify_sounds || {};
    $('sndDm').checked = s.dm !== false;
    $('sndMention').checked = s.mention !== false;
    $('sndEvent').checked = s.event !== false;
    $('sndCall').checked = s.call !== false;
    order = (prefs.layout && prefs.layout.order) || ['sidebar', 'main'];
    paintOrder();
    paintSaved();
    paintDots();
  }
  function paintDots() {
    $('fontSizeOut').textContent = $('fontSize').value;
    $('lineHeightOut').textContent = $('lineHeight').value;
  }
  function paintOrder() {
    var box = $('layoutOrder');
    if (!box) return;
    box.innerHTML = order.map(function (k, i) {
      return '<div class="cz-layout-item"><span class="grow">' + (k === 'sidebar' ? 'Conversation list' : 'Message pane') + '</span>'
        + '<button type="button" data-move="' + i + '" data-dir="-1" ' + (i === 0 ? 'disabled' : '') + '>↑</button>'
        + '<button type="button" data-move="' + i + '" data-dir="1" ' + (i === order.length - 1 ? 'disabled' : '') + '>↓</button></div>';
    }).join('');
    box.querySelectorAll('[data-move]').forEach(function (b) {
      b.onclick = function () {
        var i = parseInt(b.getAttribute('data-move'), 10), j = i + parseInt(b.getAttribute('data-dir'), 10);
        if (j < 0 || j >= order.length) return;
        var t = order[i]; order[i] = order[j]; order[j] = t;
        paintOrder();
      };
    });
  }
  function paintSaved() {
    var box = $('savedLayouts'), saved = (prefs.layout && prefs.layout.saved) || {};
    var keys = Object.keys(saved);
    box.innerHTML = keys.length ? keys.map(function (k) {
      return '<div class="cz-list-row"><span class="grow">' + esc(k) + '</span><button type="button" data-apply="' + esc(k) + '">Apply</button><button type="button" data-del="' + esc(k) + '">×</button></div>';
    }).join('') : '<div style="color:var(--text-tertiary)">No named layouts.</div>';
    box.querySelectorAll('[data-apply]').forEach(function (b) {
      b.onclick = function () { order = (saved[b.getAttribute('data-apply')] || ['sidebar', 'main']).slice(); paintOrder(); cache(); };
    });
    box.querySelectorAll('[data-del]').forEach(function (b) {
      b.onclick = function () { delete saved[b.getAttribute('data-del')]; saveLayout(null, true); };
    });
  }
  async function saveLayout(name, silent) {
    var saved = (prefs.layout && prefs.layout.saved) || {};
    if (name) saved[name] = order.slice();
    prefs.layout = { order: order.slice(), saved: saved };
    try {
      await req('/api/customize/prefs', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ layout: prefs.layout }) });
      cache(); paintSaved(); if (!silent) msg($('layoutName').closest('.cz-card').querySelector('.cz-msg'), name ? 'Layout saved.' : 'Layout updated.');
    } catch (e) { msg($('layoutName').closest('.cz-card').querySelector('.cz-msg'), e.message, true); }
  }

  async function loadConversations() {
    try {
      var d = await req('/api/conversations');
      convs = d.conversations || [];
      $('convPick').innerHTML = '<option value="">Choose a conversation…</option>' + convs.map(function (c) {
        return '<option value="' + esc(c.id) + '">' + (c.kind === 'dm' ? '@ ' : '# ') + esc(c.display) + '</option>';
      }).join('');
    } catch (e) { $('convPick').innerHTML = '<option value="">Could not load conversations</option>'; }
  }
  function pickedConv() { return convs.find(function (c) { return c.id === $('convPick').value; }); }
  async function loadConvTheme() {
    var c = pickedConv(); if (!c) return;
    try {
      var d = await req('/api/customize/conversation-theme?lobby=' + encodeURIComponent(c.name));
      $('convAccent').value = (d.theme && d.theme.accent) || '#FF8C1A';
      $('convBg').value = (d.theme && d.theme.background) || '';
      paintConvPreview();
      msg($('convMsg'), d.theme && d.theme.accent ? 'Loaded.' : 'No theme set — using the site look.');
    } catch (e) { msg($('convMsg'), e.message, true); }
  }
  function paintConvPreview() {
    var el = $('convPreview');
    el.style.backgroundImage = $('convBg').value ? 'linear-gradient(rgba(13,14,16,.7),rgba(13,14,16,.7)),url("' + $('convBg').value.replace(/"/g, '') + '")' : 'linear-gradient(90deg,' + $('convAccent').value + ' 0 18%,var(--panel-raised) 18%)';
  }
  async function saveConvTheme(clear) {
    var c = pickedConv(); if (!c) { msg($('convMsg'), 'Pick a conversation first.', true); return; }
    try {
      await req('/api/customize/conversation-theme?lobby=' + encodeURIComponent(c.name), {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ theme: clear ? {} : { accent: $('convAccent').value, background: $('convBg').value.trim() } }),
      });
      paintConvPreview(); msg($('convMsg'), clear ? 'Theme cleared.' : 'Saved to this conversation.');
    } catch (e) { msg($('convMsg'), e.message, true); }
  }

  async function loadThemes() {
    try {
      var d = await req('/api/customize/themes');
      var rows = d.themes || [];
      $('themeList').innerHTML = rows.length ? rows.map(function (t) {
        return '<div class="cz-list-row"><span style="width:16px;height:16px;border-radius:4px;background:' + esc((t.manifest && t.manifest.accent) || '#888') + '"></span>'
          + '<span class="grow">' + esc(t.name) + '</span><button type="button" data-pub="' + t.id + '" data-on="' + (t.published ? '1' : '0') + '">' + (t.published ? 'Unpublish' : 'Publish') + '</button>'
          + '<button type="button" data-tdel="' + t.id + '">×</button></div>';
      }).join('') : '<div style="color:var(--text-tertiary)">No custom themes yet.</div>';
      $('themeList').querySelectorAll('[data-pub]').forEach(function (b) {
        b.onclick = async function () {
          try { await req('/api/customize/themes/' + b.getAttribute('data-pub') + '/publish', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ published: b.getAttribute('data-on') !== '1' }) }); loadThemes(); }
          catch (e) { msg($('themeMsg'), e.message, true); }
        };
      });
      $('themeList').querySelectorAll('[data-tdel]').forEach(function (b) {
        b.onclick = async function () { try { await req('/api/customize/themes/' + b.getAttribute('data-tdel'), { method: 'DELETE' }); loadThemes(); } catch (e) { msg($('themeMsg'), e.message, true); } };
      });
    } catch (e) { msg($('themeMsg'), e.message, true); }
  }

  var widgetRows = [];
  async function loadWidgets() {
    try {
      var d = await req('/api/customize/widgets');
      widgetRows = d.widgets || [];
      $('widgetList').innerHTML = widgetRows.length ? widgetRows.map(function (w, i) {
        var label = w.kind + ': ' + (w.config && (w.config.text || w.config.label || w.config.code) || 'latest games');
        return '<div class="cz-list-row"><span class="grow">' + esc(label) + '</span>'
          + '<button type="button" data-wmove="' + i + '" data-dir="-1" ' + (i === 0 ? 'disabled' : '') + '>↑</button>'
          + '<button type="button" data-wmove="' + i + '" data-dir="1" ' + (i === widgetRows.length - 1 ? 'disabled' : '') + '>↓</button>'
          + '<button type="button" data-wdel="' + w.id + '">×</button></div>';
      }).join('') : '<div style="color:var(--text-tertiary)">No profile widgets.</div>';
      $('widgetList').querySelectorAll('[data-wmove]').forEach(function (b) {
        b.onclick = function () {
          var i = parseInt(b.getAttribute('data-wmove'), 10), j = i + parseInt(b.getAttribute('data-dir'), 10);
          if (j < 0 || j >= widgetRows.length) return;
          var t = widgetRows[i]; widgetRows[i] = widgetRows[j]; widgetRows[j] = t;
          req('/api/customize/widgets/reorder', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ids: widgetRows.map(function (w) { return w.id; }) }) })
            .then(loadWidgets).catch(function (e) { msg($('profileMsg'), e.message, true); });
        };
      });
      $('widgetList').querySelectorAll('[data-wdel]').forEach(function (b) {
        b.onclick = async function () { try { await req('/api/customize/widgets/' + b.getAttribute('data-wdel'), { method: 'DELETE' }); loadWidgets(); } catch (e) { msg($('profileMsg'), e.message, true); } };
      });
    } catch (e) { msg($('profileMsg'), e.message, true); }
  }

  async function boot() {
    TOKEN = await getToken();
    if (!TOKEN) { $('czGate').hidden = false; return; }
    $('czBody').hidden = false;
    try {
      var d = await req('/api/customize/prefs');
      prefs = d.prefs || {};
    } catch (e) {
      $('czBody').hidden = true; $('czGate').hidden = false;
      $('czGate').querySelector('h2').textContent = 'Customisation is not set up';
      $('czGate').querySelector('.sub').textContent = e.message;
      return;
    }
    fill(); cache();
    loadConversations(); loadThemes(); loadWidgets();
    ['fontSize', 'lineHeight'].forEach(function (id) { $(id).oninput = paintDots; });
    $('convAccent').oninput = paintConvPreview; $('convBg').oninput = paintConvPreview;
    $('convPick').onchange = loadConvTheme;
    $('loadConvTheme').onclick = loadConvTheme;
    $('saveConvTheme').onclick = function () { saveConvTheme(false); };
    $('clearConvTheme').onclick = function () { saveConvTheme(true); };

    $('saveLook').onclick = async function () {
      var next = {
        font_family: $('fontFamily').value, font_size: parseInt($('fontSize').value, 10),
        line_height: parseFloat($('lineHeight').value), density: $('density').value,
        rail_mode: $('railMode').value, chan_layout: $('chanLayout').value,
        glass: $('glass').checked, reduce_motion: $('motion').checked,
      };
      try { await req('/api/customize/prefs', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(next) }); prefs = Object.assign(prefs, next); cache(); msg($('lookMsg'), 'Appearance saved.'); }
      catch (e) { msg($('lookMsg'), e.message, true); }
    };
    $('saveLayout').onclick = function () { saveLayout(($('layoutName').value || '').trim(), false); };
    $('saveSounds').onclick = async function () {
      var next = { dm: $('sndDm').checked, mention: $('sndMention').checked, event: $('sndEvent').checked, call: $('sndCall').checked };
      try { await req('/api/customize/prefs', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ notify_sounds: next }) }); prefs.notify_sounds = next; cache(); msg($('soundMsg'), 'Sounds saved.'); }
      catch (e) { msg($('soundMsg'), e.message, true); }
    };
    $('czBody').querySelectorAll('[data-preview]').forEach(function (b) {
      b.onclick = function () { prefs.notify_sounds = { dm: $('sndDm').checked, mention: $('sndMention').checked, event: $('sndEvent').checked, call: $('sndCall').checked }; if (window.CudicCustomize) CudicCustomize.playSound(b.getAttribute('data-preview')); };
    });
    $('createTheme').onclick = async function () {
      var name = $('themeName').value.trim();
      if (!name) { msg($('themeMsg'), 'Name the theme.', true); return; }
      try {
        await req('/api/customize/themes', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: name, manifest: { accent: $('themeAccent').value, background: $('themeBg').value.trim(), font: $('themeFont').value } }) });
        $('themeName').value = ''; $('themeBg').value = ''; loadThemes(); msg($('themeMsg'), 'Theme created. Publish it when ready.');
      } catch (e) { msg($('themeMsg'), e.message, true); }
    };
    $('saveProfile').onclick = async function () {
      var next = { banner_pos: parseInt($('bannerPos').value, 10), banner_animated: $('bannerAnim').checked, profile_pack_slug: $('profilePack').value.trim() };
      try { await req('/api/customize/prefs', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(next) }); prefs = Object.assign(prefs, next); cache(); msg($('profileMsg'), 'Profile extras saved.'); }
      catch (e) { msg($('profileMsg'), e.message, true); }
    };
    $('addWidget').onclick = async function () {
      var kind = $('widgetKind').value, a = $('widgetA').value.trim(), b = $('widgetB').value.trim();
      var body = { kind: kind };
      if (kind === 'text') body.text = a;
      if (kind === 'link') { body.label = a; body.url = b; }
      if (kind === 'achievement') body.code = a;
      try { await req('/api/customize/widgets', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); $('widgetA').value = ''; $('widgetB').value = ''; loadWidgets(); msg($('profileMsg'), 'Widget added.'); }
      catch (e) { msg($('profileMsg'), e.message, true); }
    };
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
