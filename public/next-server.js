/* file: public/next-server.js
 * what: Fifteen server, community and play specimens for the Next workspace.
 * invariants: reads NX.state at render time; writes through NX.commit; uploads are resized client-side and capped by the model.
 * see: public/next-core.js, public/next.js.
 */
(function () {
  'use strict';

  var NX = window.CudicNext;
  var e = NX.esc;
  var starIcon = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">'
    + '<path d="M11.525 2.295a.53.53 0 0 1 .95 0l2.31 4.679a2.123 2.123 0 0 0 1.595 1.16l5.166.756a.53.53 0 0 1 .294.904l-3.736 3.638a2.123 2.123 0 0 0-.611 1.878l.882 5.14a.53.53 0 0 1-.771.56l-4.618-2.428a2.122 2.122 0 0 0-1.973 0L6.396 21.01a.53.53 0 0 1-.77-.56l.881-5.139a2.122 2.122 0 0 0-.611-1.879L2.16 9.795a.53.53 0 0 1 .294-.906l5.165-.755a2.122 2.122 0 0 0 1.597-1.16z"/></svg>';

  NX.add({
    id: 'backgrounds', plan: 105, side: 'server', group: 'Place', title: 'Custom server backgrounds', added: '2026-11-20',
    blurb: 'Give the server a room, not just an icon. Art is uploaded once, cropped for the header, and checked for readable text.',
    why: 'A server is a place before it is a feature list. One strong background does more for belonging than ten settings — provided the name stays readable and the art can be removed.',
    proof: ['The server name stays readable at 4.5:1 over every approved crop.', 'Removing the art returns the flat fallback, not a broken header.'],
    gate: 'F6 storage, a 2 MB limit, one crop per server, and a contrast check before publish.',
    render: function () {
      var s = NX.state.bg;
      var ratio = NX.contrast(s.color, '#f7f5ec').toFixed(1);
      return '<div class="nx-art" id="nxBgArt" style="background-color:' + e(s.color) + '">'
        + '<div class="nx-art-top"><span class="nx-badge">Public</span><span class="nx-badge">1,284 members</span></div>'
        + '<div class="nx-art-name">Mosslight</div><div class="nx-art-meta">tiny games · slow evenings · 7 online</div></div>'
        + '<div class="nx-swatches">'
        + ['#20334d', '#2a1b3d', '#143327', '#3a2a12'].map(function (color) {
          return '<button type="button" class="nx-swatch" data-act="bg-swatch" data-color="' + color + '" style="--sw:' + color + '" aria-pressed="' + (s.color === color) + '" aria-label="Use background ' + color + '"><span>' + color + '</span></button>';
        }).join('') + '</div>'
        + '<div class="nx-row-fields" style="margin-top:10px"><div><label class="nx-label" for="nxBgUrl">Art URL</label><input class="nx-input" id="nxBgUrl" value="' + e(s.url) + '" placeholder="https://…"></div>'
        + NX.action('Use art', 'bg-apply', '', 'primary') + '</div>'
        + '<div class="nx-inline" style="margin-top:6px"><span class="nx-badge ' + (Number(ratio) >= 4.5 ? 'ok' : 'warn') + '">Text ' + ratio + ':1</span>'
        + (s.url ? NX.action('Remove art', 'bg-clear', '', 'quiet') : '') + '</div>'
        + '<p class="nx-preview-note">The fallback is a flat colour. Art is decorative; the name and contrast check carry the meaning.</p>';
    },
    actions: {
      'bg-swatch': function (el) {
        NX.state.bg.color = el.getAttribute('data-color');
        NX.state.bg.url = '';
        NX.commit('Background colour applied.');
      },
      'bg-apply': function () {
        var input = document.getElementById('nxBgUrl');
        try {
          var url = new URL((input && input.value || '').trim());
          if (!/^https?:$/.test(url.protocol)) throw new Error('http');
          NX.state.bg.url = url.href;
          NX.commit('Background art applied.');
        } catch (err) { NX.toast('Use a full http(s) image URL.'); }
      },
      'bg-clear': function () { NX.state.bg.url = ''; NX.commit('Background art removed.'); }
    }
  });

  NX.add({
    id: 'forums', plan: 116, side: 'server', group: 'Place', title: 'Forum-style channels',
    blurb: 'A channel where the unit is a titled thread, not a stream. Same thread primitive, different first screen.',
    why: 'Some conversations need to be findable next week. A forum channel is a reading surface with a post button — not a chat with a different icon.',
    proof: ['A thread can be created, opened and replied to without losing the list.', 'The channel shows tags and reply counts before you open it.'],
    gate: 'F5 pane and F1 parent ID. Reuse the thread system; do not build a second comments table.',
    render: function () {
      var s = NX.state.forums;
      var open = s.threads.filter(function (t) { return String(t.id) === String(s.openId); })[0];
      if (open) {
        return '<button type="button" class="nx-action quiet" data-act="forum-back">' + NX.icon('arrow-left') + ' All threads</button>'
          + '<h3 style="margin:12px 0 3px;font:600 .95rem/1.35 var(--font-head);color:var(--text-primary)">' + e(open.title) + '</h3>'
          + '<div class="nx-forum-meta"><span>' + e(open.author) + '</span><span>·</span><span>' + e(open.when) + '</span>'
          + open.tags.map(function (t) { return '<span class="nx-forum-tag">' + e(t) + '</span>'; }).join('') + '</div>'
          + '<p class="nx-msg-text" style="margin-top:8px">' + e(open.body) + '</p><div class="nx-divider"></div>'
          + (open.replies.length ? open.replies.map(function (r) { return NX.msg(r.by, r.initials || r.by.slice(0, 2).toUpperCase(), r.when || 'now', e(r.text)); }).join('') : '<p class="nx-muted">No replies yet. Start the useful part.</p>')
          + '<div class="nx-row-fields" style="margin-top:8px"><input class="nx-input" id="nxForumReply" maxlength="500" placeholder="Reply to this thread…" aria-label="Reply to this thread">'
          + NX.action('Reply', 'forum-reply', '', 'primary') + '</div>';
      }
      return (s.threads.map(function (t) {
        return '<button type="button" class="nx-forum-row" data-act="forum-open" data-id="' + t.id + '"><span class="nx-forum-copy"><span class="nx-forum-title">' + e(t.title) + '</span>'
          + '<span class="nx-forum-meta"><span>' + e(t.author) + '</span><span>' + e(t.when) + '</span><span>' + t.replies.length + ' replies</span>'
          + t.tags.map(function (tag) { return '<span class="nx-forum-tag">' + e(tag) + '</span>'; }).join('') + '</span></span><span class="nx-forum-arrow" aria-hidden="true">' + NX.icon('arrow-right') + '</span></button>';
      }).join(''))
        + '<div class="nx-divider"></div>'
        + (s.composing
          ? '<div class="nx-field"><label class="nx-label" for="nxForumTitle">Thread title</label><input class="nx-input" id="nxForumTitle" maxlength="120" placeholder="What is this about?"></div>'
            + '<div class="nx-field"><label class="nx-label" for="nxForumBody">First post</label><textarea class="nx-textarea" id="nxForumBody" maxlength="2000" placeholder="Give people enough to reply to."></textarea></div>'
            + '<div class="nx-inline">' + NX.action('Post thread', 'forum-create', '', 'primary') + NX.action('Cancel', 'forum-cancel', '', 'quiet') + '</div>'
          : NX.action('New thread', 'forum-compose', '', 'primary'))
        + '<p class="nx-preview-note">A forum is a channel type: title, tags, first post, replies. One thread system across the app.</p>';
    },
    actions: {
      'forum-open': function (el) { NX.state.forums.openId = el.getAttribute('data-id'); NX.state.forums.composing = false; NX.commit(); },
      'forum-back': function () { NX.state.forums.openId = 0; NX.commit(); },
      'forum-compose': function () { NX.state.forums.composing = true; NX.commit(); },
      'forum-cancel': function () { NX.state.forums.composing = false; NX.commit(); },
      'forum-create': function () {
        var title = (document.getElementById('nxForumTitle') || {}).value || '';
        var body = (document.getElementById('nxForumBody') || {}).value || '';
        title = title.trim(); body = body.trim();
        if (!title || !body) { NX.toast('Add a title and a first post.'); return; }
        var id = Date.now();
        NX.state.forums.threads.unshift({ id: id, title: title, body: body, tags: ['New'], author: 'You', when: 'now', replies: [] });
        NX.state.forums.openId = id;
        NX.state.forums.composing = false;
        NX.commit('Thread posted.');
      },
      'forum-reply': function () {
        var input = document.getElementById('nxForumReply');
        var text = (input && input.value || '').trim();
        if (!text) { NX.toast('Write a reply first.'); return; }
        var thread = NX.state.forums.threads.filter(function (t) { return String(t.id) === String(NX.state.forums.openId); })[0];
        if (!thread) return;
        thread.replies.push({ by: 'You', initials: 'Y', text: text, when: 'now' });
        NX.commit('Reply posted.');
      }
    }
  });

  NX.add({
    id: 'galleries', plan: 117, side: 'server', group: 'Place', title: 'Media gallery channels',
    blurb: 'A grid-first channel for screenshots and clips, with the same report path as a message and a hard storage budget.',
    why: 'Builds are visual. A gallery channel gives a server a memory wall without turning chat into an attachment dump. The grid is the message list.',
    proof: ['Every tile has a report action and a visible uploader.', 'The channel refuses an upload over the budget instead of failing after it.'],
    gate: 'F6 storage + F1 parent ID + report path. Client resize is a courtesy; the server enforces the limit.',
    render: function () {
      var s = NX.state.gallery;
      return '<div class="nx-gallery">' + s.items.map(function (item) {
        return '<div class="nx-tile" style="--tile:' + e(item.color) + '">'
          + (item.src ? '<img src="' + e(item.src) + '" alt="' + e(item.label) + '">' : '<b>' + e(item.label) + '</b>')
          + '<button type="button" class="nx-tile-x" data-act="gallery-remove" data-id="' + e(item.id) + '" aria-label="Remove ' + e(item.label) + '">' + NX.icon('x') + '</button></div>';
      }).join('') + '<label class="nx-tile-add" for="nxGalFile">' + NX.icon('plus') + '<span>Add image</span></label></div>'
        + '<input type="file" id="nxGalFile" accept="image/*" hidden>'
        + '<p class="nx-preview-note">Images are resized to 560px in the browser, then checked against the server budget. Max 6 in this model.</p>';
    },
    actions: {
      'gallery-remove': function (el) {
        var id = el.getAttribute('data-id');
        NX.state.gallery.items = NX.state.gallery.items.filter(function (item) { return item.id !== id; });
        NX.commit('Image removed from the gallery.');
      }
    },
    file: function (file) {
      if (NX.state.gallery.items.length >= 6) { NX.toast('This model holds six images. Remove one first.'); return; }
      NX.readImage(file).then(function (src) {
        NX.state.gallery.items.push({ id: NX.uid(), label: 'New image', color: '#20334d', src: src });
        NX.commit('Image added to the gallery.');
      }).catch(function (err) { NX.toast(err.message); });
    }
  });

  NX.add({
    id: 'directory', plan: 131, side: 'server', group: 'Place', title: 'Member directory',
    blurb: 'Find the person, not the message. Search by name, filter by presence or join date, and keep the card opt-in for younger members.',
    why: 'A community of 1,000 needs a front door that is not the message log. The directory is also a privacy surface: being findable must be a choice with a visible default.',
    proof: ['A member who opts out cannot be found by search.', 'The result row shows role and join date without exposing private fields.'],
    gate: 'Opt-in, default off for under-13 accounts, and no last-seen timestamp. Search is server-side and rate-limited.',
    render: function () {
      var s = NX.state.directory;
      return '<div class="nx-row-fields"><input class="nx-input" id="nxDirSearch" data-live="directory.q" value="' + e(s.q) + '" placeholder="Search members…" aria-label="Search members">'
        + '<span class="nx-badge">' + filtered().length + ' found</span></div>'
        + '<div class="nx-inline" style="margin-top:8px">'
        + [['all', 'All'], ['online', 'Online'], ['new', 'New']].map(function (pair) {
          return '<button type="button" class="nx-chip' + (s.filter === pair[0] ? ' on' : '') + '" data-act="dir-filter" data-f="' + pair[0] + '">' + pair[1] + '</button>';
        }).join('') + '</div>'
        + '<div class="nx-setting" style="margin-top:10px"><div><b>Show me in the directory</b><small>Name, role and join date. Never your email or last seen.</small></div>' + NX.toggle('directory.opted', s.opted, 'Show me in the directory') + '</div>'
        + '<div id="nxDirRows" style="margin-top:10px">' + rows() + '</div>';
    },
    actions: {
      'dir-filter': function (el) { NX.state.directory.filter = el.getAttribute('data-f') || 'all'; NX.commit(); }
    },
    input: function (el, path) {
      if (path !== 'directory.q') return;
      var box = document.getElementById('nxDirRows');
      if (box) box.innerHTML = rows();
      var count = document.querySelector('.nx-demo-body .nx-badge');
      if (count) count.textContent = filtered().length + ' found';
    }
  });

  function filtered() {
    var s = NX.state.directory;
    var q = String(s.q || '').toLowerCase();
    return NX.members.filter(function (m) {
      if (q && m.name.toLowerCase().indexOf(q) === -1) return false;
      if (s.filter === 'online' && m.status === 'offline') return false;
      if (s.filter === 'new' && m.joined.indexOf('2025') === -1) return false;
      return true;
    });
  }
  function rows() {
    var list = filtered();
    if (!list.length) return '<p class="nx-muted">No member matches. Try a shorter name or clear the filter.</p>';
    return list.map(function (m) {
      return '<div class="nx-directory-row"><span class="nx-ava alt">' + e(m.initials) + '</span><div><div class="nx-directory-name">' + e(m.name) + '</div>'
        + '<div class="nx-directory-meta">' + e(m.role) + ' · joined ' + e(m.joined) + '</div></div>'
        + '<span class="nx-directory-role">' + (m.status === 'offline' ? 'away' : m.status) + '</span></div>';
    }).join('');
  }

  NX.add({
    id: 'minecraft', plan: 161, side: 'server', group: 'Place', title: 'Minecraft status widget',
    blurb: 'A live card with the address, version and player count. One fixed server-side ping — never a browser request to an arbitrary host.',
    why: 'A game server is the reason many people join a Cudic server. A tiny status card turns the directory listing into a door you can actually open.',
    proof: ['The address can be copied in one action.', 'The ping is cached and server-controlled; the browser never supplies the target.'],
    gate: 'A fixed allow-list, 2s timeout, 60s cache and an SSRF-safe server fetch.',
    render: function () {
      var s = NX.state.mc;
      return '<div class="nx-mc"><div class="nx-mc-head"><div><div class="nx-mc-name">Mosslight SMP</div><div class="nx-mc-status ' + (s.online ? 'on' : '') + '"><i></i>' + (s.online ? 'Online' : 'Offline') + '</div></div>'
        + NX.action('Refresh', 'mc-refresh', '', 'quiet') + '</div><div class="nx-mc-body"><div><div class="nx-mc-address">play.mosslight.gg</div>'
        + '<div class="nx-mc-meta">Java 1.21.4 · ' + s.players + ' playing · checked ' + e(s.checked) + '</div></div>'
        + NX.action('Copy address', 'mc-copy', '', 'quiet') + '</div></div>'
        + '<p class="nx-preview-note">The server pings a fixed host with a short timeout. A member cannot make Cudic fetch an arbitrary address.</p>';
    },
    actions: {
      'mc-refresh': function () {
        var s = NX.state.mc;
        s.online = true;
        s.players = 6 + Math.floor(Math.random() * 6);
        s.checked = 'just now';
        NX.commit('Minecraft status refreshed.');
      },
      'mc-copy': function () {
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText('play.mosslight.gg').then(function () { NX.toast('Server address copied.'); }).catch(function () { NX.toast('Copy is blocked in this browser.'); });
        } else NX.toast('Copy is not available here.');
      }
    }
  });

  NX.add({
    id: 'tags', plan: 182, side: 'server', group: 'Place', title: 'Server categories and tags',
    blurb: 'A curated vocabulary for the directory: what the server is for, who it welcomes, and how it feels.',
    why: 'Free-text tags become a spam surface and a search dead end. A small curated set makes browsing legible and gives the directory a real filter.',
    proof: ['The same tag means the same thing in search and on the card.', 'A server can carry at most three tags.'],
    gate: 'A curated list owned by the directory, not the server. Three tags maximum.',
    render: function () {
      var s = NX.state.tags;
      return '<div class="nx-inline">' + NX.tags.map(function (tag) {
        return '<button type="button" class="nx-chip' + (s.selected.indexOf(tag) !== -1 ? ' on' : '') + '" data-act="tag-toggle" data-tag="' + e(tag) + '" aria-pressed="' + (s.selected.indexOf(tag) !== -1) + '">' + e(tag) + '</button>';
      }).join('') + '</div>'
        + '<div class="nx-divider"></div><div class="nx-link-card"><span class="nx-link-thumb" aria-hidden="true">MS</span><div><div class="nx-link-domain">Server preview</div>'
        + '<p class="nx-link-title">Mosslight</p><p class="nx-link-desc">A slow little server for tiny games and very unfinished ideas.</p>'
        + '<div class="nx-inline" style="margin-top:5px">' + s.selected.map(function (tag) { return '<span class="nx-forum-tag">' + e(tag) + '</span>'; }).join('') + '</div></div></div>'
        + '<p class="nx-preview-note">Tags are a filter, not a ranking. Three is enough to describe a place honestly.</p>';
    },
    actions: {
      'tag-toggle': function (el) {
        var s = NX.state.tags;
        var tag = el.getAttribute('data-tag');
        var at = s.selected.indexOf(tag);
        if (at !== -1) s.selected.splice(at, 1);
        else if (s.selected.length >= 3) { NX.toast('Three tags is the ceiling.'); return; }
        else s.selected.push(tag);
        NX.commit();
      }
    }
  });

  NX.add({
    id: 'age', plan: 189, side: 'server', group: 'Place', title: 'Age-appropriate content labels',
    blurb: 'Say who the room is for before someone joins. A label with a visible default, not a hidden checkbox.',
    why: 'Age labels are a promise about the room, not a verification system. They belong on the join card and the directory, and they must be paired with a real reporting path.',
    proof: ['The label appears on the join gate before the Join button.', 'Under-13 accounts default to All ages; a server cannot opt them into 18+.'],
    gate: 'Policy decision plus a join-gate component. The label never replaces moderation.',
    render: function () {
      var s = NX.state.age;
      return '<div class="nx-age-grid">' + NX.ages.map(function (age) {
        return '<button type="button" class="nx-age' + (s.label === age.label ? ' on' : '') + '" data-act="age-set" data-age="' + e(age.label) + '"><b>' + e(age.label) + '</b><small>' + e(age.hint) + '</small></button>';
      }).join('') + '</div>'
        + '<div class="nx-divider"></div><div class="nx-status-preview"><span class="nx-ava">MS</span><div class="nx-status-copy"><b>Mosslight</b><span>' + e(s.label) + ' · 1,284 members</span></div>'
        + '<span class="nx-badge" style="margin-left:auto">Join gate</span></div>'
        + '<p class="nx-preview-note">This labels the room. It does not verify age, and it does not replace moderation.</p>';
    },
    actions: { 'age-set': function (el) { NX.state.age.label = el.getAttribute('data-age'); NX.commit('Content label updated.'); } }
  });

  NX.add({
    id: 'status', plan: 129, side: 'server', group: 'People', title: 'Server status messages', added: '2026-11-15',
    blurb: 'A 60-character note that says what you are doing here, not who you are everywhere. Visible only inside this server.',
    why: 'A global status is a broadcast. A server status is a room signal: “here to build”, “testing the lift”, “just reading”. The scope is the feature.',
    proof: ['The status is scoped to the server and disappears from the member list when cleared.', 'It is text and one emoji, never a remote image.'],
    gate: 'F3 presence resolver. Server-scoped, not global, and never shown to non-members.',
    render: function () {
      var s = NX.state.status;
      return '<div class="nx-status-preview"><span class="nx-ava">MC</span><div class="nx-status-copy"><b>Maya Chen</b><span><span id="nxStatusPreviewEmoji">' + e(s.emoji) + '</span> <span id="nxStatusPreviewText">' + e(s.text) + '</span></span></div></div>'
        + '<div class="nx-row-fields" style="margin-top:10px;grid-template-columns:70px 1fr"><div><label class="nx-label" for="nxStatusEmoji">Emoji</label><input class="nx-input" id="nxStatusEmoji" data-live="status.emoji" maxlength="8" value="' + e(s.emoji) + '"></div>'
        + '<div><label class="nx-label" for="nxStatusText">Status</label><input class="nx-input" id="nxStatusText" data-live="status.text" maxlength="60" value="' + e(s.text) + '"></div></div>'
        + '<div class="nx-inline" style="margin-top:8px">' + NX.action('Save status', 'status-save', '', 'primary') + '<span class="nx-muted">Only members of this server see it.</span></div>';
    },
    actions: { 'status-save': function () { NX.commit('Server status saved.'); } },
    input: function (el, path) {
      if (path === 'status.emoji') { var a = document.getElementById('nxStatusPreviewEmoji'); if (a) a.textContent = el.value; }
      if (path === 'status.text') { var b = document.getElementById('nxStatusPreviewText'); if (b) b.textContent = el.value; }
    }
  });

  NX.add({
    id: 'favourites', plan: 132, side: 'server', group: 'People', title: 'Favourite members',
    blurb: 'A private shortlist of people you want to find again. No notification, no public count, no ranking.',
    why: 'Communities are hard to navigate when every member looks the same. A private favourite is a bookmark for people, and the privacy is the product.',
    proof: ['The target is never notified and never sees the count.', 'Removing a favourite takes one action and no confirmation.'],
    gate: 'Private by default, stored per viewer, and never exposed through the member API.',
    render: function () {
      var s = NX.state.favs;
      return '<div class="nx-inline" style="justify-content:space-between"><span class="nx-muted">Only you can see this list.</span><span class="nx-badge">' + s.ids.length + ' saved</span></div>'
        + '<div class="nx-divider"></div>' + NX.members.map(function (m) {
          var on = s.ids.indexOf(m.id) !== -1;
          return '<div class="nx-directory-row"><span class="nx-ava alt">' + e(m.initials) + '</span><div><div class="nx-directory-name">' + e(m.name) + '</div><div class="nx-directory-meta">' + e(m.role) + ' · ' + e(m.joined) + '</div></div>'
            + '<button type="button" class="nx-star' + (on ? ' on' : '') + '" data-act="fav-toggle" data-id="' + m.id + '" aria-label="' + (on ? 'Remove ' : 'Add ') + e(m.name) + ' from favourites" aria-pressed="' + on + '">' + starIcon + '</button></div>';
        }).join('');
    },
    actions: {
      'fav-toggle': function (el) {
        var s = NX.state.favs;
        var id = Number(el.getAttribute('data-id'));
        var at = s.ids.indexOf(id);
        if (at === -1) s.ids.push(id); else s.ids.splice(at, 1);
        NX.commit(at === -1 ? 'Added to your private favourites.' : 'Removed from favourites.');
      }
    }
  });

  NX.add({
    id: 'activity', plan: 133, side: 'server', group: 'People', title: 'Member activity indicators',
    blurb: 'Online, in a game, or idle — a small dot with a word. No last-seen timestamp, no inference about what someone is doing off Cudic.',
    why: 'Presence makes a room feel inhabited. It becomes surveillance when it records a timeline. Show the current state, then forget it.',
    proof: ['The indicator has a text label, not colour alone.', 'Turning activity sharing off hides the dot for everyone.'],
    gate: 'F3 presence, online-now only. No last seen; no history. Under-18 accounts default off.',
    render: function () {
      var s = NX.state.activity;
      var labels = { online: 'Online', playing: 'In a game', idle: 'Idle', offline: 'Away' };
      return '<div class="nx-setting"><div><b>Show my activity</b><small>Online, in a game, or idle. Never a last-seen time.</small></div>' + NX.toggle('activity.shown', s.shown, 'Show my activity') + '</div>'
        + '<div class="nx-divider"></div>' + NX.members.map(function (m) {
          return '<div class="nx-directory-row"><span class="nx-ava alt">' + e(m.initials) + '</span><div><div class="nx-directory-name">' + e(m.name) + '</div><div class="nx-directory-meta">' + e(m.role) + '</div></div>'
            + '<span class="nx-directory-role">' + (s.shown ? '<span class="nx-activity-dot ' + e(m.status) + '"></span><span class="nx-activity-label">' + e(labels[m.status] || m.status) + '</span>' : '<span class="nx-activity-label">Hidden</span>') + '</span></div>';
        }).join('');
    },
    actions: {}
  });

  NX.add({
    id: 'colors', plan: 135, side: 'server', group: 'People', title: 'Server profile colours',
    blurb: 'Role-based name colours that work in both themes and never become the only way to tell a mod from a member.',
    why: 'Colour is the fastest social signal in a chat room. It only works if it stays legible on every theme and if the role name is still present for anyone who cannot see the hue.',
    proof: ['Every name colour passes 4.5:1 against the panel.', 'The role label remains visible next to the name.'],
    gate: 'Role model + F2. Contrast is checked at save time, not left to the owner’s monitor.',
    render: function () {
      var s = NX.state.colors;
      return '<div class="nx-status-preview"><span class="nx-ava">MC</span><div class="nx-status-copy"><b style="color:' + e(s.Owner) + '">Maya Chen</b><span>Owner · online</span></div></div>'
        + '<div class="nx-divider"></div>' + ['Owner', 'Mod', 'Member'].map(function (role) {
          return '<div class="nx-colour-row"><input class="nx-colour-input" type="color" data-live="colors.' + role + '" value="' + e(s[role]) + '" aria-label="' + role + ' name colour">'
            + '<span class="nx-colour-name">' + role + '</span><span class="nx-colour-preview" id="nxColourPreview' + role + '" style="color:' + e(s[role]) + '">Maya</span></div>';
        }).join('')
        + '<p class="nx-preview-note">The role label carries the meaning. Colour is an accent, never the only signal.</p>';
    },
    actions: {},
    input: function (el, path) {
      if (path.indexOf('colors.') !== 0) return;
      var role = path.slice(7);
      var preview = document.getElementById('nxColourPreview' + role);
      if (preview) preview.style.color = el.value;
    }
  });

  NX.add({
    id: 'competitions', plan: 147, side: 'server', group: 'Play', title: 'Member-submitted competitions',
    blurb: 'A prompt, a deadline, a submission box and a vote. The winner is a human decision; the software just keeps the entries honest.',
    why: 'Competitions are the cheapest way to turn spectators into makers. The whole feature is the constraint: one prompt, one deadline, one entry per person, visible votes.',
    proof: ['One vote per member and one entry per member.', 'A hidden entry disappears from the public list but stays in the audit log.'],
    gate: 'Existing events + reports. Text first; screenshot and art variants reuse F6.',
    render: function () {
      var s = NX.state.comp;
      return '<div class="nx-comp"><div class="nx-comp-head"><div><div class="nx-comp-theme">Small worlds</div><p class="nx-poll-meta">Make a playable place in one screen.</p></div><div class="nx-comp-deadline">Closes<br><b>Friday, 18:00</b></div></div>'
        + (s.submitted ? '<div class="nx-result" style="margin-top:9px"><span class="nx-result-mark">' + NX.icon('check') + '</span><div><b>Your entry is in</b><small>You can edit it until the deadline.</small></div></div>'
          : '<div class="nx-row-fields" style="margin-top:9px"><input class="nx-input" id="nxCompTitle" maxlength="80" placeholder="Name your entry"><button type="button" class="nx-action primary" data-act="comp-submit">Enter</button></div>')
        + s.entries.map(function (c) {
          return '<div class="nx-comp-entry"><b>' + e(c.title) + '</b><span>by ' + e(c.author) + '</span><span>' + c.votes + ' votes</span>'
            + '<button type="button" class="nx-chip' + (s.voted === c.id ? ' on' : '') + '" data-act="comp-vote" data-id="' + e(c.id) + '">' + (s.voted === c.id ? 'Voted' : 'Vote') + '</button></div>';
        }).join('') + '</div>'
        + '<p class="nx-preview-note">Votes are visible. The winner is chosen by the server team, not by the count alone.</p>';
    },
    actions: {
      'comp-submit': function () {
        var s = NX.state.comp;
        var input = document.getElementById('nxCompTitle');
        var title = (input && input.value || '').trim();
        if (!title) { NX.toast('Name your entry first.'); return; }
        s.entries.push({ id: 'c' + NX.uid(), title: title, author: 'You', votes: 0 });
        s.submitted = true;
        NX.commit('Entry submitted.');
      },
      'comp-vote': function (el) {
        var s = NX.state.comp;
        var id = el.getAttribute('data-id');
        if (s.voted === id) return;
        if (s.voted) {
          var old = s.entries.filter(function (c) { return c.id === s.voted; })[0];
          if (old) old.votes = Math.max(0, old.votes - 1);
        }
        var next = s.entries.filter(function (c) { return c.id === id; })[0];
        if (!next) return;
        next.votes += 1;
        s.voted = id;
        NX.commit('Vote counted.');
      }
    }
  });

  NX.add({
    id: 'teams', plan: 168, side: 'server', group: 'Play', title: 'Team and squad pages',
    blurb: 'A page per squad with its people, games and wins. Not a role, not a private channel — a small public identity.',
    why: 'People join servers for other people. A team page gives a group a name and a history, and gives tournaments something real to point at.',
    proof: ['A team page can exist without a private channel.', 'Joining is reversible and never grants channel access by itself.'],
    gate: 'A new social object: team, membership, join/leave. Keep it separate from roles.',
    render: function () {
      var s = NX.state.teams;
      return s.teams.map(function (t) {
        var joined = s.joined.indexOf(t.id) !== -1;
        return '<div class="nx-team"><span class="nx-team-mark">' + e(t.mark) + '</span><div><b>' + e(t.name) + '</b><small>' + t.members + ' people · ' + t.games + ' games</small></div>'
          + '<button type="button" class="nx-action' + (joined ? ' quiet' : '') + '" data-act="team-join" data-id="' + e(t.id) + '">' + (joined ? 'Leave' : 'Join') + '</button></div>';
      }).join('')
        + '<div class="nx-divider"></div><div class="nx-row-fields"><input class="nx-input" id="nxTeamName" maxlength="36" placeholder="Start a team"><button type="button" class="nx-action primary" data-act="team-create">Create</button></div>'
        + '<p class="nx-preview-note">Team membership is public and separate from server roles. It never grants a channel by itself.</p>';
    },
    actions: {
      'team-join': function (el) {
        var s = NX.state.teams;
        var id = el.getAttribute('data-id');
        var at = s.joined.indexOf(id);
        if (at === -1) s.joined.push(id); else s.joined.splice(at, 1);
        NX.commit(at === -1 ? 'Joined the team.' : 'Left the team.');
      },
      'team-create': function () {
        var s = NX.state.teams;
        var input = document.getElementById('nxTeamName');
        var name = (input && input.value || '').trim();
        if (!name) { NX.toast('Give the team a name.'); return; }
        if (s.teams.length >= 6) { NX.toast('This model holds six teams.'); return; }
        var id = 't' + NX.uid();
        s.teams.push({ id: id, name: name, mark: name.slice(0, 2).toUpperCase(), members: 1, games: 0 });
        s.joined.push(id);
        NX.commit('Team created.');
      }
    }
  });

  NX.add({
    id: 'tournaments', plan: 159, side: 'server', group: 'Play', title: 'Tournament brackets',
    blurb: 'Four teams, two semifinals, one final. Advance a winner, reset the board, and let a mod override a bad score.',
    why: 'A bracket is a promise that the event will end. It needs to be readable at a glance and editable when a match goes wrong — not a spreadsheet with a dark theme.',
    proof: ['A bracket can be reset without deleting the teams.', 'A mod can advance a team after a disputed result.'],
    gate: 'Needs team pages (#168). Score overrides are audited.',
    render: function () {
      var s = NX.state.tour;
      var teams = ['Neon Drift', 'Mosslight', 'Rook & Roll', 'Tidepool'];
      var a = teams[0], b = teams[1], c = teams[2], d = teams[3];
      return '<div class="nx-bracket"><div>'
        + '<div class="nx-bracket-label">Semifinal 1</div><div class="nx-bracket-round">'
        + [a, b].map(function (t) { return '<button type="button" class="nx-bracket-team' + (s.semi1 === t ? ' won' : '') + '" data-act="tour-semi" data-slot="1" data-team="' + e(t) + '">' + e(t) + '</button>'; }).join('') + '</div>'
        + '<div class="nx-bracket-label" style="margin-top:8px">Semifinal 2</div><div class="nx-bracket-round">'
        + [c, d].map(function (t) { return '<button type="button" class="nx-bracket-team' + (s.semi2 === t ? ' won' : '') + '" data-act="tour-semi" data-slot="2" data-team="' + e(t) + '">' + e(t) + '</button>'; }).join('') + '</div>'
        + '</div><div class="nx-bracket-final"><div class="nx-bracket-label">Final</div>'
        + (s.semi1 && s.semi2
          ? '<div class="nx-bracket-round">' + [s.semi1, s.semi2].map(function (t) {
            return '<button type="button" class="nx-bracket-team' + (s.winner === t ? ' won' : '') + '" data-act="tour-final" data-team="' + e(t) + '">' + e(t) + '</button>';
          }).join('') + '</div>' + (s.winner ? '<p class="nx-bracket-winner">' + e(s.winner) + '<span>Winner · final</span></p>' : '<p class="nx-bracket-winner">Pick the final winner<span>Mod can override</span></p>')
          : '<p class="nx-muted">Pick both semifinal winners.</p>')
        + '</div></div><div class="nx-inline" style="margin-top:9px">' + NX.action('Reset bracket', 'tour-reset', '', 'quiet') + '<span class="nx-muted">Scores are audited.</span></div>';
    },
    actions: {
      'tour-semi': function (el) {
        var s = NX.state.tour;
        var slot = el.getAttribute('data-slot');
        var team = el.getAttribute('data-team');
        if (slot === '1') s.semi1 = team; else s.semi2 = team;
        if (s.winner && s.winner !== team) s.winner = '';
        NX.commit();
      },
      'tour-final': function (el) { NX.state.tour.winner = el.getAttribute('data-team'); NX.commit('Final winner set.'); },
      'tour-reset': function () { NX.state.tour = { semi1: '', semi2: '', winner: '' }; NX.commit('Bracket reset.'); }
    }
  });

  NX.add({
    id: 'emoji', plan: 171, side: 'server', group: 'Play', title: 'Custom emoji packs',
    blurb: 'A server vocabulary of tiny images. Approved once, usable in reactions and messages, reportable from the picker.',
    why: 'Custom emoji make a server feel like a place with its own language. The hard part is not upload; it is the approval and report path that keeps the pack safe.',
    proof: ['An emoji is usable only in the server that owns it.', 'A member can report an emoji without leaving the composer.'],
    gate: 'F6 storage, owner approval, 64KB cap, and a report action on every custom emoji.',
    render: function () {
      var s = NX.state.emoji;
      var selected = s.pack.filter(function (item) { return item.code === s.selected; })[0];
      return '<div class="nx-emoji-grid">' + s.pack.map(function (item) {
        return '<button type="button" class="nx-emoji' + (s.selected === item.code ? ' on' : '') + '" data-act="emoji-select" data-code="' + e(item.code) + '" aria-label="Use :' + e(item.code) + ':" aria-pressed="' + (s.selected === item.code) + '">' + e(item.glyph) + '</button>';
      }).join('') + '</div>'
        + '<div class="nx-inline" style="margin-top:7px">' + s.pack.map(function (item) {
          return '<span class="nx-mono" style="color:var(--text-tertiary)">:' + e(item.code) + ':</span>';
        }).join('') + '</div>'
        + '<div class="nx-row-fields" style="margin-top:10px"><input class="nx-input" id="nxEmojiCustom" maxlength="32" placeholder="Add a glyph or :shortcode:" aria-label="Add a custom emoji">'
        + '<button type="button" class="nx-action primary" data-act="emoji-add">Add</button></div>'
        + (selected ? '<div class="nx-status-preview" style="margin-top:10px"><span class="nx-ava">' + e(selected.glyph) + '</span><div class="nx-status-copy"><b>:' + e(selected.code) + ':</b><span>Owned by Mosslight · approved by Maya</span></div>'
          + NX.action('Use', 'emoji-send', '', 'quiet') + '</div>' : '')
        + '<p class="nx-preview-note">Custom emoji are server-owned. Adding one sends it to the owner for approval; reporting is always one tap away.</p>';
    },
    actions: {
      'emoji-select': function (el) { NX.state.emoji.selected = el.getAttribute('data-code'); NX.commit(); },
      'emoji-add': function () {
        var s = NX.state.emoji;
        var input = document.getElementById('nxEmojiCustom');
        var value = (input && input.value || '').trim();
        if (!value) { NX.toast('Add an emoji or a shortcode.'); return; }
        if (s.pack.length >= 18) { NX.toast('This model holds eighteen emoji.'); return; }
        var code = /^:[^:]+:$/.test(value) ? value.slice(1, -1) : 'custom' + (s.pack.length + 1);
        var glyph = /^:[^:]+:$/.test(value) ? '✨' : value.slice(0, 8);
        s.pack.push({ code: code, glyph: glyph });
        s.selected = code;
        NX.commit('Emoji sent for approval.');
      },
      'emoji-send': function () { NX.toast('Emoji inserted into the composer.'); }
    }
  });

  /* ── Batch 2: the join funnel, organisation, play and the owner desk ─────── */

  NX.add({
    id: 'preview', plan: 184, side: 'server', group: 'Place', title: 'Server preview before joining', added: '2026-11-15',
    blurb: 'See the room before the door: banner, public channels, rules and member count, with Join at the end instead of a bare modal.',
    why: 'A join modal tells you a name and a member count. A preview page tells you whether you belong, and it is the cheapest raid filter we have: the public surface never names a private channel.',
    proof: ['Only public channels appear in the preview.', 'Joining from the preview writes the same membership row as the join modal.'],
    gate: 'Public-channel filter on the read path. No member names, no private structure, no join count beyond the total.',
    render: function () {
      var s = NX.state.preview;
      var channels = ['#general', '#build-log', '#art'];
      return '<div class="nx-pv" style="--pv:' + e(s.banner) + '">'
        + '<div class="nx-pv-art"><span class="nx-badge">Public preview</span><b>Mosslight</b>'
        + '<span class="nx-pv-meta">1,284 members · 7 online · tiny games, slow evenings</span></div>'
        + '<div class="nx-pv-body"><div class="nx-pv-row"><span class="nx-label" style="margin:0">Channels you can read</span>'
        + '<span class="nx-badge' + (s.triedPrivate ? ' warn' : '') + '">' + (s.triedPrivate ? '3 private withheld' : '3 public') + '</span></div>'
        + '<div class="nx-inline">' + channels.map(function (c) { return '<span class="nx-forum-tag">' + e(c) + '</span>'; }).join('') + '</div>'
        + '<div class="nx-divider"></div>'
        + '<p class="nx-pv-rule"><b>Rules.</b> Be kind on purpose. No spoilers for a week. One promotion a day.</p>'
        + '<div class="nx-inline" style="margin-top:10px">'
        + (s.joined
          ? '<span class="nx-badge ok">Joined</span>' + NX.action('Leave preview', 'preview-leave', '', 'quiet')
          : NX.action('Join Mosslight', 'preview-join', '', 'primary') + NX.action('Try to show private channels', 'preview-private', '', 'quiet'))
        + '</div></div></div>'
        + '<p class="nx-preview-note">' + (s.joined ? 'You are a member: the same row any join path writes.' : 'The preview reads the public slice only. Private channels never reach this page.') + '</p>';
    },
    actions: {
      'preview-join': function () { NX.state.preview.joined = true; NX.commit('Joined Mosslight from the preview.'); },
      'preview-leave': function () { NX.state.preview.joined = false; NX.commit('Left the preview.'); },
      'preview-private': function () { NX.state.preview.triedPrivate = true; NX.commit('The preview refuses to name private channels.'); }
    }
  });

  NX.add({
    id: 'welcome', plan: 110, side: 'server', group: 'Place', title: 'Customisable welcome page',
    blurb: 'A public /s/<id>/welcome with the banner, the rules and the next event — the join page a link can point at.',
    why: 'An invite usually lands on a modal with a name. A welcome page gives a server a front door it can style and share, and gives Join somewhere sensible to live.',
    proof: ['The page renders for a signed-out visitor with no member data.', 'The banner is the only server style; type stays the app type.'],
    gate: 'A public read route, banner reuse from #101, and the directory content rules for a page under-13s can reach.',
    render: function () {
      var s = NX.state.welcome;
      return '<div class="nx-pv" style="--pv:' + e(s.banner) + '">'
        + '<div class="nx-pv-art"><span class="nx-badge">/s/mosslight/welcome</span><b>Mosslight</b>'
        + '<span class="nx-pv-meta">Friday game night · 20:00 GMT</span></div>'
        + '<div class="nx-pv-body">'
        + (s.rules ? '<p class="nx-pv-rule"><b>House rules.</b> No spoilers, no raids, no selling. Test builds welcome.</p>' : '<p class="nx-muted">Rules are hidden from the public page.</p>')
        + '<div class="nx-setting" style="margin-top:8px"><div><b>Show the rules</b><small>Owner choice. Never member names.</small></div>'
        + NX.toggle('welcome.rules', s.rules, 'Show the rules on the welcome page') + '</div>'
        + '<div class="nx-inline" style="margin-top:9px">' + NX.action('Copy invite link', 'welcome-copy', '', 'primary')
        + NX.action('Preview as a visitor', 'welcome-visitor', '', 'quiet') + '</div></div></div>'
        + '<div class="nx-swatches">' + ['#143327', '#20334d', '#2a1b3d', '#3a2a12'].map(function (color) {
          return '<button type="button" class="nx-swatch' + (s.banner === color ? ' on' : '') + '" data-act="welcome-swatch" data-color="' + color + '" style="--sw:' + color + '" aria-pressed="' + (s.banner === color) + '" aria-label="Banner ' + color + '"><span>' + color + '</span></button>';
        }).join('') + '</div>'
        + '<p class="nx-preview-note">The banner is the only server style on this page; headings and rules use the app face.</p>';
    },
    actions: {
      'welcome-swatch': function (el) { NX.state.welcome.banner = el.getAttribute('data-color'); NX.commit('Welcome banner updated.'); },
      'welcome-copy': function () {
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText('https://cudic.app/s/mosslight/welcome').then(function () { NX.toast('Welcome link copied.'); }).catch(function () { NX.toast('Copy is blocked in this browser.'); });
        } else NX.toast('Copy is not available here.');
      },
      'welcome-visitor': function () { NX.commit('Visitor view: no member names, no private channels.'); }
    }
  });

  NX.add({
    id: 'joinq', plan: 191, side: 'server', group: 'Place', title: 'Custom join questions', added: '2026-11-15',
    blurb: 'One to three questions before joining. Answers are visible to mods only and deleted with the membership.',
    why: 'A question is a filter that respects the person answering it: it stops the raid and starts the introduction at once. It only works if the answer is treated as personal data, not as a profile field.',
    proof: ['A member can still join without answering.', 'Answers never appear on the public preview or the member card.'],
    gate: 'Owner-only read, exported with the account, deleted with the membership. Never indexed, never in a webhook.',
    render: function () {
      var s = NX.state.joinq;
      if (s.sent) {
        return '<div class="nx-result"><span class="nx-result-mark">' + NX.icon('check') + '</span><div><b>Answers sent to the mods</b><small>Deleted automatically if you leave the server.</small></div></div>'
          + (s.modView ? '<div class="nx-modcard"><span class="nx-badge">Mod view</span><p class="nx-msg-text" style="margin-top:6px">' + (e(s.why) || 'No answer to question one.') + '</p>'
            + '<p class="nx-muted">Plays ' + e(s.games || 'unknown') + ' · joined just now</p></div>' : '')
          + '<div class="nx-inline" style="margin-top:9px">' + NX.action(s.modView ? 'Hide mod view' : 'Preview mod view', 'joinq-mod', '', 'quiet')
          + NX.action('Start over', 'joinq-reset', '', 'quiet') + '</div>';
      }
      return '<div class="nx-field"><label class="nx-label" for="nxJoinWhy">Why do you want to join?</label>'
        + '<textarea class="nx-textarea" id="nxJoinWhy" data-live="joinq.why" maxlength="240" placeholder="One honest sentence.">' + e(s.why) + '</textarea></div>'
        + '<div class="nx-field"><label class="nx-label" for="nxJoinGames">What do you play?</label>'
        + '<input class="nx-input" id="nxJoinGames" data-live="joinq.games" maxlength="80" value="' + e(s.games) + '"></div>'
        + '<div class="nx-inline">' + NX.action('Send answers', 'joinq-send', '', 'primary') + NX.action('Skip and join', 'joinq-skip', '', 'quiet') + '</div>'
        + '<p class="nx-preview-note">Mods see the answers. Nobody else does, and leaving the server deletes them.</p>';
    },
    actions: {
      'joinq-send': function () {
        if (!String(NX.state.joinq.why || '').trim()) { NX.toast('Answer the first question or skip.'); return; }
        NX.state.joinq.sent = true; NX.commit('Answers sent to the mods.');
      },
      'joinq-skip': function () { NX.state.joinq.why = ''; NX.state.joinq.sent = true; NX.commit('Joined without answering.'); },
      'joinq-mod': function () { NX.state.joinq.modView = !NX.state.joinq.modView; NX.commit(); },
      'joinq-reset': function () { NX.state.joinq = { why: '', games: 'Mosslight', sent: false, modView: false }; NX.commit('Join questions reset.'); }
    }
  });

  NX.add({
    id: 'channels-order', plan: 113, side: 'server', group: 'Place', title: 'Custom channel ordering', added: '2026-11-15',
    blurb: 'Put channels and folders in the order the server actually reads. Each move saves on its own row.',
    why: 'A sidebar is a map, and every server walks through it differently. Ordering is the cheapest customisation that changes how a room feels day to day.',
    proof: ['A move persists after a reload.', 'Two mods moving different rows both keep their change.'],
    gate: '21 (shipped) for folders. A move writes one row, never the whole list.',
    render: function () {
      var s = NX.state.order;
      return '<div class="nx-chan-list">' + s.list.map(function (name, i) {
        return '<div class="nx-chan-row"><span class="nx-chan-grip">' + NX.icon('grip') + '</span><span class="nx-chan-name">' + e(name) + '</span>'
          + '<span class="nx-chan-btns">'
          + '<button type="button" class="nx-chan-btn" data-act="chan-up" data-i="' + i + '" aria-label="Move ' + e(name) + ' up"' + (i === 0 ? ' disabled' : '') + '>' + NX.icon('arrow-left') + '</button>'
          + '<button type="button" class="nx-chan-btn down" data-act="chan-down" data-i="' + i + '" aria-label="Move ' + e(name) + ' down"' + (i === s.list.length - 1 ? ' disabled' : '') + '>' + NX.icon('arrow-left') + '</button>'
          + '</span></div>';
      }).join('') + '</div>'
        + '<div class="nx-inline" style="margin-top:8px">' + NX.action('Reset order', 'chan-reset', '', 'quiet')
        + '<span class="nx-muted">' + (s.last ? e(s.last) + ' saved on its own row.' : 'Drag, or use the arrows.') + '</span></div>'
        + '<p class="nx-preview-note">Order is per server. One drag writes one row, so two mods cannot overwrite each other’s whole list.</p>';
    },
    actions: {
      'chan-up': function (el) { shift(el, -1); },
      'chan-down': function (el) { shift(el, 1); },
      'chan-reset': function () { NX.state.order = NX.clone(NX.defaults.order); NX.commit('Channel order reset.'); }
    }
  });
  function shift(el, dir) {
    var s = NX.state.order;
    var i = Number(el.getAttribute('data-i'));
    var j = i + dir;
    if (j < 0 || j >= s.list.length) return;
    var moved = s.list.splice(i, 1)[0];
    s.list.splice(j, 0, moved);
    s.last = moved;
    NX.commit(moved + ' moved.');
  }

  NX.add({
    id: 'channel-tags', plan: 123, side: 'server', group: 'Place', title: 'Channel tags', added: '2026-11-15',
    blurb: 'Short tags on a channel, filterable in the list. Three tags, twelve characters each, sanitised like a name.',
    why: 'A channel name can only say so much. Tags make the list sortable without adding folders, and a capped vocabulary keeps search honest.',
    proof: ['A fourth tag is refused, not silently dropped.', 'The tag filter and the channel row agree on the same string.'],
    gate: 'A curated list owned by the server. Three tags, 12 characters, the same sanitiser as channel names.',
    render: function () {
      var s = NX.state.chantags;
      var pool = ['build', 'help', 'art', 'lfg', 'voice', 'staff'];
      return '<div class="nx-status-preview"><span class="nx-ava alt">#</span><div class="nx-status-copy"><b>#build-log</b>'
        + '<span>' + (s.on.length ? s.on.map(function (t) { return '#' + t; }).join(' · ') : 'No tags yet') + '</span></div>'
        + '<span class="nx-badge" style="margin-left:auto">' + s.on.length + ' / 3</span></div>'
        + '<div class="nx-inline" style="margin-top:10px">' + pool.map(function (t) {
          var on = s.on.indexOf(t) !== -1;
          return '<button type="button" class="nx-chip' + (on ? ' on' : '') + '" data-act="chantag-toggle" data-tag="' + t + '" aria-pressed="' + on + '">' + e(t) + '</button>';
        }).join('') + '</div>'
        + '<div class="nx-row-fields" style="margin-top:9px"><div><label class="nx-label" for="nxTagNew">Custom tag</label>'
        + '<input class="nx-input" id="nxTagNew" maxlength="12" placeholder="12 characters max"></div>' + NX.action('Add', 'chantag-add', '', 'primary') + '</div>'
        + '<p class="nx-preview-note">Tags filter the channel list. Three is a ceiling, not a suggestion.</p>';
    },
    actions: {
      'chantag-toggle': function (el) {
        var s = NX.state.chantags;
        var t = el.getAttribute('data-tag');
        var at = s.on.indexOf(t);
        if (at !== -1) s.on.splice(at, 1);
        else if (s.on.length >= 3) { NX.toast('Three tags is the ceiling.'); return; }
        else s.on.push(t);
        NX.commit();
      },
      'chantag-add': function () {
        var s = NX.state.chantags;
        var input = document.getElementById('nxTagNew');
        var raw = (input && input.value || '').trim().toLowerCase().replace(/[^a-z0-9-]/g, '');
        if (!raw) { NX.toast('Use letters, numbers or a dash.'); return; }
        if (raw.length > 12) { NX.toast('Twelve characters maximum.'); return; }
        if (s.on.indexOf(raw) !== -1) { NX.toast('That tag is already on.'); return; }
        if (s.on.length >= 3) { NX.toast('Three tags is the ceiling.'); return; }
        s.on.push(raw);
        NX.commit('Tag added.');
      }
    }
  });

  NX.add({
    id: 'spotlights', plan: 138, side: 'server', group: 'People', title: 'Community member spotlights', added: '2026-11-15',
    blurb: 'A mod picks a member or a creation and the server posts a card. The member agrees before their name goes up.',
    why: 'A spotlight is the warmest thing a mod can do with machinery we already have: it reuses the system-post path and turns one person’s work into the room’s memory. Consent is the whole difference between recognition and exposure.',
    proof: ['A member who has not opted in never appears in the picker.', 'The posted card carries one creation and no contact detail.'],
    gate: 'System posts (69, shipped) plus per-member opt-in. A minor’s card needs a second confirmation.',
    render: function () {
      var s = NX.state.spotlight;
      var picked = NX.members.filter(function (m) { return String(m.id) === String(s.picked); })[0];
      return '<div class="nx-inline">' + NX.members.slice(0, 3).map(function (m) {
        var on = String(m.id) === String(s.picked);
        return '<button type="button" class="nx-spot" data-act="spot-pick" data-id="' + m.id + '" aria-pressed="' + on + '">'
          + '<span class="nx-ava alt">' + e(m.initials) + '</span><b>' + e(m.name) + '</b><small>' + e(m.role) + '</small></button>';
      }).join('') + '</div>'
        + '<div class="nx-setting" style="margin-top:10px"><div><b>' + (picked ? e(picked.name) + ' opted in' : 'Pick a member first') + '</b><small>A spotlight needs their yes, not just a mod’s.</small></div>'
        + NX.toggle('spotlight.optedIn', s.optedIn, 'Member opted in') + '</div>'
        + '<div class="nx-inline">' + NX.action('Post the spotlight', 'spot-post', '', 'primary') + '</div>'
        + (s.posted && picked ? '<div class="nx-result" style="margin-top:10px"><span class="nx-result-mark">' + NX.icon('check') + '</span><div><b>' + e(picked.name) + ' is this week’s spotlight</b><small>One creation, one line, no contact detail.</small></div></div>' : '')
        + '<p class="nx-preview-note">Consent first. A member who has not opted in cannot be picked, and a minor needs a second confirmation.</p>';
    },
    actions: {
      'spot-pick': function (el) { NX.state.spotlight.picked = el.getAttribute('data-id'); NX.state.spotlight.posted = false; NX.commit(); },
      'spot-post': function () {
        var s = NX.state.spotlight;
        if (!s.picked) { NX.toast('Pick a member first.'); return; }
        if (!s.optedIn) { NX.toast('That member has not opted in.'); return; }
        s.posted = true;
        NX.commit('Spotlight posted.');
      }
    }
  });

  NX.add({
    id: 'mod-dashboard', plan: 193, side: 'server', group: 'People', title: 'Moderation dashboard', added: '2026-11-15',
    blurb: 'Reports, the last actions, slow mode and mutes on one page — reports only, never messages.',
    why: 'Moderation fails quietly when the queue is spread across three screens. One desk with a count and one action per row is the difference between a mod working and a mod guessing.',
    proof: ['A resolved report leaves the queue and lands in the log.', 'The desk never reads a DM; it reads reports and actions only.'],
    gate: '51 (shipped) for the audit log and mod actions. Read scope is reports, not messages.',
    render: function () {
      var s = NX.state.dash;
      return '<div class="nx-dash-stats"><div><b>' + s.open.length + '</b><span>open</span></div>'
        + '<div><b>' + s.resolved.length + '</b><span>resolved today</span></div>'
        + '<div><b>' + (s.slow ? 'On' : 'Off') + '</b><span>slow mode</span></div></div>'
        + (s.open.length ? s.open.map(function (r) {
          return '<div class="nx-dash-row"><span class="nx-dash-kind">' + e(r.kind) + '</span>'
            + '<div class="nx-dash-copy"><b>' + e(r.target) + '</b><span>' + e(r.by) + ' · ' + e(r.age) + '</span></div>'
            + '<button type="button" class="nx-action" data-act="dash-resolve" data-id="' + e(r.id) + '">Resolve</button>'
            + '<button type="button" class="nx-action quiet" data-act="dash-ignore" data-id="' + e(r.id) + '">Ignore</button></div>';
        }).join('') : '<div class="nx-result"><span class="nx-result-mark">' + NX.icon('check') + '</span><div><b>Queue clear</b><small>New reports arrive here.</small></div></div>')
        + '<div class="nx-setting" style="margin-top:10px"><div><b>Slow mode</b><small>One message every 10 seconds in every channel.</small></div>'
        + NX.toggle('dash.slow', s.slow, 'Slow mode') + '</div>'
        + (s.resolved.length ? '<div class="nx-divider"></div><p class="nx-label" style="margin-bottom:2px">Last actions</p>'
          + s.resolved.slice(0, 3).map(function (r) {
            return '<div class="nx-dash-row done"><span class="nx-dash-kind">' + e(r.kind) + '</span>'
              + '<div class="nx-dash-copy"><b>' + e(r.target) + '</b><span>' + e(r.outcome) + ' · logged</span></div></div>';
          }).join('') : '')
        + '<p class="nx-preview-note">Reports and actions only. The desk cannot read a DM, and every resolve is in the audit log.</p>';
    },
    actions: {
      'dash-resolve': function (el) { closeReport(el, 'Resolved'); },
      'dash-ignore': function (el) { closeReport(el, 'Ignored'); }
    }
  });
  function closeReport(el, outcome) {
    var s = NX.state.dash;
    var id = el.getAttribute('data-id');
    var row = s.open.filter(function (r) { return r.id === id; })[0];
    if (!row) return;
    s.open = s.open.filter(function (r) { return r.id !== id; });
    row.outcome = outcome;
    s.resolved.unshift(row);
    NX.commit(outcome === 'Resolved' ? 'Report resolved and logged.' : 'Report ignored and logged.');
  }

  NX.add({
    id: 'lfg', plan: 156, side: 'server', group: 'Play', title: 'Looking-for-group board', added: '2026-11-15',
    blurb: 'Posts that say “two more for a run”: game, time zone, slots and a join button. Members only, and no DMs until both people opt in.',
    why: 'The hardest part of a small server is starting. A board turns “anyone around?” into a post with a time and a count, without opening a private channel for every attempt.',
    proof: ['A post fills up and closes itself at the slot count.', 'Chat stays in the server until both people allow DMs.'],
    gate: 'Members only. No DM surface until both sides opt in, and a minor’s post never advertises an external contact.',
    render: function () {
      var s = NX.state.lfg;
      return s.posts.map(function (p) {
        var here = s.joined.indexOf(p.id) !== -1;
        var have = p.have + (here ? 1 : 0);
        var full = have >= p.need;
        return '<div class="nx-lfg"><div><b>' + e(p.game) + '</b><span class="nx-lfg-meta">' + e(p.when) + ' · ' + e(p.by) + ' · ' + have + '/' + p.need + '</span></div>'
          + (full && !here
            ? '<span class="nx-badge warn">Full</span>'
            : '<button type="button" class="nx-action' + (here ? ' quiet' : '') + '" data-act="lfg-join" data-id="' + e(p.id) + '">' + (here ? 'Leave' : 'Join') + '</button>')
          + '</div>';
      }).join('')
        + '<div class="nx-divider"></div>'
        + '<div class="nx-row-fields" style="grid-template-columns:1fr 88px"><div><label class="nx-label" for="nxLfgGame">Game</label>'
        + '<select class="nx-select" id="nxLfgGame" data-change="lfg.game">' + ['Neon Drift', 'Mosslight SMP', 'Rook & Roll'].map(function (g) { return '<option' + (s.game === g ? ' selected' : '') + '>' + g + '</option>'; }).join('') + '</select></div>'
        + '<div><label class="nx-label" for="nxLfgSlots">Slots</label><select class="nx-select" id="nxLfgSlots" data-change="lfg.slots">' + ['2', '3', '4'].map(function (n) { return '<option' + (s.slots === n ? ' selected' : '') + '>' + n + '</option>'; }).join('') + '</select></div></div>'
        + '<div class="nx-inline" style="margin-top:7px">' + NX.action('Post an LFG', 'lfg-post', '', 'primary')
        + '<span class="nx-muted">Members only · no DMs until both opt in</span></div>';
    },
    actions: {
      'lfg-join': function (el) {
        var s = NX.state.lfg;
        var id = el.getAttribute('data-id');
        var at = s.joined.indexOf(id);
        if (at === -1) s.joined.push(id); else s.joined.splice(at, 1);
        NX.commit(at === -1 ? 'You are in the group.' : 'Left the group.');
      },
      'lfg-post': function () {
        var s = NX.state.lfg;
        if (s.posts.length >= 5) { NX.toast('This board holds five posts.'); return; }
        s.posts.unshift({ id: 'l' + NX.uid(), game: s.game, when: 'Today · 20:00 GMT', have: 1, need: Number(s.slots) || 2, by: 'You' });
        NX.commit('LFG posted.');
      }
    }
  });

  NX.add({
    id: 'server-info', plan: 162, side: 'server', group: 'Play', title: 'Game server connection info', added: '2026-11-15',
    blurb: 'An address, a port and a copy button on the server page — set by the owner, never inferred.',
    why: 'The address is the shortest path from a Cudic server to the game. It is also a home IP if the owner runs it from a bedroom, so the field warns before it saves and the public card is a second, explicit toggle.',
    proof: ['Only an owner can set or clear the address.', 'Publishing to the public card is a separate choice, off by default.'],
    gate: 'Owner-only write, a warning before saving, and a private default: the address stays in-server until listed.',
    render: function () {
      var s = NX.state.conn;
      return '<div class="nx-mc"><div class="nx-mc-head"><div><div class="nx-mc-name">Connection</div>'
        + '<div class="nx-mc-status' + (s.listed ? '' : ' on') + '"><i></i>' + (s.listed ? 'Listed on the public card' : 'Server members only') + '</div></div>'
        + (s.owner ? NX.action('Clear', 'conn-clear', '', 'quiet') : '<span class="nx-badge">Owner only</span>') + '</div>'
        + '<div class="nx-mc-body"><div><div class="nx-mc-address">' + (s.address ? e(s.address) : 'No address set') + (s.address ? ':' + e(s.port) : '') + '</div>'
        + '<div class="nx-mc-meta">Java · owner-set · no live ping</div></div>'
        + (s.address ? NX.action('Copy', 'conn-copy', '', 'quiet') : '') + '</div></div>'
        + '<div class="nx-row-fields" style="margin-top:9px"><div><label class="nx-label" for="nxConnAddr">Address</label>'
        + '<input class="nx-input" id="nxConnAddr" data-live="conn.address" value="' + e(s.address) + '" placeholder="play.example.gg"></div>'
        + '<div><label class="nx-label" for="nxConnPort">Port</label><input class="nx-input" id="nxConnPort" data-live="conn.port" value="' + e(s.port) + '" inputmode="numeric" style="width:82px"></div></div>'
        + '<div class="nx-setting" style="margin-top:9px"><div><b>List on the public card</b><small>Off by default. A home IP should be a choice.</small></div>'
        + NX.toggle('conn.listed', s.listed, 'List the address publicly') + '</div>'
        + (s.listed ? '<p class="nx-preview-note">This address is public now. Clear it or turn the listing off to withdraw it.</p>' : '<p class="nx-preview-note">Only the owner can edit this, and the address is never pinged from the browser.</p>');
    },
    actions: {
      'conn-copy': function () {
        var s = NX.state.conn;
        if (!s.address) { NX.toast('Set an address first.'); return; }
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(s.address + ':' + s.port).then(function () { NX.toast('Address copied.'); }).catch(function () { NX.toast('Copy is blocked in this browser.'); });
        } else NX.toast('Copy is not available here.');
      },
      'conn-clear': function () { NX.state.conn.address = ''; NX.commit('Address cleared.'); }
    }
  });

  NX.add({
    id: 'game-nights', plan: 170, side: 'server', group: 'Play', title: 'Community game nights', added: '2026-11-15',
    blurb: 'A recurring event with a game attached: RSVP, cancel one week, and the series carries on.',
    why: 'A weekly night is the cheapest habit a server can build. Recurrence is also where events usually break: a cancelled week must not reappear when the next one is generated.',
    proof: ['Cancelling one week leaves the series and the other weeks intact.', 'RSVP counts reset per occurrence, not per series.'],
    gate: '62 (shipped) for events. Recurrence is a new key: series, occurrence, cancellation. No poll, no waitlist.',
    render: function () {
      var s = NX.state.nights;
      var people = 12 + (s.rsvp ? 1 : 0);
      return '<div class="nx-night' + (s.cancelled ? ' off' : '') + '">'
        + '<div class="nx-night-head"><div><b>Friday night · Neon Drift</b><span class="nx-lfg-meta">Every Friday · 20:00 GMT · week 46</span></div>'
        + '<span class="nx-badge ' + (s.cancelled ? 'warn' : 'ok') + '">' + (s.cancelled ? 'Cancelled' : 'Scheduled') + '</span></div>'
        + (s.cancelled
          ? '<p class="nx-preview-note">This occurrence is cancelled. The series continues on 21 Nov, and this week stays cancelled.</p>'
            + '<div class="nx-inline">' + NX.action('Reopen this week', 'night-reopen', '', 'quiet') + '</div>'
          : '<div class="nx-inline" style="margin-top:9px">' + NX.action(s.rsvp ? 'You are going' : 'RSVP', 'night-rsvp', '', s.rsvp ? 'quiet' : 'primary')
            + NX.action('Cancel this week', 'night-cancel', '', 'quiet') + '<span class="nx-muted">' + people + ' going</span></div>')
        + '</div>'
        + '<p class="nx-preview-note">One occurrence, one row. A cancelled week does not come back when next week is generated.</p>';
    },
    actions: {
      'night-rsvp': function () { NX.state.nights.rsvp = !NX.state.nights.rsvp; NX.commit(NX.state.nights.rsvp ? 'RSVP saved for this week.' : 'RSVP removed.'); },
      'night-cancel': function () { NX.state.nights.cancelled = true; NX.commit('This week cancelled. The series continues.'); },
      'night-reopen': function () { NX.state.nights.cancelled = false; NX.commit('Week reopened.'); }
    }
  });
})();
