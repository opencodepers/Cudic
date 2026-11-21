/* file: lib/routes/games.js
 * what: game gallery, detail, revisions, scores, achievements, devlog, play and edit routes — extracted verbatim from server.js; routing order is unchanged.
 * invariants: handle() runs only when matches() is true; server.js falls through
 *   when nothing was written (res.headersSent is false). Shared helpers are
 *   injected by the factory, never re-declared here.
 */
module.exports = function createRoutes(deps) {
  const { cors, requireUser, isModerator, supabase, gamesListCacheClear, seatAlive, seatFromReq, seatDead, readBody, crypto, revisionFilesOf, gamesListCache, GAMES_LIST_TTL, liveCount, userOf, hasScope, scopeDenied, needVerified, activeBan, isUuid, notify, playtestValid, defaultThumb, rankRelated, rateLimit, weekStartISO, PLAYTEST_SECRET, playtestSign, siteOrigin, clientIp, logActivity, singleFileBuild, latestRelease, digestWeekStart, awardUser, freeGameSlug, sanitizeTags, copyAssetPrefix, ghToken, ghApi, accountStorageBytes, ACCOUNT_STORAGE_CAP, onPublished, discord, createRelease, forgetStorageUsage } = deps;

  async function handle(req, res, url) {
  // ── API: moderator feature/unfeature a game ─────────────────────
  if (/^\/api\/games\/[^/]+\/feature$/.test(url.pathname) && req.method === 'POST') {
    cors(res);
    const user = await requireUser(req, res); if (!user) return;
    if (!(await isModerator(user.id))) { res.writeHead(403, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'Moderators only.' })); return; }
    const gid = url.pathname.split('/')[3];
    const { data: g } = await supabase.from('games').select('featured').eq('id', gid).single();
    if (!g) { res.writeHead(404, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'Not found' })); return; }
    const next = !g.featured;
    const { data, error } = await supabase.from('games').update({ featured: next, featured_until: next ? new Date(Date.now() + 7 * 864e5).toISOString() : null }).eq('id', gid).select('featured').single();
    if (error) { res.writeHead(500, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'Could not update.' })); return; }
    gamesListCacheClear(); // featured ordering just changed
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ featured: data.featured }));
    return;
  }

if (url.pathname === '/api/games/featured' && req.method === 'GET') {
    cors(res);
    const { data, error } = await supabase.from('games')
      .select('id, title, slug, play_count, featured_until, users!owner_id(display_name, user_id)')
      .eq('published', true).eq('featured', true)
      .order('featured_until', { ascending: false }).limit(8);
    if (error) console.error('featured list error:', error.message);
    res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
    res.end(JSON.stringify({ games: data || [], error: error ? 'Could not load featured games.' : undefined }));
    return;
  }

const revList = url.pathname.match(/^\/api\/games\/([^/]+)\/revisions$/);

const revOne = url.pathname.match(/^\/api\/games\/([^/]+)\/revisions\/([^/]+)(?:\/restore)?$/);

if (revList && req.method === 'POST') {
    cors(res);
    const user = await requireUser(req, res); if (!user) return;
    if (!(await seatAlive(user.id, seatFromReq(req)))) { seatDead(res); return; }
    const gid = revList[1];
    const { data: g } = await supabase.from('games').select('owner_id, files').eq('id', gid).single();
    if (!g || g.owner_id !== user.id) { res.writeHead(404, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'Not found' })); return; }
    const body = await readBody(req, 4 * 1024 * 1024).catch(() => ({}));
    const label = String(body.label || '').trim().substring(0, 80);
    // Staged snapshot (Studio's Save-snapshot checklist): the owner may POST a
    // full files map — staged files at working-tree content, unstaged ones at
    // the previous snapshot's content, so restoring replays "last snapshot +
    // what was staged". Absent or invalid body.files keeps the old behavior:
    // snapshot the saved project row (g.files). Owner-only route, values must
    // be strings, path lengths capped — same shape the client already held.
    let files = g.files || {};
    if (body.files && typeof body.files === 'object' && !Array.isArray(body.files)) {
      const staged = {};
      let ok = true;
      for (const [k, v] of Object.entries(body.files)) {
        if (!k || typeof v !== 'string' || k.length > 300) { ok = false; break; }
        staged[k] = v;
      }
      if (ok) files = staged;
    }
    if (Object.keys(files).length > 500) { res.writeHead(413, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'Project too large to snapshot.' })); return; }
    // Store each distinct file body once and keep path → hash on the revision,
    // so a one-line edit costs one small blob instead of a whole project copy.
    const manifest = {};
    const fresh = new Map();
    for (const [path, text] of Object.entries(files || {})) {
      const hash = crypto.createHash('sha256').update(String(text)).digest('hex').slice(0, 32);
      manifest[path] = hash;
      if (!fresh.has(hash)) fresh.set(hash, text);
    }
    let addressed = false;
    if (fresh.size) {
      const up = await supabase.from('revision_blobs').upsert(
        [...fresh].map(([hash, content]) => ({ game_id: gid, hash, content })),
        { onConflict: 'game_id,hash', ignoreDuplicates: true }
      );
      addressed = !up.error; // no blob table yet -> fall back to a plain copy
    }
    const { data: countRow } = await supabase.from('project_revisions').select('id', { count: 'exact', head: true }).eq('game_id', gid);
    const total = (countRow && countRow.count) || 0;
    const REVISION_CAP = 100; // deep history is cheap now that blobs dedupe
    if (total >= REVISION_CAP) {
      const excess = total - REVISION_CAP + 1;
      const { data: oldestRows } = await supabase.from('project_revisions').select('id')
        .eq('game_id', gid).order('created_at', { ascending: true }).limit(excess);
      for (const row of oldestRows || []) await supabase.from('project_revisions').delete().eq('id', row.id);
    }
    const { data, error } = await supabase.from('project_revisions').insert({
      game_id: gid,
      owner_id: user.id,
      label: label || 'Snapshot ' + new Date().toLocaleString(),
      // `files` is NOT NULL in the original schema: manifest rows carry an empty
      // map there and the real content in revision_blobs + `manifest`.
      files: addressed ? {} : files,
      manifest: addressed ? manifest : null,
    }).select('id, label, created_at').single();
    if (error) { res.writeHead(500, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'Could not snapshot.' })); return; }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ revision: data }));
    return;
  }

if (revList && req.method === 'GET') {
    cors(res);
    const user = await requireUser(req, res); if (!user) return;
    const gid = revList[1];
    const { data: g } = await supabase.from('games').select('owner_id').eq('id', gid).single();
    if (!g || g.owner_id !== user.id) { res.writeHead(404, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'Not found' })); return; }
    const { data: rows } = await supabase.from('project_revisions').select('id, label, created_at').eq('game_id', gid).order('created_at', { ascending: false }).limit(50);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ revisions: rows || [] }));
    return;
  }

  // GET /api/games/:id/revisions/:revId/diff?against=current|prev|<revId>
  // File-level summary for the owner; ?file=<path> returns both bodies so a
  // client can render a real diff without downloading every snapshot.
  const revDiffMatch = /^\/api\/games\/([^/]+)\/revisions\/([^/]+)\/diff$/.exec(url.pathname);

if (revDiffMatch && req.method === 'GET') {
    cors(res);
    const user = await requireUser(req, res); if (!user) return;
    const gid = revDiffMatch[1], revId = revDiffMatch[2];
    const { data: g } = await supabase.from('games').select('owner_id, files').eq('id', gid).single();
    if (!g || g.owner_id !== user.id) { res.writeHead(404, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'Not found' })); return; }
    const { data: target } = await supabase.from('project_revisions').select('*').eq('id', revId).single();
    if (!target || target.owner_id !== user.id) { res.writeHead(404, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'Not found' })); return; }
    const against = String(url.searchParams.get('against') || 'current');
    let baseFiles = null;
    if (against === 'current') {
      baseFiles = g.files || {};
    } else {
      let baseRow = null;
      if (against === 'prev') {
        const { data: rows } = await supabase.from('project_revisions').select('*')
          .eq('game_id', gid).lt('created_at', target.created_at)
          .order('created_at', { ascending: false }).limit(1);
        baseRow = rows && rows[0];
      } else {
        const { data: row } = await supabase.from('project_revisions').select('*')
          .eq('id', against).eq('game_id', gid).single();
        baseRow = row;
      }
      if (!baseRow) { res.writeHead(404, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'Nothing to compare against.' })); return; }
      baseFiles = await revisionFilesOf(baseRow);
    }
    const nextFiles = await revisionFilesOf(target);
    const file = url.searchParams.get('file');
    if (file) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ path: file, before: baseFiles[file] == null ? null : baseFiles[file], after: nextFiles[file] == null ? null : nextFiles[file] }));
      return;
    }
    const paths = [...new Set([...Object.keys(baseFiles || {}), ...Object.keys(nextFiles || {})])].sort();
    const changes = [];
    for (const p of paths) {
      const a = baseFiles[p], b = nextFiles[p];
      if (a === b) continue;
      changes.push({
        path: p,
        status: a == null ? 'added' : b == null ? 'removed' : 'changed',
        before_bytes: a == null ? 0 : Buffer.byteLength(a),
        after_bytes: b == null ? 0 : Buffer.byteLength(b),
      });
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      from: against,
      to: revId,
      files: changes,
      counts: {
        added: changes.filter((c) => c.status === 'added').length,
        removed: changes.filter((c) => c.status === 'removed').length,
        changed: changes.filter((c) => c.status === 'changed').length,
      },
    }));
    return;
  }

