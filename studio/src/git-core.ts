/* file: studio/src/git-core.ts
 * what: isomorphic-git plumbing shared by the git panel: Change, CommitInfo,
 *   RepoSummary, author defaults — the shapes, not the UI.
 * invariants: browser git only (no terminal, no backend exec); everything here
 *   runs against lightning-fs, so paths are project-relative.
 * see: AGENTS.md 8 "Runtimes" */

// Real Git, in the browser, with no server and no network.
//
// isomorphic-git writes actual loose objects and refs into `.git`, so a commit
// gets a real SHA-1 and real parents, a branch really moves the working tree,
// and `log` reads what `commit` wrote. There is no imitation layer here: the
// only thing Cudic supplies is a filesystem (IndexedDB via lightning-fs in
// Studio, memfs in tests).
//
// Deliberately knows nothing about Studio, projects or the DOM — the engine can
// be exercised on its own (see tests/test_git_core.py, which bundles this file
// and drives it with memfs), and `git-repo.ts` is the layer that binds it to a
// project.
import git from 'isomorphic-git';

// isomorphic-git wants the Node `fs.promises` shape; both lightning-fs and
// memfs provide it. Typing it loosely keeps one engine usable by both.
export type AnyFs = any;

export interface Change {
  path: string;
  status: 'U' | 'M' | 'D';
}

export interface CommitInfo {
  oid: string;
  short: string;
  message: string;
  /** Commit time in milliseconds. */
  at: number;
  parents: number;
  author: string;
}

export interface RemoteInfo {
  remote: string;
  url: string;
}

export interface RepoSummary {
  exists: boolean;
  branch: string | null;
  changes: Change[];
  log: CommitInfo[];
  remotes: RemoteInfo[];
}

export interface Author {
  name: string;
  email: string;
}

/** Null/control bytes in the first 8k mean binary — same sniff as the importer. */
function looksText(bytes: Uint8Array): boolean {
  const n = Math.min(bytes.length, 8192);
  for (let i = 0; i < n; i++) {
    const b = bytes[i];
    if (b === 0 || b < 9 || (b > 13 && b < 32)) return false;
  }
  return true;
}

const GIT_DIR = '/.git';

async function exists(fs: AnyFs, path: string): Promise<boolean> {
  try {
    await fs.promises.stat(path);
    return true;
  } catch {
    return false;
  }
}

async function isDir(fs: AnyFs, path: string): Promise<boolean> {
  try {
    const st = await fs.promises.stat(path);
    return typeof st.isDirectory === 'function' ? st.isDirectory() : false;
  } catch {
    return false;
  }
}

async function mkdirp(fs: AnyFs, path: string): Promise<void> {
  const parts = path.split('/').filter((p) => p !== '');
  let cur = path.startsWith('/') ? '' : '.';
  for (const part of parts) {
    cur = cur === '' ? '/' + part : cur + '/' + part;
    if (!(await exists(fs, cur))) {
      await fs.promises.mkdir(cur);
    }
  }
}

/** Every file under `dir`, relative, skipping `.git`. */
export async function walkFiles(
  fs: AnyFs,
  dir: string,
  prefix = ''
): Promise<string[]> {
  let names: string[];
  try {
    names = await fs.promises.readdir(prefix === '' ? dir : dir + '/' + prefix);
  } catch {
    return [];
  }
  const out: string[] = [];
  for (const name of names) {
    if (name === '.git') continue;
    const rel = prefix === '' ? name : prefix + '/' + name;
    if (await isDir(fs, dir + '/' + rel)) out.push(...(await walkFiles(fs, dir, rel)));
    else out.push(rel);
  }
  return out;
}

export interface Repo {
  dir: string;
  exists(): Promise<boolean>;
  /** Make the working tree exactly `files` — added, changed and removed. */
  sync(files: Record<string, string | Uint8Array>): Promise<void>;
  /** Every file in the working tree, binary as bytes. */
  read(): Promise<Record<string, string | Uint8Array>>;
  init(defaultBranch?: string): Promise<void>;
  summary(): Promise<RepoSummary>;
  commit(message: string, author: Author): Promise<CommitInfo>;
  branches(): Promise<string[]>;
  checkout(ref: string): Promise<void>;
  createBranch(ref: string): Promise<void>;
  addRemote(url: string, name?: string): Promise<void>;
}

