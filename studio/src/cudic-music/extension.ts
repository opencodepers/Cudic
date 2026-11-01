// Cudic Music tab — a picker, not a composer. Music is made in the Music
// Lab page (/music); this tab rides in on the bottom panel (same mounting
// shape as cudic-ai) and lists (a) your saved tracks and (b) every
// signed-in user's tracks via the public browse endpoint. Picking one
// writes music.json to the project root with the chosen track id; the game
// plays it with one line: CudicMusic.play(id) from /cudic-music.js.
declare module '*.html?raw' {
  const s: string;
  export default s;
}

import * as vscode from 'vscode';
import {
  registerAction2,
  Action2,
  MenuId
} from '@codingame/monaco-vscode-api/vscode/vs/platform/actions/common/actions';
import { Parts, setPartVisibility, isPartVisibile } from '@codingame/monaco-vscode-workbench-service-override';
import { apiBase, headers } from '../project';

interface TrackRow {
  id: string;
  title: string;
  owner?: string;
  updated_at?: string;
}

let panelEl: HTMLElement | null = null;
let listEl: HTMLElement | null = null;
let hintEl: HTMLElement | null = null;
let inputEl: HTMLInputElement | null = null;
let modeMine = true;
let pickSearch = '';

function el(html: string): HTMLElement {
  const t = document.createElement('template');
  t.innerHTML = html;
  return t.content.firstElementChild as HTMLElement;
}

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] || c));
}

export function registerCudicMusic(shadowRoot: ShadowRoot): void {
  const mount = (): boolean => {
    const part = shadowRoot.querySelector('.part.panel') as HTMLElement | null;
    if (!part) return false;
    if (!panelEl) {
      if (getComputedStyle(part).position === 'static') part.style.position = 'relative';
      panelEl = el(
        '<div id="cudic-music-panel" style="position:absolute;inset:0;display:none;flex-direction:column;' +
        'background:var(--vscode-sideBar-background,#181818);color:var(--vscode-foreground,#dbe4ff);' +
        'font-family:var(--vscode-font-family,sans-serif);font-size:13px;z-index:5;"></div>'
      );
      const bar = el(
        '<div style="display:flex;align-items:center;gap:8px;padding:8px 10px 8px 14px;font-size:11px;' +
        'font-weight:700;letter-spacing:.08em;border-bottom:1px solid var(--vscode-sideBarSectionHeader-border,#2d2d2d);">' +
        '<span>♪ CUDIC MUSIC</span><span style="flex:1"></span></div>'
      );
      const hide = el(
        '<button title="Hide panel" style="background:transparent;border:none;cursor:pointer;font-size:15px;' +
        'color:inherit;opacity:.7;padding:2px 6px;">×</button>'
      );
      hide.addEventListener('click', hidePanel);
      bar.append(hide);

      const search = el(
        '<div style="display:flex;gap:8px;padding:8px 14px;align-items:center;flex-wrap:wrap;">' +
        '<button data-mode="mine" style="background:transparent;border:1px solid var(--vscode-sideBarSectionHeader-border,#2d2d2d);border-radius:4px;color:inherit;padding:3px 10px;cursor:pointer;font:inherit;">Yours</button>' +
        '<button data-mode="all" style="background:transparent;border:1px solid var(--vscode-sideBarSectionHeader-border,#2d2d2d);border-radius:4px;color:inherit;padding:3px 10px;cursor:pointer;font:inherit;opacity:.55;">Everyone</button>' +
        '<input placeholder="Search track titles…" style="flex:1;min-width:140px;background:var(--vscode-input-background,#1f1f1f);color:var(--vscode-input-foreground,#dbe4ff);border:1px solid var(--vscode-sideBarSectionHeader-border,#2d2d2d);border-radius:4px;padding:4px 8px;font:inherit;outline:none;">' +
        '</div>'
      );
      const mine = search.querySelector('[data-mode="mine"]') as HTMLButtonElement;
      const all = search.querySelector('[data-mode="all"]') as HTMLButtonElement;
      inputEl = search.querySelector('input') as HTMLInputElement;
      const paint = (): void => {
        mine.style.opacity = modeMine ? '1' : '.55';
        all.style.opacity = modeMine ? '.55' : '1';
      };
      mine.addEventListener('click', () => { modeMine = true; paint(); void refresh(); });
      all.addEventListener('click', () => { modeMine = false; paint(); void refresh(); });
      let deb = 0;
      inputEl.addEventListener('input', () => {
        pickSearch = inputEl!.value;
        window.clearTimeout(deb);
        deb = window.setTimeout(() => void refresh(), 350);
      });
      paint();

      hintEl = el('<div style="padding:6px 14px;font-size:12px;opacity:.65;"></div>');
      listEl = el('<div style="flex:1;overflow:auto;padding:4px 8px 12px;"></div>');
      panelEl.append(bar, search, hintEl, listEl);
      part.appendChild(panelEl);
    }
    return true;
  };
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
          id: 'cudic-music.openLibrary',
          title: { value: 'Cudic Music: Open library', original: 'Cudic Music: Open library' },
          menu: [{ id: MenuId.CommandPalette }]
        });
      }
      async run(): Promise<void> {
        mount();
        showPanel();
        try {
          void setPartVisibility(Parts.PANEL_PART, true);
        } catch { /* layout service unreadable */ }
        void refresh();
      }
    }
  );
}