if (revOne) {
    const gid = revOne[1], revId = revOne[2];
    const restore = /\/restore$/.test(url.pathname);
    if (req.method === 'GET' || (req.method === 'POST' && restore)) {
      cors(res);
      const user = await requireUser(req, res); if (!user) return;
      const { data: rev } = await supabase.from('project_revisions').select('*').eq('id', revId).single();
      // Both ids are attacker-controlled: the revision has to belong to this
      // user AND to the game in the path. Checking only the revision let a
      // user restore their own snapshot into somebody else's project.
      if (!rev || rev.owner_id !== user.id || rev.game_id !== gid) { res.writeHead(404, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'Not found' })); return; }
      if (restore) {
        const { data: own } = await supabase.from('games').select('owner_id').eq('id', gid).single();
        if (!own || own.owner_id !== user.id) { res.writeHead(404, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'Not found' })); return; }
        const restored = await revisionFilesOf(rev);
        await supabase.from('games').update({ files: restored, updated_at: new Date().toISOString() }).eq('id', gid).eq('owner_id', user.id);
        gamesListCacheClear(); // updated_at shifts the gallery ordering
        res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ ok: true })); return;
      }
      const full = await revisionFilesOf(rev);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ revision: { ...rev, files: full } }));
      return;
    }
    if (req.method === 'DELETE') {
      cors(res);
      const user = await requireUser(req, res); if (!user) return;
      // A revision id is not permission: without this check anyone signed in
      // could delete another creator's history, including a live release.
      const { data: rev } = await supabase.from('project_revisions').select('id, owner_id').eq('id', revId).single();
      if (!rev || rev.owner_id !== user.id) { res.writeHead(404, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'Not found' })); return; }
      await supabase.from('project_revisions').delete().eq('id', revId).eq('owner_id', user.id);
      res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ ok: true }));
      return;
    }
  }

  // ── API: list published games ──────────────────────────────────
  // ?q= searches title/description/tags, ?tag= filters one tag, ?sort=
  // new|old|az|plays. Cap stays 50: the gallery is a browse surface, and
  // a search that matches nothing is better than an endless list.
  if (url.pathname === '/api/games' && req.method === 'GET') {
    cors(res);
    const q = String(url.searchParams.get('q') || '').trim().slice(0, 60);
    const tag = String(url.searchParams.get('tag') || '').trim().toLowerCase().slice(0, 24);
    const sort = String(url.searchParams.get('sort') || 'new');
    const trending = sort === 'trending';
    // Pagination: offset is the only paging knob (size stays 50).
    const offset = Math.max(0, parseInt(String(url.searchParams.get('offset') || '0'), 10) || 0);
    // Gallery cache: the rows page, its like counts and the tag vocabulary
    // are identical for every viewer, so they're memoized for 30s keyed by
    // sort|q|tag|offset (every gallery-affecting write calls
    // gamesListCacheClear()). Without the cache each gallery hit did a rows
    // query, a 200-row tag scan and a like-count query against Supabase;
    // only the viewer's own like markers stay per-request.
    let error = null, counts = {}, tags = [];
    let rows = [];
    const ckey = `${sort}|${q}|${tag}|${offset}`;
    let cached = gamesListCache.get(ckey);
    if (!cached || Date.now() - cached.at > GAMES_LIST_TTL) cached = null;
    if (cached) {
      rows = cached.rows; counts = cached.counts; tags = cached.tags;
    } else {
      let query = supabase
        .from('games')
        .select('id, title, description, credits, thumbnail, tags, play_count, owner_id, forked_from, forked_from_title, created_at, updated_at, users!owner_id(display_name, user_id, avatar_url)')
        .eq('published', true);
      if (q) {
        const like = '%' + q.replace(/[%_\\,()]/g, '') + '%';
        query = query.or(`title.ilike.${like},description.ilike.${like}`);
      }
      if (tag) query = query.contains('tags', [tag]);
      if (sort === 'plays') query = query.order('play_count', { ascending: false }).order('updated_at', { ascending: false });
      else if (trending) query = query.order('play_count', { ascending: false });
      else if (sort === 'old') query = query.order('created_at', { ascending: true });
      else if (sort === 'az') query = query.order('title', { ascending: true });
      else query = query.order('featured', { ascending: false }).order('updated_at', { ascending: false });
      const { data, error: listErr } = await query.range(offset, offset + 49);
      rows = data || [];
      error = listErr;
      const ids = rows.map((g) => g.id);
      // Tag vocabulary + like counts: two small queries scoped to the rows
      // we just returned (never the whole table), run in parallel.
      const [tagsRes, likesRes] = await Promise.all([
        supabase.from('games').select('tags').eq('published', true).limit(200),
        ids.length === 0 ? Promise.resolve({ data: [] }) : supabase.from('game_likes').select('game_id').in('game_id', ids),
      ]);
      for (const l of likesRes.data || []) counts[l.game_id] = (counts[l.game_id] || 0) + 1;
      tags = [...new Set((tagsRes.data || []).flatMap((g) => g.tags || []))].sort();
      // Bound memory: entries stay ~50KB (50 rows, thumbnails stripped) no
      // matter how big the gallery gets, but keys are user-driven (searches),
      // so cap the Map — evict everything rather than track LRU.
      if (gamesListCache.size > 100) gamesListCache.clear();
      gamesListCache.set(ckey, { at: Date.now(), rows, counts, tags });
    }
    // Trending = plays against age: total plays weighted down by how many
    // hours the game has existed, so a fresh game with a few plays can outrank
    // an old one coasting on history. (age + 2) keeps brand-new games from
    // dividing by zero and gives a few hours of grace. Deterministic given
    // the rows, so recomputing per request costs nothing.
    if (trending) {
      const nowMs = Date.now();
      const score = (g) => (g.play_count || 0) / Math.pow((nowMs - new Date(g.created_at).getTime()) / 3600000 + 2, 1.5);
      rows.sort((a, b) => score(b) - score(a));
    }
    if (error) console.error('games list error:', error.message);
    const ids = rows.map((g) => g.id);
    const liked = new Set();
    const token = (req.headers.authorization || '').replace('Bearer ', '');
    if (token && ids.length > 0) {
      const { data: { user } } = await supabase.auth.getUser(token);
      if (user) {
        const { data: mine } = await supabase.from('game_likes').select('game_id').eq('user_id', user.id).in('game_id', ids);
        for (const l of mine || []) liked.add(l.game_id);
      }
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    // Thumbnails are ~40KB data URLs each; a 50-game page would be megabytes.
    // Ship a flag instead and let the browser fetch image bytes from
    // /api/games/:id/thumbnail (cached a day) per card it actually shows.
    res.end(JSON.stringify({
      games: rows.map(({ thumbnail, ...g }) => ({ ...g, has_thumb: true, likes: counts[g.id] || 0, liked: liked.has(g.id), playing: liveCount(g.id) })),
      tags,
      error: error ? 'Could not load games.' : undefined
    }));
    return;
  }

  // ── API: tag vocabulary (gallery chips, no game list) ──────────
  if (url.pathname === '/api/game-tags' && req.method === 'GET') {
    cors(res);
    const { data } = await supabase.from('games').select('tags').eq('published', true).limit(200);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ tags: [...new Set((data || []).flatMap((g) => g.tags || []))].sort() }));
    return;
  }

  // ── API: recently played ─────────────────────────────────────────
  // Backs the gallery's "Continue playing" shelf: the games this account last
  // opened, newest first. Published only — unpublishing a game hides it from
  // the shelf the same way it hides it from the gallery. Reads game_plays,
  // which POST /api/games/:id/play fills. Before that migration runs the table
  // is missing, so this answers with an empty shelf instead of a 500 and the
  // page simply shows nothing.
  if (url.pathname === '/api/games/continue' && req.method === 'GET') {
    cors(res);
    const user = await userOf(req);
    if (!user) { res.writeHead(401, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'Unauthorized' })); return; }
    const { data: rows } = await supabase
      .from('game_plays')
      .select('played_at, games!inner(id, title, description, thumbnail, tags, play_count, owner_id, forked_from, forked_from_title, created_at, updated_at, users!owner_id(display_name, user_id, avatar_url))')
      .eq('user_id', user.id)
      .eq('games.published', true)
      .order('played_at', { ascending: false })
      .limit(8);
    const games = (rows || []).map(r => {
      const g = Array.isArray(r.games) ? r.games[0] : r.games;
      return g ? { ...g, played_at: r.played_at } : null;
    }).filter(Boolean);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ games }));
    return;
  }

