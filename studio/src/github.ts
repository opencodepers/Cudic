// Public GitHub repos as Cudic projects — no token, no GitHub API quota.
//
// The listing comes from jsDelivr's package API, not api.github.com. The GitHub
// API allows 60 requests/hour per IP and every visitor to the Render deployment
// shares one egress IP, so an import button built on it runs dry in minutes.
// jsDelivr has no such ceiling, takes a branch name as the version, and is the
// same CDN a published game would load from.
//
// Measured, not assumed (2026-11-07):
//   - codeload.github.com zipball answers
//     `Access-Control-Allow-Origin: https://render.githubusercontent.com`, so a
//     browser zipball download is impossible. Hence file-by-file.
//   - data.jsdelivr.com and cdn.jsdelivr.net both send `Access-Control-Allow-Origin: *`.
//   - jsDelivr refuses repos over 50MB ("Package size exceeded the configured
//     limit"), which is why the errors below tell the user to import a subfolder.
//   - api.github.com is only called when neither `main` nor `master` resolves,
//     i.e. once for an exotic default branch, never on the happy path.
//
// Import is a snapshot: files land in the workspace and the next Save stores
// them as an ordinary Cudic project. Nothing here writes to GitHub.

export interface RepoRef {
  owner: string;
  repo: string;
  ref: string | null; // branch/tag/SHA from a /tree/ link; null = the default branch
  subdir: string; // '' means the repo root
}

export interface ListedFile {
  path: string;
  size: number;
}

export interface RepoImport {
  owner: string;
  repo: string;
  ref: string;
  files: Record<string, string | Uint8Array>;
  imported: number;
  skippedJunk: number;
  skippedOversize: number;
  skippedBudget: number;
  skippedTooMany: number;
  failed: string[];
}

const NAME = /^[A-Za-z0-9._-]+$/;
// https://github.com/o/r(.git)(/(tree|blob)/<ref>(/<subdir>))
const URL_RE =
  /^(?:https?:\/\/)?(?:www\.)?github\.com\/([^/\s]+)\/([^/\s]+?)(?:\.git)?(?:\/(tree|blob)\/([^/\s]+)((?:\/[^/\s]+)*))?$/i;
// o/r(.git)(/(tree|blob)/<ref>(/<subdir>)) — the subdir group spans slashes.
const SHORT_RE = /^([^/\s]+)\/([^/\s]+?)(?:\.git)?(?:\/(tree|blob)\/([^/\s]+)((?:\/[^/\s]+)*))?$/;

