/* file: public/cudic-menu.js
 * what: Cudic's own right-click menu. On chat messages it opens a Discord-style
 *   message menu (quick reactions, add reaction, reply, copy, pin, bookmark,
 *   reminder, speak, report); on the rail's Discord icon it splits server and
 *   profile; everywhere else it keeps the link/copy/back menu.
 * invariants: text fields, selects and games keep the native menu, so typing
 *   and paste never break; message actions reuse client.js globals
 *   (toggleReact, addSystemMessage, current) and the existing API routes.
 */
(function () {
  if (window.CudicMenu) return;
  window.CudicMenu = true;

  var menu = null;
  var QUICK = ['👍', '❤️', '🔥', '💀'];
  var MORE = ['👍', '👎', '❤️', '😂', '🎉', '🔥', '👀', '✨', '😮', '😢', '💯', '✅'];

  function svg(body) {
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" ' +
      'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">' + body + '</svg>';
  }
  var ICON = {
    smile: svg('<circle cx="12" cy="12" r="9"/><path d="M8.5 14.5a4.5 4.5 0 0 0 7 0"/><path d="M9 9.5h.01M15 9.5h.01"/>'),
    reply: svg('<path d="M9 14 4 9l5-5"/><path d="M20 20v-7a4 4 0 0 0-4-4H4"/>'),
    copy: svg('<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V6a2 2 0 0 1 2-2h9"/>'),
    pin: svg('<path d="M12 17v5"/><path d="m9 3 6 0-1 7 3 3v2H7v-2l3-3-1-7Z"/>'),
    bookmark: svg('<path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/>'),
    clock: svg('<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>'),
    speak: svg('<path d="M11 5 6 9H3v6h3l5 4z"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/><path d="M18.5 6a9 9 0 0 1 0 12"/>'),
    flag: svg('<path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><path d="M4 22v-7"/>'),
    link: svg('<path d="M10 13a5 5 0 0 0 7 0l2-2a5 5 0 0 0-7-7l-1 1"/><path d="M14 11a5 5 0 0 0-7 0l-2 2a5 5 0 0 0 7 7l1-1"/>'),
    edit: svg('<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>'),
    history: svg('<path d="M3 12a9 9 0 1 0 3-6.7"/><path d="M3 4v5h5"/><path d="M12 8v4l3 2"/>'),
    collect: svg('<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="M12 11v4M10 13h4"/>'),
    server: svg('<rect x="2" y="2" width="20" height="8" rx="2"/><rect x="2" y="14" width="20" height="8" rx="2"/><path d="M6 6h.01M6 18h.01"/>'),
    user: svg('<path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>'),
    calendar: svg('<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 11h18"/><path d="M8 15h.01M12 15h.01M16 15h.01M8 18h.01M12 18h.01"/>')
  };

  var css = document.createElement('style');
  // Material 3 menu behaviour at the brand sheet's density: 252px panel, 6px
  // inset, 4px rows, 16px icons, 36px row height. The spec's 48dp row is right
  // for a four-item menu, but a message menu carries eleven actions and would
  // run taller than a laptop screen. States (hover, press, focus ring) are the
  // part of Material 3 that matters here, so they stay; the height does not.
  css.textContent =
    '#cudicCtx{position:fixed;z-index:2147483000;width:252px;max-width:calc(100vw - 16px);box-sizing:border-box;' +
      'padding:6px;background:var(--panel-raised,#1e1f22);color:var(--text-primary,#dbdee1);' +
      'border:1px solid var(--line,#2b2d31);border-radius:8px;box-shadow:0 8px 24px rgba(0,0,0,.45);' +
      'font:400 14px/1.2 "Geist",system-ui,sans-serif;user-select:none;transform-origin:top left;' +
      'animation:cm-in 160ms cubic-bezier(.2,0,0,1)}' +
    '@keyframes cm-in{from{opacity:0;transform:scale(.97) translateY(-2px)}}' +
    '@media (prefers-reduced-motion:reduce){#cudicCtx{animation:none}}' +
    '#cudicCtx[hidden]{display:none}' +
    '#cudicCtx .cm-quick{display:grid;grid-template-columns:repeat(4,1fr);gap:4px;padding:0 0 6px}' +
    '#cudicCtx .cm-quick button{height:40px;border:0;border-radius:6px;background:rgba(127,127,127,.14);' +
      'color:inherit;font-size:20px;line-height:1;cursor:pointer;transition:background-color 120ms steps(4)}' +
    '#cudicCtx .cm-quick button:hover{background:rgba(127,127,127,.24)}' +
    '#cudicCtx .cm-quick button:active{background:rgba(127,127,127,.3)}' +
    '#cudicCtx .cm-more{display:grid;grid-template-columns:repeat(6,1fr);gap:2px;padding:2px 4px 6px}' +
    '#cudicCtx .cm-more button{height:30px;border:0;border-radius:5px;background:none;font-size:16px;' +
      'line-height:1;cursor:pointer}' +
    '#cudicCtx .cm-more button:hover{background:rgba(127,127,127,.16)}' +
    '#cudicCtx .cm-quick button:focus-visible,#cudicCtx .cm-more button:focus-visible{' +
      'outline:2px solid var(--signal,#b8f23a);outline-offset:1px}' +
    '#cudicCtx .cm-item{display:flex;align-items:center;gap:10px;width:100%;padding:7px 8px;' +
      'border:0;border-radius:4px;background:none;color:inherit;font:inherit;text-align:left;' +
      'cursor:pointer;transition:background-color 120ms steps(4)}' +
    '#cudicCtx .cm-item:hover{background:rgba(127,127,127,.14)}' +
    '#cudicCtx .cm-item:active{background:rgba(127,127,127,.22)}' +
    '#cudicCtx .cm-item:focus-visible{background:rgba(127,127,127,.14);' +
      'outline:2px solid var(--signal,#b8f23a);outline-offset:-2px}' +
    '#cudicCtx .cm-item svg{width:16px;height:16px;flex:0 0 16px;opacity:.9}' +
    '#cudicCtx .cm-label{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}' +
    '#cudicCtx .cm-chev{opacity:.6;font-size:15px;line-height:1}' +
    '#cudicCtx .cm-hint{max-width:110px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;' +
      'color:var(--text-tertiary,#949ba4);font:400 11px/1 "Geist Mono",ui-monospace,monospace;letter-spacing:.04em}' +
    '#cudicCtx .cm-sep{height:1px;margin:5px 2px;background:var(--line,#2b2d31)}' +
    '#cudicCtx .cm-danger{color:var(--danger,#f23f43)}' +
    '#cudicCtx .cm-danger svg{opacity:1}';
  document.head.appendChild(css);

  function close() { if (menu) menu.hidden = true; }
  function say(text) {
    if (typeof window.addSystemMessage === 'function') window.addSystemMessage(text);
  }
  function copy(text) {
    if (navigator.clipboard && window.isSecureContext) { navigator.clipboard.writeText(text).catch(function () {}); return; }
    var t = document.createElement('textarea');
    t.value = text;
    t.style.cssText = 'position:fixed;top:0;left:0;opacity:0';
    document.body.appendChild(t);
    t.select();
    try { document.execCommand('copy'); } catch (e) {}
    t.remove();
  }
  function token() {
    try { if (window.TOKEN) return Promise.resolve(window.TOKEN); } catch (e) {}
    try { if (typeof window.getAuthToken === 'function') return window.getAuthToken(); } catch (e) {}
    try {
      var raw = localStorage.getItem('sb-qgcydphkaujomxyzwcht-auth-token');
      return Promise.resolve(raw ? (JSON.parse(raw).access_token || null) : null);
    } catch (e) { return Promise.resolve(null); }
  }
  function apiHost() {
    return (typeof WS_URL !== 'undefined' && WS_URL) ? WS_URL.replace(/^wss?:\/\//, 'https://') : '';
  }
  async function call(path, opts) {
    var t = await token();
    if (!t) throw new Error('Sign in first.');
    opts = opts || {};
    opts.headers = Object.assign({ Authorization: 'Bearer ' + t }, opts.headers || {});
    if (opts.body) opts.headers['Content-Type'] = 'application/json';
    var r = await fetch(apiHost() + path, opts);
    var d = await r.json().catch(function () { return {}; });
    if (!r.ok) throw new Error(d.text || d.error || 'Request failed.');
    return d;
  }

  function item(label, icon, fn, extra) {
    extra = extra || {};
    var b = document.createElement('button');
    b.type = 'button';
    b.className = 'cm-item' + (extra.danger ? ' cm-danger' : '');
    b.setAttribute('role', 'menuitem');
    b.innerHTML = (icon || '') + '<span class="cm-label"></span>';
    b.querySelector('.cm-label').textContent = label;
    if (extra.chev) {
      var c = document.createElement('span');
      c.className = 'cm-chev';
      c.textContent = '\u203A';
      b.appendChild(c);
    }
    if (extra.hint) {
      var k = document.createElement('span');
      k.className = 'cm-hint';
      k.textContent = extra.hint;
      b.appendChild(k);
    }
    b.addEventListener('click', function (ev) {
      ev.stopPropagation();
      if (!extra.keepOpen) close();
      fn(ev, b);
    });
    return b;
  }
  function sep() {
    var d = document.createElement('div');
    d.className = 'cm-sep';
    return d;
  }
  function menuEl() {
    if (!menu) {
      menu = document.createElement('div');
      menu.id = 'cudicCtx';
      menu.hidden = true;
      menu.setAttribute('role', 'menu');
      document.body.appendChild(menu);
    }
    return menu;
  }
  function motion() {
    var m = window.CudicMotion;
    return m && m.animate && !m.reduce ? m : null;
  }
  function place(e, el) {
    el.hidden = false;
    el.style.left = '0px';
    el.style.top = '0px';
    var x = Math.max(8, Math.min(e.clientX, innerWidth - el.offsetWidth - 8));
    var y = Math.max(8, Math.min(e.clientY, innerHeight - el.offsetHeight - 8));
    el.style.left = x + 'px';
    el.style.top = y + 'px';
    var m = motion();
    if (m) {
      el.style.transformOrigin = (x < innerWidth / 2 ? 'left' : 'right') + ' ' + (y < innerHeight / 2 ? 'top' : 'bottom');
      try {
        m.animate(el, { opacity: [0, 1], transform: ['scale(.96)', 'scale(1)'] }, {
          duration: 0.13, easing: 'ease-out'
        });
      } catch (err) {}
    }
  }

  // ── Message actions ─────────────────────────────────────────────
  function messageText(row) {
    var el = row.querySelector('.msg-text');
    return el ? String(el.textContent || '').replace(/\s+/g, ' ').trim() : '';
  }
  function mid(row) { return row.getAttribute('data-mid') || ''; }

  function react(row, emoji) {
    var id = mid(row);
    if (!id) return;
    if (typeof window.toggleReact === 'function') { window.toggleReact(id, emoji); return; }
    call('/api/messages/' + encodeURIComponent(id) + '/react', {
      method: 'POST', body: JSON.stringify({ emoji: emoji })
    }).catch(function (e) { say(e.message || 'Could not react.'); });
  }

  function reply(row) {
    var input = document.getElementById('msgInput');
    if (!input) return;
    var author = row.querySelector('.author');
    var quote = '> ' + (author ? author.textContent.trim() + ': ' : '') + messageText(row).slice(0, 180) + '\n';
    input.value = quote + input.value;
    input.focus();
    try { input.selectionStart = input.selectionEnd = quote.length; } catch (e) {}
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }

  function pin(row) {
    var id = mid(row);
    // The API takes the target state, it does not toggle. Send the opposite
    // of the row's current state so a pinned message actually unpins.
    var on = row.classList.contains('pinned');
    call('/api/messages/' + encodeURIComponent(id) + '/pin', {
      method: 'POST', body: JSON.stringify({ pin: !on })
    }).then(function (d) {
      if (d && d.error) { say(d.error); return; }
      var now = (d && typeof d.pinned === 'boolean') ? d.pinned : !on;
      row.classList.toggle('pinned', now);
      var pb = row.querySelector('.msg-pin');
      if (pb && typeof window.setPinLabel === 'function') window.setPinLabel(pb, now);
      if (typeof window.loadPinned === 'function') window.loadPinned();
      say(now ? 'Message pinned.' : 'Message unpinned.');
    }).catch(function (e) { say(e.message || 'Pin failed.'); });
  }

  function bookmark(row) {
    call('/api/extras/pins', {
      method: 'POST', body: JSON.stringify({ messageId: mid(row) })
    }).then(function () { say('Bookmarked for you.'); })
      .catch(function (e) { say(e.message || 'Could not bookmark.'); });
  }

  function remind(row) {
    var mins = prompt('Remind me in how many minutes?', '60');
    if (mins == null) return;
    var n = parseInt(mins, 10);
    if (!(n >= 1 && n <= 525600)) { alert('Pick between 1 minute and a year.'); return; }
    call('/api/extras/reminders', {
      method: 'POST',
      body: JSON.stringify({
        messageId: mid(row),
        remindAt: new Date(Date.now() + n * 60000).toISOString()
      })
    }).then(function () {
      say('Reminder set for ' + n + ' minute' + (n === 1 ? '' : 's') + ' from now.');
    }).catch(function (e) { say(e.message || 'Could not set the reminder.'); });
  }

  function speak(row) {
    var text = messageText(row);
    if (!text || !window.speechSynthesis) return;
    try {
      var u = new SpeechSynthesisUtterance(text);
      u.rate = 1;
      window.speechSynthesis.cancel();
      window.speechSynthesis.speak(u);
    } catch (e) { say('Speech is not available here.'); }
  }

  function report(row) {
    var flag = row.querySelector('.msg-flag');
    if (flag) { flag.click(); return; }
    say('Report is only available on saved messages.');
  }

  function copyLink(row) {
    var conv = window.current;
    var base = location.origin + '/chat';
    var link = conv && conv.id ? base + '?c=' + encodeURIComponent(conv.id) : location.href;
    void row;
    copy(link);
  }

  function icsStamp(d) {
    return d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
  }
  function icsText(s) {
    return String(s || '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
  }
  function addCalendar(row) {
    var text = messageText(row);
    if (!text) { say('This message has no text to add.'); return; }
    var d = new Date(Date.now() + 3600000);
    d.setMinutes(0, 0, 0);
    var pad = function (n) { return String(n).padStart(2, '0'); };
    var local = d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
    var when = prompt('When should this go on your calendar? (YYYY-MM-DD HH:MM)', local);
    if (when == null || !when.trim()) return;
    var start = new Date(when.trim().replace(' ', 'T'));
    if (!Number.isFinite(start.getTime())) { alert('Use YYYY-MM-DD HH:MM.'); return; }
    var end = new Date(start.getTime() + 3600000);
    var summary = 'Cudic: ' + text.replace(/\s+/g, ' ').slice(0, 70);
    var conv = window.current;
    var link = conv && conv.id ? location.origin + '/chat?c=' + encodeURIComponent(conv.id) : location.href;
    var lines = [
      'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Cudic//Message//EN', 'CALSCALE:GREGORIAN',
      'BEGIN:VEVENT', 'UID:' + Date.now().toString(36) + '@cudic', 'DTSTAMP:' + icsStamp(new Date()),
      'DTSTART:' + icsStamp(start), 'DTEND:' + icsStamp(end), 'SUMMARY:' + icsText(summary),
      'DESCRIPTION:' + icsText(text + '\n\n' + link), 'URL:' + link,
      'END:VEVENT', 'END:VCALENDAR', ''
    ];
    var blob = new Blob([lines.join('\r\n')], { type: 'text/calendar;charset=utf-8' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = 'cudic-message.ics';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 2000);
    say('Calendar file downloaded.');
  }

  function buildMessageMenu(row, e) {
    var el = menuEl();
    el.replaceChildren();

    var quick = document.createElement('div');
    quick.className = 'cm-quick';
    QUICK.forEach(function (emoji) {
      var b = document.createElement('button');
      b.type = 'button';
      b.textContent = emoji;
      b.title = 'React with ' + emoji;
      b.addEventListener('click', function (ev) { ev.stopPropagation(); close(); react(row, emoji); });
      quick.appendChild(b);
    });
    el.appendChild(quick);

    el.appendChild(item('Add Reaction', ICON.smile, function () {
      var grid = el.querySelector('.cm-more');
      if (grid) { grid.remove(); return; }
      grid = document.createElement('div');
      grid.className = 'cm-more';
      MORE.forEach(function (emoji) {
        var b = document.createElement('button');
        b.type = 'button';
        b.textContent = emoji;
        b.addEventListener('click', function (ev) { ev.stopPropagation(); close(); react(row, emoji); });
        grid.appendChild(b);
      });
      el.insertBefore(grid, el.children[1] ? el.children[1] : null);
      var mm = motion();
      if (mm) {
        try { mm.animate(grid, { opacity: [0, 1], y: [-4, 0] }, { duration: 0.12, easing: 'ease-out' }); } catch (err) {}
      }
    }, { chev: true, keepOpen: true }));
    el.appendChild(sep());

    el.appendChild(item('Reply', ICON.reply, function () { reply(row); }));
    el.appendChild(item('Copy Text', ICON.copy, function () { copy(messageText(row)); }));
    // Edit / History / Collect used to be inline buttons. They stay in the DOM
    // (hidden by chat.html) so this menu can reuse their existing handlers.
    var editBtn = row.querySelector('.msg-edit');
    if (editBtn) el.appendChild(item('Edit Message', ICON.edit, function () { editBtn.click(); }));
    var histBtn = row.querySelector('.msg-history');
    if (histBtn) el.appendChild(item('Message History', ICON.history, function () { histBtn.click(); }));
    // Authors may pin their own messages; everyone else needs owner/mod in a
    // server channel (the server enforces the same rule).
    var canPin = row.classList.contains('mine') || window.myRole === 'owner' || window.myRole === 'mod';
    if (canPin) {
      el.appendChild(item(row.classList.contains('pinned') ? 'Unpin Message' : 'Pin Message', ICON.pin, function () { pin(row); }));
    }
    if (window.current && window.current.kind === 'dm') {
      el.appendChild(item('Bookmark Message', ICON.bookmark, function () { bookmark(row); }));
    }
    var colBtn = row.querySelector('.msg-collect');
    if (colBtn) el.appendChild(item('Collect Message', ICON.collect, function () { colBtn.click(); }));
    el.appendChild(item('Create Reminder', ICON.clock, function () { remind(row); }));
    el.appendChild(item('Copy Conversation Link', ICON.link, function () { copyLink(row); }));
    el.appendChild(item('Add to Calendar', ICON.calendar, function () { addCalendar(row); }));
    el.appendChild(item('Speak Message', ICON.speak, function () { speak(row); }));

    if (!row.classList.contains('mine')) {
      el.appendChild(sep());
      el.appendChild(item('Report Message', ICON.flag, function () { report(row); }, { danger: true }));
    }

    place(e, el);
  }

  // ── Discord icon menu ───────────────────────────────────────────
  // The rail has one Discord button but two things people mean by it: the
  // Cudic server and Nathen's own profile. A click goes to the server, so the
  // right-click is where the other one lives. The invite is read off the link
  // itself, so changing it in sidebar.js changes it here too.
  var DISCORD_PROFILE = 'https://discord.com/users/1553117800543821969';
  function buildDiscordMenu(e, link) {
    var el = menuEl();
    el.replaceChildren();
    var server = link.getAttribute('href') || 'https://discord.gg/rAar6AJ3N';
    el.appendChild(item('Cudic Discord server', ICON.server, function () {
      window.open(server, '_blank', 'noopener');
    }, { hint: 'invite' }));
    el.appendChild(item('My Discord profile', ICON.user, function () {
      window.open(DISCORD_PROFILE, '_blank', 'noopener');
    }, { hint: '@itoleursweets' }));
    place(e, el);
  }

  // ── Generic page menu ───────────────────────────────────────────
  function buildPageMenu(e) {
    var el = menuEl();
    el.replaceChildren();
    var link = e.target.closest ? e.target.closest('a[href]') : null;
    var href = link && link.getAttribute('href') ? link.href : '';
    var sel = window.getSelection ? String(window.getSelection()).trim() : '';

    if (href) {
      el.appendChild(item('Open link', '', function () { location.href = href; }));
      el.appendChild(item('Open in new tab', '', function () { window.open(href, '_blank', 'noopener'); }));
      el.appendChild(item('Copy link address', '', function () { copy(href); }));
      el.appendChild(sep());
    }
    if (sel) {
      el.appendChild(item('Copy', '', function () { copy(sel); }, { hint: sel.length > 22 ? sel.slice(0, 22) + '…' : sel }));
      el.appendChild(sep());
    }
    el.appendChild(item('Copy page link', '', function () { copy(location.href); }));
    el.appendChild(item('Back', '', function () { history.back(); }));
    el.appendChild(item('Reload', '', function () { location.reload(); }));

    place(e, el);
  }

  function build(e) {
    var row = e.target.closest ? e.target.closest('.msg[data-mid]') : null;
    if (row && row.closest('#messages')) { buildMessageMenu(row, e); return; }
    var discord = e.target.closest ? e.target.closest('[data-p="discord"], .sidebar a[href*="discord.gg"]') : null;
    if (discord) buildDiscordMenu(e, discord);
    else buildPageMenu(e);
  }

  document.addEventListener('contextmenu', function (e) {
    if (e.defaultPrevented) return;
    var t = e.target;
    var native = t.closest && t.closest('input,textarea,select,[contenteditable=""],[contenteditable="true"],#cudicCtx');
    if (native) return;
    e.preventDefault();
    build(e);
  });
  document.addEventListener('mousedown', function (e) { if (menu && !menu.contains(e.target)) close(); });
  document.addEventListener('scroll', close, true);
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') close(); });
  window.addEventListener('blur', close);
  window.addEventListener('resize', close);
})();