function showPanel(): void {
  if (panelEl) panelEl.style.display = 'flex';
}
function hidePanel(): void {
  if (panelEl) panelEl.style.display = 'none';
}

async function refresh(): Promise<void> {
  if (!listEl || !hintEl) return;
  listEl.innerHTML = '<div style="opacity:.6;padding:8px;">Loading…</div>';
  const base = await apiBase();
  const q = pickSearch.trim();
  const escQ = encodeURIComponent(q);
  const path = modeMine
    ? base + '/api/music' + (q ? '?q=' + escQ : '')
    : base + '/api/music/browse?limit=30' + (q ? '&q=' + escQ : '');
  let tracks: TrackRow[] = [];
  try {
    const r = await fetch(path, { headers: headers(false) });
    if (r.status === 401) {
      hintEl.textContent = modeMine
        ? 'Sign in on the website first — only signed-in accounts see "Yours". "Everyone" works signed-out.'
        : '';
      tracks = [];
      if (modeMine) { modeMine = false; return void refresh(); }
    } else if (!r.ok) {
      throw new Error('HTTP ' + r.status);
    } else {
      const d = (await r.json()) as { tracks?: TrackRow[] };
      tracks = d.tracks || [];
      hintEl.textContent = modeMine
        ? 'Tracks you saved in the Music Lab (/music). Composing happens there.'
        : 'All users\u2019 tracks — searching titles. Click Use to put one in this project.';
    }
  } catch (e) {
    hintEl.textContent = 'Could not load tracks (' + ((e as Error).message || 'network') + '). Music Lab saves need the backend running.';
    listEl.innerHTML = '';
    return;
  }
  if (!tracks.length) {
    listEl.innerHTML = modeMine
      ? '<div style="opacity:.6;padding:8px;">No saved tracks yet. Open ' +
        '<a href="' + esc(base || '') + '/music" style="color:var(--vscode-textLink-foreground,#9dd1ff);">/music</a> and beat-make one, then Save.</div>'
      : '<div style="opacity:.6;padding:8px;">No tracks match that search.</div>';
    return;
  }
  listEl.innerHTML = tracks.map((t) =>
    '<div style="display:flex;gap:8px;align-items:center;padding:6px 6px;border-bottom:1px solid var(--vscode-sideBarSectionHeader-border,#2d2d2d);">' +
    '<div style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;"><b>' + esc(t.title) + '</b>' +
    (modeMine ? '' : '<span style="opacity:.6"> — ' + esc(t.owner || 'Cudic user') + '</span>') + '</div>' +
    '<button data-id="' + esc(t.id) + '" style="background:var(--vscode-button-background,#7300FF);color:var(--vscode-button-foreground,#fff);' +
    'border:none;border-radius:4px;padding:3px 10px;cursor:pointer;font:inherit;font-size:11px;">Use</button>' +
    '</div>'
  ).join('');
  const list = listEl;
  list.querySelectorAll('button[data-id]').forEach((b) => {
    b.addEventListener('click', async () => {
      const id = (b as HTMLElement).dataset.id || '';
      const row = tracks.find((t) => t.id === id);
      const title = row ? row.title : 'music';
      const payload = JSON.stringify({ id, title: title, from: row && row.owner ? row.owner : null }, null, 2) + '\n';
      try {
        await vscode.workspace.fs.writeFile(
          vscode.Uri.file('/workspace/music.json'),
          new TextEncoder().encode(payload)
        );
        void vscode.window.showInformationMessage(
          'Added ' + title + ' to the project. In your game HTML add ' +
          '<script src="/cudic-music.js"></script> then call CudicMusic.play(\'' + id + '\').'
        );
        try {
          void vscode.commands.executeCommand('vscode.open', vscode.Uri.file('/workspace/music.json'));
        } catch { /* editor not ready */ }
      } catch (err) {
        void vscode.window.showErrorMessage('Cudic Music: could not write music.json — ' + ((err as Error).message || err));
      }
    });
  });
}
