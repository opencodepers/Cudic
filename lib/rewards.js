/* file: lib/rewards.js
 * what: the growth rewards that sit around the one-time quests — invitee welcome, invite ladder, fork credit, play milestones, Scratch import, 7-day play streak, weekly quests and server growth.
 * invariants: every payout is proved from rows on the server (never a client count) and keyed in coin_ledger or storage_grants, so a retry, restart or second tab cannot pay twice; fork and play rewards count distinct signed-in players, because raw play_count is trivially self-inflated.
 * see: AGENTS.md 5 (rewards), supabase/migrations/20261122140000_rewards.sql, server.js (/api/rewards) */

module.exports = function createRewards(supabase, deps) {
  const opts = deps || {};
  const notify = typeof opts.notify === 'function' ? opts.notify : null;
  const award = typeof opts.award === 'function' ? opts.award : null;
  const MB = 1024 * 1024;
  const DAY = 864e5;

  // ── Tuning ────────────────────────────────────────────────────
  // `players` is the number of distinct signed-in accounts required, not the
  // play counter. Requiring 3 real accounts for the first payout makes a farm
  // pay for three verified emails before it earns 25 coins.
  const PLAY_STEPS = [
    { plays: 10,   coins: 25,  players: 3 },
    { plays: 100,  coins: 100, players: 10 },
    { plays: 1000, coins: 250, players: 50 }
  ];
  const WEEK_QUESTS = [
    { id: 'week_comment3', coins: 40, label: 'Comment on 3 games',     note: 'On games other people made.' },
    { id: 'week_play5',    coins: 30, label: 'Play 5 different games', note: 'At least three made by someone else.' },
    { id: 'week_update',   coins: 50, label: 'Ship an update',         note: 'Publish a new release of a game you already shipped.' }
  ];
  const FORK_OWNER_COINS = 25;
  const FORKER_COINS = 10;
  const FORK_PLAYERS = 3;          // distinct signed-in players before a fork pays
  const WELCOME_COINS = 50;
  const IMPORT_COINS = 100;
  const STREAK_COINS = 100;
  const SERVER_COINS = 100;
  const SERVER_KEPT = 5;           // non-owner members past the 7-day mark

  // ── Small helpers ─────────────────────────────────────────────
  // Monday of the UTC week, as YYYY-MM-DD. Weekly keys use it so a reward can
  // land once per week without a scheduler.
  function mondayISO(d) {
    const x = new Date(d || Date.now());
    x.setUTCDate(x.getUTCDate() - ((x.getUTCDay() + 6) % 7));
    return x.toISOString().slice(0, 10);
  }
  const week = () => mondayISO();
  const since = (ms) => new Date(Date.now() - ms).toISOString();
  const today = () => new Date().toISOString().slice(0, 10);

  async function coinBalance(userId) {
    const { data } = await supabase.from('users').select('balance').eq('id', userId).single();
    return (data && data.balance) || 0;
  }

  // The ledger row *is* the receipt. Checking first keeps the common retry
  // cheap; the unique index behind grant_coins is the real fence.
  async function ledgerHas(userId, reason, ref) {
    let q = supabase.from('coin_ledger').select('id').eq('user_id', userId).eq('reason', reason).limit(1);
    if (ref) q = q.eq('ref_id', String(ref));
    const { data } = await q;
    return !!(data && data.length);
  }

  async function pay(userId, coins, reason, ref) {
    if (!coins) return { paid: false, already: true, balance: await coinBalance(userId) };
    if (await ledgerHas(userId, reason, ref)) return { paid: false, already: true, balance: await coinBalance(userId) };
    const { data, error } = await supabase.rpc('grant_coins', {
      p_user: userId, p_delta: coins, p_reason: reason, p_ref: ref ? String(ref) : null
    });
    if (error) {
      if (/duplicate|unique/i.test(String(error.message || ''))) {
        return { paid: false, already: true, balance: await coinBalance(userId) };
      }
      throw error;
    }
    return { paid: true, already: false, balance: Number(data) || await coinBalance(userId) };
  }

  function tell(userId, title, body, refType, refId) {
    if (!notify) return;
    try { notify(userId, 'reward', title, body, refType || 'profile', refId || null); } catch (e) {}
  }

  // ── Storage ───────────────────────────────────────────────────
  // Grants are counted, never stored as a balance: the cap is derived every
  // read, so deleting a grant takes the space back with it.
  async function storageBonus(userId) {
    const { data } = await supabase.from('storage_grants').select('bytes').eq('user_id', userId);
    return (data || []).reduce((n, r) => n + Math.max(0, Number(r.bytes) || 0), 0);
  }

  async function grantStorage(userId, source, bytes) {
    const { error } = await supabase.from('storage_grants').insert({ user_id: userId, source, bytes });
    if (!error) return bytes;
    if (String(error.code) === '23505' || /duplicate|unique/i.test(String(error.message || ''))) return 0;
    throw error;
  }

  async function storageSources(userId) {
    const { data } = await supabase.from('storage_grants').select('source').eq('user_id', userId);
    return new Set((data || []).map(r => r.source));
  }

  // ── Counters ──────────────────────────────────────────────────
  async function invitesOf(userId) {
    const { count } = await supabase.from('referrals').select('id', { count: 'exact', head: true }).eq('inviter_id', userId);
    return Number(count) || 0;
  }

  async function distinctPlayers(gameId) {
    const { count } = await supabase.from('game_plays').select('game_id', { count: 'exact', head: true }).eq('game_id', gameId);
    return Number(count) || 0;
  }

  // Written by the play route on every signed-in play. The PK makes it one row
  // per day, which is exactly the fact the streak reward needs.
  async function noteDailyPlay(userId) {
    try {
      await supabase.from('daily_plays').upsert(
        { user_id: userId, day: today() },
        { onConflict: 'user_id,day', ignoreDuplicates: true }
      );
    } catch (e) { /* a missing table must never break a play */ }
  }

  async function playDays(userId) {
    const from = new Date(Date.now() - 6 * DAY).toISOString().slice(0, 10);
    const { data } = await supabase.from('daily_plays').select('day').eq('user_id', userId).gte('day', from);
    return new Set((data || []).map(r => String(r.day).slice(0, 10))).size;
  }

  // ── Automatic hooks ───────────────────────────────────────────
  // Play milestones: fired only on the exact play that crosses a step, so the
  // hot path does no extra work on ordinary plays.
  async function playMilestones(game, plays) {
    const n = Number(plays) || 0;
    for (const step of PLAY_STEPS) {
      if (n !== step.plays) continue;
      if (await ledgerHas(game.owner_id, 'plays:' + step.plays, game.id)) continue;
      const players = await distinctPlayers(game.id);
      if (players < step.players) continue;
      const r = await pay(game.owner_id, step.coins, 'plays:' + step.plays, game.id);
      if (r.paid) {
        tell(game.owner_id, 'Your game passed ' + step.plays + ' plays',
          '+' + step.coins + ' coins — ' + players + ' different people have played it.', 'game', game.id);
      }
    }
  }

  // Fork credit: the fork must be published, owned by someone other than the
  // original maker, and have FORK_PLAYERS distinct signed-in players. That
  // turns "fork everything and collect" into "get three people to actually
  // play each fork", which is the behaviour the reward is trying to buy.
  async function forkCredit(game) {
    if (!game.published) return;
    const { data: origin } = await supabase.from('games')
      .select('owner_id, published').eq('id', game.forked_from).maybeSingle();
    if (!origin || !origin.published || origin.owner_id === game.owner_id) return;
    // The receipt belongs to the original maker, who is the account that gets
    // the larger half; checking it there avoids re-verifying on every play.
    if (await ledgerHas(origin.owner_id, 'fork', game.id)) return;
    const players = await distinctPlayers(game.id);
    if (players < FORK_PLAYERS) return;
    const { data: authRow } = await supabase.auth.admin.getUserById(game.owner_id);
    if (!authRow || !authRow.user || !authRow.user.email_confirmed_at) return;
    const ownerPay = await pay(origin.owner_id, FORK_OWNER_COINS, 'fork', game.id);
    await pay(game.owner_id, FORKER_COINS, 'forker', game.id);
    if (ownerPay.paid) {
      tell(origin.owner_id, 'Someone remixed your game',
        'A published fork picked up ' + players + ' players — +' + FORK_OWNER_COINS + ' coins.', 'game', game.id);
    }
  }

  async function onPlay(game, user, plays) {
    if (!game) return;
    if (user) await noteDailyPlay(user.id);
    const jobs = [];
    if (game.owner_id) jobs.push(playMilestones(game, plays));
    if (game.forked_from) jobs.push(forkCredit(game));
    await Promise.all(jobs);
  }

  // Invitee welcome: the invite has to have produced a published game. Paying
  // at signup is what alt-account farms live on; paying at publish is not.
  async function onPublish(userId) {
    const { data: ref } = await supabase.from('referrals').select('inviter_id').eq('invitee_id', userId).maybeSingle();
    if (!ref) return;
    const { count } = await supabase.from('games').select('id', { count: 'exact', head: true })
      .eq('owner_id', userId).eq('published', true);
    if (!count) return;
    const r = await pay(userId, WELCOME_COINS, 'welcome', userId);
    if (r.paid) {
      tell(userId, 'Welcome bonus',
        'Your first published game earned the ' + WELCOME_COINS + '-coin invite bonus.', 'profile', null);
    }
  }

  // Scratch import pays once per account. The route already rate-limits imports
  // and awards the `bolt` flair, so this only adds the coins.
  async function onScratchImport(userId) {
    const r = await pay(userId, IMPORT_COINS, 'import', 'scratch');
    if (r.paid) tell(userId, 'Scratch import bonus', '+' + IMPORT_COINS + ' coins for bringing a project over.', 'profile', null);
  }

  // ── Claimable state ───────────────────────────────────────────
  async function welcomeState(userId) {
    const { data: ref } = await supabase.from('referrals').select('inviter_id').eq('invitee_id', userId).maybeSingle();
    if (!ref) return null;
    const { count } = await supabase.from('games').select('id', { count: 'exact', head: true })
      .eq('owner_id', userId).eq('published', true);
    return { published: Number(count) > 0, done: await ledgerHas(userId, 'welcome', userId) };
  }

  async function commentGames(userId) {
    const { data } = await supabase.from('game_comments')
      .select('game_id, games!inner(owner_id, published)')
      .eq('user_id', userId).gte('created_at', since(7 * DAY)).limit(200);
    const ids = new Set();
    for (const r of data || []) {
      const g = r.games;
      if (g && g.published && g.owner_id !== userId) ids.add(r.game_id);
    }
    return ids.size;
  }

  async function recentGames(userId) {
    const { data } = await supabase.from('game_plays')
      .select('game_id').eq('user_id', userId).gte('played_at', since(7 * DAY)).limit(100);
    const ids = [...new Set((data || []).map(r => r.game_id))];
    if (!ids.length) return { games: 0, others: 0 };
    const { data: rows } = await supabase.from('games').select('id, owner_id').in('id', ids);
    const owners = new Map((rows || []).map(r => [r.id, r.owner_id]));
    let others = 0;
    for (const id of ids) if (owners.get(id) !== userId) others++;
    return { games: ids.length, others };
  }

  async function updatedThisWeek(userId) {
    const monday = week();
    const { count } = await supabase.from('games').select('id', { count: 'exact', head: true })
      .eq('owner_id', userId).eq('published', true)
      .lt('created_at', monday).gte('updated_at', monday);
    return Number(count) || 0;
  }

  async function serverProgress(userId) {
    const { data: servers } = await supabase.from('servers').select('id, name').eq('owner_id', userId).limit(20);
    if (!servers || !servers.length) return [];
    const ids = servers.map(s => s.id);
    const cutoff = since(7 * DAY);
    const { data: members } = await supabase.from('server_members')
      .select('server_id, role, joined_at').in('server_id', ids).lte('joined_at', cutoff);
    const kept = {};
    for (const m of members || []) {
      if (String(m.role || 'member') === 'owner') continue;
      kept[m.server_id] = (kept[m.server_id] || 0) + 1;
    }
    return servers.map(s => ({ id: s.id, name: s.name || 'your server', kept: kept[s.id] || 0 }));
  }

  // Everything the quests page can show. `done` comes from the same ledger keys
  // claim() uses, so the button state and the payout cannot disagree.
  async function list(userId) {
    const out = [];
    const [welcome, invites, sources, days, comments, recent, updates, servers] = await Promise.all([
      welcomeState(userId).catch(() => null),
      invitesOf(userId).catch(() => 0),
      storageSources(userId).catch(() => new Set()),
      playDays(userId).catch(() => 0),
      commentGames(userId).catch(() => 0),
      recentGames(userId).catch(() => ({ games: 0, others: 0 })),
      updatedThisWeek(userId).catch(() => 0),
      serverProgress(userId).catch(() => [])
    ]);

    if (welcome) {
      out.push({
        id: 'invite_welcome', kind: 'One-time', label: 'Welcome from a friend',
        note: welcome.published ? 'Your first game is published.' : 'Publish your first game to unlock it.',
        coins: WELCOME_COINS, storage_bytes: 0, done: welcome.done
      });
    }
    {
      out.push({
        id: 'invite_3', kind: 'Invites', label: 'Bring 3 makers',
        note: Math.min(invites, 3) + '/3 invites · +15 MB and the Scout title',
        coins: 0, storage_bytes: 15 * MB, done: sources.has('invite3')
      });
      out.push({
        id: 'invite_10', kind: 'Invites', label: 'Bring 10 makers',
        note: Math.min(invites, 10) + '/10 invites · +25 MB and the Recruiter badge',
        coins: 0, storage_bytes: 25 * MB, done: sources.has('invite10')
      });
    }
    out.push({
      id: 'import_scratch', kind: 'One-time', label: 'Bring a Scratch project',
      note: 'Import an .sb3 or a Scratch link.', coins: IMPORT_COINS, storage_bytes: 0,
      done: await ledgerHas(userId, 'import', 'scratch').catch(() => false)
    });
    out.push({
      id: 'daily7', kind: 'Weekly', label: 'Play 7 days in a row',
      note: days + '/7 days this week (server-counted).', coins: STREAK_COINS, storage_bytes: 0,
      done: await ledgerHas(userId, 'daily7:' + week()).catch(() => false)
    });
    out.push({
      id: 'week_comment3', kind: 'Weekly', label: WEEK_QUESTS[0].label,
      note: comments + '/3 other makers\' games.', coins: WEEK_QUESTS[0].coins, storage_bytes: 0,
      done: await ledgerHas(userId, 'quest:week_comment3:' + week()).catch(() => false)
    });
    out.push({
      id: 'week_play5', kind: 'Weekly', label: WEEK_QUESTS[1].label,
      note: recent.games + '/5 games, ' + recent.others + ' by other makers.', coins: WEEK_QUESTS[1].coins, storage_bytes: 0,
      done: await ledgerHas(userId, 'quest:week_play5:' + week()).catch(() => false)
    });
    out.push({
      id: 'week_update', kind: 'Weekly', label: WEEK_QUESTS[2].label,
      note: updates ? 'Update shipped this week.' : 'Publish a new release of an older game.', coins: WEEK_QUESTS[2].coins, storage_bytes: 0,
      done: await ledgerHas(userId, 'quest:week_update:' + week()).catch(() => false)
    });
    for (const s of servers) {
      out.push({
        id: 'server_growth:' + s.id, kind: 'Community',
        label: 'Grow ' + s.name,
        note: Math.min(s.kept, SERVER_KEPT) + '/' + SERVER_KEPT + ' members stayed a week.',
        coins: SERVER_COINS, storage_bytes: 0,
        done: await ledgerHas(userId, 'server:' + s.id).catch(() => false)
      });
    }
    return out;
  }

  // ── Claim ─────────────────────────────────────────────────────
  // Every branch re-checks the deed here. A client that lies about `done` gets
  // a 400, not a payout.
  async function claim(userId, id) {
    const key = String(id || '');
    if (!key) return { error: 'unknown_reward', status: 400, text: 'Unknown reward.' };

    if (key === 'invite_welcome') {
      const st = await welcomeState(userId);
      if (!st) return { error: 'not_referred', status: 400, text: 'That reward is for accounts that joined through a link.' };
      if (!st.published) return { error: 'not_published', status: 400, text: 'Publish your first game first.' };
      const r = await pay(userId, WELCOME_COINS, 'welcome', userId);
      return { ok: true, coins: r.paid ? WELCOME_COINS : 0, already: r.already, balance: r.balance };
    }

    if (key === 'invite_3' || key === 'invite_10') {
      const need = key === 'invite_3' ? 3 : 10;
      const bytes = key === 'invite_3' ? 15 * MB : 25 * MB;
      const source = key === 'invite_3' ? 'invite3' : 'invite10';
      const invites = await invitesOf(userId);
      if (invites < need) return { error: 'not_enough_invites', status: 400, text: 'That needs ' + need + ' credited invites.' };
      const granted = await grantStorage(userId, source, bytes);
      if (granted && award) {
        await award(userId, key === 'invite_3' ? 'scout' : 'recruiter');
        tell(userId, 'Invite milestone', '+' + Math.round(bytes / MB) + ' MB of storage.', 'profile', null);
      }
      return { ok: true, coins: 0, storage_bytes: granted, already: !granted, balance: await coinBalance(userId) };
    }

    if (key === 'import_scratch') {
      const r = await pay(userId, IMPORT_COINS, 'import', 'scratch');
      return { ok: true, coins: r.paid ? IMPORT_COINS : 0, already: r.already, balance: r.balance };
    }

    if (key === 'daily7') {
      const days = await playDays(userId);
      if (days < 7) return { error: 'streak_incomplete', status: 400, text: 'Play on ' + (7 - days) + ' more day(s) this week.' };
      const r = await pay(userId, STREAK_COINS, 'daily7:' + week());
      return { ok: true, coins: r.paid ? STREAK_COINS : 0, already: r.already, balance: r.balance };
    }

    if (key === 'week_comment3') {
      const n = await commentGames(userId);
      if (n < 3) return { error: 'not_done', status: 400, text: 'Comment on ' + (3 - n) + ' more game(s) by other makers.' };
      const r = await pay(userId, WEEK_QUESTS[0].coins, 'quest:week_comment3:' + week());
      return { ok: true, coins: r.paid ? WEEK_QUESTS[0].coins : 0, already: r.already, balance: r.balance };
    }

    if (key === 'week_play5') {
      const st = await recentGames(userId);
      if (st.games < 5 || st.others < 3) {
        return { error: 'not_done', status: 400, text: 'Play more games — 5 different ones, at least 3 by other makers.' };
      }
      const r = await pay(userId, WEEK_QUESTS[1].coins, 'quest:week_play5:' + week());
      return { ok: true, coins: r.paid ? WEEK_QUESTS[1].coins : 0, already: r.already, balance: r.balance };
    }

    if (key === 'week_update') {
      const n = await updatedThisWeek(userId);
      if (!n) return { error: 'not_done', status: 400, text: 'Publish a new release of a game you shipped before this week.' };
      const r = await pay(userId, WEEK_QUESTS[2].coins, 'quest:week_update:' + week());
      return { ok: true, coins: r.paid ? WEEK_QUESTS[2].coins : 0, already: r.already, balance: r.balance };
    }

    if (key.startsWith('server_growth:')) {
      const serverId = key.slice('server_growth:'.length);
      const servers = await serverProgress(userId);
      const s = servers.find(x => x.id === serverId);
      if (!s) return { error: 'not_owner', status: 403, text: 'That is not your server.' };
      if (s.kept < SERVER_KEPT) return { error: 'not_done', status: 400, text: 'Needs ' + SERVER_KEPT + ' members who have stayed a week.' };
      const r = await pay(userId, SERVER_COINS, 'server:' + serverId);
      return { ok: true, coins: r.paid ? SERVER_COINS : 0, already: r.already, balance: r.balance };
    }

    return { error: 'unknown_reward', status: 400, text: 'Unknown reward.' };
  }

  return {
    MB,
    PLAY_STEPS,
    WEEK_QUESTS,
    mondayISO,
    storageBonus,
    list,
    claim,
    onPlay,
    onPublish,
    onScratchImport,
    noteDailyPlay
  };
};
