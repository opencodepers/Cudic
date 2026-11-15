/* file: lib/routes/chat.js
 * what: Chat routes — conversations, people, friends, DMs and read state. Extracted verbatim from server.js so the chat surface
 *   can grow without editing the monolith; routing order is unchanged.
 * invariants: handle() is called only when matches() is true, and server.js
 *   falls through when nothing was written (res.headersSent is false). Every
 *   early `return` inside a route still exits the whole handler on purpose.
 */
module.exports = function createRoutes(deps) {  const { supabase, cors, requireUser, needVerified, readBody, isUuid, dmRoomName, chanDisplay, sendConversationsDirty, canSeeLobby, serverRole, notify, logActivity, isModerator, rateLimit, lobbies, awardUser } = deps;

  // Ten accepted friendships earns Socialite. One row per friend on the
  // caller's side, so the count is exact; the badge insert is idempotent.
  async function awardSocialite(uid) {
    try {
      const { count } = await supabase.from('friendships').select('user_id', { count: 'exact', head: true })
        .eq('user_id', uid).eq('status', 'accepted');
      if ((count || 0) >= 10) await awardUser(uid, 'socialite');
    } catch (e) {}
  }

  async function handle(req, res, url) {
    if (url.pathname === '/api/conversations' && req.method === 'GET') {
      cors(res);
      const user = await requireUser(req, res); if (!user) return;
      const me = user.id;
      const { data: memberRows } = await supabase.from('server_members').select('server_id').eq('user_id', me);
      const serverIds = [...new Set((memberRows || []).map(r => r.server_id))];
      const { data: ownedRows } = await supabase.from('servers').select('id').eq('owner_id', me);
      const ownedIds = (ownedRows || []).map(r => r.id);
      ownedIds.forEach(id => { if (!serverIds.includes(id)) serverIds.push(id); });
      const { data: myRows } = await supabase.from('conversation_members').select('lobby_id').eq('user_id', me);
      const myIds = (myRows || []).map(r => r.lobby_id);
      var lobbyRows = [];
      if (myIds.length) {
        const { data } = await supabase.from('lobbies').select('id, name, kind, server_id, topic, is_private, slow_seconds, created_at').in('id', myIds);
        (data || []).forEach(r => lobbyRows.push(r));
      }
      if (serverIds.length) {
        const { data } = await supabase.from('lobbies').select('id, name, kind, server_id, topic, is_private, slow_seconds, created_at').eq('kind', 'channel').in('server_id', serverIds).eq('is_private', false);
        (data || []).forEach(r => { if (!lobbyRows.some(x => x.id === r.id)) lobbyRows.push(r); });
      }
      if (ownedIds.length) {
        const { data } = await supabase.from('lobbies').select('id, name, kind, server_id, topic, is_private, slow_seconds, created_at').eq('kind', 'channel').in('server_id', ownedIds);
        (data || []).forEach(r => { if (!lobbyRows.some(x => x.id === r.id)) lobbyRows.push(r); });
      }
      if (!lobbyRows.length) { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ conversations: [] })); return; }
      const lobbyIds = lobbyRows.map(r => r.id);
      const srvIds = [...new Set(lobbyRows.map(r => r.server_id).filter(Boolean))];
      var srvById = {};
      if (srvIds.length) {
        const { data: srvs } = await supabase.from('servers').select('id, name').in('id', srvIds);
        (srvs || []).forEach(s => { srvById[s.id] = s.name; });
      }
      const dmIds = lobbyRows.filter(r => r.kind === 'dm').map(r => r.id);
      var peerByLobby = {};
      if (dmIds.length) {
        const { data: parts } = await supabase.from('conversation_members').select('lobby_id, user_id').in('lobby_id', dmIds).neq('user_id', me);
        const peerIds = [...new Set((parts || []).map(p => p.user_id))];
        var peerById = {};
        if (peerIds.length) {
          const { data: peers } = await supabase.from('users').select('id, display_name, avatar_url, user_id').in('id', peerIds);
          (peers || []).forEach(p => { peerById[p.id] = p; });
        }
        (parts || []).forEach(p => { if (!peerByLobby[p.lobby_id] && peerById[p.user_id]) peerByLobby[p.lobby_id] = peerById[p.user_id]; });
      }
      const { data: stateRows } = await supabase.from('conversation_state').select('lobby_id, last_read_at').eq('user_id', me).in('lobby_id', lobbyIds);
      var readByLobby = {};
      (stateRows || []).forEach(s => { readByLobby[s.lobby_id] = s.last_read_at; });
      var out = await Promise.all(lobbyRows.map(async (row) => {
        const { data: lastRows } = await supabase.from('messages').select('text, display_name, created_at, user_id').eq('lobby_id', row.id).order('created_at', { ascending: false }).limit(1);
        const last = (lastRows && lastRows[0]) || null;
        var unread = 0;
        if (last) {
          var uq = supabase.from('messages').select('id', { count: 'exact', head: true }).eq('lobby_id', row.id).neq('user_id', me);
          if (readByLobby[row.id]) uq = uq.gt('created_at', readByLobby[row.id]);
          const { count } = await uq;
          unread = count || 0;
        }
        var online = 0;
        try { const rm = lobbies.get(row.name); if (rm) online = rm.size; } catch (e) {}
        const item = { id: row.id, name: row.name, kind: row.kind, topic: row.topic || '', is_private: !!row.is_private, slow_seconds: row.slow_seconds || 0, last, unread, online };
        if (row.kind === 'dm') {
          const peer = peerByLobby[row.id] || null;
          item.display = peer ? peer.display_name : 'Direct message';
          item.peer = peer;
        } else {
          item.server_id = row.server_id;
          item.server_name = srvById[row.server_id] || '';
          item.display = chanDisplay(row.name);
        }
        item.sortKey = (last && last.created_at) || row.created_at;
        return item;
      }));
      // Rows resolve in parallel: two queries per conversation were serial, so a
      // long sidebar waited on 2N round-trips back to back.
      out.sort((a, b) => (a.sortKey < b.sortKey ? 1 : -1));
      out.forEach(o => delete o.sortKey);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ conversations: out }));
      return;
    }

    // ── API: find people (start a DM) ──────────────────────────────
    if (url.pathname === '/api/people' && req.method === 'GET') {
      cors(res);
      const user = await requireUser(req, res); if (!user) return;
      const me = user.id;
      const q = (url.searchParams.get('q') || '').trim();
      if (q.length < 2) { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ people: [] })); return; }
      var pq = supabase.from('users').select('id, display_name, avatar_url, user_id').neq('id', me).limit(20);
      if (/^\d+$/.test(q)) pq = pq.eq('user_id', parseInt(q, 10));
      else pq = pq.ilike('display_name', '%' + q.replace(/[%_\\]/g, '') + '%');
      const { data: people } = await pq;
      const { data: myFr } = await supabase.from('friendships').select('user_id, friend_id, status').or('user_id.eq.' + me + ',friend_id.eq.' + me);
      var fmap = {};
      (myFr || []).forEach(f => {
        const other = f.user_id === me ? f.friend_id : f.user_id;
        if (f.status === 'accepted') fmap[other] = 'accepted';
        else if (!fmap[other]) fmap[other] = (f.user_id === me ? 'pending_out' : 'pending_in');
      });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ people: (people || []).map(p => ({ id: p.id, display_name: p.display_name, avatar_url: p.avatar_url, user_id: p.user_id, friendship: fmap[p.id] || 'none' })) }));
      return;
    }

    // ── API: friends (accepted + pending both ways) ────────────────
    if (url.pathname === '/api/friends' && req.method === 'GET') {
      cors(res);
      const user = await requireUser(req, res); if (!user) return;
      const me = user.id;
      const [fRes, outF, inF] = await Promise.all([
        supabase.from('friendships').select('user_id, friend_id, status, created_at').or('user_id.eq.' + me + ',friend_id.eq.' + me),
        supabase.from('follows').select('followed_id, created_at').eq('follower_id', me),
        supabase.from('follows').select('follower_id, created_at').eq('followed_id', me)
      ]);
      const rows = fRes.data;
      const ids = [...new Set([
        ...((rows || []).map(f => (f.user_id === me ? f.friend_id : f.user_id))),
        ...((outF.data || []).map(r => r.followed_id)),
        ...((inF.data || []).map(r => r.follower_id))
      ])];
      var byId = {};
      if (ids.length) {
        const { data: us } = await supabase.from('users').select('id, display_name, avatar_url, user_id').in('id', ids);
        (us || []).forEach(u => { byId[u.id] = u; });
      }
      var friends = [], incoming = [], outgoing = [];
      var seen = {};
      (rows || []).forEach(f => {
        const other = f.user_id === me ? f.friend_id : f.user_id;
        const u = byId[other];
        if (!u) return;
        const entry = { id: u.id, display_name: u.display_name, avatar_url: u.avatar_url, user_id: u.user_id, since: f.created_at };
        if (f.status === 'accepted') { if (!seen[other]) { seen[other] = 1; friends.push(entry); } }
        else if (f.user_id === me) outgoing.push(entry);
        else incoming.push(entry);
      });
      var following = [], followers = [];
      (outF.data || []).forEach(r => {
        const u = byId[r.followed_id];
        if (u) following.push({ id: u.id, display_name: u.display_name, avatar_url: u.avatar_url, user_id: u.user_id, since: r.created_at });
      });
      (inF.data || []).forEach(r => {
        const u = byId[r.follower_id];
        if (u) followers.push({ id: u.id, display_name: u.display_name, avatar_url: u.avatar_url, user_id: u.user_id, since: r.created_at });
      });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ friends, incoming, outgoing, following, followers }));
      return;
    }

    if (url.pathname === '/api/friends' && req.method === 'POST') {
      cors(res);
      const user = await requireUser(req, res); if (!user) return;
      const me = user.id;
      const body = await readBody(req).catch(() => ({}));
      const targetId = String(body.userId || '').trim();
      if (!isUuid(targetId) || targetId === me) { res.writeHead(400, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'Invalid user.' })); return; }
      const { data: target } = await supabase.from('users').select('id').eq('id', targetId).single();
      if (!target) { res.writeHead(404, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'User not found.' })); return; }
      if (!(await needVerified(user, res))) return;
      const { data: mine } = await supabase.from('friendships').select('status').eq('user_id', me).eq('friend_id', targetId).single();
      const { data: theirs } = await supabase.from('friendships').select('status').eq('user_id', targetId).eq('friend_id', me).single();
      if (mine || theirs) {
        if (theirs && theirs.status === 'pending' && !mine) {
          // They already asked: accept on the spot instead of deadlocking.
          await supabase.from('friendships').update({ status: 'accepted' }).eq('user_id', targetId).eq('friend_id', me);
          await supabase.from('friendships').upsert({ user_id: me, friend_id: targetId, status: 'accepted' }, { onConflict: 'user_id,friend_id' });
          await awardSocialite(me);
          res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ status: 'accepted' })); return;
        }
        res.writeHead(400, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'Already friends or requested.' })); return;
      }
      await supabase.from('friendships').insert({ user_id: me, friend_id: targetId, status: 'pending' });
      const { data: rn } = await supabase.from('users').select('display_name').eq('id', me).single();
      notify(targetId, 'friend', 'Friend request from ' + (rn ? rn.display_name : 'someone'), 'Open your Friends page to accept or decline.', 'user', me);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'pending' }));
      return;
    }

    // ── API: accept / decline a friend request ─────────────────────
    if (url.pathname.startsWith('/api/friends/') && (req.method === 'POST') && (url.pathname.endsWith('/accept') || url.pathname.endsWith('/decline'))) {
      cors(res);
      const user = await requireUser(req, res); if (!user) return;
      const me = user.id;
      const parts = url.pathname.split('/');
      const otherId = parts[3];
      if (!(await needVerified(user, res))) return;
      const accept = url.pathname.endsWith('/accept');
      if (!isUuid(otherId)) { res.writeHead(400, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'Invalid user.' })); return; }
      const { data: req1 } = await supabase.from('friendships').select('user_id').eq('user_id', otherId).eq('friend_id', me).eq('status', 'pending').single();
      if (!req1) { res.writeHead(404, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'No pending request.' })); return; }
      if (accept) {
        await supabase.from('friendships').update({ status: 'accepted' }).eq('user_id', otherId).eq('friend_id', me);
        await supabase.from('friendships').upsert({ user_id: me, friend_id: otherId, status: 'accepted' }, { onConflict: 'user_id,friend_id' });
        await awardSocialite(me);
        // Notify the requester that their request was accepted.
        try { await supabase.from('notifications').insert({
          user_id: otherId,
          kind: 'friend',
          title: 'Friend request accepted',
          body: 'You are now friends.',
          ref_type: 'user',
          ref_id: me
        }); } catch (e) {}
      } else {
        await supabase.from('friendships').delete().eq('user_id', otherId).eq('friend_id', me);
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
      return;
    }

    // ── API: remove a friend ───────────────────────────────────────
    if (url.pathname.startsWith('/api/friends/') && req.method === 'DELETE') {
      cors(res);
      const user = await requireUser(req, res); if (!user) return;
      const me = user.id;
      const otherId = url.pathname.split('/')[3];
      if (!(await needVerified(user, res))) return;
      if (!isUuid(otherId)) { res.writeHead(400, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'Invalid user.' })); return; }
      await supabase.from('friendships').delete().eq('user_id', me).eq('friend_id', otherId);
      await supabase.from('friendships').delete().eq('user_id', otherId).eq('friend_id', me);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
      return;
    }

    // ── API: open a DM (any signed-in user) ────────────────────────
    if (url.pathname === '/api/dm' && req.method === 'POST') {
      cors(res);
      const user = await requireUser(req, res); if (!user) return;
      const me = user.id;
      const body = await readBody(req).catch(() => ({}));
      const targetId = String(body.userId || '').trim();
      if (!isUuid(targetId) || targetId === me) { res.writeHead(400, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'Invalid user.' })); return; }
      const { data: target } = await supabase.from('users').select('id').eq('id', targetId).single();
      if (!target) { res.writeHead(404, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'User not found.' })); return; }
      if (!(await needVerified(user, res))) return;
      // Open DMs: any signed-in user can message anyone. (Friendship is
      // social, not a gate. Block/mute is the follow-up for abuse.)
      const name = dmRoomName(me, targetId);
      let { data: lobby } = await supabase.from('lobbies').select('id, name').eq('name', name).single();
      if (!lobby) {
        const { data: created } = await supabase.from('lobbies').insert({ name, kind: 'dm', is_private: true, created_by: me }).select('id, name').single();
        lobby = created;
      }
      if (!lobby) { res.writeHead(500, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'Could not open conversation.' })); return; }
      await supabase.from('conversation_members').upsert([{ user_id: me, lobby_id: lobby.id }, { user_id: targetId, lobby_id: lobby.id }], { onConflict: 'user_id,lobby_id' });
      sendConversationsDirty();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ id: lobby.id, name: lobby.name }));
      return;
    }

    if (url.pathname.startsWith('/api/conversations/') && url.pathname.endsWith('/read') && req.method === 'POST') {
      cors(res);
      const user = await requireUser(req, res); if (!user) return;
      const me = user.id;
      const cid = url.pathname.split('/')[3];
      if (!isUuid(cid)) { res.writeHead(400, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'Invalid conversation.' })); return; }
      const { data: lobby } = await supabase.from('lobbies').select('id, name, kind, server_id, is_private').eq('id', cid).single();
      if (!lobby || !(await canSeeLobby(me, lobby))) { res.writeHead(404, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'Not found.' })); return; }
      await supabase.from('conversation_state').upsert({ user_id: me, lobby_id: cid, last_read_at: new Date().toISOString() }, { onConflict: 'user_id,lobby_id' });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
      return;
    }

    // ── API: peer read state (DMs only) ──────────────────────────
    // Returns the other participant's last_read_at so own messages can
    // render sent (✓) vs seen (✓✓). Only visible to DM participants.
    if (url.pathname.startsWith('/api/conversations/') && url.pathname.endsWith('/peer') && req.method === 'GET') {
      cors(res);
      const user = await requireUser(req, res); if (!user) return;
      const me = user.id;
      const cid = url.pathname.split('/')[3];
      if (!isUuid(cid)) { res.writeHead(400, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'Invalid conversation.' })); return; }
      const { data: lobby } = await supabase.from('lobbies').select('id, name, kind').eq('id', cid).single();
      if (!lobby || lobby.kind !== 'dm' || !(await canSeeLobby(me, lobby))) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Not found.' }));
        return;
      }
      const { data: parts } = await supabase.from('conversation_members').select('user_id').eq('lobby_id', cid).neq('user_id', me).limit(1);
      const peerId = parts && parts[0] && parts[0].user_id;
      var lastRead = null;
      // Receipts are reciprocal: if either side turned sharing off, neither
      // side sees read state. A missing column reads as "sharing on".
      var mineShares = true, peerShares = true;
      try {
        const { data: rows } = await supabase.from('users').select('id, read_receipts').in('id', [me, peerId].filter(Boolean));
        (rows || []).forEach(r => {
          if (r.id === me && r.read_receipts === false) mineShares = false;
          if (r.id === peerId && r.read_receipts === false) peerShares = false;
        });
      } catch (e) {}
      if (mineShares && peerShares && peerId) {
        const { data: st } = await supabase.from('conversation_state').select('last_read_at').eq('user_id', peerId).eq('lobby_id', cid).single();
        if (st) lastRead = st.last_read_at;
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ last_read_at: lastRead }));
      return;
    }

  }

  return { handle, matches };
};

function matches(pathname) {
  return pathname === '/api/conversations' || pathname.startsWith('/api/conversations/')
    || pathname === '/api/people' || pathname === '/api/friends'
    || pathname.startsWith('/api/friends/') || pathname === '/api/dm';
}
