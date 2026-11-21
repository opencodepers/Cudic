/* file: lib/routes/batch.js
 * what: the server batch — public event listings, private channel bookmarks,
 *   server polls and votes, answered Q&A messages, join questions, game-update
 *   feeds, a per-server moderation overview, weekly backups, featured artwork
 *   and announcement/QA channel types.
 * invariants: every server route resolves membership through serverRole before
 *   it reads; owner-only writes (type, questions, feeds, backups, featured) are
 *   re-checked against the server that owns the row. Missing tables answer 503,
 *   never a fake success. Polls store no voter identity in any response.
 */
module.exports = function createRoutes(deps) {
  const { supabase, cors, requireUser, needVerified, readBody, isUuid, serverRole, rateLimit, broadcast } = deps;

  function send(res, code, body) {
    res.writeHead(code, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(body));
  }
  function noTable(err) {
    const c = String((err && err.code) || '');
    return c === 'PGRST205' || c === '42P01' || /does not exist|schema cache|column .* does not exist/i.test(String((err && err.message) || ''));
  }
  function notSetUp(res) { send(res, 503, { error: 'batch_not_set_up', text: 'This needs the server-batch or DM-poll migration first.' }); }
  function text(v, max) { return String(v == null ? '' : v).replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max); }
  function httpsUrl(v) {
    const s = String(v || '').trim().slice(0, 500);
    return /^https:\/\/[^\s"'<>]+$/i.test(s) ? s : '';
  }
  function channelName(lobby) { return String(lobby || '').split(':').pop(); }

  async function roleFor(me, sid, res) {
    const { server, role } = await serverRole(me, sid);
    if (!server) { send(res, 404, { error: 'Server not found.' }); return null; }
    if (!role) { send(res, 403, { error: 'Join this server first.' }); return null; }
    return { server, role };
  }
  async function channelInServer(sid, cid) {
    if (!isUuid(cid)) return null;
    const { data } = await supabase.from('lobbies')
      .select('id, name, kind, server_id, is_private').eq('id', cid).eq('server_id', sid).eq('kind', 'channel').single();
    return data || null;
  }
  // A DM has no server role. Membership in conversation_members is the whole
  // gate; the lobby must also actually be a DM, never a server channel.
  async function dmLobbyFor(me, lid, res) {
    if (!isUuid(lid)) { send(res, 400, { error: 'Invalid conversation.' }); return null; }
    const { data: lob } = await supabase.from('lobbies')
      .select('id, name, kind, server_id').eq('id', lid).single();
    if (!lob || lob.kind !== 'dm') { send(res, 404, { error: 'Conversation not found.' }); return null; }
    const { data: member } = await supabase.from('conversation_members')
      .select('user_id').eq('lobby_id', lob.id).eq('user_id', me).maybeSingle();
    if (!member) { send(res, 403, { error: 'Not in this conversation.' }); return null; }
    return lob;
  }

  // ── Game publish fan-out (169) ────────────────────────────────
  async function onGamePublished(gid, title, slug) {
    try {
      const { data: feeds, error } = await supabase.from('server_game_feeds')
        .select('server_id, channel_id').eq('game_id', gid).limit(50);
      if (error || !feeds || !feeds.length) return;
      // A publish callback only knows the id and title. The public page is
      // slug-addressed, so resolve the slug here once instead of linking to
      // a URL that the game page cannot route.
      if (!slug) {
        const { data: game } = await supabase.from('games').select('slug').eq('id', gid).maybeSingle();
        slug = game && game.slug;
      }
      const link = 'https://cudic.vercel.app/game/' + encodeURIComponent(slug || gid);
      const body = 'Game update: ' + (title || 'A game') + ' just published. Play it: ' + link;
      const ids = [...new Set(feeds.map(f => f.channel_id))];
      const { data: lobbies } = await supabase.from('lobbies').select('id, name').in('id', ids);
      const names = {};
      (lobbies || []).forEach(l => { names[l.id] = l.name; });
      for (const f of feeds) {
        if (!names[f.channel_id]) continue;
        await supabase.from('messages').insert({
          lobby_id: f.channel_id, user_id: null, display_name: 'Cudic', text: body,
        });
        try { broadcast(names[f.channel_id], { type: 'message', lobby: names[f.channel_id], username: 'Cudic', text: body, ts: new Date().toISOString() }); } catch (e) {}
      }
    } catch (e) {}
  }

  // ── Weekly backups (200) ─────────────────────────────────────
  async function snapshot(sid) {
    const { data: srv } = await supabase.from('servers').select('*').eq('id', sid).single();
    if (!srv) return null;
    const [ch, mem, ev, presets, nights, lfg, sug, prom] = await Promise.all([
      supabase.from('lobbies').select('id, name, topic, description, icon, position, tags, labels, welcome, is_private, folder_id, slow_seconds, type').eq('server_id', sid).eq('kind', 'channel'),
      supabase.from('server_members').select('user_id, role, rules_accepted_at').eq('server_id', sid),
      supabase.from('server_events').select('title, description, starts_at, ends_at, channel_id').eq('server_id', sid),
      supabase.from('server_theme_presets').select('name, theme').eq('server_id', sid),
      supabase.from('server_nights').select('title, game, note, starts_at, is_public').eq('server_id', sid),
      supabase.from('server_lfg').select('user_id, game, note, slots, starts_at').eq('server_id', sid),
      supabase.from('server_suggestions').select('title, body, status').eq('server_id', sid),
      supabase.from('server_prompts').select('kind, body, active_on').eq('server_id', sid),
    ]);
    return {
      version: 1, created_at: new Date().toISOString(),
      server: {
        id: srv.id, name: srv.name, description: srv.description, icon_url: srv.icon_url,
        visibility: srv.visibility, rules: srv.rules, tags: srv.tags, theme: srv.theme,
        meta: srv.meta, content_label: srv.content_label,
      },
      channels: ch.data || [], members: mem.data || [], events: ev.data || [],
      presets: presets.data || [], nights: nights.data || [], lfg: lfg.data || [],
      suggestions: sug.data || [], prompts: prom.data || [],
      counts: { channels: (ch.data || []).length, members: (mem.data || []).length },
    };
  }
  async function writeBackup(sid, reason) {
    const payload = await snapshot(sid);
    if (!payload) return null;
    await supabase.from('server_backups').insert({ server_id: sid, payload, reason });
    const { data: old } = await supabase.from('server_backups').select('id')
      .eq('server_id', sid).order('created_at', { ascending: false }).range(4, 30);
    if (old && old.length) await supabase.from('server_backups').delete().in('id', old.map(r => r.id));
    return payload;
  }
  async function sweepBackups() {
    try {
      const { data: rows, error } = await supabase.from('servers')
        .select('id, backup_weekly').eq('backup_weekly', true).limit(100);
      if (error || !rows || !rows.length) return;
      for (const r of rows) {
        const { data: last } = await supabase.from('server_backups').select('created_at')
          .eq('server_id', r.id).order('created_at', { ascending: false }).limit(1);
        const at = last && last[0] ? Date.parse(last[0].created_at) : 0;
        if (!at || Date.now() - at > 7 * 86400000) await writeBackup(r.id, 'weekly');
      }
    } catch (e) {}
  }

  async function handle(req, res, url) {
    const p = url.pathname;

    // ── Public event listings (188) ─────────────────────────────
    if (p === '/api/events/public' && req.method === 'GET') {
      cors(res);
      const now = new Date().toISOString();
      const [nights, events] = await Promise.all([
        supabase.from('server_nights').select('id, server_id, title, game, note, starts_at')
          .eq('is_public', true).gte('starts_at', now).order('starts_at').limit(60),
        supabase.from('server_events').select('id, server_id, title, description, starts_at').gte('starts_at', now).order('starts_at').limit(60),
      ]);
      const ids = [...new Set([...(nights.data || []).map(n => n.server_id), ...(events.data || []).map(e => e.server_id)])];
      let byId = {};
      if (ids.length) {
        const { data: srvs } = await supabase.from('servers').select('id, name, icon_url, visibility').in('id', ids).eq('visibility', 'public');
        (srvs || []).forEach(s => { byId[s.id] = s; });
      }
      const out = [];
      (nights.data || []).forEach(n => {
        const s = byId[n.server_id]; if (!s) return;
        out.push({ kind: 'night', id: n.id, server_id: n.server_id, server_name: s.name, icon_url: s.icon_url, title: n.title, game: n.game || '', note: n.note || '', starts_at: n.starts_at });
      });
      (events.data || []).forEach(e => {
        const s = byId[e.server_id]; if (!s) return;
        out.push({ kind: 'event', id: e.id, server_id: e.server_id, server_name: s.name, icon_url: s.icon_url, title: e.title, game: '', note: e.description || '', starts_at: e.starts_at });
      });
      out.sort((a, b) => Date.parse(a.starts_at) - Date.parse(b.starts_at));
      send(res, 200, { events: out.slice(0, 80) });
      return;
    }

    // ── Directory art + next event (187/188) ────────────────────
    if (p === '/api/servers/public-meta' && req.method === 'GET') {
      cors(res);
      const { data: rows } = await supabase.from('servers')
        .select('id, theme').eq('visibility', 'public').limit(100);
      const ids = (rows || []).map(r => r.id);
      let next = {};
      if (ids.length) {
        const { data: nights } = await supabase.from('server_nights').select('server_id, title, starts_at')
          .in('server_id', ids).eq('is_public', true).gte('starts_at', new Date().toISOString())
          .order('starts_at').limit(100);
        (nights || []).forEach(n => { if (!next[n.server_id]) next[n.server_id] = n; });
      }
      const meta = {};
      (rows || []).forEach(r => { meta[r.id] = { featured: (r.theme && r.theme.featured) || '', next_event: next[r.id] || null }; });
      send(res, 200, { meta });
      return;
    }

    // ── Servers I can moderate (193) ────────────────────────────
    if (p === '/api/mod/my-servers' && req.method === 'GET') {
      cors(res);
      const user = await requireUser(req, res); if (!user) return;
      const [owned, mem] = await Promise.all([
        supabase.from('servers').select('id, name, icon_url').eq('owner_id', user.id).limit(50),
        supabase.from('server_members').select('server_id, role').eq('user_id', user.id).eq('role', 'mod').limit(50),
      ]);
      const modIds = (mem.data || []).map(m => m.server_id);
      let modServers = [];
      if (modIds.length) {
        const { data } = await supabase.from('servers').select('id, name, icon_url').in('id', modIds);
        modServers = data || [];
      }
      const seen = {};
      const rows = [];
      [...(owned.data || []), ...modServers].forEach(s => {
        if (s && !seen[s.id]) { seen[s.id] = 1; rows.push({ id: s.id, name: s.name, icon_url: s.icon_url || null, role: (owned.data || []).some(o => o.id === s.id) ? 'owner' : 'mod' }); }
      });
      send(res, 200, { servers: rows });
      return;
    }

    // ── Channel bookmarks (124) ────────────────────────────────
    const bm = /^\/api\/servers\/([^/]+)\/bookmarks(?:\/([^/]+))?$/.exec(p);
    if (bm) {
      cors(res);
      const user = await requireUser(req, res); if (!user) return;
      const sid = bm[1], cid = bm[2];
      if (!isUuid(sid)) { send(res, 400, { error: 'Invalid server.' }); return; }
      const ctx = await roleFor(user.id, sid, res); if (!ctx) return;
      if (req.method === 'GET' && !cid) {
        const { data, error } = await supabase.from('channel_bookmarks')
          .select('lobby_id, created_at').eq('user_id', user.id).order('created_at', { ascending: false }).limit(100);
        if (error) { if (noTable(error)) return notSetUp(res); send(res, 500, { error: 'Could not load bookmarks.' }); return; }
        const ids = (data || []).map(b => b.lobby_id);
        let rows = [];
        if (ids.length) {
          const { data: chans } = await supabase.from('lobbies').select('id, name, server_id, is_private, type')
            .in('id', ids).eq('server_id', sid).eq('kind', 'channel');
          rows = (chans || []).map(c => ({ id: c.id, display: channelName(c.name), is_private: !!c.is_private, type: c.type || 'chat' }));
        }
        send(res, 200, { bookmarks: rows, ids });
        return;
      }
      if (req.method === 'POST' && !cid) {
        if (!(await needVerified(user, res))) return;
        const body = await readBody(req, 4096).catch(() => ({}));
        const lobbyId = String(body.lobbyId || '');
        const chan = await channelInServer(sid, lobbyId);
        if (!chan) { send(res, 404, { error: 'Channel not found.' }); return; }
        const { error } = await supabase.from('channel_bookmarks')
          .upsert({ user_id: user.id, lobby_id: lobbyId }, { onConflict: 'user_id,lobby_id' });
        if (error) { if (noTable(error)) return notSetUp(res); send(res, 500, { error: 'Could not save the bookmark.' }); return; }
        send(res, 200, { ok: true });
        return;
      }
      if (req.method === 'DELETE' && !cid) {
        const lobbyId = String(url.searchParams.get('lobbyId') || '');
        if (!isUuid(lobbyId)) { send(res, 400, { error: 'Invalid channel.' }); return; }
        await supabase.from('channel_bookmarks').delete().eq('user_id', user.id).eq('lobby_id', lobbyId);
        send(res, 200, { ok: true });
        return;
      }
      send(res, 405, { error: 'Method not allowed.' });
      return;
    }

    // ── Server polls (141/142) ─────────────────────────────────
    const pollList = /^\/api\/servers\/([^/]+)\/polls$/.exec(p);
    if (pollList) {
      cors(res);
      const user = await requireUser(req, res); if (!user) return;
      const sid = pollList[1];
      if (!isUuid(sid)) { send(res, 400, { error: 'Invalid server.' }); return; }
      const ctx = await roleFor(user.id, sid, res); if (!ctx) return;
      const lobbyQuery = String(url.searchParams.get('lobby') || '');
      const { data: chan } = lobbyQuery
        ? await supabase.from('lobbies').select('id, name, kind, server_id').eq('name', lobbyQuery).single()
        : { data: null };
      if (lobbyQuery && (!chan || chan.server_id !== sid)) { send(res, 404, { error: 'Channel not found.' }); return; }

      if (req.method === 'GET') {
        let q = supabase.from('server_polls').select('id, lobby_id, question, options, anonymous, closes_at, created_at, created_by')
          .eq('server_id', sid).order('created_at', { ascending: false }).limit(30);
        if (chan) q = q.eq('lobby_id', chan.id);
        const { data: polls, error } = await q;
        if (error) { if (noTable(error)) return notSetUp(res); send(res, 500, { error: 'Could not load polls.' }); return; }
        const ids = (polls || []).map(x => x.id);
        let votes = [];
        if (ids.length) {
          const { data } = await supabase.from('server_poll_votes').select('poll_id, user_id, choice').in('poll_id', ids);
          votes = data || [];
        }
        const out = (polls || []).map(x => {
          const mine = votes.find(v => v.poll_id === x.id && v.user_id === user.id);
          const counts = {};
          votes.filter(v => v.poll_id === x.id).forEach(v => { counts[v.choice] = (counts[v.choice] || 0) + 1; });
          const opts = Array.isArray(x.options) ? x.options : [];
          return {
            id: x.id, lobby_id: x.lobby_id, question: x.question, options: opts,
            anonymous: !!x.anonymous, closes_at: x.closes_at, created_at: x.created_at,
            mine: mine ? mine.choice : null,
            counts: opts.map((_, i) => counts[i] || 0),
            total: votes.filter(v => v.poll_id === x.id).length,
            closed: !!(x.closes_at && Date.parse(x.closes_at) < Date.now()),
          };
        });
        send(res, 200, { polls: out });
        return;
      }
      if (req.method === 'POST') {
        if (ctx.role !== 'owner' && ctx.role !== 'mod') { send(res, 403, { error: 'Owner or mods only.' }); return; }
        if (!(await needVerified(user, res))) return;
        if (!rateLimit('poll:' + user.id, 10, 60 * 1000)) { send(res, 429, { error: 'Slow down.' }); return; }
        const body = await readBody(req, 8192).catch(() => ({}));
        const target = chan || await channelInServer(sid, String(body.lobbyId || ''));
        if (!target) { send(res, 400, { error: 'Pick a channel.' }); return; }
        const question = text(body.question, 160);
        const options = (Array.isArray(body.options) ? body.options : []).map(o => text(o, 60)).filter(Boolean).slice(0, 10);
        if (question.length < 4) { send(res, 400, { error: 'Write a question.' }); return; }
        if (options.length < 2) { send(res, 400, { error: 'Two options minimum.' }); return; }
        const closes = body.closesAt ? Date.parse(body.closesAt) : null;
        const closesAt = Number.isFinite(closes) && closes > Date.now() && closes < Date.now() + 30 * 86400000 ? new Date(closes).toISOString() : null;
        const { data: msg } = await supabase.from('messages').insert({
          lobby_id: target.id, user_id: user.id, display_name: 'Poll', text: 'Poll: ' + question,
        }).select('id').single();
        const { data: poll, error } = await supabase.from('server_polls').insert({
          server_id: sid, lobby_id: target.id, message_id: msg ? msg.id : null, created_by: user.id,
          question, options, anonymous: body.anonymous === true, closes_at: closesAt,
        }).select('id, question, options, anonymous, closes_at, created_at').single();
        if (error) { if (noTable(error)) return notSetUp(res); send(res, 500, { error: 'Could not create the poll.' }); return; }
        try { broadcast(target.name, { type: 'message', lobby: target.name, username: 'Poll', text: 'Poll: ' + question, ts: new Date().toISOString() }); } catch (e) {}
        send(res, 200, { poll: Object.assign({}, poll, { mine: null, counts: options.map(() => 0), total: 0, closed: false }) });
        return;
      }
      send(res, 405, { error: 'Method not allowed.' });
      return;
    }

    const pollAct = /^\/api\/servers\/([^/]+)\/polls\/([^/]+)\/(vote|close)$/.exec(p);
    if (pollAct && req.method === 'POST') {
      cors(res);
      const user = await requireUser(req, res); if (!user) return;
      const sid = pollAct[1], pid = pollAct[2], act = pollAct[3];
      if (!isUuid(sid) || !isUuid(pid)) { send(res, 400, { error: 'Invalid poll.' }); return; }
      const ctx = await roleFor(user.id, sid, res); if (!ctx) return;
      const { data: poll } = await supabase.from('server_polls')
        .select('id, server_id, lobby_id, options, closes_at, anonymous').eq('id', pid).eq('server_id', sid).single();
      if (!poll) { send(res, 404, { error: 'Poll not found.' }); return; }
      if (act === 'close') {
        if (ctx.role !== 'owner' && ctx.role !== 'mod') { send(res, 403, { error: 'Owner or mods only.' }); return; }
        await supabase.from('server_polls').update({ closes_at: new Date().toISOString() }).eq('id', pid);
        send(res, 200, { ok: true });
        return;
      }
      if (poll.closes_at && Date.parse(poll.closes_at) < Date.now()) { send(res, 400, { error: 'That poll has closed.' }); return; }
      const body = await readBody(req, 4096).catch(() => ({}));
      const choice = parseInt(body.choice, 10);
      const opts = Array.isArray(poll.options) ? poll.options : [];
      if (!Number.isFinite(choice) || choice < 0 || choice >= opts.length) { send(res, 400, { error: 'Pick an option.' }); return; }
      if (!(await needVerified(user, res))) return;
      const { error } = await supabase.from('server_poll_votes')
        .upsert({ poll_id: pid, user_id: user.id, choice }, { onConflict: 'poll_id,user_id' });
      if (error) { if (noTable(error)) return notSetUp(res); send(res, 500, { error: 'Could not save your vote.' }); return; }
      send(res, 200, { ok: true, choice });
      return;
    }

    // ── DM polls (141/142) ─────────────────────────────────────
    // Same poll rows as a channel poll, keyed by lobby membership instead of
    // a server id. The migration only relaxes server_id to allow the null;
    // until it runs, creation answers 503 rather than half-writing a row.
    const dmPollList = /^\/api\/lobbies\/([^/]+)\/polls$/.exec(p);
    if (dmPollList) {
      cors(res);
      const user = await requireUser(req, res); if (!user) return;
      const lob = await dmLobbyFor(user.id, dmPollList[1], res); if (!lob) return;
      if (req.method === 'GET') {
        const { data: polls, error } = await supabase.from('server_polls')
          .select('id, lobby_id, question, options, anonymous, closes_at, created_at, created_by')
          .eq('lobby_id', lob.id).order('created_at', { ascending: false }).limit(30);
        if (error) { if (noTable(error)) return notSetUp(res); send(res, 500, { error: 'Could not load polls.' }); return; }
        const ids = (polls || []).map(x => x.id);
        let votes = [];
        if (ids.length) {
          const { data } = await supabase.from('server_poll_votes').select('poll_id, user_id, choice').in('poll_id', ids);
          votes = data || [];
        }
        const out = (polls || []).map(x => {
          const mine = votes.find(v => v.poll_id === x.id && v.user_id === user.id);
          const counts = {};
          votes.filter(v => v.poll_id === x.id).forEach(v => { counts[v.choice] = (counts[v.choice] || 0) + 1; });
          const opts = Array.isArray(x.options) ? x.options : [];
          return {
            id: x.id, lobby_id: x.lobby_id, question: x.question, options: opts,
            anonymous: !!x.anonymous, closes_at: x.closes_at, created_at: x.created_at,
            mine: mine ? mine.choice : null,
            counts: opts.map((_, i) => counts[i] || 0),
            total: votes.filter(v => v.poll_id === x.id).length,
            closed: !!(x.closes_at && Date.parse(x.closes_at) < Date.now()),
          };
        });
        send(res, 200, { polls: out });
        return;
      }
      if (req.method === 'POST') {
        if (!(await needVerified(user, res))) return;
        if (!rateLimit('dmpoll:' + user.id, 10, 60 * 1000)) { send(res, 429, { error: 'Slow down.' }); return; }
        const body = await readBody(req, 8192).catch(() => ({}));
        const question = text(body.question, 160);
        const options = (Array.isArray(body.options) ? body.options : []).map(o => text(o, 60)).filter(Boolean).slice(0, 10);
        if (question.length < 4) { send(res, 400, { error: 'Write a question.' }); return; }
        if (options.length < 2) { send(res, 400, { error: 'Two options minimum.' }); return; }
        const { data: msg } = await supabase.from('messages').insert({
          lobby_id: lob.id, user_id: user.id, display_name: 'Poll', text: 'Poll: ' + question,
        }).select('id').single();
        const { data: poll, error } = await supabase.from('server_polls').insert({
          server_id: null, lobby_id: lob.id, message_id: msg ? msg.id : null, created_by: user.id,
          question, options, anonymous: body.anonymous === true,
        }).select('id, question, options, anonymous, closes_at, created_at').single();
        if (error) {
          if (noTable(error) || String(error.code || '') === '23502') return notSetUp(res);
          send(res, 500, { error: 'Could not create the poll.' }); return;
        }
        try { broadcast(lob.name, { type: 'message', lobby: lob.name, username: 'Poll', text: 'Poll: ' + question, ts: new Date().toISOString() }); } catch (e) {}
        send(res, 200, { poll: Object.assign({}, poll, { mine: null, counts: options.map(() => 0), total: 0, closed: false }) });
        return;
      }
      send(res, 405, { error: 'Method not allowed.' });
      return;
    }

    const dmPollAct = /^\/api\/lobbies\/([^/]+)\/polls\/([^/]+)\/(vote|close)$/.exec(p);
    if (dmPollAct && req.method === 'POST') {
      cors(res);
      const user = await requireUser(req, res); if (!user) return;
      const lob = await dmLobbyFor(user.id, dmPollAct[1], res); if (!lob) return;
      const pid = dmPollAct[2], act = dmPollAct[3];
      if (!isUuid(pid)) { send(res, 400, { error: 'Invalid poll.' }); return; }
      const { data: poll } = await supabase.from('server_polls')
        .select('id, lobby_id, options, closes_at').eq('id', pid).eq('lobby_id', lob.id).single();
      if (!poll) { send(res, 404, { error: 'Poll not found.' }); return; }
      if (act === 'close') {
        await supabase.from('server_polls').update({ closes_at: new Date().toISOString() }).eq('id', pid);
        send(res, 200, { ok: true });
        return;
      }
      if (poll.closes_at && Date.parse(poll.closes_at) < Date.now()) { send(res, 400, { error: 'That poll has closed.' }); return; }
      const body = await readBody(req, 4096).catch(() => ({}));
      const choice = parseInt(body.choice, 10);
      const opts = Array.isArray(poll.options) ? poll.options : [];
      if (!Number.isFinite(choice) || choice < 0 || choice >= opts.length) { send(res, 400, { error: 'Pick an option.' }); return; }
      if (!(await needVerified(user, res))) return;
      const { error } = await supabase.from('server_poll_votes')
        .upsert({ poll_id: pid, user_id: user.id, choice }, { onConflict: 'poll_id,user_id' });
      if (error) { if (noTable(error)) return notSetUp(res); send(res, 500, { error: 'Could not save your vote.' }); return; }
      send(res, 200, { ok: true, choice });
      return;
    }

    // ── Answered Q&A messages (118) ────────────────────────────
    const ansMatch = /^\/api\/servers\/([^/]+)\/questions\/([^/]+)\/answer$/.exec(p);
    if (ansMatch) {
      cors(res);
      const user = await requireUser(req, res); if (!user) return;
      const sid = ansMatch[1], mid = ansMatch[2];
      if (!isUuid(sid) || !isUuid(mid)) { send(res, 400, { error: 'Invalid question.' }); return; }
      const ctx = await roleFor(user.id, sid, res); if (!ctx) return;
      const { data: msg } = await supabase.from('messages')
        .select('id, user_id, lobby_id, text, answered_at, lobbies!messages_lobby_id_fkey(name, kind, server_id)')
        .eq('id', mid).single();
      const lob = msg && msg.lobbies ? msg.lobbies : null;
      if (!msg || !lob || lob.server_id !== sid) { send(res, 404, { error: 'Message not found.' }); return; }
      const mine = msg.user_id === user.id;
      if (!mine && ctx.role !== 'owner' && ctx.role !== 'mod') { send(res, 403, { error: 'Only the asker or a mod can mark an answer.' }); return; }
      if (req.method === 'POST') {
        if (!(await needVerified(user, res))) return;
        const stamp = new Date().toISOString();
        const { error } = await supabase.from('messages').update({ answered_at: stamp, answered_by: user.id }).eq('id', mid);
        if (error) { if (noTable(error)) return notSetUp(res); send(res, 500, { error: 'Could not mark the answer.' }); return; }
        try { broadcast(lob.name, { type: 'answered', lobby: lob.name, id: mid, answered_at: stamp }); } catch (e) {}
        send(res, 200, { ok: true, answered_at: stamp });
        return;
      }
      if (req.method === 'DELETE') {
        await supabase.from('messages').update({ answered_at: null, answered_by: null }).eq('id', mid);
        try { broadcast(lob.name, { type: 'answered', lobby: lob.name, id: mid, answered_at: null }); } catch (e) {}
        send(res, 200, { ok: true });
        return;
      }
      send(res, 405, { error: 'Method not allowed.' });
      return;
    }

    const answeredList = /^\/api\/servers\/([^/]+)\/answered$/.exec(p);
    if (answeredList && req.method === 'GET') {
      cors(res);
      const user = await requireUser(req, res); if (!user) return;
      const sid = answeredList[1];
      if (!isUuid(sid)) { send(res, 400, { error: 'Invalid server.' }); return; }
      const ctx = await roleFor(user.id, sid, res); if (!ctx) return;
      const name = String(url.searchParams.get('lobby') || '');
      const { data: chan } = await supabase.from('lobbies').select('id, server_id').eq('name', name).eq('server_id', sid).single();
      if (!chan) { send(res, 404, { error: 'Channel not found.' }); return; }
      const { data, error } = await supabase.from('messages')
        .select('id, display_name, text, answered_at').eq('lobby_id', chan.id).not('answered_at', 'is', null)
        .order('answered_at', { ascending: false }).limit(20);
      if (error) { if (noTable(error)) return notSetUp(res); send(res, 500, { error: 'Could not load answers.' }); return; }
      send(res, 200, { answered: data || [] });
      return;
    }

    // ── Custom join questions (191) ────────────────────────────
    const jq = /^\/api\/servers\/([^/]+)\/join-questions$/.exec(p);
    if (jq) {
      cors(res);
      const user = await requireUser(req, res); if (!user) return;
      const sid = jq[1];
      if (!isUuid(sid)) { send(res, 400, { error: 'Invalid server.' }); return; }
      const { server, role } = await serverRole(user.id, sid);
      if (!server) { send(res, 404, { error: 'Server not found.' }); return; }
      if (req.method === 'GET') {
        if (!role) { send(res, 403, { error: 'Join this server first.' }); return; }
        const qs = Array.isArray(server.join_questions) ? server.join_questions : [];
        let answers = [];
        if (role === 'owner' || role === 'mod') {
          const { data } = await supabase.from('server_join_answers')
            .select('user_id, answers, created_at').eq('server_id', sid).order('created_at', { ascending: false }).limit(50);
          const ids = (data || []).map(r => r.user_id);
          let names = {};
          if (ids.length) {
            const { data: us } = await supabase.from('users').select('id, display_name').in('id', ids);
            (us || []).forEach(u => { names[u.id] = u.display_name; });
          }
          answers = (data || []).map(r => ({ user_id: r.user_id, name: names[r.user_id] || 'Member', answers: r.answers || [], created_at: r.created_at }));
        }
        send(res, 200, { questions: qs, answers });
        return;
      }
      if (req.method === 'PUT') {
        if (role !== 'owner') { send(res, 403, { error: 'Only the owner sets join questions.' }); return; }
        if (!(await needVerified(user, res))) return;
        const body = await readBody(req, 8192).catch(() => ({}));
        const questions = (Array.isArray(body.questions) ? body.questions : []).map(q => text(q, 120)).filter(Boolean).slice(0, 3);
        const { error } = await supabase.from('servers').update({ join_questions: questions }).eq('id', sid);
        if (error) { if (noTable(error)) return notSetUp(res); send(res, 500, { error: 'Could not save join questions.' }); return; }
        send(res, 200, { ok: true, questions });
        return;
      }
      send(res, 405, { error: 'Method not allowed.' });
      return;
    }

    // ── Game-update feeds (169) ────────────────────────────────
    const feed = /^\/api\/servers\/([^/]+)\/game-feeds$/.exec(p);
    if (feed) {
      cors(res);
      const user = await requireUser(req, res); if (!user) return;
      const sid = feed[1];
      if (!isUuid(sid)) { send(res, 400, { error: 'Invalid server.' }); return; }
      const ctx = await roleFor(user.id, sid, res); if (!ctx) return;
      if (req.method === 'GET') {
        const { data, error } = await supabase.from('server_game_feeds')
          .select('id, game_id, channel_id, games(title, slug), lobbies(name)')
          .eq('server_id', sid).order('created_at').limit(50);
        if (error) { if (noTable(error)) return notSetUp(res); send(res, 500, { error: 'Could not load feeds.' }); return; }
        send(res, 200, { feeds: (data || []).map(f => ({
          id: f.id, game_id: f.game_id, channel_id: f.channel_id,
          title: (f.games && f.games.title) || 'Game', slug: (f.games && f.games.slug) || '',
          channel: f.lobbies ? channelName(f.lobbies.name) : '',
        })) });
        return;
      }
      if (ctx.role !== 'owner' && ctx.role !== 'mod') { send(res, 403, { error: 'Owner or mods only.' }); return; }
      if (req.method === 'POST') {
        if (!(await needVerified(user, res))) return;
        const body = await readBody(req, 4096).catch(() => ({}));
        const gameId = String(body.gameId || ''), channelId = String(body.channelId || '');
        if (!isUuid(gameId)) { send(res, 400, { error: 'Pick a game.' }); return; }
        const chan = await channelInServer(sid, channelId);
        if (!chan) { send(res, 404, { error: 'Channel not found.' }); return; }
        const { data: game } = await supabase.from('games').select('id, title').eq('id', gameId).single();
        if (!game) { send(res, 404, { error: 'Game not found.' }); return; }
        const { error } = await supabase.from('server_game_feeds').upsert({
          server_id: sid, game_id: gameId, channel_id: channelId, created_by: user.id,
        }, { onConflict: 'server_id,game_id' });
        if (error) { if (noTable(error)) return notSetUp(res); send(res, 500, { error: 'Could not follow that game.' }); return; }
        send(res, 200, { ok: true });
        return;
      }
      if (req.method === 'DELETE') {
        const id = String(url.searchParams.get('id') || '');
        if (!isUuid(id)) { send(res, 400, { error: 'Invalid feed.' }); return; }
        await supabase.from('server_game_feeds').delete().eq('id', id).eq('server_id', sid);
        send(res, 200, { ok: true });
        return;
      }
      send(res, 405, { error: 'Method not allowed.' });
      return;
    }

    // ── Moderation overview (193) ──────────────────────────────
    const mo = /^\/api\/servers\/([^/]+)\/mod-overview$/.exec(p);
    if (mo && req.method === 'GET') {
      cors(res);
      const user = await requireUser(req, res); if (!user) return;
      const sid = mo[1];
      if (!isUuid(sid)) { send(res, 400, { error: 'Invalid server.' }); return; }
      const ctx = await roleFor(user.id, sid, res); if (!ctx) return;
      if (ctx.role !== 'owner' && ctx.role !== 'mod') { send(res, 403, { error: 'Owner or mods only.' }); return; }
      const [mem, bans, warn, audit, chans, joins] = await Promise.all([
        supabase.from('server_members').select('user_id, role').eq('server_id', sid).limit(1000),
        supabase.from('server_bans').select('user_id, reason, created_at').eq('server_id', sid).limit(100),
        supabase.from('server_warnings').select('user_id, reason, created_at, acknowledged_at').eq('server_id', sid).order('created_at', { ascending: false }).limit(20),
        supabase.from('server_audit').select('actor_id, action, target, created_at').eq('server_id', sid).order('created_at', { ascending: false }).limit(20),
        supabase.from('lobbies').select('id, name, slow_seconds, type').eq('server_id', sid).eq('kind', 'channel'),
        supabase.from('server_join_answers').select('user_id, answers, created_at').eq('server_id', sid).order('created_at', { ascending: false }).limit(20),
      ]);
      const ids = [...new Set([
        ...(mem.data || []).map(m => m.user_id), ...(bans.data || []).map(b => b.user_id),
        ...(warn.data || []).map(w => w.user_id), ...(audit.data || []).map(a => a.actor_id),
        ...(joins.data || []).map(j => j.user_id),
      ].filter(Boolean))];
      let names = {};
      if (ids.length) {
        const { data: us } = await supabase.from('users').select('id, display_name').in('id', ids);
        (us || []).forEach(u => { names[u.id] = u.display_name; });
      }
      send(res, 200, {
        members: (mem.data || []).length,
        mods: (mem.data || []).filter(m => m.role === 'mod' || m.role === 'owner').length,
        bans: (bans.data || []).map(b => ({ user_id: b.user_id, name: names[b.user_id] || 'Member', reason: b.reason || '', created_at: b.created_at })),
        warnings: (warn.data || []).map(w => ({ user_id: w.user_id, name: names[w.user_id] || 'Member', reason: w.reason, created_at: w.created_at, acknowledged: !!w.acknowledged_at })),
        audit: (audit.data || []).map(a => ({ actor: names[a.actor_id] || 'System', action: a.action, target: a.target || '', created_at: a.created_at })),
        slow: (chans.data || []).filter(c => (c.slow_seconds || 0) > 0).map(c => ({ name: channelName(c.name), slow_seconds: c.slow_seconds })),
        joins: (joins.data || []).map(j => ({ user_id: j.user_id, name: names[j.user_id] || 'Member', answers: j.answers || [], created_at: j.created_at })),
      });
      return;
    }

    // ── Backups (200) ──────────────────────────────────────────
    const bk = /^\/api\/servers\/([^/]+)\/backups(?:\/([^/]+))?$/.exec(p);
    if (bk) {
      cors(res);
      const user = await requireUser(req, res); if (!user) return;
      const sid = bk[1], bid = bk[2];
      if (!isUuid(sid)) { send(res, 400, { error: 'Invalid server.' }); return; }
      const ctx = await roleFor(user.id, sid, res); if (!ctx) return;
      if (ctx.role !== 'owner') { send(res, 403, { error: 'Only the owner can manage backups.' }); return; }
      if (req.method === 'GET' && bid) {
        if (!isUuid(bid)) { send(res, 400, { error: 'Invalid backup.' }); return; }
        const { data } = await supabase.from('server_backups').select('payload, created_at').eq('id', bid).eq('server_id', sid).single();
        if (!data) { send(res, 404, { error: 'Backup not found.' }); return; }
        res.writeHead(200, {
          'Content-Type': 'application/json',
          'Content-Disposition': 'attachment; filename="cudic-server-' + sid + '-' + String(data.created_at).slice(0, 10) + '.json"',
        });
        res.end(JSON.stringify(data.payload, null, 2));
        return;
      }
      if (req.method === 'GET') {
        const { data, error } = await supabase.from('server_backups')
          .select('id, created_at, reason, payload').eq('server_id', sid).order('created_at', { ascending: false }).limit(10);
        if (error) { if (noTable(error)) return notSetUp(res); send(res, 500, { error: 'Could not load backups.' }); return; }
        send(res, 200, {
          weekly: !!ctx.server.backup_weekly,
          backups: (data || []).map(b => ({ id: b.id, created_at: b.created_at, reason: b.reason, channels: ((b.payload || {}).counts || {}).channels || 0, members: ((b.payload || {}).counts || {}).members || 0 })),
        });
        return;
      }
      if (req.method === 'POST') {
        if (!(await needVerified(user, res))) return;
        if (!rateLimit('backup:' + user.id, 4, 3600 * 1000)) { send(res, 429, { error: 'Four backups an hour is plenty.' }); return; }
        const payload = await writeBackup(sid, 'manual').catch(() => null);
        if (!payload) { send(res, 500, { error: 'Could not build the backup.' }); return; }
        send(res, 200, { ok: true, counts: payload.counts });
        return;
      }
      if (req.method === 'PUT') {
        const body = await readBody(req, 4096).catch(() => ({}));
        const weekly = body.weekly === true;
        const { error } = await supabase.from('servers').update({ backup_weekly: weekly }).eq('id', sid);
        if (error) { if (noTable(error)) return notSetUp(res); send(res, 500, { error: 'Could not save the schedule.' }); return; }
        if (weekly) writeBackup(sid, 'weekly').catch(() => {});
        send(res, 200, { ok: true, weekly });
        return;
      }
      send(res, 405, { error: 'Method not allowed.' });
      return;
    }

    // ── Featured artwork (187) ─────────────────────────────────
    const feat = /^\/api\/servers\/([^/]+)\/featured$/.exec(p);
    if (feat && req.method === 'PUT') {
      cors(res);
      const user = await requireUser(req, res); if (!user) return;
      const sid = feat[1];
      if (!isUuid(sid)) { send(res, 400, { error: 'Invalid server.' }); return; }
      const ctx = await roleFor(user.id, sid, res); if (!ctx) return;
      if (ctx.role !== 'owner') { send(res, 403, { error: 'Only the owner sets featured artwork.' }); return; }
      if (!(await needVerified(user, res))) return;
      const body = await readBody(req, 4096).catch(() => ({}));
      const theme = Object.assign({}, ctx.server.theme || {});
      const url = httpsUrl(body.url);
      if (url) theme.featured = url; else delete theme.featured;
      const { error } = await supabase.from('servers').update({ theme }).eq('id', sid);
      if (error) { send(res, 500, { error: 'Could not save the artwork.' }); return; }
      send(res, 200, { ok: true, featured: url });
      return;
    }

    // ── Channel type: announcement / QA (115/118/120) ──────────
    const ctype = /^\/api\/channels\/([^/]+)\/type$/.exec(p);
    if (ctype && req.method === 'PUT') {
      cors(res);
      const user = await requireUser(req, res); if (!user) return;
      const cid = ctype[1];
      if (!isUuid(cid)) { send(res, 400, { error: 'Invalid channel.' }); return; }
      const chan = await supabase.from('lobbies').select('id, server_id, kind').eq('id', cid).single().then(r => r.data);
      if (!chan || chan.kind !== 'channel') { send(res, 404, { error: 'Channel not found.' }); return; }
      const { role } = await serverRole(user.id, chan.server_id);
      if (role !== 'owner') { send(res, 403, { error: 'Only the owner changes the channel type.' }); return; }
      if (!(await needVerified(user, res))) return;
      const body = await readBody(req, 4096).catch(() => ({}));
      const type = ['chat', 'announcement', 'qa'].includes(body.type) ? body.type : null;
      if (!type) { send(res, 400, { error: 'Pick chat, announcement or QA.' }); return; }
      const { error } = await supabase.from('lobbies').update({ type }).eq('id', cid);
      if (error) { if (noTable(error)) return notSetUp(res); send(res, 500, { error: 'Could not change the channel type.' }); return; }
      send(res, 200, { ok: true, type });
      return;
    }

    send(res, 404, { error: 'Not found.' });
  }

  return { handle, matches, onGamePublished, sweepBackups };
};

function matches(pathname) {
  return pathname === '/api/events/public'
    || pathname === '/api/servers/public-meta'
    || pathname === '/api/mod/my-servers'
    || /^\/api\/servers\/[^/]+\/(bookmarks|polls|answered|questions|join-questions|game-feeds|mod-overview|backups|featured)(\/|$)/.test(pathname)
    || /^\/api\/lobbies\/[^/]+\/polls(\/|$)/.test(pathname)
    || /^\/api\/channels\/[^/]+\/type$/.test(pathname);
}
