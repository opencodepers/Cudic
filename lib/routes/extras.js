/* file: lib/routes/extras.js
 * what: Small personal chat features — private notes, message reminders,
 *   per-user DM pins and mutual interests. Additive; every table is optional,
 *   so an unmigrated deploy answers 503 instead of breaking the chat shell.
 * invariants: every route resolves the caller first; a message is only read
 *   through canSeeLobby, never by trusting a lobby id from the client.
 */
module.exports = function createRoutes(deps) {
  const { supabase, cors, requireUser, needVerified, readBody, isUuid, canSeeLobby, rateLimit } = deps;

  function send(res, code, body) {
    res.writeHead(code, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(body));
  }

  function noTable(err) {
    const code = String((err && err.code) || '');
    return code === 'PGRST205' || code === '42P01' || /does not exist|schema cache/i.test(String((err && err.message) || ''));
  }

  function notSetUp(res, what) {
    send(res, 503, { error: what + '_not_set_up', text: 'This needs the chat-extras migration first.' });
  }

  async function messageFor(userId, messageId) {
    if (!isUuid(messageId)) return null;
    const { data: msg } = await supabase.from('messages')
      .select('id, user_id, text, lobby_id, created_at, lobbies!messages_lobby_id_fkey(id, name, kind, server_id, is_private)')
      .eq('id', messageId).single();
    if (!msg) return null;
    const lob = msg.lobbies || {};
    const lobby = { id: msg.lobby_id, name: lob.name || '', kind: lob.kind || '', server_id: lob.server_id || null, is_private: !!lob.is_private };
    if (!(await canSeeLobby(userId, lobby))) return null;
    return { msg, lobby };
  }

  async function handle(req, res, url) {
    // ── Private notes ─────────────────────────────────────────────
    const noteMatch = /^\/api\/extras\/notes\/([^/]+)$/.exec(url.pathname);
    if (noteMatch) {
      cors(res);
      const user = await requireUser(req, res); if (!user) return;
      const target = noteMatch[1];
      if (!isUuid(target) || target === user.id) { send(res, 400, { error: 'Invalid user.' }); return; }
      if (req.method === 'GET') {
        const { data, error } = await supabase.from('contact_notes').select('note, updated_at')
          .eq('user_id', user.id).eq('target_id', target).maybeSingle();
        if (error) { if (noTable(error)) { notSetUp(res, 'notes'); return; } send(res, 500, { error: 'Could not read the note.' }); return; }
        send(res, 200, { note: (data && data.note) || '', updated_at: (data && data.updated_at) || null });
        return;
      }
      if (req.method === 'PUT') {
        if (!(await needVerified(user, res))) return;
        const body = await readBody(req, 8 * 1024).catch(() => ({}));
        const note = String((body && body.note) || '').replace(/\s+/g, ' ').trim().substring(0, 1000);
        const { error } = await supabase.from('contact_notes').upsert(
          { user_id: user.id, target_id: target, note, updated_at: new Date().toISOString() },
          { onConflict: 'user_id,target_id' }
        );
        if (error) { if (noTable(error)) { notSetUp(res, 'notes'); return; } send(res, 500, { error: 'Could not save the note.' }); return; }
        send(res, 200, { ok: true, note });
        return;
      }
      send(res, 405, { error: 'Method not allowed.' });
      return;
    }

    // ── Message reminders ─────────────────────────────────────────
    if (url.pathname === '/api/extras/reminders' && req.method === 'GET') {
      cors(res);
      const user = await requireUser(req, res); if (!user) return;
      const { data, error } = await supabase.from('message_reminders')
        .select('id, message_id, lobby_id, text, remind_at, sent_at, created_at')
        .eq('user_id', user.id).order('created_at', { ascending: false }).limit(50);
      if (error) { if (noTable(error)) { notSetUp(res, 'reminders'); return; } send(res, 500, { error: 'Could not load reminders.' }); return; }
      send(res, 200, { reminders: data || [] });
      return;
    }
    if (url.pathname === '/api/extras/reminders' && req.method === 'POST') {
      cors(res);
      const user = await requireUser(req, res); if (!user) return;
      if (!(await needVerified(user, res))) return;
      if (!rateLimit('reminder:' + user.id, 20, 60 * 1000)) { send(res, 429, { error: 'Slow down.' }); return; }
      const body = await readBody(req, 8 * 1024).catch(() => ({}));
      const found = await messageFor(user.id, String((body && body.messageId) || ''));
      if (!found) { send(res, 404, { error: 'Message not found.' }); return; }
      const at = new Date(body.remindAt || 0).getTime();
      if (!Number.isFinite(at) || at < Date.now() + 30 * 1000 || at > Date.now() + 366 * 86400000) {
        send(res, 400, { error: 'Pick a time between 30 seconds and a year from now.' });
        return;
      }
      const { data, error } = await supabase.from('message_reminders').insert({
        user_id: user.id,
        message_id: found.msg.id,
        lobby_id: found.msg.lobby_id,
        text: String(found.msg.text || '').substring(0, 200),
        remind_at: new Date(at).toISOString(),
      }).select('id, message_id, text, remind_at').single();
      if (error) { if (noTable(error)) { notSetUp(res, 'reminders'); return; } send(res, 500, { error: 'Could not set the reminder.' }); return; }
      send(res, 200, { ok: true, reminder: data });
      return;
    }
    const remMatch = /^\/api\/extras\/reminders\/([^/]+)$/.exec(url.pathname);
    if (remMatch && req.method === 'DELETE') {
      cors(res);
      const user = await requireUser(req, res); if (!user) return;
      if (!isUuid(remMatch[1])) { send(res, 400, { error: 'Invalid reminder.' }); return; }
      const { error } = await supabase.from('message_reminders').delete().eq('id', remMatch[1]).eq('user_id', user.id);
      if (error) { send(res, 500, { error: 'Could not remove the reminder.' }); return; }
      send(res, 200, { ok: true });
      return;
    }

    // ── Personal DM pins ──────────────────────────────────────────
    if (url.pathname === '/api/extras/pins' && req.method === 'GET') {
      cors(res);
      const user = await requireUser(req, res); if (!user) return;
      const lobbyName = String(url.searchParams.get('lobby') || '');
      if (!lobbyName) { send(res, 400, { error: 'lobby param required' }); return; }
      const { data: lob } = await supabase.from('lobbies').select('id, name, kind, server_id, is_private').eq('name', lobbyName).single();
      if (!lob || lob.kind !== 'dm' || !(await canSeeLobby(user.id, lob))) { send(res, 404, { error: 'Not found.' }); return; }
      const { data: rows, error } = await supabase.from('message_pins')
        .select('message_id, created_at').eq('user_id', user.id).order('created_at', { ascending: false }).limit(50);
      if (error) { if (noTable(error)) { notSetUp(res, 'pins'); return; } send(res, 500, { error: 'Could not load pins.' }); return; }
      const ids = (rows || []).map(r => r.message_id);
      var byId = {};
      if (ids.length) {
        const { data: msgs } = await supabase.from('messages').select('id, text, display_name, created_at, lobby_id').in('id', ids).eq('lobby_id', lob.id);
        (msgs || []).forEach(m => { byId[m.id] = m; });
      }
      const pins = (rows || []).filter(r => byId[r.message_id]).map(r => ({
        message_id: r.message_id, pinned_at: r.created_at,
        text: byId[r.message_id].text, display_name: byId[r.message_id].display_name,
        created_at: byId[r.message_id].created_at,
      }));
      send(res, 200, { pins });
      return;
    }
    if (url.pathname === '/api/extras/pins' && req.method === 'POST') {
      cors(res);
      const user = await requireUser(req, res); if (!user) return;
      if (!(await needVerified(user, res))) return;
      const body = await readBody(req, 8 * 1024).catch(() => ({}));
      const found = await messageFor(user.id, String((body && body.messageId) || ''));
      if (!found || found.lobby.kind !== 'dm') { send(res, 404, { error: 'Direct messages only.' }); return; }
      const { error } = await supabase.from('message_pins').upsert(
        { user_id: user.id, message_id: found.msg.id }, { onConflict: 'user_id,message_id' }
      );
      if (error) { if (noTable(error)) { notSetUp(res, 'pins'); return; } send(res, 500, { error: 'Could not pin.' }); return; }
      send(res, 200, { ok: true, pinned: true });
      return;
    }
    const pinMatch = /^\/api\/extras\/pins\/([^/]+)$/.exec(url.pathname);
    if (pinMatch && req.method === 'DELETE') {
      cors(res);
      const user = await requireUser(req, res); if (!user) return;
      if (!isUuid(pinMatch[1])) { send(res, 400, { error: 'Invalid message.' }); return; }
      const { error } = await supabase.from('message_pins').delete().eq('user_id', user.id).eq('message_id', pinMatch[1]);
      if (error) { send(res, 500, { error: 'Could not unpin.' }); return; }
      send(res, 200, { ok: true, pinned: false });
      return;
    }

    // ── Mutual interests (public profile data only) ───────────────
    const mutMatch = /^\/api\/extras\/mutual\/([^/]+)$/.exec(url.pathname);
    if (mutMatch && req.method === 'GET') {
      cors(res);
      const user = await requireUser(req, res); if (!user) return;
      const target = mutMatch[1];
      if (!isUuid(target) || target === user.id) { send(res, 400, { error: 'Invalid user.' }); return; }
      const [meRes, themRes] = await Promise.all([
        supabase.from('users').select('interests').eq('id', user.id).maybeSingle(),
        supabase.from('users').select('interests, status_emoji, status_text').eq('id', target).maybeSingle(),
      ]);
      const mine = (meRes.data && Array.isArray(meRes.data.interests)) ? meRes.data.interests : [];
      const theirs = (themRes.data && Array.isArray(themRes.data.interests)) ? themRes.data.interests : [];
      const set = new Set(mine.map(x => String(x).toLowerCase()));
      const shared = theirs.filter(x => set.has(String(x).toLowerCase())).slice(0, 10);
      send(res, 200, {
        shared,
        status_emoji: (themRes.data && themRes.data.status_emoji) || '',
        status_text: (themRes.data && themRes.data.status_text) || '',
      });
      return;
    }

    send(res, 404, { error: 'Not found.' });
  }

  return { handle, matches };
};

function matches(pathname) {
  return pathname.startsWith('/api/extras/');
}
