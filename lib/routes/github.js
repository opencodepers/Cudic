/* file: lib/routes/github.js
 * what: GitHub connection, repo, push, tree/file and webhook routes — extracted verbatim from server.js; routing order is unchanged.
 * invariants: handle() runs only when matches() is true; server.js falls through
 *   when nothing was written (res.headersSent is false). Shared helpers are
 *   injected by the factory, never re-declared here.
 */
module.exports = function createRoutes(deps) {
  const { cors, userOf, ghKey, GH_SETUP_TEXT, supabase, ghNoTable, requireUser, needVerified, rateLimit, readBody, GH_SCOPES_OK, ghSeal, ghGate, ghApi, ghFail, ghSend, GH_PATH, ghDeployWarned, GIT_SNAP_PATH, GIT_SNAP_CAP, GH_NAME, crypto, ghToken, repoTreeFiles, createRelease } = deps;

  async function handle(req, res, url) {
if (url.pathname === '/api/github/connection' && req.method === 'GET') {
    cors(res);
    const user = await userOf(req);
    if (!user) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Sign in required.' }));
      return;
    }
    if (!ghKey()) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ enabled: false, connected: false, text: GH_SETUP_TEXT }));
      return;
    }
    const { data, error } = await supabase.from('github_connections')
      .select('login, scopes, connected_at').eq('user_id', user.id).maybeSingle();
    if (error && !ghNoTable(error)) {
      console.error('github connection read:', error.message || error);
    }
    const row = error ? null : data;
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      enabled: true,
      connected: !!row,
      login: (row && row.login) || '',
      scopes: String((row && row.scopes) || '').split(',').map((s) => s.trim()).filter(Boolean),
      connected_at: (row && row.connected_at) || null,
    }));
    return;
  }

if (url.pathname === '/api/github/connect' && req.method === 'POST') {
    cors(res);
    const user = await requireUser(req, res); if (!user) return;
    if (!(await needVerified(user, res))) return;
    const key = ghKey();
    if (!key) {
      res.writeHead(503, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'github_not_configured', text: GH_SETUP_TEXT }));
      return;
    }
    if (!rateLimit('github:connect:' + user.id, 10, 60 * 60 * 1000)) {
      res.writeHead(429, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Too many attempts. Try again later.' }));
      return;
    }
    const body = await readBody(req).catch(() => ({}));
    const token = String(body.token || '').trim();
    // GitHub OAuth tokens are 40+ chars, no whitespace. Reject obvious junk
    // before spending a call on it.
    if (token.length < 20 || token.length > 255 || /\s/.test(token)) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'github_bad_token', text: 'That does not look like a GitHub token.' }));
      return;
    }
    let gh;
    try {
      gh = await fetch('https://api.github.com/user', {
        headers: { 'Authorization': 'Bearer ' + token, 'Accept': 'application/vnd.github+json', 'User-Agent': 'cudic' },
      });
    } catch (e) {
      res.writeHead(502, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'github_unreachable', text: 'Could not reach GitHub. Try again.' }));
      return;
    }
    if (!gh.ok) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        error: 'github_rejected',
        text: gh.status === 401 ? 'GitHub rejected that token — reconnect and approve repo access.' : 'GitHub answered ' + gh.status + '.',
      }));
      return;
    }
    // GitHub reports what the token may do in a header, not the body. A token
    // from a plain sign-in has no repo scope, which is exactly the case this
    // check exists to catch.
    const scopes = String(gh.headers.get('x-oauth-scopes') || '')
      .split(',').map((s) => s.trim()).filter(Boolean);
    if (!GH_SCOPES_OK.some((s) => scopes.includes(s))) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        error: 'github_scope',
        text: 'Cudic needs repo access — reconnect and allow access to your repositories.',
      }));
      return;
    }
    const me = await gh.json().catch(() => null);
    const login = String((me && me.login) || '').replace(/[^A-Za-z0-9._-]/g, '').slice(0, 100);
    const { error: saveErr } = await supabase.from('github_connections').upsert({
      user_id: user.id,
      login,
      scopes: scopes.join(','),
      token_enc: ghSeal(token, key),
      connected_at: new Date().toISOString(),
      last_used_at: null,
    }, { onConflict: 'user_id' });
    if (saveErr) {
      console.error('github connection save:', saveErr.message || saveErr);
      res.writeHead(ghNoTable(saveErr) ? 503 : 500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        error: ghNoTable(saveErr) ? 'github_not_configured' : 'github_save_failed',
        text: ghNoTable(saveErr) ? GH_SETUP_TEXT : 'Could not save the connection.',
      }));
      return;
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, login, scopes }));
    return;
  }

