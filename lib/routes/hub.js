/* file: lib/routes/hub.js
 * what: The three surfaces that read across Cudic — the universal inbox, search
 *   across every conversation and server the caller can open, and the home
 *   dashboard built from the same two reads.
 * invariants: every route resolves the caller first. Search filters messages by
 *   lobby ids taken from membership rows, never by an id supplied by the client,
 *   so a search can never widen access. A missing table or column hides one
 *   section and answers 503 for the write that needs it; it never turns the
 *   inbox into an empty page that looks like "nothing happened".
 */
module.exports = function createRoutes(deps) {
  const { supabase, cors, requireUser, readBody, isUuid, canSeeLobby, serverRole, rateLimit } = deps;

  const HOME_CARDS = ['inbox', 'servers', 'events', 'games', 'activity'];

  function send(res, code, body) {
    res.writeHead(code, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(body));
  }
  function noTable(err) {
    const code = String((err && err.code) || '');
    return code === 'PGRST205' || code === '42P01' || /does not exist|schema cache/i.test(String((err && err.message) || ''));
  }
  function clean(value, max) {
    return String(value == null ? '' : value).trim().slice(0, max).replace(/[%_\\]/g, '');
  }
  function refHref(kind, id) {
    if (!id) return null;
    if (kind === 'game') return '/view.html?id=' + encodeURIComponent(id);
    if (kind === 'user') return '/creator?id=' + encodeURIComponent(id);
    if (kind === 'server') return '/server/' + encodeURIComponent(id);
    if (kind === 'forum' || kind === 'thread' || kind === 'post') return '/forums?id=' + encodeURIComponent(id);
    return null;
  }

  // Every lobby this person can already open: the conversations they are a
  // member of, public channels of servers they belong to, and every channel of
  // a server they own. Bounded so one huge account cannot build an unbounded
  // `in (...)` list.
  async function visibleLobbyIds(me) {
    const [memRes, ownedRes, convRes] = await Promise.all([
      supabase.from('server_members').select('server_id').eq('user_id', me).limit(200),
      supabase.from('servers').select('id').eq('owner_id', me).limit(100),
      supabase.from('conversation_members').select('lobby_id').eq('user_id', me).limit(500),
    ]);
    const ids = new Set((convRes.data || []).map(r => r.lobby_id));
    const members = new Set((memRes.data || []).map(r => r.server_id));
    const owned = new Set((ownedRes.data || []).map(r => r.id));
    const all = [...new Set([...members, ...owned])];
    if (all.length) {
      const { data: pub } = await supabase.from('lobbies')
        .select('id').eq('kind', 'channel').in('server_id', all).eq('is_private', false).limit(500);
      (pub || []).forEach(r => ids.add(r.id));
    }
    if (owned.size) {
      const { data: own } = await supabase.from('lobbies')
        .select('id').eq('kind', 'channel').in('server_id', [...owned]).limit(500);
      (own || []).forEach(r => ids.add(r.id));
    }
    return [...ids].filter(isUuid).slice(0, 500);
  }

  // Unread DMs, newest activity first. Read state is the existing
  // conversation_state row, so "read" means the same thing here as in chat.
  async function unreadDms(me) {
    const { data: mine } = await supabase.from('conversation_members').select('lobby_id').eq('user_id', me).limit(500);
    const ids = (mine || []).map(r => r.lobby_id);
    if (!ids.length) return { items: [], unread: 0 };
    const { data: dms } = await supabase.from('lobbies').select('id, name').eq('kind', 'dm').in('id', ids).limit(100);
    const dmIds = (dms || []).map(r => r.id);
    if (!dmIds.length) return { items: [], unread: 0 };
    const { data: states } = await supabase.from('conversation_state')
      .select('lobby_id, last_read_at').eq('user_id', me).in('lobby_id', dmIds);
    const readBy = {};
    (states || []).forEach(s => { readBy[s.lobby_id] = s.last_read_at; });
    const { data: recent } = await supabase.from('messages')
      .select('lobby_id, text, display_name, created_at, user_id')
      .in('lobby_id', dmIds).order('created_at', { ascending: false }).limit(200);
    const lastBy = {};
    (recent || []).forEach(m => { if (!lastBy[m.lobby_id]) lastBy[m.lobby_id] = m; });
    const ordered = dmIds.filter(id => lastBy[id])
      .sort((a, b) => String(lastBy[b].created_at).localeCompare(String(lastBy[a].created_at)))
      .slice(0, 15);
    const items = [];
    var unread = 0;
    for (const lobbyId of ordered) {
      const last = lastBy[lobbyId];
      if (last.user_id === me) continue;
      var q = supabase.from('messages').select('id', { count: 'exact', head: true })
        .eq('lobby_id', lobbyId).neq('user_id', me);
      if (readBy[lobbyId]) q = q.gt('created_at', readBy[lobbyId]);
      const { count } = await q;
      if (!count) continue;
      unread += count;
      items.push({
        id: 'dm:' + lobbyId,
        kind: 'dm',
        lobby_id: lobbyId,
        title: last.display_name || 'Direct message',
        body: String(last.text || '').slice(0, 160),
        when: last.created_at,
        count,
        href: '/chat?c=' + encodeURIComponent(lobbyId),
      });
    }
    return { items, unread };
  }

  async function notificationItems(me, limit) {
    const { data, error } = await supabase.from('notifications')
      .select('id, kind, title, body, ref_type, ref_id, read_at, created_at')
      .eq('user_id', me).order('created_at', { ascending: false }).limit(limit || 60);
    if (error) return { items: [], unread: 0, missing: noTable(error) };
    const items = (data || []).map(n => ({
      id: 'n:' + n.id,
      kind: n.kind || 'notice',
      title: n.title || 'Notification',
      body: n.body || '',
      when: n.created_at,
      unread: !n.read_at,
      href: refHref(n.ref_type, n.ref_id),
    }));
    return { items, unread: items.filter(i => i.unread).length };
  }

  async function handle(req, res, url) {
    // ── Universal inbox ─────────────────────────────────────────
    if (url.pathname === '/api/inbox' && req.method === 'GET') {
      cors(res);
      const user = await requireUser(req, res); if (!user) return;
      const [dms, notes] = await Promise.all([unreadDms(user.id), notificationItems(user.id)]);
      const items = dms.items.concat(notes.items)
        .sort((a, b) => String(b.when).localeCompare(String(a.when)))
        .slice(0, 80);
      send(res, 200, {
        items,
        unread: dms.unread + notes.unread,
        unread_dms: dms.unread,
        unread_notifications: notes.unread,
      });
      return;
    }

    if ((url.pathname === '/api/inbox/read' || url.pathname === '/api/inbox/read-all') && req.method === 'POST') {
      cors(res);
      const user = await requireUser(req, res); if (!user) return;
      if (!rateLimit('inbox:' + user.id, 60, 60 * 1000)) { send(res, 429, { error: 'Slow down.' }); return; }
      const all = url.pathname.endsWith('read-all');
      var ids = [];
      if (!all) {
        const body = await readBody(req, 4096).catch(() => ({}));
        ids = Array.isArray(body && body.ids) ? body.ids.slice(0, 50) : [body && body.id].filter(Boolean);
        if (!ids.length) { send(res, 400, { error: 'Nothing to mark.' }); return; }
      }
      var marked = 0;
      // Notifications: the whole set for read-all, otherwise just the named
      // rows that belong to this person.
      var nq = supabase.from('notifications').update({ read_at: new Date().toISOString() }).eq('user_id', user.id).is('read_at', null);
      if (!all) {
        const noteIds = ids.filter(x => String(x).startsWith('n:')).map(x => String(x).slice(2)).filter(isUuid);
        if (noteIds.length) nq = nq.in('id', noteIds);
        else nq = null;
      }
      if (nq) {
        const { error, count } = await nq;
        if (!error) marked += count || 0;
      }
      // DMs: read-all marks every DM read; a single dm id marks just that one.
      var dmIds = ids.filter(x => String(x).startsWith('dm:')).map(x => String(x).slice(2)).filter(isUuid);
      if (all) {
        const { data: mine } = await supabase.from('conversation_members').select('lobby_id').eq('user_id', user.id).limit(500);
        const list = (mine || []).map(r => r.lobby_id);
        if (list.length) {
          const { data: dms } = await supabase.from('lobbies').select('id').eq('kind', 'dm').in('id', list).limit(200);
          dmIds = (dms || []).map(r => r.id);
        }
      }
      if (dmIds.length) {
        // Never write read state for a conversation the caller is not in: the
        // id came from the client, so it is checked, not trusted.
        const { data: lobs } = await supabase.from('lobbies')
          .select('id, name, kind, server_id, is_private').in('id', dmIds).limit(50);
        const allowed = [];
        for (const lob of (lobs || [])) {
          if (await canSeeLobby(user.id, lob)) allowed.push(lob.id);
        }
        if (allowed.length) {
          const at = new Date().toISOString();
          const rows = allowed.map(id => ({ user_id: user.id, lobby_id: id, last_read_at: at }));
          const { error } = await supabase.from('conversation_state').upsert(rows, { onConflict: 'user_id,lobby_id' });
          if (!error) marked += rows.length;
        }
      }
      send(res, 200, { ok: true, marked });
      return;
    }

    // ── Cross-server search ─────────────────────────────────────
    if (url.pathname === '/api/search/all' && req.method === 'GET') {
      cors(res);
      const user = await requireUser(req, res); if (!user) return;
      if (!rateLimit('search:' + user.id, 40, 60 * 1000)) { send(res, 429, { error: 'Slow down.' }); return; }
      const term = clean(url.searchParams.get('q'), 60);
      if (term.length < 2) { send(res, 400, { error: 'Search needs two characters or more.' }); return; }
      const kind = ['messages', 'people', 'servers', 'games'].includes(url.searchParams.get('kind'))
        ? url.searchParams.get('kind') : 'all';
      const out = { messages: [], people: [], servers: [], games: [] };
      const like = '%' + term + '%';
      const wanted = k => kind === 'all' || kind === k;

      if (wanted('messages')) {
        const lobbyIds = await visibleLobbyIds(user.id);
        if (lobbyIds.length) {
          const { data, error } = await supabase.from('messages')
            .select('id, text, display_name, created_at, lobby_id, lobbies!messages_lobby_id_fkey(id, name, kind, server_id)')
            .in('lobby_id', lobbyIds).ilike('text', like)
            .order('created_at', { ascending: false }).limit(30);
          if (!error) {
            out.messages = (data || []).map(m => ({
              id: m.id,
              text: String(m.text || '').slice(0, 400),
              display_name: m.display_name || 'Someone',
              created_at: m.created_at,
              lobby_id: m.lobby_id,
              lobby_name: (m.lobbies && m.lobbies.name) || '',
              kind: (m.lobbies && m.lobbies.kind) || 'channel',
              href: '/chat?c=' + encodeURIComponent(m.lobby_id),
            }));
          }
        }
      }

      if (wanted('people')) {
        var pq = supabase.from('users').select('id, display_name, avatar_url, user_id, bio').neq('id', user.id).limit(20);
        if (/^\d+$/.test(term)) pq = pq.eq('user_id', parseInt(term, 10));
        else pq = pq.ilike('display_name', like);
        const { data } = await pq;
        out.people = (data || []).map(u => ({
          id: u.id, display_name: u.display_name, avatar_url: u.avatar_url || null,
          user_id: u.user_id, bio: String(u.bio || '').slice(0, 120),
          href: '/creator?id=' + encodeURIComponent(u.id),
        }));
      }

      if (wanted('servers')) {
        const { data } = await supabase.from('servers')
          .select('id, name, description, icon_url, visibility, created_at')
          .or('visibility.eq.public,owner_id.eq.' + user.id)
          .ilike('name', like).limit(20);
        out.servers = (data || []).map(s => ({
          id: s.id, name: s.name, icon_url: s.icon_url || null,
          description: String(s.description || '').slice(0, 140),
          visibility: s.visibility,
          href: '/server/' + encodeURIComponent(s.id),
        }));
      }

      if (wanted('games')) {
        const { data } = await supabase.from('games')
          .select('id, title, slug, blurb, play_count, owner_id, users!games_owner_id_fkey(display_name)')
          .eq('published', true).ilike('title', like).limit(20);
        out.games = (data || []).map(g => ({
          id: g.id, title: g.title, slug: g.slug,
          blurb: String(g.blurb || '').slice(0, 140),
          play_count: g.play_count || 0,
          creator: (g.users && g.users.display_name) || 'Someone',
          href: '/g/' + encodeURIComponent(g.slug || g.id),
        }));
      }

      const total = out.messages.length + out.people.length + out.servers.length + out.games.length;
      send(res, 200, { q: term, kind, total, results: out });
      return;
    }

    // ── Home dashboard ──────────────────────────────────────────
    if (url.pathname === '/api/home' && req.method === 'GET') {
      cors(res);
      const user = await requireUser(req, res); if (!user) return;
      const [meRes, memRes, ownedRes] = await Promise.all([
        supabase.from('users').select('id, display_name, avatar_url, home_cards').eq('id', user.id).single(),
        supabase.from('server_members').select('server_id, role, joined_at').eq('user_id', user.id).limit(50),
        supabase.from('servers').select('id, name, icon_url, visibility').eq('owner_id', user.id).limit(50),
      ]);
      const me = meRes.data || { display_name: 'there' };
      const memberIds = (memRes.data || []).map(r => r.server_id);
      const owned = ownedRes.data || [];
      const serverIds = [...new Set([...memberIds, ...owned.map(s => s.id)])];

      var servers = [];
      if (serverIds.length) {
        const { data } = await supabase.from('servers')
          .select('id, name, icon_url, visibility, created_at').in('id', serverIds).limit(8);
        const own = new Set(owned.map(s => s.id));
        servers = (data || []).map(s => ({
          id: s.id, name: s.name, icon_url: s.icon_url || null,
          visibility: s.visibility, owner: own.has(s.id),
          href: '/server/' + encodeURIComponent(s.id),
        }));
      }

      var events = [];
      if (serverIds.length) {
        const { data } = await supabase.from('server_events')
          .select('id, server_id, title, starts_at, ends_at')
          .in('server_id', serverIds).gte('starts_at', new Date().toISOString())
          .order('starts_at').limit(4);
        events = (data || []).map(e => ({
          id: e.id, title: e.title, starts_at: e.starts_at, ends_at: e.ends_at,
          server_id: e.server_id,
          href: '/server/' + encodeURIComponent(e.server_id),
        }));
      }

      const { data: gameRows } = await supabase.from('games')
        .select('id, title, slug, play_count, published, updated_at')
        .eq('owner_id', user.id).order('updated_at', { ascending: false }).limit(5);
      const games = (gameRows || []).map(g => ({
        id: g.id, title: g.title, slug: g.slug, play_count: g.play_count || 0,
        published: !!g.published,
        href: '/g/' + encodeURIComponent(g.slug || g.id),
      }));

      var activity = [];
      try {
        const { data: fr } = await supabase.from('friendships')
          .select('user_id, friend_id').or('user_id.eq.' + user.id + ',friend_id.eq.' + user.id)
          .eq('status', 'accepted').limit(200);
        const friendIds = [...new Set((fr || []).map(r => (r.user_id === user.id ? r.friend_id : r.user_id)))];
        if (friendIds.length) {
          const { data: sharing } = await supabase.from('users')
            .select('id, display_name, avatar_url, share_activity').in('id', friendIds);
          const yes = (sharing || []).filter(u => u.share_activity === true);
          if (yes.length) {
            const byId = {};
            yes.forEach(u => { byId[u.id] = u; });
            const { data: acts } = await supabase.from('activity')
              .select('id, user_id, kind, text, created_at')
              .in('user_id', yes.map(u => u.id))
              .gte('created_at', new Date(Date.now() - 14 * 86400000).toISOString())
              .order('created_at', { ascending: false }).limit(6);
            activity = (acts || []).map(a => ({
              id: a.id, kind: a.kind, text: a.text, created_at: a.created_at,
              display_name: (byId[a.user_id] && byId[a.user_id].display_name) || 'A friend',
              avatar_url: (byId[a.user_id] && byId[a.user_id].avatar_url) || null,
            }));
          }
        }
      } catch (e) {}

      const [dms, notes] = await Promise.all([unreadDms(user.id), notificationItems(user.id, 20)]);
      const hidden = Array.isArray((me.home_cards || {}).hidden) ? me.home_cards.hidden : [];

      send(res, 200, {
        me: { id: me.id, display_name: me.display_name || 'there', avatar_url: me.avatar_url || null },
        unread: { dms: dms.unread, notifications: notes.unread, total: dms.unread + notes.unread },
        dm_items: dms.items.slice(0, 4),
        notices: notes.items.slice(0, 4),
        servers,
        events,
        games,
        activity,
        hidden,
        cards: HOME_CARDS,
      });
      return;
    }

    if (url.pathname === '/api/home/cards' && req.method === 'POST') {
      cors(res);
      const user = await requireUser(req, res); if (!user) return;
      const body = await readBody(req, 4096).catch(() => ({}));
      const wanted = Array.isArray(body && body.hidden) ? body.hidden : [];
      const hidden = [...new Set(wanted.filter(k => HOME_CARDS.includes(k)))].slice(0, HOME_CARDS.length);
      const { error } = await supabase.from('users').update({ home_cards: { hidden } }).eq('id', user.id);
      if (error) {
        if (noTable(error) || /column .*home_cards/i.test(String(error.message || ''))) {
          send(res, 503, { error: 'home_cards_not_set_up', text: 'This needs the inbox/search/home migration first.' });
          return;
        }
        send(res, 500, { error: 'Could not save your dashboard.' });
        return;
      }
      send(res, 200, { ok: true, hidden });
      return;
    }

    send(res, 404, { error: 'Not found.' });
  }

  return { handle, matches };
};

function matches(pathname) {
  return pathname === '/api/inbox' || pathname === '/api/inbox/read' || pathname === '/api/inbox/read-all'
    || pathname === '/api/search/all'
    || pathname === '/api/home' || pathname === '/api/home/cards';
}
