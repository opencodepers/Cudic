/* file: lib/routes/mod.js
 * what: moderation, reports and changelog routes — extracted verbatim from server.js; routing order is unchanged.
 * invariants: handle() runs only when matches() is true; server.js falls through
 *   when nothing was written (res.headersSent is false). Shared helpers are
 *   injected by the factory, never re-declared here.
 */
module.exports = function createRoutes(deps) {
  const { cors, requireUser, needVerified, isModerator, supabase, isUuid, readBody, AWARDS, awardUser, notify, ghToken, rateLimit, canSeeLobby, packByKey, RESERVED_PACK_SLUGS, gamesListCacheClear } = deps;

  async function handle(req, res, url) {
  // ── API: request a friend ──────────────────────────────────────
  // ── API: mod user search (moderators only) ─────────────────────
  // Search by display name or cudic id #. Returns up to 20 rows.
  if (url.pathname === '/api/mod/users' && req.method === 'GET') {
    cors(res);
    const user = await requireUser(req, res); if (!user) return;
    if (!(await needVerified(user, res))) return;
    if (!(await isModerator(user.id))) { res.writeHead(403, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'Moderators only.' })); return; }
    const q = (new URL(req.url, 'http://localhost').searchParams.get('q') || '').trim().slice(0, 60);
    var query = supabase.from('users').select('id, user_id, display_name, avatar_url, created_at').order('created_at', { ascending: false }).limit(20);
    if (q) {
      const num = /^\d+$/.test(q) ? parseInt(q, 10) : null;
      if (num !== null) query = query.eq('user_id', num);
      else query = query.ilike('display_name', '%' + q.replace(/[%_\\]/g, '') + '%');
    }
    const { data } = await query;
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ users: data || [] }));
    return;
  }

  // ── API: mod — a user's awards + equips ───────────────────────
  if (url.pathname === '/api/mod/user-awards' && req.method === 'GET') {
    cors(res);
    const user = await requireUser(req, res); if (!user) return;
    if (!(await needVerified(user, res))) return;
    if (!(await isModerator(user.id))) { res.writeHead(403, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'Moderators only.' })); return; }
    const uid = (new URL(req.url, 'http://localhost').searchParams.get('id') || '').trim();
    if (!isUuid(uid)) { res.writeHead(400, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'Invalid user.' })); return; }
    const [bRes, pRes] = await Promise.all([
      supabase.from('user_badges').select('code, awarded_at').eq('user_id', uid),
      supabase.from('users').select('equips, display_name, user_id').eq('id', uid).single()
    ]);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ awards: bRes.data || [], equips: (pRes.data && pRes.data.equips) || { b: [], f: [], t: [] }, profile: pRes.data || null }));
    return;
  }

  // ── API: mod — grant or revoke an award for a player ──────────
  if (url.pathname === '/api/mod/grant' && req.method === 'POST') {
    cors(res);
    const user = await requireUser(req, res); if (!user) return;
    if (!(await needVerified(user, res))) return;
    if (!(await isModerator(user.id))) { res.writeHead(403, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'Moderators only.' })); return; }
    const body = await readBody(req).catch(() => ({}));
    const targetId = String(body.userId || '').trim();
    const code = String(body.code || '').trim();
    const action = body.action === 'revoke' ? 'revoke' : 'grant';
    if (!isUuid(targetId)) { res.writeHead(400, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'Invalid user.' })); return; }
    if (!AWARDS[code]) { res.writeHead(400, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'Unknown award code.' })); return; }
    if (action === 'grant') {
      const ok = await awardUser(targetId, code);
      notify(targetId, 'award', 'You received ' + (AWARDS[code].kind === 'title' ? 'the title ' : AWARDS[code].kind === 'badge' ? 'the badge ' : 'the flair ') + AWARDS[code].label,
        'Granted by a moderator.', null, null);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, granted: ok, alreadyOwned: !ok }));
      return;
    }
    // revoke
    await supabase.from('user_badges').delete().eq('user_id', targetId).eq('code', code);
    const { data: p } = await supabase.from('users').select('equips').eq('id', targetId).single();
    const eq = (p && p.equips && typeof p.equips === 'object') ? p.equips : { b: [], f: [], t: [] };
    const slot = AWARDS[code].kind === 'title' ? 't' : AWARDS[code].kind === 'flair' ? 'f' : 'b';
    if (Array.isArray(eq[slot])) eq[slot] = eq[slot].filter(c => c !== code);
    await supabase.from('users').update({ equips: eq }).eq('id', targetId);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, revoked: true }));
    return;
  }

  // ── API: mod — pull recent commits from GitHub (fallback) ─────
  if (url.pathname === '/api/mod/changelog/sync' && req.method === 'POST') {
    cors(res);
    const user = await requireUser(req, res); if (!user) return;
    if (!(await needVerified(user, res))) return;
    if (!(await isModerator(user.id))) { res.writeHead(403, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'Moderators only.' })); return; }
    // A public repo syncs with no token at all; an env token or the moderator's
    // connected account only raises GitHub's 60/hour anonymous limit. The old
    // code required GITHUB_TOKEN, which this project never sets, so the button
    // was dead for every moderator — including ones with no GitHub connection.
    let token = process.env.GITHUB_TOKEN || process.env.GITHUB_PAT || '';
    if (!token) {
      const conn = await ghToken(user);
      if (conn && conn.token) token = conn.token;
    }
    // The repo moved from nathent2023-glitch to opencodepers; the old owner
    // 404s even with a valid token. GITHUB_REPO lets a fork point elsewhere.
    const repo = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(process.env.GITHUB_REPO || '') ? process.env.GITHUB_REPO : 'opencodepers/Cudic';
    const ghHeaders = { 'Accept': 'application/vnd.github+json', 'User-Agent': 'Cudic' };
    if (token) ghHeaders.Authorization = 'Bearer ' + token;
    let ghRes;
    try { ghRes = await fetch('https://api.github.com/repos/' + repo + '/commits?per_page=100', { headers: ghHeaders }); }
    catch (e) { res.writeHead(502, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'GitHub unreachable.' })); return; }
    if (!ghRes.ok) { res.writeHead(502, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'GitHub ' + ghRes.status })); return; }
    const commits = await ghRes.json();
    let inserted = 0;
    for (const c of (Array.isArray(commits) ? commits : [])) {
      const subject = String((c.commit && c.commit.message) || '').split('\n')[0].slice(0, 140);
      if (!subject) continue;
      let kind = 'change';
      const m = subject.match(/^(\w+)(\(.+\))?!?:/);
      const prefix = m ? m[1].toLowerCase() : '';
      if (prefix === 'feat' || prefix === 'feature' || prefix === 'add') kind = 'feature';
      else if (prefix === 'fix') kind = 'fix';
      else if (prefix === 'perf' || prefix === 'improve') kind = 'improvement';
      const body = String((c.commit && c.commit.message) || '').split('\n').slice(1).join('\n').trim().slice(0, 2000);
      const authorName = String((c.commit && c.commit.author && c.commit.author.name) || 'unknown').slice(0, 80);
      const { error } = await supabase.from('changelog').insert({ kind, title: subject, body, author_name: authorName, commit_sha: c.sha, created_at: (c.commit && c.commit.author && c.commit.author.date) || new Date().toISOString(), author_id: null });
      if (!error) inserted++;
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, inserted, fetched: Array.isArray(commits) ? commits.length : 0 }));
    return;
  }

  // ── API: mod — send a message to a player's inbox ────────────
  if (url.pathname === '/api/mod/message' && req.method === 'POST') {
    cors(res);
    const user = await requireUser(req, res); if (!user) return;
    if (!(await needVerified(user, res))) return;
    if (!(await isModerator(user.id))) { res.writeHead(403, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'Moderators only.' })); return; }
    const body = await readBody(req).catch(() => ({}));
    const targetId = String(body.userId || '').trim();
    const title = String(body.title || '').trim().slice(0, 120);
    const text = String(body.body || '').trim().slice(0, 500);
    if (!isUuid(targetId)) { res.writeHead(400, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'Invalid user.' })); return; }
    if (!title) { res.writeHead(400, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'Give the message a subject.' })); return; }
    if (!text) { res.writeHead(400, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'Say something.' })); return; }
    await supabase.from('notifications').insert({ user_id: targetId, kind: 'mod_message', title, body: text, ref_type: null, ref_id: null });
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true }));
    return;
  }

  // ── API: mod — ban a player from chat (and comments) ─────────
  if (url.pathname === '/api/mod/ban' && req.method === 'POST') {
    cors(res);
    const user = await requireUser(req, res); if (!user) return;
    if (!(await needVerified(user, res))) return;
    if (!(await isModerator(user.id))) { res.writeHead(403, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'Moderators only.' })); return; }
    const body = await readBody(req).catch(() => ({}));
    const targetId = String(body.userId || '').trim();
    const kind = String(body.kind || 'chat').trim().slice(0, 24) || 'chat';
    const hours = Math.max(1, Math.min(8760, parseInt(body.hours, 10) || 24));
    const reason = String(body.reason || '').trim().slice(0, 200);
    if (!isUuid(targetId)) { res.writeHead(400, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'Invalid user.' })); return; }
    const until = new Date(Date.now() + hours * 3600000).toISOString();
    await supabase.from('user_bans').insert({ user_id: targetId, kind, banned_until: until, reason, created_by: user.id });
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, banned_until: until }));
    return;
  }

  // ── API: mod — lift a ban ─────────────────────────────────────
  if (url.pathname === '/api/mod/unban' && req.method === 'POST') {
    cors(res);
    const user = await requireUser(req, res); if (!user) return;
    if (!(await needVerified(user, res))) return;
    if (!(await isModerator(user.id))) { res.writeHead(403, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'Moderators only.' })); return; }
    const body = await readBody(req).catch(() => ({}));
    const targetId = String(body.userId || '').trim();
    const kind = String(body.kind || 'chat').trim().slice(0, 24) || 'chat';
    if (!isUuid(targetId)) { res.writeHead(400, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'Invalid user.' })); return; }
    await supabase.from('user_bans').delete().eq('user_id', targetId).eq('kind', kind);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true }));
    return;
  }

  // ── API: mod — list active bans for a user ───────────────────
  if (url.pathname === '/api/mod/bans' && req.method === 'GET') {
    cors(res);
    const user = await requireUser(req, res); if (!user) return;
    if (!(await needVerified(user, res))) return;
    if (!(await isModerator(user.id))) { res.writeHead(403, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'Moderators only.' })); return; }
    const uid = (new URL(req.url, 'http://localhost').searchParams.get('userId') || '').trim();
    if (!isUuid(uid)) { res.writeHead(400, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'Invalid user.' })); return; }
    const { data } = await supabase.from('user_bans').select('*').eq('user_id', uid).order('created_at', { ascending: false }).limit(20);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ bans: data || [] }));
    return;
  }

  // ── API: changelog (public read, mod write) ───────────────────
  if (url.pathname === '/api/changelog' && req.method === 'GET') {
    cors(res);
    const { data } = await supabase.from('changelog')
      .select('id, kind, title, body, author_name, created_at, users!changelog_author_id_fkey(display_name)')
      .order('created_at', { ascending: false }).limit(50);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ entries: data || [] }));
    return;
  }

  // ── Update log RSS (public, cached five minutes) ──────────────
  if (url.pathname === '/updlog.xml' && (req.method === 'GET' || req.method === 'HEAD')) {
    const { data } = await supabase.from('changelog')
      .select('id, title, body, created_at')
      .order('created_at', { ascending: false }).limit(50);
    const base = (process.env.SITE_URL || 'https://cudic.vercel.app').replace(/\/$/, '');
    const xml = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]));
    const items = (data || []).map((e) => '<item><title>' + xml(e.title) + '</title><link>' + base + '/updlog#e-' + encodeURIComponent(e.id) + '</link><guid isPermaLink="false">' + xml(e.id) + '</guid><pubDate>' + new Date(e.created_at).toUTCString() + '</pubDate><description>' + xml(e.body || '') + '</description></item>').join('');
    res.writeHead(200, { 'Content-Type': 'application/rss+xml; charset=utf-8', 'Cache-Control': 'public, max-age=300' });
    const rss = '<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel><title>Cudic — Update log</title><link>' + base + '/updlog</link><description>What is new in Cudic.</description><language>en</language>' + items + '</channel></rss>';
    res.end(req.method === 'HEAD' ? undefined : rss);
    return;
  }

