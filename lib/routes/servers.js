/* file: lib/routes/servers.js
 * what: Server routes — servers, channels, members, roles, kicks, bans and rules. Extracted verbatim from server.js so the chat surface
 *   can grow without editing the monolith; routing order is unchanged.
 * invariants: handle() is called only when matches() is true, and server.js
 *   falls through when nothing was written (res.headersSent is false). Every
 *   early `return` inside a route still exits the whole handler on purpose.
 */
module.exports = function createRoutes(deps) {
  const { supabase, cors, requireUser, needVerified, readBody, isUuid, serverRole, chanSlug, chanRoomName, chanDisplay, sendConversationsDirty, safeIconUrl, awardUser, crypto, lobbies } = deps;

  // Audit rows are best-effort: a missing table must never fail the action
  // it is recording. Owner/mods read them through /api/servers/:sid/audit.
  async function audit(sid, actorId, action, target, meta) {
    try {
      await supabase.from('server_audit').insert({
        server_id: sid, actor_id: actorId || null, action: String(action).slice(0, 60),
        target: String(target || '').slice(0, 120), meta: meta || {},
      });
    } catch (e) {}
  }

  async function handle(req, res, url) {
    if (url.pathname === '/api/servers' && req.method === 'GET') {
      cors(res);
      const authHeader = req.headers.authorization || '';
      const token = authHeader.replace('Bearer ', '');
      let userId = null;
      if (token) {
        const { data: { user } } = await supabase.auth.getUser(token);
        if (user) userId = user.id;
      }
      let query = supabase.from('servers').select('id, name, description, icon_url, visibility, invite_code, owner_id, rules, created_at, users!owner_id(display_name)').order('created_at', { ascending: false });
      const { data, error } = await query.limit(50);
      // Filter: show public or owned/member
      let filtered = (data || []).filter(s => s.visibility === 'public');
      if (userId) {
        const { data: memberServers } = await supabase.from('server_members').select('server_id').eq('user_id', userId);
        const memberIds = new Set((memberServers || []).map(m => m.server_id));
        const mine = (data || []).filter(s => s.owner_id === userId || memberIds.has(s.id));
        // A private server older than the newest-50 window is missing from
        // page one — fetch just those and merge them in.
        const known = new Set((data || []).map(s => s.id));
        const absent = [...memberIds].filter(id => !known.has(id));
        if (absent.length) {
          const { data: extraRows } = await supabase.from('servers').select('id, name, description, icon_url, visibility, invite_code, owner_id, rules, created_at, users!owner_id(display_name)').in('id', absent);
          mine.push(...(extraRows || []));
        }
        filtered = [...mine, ...filtered];
      }
      // Liveness per server: member counts (one query) + online now
      // (sum of live sockets across the server's channels, same process).
      const sids = filtered.map(s => s.id);
      var memberCount = {};
      if (sids.length) {
        const { data: mems } = await supabase.from('server_members').select('server_id').in('server_id', sids);
        (mems || []).forEach(m => { memberCount[m.server_id] = (memberCount[m.server_id] || 0) + 1; });
      }
      const withLive = filtered.map(s => {
        var online = 0;
        try {
          for (const entry of lobbies) {
            if (typeof entry[0] === 'string' && entry[0].startsWith('chan:' + s.id + ':')) online += entry[1].size;
          }
        } catch (e) {}
        return Object.assign({}, s, { member_count: memberCount[s.id] || 0, online });
      });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ servers: withLive }));
      return;
    }

    // Get my servers (owned)
    if (url.pathname === '/api/servers/mine' && req.method === 'GET') {
      cors(res);
      const authHeader = req.headers.authorization || '';
      const token = authHeader.replace('Bearer ', '');
      if (!token) { res.writeHead(401); res.end(); return; }
      const { data: { user } } = await supabase.auth.getUser(token);
      if (!user) { res.writeHead(401); res.end(); return; }
      const { data } = await supabase.from('servers').select('id, name, description, icon_url, visibility, invite_code, rules, created_at').eq('owner_id', user.id).order('created_at', { ascending: true });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ servers: data || [] }));
      return;
    }

    // ── Server templates: preset channel bundles picked at creation ──
    // (Discord-style: Gaming, School, Study, Friends, Local Community).
    // Single source of truth — the create-server picker reads these.
    const SERVER_TEMPLATES = {
      blank: { name: 'Blank', description: 'Just the basics.', channels: [
        { slug: 'general', topic: '' },
        { slug: 'random', topic: '' } ] },
      gaming: { name: 'Gaming', description: 'Coordinate sessions and share clips.', channels: [
        { slug: 'general', topic: 'Home base' },
        { slug: 'clips', topic: 'Screenshots and clips' },
        { slug: 'lfg', topic: 'Find players' },
        { slug: 'off-topic', topic: '' } ] },
      school: { name: 'School', description: 'Classes, homework help, resources.', channels: [
        { slug: 'general', topic: 'Home base' },
        { slug: 'homework-help', topic: 'Ask and answer' },
        { slug: 'resources', topic: 'Notes and links' },
        { slug: 'off-topic', topic: '' } ] },
      study: { name: 'Study Group', description: 'Goals, questions, shared resources.', channels: [
        { slug: 'general', topic: 'Home base' },
        { slug: 'goals', topic: 'Daily goals' },
        { slug: 'questions', topic: 'Ask anything' },
        { slug: 'resources', topic: 'Shared notes and links' } ] },
      friends: { name: 'Friends', description: 'Your circle, nothing formal.', channels: [
        { slug: 'general', topic: 'Home base' },
        { slug: 'plans', topic: 'Make plans' },
        { slug: 'media', topic: 'Photos and clips' },
        { slug: 'random', topic: '' } ] },
      community: { name: 'Local Community', description: 'Neighborhood hub: events and tips.', channels: [
        { slug: 'general', topic: 'Home base' },
        { slug: 'announcements', topic: 'Official updates' },
        { slug: 'events', topic: 'What is happening' },
        { slug: 'recommendations', topic: 'Tips and finds' } ] },
    };
    const STARTER_RULES = [
      'Be kind — no harassment, hate speech, or slurs.',
      'No spam, ads, or NSFW.',
      'Keep channels on topic.',
      'Respect other members and their DMs.',
      'Follow community guidelines.',
    ].join('\n');

    // ── API: list server templates (public, static data) ────────────
    if (url.pathname === '/api/server-templates' && req.method === 'GET') {
      cors(res);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        templates: Object.keys(SERVER_TEMPLATES).map(k => ({
          slug: k, name: SERVER_TEMPLATES[k].name,
          description: SERVER_TEMPLATES[k].description,
          channels: SERVER_TEMPLATES[k].channels,
        })),
        starterRules: STARTER_RULES,
      }));
      return;
    }

    // Create server (max 3 per user)
    if (url.pathname === '/api/servers' && req.method === 'POST') {
      cors(res);
      const authHeader = req.headers.authorization || '';
      const token = authHeader.replace('Bearer ', '');
      if (!token) { res.writeHead(401, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'Unauthorized' })); return; }
      const { data: { user }, error: authErr } = await supabase.auth.getUser(token);
      if (authErr || !user) { res.writeHead(401, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'Unauthorized' })); return; }
      if (!(await needVerified(user, res))) return;
      // Check limit
      const { count } = await supabase.from('servers').select('id', { count: 'exact', head: true }).eq('owner_id', user.id);
      if (count !== null && count >= 50) { res.writeHead(400, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'You can own at most 50 servers.' })); return; }
      const body = await readBody(req);
      const name = (body.name || '').trim().replace(/[^a-zA-Z0-9-_]/g, '').substring(0, 20);
      if (!name || name.length < 2) { res.writeHead(400, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'Server name 2-20 chars (letters, numbers, -,_)' })); return; }
      const invite = crypto.randomBytes(4).toString('hex');
      const { data, error } = await supabase.from('servers').insert({
        name,
        description: (body.description || '').substring(0, 200),
        icon_url: safeIconUrl(body.icon_url),
        visibility: body.visibility === 'private' ? 'private' : 'public',
        invite_code: invite,
        owner_id: user.id,
        rules: String(body.rules || '').substring(0, 2000),
      }).select().single();
      if (error) { console.error('servers insert error:', error.message); res.writeHead(400, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'Could not create the server.' })); return; }
      // Add owner as member with the owner role
      await supabase.from('server_members').insert({ server_id: data.id, user_id: user.id, role: 'owner' });
      await awardUser(user.id, 'host');
      // Channels from the picked template (blank = general + random)
      const tpl = SERVER_TEMPLATES[body.template] || SERVER_TEMPLATES.blank;
      await supabase.from('lobbies').insert(tpl.channels.map(c => ({
        name: 'chan:' + data.id + ':' + c.slug, kind: 'channel',
        server_id: data.id, topic: c.topic || '', created_by: user.id,
      })));
      sendConversationsDirty();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ server: data }));
      return;
    }

    // Update server (owner only)
    if (url.pathname.startsWith('/api/servers/') && req.method === 'PUT') {
      cors(res);
      const id = url.pathname.split('/')[3];
      const authHeader = req.headers.authorization || '';
      const token = authHeader.replace('Bearer ', '');
      if (!token) { res.writeHead(401); res.end(); return; }
      const { data: { user } } = await supabase.auth.getUser(token);
      if (!user) { res.writeHead(401); res.end(); return; }
      if (!(await needVerified(user, res))) return;
      const body = await readBody(req);
      const updates = {};
      if (body.name !== undefined) {
        const n = body.name.trim().replace(/[^a-zA-Z0-9-_]/g, '').substring(0, 20);
        if (n.length >= 2) updates.name = n;
      }
      if (body.description !== undefined) updates.description = body.description.substring(0, 200);
      if (body.icon_url !== undefined) updates.icon_url = safeIconUrl(body.icon_url);
      if (body.visibility !== undefined && ['public','private'].includes(body.visibility)) updates.visibility = body.visibility;
      if (body.rules !== undefined) updates.rules = String(body.rules || '').substring(0, 2000);
      if (Object.keys(updates).length === 0) { res.writeHead(400); res.end(); return; }
      const { data, error } = await supabase.from('servers').update(updates).eq('id', id).eq('owner_id', user.id).select().single();
      if (error) { res.writeHead(400, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: error.message })); return; }
      sendConversationsDirty();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ server: data }));
      return;
    }

    // Delete server
    if (url.pathname.startsWith('/api/servers/') && req.method === 'DELETE') {
      cors(res);
      const id = url.pathname.split('/')[3];
      const authHeader = req.headers.authorization || '';
      const token = authHeader.replace('Bearer ', '');
      if (!token) { res.writeHead(401); res.end(); return; }
      const { data: { user } } = await supabase.auth.getUser(token);
      if (!user) { res.writeHead(401); res.end(); return; }
      if (!(await needVerified(user, res))) return;
      await supabase.from('servers').delete().eq('id', id).eq('owner_id', user.id);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
      return;
    }

    // Join server (by invite code or public)
    if (url.pathname.endsWith('/join') && req.method === 'POST') {
      cors(res);
      const parts = url.pathname.split('/');
      const id = parts[3];
      const authHeader = req.headers.authorization || '';
      const token = authHeader.replace('Bearer ', '');
      if (!token) { res.writeHead(401); res.end(); return; }
      const { data: { user } } = await supabase.auth.getUser(token);
      if (!user) { res.writeHead(401); res.end(); return; }
      if (!(await needVerified(user, res))) return;
      const body = await readBody(req).catch(() => ({}));
      const { data: server } = await supabase.from('servers').select('id, visibility, invite_code').eq('id', id).single();
      if (!server) { res.writeHead(404); res.end(); return; }
      if (server.visibility === 'private' && body.invite_code !== server.invite_code) {
        res.writeHead(403, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'Invalid invite code' })); return;
      }
      // Banned people stay out, invite code or not.
      const { data: banRow } = await supabase.from('server_bans').select('reason, created_at').eq('server_id', server.id).eq('user_id', user.id).single();
      if (banRow) {
        res.writeHead(403, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'You are banned from this server.' + (banRow.reason ? ' Reason: ' + banRow.reason : '') })); return;
      }
      await supabase.from('server_members').upsert({ server_id: server.id, user_id: user.id }, { onConflict: 'server_id,user_id' });
      sendConversationsDirty();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
      return;
    }

    // Leave server
    if (url.pathname.endsWith('/leave') && req.method === 'POST') {
      cors(res);
      const id = url.pathname.split('/')[3];
      const authHeader = req.headers.authorization || '';
      const token = authHeader.replace('Bearer ', '');
      if (!token) { res.writeHead(401); res.end(); return; }
      const { data: { user } } = await supabase.auth.getUser(token);
      if (!user) { res.writeHead(401); res.end(); return; }
      await supabase.from('server_members').delete().eq('server_id', id).eq('user_id', user.id);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
      return;
    }

    // Regenerate invite code
    if (url.pathname.endsWith('/regenerate-invite') && req.method === 'POST') {
      cors(res);
      const id = url.pathname.split('/')[3];
      const authHeader = req.headers.authorization || '';
      const token = authHeader.replace('Bearer ', '');
      if (!token) { res.writeHead(401); res.end(); return; }
      const { data: { user } } = await supabase.auth.getUser(token);
      if (!user) { res.writeHead(401); res.end(); return; }
      if (!(await needVerified(user, res))) return;
      const newCode = crypto.randomBytes(4).toString('hex');
      const { data } = await supabase.from('servers').update({ invite_code: newCode }).eq('id', id).eq('owner_id', user.id).select().single();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ server: data }));
      return;
    }

    // My membership in a server (role + rules acceptance)
    if (url.pathname.startsWith('/api/servers/') && url.pathname.endsWith('/membership') && req.method === 'GET') {
      cors(res);
      const id = url.pathname.split('/')[3];
      const authHeader = req.headers.authorization || '';
      const token = authHeader.replace('Bearer ', '');
      if (!token) { res.writeHead(401); res.end(); return; }
      const { data: { user } } = await supabase.auth.getUser(token);
      if (!user) { res.writeHead(401); res.end(); return; }
      if (!isUuid(id)) { res.writeHead(400, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'Invalid server.' })); return; }
      const { data: m } = await supabase.from('server_members').select('role, rules_accepted_at').eq('server_id', id).eq('user_id', user.id).single();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ member: !!m, role: m ? m.role : null, accepted: !!(m && m.rules_accepted_at) }));
      return;
    }

    // Accept a server's rules (must already be a member)
    if (url.pathname.startsWith('/api/servers/') && url.pathname.endsWith('/rules/accept') && req.method === 'POST') {
      cors(res);
      const id = url.pathname.split('/')[3];
      const authHeader = req.headers.authorization || '';
      const token = authHeader.replace('Bearer ', '');
      if (!token) { res.writeHead(401); res.end(); return; }
      const { data: { user } } = await supabase.auth.getUser(token);
      if (!user) { res.writeHead(401); res.end(); return; }
      if (!isUuid(id)) { res.writeHead(400, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'Invalid server.' })); return; }
      const { data: m } = await supabase.from('server_members').select('server_id').eq('server_id', id).eq('user_id', user.id).single();
      if (!m) { res.writeHead(403, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'Join this server first.' })); return; }
      if (!(await needVerified(user, res))) return;
      if (!m) { res.writeHead(403, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'Join this server first.' })); return; }
      await supabase.from('server_members').update({ rules_accepted_at: new Date().toISOString() }).eq('server_id', id).eq('user_id', user.id);
      sendConversationsDirty();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
      return;
    }

    if (url.pathname.startsWith('/api/servers/') && url.pathname.endsWith('/channels') && (req.method === 'GET' || req.method === 'POST')) {
      cors(res);
      const user = await requireUser(req, res); if (!user) return;
      const me = user.id;
      const sid = url.pathname.split('/')[3];
      if (!isUuid(sid)) { res.writeHead(400, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'Invalid server.' })); return; }
      const { server, role } = await serverRole(me, sid);
      if (!server) { res.writeHead(404, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'Server not found.' })); return; }
      if (req.method === 'GET') {
        if (server.visibility !== 'public' && !role) { res.writeHead(403, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'Join this server first.' })); return; }
        let q = supabase.from('lobbies').select('id, name, topic, description, is_private, slow_seconds, created_at, folder_id').eq('kind', 'channel').eq('server_id', sid).order('created_at', { ascending: true });
        const { data, error: chanErr } = await q;
        // A select error (e.g. a migration column not applied yet) used to be
        // discarded and rendered as `{channels: []}` — a template server looked
        // empty with no trace. Fail loudly so the cause is visible.
        if (chanErr) { console.error('channels select failed:', chanErr.message); res.writeHead(500, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'Could not load channels.' })); return; }
        var chans = data || [];
        if (role !== 'owner') {
          const { data: mine } = await supabase.from('conversation_members').select('lobby_id').eq('user_id', me);
          var mineSet = {};
          (mine || []).forEach(r => { mineSet[r.lobby_id] = 1; });
          chans = chans.filter(c => !c.is_private || mineSet[c.id]);
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ channels: chans.map(c => ({ id: c.id, name: c.name, slug: c.name.split(':').pop(), display: chanDisplay(c.name), topic: c.topic || '', description: c.description || '', is_private: !!c.is_private, slow_seconds: c.slow_seconds || 0, folder_id: c.folder_id || null, created_at: c.created_at })) }));
        return;
      }
      // POST: create channel (owner only)
      if (role !== 'owner') { res.writeHead(403, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'Only the server owner can add channels.' })); return; }
      if (!(await needVerified(user, res))) return;
      const body = await readBody(req).catch(() => ({}));
      const slug = chanSlug(body.name);
      if (slug.length < 2) { res.writeHead(400, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'Channel name 2-30 chars (letters, numbers, -, _).' })); return; }
      const { data, error } = await supabase.from('lobbies').insert({ name: chanRoomName(sid, slug), kind: 'channel', server_id: sid, topic: String(body.topic || '').substring(0, 200), description: String(body.description || '').substring(0, 500), is_private: !!body.is_private, created_by: me }).select('id, name').single();
      if (error) { res.writeHead(400, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'Channel exists.' })); return; }
      await audit(sid, me, 'channel.create', data.name, {});
      sendConversationsDirty();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ channel: data }));
      return;
    }

    // ── API: edit a channel (owner only) ───────────────────────────
    if (url.pathname.startsWith('/api/channels/') && req.method === 'PATCH' && url.pathname.split('/').length === 4) {
      cors(res);
      const user = await requireUser(req, res); if (!user) return;
      const me = user.id;
      if (!(await needVerified(user, res))) return;
      const cid = url.pathname.split('/')[3];
      if (!isUuid(cid)) { res.writeHead(400, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'Invalid channel.' })); return; }
      const { data: lobby } = await supabase.from('lobbies').select('id, name, kind, server_id').eq('id', cid).single();
      if (!lobby || lobby.kind !== 'channel') { res.writeHead(404, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'Channel not found.' })); return; }
      const { role } = await serverRole(me, lobby.server_id);
      if (role !== 'owner') { res.writeHead(403, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'Only the server owner can edit channels.' })); return; }
      const body = await readBody(req).catch(() => ({}));
      var updates = {};
      if (body.name !== undefined) {
        const slug = chanSlug(body.name);
        if (slug.length < 2) { res.writeHead(400, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'Channel name 2-30 chars (letters, numbers, -, _).' })); return; }
        updates.name = chanRoomName(lobby.server_id, slug);
      }
      if (body.topic !== undefined) updates.topic = String(body.topic || '').substring(0, 200);
      if (body.description !== undefined) updates.description = String(body.description || '').substring(0, 500);
      if (body.is_private !== undefined) updates.is_private = !!body.is_private;
      if (body.slow_seconds !== undefined) {
        const s = parseInt(body.slow_seconds, 10);
        updates.slow_seconds = (isNaN(s) || s < 0 || s > 600) ? 0 : s;
      }
      if (!Object.keys(updates).length) { res.writeHead(400, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'Nothing to update.' })); return; }
      const { data, error } = await supabase.from('lobbies').update(updates).eq('id', cid).select('id, name').single();
      if (error) { res.writeHead(400, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'Channel exists.' })); return; }
      await audit(lobby.server_id, me, 'channel.update', cid, updates);
      sendConversationsDirty();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ channel: data }));
      return;
    }

    // ── API: server member roster (owner/mod view) ───────────────
    // GET /api/servers/:sid/members — powers the in-chat moderation panel.
    // Owner or mods only; owner/mods never appear actionable (server calls
    // them out and the UI hides the buttons).
    if (url.pathname.startsWith('/api/servers/') && url.pathname.endsWith('/members') && req.method === 'GET') {
      cors(res);
      const user = await requireUser(req, res); if (!user) return;
      const sid = url.pathname.split('/')[3];
      if (!isUuid(sid)) { res.writeHead(400, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'Invalid server.' })); return; }
      const { role } = await serverRole(user.id, sid);
      if (role !== 'owner' && role !== 'mod') { res.writeHead(403, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'Owner or mods only.' })); return; }
      const [mRes, bRes] = await Promise.all([
        supabase.from('server_members').select('role, user_id').eq('server_id', sid).limit(500),
        supabase.from('server_bans').select('user_id, reason, created_at').eq('server_id', sid).limit(500)
      ]);
      const ids = [...new Set([...(mRes.data || []).map(m => m.user_id), ...(bRes.data || []).map(b => b.user_id)])];
      var byId = {};
      if (ids.length) {
        const { data: us } = await supabase.from('users').select('id, display_name, user_id').in('id', ids);
        (us || []).forEach(u => { byId[u.id] = u; });
      }
      const members = (mRes.data || []).map(m => ({ user_id: m.user_id, display_name: (byId[m.user_id] && byId[m.user_id].display_name) || 'Unknown', num_id: (byId[m.user_id] && byId[m.user_id].user_id) || null, role: m.role }))
        .sort((a, b) => (a.role === 'owner' ? -1 : b.role === 'owner' ? 1 : 0) || String(a.display_name).localeCompare(b.display_name));
      const bans = (bRes.data || []).map(b => ({ user_id: b.user_id, reason: b.reason || null, name: (byId[b.user_id] && byId[b.user_id].display_name) || 'Unknown' }));
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ members, bans }));
      return;
    }

    // ── API: per-server roles + kicks + bans (owner/mod) ─────────────
    // PUT    /api/servers/:sid/members/:uid { role: 'mod'|'member' } — owner
    //        promotes/demotes. The owner row never changes hands.
    // DELETE /api/servers/:sid/members/:uid — owner or mod kicks (mods can't
    //        kick their peers). Same-hour rules gate stays untouched.
    // POST   /api/servers/:sid/bans/:uid { reason } — owner or mod bans:
    //        membership row + ban row together, and JOIN refuses a banned id.
    // DELETE /api/servers/:sid/bans/:uid — owner or mod unbans.
    const srvMm = /^\/api\/servers\/([^/]+)\/(members|bans)\/([^/]+)$/.exec(url.pathname);
    if (srvMm && (req.method === 'PUT' || req.method === 'POST' || req.method === 'DELETE')) {
      cors(res);
      const user = await requireUser(req, res); if (!user) return;
      if (!(await needVerified(user, res))) return;
      const sid = srvMm[1], list = srvMm[2], target = srvMm[3];
      if (!isUuid(sid) || !isUuid(target)) { res.writeHead(400, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'Invalid server or user.' })); return; }
      const { role: myRole } = await serverRole(user.id, sid);
      if (!myRole) { res.writeHead(403, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'Join this server first.' })); return; }
      const { data: tRole0 } = await supabase.from('server_members').select('role').eq('server_id', sid).eq('user_id', target).single();
      const tRole = (tRole0 && tRole0.role) || null;
      if (tRole === 'owner') { res.writeHead(403, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'That is the owner.' })); return; }
      if (user.id === target) { res.writeHead(400, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'No self-actions — leave the server instead.' })); return; }
      if (list === 'members' && req.method === 'PUT') {
        if (myRole !== 'owner') { res.writeHead(403, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'Only the owner sets roles.' })); return; }
        const body = await readBody(req).catch(() => ({}));
        const r = body.role === 'mod' ? 'mod' : 'member';
        const { error } = await supabase.from('server_members').update({ role: r }).eq('server_id', sid).eq('user_id', target);
        if (error && !/no rows/.test(String(error.message))) { res.writeHead(400, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'They are not a member.' })); return; }
        await audit(sid, user.id, 'member.role', target, { role: r });
        sendConversationsDirty();
        res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ ok: true, role: r }));
        return;
      }
      if (list === 'members' && req.method === 'DELETE') {
        if (myRole !== 'owner' && myRole !== 'mod') { res.writeHead(403, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'Owner or mods only.' })); return; }
        if (tRole === 'mod' && myRole !== 'owner') { res.writeHead(403, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'Only the owner kicks a mod.' })); return; }
        await supabase.from('server_members').delete().eq('server_id', sid).eq('user_id', target);
        await audit(sid, user.id, 'member.kick', target, {});
        sendConversationsDirty();
        res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ ok: true }));
        return;
      }
      if (list === 'bans') {
        if (myRole !== 'owner' && myRole !== 'mod') { res.writeHead(403, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'Owner or mods only.' })); return; }
        if (tRole === 'mod' && myRole !== 'owner') { res.writeHead(403, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'Only the owner bans a mod.' })); return; }
        if (req.method === 'POST') {
          const body = await readBody(req).catch(() => ({}));
          await supabase.from('server_members').delete().eq('server_id', sid).eq('user_id', target);
          const { error } = await supabase.from('server_bans').upsert({
            server_id: sid, user_id: target, banned_by: user.id,
            reason: String((body && body.reason) || '').substring(0, 240) || null
          }, { onConflict: 'server_id,user_id' });
          if (error) { res.writeHead(500, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'Could not ban.' })); return; }
          await audit(sid, user.id, 'member.ban', target, { reason: String((body && body.reason) || '').slice(0, 240) });
          sendConversationsDirty();
          res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ ok: true }));
        } else {
          await supabase.from('server_bans').delete().eq('server_id', sid).eq('user_id', target);
          res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ ok: true }));
        }
        return;
      }
    }

    // ── API: private-channel membership (owner only) ────────────────
    if (url.pathname.startsWith('/api/channels/') && url.pathname.split('/')[4] === 'members' && (req.method === 'POST' || req.method === 'DELETE')) {
      cors(res);
      const user = await requireUser(req, res); if (!user) return;
      const me = user.id;
      const parts = url.pathname.split('/');
      const cid = parts[3];
      if (!(await needVerified(user, res))) return;
      if (!isUuid(cid)) { res.writeHead(400, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'Invalid channel.' })); return; }
      const { data: lobby } = await supabase.from('lobbies').select('id, kind, server_id').eq('id', cid).single();
      if (!lobby || lobby.kind !== 'channel') { res.writeHead(404, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'Channel not found.' })); return; }
      const { role } = await serverRole(me, lobby.server_id);
      if (role !== 'owner') { res.writeHead(403, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'Only the server owner can manage members.' })); return; }
      var targetId;
      if (req.method === 'POST') {
        const body = await readBody(req).catch(() => ({}));
        targetId = String(body.userId || '').trim();
      } else {
        targetId = String(parts[5] || '').trim();
      }
      if (!isUuid(targetId)) { res.writeHead(400, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'Invalid user.' })); return; }
      if (req.method === 'POST') {
        const { role: tr } = await serverRole(targetId, lobby.server_id);
        if (!tr) { res.writeHead(400, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'They must join the server first.' })); return; }
        await supabase.from('conversation_members').upsert({ user_id: targetId, lobby_id: cid }, { onConflict: 'user_id,lobby_id' });
      } else {
        await supabase.from('conversation_members').delete().eq('user_id', targetId).eq('lobby_id', cid);
      }
      sendConversationsDirty();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
      return;
    }

  }

  return { handle, matches };
};

function matches(pathname) {
  return pathname === '/api/servers' || pathname.startsWith('/api/servers/')
    || pathname.startsWith('/api/channels/') || pathname === '/api/server-templates';
}
