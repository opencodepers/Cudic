/* file: public/next-chat.js
 * what: Fifteen chat and community specimens for the Next workspace, each with its own render and action map.
 * invariants: reads NX.state at render time; writes through NX.commit; no user text reaches innerHTML without NX.esc.
 * see: public/next-core.js, public/next.js.
 */
(function () {
  'use strict';

  var NX = window.CudicNext;
  var e = NX.esc;

  NX.add({
    id: 'threads', plan: 15, side: 'chat', group: 'Talk', title: 'Threads everywhere',
    blurb: 'Keep a side conversation attached to the message that started it. The room stays readable; the detail stays findable.',
    why: 'This is the largest missing chat primitive. A thread is a second view of one message, not another channel, so it does not split the room or multiply the sidebar.',
    proof: ['A reply opens in place and never creates a channel.', 'The reply count survives a reload and a deep link.'],
    gate: 'F5 pane + F1 parent ID. One thread primitive powers game comments, forums and channels.',
    render: function () {
      var s = NX.state.threads;
      var replies = s.replies.map(function (r) { return NX.msg(r.by, r.initials, r.when, e(r.text)); }).join('');
      return '<div class="nx-chat">'
        + '<div class="nx-chat-bar"><span class="nx-dot"></span>#build-log<span style="margin-left:auto">12 online</span></div>'
        + '<div class="nx-chat-log">'
        + NX.msg('Maya Chen', 'MC', '2m', 'The jump feels floaty — try <b>620</b> instead of 540.',
          NX.action(s.open ? 'Hide thread' : 'Open thread · ' + s.replies.length, 'thread-toggle', '', 'quiet'))
        + (s.open ? '<div class="nx-thread"><div class="nx-thread-head"><b>Thread · tuning the jump</b><span class="nx-badge">' + s.replies.length + ' replies</span></div>'
          + replies
          + '<div class="nx-thread-compose"><input class="nx-input" id="nxThreadInput" maxlength="240" placeholder="Reply in thread…" aria-label="Reply in thread">'
          + NX.action('Reply', 'thread-add', '', 'primary') + '</div></div>' : '')
        + '</div></div>';
    },
    actions: {
      'thread-toggle': function () { NX.state.threads.open = !NX.state.threads.open; NX.commit(); },
      'thread-add': function () {
        var input = document.getElementById('nxThreadInput');
        var text = (input && input.value || '').trim();
        if (!text) { NX.toast('Write a reply first.'); if (input) input.focus(); return; }
        NX.state.threads.replies.push({ by: 'You', initials: 'Y', when: 'now', text: text });
        NX.commit('Reply added to the thread.', 'thread-toggle');
      }
    }
  });

  NX.add({
    id: 'link', plan: 17, side: 'chat', group: 'Talk', title: 'Link previews',
    blurb: 'A link becomes a card with a domain, title and one useful line — never a surprise embed that runs code.',
    why: 'Chat is where people trade builds. A preview turns a bare URL into a decision: open it, trust it, or ignore it. The server fetches once and caches the result.',
    proof: ['A preview can be removed without losing the URL.', 'Fetching is server-side, timed out and never executes page scripts.'],
    gate: 'Safe fetch, 2s timeout, cached metadata, and a report control on the card.',
    render: function () {
      var s = NX.state.link;
      return '<label class="nx-label" for="nxLinkUrl">Paste a link</label><div class="nx-row-fields">'
        + '<input class="nx-input" id="nxLinkUrl" value="' + e(s.url) + '" placeholder="https://…" inputmode="url">'
        + NX.action('Preview', 'link-preview', '', 'primary') + '</div>'
        + (s.removed
          ? '<p class="nx-preview-note">Preview removed. The message still keeps the URL, so nothing is lost.</p>' + NX.action('Undo remove', 'link-undo', '', 'quiet')
          : '<div class="nx-link-card"><span class="nx-link-thumb" aria-hidden="true">CD</span><div><div class="nx-link-domain">' + e(NX.domainOf(s.url) || 'link') + '</div>'
            + '<p class="nx-link-title">Neon Drift — a tiny night drive</p><p class="nx-link-desc">Steer with two keys. Finish the loop before the sun comes up.</p></div>'
            + NX.action('Remove', 'link-remove', '', 'quiet') + '</div>')
        + '<p class="nx-preview-note">Fetched on the server with a 2 second timeout. Page scripts are never executed.</p>';
    },
    actions: {
      'link-preview': function () {
        var input = document.getElementById('nxLinkUrl');
        var value = (input && input.value || '').trim();
        try {
          var url = new URL(value);
          if (!/^https?:$/.test(url.protocol)) throw new Error('http');
          NX.state.link.url = url.href;
          NX.state.link.removed = false;
          NX.commit('Preview attached.');
        } catch (err) { NX.toast('Use a full http:// or https:// link.'); if (input) input.focus(); }
      },
      'link-remove': function () { NX.state.link.removed = true; NX.commit('Preview removed.'); },
      'link-undo': function () { NX.state.link.removed = false; NX.commit('Preview restored.'); }
    }
  });

  NX.add({
    id: 'interactive', plan: 92, side: 'chat', group: 'Talk', title: 'Interactive messages',
    blurb: 'Polls already ship. Finish the pattern with declared buttons and a tiny form that writes one answer back to the message.',
    why: 'A room should be able to commit to a plan without a second app. The message owns the state, so the answer is visible where the question was asked.',
    proof: ['A choice updates the card in place and can be changed.', 'The payload is validated server-side; a button is not a permission bypass.'],
    gate: 'F1 message metadata + F2 resolver. Actions are allow-listed, never raw URLs.',
    render: function () {
      var s = NX.state.interactive;
      var c = s.counts;
      var choices = [['in', 'I’m in'], ['maybe', 'Maybe'], ['out', 'Can’t make it']];
      return NX.msg('Jules Avery', 'JA', '4m', 'Movie night Friday? I made a tiny RSVP card so we stop losing the count.',
        choices.map(function (pair) {
          return '<button type="button" class="nx-choice' + (s.vote === pair[0] ? ' on' : '') + '" data-act="interactive-choice" data-choice="' + pair[0] + '">'
            + pair[1] + '<small>' + c[pair[0]] + ' now</small></button>';
        }).join(''))
        + (s.form ? '<div class="nx-divider"></div><label class="nx-label" for="nxRsvpTime">Friday start</label><div class="nx-row-fields"><select class="nx-select" id="nxRsvpTime"><option>7:00 PM</option><option>8:00 PM</option><option>9:00 PM</option></select>'
          + NX.action('Send RSVP', 'rsvp-send', '', 'primary') + '</div>' : '')
        + '<p class="nx-preview-note">Buttons and forms are allow-listed message metadata. No script, no remote payload.</p>';
    },
    actions: {
      'interactive-choice': function (el) {
        var s = NX.state.interactive;
        var next = el.getAttribute('data-choice');
        if (!next || !s.counts[next] && s.counts[next] !== 0) return;
        if (s.vote === next) {
          s.counts[next] = Math.max(0, s.counts[next] - 1);
          s.vote = '';
        } else {
          if (s.vote) s.counts[s.vote] = Math.max(0, s.counts[s.vote] - 1);
          s.counts[next] += 1;
          s.vote = next;
        }
        NX.commit('Your answer is on the card.');
      },
      'rsvp-send': function () {
        var s = NX.state.interactive;
        if (s.vote !== 'in') {
          if (s.vote) s.counts[s.vote] = Math.max(0, s.counts[s.vote] - 1);
          s.counts.in += 1;
          s.vote = 'in';
        }
        s.form = false;
        NX.commit('RSVP saved to the message.');
      }
    }
  });

  NX.add({
    id: 'reactions', plan: 12, side: 'chat', group: 'Talk', title: 'Advanced reactions',
    blurb: 'The fixed six are a start. Add custom emoji, combined chips and a picker that remembers the room’s favourites.',
    why: 'Reactions are the lowest-effort way to make a room feel inhabited. Custom emoji turn an inside joke into a shared vocabulary — but only if upload, approval and reporting share one path.',
    proof: ['One person can react once per emoji; counts never double.', 'A custom emoji can be reported from the picker without opening a menu.'],
    gate: 'F6 storage + a per-server approval path. The payload is one row per person, per emoji.',
    render: function () {
      var s = NX.state.reactions;
      var chips = Object.keys(s.counts).filter(function (k) { return s.counts[k] > 0; }).map(function (emoji) {
        return '<button type="button" class="nx-react' + (s.mine.indexOf(emoji) !== -1 ? ' on' : '') + '" data-act="react-toggle" data-emoji="' + e(emoji) + '" aria-pressed="' + (s.mine.indexOf(emoji) !== -1) + '">'
          + '<span aria-hidden="true">' + e(NX.face(emoji)) + '</span><b>' + s.counts[emoji] + '</b></button>';
      }).join('');
      var picker = s.picker ? '<div class="nx-divider"></div><div class="nx-inline">'
        + ['👍', '🔥', '🎮', '😂', ':pixelheart:', ':partyblob:'].map(function (emoji) {
          return '<button type="button" class="nx-react" data-act="react-toggle" data-emoji="' + e(emoji) + '" aria-label="React with ' + e(NX.face(emoji)) + '">' + e(NX.face(emoji)) + '</button>';
        }).join('') + '</div>' : '';
      return '<div class="nx-chat"><div class="nx-chat-bar"><span class="nx-dot"></span>#showcase</div><div class="nx-chat-log">'
        + NX.msg('Priya Shah', 'PS', '6m', 'The little crown on the win screen is doing a lot of work.',
          chips + NX.action(NX.icon('plus'), 'react-open', 'aria-label="Open reaction picker"', 'quiet')) + picker + '</div></div>'
        + '<p class="nx-preview-note">Custom packs are shared, owned by the server, and reportable from the same picker.</p>';
    },
    actions: {
      'react-open': function () { NX.state.reactions.picker = !NX.state.reactions.picker; NX.commit(); },
      'react-toggle': function (el) {
        var s = NX.state.reactions;
        var emoji = el.getAttribute('data-emoji');
        if (!emoji) return;
        var i = s.mine.indexOf(emoji);
        if (i === -1) {
          s.mine.push(emoji);
          s.counts[emoji] = (s.counts[emoji] || 0) + 1;
        } else {
          s.mine.splice(i, 1);
          s.counts[emoji] = Math.max(0, (s.counts[emoji] || 0) - 1);
        }
        s.picker = false;
        NX.commit();
      }
    }
  });

  NX.add({
    id: 'typing', plan: 11, side: 'chat', group: 'Talk', title: 'Live typing previews in DMs',
    blurb: 'Channels already show the first few words. DMs deliberately do not. Finish it with a switch that belongs to the person typing.',
    why: 'A typing preview is presence with a sentence attached. In a DM it is intimate, so the default is off, the switch is visible, and the preview never survives the keystroke.',
    proof: ['Turning the switch off removes the preview immediately for both people.', 'The preview is never stored in message history.'],
    gate: 'Privacy preference on the sender, not the room. No transcript, no replay.',
    render: function () {
      var s = NX.state.typing;
      return '<div class="nx-setting"><div><b>Share typing previews in DMs</b><small>Only the first 40 characters, only while you are typing.</small></div>'
        + NX.toggle('typing.enabled', s.enabled, 'Share typing previews in DMs') + '</div>'
        + '<div class="nx-divider"></div><label class="nx-label" for="nxTypingInput">What you are typing</label>'
        + '<input class="nx-input" id="nxTypingInput" data-live="typing.text" maxlength="40" value="' + e(s.text) + '">'
        + '<div class="nx-inline" style="margin-top:8px">' + NX.action('Simulate', 'typing-simulate', '', 'primary') + '</div>'
        + (s.enabled && s.visible
          ? '<div class="nx-typing" role="status" style="margin-top:10px"><span aria-hidden="true">Maya is typing: </span><span id="nxTypingText">' + e(s.text) + '</span><span aria-hidden="true"><i></i><i></i><i></i></span></div>'
          : '<p class="nx-preview-note">' + (s.enabled ? 'Preview hidden until the next keystroke.' : 'Typing previews are off. Maya sees a plain “typing…” line or nothing.') + '</p>')
        + '<p class="nx-preview-note">The preview is ephemeral. It is not written to message history.</p>';
    },
    actions: {
      'typing-simulate': function () {
        var s = NX.state.typing;
        if (!s.enabled) { NX.toast('Turn the preview switch on first.'); return; }
        s.visible = true;
        NX.commit();
      }
    },
    input: function (el, path) {
      if (path === 'typing.text') {
        var target = document.getElementById('nxTypingText');
        if (target) target.textContent = el.value;
      }
    }
  });

  NX.add({
    id: 'polls', plan: 14, side: 'chat', group: 'Talk', title: 'DM polls and multi-select',
    blurb: 'Server polls ship. Take the same card into DMs, allow 2–10 options, and let the author close it without deleting the result.',
    why: 'A poll is a decision surface, not a message with bars. DMs need the same trust: one vote per person, a visible close, and no result hidden behind a reload.',
    proof: ['A closed poll keeps its final counts.', 'Multi-select is explicit and cannot be changed after voting.'],
    gate: 'Existing poll card plus DM visibility. No new table if the message metadata already carries the poll.',
    render: function () {
      var s = NX.state.polls;
      var total = s.options.reduce(function (n, o) { return n + o.votes; }, 0);
      var show = s.voted || s.closed;
      return '<div class="nx-poll"><div class="nx-comp-head"><div><p class="nx-poll-q">Which game for Friday?</p><p class="nx-poll-meta">Pick up to two · closes 6:00 PM</p></div>'
        + (s.closed ? '<span class="nx-badge warn">Closed</span>' : '<span class="nx-badge">' + total + ' votes</span>') + '</div>'
        + s.options.map(function (o, i) {
          var pct = total ? Math.round((o.votes / total) * 100) : 0;
          var on = s.selected.indexOf(o.label) !== -1;
          return '<button type="button" class="nx-poll-option' + (on ? ' on' : '') + '" data-act="poll-toggle" data-i="' + i + '"'
            + (show ? ' disabled' : '') + ' aria-pressed="' + on + '">'
            + (show ? '<span class="nx-bar" style="width:' + pct + '%"></span>' : '')
            + '<span>' + e(o.label) + '</span>' + (show ? '<b>' + o.votes + ' · ' + pct + '%</b>' : '') + '</button>';
        }).join('')
        + '<div class="nx-poll-foot"><span class="nx-muted">' + (s.voted ? 'Your vote is locked in.' : s.closed ? 'Voting is closed.' : 'Select all that apply.') + '</span>'
        + (s.voted || s.closed ? '' : NX.action('Vote', 'poll-vote', s.selected.length ? '' : 'disabled', 'primary') + NX.action('Close', 'poll-close', '', 'quiet')) + '</div></div>';
    },
    actions: {
      'poll-toggle': function (el) {
        var s = NX.state.polls;
        if (s.voted || s.closed) return;
        var i = Number(el.getAttribute('data-i'));
        var label = s.options[i] && s.options[i].label;
        if (!label) return;
        var at = s.selected.indexOf(label);
        if (at === -1) {
          if (s.selected.length >= 2) { NX.toast('This poll allows two choices.'); return; }
          s.selected.push(label);
        } else s.selected.splice(at, 1);
        NX.commit();
      },
      'poll-vote': function () {
        var s = NX.state.polls;
        if (!s.selected.length) { NX.toast('Pick at least one option.'); return; }
        if (s.voted) return;
        s.options.forEach(function (o) { if (s.selected.indexOf(o.label) !== -1) o.votes += 1; });
        s.voted = true;
        NX.commit('Vote counted.');
      },
      'poll-close': function () { NX.state.polls.closed = true; NX.commit('Poll closed with its counts intact.'); }
    }
  });

  NX.add({
    id: 'syntax', plan: 16, side: 'chat', group: 'Talk', title: 'Code-block syntax colouring',
    blurb: 'Labels and copy already ship. Colour the code by language without turning the message into a syntax-highlighting dependency.',
    why: 'The room is full of snippets. A consistent, token-only colour pass makes the block scannable and keeps the language label honest.',
    proof: ['Copy copies plain text, never the highlighted HTML.', 'Unknown languages fall back to a readable monochrome block.'],
    gate: 'A small allow-list of languages and one highlighter. No HTML injection from message content.',
    render: function () {
      var s = NX.state.syntax;
      return '<div class="nx-code"><div class="nx-code-bar"><select class="nx-select" data-change="syntax.lang" aria-label="Code language" style="max-width:112px;min-height:28px;padding:3px 6px;font-size:.72rem">'
        + '<option value="js"' + (s.lang === 'js' ? ' selected' : '') + '>JavaScript</option><option value="py"' + (s.lang === 'py' ? ' selected' : '') + '>Python</option></select>'
        + NX.action('Copy code', 'code-copy', '', 'quiet') + '</div>'
        + '<pre><code>' + (NX.codeHtml[s.lang] || NX.codeHtml.js) + '</code></pre></div>'
        + '<p class="nx-preview-note">Tokens only: keyword, string, number, comment. Copy always returns the original text.</p>';
    },
    actions: {
      'code-copy': function () {
        var lang = NX.state.syntax.lang || 'js';
        var text = NX.codeText[lang] || NX.codeText.js;
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(text).then(function () { NX.toast('Code copied.'); }).catch(function () { NX.toast('Copy is blocked in this browser.'); });
        } else NX.toast('Copy is not available here.');
      }
    }
  });

  NX.add({
    id: 'summary', plan: 87, side: 'chat', group: 'Talk', title: 'AI conversation summaries',
    blurb: '“Catch me up” turns a missed channel into three decisions, two open questions and a link back to the source.',
    why: 'A busy room is a reading queue. A summary is only trustworthy if every line points at a message and the feature is opt-in for the account.',
    proof: ['Every bullet links back to a message.', 'The summary is never generated for a room the viewer cannot read.'],
    gate: 'AI consent per account, a server-side model call, and message citations. This specimen is the interaction shape.',
    render: function () {
      var s = NX.state.summary;
      return '<div class="nx-chat"><div class="nx-chat-bar"><span class="nx-dot"></span>#build-log<span style="margin-left:auto">' + NX.action(s.shown ? 'Hide summary' : 'Catch me up', 'summary-toggle', '', 'quiet') + '</span></div>'
        + '<div class="nx-chat-log">'
        + NX.msg('Jon Bell', 'JB', '18m', 'The respawn timer is the thing making it feel unfair, not the jump height.')
        + NX.msg('Maya Chen', 'MC', '12m', 'Agreed. I’ll cut it to 1.2s and keep the camera snap.')
        + NX.msg('Theo Park', 'TP', '6m', 'Can we test the new timer before Friday? I have a build with three levels.')
        + (s.shown ? '<div class="nx-summary"><div class="nx-summary-head"><b>Catch-up · 24 messages</b><span class="nx-badge signal">3 min read</span></div><ul>'
          + '<li>The unfairness is the <b>respawn timer</b>, not the jump height.</li>'
          + '<li>Maya will cut it to <b>1.2s</b> and keep the camera snap.</li>'
          + '<li>Theo has a <b>three-level build</b> ready for a Friday test.</li>'
          + '</ul><p class="nx-preview-note">Every line cites the message it came from. Generated only after you opt in.</p></div>' : '')
        + '</div></div>';
    },
    actions: { 'summary-toggle': function () { NX.state.summary.shown = !NX.state.summary.shown; NX.commit(); } }
  });

  NX.add({
    id: 'notifications', plan: 97, side: 'chat', group: 'Talk', title: 'Notification intelligence',
    blurb: 'Quiet hours exist. Add priority, a digest and mentions-only that actually holds across channels and DMs.',
    why: 'Notification fatigue is a design failure, not a user failure. The product should make the quiet choice easy and show exactly what still gets through.',
    proof: ['The preview names what will interrupt you.', 'Quiet hours hold push but never lose the inbox row.'],
    gate: 'Existing quiet-hours preference plus a per-account digest window. No new notification type.',
    render: function () {
      var s = NX.state.notify;
      var interruptions = s.mentions ? 1 : 0;
      return '<div class="nx-setting"><div><b>Mentions only</b><small>Direct mentions and replies still break through. Everything else waits.</small></div>' + NX.toggle('notify.mentions', s.mentions, 'Mentions only') + '</div>'
        + '<div class="nx-setting"><div><b>Daily digest</b><small>One summary at 18:00 instead of a ping per message.</small></div>' + NX.toggle('notify.digest', s.digest, 'Daily digest') + '</div>'
        + '<div class="nx-setting"><div><b>Quiet hours</b><small>22:00–08:00 · push held, inbox still written.</small></div>' + NX.toggle('notify.quiet', s.quiet, 'Quiet hours') + '</div>'
        + '<div class="nx-result"><span class="nx-result-mark">' + interruptions + '</span><div><b>' + interruptions + ' notification would interrupt you</b>'
        + '<small>' + (s.quiet ? 'Quiet hours are on, so it will wait until 08:00.' : 'Quiet hours are off.') + ' ' + (s.digest ? 'The digest will include 6 other messages.' : 'Six other messages are muted.') + '</small></div></div>';
    },
    actions: {}
  });

  NX.add({
    id: 'smartreplies', plan: 19, side: 'chat', group: 'Talk', title: 'Smart replies',
    blurb: 'Optional suggestions above the composer. Pick one, edit it, or send nothing. The model never sends on your behalf.',
    why: 'A reply suggestion should remove the blank box, not the voice. Three short options with the same meaning are more useful than one clever paragraph.',
    proof: ['A suggestion never auto-sends.', 'Editing the suggestion changes the sent text.'],
    gate: 'AI consent and a strict “draft only” contract. No suggested reply is written to history until Send.',
    render: function () {
      var s = NX.state.smartreplies;
      var variants = [
        ['I can test it after lunch.', 'Send the link — I have five minutes.', 'Looks good. Ping me when it’s live.'],
        ['I’m in. What should I look for?', 'The jump felt off last time; is that fixed?', 'Can’t today, but send a build.']
      ];
      var picks = variants[s.variant % variants.length];
      return NX.msg('Theo Park', 'TP', 'just now', 'Anyone up for testing the new build? It is three levels and one very suspicious lift.',
        s.sent ? '<span class="nx-badge ok">Reply sent</span>' : picks.map(function (text) {
          return '<button type="button" class="nx-chip" data-act="reply-pick" data-text="' + e(text) + '">' + e(text) + '</button>';
        }).join(''))
        + (s.sent ? '<div class="nx-result"><span class="nx-result-mark">' + NX.icon('check') + '</span><div><b>Sent</b><small>' + e(s.chosen) + '</small></div></div>' : '')
        + '<div class="nx-divider"></div><div class="nx-row-fields"><input class="nx-input" id="nxReplyInput" data-live="smartreplies.chosen" value="' + e(s.chosen) + '" placeholder="Write your own or pick a suggestion">'
        + NX.action('Send', 'reply-send', s.chosen.trim() ? '' : 'disabled', 'primary') + '</div>'
        + '<div class="nx-inline" style="margin-top:7px">' + NX.action('Shuffle suggestions', 'reply-shuffle', '', 'quiet') + '</div>'
        + '<p class="nx-preview-note">Suggestions are drafts. Nothing is sent until you press Send.</p>';
    },
    actions: {
      'reply-pick': function (el) {
        NX.state.smartreplies.chosen = el.getAttribute('data-text') || '';
        NX.state.smartreplies.sent = false;
        NX.commit();
      },
      'reply-shuffle': function () {
        NX.state.smartreplies.variant += 1;
        NX.state.smartreplies.chosen = '';
        NX.state.smartreplies.sent = false;
        NX.commit();
      },
      'reply-send': function () {
        var text = String(NX.state.smartreplies.chosen || '').trim();
        if (!text) { NX.toast('Pick or write a reply first.'); return; }
        NX.state.smartreplies.chosen = text;
        NX.state.smartreplies.sent = true;
        NX.commit('Reply sent.');
      }
    }
  });

  NX.add({
    id: 'translation', plan: 13, side: 'chat', group: 'Talk', title: 'Message translation',
    blurb: 'Translate one message or a whole conversation without leaving the room. The original stays one tap away.',
    why: 'A global community needs a local reading experience. Translation belongs to the reader, not the sender, and the original must never be overwritten.',
    proof: ['The original text is always available.', 'Translation is opt-in per message, not a silent rewrite.'],
    gate: 'AI consent and language detection. No translated text is stored as the message body.',
    render: function () {
      var s = NX.state.translation;
      return NX.msg('Lena Ortiz', 'LO', '3m', '¿Alguien quiere probar mi juego esta noche?',
        '<span class="nx-badge">Spanish</span>' + NX.action('Translate', 'translate', '', 'quiet'))
        + '<div class="nx-row-fields" style="margin-top:8px"><select class="nx-select" data-change="translation.lang" aria-label="Translate into">'
        + [['en', 'English'], ['fr', 'French'], ['es', 'Spanish']].map(function (pair) {
          return '<option value="' + pair[0] + '"' + (s.lang === pair[0] ? ' selected' : '') + '>' + pair[1] + '</option>';
        }).join('') + '</select><span class="nx-muted">Translated for you only</span></div>'
        + (s.shown ? '<div class="nx-summary" style="margin-top:9px"><div class="nx-summary-head"><b>' + (s.lang === 'es' ? 'Original' : 'Translation') + '</b><span class="nx-badge">Auto-detected</span></div><p class="nx-msg-text">' + e(NX.translations[s.lang] || NX.translations.en) + '</p><p class="nx-preview-note">Original: “¿Alguien quiere probar mi juego esta noche?”</p></div>' : '')
        + '<p class="nx-preview-note">The original message is never replaced. The translation is a reading layer.</p>';
    },
    actions: { translate: function () { NX.state.translation.shown = true; NX.commit(); } },
    change: function (el, path) { if (path === 'translation.lang') NX.state.translation.shown = false; }
  });

  NX.add({
    id: 'permissions', plan: 28, side: 'chat', group: 'Trust', title: 'Advanced channel permissions',
    blurb: 'Per-channel, per-role allow, inherit and deny — one matrix that the API and the UI both read.',
    why: 'Permissions are where friendly communities become unpredictable. A visible matrix with an explicit inherited state is the difference between a policy and a guess.',
    proof: ['Deny wins over allow at the same level.', 'The UI reads the same resolver the API enforces.'],
    gate: 'F2 first. One resolver used by REST and WebSocket; this table is a view of it, not a second policy.',
    render: function () {
      var s = NX.state.perms;
      var roles = ['Member', 'Mod', 'Guest'];
      var perms = [['view', 'View'], ['post', 'Post'], ['attach', 'Attach'], ['pin', 'Pin']];
      return '<div class="nx-matrix-wrap"><table class="nx-matrix"><thead><tr><th>Role</th>'
        + perms.map(function (p) { return '<th>' + p[1] + '</th>'; }).join('') + '</tr></thead><tbody>'
        + roles.map(function (role) {
          return '<tr><th scope="row">' + role + '</th>' + perms.map(function (p) {
            var v = s[role][p[0]];
            var label = v === 'allow' ? 'A' : v === 'inherit' ? 'I' : 'D';
            var word = v === 'allow' ? 'Allow' : v === 'inherit' ? 'Inherit' : 'Deny';
            return '<td><button type="button" class="nx-perm" data-v="' + v + '" data-act="perm-cycle" data-role="' + role + '" data-perm="' + p[0] + '" aria-label="' + role + ' ' + p[1] + ': ' + word + '">' + label + '</button></td>';
          }).join('') + '</tr>';
        }).join('') + '</tbody></table></div>'
        + '<div class="nx-legend"><span><b>A</b> allow</span><span><b>I</b> inherit</span><span><b>D</b> deny</span><span>Deny wins at the same level.</span></div>'
        + '<div class="nx-inline" style="margin-top:9px">' + NX.action('Reset matrix', 'perm-reset', '', 'quiet') + '</div>';
    },
    actions: {
      'perm-cycle': function (el) {
        var s = NX.state.perms;
        var role = el.getAttribute('data-role');
        var perm = el.getAttribute('data-perm');
        var order = { allow: 'inherit', inherit: 'deny', deny: 'allow' };
        if (!s[role] || !s[role][perm]) return;
        s[role][perm] = order[s[role][perm]] || 'inherit';
        NX.commit();
      },
      'perm-reset': function () {
        NX.state.perms = NX.clone(NX.defaults.perms);
        NX.commit('Permission matrix reset.');
      }
    }
  });

  NX.add({
    id: 'simulator', plan: 52, side: 'chat', group: 'Trust', title: 'Permission simulator',
    blurb: 'Ask “what can this member do here?” before changing a role. Show the answer and the inheritance path that produced it.',
    why: 'A permission editor without a simulator asks people to reason about a graph. The simulator is the fastest way to catch the one deny that makes a channel unusable.',
    proof: ['The result names the winning rule.', 'Changing a role never silently changes another role’s answer.'],
    gate: 'F2. The simulator calls the real resolver with a synthetic subject, not a client-side copy.',
    render: function () {
      var s = NX.state.sim;
      var result = simulate(s);
      return '<div class="nx-row-fields" style="grid-template-columns:1fr 1fr 1fr"><div><label class="nx-label" for="nxSimRole">Role</label><select class="nx-select" id="nxSimRole" data-change="sim.role">'
        + ['Owner', 'Mod', 'Member', 'Guest'].map(function (r) { return '<option' + (s.role === r ? ' selected' : '') + '>' + r + '</option>'; }).join('') + '</select></div>'
        + '<div><label class="nx-label" for="nxSimChannel">Channel</label><select class="nx-select" id="nxSimChannel" data-change="sim.channel">'
        + ['#general', '#staff', '#art'].map(function (c) { return '<option' + (s.channel === c ? ' selected' : '') + '>' + c + '</option>'; }).join('') + '</select></div>'
        + '<div><label class="nx-label" for="nxSimAction">Action</label><select class="nx-select" id="nxSimAction" data-change="sim.action">'
        + ['view', 'post', 'attach', 'pin'].map(function (a) { return '<option' + (s.action === a ? ' selected' : '') + '>' + a + '</option>'; }).join('') + '</select></div></div>'
        + '<div class="nx-result' + (result.ok ? '' : ' deny') + '"><span class="nx-result-mark">' + NX.icon(result.ok ? 'check' : 'x') + '</span><div><b>' + (result.ok ? 'Allowed' : 'Denied') + ' · ' + e(s.role) + ' can ' + e(s.action) + ' in ' + e(s.channel) + '</b><small>' + e(result.why) + '</small></div></div>'
        + '<pre class="nx-trace">' + e(result.trace) + '</pre>';
    },
    actions: {}
  });

  function simulate(s) {
    if (s.role === 'Owner') return { ok: true, why: 'The owner bypasses channel overrides.', trace: 'owner → allow everything' };
    if (s.role === 'Guest') {
      if (s.channel === '#staff') return { ok: false, why: 'Guest is denied by the #staff channel override.', trace: 'Guest → @everyone (allow view) → #staff override (deny view)' };
      if (s.action === 'view') return { ok: true, why: 'Guest can read public channels but cannot write in them.', trace: 'Guest → @everyone (allow view) → ' + s.channel + ' (inherit)' };
      return { ok: false, why: 'Guest has read-only access in ' + s.channel + '.', trace: 'Guest → @everyone (allow view) → ' + s.action + ' (deny)' };
    }
    if (s.action === 'pin' && s.role !== 'Mod') return { ok: false, why: 'Pin is a Mod capability; Member inherits View and Post only.', trace: 'Member → @everyone (view, post) → ' + s.channel + ' (inherit) → pin (deny)' };
    if (s.action === 'attach' && s.role === 'Member' && s.channel === '#staff') return { ok: false, why: 'Member can read #staff, but the channel override denies attachments.', trace: 'Member → @everyone (view, post) → #staff (deny attach)' };
    return { ok: true, why: s.role + ' inherits the base role, then ' + s.channel + ' allows ' + s.action + '.', trace: s.role + ' → Member (view, post) → ' + s.channel + ' (allow ' + s.action + ')' };
  }

  NX.add({
    id: 'roles', plan: 58, side: 'chat', group: 'Trust', title: 'Role inheritance',
    blurb: 'Roles can build on one parent instead of duplicating every permission. Show what is inherited, and let an explicit deny stop the chain.',
    why: 'Most role bugs come from copies that drift. Inheritance makes the intent legible: a Mod is a Member plus three extras, not a second universe.',
    proof: ['Inherited permissions are visibly distinct from granted ones.', 'Removing a parent removes only inherited access.'],
    gate: 'F2 and the role model. Cycles must be rejected in the resolver, not only the UI.',
    render: function () {
      var s = NX.state.roles;
      return '<div class="nx-role-row"><span class="nx-role-swatch" style="background:var(--signal)"></span><span class="nx-role-name">Owner<small>server owner · all permissions</small></span><span class="nx-badge">root</span></div>'
        + '<div class="nx-role-row"><span class="nx-role-swatch" style="background:#6EA8FF"></span><span class="nx-role-name">Mod<small>parent role · extra moderation powers</small></span>'
        + '<select class="nx-select" data-change="roles.parent" aria-label="Mod parent role"><option' + (s.parent === 'Member' ? ' selected' : '') + '>Member</option><option' + (s.parent === 'Guest' ? ' selected' : '') + '>Guest</option></select></div>'
        + '<div class="nx-role-row"><span class="nx-role-swatch" style="background:#3ECF8E"></span><span class="nx-role-name">Member<small>base role · view and post</small></span><span class="nx-badge">base</span></div>'
        + '<div class="nx-setting" style="margin-top:8px"><div><b>Inherit from parent</b><small>When off, Mod only has its direct grants.</small></div>' + NX.toggle('roles.inherit', s.inherit, 'Mod inherits from parent') + '</div>'
        + '<div class="nx-inline" style="margin-top:8px"><span class="nx-chip on">View</span><span class="nx-chip on">Post</span>'
        + (s.inherit ? '<span class="nx-chip on">Moderate</span><span class="nx-chip on">Pin</span>' : '<span class="nx-chip">Moderate</span><span class="nx-chip">Pin</span>') + '</div>'
        + '<p class="nx-preview-note">' + (s.inherit ? 'Mod inherits View and Post from ' + e(s.parent) + '.' : 'Mod has only its direct grants.') + ' An explicit deny still wins.</p>';
    },
    actions: {}
  });

  NX.add({
    id: 'moderation', plan: 53, side: 'chat', group: 'Trust', title: 'Automated moderation builder',
    blurb: 'Build “when this, then that” rules for links, mentions and spam — then test a message before the rule goes live.',
    why: 'Moderation should be a readable sentence, not a regex buried in a settings page. A test box turns a policy into something the whole mod team can agree on.',
    proof: ['A rule can be tested against a sample without saving it.', 'Every rule is written to the server audit log.'],
    gate: 'F2 and the audit log. Rules are server-scoped and owner-only; mods can test but not publish.',
    render: function () {
      var s = NX.state.mod;
      return '<div class="nx-inline" style="align-items:flex-end"><div style="flex:1;min-width:150px"><label class="nx-label" for="nxRuleWhen">When</label><select class="nx-select" id="nxRuleWhen"><option>a message contains a link</option><option>a new account mentions 5+ people</option><option>a message repeats in 30s</option></select></div>'
        + '<div style="flex:1;min-width:140px"><label class="nx-label" for="nxRuleThen">Then</label><select class="nx-select" id="nxRuleThen"><option>flag for review</option><option>hold the message</option><option>delete and warn</option></select></div>'
        + NX.action('Add rule', 'rule-add', '', 'primary') + '</div>'
        + '<div class="nx-divider"></div>'
        + (s.rules.length ? s.rules.map(function (r) {
          return '<div class="nx-rule"><span class="nx-rule-when">WHEN</span><span>' + e(r.when) + '</span><span class="nx-rule-when">THEN</span><b>' + e(r.then) + '</b>'
            + NX.action(NX.icon('x'), 'rule-remove', 'data-id="' + e(r.id) + '" aria-label="Remove rule"', 'quiet danger') + '</div>';
        }).join('') : '<p class="nx-muted">No rules yet. Add one above.</p>')
        + '<div class="nx-divider"></div><label class="nx-label" for="nxRuleTest">Test a message</label><div class="nx-row-fields"><input class="nx-input" id="nxRuleTest" data-live="mod.test" value="' + e(s.test) + '" placeholder="Paste a message…">'
        + NX.action('Run test', 'rule-test', '', 'primary') + '</div>'
        + (s.result ? '<div class="nx-result' + (s.result.indexOf('would allow') === 0 ? '' : ' deny') + '"><span class="nx-result-mark">' + NX.icon(s.result.indexOf('would allow') === 0 ? 'check' : 'alert') + '</span><div><b>' + e(s.result) + '</b><small>Test only. No message was changed.</small></div></div>' : '');
    },
    actions: {
      'rule-add': function () {
        var when = (document.getElementById('nxRuleWhen') || {}).value;
        var then = (document.getElementById('nxRuleThen') || {}).value;
        if (!when || !then) return;
        NX.state.mod.rules.push({ id: 'r' + NX.uid(), when: when, then: then });
        NX.commit('Rule added to the draft.');
      },
      'rule-remove': function (el) {
        var id = el.getAttribute('data-id');
        NX.state.mod.rules = NX.state.mod.rules.filter(function (r) { return r.id !== id; });
        NX.commit('Rule removed.');
      },
      'rule-test': function () {
        var input = document.getElementById('nxRuleTest');
        var text = (input && input.value || '').trim();
        if (!text) { NX.toast('Write a message to test.'); return; }
        var link = /https?:\/\//i.test(text);
        var mentions = (text.match(/@\w+/g) || []).length;
        NX.state.mod.test = text;
        NX.state.mod.result = link ? 'would flag for review: link detected' : mentions >= 3 ? 'would hold the message: mention burst' : 'would allow: no rule matched';
        NX.commit();
      }
    }
  });
})();
