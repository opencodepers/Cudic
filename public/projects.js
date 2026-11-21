/* file: public/projects.js
 * what: the /projects client — board filters, weekly votes, project detail and
 *   comments, submission dialog, and one Motion-authored entrance.
 * invariants: every request is same-origin; the server is the source of truth
 *   for scores and ownership; reduced motion leaves all content and state usable.
 */
(function () {
  'use strict';

  var $ = function (selector, root) { return (root || document).querySelector(selector); };
  var $$ = function (selector, root) { return Array.prototype.slice.call((root || document).querySelectorAll(selector)); };

  var CATEGORIES = [
    { id: 'all', label: 'All projects' },
    { id: 'game', label: 'Games' },
    { id: 'tool', label: 'Tools' },
    { id: 'site', label: 'Sites' },
    { id: 'app', label: 'Apps' },
    { id: 'art', label: 'Art' },
    { id: 'writing', label: 'Writing' },
    { id: 'music', label: 'Music' },
    { id: 'other', label: 'Other' }
  ];
  var CATEGORY_LABELS = {};
  CATEGORIES.forEach(function (category) { CATEGORY_LABELS[category.id] = category.label; });

  var Motion = window.Motion || null;
  var API_BASE = (typeof WS_URL !== 'undefined' && WS_URL)
    ? WS_URL.replace(/^wss?:\/\//, 'https://')
    : '';
  var reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var toastTimer = 0;
  var searchTimer = 0;

  var state = {
    session: null,
    user: null,
    token: '',
    projects: [],
    sort: 'week',
    category: 'all',
    query: '',
    weekStart: '',
    weekEnd: '',
    loading: false,
    hasRevealed: false,
    voting: {},
    slug: slugFromPath(),
    detailProject: null,
    comments: [],
    commentDraft: '',
    commentLoading: false,
    commentError: '',
    detailLoading: false,
    hasRevealedDetail: false,
    dialogTrigger: null
  };

  function slugFromPath() {
    var match = /^\/projects\/([^/]+)\/?$/.exec(window.location.pathname);
    if (!match) return '';
    try { return decodeURIComponent(match[1]); } catch (err) { return match[1]; }
  }

  function esc(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (character) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character];
    });
  }

  function request(path, options) {
    var opts = options || {};
    var headers = Object.assign({ Accept: 'application/json' }, opts.headers || {});
    if (opts.body && !headers['Content-Type']) headers['Content-Type'] = 'application/json';
    if (state.token && !headers.Authorization) headers.Authorization = 'Bearer ' + state.token;
    return fetch(API_BASE + path, Object.assign({ credentials: 'same-origin', cache: 'no-store' }, opts, { headers: headers }))
      .then(function (response) {
        return response.text().then(function (text) {
          var data = {};
          try { data = text ? JSON.parse(text) : {}; } catch (err) { data = { error: text.slice(0, 180) }; }
          if (!response.ok) {
            var detail = data.text || data.error || data.message;
            if (detail && typeof detail === 'object') detail = detail.message || JSON.stringify(detail);
            var error = new Error(typeof detail === 'string' && detail
              ? detail
              : 'That request did not go through (' + response.status + ').');
            error.status = response.status;
            if (typeof data.error === 'string') error.code = data.error;
            throw error;
          }
          return data;
        });
      });
  }

  function loginUrl() {
    return '/login?next=' + encodeURIComponent(window.location.pathname + window.location.search);
  }

  function requireSignIn(action) {
    showToast('Sign in to ' + action + '.');
    window.setTimeout(function () { window.location.href = loginUrl(); }, 420);
  }

  function formatNumber(value) {
    return Number(value || 0).toLocaleString();
  }

  function formatCompact(value) {
    var number = Number(value) || 0;
    if (Math.abs(number) < 1000) return String(number);
    return (number / 1000).toFixed(number % 1000 === 0 ? 0 : 1).replace(/\.0$/, '') + 'k';
  }

  function signed(value) {
    var number = Number(value) || 0;
    return number > 0 ? '+' + number : String(number);
  }

  function initials(name) {
    var words = String(name || '').trim().split(/\s+/).filter(Boolean);
    if (!words.length) return '—';
    return words.slice(0, 2).map(function (word) { return word.charAt(0).toUpperCase(); }).join('');
  }

  function categoryLabel(category) {
    return CATEGORY_LABELS[category] || 'Other';
  }

  function shortDate(iso) {
    var date = new Date(iso);
    if (isNaN(date.getTime())) return '';
    return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  }

  function timeAgo(iso) {
    var date = new Date(iso);
    if (isNaN(date.getTime())) return '';
    var seconds = Math.max(0, Math.floor((Date.now() - date.getTime()) / 1000));
    if (seconds < 50) return 'just now';
    if (seconds < 3600) return Math.floor(seconds / 60) + 'm ago';
    if (seconds < 86400) return Math.floor(seconds / 3600) + 'h ago';
    if (seconds < 604800) return Math.floor(seconds / 86400) + 'd ago';
    return shortDate(iso);
  }

  function projectUrl(project) {
    return '/projects/' + encodeURIComponent(project.slug);
  }

  function safeHttp(value) {
    return /^https?:\/\//i.test(String(value || '')) ? String(value) : '';
  }

  function artMarkup(project) {
    var fallback = '<span class="project-art-fallback"><b>' + esc(initials(project.name)) +
      '</b><small>' + esc(categoryLabel(project.category)) + '</small></span>';
    var image = safeHttp(project.image_url);
    return fallback + (image
      ? '<img src="' + esc(image) + '" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer">'
      : '');
  }

  function showToast(message) {
    var toast = $('#projectToast');
    if (!toast) return;
    window.clearTimeout(toastTimer);
    toast.textContent = message;
    toast.setAttribute('aria-hidden', 'false');
    toast.classList.add('is-on');
    toastTimer = window.setTimeout(function () {
      toast.classList.remove('is-on');
      toast.setAttribute('aria-hidden', 'true');
    }, 3600);
  }

  function motionAnimate(target, keyframes, options) {
    if (!Motion || !Motion.animate || reduceMotion) return null;
    try { return Motion.animate(target, keyframes, options); } catch (err) { return null; }
  }

  function revealHero() {
    if (reduceMotion) return;
    motionAnimate($$('.projects-hero-copy > *'), { opacity: [0, 1], y: [12, 0] }, {
      duration: 0.46, delay: Motion && Motion.stagger ? Motion.stagger(0.055) : 0, ease: [0.22, 1, 0.36, 1]
    });
    motionAnimate($('.projects-cycle-card'), { opacity: [0, 1], y: [12, 0] }, {
      duration: 0.46, delay: 0.16, ease: [0.22, 1, 0.36, 1]
    });
  }

  function revealCards() {
    if (state.hasRevealed || reduceMotion) return;
    var cards = $$('.project-card', $('#projectList'));
    if (!cards.length) return;
    state.hasRevealed = true;
    motionAnimate(cards, { opacity: [0, 1], y: [12, 0] }, {
      duration: 0.4,
      delay: Motion && Motion.stagger ? Motion.stagger(0.035) : 0,
      ease: [0.22, 1, 0.36, 1]
    });
  }

  function revealDetail() {
    if (reduceMotion) return;
    motionAnimate($$('.project-detail-grid > *, .project-comments'), { opacity: [0, 1], y: [12, 0] }, {
      duration: 0.4, delay: Motion && Motion.stagger ? Motion.stagger(0.045) : 0, ease: [0.22, 1, 0.36, 1]
    });
  }

  function pulseVote(projectId) {
    window.requestAnimationFrame(function () {
      var row = $('.project-card[data-project-id="' + projectId + '"]');
      var button = row && $('.project-vote.is-on', row);
      if (button) motionAnimate(button, { scale: [0.82, 1] }, { type: 'spring', stiffness: 320, damping: 32 });
      var detail = $('#projectDetail');
      var score = detail && $('.project-vote-score', detail);
      if (score) motionAnimate(score, { y: [2, 0] }, { type: 'spring', stiffness: 320, damping: 32 });
    });
  }

  function weekParts() {
    var start = state.weekStart ? new Date(state.weekStart + 'T00:00:00.000Z') : null;
    var end = state.weekEnd ? new Date(state.weekEnd) : null;
    if (!start || isNaN(start.getTime())) {
      start = new Date();
      var day = start.getUTCDay();
      var distance = (day + 6) % 7;
      start.setUTCDate(start.getUTCDate() - distance);
      start.setUTCHours(0, 0, 0, 0);
    }
    if (!end || isNaN(end.getTime())) {
      end = new Date(start.getTime() + 7 * 86400000);
    }
    return { start: start, end: end };
  }

  function renderWeek() {
    var parts = weekParts();
    var pill = $('#cyclePill');
    var date = $('#resetDate');
    if (pill) pill.textContent = 'Week of ' + parts.start.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    if (date) {
      date.textContent = 'Resets ' + parts.end.toLocaleDateString(undefined, {
        weekday: 'short', month: 'short', day: 'numeric'
      }) + ' · 00:00 UTC';
    }
    updateCountdown();
  }

  function updateCountdown() {
    var parts = weekParts();
    var countdown = $('#resetCountdown');
    var meter = $('#cycleMeter');
    var now = Date.now();
    var left = Math.max(0, parts.end.getTime() - now);
    var total = Math.max(1, parts.end.getTime() - parts.start.getTime());
    var elapsed = Math.min(1, Math.max(0, (now - parts.start.getTime()) / total));
    if (countdown) {
      if (!left) countdown.textContent = 'Resetting now';
      else {
        var days = Math.floor(left / 86400000);
        var hours = Math.floor((left % 86400000) / 3600000);
        var minutes = Math.floor((left % 3600000) / 60000);
        var seconds = Math.floor((left % 60000) / 1000);
        countdown.textContent = days > 0
          ? days + 'd ' + String(hours).padStart(2, '0') + 'h'
          : hours > 0
            ? hours + 'h ' + String(minutes).padStart(2, '0') + 'm'
            : minutes + 'm ' + String(seconds).padStart(2, '0') + 's';
      }
    }
    if (meter) meter.style.width = Math.max(2, Math.round(elapsed * 100)) + '%';
  }

  function renderStats() {
    var projects = state.projects || [];
    var weekVotes = projects.reduce(function (total, project) {
      return total + (Number(project.week_upvotes) || 0) + (Number(project.week_downvotes) || 0);
    }, 0);
    var allTime = projects.reduce(function (total, project) { return total + (Number(project.upvotes) || 0); }, 0);
    var projectEl = $('#statProjects');
    var votesEl = $('#statVotes');
    var allEl = $('#statAllTime');
    if (projectEl) projectEl.textContent = state.loading ? '—' : formatNumber(projects.length);
    if (votesEl) votesEl.textContent = state.loading ? '—' : formatCompact(weekVotes);
    if (allEl) allEl.textContent = state.loading ? '—' : formatCompact(allTime);
  }

  function renderCategories() {
    var list = $('#categoryList');
    if (!list) return;
    var counts = { all: state.projects.length };
    state.projects.forEach(function (project) {
      counts[project.category] = (counts[project.category] || 0) + 1;
    });
    list.innerHTML = CATEGORIES.map(function (category) {
      var active = state.category === category.id;
      return '<button class="projects-cat' + (active ? ' is-on' : '') + '" type="button" data-category="' +
        esc(category.id) + '" aria-pressed="' + (active ? 'true' : 'false') + '">' +
        '<span>' + esc(category.label) + '</span><small>' + (counts[category.id] || 0) + '</small></button>';
    }).join('');
  }

  function filteredProjects() {
    var query = state.query.trim().toLowerCase();
    var rows = state.projects.filter(function (project) {
      if (state.category !== 'all' && project.category !== state.category) return false;
      if (!query) return true;
      return [project.name, project.tagline, project.description, (project.tags || []).join(' '), project.domain]
        .join(' ').toLowerCase().indexOf(query) !== -1;
    });
    rows.sort(function (a, b) {
      var aPrimary = state.sort === 'all' ? a.all_score : a.week_score;
      var bPrimary = state.sort === 'all' ? b.all_score : b.week_score;
      var aUp = state.sort === 'all' ? a.upvotes : a.week_upvotes;
      var bUp = state.sort === 'all' ? b.upvotes : b.week_upvotes;
      return (bPrimary - aPrimary) || (bUp - aUp) || (b.upvotes - a.upvotes) ||
        (new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
    });
    return rows;
  }

  function projectCard(project, index) {
    var rank = index + 1;
    var votesDisabled = project.is_owner || !!state.voting[project.id];
    var tags = (project.tags || []).slice(0, 4).map(function (tag) {
      return '<span class="project-tag">' + esc(tag) + '</span>';
    }).join('');
    var domain = project.domain ? '<span class="project-domain">' + esc(project.domain) + '</span>' : '';
    var url = safeHttp(project.url);
    return '<article class="project-card' + (rank <= 3 ? ' is-top' : '') + '" data-project-id="' + esc(project.id) + '">' +
      '<span class="project-rank' + (rank <= 3 ? ' rank-' + rank : '') + '">' + (rank < 10 ? '0' + rank : rank) + '</span>' +
      '<a class="project-art" href="' + esc(projectUrl(project)) + '" aria-label="Open ' + esc(project.name) + '">' + artMarkup(project) + '</a>' +
      '<div class="project-main">' +
        '<div class="project-head"><div><h3><a href="' + esc(projectUrl(project)) + '">' + esc(project.name) + '</a></h3>' +
          '<p class="project-tagline">' + esc(project.tagline || 'A project on the board.') + '</p></div>' + domain + '</div>' +
        (project.description ? '<p class="project-desc">' + esc(project.description) + '</p>' : '') +
        '<div class="project-meta"><span class="project-cat">' + esc(categoryLabel(project.category)) + '</span>' +
          (tags ? '<span class="project-meta-dot">·</span>' + tags : '') +
          '<span class="project-meta-dot">·</span><span>by ' + esc(project.owner.display_name) + '</span></div>' +
        '<div class="project-links"><a href="' + esc(projectUrl(project)) + '#comments">Comments ' + formatNumber(project.comments) + '</a>' +
          (url ? '<a href="' + esc(url) + '" target="_blank" rel="noopener noreferrer nofollow">Visit project</a>' : '') + '</div>' +
      '</div>' +
      '<div class="project-side">' +
        '<div class="project-week"><b class="' + (project.week_score > 0 ? 'is-positive' : '') + '">' + signed(project.week_score) + '</b><small>this week</small></div>' +
        '<div class="project-votes" role="group" aria-label="Vote on ' + esc(project.name) + '">' +
          '<button class="project-vote' + (project.my_vote === 1 ? ' is-on' : '') + '" type="button" data-vote="1" aria-label="Upvote ' + esc(project.name) + '" aria-pressed="' + (project.my_vote === 1 ? 'true' : 'false') + '"' + (votesDisabled ? ' disabled' : '') + '>' +
            '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 14 6-6 6 6"/></svg></button>' +
          '<button class="project-vote' + (project.my_vote === -1 ? ' is-on' : '') + '" type="button" data-vote="-1" aria-label="Downvote ' + esc(project.name) + '" aria-pressed="' + (project.my_vote === -1 ? 'true' : 'false') + '"' + (votesDisabled ? ' disabled' : '') + '>' +
            '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 10 6 6 6-6"/></svg></button>' +
        '</div>' +
        '<span class="project-alltime">' + formatNumber(project.upvotes) + ' all-time up</span>' +
      '</div>' +
    '</article>';
  }

  function renderBoard() {
    var list = $('#projectList');
    var empty = $('#projectEmpty');
    if (!list) return;
    var rows = filteredProjects();

    renderCategories();
    renderStats();
    var title = $('#boardTitle');
    var sub = $('#boardSub');
    var count = $('#boardCount');
    if (title) title.textContent = state.sort === 'all' ? 'All-time board' : "This week's board";
    if (sub) {
      sub.textContent = state.sort === 'all'
        ? 'Ranked by lifetime net votes. The weekly score stays beside it.'
        : 'Ranked by net votes since Monday 00:00 UTC.';
    }
    if (count) count.textContent = rows.length + (rows.length === 1 ? ' project' : ' projects');

    if (state.loading && !state.projects.length) return;
    list.innerHTML = rows.map(projectCard).join('');
    list.hidden = rows.length === 0;
    if (empty) {
      empty.hidden = rows.length !== 0;
      var emptyText = $('#projectEmptyText');
      if (emptyText) {
        emptyText.textContent = state.query
          ? 'No projects match “' + state.query + '”. Try a name, tag or domain.'
          : state.category !== 'all'
            ? 'Nothing in this category yet. Be the first to add one.'
            : 'Be the first to put something on this board.';
      }
    }
    bindArtFallbacks();
    revealCards();
  }

  function renderBoardError(error) {
    var list = $('#projectList');
    var empty = $('#projectEmpty');
    if (empty) empty.hidden = true;
    if (!list) return;
    list.hidden = false;
    list.innerHTML = '<div class="projects-empty"><div class="projects-empty-mark" aria-hidden="true">!</div>' +
      '<h3>The board did not load</h3><p>' + esc(error.message || 'Try again in a moment.') + '</p>' +
      '<button class="btn btn-secondary" type="button" data-retry-board>Try again</button></div>';
    state.loading = false;
    renderStats();
    setBoardCount('—');
  }

  function setBoardCount(text) {
    var count = $('#boardCount');
    if (count) count.textContent = text;
  }

  function bindArtFallbacks() {
    $$('.project-art img, .project-detail-art img').forEach(function (image) {
      image.addEventListener('error', function () { image.remove(); }, { once: true });
    });
  }

  async function loadBoard() {
    state.loading = true;
    state.projects = [];
    renderStats();
    try {
      var data = await request('/api/projects?sort=week');
      state.projects = data.projects || [];
      state.weekStart = data.week_start || '';
      state.weekEnd = data.week_end || '';
      state.loading = false;
      renderWeek();
      renderBoard();
    } catch (error) {
      state.loading = false;
      renderBoardError(error);
      if (error.code === 'projects_not_set_up') showToast('The project board migration is not applied yet.');
    }
  }

  function renderDetailLoading() {
    var detail = $('#projectDetail');
    if (!detail) return;
    detail.innerHTML = '<a class="project-back" href="/projects"><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="vertical-align:-2px;margin-right:6px"><path d="M19 12H5M11 18l-6-6 6-6"/></svg>All projects</a>' +
      '<div class="projects-empty"><div class="projects-empty-mark" aria-hidden="true">…</div>' +
      '<h3>Opening the project</h3><p>Loading the board card and comments.</p></div>';
  }

  function renderDetailError(error) {
    var detail = $('#projectDetail');
    if (!detail) return;
    detail.innerHTML = '<a class="project-back" href="/projects"><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="vertical-align:-2px;margin-right:6px"><path d="M19 12H5M11 18l-6-6 6-6"/></svg>All projects</a>' +
      '<div class="projects-empty"><div class="projects-empty-mark" aria-hidden="true">!</div>' +
      '<h3>That project did not open</h3><p>' + esc(error.message || 'Try again from the board.') + '</p>' +
      '<a class="btn btn-secondary" href="/projects">Back to the board</a></div>';
  }

  function commentListHtml() {
    if (state.commentLoading) return '<div class="project-comment-empty">Loading comments…</div>';
    if (state.commentError) {
      return '<div class="project-comment-error">' + esc(state.commentError) +
        ' <button class="project-links" type="button" data-comment-retry style="border:0;background:none;padding:0;color:var(--signal);cursor:pointer">Try again</button></div>';
    }
    if (!state.comments.length) return '<p class="project-comment-empty">No comments yet. Say what you noticed, or ask how it was made.</p>';
    return state.comments.map(function (comment) {
      var avatar = safeHttp(comment.avatar_url)
        ? '<img src="' + esc(comment.avatar_url) + '" alt="">'
        : esc(initials(comment.display_name));
      return '<article class="project-comment"><span class="project-comment-avatar">' + avatar + '</span>' +
        '<div><div class="project-comment-head"><b>' + esc(comment.display_name) + '</b><time datetime="' +
        esc(comment.created_at) + '">' + esc(timeAgo(comment.created_at)) + '</time></div>' +
        '<p class="project-comment-body">' + esc(comment.body) + '</p></div></article>';
    }).join('');
  }

  function commentFormHtml() {
    if (!state.session) {
      return '<p class="project-comment-signin"><a href="' + esc(loginUrl()) + '">Sign in</a> to leave a comment. Public reading is open to everyone.</p>';
    }
    return '<form class="project-comment-form" id="projectCommentForm">' +
      '<label class="projects-mono" for="projectCommentBody">Add a comment</label>' +
      '<textarea id="projectCommentBody" maxlength="600" placeholder="What did you notice? What should someone try?">' + esc(state.commentDraft) + '</textarea>' +
      '<p class="project-form-msg" id="projectCommentError" role="alert"></p>' +
      '<div class="project-comment-form-foot"><small><span id="projectCommentCount">' + state.commentDraft.length + '</span>/600</small>' +
      '<button class="btn btn-primary" type="submit" id="projectCommentSubmit">Post comment</button></div></form>';
  }

  function renderDetail() {
    var detail = $('#projectDetail');
    var project = state.detailProject;
    if (!detail || !project) return;
    var avatar = safeHttp(project.owner.avatar_url)
      ? '<img src="' + esc(project.owner.avatar_url) + '" alt="">'
      : esc(initials(project.owner.display_name));
    var external = safeHttp(project.url);
    var tags = (project.tags || []).map(function (tag) {
      return '<span class="project-tag">' + esc(tag) + '</span>';
    }).join('');
    var comments = project.comments || 0;
    var votesDisabled = project.is_owner || !!state.voting[project.id];
    detail.innerHTML =
      '<a class="project-back" href="/projects"><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="vertical-align:-2px;margin-right:6px"><path d="M19 12H5M11 18l-6-6 6-6"/></svg>All projects</a>' +
      '<div class="project-detail-grid">' +
        '<div>' +
          '<div class="project-detail-art">' + artMarkup(project) + '</div>' +
          '<div class="project-detail-copy">' +
            '<div class="project-detail-kicker"><span>' + esc(categoryLabel(project.category)) + '</span><span>·</span>' +
              'on the board since ' + esc(shortDate(project.created_at)) + '</div>' +
            '<h2>' + esc(project.name) + '</h2>' +
            '<p class="project-detail-tagline">' + esc(project.tagline || 'A project on the board.') + '</p>' +
            (project.description ? '<p class="project-detail-desc">' + esc(project.description) + '</p>' : '') +
            '<div class="project-detail-meta"><span>by <b>' + esc(project.owner.display_name) + '</b></span>' +
              (project.domain ? '<span>' + esc(project.domain) + '</span>' : '') +
              (tags ? '<span>' + tags + '</span>' : '') + '</div>' +
            '<div class="project-detail-actions">' +
              (external ? '<a class="btn btn-primary" href="' + esc(external) + '" target="_blank" rel="noopener noreferrer nofollow">Open project</a>' : '') +
              '<a class="btn btn-secondary" href="#comments">Comments ' + formatNumber(comments) + '</a>' +
            '</div>' +
          '</div>' +
        '</div>' +
        '<aside class="project-vote-card" aria-label="Vote on this project">' +
          '<span class="projects-mono">This week</span>' +
          '<b class="project-vote-score' + (project.week_score > 0 ? ' is-positive' : '') + '">' + signed(project.week_score) + '</b>' +
          '<p class="project-vote-label">net weekly score</p>' +
          '<div class="project-vote-actions" role="group" aria-label="Vote">' +
            '<button class="project-vote' + (project.my_vote === 1 ? ' is-on' : '') + '" type="button" data-vote="1" aria-label="Upvote" aria-pressed="' + (project.my_vote === 1 ? 'true' : 'false') + '"' + (votesDisabled ? ' disabled' : '') + '>' +
              '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 14 6-6 6 6"/></svg></button>' +
            '<button class="project-vote' + (project.my_vote === -1 ? ' is-on' : '') + '" type="button" data-vote="-1" aria-label="Downvote" aria-pressed="' + (project.my_vote === -1 ? 'true' : 'false') + '"' + (votesDisabled ? ' disabled' : '') + '>' +
              '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 10 6 6 6-6"/></svg></button>' +
          '</div>' +
          '<span class="project-alltime"><b>' + formatNumber(project.upvotes) + '</b> all-time up · <b>' + formatNumber(project.downvotes) + '</b> down</span>' +
          '<p class="project-vote-note">' + (project.is_owner ? 'This is your project. You cannot vote on it.' : 'One vote per project each week. Change it or clear it any time.') + '</p>' +
          '<div class="project-owner"><span class="project-owner-avatar">' + avatar + '</span><span>by ' + esc(project.owner.display_name) + '</span></div>' +
        '</aside>' +
      '</div>' +
      '<section class="project-comments" id="comments">' +
        '<div class="project-comments-head"><h3>Comments</h3><span>' + formatNumber(comments) + ' total</span></div>' +
        '<div class="project-comment-list">' + commentListHtml() + '</div>' +
        commentFormHtml() +
      '</section>';
    bindArtFallbacks();
    if (!state.hasRevealedDetail) {
      state.hasRevealedDetail = true;
      revealDetail();
    }
    if (state.commentDraft) {
      var input = $('#projectCommentBody');
      if (input) input.setSelectionRange(input.value.length, input.value.length);
    }
  }

  async function loadComments(slug) {
    state.commentLoading = true;
    state.commentError = '';
    renderDetail();
    try {
      var data = await request('/api/projects/' + encodeURIComponent(slug) + '/comments');
      state.comments = data.comments || [];
    } catch (error) {
      state.commentError = error.message || 'Comments did not load.';
    } finally {
      state.commentLoading = false;
      renderDetail();
    }
  }

  async function loadProject() {
    state.detailLoading = true;
    state.detailProject = null;
    state.comments = [];
    state.commentDraft = '';
    state.commentError = '';
    state.hasRevealedDetail = false;
    toggleDetailView(true);
    renderDetailLoading();
    try {
      var data = await request('/api/projects/' + encodeURIComponent(state.slug));
      state.detailProject = data.project;
      state.weekStart = data.week_start || '';
      state.weekEnd = data.week_end || '';
      state.detailLoading = false;
      renderWeek();
      document.title = data.project.name + ' — Projects — Cudic';
      renderDetail();
      loadComments(data.project.slug);
    } catch (error) {
      state.detailLoading = false;
      renderDetailError(error);
    }
  }

  function toggleDetailView(isDetail) {
    var hero = $('#boardHero');
    var board = $('#board');
    var detail = $('#projectDetail');
    if (hero) hero.hidden = isDetail;
    if (board) board.hidden = isDetail;
    if (detail) detail.hidden = !isDetail;
    if (!isDetail) document.title = 'Projects — Cudic';
  }

  function findProject(projectId) {
    if (state.detailProject && state.detailProject.id === projectId) return state.detailProject;
    for (var i = 0; i < state.projects.length; i += 1) {
      if (state.projects[i].id === projectId) return state.projects[i];
    }
    return null;
  }

  function snapshotVote(project) {
    return {
      week_upvotes: project.week_upvotes,
      week_downvotes: project.week_downvotes,
      week_score: project.week_score,
      upvotes: project.upvotes,
      downvotes: project.downvotes,
      all_score: project.all_score,
      my_vote: project.my_vote
    };
  }

  function applyVoteNumbers(project, next) {
    var previous = Number(project.my_vote) || 0;
    project.week_upvotes = Math.max(0, project.week_upvotes + (next === 1 ? 1 : 0) - (previous === 1 ? 1 : 0));
    project.week_downvotes = Math.max(0, project.week_downvotes + (next === -1 ? 1 : 0) - (previous === -1 ? 1 : 0));
    project.week_score = project.week_upvotes - project.week_downvotes;
    project.upvotes = Math.max(0, project.upvotes + (next === 1 ? 1 : 0) - (previous === 1 ? 1 : 0));
    project.downvotes = Math.max(0, project.downvotes + (next === -1 ? 1 : 0) - (previous === -1 ? 1 : 0));
    project.all_score = project.upvotes - project.downvotes;
    project.my_vote = next;
  }

  function applyVoteResponse(project, data) {
    project.week_upvotes = Number(data.week_upvotes) || 0;
    project.week_downvotes = Number(data.week_downvotes) || 0;
    project.week_score = Number(data.week_score) || 0;
    project.upvotes = Number(data.upvotes) || 0;
    project.downvotes = Number(data.downvotes) || 0;
    project.all_score = project.upvotes - project.downvotes;
    project.my_vote = Number(data.my_vote) || 0;
  }

  async function vote(projectId, value) {
    var project = findProject(projectId);
    if (!project) return;
    if (!state.session) { requireSignIn('vote'); return; }
    if (project.is_owner) { showToast('You cannot vote on your own project.'); return; }
    if (state.voting[projectId]) return;
    var next = Number(project.my_vote) === value ? 0 : value;
    var before = snapshotVote(project);
    state.voting[projectId] = true;
    applyVoteNumbers(project, next);
    if (state.detailProject && state.detailProject.id === projectId) renderDetail();
    else renderBoard();
    try {
      var data = await request('/api/projects/' + encodeURIComponent(project.id) + '/vote', {
        method: 'POST',
        body: JSON.stringify({ vote: next })
      });
      applyVoteResponse(project, data);
      delete state.voting[projectId];
      if (state.detailProject && state.detailProject.id === projectId) renderDetail();
      else renderBoard();
      pulseVote(projectId);
      showToast(next === 1 ? 'Upvote counted.' : next === -1 ? 'Downvote counted.' : 'Vote cleared.');
    } catch (error) {
      Object.assign(project, before);
      delete state.voting[projectId];
      if (state.detailProject && state.detailProject.id === projectId) renderDetail();
      else renderBoard();
      if (error.status === 401) requireSignIn('vote');
      else showToast(error.message || 'The vote did not save.');
    }
  }

  function setSubmitBusy(busy) {
    var submit = $('#projectSubmit');
    if (!submit) return;
    submit.disabled = busy;
    submit.setAttribute('aria-busy', busy ? 'true' : 'false');
    submit.textContent = busy ? 'Submitting…' : (state.session ? 'Submit for review' : 'Sign in to submit');
  }

  function openSubmitDialog() {
    var dialog = $('#projectDialog');
    var form = $('#projectForm');
    var note = $('#projectFormAuth');
    var message = $('#projectFormMsg');
    if (!dialog || !form) return;
    state.dialogTrigger = document.activeElement;
    form.reset();
    $('#projectCategory').value = 'site';
    if (note) note.hidden = !!state.session;
    if (message) message.textContent = '';
    setSubmitBusy(false);
    if (!dialog.open) {
      if (typeof dialog.showModal === 'function') dialog.showModal();
      else dialog.setAttribute('open', '');
      motionAnimate(dialog, { opacity: [0, 1], y: [16, 0], scale: [0.985, 1] }, {
        duration: 0.26, ease: [0.22, 1, 0.36, 1]
      });
    }
    var first = $('#projectName');
    if (first) window.setTimeout(function () { first.focus(); }, 40);
  }

  function closeSubmitDialog() {
    var dialog = $('#projectDialog');
    if (!dialog || !dialog.open) return;
    if (typeof dialog.close === 'function') dialog.close();
    else dialog.removeAttribute('open');
  }

  async function submitProject(event) {
    event.preventDefault();
    if (!state.session) { window.location.href = loginUrl(); return; }
    var message = $('#projectFormMsg');
    var name = $('#projectName').value.trim();
    var url = $('#projectUrl').value.trim();
    var category = $('#projectCategory').value;
    if (name.length < 2) { message.textContent = 'Give the project a name.'; $('#projectName').focus(); return; }
    if (url && !/^https?:\/\//i.test(url)) {
      url = 'https://' + url;
      $('#projectUrl').value = url;
    }
    if (!/^https?:\/\/[^\s/$.?#].[^\s]*$/i.test(url)) {
      message.textContent = 'Add a public http(s) URL.'; $('#projectUrl').focus(); return;
    }
    message.textContent = '';
    setSubmitBusy(true);
    try {
      var data = await request('/api/projects', {
        method: 'POST',
        body: JSON.stringify({
          name: name,
          url: url,
          tagline: $('#projectTagline').value.trim(),
          description: $('#projectDescription').value.trim(),
          category: category,
          tags: $('#projectTags').value.trim(),
          image_url: $('#projectImage').value.trim() || null
        })
      });
      closeSubmitDialog();
      window.location.href = projectUrl(data.project);
    } catch (error) {
      if (error.status === 401) { window.location.href = loginUrl(); return; }
      message.textContent = error.message || 'The project did not submit.';
      setSubmitBusy(false);
    }
  }

  async function postComment(event) {
    event.preventDefault();
    if (!state.session) { window.location.href = loginUrl(); return; }
    var body = state.commentDraft.trim();
    var submit = $('#projectCommentSubmit');
    var errorBox = $('#projectCommentError');
    if (!body) {
      if (errorBox) errorBox.textContent = 'Write a comment first.';
      else showToast('Write a comment first.');
      return;
    }
    if (submit) { submit.disabled = true; submit.textContent = 'Posting…'; }
    try {
      var data = await request('/api/projects/' + encodeURIComponent(state.detailProject.id) + '/comments', {
        method: 'POST',
        body: JSON.stringify({ body: body })
      });
      state.comments.unshift(data.comment);
      state.detailProject.comments = (state.detailProject.comments || 0) + 1;
      state.commentDraft = '';
      renderDetail();
      showToast('Comment posted.');
    } catch (error) {
      if (error.status === 401) requireSignIn('comment');
      else {
        if (errorBox) errorBox.textContent = error.message;
        else showToast(error.message || 'The comment did not post.');
      }
      if (submit) { submit.disabled = false; submit.textContent = 'Post comment'; }
    }
  }

  function bindEvents() {
    var openers = ['#openProjectDialog', '#heroSubmit'];
    openers.forEach(function (selector) {
      var button = $(selector);
      if (button) button.addEventListener('click', openSubmitDialog);
    });

    var close = $('#closeProjectDialog');
    if (close) close.addEventListener('click', closeSubmitDialog);
    var cancel = $('#cancelProjectDialog');
    if (cancel) cancel.addEventListener('click', closeSubmitDialog);
    var dialog = $('#projectDialog');
    if (dialog) {
      dialog.addEventListener('click', function (event) {
        if (event.target === dialog) closeSubmitDialog();
      });
      dialog.addEventListener('close', function () {
        if (state.dialogTrigger && typeof state.dialogTrigger.focus === 'function') state.dialogTrigger.focus();
      });
    }

    var form = $('#projectForm');
    if (form) form.addEventListener('submit', submitProject);

    var search = $('#projectSearch');
    if (search) {
      search.addEventListener('input', function () {
        window.clearTimeout(searchTimer);
        state.query = search.value;
        searchTimer = window.setTimeout(renderBoard, 90);
      });
    }

    $$('.projects-sort-btn').forEach(function (button) {
      button.addEventListener('click', function () {
        state.sort = button.getAttribute('data-sort') === 'all' ? 'all' : 'week';
        $$('.projects-sort-btn').forEach(function (item) {
          var active = item === button;
          item.classList.toggle('is-on', active);
          item.setAttribute('aria-pressed', active ? 'true' : 'false');
        });
        renderBoard();
      });
    });

    var categories = $('#categoryList');
    if (categories) {
      categories.addEventListener('click', function (event) {
        var button = event.target.closest('[data-category]');
        if (!button) return;
        state.category = button.getAttribute('data-category');
        renderBoard();
      });
    }

    var list = $('#projectList');
    if (list) {
      list.addEventListener('click', function (event) {
        var retry = event.target.closest('[data-retry-board]');
        if (retry) { loadBoard(); return; }
        var voteButton = event.target.closest('[data-vote]');
        if (!voteButton) return;
        var card = voteButton.closest('[data-project-id]');
        if (!card) return;
        vote(card.getAttribute('data-project-id'), Number(voteButton.getAttribute('data-vote')));
      });
    }

    var detail = $('#projectDetail');
    if (detail) {
      detail.addEventListener('click', function (event) {
        var retry = event.target.closest('[data-comment-retry]');
        if (retry && state.detailProject) { loadComments(state.detailProject.slug); return; }
        var voteButton = event.target.closest('[data-vote]');
        if (!voteButton || !state.detailProject) return;
        vote(state.detailProject.id, Number(voteButton.getAttribute('data-vote')));
      });
      detail.addEventListener('input', function (event) {
        if (event.target.id !== 'projectCommentBody') return;
        state.commentDraft = event.target.value;
        var count = $('#projectCommentCount');
        if (count) count.textContent = state.commentDraft.length;
      });
      detail.addEventListener('submit', function (event) {
        if (event.target.id === 'projectCommentForm') postComment(event);
      });
    }

    var submitOpen = $('[data-open-submit]');
    if (submitOpen) submitOpen.addEventListener('click', openSubmitDialog);

    window.setInterval(updateCountdown, 1000);
  }

  async function initSession() {
    if (typeof getSession !== 'function') return;
    try {
      var session = await getSession();
      state.session = session && session.user ? session : null;
      state.user = state.session ? state.session.user : null;
      state.token = state.session && state.session.access_token ? state.session.access_token : '';
    } catch (err) {
      state.session = null;
      state.user = null;
      state.token = '';
    }
  }

  async function init() {
    bindEvents();
    renderWeek();
    revealHero();
    await initSession();
    if (state.slug) await loadProject();
    else await loadBoard();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
