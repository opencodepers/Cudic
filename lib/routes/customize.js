/* file: lib/routes/customize.js
 * what: User and server customisation — layout/density/font/rail/glass/motion/
 *   sound prefs, DM/channel/server themes, custom theme packs, nested channel
 *   folders, profile widgets, custom badges, welcome flows and declarative
 *   commands. Missing migration tables return 503 instead of breaking pages.
 * invariants: every server write checks serverRole; every conversation theme
 *   checks canSeeLobby; theme values are clamped and URLs are https only.
 */
module.exports = function createRoutes(deps) {
  const { supabase, cors, requireUser, needVerified, readBody, isUuid, canSeeLobby, serverRole, rateLimit } = deps;

  const FONTS = ['', 'system-ui', 'Georgia', 'ui-monospace', 'Trebuchet MS', 'Verdana', 'Geist'];
  const DENSITIES = ['comfortable', 'compact'];
  const RAILS = ['icon', 'labels', 'floating'];
  const LAYOUTS = ['list', 'grid', 'grouped'];
  const SOUND_KINDS = ['dm', 'mention', 'event', 'call'];

  function send(res, code, body) {
    res.writeHead(code, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(body));
  }
  function noTable(err) {
    const code = String((err && err.code) || '');
    return code === 'PGRST205' || code === '42P01' || /does not exist|schema cache/i.test(String((err && err.message) || ''));
  }
  function notSetUp(res) {
    send(res, 503, { error: 'customization_not_set_up', text: 'This needs the customisation migration first.' });
  }
  function cleanHex(v, fallback) {
    const s = String(v || '').trim();
    return /^#[0-9a-f]{6}$/i.test(s) ? s : (fallback || '');
  }
  function cleanUrl(v) {
    const s = String(v || '').trim().substring(0, 500);
    return /^https:\/\/[^\s"'<>]+$/i.test(s) ? s : '';
  }
  function cleanTheme(v) {
    v = v && typeof v === 'object' ? v : {};
    const t = {};
    const accent = cleanHex(v.accent);
    const bg = cleanUrl(v.background);
    if (accent) t.accent = accent;
    if (bg) t.background = bg;
    if (v.font && FONTS.indexOf(String(v.font)) !== -1) t.font = String(v.font);
    if (v.glass === true) t.glass = true;
    return t;
  }
  function cleanWidget(body) {
    const kind = ['text', 'link', 'games', 'achievement'].indexOf(String(body.kind)) !== -1 ? String(body.kind) : 'text';
    const config = {};
    if (kind === 'text') config.text = String(body.text || body.config && body.config.text || '').replace(/\s+/g, ' ').trim().substring(0, 300);
    if (kind === 'link') {
      config.label = String(body.label || body.config && body.config.label || '').trim().substring(0, 60);
      config.url = cleanUrl(body.url || body.config && body.config.url);
    }
    if (kind === 'achievement') config.code = String(body.code || body.config && body.config.code || '').trim().substring(0, 80);
    if (kind === 'games') config.limit = Math.max(1, Math.min(6, parseInt(body.limit, 10) || 3));
    return { kind, config };
  }

  async function handle(req, res, url) {
    // ── Preferences / layout ─────────────────────────────────────
    if (url.pathname === '/api/customize/prefs' && (req.method === 'GET' || req.method === 'PUT')) {
      cors(res);
      const user = await requireUser(req, res); if (!user) return;
      if (req.method === 'PUT') {
        if (!(await needVerified(user, res))) return;
        const body = await readBody(req, 32768).catch(() => ({}));
        const updates = {};
        if (body.font_family !== undefined && FONTS.indexOf(String(body.font_family)) !== -1) updates.font_family = String(body.font_family);
        if (body.font_size !== undefined) {
          const n = parseInt(body.font_size, 10);
          updates.font_size = (n >= 12 && n <= 22) ? n : 0;
        }
        if (body.line_height !== undefined) {
          const n = parseFloat(body.line_height);
          updates.line_height = (n >= 1.1 && n <= 2.2) ? n : 0;
        }
        if (body.density !== undefined && DENSITIES.indexOf(String(body.density)) !== -1) updates.density = String(body.density);
        if (body.rail_mode !== undefined && RAILS.indexOf(String(body.rail_mode)) !== -1) updates.rail_mode = String(body.rail_mode);
        if (body.glass !== undefined) updates.glass = body.glass === true;
        if (body.reduce_motion !== undefined) updates.reduce_motion = body.reduce_motion === true;
        if (body.chan_layout !== undefined && LAYOUTS.indexOf(String(body.chan_layout)) !== -1) updates.chan_layout = String(body.chan_layout);
        if (body.profile_pack_slug !== undefined) {
          const s = String(body.profile_pack_slug || '').trim().substring(0, 64);
          updates.profile_pack_slug = s || null;
        }
        if (body.banner_pos !== undefined) {
          const n = parseInt(body.banner_pos, 10);
          updates.banner_pos = Math.max(0, Math.min(100, Number.isFinite(n) ? n : 50));
        }
        if (body.banner_animated !== undefined) updates.banner_animated = body.banner_animated === true;
        if (body.notify_sounds !== undefined) {
          const src = body.notify_sounds && typeof body.notify_sounds === 'object' ? body.notify_sounds : {};
          const sounds = {};
          SOUND_KINDS.forEach(k => { sounds[k] = src[k] !== false; });
          updates.notify_sounds = sounds;
        }
        if (body.layout !== undefined) {
          const layout = body.layout && typeof body.layout === 'object' ? body.layout : {};
          const order = Array.isArray(layout.order) ? layout.order.filter(k => ['sidebar', 'main'].indexOf(k) !== -1).slice(0, 2) : [];
          if (order.length === 2) {
            updates.layout = { order, saved: layout.saved && typeof layout.saved === 'object' ? layout.saved : {} };
          }
        }
        if (!Object.keys(updates).length) { send(res, 400, { error: 'Nothing to update.' }); return; }
        const { error } = await supabase.from('users').update(updates).eq('id', user.id);
        if (error) { if (noTable(error)) { notSetUp(res); return; } send(res, 500, { error: 'Could not save preferences.' }); return; }
        send(res, 200, { ok: true, prefs: updates });
        return;
      }
      const { data, error } = await supabase.from('users')
        .select('layout, font_family, font_size, line_height, density, rail_mode, glass, reduce_motion, notify_sounds, profile_pack_slug, banner_pos, banner_animated, chan_layout')
        .eq('id', user.id).single();
      if (error) { if (noTable(error)) { notSetUp(res); return; } send(res, 500, { error: 'Could not load preferences.' }); return; }
      send(res, 200, { prefs: data || {} });
      return;
    }

    // ── Custom theme packs ───────────────────────────────────────
    if (url.pathname === '/api/customize/themes' && (req.method === 'GET' || req.method === 'POST')) {
      cors(res);
      const user = await requireUser(req, res); if (!user) return;
      if (req.method === 'POST') {
        if (!(await needVerified(user, res))) return;
        if (!rateLimit('theme:create:' + user.id, 10, 60 * 1000)) { send(res, 429, { error: 'Slow down.' }); return; }
        const body = await readBody(req, 16384).catch(() => ({}));
        const name = String(body.name || '').trim().substring(0, 40);
        if (!name) { send(res, 400, { error: 'Name the theme.' }); return; }
        const manifest = cleanTheme(body.manifest || body);
        if (!manifest.accent) { send(res, 400, { error: 'Pick an accent colour.' }); return; }
        const { data, error } = await supabase.from('custom_themes').insert({
          user_id: user.id, name, manifest, published: false,
        }).select('id, name, manifest, published, created_at').single();
        if (error) {
          if (noTable(error)) { notSetUp(res); return; }
          send(res, 400, { error: /duplicate/i.test(error.message) ? 'You already have a theme with that name.' : 'Could not create the theme.' });
          return;
        }
        send(res, 200, { theme: data });
        return;
      }
      const { data, error } = await supabase.from('custom_themes')
        .select('id, name, manifest, published, created_at').eq('user_id', user.id)
        .order('created_at', { ascending: false }).limit(50);
      if (error) { if (noTable(error)) { notSetUp(res); return; } send(res, 500, { error: 'Could not load themes.' }); return; }
      send(res, 200, { themes: data || [] });
      return;
    }
    const themeMatch = /^\/api\/customize\/themes\/([^/]+)(\/publish|\/manifest)?$/.exec(url.pathname);
    if (themeMatch && isUuid(themeMatch[1])) {
      if (themeMatch[2] === '/manifest' && req.method === 'GET') {
        const { data } = await supabase.from('custom_themes')
          .select('id, name, manifest, published').eq('id', themeMatch[1]).eq('published', true).single();
        if (!data) { send(res, 404, { error: 'Theme not found.' }); return; }
        send(res, 200, { theme: data });
        return;
      }
      cors(res);
      const user = await requireUser(req, res); if (!user) return;
      if (themeMatch[2] === '/publish' && req.method === 'POST') {
        const body = await readBody(req, 4096).catch(() => ({}));
        const { data, error } = await supabase.from('custom_themes')
          .update({ published: body.published !== false }).eq('id', themeMatch[1]).eq('user_id', user.id)
          .select('id, published').single();
        if (error || !data) { send(res, 404, { error: 'Theme not found.' }); return; }
        send(res, 200, { theme: data });
        return;
      }
      if (req.method === 'DELETE') {
        await supabase.from('custom_themes').delete().eq('id', themeMatch[1]).eq('user_id', user.id);
        send(res, 200, { ok: true });
        return;
      }
    }

    // ── Conversation (DM/channel) theme ──────────────────────────
    if (url.pathname === '/api/customize/conversation-theme' && (req.method === 'GET' || req.method === 'PUT')) {
      cors(res);
      const user = await requireUser(req, res); if (!user) return;
      const name = String(url.searchParams.get('lobby') || '');
      const { data: lobby } = await supabase.from('lobbies').select('id, name, kind, server_id, is_private').eq('name', name).single();
      if (!lobby || !(await canSeeLobby(user.id, lobby))) { send(res, 404, { error: 'Conversation not found.' }); return; }
      if (req.method === 'GET') {
        const { data, error } = await supabase.from('conversation_themes').select('theme')
          .eq('user_id', user.id).eq('lobby_id', lobby.id).maybeSingle();
        if (error) { if (noTable(error)) { notSetUp(res); return; } send(res, 500, { error: 'Could not load the theme.' }); return; }
        send(res, 200, { theme: (data && data.theme) || {} });
        return;
      }
      const body = await readBody(req, 8192).catch(() => ({}));
      const theme = cleanTheme(body.theme || body);
      const { error } = await supabase.from('conversation_themes').upsert({
        user_id: user.id, lobby_id: lobby.id, theme, updated_at: new Date().toISOString(),
      }, { onConflict: 'user_id,lobby_id' });
      if (error) { if (noTable(error)) { notSetUp(res); return; } send(res, 500, { error: 'Could not save the theme.' }); return; }
      send(res, 200, { ok: true, theme });
      return;
    }

    // ── Server appearance ────────────────────────────────────────
    const srvThemeMatch = /^\/api\/servers\/([^/]+)\/appearance$/.exec(url.pathname);
    if (srvThemeMatch && (req.method === 'GET' || req.method === 'PUT')) {
      cors(res);
      const user = await requireUser(req, res); if (!user) return;
      if (!isUuid(srvThemeMatch[1])) { send(res, 400, { error: 'Invalid server.' }); return; }
      const { server, role } = await serverRole(user.id, srvThemeMatch[1]);
      if (!server) { send(res, 404, { error: 'Server not found.' }); return; }
      if (req.method === 'GET') { send(res, 200, { theme: server.theme || {} }); return; }
      if (role !== 'owner') { send(res, 403, { error: 'Only the owner can change the server appearance.' }); return; }
      const body = await readBody(req, 8192).catch(() => ({}));
      const theme = cleanTheme(body.theme || body);
      const { error } = await supabase.from('servers').update({ theme }).eq('id', server.id);
      if (error) { if (noTable(error)) { notSetUp(res); return; } send(res, 500, { error: 'Could not save the appearance.' }); return; }
      send(res, 200, { ok: true, theme });
      return;
    }

    // ── Nested channel folders ───────────────────────────────────
    const folderMatch = /^\/api\/servers\/([^/]+)\/channel-folders(\/assign)?$/.exec(url.pathname);
    if (folderMatch && isUuid(folderMatch[1])) {
      cors(res);
      const user = await requireUser(req, res); if (!user) return;
      const { server, role } = await serverRole(user.id, folderMatch[1]);
      if (!server) { send(res, 404, { error: 'Server not found.' }); return; }
      if (req.method === 'GET') {
        const { data, error } = await supabase.from('channel_folders')
          .select('id, parent_id, name, position, icon').eq('server_id', server.id)
          .order('position').order('created_at');
        if (error) { if (noTable(error)) { notSetUp(res); return; } send(res, 500, { error: 'Could not load folders.' }); return; }
        send(res, 200, { folders: data || [] });
        return;
      }
      if (role !== 'owner' && role !== 'mod') { send(res, 403, { error: 'Owner or mod only.' }); return; }
      if (req.method === 'POST' && !folderMatch[2]) {
        const body = await readBody(req, 8192).catch(() => ({}));
        const name = String(body.name || '').trim().substring(0, 40);
        if (!name) { send(res, 400, { error: 'Name the folder.' }); return; }
        let parent = body.parentId && isUuid(body.parentId) ? body.parentId : null;
        if (parent) {
          const { data: p } = await supabase.from('channel_folders').select('id, parent_id').eq('id', parent).eq('server_id', server.id).single();
          if (!p || p.parent_id) { send(res, 400, { error: 'Only two folder levels are supported.' }); return; }
        }
        const { count } = await supabase.from('channel_folders').select('id', { count: 'exact', head: true }).eq('server_id', server.id);
        if ((count || 0) >= 30) { send(res, 400, { error: 'Folder limit reached.' }); return; }
        const { data, error } = await supabase.from('channel_folders').insert({
          server_id: server.id, parent_id: parent, name, position: count || 0,
        }).select('id, parent_id, name, position, icon').single();
        if (error) { if (noTable(error)) { notSetUp(res); return; } send(res, 500, { error: 'Could not create the folder.' }); return; }
        send(res, 200, { folder: data });
        return;
      }
      if (req.method === 'POST' && folderMatch[2]) {
        const body = await readBody(req, 4096).catch(() => ({}));
        const cid = String(body.channelId || '');
        if (!isUuid(cid)) { send(res, 400, { error: 'Invalid channel.' }); return; }
        const folderId = body.folderId && isUuid(body.folderId) ? body.folderId : null;
        const { data: chan } = await supabase.from('lobbies').select('id, server_id').eq('id', cid).single();
        if (!chan || chan.server_id !== server.id) { send(res, 404, { error: 'Channel not found.' }); return; }
        if (folderId) {
          const { data: f } = await supabase.from('channel_folders').select('id').eq('id', folderId).eq('server_id', server.id).single();
          if (!f) { send(res, 404, { error: 'Folder not found.' }); return; }
        }
        const { error } = await supabase.from('lobbies').update({ folder_id: folderId }).eq('id', cid);
        if (error) { if (noTable(error)) { notSetUp(res); return; } send(res, 500, { error: 'Could not file the channel.' }); return; }
        send(res, 200, { ok: true });
        return;
      }
      if (req.method === 'DELETE') {
        const id = String(url.searchParams.get('id') || '');
        if (!isUuid(id)) { send(res, 400, { error: 'Invalid folder.' }); return; }
        await supabase.from('lobbies').update({ folder_id: null }).eq('server_id', server.id).eq('folder_id', id);
        await supabase.from('channel_folders').delete().eq('id', id).eq('server_id', server.id);
        send(res, 200, { ok: true });
        return;
      }
      send(res, 400, { error: 'Unsupported folder action.' });
      return;
    }

    // ── Profile widgets ──────────────────────────────────────────
    if (url.pathname === '/api/customize/widgets' && (req.method === 'GET' || req.method === 'POST')) {
      cors(res);
      const user = await requireUser(req, res); if (!user) return;
      if (req.method === 'POST') {
        const body = await readBody(req, 8192).catch(() => ({}));
        const widget = cleanWidget(body);
        if (widget.kind === 'text' && !widget.config.text) { send(res, 400, { error: 'Write something first.' }); return; }
        if (widget.kind === 'link' && (!widget.config.label || !widget.config.url)) { send(res, 400, { error: 'A label and an https link are required.' }); return; }
        const { count } = await supabase.from('profile_widgets').select('id', { count: 'exact', head: true }).eq('user_id', user.id);
        if ((count || 0) >= 12) { send(res, 400, { error: 'Widget limit reached (12).' }); return; }
        const { data, error } = await supabase.from('profile_widgets').insert({
          user_id: user.id, kind: widget.kind, config: widget.config, position: count || 0,
        }).select('id, kind, config, position').single();
        if (error) { if (noTable(error)) { notSetUp(res); return; } send(res, 500, { error: 'Could not add the widget.' }); return; }
        send(res, 200, { widget: data });
        return;
      }
      const { data, error } = await supabase.from('profile_widgets')
        .select('id, kind, config, position').eq('user_id', user.id).order('position').order('created_at');
      if (error) { if (noTable(error)) { notSetUp(res); return; } send(res, 500, { error: 'Could not load widgets.' }); return; }
      send(res, 200, { widgets: data || [] });
      return;
    }
    if (url.pathname === '/api/customize/widgets/reorder' && req.method === 'POST') {
      cors(res);
      const user = await requireUser(req, res); if (!user) return;
      const body = await readBody(req, 8192).catch(() => ({}));
      const ids = Array.isArray(body.ids) ? body.ids.filter(isUuid).slice(0, 12) : [];
      if (!ids.length) { send(res, 400, { error: 'No widgets to reorder.' }); return; }
      const { data: mine } = await supabase.from('profile_widgets').select('id').eq('user_id', user.id);
      const allowed = new Set((mine || []).map(w => w.id));
      if (ids.some(id => !allowed.has(id))) { send(res, 403, { error: 'Not your widget.' }); return; }
      for (let i = 0; i < ids.length; i++) {
        await supabase.from('profile_widgets').update({ position: i }).eq('id', ids[i]).eq('user_id', user.id);
      }
      send(res, 200, { ok: true });
      return;
    }
    const widgetMatch = /^\/api\/customize\/widgets\/([^/]+)$/.exec(url.pathname);
    if (widgetMatch && req.method === 'DELETE' && isUuid(widgetMatch[1])) {
      cors(res);
      const user = await requireUser(req, res); if (!user) return;
      await supabase.from('profile_widgets').delete().eq('id', widgetMatch[1]).eq('user_id', user.id);
      send(res, 200, { ok: true });
      return;
    }

    // ── Public profile widgets/badges/theme ──────────────────────
    const pubMatch = /^\/api\/customize\/public\/([^/]+)$/.exec(url.pathname);
    if (pubMatch && req.method === 'GET' && isUuid(pubMatch[1])) {
      const { data: userRow } = await supabase.from('users')
        .select('id, intro, profile_pack_slug, banner_pos, banner_animated').eq('id', pubMatch[1]).maybeSingle();
      if (!userRow) { send(res, 404, { error: 'Profile not found.' }); return; }
      const [{ data: widgets }, { data: badgeRows }] = await Promise.all([
        supabase.from('profile_widgets').select('id, kind, config, position').eq('user_id', pubMatch[1]).order('position').limit(12),
        supabase.from('user_custom_badges').select('custom_badges!inner(name, icon, colour, server_id)').eq('user_id', pubMatch[1]).limit(12),
      ]);
      send(res, 200, {
        profile: userRow,
        widgets: widgets || [],
        badges: (badgeRows || []).map(r => r.custom_badges).filter(Boolean),
      });
      return;
    }

    // ── Custom badges ────────────────────────────────────────────
    const badgeMatch = /^\/api\/servers\/([^/]+)\/badges(\/grant)?$/.exec(url.pathname);
    if (badgeMatch && isUuid(badgeMatch[1])) {
      cors(res);
      const user = await requireUser(req, res); if (!user) return;
      const { server, role } = await serverRole(user.id, badgeMatch[1]);
      if (!server) { send(res, 404, { error: 'Server not found.' }); return; }
      if (req.method === 'GET') {
        const { data, error } = await supabase.from('custom_badges')
          .select('id, name, icon, colour, created_at').eq('server_id', server.id).order('created_at');
        if (error) { if (noTable(error)) { notSetUp(res); return; } send(res, 500, { error: 'Could not load badges.' }); return; }
        send(res, 200, { badges: data || [] });
        return;
      }
      if (!role) { send(res, 403, { error: 'Join the server first.' }); return; }
      if (badgeMatch[2] === '/grant') {
        if (role !== 'owner' && role !== 'mod') { send(res, 403, { error: 'Owner or mod only.' }); return; }
        const body = await readBody(req, 4096).catch(() => ({}));
        const badgeId = String(body.badgeId || '');
        const target = String(body.userId || '');
        if (!isUuid(badgeId) || !isUuid(target)) { send(res, 400, { error: 'Invalid badge or member.' }); return; }
        const { data: badge } = await supabase.from('custom_badges').select('id').eq('id', badgeId).eq('server_id', server.id).single();
        if (!badge) { send(res, 404, { error: 'Badge not found.' }); return; }
        const { data: member } = await supabase.from('server_members').select('user_id').eq('server_id', server.id).eq('user_id', target).single();
        if (!member) { send(res, 400, { error: 'That person is not in this server.' }); return; }
        if (body.revoke === true) {
          await supabase.from('user_custom_badges').delete().eq('user_id', target).eq('badge_id', badgeId);
        } else {
          const { error } = await supabase.from('user_custom_badges').upsert({
            user_id: target, badge_id: badgeId, granted_by: user.id,
          }, { onConflict: 'user_id,badge_id' });
          if (error) { if (noTable(error)) { notSetUp(res); return; } send(res, 500, { error: 'Could not grant the badge.' }); return; }
        }
        send(res, 200, { ok: true });
        return;
      }
      if (req.method === 'POST') {
        if (role !== 'owner') { send(res, 403, { error: 'Only the owner can create badges.' }); return; }
        const body = await readBody(req, 8192).catch(() => ({}));
        const name = String(body.name || '').trim().substring(0, 32);
        const icon = String(body.icon || '★').trim().substring(0, 8) || '★';
        const colour = cleanHex(body.colour, '#FF8C1A');
        if (!name) { send(res, 400, { error: 'Name the badge.' }); return; }
        const { data, error } = await supabase.from('custom_badges').insert({
          server_id: server.id, name, icon, colour, created_by: user.id,
        }).select('id, name, icon, colour').single();
        if (error) { if (noTable(error)) { notSetUp(res); return; } send(res, 400, { error: 'That badge already exists.' }); return; }
        send(res, 200, { badge: data });
        return;
      }
      if (req.method === 'DELETE') {
        if (role !== 'owner') { send(res, 403, { error: 'Only the owner can delete badges.' }); return; }
        const id = String(url.searchParams.get('id') || '');
        if (!isUuid(id)) { send(res, 400, { error: 'Invalid badge.' }); return; }
        await supabase.from('custom_badges').delete().eq('id', id).eq('server_id', server.id);
        send(res, 200, { ok: true });
        return;
      }
    }

    // ── Welcome flow ─────────────────────────────────────────────
    const welcomeMatch = /^\/api\/servers\/([^/]+)\/welcome$/.exec(url.pathname);
    if (welcomeMatch && isUuid(welcomeMatch[1])) {
      cors(res);
      const user = await requireUser(req, res); if (!user) return;
      const { server, role } = await serverRole(user.id, welcomeMatch[1]);
      if (!server) { send(res, 404, { error: 'Server not found.' }); return; }
      if (req.method === 'GET') {
        const { data, error } = await supabase.from('server_welcome')
          .select('steps, enabled').eq('server_id', server.id).maybeSingle();
        if (error && !noTable(error)) { send(res, 500, { error: 'Could not load the welcome flow.' }); return; }
        send(res, 200, { welcome: { steps: (data && data.steps) || [], enabled: !!(data && data.enabled) } });
        return;
      }
      if (role !== 'owner') { send(res, 403, { error: 'Only the owner can edit the welcome flow.' }); return; }
      const body = await readBody(req, 16384).catch(() => ({}));
      const steps = Array.isArray(body.steps) ? body.steps.slice(0, 3).map(s => ({
        title: String(s && s.title || '').trim().substring(0, 80),
        body: String(s && s.body || '').trim().substring(0, 500),
      })).filter(s => s.title || s.body) : [];
      const { error } = await supabase.from('server_welcome').upsert({
        server_id: server.id, steps, enabled: body.enabled !== false, updated_at: new Date().toISOString(),
      }, { onConflict: 'server_id' });
      if (error) { if (noTable(error)) { notSetUp(res); return; } send(res, 500, { error: 'Could not save the welcome flow.' }); return; }
      send(res, 200, { ok: true, welcome: { steps, enabled: body.enabled !== false } });
      return;
    }

    // ── Declarative server commands ──────────────────────────────
    const cmdMatch = /^\/api\/servers\/([^/]+)\/commands$/.exec(url.pathname);
    if (cmdMatch && isUuid(cmdMatch[1])) {
      cors(res);
      const user = await requireUser(req, res); if (!user) return;
      const { server, role } = await serverRole(user.id, cmdMatch[1]);
      if (!server) { send(res, 404, { error: 'Server not found.' }); return; }
      if (req.method === 'GET') {
        const { data, error } = await supabase.from('server_commands')
          .select('id, trigger, response, cooldown').eq('server_id', server.id).order('trigger');
        if (error) { if (noTable(error)) { notSetUp(res); return; } send(res, 500, { error: 'Could not load commands.' }); return; }
        send(res, 200, { commands: data || [] });
        return;
      }
      if (role !== 'owner' && role !== 'mod') { send(res, 403, { error: 'Owner or mod only.' }); return; }
      if (req.method === 'POST') {
        const body = await readBody(req, 8192).catch(() => ({}));
        const trigger = String(body.trigger || '').trim().toLowerCase();
        const response = String(body.response || '').trim().substring(0, 500);
        const cooldown = Math.max(0, Math.min(3600, parseInt(body.cooldown, 10) || 30));
        if (!/^\/[a-z0-9_-]{1,24}$/.test(trigger) || !response) { send(res, 400, { error: 'Use /command and a response.' }); return; }
        const { count } = await supabase.from('server_commands').select('id', { count: 'exact', head: true }).eq('server_id', server.id);
        if ((count || 0) >= 25) { send(res, 400, { error: 'Command limit reached (25).' }); return; }
        const { data, error } = await supabase.from('server_commands').insert({
          server_id: server.id, trigger, response, cooldown, created_by: user.id,
        }).select('id, trigger, response, cooldown').single();
        if (error) { if (noTable(error)) { notSetUp(res); return; } send(res, 400, { error: 'That command already exists.' }); return; }
        send(res, 200, { command: data });
        return;
      }
      if (req.method === 'DELETE') {
        const id = String(url.searchParams.get('id') || '');
        if (!isUuid(id)) { send(res, 400, { error: 'Invalid command.' }); return; }
        await supabase.from('server_commands').delete().eq('id', id).eq('server_id', server.id);
        send(res, 200, { ok: true });
        return;
      }
    }

    return false;
  }

  function matches(pathname) {
    return pathname === '/api/customize/prefs'
      || pathname.startsWith('/api/customize/themes')
      || pathname === '/api/customize/conversation-theme'
      || pathname === '/api/customize/widgets'
      || pathname.startsWith('/api/customize/widgets/')
      || pathname.startsWith('/api/customize/public/')
      || /^\/api\/servers\/[^/]+\/(appearance|channel-folders|badges|welcome|commands)/.test(pathname);
  }

  return { handle, matches };
};
