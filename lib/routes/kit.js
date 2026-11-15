/* file: lib/routes/kit.js
 * what: the server kit — named theme presets, channel icons/order/tags/welcome
 *   lines, category icons, server tags, a game card, and the public invite
 *   lookup behind /join/<code>.
 * invariants: reads need membership and go through serverRole; every write is
 *   owner-only and re-validates the ids it was handed against the server, so a
 *   channel from another server can never be renamed or reordered. Missing
 *   columns answer 503 with the feature hidden rather than wiping a field.
 */
module.exports = function createRoutes(deps) {
  const { supabase, cors, requireUser, needVerified, readBody, isUuid, serverRole, rateLimit } = deps;

  const LABELS = ['spoiler', 'nsfw', 'art', 'build', 'event'];
  const FONTS = {
    default: '',
    geist: '"Geist", system-ui, -apple-system, "Segoe UI", sans-serif',
    mono: 'ui-monospace, "SF Mono", Menlo, Consolas, monospace',
    serif: 'Georgia, "Times New Roman", serif',
    rounded: 'ui-rounded, "Segoe UI", system-ui, sans-serif',
  };

  function send(res, code, body) {
    res.writeHead(code, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(body));
  }
  function noTable(err) {
    const code = String((err && err.code) || '');
    return code === 'PGRST205' || code === '42P01' || /does not exist|schema cache/i.test(String((err && err.message) || ''));
  }
  function text(value, max) {
    return String(value == null ? '' : value).replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max);
  }
  function tagList(value, maxCount) {
    const raw = Array.isArray(value) ? value : [];
    const out = [];
    for (const item of raw) {
      const tag = text(item, 16).replace(/[<>]/g, '');
      if (tag && !out.includes(tag) && out.length < maxCount) out.push(tag);
    }
    return out;
  }
  function accent(value) {
    const v = String(value || '').trim();
    return /^#[0-9a-fA-F]{6}$/.test(v) ? v : '';
  }
  function background(value) {
    const v = String(value || '').trim();
    return /^https:\/\/[^\s"'<>]{1,300}$/i.test(v) ? v : '';
  }
  function themeOf(body) {
    const theme = {};
    const a = accent(body && body.accent);
    const bg = background(body && body.background);
    if (a) theme.accent = a;
    if (bg) theme.background = bg;
    if (body && typeof body.font === 'string' && Object.prototype.hasOwnProperty.call(FONTS, body.font)) theme.font = body.font;
    return theme;
  }
  async function channelRows(sid) {
    const { data, error } = await supabase.from('lobbies')
      .select('id, name, kind, icon, position, tags, labels, welcome, folder_id, is_private, expires_at')
      .eq('server_id', sid).eq('kind', 'channel').order('position').order('created_at');
    if (error) return { rows: [], missing: noTable(error) };
    return { rows: data || [], missing: false };
  }

  async function handle(req, res, url) {
    // ── Public invite lookup (190) ───────────────────────────────
    const inviteMatch = /^\/api\/servers\/invite\/([A-Za-z0-9_-]{4,40})$/.exec(url.pathname);
    if (inviteMatch && req.method === 'GET') {
      cors(res);
      const { data: srv, error } = await supabase.from('servers')
        .select('id, name, description, icon_url, rules, tags, visibility, invite_code, created_at, theme')
        .eq('invite_code', inviteMatch[1]).single();
      if (error || !srv) { send(res, 404, { error: 'No server uses that invite code.' }); return; }
      const { count } = await supabase.from('server_members')
        .select('user_id', { count: 'exact', head: true }).eq('server_id', srv.id);
      send(res, 200, {
        server: {
          id: srv.id, name: srv.name, description: srv.description || '',
          icon_url: srv.icon_url || null, rules: srv.rules || '',
          tags: Array.isArray(srv.tags) ? srv.tags : [],
          visibility: srv.visibility, members: count || 0,
          accent: (srv.theme && srv.theme.accent) || null,
        },
      });
      return;
    }

    const kitMatch = /^\/api\/servers\/([^/]+)\/kit$/.exec(url.pathname);
    if (kitMatch) {
      cors(res);
      const user = await requireUser(req, res); if (!user) return;
      const sid = kitMatch[1];
      if (!isUuid(sid)) { send(res, 400, { error: 'Invalid server.' }); return; }
      const { server, role } = await serverRole(user.id, sid);
      if (!role) { send(res, 403, { error: 'Join this server first.' }); return; }

      if (req.method === 'GET') {
        const [ch, fo, pr] = await Promise.all([
          channelRows(sid),
          supabase.from('channel_folders').select('id, name, parent_id, icon, position').eq('server_id', sid).order('position').order('created_at'),
          supabase.from('server_theme_presets').select('id, name, theme, created_at').eq('server_id', sid).order('created_at'),
        ]);
        send(res, 200, {
          owner: role === 'owner',
          server: {
            id: sid,
            name: (server && server.name) || '',
            tags: Array.isArray(server && server.tags) ? server.tags : [],
            meta: (server && server.meta) || {},
            theme: (server && server.theme) || {},
            invite_code: (server && server.invite_code) || '',
            visibility: (server && server.visibility) || 'public',
          },
          channels: ch.rows.map(c => ({
            id: c.id, name: String(c.name).split(':').pop(), icon: c.icon || '',
            position: c.position || 0, tags: Array.isArray(c.tags) ? c.tags : [],
            welcome: c.welcome || '', folder_id: c.folder_id || null,
            labels: Array.isArray(c.labels) ? c.labels : [],
            is_private: !!c.is_private, expires_at: c.expires_at || null,
          })),
          folders: (fo.data || []).map(f => ({ id: f.id, name: f.name, parent_id: f.parent_id || null, icon: f.icon || '', position: f.position || 0 })),
          presets: pr.data || [],
          channels_not_set_up: ch.missing,
        });
        return;
      }

      if (req.method === 'PUT') {
        if (role !== 'owner') { send(res, 403, { error: 'Only the owner can change server settings.' }); return; }
        if (!(await needVerified(user, res))) return;
        if (!rateLimit('kit:' + user.id, 30, 60 * 1000)) { send(res, 429, { error: 'Slow down.' }); return; }
        const body = await readBody(req, 16384).catch(() => ({}));
        const update = {};
        if (body && body.tags !== undefined) update.tags = tagList(body.tags, 5);
        if (body && body.font !== undefined) {
          const theme = Object.assign({}, (server && server.theme) || {});
          if (Object.prototype.hasOwnProperty.call(FONTS, body.font)) {
            if (body.font === 'default') delete theme.font; else theme.font = body.font;
            update.theme = theme;
          }
        }
        if (body && body.game !== undefined) {
          const game = (body.game && typeof body.game === 'object') ? body.game : {};
          const meta = Object.assign({}, (server && server.meta) || {});
          const address = text(game.address, 120).replace(/[<>]/g, '');
          const note = text(game.note, 200).replace(/[<>]/g, '');
          if (address || note) meta.game = { address, note }; else delete meta.game;
          update.meta = meta;
        }
        if (!Object.keys(update).length) { send(res, 400, { error: 'Nothing to save.' }); return; }
        const { error } = await supabase.from('servers').update(update).eq('id', sid);
        if (error) {
          if (noTable(error)) { send(res, 503, { error: 'kit_not_set_up', text: 'This needs the server-kit migration first.' }); return; }
          send(res, 500, { error: 'Could not save the server kit.' }); return;
        }
        send(res, 200, { ok: true });
        return;
      }
      send(res, 405, { error: 'Method not allowed.' });
      return;
    }

    // ── Channels and folders: icons, tags, welcome, order (106/107/113/123/178) ──
    const chMatch = /^\/api\/servers\/([^/]+)\/kit\/channels$/.exec(url.pathname);
    if (chMatch && req.method === 'POST') {
      cors(res);
      const user = await requireUser(req, res); if (!user) return;
      const sid = chMatch[1];
      if (!isUuid(sid)) { send(res, 400, { error: 'Invalid server.' }); return; }
      const { role } = await serverRole(user.id, sid);
      if (role !== 'owner') { send(res, 403, { error: 'Only the owner can change channels.' }); return; }
      if (!(await needVerified(user, res))) return;
      const body = await readBody(req, 32768).catch(() => ({}));
      const rows = (await channelRows(sid)).rows;
      const byId = {};
      rows.forEach(r => { byId[r.id] = r; });
      const { data: folderRows } = await supabase.from('channel_folders').select('id').eq('server_id', sid);
      const folderIds = new Set((folderRows || []).map(f => f.id));

      var changed = 0;
      const channels = Array.isArray(body && body.channels) ? body.channels.slice(0, 100) : [];
      for (const c of channels) {
        if (!c || !isUuid(c.id) || !byId[c.id]) continue;
        const patch = {};
        if (c.icon !== undefined) patch.icon = text(c.icon, 4).replace(/[<>]/g, '');
        if (c.tags !== undefined) patch.tags = tagList(c.tags, 3);
        if (c.welcome !== undefined) patch.welcome = text(c.welcome, 300);
        if (c.labels !== undefined) patch.labels = (Array.isArray(c.labels) ? c.labels : []).filter(l => LABELS.includes(l)).slice(0, 3);
        if (c.folder_id !== undefined) {
          const fid = String(c.folder_id || '');
          patch.folder_id = fid && folderIds.has(fid) ? fid : null;
        }
        if (!Object.keys(patch).length) continue;
        const { error } = await supabase.from('lobbies').update(patch).eq('id', c.id).eq('server_id', sid);
        if (error) {
          if (noTable(error)) { send(res, 503, { error: 'kit_not_set_up', text: 'This needs the server-kit migration first.' }); return; }
          send(res, 500, { error: 'Could not save a channel.' }); return;
        }
        changed++;
      }

      const folders = Array.isArray(body && body.folders) ? body.folders.slice(0, 50) : [];
      for (const f of folders) {
        if (!f || !isUuid(f.id) || !folderIds.has(f.id) || f.icon === undefined) continue;
        const icon = text(f.icon, 4).replace(/[<>]/g, '');
        const { error } = await supabase.from('channel_folders').update({ icon }).eq('id', f.id).eq('server_id', sid);
        if (error) { if (noTable(error)) { send(res, 503, { error: 'kit_not_set_up', text: 'This needs the server-kit migration first.' }); return; } }
      }

      const order = Array.isArray(body && body.order) ? body.order.slice(0, 200) : [];
      for (let i = 0; i < order.length; i++) {
        const id = order[i];
        if (!isUuid(id) || !byId[id]) continue;
        const { error } = await supabase.from('lobbies').update({ position: i }).eq('id', id).eq('server_id', sid);
        if (error) {
          if (noTable(error)) { send(res, 503, { error: 'kit_not_set_up', text: 'This needs the server-kit migration first.' }); return; }
          send(res, 500, { error: 'Could not reorder the channels.' }); return;
        }
      }
      send(res, 200, { ok: true, changed });
      return;
    }

    // ── Named theme presets (104) ───────────────────────────────
    if (url.pathname.match(/^\/api\/servers\/[^/]+\/kit\/presets$/) && req.method === 'POST') {
      cors(res);
      const user = await requireUser(req, res); if (!user) return;
      const sid = /^\/api\/servers\/([^/]+)\//.exec(url.pathname)[1];
      if (!isUuid(sid)) { send(res, 400, { error: 'Invalid server.' }); return; }
      const { role } = await serverRole(user.id, sid);
      if (role !== 'owner') { send(res, 403, { error: 'Only the owner can save presets.' }); return; }
      if (!(await needVerified(user, res))) return;
      const body = await readBody(req, 8192).catch(() => ({}));
      const name = text(body && body.name, 32);
      const theme = themeOf(body && body.theme ? body.theme : body);
      if (name.length < 1) { send(res, 400, { error: 'Name the preset.' }); return; }
      if (!Object.keys(theme).length) { send(res, 400, { error: 'Pick an accent, background or font.' }); return; }
      const { count } = await supabase.from('server_theme_presets')
        .select('id', { count: 'exact', head: true }).eq('server_id', sid);
      if ((count || 0) >= 8) { send(res, 400, { error: 'Keep up to 8 presets.' }); return; }
      const { data, error } = await supabase.from('server_theme_presets')
        .insert({ server_id: sid, name, theme }).select('id, name, theme, created_at').single();
      if (error) {
        if (noTable(error)) { send(res, 503, { error: 'kit_not_set_up', text: 'This needs the server-kit migration first.' }); return; }
        send(res, 400, { error: 'A preset with that name already exists.' }); return;
      }
      send(res, 200, { preset: data });
      return;
    }

    const preMatch = /^\/api\/servers\/([^/]+)\/kit\/presets\/([^/]+)(\/apply)?$/.exec(url.pathname);
    if (preMatch) {
      cors(res);
      const user = await requireUser(req, res); if (!user) return;
      const sid = preMatch[1], pid = preMatch[2], applying = !!preMatch[3];
      if (!isUuid(sid) || !isUuid(pid)) { send(res, 400, { error: 'Invalid preset.' }); return; }
      const { role } = await serverRole(user.id, sid);
      if (role !== 'owner') { send(res, 403, { error: 'Only the owner can change presets.' }); return; }
      if (!(await needVerified(user, res))) return;
      if (req.method === 'POST' && applying) {
        const { data: preset } = await supabase.from('server_theme_presets')
          .select('id, theme').eq('id', pid).eq('server_id', sid).single();
        if (!preset) { send(res, 404, { error: 'Preset not found.' }); return; }
        const { error } = await supabase.from('servers').update({ theme: preset.theme || {} }).eq('id', sid);
        if (error) { send(res, 500, { error: 'Could not apply the preset.' }); return; }
        send(res, 200, { ok: true });
        return;
      }
      if (req.method === 'DELETE') {
        await supabase.from('server_theme_presets').delete().eq('id', pid).eq('server_id', sid);
        send(res, 200, { ok: true });
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
  return /^\/api\/servers\/invite\/[A-Za-z0-9_-]{4,40}$/.test(pathname)
    || /^\/api\/servers\/[^/]+\/kit(\/|$)/.test(pathname);
}
