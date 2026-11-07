// Source Control: the project's change list and commit history, in the
// sidebar. A Cudic project is not a git repository, so "commit" means what the
// revision API means — stage the working files as they are now and record them
// as a labelled revision of the saved project, which Restore can put back.
// The Changes list is a diff against the newest revision, the same comparison
// the Save-snapshot checklist uses, so the two never disagree.
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
import { apiBase, collectTextFiles, getProjectId, getToken, headers } from './project';

interface Revision {
  id: string;
  label: string;
  created_at: string;
}

interface Change {
  path: string;
  status: 'U' | 'M' | 'D';
}

let sr: ShadowRoot | null = null;
let tabIcon: HTMLButtonElement | null = null;
let panel: HTMLElement | null = null;
let inputEl: HTMLInputElement | null = null;
let commitEl: HTMLButtonElement | null = null;
let hintEl: HTMLElement | null = null;
let changesEl: HTMLElement | null = null;
let countEl: HTMLElement | null = null;
let historyEl: HTMLElement | null = null;

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] || c));
}

function hint(text: string): void {
  if (hintEl) hintEl.textContent = text;
}

function ago(iso: string): string {
  const at = new Date(iso).getTime();
  if (!isFinite(at)) return '';
  const mins = Math.round((Date.now() - at) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return mins + 'm ago';
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return hrs + 'h ago';
  const days = Math.round(hrs / 24);
  if (days < 30) return days + 'd ago';
  return new Date(iso).toLocaleDateString();
}

// ---- Reading the account's revisions ---------------------------------------
// Both calls are owner-only and need a signed-in session; any failure means
// "no history to compare against yet", which the panel says in words rather
// than showing an empty screen with no explanation.

async function listRevisions(id: string): Promise<Revision[] | null> {
  const tok = getToken();
  try {
    const res = await fetch(
      (await apiBase()) + '/api/games/' + encodeURIComponent(id) + '/revisions',
      { headers: headers(!!tok) }
    );
    if (!res.ok) return null;
    const d = (await res.json().catch(() => null)) as { revisions?: Revision[] } | null;
    return Array.isArray(d?.revisions) ? d!.revisions! : null;
  } catch {
    return null;
  }
}

async function latestFiles(id: string, revId: string): Promise<Record<string, string> | null> {
  const tok = getToken();
  try {
    const res = await fetch(
      (await apiBase()) + '/api/games/' + encodeURIComponent(id) + '/revisions/' + encodeURIComponent(revId),
      { headers: headers(!!tok) }
    );
    if (!res.ok) return null;
    const d = (await res.json().catch(() => null)) as { revision?: { files?: Record<string, string> } } | null;
    const files = d?.revision?.files;
    return files && typeof files === 'object' && !Array.isArray(files) ? files : null;
  } catch {
    return null;
  }
}

function diff(current: Record<string, string>, base: Record<string, string> | null): Change[] {
  const out: Change[] = [];
  for (const p of Object.keys(current).sort()) {
    if (base == null || !(p in base)) out.push({ path: p, status: 'U' });
    else if (base[p] !== current[p]) out.push({ path: p, status: 'M' });
  }
  if (base != null) {
    for (const p of Object.keys(base).sort()) {
      if (!(p in current)) out.push({ path: p, status: 'D' });
    }
  }
  return out;
}

function openFile(path: string): void {
  void vscode.commands.executeCommand('vscode.open', vscode.Uri.file('/workspace/' + path)).then(
    undefined,
    () => {
      /* the file may have been deleted — nothing to open */
    }
  );
}

// ---- Painting ---------------------------------------------------------------

function paintChanges(changes: Change[]): void {
  if (!changesEl) return;
  if (countEl) countEl.textContent = changes.length === 0 ? '' : String(changes.length);
  if (changes.length === 0) {
    changesEl.innerHTML = '<div class="sc-empty">No changes — this matches your last commit.</div>';
    return;
  }
  changesEl.innerHTML = changes
    .map(
      (c) =>
        '<div class="sc-file" data-path="' + esc(c.path) + '" title="' + esc(c.path) + '">' +
        '<span class="sc-badge ' + (c.status === 'U' ? 'u' : c.status === 'M' ? 'm' : 'd') + '">' + c.status + '</span>' +
        '<span class="sc-path">' + esc(c.path) + '</span></div>'
    )
    .join('');
  changesEl.querySelectorAll('.sc-file').forEach((row) => {
    row.addEventListener('click', () => openFile((row as HTMLElement).dataset.path || ''));
  });
}

function paintHistory(revisions: Revision[] | null): void {
  if (!historyEl) return;
  if (revisions == null) {
    historyEl.innerHTML = '<div class="sc-empty">Sign in to see your commit history.</div>';
    return;
  }
  if (revisions.length === 0) {
    historyEl.innerHTML = '<div class="sc-empty">No commits yet — the first one starts the history.</div>';
    return;
  }
  historyEl.innerHTML = revisions
    .map(
      (r, i) =>
        '<div class="sc-rev" title="' + esc(r.label) + '">' +
        '<span class="sc-dot' + (i === 0 ? ' head' : '') + '"></span>' +
        '<div class="sc-rev-tx"><div class="sc-rev-label">' + esc(r.label) + '</div>' +
        '<div class="sc-rev-meta">' + esc(ago(r.created_at)) + '</div></div></div>'
    )
    .join('');
}

async function load(): Promise<void> {
  if (!changesEl || !historyEl) return;
  const id = getProjectId();
  if (id == null) {
    paintChanges([]);
    paintHistory(null);
    hint('Save the project first — a commit records a revision of a saved project.');
    return;
  }
  const revs = await listRevisions(id);
  paintHistory(revs);
  if (revs == null) {
    hint('Could not read the history — sign in, or check your connection.');
    return;
  }
  const current = await collectTextFiles();
  const base = revs.length > 0 ? await latestFiles(id, revs[0].id) : null;
  paintChanges(diff(current, base));
  hint(
    getToken() == null
      ? 'Sign in at /login to commit — history is stored on your account.'
      : revs.length === 0
        ? 'The first commit records every file in this project.'
        : 'Changes are compared with your newest commit.'
  );
}

async function commit(): Promise<void> {
  const id = getProjectId();
  if (id == null) {
    hint('Save the project first — a commit records a revision of a saved project.');
    return;
  }
  const tok = getToken();
  if (tok == null) {
    hint('Sign in at /login to commit — history is stored on your account.');
    return;
  }
  const files = await collectTextFiles();
  if (Object.keys(files).length === 0) {
    hint('Nothing to commit — this project has no text files.');
    return;
  }
  const typed = (inputEl?.value || '').trim().substring(0, 80);
  if (commitEl) {
    commitEl.disabled = true;
    commitEl.textContent = 'Committing…';
  }
  try {
    const res = await fetch((await apiBase()) + '/api/games/' + encodeURIComponent(id) + '/revisions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + tok },
      body: JSON.stringify({
        label: typed === '' ? 'Commit ' + new Date().toLocaleString() : typed,
        files
      })
    });
    const d = (await res.json().catch(() => null)) as { revision?: Revision; error?: string } | null;
    if (!res.ok || d?.revision == null) {
      hint(d?.error || 'Commit failed (' + res.status + ').');
      return;
    }
    if (inputEl) inputEl.value = '';
    void vscode.window.showInformationMessage('Committed "' + d.revision.label + '".');
    await load();
  } catch (e) {
    hint('Commit failed: ' + ((e as Error).message || 'network'));
  } finally {
    if (commitEl) {
      commitEl.disabled = false;
      commitEl.textContent = 'Commit';
    }
  }
}

