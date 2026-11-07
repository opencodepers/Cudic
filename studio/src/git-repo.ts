// Binds the real Git engine (git-core.ts) to a Studio project.
//
// One repository per project key, stored in IndexedDB by lightning-fs, so the
// history survives a reload and a project rename — the repository is found by
// the project's id (or 'draft'), never by its title. When a project knows which
// GitHub repo it came from, the panel sets `origin` from that and initialises
// the repository the first time it is opened; a project with no repo and no
// source shows an explicit "Initialise repository" button instead of guessing.
// lightning-fs is CommonJS: the constructor is the default export (some
// bundlers expose it as `FS`). Resolving it explicitly is what makes
// "Initialise repository" actually run instead of throwing a constructor error.
import * as lightning from '@isomorphic-git/lightning-fs';
import {
  apiBase,
  collectBinaryFiles,
  collectTextFiles,
  getToken,
  projectKey,
  replaceWorkspace,
  type FileMap
} from './project';
import {
  createRepo,
  originUrlOf,
  walkFiles,
  type Author,
  type CommitInfo,
  type RemoteInfo,
  type RepoSummary
} from './git-core';

const FS_NAME = 'cudic-git';
const REPOS = '/repos';

export interface RepoSource {
  owner: string;
  repo: string;
  ref?: string;
  subdir?: string;
}

export interface RepoView extends RepoSummary {
  source: RepoSource | null;
  /** branch names, for the branch menu */
  branches: string[];
}

let diskCache: any = null;
function disk(): any {
  if (diskCache == null) {
    const mod = lightning as unknown as { default?: unknown; FS?: unknown };
    const Ctor = (mod.default ?? mod.FS ?? lightning) as new (name: string) => unknown;
    if (typeof Ctor !== 'function') {
      throw new Error('the browser filesystem failed to load (lightning-fs)');
    }
    diskCache = new Ctor(FS_NAME);
  }
  return diskCache;
}

function sourceKey(key: string): string {
  return 'cudic_git_source:' + key;
}

/** Remember which repo this project came from, so origin is set on init. */
export function rememberSource(src: RepoSource): void {
  try {
    localStorage.setItem(sourceKey(projectKey()), JSON.stringify(src));
  } catch {
    /* private mode — the repo still works, it just has no origin */
  }
}

export function storedSource(): RepoSource | null {
  try {
    const raw = localStorage.getItem(sourceKey(projectKey()));
    if (raw == null) return null;
    const j = JSON.parse(raw) as Partial<RepoSource>;
    if (typeof j.owner !== 'string' || typeof j.repo !== 'string') return null;
    return { owner: j.owner, repo: j.repo, ref: j.ref, subdir: j.subdir };
  } catch {
    return null;
  }
}

function sourceUrl(src: RepoSource): string {
  return 'https://github.com/' + src.owner + '/' + src.repo + '.git';
}

async function cloneTree(from: string, to: string): Promise<void> {
  for (const rel of await walkFiles(disk(), from)) {
    const dest = to + '/' + rel;
    const slash = dest.lastIndexOf('/');
    try {
      await disk().promises.stat(dest.slice(0, slash));
    } catch {
      let cur = '';
      for (const part of dest.slice(0, slash).split('/').filter((p) => p !== '')) {
        cur += '/' + part;
        try {
          await disk().promises.mkdir(cur);
        } catch {
          /* exists */
        }
      }
    }
    await disk().promises.writeFile(dest, await disk().promises.readFile(from + '/' + rel));
  }
}

// A first save turns the draft into a project with an id, and the key moves
// with it. Carrying the draft repository across means a rename or a first save
// never looks like "no repository".
async function repoDir(): Promise<string> {
  const key = projectKey();
  const dir = REPOS + '/' + key;
  const has = async (p: string): Promise<boolean> => {
    try {
      await disk().promises.stat(p + '/.git');
      return true;
    } catch {
      return false;
    }
  };
  if (key !== 'draft' && !(await has(dir)) && (await has(REPOS + '/draft'))) {
    await cloneTree(REPOS + '/draft', dir).catch(() => {});
  }
  return dir;
}

