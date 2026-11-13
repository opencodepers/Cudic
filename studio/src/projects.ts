/* file: studio/src/projects.ts
 * what: The project picker dialog — lists the signed-in user's games, switches
 *   to one after saving, and starts, renames or duplicates projects from Studio.
 * invariants: leaving the open project always saves first; New project goes
 *   through offerTemplatePicker(true), and Duplicate uses the fork route so
 *   copied projects keep sharing their asset bytes.
 * see: AGENTS.md 2b, 12.17 */

import { apiBase, headers, liveToken } from './api-host';
import {
  getProjectId,
  getProjectTitle,
  offerTemplatePicker,
  READ_ONLY,
  saveBeforeSwitch,
  setProjectTitle
} from './project';
import { icon } from './icons';

interface MineProject {
  id: string;
  title?: string | null;
  published?: boolean;
  updated_at?: string | null;
  created_at?: string | null;
  has_thumb?: boolean;
}

let dialogEl: HTMLDialogElement | null = null;
let listEl: HTMLElement | null = null;
let searchEl: HTMLInputElement | null = null;
let countEl: HTMLElement | null = null;
let projects: MineProject[] = [];
let baseUrl = '';
let loadRun = 0;

function esc(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function projectName(p: MineProject): string {
  return (p.title || '').trim() || 'Untitled Project';
}

function timeAgo(value: string | null | undefined): string {
  const ts = value != null ? Date.parse(value) : NaN;
  if (!Number.isFinite(ts)) return '';
  const mins = Math.max(0, Math.round((Date.now() - ts) / 60000));
  if (mins < 1) return 'just now';
  if (mins < 60) return mins + 'm ago';
  const hours = Math.round(mins / 60);
  if (hours < 24) return hours + 'h ago';
  const days = Math.round(hours / 24);
  if (days < 7) return days + 'd ago';
  return new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function ensureStyle(): void {
  if (document.getElementById('cudic-projects-style') != null) return;
  const style = document.createElement('style');
  style.id = 'cudic-projects-style';
  style.textContent = `
#cudic-projects-dialog {
  width: min(620px, calc(100vw - 32px));
  max-height: min(720px, calc(100vh - 64px));
  margin: auto;
  padding: 0;
  border: 1px solid #2f3540;
  border-radius: 10px;
  overflow: hidden;
  background: #14161b;
  color: #f7f5ec;
  font: 400 13px/1.5 "Geist", system-ui, sans-serif;
  box-shadow: 0 30px 90px rgba(0, 0, 0, .65);
}
#cudic-projects-dialog::backdrop { background: rgba(5, 6, 8, .72); backdrop-filter: blur(6px); }
#cudic-projects-dialog[open] { display: flex; flex-direction: column; }
#cudic-projects-dialog .cp-head {
  padding: 20px 22px 16px;
  border-bottom: 1px solid #262a33;
  background: radial-gradient(520px 180px at 0% 0%, rgba(184, 242, 58, .10), transparent 68%);
}
#cudic-projects-dialog .cp-kicker {
  margin-bottom: 7px;
  color: #b8f23a;
  font: 600 10px/1 "Geist Mono", ui-monospace, monospace;
  letter-spacing: .14em;
  text-transform: uppercase;
}
#cudic-projects-dialog .cp-title-row { display: flex; align-items: center; gap: 8px; }
#cudic-projects-dialog h2 { margin: 0; flex: 1; font-size: 21px; font-weight: 600; letter-spacing: -.03em; }
#cudic-projects-dialog .cp-sub { margin: 5px 0 0; color: #9a9a94; font-size: 12px; }
#cudic-projects-dialog .cp-new {
  display: inline-flex; align-items: center; justify-content: center; gap: 5px;
  height: 30px; flex: 0 0 auto; padding: 0 10px;
  border: 1px solid #3a404b; border-radius: 5px;
  background: #1c1f26; color: #f7f5ec; cursor: pointer;
  font: 600 10px/1 "Geist Mono", ui-monospace, monospace;
  letter-spacing: .04em; text-transform: uppercase;
}
#cudic-projects-dialog .cp-new:hover { border-color: #b8f23a; color: #b8f23a; }
#cudic-projects-dialog .cp-close {
  display: inline-flex; align-items: center; justify-content: center;
  width: 30px; height: 30px; flex: 0 0 auto; padding: 0;
  border: 1px solid transparent; border-radius: 5px;
  background: transparent; color: #9a9a94; cursor: pointer;
}
#cudic-projects-dialog .cp-close:hover { border-color: #2f3540; background: #1c1f26; color: #f7f5ec; }
#cudic-projects-dialog .cp-search {
  display: flex; align-items: center; gap: 9px;
  padding: 0 22px; height: 45px; flex: 0 0 auto;
  border-bottom: 1px solid #262a33; color: #777b84;
}
#cudic-projects-dialog .cp-search input {
  width: 100%; min-width: 0; padding: 0;
  border: 0; outline: 0; background: transparent;
  color: #f7f5ec; font: inherit;
}
#cudic-projects-dialog .cp-search input::placeholder { color: #6f747e; }
#cudic-projects-dialog .cp-search:focus-within { color: #b8f23a; }
#cudic-projects-dialog .cp-list {
  flex: 1; min-height: 140px; overflow-y: auto;
  padding: 8px; background: #101216;
}
#cudic-projects-dialog .cp-row {
  display: flex; align-items: stretch; width: 100%;
  margin: 0 0 3px; border: 1px solid transparent; border-radius: 6px;
  background: transparent;
}
#cudic-projects-dialog .cp-row:hover { border-color: #2f3540; background: #181b21; }
#cudic-projects-dialog .cp-row.is-current { border-color: rgba(184, 242, 58, .36); background: rgba(184, 242, 58, .055); }
#cudic-projects-dialog .cp-row.is-busy { opacity: .62; }
#cudic-projects-dialog .cp-hit {
  display: grid; grid-template-columns: 42px minmax(0, 1fr) auto;
  align-items: center; gap: 12px; flex: 1; min-width: 0; width: 100%;
  padding: 8px 11px; border: 0; background: transparent;
  color: inherit; text-align: left; font: inherit; cursor: pointer;
}
#cudic-projects-dialog .cp-hit:focus-visible { outline: 1px solid #b8f23a; outline-offset: -3px; border-radius: 5px; }
#cudic-projects-dialog .cp-hit-editing { cursor: default; }
#cudic-projects-dialog .cp-thumb {
  position: relative; display: flex; align-items: center; justify-content: center;
  width: 42px; height: 42px; overflow: hidden; border-radius: 5px;
  border: 1px solid #303540; background: linear-gradient(145deg, #232832, #15181e);
  color: #b8f23a; font: 600 15px/1 "Geist Mono", ui-monospace, monospace;
}
#cudic-projects-dialog .cp-thumb img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }
#cudic-projects-dialog .cp-copy { display: flex; min-width: 0; flex-direction: column; gap: 2px; }
#cudic-projects-dialog .cp-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 13px; font-weight: 500; }
#cudic-projects-dialog .cp-meta {
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  color: #8c919b; font: 400 10px/1.4 "Geist Mono", ui-monospace, monospace;
}
#cudic-projects-dialog .cp-tail { display: flex; align-items: center; gap: 6px; }
#cudic-projects-dialog .cp-pill {
  padding: 2px 7px; border-radius: 999px; font: 600 9px/1.5 "Geist Mono", ui-monospace, monospace;
  letter-spacing: .04em; text-transform: uppercase; white-space: nowrap;
}
#cudic-projects-dialog .cp-pill.pub { background: rgba(184, 242, 58, .13); color: #b8f23a; }
#cudic-projects-dialog .cp-pill.draft { background: #20242c; color: #9a9a94; }
#cudic-projects-dialog .cp-current { display: inline-flex; align-items: center; gap: 4px; color: #b8f23a; font: 500 10px/1.4 "Geist Mono", ui-monospace, monospace; }
#cudic-projects-dialog .cp-open { color: #f7f5ec; opacity: 0; font: 500 10px/1.4 "Geist Mono", ui-monospace, monospace; text-transform: uppercase; letter-spacing: .05em; }
#cudic-projects-dialog .cp-row:hover .cp-open, #cudic-projects-dialog .cp-row:focus-within .cp-open { opacity: 1; }
#cudic-projects-dialog .cp-actions {
  display: flex; align-items: center; gap: 2px; padding: 0 7px 0 0;
  opacity: 0; transition: opacity .12s ease;
}
#cudic-projects-dialog .cp-row:hover .cp-actions, #cudic-projects-dialog .cp-row:focus-within .cp-actions { opacity: 1; }
#cudic-projects-dialog .cp-actions button {
  display: inline-flex; align-items: center; justify-content: center;
  width: 27px; height: 27px; padding: 0;
  border: 1px solid transparent; border-radius: 4px;
  background: transparent; color: #8c919b; cursor: pointer;
}
#cudic-projects-dialog .cp-actions button:hover { border-color: #2f3540; background: #1c1f26; color: #f7f5ec; }
#cudic-projects-dialog .cp-actions button:disabled { opacity: .4; cursor: default; }
#cudic-projects-dialog .cp-rename { display: flex; align-items: center; gap: 5px; min-width: 0; }
#cudic-projects-dialog .cp-rename input {
  width: 100%; min-width: 0; height: 27px; padding: 0 7px;
  border: 1px solid #4a5260; border-radius: 4px;
  outline: 0; background: #0d0f13; color: #f7f5ec;
  font: 500 12px/1 "Geist", system-ui, sans-serif;
}
#cudic-projects-dialog .cp-rename input:focus { border-color: #b8f23a; }
#cudic-projects-dialog .cp-rename button {
  height: 27px; flex: 0 0 auto; padding: 0 8px;
  border: 1px solid #3a404b; border-radius: 4px;
  background: transparent; color: #f7f5ec; cursor: pointer;
  font: 600 9px/1 "Geist Mono", ui-monospace, monospace;
  letter-spacing: .04em; text-transform: uppercase;
}
#cudic-projects-dialog .cp-rename .cp-rename-save { border-color: #b8f23a; background: #b8f23a; color: #0d0e10; }
#cudic-projects-dialog .cp-rename button:disabled { opacity: .5; cursor: default; }
#cudic-projects-dialog .cp-state, #cudic-projects-dialog .cp-empty {
  padding: 30px 22px; color: #8c919b; text-align: center; font-size: 12px;
}
#cudic-projects-dialog .cp-empty { display: flex; flex-direction: column; align-items: center; gap: 7px; }
#cudic-projects-dialog .cp-empty strong { color: #f7f5ec; font-size: 13px; font-weight: 500; }
#cudic-projects-dialog .cp-cta {
  display: inline-flex; align-items: center; justify-content: center;
  margin-top: 4px; padding: 6px 12px; border: 1px solid #b8f23a;
  border-radius: 4px; background: #b8f23a; color: #0d0e10;
  font: 600 10px/1.4 "Geist Mono", ui-monospace, monospace;
  letter-spacing: .05em; text-decoration: none; text-transform: uppercase; cursor: pointer;
}
#cudic-projects-dialog .cp-cta:hover { background: #f7f5ec; border-color: #f7f5ec; }
#cudic-projects-dialog .cp-retry {
  margin-top: 4px; padding: 6px 12px; border: 1px solid #3a404b; border-radius: 4px;
  background: transparent; color: #f7f5ec; font: inherit; font-size: 12px; cursor: pointer;
}
#cudic-projects-dialog .cp-retry:hover { border-color: #b8f23a; }
#cudic-projects-dialog .cp-foot {
  display: flex; align-items: center; gap: 8px; padding: 9px 16px;
  border-top: 1px solid #262a33; background: #14161b;
  color: #777b84; font: 400 10px/1.4 "Geist Mono", ui-monospace, monospace;
}
#cudic-projects-dialog .cp-foot b { color: #b8f23a; font-weight: 500; }
@media (hover: none) {
  #cudic-projects-dialog .cp-actions { opacity: 1; }
  #cudic-projects-dialog .cp-open { opacity: 1; }
}
`;
  document.head.appendChild(style);
}

function rowHtml(p: MineProject, base: string): string {
  const title = projectName(p);
  const current = p.id === getProjectId();
  const when = timeAgo(p.updated_at || p.created_at);
  const meta = when ? 'Updated ' + when : 'Not saved yet';
  const thumb =
    '<span aria-hidden="true">' + esc(title.charAt(0).toUpperCase()) + '</span>' +
    (p.has_thumb
      ? '<img src="' + esc(base + '/api/games/' + encodeURIComponent(p.id) + '/thumbnail') + '" alt="" loading="lazy">'
      : '');
  const state =
    '<span class="cp-tail">' + (current
      ? '<span class="cp-current">' + icon('check', 12, 2.2) + 'Current</span>'
      : '<span class="cp-pill ' + (p.published ? 'pub' : 'draft') + '">' + (p.published ? 'Published' : 'Draft') + '</span>' +
        '<span class="cp-open">Open</span>') +
    '</span>';
  return (
    '<div class="cp-row' + (current ? ' is-current' : '') + '" data-project-id="' + esc(p.id) + '">' +
      '<button type="button" class="cp-hit" data-act="open"' +
      (current ? ' aria-current="true"' : '') +
      ' aria-label="' + (current ? 'Current project: ' : 'Open ') + esc(title) + '">' +
        '<span class="cp-thumb">' + thumb + '</span>' +
        '<span class="cp-copy"><span class="cp-name">' + esc(title) + '</span>' +
        '<span class="cp-meta">' + esc(meta) + ' · ' + (p.published ? 'Published' : 'Draft') + '</span></span>' +
        state +
      '</button>' +
      '<span class="cp-actions">' +
        '<button type="button" data-act="rename" title="Rename project" aria-label="Rename ' + esc(title) + '">' +
          icon('pencil', 13, 1.8) + '</button>' +
        '<button type="button" data-act="duplicate" title="Duplicate project" aria-label="Duplicate ' + esc(title) + '">' +
          icon('copy', 13, 1.8) + '</button>' +
      '</span>' +
    '</div>'
  );
}

function setFooter(text: string): void {
  if (countEl != null) countEl.textContent = text;
}

function paintList(): void {
  if (listEl == null) return;
  const q = (searchEl?.value || '').trim().toLowerCase();
  if (projects.length === 0) {
    listEl.innerHTML =
      '<div class="cp-empty"><strong>No projects yet.</strong>' +
      '<span>Start from a template and it will show up here.</span>' +
      '<button type="button" class="cp-cta" data-act="new">New project</button></div>';
    setFooter('0 projects');
    return;
  }
  const visible = projects.filter((p) => projectName(p).toLowerCase().includes(q));
  if (visible.length === 0) {
    listEl.innerHTML = '<div class="cp-state">No projects match “' + esc(q) + '”.</div>';
    setFooter('0 of ' + projects.length + ' projects');
    return;
  }
  listEl.innerHTML = visible.map((p) => rowHtml(p, baseUrl)).join('');
  for (const img of listEl.querySelectorAll('img')) {
    img.addEventListener('error', () => img.remove());
  }
  setFooter(visible.length + (visible.length === 1 ? ' project' : ' projects'));
}

function showState(html: string): void {
  if (listEl != null) listEl.innerHTML = html;
}

async function loadProjects(): Promise<void> {
  const run = ++loadRun;
  if (listEl == null) return;
  projects = [];
  showState('<div class="cp-state">Loading your projects…</div>');
  setFooter('Loading…');

  const token = await liveToken();
  if (run !== loadRun) return;
  if (token == null) {
    showState(
      '<div class="cp-empty"><strong>Sign in to switch projects.</strong>' +
      '<span>Your projects are tied to your Cudic account.</span>' +
      '<a class="cp-cta" href="/login">Sign in</a></div>'
    );
    setFooter('Signed out');
    return;
  }

  const base = await apiBase();
  if (run !== loadRun) return;
  try {
    const res = await fetch(base + '/api/games/mine?t=' + Date.now(), {
      headers: headers(false, token),
      cache: 'no-store'
    });
    if (run !== loadRun) return;
    if (res.status === 401) {
      showState(
        '<div class="cp-empty"><strong>Sign in to switch projects.</strong>' +
        '<span>Your projects are tied to your Cudic account.</span>' +
        '<a class="cp-cta" href="/login">Sign in</a></div>'
      );
      setFooter('Signed out');
      return;
    }
    if (!res.ok) throw new Error('Projects request failed (' + res.status + ').');
    const data = (await res.json().catch(() => null)) as { games?: MineProject[] } | null;
    if (run !== loadRun) return;
    projects = Array.isArray(data?.games)
      ? data.games.filter((p): p is MineProject => p != null && typeof p.id === 'string')
      : [];
    baseUrl = base;
    paintList();
  } catch (e) {
    if (run !== loadRun) return;
    showState(
      '<div class="cp-empty"><strong>Couldn’t load your projects.</strong>' +
      '<span>' + esc((e as Error).message || 'Check your connection and try again.') + '</span>' +
      '<button type="button" class="cp-retry" id="cpRetry">Try again</button></div>'
    );
    setFooter('Load failed');
    listEl.querySelector('#cpRetry')?.addEventListener('click', () => void loadProjects());
  }
}

function projectOf(row: HTMLElement): MineProject | null {
  const id = row.dataset.projectId;
  if (id == null) return null;
  return projects.find((p) => p.id === id) ?? null;
}

function setRowBusy(row: HTMLElement, busy: boolean): void {
  row.classList.toggle('is-busy', busy);
  row.setAttribute('aria-busy', busy ? 'true' : 'false');
  for (const button of row.querySelectorAll('button')) button.disabled = busy;
}

async function saveOpenProject(): Promise<boolean> {
  if (READ_ONLY || getProjectId() == null) return true;
  try {
    return await saveBeforeSwitch();
  } catch {
    return false;
  }
}

async function startNewProject(): Promise<void> {
  if (!(await saveOpenProject())) {
    setFooter('Save failed — staying on the current project');
    return;
  }
  dialogEl?.close();
  await offerTemplatePicker(true);
}

async function renameProject(p: MineProject, title: string): Promise<boolean> {
  const token = await liveToken();
  if (token == null) {
    setFooter('Sign in to rename projects.');
    return false;
  }
  try {
    const base = await apiBase();
    const res = await fetch(base + '/api/games/' + encodeURIComponent(p.id), {
      method: 'PUT',
      headers: headers(true, token),
      body: JSON.stringify({ title })
    });
    const d = (await res.json().catch(() => null)) as { game?: { title?: string | null }; error?: string } | null;
    if (!res.ok || d?.game == null) throw new Error(d?.error || 'Rename failed (' + res.status + ').');
    p.title = (d.game.title || title).slice(0, 100);
    if (p.id === getProjectId()) setProjectTitle(p.title);
    return true;
  } catch (e) {
    setFooter('Rename failed: ' + ((e as Error).message || 'try again.'));
    return false;
  }
}

function beginRename(row: HTMLElement, p: MineProject): void {
  if (row.classList.contains('is-busy')) return;
  const hit = row.querySelector<HTMLButtonElement>('.cp-hit');
  if (hit == null) return;
  const title = projectName(p);

  // Replace the row's open button with a div so the input and its two buttons
  // are not nested inside a button, which browsers treat as invalid markup.
  const form = document.createElement('div');
  form.className = 'cp-hit cp-hit-editing';
  while (hit.firstChild != null) form.appendChild(hit.firstChild);
  hit.replaceWith(form);
  const copy = form.querySelector('.cp-copy');
  if (copy == null) return;
  copy.innerHTML =
    '<span class="cp-rename">' +
      '<input class="cp-rename-input" type="text" maxlength="100" value="' + esc(title) + '" aria-label="Project name">' +
      '<button type="button" class="cp-rename-save">Save</button>' +
      '<button type="button" class="cp-rename-cancel">Cancel</button>' +
    '</span>';

  const input = copy.querySelector<HTMLInputElement>('.cp-rename-input');
  const saveBtn = copy.querySelector<HTMLButtonElement>('.cp-rename-save');
  const cancelBtn = copy.querySelector<HTMLButtonElement>('.cp-rename-cancel');
  input?.focus();
  input?.select();

  const cancel = (): void => {
    paintList();
  };
  const commit = async (): Promise<void> => {
    if (input == null) return;
    const next = input.value.trim();
    if (next === '') {
      input.setCustomValidity('Give the project a name.');
      input.reportValidity();
      return;
    }
    if (next === title) {
      paintList();
      return;
    }
    input.disabled = true;
    if (saveBtn != null) {
      saveBtn.disabled = true;
      saveBtn.textContent = 'Saving…';
    }
    if (cancelBtn != null) cancelBtn.disabled = true;
    if (await renameProject(p, next)) {
      paintList();
      if (p.id === getProjectId()) {
        const currentLabel = dialogEl?.querySelector<HTMLElement>('.cp-foot b');
        if (currentLabel != null) currentLabel.textContent = p.title || next;
      }
      setFooter('Renamed to “' + next + '”.');
      return;
    }
    input.disabled = false;
    if (saveBtn != null) {
      saveBtn.disabled = false;
      saveBtn.textContent = 'Save';
    }
    if (cancelBtn != null) cancelBtn.disabled = false;
    input.focus();
  };

  input?.addEventListener('input', () => input.setCustomValidity(''));
  input?.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter') {
      ev.preventDefault();
      void commit();
    } else if (ev.key === 'Escape') {
      ev.preventDefault();
      ev.stopPropagation();
      cancel();
    }
  });
  saveBtn?.addEventListener('click', () => void commit());
  cancelBtn?.addEventListener('click', cancel);
}

