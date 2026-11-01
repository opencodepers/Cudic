// Revision history: snapshot/restore project files against the account.
// Snapshots are staged: "Save snapshot" diffs the workspace against the
// newest snapshot and lets you uncheck files, which keep their previous
// snapshot copy — the stored state is the last snapshot + exactly what you
// staged (commit-like), and restore remains a plain full replacement.
import * as vscode from 'vscode';
import {
  registerAction2,
  Action2,
  MenuId
} from '@codingame/monaco-vscode-api/vscode/vs/platform/actions/common/actions';
import { getToken, getProjectId, collectTextFiles, apiBase, headers } from './project';

async function snapshots() {
  const id = getProjectId();
  if (!id) return null;
  const tok = getToken();
  const res = await fetch(apiBase() + '/api/games/' + encodeURIComponent(id) + '/revisions', { headers: headers(!!tok) });
  if (!res.ok) return null;
  const d = await res.json();
  return d.revisions || [];
}

// The newest snapshot's full file map, or null when there is none (first
// snapshot, fetch failure — every failure just falls back to whole-state).
async function latestSnapshotFiles(id: string, tok: string): Promise<Record<string, string> | null> {
  const list = await snapshots();
  if (!list || !list.length) return null;
  try {
    const res = await fetch(apiBase() + '/api/games/' + encodeURIComponent(id) + '/revisions/' + encodeURIComponent(list[0].id), { headers: headers(!!tok) });
    if (!res.ok) return null;
    const d = await res.json();
    const f = d?.revision?.files;
    if (f && typeof f === 'object' && !Array.isArray(f)) return f;
  } catch { /* fall back below */ }
  return null;
}

type StageItem = vscode.QuickPickItem & { path: string; status: 'new' | 'changed' | 'deleted' };

// Exported so the Cudic AI agent can checkpoint the project before it
// starts editing files (same command the File menu runs). Returns whether
// a snapshot was actually created.
// auto=true runs headless (all changes staged, fixed label) so the Cudic AI
// agent can checkpoint without yanking quickpicks in front of the user.
export async function createSnapshot(auto?: boolean, autoLabel?: string): Promise<boolean> {
  const id = getProjectId();
  if (!id) { vscode.window.showInformationMessage('Save the project first — you can snapshot after it has an id.'); return false; }
  const tok = getToken();
  if (!tok) { vscode.window.showInformationMessage('Sign in to snapshot.'); return false; }
  const current = await collectTextFiles();
  const base = await latestSnapshotFiles(id, tok);
  const payload: { label: string; files?: Record<string, string> } = { label: '' };
  let stagedCount: number | null = null;

  if (base != null) {
    const changes: StageItem[] = [];
    for (const p of Object.keys(current)) {
      if (!(p in base)) changes.push({ label: p, description: 'new', path: p, status: 'new' });
      else if (base[p] !== current[p]) changes.push({ label: p, description: 'changed', path: p, status: 'changed' });
    }
    for (const p of Object.keys(base)) {
      if (!(p in current)) changes.push({ label: p, description: 'deleted from project', path: p, status: 'deleted' });
    }
    if (changes.length === 0) {
      vscode.window.showInformationMessage('Nothing has changed since the last snapshot.');
      return true;
    }
    // Stage dialog: every change starts checked; press Enter to snapshot the
    // checked ones. Untouched files ride along unchanged.
    // Agent mode (auto) stages everything instead — no quickpick.
    const picked = auto
      ? changes
      : await (async (): Promise<StageItem[]> => {
          const qp = vscode.window.createQuickPick<StageItem>();
          qp.canPickMany = true;
          qp.title = 'Stage changes for this snapshot';
          qp.placeholder = 'Enter snapshots the checked files — click or press space to toggle a file';
          qp.items = changes;
          qp.selectedItems = changes;
          let accepted = false;
          const res = await new Promise<StageItem[]>((resolve) => {
            qp.onDidAccept(() => { accepted = true; resolve(qp.selectedItems.slice()); });
            qp.onDidHide(() => resolve([]));
            qp.show();
          });
          qp.dispose();
          if (!accepted) return [];
          return res;
        })();
    if (!auto && picked.length === 0) return false; // dismissed
    if (picked.length === 0) {
      vscode.window.showInformationMessage('Snapshot would be empty — stage at least one change, or run it again and keep everything checked.');
      return false;
    }
    const keep = new Set(picked.map((i) => i.path));
    const staged: Record<string, string> = {};
    for (const [p, v] of Object.entries(current)) {
      if (p in base && base[p] === v) { staged[p] = v; continue; } // untouched
      if (keep.has(p)) staged[p] = v; // staged at working-tree content
      else if (p in base) staged[p] = base[p]; // unstaged edit keeps the last snapshot's copy
      // a brand-new file left unchecked is simply not part of this snapshot
    }
    for (const p of Object.keys(base)) {
      if (!(p in current) && !keep.has(p)) staged[p] = base[p]; // unstaged deletion keeps its copy
    }
    payload.files = staged;
    stagedCount = picked.length;
  }

  const label = auto
    ? (autoLabel || 'before agent edit')
    : await vscode.window.showInputBox({ prompt: 'Snapshot label (optional)', placeHolder: 'e.g. "before adding powerups"', value: '' });
  if (label === undefined) return false;
  payload.label = label || '';
  const res = await fetch(apiBase() + '/api/games/' + encodeURIComponent(id) + '/revisions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + tok },
    body: JSON.stringify(payload)
  });
  const d = await res.json();
  if (d.revision) {
    vscode.window.showInformationMessage(
      'Snapshot saved: ' + d.revision.label +
      (stagedCount != null ? ' (' + stagedCount + ' change(s) staged).' : '')
    );
    return true;
  }
  vscode.window.showErrorMessage(d.error || 'Snapshot failed.');
  return false;
}