if (url.pathname === '/api/games/mine' && req.method === 'GET') {
    cors(res);
    const user = await userOf(req);
    if (!user) { res.writeHead(401); res.end(); return; }
    if (!hasScope(user, 'projects:read')) { scopeDenied(res, 'projects:read'); return; }
    const { data } = await supabase.from('games').select('id, title, description, thumbnail, published, forked_from, forked_from_title, created_at, updated_at').eq('owner_id', user.id).order('updated_at', { ascending: false });
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ games: (data || []).map(({ thumbnail, ...g }) => ({ ...g, has_thumb: true })) }));
    return;
  }

  // ── API: list game comments ──────────────────────────────────
  if (/^\/api\/games\/[^/]+\/comments$/.test(url.pathname) && req.method === 'GET') {
    cors(res);
    const id = url.pathname.split('/')[3];
    // parent_id arrived with the replies migration; a database that has not run
    // it yet still serves flat comments instead of an error or an empty list.
    let { data, error } = await supabase.from('game_comments')
      .select('id, text, created_at, user_id, display_name, parent_id')
      .eq('game_id', id).order('created_at', { ascending: true }).limit(200);
    if (error) {
      ({ data } = await supabase.from('game_comments')
        .select('id, text, created_at, user_id, display_name')
        .eq('game_id', id).order('created_at', { ascending: true }).limit(200));
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ comments: data || [] }));
    return;
  }

  // ── API: post game comment ───────────────────────────────────
  if (/^\/api\/games\/[^/]+\/comments$/.test(url.pathname) && req.method === 'POST') {
    cors(res);
    const authHeader = req.headers.authorization || '';
    const token = authHeader.replace('Bearer ', '');
    if (!token) { res.writeHead(401, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'Unauthorized' })); return; }
    const { data: { user }, error: authErr } = await supabase.auth.getUser(token);
    if (authErr || !user) { res.writeHead(401, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'Unauthorized' })); return; }
    if (!(await needVerified(user, res))) return;
    const id = url.pathname.split('/')[3];
    const body = await readBody(req);
    const text = (body.text || '').trim().substring(0, 2000);
    if (!text) { res.writeHead(400, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'Empty comment' })); return; }
    const cban = await activeBan(user.id, 'chat');
    if (cban) { res.writeHead(403, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'You are muted from commenting until ' + new Date(cban.banned_until).toLocaleString() + (cban.reason ? ' — ' + cban.reason : '') + '.' })); return; }
    const { data: prof } = await supabase.from('users').select('display_name').eq('id', user.id).single();
    const name = (prof && prof.display_name) || 'Unknown';
    // A reply names the comment it answers, but only after checking that the
    // comment belongs to this same game: a parent id from another thread is
    // dropped and the comment posts at the top level instead of being trusted.
    const rawParent = String(body.parentId || '').trim();
    let parent = null;
    if (isUuid(rawParent)) {
      const { data: p } = await supabase.from('game_comments')
        .select('id, user_id, game_id')
        .eq('id', rawParent).maybeSingle();
      if (p && p.game_id === id) parent = p;
    }
    const row = { game_id: id, user_id: user.id, display_name: name, text };
    if (parent) row.parent_id = parent.id;
    let { data, error } = await supabase.from('game_comments').insert(row).select().single();
    if (error && parent) {
      // No parent_id column yet: keep the comment, lose only the nesting.
      delete row.parent_id;
      ({ data, error } = await supabase.from('game_comments').insert(row).select().single());
    }
    if (error) console.error('comment insert error:', error.message);
    if (data && data.id) {
      if (parent && parent.user_id && parent.user_id !== user.id) {
        await notify(parent.user_id, 'reply', 'New reply to your comment',
          name + ' replied: ' + text.substring(0, 100), 'game', id);
      }
      const { data: game } = await supabase.from('games').select('owner_id').eq('id', id).single();
      if (game && game.owner_id && game.owner_id !== user.id) {
        await notify(game.owner_id, 'comment', 'New comment on your game',
          name + ' commented: ' + text.substring(0, 100), 'game', id);
      }
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ comment: data, error: error ? 'Could not post the comment.' : undefined }));
    return;
  }

  // ── API: game thumbnail as a real URL ────────────────────────
  // Stored as a data: URL (unusable by link scrapers); this serves real bytes.
  // Must stay above the generic /api/games/:id GET below, which would swallow it.
  if (/^\/api\/games\/[^/]+\/thumbnail$/.test(url.pathname) && req.method === 'GET') {
    cors(res);
    const id = url.pathname.split('/')[3];
    const { data } = await supabase.from('games').select('thumbnail, published, owner_id').eq('id', id).single();
    // Same rule as the game body: draft thumbnails ship to their owner or a
    // valid playtest link only.
    const ptToken = new URLSearchParams(url.search).get('playtest') || '';
    if (data && !data.published && !playtestValid(id, ptToken)) {
      const tok = (req.headers.authorization || '').replace('Bearer ', '');
      const { data: { user: viewer } } = tok ? await supabase.auth.getUser(tok) : { data: { user: null } };
      if (!viewer || data.owner_id !== viewer.id) {
        res.writeHead(404, { 'Content-Type': 'text/plain' }); res.end('Not found'); return;
      }
    }
    if (!data) { res.writeHead(404, { 'Content-Type': 'text/plain' }); res.end('Not found'); return; }
    // No upload yet → the shared default card, not a 404. Callers put this URL
    // straight into an <img> (gallery, arcade, Studio picker), so a 404 here is
    // a blank card there.
    const m = typeof data.thumbnail === 'string'
      ? /^data:(image\/[a-z0-9.+-]+);base64,([A-Za-z0-9+/=]+)$/i.exec(data.thumbnail) : null;
    const buf = m ? Buffer.from(m[2], 'base64') : defaultThumb();
    res.writeHead(200, {
      'Content-Type': m ? m[1] : defaultThumb.TYPE,
      'Content-Length': buf.length,
      'Cache-Control': 'public, max-age=86400'
    });
    res.end(buf);
    return;
  }

  // ── API: games this account liked ───────────────────────────────
  // Must stay above the generic /api/games/:id GET below, which would swallow it.
  if (url.pathname === '/api/games/liked' && req.method === 'GET') {
    cors(res);
    const authHeader = req.headers.authorization || '';
    const token = authHeader.replace('Bearer ', '');
    if (!token) { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ games: [] })); return; }
    const { data: { user } } = await supabase.auth.getUser(token);
    if (!user) { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ games: [] })); return; }
    const { data: rows } = await supabase
      .from('game_likes')
      .select('game_id, created_at, games!inner(id, title, description, thumbnail, tags, play_count, users!owner_id(display_name))')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(50);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ games: (rows || []).map((r) => r.games).filter((g) => g && g.id).map(({ thumbnail, ...g }) => ({ ...g, has_thumb: true, likes: 1 })) }));
    return;
  }

  // ── API: get single game ───────────────────────────────────────
  // Just the live room count — the game page polls this while it is open, so
  // the "playing now" pill is not a page-load snapshot. Must stay above the
  // generic /api/games/:id GET below, which would swallow it. No auth: it
  // reads an in-memory number and stores nothing.
  if (url.pathname.startsWith('/api/games/') && url.pathname.endsWith('/live') && req.method === 'GET') {
    cors(res);
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify({ playing: liveCount(url.pathname.split('/')[3]) }));
    return;
  }

  // ── API: related games (More from this creator / More like this) ─
  // Two shelves on the game page, one request: the maker's other published
  // games, plus published games sharing at least one tag. Both are public
  // data and thumbnail-free (has_thumb flag like the gallery list) so the
  // shelf never ships ~40KB data URLs. Must stay above the generic
  // /api/games/:id GET below, which would otherwise read "/related" as id.
  if (/^\/api\/games\/[^/]+\/related$/.test(url.pathname) && req.method === 'GET') {
    cors(res);
    const rid = url.pathname.split('/')[3];
    if (!isUuid(rid)) { res.writeHead(400, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'Invalid game.' })); return; }
    const { data: g } = await supabase.from('games').select('published, owner_id, tags, description').eq('id', rid).single();
    if (!g || !g.published) { res.writeHead(404, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'Not found' })); return; }
    const shelf = 'id, title, play_count, users!owner_id(display_name, user_id)';
    const [creatorRes, poolRes] = await Promise.all([
      supabase.from('games').select(shelf)
        .eq('published', true).eq('owner_id', g.owner_id).neq('id', rid)
        .order('updated_at', { ascending: false }).limit(6),
      // Ranked in memory instead of one `overlaps` filter: shared tags first,
      // then wording that describes the mechanics, then most played as the
      // floor — so a game nobody tagged still gets a shelf. Bounded pool keeps
      // the round trip cheap.
      supabase.from('games')
        .select('id, title, description, tags, play_count, owner_id, forked_from, users!owner_id(display_name, user_id)')
        .eq('published', true).neq('id', rid)
        .order('play_count', { ascending: false }).limit(200)
    ]);
    // The card needs art, and /g/<id>/thumb always answers with one (the shared
    // default cover when the game has none), so the shelf ships a URL instead of
    // the ~40KB base64 thumbnail this route deliberately avoids.
    const shape = (rows) => (rows || []).map((r) => ({
      id: r.id, title: r.title, play_count: r.play_count || 0,
      name: (r.users && r.users.display_name) || 'Unknown', user_id: (r.users && r.users.user_id) || null,
      thumb: '/g/' + encodeURIComponent(r.id) + '/thumb'
    }));
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    const similar = rankRelated({ id: rid, owner_id: g.owner_id, description: g.description, tags: g.tags }, poolRes.data, { limit: 6 });
    res.end(JSON.stringify({ by_creator: shape(creatorRes.data), similar: shape(similar.map((r) => r.game)) }));
    return;
  }

  // ── API: remixes of a game (remix tree shelf) ─────────────────────
  // PUBLIC read-only: every published game that forked this one. Data
  // already exists ('forked_from' + the cached title); this only surfaces
  // it, so the original maker SEES who built on their work — the loop
  // Scratch proved drives creators to keep going. Above the generic :id GET.
  if (/^\/api\/games\/[^/]+\/remixes$/.test(url.pathname) && req.method === 'GET') {
    cors(res);
    const rid = url.pathname.split('/')[3];
    if (!isUuid(rid)) { res.writeHead(400, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'Invalid game.' })); return; }
    const { data: g } = await supabase.from('games').select('published').eq('id', rid).single();
    if (!g || !g.published) { res.writeHead(404, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'Not found' })); return; }
    const { data: rows } = await supabase.from('games')
      .select('id, title, play_count, updated_at, users!owner_id(display_name, user_id)')
      .eq('published', true).eq('forked_from', rid)
      .order('updated_at', { ascending: false }).limit(24);
    const remixes = (rows || []).map((r) => ({
      id: r.id, title: r.title, play_count: r.play_count || 0, updated_at: r.updated_at,
      name: (r.users && r.users.display_name) || 'Unknown', user_id: (r.users && r.users.user_id) || null
    }));
    // One level up: what this game itself forked from (read-only chain tip).
    let parent = null;
    const { data: me0 } = await supabase.from('games').select('forked_from, forked_from_title').eq('id', rid).single();
    if (me0 && me0.forked_from) parent = { id: me0.forked_from, title: me0.forked_from_title || 'Untitled' };
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify({ remixes, parent }));
    return;
  }

  // ── API: invite a friend into a multiplayer room ───────────────────
  // POST /api/games/:id/invite { friend_id, room } — writes a single
  // notification; the recipient deep-links view.html?id=..&room=<code>.
  // The room join itself stays anonymous/guest-open (CudicMulti rules);
  // this only carries the invite, gated + rate-limited like follows.
  if (/^\/api\/games\/[^/]+\/invite$/.test(url.pathname) && req.method === 'POST') {
    cors(res);
    const user = await requireUser(req, res); if (!user) return;
    if (!(await needVerified(user, res))) return;
    if (!rateLimit('invite:' + user.id, 10, 3600 * 1000)) { res.writeHead(429, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'Too many invites. Try later.' })); return; }
    const gid = url.pathname.split('/')[3];
    if (!isUuid(gid)) { res.writeHead(400, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'Invalid game.' })); return; }
    const body = await readBody(req).catch(() => ({}));
    const fid = String((body && body.friend_id) || '').trim();
    const room = String((body && body.room) || 'main').replace(/[^a-zA-Z0-9_-]/g, '').substring(0, 40) || 'main';
    if (!isUuid(fid)) { res.writeHead(400, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'Pick who to invite.' })); return; }
    // Must actually be an accepted friend — a public game id alone cannot
    // be used to point notifications at arbitrary accounts.
    let isFriend = false;
    for (const row of (await Promise.all([
      supabase.from('friendships').select('user_id').eq('status', 'accepted').eq('user_id', user.id).eq('friend_id', fid),
      supabase.from('friendships').select('user_id').eq('status', 'accepted').eq('friend_id', user.id).eq('user_id', fid)
    ]))) { if (row.data && row.data.length) isFriend = true; }
    if (!isFriend) { res.writeHead(403, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'Invite your friends, not strangers.' })); return; }
    const { data: g } = await supabase.from('games').select('title, published').eq('id', gid).single();
    if (!g || !g.published) { res.writeHead(404, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'Not found' })); return; }
    const { data: profile } = await supabase.from('users').select('display_name').eq('id', user.id).single();
    notify(fid, 'invite', (profile && profile.display_name) || 'A friend', 'You are invited to the room "' + room + '" in ' + (g.title || 'a game') + '.', 'game', gid);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true }));
    return;
  }

  // ── API: game leaderboard (best score per player) ──────────────────
  // GET is public: the board shows on the game page for everyone, guests
  // included. POST is signed-in (seat-checked) only — there is no identity
  // to bind a guest score to. One row per (game, player): a replay never
  // lowers your best, and spam can't flood the board.
  // Must stay above the generic /api/games/:id GET below, which would
  // otherwise read ".../scores" as a game id.
  const scoreMatch = /^\/api\/games\/([^/]+)\/scores$/.exec(url.pathname);