if (url.pathname === '/api/github/connection' && req.method === 'DELETE') {
    cors(res);
    const user = await requireUser(req, res); if (!user) return;
    if (!(await needVerified(user, res))) return;
    const { error } = await supabase.from('github_connections').delete().eq('user_id', user.id);
    if (error && !ghNoTable(error)) {
      console.error('github connection delete:', error.message || error);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Could not disconnect.' }));
      return;
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true }));
    return;
  }

if (url.pathname === '/api/github/repos' && req.method === 'GET') {
    const got = await ghGate(req, res, 'repos', 120); if (!got) return;
    let r;
    try {
      r = await ghApi('/user/repos?per_page=100&sort=updated&affiliation=owner,collaborator', got.token);
    } catch (e) { return ghFail(res, 502, 'github_unreachable', 'Could not reach GitHub. Try again.'); }
    if (r.status === 401) return ghFail(res, 401, 'github_reconnect');
    if (r.status === 403) return ghFail(res, 429, 'github_rate_limited', 'GitHub is rate-limiting that account right now.');
    if (!r.ok) return ghFail(res, 502, 'github_error', 'GitHub answered ' + r.status + '.');
    const list = await r.json().catch(() => null);
    const repos = (Array.isArray(list) ? list : []).map((x) => ({
      full_name: String((x && x.full_name) || '').slice(0, 200),
      owner: String((x && x.owner && x.owner.login) || '').slice(0, 100),
      name: String((x && x.name) || '').slice(0, 100),
      private: !!(x && x.private),
      fork: !!(x && x.fork),
      archived: !!(x && x.archived),
      default_branch: String((x && x.default_branch) || 'main').slice(0, 200),
      size_kb: Number(x && x.size) || 0,
      updated_at: (x && x.updated_at) || null,
      description: typeof (x && x.description) === 'string' ? x.description.slice(0, 140) : '',
    }));
    // Private first — those are the ones no public path can reach.
    repos.sort((a, b) =>
      (Number(b.private) - Number(a.private)) ||
      String(b.updated_at || '').localeCompare(String(a.updated_at || '')));
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ login: got.login, repos }));
    return;
  }

  // POST /api/github/repos — create a repository on the connected account.
  // Studio's Source Control needs a remote before it can push; this is that
  // step, on the user's own account, with the user's own token.
  if (url.pathname === '/api/github/repos' && req.method === 'POST') {
    const got = await ghGate(req, res, 'repo-create', 10); if (!got) return;
    const body = await readBody(req, 16 * 1024).catch(() => ({}));
    const name = String(body.name || '').trim();
    if (!/^[A-Za-z0-9._-]{1,100}$/.test(name)) {
      return ghFail(res, 400, 'bad_name', 'Repository names use letters, digits, dot, dash or underscore.');
    }
    let r;
    try {
      r = await ghSend('/user/repos', got.token, 'POST', {
        name,
        description: String(body.description || '').slice(0, 200),
        private: body.private === true,
        auto_init: false,
      });
    } catch (e) {
      return ghFail(res, 502, 'github_unreachable', 'Could not reach GitHub. Try again.');
    }
    if (r.status === 401) return ghFail(res, 401, 'github_reconnect');
    if (r.status === 403) return ghFail(res, 429, 'github_rate_limited');
    if (r.status === 422) return ghFail(res, 409, 'repo_exists', 'A repository with that name already exists on your account.');
    if (!r.ok) return ghFail(res, 502, 'github_error', 'GitHub answered ' + r.status + '.');
    const j = await r.json().catch(() => null);
    res.writeHead(201, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      repo: {
        full_name: String((j && j.full_name) || ''),
        owner: String((j && j.owner && j.owner.login) || ''),
        name: String((j && j.name) || ''),
        default_branch: String((j && j.default_branch) || 'main'),
        html_url: String((j && j.html_url) || ''),
        private: !!(j && j.private),
      },
    }));
    return;
  }

  // POST /api/github/push — write the project's files as a real commit on a
  // real branch: blobs, a tree, a commit with the branch tip as its parent, then
  // the ref. Fast-forward only: if the branch moved since the client last read
  // it, the push is refused instead of overwriting someone else's commit.
  if (url.pathname === '/api/github/push' && req.method === 'POST') {
    const got = await ghGate(req, res, 'push', 30); if (!got) return;
    const body = await readBody(req, 24 * 1024 * 1024).catch(() => ({}));
    const owner = String(body.owner || '').replace(/[^A-Za-z0-9._-]/g, '');
    const repoName = String(body.repo || '').replace(/[^A-Za-z0-9._-]/g, '');
    const branch = String(body.branch || 'main').replace(/[^A-Za-z0-9._/-]/g, '');
    const message = String(body.message || '').trim().slice(0, 2000) || 'Push from Cudic';
    if (!owner || !repoName) return ghFail(res, 400, 'bad_repo', 'Which repository should this push to?');
    if (!branch || branch.includes('..') || branch.startsWith('/')) {
      return ghFail(res, 400, 'bad_branch', 'That branch name is not usable.');
    }
    const entries = Array.isArray(body.files) ? body.files.slice(0, 500) : [];
    const usable = entries.filter((e) => {
      const p = String(e && e.path || '');
      return GH_PATH.test(p) && !p.includes('..') && typeof e.base64 === 'string' && e.base64 !== '';
    });
    if (usable.length === 0) return ghFail(res, 400, 'empty', 'Nothing to push — the project has no files.');

    const base = '/repos/' + owner + '/' + repoName;
    const guard = (r, what) => {
      if (r.status === 401) { ghFail(res, 401, 'github_reconnect'); return false; }
      if (r.status === 403) { ghFail(res, 429, 'github_rate_limited'); return false; }
      if (r.status === 404) { ghFail(res, 404, 'repo_missing', 'GitHub could not find ' + owner + '/' + repoName + '.'); return false; }
      if (r.status === 409) { ghFail(res, 409, 'github_conflict', 'GitHub refused a write to ' + owner + '/' + repoName + ' (' + what + '). If that repository has no commits yet, open it on GitHub once and push again.'); return false; }
      if (!r.ok) { ghFail(res, 502, 'github_error', 'GitHub answered ' + r.status + ' while ' + what + '.'); return false; }
      return true;
    };

    let parentSha = null;
    let parentTree = null;
    let refRes;
    try {
      refRes = await ghApi(base + '/git/ref/heads/' + branch, got.token);
    } catch (e) {
      return ghFail(res, 502, 'github_unreachable', 'Could not reach GitHub. Try again.');
    }
    if (refRes.status === 200) {
      const rj = await refRes.json().catch(() => null);
      parentSha = String((rj && rj.object && rj.object.sha) || '') || null;
    } else if (refRes.status !== 404 && refRes.status !== 409) {
      // 404 = no such ref; 409 = GitHub's answer for a repository with no
      // commits yet ("Git Repository is empty"). Both mean the same thing:
      // this is the first push, so the commit has no parent and the branch ref
      // is created below instead of updated.
      if (!guard(refRes, 'reading the branch')) return;
    }
    if (parentSha) {
      const cRes = await ghApi(base + '/git/commits/' + parentSha, got.token).catch(() => null);
      if (cRes && cRes.ok) {
        const cj = await cRes.json().catch(() => null);
        parentTree = String((cj && cj.tree && cj.tree.sha) || '') || null;
      }
    }

    // GitHub's git-data endpoints answer 409 ("Git Repository is empty.") while
    // a repository has no commits at all — there is no object database to write
    // blobs and trees into yet. Reading the ref already treats 409 as "no
    // parent", but the first blob still fails, which is exactly what "GitHub
    // answered 409 while uploading index.html" was. The Contents API does work
    // on an empty repository, so the first push seeds one real file through it
    // and then builds the rest of the project into a normal commit.
    if (!parentSha) {
      const probe = await ghApi(base + '/commits?per_page=1', got.token).catch(() => null);
      const seed = usable[0];
      if (probe != null && probe.status === 409 && seed) {
        const seedPath = String(seed.path).split('/').map(encodeURIComponent).join('/');
        const seedRes = await ghSend(base + '/contents/' + seedPath, got.token, 'PUT', {
          message: 'Initial commit from Cudic',
          content: seed.base64,
        }).catch(() => null);
        const sj = seedRes && seedRes.ok ? await seedRes.json().catch(() => null) : null;
        const seedSha = String((sj && sj.commit && sj.commit.sha) || '');
        if (seedSha) {
          parentSha = seedSha;
          parentTree = String((sj && sj.commit && sj.commit.tree && sj.commit.tree.sha) || '') || null;
          // The Contents API writes to the repository's default branch; a
          // project pushing to any other name needs that ref to exist before
          // the final step updates it.
          const seedRef = await ghApi(base + '/git/ref/heads/' + branch, got.token).catch(() => null);
          if (seedRef != null && seedRef.status === 404) {
            await ghSend(base + '/git/refs', got.token, 'POST', { ref: 'refs/heads/' + branch, sha: seedSha }).catch(() => null);
          }
        } else if (seedRes && seedRes.status === 401) {
          return ghFail(res, 401, 'github_reconnect');
        } else if (seedRes && seedRes.status === 403) {
          return ghFail(res, 429, 'github_rate_limited');
        }
      }
    }

    const treeEntries = [];
    for (const e of usable) {
      let bRes;
      try {
        bRes = await ghSend(base + '/git/blobs', got.token, 'POST', {
          content: e.base64,
          encoding: 'base64',
        });
      } catch (err) {
        return ghFail(res, 502, 'github_unreachable', 'Could not reach GitHub. Try again.');
      }
      if (!guard(bRes, 'uploading ' + e.path)) return;
      const bj = await bRes.json().catch(() => null);
      const sha = String((bj && bj.sha) || '');
      if (!sha) return ghFail(res, 502, 'github_error', 'GitHub returned no blob for ' + e.path + '.');
      treeEntries.push({ path: String(e.path), mode: '100644', type: 'blob', sha });
    }

    // base_tree keeps files this project does not carry (an imported subfolder
    // must never wipe the rest of the repository). Deleting on push is a
    // separate decision, and not one this route makes silently.
    const treePayload = { tree: treeEntries };
    if (parentTree) treePayload.base_tree = parentTree;
    let tRes;
    try {
      tRes = await ghSend(base + '/git/trees', got.token, 'POST', treePayload);
    } catch (err) {
      return ghFail(res, 502, 'github_unreachable', 'Could not reach GitHub. Try again.');
    }
    if (!guard(tRes, 'building the tree')) return;
    const tj = await tRes.json().catch(() => null);
    const treeSha = String((tj && tj.sha) || '');
    if (!treeSha) return ghFail(res, 502, 'github_error', 'GitHub returned no tree.');

    let commitRes;
    try {
      commitRes = await ghSend(base + '/git/commits', got.token, 'POST', {
        message,
        tree: treeSha,
        parents: parentSha ? [parentSha] : [],
      });
    } catch (err) {
      return ghFail(res, 502, 'github_unreachable', 'Could not reach GitHub. Try again.');
    }
    if (!guard(commitRes, 'creating the commit')) return;
    const cj = await commitRes.json().catch(() => null);
    const commitSha = String((cj && cj.sha) || '');
    if (!commitSha) return ghFail(res, 502, 'github_error', 'GitHub returned no commit.');

    let refWrite;
    try {
      refWrite = parentSha
        ? await ghSend(base + '/git/refs/heads/' + branch, got.token, 'PATCH', { sha: commitSha, force: false })
        : await ghSend(base + '/git/refs', got.token, 'POST', { ref: 'refs/heads/' + branch, sha: commitSha });
    } catch (err) {
      return ghFail(res, 502, 'github_unreachable', 'Could not reach GitHub. Try again.');
    }
    if (refWrite.status === 422) {
      return ghFail(res, 409, 'remote_moved', 'The branch moved on GitHub since this project last read it — pull or fetch before pushing again.');
    }
    if (!guard(refWrite, 'updating the branch')) return;

    // Remember which project this repository belongs to. Without it a push is
    // an anonymous contribution: the server holds the repo, the token and the
    // code, but nothing that says which game it is, so a later commit to the
    // repo cannot deploy anything. Columns are additive (see the
    // game_github_deploy migration); until it is applied this update fails
    // harmlessly and the push still succeeds.
    const pushProject = /^[0-9a-fA-F-]{8,64}$/.test(String(body.game_id || '')) ? String(body.game_id) : '';
    if (pushProject !== '' && got.login) {
      const mapped = await supabase.from('games').update({
        github_repo: owner + '/' + repoName,
        github_branch: branch,
        github_login: got.login,
      }).eq('id', pushProject).eq('owner_id', got.user.id).select('id').maybeSingle();
      if (mapped.error != null) {
        // Say it once per process instead of failing every push ever made.
        if (!ghDeployWarned) {
          ghDeployWarned = true;
          console.warn('github deploy: games.github_repo not writable (' + mapped.error.message + ') — apply supabase/migrations/20261108120000_game_github_deploy.sql');
        }
      }
    }

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      commit: commitSha,
      tree: treeSha,
      parent: parentSha,
      branch,
      url: 'https://github.com/' + owner + '/' + repoName + '/commit/' + commitSha,
      files: treeEntries.length,
    }));
    return;
  }

