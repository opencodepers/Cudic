/* file: lib/routes/hq.js
 * what: One server's HQ — member/message insights, a 30-day leaderboard,
 *   member introductions, and owner-only bulk channel edits.
 * invariants: every route resolves the caller and goes through serverRole;
 *   a missing chat-HQ migration hides only intros/temporary channels, while
 *   insights keep working on the existing tables.
 */
module.exports = function createRoutes(deps) {
  const {
    supabase, cors, requireUser, needVerified, readBody, isUuid, serverRole,
    sendConversationsDirty,
  } = deps;

  function send(res, code, body) {
    res.writeHead(code, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(body));
  }
  function noTable(err) {
    const code = String((err && err.code) || '');
    return code === 'PGRST205' || code === '42P01' || /does not exist|schema cache/i.test(String((err && err.message) || ''));
  }
  function noColumn(err) {
    const code = String((err && err.code) || '');
    return code === '42P01' || code === '42703' || code === 'PGRST204' || /column .* does not exist|schema cache/i.test(String((err && err.message) || ''));
  }
  async function audit(sid, actorId, action, target, meta) {
    try {
      await supabase.from('server_audit').insert({
        server_id: sid, actor_id: actorId || null, action: String(action).slice(0, 60),
        target: String(target || '').slice(0, 120), meta: meta || {},
      });
    } catch (e) {}
  }

  // A channel list that still works before the migration: expires_at is
  // selected when present, and the old columns are selected when it is not.
  async function channelsFor(sid, userId, role) {
    let temporary = true;
    let result = await supabase.from('lobbies')
      .select('id, name, expires_at, is_private, slow_seconds')
      .eq('kind', 'channel').eq('server_id', sid).order('created_at', { ascending: true });
    if (result.error && noColumn(result.error)) {
      temporary = false;
      result = await supabase.from('lobbies')
        .select('id, name, is_private, slow_seconds')
        .eq('kind', 'channel').eq('server_id', sid).order('created_at', { ascending: true });
    }
    let channels = result.data || [];
    // Private channels are not part of HQ for members; the core channel API
    // already hides them, and insights must not become a side door.
    if (role !== 'owner' && channels.length) {
      const { data: mine } = await supabase.from('conversation_members')
        .select('lobby_id').eq('user_id', userId);
      const joined = new Set((mine || []).map(r => r.lobby_id));
      channels = channels.filter(c => !c.is_private || joined.has(c.id));
    }
    return { channels, temporary, error: result.error || null };
  }

  async function handle(req, res, url) {
    // ── Server HQ: insights + leaderboard + intros ────────────────
    const hqMatch = /^\/api\/servers\/([^/]+)\/hq$/.exec(url.pathname);
    if (hqMatch && req.method === 'GET') {
      cors(res);
      const user = await requireUser(req, res); if (!user) return;
      const sid = hqMatch[1];
      if (!isUuid(sid)) { send(res, 400, { error: 'Invalid server.' }); return; }
      const { server, role } = await serverRole(user.id, sid);
      if (!server || !role) { send(res, 403, { error: 'Join this server first.' }); return; }

      const { channels, temporary } = await channelsFor(sid, user.id, role);
      const ids = channels.map(c => c.id);
      const since7 = new Date(Date.now() - 7 * 86400000).toISOString();
      const since30 = new Date(Date.now() - 30 * 86400000).toISOString();

      const [memberRes, msgCountRes, recentRes] = await Promise.all([
        supabase.from('server_members').select('user_id', { count: 'exact', head: true }).eq('server_id', sid),
        ids.length
          ? supabase.from('messages').select('id', { count: 'exact', head: true }).in('lobby_id', ids).gte('created_at', since7)
          : Promise.resolve({ count: 0 }),
        ids.length
          ? supabase.from('messages').select('user_id, display_name, lobby_id, created_at')
              .in('lobby_id', ids).gte('created_at', since30)
              .order('created_at', { ascending: false }).limit(3000)
          : Promise.resolve({ data: [] }),
      ]);

      const recent = recentRes.data || [];
      const activeChannels = new Set(recent.map(m => m.lobby_id));
      const byUser = {};
      recent.forEach(m => {
        if (!m.user_id) return;
        if (!byUser[m.user_id]) byUser[m.user_id] = { user_id: m.user_id, display_name: m.display_name || 'Unknown', count: 0 };
        byUser[m.user_id].count++;
      });
      const leaderboard = Object.keys(byUser).map(k => byUser[k]).sort((a, b) => b.count - a.count).slice(0, 8);

      let intros = [];
      let introsReady = true;
      if (temporary) {
        const ir = await supabase.from('server_intros')
          .select('user_id, body, updated_at').eq('server_id', sid)
          .order('updated_at', { ascending: false }).limit(50);
        if (ir.error && noTable(ir.error)) introsReady = false;
        else if (!ir.error) {
          const rows = ir.data || [];
          const names = {};
          if (rows.length) {
            const { data: users } = await supabase.from('users')
              .select('id, display_name, avatar_url').in('id', rows.map(r => r.user_id));
            (users || []).forEach(u => { names[u.id] = u; });
          }
          intros = rows.map(r => ({
            user_id: r.user_id, body: r.body, updated_at: r.updated_at,
            display_name: (names[r.user_id] && names[r.user_id].display_name) || 'Member',
            avatar_url: (names[r.user_id] && names[r.user_id].avatar_url) || null,
          }));
        }
      } else {
        introsReady = false;
      }

      send(res, 200, {
        me: user.id,
        role,
        capabilities: { temporary, intros: introsReady },
        analytics: {
          members: memberRes.count || 0,
          channels: channels.length,
          messages_7d: msgCountRes.count || 0,
          active_channels_7d: activeChannels.size,
          sample_messages: recent.length,
        },
        channels: channels.map(c => ({ id: c.id, name: c.name, display_name: String(c.name).split(':').pop(), expires_at: c.expires_at || null })),
        leaderboard,
        intros,
      });
      return;
    }

    // ── Bulk channel edit (owner only) ───────────────────────────
    const bulkMatch = /^\/api\/servers\/([^/]+)\/channels\/bulk$/.exec(url.pathname);
    if (bulkMatch && req.method === 'POST') {
      cors(res);
      const user = await requireUser(req, res); if (!user) return;
      if (!(await needVerified(user, res))) return;
      const sid = bulkMatch[1];
      if (!isUuid(sid)) { send(res, 400, { error: 'Invalid server.' }); return; }
      const { role } = await serverRole(user.id, sid);
      if (role !== 'owner') { send(res, 403, { error: 'Only the server owner can bulk-edit channels.' }); return; }
      const body = await readBody(req, 32 * 1024).catch(() => ({}));
      const ids = Array.isArray(body.ids) ? [...new Set(body.ids.map(String).filter(isUuid))].slice(0, 50) : [];
      if (!ids.length) { send(res, 400, { error: 'Pick at least one channel.' }); return; }
      const updates = {};
      if (body.topic !== undefined) updates.topic = String(body.topic || '').substring(0, 200);
      if (body.description !== undefined) updates.description = String(body.description || '').substring(0, 500);
      if (body.is_private !== undefined) updates.is_private = !!body.is_private;
      if (body.slow_seconds !== undefined) {
        const s = parseInt(body.slow_seconds, 10);
        updates.slow_seconds = (isNaN(s) || s < 0 || s > 600) ? 0 : s;
      }
      if (!Object.keys(updates).length) { send(res, 400, { error: 'Choose at least one field to change.' }); return; }
      const { data: owned } = await supabase.from('lobbies')
        .select('id').eq('server_id', sid).eq('kind', 'channel').in('id', ids);
      if ((owned || []).length !== ids.length) { send(res, 400, { error: 'One of those channels is not in this server.' }); return; }
      const { error } = await supabase.from('lobbies').update(updates).in('id', ids);
      if (error) { send(res, 500, { error: 'Could not update those channels.' }); return; }
      await audit(sid, user.id, 'channel.bulk', String(ids.length) + ' channel(s)', updates);
      sendConversationsDirty();
      send(res, 200, { ok: true, updated: ids.length });
      return;
    }

    // ── Member introductions ────────────────────────────────────
    const introMatch = /^\/api\/servers\/([^/]+)\/intros$/.exec(url.pathname);
    if (introMatch) {
      cors(res);
      const user = await requireUser(req, res); if (!user) return;
      const sid = introMatch[1];
      if (!isUuid(sid)) { send(res, 400, { error: 'Invalid server.' }); return; }
      const { role } = await serverRole(user.id, sid);
      if (!role) { send(res, 403, { error: 'Join this server first.' }); return; }
      if (req.method === 'GET') {
        const { data, error } = await supabase.from('server_intros')
          .select('user_id, body, updated_at').eq('server_id', sid)
          .order('updated_at', { ascending: false }).limit(50);
        if (error) {
          if (noTable(error)) { send(res, 503, { error: 'intros_not_set_up', text: 'This needs the chat-HQ migration first.' }); return; }
          send(res, 500, { error: 'Could not load introductions.' }); return;
        }
        const rows = data || [];
        var names = {};
        if (rows.length) {
          const { data: users } = await supabase.from('users')
            .select('id, display_name, avatar_url').in('id', rows.map(r => r.user_id));
          (users || []).forEach(u => { names[u.id] = u; });
        }
        send(res, 200, {
          intros: rows.map(r => ({
            user_id: r.user_id, body: r.body, updated_at: r.updated_at,
            display_name: (names[r.user_id] && names[r.user_id].display_name) || 'Member',
            avatar_url: (names[r.user_id] && names[r.user_id].avatar_url) || null,
          })),
        });
        return;
      }
      if (req.method === 'POST') {
        if (!(await needVerified(user, res))) return;
        const body = await readBody(req, 4096).catch(() => ({}));
        const text = String(body.body || '').replace(/\s+/g, ' ').trim().substring(0, 400);
        if (!text) { send(res, 400, { error: 'Write a short introduction first.' }); return; }
        const { data, error } = await supabase.from('server_intros').upsert({
          server_id: sid, user_id: user.id, body: text, updated_at: new Date().toISOString(),
        }, { onConflict: 'server_id,user_id' }).select('user_id, body, updated_at').single();
        if (error) {
          if (noTable(error)) { send(res, 503, { error: 'intros_not_set_up', text: 'This needs the chat-HQ migration first.' }); return; }
          send(res, 500, { error: 'Could not save your introduction.' }); return;
        }
        await audit(sid, user.id, 'intro.update', '', { chars: text.length });
        send(res, 200, { intro: data });
        return;
      }
      send(res, 405, { error: 'Method not allowed.' });
      return;
    }

    send(res, 404, { error: 'Not found.' });
  }

  return { handle, matches };
};

function matches(pathname) {
  return /^\/api\/servers\/[^/]+\/hq$/.test(pathname)
    || /^\/api\/servers\/[^/]+\/channels\/bulk$/.test(pathname)
    || /^\/api\/servers\/[^/]+\/intros$/.test(pathname);
}