// ---- Mounting ---------------------------------------------------------------

function buildPanel(): boolean {
  if (!sr) return false;
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
    '#cudic-source-control .sc-head{display:flex;align-items:center;gap:8px;padding:10px 12px;border-bottom:1px solid var(--line)}' +
    '#cudic-source-control .sc-sec{display:flex;align-items:center;gap:8px;padding:8px 12px;border-bottom:1px solid var(--line);' +
    'font-family:' + MONO + ';font-size:10px;text-transform:uppercase;letter-spacing:.08em;color:var(--mute)}' +
    '#cudic-source-control .sc-count{font-family:' + MONO + ';font-size:10px;color:#0d0e10;background:var(--lime);padding:0 6px;' +
    'line-height:16px;display:none}' +
    '#cudic-source-control .sc-body{flex:1;overflow-y:auto}' +
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
    '#cudic-source-control #scCommit:disabled{opacity:.6;cursor:default}' +
    '#cudic-source-control .sc-hint{padding:8px 12px;font-size:11px;color:var(--mute);border-bottom:1px solid var(--line)}' +
    '#cudic-source-control .sc-rev{display:flex;gap:8px;padding:7px 12px;position:relative}' +
    '#cudic-source-control .sc-rev:before{content:"";position:absolute;left:17px;top:0;bottom:0;width:1px;background:var(--line)}' +
    '#cudic-source-control .sc-dot{width:7px;height:7px;border-radius:50%;background:var(--panel);border:1px solid var(--mute);' +
    'margin-top:6px;flex:none;position:relative;z-index:1}' +
    '#cudic-source-control .sc-dot.head{background:var(--lime);border-color:var(--lime)}' +
    '#cudic-source-control .sc-rev-tx{min-width:0}' +
    '#cudic-source-control .sc-rev-label{font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}' +
    '#cudic-source-control .sc-rev-meta{font-family:' + MONO + ';font-size:10px;color:var(--mute)}' +
    '</style>' +
    '<div class="sc-head">' +
    '<b style="font-weight:500;letter-spacing:-.02em;font-size:14px;flex:1">Source Control</b>' +
    '<button id="scRefresh" title="Refresh" style="background:transparent;border:none;color:inherit;opacity:.7;cursor:pointer;font-size:14px">⟳</button>' +
    '<button id="scHide" title="Hide" style="background:transparent;border:none;color:inherit;opacity:.7;cursor:pointer;font-size:15px">×</button>' +
    '</div>' +
    '<div class="sc-commit">' +
    '<input id="scMsg" placeholder="Message (what changed)" maxlength="80"/>' +
    '<button id="scCommit">Commit</button>' +
    '</div>' +
    '<div class="sc-hint" id="scHint"></div>' +
    '<div class="sc-body">' +
    '<div class="sc-sec">Changes <span class="sc-count" id="scCount"></span></div>' +
    '<div id="scChanges"></div>' +
    '<div class="sc-sec" style="border-top:1px solid var(--line)">History</div>' +
    '<div id="scHistory"></div>' +
    '</div>';

  side.appendChild(panel);
  inputEl = panel.querySelector('#scMsg') as HTMLInputElement;
  commitEl = panel.querySelector('#scCommit') as HTMLButtonElement;
  hintEl = panel.querySelector('#scHint') as HTMLElement;
  changesEl = panel.querySelector('#scChanges') as HTMLElement;
  countEl = panel.querySelector('#scCount') as HTMLElement;
  historyEl = panel.querySelector('#scHistory') as HTMLElement;

  commitEl.addEventListener('click', () => void commit());
  inputEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      void commit();
    }
  });
  (panel.querySelector('#scRefresh') as HTMLButtonElement).addEventListener('click', () => void load());
  (panel.querySelector('#scHide') as HTMLButtonElement).addEventListener('click', hidePanel);
  return true;
}