async function workspaceFiles(): Promise<FileMap> {
  return { ...(await collectTextFiles()), ...(await collectBinaryFiles()) };
}

function author(): Author {
  let email = '';
  let name = '';
  try {
    const raw = localStorage.getItem('sb-qgcydphkaujomxyzwcht-auth-token');
    const token = raw ? (JSON.parse(raw).access_token as string) : '';
    const payload = token ? JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))) : null;
    email = typeof payload?.email === 'string' ? payload.email : '';
    const meta = payload?.user_metadata ?? {};
    name = String(meta.display_name || meta.full_name || meta.name || '');
  } catch {
    /* signed out — a local identity below */
  }
  return {
    name: name || (email ? email.split('@')[0] : 'Cudic Builder'),
    email: email || 'builder@cudic.local'
  };
}

async function openRepo() {
  const dir = await repoDir();
  return { repo: createRepo(disk(), dir), dir };
}

/**
 * The repository as the panel needs it: initialising one when the project
 * already knows its GitHub source, and reporting `exists: false` otherwise.
 */
export async function repoView(): Promise<RepoView> {
  const { repo } = await openRepo();
  const source = storedSource();
  if (!(await repo.exists())) {
    if (source == null) {
      return { exists: false, branch: null, changes: [], log: [], remotes: [], source: null, branches: [] };
    }
    await repo.init('main');
    await repo.sync(await workspaceFiles());
    await repo.addRemote(sourceUrl(source));
  }
  const summary = await repo.summary();
  return { ...summary, source, branches: await repo.branches() };
}

export async function initRepo(): Promise<RepoView> {
  const { repo } = await openRepo();
  if (!(await repo.exists())) {
    await repo.init('main');
    await repo.sync(await workspaceFiles());
    const source = storedSource();
    if (source != null) await repo.addRemote(sourceUrl(source));
  }
  const summary = await repo.summary();
  return { ...summary, source: storedSource(), branches: await repo.branches() };
}

export async function commitAll(message: string): Promise<CommitInfo> {
  const { repo } = await openRepo();
  if (!(await repo.exists())) await repo.init('main');
  await repo.sync(await workspaceFiles());
  const info = await repo.commit(message, author());
  await repo.summary(); // keep the index consistent with the new HEAD
  return info;
}

/** Point `origin` at a pasted GitHub link (or owner/repo). */
export async function setRemote(link: string): Promise<string> {
  const url = originUrlOf(link);
  if (url == null) throw new Error('That is not a GitHub link or owner/repo.');
  const { repo } = await openRepo();
  if (!(await repo.exists())) await repo.init('main');
  await repo.addRemote(url);
  const m = /^https:\/\/github\.com\/([^/]+)\/([^/]+?)(?:\.git)?$/.exec(url);
  if (m != null) rememberSource({ owner: m[1], repo: m[2] });
  return url;
}

export async function switchBranch(ref: string): Promise<void> {
  const { repo } = await openRepo();
  await repo.checkout(ref);
  await replaceWorkspace(await repo.read());
}

export async function newBranch(ref: string): Promise<void> {
  const name = ref.trim();
  if (name === '') throw new Error('A branch needs a name.');
  const { repo } = await openRepo();
  await repo.createBranch(name);
  await repo.checkout(name);
  await replaceWorkspace(await repo.read());
}

/** origin owner/repo, from the recorded import or from the repo's own remote. */
export async function repoSource(): Promise<{ owner: string; repo: string } | null> {
  const src = storedSource();
  if (src != null) return { owner: src.owner, repo: src.repo };
  const { repo } = await openRepo();
  if (!(await repo.exists())) return null;
  const summary = await repo.summary();
  const origin = summary.remotes.find((r) => r.remote === 'origin');
  if (origin == null) return null;
  const m = /github\.com\/([^/]+)\/([^/]+?)(?:\.git)?$/i.exec(origin.url);
  return m == null ? null : { owner: m[1], repo: m[2] };
}

function toBase64(bytes: Uint8Array): string {
  let out = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    out += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(out);
}