if (url.pathname === '/api/git/repo' && (req.method === 'POST' || req.method === 'GET')) {
    cors(res);
    const user = await userOf(req);
    if (!user) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Sign in required.' }));
      return;
    }
    const body = req.method === 'POST'
      ? await readBody(req, 12 * 1024 * 1024).catch(() => null)
      : null;
    const id = String((req.method === 'POST' ? body && body.id : url.searchParams.get('id')) || '');
    if (!/^[0-9a-fA-F-]{8,64}$/.test(id)) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Unknown project.' }));
      return;
    }
    // The repository names the project's files, so it is exactly as private as
    // the project: owner only, never the published-games path.
    const { data: row } = await supabase.from('games').select('owner_id').eq('id', id).maybeSingle();
    if (!row) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Project not found.' }));
      return;
    }
    if (row.owner_id !== user.id) {
      res.writeHead(403, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Only the project owner can store its repository.' }));
      return;
    }
    const snapPath = 'game-git/' + id + '.json';
    const bucket = supabase.storage.from('game-assets');

    if (req.method === 'GET') {
      let text = '';
      try {
        const { data: blob, error } = await bucket.download(snapPath);
        if (error || !blob) throw error || new Error('empty');
        text = await blob.text();
      } catch {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'No stored repository for this project.' }));
        return;
      }
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      res.end(text);
      return;
    }

    const list = Array.isArray(body && body.files) ? body.files : [];
    if (list.length === 0 || list.length > 6000) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'That repository snapshot looks wrong.' }));
      return;
    }
    const files = [];
    let bytes = 0;
    for (const f of list) {
      const path = typeof (f && f.path) === 'string' ? f.path : '';
      const b64 = typeof (f && f.base64) === 'string' ? f.base64 : '';
      if (!GIT_SNAP_PATH.test(path) || path === '.' || path.includes('..')) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'A path in that repository snapshot is not allowed.' }));
        return;
      }
      bytes += b64.length;
      if (bytes > GIT_SNAP_CAP) {
        res.writeHead(413, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'This repository is too large to store with the project yet.' }));
        return;
      }
      files.push({ path, base64: b64 });
    }
    if (!rateLimit('git-repo:' + user.id, 120, 60 * 60 * 1000)) {
      res.writeHead(429, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Too many repository saves just now. Try again in a few minutes.' }));
      return;
    }
    const json = JSON.stringify({ version: 1, project: id, saved_at: new Date().toISOString(), files });
    try {
      const { error } = await bucket.upload(snapPath, new Blob([json], { type: 'application/json' }), {
        upsert: true,
        contentType: 'application/json',
      });
      if (error) throw error;
    } catch (e) {
      console.error('git snapshot upload failed:', e && e.message);
      res.writeHead(503, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Could not store the repository.' }));
      return;
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, files: files.length }));
    return;
  }