async function duplicateProject(row: HTMLElement, p: MineProject): Promise<void> {
  if (row.classList.contains('is-busy')) return;
  const token = await liveToken();
  if (token == null) {
    setFooter('Sign in to duplicate projects.');
    return;
  }
  if (p.id === getProjectId() && !(await saveOpenProject())) {
    setFooter('Save failed — nothing was duplicated');
    return;
  }

  setRowBusy(row, true);
  setFooter('Duplicating “' + projectName(p) + '”…');
  try {
    const base = await apiBase();
    const res = await fetch(base + '/api/games/' + encodeURIComponent(p.id) + '/fork', {
      method: 'POST',
      headers: headers(false, token)
    });
    const d = (await res.json().catch(() => null)) as { game?: { id?: string }; error?: string } | null;
    if (!res.ok || d?.game?.id == null) {
      throw new Error(d?.error || 'Duplicate failed (' + res.status + ').');
    }
    const copyTitle = (projectName(p) + ' copy').slice(0, 100);
    let named = true;
    try {
      const namedRes = await fetch(base + '/api/games/' + encodeURIComponent(d.game.id), {
        method: 'PUT',
        headers: headers(true, token),
        body: JSON.stringify({ title: copyTitle })
      });
      named = namedRes.ok;
    } catch {
      named = false;
    }
    await loadProjects();
    if (dialogEl != null) {
      const listed = projects.some((project) => project.id === d.game?.id);
      setFooter(
        listed
          ? 'Duplicated — “' + (named ? copyTitle : projectName(p) + ' (fork)') + '” is ready to open.'
          : 'Duplicated — refresh the list to see the copy.'
      );
    }
  } catch (e) {
    if (dialogEl != null) {
      setRowBusy(row, false);
      setFooter('Duplicate failed: ' + ((e as Error).message || 'try again.'));
    }
  }
}

