// Binds the real Git engine (git-core.ts) to a Studio project.
//
// One repository per project key, stored in IndexedDB by lightning-fs, so the
// history survives a reload and a project rename — the repository is found by
// the project's id (or 'draft'), never by its title. When a project knows which
// GitHub repo it came from, the panel sets `origin` from that and initialises
// the repository the first time it is opened; a project with no repo and no
// source shows an explicit "Initialise repository" button instead of guessing.
import { FS } from '@isomorphic-git/lightning-fs';
import {
  collectBinaryFiles,
  collectTextFiles,
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
  if (diskCache == null) diskCache = new FS(FS_NAME);
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

/** The commit a message box would create, for the panel's "nothing staged" state. */
export function emptyMessage(message: string): boolean {
  return message.trim() === '';
}

export type { CommitInfo, RemoteInfo };
