/* file: lib/routes/planner.js
 * what: Scheduling and organisation — scheduled messages/announcements,
 *   message edit history, private message collections, and server events
 *   with RSVPs and an .ics download.
 * invariants: every read is gated by canSeeLobby or serverRole; edits are
 *   author-only and time-boxed; a collection snapshots its text so a deleted
 *   message never leaves an empty card. Missing tables read as 503.
 */
module.exports = function createRoutes(deps) {
  const { supabase, cors, requireUser, needVerified, readBody, isUuid, canSeeLobby, serverRole, broadcast, rateLimit } = deps;

  function send(res, code, body) {
    res.writeHead(code, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(body));
  }
  function noTable(err) {
    const code = String((err && err.code) || '');
    return code === 'PGRST205' || code === '42P01' || /does not exist|schema cache/i.test(String((err && err.message) || ''));
  }
  function notSetUp(res, what) {
    send(res, 503, { error: what + '_not_set_up', text: 'This needs the planner migration first.' });
  }
  async function lobbyByName(name) {
    const { data } = await supabase.from('lobbies')
      .select('id, name, kind, server_id, is_private').eq('name', String(name || '')).single();
    return data || null;
  }
  function icsStamp(d) {
    return new Date(d).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
  }
  function icsText(s) {
    return String(s || '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
  }

  async function handle(req, res, url) {
    // ── Scheduled messages / announcements ────────────────────────
    if (url.pathname === '/api/scheduled' && (req.method === 'GET' || req.method === 'POST')) {
      cors(res);
      const user = await requireUser(req, res); if (!user) return;
      if (req.method === 'POST') {
        if (!(await needVerified(user, res))) return;
        if (!rateLimit('sched:' + user.id, 20, 60 * 1000)) { send(res, 429, { error: 'Slow down.' }); return; }
        const body = await readBody(req, 8192).catch(() => ({}));
        const text = String((body && body.text) || '').trim().substring(0, 2000);
        const lobbyName = String((body && body.lobby) || '');
        if (!text || !lobbyName) { send(res, 400, { error: 'Message and conversation required.' }); return; }
        const lobby = await lobbyByName(lobbyName);
        if (!lobby || !(await canSeeLobby(user.id, lobby))) { send(res, 404, { error: 'Conversation not found.' }); return; }
        const at = Date.parse(body.sendAt || '');
        if (!Number.isFinite(at) || at < Date.now() + 30 * 1000 || at > Date.now() + 30 * 86400000) {
          send(res, 400, { error: 'Pick a time between 30 seconds and 30 days from now.' }); return;
        }
        const announcement = body.announcement === true;
        if (announcement) {
          if (!lobby.server_id) { send(res, 400, { error: 'Announcements need a server channel.' }); return; }
          const { role } = await serverRole(user.id, lobby.server_id);
          if (role !== 'owner') { send(res, 403, { error: 'Only the owner can schedule announcements.' }); return; }
        }
        const { data, error } = await supabase.from('scheduled_messages').insert({
          user_id: user.id, lobby_id: lobby.id, text, send_at: new Date(at).toISOString(),
          announcement,
        }).select('id, lobby_id, text, send_at, announcement').single();
        if (error) { if (noTable(error)) { notSetUp(res, 'scheduled'); return; } send(res, 500, { error: 'Could not schedule the message.' }); return; }
        send(res, 200, { scheduled: data });
        return;
      }
      const { data, error } = await supabase.from('scheduled_messages')
        .select('id, lobby_id, text, send_at, announcement, lobbies!scheduled_messages_lobby_fk(name)')
        .eq('user_id', user.id).is('sent_at', null).order('send_at').limit(30);
      if (error) { if (noTable(error)) { notSetUp(res, 'scheduled'); return; } send(res, 500, { error: 'Could not load scheduled messages.' }); return; }
      send(res, 200, { scheduled: (data || []).map(r => Object.assign({}, r, {
        lobby_name: (r.lobbies && r.lobbies.name) || '',
      })) });
      return;
    }
    const schedMatch = /^\/api\/scheduled\/([^/]+)$/.exec(url.pathname);
    if (schedMatch && req.method === 'DELETE') {
      cors(res);
      const user = await requireUser(req, res); if (!user) return;
      if (!isUuid(schedMatch[1])) { send(res, 400, { error: 'Invalid scheduled message.' }); return; }
      await supabase.from('scheduled_messages').delete().eq('id', schedMatch[1]).eq('user_id', user.id);
      send(res, 200, { ok: true });
      return;
    }

    // ── Edit history ─────────────────────────────────────────────
    const editsMatch = /^\/api\/messages\/([^/]+)\/edits$/.exec(url.pathname);
    if (editsMatch && req.method === 'GET') {
      cors(res);
      const user = await requireUser(req, res); if (!user) return;
      if (!isUuid(editsMatch[1])) { send(res, 400, { error: 'Invalid message.' }); return; }
      const { data: msg } = await supabase.from('messages')
        .select('id, lobby_id, lobbies!messages_lobby_id_fkey(name, kind, server_id, is_private)')
        .eq('id', editsMatch[1]).single();
      if (!msg) { send(res, 404, { error: 'Not found.' }); return; }
      const lob = msg.lobbies || {};
      if (!(await canSeeLobby(user.id, { id: msg.lobby_id, name: lob.name || '', kind: lob.kind || '', server_id: lob.server_id || null, is_private: !!lob.is_private }))) {
        send(res, 404, { error: 'Not found.' }); return;
      }
      const { data, error } = await supabase.from('message_edits')
        .select('body, edited_at').eq('message_id', msg.id).order('edited_at', { ascending: false }).limit(10);
      if (error) { if (noTable(error)) { notSetUp(res, 'edits'); return; } send(res, 500, { error: 'Could not load edits.' }); return; }
      send(res, 200, { edits: data || [] });
      return;
    }
    const editMatch = /^\/api\/messages\/([^/]+)\/edit$/.exec(url.pathname);
    if (editMatch && req.method === 'PUT') {
      cors(res);
      const mid = editMatch[1];
      if (!isUuid(mid)) { send(res, 400, { error: 'Invalid message.' }); return; }
      const user = await requireUser(req, res); if (!user) return;
      if (!(await needVerified(user, res))) return;
      const body = await readBody(req, 8192).catch(() => ({}));
      const text = String((body && body.text) || '').trim().substring(0, 2000);
      if (!text) { send(res, 400, { error: 'Message cannot be empty.' }); return; }
      const { data: msg } = await supabase.from('messages')
        .select('id, user_id, text, lobby_id, created_at, lobbies!messages_lobby_id_fkey(name, kind, server_id, is_private)')
        .eq('id', mid).single();
      if (!msg) { send(res, 404, { error: 'Not found.' }); return; }
      if (msg.user_id !== user.id) { send(res, 403, { error: 'Only the author can edit a message.' }); return; }
      if (Date.now() - new Date(msg.created_at).getTime() > 24 * 3600 * 1000) { send(res, 403, { error: 'Messages can be edited for 24 hours.' }); return; }
      if (text === String(msg.text || '').trim()) { send(res, 200, { ok: true, unchanged: true }); return; }
      const { error: histErr } = await supabase.from('message_edits').insert({ message_id: mid, body: msg.text, editor_id: user.id });
      if (histErr) { if (noTable(histErr)) { notSetUp(res, 'edits'); return; } send(res, 500, { error: 'Could not save the previous version.' }); return; }
      const { error } = await supabase.from('messages').update({ text, edited_at: new Date().toISOString() }).eq('id', mid);
      if (error) { send(res, 500, { error: 'Could not edit the message.' }); return; }
      // Keep the last ten revisions; older rows are noise, not history.
      const { data: old } = await supabase.from('message_edits').select('id')
        .eq('message_id', mid).order('edited_at', { ascending: false }).range(10, 40);
      if (old && old.length) await supabase.from('message_edits').delete().in('id', old.map(r => r.id));
      const lob = msg.lobbies || {};
      if (lob.name) broadcast(lob.name, { type: 'edit', lobby: lob.name, id: mid, text, edited_at: new Date().toISOString() });
      send(res, 200, { ok: true, text });
      return;
    }

    // ── Private message collections ──────────────────────────────
    if (url.pathname === '/api/message-collections' && (req.method === 'GET' || req.method === 'POST')) {
      cors(res);
      const user = await requireUser(req, res); if (!user) return;
      if (req.method === 'POST') {
        if (!(await needVerified(user, res))) return;
        const body = await readBody(req, 4096).catch(() => ({}));
        const name = String((body && body.name) || '').replace(/\s+/g, ' ').trim().substring(0, 32);
        if (!name) { send(res, 400, { error: 'Name the collection.' }); return; }
        const { count } = await supabase.from('message_collections').select('id', { count: 'exact', head: true }).eq('user_id', user.id);
        if ((count || 0) >= 12) { send(res, 400, { error: 'You can keep up to 12 collections.' }); return; }
        const { data, error } = await supabase.from('message_collections')
          .insert({ user_id: user.id, name }).select('id, name').single();
        if (error) { if (noTable(error)) { notSetUp(res, 'collections'); return; } send(res, 400, { error: 'That collection already exists.' }); return; }
        send(res, 200, { collection: data });
        return;
      }
      const { data, error } = await supabase.from('message_collections')
        .select('id, name, created_at').eq('user_id', user.id).order('name');
      if (error) { if (noTable(error)) { notSetUp(res, 'collections'); return; } send(res, 500, { error: 'Could not load collections.' }); return; }
      const rows = data || [];
      var counts = {};
      if (rows.length) {
        const { data: items } = await supabase.from('message_collection_items')
          .select('collection_id').eq('user_id', user.id).in('collection_id', rows.map(r => r.id));
        (items || []).forEach(i => { counts[i.collection_id] = (counts[i.collection_id] || 0) + 1; });
      }
      send(res, 200, { collections: rows.map(r => Object.assign({}, r, { count: counts[r.id] || 0 })) });
      return;
    }
    const colMatch = /^\/api\/message-collections\/([^/]+)(?:\/items(?:\/([^/]+))?)?$/.exec(url.pathname);
    if (colMatch) {
      cors(res);
      const user = await requireUser(req, res); if (!user) return;
      const cid = colMatch[1], mid = colMatch[2];
      if (!isUuid(cid)) { send(res, 400, { error: 'Invalid collection.' }); return; }
      const { data: col } = await supabase.from('message_collections').select('id').eq('id', cid).eq('user_id', user.id).single();
      if (!col) { send(res, 404, { error: 'Collection not found.' }); return; }
      if (req.method === 'DELETE' && !mid) {
        await supabase.from('message_collections').delete().eq('id', cid).eq('user_id', user.id);
        send(res, 200, { ok: true }); return;
      }
      if (!mid) { send(res, 405, { error: 'Method not allowed.' }); return; }
      if (req.method === 'DELETE' && mid) {
        if (!isUuid(mid)) { send(res, 400, { error: 'Invalid message.' }); return; }
        await supabase.from('message_collection_items').delete()
          .eq('collection_id', cid).eq('user_id', user.id).eq('message_id', mid);
        send(res, 200, { ok: true }); return;
      }
      if (req.method === 'POST' && !mid) {
        if (!(await needVerified(user, res))) return;
        const body = await readBody(req, 4096).catch(() => ({}));
        const messageId = String((body && body.messageId) || '');
        if (!isUuid(messageId)) { send(res, 400, { error: 'Invalid message.' }); return; }
        const { data: msg } = await supabase.from('messages')
          .select('id, text, display_name, lobby_id, lobbies!messages_lobby_id_fkey(name, kind, server_id, is_private)')
          .eq('id', messageId).single();
        if (!msg) { send(res, 404, { error: 'Message not found.' }); return; }
        const lob = msg.lobbies || {};
        if (!(await canSeeLobby(user.id, { id: msg.lobby_id, name: lob.name || '', kind: lob.kind || '', server_id: lob.server_id || null, is_private: !!lob.is_private }))) {
          send(res, 404, { error: 'Message not found.' }); return;
        }
        const { error } = await supabase.from('message_collection_items').upsert({
          collection_id: cid, message_id: messageId, user_id: user.id,
          text: String(msg.text || '').substring(0, 2000), display_name: msg.display_name || '',
          lobby_id: msg.lobby_id,
        }, { onConflict: 'collection_id,message_id' });
        if (error) { if (noTable(error)) { notSetUp(res, 'collections'); return; } send(res, 500, { error: 'Could not save the message.' }); return; }
        send(res, 200, { ok: true }); return;
      }
      if (req.method === 'GET' && !mid) {
        const { data, error } = await supabase.from('message_collection_items')
          .select('message_id, text, display_name, created_at').eq('collection_id', cid).eq('user_id', user.id)
          .order('created_at', { ascending: false }).limit(100);
        if (error) { if (noTable(error)) { notSetUp(res, 'collections'); return; } send(res, 500, { error: 'Could not load the collection.' }); return; }
        send(res, 200, { items: data || [] }); return;
      }
      send(res, 405, { error: 'Method not allowed.' });
      return;
    }

    // ── Server events, RSVP and calendar download ────────────────
    const evMatch = /^\/api\/servers\/([^/]+)\/events(?:\/([^/]+))?$/.exec(url.pathname);
    if (evMatch) {
      cors(res);
      const user = await requireUser(req, res); if (!user) return;
      const sid = evMatch[1], eid = evMatch[2];
      if (!isUuid(sid)) { send(res, 400, { error: 'Invalid server.' }); return; }
      const { role } = await serverRole(user.id, sid);
      if (!role) { send(res, 403, { error: 'Join this server first.' }); return; }
      if (req.method === 'GET' && !eid) {
        const { data, error } = await supabase.from('server_events')
          .select('id, channel_id, title, description, starts_at, ends_at, created_by')
          .eq('server_id', sid).gte('starts_at', new Date(Date.now() - 3600000).toISOString())
          .order('starts_at').limit(50);
        if (error) { if (noTable(error)) { notSetUp(res, 'events'); return; } send(res, 500, { error: 'Could not load events.' }); return; }
        const rows = data || [];
        var mine = {}, counts = {};
        if (rows.length) {
          const { data: rsvps } = await supabase.from('event_rsvps').select('event_id, user_id, state').in('event_id', rows.map(r => r.id));
          (rsvps || []).forEach(r => {
            if (r.state === 'going') counts[r.event_id] = (counts[r.event_id] || 0) + 1;
            if (r.user_id === user.id) mine[r.event_id] = r.state;
          });
        }
        send(res, 200, { events: rows.map(r => Object.assign({}, r, { going: counts[r.id] || 0, mine: mine[r.id] || null })) });
        return;
      }
      if (req.method === 'POST' && !eid) {
        if (role !== 'owner' && role !== 'mod') { send(res, 403, { error: 'Owner or mods only.' }); return; }
        if (!(await needVerified(user, res))) return;
        const body = await readBody(req, 8192).catch(() => ({}));
        const title = String((body && body.title) || '').trim().substring(0, 100);
        const desc = String((body && body.description) || '').trim().substring(0, 500);
        const start = Date.parse(body.startsAt || '');
        const end = body.endsAt ? Date.parse(body.endsAt) : null;
        if (title.length < 2 || !Number.isFinite(start)) { send(res, 400, { error: 'Title and start time required.' }); return; }
        if (start < Date.now() - 86400000 || start > Date.now() + 366 * 86400000) { send(res, 400, { error: 'Pick a start time within the next year.' }); return; }
        const { data, error } = await supabase.from('server_events').insert({
          server_id: sid, channel_id: isUuid(body.channelId || '') ? body.channelId : null,
          title, description: desc, starts_at: new Date(start).toISOString(),
          ends_at: Number.isFinite(end) ? new Date(end).toISOString() : null, created_by: user.id,
        }).select('id, title, starts_at').single();
        if (error) { if (noTable(error)) { notSetUp(res, 'events'); return; } send(res, 500, { error: 'Could not create the event.' }); return; }
        try { await supabase.from('server_audit').insert({ server_id: sid, actor_id: user.id, action: 'event.create', target: title }); } catch (e) {}
        send(res, 200, { event: data }); return;
      }
      if (req.method === 'DELETE' && eid) {
        if (role !== 'owner' && role !== 'mod') { send(res, 403, { error: 'Owner or mods only.' }); return; }
        if (!isUuid(eid)) { send(res, 400, { error: 'Invalid event.' }); return; }
        await supabase.from('server_events').delete().eq('id', eid).eq('server_id', sid);
        send(res, 200, { ok: true }); return;
      }
      send(res, 405, { error: 'Method not allowed.' });
      return;
    }
    const rsvpMatch = /^\/api\/events\/([^/]+)\/rsvp$/.exec(url.pathname);
    if (rsvpMatch && req.method === 'POST') {
      cors(res);
      const user = await requireUser(req, res); if (!user) return;
      const eid = rsvpMatch[1];
      if (!isUuid(eid)) { send(res, 400, { error: 'Invalid event.' }); return; }
      const { data: ev } = await supabase.from('server_events').select('id, server_id').eq('id', eid).single();
      if (!ev) { send(res, 404, { error: 'Event not found.' }); return; }
      const { role } = await serverRole(user.id, ev.server_id);
      if (!role) { send(res, 403, { error: 'Join this server first.' }); return; }
      const body = await readBody(req, 4096).catch(() => ({}));
      const state = body.state === 'not_going' ? 'not_going' : 'going';
      const { error } = await supabase.from('event_rsvps').upsert({
        event_id: eid, user_id: user.id, state,
        reminded_15: false, reminded_1: false,
      }, { onConflict: 'event_id,user_id' });
      if (error) { if (noTable(error)) { notSetUp(res, 'events'); return; } send(res, 500, { error: 'Could not save your RSVP.' }); return; }
      send(res, 200, { ok: true, state }); return;
    }
    const icsMatch = /^\/api\/events\/([^/]+)\/ics$/.exec(url.pathname);
    if (icsMatch && req.method === 'GET') {
      cors(res);
      const user = await requireUser(req, res); if (!user) return;
      const eid = icsMatch[1];
      if (!isUuid(eid)) { send(res, 400, { error: 'Invalid event.' }); return; }
      const { data: ev } = await supabase.from('server_events')
        .select('id, server_id, title, description, starts_at, ends_at').eq('id', eid).single();
      if (!ev) { send(res, 404, { error: 'Event not found.' }); return; }
      const { server, role } = await serverRole(user.id, ev.server_id);
      if (!role) { send(res, 403, { error: 'Join this server first.' }); return; }
      const end = ev.ends_at || new Date(new Date(ev.starts_at).getTime() + 3600000).toISOString();
      const lines = [
        'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Cudic//Events//EN', 'CALSCALE:GREGORIAN',
        'BEGIN:VEVENT', 'UID:' + ev.id + '@cudic', 'DTSTAMP:' + icsStamp(new Date()),
        'DTSTART:' + icsStamp(ev.starts_at), 'DTEND:' + icsStamp(end),
        'SUMMARY:' + icsText(ev.title), 'DESCRIPTION:' + icsText(ev.description),
        'LOCATION:' + icsText('Cudic — ' + ((server && server.name) || 'server')),
        'END:VEVENT', 'END:VCALENDAR', '',
      ];
      res.writeHead(200, {
        'Content-Type': 'text/calendar; charset=utf-8',
        'Content-Disposition': 'attachment; filename="cudic-event.ics"',
      });
      res.end(lines.join('\r\n'));
      return;
    }

    send(res, 404, { error: 'Not found.' });
  }

  return { handle, matches };
};

function matches(pathname) {
  return pathname === '/api/scheduled' || pathname.startsWith('/api/scheduled/')
    || pathname === '/api/message-collections' || pathname.startsWith('/api/message-collections/')
    || /^\/api\/messages\/[^/]+\/edits$/.test(pathname)
    || /^\/api\/messages\/[^/]+\/edit$/.test(pathname)
    || /^\/api\/servers\/[^/]+\/events(\/|$)/.test(pathname)
    || /^\/api\/events\/[^/]+\/(rsvp|ics)$/.test(pathname);
}
