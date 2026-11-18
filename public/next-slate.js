/* file: public/next-slate.js
 * what: The unshipped server moves from pland.md that do not have a working Next model.
 * invariants: static reference data only; the renderer escapes every field and never writes user input.
 * see: public/next.html, public/next.css, public/next-server.js, pland.md.
 */
(function () {
  'use strict';

  var NX = window.CudicNext;
  var items = [
  {
    "n": 101,
    "title": "Custom server banners",
    "section": "Server customisation",
    "effort": "S",
    "what": "Shipped in 80: /server-customize sets an accent and a banner. Remaining: crop/focal point and a remove button.",
    "needs": "—",
    "risk": "A banner at the wrong focal point crops the name; reuse the profile's banner_pos rule.",
    "partial": true
  },
  {
    "n": 102,
    "title": "Animated server icons",
    "section": "Server customisation",
    "effort": "S–M",
    "what": "A GIF or WebP icon that plays in the server list and header.",
    "needs": "F6 for the stored file",
    "risk": "Animated icons fight a 32px list row; cap 256 KB, ship a poster frame, freeze under reduced motion.",
    "partial": false
  },
  {
    "n": 104,
    "title": "Multiple theme presets",
    "section": "Server customisation",
    "effort": "S",
    "what": "Two or three named server looks (seasonal, event night) the owner switches between.",
    "needs": "103",
    "risk": "A preset must set only the server layer, never override a member's own pack.",
    "partial": false
  },
  {
    "n": 106,
    "title": "Custom channel icons",
    "section": "Server customisation",
    "effort": "S",
    "what": "A glyph or short emoji before a channel name.",
    "needs": "—",
    "risk": "Keep it emoji-only; a URL version needs F6 and a report path.",
    "partial": false
  },
  {
    "n": 107,
    "title": "Custom category icons",
    "section": "Server customisation",
    "effort": "S",
    "what": "The same glyph on folder rows.",
    "needs": "21 (shipped)",
    "risk": "None beyond a length cap.",
    "partial": false
  },
  {
    "n": 108,
    "title": "Custom role icons",
    "section": "Server customisation",
    "effort": "M–L",
    "what": "A glyph per role, shown beside a member's name.",
    "needs": "28",
    "risk": "Icons need a real role model; do not bolt them onto the three fixed strings.",
    "partial": false
  },
  {
    "n": 109,
    "title": "Custom server fonts",
    "section": "Server customisation",
    "effort": "S",
    "what": "The interface face used inside one server.",
    "needs": "75 (shipped)",
    "risk": "Every face must be licensed and shipped locally; the server layer applies only inside the server.",
    "partial": false
  },
  {
    "n": 110,
    "title": "Customisable server welcome page",
    "section": "Server customisation",
    "effort": "S–M",
    "what": "A public /s/<id>/welcome with banner, rules, next event and a join button instead of a bare modal.",
    "needs": "54 (shipped)",
    "risk": "A public page under-13s can reach needs the directory's content rules; no member names on it.",
    "partial": false
  },
  {
    "n": 113,
    "title": "Custom channel ordering",
    "section": "Channels and organisation",
    "effort": "S",
    "what": "Drag channels and folders into any order, remembered for the server.",
    "needs": "21 (shipped)",
    "risk": "Two mods dragging at once; last write wins per moved row, not for the whole list.",
    "partial": false
  },
  {
    "n": 114,
    "title": "Channel descriptions with images",
    "section": "Channels and organisation",
    "effort": "M",
    "what": "Text descriptions shipped in 29. An inline image or code block still needs the attachment pipeline.",
    "needs": "F6",
    "risk": "Markdown image syntax pointing off-site is a tracking pixel; allow only uploaded assets.",
    "partial": true
  },
  {
    "n": 115,
    "title": "Announcement channels",
    "section": "Channels and organisation",
    "effort": "S–M",
    "what": "A channel where only mods post and everyone else reads.",
    "needs": "28, or the existing owner/mod check",
    "risk": "Announcement channels multiply notifications; default the channel to mentions only.",
    "partial": false
  },
  {
    "n": 118,
    "title": "Question-and-answer channels",
    "section": "Channels and organisation",
    "effort": "M",
    "what": "A channel where a message can be marked answered and the answer sorts first.",
    "needs": "F1",
    "risk": "Only the asker or a mod sets it, or it becomes a way to bury a complaint.",
    "partial": false
  },
  {
    "n": 120,
    "title": "Read-only announcement channels",
    "section": "Channels and organisation",
    "effort": "S",
    "what": "The same work as 115, arrived at from a different direction; one flag, not two.",
    "needs": "115",
    "risk": "Do not ship a second read-only mechanism beside the channel type.",
    "partial": false
  },
  {
    "n": 122,
    "title": "Custom channel permissions",
    "section": "Channels and organisation",
    "effort": "L",
    "what": "The per-channel, per-role allow/deny matrix from 28; still the largest unshipped server item.",
    "needs": "—",
    "risk": "Permission bugs look like outages; ship read enforcement first and never let an owner lock themselves out.",
    "partial": false
  },
  {
    "n": 123,
    "title": "Channel tags",
    "section": "Channels and organisation",
    "effort": "S",
    "what": "Short tags on a channel, filterable in the channel list.",
    "needs": "—",
    "risk": "Tags are a naming surface; cap at 3 × 12 characters and sanitise like names.",
    "partial": false
  },
  {
    "n": 124,
    "title": "Channel bookmarks",
    "section": "Channels and organisation",
    "effort": "S",
    "what": "Save a channel to your own list, separate from favourites.",
    "needs": "—",
    "risk": "A bookmark can outlive access; read through the membership check and hide it when gone.",
    "partial": false
  },
  {
    "n": 126,
    "title": "Server nicknames",
    "section": "Member profiles and community",
    "effort": "M",
    "what": "A display name that applies in one server only.",
    "needs": "—",
    "risk": "Nicknames impersonating staff; reserve staff-like names and log changes in 51.",
    "partial": false
  },
  {
    "n": 127,
    "title": "Server-specific member bios",
    "section": "Member profiles and community",
    "effort": "S",
    "what": "The 400-character server_intros card (65) shown on the member card and directory, not only in the HQ panel.",
    "needs": "65 (shipped)",
    "risk": "Intro cards invite personal detail from minors; ask for interests only.",
    "partial": false
  },
  {
    "n": 128,
    "title": "Member profile decorations",
    "section": "Member profiles and community",
    "effort": "M",
    "what": "A frame or flair that shows only inside one server.",
    "needs": "—",
    "risk": "Keep it grantable, not purchasable, until the coin rules for 61 exist.",
    "partial": false
  },
  {
    "n": 136,
    "title": "Member interests and game tags",
    "section": "Member profiles and community",
    "effort": "S",
    "what": "Tags on your server profile: what you build and what you play.",
    "needs": "127",
    "risk": "Free-text tags become a bio field; ship a fixed list plus three custom.",
    "partial": false
  },
  {
    "n": 137,
    "title": "Member anniversary celebrations",
    "section": "Member profiles and community",
    "effort": "S",
    "what": "One year in the server gets a system post and a badge.",
    "needs": "69 (shipped)",
    "risk": "Idempotency is the primary key, not an in-memory flag, or a restart posts twice.",
    "partial": false
  },
  {
    "n": 138,
    "title": "Community member spotlights",
    "section": "Member profiles and community",
    "effort": "S",
    "what": "A mod picks a member or a creation; the server posts a card.",
    "needs": "—",
    "risk": "Spotlighting a minor needs that member's own opt-in.",
    "partial": false
  },
  {
    "n": 139,
    "title": "Custom member titles",
    "section": "Member profiles and community",
    "effort": "S",
    "what": "A short title under a name, granted per server.",
    "needs": "50 (shipped)",
    "risk": "Reserve staff words so a title cannot impersonate moderation.",
    "partial": false
  },
  {
    "n": 141,
    "title": "Server polls",
    "section": "Server engagement",
    "effort": "M",
    "what": "The polls from 14, scoped to a server channel.",
    "needs": "14, F1",
    "risk": "A poll is a message, so it inherits edits and reports; add a mod close.",
    "partial": false
  },
  {
    "n": 142,
    "title": "Anonymous polls",
    "section": "Server engagement",
    "effort": "S",
    "what": "A tally with no identities.",
    "needs": "141",
    "risk": "In a small server, timing still identifies voters; say so in the UI.",
    "partial": false
  },
  {
    "n": 143,
    "title": "Daily community questions",
    "section": "Server engagement",
    "effort": "S",
    "what": "A question posts itself each day from an owner-set queue.",
    "needs": "4 (shipped)",
    "risk": "A queue that runs dry posts nothing; show the owner the remaining count.",
    "partial": false
  },
  {
    "n": 144,
    "title": "Weekly discussion topics",
    "section": "Server engagement",
    "effort": "S",
    "what": "The same machinery, weekly, pinned for the week.",
    "needs": "143",
    "risk": "Unpinning last week's topic is part of the job, not a manual step.",
    "partial": false
  },
  {
    "n": 145,
    "title": "Community suggestions board",
    "section": "Server engagement",
    "effort": "M",
    "what": "A #suggestions channel where posts become cards with a status.",
    "needs": "F1",
    "risk": "Status changes are mod actions and belong in the audit log.",
    "partial": false
  },
  {
    "n": 146,
    "title": "Suggestion voting",
    "section": "Server engagement",
    "effort": "S",
    "what": "Upvotes on those cards, one per member.",
    "needs": "145",
    "risk": "Votes scoped to the server; cross-server brigading is the failure mode.",
    "partial": false
  },
  {
    "n": 148,
    "title": "Screenshot competitions",
    "section": "Server engagement",
    "effort": "M",
    "what": "147 with an image entry.",
    "needs": "147, F6",
    "risk": "Uploaded images need the report path first.",
    "partial": false
  },
  {
    "n": 149,
    "title": "Art competitions",
    "section": "Server engagement",
    "effort": "M",
    "what": "147 with an image entry and a gallery vote.",
    "needs": "148",
    "risk": "Voting on art by minors needs the same opt-in as 138.",
    "partial": false
  },
  {
    "n": 150,
    "title": "Community trivia",
    "section": "Server engagement",
    "effort": "M",
    "what": "A quiz the server plays together in a channel.",
    "needs": "70, 51",
    "risk": "Answers shipped to the client are readable; keep them server-side and rate-limit guesses.",
    "partial": false
  },
  {
    "n": 151,
    "title": "Server-wide quizzes",
    "section": "Server engagement",
    "effort": "M",
    "what": "150 with a scoreboard.",
    "needs": "150",
    "risk": "A scoreboard rewards whoever is online most; cap per round.",
    "partial": false
  },
  {
    "n": 152,
    "title": "Guess-the-image games",
    "section": "Server engagement",
    "effort": "M",
    "what": "A cropped image revealed in rounds.",
    "needs": "150, F6",
    "risk": "Same upload and moderation cost as 148.",
    "partial": false
  },
  {
    "n": 153,
    "title": "Community challenges",
    "section": "Server engagement",
    "effort": "M",
    "what": "The server quests from 61.",
    "needs": "61",
    "risk": "Coins are the site economy; cap server-issued rewards.",
    "partial": false
  },
  {
    "n": 154,
    "title": "Weekly community highlights",
    "section": "Server engagement",
    "effort": "M",
    "what": "A weekly rollup of the busiest thread, top reaction score and new games.",
    "needs": "55, 59",
    "risk": "Ranking people rewards spam; weight reactions above message count, as 64 does.",
    "partial": false
  },
  {
    "n": 156,
    "title": "Looking-for-group board",
    "section": "Gaming features",
    "effort": "M",
    "what": "Posts saying \"two more for a run\" with game, time zone, slots and a join button.",
    "needs": "—",
    "risk": "Adults and minors meeting through a board; default to members-only and no DMs until both opt in.",
    "partial": false
  },
  {
    "n": 157,
    "title": "Game-specific member roles",
    "section": "Gaming features",
    "effort": "M",
    "what": "Self-assign roles for the games you play.",
    "needs": "28",
    "risk": "A self-assign role that grants channel access is a permission bypass; self-assign roles carry no permissions.",
    "partial": false
  },
  {
    "n": 158,
    "title": "Gaming team recruitment",
    "section": "Gaming features",
    "effort": "M",
    "what": "156 with a squad page and an invite.",
    "needs": "156",
    "risk": "Recruiting is the highest-risk contact surface for minors; keep it in-server.",
    "partial": false
  },
  {
    "n": 160,
    "title": "Community gaming leaderboards",
    "section": "Gaming features",
    "effort": "M",
    "what": "Server activity ranking shipped in 64; a per-game score board is what is left.",
    "needs": "64 (shipped)",
    "risk": "Two boards with different meanings must not share a label in the UI.",
    "partial": true
  },
  {
    "n": 162,
    "title": "Game server connection info",
    "section": "Gaming features",
    "effort": "S",
    "what": "An address and a copy button on the server page.",
    "needs": "—",
    "risk": "A home IP published on a public page; owner-only to set, warn before saving.",
    "partial": false
  },
  {
    "n": 163,
    "title": "Gaming screenshot galleries",
    "section": "Gaming features",
    "effort": "L",
    "what": "A showcase channel for screenshots.",
    "needs": "117",
    "risk": "Same upload moderation as 148.",
    "partial": false
  },
  {
    "n": 164,
    "title": "Gaming clip sharing",
    "section": "Gaming features",
    "effort": "L",
    "what": "Drop a clip from a game into a channel with a player.",
    "needs": "F6, F1",
    "risk": "Video is the most expensive thing in this list; cap duration and count it against the account budget.",
    "partial": false
  },
  {
    "n": 165,
    "title": "Game recommendation boards",
    "section": "Gaming features",
    "effort": "M",
    "what": "A server shelf of games its members recommend.",
    "needs": "—",
    "risk": "A recommendation shelf is a promotion surface; one note per member per game, no paid placement.",
    "partial": false
  },
  {
    "n": 167,
    "title": "Player statistics profiles",
    "section": "Gaming features",
    "effort": "M",
    "what": "Per-game plays, best score and achievements for a player.",
    "needs": "—",
    "risk": "Public stats for minors; opt-in and aggregate only.",
    "partial": false
  },
  {
    "n": 169,
    "title": "Game update announcements",
    "section": "Gaming features",
    "effort": "S",
    "what": "A published game posts its changelog into a server's channel.",
    "needs": "59 (shipped)",
    "risk": "One publish fanning out to every subscribed server; cap and batch.",
    "partial": false
  },
  {
    "n": 170,
    "title": "Community game nights",
    "section": "Gaming features",
    "effort": "S",
    "what": "A recurring event with a game attached.",
    "needs": "62 (shipped)",
    "risk": "Recurrence is a new key; a cancelled night must not return.",
    "partial": false
  },
  {
    "n": 172,
    "title": "Sticker packs",
    "section": "Messaging and interaction",
    "effort": "L",
    "what": "Larger images sent as a single message.",
    "needs": "171, F6",
    "risk": "Stickers are images with no text; moderation gets harder, not easier.",
    "partial": false
  },
  {
    "n": 173,
    "title": "Custom reaction sets",
    "section": "Messaging and interaction",
    "effort": "M",
    "what": "A server's own reaction palette instead of the fixed six.",
    "needs": "171",
    "risk": "A reaction palette that includes a slur is a moderation incident; approve per server.",
    "partial": false
  },
  {
    "n": 174,
    "title": "Interactive message buttons",
    "section": "Messaging and interaction",
    "effort": "L",
    "what": "The declared-actions platform from 92.",
    "needs": "92, F2",
    "risk": "A button that calls a client-supplied URL is phishing; only server-declared actions.",
    "partial": false
  },
  {
    "n": 175,
    "title": "Message polls",
    "section": "Messaging and interaction",
    "effort": "M",
    "what": "The polls from 14 as a message card.",
    "needs": "14, F1",
    "risk": "Same as 141.",
    "partial": false
  },
  {
    "n": 177,
    "title": "Pinned message collections",
    "section": "Messaging and interaction",
    "effort": "S–M",
    "what": "Personal collections shipped in 20; a shared server collection is the remainder.",
    "needs": "20 (shipped)",
    "risk": "Shared pins are a moderation surface; mods can remove, owner can hide.",
    "partial": true
  },
  {
    "n": 178,
    "title": "Channel-specific welcome messages",
    "section": "Messaging and interaction",
    "effort": "S",
    "what": "A line in the channel when someone joins, instead of the server-wide flow.",
    "needs": "54 (shipped)",
    "risk": "A welcome line per channel becomes spam if the server has thirty channels; cap to one.",
    "partial": false
  },
  {
    "n": 179,
    "title": "Custom message embeds",
    "section": "Messaging and interaction",
    "effort": "M",
    "what": "A message posted as a card with title, fields and colour.",
    "needs": "F1",
    "risk": "Embeds are the classic phishing shape; render declared fields only, never raw HTML or an author icon URL.",
    "partial": false
  },
  {
    "n": 180,
    "title": "Threaded conversations",
    "section": "Messaging and interaction",
    "effort": "L",
    "what": "The threads from 15: any message opens a side pane.",
    "needs": "F1, F5",
    "risk": "Unread counts explode when threads are unread too; decide inheritance before building.",
    "partial": false
  },
  {
    "n": 184,
    "title": "Server preview before joining",
    "section": "Server discovery and identity",
    "effort": "S–M",
    "what": "See the channel list, rules and member count before joining.",
    "needs": "—",
    "risk": "A preview that lists every channel leaks the structure of private ones; filter to public channels.",
    "partial": false
  },
  {
    "n": 185,
    "title": "Server image galleries",
    "section": "Server discovery and identity",
    "effort": "M",
    "what": "Artwork on the public card and server page.",
    "needs": "F6",
    "risk": "Another upload slot on the least-moderated surface; owner-only and reviewed with the directory.",
    "partial": false
  },
  {
    "n": 187,
    "title": "Featured server artwork",
    "section": "Server discovery and identity",
    "effort": "S",
    "what": "A separate image for the directory card, distinct from the banner.",
    "needs": "101",
    "risk": "Reuse the banner when there is no featured image rather than shipping a broken card.",
    "partial": false
  },
  {
    "n": 188,
    "title": "Public server event listings",
    "section": "Server discovery and identity",
    "effort": "S",
    "what": "Events appear on the public card and a /events view.",
    "needs": "62 (shipped)",
    "risk": "A cancelled event must vanish from the public list, not linger.",
    "partial": false
  },
  {
    "n": 190,
    "title": "Custom invitation pages",
    "section": "Server discovery and identity",
    "effort": "S",
    "what": "A branded join page per invite code with the banner and rules.",
    "needs": "110",
    "risk": "Invite links are how raids arrive; rate-limit joins per code and keep 95 in front.",
    "partial": false
  },
  {
    "n": 191,
    "title": "Custom join questions",
    "section": "Server owner tools",
    "effort": "M",
    "what": "One to three questions before joining; answers visible to mods.",
    "needs": "54 (shipped)",
    "risk": "Answers are personal data; owner-only, deleted with the membership, included in the account export.",
    "partial": false
  },
  {
    "n": 192,
    "title": "Member verification settings",
    "section": "Server owner tools",
    "effort": "M",
    "what": "Require an account age or a Turnstile challenge to join.",
    "needs": "—",
    "risk": "Verification excludes real people; default off and never require a phone.",
    "partial": false
  },
  {
    "n": 193,
    "title": "Moderation dashboard",
    "section": "Server owner tools",
    "effort": "M",
    "what": "One page for reports, recent actions, slow mode and mutes.",
    "needs": "51 (shipped)",
    "risk": "A dashboard that shows DMs would be a privacy breach; reports only.",
    "partial": false
  },
  {
    "n": 194,
    "title": "Member warning history",
    "section": "Server owner tools",
    "effort": "S",
    "what": "Every warning and mute for one member in one place.",
    "needs": "193",
    "risk": "A permanent record shown to the member escalates; show count and reason, not mod notes.",
    "partial": false
  },
  {
    "n": 195,
    "title": "Automated spam protection",
    "section": "Server owner tools",
    "effort": "M",
    "what": "Detect repeated lines, link floods and join raids.",
    "needs": "—",
    "risk": "False positives mute a real member; start with links and repeats, and always tell a mod.",
    "partial": false
  },
  {
    "n": 196,
    "title": "Custom moderation rules",
    "section": "Server owner tools",
    "effort": "M",
    "what": "Banned words, link policy and caps limits per server.",
    "needs": "70 (shipped)",
    "risk": "Word filters are trivially evaded and over-block; ship advisory flags to mods, not silent blocks.",
    "partial": false
  },
  {
    "n": 199,
    "title": "Automatic inactive-member management",
    "section": "Server owner tools",
    "effort": "M",
    "what": "Flag members inactive for N days, then optionally remove them.",
    "needs": "—",
    "risk": "Never remove silently; a 30-day grace list and an owner confirmation are the feature.",
    "partial": false
  },
  {
    "n": 200,
    "title": "Server backup and restore",
    "section": "Server owner tools",
    "effort": "—",
    "what": "Shipped in 60, JSON export and import.",
    "needs": "—",
    "risk": "Done; a scheduled export is the remaining part.",
    "partial": true
  }
];
  NX.slate = items;

  var list = document.getElementById('nxSlateList');
  var search = document.getElementById('nxSlateSearch');
  var count = document.getElementById('nxSlateCount');
  var empty = document.getElementById('nxSlateEmpty');
  if (!list || !search) return;

  var query = '';
  var filter = 'all';

  function effortGroup(effort) {
    if (/^S/i.test(effort)) return 's';
    if (/^M/i.test(effort)) return 'm';
    if (/^L/i.test(effort)) return 'l';
    return 'other';
  }

  function matches(item) {
    if (filter !== 'all' && effortGroup(item.effort) !== filter) return false;
    var q = query.trim().toLowerCase();
    if (!q) return true;
    return [item.n, item.title, item.section, item.effort, item.what, item.needs, item.risk]
      .join(' ').toLowerCase().indexOf(q) !== -1;
  }

  function row(item) {
    return '<details class="nx-slate-item" data-plan="' + item.n + '">'
      + '<summary><span class="nx-slate-no">' + String(item.n) + '</span>'
      + '<span class="nx-slate-copy"><span class="nx-slate-title">' + NX.esc(item.title) + '</span>'
      + '<span class="nx-slate-meta">' + NX.esc(item.section) + ' · ' + NX.esc(item.effort) + (item.partial ? ' · partial' : '') + '</span></span>'
      + '<svg class="nx-slate-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="m9 18 6-6-6-6"/></svg></summary>'
      + '<div class="nx-slate-body"><p>' + NX.esc(item.what) + '</p>'
      + '<dl class="nx-slate-facts"><div><dt>Needs</dt><dd>' + NX.esc(item.needs || 'Nothing') + '</dd></div><div><dt>Risk</dt><dd>' + NX.esc(item.risk) + '</dd></div></dl>'
      + '</div></details>';
  }

  function render() {
    var visible = items.filter(matches);
    list.innerHTML = visible.map(row).join('');
    if (count) count.textContent = visible.length + ' of ' + items.length + ' items';
    if (empty) empty.hidden = visible.length !== 0;
  }

  search.addEventListener('input', function () {
    query = search.value;
    render();
  });

  NX.$$('[data-slate-filter]').forEach(function (button) {
    button.addEventListener('click', function () {
      filter = button.getAttribute('data-slate-filter') || 'all';
      NX.$$('[data-slate-filter]').forEach(function (other) {
        var on = other === button;
        other.classList.toggle('on', on);
        other.setAttribute('aria-pressed', String(on));
      });
      render();
    });
  });

  render();
})();
