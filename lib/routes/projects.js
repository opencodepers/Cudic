/* file: lib/routes/projects.js
 * what: the /projects board API — public reads, signed-in submissions, weekly
 *   up/down votes and per-project comments.
 * invariants: projects.upvotes/downvotes are lifetime counters; weekly ranking
 *   comes only from project_votes for the current Monday UTC week, so a reset
 *   never erases the original score. Writes are verified and rate-limited.
 */
module.exports = function createRoutes(deps) {
  const { supabase, cors, requireUser, needVerified, readBody, rateLimit, userOf, digestWeekStart } = deps;
  const CATEGORIES = ['game', 'tool', 'site', 'app', 'art', 'writing', 'music', 'other'];
  const CATEGORY_SET = new Set(CATEGORIES);
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  function send(res, code, body) {
    res.writeHead(code, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(body));
  }

  function noTable(err) {
    const code = String((err && err.code) || '');
    const message = String((err && err.message) || '');
    return code === 'PGRST205' || code === '42P01' || code === 'PGRST202' || code === '42883' ||
      /does not exist|schema cache|could not find the function/i.test(message);
  }

  function notSetUp(res) {
    send(res, 503, {
      error: 'projects_not_set_up',
      text: 'The project board needs the projects migration first.',
    });
  }

  function cleanText(value, max) {
    return String(value == null ? '' : value)
      .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, ' ')
      .replace(/\r\n/g, '\n')
      .trim()
      .slice(0, max);
  }

  function singleLine(value, max) {
    return cleanText(value, max).replace(/\s+/g, ' ');
  }

  function normalizeUrl(value) {
    const raw = String(value || '').trim();
    if (!raw) return null;
    let parsed;
    try { parsed = new URL(raw); } catch (err) { return null; }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
    if (parsed.username || parsed.password) return null;
    parsed.hash = '';
    if (parsed.pathname !== '/' && parsed.pathname.endsWith('/')) {
      parsed.pathname = parsed.pathname.replace(/\/+$/, '');
    }
    return parsed.toString();
  }

  function cleanTags(value) {
    const list = Array.isArray(value) ? value : String(value || '').split(',');
    const out = [];
    list.forEach((item) => {
      const tag = String(item || '').toLowerCase().trim().replace(/[^a-z0-9-]/g, '').slice(0, 24);
      if (tag && out.indexOf(tag) === -1) out.push(tag);
    });
    return out.slice(0, 5);
  }

  function slugBase(name) {
    return String(name || '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 56) || 'project';
  }

  async function uniqueSlug(name) {
    const base = slugBase(name);
    for (let i = 1; i <= 12; i += 1) {
      const candidate = i === 1 ? base : base.slice(0, 56 - String(i).length) + '-' + i;
      const { data } = await supabase.from('projects').select('id').eq('slug', candidate).maybeSingle();
      if (!data) return candidate;
    }
    return base.slice(0, 50) + '-' + Math.random().toString(36).slice(2, 7);
  }

  function weekEnd(week) {
    const start = new Date(String(week) + 'T00:00:00.000Z');
    start.setUTCDate(start.getUTCDate() + 7);
    return start.toISOString();
  }

  function domainOf(value) {
    try { return new URL(String(value || '')).hostname.replace(/^www\./i, ''); } catch (err) { return ''; }
  }

  async function profilesFor(ids) {
    if (!ids.length) return {};
    const { data } = await supabase.from('users').select('id, display_name, avatar_url').in('id', ids);
    const byId = {};
    (data || []).forEach((user) => { byId[user.id] = user; });
    return byId;
  }

  async function weeklyStats(ids, week, viewerId) {
    const byId = {};
    ids.forEach((id) => { byId[id] = { up: 0, down: 0, score: 0, mine: 0 }; });
    if (!ids.length) return { byId };
    const { data, error } = await supabase.from('project_votes')
      .select('project_id, user_id, vote')
      .eq('week_start', week)
      .in('project_id', ids)
      .limit(10000);
    if (error) return { error };
    (data || []).forEach((row) => {
      const stat = byId[row.project_id];
      if (!stat) return;
      if (row.vote === 1) stat.up += 1;
      if (row.vote === -1) stat.down += 1;
      stat.score += row.vote;
      if (viewerId && row.user_id === viewerId) stat.mine = row.vote;
    });
    return { byId };
  }

  async function commentCounts(ids) {
    const byId = {};
    if (!ids.length) return byId;
    const { data, error } = await supabase.from('project_comments')
      .select('project_id').in('project_id', ids).limit(10000);
    if (error) return byId;
    (data || []).forEach((row) => { byId[row.project_id] = (byId[row.project_id] || 0) + 1; });
    return byId;
  }

  async function resolveProject(key) {
    const column = UUID.test(String(key)) ? 'id' : 'slug';
    const { data, error } = await supabase.from('projects')
      .select('*').eq(column, String(key)).maybeSingle();
    return { project: data || null, error };
  }

  function shapeProject(row, owner, stat, comments, viewerId) {
    const up = Number(row.upvotes) || 0;
    const down = Number(row.downvotes) || 0;
    const weekly = stat || { up: 0, down: 0, score: 0, mine: 0 };
    return {
      id: row.id,
      slug: row.slug,
      name: row.name,
      tagline: row.tagline || '',
      description: row.description || '',
      url: row.url,
      domain: domainOf(row.url),
      image_url: row.image_url || '',
      category: row.category || 'other',
      tags: Array.isArray(row.tags) ? row.tags : [],
      created_at: row.created_at,
      owner: {
        display_name: (owner && owner.display_name) || 'Someone',
        avatar_url: (owner && owner.avatar_url) || '',
      },
      upvotes: up,
      downvotes: down,
      all_score: up - down,
      week_upvotes: weekly.up || 0,
      week_downvotes: weekly.down || 0,
      week_score: weekly.score || 0,
      my_vote: viewerId ? (weekly.mine || 0) : 0,
      is_owner: !!viewerId && row.owner_id === viewerId,
      comments: comments || 0,
    };
  }

  function shapeComment(row, profiles) {
    const profile = profiles[row.author_id] || {};
    return {
      id: row.id,
      body: row.body,
      created_at: row.created_at,
      display_name: profile.display_name || 'Someone',
      avatar_url: profile.avatar_url || '',
    };
  }

  async function handle(req, res, url) {
    if (url.pathname === '/api/projects') {
      if (req.method === 'GET') {
        cors(res);
        const q = String(url.searchParams.get('q') || '').trim().toLowerCase().slice(0, 80);
        const category = String(url.searchParams.get('category') || '').toLowerCase();
        const sort = String(url.searchParams.get('sort') || 'week') === 'all' ? 'all' : 'week';
        const week = digestWeekStart();
        const { data, error } = await supabase.from('projects')
          .select('*').order('created_at', { ascending: false }).limit(200);
        if (error) {
          if (noTable(error)) notSetUp(res);
          else send(res, 500, { error: 'Could not load projects.' });
          return;
        }
        let rows = data || [];
        if (category && CATEGORY_SET.has(category)) rows = rows.filter((row) => row.category === category);
        if (q) {
          rows = rows.filter((row) => [
            row.name, row.tagline, row.description, (row.tags || []).join(' '), domainOf(row.url),
          ].join(' ').toLowerCase().indexOf(q) !== -1);
        }
        const ids = rows.map((row) => row.id);
        let viewer = null;
        try { viewer = await userOf(req); } catch (err) { viewer = null; }
        const [stats, counts, profiles] = await Promise.all([
          weeklyStats(ids, week, viewer && viewer.id),
          commentCounts(ids),
          profilesFor([...new Set(rows.map((row) => row.owner_id))]),
        ]);
        if (stats.error) {
          if (noTable(stats.error)) notSetUp(res);
          else send(res, 500, { error: 'Could not load weekly votes.' });
          return;
        }
        const projects = rows.map((row) => shapeProject(
          row, profiles[row.owner_id], stats.byId[row.id], counts[row.id], viewer && viewer.id
        ));
        projects.sort((a, b) => {
          const aPrimary = sort === 'all' ? a.all_score : a.week_score;
          const bPrimary = sort === 'all' ? b.all_score : b.week_score;
          const aUp = sort === 'all' ? a.upvotes : a.week_upvotes;
          const bUp = sort === 'all' ? b.upvotes : b.week_upvotes;
          return (bPrimary - aPrimary) || (bUp - aUp) || (b.upvotes - a.upvotes) ||
            (new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
        });
        send(res, 200, {
          projects,
          week_start: week,
          week_end: weekEnd(week),
          next_reset: weekEnd(week),
          sort,
          categories: CATEGORIES,
        });
        return;
      }

      if (req.method === 'POST') {
        cors(res);
        const user = await requireUser(req, res); if (!user) return;
        if (!(await needVerified(user, res))) return;
        if (!rateLimit('project-submit:' + user.id, 5, 24 * 60 * 60 * 1000)) {
          send(res, 429, { error: 'You can submit five projects a day.' });
          return;
        }
        const body = await readBody(req, 32 * 1024).catch(() => ({}));
        const name = singleLine(body.name, 80);
        const tagline = singleLine(body.tagline, 140);
        const description = cleanText(body.description, 2800);
        const urlValue = normalizeUrl(body.url);
        const imageValue = body.image_url ? normalizeUrl(body.image_url) : null;
        const category = String(body.category || 'other').toLowerCase();
        if (name.length < 2) { send(res, 400, { error: 'Give the project a name.' }); return; }
        if (!urlValue) { send(res, 400, { error: 'Add a public http(s) URL.' }); return; }
        if (body.image_url && !imageValue) { send(res, 400, { error: 'The image URL must be http(s).' }); return; }
        if (!CATEGORY_SET.has(category)) { send(res, 400, { error: 'Pick a category.' }); return; }
        const slug = await uniqueSlug(name);
        const { data, error } = await supabase.from('projects').insert({
          owner_id: user.id,
          slug,
          name,
          tagline,
          description,
          url: urlValue,
          image_url: imageValue,
          category,
          tags: cleanTags(body.tags),
        }).select('*').single();
        if (error) {
          if (noTable(error)) notSetUp(res);
          else if (String(error.code || '') === '23505') send(res, 409, { error: 'That project URL is already on the board.' });
          else send(res, 500, { error: 'Could not submit the project.' });
          return;
        }
        const profiles = await profilesFor([user.id]);
        send(res, 201, { project: shapeProject(data, profiles[user.id], null, 0, user.id) });
        return;
      }

      send(res, 405, { error: 'Method not allowed.' });
      return;
    }

    const match = /^\/api\/projects\/([^/]+)(?:\/(vote|comments))?$/.exec(url.pathname);
    if (!match) { send(res, 404, { error: 'Not found.' }); return; }
    let key = match[1];
    try { key = decodeURIComponent(key); } catch (err) { /* keep the raw key */ }
    const action = match[2] || '';

    if (action === 'vote' && req.method === 'POST') {
      cors(res);
      const user = await requireUser(req, res); if (!user) return;
      if (!(await needVerified(user, res))) return;
      if (!rateLimit('project-vote:' + user.id, 240, 60 * 60 * 1000)) {
        send(res, 429, { error: 'Too many votes. Try again later.' });
        return;
      }
      const body = await readBody(req, 8 * 1024).catch(() => ({}));
      const value = Number(body.vote);
      if (value !== -1 && value !== 0 && value !== 1) {
        send(res, 400, { error: 'Vote must be up, down, or clear.' });
        return;
      }
      const resolved = await resolveProject(key);
      if (resolved.error) {
        if (noTable(resolved.error)) notSetUp(res);
        else send(res, 500, { error: 'Could not load the project.' });
        return;
      }
      if (!resolved.project) { send(res, 404, { error: 'Project not found.' }); return; }
      if (resolved.project.owner_id === user.id) {
        send(res, 403, { error: 'You cannot vote on your own project.' });
        return;
      }
      const week = digestWeekStart();
      const { data, error } = await supabase.rpc('cast_project_vote', {
        p_project: resolved.project.id,
        p_user: user.id,
        p_vote: value,
        p_week: week,
      });
      if (error) {
        if (noTable(error)) notSetUp(res);
        else if (String(error.code || '') === 'P0002') send(res, 404, { error: 'Project not found.' });
        else send(res, 500, { error: 'Could not save the vote.' });
        return;
      }
      const row = Array.isArray(data) ? data[0] : data;
      send(res, 200, {
        ok: true,
        week_start: week,
        week_end: weekEnd(week),
        week_upvotes: Number(row && row.week_upvotes) || 0,
        week_downvotes: Number(row && row.week_downvotes) || 0,
        week_score: Number(row && row.week_score) || 0,
        upvotes: Number(row && row.upvotes) || 0,
        downvotes: Number(row && row.downvotes) || 0,
        my_vote: Number(row && row.my_vote) || 0,
      });
      return;
    }

    if (action === 'comments') {
      const resolved = await resolveProject(key);
      if (resolved.error) {
        cors(res);
        if (noTable(resolved.error)) notSetUp(res);
        else send(res, 500, { error: 'Could not load the project.' });
        return;
      }
      if (!resolved.project) { cors(res); send(res, 404, { error: 'Project not found.' }); return; }

      if (req.method === 'GET') {
        cors(res);
        const { data, error } = await supabase.from('project_comments')
          .select('id, project_id, author_id, body, created_at')
          .eq('project_id', resolved.project.id)
          .order('created_at', { ascending: false })
          .limit(100);
        if (error) {
          if (noTable(error)) notSetUp(res);
          else send(res, 500, { error: 'Could not load comments.' });
          return;
        }
        const rows = data || [];
        const profiles = await profilesFor([...new Set(rows.map((row) => row.author_id))]);
        send(res, 200, { comments: rows.map((row) => shapeComment(row, profiles)) });
        return;
      }

      if (req.method === 'POST') {
        cors(res);
        const user = await requireUser(req, res); if (!user) return;
        if (!(await needVerified(user, res))) return;
        if (!rateLimit('project-comment:' + user.id, 20, 60 * 60 * 1000)) {
          send(res, 429, { error: 'Slow down — 20 comments an hour max.' });
          return;
        }
        const body = await readBody(req, 8 * 1024).catch(() => ({}));
        const text = cleanText(body.body, 600);
        if (!text) { send(res, 400, { error: 'Write a comment first.' }); return; }
        const { data, error } = await supabase.from('project_comments').insert({
          project_id: resolved.project.id,
          author_id: user.id,
          body: text,
        }).select('id, project_id, author_id, body, created_at').single();
        if (error) {
          if (noTable(error)) notSetUp(res);
          else send(res, 500, { error: 'Could not post the comment.' });
          return;
        }
        const profiles = await profilesFor([user.id]);
        send(res, 200, { comment: shapeComment(data, profiles) });
        return;
      }

      send(res, 405, { error: 'Method not allowed.' });
      return;
    }

    if (req.method === 'GET') {
      cors(res);
      const resolved = await resolveProject(key);
      if (resolved.error) {
        if (noTable(resolved.error)) notSetUp(res);
        else send(res, 500, { error: 'Could not load the project.' });
        return;
      }
      if (!resolved.project) { send(res, 404, { error: 'Project not found.' }); return; }
      let viewer = null;
      try { viewer = await userOf(req); } catch (err) { viewer = null; }
      const week = digestWeekStart();
      const [stats, counts, profiles] = await Promise.all([
        weeklyStats([resolved.project.id], week, viewer && viewer.id),
        commentCounts([resolved.project.id]),
        profilesFor([resolved.project.owner_id]),
      ]);
      if (stats.error) {
        if (noTable(stats.error)) notSetUp(res);
        else send(res, 500, { error: 'Could not load weekly votes.' });
        return;
      }
      send(res, 200, {
        project: shapeProject(
          resolved.project,
          profiles[resolved.project.owner_id],
          stats.byId[resolved.project.id],
          counts[resolved.project.id],
          viewer && viewer.id
        ),
        week_start: week,
        week_end: weekEnd(week),
        next_reset: weekEnd(week),
      });
      return;
    }

    send(res, 405, { error: 'Method not allowed.' });
  }

  return { handle, matches };
};

function matches(pathname) {
  return pathname === '/api/projects' || /^\/api\/projects\/[^/]+(?:\/(?:vote|comments))?$/.test(pathname);
}
