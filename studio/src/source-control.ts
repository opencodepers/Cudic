// Source Control: a real Git repository for the open project.
//
// Commits here are actual Git commits — isomorphic-git writes loose objects and
// refs into `.git` in IndexedDB, so every commit has a real SHA-1, history is
// the real object graph, branches are real refs and checking one out really
// moves the files in the workspace. Nothing in this panel is a stand-in for
// version history, and the repository is found by project key, not by project
// title, so renaming a project never loses it.
//
// Mounted the way Collab is (activity-bar tab + a panel over the sidebar):
// this stack ships no WebviewViewPane, so a contributed view cannot render.
import * as vscode from 'vscode';
import {
  registerAction2,
  Action2,
  MenuId
} from '@codingame/monaco-vscode-api/vscode/vs/platform/actions/common/actions';
import { Parts, setPartVisibility } from '@codingame/monaco-vscode-workbench-service-override';
import { getProjectTitle } from './project';
import {
  commitAll,
  createGitHubRepo,
  initRepo,
  lastPush,
  newBranch,
  pushToGitHub,
  repoView,
  setRemote,
  switchBranch,
  type CommitInfo,
  type RepoView
} from './git-repo';
import { mountTab, onOtherTabSelected, setTabActive as setActive } from './activity-bar';

let sr: ShadowRoot | null = null;
let tabIcon: HTMLButtonElement | null = null;
let panel: HTMLElement | null = null;
let view: RepoView | null = null;
let busy = false;

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] || c));
}