if (url.pathname === '/api/github/tree' && req.method === 'GET') {
    const got = await ghGate(req, res, 'tree', 300); if (!got) return;
    const owner = String(url.searchParams.get('owner') || '');
    const repo = String(url.searchParams.get('repo') || '');
    const wantRef = String(url.searchParams.get('ref') || '');
    if (!GH_NAME.test(owner) || !GH_NAME.test(repo)) return ghFail(res, 400, 'github_bad_repo', 'That is not a repo name.');
    if (wantRef !== '' && !GH_PATH.test(wantRef)) return ghFail(res, 400, 'github_bad_ref', 'That is not a branch name.');
    try {
      let ref = wantRef;
      if (ref === '') {
        const info = await ghApi('/repos/' + owner + '/' + repo, got.token);
        if (info.status === 401) return ghFail(res, 401, 'github_reconnect');
        if (info.status === 404) return ghFail(res, 404, 'github_not_found', 'No repo at ' + owner + '/' + repo + ' that this account can read.');
        if (!info.ok) return ghFail(res, 502, 'github_error', 'GitHub answered ' + info.status + '.');
        const j = await info.json().catch(() => null);
        ref = String((j && j.default_branch) || 'main');
      }
      const t = await ghApi('/repos/' + owner + '/' + repo + '/git/trees/' + encodeURIComponent(ref) + '?recursive=1', got.token);
      if (t.status === 401) return ghFail(res, 401, 'github_reconnect');
      if (t.status === 403) return ghFail(res, 409, 'github_scope', 'Cudic cannot read that repo — reconnect GitHub and allow access to it.');
      if (t.status === 404) return ghFail(res, 404, 'github_not_found', 'No branch ' + ref + ' in ' + owner + '/' + repo + '.');
      if (t.status === 409) return ghFail(res, 409, 'github_empty', 'That repository is empty.');
      if (!t.ok) return ghFail(res, 502, 'github_error', 'GitHub answered ' + t.status + '.');
      const j = await t.json().catch(() => null);
      const files = [];
      for (const n of (j && j.tree) || []) {
        if (!n || n.type !== 'blob') continue;
        files.push({ path: String(n.path || '').slice(0, 400), size: Number(n.size) || 0 });
        if (files.length >= 5000) break;
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ owner, repo, ref, truncated: !!(j && j.truncated), files }));
    } catch (e) {
      return ghFail(res, 502, 'github_unreachable', 'Could not reach GitHub. Try again.');
    }
    return;
  }

