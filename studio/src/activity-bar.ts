// Adding tabs to the activity bar without fighting its layout.
//
// The Collab and Source Control tabs used to be absolutely positioned at
// `bottom:76px` / `bottom:128px`, which is guesswork: the workbench's own
// bottom cluster (account, settings) moves with the theme and the window
// height, so the icons ended up unevenly spaced and overlapping the account
// avatar. This appends a real `li.action-item` to the activity bar's own list
// instead, so VS Code lays it out with the built-in icons and the spacing is
// whatever the workbench uses for every other tab.

let styled = false;

/**
 * Point the workbench at Cudic's palette (same tokens as the site and the
 * Collab panel). VS Code reads these variables on `.monaco-workbench`, so
 * overriding them here is the supported way to recolour a part without
 * out-specificity hacks on every internal class.
 */
export function styleActivityBar(root: ShadowRoot): void {
  if (styled) return;
  styled = true;
  const style = document.createElement('style');
  style.id = 'cudic-activitybar-theme';
  style.textContent =
    '.monaco-workbench{' +
    '--vscode-activityBar-background:#0d0e10;' +
    '--vscode-activityBar-foreground:#9a9a94;' +
    '--vscode-activityBar-inactiveForeground:#8b8d94;' +
    '--vscode-activityBar-activeBorder:#b8f23a;' +
    '--vscode-activityBar-activeBackground:rgba(184,242,58,.08);' +
    '--vscode-activityBar-dropBorder:#b8f23a;' +
    '--vscode-activityBarBadge-background:#b8f23a;' +
    '--vscode-activityBarBadge-foreground:#0d0e10;' +
    '}' +
    '#cudic-activitybar-theme{display:none;}' +
    '.part.activitybar .action-item.cudic-tab>.action-label{' +
    'display:flex;align-items:center;justify-content:center;' +
    'width:100%;height:100%;background:transparent;border:none;padding:0;' +
    'color:var(--vscode-activityBar-inactiveForeground,#8b8d94);cursor:pointer;' +
    'border-left:2px solid transparent;transition:color .12s steps(2),background .12s steps(2);' +
    '}' +
    '.part.activitybar .action-item.cudic-tab>.action-label:hover{' +
    'color:var(--vscode-activityBar-foreground,#f7f5ec);' +
    'background:rgba(184,242,58,.06);' +
    '}' +
    '.part.activitybar .action-item.cudic-tab.on>.action-label{' +
    'color:#f7f5ec;background:rgba(184,242,58,.08);border-left-color:#b8f23a;' +
    '}' +
    '.part.activitybar .action-item.cudic-tab>.action-label:focus-visible{' +
    'outline:1px solid #b8f23a;outline-offset:-2px;' +
    '}';
  root.appendChild(style);
}

export interface TabOptions {
  id: string;
  title: string;
  /** inner SVG markup, inheriting currentColor */
  svg: string;
  onClick: () => void;
}

function actionList(act: HTMLElement): HTMLElement | null {
  const bars = act.querySelectorAll('.monaco-action-bar.vertical');
  for (const bar of bars) {
    const list = bar.querySelector('ul.actions-container');
    if (list != null) return list as HTMLElement;
  }
  return null;
}

/**
 * Append a tab to the activity bar and hand back its button. Returns null while
 * the workbench has not built the bar yet, so callers can retry.
 */
export function mountTab(root: ShadowRoot, act: HTMLElement, o: TabOptions): HTMLButtonElement | null {
  styleActivityBar(root);
  const existing = act.querySelector('#' + o.id) as HTMLButtonElement | null;
  if (existing != null) return existing;
  const list = actionList(act);
  if (list == null) return null;

  const li = document.createElement('li');
  li.className = 'action-item cudic-tab';
  li.setAttribute('role', 'presentation');
  const btn = document.createElement('button');
  btn.id = o.id;
  btn.type = 'button';
  btn.className = 'action-label';
  btn.title = o.title;
  btn.setAttribute('aria-label', o.title);
  btn.innerHTML = o.svg;
  btn.addEventListener('click', () => o.onClick());
  li.appendChild(btn);
  list.appendChild(li);
  return btn;
}

/** Active state: left accent bar + faint tint, on the site's lime. */
export function setTabActive(btn: HTMLButtonElement | null, on: boolean): void {
  if (btn == null) return;
  const li = btn.parentElement;
  if (li == null) return;
  li.classList.toggle('on', on);
}