if (scoreMatch && (req.method === 'GET' || req.method === 'POST')) {
    cors(res);
    const gid = scoreMatch[1];
    if (!isUuid(gid)) { res.writeHead(400, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'Invalid game.' })); return; }
    const { data: g } = await supabase.from('games').select('published, owner_id').eq('id', gid).single();
    if (req.method === 'GET') {
      if (!g || !g.published) { res.writeHead(404, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'Not found' })); return; }
      const lim = Math.min(Math.max(Number(new URLSearchParams(url.search).get('limit')) || 10, 1), 50);
      const range = String(new URLSearchParams(url.search).get('range') || 'all');
      // Filters chain only after .select() in supabase-js, so the week
      // condition is added to the builder rather than before it.
      let scoreQuery = supabase
        .from('game_scores')
        .select('score, updated_at, users!game_scores_user_id_fkey(display_name)')
        .eq('game_id', gid);
      if (range === 'week') scoreQuery = scoreQuery.gte('updated_at', weekStartISO() + 'T00:00:00.000Z');
      const { data: rows } = await scoreQuery
        .order('score', { ascending: false })
        .order('updated_at', { ascending: true })
        .limit(lim);
      // Names only leave the door — user ids never appear on a public board.
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify({
        scores: (rows || []).map((r) => ({ score: r.score, name: (r.users && r.users.display_name) || 'Player', at: r.updated_at }))
      }));
      return;
    }
    // POST — signed-in + seat-alive. Verified-check matches like/rate.
    const authHeader = req.headers.authorization || '';
    const token = authHeader.replace('Bearer ', '');
    if (!token) { res.writeHead(401, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'Unauthorized' })); return; }
    const { data: { user }, error: authErr } = await supabase.auth.getUser(token);
    if (authErr || !user) { res.writeHead(401, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'Unauthorized' })); return; }
    if (!(await seatAlive(user.id, seatFromReq(req)))) { seatDead(res); return; }
    if (!(await needVerified(user, res))) return;
    if (!g || !(g.published || g.owner_id === user.id)) { res.writeHead(404, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'Not found' })); return; }
    const body = await readBody(req).catch(() => ({}));
    const score = Math.floor(Number(body.score));
    // Bounded on purpose: scores are ints inside int4, and NaN/Infinity
    // must never reach the column.
    if (!Number.isFinite(score) || score < 0 || score > 2147483647) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Score must be a number from 0 to 2147483647.' }));
      return;
    }
    // Cheap read-then-write instead of an rpc: only overwrite when the new
    // run beats the stored one. Two writers racing here both keep a valid
    // best, so no lock is worth it at this scale.
    const { data: prev } = await supabase.from('game_scores')
      .select('score').eq('game_id', gid).eq('user_id', user.id).maybeSingle();
    if (prev != null && prev.score >= score) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, kept: true, best: prev.score }));
      return;
    }
    const { error } = await supabase.from('game_scores')
      .upsert({ game_id: gid, user_id: user.id, score, updated_at: new Date().toISOString() }, { onConflict: 'game_id,user_id' });
    if (error) { res.writeHead(500, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'Could not save the score.' })); return; }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, best: score }));
    return;
  }

  // ── In-game achievements (cudic-ach.js) ──────────────────────
  // Same sandbox shape as scores: the frame never holds the token, view.html
  // mediates with the viewer's session. unlock() writes one row per
  // (game, player, code); GET is a public read of what exists.
  if (/^\/api\/games\/[^/]+\/achievements$/.test(url.pathname) && req.method === 'GET') {
    cors(res);
    const gid = url.pathname.split('/')[3];
    if (!isUuid(gid)) { res.writeHead(400, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'Invalid game.' })); return; }
    const { data: g } = await supabase.from('games').select('published').eq('id', gid).single();
    if (!g || !g.published) { res.writeHead(404, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'Not found' })); return; }
    const { data: rows } = await supabase.from('game_achievements')
      .select('code, user_id').eq('game_id', gid).limit(5000);
    const counts = {};
    for (const r of rows || []) counts[r.code] = (counts[r.code] || 0) + 1;
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify({
      // Codes + holder counts, names-length never ids — public data rules
      // match the leaderboard's (user ids never leave the door).
      achievements: Object.keys(counts).sort().map((code) => ({ code, count: counts[code] }))
    }));
    return;
  }