/** Accepts a repo link, `owner/repo`, or a /tree/ or /blob/ link into a subfolder. */
export function parseRepoInput(raw: string): RepoRef | null {
  const text = (raw ?? '')
    .trim()
    .replace(/[?#].*$/, '')
    .replace(/\/+$/, '');
  if (text === '') return null;
  const m = URL_RE.exec(text) ?? SHORT_RE.exec(text);
  if (m == null) return null;
  const owner = m[1];
  const repo = m[2];
  if (!NAME.test(owner) || !NAME.test(repo)) return null;
  if (owner === '.' || owner === '..' || repo === '.' || repo === '..') return null;
  let subdir = (m[5] ?? '')
    .split('/')
    .filter((s) => s !== '' && s !== '.' && s !== '..')
    .join('/');
  // A /blob/ link points at one file — import the folder that holds it.
  if (m[3] === 'blob') {
    const cut = subdir.lastIndexOf('/');
    subdir = cut < 0 ? '' : subdir.slice(0, cut);
  }
  return { owner, repo, ref: m[4] ?? null, subdir };
}

// ---- Limits ---------------------------------------------------------------
// Same total budget as Import files (project.ts MAX_IMPORT_BYTES), so a repo
// import can never fail later than a folder import would.
const MAX_FILES = 400;
const MAX_FILE_BYTES = 8 * 1024 * 1024; // jsDelivr serves up to 20MB/file
const MAX_TOTAL_BYTES = 25 * 1024 * 1024;

const SKIP_DIRS = new Set([
  'node_modules', '.git', '.github', '.vscode', '.idea', '.devcontainer',
  '__pycache__', '.agents', 'venv', '.venv', '.next', '.cache'
]);
const SKIP_FILES = new Set([
  'package-lock.json', 'yarn.lock', 'pnpm-lock.yaml', 'bun.lockb',
  'composer.lock', 'Gemfile.lock', 'Cargo.lock'
]);

const TEXT_EXT = new Set([
  'html', 'htm', 'js', 'mjs', 'cjs', 'css', 'json', 'jsx', 'ts', 'tsx',
  'svg', 'md', 'txt', 'xml', 'csv', 'yml', 'yaml', 'map'
]);
const MEDIA_EXT = new Set([
  'png', 'jpg', 'jpeg', 'gif', 'webp', 'avif', 'ico', 'bmp',
  'glb', 'gltf', 'mp3', 'wav', 'ogg', 'oga', 'm4a', 'mp4', 'webm'
]);

interface JsNode {
  type?: string;
  name?: string;
  size?: number;
  files?: JsNode[];
}

function flatten(nodes: JsNode[] | undefined, prefix: string, out: ListedFile[]): void {
  for (const n of nodes ?? []) {
    const name = String(n?.name ?? '');
    if (name === '') continue;
    const p = prefix === '' ? name : prefix + '/' + name;
    if (n.type === 'directory') flatten(n.files, p, out);
    else out.push({ path: p, size: Number(n.size) || 0 });
  }
}

function extOf(path: string): string {
  const base = path.slice(path.lastIndexOf('/') + 1);
  const i = base.lastIndexOf('.');
  return i <= 0 ? '' : base.slice(i + 1).toLowerCase();
}

async function jsdelivrFiles(owner: string, repo: string, ref: string): Promise<ListedFile[]> {
  const url =
    'https://data.jsdelivr.com/v1/packages/gh/' +
    encodeURIComponent(owner) + '/' + encodeURIComponent(repo) +
    '@' + encodeURIComponent(ref);
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { message?: string } | null;
    const msg = body?.message ?? 'jsDelivr answered ' + res.status;
    if (res.status === 403) {
      throw new Error(
        'that repo is too big for the CDN (' + msg + ') — open a subfolder instead, e.g. /tree/' + ref + '/games/my-game'
      );
    }
    throw new Error(msg);
  }
  const j = (await res.json().catch(() => null)) as { files?: JsNode[] } | null;
  const out: ListedFile[] = [];
  flatten(j?.files, '', out);
  if (out.length === 0) throw new Error('that repo has no files at ' + ref);
  return out;
}

export interface RepoListing {
  ref: string;
  files: ListedFile[];
}

export async function listRepo(r: RepoRef): Promise<RepoListing> {
  if (r.ref != null && r.ref.includes('/')) {
    throw new Error('branch names with slashes are not supported — use the default branch');
  }
  const tried: string[] = [];
  for (const ref of r.ref != null ? [r.ref] : ['main', 'master']) {
    try {
      return { ref, files: await jsdelivrFiles(r.owner, r.repo, ref) };
    } catch (e) {
      tried.push(ref + ' — ' + (e as Error).message);
    }
  }
  // Neither main nor master. One API call settles which branch is default.
  if (r.ref == null) {
    let res: Response;
    try {
      res = await fetch(
        'https://api.github.com/repos/' + encodeURIComponent(r.owner) + '/' + encodeURIComponent(r.repo)
      );
    } catch (e) {
      throw new Error('could not reach GitHub: ' + (e as Error).message + ' (' + tried.join(' · ') + ')');
    }
    if (res.status === 404) {
      throw new Error('no public repo at ' + r.owner + '/' + r.repo + ' — check the spelling, or make the repo public');
    }
    if (res.status === 403) {
      throw new Error('GitHub is rate-limiting this network right now — try again in a few minutes');
    }
    if (!res.ok) throw new Error('GitHub answered ' + res.status + ' (' + tried.join(' · ') + ')');
    const j = (await res.json().catch(() => null)) as { default_branch?: string } | null;
    const ref = String(j?.default_branch ?? '');
    if (ref !== '') {
      try {
        return { ref, files: await jsdelivrFiles(r.owner, r.repo, ref) };
      } catch (e) {
        tried.push(ref + ' — ' + (e as Error).message);
      }
    }
  }
  throw new Error(
    'could not read ' + r.owner + '/' + r.repo + ' — ' + tried.join(' · ') +
    '. Private repos need GitHub connected in Profile → Connections.'
  );
}

// ---- Private repos (Connect GitHub) --------------------------------------
// jsDelivr only sees public code, and api.github.com is 60 req/hour per IP —
// one IP shared by every visitor because Render egresses from a single one. So
// the work moves to Cudic's own server, which spends the connected account's
// own quota and never returns the token. Studio only ever sees paths and bytes.

interface CudicError {
  error?: string;
  text?: string;
}

async function cudicJson<T>(path: string): Promise<T> {
  const res = await fetch(path, {
    credentials: 'include',
    cache: 'no-store',
    headers: { Accept: 'application/json' },
  });
  const j = (await res.json().catch(() => null)) as (T & CudicError) | null;
  if (!res.ok) throw new Error((j && (j.text ?? j.error)) ?? 'Cudic answered ' + res.status);
  if (j == null) throw new Error('Cudic answered ' + res.status + ' with no body');
  return j;
}

async function listConnectedRepo(r: RepoRef): Promise<RepoListing> {
  const q = new URLSearchParams({ owner: r.owner, repo: r.repo });
  if (r.ref != null) q.set('ref', r.ref);
  const j = await cudicJson<{ ref?: string; files?: ListedFile[] }>('/api/github/tree?' + q.toString());
  const files = Array.isArray(j.files) ? j.files : [];
  if (files.length === 0) throw new Error('that repo has no files at ' + (j.ref ?? r.ref ?? 'main'));
  return { ref: String(j.ref ?? r.ref ?? 'main'), files };
}

async function fetchConnectedFile(
  owner: string,
  repo: string,
  ref: string,
  path: string
): Promise<Uint8Array> {
  const q = new URLSearchParams({ owner, repo, ref, path });
  const res = await fetch('/api/github/file?' + q.toString(), { credentials: 'include', cache: 'no-store' });
  if (!res.ok) {
    const j = (await res.json().catch(() => null)) as CudicError | null;
    throw new Error(path + ' (' + ((j && (j.text ?? j.error)) || res.status) + ')');
  }
  return new Uint8Array(await res.arrayBuffer());
}

export interface ConnectedRepo {
  full_name: string;
  owner: string;
  name: string;
  private: boolean;
  fork: boolean;
  archived: boolean;
  default_branch: string;
  size_kb: number;
  updated_at: string | null;
  description: string;
}

/**
 * The connected account's repositories, private ones first (the server sorts).
 * This is the only call that reveals repo names, so the picker built on it is
 * also the only affordance for a repo a public import could never reach. Throws
 * with the server's own sentence when GitHub is not connected or the token died,
 * which the caller treats as "fall back to the paste box", never as an error.
 */
async function listConnectedRepos(): Promise<{ login: string; repos: ConnectedRepo[] }> {
  const j = await cudicJson<{ login?: string; repos?: ConnectedRepo[] }>('/api/github/repos');
  const repos = (Array.isArray(j.repos) ? j.repos : []).filter(
    (r): r is ConnectedRepo => typeof r?.full_name === 'string' && r.full_name.indexOf('/') > 0
  );
  return { login: String(j.login ?? ''), repos };
}

export { listConnectedRepos };

function dirname(p: string): string {
  const i = p.lastIndexOf('/');
  return i < 0 ? '' : p.slice(0, i);
}

function rank(path: string): number {
  const base = path.slice(path.lastIndexOf('/') + 1).toLowerCase();
  if (base === 'index.html' || base === 'index.htm') return 0;
  const ext = extOf(path);
  if (TEXT_EXT.has(ext)) return 1;
  if (MEDIA_EXT.has(ext)) return 2;
  return 3;
}

interface Selection {
  picked: ListedFile[];
  skippedJunk: number;
  skippedOversize: number;
  skippedBudget: number;
  skippedTooMany: number;
}

/**
 * Chooses what to import. A repo is not a project: it carries CI config,
 * lockfiles and often several demos. So the folder holding the shallowest
 * `index.html` is preferred, then code, then media — a 2000-file repo still
 * yields a runnable page inside the budget.
 */
export function selectFiles(files: ListedFile[], subdir: string): Selection {
  const prefix = subdir === '' ? '' : subdir + '/';
  const rel: ListedFile[] = [];
  for (const f of files) {
    if (prefix !== '' && !f.path.startsWith(prefix)) continue;
    rel.push({ path: f.path.slice(prefix.length), size: f.size });
  }
  const usable = rel.filter((f) => {
    const parts = f.path.split('/');
    if (parts.some((p) => SKIP_DIRS.has(p))) return false;
    return !SKIP_FILES.has(parts[parts.length - 1]);
  });
  const junk = rel.length - usable.length;
  const entry = usable
    .filter((f) => /^index\.html?$/i.test(f.path.slice(f.path.lastIndexOf('/') + 1)))
    .sort((a, b) => a.path.split('/').length - b.path.split('/').length || a.path.length - b.path.length)[0];
  const baseDir = entry == null ? '' : dirname(entry.path);
  const inBase = (p: string): number => (baseDir === '' || p.startsWith(baseDir + '/') ? 0 : 1);
  const ordered = usable.slice().sort((a, b) => {
    return (
      inBase(a.path) - inBase(b.path) ||
      rank(a.path) - rank(b.path) ||
      a.path.split('/').length - b.path.split('/').length ||
      a.path.localeCompare(b.path)
    );
  });
  const picked: ListedFile[] = [];
  let total = 0;
  let oversize = 0;
  let budget = 0;
  let tooMany = 0;
  for (const f of ordered) {
    if (picked.length >= MAX_FILES) {
      tooMany++;
      continue;
    }
    if (f.size > MAX_FILE_BYTES) {
      oversize++;
      continue;
    }
    if (total + f.size > MAX_TOTAL_BYTES) {
      budget++;
      continue;
    }
    total += f.size;
    picked.push(f);
  }
  return { picked, skippedJunk: junk, skippedOversize: oversize, skippedBudget: budget, skippedTooMany: tooMany };
}

/** Null/control bytes in the first 8k → binary. Mirrors project.ts' import sniff. */
function sniffBinary(buf: Uint8Array): boolean {
  const n = Math.min(buf.length, 8192);
  for (let i = 0; i < n; i++) {
    const b = buf[i];
    if (b === 0 || b < 9 || (b > 13 && b < 32)) return true;
  }
  return false;
}

async function fetchFile(owner: string, repo: string, ref: string, path: string): Promise<Uint8Array> {
  const url =
    'https://cdn.jsdelivr.net/gh/' +
    encodeURIComponent(owner) + '/' + encodeURIComponent(repo) +
    '@' + encodeURIComponent(ref) + '/' +
    path.split('/').map(encodeURIComponent).join('/');
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) throw new Error(path + ' (' + res.status + ')');
  return new Uint8Array(await res.arrayBuffer());
}