if (url.pathname === '/api/github/file' && req.method === 'GET') {
    const got = await ghGate(req, res, 'file', 2000); if (!got) return;
    const owner = String(url.searchParams.get('owner') || '');
    const repo = String(url.searchParams.get('repo') || '');
    const ref = String(url.searchParams.get('ref') || '');
    const filePath = String(url.searchParams.get('path') || '');
    if (!GH_NAME.test(owner) || !GH_NAME.test(repo) || ref === '' || !GH_PATH.test(filePath)) {
      return ghFail(res, 400, 'github_bad_path', 'That is not a repo path.');
    }
    let r;
    try {
      r = await ghApi(
        '/repos/' + owner + '/' + repo + '/contents/' +
          filePath.split('/').map(encodeURIComponent).join('/') +
          '?ref=' + encodeURIComponent(ref),
        got.token,
        'application/vnd.github.raw'
      );
    } catch (e) { return ghFail(res, 502, 'github_unreachable', 'Could not reach GitHub. Try again.'); }
    if (r.status === 401) return ghFail(res, 401, 'github_reconnect');
    if (r.status === 403) return ghFail(res, 409, 'github_scope', 'Cudic cannot read that file — reconnect GitHub and allow access.');
    if (r.status === 404) return ghFail(res, 404, 'github_not_found', 'No file ' + filePath + ' on ' + ref + '.');
    if (!r.ok) return ghFail(res, 502, 'github_error', 'GitHub answered ' + r.status + '.');
    let buf;
    try { buf = Buffer.from(await r.arrayBuffer()); }
    catch (e) { return ghFail(res, 502, 'github_error', 'Could not download that file.'); }
    if (buf.length > 8 * 1024 * 1024) return ghFail(res, 413, 'github_too_big', 'That file is over 8MB.');
    res.writeHead(200, {
      'Content-Type': 'application/octet-stream',
      'Content-Length': String(buf.length),
      'Cache-Control': 'no-store',
    });
    res.end(buf);
    return;
  }

  // ── API: GitHub webhook — auto-post commits to the changelog ──
  if (url.pathname === '/api/webhooks/github' && req.method === 'POST') {
    cors(res);
    const secret = process.env.GITHUB_WEBHOOK_SECRET;
    let raw = '';
    try {
      raw = await new Promise((resolve, reject) => {
        const chunks = []; let size = 0;
        req.on('data', c => { chunks.push(c); size += c.length; if (size > 2 * 1024 * 1024) reject(new Error('too_large')); });
        req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
        req.on('error', reject);
      });
    } catch (e) { res.writeHead(413, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'Payload too large.' })); return; }
    if (secret) {
      const sig = req.headers['x-hub-signature-256'];
      if (!sig) { res.writeHead(401, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'Missing signature.' })); return; }
      const hmac = crypto.createHmac('sha256', secret).update(raw).digest('hex');
      const expected = 'sha256=' + hmac;
      let ok = false;
      try { ok = crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected)); } catch (e) { ok = false; }
      if (!ok) { res.writeHead(401, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'Bad signature.' })); return; }
    } else {
      res.writeHead(503, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Webhook secret not configured (set GITHUB_WEBHOOK_SECRET).' }));
      return;
    }
    if (req.headers['x-github-event'] === 'ping') { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ ok: true, pong: true })); return; }
    if (req.headers['x-github-event'] !== 'push') { res.writeHead(204); res.end(); return; }
    let payload; try { payload = JSON.parse(raw); } catch (e) { res.writeHead(400, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'Invalid JSON.' })); return; }
    const commits = Array.isArray(payload.commits) ? payload.commits : [];
    let inserted = 0;
    for (const c of commits) {
      const subject = String(c.message || '').split('\n')[0].slice(0, 140);
      if (!subject) continue;
      let kind = 'change';
      const m = subject.match(/^(\w+)(\(.+\))?!?:/);
      const prefix = m ? m[1].toLowerCase() : '';
      if (prefix === 'feat' || prefix === 'feature' || prefix === 'add') kind = 'feature';
      else if (prefix === 'fix') kind = 'fix';
      else if (prefix === 'perf' || prefix === 'improve') kind = 'improvement';
      const body = String(c.message || '').split('\n').slice(1).join('\n').trim().slice(0, 2000);
      const authorName = String((c.author && c.author.name) || 'unknown').slice(0, 80);
      const { error } = await supabase.from('changelog').insert({ kind, title: subject, body, author_name: authorName, commit_sha: c.id, created_at: c.timestamp || new Date().toISOString(), author_id: null });
      if (!error) inserted++;
    }
    // ── Deploy a release ────────────────────────────────────────
    // The point of the mapping: a push to the repository a project publishes
    // from becomes the next release. Guarded three ways, because a webhook is
    // unauthenticated apart from its signature — only the publish branch, only
    // while the game is published, and only for a push by the GitHub login
    // that pushed from that project. Anyone else's commit is just a changelog
    // line, which is also why a fork or a PR cannot ship under your name.
    let deployed = null;
    const repoFull = String((payload.repository && payload.repository.full_name) || '');
    const pushedRef = String(payload.ref || '');
    if (repoFull !== '' && pushedRef.indexOf('refs/heads/') === 0 && commits.length > 0) {
      const pushedBranch = pushedRef.slice('refs/heads/'.length);
      const pusher = String(
        (payload.sender && payload.sender.login) || (payload.pusher && payload.pusher.name) || ''
      );
      const { data: mappedRows, error: mapError } = await supabase.from('games')
        .select('id, owner_id, published, github_branch, github_login')
        .ilike('github_repo', repoFull).limit(1);
      const game = !mapError && mappedRows && mappedRows[0];
      if (game) {
        const wantBranch = String(game.github_branch || (payload.repository && payload.repository.default_branch) || 'main');
        const ownerLogin = String(game.github_login || '').toLowerCase();
        if (!game.published) deployed = { skipped: 'not-published' };
        else if (pushedBranch !== wantBranch) deployed = { skipped: 'other-branch' };
        else if (ownerLogin !== '' && pusher !== '' && ownerLogin !== pusher.toLowerCase()) deployed = { skipped: 'not-the-owner' };
        else {
          const ownerToken = await ghToken({ id: game.owner_id });
          if (ownerToken.error) deployed = { skipped: ownerToken.error };
          else {
            const files = await repoTreeFiles(repoFull, String(payload.after || ''), ownerToken.token);
            if (files == null) deployed = { skipped: 'no-readable-files' };
            else {
              const headCommit = commits[commits.length - 1] || {};
              const notes = String(headCommit.message || '').split('\n')[0].slice(0, 200);
              const rel = await createRelease(
                game.id, game.owner_id, files, notes, 'github', String(payload.after || '').slice(0, 7)
              );
              deployed = rel ? { game: game.id, version: rel.version } : { skipped: 'release-failed' };
            }
          }
        }
      }
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, inserted, ref: payload.ref || '', deployed }));
    return;
  }
  }

  return { handle, matches };
};

function matches(pathname) {
  return pathname.startsWith('/api/github/') || pathname.startsWith('/api/git/') || pathname === '/api/webhooks/github';
}