if (/^\/api\/games\/[^/]+\/achievements$/.test(url.pathname) && req.method === 'POST') {
    cors(res);
    const authHeader = req.headers.authorization || '';
    const token = authHeader.replace('Bearer ', '');
    if (!token) { res.writeHead(401, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'Unauthorized' })); return; }
    const { data: { user }, error: authErr } = await supabase.auth.getUser(token);
    if (authErr || !user) { res.writeHead(401, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'Unauthorized' })); return; }
    if (!(await seatAlive(user.id, seatFromReq(req)))) { seatDead(res); return; }
    if (!(await needVerified(user, res))) return;
    const gid = url.pathname.split('/')[3];
    if (!isUuid(gid)) { res.writeHead(400, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'Invalid game.' })); return; }
    const { data: g } = await supabase.from('games').select('published, owner_id').eq('id', gid).single();
    if (!g || !(g.published || g.owner_id === user.id)) { res.writeHead(404, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'Not found' })); return; }
    if (!rateLimit('ach:' + user.id, 30, 60000)) { res.writeHead(429, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'Slow down.' })); return; }
    const body = await readBody(req).catch(() => ({}));
    // Codes are short slugs the game invents — not free text. Lock the
    // charset so nothing weird can ride into the key or a display name.
    const code = String(body.code || '').trim();
    if (!/^[a-z0-9][a-z0-9_-]{0,31}$/.test(code)) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Code must be 1-32 chars: lowercase letters, numbers, dash, underscore.' }));
      return;
    }
    const { data: existing } = await supabase.from('game_achievements')
      .select('awarded_at').eq('game_id', gid).eq('user_id', user.id).eq('code', code).maybeSingle();
    if (existing) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, first: false, at: existing.awarded_at }));
      return;
    }
    const { error: insErr } = await supabase.from('game_achievements')
      .insert({ game_id: gid, user_id: user.id, code, awarded_at: new Date().toISOString() });
    if (insErr) {
      // Lost a race with another tab unlocking the same thing: fine, it exists.
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, first: false }));
      return;
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, first: true }));
    return;
  }

  // ── API: playtest links (drafts shared by a signed, expiring URL) ──
  // The link is the credential. Minting is owner-only; playing and feedback
  // need nothing but a valid token, so testers do not need an account.
  if (/^\/api\/games\/[^/]+\/playtest$/.test(url.pathname) && req.method === 'POST') {
    cors(res);
    const user = await requireUser(req, res); if (!user) return;
    if (!(await seatAlive(user.id, seatFromReq(req)))) { seatDead(res); return; }
    if (!(await needVerified(user, res))) return;
    const gid = url.pathname.split('/')[3];
    if (!isUuid(gid)) { res.writeHead(400, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'Invalid game.' })); return; }
    const { data: g } = await supabase.from('games').select('owner_id').eq('id', gid).single();
    if (!g) { res.writeHead(404, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'Not found' })); return; }
    if (g.owner_id !== user.id) { res.writeHead(403, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'Only the creator can make a playtest link.' })); return; }
    if (!PLAYTEST_SECRET) { res.writeHead(503, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'Playtest links need PLAYTEST_SECRET or a service key.' })); return; }
    const body = await readBody(req).catch(() => ({}));
    const days = Math.max(1, Math.min(30, Math.floor(Number(body.days)) || 7));
    const made = playtestSign(gid, days);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      ok: true, token: made.token, days,
      expires_at: new Date(made.exp * 1000).toISOString(),
      url: siteOrigin(req) + '/view.html?id=' + encodeURIComponent(gid) + '&playtest=' + encodeURIComponent(made.token)
    }));
    return;
  }

if (/^\/api\/games\/[^/]+\/playtest\/feedback$/.test(url.pathname) && req.method === 'POST') {
    cors(res);
    const gid = url.pathname.split('/')[3];
    if (!isUuid(gid)) { res.writeHead(400, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'Invalid game.' })); return; }
    const body = await readBody(req).catch(() => ({}));
    if (!playtestValid(gid, body.token)) { res.writeHead(403, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'This playtest link is invalid or expired.' })); return; }
    const name = String(body.name || '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, 40) || 'A playtester';
    const text = String(body.text || '').trim().slice(0, 2000);
    if (text.length < 2) { res.writeHead(400, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'Write a little feedback first.' })); return; }
    if (!rateLimit('playtestfb:' + clientIp(req), 8, 600000)) { res.writeHead(429, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'Slow down a little.' })); return; }
    const { data: g } = await supabase.from('games').select('owner_id, title').eq('id', gid).single();
    if (!g) { res.writeHead(404, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'Not found' })); return; }
    const { error } = await supabase.from('game_posts').insert({ game_id: gid, body: text, kind: 'feedback', author_name: name });
    if (error) { res.writeHead(500, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'Could not save feedback.' })); return; }
    if (g.owner_id) notify(g.owner_id, 'comment', name + ' sent playtest feedback', text.slice(0, 180), 'game', gid).catch(() => {});
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true }));
    return;
  }

  // ── API: game devlog posts (feature 7) ────────────────────────
  // Markdown posts owned by a game: GET is public on published games,
  // POST is the creator (limit 5/game, rate-limited), DELETE is the
  // author. Events ride the existing activity feed via postEvent.
  const devlogMatch = url.pathname.match(/^\/api\/games\/([^/]+)\/devlog(?:\/([^/]+))?$/);

if (devlogMatch && req.method === 'GET') {
    cors(res);
    const gid = devlogMatch[1];
    if (!isUuid(gid)) { res.writeHead(400, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'Invalid game.' })); return; }
    const wantFeedback = new URLSearchParams(url.search).get('feedback') === '1';
    const { data: g } = await supabase.from('games').select('published, owner_id').eq('id', gid).single();
    if (!g) { res.writeHead(404, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'Not found' })); return; }
    if (wantFeedback) {
      const viewer = await userOf(req);
      if (!viewer || g.owner_id !== viewer.id) { res.writeHead(403, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'Not your game.' })); return; }
    } else if (!g.published) {
      const viewer = await userOf(req);
      if (!viewer || g.owner_id !== viewer.id) { res.writeHead(404, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'Not found' })); return; }
    }
    const { data: rows } = await supabase.from('game_posts')
      .select('id, body, created_at, author_name')
      .eq('game_id', gid)
      .eq('kind', wantFeedback ? 'feedback' : 'post')
      .order('created_at', { ascending: false })
      .limit(wantFeedback ? 20 : 50);
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify({ posts: rows || [] }));
    return;
  }

if (devlogMatch && !devlogMatch[2] && req.method === 'POST') {
    cors(res);
    const authHeader = req.headers.authorization || '';
    const token = authHeader.replace('Bearer ', '');
    if (!token) { res.writeHead(401, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'Unauthorized' })); return; }
    const { data: { user }, error: authErr } = await supabase.auth.getUser(token);
    if (authErr || !user) { res.writeHead(401, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'Unauthorized' })); return; }
    if (!(await seatAlive(user.id, seatFromReq(req)))) { seatDead(res); return; }
    if (!(await needVerified(user, res))) return;
    const gid = devlogMatch[1];
    if (!isUuid(gid)) { res.writeHead(400, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'Invalid game.' })); return; }
    const { data: g } = await supabase.from('games').select('published, owner_id').eq('id', gid).single();
    if (!g || g.owner_id !== user.id) { res.writeHead(404, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'Not found' })); return; }
    if (!rateLimit('devlog:' + user.id, 10, 60000)) { res.writeHead(429, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'Slow down.' })); return; }
    const body = await readBody(req).catch(() => ({}));
    const text = String(body.body || '').trim();
    if (!text || text.length > 8000) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Body must be 1 to 8000 characters.' }));
      return;
    }
    const { count } = await supabase.from('game_posts').select('id', { count: 'exact', head: true }).eq('game_id', gid).eq('kind', 'post');
    if ((count || 0) >= 5) {
      res.writeHead(409, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'This game already has 5 posts — delete one first.' }));
      return;
    }
    const { data: post, error } = await supabase.from('game_posts')
      .insert({ game_id: gid, body: text, kind: 'post' }).select('id, body, created_at').single();
    if (error) { res.writeHead(500, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'Could not save the post.' })); return; }
    try {
      const { data: g } = await supabase.from('games').select('title').eq('id', gid).single();
      await logActivity(user.id, 'devlog', 'Posted a devlog on ' + ((g && g.title) || 'their game'));
    } catch {}
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ post }));
    return;
  }

if (devlogMatch && devlogMatch[2] && req.method === 'DELETE') {
    cors(res);
    const authHeader = req.headers.authorization || '';
    const token = authHeader.replace('Bearer ', '');
    if (!token) { res.writeHead(401, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'Unauthorized' })); return; }
    const { data: { user }, error: authErr } = await supabase.auth.getUser(token);
    if (authErr || !user) { res.writeHead(401, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'Unauthorized' })); return; }
    if (!(await seatAlive(user.id, seatFromReq(req)))) { seatDead(res); return; }
    const gid = devlogMatch[1], pid = devlogMatch[2];
    if (!isUuid(gid)) { res.writeHead(400, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'Invalid game.' })); return; }
    const { data: g } = await supabase.from('games').select('owner_id').eq('id', gid).single();
    if (!g || g.owner_id !== user.id) { res.writeHead(404, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'Not found' })); return; }
    await supabase.from('game_posts').delete().eq('id', pid).eq('game_id', gid);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true }));
    return;
  }

  // ── /api/games/:id/howto — the first-run controls line ────────
  // Guessed from the game's own source so the cover can say how to play without
  // the creator writing anything. A wrong guess is worse than a generic line,
  // so only unambiguous tokens count.
  const gamePath = url.pathname.startsWith('/api/games/') ? url.pathname.slice('/api/games/'.length).split('/') : null;

