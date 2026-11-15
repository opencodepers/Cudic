/* file: lib/routes/community.js
 * what: Community tools — DM peer cards, friend activity, per-user DM folders,
 *   channel templates, server audit log, owner backups and milestones.
 * invariants: every route resolves the caller first; server-scoped reads go
 *   through serverRole, and DM scoped reads go through canSeeLobby. Missing
 *   tables read as 503, never as an empty page that looks broken.
 */
module.exports = function createRoutes(deps) {
  const {
    supabase, cors, requireUser, needVerified, readBody, isUuid, canSeeLobby,
    serverRole, notify, awardUser, chanSlug, chanRoomName, sendConversationsDirty,
  } = deps;

  function send(res, code, body) {
    res.writeHead(code, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(body));
  }

  function noTable(err) {
    const code = String((err && err.code) || '');
    return code === 'PGRST205' || code === '42P01' || /does not exist|schema cache/i.test(String((err && err.message) || ''));
  }

  function notSetUp(res, what) {
    send(res, 503, { error: what + '_not_set_up', text: 'This needs the community-tools migration first.' });
  }

  async function audit(sid, actorId, action, target, meta) {
    try {
      await supabase.from('server_audit').insert({
        server_id: sid, actor_id: actorId || null, action: String(action).slice(0, 60),
        target: String(target || '').slice(0, 120), meta: meta || {},
      });
    } catch (e) {}
  }

  async function handle(req, res, url) {
    // ── Rich DM peer card ─────────────────────────────────────────
    const cardMatch = /^\/api\/users\/([^/]+)\/card$/.exec(url.pathname);
    if (cardMatch && req.method === 'GET') {
      cors(res);
      const user = await requireUser(req, res); if (!user) return;
      const targetId = cardMatch[1];
      if (!isUuid(targetId) || targetId === user.id) { send(res, 400, { error: 'Invalid user.' }); return; }
      const { data: card, error } = await supabase.from('users')
        .select('id, user_id, display_name, avatar_url, bio, interests, intro, created_at')
        .eq('id', targetId).single();
      if (error || !card) { send(res, 404, { error: 'User not found.' }); return; }
      card.status_emoji = '';
      card.status_text = '';
      try {
        const { data: ex } = await supabase.from('users')
          .select('status_emoji, status_text').eq('id', targetId).single();
        if (ex) { card.status_emoji = ex.status_emoji || ''; card.status_text = ex.status_text || ''; }
      } catch (e) {}
      const [mineRes, theirsRes, gamesRes] = await Promise.all([
        supabase.from('server_members').select('server_id').eq('user_id', user.id),
        supabase.from('server_members').select('server_id').eq('user_id', targetId),
        supabase.from('games').select('id, title, play_count').eq('owner_id', targetId)
          .eq('published', true).order('updated_at', { ascending: false }).limit(6),
      ]);
      const mineSet = new Set((mineRes.data || []).map(r => r.server_id));
      const mutualIds = (theirsRes.data || []).map(r => r.server_id).filter(id => mineSet.has(id));
      var mutual = [];
      if (mutualIds.length) {
        const { data: srvs } = await supabase.from('servers').select('id, name').in('id', mutualIds);
        mutual = (srvs || []).map(s => ({ id: s.id, name: s.name }));
      }
      const myInterests = new Set((Array.isArray(card.interests) ? card.interests : []).map(x => String(x).toLowerCase()));
      const shared = [];
      try {
        const { data: me } = await supabase.from('users').select('interests').eq('id', user.id).single();
        (me && Array.isArray(me.interests) ? me.interests : []).forEach(x => {
          if (myInterests.has(String(x).toLowerCase())) shared.push(x);
        });
      } catch (e) {}
      card.games = gamesRes.data || [];
      card.mutual_servers = mutual.slice(0, 12);
      card.shared_interests = shared.slice(0, 10);
      send(res, 200, { card });
      return;
    }

    // ── Friend activity (opt-in only) ────────────────────────────
    if (url.pathname === '/api/activity/friends' && req.method === 'GET') {
      cors(res);
      const user = await requireUser(req, res); if (!user) return;
      const me = user.id;
      const { data: rows } = await supabase.from('friendships')
        .select('user_id, friend_id').or('user_id.eq.' + me + ',friend_id.eq.' + me)
        .eq('status', 'accepted').limit(500);
      const ids = [...new Set((rows || []).map(r => (r.user_id === me ? r.friend_id : r.user_id)))];
      if (!ids.length) { send(res, 200, { activity: [] }); return; }
      const { data: users } = await supabase.from('users')
        .select('id, display_name, avatar_url, share_activity').in('id', ids);
      const sharing = (users || []).filter(u => u.share_activity === true);
      if (!sharing.length) { send(res, 200, { activity: [] }); return; }
      const byId = {};
      sharing.forEach(u => { byId[u.id] = u; });
      const { data: acts, error } = await supabase.from('activity')
        .select('id, user_id, kind, text, created_at')
        .in('user_id', sharing.map(u => u.id))
        .gte('created_at', new Date(Date.now() - 14 * 86400000).toISOString())
        .order('created_at', { ascending: false }).limit(50);
      if (error) { send(res, 200, { activity: [] }); return; }
      send(res, 200, {
        activity: (acts || []).map(a => ({
          id: a.id, kind: a.kind, text: a.text, created_at: a.created_at,
          user_id: a.user_id,
          display_name: (byId[a.user_id] && byId[a.user_id].display_name) || 'Someone',
          avatar_url: (byId[a.user_id] && byId[a.user_id].avatar_url) || null,
        })),
      });
      return;
    }

    // ── Per-user DM folders ──────────────────────────────────────
    if (url.pathname === '/api/folders' && (req.method === 'GET' || req.method === 'POST')) {
      cors(res);
      const user = await requireUser(req, res); if (!user) return;
      if (req.method === 'POST') {
        if (!(await needVerified(user, res))) return;
        const body = await readBody(req, 4096).catch(() => ({}));
        const name = String((body && body.name) || '').replace(/\s+/g, ' ').trim().substring(0, 24);
        if (name.length < 1) { send(res, 400, { error: 'Name the folder.' }); return; }
        const { count } = await supabase.from('conversation_folders')
          .select('id', { count: 'exact', head: true }).eq('user_id', user.id);
        if ((count || 0) >= 12) { send(res, 400, { error: 'You can keep up to 12 folders.' }); return; }
        const { data, error } = await supabase.from('conversation_folders')
          .insert({ user_id: user.id, name }).select('id, name, position').single();
        if (error) { if (noTable(error)) { notSetUp(res, 'folders'); return; } send(res, 400, { error: 'That folder already exists.' }); return; }
        send(res, 200, { folder: data });
        return;
      }
      const { data: folders, error } = await supabase.from('conversation_folders')
        .select('id, name, position').eq('user_id', user.id).order('position').order('created_at');
      if (error) { if (noTable(error)) { notSetUp(res, 'folders'); return; } send(res, 500, { error: 'Could not load folders.' }); return; }
      var items = [];
      if ((folders || []).length) {
        const { data: rows } = await supabase.from('conversation_folder_items')
          .select('folder_id, lobby_id').eq('user_id', user.id).in('folder_id', folders.map(f => f.id));
        items = rows || [];
      }
      send(res, 200, { folders: folders || [], items });
      return;
    }
    const folderMatch = /^\/api\/folders\/([^/]+)$/.exec(url.pathname);
    if (folderMatch && req.method === 'DELETE') {
      cors(res);
      const user = await requireUser(req, res); if (!user) return;
      if (!isUuid(folderMatch[1])) { send(res, 400, { error: 'Invalid folder.' }); return; }
      await supabase.from('conversation_folders').delete().eq('id', folderMatch[1]).eq('user_id', user.id);
      send(res, 200, { ok: true });
      return;
    }
    const folderItemMatch = /^\/api\/folders\/([^/]+)\/items(?:\/([^/]+))?$/.exec(url.pathname);
    if (folderItemMatch && (req.method === 'POST' || req.method === 'DELETE')) {
      cors(res);
      const user = await requireUser(req, res); if (!user) return;
      const fid = folderItemMatch[1];
      if (!isUuid(fid)) { send(res, 400, { error: 'Invalid folder.' }); return; }
      const { data: folder } = await supabase.from('conversation_folders')
        .select('id').eq('id', fid).eq('user_id', user.id).single();
      if (!folder) { send(res, 404, { error: 'Folder not found.' }); return; }
      var lobbyId = folderItemMatch[2] || '';
      if (!lobbyId) {
        const body = await readBody(req, 4096).catch(() => ({}));
        lobbyId = String((body && body.lobbyId) || '');
      }
      if (!isUuid(lobbyId)) { send(res, 400, { error: 'Invalid conversation.' }); return; }
      if (req.method === 'DELETE') {
        await supabase.from('conversation_folder_items').delete()
          .eq('folder_id', fid).eq('user_id', user.id).eq('lobby_id', lobbyId);
        send(res, 200, { ok: true });
        return;
      }
      if (!(await needVerified(user, res))) return;
      const { data: lobby } = await supabase.from('lobbies')
        .select('id, name, kind, server_id, is_private').eq('id', lobbyId).single();
      if (!lobby || lobby.kind !== 'dm' || !(await canSeeLobby(user.id, lobby))) {
        send(res, 404, { error: 'Direct message not found.' }); return;
      }
      const { error } = await supabase.from('conversation_folder_items')
        .upsert({ folder_id: fid, user_id: user.id, lobby_id: lobbyId }, { onConflict: 'folder_id,lobby_id' });
      if (error) { if (noTable(error)) { notSetUp(res, 'folders'); return; } send(res, 500, { error: 'Could not file the conversation.' }); return; }
      send(res, 200, { ok: true });
      return;
    }

    // ── Channel templates ────────────────────────────────────────
    const tplMatch = /^\/api\/servers\/([^/]+)\/templates(?:\/([^/]+))?(?:\/(apply))?$/.exec(url.pathname);
    if (tplMatch) {
      cors(res);
      const user = await requireUser(req, res); if (!user) return;
      const sid = tplMatch[1], tid = tplMatch[2], applying = tplMatch[3] === 'apply';
      if (!isUuid(sid)) { send(res, 400, { error: 'Invalid server.' }); return; }
      const { role } = await serverRole(user.id, sid);
      if (!role) { send(res, 403, { error: 'Join this server first.' }); return; }
      if (req.method === 'GET' && !tid) {
        const { data, error } = await supabase.from('channel_templates')
          .select('id, name, config, created_at').eq('server_id', sid).order('created_at');
        if (error) { if (noTable(error)) { notSetUp(res, 'templates'); return; } send(res, 500, { error: 'Could not load templates.' }); return; }
        send(res, 200, { templates: data || [] });
        return;
      }
      if (role !== 'owner') { send(res, 403, { error: 'Only the server owner can manage templates.' }); return; }
      if (!(await needVerified(user, res))) return;
      if (req.method === 'POST' && !tid && !applying) {
        const body = await readBody(req, 8192).catch(() => ({}));
        const name = String((body && body.name) || '').replace(/\s+/g, ' ').trim().substring(0, 32);
        const cid = String((body && body.channelId) || '');
        if (name.length < 1 || !isUuid(cid)) { send(res, 400, { error: 'Template name and channel required.' }); return; }
        const { data: ch } = await supabase.from('lobbies')
          .select('id, name, topic, description, is_private, slow_seconds').eq('id', cid).eq('server_id', sid).single();
        if (!ch) { send(res, 404, { error: 'Channel not found.' }); return; }
        const config = {
          slug: String(ch.name).split(':').pop(), topic: ch.topic || '',
          description: ch.description || '', is_private: !!ch.is_private,
          slow_seconds: ch.slow_seconds || 0,
        };
        const { data, error } = await supabase.from('channel_templates')
          .insert({ server_id: sid, name, config, created_by: user.id })
          .select('id, name, config, created_at').single();
        if (error) {
          if (noTable(error)) { notSetUp(res, 'templates'); return; }
          send(res, 400, { error: 'A template with that name already exists.' }); return;
        }
        await audit(sid, user.id, 'template.save', name, { channel: ch.name });
        send(res, 200, { template: data });
        return;
      }
      if (req.method === 'DELETE' && tid) {
        if (!isUuid(tid)) { send(res, 400, { error: 'Invalid template.' }); return; }
        await supabase.from('channel_templates').delete().eq('id', tid).eq('server_id', sid);
        await audit(sid, user.id, 'template.delete', tid);
        send(res, 200, { ok: true });
        return;
      }
      if (req.method === 'POST' && tid && applying) {
        if (!isUuid(tid)) { send(res, 400, { error: 'Invalid template.' }); return; }
        const { data: tpl } = await supabase.from('channel_templates')
          .select('id, name, config').eq('id', tid).eq('server_id', sid).single();
        if (!tpl) { send(res, 404, { error: 'Template not found.' }); return; }
        const body = await readBody(req, 4096).catch(() => ({}));
        const cfg = tpl.config || {};
        const slug = chanSlug((body && body.name) || cfg.slug || tpl.name);
        if (slug.length < 2) { send(res, 400, { error: 'Channel name 2-30 chars.' }); return; }
        const name = chanRoomName(sid, slug);
        const { data: ch, error } = await supabase.from('lobbies').insert({
          name, kind: 'channel', server_id: sid,
          topic: String(cfg.topic || '').substring(0, 200),
          description: String(cfg.description || '').substring(0, 500),
          is_private: !!cfg.is_private, created_by: user.id,
        }).select('id, name').single();
        if (error) { send(res, 400, { error: 'That channel already exists.' }); return; }
        await audit(sid, user.id, 'template.apply', name, { template: tpl.name });
        sendConversationsDirty();
        send(res, 200, { channel: ch });
        return;
      }
      send(res, 405, { error: 'Method not allowed.' });
      return;
    }

    // ── Server audit log ─────────────────────────────────────────
    const auditMatch = /^\/api\/servers\/([^/]+)\/audit$/.exec(url.pathname);
    if (auditMatch && req.method === 'GET') {
      cors(res);
      const user = await requireUser(req, res); if (!user) return;
      const sid = auditMatch[1];
      if (!isUuid(sid)) { send(res, 400, { error: 'Invalid server.' }); return; }
      const { role } = await serverRole(user.id, sid);
      if (role !== 'owner' && role !== 'mod') { send(res, 403, { error: 'Owner or mods only.' }); return; }
      const { data, error } = await supabase.from('server_audit')
        .select('id, action, target, meta, created_at, actor_id')
        .eq('server_id', sid).order('created_at', { ascending: false }).limit(100);
      if (error) { if (noTable(error)) { notSetUp(res, 'audit'); return; } send(res, 500, { error: 'Could not load the audit log.' }); return; }
      const ids = [...new Set((data || []).map(r => r.actor_id).filter(Boolean))];
      var names = {};
      if (ids.length) {
        const { data: users } = await supabase.from('users').select('id, display_name').in('id', ids);
        (users || []).forEach(u => { names[u.id] = u.display_name; });
      }
      send(res, 200, { audit: (data || []).map(r => Object.assign({}, r, { actor_name: names[r.actor_id] || 'Cudic' })) });
      return;
    }

    // ── Owner backup export / import ─────────────────────────────
    const backupMatch = /^\/api\/servers\/([^/]+)\/backup$/.exec(url.pathname);
    if (backupMatch) {
      cors(res);
      const user = await requireUser(req, res); if (!user) return;
      const sid = backupMatch[1];
      if (!isUuid(sid)) { send(res, 400, { error: 'Invalid server.' }); return; }
      const { server, role } = await serverRole(user.id, sid);
      if (!server || role !== 'owner') { send(res, 403, { error: 'Only the owner can back up this server.' }); return; }
      if (req.method === 'GET') {
        const [chRes, memRes, banRes, msRes] = await Promise.all([
          supabase.from('lobbies').select('name, topic, description, is_private, slow_seconds').eq('server_id', sid).eq('kind', 'channel').order('created_at'),
          supabase.from('server_members').select('user_id, role').eq('server_id', sid).limit(1000),
          supabase.from('server_bans').select('user_id, reason').eq('server_id', sid).limit(1000),
          supabase.from('server_milestones').select('code, reached_at').eq('server_id', sid),
        ]);
        send(res, 200, {
          version: 1,
          exported_at: new Date().toISOString(),
          backup: {
            server: { name: server.name, description: server.description || '', rules: server.rules || '', visibility: server.visibility },
            channels: (chRes.data || []).map(c => ({
              slug: String(c.name).split(':').pop(), topic: c.topic || '',
              description: c.description || '', is_private: !!c.is_private, slow_seconds: c.slow_seconds || 0,
            })),
            members: memRes.data || [],
            bans: banRes.data || [],
            milestones: msRes.data || [],
          },
        });
        return;
      }
      if (req.method === 'POST') {
        if (!(await needVerified(user, res))) return;
        const body = await readBody(req, 512 * 1024).catch(() => ({}));
        const b = (body && body.backup && typeof body.backup === 'object') ? body.backup : body;
        if (!b || typeof b !== 'object') { send(res, 400, { error: 'Backup file missing.' }); return; }
        var updates = {};
        const s = b.server && typeof b.server === 'object' ? b.server : {};
        if (typeof s.name === 'string') {
          const n = s.name.replace(/[^a-zA-Z0-9-_]/g, '').substring(0, 20);
          if (n.length >= 2) updates.name = n;
        }
        if (typeof s.description === 'string') updates.description = s.description.substring(0, 200);
        if (typeof s.rules === 'string') updates.rules = s.rules.substring(0, 2000);
        if (s.visibility === 'public' || s.visibility === 'private') updates.visibility = s.visibility;
        if (Object.keys(updates).length) await supabase.from('servers').update(updates).eq('id', sid);
        const wanted = Array.isArray(b.channels) ? b.channels.slice(0, 100) : [];
        const { data: existing } = await supabase.from('lobbies').select('name').eq('server_id', sid).eq('kind', 'channel');
        const have = new Set((existing || []).map(c => c.name));
        var created = 0;
        for (const c of wanted) {
          if (!c || typeof c !== 'object') continue;
          const slug = chanSlug(c.slug || c.name || '');
          if (slug.length < 2) continue;
          const name = chanRoomName(sid, slug);
          if (have.has(name)) continue;
          const { error } = await supabase.from('lobbies').insert({
            name, kind: 'channel', server_id: sid,
            topic: String(c.topic || '').substring(0, 200),
            description: String(c.description || '').substring(0, 500),
            is_private: !!c.is_private, slow_seconds: Math.max(0, Math.min(600, parseInt(c.slow_seconds, 10) || 0)),
            created_by: user.id,
          });
          if (!error) { created++; have.add(name); }
        }
        var roles = 0;
        const mems = Array.isArray(b.members) ? b.members.slice(0, 500) : [];
        for (const m of mems) {
          if (!m || !isUuid(m.user_id) || (m.role !== 'mod' && m.role !== 'member')) continue;
          const { error } = await supabase.from('server_members').update({ role: m.role })
            .eq('server_id', sid).eq('user_id', m.user_id);
          if (!error) roles++;
        }
        var bans = 0;
        const banRows = Array.isArray(b.bans) ? b.bans.slice(0, 500) : [];
        for (const bn of banRows) {
          if (!bn || !isUuid(bn.user_id)) continue;
          const { error } = await supabase.from('server_bans').upsert({
            server_id: sid, user_id: bn.user_id, banned_by: user.id,
            reason: String(bn.reason || '').substring(0, 240) || null,
          }, { onConflict: 'server_id,user_id' });
          if (!error) bans++;
        }
        await audit(sid, user.id, 'backup.restore', '', { channels_created: created, roles, bans });
        sendConversationsDirty();
        send(res, 200, { ok: true, channels_created: created, roles_restored: roles, bans_restored: bans });
        return;
      }
      send(res, 405, { error: 'Method not allowed.' });
      return;
    }

    // ── Milestone history ────────────────────────────────────────
    const msMatch = /^\/api\/servers\/([^/]+)\/milestones$/.exec(url.pathname);
    if (msMatch && req.method === 'GET') {
      cors(res);
      const user = await requireUser(req, res); if (!user) return;
      const sid = msMatch[1];
      if (!isUuid(sid)) { send(res, 400, { error: 'Invalid server.' }); return; }
      const { role } = await serverRole(user.id, sid);
      if (!role) { send(res, 403, { error: 'Join this server first.' }); return; }
      const { data, error } = await supabase.from('server_milestones')
        .select('code, reached_at').eq('server_id', sid).order('reached_at');
      if (error) { if (noTable(error)) { notSetUp(res, 'milestones'); return; } send(res, 500, { error: 'Could not load milestones.' }); return; }
      send(res, 200, { milestones: data || [] });
      return;
    }

    send(res, 404, { error: 'Not found.' });
  }

  return { handle, matches };
};

function matches(pathname) {
  return /^\/api\/users\/[^/]+\/card$/.test(pathname)
    || pathname === '/api/activity/friends'
    || pathname === '/api/folders' || pathname.startsWith('/api/folders/')
    || /^\/api\/servers\/[^/]+\/(templates|audit|backup|milestones)(\/|$)/.test(pathname);
}