function setTabActive(on: boolean): void {
  if (tabIcon == null) return;
  tabIcon.style.borderLeft = on ? '3px solid #b8f23a' : '3px solid transparent';
  tabIcon.style.background = on ? 'rgba(184,242,58,.08)' : 'transparent';
  tabIcon.style.color = on ? '#f7f5ec' : 'var(--vscode-activityBar-foreground,#a6abb2)';
}

function buildTabIcon(): boolean {
  if (tabIcon != null || sr == null) return true;
  const act = sr.querySelector('.part.activitybar') as HTMLElement | null;
  if (act == null) return false;
  tabIcon = document.createElement('button');
  tabIcon.id = 'cudic-source-control-tab';
  tabIcon.title = 'Source Control';
  tabIcon.setAttribute('aria-label', 'Source Control');
  tabIcon.style.cssText =
    'position:absolute;left:0;bottom:128px;width:48px;height:48px;display:flex;align-items:center;justify-content:center;' +
    'border:3px solid transparent;outline:none;color:var(--vscode-activityBar-foreground,#a6abb2);cursor:pointer;z-index:60;';
  tabIcon.innerHTML =
    '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true">' +
    '<circle cx="7" cy="5" r="2.4"/><circle cx="7" cy="19" r="2.4"/><circle cx="17" cy="9" r="2.4"/>' +
    '<path d="M7 7.4v9.2"/><path d="M17 11.4c0 3.2-3.4 3.6-6.2 4.2"/></svg>';
  tabIcon.addEventListener('click', () => {
    if (panel != null && panel.style.display !== 'none') {
      hidePanel();
      return;
    }
    void openPanel();
  });
  if (getComputedStyle(act).position === 'static') act.style.position = 'relative';
  act.appendChild(tabIcon);
  return true;
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
