/* file: lib/routes/messages.js
 * what: Message routes — history, reactions, pins and search. Extracted verbatim from server.js so the chat surface
 *   can grow without editing the monolith; routing order is unchanged.
 * invariants: handle() is called only when matches() is true, and server.js
 *   falls through when nothing was written (res.headersSent is false). Every
 *   early `return` inside a route still exits the whole handler on purpose.
 */
module.exports = function createRoutes(deps) {
  const { supabase, cors, requireUser, needVerified, readBody, isUuid, validName, canSeeLobby, serverRole, broadcast, rateLimit } = deps;

  async function handle(req, res, url) {
    if (url.pathname === '/api/messages') {
      cors(res);
      const user = await requireUser(req, res); if (!user) return;
      const lobbyName = url.searchParams.get('lobby');
      if (!lobbyName) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'lobby param required' }));
        return;
      }
      if (!validName(lobbyName)) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid lobby name.' }));
        return;
      }

      // No creation here: conversations are opened via /api/dm or channel create.
      const { data: lobby } = await supabase
        .from('lobbies')
        .select('id, name, kind, server_id, is_private')
        .eq('name', lobbyName)
        .single();

      // Deliberately 404 (not 403) so room names can't be probed.
      if (!lobby || !(await canSeeLobby(user.id, lobby))) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Not found.' }));
        return;
      }

      // Newest 100, then flipped back to oldest-first for the client.
      // Optional `before` cursor (ISO timestamp) loads the 100 messages
      // older than it, for pagination.
      const before = url.searchParams.get('before');
      let q = supabase
        .from('messages')
        .select('id, display_name, text, created_at, user_id, pinned, answered_at, users!messages_user_id_fkey(avatar_url)')
        .eq('lobby_id', lobby.id)
        .order('created_at', { ascending: false })
        .limit(100);
      if (before) q = q.lt('created_at', before);
      // ?pinned=1 powers the pinned shelf on the client — same room gate
      // above, so it can't leak pins from a channel you can't open.
      if (url.searchParams.get('pinned') === '1') q = q.eq('pinned', true);
      let { data: recent, error: histErr } = await q;
      // answered_at is additive: before the batch migration the room still
      // opens with plain history instead of failing the whole channel.
      if (histErr && /answered_at|schema cache|column/i.test(String(histErr.message || ''))) {
        const fb = await supabase.from('messages')
          .select('id, display_name, text, created_at, user_id, pinned, users!messages_user_id_fkey(avatar_url)')
          .eq('lobby_id', lobby.id).order('created_at', { ascending: false }).limit(100);
        recent = fb.data;
      }
      const messages = (recent || []).reverse();

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ messages: messages, persistent: true }));
      return;
    }

    // ── API: reactions summary for a room ────────────────────────
    // GET /api/messages/reactions?lobby=<name> — aggregates the room's recent
    // reactions so an opened chat paints existing emoji without waiting for a
    // broadcast. Same visibility gate as history; capped at the newest 200
    // messages so a huge room can't make this endpoint heavy.
    if (url.pathname === '/api/messages/reactions' && req.method === 'GET') {
      cors(res);
      const user = await requireUser(req, res); if (!user) return;
      const lobbyName = String(url.searchParams.get('lobby') || '');
      if (!validName(lobbyName)) { res.writeHead(400, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'Invalid lobby name.' })); return; }
      const { data: lob } = await supabase.from('lobbies').select('id, name, kind, server_id, is_private').eq('name', lobbyName).single();
      if (!lob || !(await canSeeLobby(user.id, lob))) { res.writeHead(404, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'Not found.' })); return; }
      const { data: recent } = await supabase.from('messages').select('id').eq('lobby_id', lob.id).order('created_at', { ascending: false }).limit(200);
      const ids = (recent || []).map(m => m.id);
      var reactions = {};
      if (ids.length) {
        const { data: rows } = await supabase.from('message_reactions').select('message_id, emoji').in('message_id', ids);
        for (const r of rows || []) {
          if (!reactions[r.message_id]) reactions[r.message_id] = {};
          reactions[r.message_id][r.emoji] = (reactions[r.message_id][r.emoji] || 0) + 1;
        }
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ reactions }));
      return;
    }

    // ── API: search messages in one conversation ──────────────────
    // Same gate as reading a room (canSeeLobby), so search can't be used to
    // read channels you can't open. 3+ chars, newest first.
    // ── API: pin / unpin a message (author or the channel's owner/mod) ─
    // POST /api/messages/:mid/pin { pin: true|false } — toggles the flag.
    // Pinned rows ride the normal ?pinned=1 history fetch; a live WS event
    // lets the open room re-render its pinned shelf without a reload.
    const msgMid = /^\/api\/messages\/([^/]+)\/(pin|react)$/.exec(url.pathname);
    if (msgMid && req.method === 'POST' && msgMid[2] === 'pin') {
      cors(res);
      const user = await requireUser(req, res); if (!user) return;
      if (!(await needVerified(user, res))) return;
      const mid = msgMid[1];
      if (!isUuid(mid)) { res.writeHead(400, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'Invalid message.' })); return; }
      const { data: msg } = await supabase.from('messages').select('id, user_id, lobby_id, lobbies!messages_lobby_id_fkey(id, name, kind, server_id)').eq('id', mid).single();
      if (!msg) { res.writeHead(404, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'Not found.' })); return; }
      let allowed = msg.user_id === user.id;
      if (!allowed && msg.lobbies && msg.lobbies.server_id) {
        const { role } = await serverRole(user.id, msg.lobbies.server_id);
        allowed = role === 'owner' || role === 'mod';
      }
      if (!allowed) { res.writeHead(403, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'Not your message or channel.' })); return; }
      const body = await readBody(req).catch(() => ({}));
      const pinned = !!(body && body.pin);
      const { error } = await supabase.from('messages').update({ pinned }).eq('id', mid);
      if (error) { res.writeHead(500, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'Could not pin.' })); return; }
      if (msg.lobbies && msg.lobbies.name) broadcast(msg.lobbies.name, { type: 'pin', lobby: msg.lobbies.name, id: mid, pinned });
      res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ ok: true, pinned }));
      return;
    }
    // ── API: reactions on a message ─────────────────────────────────
    // One row per (message, user, emoji) — reacting twice with the same
    // emoji upserts, never double-counts. Visible only if you can see the
    // conversation (same rule as history); a live WS event updates open rooms.
    if (msgMid && msgMid[2] === 'react' && (req.method === 'POST' || req.method === 'DELETE')) {
      cors(res);
      const user = await requireUser(req, res); if (!user) return;
      if (!(await needVerified(user, res))) return;
      if (!rateLimit('react:' + user.id, 30, 60 * 1000)) { res.writeHead(429, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'Slow down.' })); return; }
      const mid = msgMid[1];
      if (!isUuid(mid)) { res.writeHead(400, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'Invalid message.' })); return; }
      const { data: msg } = await supabase.from('messages').select('id, lobby_id, lobbies!messages_lobby_id_fkey(id, name)').eq('id', mid).single();
      if (!msg) { res.writeHead(404, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'Not found.' })); return; }
      const { data: lob } = await supabase.from('lobbies').select('id, kind, server_id, is_private').eq('id', msg.lobby_id).single();
      if (!lob || !(await canSeeLobby(user.id, { ...lob, name: (msg.lobbies && msg.lobbies.name) || '' }))) { res.writeHead(404, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'Not found.' })); return; }
      const body = await readBody(req).catch(() => ({}));
      const emoji = String((body && body.emoji) || '').trim();
      if (!emoji || emoji.length > 8 || /[<>"'`\\]/.test(emoji)) { res.writeHead(400, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'Invalid emoji.' })); return; }
      if (req.method === 'POST') {
        const { error } = await supabase.from('message_reactions').upsert({ message_id: mid, user_id: user.id, emoji });
        if (error) { res.writeHead(500, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'Could not react.' })); return; }
      } else {
        await supabase.from('message_reactions').delete().eq('message_id', mid).eq('user_id', user.id).eq('emoji', emoji);
      }
      const { data: rows } = await supabase.from('message_reactions').select('emoji, user_id').eq('message_id', mid);
      const counts = {};
      for (const r of rows || []) counts[r.emoji] = (counts[r.emoji] || 0) + 1;
      if (msg.lobbies && msg.lobbies.name) broadcast(msg.lobbies.name, { type: 'react', lobby: msg.lobbies.name, id: mid, counts });
      res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ ok: true, counts }));
      return;
    }

    if (url.pathname === '/api/messages/search') {
      cors(res);
      const user = await requireUser(req, res); if (!user) return;
      const lobbyName = url.searchParams.get('lobby') || '';
      const q = String(url.searchParams.get('q') || '').trim();
      if (!validName(lobbyName) || q.length < 3) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'lobby param and 3+ characters required' }));
        return;
      }
      const { data: lobby } = await supabase
        .from('lobbies')
        .select('id, name, kind, server_id, is_private')
        .eq('name', lobbyName)
        .single();
      if (!lobby || !(await canSeeLobby(user.id, lobby))) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Not found.' }));
        return;
      }
      let search = supabase
        .from('messages')
        .select('id, display_name, text, created_at, user_id, answered_at')
        .eq('lobby_id', lobby.id)
        .ilike('text', '%' + q.slice(0, 60).replace(/[%_\\]/g, '') + '%');
      // Optional filters stay on the same membership-gated query: a date or
      // author narrows the room, it never widens access.
      const from = String(url.searchParams.get('from') || '').trim();
      if (from) search = search.ilike('display_name', '%' + from.slice(0, 24).replace(/[%_\\]/g, '') + '%');
      const after = String(url.searchParams.get('after') || '').trim();
      if (after) { const t = Date.parse(after); if (Number.isFinite(t)) search = search.gte('created_at', new Date(t).toISOString()); }
      const beforeAt = String(url.searchParams.get('before') || '').trim();
      if (beforeAt) { const t = Date.parse(beforeAt); if (Number.isFinite(t)) search = search.lte('created_at', new Date(t + 86399999).toISOString()); }
      if (url.searchParams.get('has') === 'link') search = search.ilike('text', '%http%');
      const { data: hits } = await search.order('created_at', { ascending: false }).limit(50);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ results: hits || [] }));
      return;
    }

  }

  return { handle, matches };
};

function matches(pathname) {
  return pathname === '/api/messages' || pathname.startsWith('/api/messages/');
}