function ago(at: number): string {
  if (!isFinite(at) || at <= 0) return '';
  const mins = Math.round((Date.now() - at) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return mins + 'm ago';
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return hrs + 'h ago';
  const days = Math.round(hrs / 24);
  if (days < 30) return days + 'd ago';
  return new Date(at).toLocaleDateString();
}

function q<T extends HTMLElement>(id: string): T | null {
  return (panel?.querySelector('#' + id) as T | null) ?? null;
}

function hint(text: string): void {
  const el = q('scHint');
  if (el) el.textContent = text;
}

// ---- Painting ---------------------------------------------------------------

function remoteText(v: RepoView | null): string {
  if (v == null) return '';
  if (v.source != null) return 'github.com/' + v.source.owner + '/' + v.source.repo;
  const origin = v.remotes.find((r) => r.remote === 'origin') ?? v.remotes[0];
  return origin ? origin.url.replace(/^https?:\/\//, '').replace(/\.git$/, '') : '';
}

function paintHistory(commits: CommitInfo[]): void {
  const el = q('scHistory');
  if (el == null) return;
  if (commits.length === 0) {
    el.innerHTML = '<div class="sc-empty">No commits yet — the first commit starts the history.</div>';
    return;
  }
  el.innerHTML = commits
    .map(
      (c, i) =>
        '<div class="sc-rev" title="' + esc(c.oid) + '">' +
        '<span class="sc-dot' + (i === 0 ? ' head' : '') + '"></span>' +
        '<div class="sc-rev-tx"><div class="sc-rev-label">' + esc(c.message || '(no message)') + '</div>' +
        '<div class="sc-rev-meta"><code>' + esc(c.short) + '</code> · ' + esc(ago(c.at)) + '</div></div></div>'
    )
    .join('');
}

function paint(v: RepoView | null): void {
  if (panel == null) return;
  const branchBtn = q<HTMLButtonElement>('scBranch');
  const remoteEl = q('scRemote');
  const initWrap = q<HTMLElement>('scInitWrap');
  const mainWrap = q<HTMLElement>('scMain');
  const changesEl = q('scChanges');
  const countEl = q('scCount');
  const commitBtn = q<HTMLButtonElement>('scCommit');

  const exists = v?.exists === true;
  if (branchBtn != null) branchBtn.textContent = exists ? '⎇ ' + (v?.branch || 'main') : '⎇ no repository';
  const pushed = exists ? lastPush() : null;
  if (remoteEl != null) {
    remoteEl.textContent = remoteText(v) + (pushed != null ? '  ·  pushed ' + pushed.sha.slice(0, 7) : '');
  }
  if (initWrap != null) initWrap.style.display = exists ? 'none' : 'flex';
  if (mainWrap != null) mainWrap.style.display = exists ? 'flex' : 'none';
  if (!exists) {
    paintHistory([]);
    return;
  }
  const changes = v?.changes ?? [];
  if (countEl != null) {
    countEl.textContent = changes.length === 0 ? '' : String(changes.length);
    countEl.style.display = changes.length === 0 ? 'none' : 'inline-block';
  }
  if (changesEl != null) {
    changesEl.innerHTML =
      changes.length === 0
        ? '<div class="sc-empty">No changes — the working tree matches HEAD.</div>'
        : changes
            .map(
              (c) =>
                '<div class="sc-file" data-path="' + esc(c.path) + '" title="' + esc(c.path) + '">' +
                '<span class="sc-badge ' + (c.status === 'U' ? 'u' : c.status === 'M' ? 'm' : 'd') + '">' + c.status + '</span>' +
                '<span class="sc-path">' + esc(c.path) + '</span></div>'
            )
            .join('');
    changesEl.querySelectorAll('.sc-file').forEach((row) => {
      row.addEventListener('click', () => {
        const path = (row as HTMLElement).dataset.path || '';
        void vscode.commands
          .executeCommand('vscode.open', vscode.Uri.file('/workspace/' + path))
          .then(undefined, () => {});
      });
    });
  }
  if (commitBtn != null) commitBtn.disabled = busy || changes.length === 0;
  const pushBtn = q<HTMLButtonElement>('scPush');
  const hasRemote = remoteText(v) !== '';
  if (pushBtn != null) {
    pushBtn.disabled = busy || !hasRemote;
    pushBtn.title = hasRemote ? 'Write these files to ' + remoteText(v) : 'Set or create a GitHub remote first';
  }
  paintHistory(v?.log ?? []);
}

// ---- Actions ----------------------------------------------------------------

async function load(): Promise<void> {
  if (panel == null) return;
  busy = true;
  paint(view);
  hint('Reading repository…');
  try {
    view = await repoView();
  } catch (e) {
    view = null;
    hint('Could not open the repository: ' + ((e as Error).message || 'unknown error'));
    busy = false;
    paint(null);
    return;
  }
  busy = false;
  paint(view);
  if (view.exists) {
    hint(
      view.changes.length === 0
        ? 'Working tree clean on ' + (view.branch || 'main') + '.'
        : '',
    );
  }
}

async function doInit(): Promise<void> {
  if (busy) return;
  busy = true;
  hint('Initialising local repository…');
  const initBtn = q<HTMLButtonElement>('scInitBtn');
  if (initBtn != null) {
    initBtn.disabled = true;
    initBtn.textContent = 'Initialising…';
  }
  paint(view);
  try {
    view = await initRepo();
    hint('Local repository initialised on ' + (view.branch || 'main') + '. Commit to record the first version, then push it to GitHub.');
  } catch (e) {
    const msg = (e as Error).message || 'unknown error';
    hint('Could not initialise: ' + msg);
    // The panel may be scrolled or narrow; a real error must never be silent.
    void vscode.window.showErrorMessage('Source Control: could not initialise the repository — ' + msg);
  }
  if (initBtn != null) {
    initBtn.disabled = false;
    initBtn.textContent = 'Initialise local repository';
  }
  busy = false;
  paint(view);
}

async function doCommit(): Promise<void> {
  const input = q<HTMLInputElement>('scMsg');
  const commitBtn = q<HTMLButtonElement>('scCommit');
  const typed = (input?.value || '').trim();
  if (typed === '') {
    hint('Write a message first — a commit without one is unreadable later.');
    input?.focus();
    return;
  }
  busy = true;
  if (commitBtn != null) {
    commitBtn.disabled = true;
    commitBtn.textContent = 'Committing…';
  }
  try {
    const info = await commitAll(typed);
    if (input != null) input.value = '';
    hint('Committed ' + info.short + '.');
    view = await repoView();
  } catch (e) {
    hint('Commit failed: ' + ((e as Error).message || 'unknown error'));
  } finally {
    if (commitBtn != null) commitBtn.textContent = 'Commit';
    busy = false;
  }
  paint(view);
}

async function doPush(): Promise<void> {
  const pushBtn = q<HTMLButtonElement>('scPush');
  const typed = (q<HTMLInputElement>('scMsg')?.value || '').trim();
  busy = true;
  if (pushBtn != null) {
    pushBtn.disabled = true;
    pushBtn.textContent = 'Pushing…';
  }
  hint('Writing to GitHub…');
  try {
    const r = await pushToGitHub(typed !== '' ? typed : view?.log[0]?.message || '');
    const short = r.sha.slice(0, 7);
    hint('Pushed ' + r.files + ' file(s) to ' + r.branch + ' as ' + short + '.');
    void vscode.window
      .showInformationMessage('Pushed ' + short + ' to ' + r.branch + '.', 'Open commit')
      .then((pick) => {
        if (pick === 'Open commit' && r.url !== '') window.open(r.url, '_blank');
      });
    view = await repoView();
  } catch (e) {
    const msg = (e as Error).message || 'unknown error';
    hint('Push failed: ' + msg);
    void vscode.window.showErrorMessage('Source Control: push failed — ' + msg);
  }
  if (pushBtn != null) pushBtn.textContent = 'Push to GitHub';
  busy = false;
  paint(view);
}

async function doCreateRepo(): Promise<void> {
  const suggested =
    getProjectTitle()
      .toLowerCase()
      .replace(/[^a-z0-9._-]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'cudic-project';
  const name = await vscode.window.showInputBox({
    prompt: 'New GitHub repository on your account',
    placeHolder: 'my-game',
    value: suggested,
    validateInput: (v) =>
      /^[A-Za-z0-9._-]{1,100}$/.test(v.trim()) ? null : 'Letters, digits, dot, dash or underscore.'
  });
  if (name == null || name.trim() === '') return;
  const vis = await vscode.window.showQuickPick(
    [
      { label: 'Private', description: 'Only you and people you add', private: true },
      { label: 'Public', description: 'Anyone can see it', private: false }
    ],
    { title: 'Repository visibility' }
  );
  if (vis == null) return;
  hint('Creating ' + name.trim() + '…');
  try {
    const created = await createGitHubRepo(name.trim(), vis.private);
    // A repository created with auto_init:false has no commits, and GitHub's
    // "Quick setup" page reads like a failure. Push the first commit straight
    // away so the new repo already holds the project.
    let first = '';
    let why = '';
    try {
      const pushed = await pushToGitHub('Initial commit from Cudic');
      first = pushed.sha.slice(0, 7);
    } catch (e) {
      why = (e as Error).message || 'unknown error';
    }
    hint(
      'Created github.com/' + created.owner + '/' + created.repo +
      (first !== ''
        ? ' · first push ' + first
        : why !== ''
          ? ' · first push failed: ' + why
          : ' — push to fill it.')
    );
    void vscode.window
      .showInformationMessage(
        'Created ' + created.owner + '/' + created.repo +
        (first !== '' ? ' and pushed the first commit (' + first + ').' : '. Push to fill it.'),
        'Open on GitHub'
      )
      .then((pick) => {
        if (pick === 'Open on GitHub') window.open(created.url, '_blank');
      });
    view = await repoView();
  } catch (e) {
    const msg = (e as Error).message || 'unknown error';
    hint('Could not create the repository: ' + msg);
    void vscode.window.showErrorMessage('Source Control: ' + msg);
  }
  paint(view);
}

async function doSetRemote(): Promise<void> {
  const link = await vscode.window.showInputBox({
    prompt: 'GitHub repository for this project',
    placeHolder: 'https://github.com/owner/repo  —  owner/repo',
    value: remoteText(view)
  });
  if (link == null || link.trim() === '') return;
  try {
    const url = await setRemote(link);
    hint('origin → ' + url.replace(/^https?:\/\//, ''));
    view = await repoView();
  } catch (e) {
    hint((e as Error).message || 'Could not set the remote.');
  }
  paint(view);
}

async function doBranchMenu(): Promise<void> {
  if (view == null || !view.exists) return;
  const current = view.branch || 'main';
  const NEW = '$(add) New branch…';
  const items = [
    ...view.branches.map((b) => ({
      label: (b === current ? '$(check) ' : '') + b,
      description: b === current ? 'current' : '',
      branch: b
    })),
    { label: NEW, description: '', branch: '' }
  ];
  const pick = await vscode.window.showQuickPick(items, {
    title: 'Switch branch',
    placeHolder: 'Checking out a branch replaces the workspace files with that commit'
  });
  if (pick == null) return;
  if (pick.branch === '') {
    const name = await vscode.window.showInputBox({
      prompt: 'New branch name',
      placeHolder: 'e.g. powerups'
    });
    if (name == null || name.trim() === '') return;
    try {
      await newBranch(name);
      view = await repoView();
      hint('On new branch ' + name.trim() + '.');
    } catch (e) {
      hint('Could not create the branch: ' + ((e as Error).message || 'unknown error'));
    }
    paint(view);
    return;
  }
  if (pick.branch === current) return;
  try {
    await switchBranch(pick.branch);
    view = await repoView();
    hint('Checked out ' + pick.branch + ' — workspace files now match that commit.');
  } catch (e) {
    hint('Checkout failed: ' + ((e as Error).message || 'unknown error'));
  }
  paint(view);
}

// ---- Mounting ---------------------------------------------------------------

function buildPanel(): boolean {
  if (sr == null) return false;
  if (panel != null) return true;
  const side = sr.querySelector('.part.sidebar') as HTMLElement | null;
  if (side == null) return false;
  if (getComputedStyle(side).position === 'static') side.style.position = 'relative';

  const MONO = '"Geist Mono",ui-monospace,monospace';
  panel = document.createElement('div');
  panel.id = 'cudic-source-control';
  panel.style.cssText =
    'position:absolute;inset:0;display:none;flex-direction:column;overflow:hidden;z-index:100;' +
    '--bg:#0d0e10;--panel:#14161b;--line:#262a33;--ink:#f7f5ec;--mute:#9a9a94;--lime:#b8f23a;' +
    'font:400 13px/1.5 "Geist",system-ui,sans-serif;color:var(--ink);background:var(--panel);';
  panel.innerHTML =
    '<style>' +
    '#cudic-source-control .sc-head{display:flex;align-items:center;gap:6px;padding:10px 12px;border-bottom:1px solid var(--line)}' +
    '#cudic-source-control .sc-sec{display:flex;align-items:center;gap:8px;padding:8px 12px;border-bottom:1px solid var(--line);' +
    'font-family:' + MONO + ';font-size:10px;text-transform:uppercase;letter-spacing:.08em;color:var(--mute)}' +
    '#cudic-source-control .sc-count{font-family:' + MONO + ';font-size:10px;color:#0d0e10;background:var(--lime);padding:0 6px;' +
    'line-height:16px;display:none}' +
    '#cudic-source-control .sc-body{flex:1;overflow-y:auto;display:flex;flex-direction:column}' +
    '#cudic-source-control .sc-file{display:flex;align-items:center;gap:8px;padding:5px 12px;cursor:pointer}' +
    '#cudic-source-control .sc-file:hover{background:rgba(247,245,236,.05)}' +
    '#cudic-source-control .sc-badge{font-family:' + MONO + ';font-size:10px;font-weight:600;width:14px;text-align:center;flex:none}' +
    '#cudic-source-control .sc-badge.u{color:#73c991}#cudic-source-control .sc-badge.m{color:#e2c08d}' +
    '#cudic-source-control .sc-badge.d{color:#f48771}' +
    '#cudic-source-control .sc-path{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12px}' +
    '#cudic-source-control .sc-empty{padding:8px 12px;font-size:12px;color:var(--mute);line-height:1.5}' +
    '#cudic-source-control .sc-commit{padding:10px 12px;border-bottom:1px solid var(--line)}' +
    '#cudic-source-control #scMsg{width:100%;box-sizing:border-box;background:var(--bg);color:var(--ink);border:1px solid var(--line);' +
    'font:inherit;font-size:12px;padding:7px 9px;outline:none}' +
    '#cudic-source-control #scMsg:focus{border-color:var(--lime)}' +
    '#cudic-source-control #scCommit{margin-top:8px;width:100%;padding:7px 10px;background:var(--lime);color:#0d0e10;border:1px solid var(--lime);' +
    'font-family:' + MONO + ';font-size:11px;font-weight:500;text-transform:uppercase;letter-spacing:.06em;cursor:pointer}' +
    '#cudic-source-control #scCommit:hover:not(:disabled){background:var(--ink);border-color:var(--ink)}' +
    '#cudic-source-control #scCommit:disabled{opacity:.45;cursor:default}' +
    '#cudic-source-control .sc-hint{padding:8px 12px;font-size:11px;color:var(--mute);border-bottom:1px solid var(--line);min-height:16px}' +
    '#cudic-source-control .sc-rev{display:flex;gap:8px;padding:7px 12px;position:relative}' +
    '#cudic-source-control .sc-rev:before{content:"";position:absolute;left:17px;top:0;bottom:0;width:1px;background:var(--line)}' +
    '#cudic-source-control .sc-dot{width:7px;height:7px;border-radius:50%;background:var(--panel);border:1px solid var(--mute);' +
    'margin-top:6px;flex:none;position:relative;z-index:1}' +
    '#cudic-source-control .sc-dot.head{background:var(--lime);border-color:var(--lime)}' +
    '#cudic-source-control .sc-rev-tx{min-width:0}' +
    '#cudic-source-control .sc-rev-label{font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}' +
    '#cudic-source-control .sc-rev-meta{font-family:' + MONO + ';font-size:10px;color:var(--mute)}' +
    '#cudic-source-control .sc-rev-meta code{color:var(--mute)}' +
    '#cudic-source-control .sc-init{padding:14px 12px;display:none;flex-direction:column;gap:10px}' +
    '#cudic-source-control .sc-init p{margin:0;font-size:12px;color:var(--mute);line-height:1.55}' +
    '#cudic-source-control #scInitBtn,#cudic-source-control #scSetRemote{font-family:' + MONO + ';font-size:11px;' +
    'text-transform:uppercase;letter-spacing:.06em;cursor:pointer;padding:6px 10px}' +
    '#cudic-source-control #scInitBtn{background:var(--lime);color:#0d0e10;border:1px solid var(--lime)}' +
    '#cudic-source-control #scInitBtn:hover{background:var(--ink);border-color:var(--ink)}' +
    '#cudic-source-control #scSetRemote{background:transparent;color:var(--ink);border:1px solid var(--line)}' +
    '#cudic-source-control #scSetRemote:hover{border-color:var(--ink)}' +
    '#cudic-source-control #scBranch{background:transparent;border:1px solid var(--line);color:var(--ink);cursor:pointer;' +
    'font-family:' + MONO + ';font-size:11px;padding:2px 8px;max-width:46%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}' +
    '#cudic-source-control #scBranch:hover{border-color:var(--ink)}' +
    '#cudic-source-control #scPush{margin-top:6px;width:100%;padding:7px 10px;background:transparent;color:var(--ink);' +
    'border:1px solid var(--ink);font-family:' + MONO + ';font-size:11px;text-transform:uppercase;letter-spacing:.06em;cursor:pointer}' +
    '#cudic-source-control #scPush:hover:not(:disabled){background:var(--ink);color:var(--bg)}' +
    '#cudic-source-control #scPush:disabled{opacity:.4;cursor:default}' +
    '#cudic-source-control #scCreateRepo{background:transparent;color:var(--ink);border:1px solid var(--line);' +
    'font-family:' + MONO + ';font-size:11px;text-transform:uppercase;letter-spacing:.06em;cursor:pointer;padding:6px 10px}' +
    '#cudic-source-control #scCreateRepo:hover{border-color:var(--ink)}' +
    '#cudic-source-control .sc-icon{background:transparent;border:none;color:inherit;opacity:.7;cursor:pointer;font-size:14px}' +
    '</style>' +
    '<div class="sc-head">' +
    '<b style="font-weight:500;letter-spacing:-.02em;font-size:14px">Source Control</b>' +
    '<span style="flex:1"></span>' +
    '<button id="scBranch" title="Switch branch">⎇ —</button>' +
    '<button id="scRefresh" class="sc-icon" title="Refresh">⟳</button>' +
    '<button id="scHide" class="sc-icon" title="Hide" style="font-size:15px">×</button>' +
    '</div>' +
    '<div class="sc-hint" id="scRemote" style="font-family:' + MONO + ';font-size:10px" title="origin"></div>' +
    // Outside #scMain on purpose: an initialise failure used to be reported
    // into a hidden element, which is why the button looked like it did nothing.
    '<div class="sc-hint" id="scHint"></div>' +
    '<div class="sc-init" id="scInitWrap">' +
    '<p><strong style="color:var(--ink)">No local repository yet.</strong><br/>' +
    'Initialising creates a Git repository inside this browser — real commits, history and branches, keyed to the project so a rename keeps it. It never touches GitHub; that is the last button.</p>' +
    '<button id="scInitBtn">Initialise local repository</button>' +
    '<button id="scSetRemote">Set GitHub remote…</button>' +
    '<button id="scCreateRepo">Create GitHub repository…</button>' +
    '</div>' +
    '<div id="scMain" style="display:none;flex-direction:column;flex:1;min-height:0">' +
    '<div class="sc-commit">' +
    '<input id="scMsg" placeholder="Commit message" maxlength="120"/>' +
    '<button id="scCommit" disabled>Commit</button>' +
    '<button id="scPush" disabled>Push to GitHub</button>' +
    '</div>' +
    '<div class="sc-body">' +
    '<div class="sc-sec">Changes <span class="sc-count" id="scCount"></span><span style="flex:1"></span>' +
    '<button id="scSetRemote2" class="sc-icon" title="Set GitHub remote" style="font-size:11px">remote</button></div>' +
    '<div id="scChanges"></div>' +
    '<div class="sc-sec" style="border-top:1px solid var(--line)">History</div>' +
    '<div id="scHistory"></div>' +
    '</div>' +
    '</div>';

  side.appendChild(panel);
  (panel.querySelector('#scCommit') as HTMLButtonElement).addEventListener('click', () => void doCommit());
  (panel.querySelector('#scMsg') as HTMLInputElement).addEventListener('keydown', (e) => {
    if ((e as KeyboardEvent).key === 'Enter') {
      e.preventDefault();
      void doCommit();
    }
  });
  (panel.querySelector('#scInitBtn') as HTMLButtonElement).addEventListener('click', () => void doInit());
  (panel.querySelector('#scPush') as HTMLButtonElement).addEventListener('click', () => void doPush());
  (panel.querySelector('#scCreateRepo') as HTMLButtonElement).addEventListener('click', () => void doCreateRepo());
  (panel.querySelector('#scRefresh') as HTMLButtonElement).addEventListener('click', () => void load());
  (panel.querySelector('#scHide') as HTMLButtonElement).addEventListener('click', hidePanel);
  (panel.querySelector('#scBranch') as HTMLButtonElement).addEventListener('click', () => void doBranchMenu());
  const setRemoteBtn = panel.querySelector('#scSetRemote');
  if (setRemoteBtn) setRemoteBtn.addEventListener('click', () => void doSetRemote());
  const setRemoteBtn2 = panel.querySelector('#scSetRemote2');
  if (setRemoteBtn2) setRemoteBtn2.addEventListener('click', () => void doSetRemote());
  return true;
}

function setTabActive(on: boolean): void {
  setActive(tabIcon, on);
}

const BRANCH_SVG =
  '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true">' +
  '<circle cx="7" cy="5" r="2.4"/><circle cx="7" cy="19" r="2.4"/><circle cx="17" cy="9" r="2.4"/>' +
  '<path d="M7 7.4v9.2"/><path d="M17 11.4c0 3.2-3.4 3.6-6.2 4.2"/></svg>';

function buildTabIcon(): boolean {
  if (tabIcon != null || sr == null) return true;
  const act = sr.querySelector('.part.activitybar') as HTMLElement | null;
  if (act == null) return false;
  tabIcon = mountTab(sr, act, {
    id: 'cudic-source-control-tab',
    title: 'Source Control',
    svg: BRANCH_SVG,
    onClick: () => {
      if (panel != null && panel.style.display !== 'none') {
        hidePanel();
        return;
      }
      void openPanel();
    }
  });
  return tabIcon != null;
}

function hidePanel(): void {
  if (panel == null) return;
  panel.style.display = 'none';
  setTabActive(false);
}

async function openPanel(): Promise<void> {
  if (!buildPanel()) return;
  if (panel == null) return;
  panel.style.display = 'flex';
  setTabActive(true);
  try {
    void setPartVisibility(Parts.SIDEBAR_PART, true);
  } catch {
    /* layout service unreadable — the panel is already mounted */
  }
  await load();
}

export function registerSourceControl(shadowRoot: ShadowRoot): void {
  sr = shadowRoot;
  // Step aside when another activity-bar tab is picked, same as Collab.
  onOtherTabSelected(hidePanel);
  const mount = (): boolean => buildTabIcon() && buildPanel();
  if (!mount()) {
    const timer = setInterval(() => {
      if (mount()) clearInterval(timer);
    }, 500);
    setTimeout(() => clearInterval(timer), 10000);
  }

  registerAction2(
    class extends Action2 {
      constructor() {
        super({
          id: 'cudic.sourceControl',
          title: { value: 'Cudic: Source control', original: 'Cudic: Source control' },
          menu: [{ id: MenuId.CommandPalette }]
        });
      }
      async run(): Promise<void> {
        await openPanel();
      }
    }
  );
}