async function authed(path: string, body: unknown): Promise<Response> {
  const tok = getToken();
  if (tok == null) throw new Error('Sign in first — GitHub writes need your session.');
  const base = await apiBase();
  try {
    // No `credentials`: the API answers Access-Control-Allow-Origin: * and a
    // browser refuses a credentialed request against that, which surfaced as a
    // bare "Failed to fetch" while GitHub was never called. Auth is the header.
    return await fetch(base + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + tok },
      body: JSON.stringify(body),
    });
  } catch (e) {
    throw new Error(
      'could not reach the Cudic API at ' + (base || 'this host') +
      ' (' + ((e as Error).message || 'network error') + ')'
    );
  }
}

export interface PushResult {
  sha: string;
  branch: string;
  url: string;
  files: number;
}

export interface CreatedRepo {
  owner: string;
  repo: string;
  url: string;
  private: boolean;
}

/** Create the remote on the connected GitHub account, then point origin at it. */
export async function createGitHubRepo(name: string, isPrivate: boolean): Promise<CreatedRepo> {
  const res = await authed('/api/github/repos', { name, private: isPrivate });
  const d = (await res.json().catch(() => null)) as
    | { repo?: { owner?: string; name?: string; html_url?: string; private?: boolean }; text?: string; error?: string }
    | null;
  const owner = String(d?.repo?.owner || '');
  const repo = String(d?.repo?.name || '');
  if (!res.ok || owner === '' || repo === '') {
    throw new Error(d?.text || d?.error || 'Could not create the repository (' + res.status + ').');
  }
  rememberSource({ owner, repo });
  const { repo: local } = await openRepo();
  if (!(await local.exists())) await local.init('main');
  await local.addRemote('https://github.com/' + owner + '/' + repo + '.git');
  return {
    owner,
    repo,
    url: String(d?.repo?.html_url || 'https://github.com/' + owner + '/' + repo),
    private: d?.repo?.private === true
  };
}

/**
 * Write the working files to GitHub as a real commit on the current branch.
 * The server owns the token (the browser never sees it) and creates blobs, a
 * tree, a commit whose parent is the branch tip, then moves the ref.
 */
export async function pushToGitHub(message: string): Promise<PushResult> {
  const src = await repoSource();
  if (src == null) throw new Error('No GitHub remote — create a repository or set one first.');
  const { repo } = await openRepo();
  if (!(await repo.exists())) throw new Error('Initialise the repository first.');
  const summary = await repo.summary();
  const files = await workspaceFiles();
  const entries = Object.entries(files).map(([path, content]) => ({
    path,
    base64: toBase64(typeof content === 'string' ? new TextEncoder().encode(content) : content)
  }));
  const res = await authed('/api/github/push', {
    owner: src.owner,
    repo: src.repo,
    branch: summary.branch || 'main',
    message: message.trim() === '' ? 'Push from Cudic' : message.trim(),
    files: entries
  });
  const d = (await res.json().catch(() => null)) as
    | { commit?: string; branch?: string; url?: string; files?: number; text?: string; error?: string }
    | null;
  if (!res.ok || typeof d?.commit !== 'string') {
    throw new Error(d?.text || d?.error || 'Push failed (' + res.status + ').');
  }
  try {
    localStorage.setItem('cudic_git_pushed:' + projectKey(), JSON.stringify({
      sha: d.commit, branch: d.branch, at: Date.now()
    }));
  } catch {
    /* private mode — the push already happened */
  }
  return {
    sha: d.commit,
    branch: String(d.branch || summary.branch || 'main'),
    url: String(d.url || ''),
    files: Number(d.files) || entries.length
  };
}

export function lastPush(): { sha: string; branch: string; at: number } | null {
  try {
    const raw = localStorage.getItem('cudic_git_pushed:' + projectKey());
    if (raw == null) return null;
    const j = JSON.parse(raw) as { sha?: string; branch?: string; at?: number };
    if (typeof j.sha !== 'string') return null;
    return { sha: j.sha, branch: String(j.branch || 'main'), at: Number(j.at) || 0 };
  } catch {
    return null;
  }
}

export type { CommitInfo, RemoteInfo };