async function mapLimit<T>(
  items: T[],
  limit: number,
  work: (item: T) => Promise<void>,
  progress?: (done: number, total: number) => void
): Promise<void> {
  let next = 0;
  let done = 0;
  const worker = async (): Promise<void> => {
    while (next < items.length) {
      const item = items[next++];
      await work(item);
      done++;
      progress?.(done, items.length);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, worker));
}

export async function importRepo(
  input: string,
  progress?: (done: number, total: number) => void
): Promise<RepoImport> {
  const r = parseRepoInput(input);
  if (r == null) throw new Error('that is not a GitHub repo link or owner/repo');
  let listing: RepoListing;
  let connected = false;
  try {
    // Public first: anonymous, CDN-fast, and no authenticated request at all.
    listing = await listRepo(r);
  } catch (publicErr) {
    // Everything jsDelivr cannot serve — private, or over its 50MB cap — goes
    // through the server with the connected account's token.
    try {
      listing = await listConnectedRepo(r);
      connected = true;
    } catch (e) {
      const msg = String((e as Error)?.message ?? '');
      // Not signed in, or GitHub not connected: the public error is the honest one.
      throw new Error(/sign in|connect github|reconnect/i.test(msg) ? String((publicErr as Error)?.message ?? msg) : msg);
    }
  }
  const sel = selectFiles(listing.files, r.subdir);
  if (sel.picked.length === 0) {
    throw new Error('nothing to import from that ' + (r.subdir === '' ? 'repo' : 'folder') + ' (only CI config or lockfiles)');
  }
  const files: Record<string, string | Uint8Array> = {};
  const failed: string[] = [];
  await mapLimit(
    sel.picked,
    6,
    async (f) => {
      try {
        const full = (r.subdir === '' ? '' : r.subdir + '/') + f.path;
        const buf = connected
          ? await fetchConnectedFile(r.owner, r.repo, listing.ref, full)
          : await fetchFile(r.owner, r.repo, listing.ref, full);
        files[f.path] = sniffBinary(buf) ? buf : new TextDecoder().decode(buf);
      } catch (e) {
        failed.push((e as Error).message);
      }
    },
    progress
  );
  const imported = Object.keys(files).length;
  if (imported === 0) {
    throw new Error(
      'every file failed to download' + (failed.length > 0 ? ' (' + failed.slice(0, 3).join(', ') + ')' : '')
    );
  }
  return {
    owner: r.owner,
    repo: r.repo,
    ref: listing.ref,
    files,
    imported,
    skippedJunk: sel.skippedJunk,
    skippedOversize: sel.skippedOversize,
    skippedBudget: sel.skippedBudget,
    skippedTooMany: sel.skippedTooMany,
    failed
  };
}