if (url.pathname === '/api/changelog' && req.method === 'POST') {
    cors(res);
    const user = await requireUser(req, res); if (!user) return;
    if (!(await needVerified(user, res))) return;
    if (!(await isModerator(user.id))) { res.writeHead(403, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'Moderators only.' })); return; }
    const body = await readBody(req).catch(() => ({}));
    const kind = String(body.kind || 'feature').trim().slice(0, 24) || 'feature';
    const title = String(body.title || '').trim().slice(0, 140);
    const text = String(body.body || '').trim().slice(0, 2000);
    if (!title) { res.writeHead(400, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'Give the entry a title.' })); return; }
    const { data, error } = await supabase.from('changelog').insert({ kind, title, body: text, author_id: user.id }).select().single();
    if (error) { res.writeHead(500, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'Could not post.' })); return; }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, entry: data }));
    return;
  }

  // ── API: file a report (reason required, picture optional) ────
  // Evidence uploads go to the private report-evidence bucket; the client
  // sends the storage path (not a URL) and review happens in the dashboard.
  var REPORT_REASONS = ['inappropriate', 'stolen', 'broken', 'spam', 'other'];

var REPORT_TYPES = ['pack', 'game', 'message', 'user', 'thread', 'comment'];

if (url.pathname === '/api/reports' && req.method === 'POST') {
    cors(res);
    const user = await requireUser(req, res); if (!user) return;
    if (!(await needVerified(user, res))) return;
    const body = await readBody(req).catch(() => ({}));
    if (!rateLimit('report:' + user.id, 20, 3600000)) { res.writeHead(429, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'Too many reports, slow down.' })); return; }
    if (!REPORT_TYPES.includes(body.content_type)) { res.writeHead(400, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'Unknown content.' })); return; }
    if (!REPORT_REASONS.includes(body.reason)) { res.writeHead(400, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'Pick a reason.' })); return; }
    const details = String(body.details || '').trim().substring(0, 1000);
    var contentId = null, contentSlug = null;
    if (body.content_type === 'game') {
      // Game reports (plan.md 2.1): target a published game by id. Owners
      // may also flag their own draft; nobody else can see it to report it.
      const gid = body.content_id;
      if (typeof gid !== 'string' || !isUuid(gid)) { res.writeHead(400, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'Unknown game.' })); return; }
      const { data: repGame } = await supabase.from('games').select('id, published, owner_id').eq('id', gid).single();
      if (!repGame || (!repGame.published && repGame.owner_id !== user.id)) { res.writeHead(404, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'Game not found.' })); return; }
      contentId = repGame.id;
    } else if (body.content_type === 'message') {
      // Message reports (plan.md 2.1): the reporter must be able to see the
      // room the message lives in, so ids can't be used to probe rooms.
      const mid = body.content_id;
      if (typeof mid !== 'string' || !isUuid(mid)) { res.writeHead(400, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'Unknown message.' })); return; }
      const { data: rm } = await supabase.from('messages').select('id, lobby_id, user_id').eq('id', mid).single();
      if (!rm) { res.writeHead(404, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'Message not found.' })); return; }
      const { data: rl } = await supabase.from('lobbies').select('id, name, kind, server_id').eq('id', rm.lobby_id).single();
      if (!rl || !(await canSeeLobby(user.id, rl))) { res.writeHead(404, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'Message not found.' })); return; }
      contentId = rm.id;
    } else if (body.content_type === 'user') {
      // User reports: no self-reports, target must be a real profile.
      const uid = body.content_id;
      if (typeof uid !== 'string' || !isUuid(uid) || uid === user.id) { res.writeHead(400, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'Invalid user.' })); return; }
      const { data: ru } = await supabase.from('users').select('id').eq('id', uid).single();
      if (!ru) { res.writeHead(404, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'User not found.' })); return; }
      contentId = ru.id;
    } else if (body.content_type === 'thread' || body.content_type === 'comment') {
      // Forum posts are public to read, so any signed-in reader can report
      // one. The row must exist — no reporting made-up ids.
      const pid = body.content_id;
      if (typeof pid !== 'string' || !isUuid(pid)) { res.writeHead(400, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'Unknown post.' })); return; }
      const { data: post } = await supabase.from(body.content_type === 'thread' ? 'forum_threads' : 'forum_comments').select('id').eq('id', pid).single();
      if (!post) { res.writeHead(404, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'Post not found.' })); return; }
      contentId = post.id;
    } else if (body.content_id && isUuid(body.content_id)) {
      const pack = await packByKey(body.content_id);
      if (!pack || !pack.published) { res.writeHead(404, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'Pack not found.' })); return; }
      contentId = pack.id;
    } else if (body.content_slug && typeof body.content_slug === 'string') {
      const slug = body.content_slug.substring(0, 60);
      const known = RESERVED_PACK_SLUGS.includes(slug) || await packByKey(slug);
      if (!known) { res.writeHead(404, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'Pack not found.' })); return; }
      contentSlug = slug;
    } else {
      res.writeHead(400, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'Unknown pack.' })); return;
    }
    var evidencePath = null;
    if (body.evidence_path) {
      if (typeof body.evidence_path !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9/_.-]{0,199}$/.test(body.evidence_path)) {
        res.writeHead(400, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'Bad evidence file.' })); return;
      }
      evidencePath = body.evidence_path;
    }
    const { error } = await supabase.from('reports').insert({
      reporter_id: user.id, content_type: body.content_type,
      content_id: contentId, content_slug: contentSlug,
      reason: body.reason, details, evidence_url: evidencePath, status: 'open',
    });
    if (error) { res.writeHead(500, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'Report failed.' })); return; }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true }));
    return;
  }

  // Active (not-yet-expired) chat ban for a user, or null. kind='chat'.
  async function activeBan(userId, kind) {
    if (!userId) return null;
    try {
      const { data } = await supabase.from('user_bans').select('banned_until, reason')
        .eq('user_id', userId).eq('kind', kind || 'chat')
        .order('banned_until', { ascending: false }).limit(1);
      const row = data && data[0];
      if (!row) return null;
      if (new Date(row.banned_until).getTime() <= Date.now()) return null;
      return row;
    } catch { return null; }
  }

  // ── API: my reports (status of things I flagged) ──────────────
  if (url.pathname === '/api/reports/mine' && req.method === 'GET') {
    cors(res);
    const user = await requireUser(req, res); if (!user) return;
    const { data } = await supabase.from('reports')
      .select('id, content_type, content_id, content_slug, reason, details, status, created_at')
      .eq('reporter_id', user.id).order('created_at', { ascending: false }).limit(50);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ reports: data || [] }));
    return;
  }

  // ── API: moderation queue (moderators only) ────────────────────
  if (url.pathname === '/api/reports/queue' && req.method === 'GET') {
    cors(res);
    const user = await requireUser(req, res); if (!user) return;
    if (!(await isModerator(user.id))) { res.writeHead(403, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'Moderators only.' })); return; }
    const status = String(url.searchParams.get('status') || 'open');
    const type = String(url.searchParams.get('type') || '');
    if (!['open', 'reviewing', 'actioned', 'dismissed'].includes(status)) { res.writeHead(400, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'Bad status.' })); return; }
    if (type && !REPORT_TYPES.includes(type)) { res.writeHead(400, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'Bad type.' })); return; }
    let q = supabase.from('reports').select('id, reporter_id, content_type, content_id, content_slug, reason, details, evidence_url, status, created_at').eq('status', status);
    if (type) q = q.eq('content_type', type);
    const { data: reps } = await q.order('created_at', { ascending: false }).limit(50);
    const rows = reps || [];
    // Previews: one scoped query per target kind, joined client-side.
    const gids = [...new Set(rows.filter(r => r.content_type === 'game' && r.content_id).map(r => r.content_id))];
    const mids = [...new Set(rows.filter(r => r.content_type === 'message' && r.content_id).map(r => r.content_id))];
    const uids = [...new Set(rows.filter(r => r.content_type === 'user' && r.content_id).map(r => r.content_id))];
    const pids = [...new Set(rows.filter(r => r.content_type === 'pack' && r.content_id).map(r => r.content_id))];
    const pslugs = [...new Set(rows.filter(r => r.content_type === 'pack' && r.content_slug).map(r => r.content_slug))];
    const rids = [...new Set(rows.map(r => r.reporter_id))];
    const ttids = [...new Set(rows.filter(r => r.content_type === 'thread' && r.content_id).map(r => r.content_id))];
    const ccids = [...new Set(rows.filter(r => r.content_type === 'comment' && r.content_id).map(r => r.content_id))];
    const [games, packsById, packsBySlug, msgs, usrs, reps2, threads, threads2] = await Promise.all([
      gids.length ? supabase.from('games').select('id, title, published').in('id', gids) : Promise.resolve({ data: [] }),
      pids.length ? supabase.from('theme_packs').select('id, slug, name, published').in('id', pids) : Promise.resolve({ data: [] }),
      pslugs.length ? supabase.from('theme_packs').select('id, slug, name, published').in('slug', pslugs) : Promise.resolve({ data: [] }),
      mids.length ? supabase.from('messages').select('id, text, display_name').in('id', mids) : Promise.resolve({ data: [] }),
      uids.length ? supabase.from('users').select('id, display_name').in('id', uids) : Promise.resolve({ data: [] }),
      rids.length ? supabase.from('users').select('id, display_name').in('id', rids) : Promise.resolve({ data: [] }),
      ttids.length ? supabase.from('forum_threads').select('id, title').in('id', ttids) : Promise.resolve({ data: [] }),
      ccids.length ? supabase.from('forum_comments').select('id, text, display_name').in('id', ccids) : Promise.resolve({ data: [] }),
    ]);
    const byId = (arr, key) => { const m = {}; for (const r of (arr && arr.data) || []) m[r[key || 'id']] = r; return m; };
    const gById = byId(games), mById = byId(msgs), uById = byId(usrs), rById = byId(reps2);
    const pById = byId(packsById), pBySlug = byId(packsBySlug, 'slug');
    const tById = byId(threads), cById = byId(threads2);
    const out = rows.map(r => {
      let preview = null;
      if (r.content_type === 'game' && gById[r.content_id]) { const g = gById[r.content_id]; preview = g.title + (g.published ? '' : ' (unpublished)'); }
      else if (r.content_type === 'pack') { const p = (r.content_id && pById[r.content_id]) || (r.content_slug && pBySlug[r.content_slug]); if (p) preview = p.name + (p.published ? '' : ' (unpublished)'); else if (r.content_slug) preview = 'static pack: ' + r.content_slug; }
      else if (r.content_type === 'message' && mById[r.content_id]) { const m = mById[r.content_id]; preview = (m.display_name || '?') + ': ' + String(m.text || '').substring(0, 140); }
      else if (r.content_type === 'user' && uById[r.content_id]) preview = uById[r.content_id].display_name;
      else if (r.content_type === 'thread' && tById[r.content_id]) preview = tById[r.content_id].title;
      else if (r.content_type === 'comment' && cById[r.content_id]) { const c = cById[r.content_id]; preview = (c.display_name || '?') + ': ' + String(c.text || '').substring(0, 140); }
      return { ...r, reporter_name: (rById[r.reporter_id] || {}).display_name || '?', preview };
    });
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ reports: out }));
    return;
  }

  // ── API: resolve a report (moderators only, every action audited) ──
  const modActMatch = /^\/api\/reports\/([^/]+)\/action$/.exec(url.pathname);

