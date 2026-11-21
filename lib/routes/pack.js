/* file: lib/routes/pack.js
 * what: the community pack — member nicknames/status/titles/intro cards,
 *   anniversaries, spotlights, daily and weekly prompts, suggestions with votes,
 *   LFG posts, game nights and public events, warnings, favourites, channel
 *   labels and an inactivity read for owners.
 * invariants: every server-scoped route resolves membership through serverRole
 *   before it reads; writes that change other people (title, warning, spotlight,
 *   prompt, status, labels) are owner-only. Missing tables answer 503 instead of
 *   pretending the write worked.
 */
module.exports = function createRoutes(deps) {
  const { supabase, cors, requireUser, needVerified, readBody, isUuid, serverRole, rateLimit, broadcast } = deps;
  const LABELS = ['spoiler', 'nsfw', 'art', 'build', 'event'];
  // A nickname must never impersonate the people who run the server. The
  // check is on the normalised value so "Owner", "owner " and "OWNER" all
  // land in the same place.
  const RESERVED_NICKS = new Set([
    'owner', 'mod', 'moderator', 'admin', 'administrator', 'staff', 'official',
    'system', 'cudic', 'support', 'server', 'everyone', 'here',
  ]);

  function send(res, code, body) {
    res.writeHead(code, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(body));
  }
  function noTable(err) {
    const code = String((err && err.code) || '');
    return code === 'PGRST205' || code === '42P01' || /does not exist|schema cache/i.test(String((err && err.message) || ''));
  }
  function text(v, max) { return String(v == null ? '' : v).replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max); }
  function tagList(v, n) {
    const out = [];
    (Array.isArray(v) ? v : []).forEach(t => {
      const s = text(t, 16).replace(/[<>]/g, '');
      if (s && !out.includes(s) && out.length < n) out.push(s);
    });
    return out;
  }
  function when(v) {
    if (!v) return null;
    const d = new Date(v);
    return isNaN(d.getTime()) ? null : d.toISOString();
  }
  function day() { return new Date().toISOString().slice(0, 10); }
  function weekStart() {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
    return d.toISOString().slice(0, 10);
  }
  function notSetUp(res) { send(res, 503, { error: 'pack_not_set_up', text: 'This needs the community-pack migration first.' }); }
  function bad(res, msg) { send(res, 400, { error: msg }); }

  async function profilesFor(sid, ids) {
    if (!ids.length) return {};
    const { data, error } = await supabase.from('server_member_profiles')
      .select('user_id, nickname, status, title, intro, intro_tags').eq('server_id', sid).in('user_id', ids);
    const map = {};
    if (!error) (data || []).forEach(p => { map[p.user_id] = p; });
    return map;
  }

  async function handle(req, res, url) {
    const p = url.pathname;
    // Every pack route is called from the static site on another origin. Set
    // this before any branch, so member-scoped reads and 403s are readable by
    // the browser instead of surfacing as an opaque "Failed to fetch".
    cors(res);

    // ── Public preview of a public server (184) ────────────────
    let m = /^\/api\/servers\/([^/]+)\/preview$/.exec(p);
    if (m && req.method === 'GET') {
      cors(res);
      if (!isUuid(m[1])) { bad(res, 'Invalid server.'); return; }
      const { data: srv, error } = await supabase.from('servers')
        .select('id, name, description, icon_url, tags, theme, rules, visibility, invite_code').eq('id', m[1]).maybeSingle();
      if (error || !srv || srv.visibility !== 'public') { send(res, 404, { error: 'Server not found.' }); return; }
      const [ch, mem, nights] = await Promise.all([
        supabase.from('lobbies').select('id, name, topic, is_private, labels, position').eq('server_id', srv.id).eq('kind', 'channel').eq('is_private', false).order('position').order('created_at').limit(40),
        supabase.from('server_members').select('user_id', { count: 'exact', head: true }).eq('server_id', srv.id),
        supabase.from('server_nights').select('id, title, game, note, starts_at').eq('server_id', srv.id).eq('is_public', true).gte('starts_at', new Date().toISOString()).order('starts_at').limit(3),
      ]);
      send(res, 200, {
        server: {
          id: srv.id, name: srv.name, description: srv.description || '', icon_url: srv.icon_url || null,
          tags: Array.isArray(srv.tags) ? srv.tags : [], rules: srv.rules || '',
          accent: (srv.theme && srv.theme.accent) || null,
          banner: (srv.theme && srv.theme.banner) || null,
          bannerPos: srv.theme && srv.theme.bannerPos != null ? srv.theme.bannerPos : 50,
          invite_code: srv.invite_code,
          members: mem.count || 0,
        },
        channels: (ch.data || []).map(c => ({
          id: c.id, name: String(c.name).split(':').pop(), topic: c.topic || '',
          labels: Array.isArray(c.labels) ? c.labels : [],
        })),
        nights: nights.error ? [] : (nights.data || []),
      });
      return;
    }

    // ── Favourites list (132) ──────────────────────────────────
    if (p === '/api/servers/favourites' && req.method === 'GET') {
      cors(res);
      const user = await requireUser(req, res); if (!user) return;
      const { data: favs, error } = await supabase.from('server_favourites')
        .select('server_id, created_at').eq('user_id', user.id).order('created_at', { ascending: false }).limit(100);
      if (error) { if (noTable(error)) return notSetUp(res); send(res, 500, { error: 'Could not load favourites.' }); return; }
      const ids = (favs || []).map(f => f.server_id);
      let rows = [];
      if (ids.length) {
        const { data } = await supabase.from('servers').select('id, name, description, icon_url, visibility, invite_code, tags').in('id', ids);
        rows = data || [];
      }
      send(res, 200, { favourites: ids, servers: rows });
      return;
    }

    // ── Channel content labels (189) ───────────────────────────
    m = /^\/api\/channels\/([^/]+)\/labels$/.exec(p);
    if (m && req.method === 'PUT') {
      cors(res);
      const user = await requireUser(req, res); if (!user) return;
      if (!isUuid(m[1])) { bad(res, 'Invalid channel.'); return; }
      const { data: ch } = await supabase.from('lobbies').select('id, server_id, kind').eq('id', m[1]).single();
      if (!ch || ch.kind !== 'channel') { send(res, 404, { error: 'Channel not found.' }); return; }
      const { role } = await serverRole(user.id, ch.server_id);
      if (role !== 'owner') { send(res, 403, { error: 'Only the owner can label channels.' }); return; }
      if (!(await needVerified(user, res))) return;
      const body = await readBody(req, 4096).catch(() => ({}));
      const labels = (Array.isArray(body.labels) ? body.labels : []).filter(l => LABELS.includes(l)).slice(0, 3);
      const { error } = await supabase.from('lobbies').update({ labels }).eq('id', ch.id);
      if (error) { if (noTable(error)) return notSetUp(res); send(res, 500, { error: 'Could not save labels.' }); return; }
      send(res, 200, { ok: true, labels });
      return;
    }

    // ── Favourite toggle (132) ─────────────────────────────────
    m = /^\/api\/servers\/([^/]+)\/favourite$/.exec(p);
    if (m && (req.method === 'POST' || req.method === 'DELETE')) {
      cors(res);
      const user = await requireUser(req, res); if (!user) return;
      if (!isUuid(m[1])) { bad(res, 'Invalid server.'); return; }
      if (req.method === 'POST') {
        const { error } = await supabase.from('server_favourites')
          .upsert({ user_id: user.id, server_id: m[1] }, { onConflict: 'user_id,server_id' });
        if (error) { if (noTable(error)) return notSetUp(res); send(res, 500, { error: 'Could not favourite that server.' }); return; }
      } else {
        const { error } = await supabase.from('server_favourites').delete().eq('user_id', user.id).eq('server_id', m[1]);
        if (error) { if (noTable(error)) return notSetUp(res); send(res, 500, { error: 'Could not remove that favourite.' }); return; }
      }
      send(res, 200, { ok: true });
      return;
    }

    // ── Everything below is member-scoped ──────────────────────
    if (!/^\/api\/servers\//.test(p)) { send(res, 404, { error: 'Not found.' }); return; }
    const sid = p.split('/')[3];
    if (!isUuid(sid)) { bad(res, 'Invalid server.'); return; }
    const user = await requireUser(req, res); if (!user) return;
    const { server, role } = await serverRole(user.id, sid);
    if (!role) { send(res, 403, { error: 'Join this server first.' }); return; }
    const owner = role === 'owner', mod = owner || role === 'mod';

    // ── Community read: roster, prompts, suggestions, LFG, nights, warnings ──
    if (p === '/api/servers/' + sid + '/community' && req.method === 'GET') {
      let memQ = await supabase.from('server_members').select('user_id, role, created_at').eq('server_id', sid).limit(200);
      if (memQ.error && /created_at/i.test(String(memQ.error.message || ''))) {
        memQ = await supabase.from('server_members').select('user_id, role').eq('server_id', sid).limit(200);
      }
      const memRows = memQ.data || [];
      const ids = memRows.map(r => r.user_id);
      const [usersQ, profiles, promptsQ, suggQ, lfgQ, nightsQ, warnQ, spotQ, channelsQ] = await Promise.all([
        ids.length ? supabase.from('users').select('id, display_name, avatar_url').in('id', ids) : Promise.resolve({ data: [] }),
        profilesFor(sid, ids),
        supabase.from('server_prompts').select('id, kind, body, active_on').eq('server_id', sid).lte('active_on', day()).order('active_on', { ascending: false }).limit(20),
        supabase.from('server_suggestions').select('id, user_id, title, body, status, created_at').eq('server_id', sid).order('created_at', { ascending: false }).limit(50),
        supabase.from('server_lfg').select('id, user_id, game, note, slots, starts_at').eq('server_id', sid).order('created_at', { ascending: false }).limit(30),
        supabase.from('server_nights').select('id, title, game, note, starts_at, is_public, created_by').eq('server_id', sid).gte('starts_at', new Date().toISOString()).order('starts_at').limit(20),
        supabase.from('server_warnings').select('id, reason, created_at, acknowledged_at, user_id').eq('server_id', sid).eq('user_id', user.id).is('acknowledged_at', null).order('created_at', { ascending: false }).limit(10),
        supabase.from('server_spotlights').select('id, user_id, blurb, created_at').eq('server_id', sid).eq('active', true).order('created_at', { ascending: false }).limit(1),
        supabase.from('lobbies').select('id, name, type').eq('server_id', sid).eq('kind', 'channel').order('position').limit(100),
      ]);
      const users = {};
      (usersQ.data || []).forEach(u => { users[u.id] = u; });
      const roster = memRows.map(r => {
        const u = users[r.user_id] || {}, pr = profiles[r.user_id] || {};
        return {
          user_id: r.user_id, role: r.role, name: u.display_name || 'Member', avatar: u.avatar_url || '',
          nickname: pr.nickname || '', status: pr.status || '', title: pr.title || '',
          intro: pr.intro || '', intro_tags: Array.isArray(pr.intro_tags) ? pr.intro_tags : [],
          joined_at: r.created_at || null,
        };
      });
      const suggestIds = (suggQ.data || []).map(s => s.id);
      let votes = [];
      if (suggestIds.length) {
        const vq = await supabase.from('server_suggestion_votes').select('suggestion_id, user_id').in('suggestion_id', suggestIds);
        if (!vq.error) votes = vq.data || [];
      }
      const voteCount = {};
      let mine = {};
      votes.forEach(v => {
        voteCount[v.suggestion_id] = (voteCount[v.suggestion_id] || 0) + 1;
        if (v.user_id === user.id) mine[v.suggestion_id] = 1;
      });
      const prompts = { daily: null, weekly: null };
      (promptsQ.data || []).forEach(pr => {
        if (pr.kind === 'daily' && !prompts.daily) prompts.daily = pr;
        if (pr.kind === 'weekly' && !prompts.weekly && pr.active_on >= weekStart()) prompts.weekly = pr;
      });
      const spot = (spotQ.data || [])[0] || null;
      if (spot) {
        const su = roster.find(r => r.user_id === spot.user_id);
        spot.name = (su && (su.nickname || su.name)) || 'Member';
      }
      send(res, 200, {
        role, owner, mod, me_id: user.id,
        server: {
          id: sid, name: (server && server.name) || '', tags: Array.isArray(server && server.tags) ? server.tags : [],
          visibility: (server && server.visibility) || 'public', invite_code: (server && server.invite_code) || '',
          theme: (server && server.theme) || {},
        },
        me: profiles[user.id] || { nickname: '', status: '', title: '', intro: '', intro_tags: [] },
        roster,
        channels: (channelsQ.data || []).map(c => ({ id: c.id, name: String(c.name).split(':').pop(), type: c.type || 'chat' })),
        prompts,
        suggestions: (suggQ.data || []).map(s => ({
          id: s.id, user_id: s.user_id, title: s.title, body: s.body, status: s.status, created_at: s.created_at,
          name: (users[s.user_id] && users[s.user_id].display_name) || 'Member',
          votes: voteCount[s.id] || 0, mine: !!mine[s.id],
        })),
        lfg: (lfgQ.data || []).filter(l => !l.starts_at || Date.parse(l.starts_at) > Date.now() - 3600000),
        nights: nightsQ.error ? [] : (nightsQ.data || []),
        warnings: warnQ.error ? [] : (warnQ.data || []),
        spotlight: spot,
        labels: LABELS,
      });
      return;
    }

    // ── My profile in this server (126/127/129/136) ────────────
    if (p === '/api/servers/' + sid + '/me' && req.method === 'PUT') {
      if (!(await needVerified(user, res))) return;
      if (!rateLimit('pack:' + user.id, 60, 60000)) { send(res, 429, { error: 'Slow down.' }); return; }
      const body = await readBody(req, 8192).catch(() => ({}));
      const nickname = text(body.nickname, 24).replace(/[<>]/g, '');
      if (nickname && RESERVED_NICKS.has(nickname.toLowerCase())) {
        send(res, 400, { error: 'That nickname is reserved for server staff. Pick another.' });
        return;
      }
      const patch = {
        server_id: sid, user_id: user.id,
        nickname,
        status: text(body.status, 80).replace(/[<>]/g, ''),
        intro: text(body.intro, 400).replace(/[<>]/g, ''),
        intro_tags: tagList(body.intro_tags, 4),
        updated_at: new Date().toISOString(),
      };
      const { data: before } = await supabase.from('server_member_profiles')
        .select('nickname').eq('server_id', sid).eq('user_id', user.id).maybeSingle();
      const { error } = await supabase.from('server_member_profiles').upsert(patch, { onConflict: 'server_id,user_id' });
      if (error) { if (noTable(error)) return notSetUp(res); send(res, 500, { error: 'Could not save your card.' }); return; }
      if (nickname !== ((before && before.nickname) || '')) {
        try {
          await supabase.from('server_audit').insert({
            server_id: sid, actor_id: user.id, action: 'member.nickname',
            target: user.id, meta: { from: (before && before.nickname) || '', to: nickname },
          });
        } catch (e) {}
      }
      send(res, 200, { ok: true, nickname });
      return;
    }

    // ── Owner: member title (139) ──────────────────────────────
    m = /^\/api\/servers\/([^/]+)\/community\/members\/([^/]+)$/.exec(p);
    if (m && req.method === 'PUT') {
      if (!owner) { send(res, 403, { error: 'Only the owner sets titles.' }); return; }
      if (!isUuid(m[2])) { bad(res, 'Invalid member.'); return; }
      if (!(await needVerified(user, res))) return;
      const body = await readBody(req, 4096).catch(() => ({}));
      const title = text(body.title, 32).replace(/[<>]/g, '');
      const { data: mem } = await supabase.from('server_members').select('user_id').eq('server_id', sid).eq('user_id', m[2]).single();
      if (!mem) { send(res, 404, { error: 'They are not a member.' }); return; }
      const { error } = await supabase.from('server_member_profiles')
        .upsert({ server_id: sid, user_id: m[2], title, updated_at: new Date().toISOString() }, { onConflict: 'server_id,user_id' });
      if (error) { if (noTable(error)) return notSetUp(res); send(res, 500, { error: 'Could not set that title.' }); return; }
      send(res, 200, { ok: true, title });
      return;
    }

    // ── Owner: prompts (143/144) ───────────────────────────────
    if (p === '/api/servers/' + sid + '/prompts' && req.method === 'POST') {
      if (!owner) { send(res, 403, { error: 'Only the owner sets prompts.' }); return; }
      if (!(await needVerified(user, res))) return;
      const body = await readBody(req, 4096).catch(() => ({}));
      const kind = body.kind === 'weekly' ? 'weekly' : 'daily';
      const bodyText = text(body.body, 300).replace(/[<>]/g, '');
      if (bodyText.length < 3) { bad(res, 'Write a prompt first.'); return; }
      const active = kind === 'weekly' ? weekStart() : day();
      const { data, error } = await supabase.from('server_prompts')
        .upsert({ server_id: sid, kind, body: bodyText, active_on: active, created_by: user.id }, { onConflict: 'server_id,kind,active_on' })
        .select('id, kind, body, active_on').single();
      if (error) { if (noTable(error)) return notSetUp(res); send(res, 500, { error: 'Could not save the prompt.' }); return; }
      send(res, 200, { prompt: data });
      return;
    }

    // ── Post a prompt into a channel (143/144) ────────────────
    // Saving a prompt is a draft; this is the explicit "say it now" action.
    // The weekly topic can pin itself so it stays above the week's chat.
    m = /^\/api\/servers\/([^/]+)\/prompts\/([^/]+)\/post$/.exec(p);
    if (m && req.method === 'POST') {
      if (!owner) { send(res, 403, { error: 'Only the owner posts prompts.' }); return; }
      if (!(await needVerified(user, res))) return;
      const body = await readBody(req, 4096).catch(() => ({}));
      const { data: prompt } = await supabase.from('server_prompts')
        .select('id, kind, body').eq('id', m[2]).eq('server_id', sid).single();
      if (!prompt) { send(res, 404, { error: 'Prompt not found.' }); return; }
      const cid = String(body.channelId || '');
      if (!isUuid(cid)) { send(res, 400, { error: 'Pick a channel.' }); return; }
      const { data: chan } = await supabase.from('lobbies')
        .select('id, name, kind, type').eq('id', cid).eq('server_id', sid).eq('kind', 'channel').single();
      if (!chan) { send(res, 404, { error: 'Channel not found.' }); return; }
      const label = prompt.kind === 'weekly' ? 'Weekly topic' : 'Daily prompt';
      const textLine = label + ': ' + prompt.body;
      const { data: msg, error } = await supabase.from('messages').insert({
        lobby_id: chan.id, user_id: null, display_name: 'Cudic', text: textLine, pinned: body.pin === true,
      }).select('id').single();
      if (error) { if (noTable(error)) return notSetUp(res); send(res, 500, { error: 'Could not post the prompt.' }); return; }
      try {
        broadcast(chan.name, {
          type: 'message', lobby: chan.name, username: 'Cudic', user_id: null,
          avatar_url: null, text: textLine, ts: new Date().toISOString(), cid: null,
        });
      } catch (e) {}
      send(res, 200, { ok: true, message: msg, text: textLine, pinned: body.pin === true });
      return;
    }

    // ── Suggestions (145), votes (146), owner status ───────────
    if (p === '/api/servers/' + sid + '/suggestions' && req.method === 'POST') {
      if (!(await needVerified(user, res))) return;
      if (!rateLimit('sugg:' + user.id, 6, 60000)) { send(res, 429, { error: 'Slow down.' }); return; }
      const body = await readBody(req, 8192).catch(() => ({}));
      const title = text(body.title, 80).replace(/[<>]/g, '');
      if (title.length < 3) { bad(res, 'Give the suggestion a title.'); return; }
      const { data, error } = await supabase.from('server_suggestions')
        .insert({ server_id: sid, user_id: user.id, title, body: text(body.body, 600).replace(/[<>]/g, '') })
        .select('id, title, body, status, created_at').single();
      if (error) { if (noTable(error)) return notSetUp(res); send(res, 500, { error: 'Could not post that.' }); return; }
      send(res, 200, { suggestion: data });
      return;
    }
    m = /^\/api\/servers\/([^/]+)\/suggestions\/([^/]+)\/vote$/.exec(p);
    if (m && req.method === 'POST') {
      if (!isUuid(m[2])) { bad(res, 'Invalid suggestion.'); return; }
      const { data: s } = await supabase.from('server_suggestions').select('id').eq('id', m[2]).eq('server_id', sid).single();
      if (!s) { send(res, 404, { error: 'Suggestion not found.' }); return; }
      const { data: existing } = await supabase.from('server_suggestion_votes')
        .select('suggestion_id').eq('suggestion_id', m[2]).eq('user_id', user.id).single();
      if (existing) await supabase.from('server_suggestion_votes').delete().eq('suggestion_id', m[2]).eq('user_id', user.id);
      else {
        const { error } = await supabase.from('server_suggestion_votes').insert({ suggestion_id: m[2], user_id: user.id });
        if (error) { if (noTable(error)) return notSetUp(res); send(res, 500, { error: 'Could not vote.' }); return; }
      }
      const { count } = await supabase.from('server_suggestion_votes')
        .select('user_id', { count: 'exact', head: true }).eq('suggestion_id', m[2]);
      send(res, 200, { ok: true, votes: count || 0, mine: !existing });
      return;
    }
    m = /^\/api\/servers\/([^/]+)\/suggestions\/([^/]+)$/.exec(p);
    if (m && req.method === 'PATCH') {
      if (!mod) { send(res, 403, { error: 'Owner or mods only.' }); return; }
      if (!(await needVerified(user, res))) return;
      const body = await readBody(req, 2048).catch(() => ({}));
      const status = ['open', 'planned', 'done', 'declined'].includes(body.status) ? body.status : 'open';
      const { error } = await supabase.from('server_suggestions').update({ status }).eq('id', m[2]).eq('server_id', sid);
      if (error) { send(res, 500, { error: 'Could not update that.' }); return; }
      send(res, 200, { ok: true, status });
      return;
    }

    // ── LFG (156) ──────────────────────────────────────────────
    if (p === '/api/servers/' + sid + '/lfg' && req.method === 'POST') {
      if (!(await needVerified(user, res))) return;
      if (!rateLimit('lfg:' + user.id, 8, 60000)) { send(res, 429, { error: 'Slow down.' }); return; }
      const body = await readBody(req, 4096).catch(() => ({}));
      const game = text(body.game, 60).replace(/[<>]/g, '');
      if (!game) { bad(res, 'Name the game.'); return; }
      const slots = Math.min(20, Math.max(2, parseInt(body.slots, 10) || 2));
      const { data, error } = await supabase.from('server_lfg')
        .insert({ server_id: sid, user_id: user.id, game, note: text(body.note, 200).replace(/[<>]/g, ''), slots, starts_at: when(body.starts_at) })
        .select('id, game, note, slots, starts_at, created_at').single();
      if (error) { if (noTable(error)) return notSetUp(res); send(res, 500, { error: 'Could not post that.' }); return; }
      send(res, 200, { post: data });
      return;
    }
    m = /^\/api\/servers\/([^/]+)\/lfg\/([^/]+)$/.exec(p);
    if (m && req.method === 'DELETE') {
      const { data: row } = await supabase.from('server_lfg').select('id, user_id').eq('id', m[2]).eq('server_id', sid).single();
      if (!row) { send(res, 404, { error: 'Not found.' }); return; }
      if (row.user_id !== user.id && !mod) { send(res, 403, { error: 'That is not yours.' }); return; }
      await supabase.from('server_lfg').delete().eq('id', m[2]);
      send(res, 200, { ok: true });
      return;
    }

    // ── Game nights and public events (170/188) ────────────────
    if (p === '/api/servers/' + sid + '/nights' && req.method === 'POST') {
      if (!mod) { send(res, 403, { error: 'Owner or mods only.' }); return; }
      if (!(await needVerified(user, res))) return;
      const body = await readBody(req, 4096).catch(() => ({}));
      const title = text(body.title, 80).replace(/[<>]/g, '');
      const starts = when(body.starts_at);
      if (!title) { bad(res, 'Name the night.'); return; }
      if (!starts) { bad(res, 'Pick a start time.'); return; }
      const { data, error } = await supabase.from('server_nights')
        .insert({ server_id: sid, created_by: user.id, title, game: text(body.game, 60).replace(/[<>]/g, ''), note: text(body.note, 240).replace(/[<>]/g, ''), starts_at: starts, is_public: body.is_public !== false })
        .select('id, title, game, note, starts_at, is_public').single();
      if (error) { if (noTable(error)) return notSetUp(res); send(res, 500, { error: 'Could not save the night.' }); return; }
      send(res, 200, { night: data });
      return;
    }
    m = /^\/api\/servers\/([^/]+)\/nights\/([^/]+)$/.exec(p);
    if (m && req.method === 'DELETE') {
      if (!mod) { send(res, 403, { error: 'Owner or mods only.' }); return; }
      await supabase.from('server_nights').delete().eq('id', m[2]).eq('server_id', sid);
      send(res, 200, { ok: true });
      return;
    }

    // ── Warnings (194): owner issues, member acknowledges ─────
    if (p === '/api/servers/' + sid + '/warnings' && req.method === 'POST') {
      if (!owner) { send(res, 403, { error: 'Only the owner issues warnings.' }); return; }
      if (!(await needVerified(user, res))) return;
      const body = await readBody(req, 4096).catch(() => ({}));
      const uid = String(body.user_id || '');
      const reason = text(body.reason, 300).replace(/[<>]/g, '');
      if (!isUuid(uid) || !reason) { bad(res, 'Pick a member and a reason.'); return; }
      const { data: mem } = await supabase.from('server_members').select('user_id').eq('server_id', sid).eq('user_id', uid).single();
      if (!mem) { send(res, 404, { error: 'They are not a member.' }); return; }
      const { data, error } = await supabase.from('server_warnings')
        .insert({ server_id: sid, user_id: uid, issued_by: user.id, reason }).select('id, reason, created_at').single();
      if (error) { if (noTable(error)) return notSetUp(res); send(res, 500, { error: 'Could not issue that warning.' }); return; }
      send(res, 200, { warning: data });
      return;
    }
    m = /^\/api\/servers\/([^/]+)\/warnings\/([^/]+)\/ack$/.exec(p);
    if (m && req.method === 'POST') {
      const { error } = await supabase.from('server_warnings')
        .update({ acknowledged_at: new Date().toISOString() }).eq('id', m[2]).eq('server_id', sid).eq('user_id', user.id);
      if (error) { send(res, 500, { error: 'Could not acknowledge that.' }); return; }
      send(res, 200, { ok: true });
      return;
    }

    // ── Spotlight (138) ────────────────────────────────────────
    if (p === '/api/servers/' + sid + '/spotlight' && req.method === 'POST') {
      if (!owner) { send(res, 403, { error: 'Only the owner picks a spotlight.' }); return; }
      if (!(await needVerified(user, res))) return;
      const body = await readBody(req, 4096).catch(() => ({}));
      const uid = String(body.user_id || '');
      if (!isUuid(uid)) { bad(res, 'Pick a member.'); return; }
      const { data: mem } = await supabase.from('server_members').select('user_id').eq('server_id', sid).eq('user_id', uid).single();
      if (!mem) { send(res, 404, { error: 'They are not a member.' }); return; }
      await supabase.from('server_spotlights').update({ active: false }).eq('server_id', sid).eq('active', true);
      const { data, error } = await supabase.from('server_spotlights')
        .insert({ server_id: sid, user_id: uid, blurb: text(body.blurb, 240).replace(/[<>]/g, ''), created_by: user.id })
        .select('id, user_id, blurb, created_at').single();
      if (error) { if (noTable(error)) return notSetUp(res); send(res, 500, { error: 'Could not set the spotlight.' }); return; }
      send(res, 200, { spotlight: data });
      return;
    }
    if (p === '/api/servers/' + sid + '/spotlight' && req.method === 'DELETE') {
      if (!owner) { send(res, 403, { error: 'Only the owner clears the spotlight.' }); return; }
      await supabase.from('server_spotlights').update({ active: false }).eq('server_id', sid).eq('active', true);
      send(res, 200, { ok: true });
      return;
    }

    // ── Inactivity read (199) ──────────────────────────────────
    if (p === '/api/servers/' + sid + '/inactive' && req.method === 'GET') {
      if (!owner) { send(res, 403, { error: 'Owner only.' }); return; }
      const days = Math.min(365, Math.max(7, parseInt(url.searchParams.get('days'), 10) || 30));
      const { data: chans } = await supabase.from('lobbies').select('name').eq('server_id', sid).eq('kind', 'channel').limit(200);
      const names = (chans || []).map(c => c.name);
      let last = {};
      if (names.length) {
        const { data: msgs } = await supabase.from('messages').select('user_id, created_at').in('lobby', names).order('created_at', { ascending: false }).limit(3000);
        (msgs || []).forEach(msg => { if (msg.user_id && !last[msg.user_id]) last[msg.user_id] = msg.created_at; });
      }
      const { data: memRows } = await supabase.from('server_members').select('user_id, role').eq('server_id', sid).limit(200);
      const ids = (memRows || []).map(r => r.user_id);
      const { data: us } = ids.length ? await supabase.from('users').select('id, display_name').in('id', ids) : { data: [] };
      const namesById = {};
      (us || []).forEach(u => { namesById[u.id] = u.display_name; });
      const cutoff = Date.now() - days * 86400000;
      const rows = (memRows || []).filter(r => r.role !== 'owner').map(r => {
        const seen = last[r.user_id] || null;
        return { user_id: r.user_id, name: namesById[r.user_id] || 'Member', role: r.role, last_message_at: seen };
      }).filter(r => !r.last_message_at || Date.parse(r.last_message_at) < cutoff)
        .sort((a, b) => String(a.last_message_at || '').localeCompare(String(b.last_message_at || '')));
      send(res, 200, { days, inactive: rows });
      return;
    }

    send(res, 404, { error: 'Not found.' });
  }

  return { handle, matches };
};

function matches(p) {
  if (p === '/api/servers/favourites') return true;
  if (!/^\/api\/servers\//.test(p) && !/^\/api\/channels\//.test(p)) return false;
  return /^\/api\/servers\/[^/]+\/(preview|community|community\/members\/[^/]+|me|prompts|prompts\/[^/]+\/post|suggestions|suggestions\/[^/]+|suggestions\/[^/]+\/vote|lfg|lfg\/[^/]+|nights|nights\/[^/]+|warnings|warnings\/[^/]+\/ack|spotlight|inactive|favourite)$/.test(p)
    || /^\/api\/channels\/[^/]+\/labels$/.test(p);
}