export function createRepo(fs: AnyFs, dir: string): Repo {
  const repo: Repo = {
    dir,

    async exists() {
      return exists(fs, dir + GIT_DIR);
    },

    async sync(files) {
      await mkdirp(fs, dir);
      const want = new Set(Object.keys(files));
      // Deleting first keeps a rename from leaving the old path tracked.
      for (const rel of await walkFiles(fs, dir)) {
        if (!want.has(rel)) {
          try {
            await fs.promises.unlink(dir + '/' + rel);
          } catch {
            /* already gone */
          }
        }
      }
      for (const [rel, content] of Object.entries(files)) {
        const path = dir + '/' + rel;
        const slash = path.lastIndexOf('/');
        if (slash > 0) await mkdirp(fs, path.slice(0, slash));
        await fs.promises.writeFile(path, content);
      }
    },

    async read() {
      const out: Record<string, string | Uint8Array> = {};
      for (const rel of await walkFiles(fs, dir)) {
        try {
          const buf = await fs.promises.readFile(dir + '/' + rel);
          if (typeof buf === 'string') {
            out[rel] = buf;
            continue;
          }
          // A filesystem hands back bytes even for text. A checkout has to put
          // `index.html` back as editable text, not as a binary blob.
          const bytes = new Uint8Array(buf);
          out[rel] = looksText(bytes) ? new TextDecoder().decode(bytes) : bytes;
        } catch {
          /* vanished between walk and read */
        }
      }
      return out;
    },

    async init(defaultBranch = 'main') {
      await mkdirp(fs, dir);
      await git.init({ fs, dir, defaultBranch });
    },

    async summary() {
      if (!(await repo.exists())) {
        return { exists: false, branch: null, changes: [], log: [], remotes: [] };
      }
      let branch: string | null = null;
      try {
        branch = await git.currentBranch({ fs, dir, fullname: false });
      } catch {
        /* unborn branch reads as null */
      }
      if (branch == null) branch = 'main';

      const changes: Change[] = [];
      try {
        const matrix = await git.statusMatrix({ fs, dir });
        for (const [filepath, head, workdir] of matrix) {
          if (head === 1 && workdir === 1) continue; // identical to HEAD
          if (head === 0 && workdir !== 0) changes.push({ path: filepath, status: 'U' });
          else if (head !== 0 && workdir === 0) changes.push({ path: filepath, status: 'D' });
          else if (head !== workdir) changes.push({ path: filepath, status: 'M' });
        }
      } catch {
        /* empty repository: no HEAD to compare against */
        for (const path of await walkFiles(fs, dir)) changes.push({ path, status: 'U' });
      }
      changes.sort((a, b) => a.path.localeCompare(b.path));

      const log: CommitInfo[] = [];
      try {
        const rows = await git.log({ fs, dir, depth: 60 });
        for (const r of rows) {
          log.push({
            oid: r.oid,
            short: r.oid.slice(0, 7),
            message: (r.commit.message || '').split('\n')[0],
            at: (r.commit.committer?.timestamp ?? 0) * 1000,
            parents: (r.commit.parent || []).length,
            author: r.commit.author?.name || ''
          });
        }
      } catch {
        /* no commits yet */
      }

      let remotes: RemoteInfo[] = [];
      try {
        remotes = await git.listRemotes({ fs, dir });
      } catch {
        /* no config yet */
      }
      return { exists: true, branch, changes, log, remotes };
    },

    async commit(message, author) {
      // Stage the working tree as it stands: new and changed files added,
      // deleted ones removed. Then commit — a real object, real SHA.
      const matrix = await git.statusMatrix({ fs, dir });
      for (const [filepath, head, workdir] of matrix) {
        if (head === 1 && workdir === 1) continue;
        if (workdir === 0) await git.remove({ fs, dir, filepath });
        else await git.add({ fs, dir, filepath });
      }
      const oid = await git.commit({ fs, dir, message, author });
      return {
        oid,
        short: oid.slice(0, 7),
        message: message.split('\n')[0],
        at: Date.now(),
        parents: 0,
        author: author.name
      };
    },

    async branches() {
      if (!(await repo.exists())) return [];
      try {
        return await git.listBranches({ fs, dir });
      } catch {
        return [];
      }
    },

    async checkout(ref) {
      await git.checkout({ fs, dir, ref });
    },

    async createBranch(ref) {
      await git.branch({ fs, dir, ref, checkout: false });
    },

    async addRemote(url, name = 'origin') {
      try {
        await git.deleteRemote({ fs, dir, remote: name });
      } catch {
        /* no such remote yet */
      }
      await git.addRemote({ fs, dir, remote: name, url });
    }
  };
  return repo;
}

// A rough GitHub URL parser so a pasted link becomes a remote. Accepts
// `owner/repo`, full https URLs and `.git` suffixes — the same shapes the
// import box takes.
export function originUrlOf(link: string): string | null {
  const text = (link || '')
    .trim()
    .replace(/[?#].*$/, '')
    .replace(/\/+$/, '')
    .replace(/\.git$/i, '');
  if (text === '') return null;
  const m = /^(?:https?:\/\/)?(?:www\.)?github\.com\/([^/\s]+)\/([^/\s]+)/i.exec(text) ?? /^([^/\s]+)\/([^/\s]+)$/.exec(text);
  if (m == null) return null;
  if (!/^[A-Za-z0-9._-]+$/.test(m[1]) || !/^[A-Za-z0-9._-]+$/.test(m[2])) return null;
  return 'https://github.com/' + m[1] + '/' + m[2] + '.git';
}