async function chooseProject(row: HTMLElement, p: MineProject): Promise<void> {
  if (p.id === getProjectId()) {
    dialogEl?.close();
    return;
  }

  const open = row.querySelector('.cp-open');
  setRowBusy(row, true);
  if (open != null) open.textContent = 'Saving…';
  setFooter(READ_ONLY ? 'Opening…' : 'Saving the current project…');

  if (!(await saveOpenProject())) {
    setRowBusy(row, false);
    if (open != null) open.textContent = 'Open';
    setFooter('Save failed — staying on the current project');
    return;
  }

  location.assign('/studio?id=' + encodeURIComponent(p.id));
}

/** Open the project picker, or focus the one already open. */
export function openProjectPicker(): void {
  if (dialogEl != null) {
    dialogEl.querySelector<HTMLInputElement>('.cp-search input')?.focus();
    return;
  }
  ensureStyle();

  const dlg = document.createElement('dialog');
  dlg.id = 'cudic-projects-dialog';
  dlg.setAttribute('aria-labelledby', 'cudic-projects-title');
  const current = getProjectTitle();
  dlg.innerHTML =
    '<div class="cp-head">' +
      '<div class="cp-kicker">Cudic Studio</div>' +
      '<div class="cp-title-row"><h2 id="cudic-projects-title">Your projects</h2>' +
      '<button type="button" class="cp-new" id="cpNew">' + icon('plus', 13, 1.8) + '<span>New project</span></button>' +
      '<button type="button" class="cp-close" id="cpClose" title="Close" aria-label="Close project picker">' +
      icon('x', 16, 1.8) + '</button></div>' +
      '<p class="cp-sub">Open another project, start a new one, or manage a copy. ' +
      (READ_ONLY ? 'This view is read-only.' : 'Studio saves the open one first.') + '</p>' +
    '</div>' +
    '<label class="cp-search">' + icon('search', 14, 1.8) +
      '<input type="search" placeholder="Filter projects" aria-label="Filter projects" autocomplete="off"></label>' +
    '<div class="cp-list" aria-live="polite"></div>' +
    '<div class="cp-foot"><b>' + esc(current) + '</b><span>· ' +
      (READ_ONLY ? 'read-only view' : 'saved before switching') +
      '</span><span style="flex:1"></span><span id="cpCount">Loading…</span></div>';

  document.body.appendChild(dlg);
  dialogEl = dlg;
  listEl = dlg.querySelector('.cp-list');
  searchEl = dlg.querySelector('.cp-search input');
  countEl = dlg.querySelector('#cpCount');

  dlg.querySelector('#cpClose')?.addEventListener('click', () => dlg.close());
  dlg.querySelector('#cpNew')?.addEventListener('click', () => void startNewProject());
  dlg.addEventListener('click', (ev) => {
    if (ev.target === dlg) dlg.close();
  });
  dlg.addEventListener('close', () => {
    dlg.remove();
    if (dialogEl === dlg) dialogEl = null;
    listEl = null;
    searchEl = null;
    countEl = null;
    projects = [];
  });
  searchEl?.addEventListener('input', paintList);
  listEl?.addEventListener('click', (ev) => {
    const action = (ev.target as HTMLElement).closest<HTMLButtonElement>('[data-act]');
    if (action == null || action.disabled) return;
    if (action.dataset.act === 'new') {
      void startNewProject();
      return;
    }
    const row = action.closest<HTMLElement>('.cp-row');
    if (row == null) return;
    const p = projectOf(row);
    if (p == null) return;
    if (action.dataset.act === 'open') void chooseProject(row, p);
    else if (action.dataset.act === 'rename') beginRename(row, p);
    else if (action.dataset.act === 'duplicate') void duplicateProject(row, p);
  });

  dlg.showModal();
  searchEl?.focus();
  void loadProjects();
}