const gamePathId = gamePath && isUuid(gamePath[0]) ? gamePath[0] : null;

if (gamePathId && gamePath.length === 2 && gamePath[1] === 'howto' && req.method === 'GET') {
    // The first-run cover reads this from cudic.vercel.app, so without the
    // header the browser blocks it and every cover falls back to generic text.
    cors(res);
    const { data: hg } = await supabase.from('games').select('files').eq('id', gamePathId).single();
    let hfiles = hg && hg.files;
    if (typeof hfiles === 'string') { try { hfiles = JSON.parse(hfiles); } catch (e) { hfiles = null; } }
    const src = Object.keys(hfiles || {})
      .filter((p) => /\.(js|mjs|ts|html)$/i.test(p))
      .map((p) => String(hfiles[p] || ''))
      .join('\n')
      .slice(0, 400000);
    const hints = [];
    if (/ArrowLeft|ArrowRight/.test(src)) hints.push('arrow keys to move');
    else if (/WASD|KeyW|KeyA/.test(src)) hints.push('WASD or the arrow keys');
    if (/Space/.test(src)) hints.push('Space to jump or shoot');
    if (/mousedown|pointerdown|touchstart/.test(src)) hints.push('tap or click to act');
    if (/cudic-touch|dpad|joystick/i.test(src)) hints.push('on-screen buttons on a phone');
    const text = hints.length
      ? 'How to play: ' + hints.slice(0, 3).join(' · ') + '.'
      : 'Tap or click to start. If on-screen buttons appear, they work with a thumb.';
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'public, max-age=600' });
    res.end(JSON.stringify({ text, hints }));
    return;
  }

  // ── /api/games/:id/export — one self-contained .html ─────────
  // The files of a published game are already public to every player, so this
  // needs no session; it only reassembles them into the single-file shape
  // itch.io and CrazyGames take as an upload.
  if (gamePathId && gamePath.length === 2 && gamePath[1] === 'export' && req.method === 'GET') {
    const { data: eg } = await supabase.from('games')
      .select('id, slug, title, credits, files, published, users!owner_id(display_name)')
      .eq('id', gamePathId).single();
    let efiles = eg && eg.files;
    if (typeof efiles === 'string') { try { efiles = JSON.parse(efiles); } catch (e) { efiles = null; } }
    if (!eg || !eg.published || !efiles || !Object.keys(efiles).length) {
      res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: 'Only a published game can be exported.' }));
      return;
    }
    const html = singleFileBuild(efiles, {
      title: eg.title,
      author: eg.users && eg.users.display_name
    });
    const name = String(eg.slug || 'game').replace(/[^a-z0-9-]/gi, '-').toLowerCase() || 'game';
    res.writeHead(200, {
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Disposition': 'attachment; filename="' + name + '.html"',
      'Cache-Control': 'no-store'
    });
    res.end(html);
    return;
  }

if (url.pathname.startsWith('/api/games/') && req.method === 'GET') {
    cors(res);
    const id = url.pathname.split('/')[3];
    const { data, error } = await supabase.from('games').select('*, users!games_owner_id_fkey(id, display_name, user_id, avatar_url)').eq('id', id).single();
    if (!data) { res.writeHead(404, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'Not found' })); return; }
    // Like count + whether this viewer liked it (optional token).
    const viewer = await userOf(req);
    if (viewer && !hasScope(viewer, 'projects:read')) { scopeDenied(res, 'projects:read'); return; }
    // Drafts ship only to their owner or to a valid playtest link. Anyone
    // else gets the same Not found whether or not the id exists — never
    // confirm a draft's existence.
    const playtestParam = url.searchParams.get('playtest') || '';
    const viaPlaytest = !data.published && playtestValid(id, playtestParam);
    if (!data.published && (!viewer || data.owner_id !== viewer.id) && !viaPlaytest) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Not found' }));
      return;
    }
    const { count: likeCount } = await supabase.from('game_likes').select('user_id', { count: 'exact', head: true }).eq('game_id', id);
    let liked = false;
    if (viewer) {
      const { data: mine } = await supabase.from('game_likes').select('user_id').eq('game_id', id).eq('user_id', viewer.id).maybeSingle();
      liked = !!mine;
    }
    // Rating summary: average + count, plus this viewer's rating.
    const { data: ratingRows } = await supabase.from('game_ratings').select('rating').eq('game_id', id);
    const ratings = ratingRows || [];
    const avg = ratings.length ? ratings.reduce((a, r) => a + r.rating, 0) / ratings.length : 0;
    let myRating = 0;
    if (viewer) {
      const { data: mine } = await supabase.from('game_ratings').select('rating').eq('game_id', id).eq('user_id', viewer.id).maybeSingle();
      myRating = (mine && mine.rating) || 0;
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    // A published game plays its shipped release, not the working draft: save
    // freely in Studio and players stay on the build you published. Games with
    // no release yet (published before releases existed) keep serving the row.
    const out = { ...data, likes: likeCount || 0, liked, playing: liveCount(id), playtest: viaPlaytest, rating_avg: Math.round(avg * 10) / 10, rating_count: ratings.length, my_rating: myRating };
    if (data.published) {
      const rel = await latestRelease(id);
      if (rel) {
        out.files = rel.files;
        out.release = { version: rel.version, notes: rel.notes, at: rel.at, source: rel.source, commit: rel.commit };
      }
    }
    res.end(JSON.stringify({ game: out }));
    return;
  }

  // ── API: like / unlike a game ──────────────────────────────────
  // Seat-checked like everything else; the row itself is the only state.
  // Guests get the count without the ability to like (no identity to bind).
  const likeMatch = /^\/api\/games\/([^/]+)\/like$/.exec(url.pathname);

if (likeMatch && (req.method === 'POST' || req.method === 'DELETE')) {
    cors(res);
    const authHeader = req.headers.authorization || '';
    const token = authHeader.replace('Bearer ', '');
    if (!token) { res.writeHead(401, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'Unauthorized' })); return; }
    const { data: { user }, error: authErr } = await supabase.auth.getUser(token);
    if (authErr || !user) { res.writeHead(401, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'Unauthorized' })); return; }
    if (!(await seatAlive(user.id, seatFromReq(req)))) { seatDead(res); return; }
    if (!(await needVerified(user, res))) return;
    const gid = likeMatch[1];
    if (!isUuid(gid)) { res.writeHead(400, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'Invalid game.' })); return; }
    const { data: g } = await supabase.from('games').select('published, owner_id, title').eq('id', gid).single();
    if (!g || !(g.published || g.owner_id === user.id)) { res.writeHead(404, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'Not found' })); return; }
    if (req.method === 'POST') {
      await supabase.from('game_likes').upsert({ user_id: user.id, game_id: gid }, { onConflict: 'user_id,game_id', ignoreDuplicates: true });
      // Owner gets a line in their inbox (except on self-likes).
      if (g.owner_id && g.owner_id !== user.id) {
        const { data: lu } = await supabase.from('users').select('display_name').eq('id', user.id).single();
        notify(g.owner_id, 'like', (lu ? lu.display_name : 'Someone') + ' liked ' + (g.title || 'your game'), '', 'game', gid);
      }
    } else {
      await supabase.from('game_likes').delete().eq('user_id', user.id).eq('game_id', gid);
    }
    const { count } = await supabase.from('game_likes').select('user_id', { count: 'exact', head: true }).eq('game_id', gid);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ liked: req.method === 'POST', likes: count || 0 }));
    return;
  }

  // ── API: rate a game (1–5) ──────────────────────────────────────
  // One rating per user per game; posting again changes it. Seat-checked.
  const rateMatch = /^\/api\/games\/([^/]+)\/rate$/.exec(url.pathname);

if (rateMatch && req.method === 'POST') {
    cors(res);
    const user = await requireUser(req, res); if (!user) return;
    if (!(await seatAlive(user.id, seatFromReq(req)))) { seatDead(res); return; }
    if (!(await needVerified(user, res))) return;
    const gid = rateMatch[1];
    if (!isUuid(gid)) { res.writeHead(400, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'Invalid game.' })); return; }
    const { data: g } = await supabase.from('games').select('published, owner_id').eq('id', gid).single();
    if (!g || !g.published) { res.writeHead(404, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'Not found' })); return; }
    const body = await readBody(req).catch(() => ({}));
    const rating = Math.round(Number(body.rating));
    if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
      res.writeHead(400, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'Rating must be 1–5.' })); return;
    }
    const { error } = await supabase.from('game_ratings').upsert({ game_id: gid, user_id: user.id, rating }, { onConflict: 'game_id,user_id' });
    if (error) { res.writeHead(500, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'Could not save rating.' })); return; }
    const { data: ratingRows } = await supabase.from('game_ratings').select('rating').eq('game_id', gid);
    const ratings = ratingRows || [];
    const avg = ratings.length ? ratings.reduce((a, r) => a + r.rating, 0) / ratings.length : 0;
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ rating: rating, rating_avg: Math.round(avg * 10) / 10, rating_count: ratings.length }));
    return;
  }

  // ── API: count a play ───────────────────────────────────────────
  // A counter, not analytics: one integer per game, bumped when a game
  // page actually starts the player. Guests count too — a play is a play.
  const playMatch = /^\/api\/games\/([^/]+)\/play$/.exec(url.pathname);