async function restoreSnapshot() {
  const id = getProjectId();
  if (!id) { vscode.window.showInformationMessage('No project open.'); return; }
  const tok = getToken();
  if (!tok) { vscode.window.showInformationMessage('Sign in to restore.'); return; }
  const list = await snapshots();
  if (!list || !list.length) { vscode.window.showInformationMessage('No snapshots yet — create one first.'); return; }
  const pick = await vscode.window.showQuickPick(
    list.map((r: { id: string; label: string; created_at: string }) => ({
      label: r.label,
      description: new Date(r.created_at).toLocaleString(),
      detail: 'Restore this snapshot into the current project',
      id: r.id
    })),
    { placeHolder: 'Choose a snapshot to restore' }
  );
  if (!pick) return;
  const res = await fetch(apiBase() + '/api/games/' + encodeURIComponent(id) + '/revisions/' + encodeURIComponent(pick.id) + '/restore', {
    method: 'POST',
    headers: { 'Authorization': 'Bearer ' + tok }
  });
  const d = await res.json();
  if (d.ok) {
    vscode.window.showInformationMessage('Restored — reloading project…');
    setTimeout(() => location.reload(), 600);
  } else {
    vscode.window.showErrorMessage(d.error || 'Restore failed.');
  }
}

export function registerRevisionCommands(): void {
  registerAction2(
    class extends Action2 {
      constructor() {
        super({
          id: 'glox.snapshot',
          title: { value: 'Cudic: Save snapshot', original: 'Cudic: Save snapshot' },
          menu: [{ id: MenuId.CommandPalette }, { id: MenuId.MenubarFileMenu, group: '5_glox' }]
        });
      }
      async run(): Promise<void> { await createSnapshot(); }
    }
  );
  registerAction2(
    class extends Action2 {
      constructor() {
        super({
          id: 'glox.snapshotList',
          title: { value: 'Cudic: Restore snapshot…', original: 'Cudic: Restore snapshot…' },
          menu: [{ id: MenuId.CommandPalette }, { id: MenuId.MenubarFileMenu, group: '5_glox' }]
        });
      }
      async run(): Promise<void> { await restoreSnapshot(); }
    }
  );
}