if (modActMatch && req.method === 'POST') {
    cors(res);
    const user = await requireUser(req, res); if (!user) return;
    if (!(await needVerified(user, res))) return;
    if (!(await isModerator(user.id))) { res.writeHead(403, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'Moderators only.' })); return; }
    const rid = modActMatch[1];
    if (!isUuid(rid)) { res.writeHead(400, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'Bad report.' })); return; }
    const body = await readBody(req).catch(() => ({}));
    const action = String(body.action || '');
    if (!['dismiss', 'reviewing', 'actioned', 'unpublish', 'delete_message', 'delete_post'].includes(action)) { res.writeHead(400, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'Unknown action.' })); return; }
    const { data: rep } = await supabase.from('reports').select('*').eq('id', rid).single();
    if (!rep) { res.writeHead(404, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'Report not found.' })); return; }
    // Side effects reuse the same state changes as the owner endpoints.
    // Every branch verifies a row actually changed: an update matching
    // zero rows (deleted content, or a static pack with no DB row) must
    // fail loudly, never report success for a no-op.
    async function unpublishBy(table, col, val) {
      const { data } = await supabase.from(table).update({ published: false }).eq(col, val).select('id');
      if (table === 'games' && (data || []).length) gamesListCacheClear();
      return (data || []).length;
    }
    if (action === 'unpublish') {
      let changed = 0, gone = false;
      if (rep.content_type === 'game' && rep.content_id) changed = await unpublishBy('games', 'id', rep.content_id);
      else if (rep.content_type === 'pack' && rep.content_id) changed = await unpublishBy('theme_packs', 'id', rep.content_id);
      else if (rep.content_type === 'pack' && rep.content_slug) {
        changed = await unpublishBy('theme_packs', 'slug', rep.content_slug);
        if (!changed) gone = true;
      }
      else { res.writeHead(400, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'Cannot unpublish that.' })); return; }
      if (!changed) {
        // Slug with no DB row = built-in static pack (ships in public/packs,
        // not the database). It can't be unpublished from here.
        const msg = gone && rep.content_slug
          ? 'Built-in static pack "' + rep.content_slug + '" — remove it from public/packs instead.'
          : 'Content is already gone.';
        res.writeHead(400, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: msg })); return;
      }
    } else if (action === 'delete_message') {
      if (rep.content_type !== 'message' || !rep.content_id) { res.writeHead(400, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'Not a message report.' })); return; }
      const { data: del } = await supabase.from('messages').delete().eq('id', rep.content_id).select('id');
      if (!(del || []).length) { res.writeHead(400, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'Message is already gone.' })); return; }
    } else if (action === 'delete_post') {
      if (!rep.content_id) { res.writeHead(400, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'Not a forum post.' })); return; }
      if (rep.content_type === 'comment') {
        const { data: c } = await supabase.from('forum_comments').select('id, thread_id').eq('id', rep.content_id).single();
        if (!c) { res.writeHead(400, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'Reply is already gone.' })); return; }
        await supabase.from('forum_comments').delete().eq('id', c.id);
        // Keep the thread's reply count honest, same as the owner endpoint.
        const { data: th } = await supabase.from('forum_threads').select('comment_count').eq('id', c.thread_id).single();
        if (th) await supabase.from('forum_threads').update({ comment_count: Math.max(0, (th.comment_count || 1) - 1) }).eq('id', c.thread_id);
      } else if (rep.content_type === 'thread') {
        const { data: del } = await supabase.from('forum_threads').delete().eq('id', rep.content_id).select('id');
        if (!(del || []).length) { res.writeHead(400, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'Thread is already gone.' })); return; }
      } else {
        res.writeHead(400, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'Not a forum post.' })); return;
      }
    }
    const status = action === 'dismiss' ? 'dismissed' : action === 'reviewing' ? 'reviewing' : 'actioned';
    await supabase.from('reports').update({ status }).eq('id', rid);
    await supabase.from('moderation_actions').insert({
      moderator_id: user.id, report_id: rid, content_type: rep.content_type,
      content_id: rep.content_id, action, reason: String(body.reason || '').substring(0, 200),
    });
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, status }));
    return;
  }
  }

  return { handle, matches };
};

function matches(pathname) {
  return pathname.startsWith('/api/mod/') || pathname === '/api/reports' || pathname.startsWith('/api/reports/') || pathname === '/api/changelog' || pathname === '/updlog.xml';
}
