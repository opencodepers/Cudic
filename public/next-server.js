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
    id: 'backgrounds', plan: 105, side: 'server', group: 'Place', title: 'Custom server backgrounds',
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
    id: 'status', plan: 129, side: 'server', group: 'People', title: 'Server status messages',
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
})();