if (playMatch && req.method === 'POST') {
    cors(res);
    const gid = playMatch[1];
    if (!isUuid(gid)) { res.writeHead(400, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'Invalid game.' })); return; }
    const { data: g } = await supabase.from('games').select('published, owner_id').eq('id', gid).single();
    const authHeader = req.headers.authorization || '';
    const token = authHeader.replace('Bearer ', '');
    const { data: { user } } = token ? await supabase.auth.getUser(token) : { data: { user: null } };
    if (!g || !(g.published || (user && g.owner_id === user.id))) { res.writeHead(404, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'Not found' })); return; }
    // Recently-played ledger for the gallery's "Continue playing" shelf.
    // Guests only bump the counter; a signed-in play is remembered per game,
    // and re-opening a game refreshes the timestamp instead of adding a row.
    // Never awaited for long and never fatal: a database without game_plays
    // (before the migration runs) just records nothing, and the play still counts.
    if (user) {
      try {
        await supabase.from('game_plays').upsert(
          { user_id: user.id, game_id: gid, played_at: new Date().toISOString() },
          { onConflict: 'user_id,game_id' }
        );
      } catch (e) { /* shelf stays empty, play_count already bumped */ }
    }
    // One play per game per browser per hour: a reload shouldn't inflate it.
    const key = 'play:' + clientIp(req) + ':' + gid;
    if (!rateLimit(key, 1, 3600000)) { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ ok: true })); return; }
    const { data: bumped } = await supabase.rpc('bump_play_count', { p_game: gid });
    // Weekly creator race: one point per unique player per game per week.
    // The upsert PK (week, game_id, viewer) de-dupes; viewer is a salted IP
    // hash — no personal data, one point per household is the accepted
    // anti-bot bias. Owner-less games are skipped. Never awaited: a play
    // must not wait on the race ledger.
    if (g.owner_id) {
      try {
        const viewer = crypto.createHash('sha256').update('race|' + clientIp(req)).digest('hex').slice(0, 32);
        supabase.from('race_plays')
          .upsert({ week: digestWeekStart(), game_id: gid, creator_id: g.owner_id, viewer },
            { onConflict: 'week,game_id,viewer', ignoreDuplicates: true })
          .then(() => {}, () => {});
      } catch (e) {}
    }
    if (bumped >= 100 && g.owner_id) {
      // Fire-and-forget: the play response must not wait on awards.
      awardUser(g.owner_id, 'viral').catch(() => {});
      awardUser(g.owner_id, 'renowned').catch(() => {});
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, plays: bumped ?? null }));
    return;
  }

  // ── API: create game ──────────────────────────────────────────
  if (url.pathname === '/api/games' && req.method === 'POST') {
    cors(res);
    const user = await userOf(req);
    if (!user) { res.writeHead(401, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'Unauthorized' })); return; }
    if (!hasScope(user, 'projects:write')) { scopeDenied(res, 'projects:write'); return; }
    if (!(await needVerified(user, res))) return;
    const body = await readBody(req, 25 * 1024 * 1024); // projects can carry MB-scale file JSON, but bound it
    const { data, error } = await supabase.from('games').insert({
      owner_id: user.id,
      slug: await freeGameSlug(body.title),
      title: String(body.title || 'Untitled Game').slice(0, 100),
      description: String(body.description || '').slice(0, 500),
      credits: String(body.credits || '').slice(0, 200),
      scene: body.scene == null || body.scene === '' ? '[]' : String(body.scene).slice(0, 512 * 1024),
      files: body.files || null,
      assets: body.assets || null,
      thumbnail: (typeof body.thumbnail === 'string' && body.thumbnail.length <= 700 * 1024) ? body.thumbnail : null,
      published: body.published || false,
      // Create-time tags: the publish modal sends them with the first PUT
      // for existing projects; new games get them right in the insert so a
      // first publish is already filterable in the gallery.
      tags: sanitizeTags(body.tags),
    }).select().single();
    if (error) console.error('games insert error:', error.message);
    gamesListCacheClear();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ game: data, error: error ? 'Could not create the game.' : undefined }));
    return;
  }

  // ── API: fork game (copy row + storage objects, fresh discussion) ──
  if (/^\/api\/games\/[^/]+\/fork$/.test(url.pathname) && req.method === 'POST') {
    cors(res);
    const authHeader = req.headers.authorization || '';
    const token = authHeader.replace('Bearer ', '');
    if (!token) { res.writeHead(401, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'Unauthorized' })); return; }
    const { data: { user }, error: authErr } = await supabase.auth.getUser(token);
    if (authErr || !user) { res.writeHead(401, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'Unauthorized' })); return; }
    if (!(await needVerified(user, res))) return;
    const id = url.pathname.split('/')[3];
    const { data: g } = await supabase.from('games').select('*').eq('id', id).single();
    if (!g) { res.writeHead(404, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'Not found' })); return; }
    if (!g.published && g.owner_id !== user.id) { res.writeHead(403, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'Forbidden' })); return; }
    // Transitive credit: extend the parent's snapshot chain with the parent
    // itself, so a remix of a remix still names the original maker. Capped
    // (original always kept); snapshots survive deletions by design.
    const parentChain = Array.isArray(g.fork_chain) ? g.fork_chain : [];
    const cleanChain = parentChain
      .filter(e => e && typeof e.id === 'string')
      .map(e => ({ id: e.id, title: String(e.title || 'Untitled') }));
    cleanChain.push({ id: g.id, title: g.title || 'Untitled' });
    const chain = cleanChain.length > 25 ? [cleanChain[0], ...cleanChain.slice(-24)] : cleanChain;
    const forkRow = {
      owner_id: user.id,
      title: (g.title || 'Untitled') + ' (fork)',
      description: g.description || '',
      credits: g.credits || '',
      scene: g.scene || '[]',
      files: g.files || null,
      assets: null,
      thumbnail: g.thumbnail || null,
      published: false,
      forked_from: g.id,
      forked_from_title: g.title || 'Untitled',
      fork_chain: chain
    };
    // asset_owner is the game whose storage prefix holds this fork's bytes.
    // A database without the column falls back to copying, so forking keeps
    // working on a schema older than the sharing migration.
    let canShare = true;
    let { data: nu, error: insErr } = await supabase.from('games')
      .insert({ ...forkRow, asset_owner: g.asset_owner || g.id }).select().single();
    if (insErr && /asset_owner/.test(String(insErr.message))) {
      canShare = false;
      ({ data: nu, error: insErr } = await supabase.from('games').insert(forkRow).select().single());
    }
    if (insErr || !nu) { res.writeHead(500, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: insErr?.message || 'Fork failed' })); return; }
    gamesListCacheClear();
    // Assets: share the bytes instead of copying them. A fork used to duplicate
    // every object into a fresh prefix, which is how one 40MB game forked 500
    // times became 20GB. The fork now points at the prefix it inherited; the
    // delete handler below copies a prefix into its children before purging it.
    const ownerPrefix = g.asset_owner || g.id;
    const manifest = g.assets || {};
    const rewritten = {};
    let copyFailed = 0;
    if (canShare) {
      for (const [k, v] of Object.entries(manifest)) {
        const s = String(v);
        const stripped = s.replace(/^game-assets\//, '');
        rewritten[k] = stripped.startsWith(id + '/')
          ? 'game-assets/' + ownerPrefix + stripped.substring(id.length)
          : s;
      }
    } else {
      const { copied, total } = await copyAssetPrefix(id, nu.id);
      copyFailed = total - copied.size;
      for (const [k, v] of Object.entries(manifest)) {
        const stripped = String(v).replace(/^game-assets\//, '');
        if (!stripped.startsWith(id + '/')) { rewritten[k] = String(v); continue; }
        if (!copied.has(stripped)) continue; // drop refs whose object didn't survive
        rewritten[k] = 'game-assets/' + nu.id + stripped.substring(id.length);
      }
    }
    if (copyFailed) console.error('fork: asset copy failed for', copyFailed, 'object(s) (project', id + ')');
    // A manifest that fails to rewrite must be visible, not silent: text road
    // already forked, so the game is real and its images are the only casualty.
    if (Object.keys(rewritten).length) {
      const { error: shareErr } = await supabase.from('games').update({ assets: rewritten }).eq('id', nu.id);
      if (shareErr) {
        console.error('fork: asset manifest rewrite failed for', nu.id, shareErr.message);
        copyFailed = copyFailed || 'manifest';
      } else nu.assets = rewritten;
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ game: nu, assets_partial: copyFailed !== 0, assets_failed: copyFailed, assets_shared: canShare }));
    return;
  }

  // ── API: update game ──────────────────────────────────────────
  if (url.pathname.startsWith('/api/games/') && req.method === 'PUT') {
    cors(res);
    const user = await userOf(req);
    if (!user) { res.writeHead(401, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'Unauthorized' })); return; }
    if (!hasScope(user, 'projects:write')) { scopeDenied(res, 'projects:write'); return; }
    if (!(await needVerified(user, res))) return;
    const id = url.pathname.split('/')[3];
    const body = await readBody(req, 25 * 1024 * 1024);
    const updates = {};
    if (body.title !== undefined) updates.title = String(body.title || 'Untitled Game').slice(0, 100);
    if (body.description !== undefined) updates.description = String(body.description || '').slice(0, 500);
    if (body.credits !== undefined) updates.credits = String(body.credits || '').slice(0, 200);
    if (body.scene !== undefined && body.scene != null) updates.scene = String(body.scene).slice(0, 512 * 1024);
    if (body.files !== undefined) updates.files = body.files;
    if (body.assets !== undefined) updates.assets = body.assets;
    if (body.published !== undefined) updates.published = body.published;
    if (body.published && body.slug === undefined && !(await supabase.from('games').select('slug').eq('id', id).single()).data?.slug) {
      updates.slug = await freeGameSlug(body.title ?? (await supabase.from('games').select('title').eq('id', id).single()).data?.title, id);
    }
    // Thumbnails arrive as ≤1000px JPEG data URLs; reject anything else
    // instead of storing a multi-MB blob the view page would re-fetch.
    if (body.thumbnail !== undefined) {
      if (body.thumbnail === null) updates.thumbnail = null;
      else if (typeof body.thumbnail === 'string' && body.thumbnail.length <= 700 * 1024) updates.thumbnail = body.thumbnail;
      else { res.writeHead(400, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'Thumbnail too large (700KB max).' })); return; }
    }
    // Tags: sanitized by the shared helper (see slugify's neighbor) so the
    // product rules live in exactly one place.
    if (body.tags !== undefined) updates.tags = sanitizeTags(body.tags);
    // A project imported from GitHub should keep tracking that repository even
    // if it is never pushed from Studio — otherwise an import is a dead copy
    // and only a push sets the mapping. The client sends the repo it came from;
    // the server checks it can actually read it with this user's GitHub token,
    // and records the repository's owner as the login allowed to deploy (which
    // is who pushes to it, whether or not that is the Cudic user).
    if (body.github_link !== undefined) {
      const linkMatch = /^([A-Za-z0-9._-]+)\/([A-Za-z0-9._-]+)(?:#([A-Za-z0-9._\/-]+))?$/.exec(String(body.github_link || '').trim());
      if (linkMatch) {
        const linkToken = await ghToken(user);
        if (!linkToken.error) {
          const repoRes = await ghApi('/repos/' + linkMatch[1] + '/' + linkMatch[2], linkToken.token).catch(() => null);
          const repoJson = repoRes && repoRes.ok ? await repoRes.json().catch(() => null) : null;
          if (repoJson) {
            updates.github_repo = linkMatch[1] + '/' + linkMatch[2];
            updates.github_branch = linkMatch[3] || String(repoJson.default_branch || 'main');
            updates.github_login = String((repoJson.owner && repoJson.owner.login) || linkMatch[1]);
          }
        }
      }
    }
    // Only a false → true flip fires the publish hook; unpublishing can't.
    const wasPub = updates.published === true
      ? (((await supabase.from('games').select('published').eq('id', id).eq('owner_id', user.id).single()).data || {}).published)
      : null;
    updates.updated_at = new Date().toISOString();
    // Storage budget: worth counting only when the save actually carries binary
    // assets (text files live in the row, not the bucket). Uploaded bytes are
    // already in storage by now, so this counts the real total.
    let storage = null;
    if (body.assets !== undefined) {
      const used = await accountStorageBytes(user.id).catch(() => null);
      if (used != null) {
        storage = { used, cap: ACCOUNT_STORAGE_CAP };
        if (used > ACCOUNT_STORAGE_CAP) {
          res.writeHead(413, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            error: 'storage_over_cap',
            text: 'That save would put you over your storage budget.',
            used,
            cap: ACCOUNT_STORAGE_CAP
          }));
          return;
        }
      }
    }
    // Publishing is gated on the project's tests. They run in the browser, so
    // this is the client's word — but a stale Studio build (or a bug) that
    // reports failures must not be able to flip a red build live.
    if (updates.published === true && body.tests && Number(body.tests.failed) > 0) {
      res.writeHead(409, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        error: 'tests_failed',
        text: 'Tests are failing, so this build was not published.',
        failed: Number(body.tests.failed),
        passed: Number(body.tests.passed) || 0
      }));
      return;
    }
    let { data, error } = await supabase.from('games').update(updates).eq('id', id).eq('owner_id', user.id).select().single();
    // A database without the deploy columns (migration not applied) must still
    // save the game: drop them and retry once instead of failing the write.
    if (error && /github_(repo|branch|login)/.test(String(error.message)) &&
        ('github_repo' in updates || 'github_branch' in updates || 'github_login' in updates)) {
      delete updates.github_repo;
      delete updates.github_branch;
      delete updates.github_login;
      ({ data, error } = await supabase.from('games').update(updates).eq('id', id).eq('owner_id', user.id).select().single());
    }
    if (error) console.error('games update error:', error.message);
    else if (wasPub === false && data) {
      onPublished(user.id, id, data.title).catch(() => {});
      // Announcing belongs to publishing, not saving: this branch only runs on
      // the false → true flip. A webhook that is unset, slow or failing is
      // logged inside lib/discord.js and must never fail the publish.
      discord.announcePublished(data).catch(() => {});
    }
    gamesListCacheClear(); // title/tags/publish flips change the gallery
    // Publishing ships a release: snapshot the files that just went live, so
    // later saves are a draft until the next publish. Failures leave the old
    // behaviour (row files) in place rather than failing the save.
    let release = null;
    if (updates.published === true && data) {
      release = await createRelease(
        id, user.id, body.files !== undefined ? body.files : data.files,
        body.release_notes, body.release_source || 'studio', body.release_commit, body.tests
      );
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    if (!error) forgetStorageUsage(user.id);
    res.end(JSON.stringify({ game: data, release, storage, error: error ? 'Could not save the game.' : undefined }));
    return;
  }

  // ── API: delete game ──────────────────────────────────────────
  if (url.pathname.startsWith('/api/games/') && req.method === 'DELETE') {
    cors(res);
    const user = await userOf(req);
    if (!user) { res.writeHead(401, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'Unauthorized' })); return; }
    if (!hasScope(user, 'projects:write')) { scopeDenied(res, 'projects:write'); return; }
    if (!(await needVerified(user, res))) return;
    const id = url.pathname.split('/')[3];
    // Forks share their parent's bytes, so a prefix cannot be purged while a
    // child still points at it. Copy the share into each child, rewrite its
    // manifest and detach it first. If any copy fails, leave the bytes alone:
    // an orphaned prefix is recoverable, a fork that lost its images is not.
    let safeToPurge = true;
    try {
      const { data: kids, error: kidErr } = await supabase
        .from('games').select('id, assets').eq('asset_owner', id).neq('id', id);
      // No sharing column: every fork already holds its own copy.
      if (kidErr && !/asset_owner/.test(String(kidErr.message))) throw kidErr;
      for (const kid of kids || []) {
        const { copied, total } = await copyAssetPrefix(id, kid.id);
        if (copied.size !== total) { safeToPurge = false; continue; }
        const next = {};
        for (const [k, v] of Object.entries(kid.assets || {})) {
          const stripped = String(v).replace(/^game-assets\//, '');
          next[k] = stripped.startsWith(id + '/')
            ? 'game-assets/' + kid.id + stripped.substring(id.length)
            : String(v);
        }
        const { error: detachErr } = await supabase.from('games')
          .update({ assets: next, asset_owner: kid.id }).eq('id', kid.id);
        if (detachErr) safeToPurge = false;
      }
    } catch (e) {
      safeToPurge = false;
      console.error('delete: could not hand assets to forks of', id, e?.message || e);
    }
    // Best-effort: purge the project's storage prefix so binaries don't orphan.
    try {
      if (safeToPurge) {
        const bucket = supabase.storage.from('game-assets');
        const paths = [];
        async function walk(prefix) {
          const { data: entries } = await bucket.list(prefix, { limit: 1000 });
          for (const e of entries || []) {
            const p = prefix ? prefix + '/' + e.name : e.name;
            if (e.metadata) paths.push(p);
            else await walk(p);
          }
        }
        await walk(id, paths);
        if (paths.length) await bucket.remove(paths);
      }
    } catch {}
    await supabase.from('games').delete().eq('id', id).eq('owner_id', user.id);
    gamesListCacheClear();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true }));
    return;
  }
  }

  return { handle, matches };
};

function matches(pathname) {
  return pathname === '/api/games' || pathname.startsWith('/api/games/') || pathname === '/api/game-tags';
}
