/* file: lib/routes/next.js
 * what: feedback comments on the /next product models, one thread per feature.
 * invariants: reads are public; writes resolve the caller, require a confirmed
 *   email and are rate-limited. The feature id is a slug, never free-form HTML.
 */
module.exports = function createRoutes(deps) {
  const { supabase, cors, requireUser, needVerified, readBody, rateLimit } = deps;
  const FEATURE = /^[a-z][a-z0-9-]{0,39}$/;

  function send(res, code, body) {
    res.writeHead(code, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(body));
  }

  function noTable(err) {
    const code = String((err && err.code) || '');
    return code === 'PGRST205' || code === '42P01' || /does not exist|schema cache/i.test(String((err && err.message) || ''));
  }

  function notSetUp(res) {
    send(res, 503, {
      error: 'next_comments_not_set_up',
      text: 'Comments need the next-comments migration first.',
    });
  }

  async function profilesFor(ids) {
    if (!ids.length) return {};
    const { data } = await supabase.from('users').select('id, display_name, avatar_url').in('id', ids);
    const byId = {};
    (data || []).forEach((user) => { byId[user.id] = user; });
    return byId;
  }

  function shape(row, profiles) {
    const author = profiles[row.author_id] || {};
    return {
      id: row.id,
      feature_id: row.feature_id,
      body: row.body,
      created_at: row.created_at,
      display_name: author.display_name || 'Someone',
      avatar_url: author.avatar_url || '',
    };
  }

  async function handle(req, res, url) {
    if (url.pathname !== '/api/next/comments') {
      send(res, 404, { error: 'Not found.' });
      return;
    }

    if (req.method === 'GET') {
      cors(res);
      const feature = String(url.searchParams.get('feature') || '');
      if (!FEATURE.test(feature)) {
        send(res, 400, { error: 'Pick a feature.' });
        return;
      }
      const { data, error } = await supabase.from('next_comments')
        .select('id, feature_id, author_id, body, created_at')
        .eq('feature_id', feature)
        .order('created_at', { ascending: false })
        .limit(100);
      if (error) {
        if (noTable(error)) notSetUp(res);
        else send(res, 500, { error: 'Could not load comments.' });
        return;
      }
      const rows = data || [];
      const profiles = await profilesFor([...new Set(rows.map((row) => row.author_id))]);
      send(res, 200, { comments: rows.map((row) => shape(row, profiles)) });
      return;
    }

    if (req.method === 'POST') {
      cors(res);
      const user = await requireUser(req, res); if (!user) return;
      if (!(await needVerified(user, res))) return;
      if (!rateLimit('next-comment:' + user.id, 20, 60 * 60 * 1000)) {
        send(res, 429, { error: 'Slow down — 20 comments an hour max.' });
        return;
      }
      const body = await readBody(req, 8 * 1024).catch(() => ({}));
      const feature = String((body && (body.feature_id || body.featureId)) || '');
      if (!FEATURE.test(feature)) {
        send(res, 400, { error: 'Pick a feature.' });
        return;
      }
      const text = String((body && body.body) || '').trim().substring(0, 600);
      if (!text) {
        send(res, 400, { error: 'Write a comment first.' });
        return;
      }
      const { data, error } = await supabase.from('next_comments')
        .insert({ feature_id: feature, author_id: user.id, body: text })
        .select('id, feature_id, author_id, body, created_at')
        .single();
      if (error) {
        if (noTable(error)) notSetUp(res);
        else send(res, 500, { error: 'Could not post the comment.' });
        return;
      }
      const profiles = await profilesFor([user.id]);
      send(res, 200, { comment: shape(data, profiles) });
      return;
    }

    send(res, 405, { error: 'Method not allowed.' });
  }

  return { handle, matches };
};

function matches(pathname) {
  return pathname === '/api/next/comments';
}
