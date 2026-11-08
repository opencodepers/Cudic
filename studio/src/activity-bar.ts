// Adding tabs to the activity bar without fighting its layout.
//
// The Collab and Source Control tabs used to be absolutely positioned at
// guessed offsets, which is why the icons were unevenly spaced and overlapped
// the account avatar. They are real `li.action-item` rows in the bar's own list
// instead, so the workbench spaces them like every other tab.
//
// Two things this file has to survive:
//  * the workbench re-rendering `ul.actions-container`, which drops any row it
//    did not create — so a mounted tab is re-appended whenever it goes missing;
//  * picking a built-in tab (Explorer, Search, …) while a Cudic panel is open —
//    those panels overlay the sidebar, so they register a closer here and are
//    hidden the moment someone selects another view.

let styled = false;
let root: ShadowRoot | null = null;
let mountedList: HTMLElement | null = null;
let armedFor: HTMLElement | null = null;
let watchdog: ReturnType<typeof setInterval> | null = null;

const entries: Array<{ li: HTMLLIElement; btn: HTMLButtonElement }> = [];
const closers: Array<() => void> = [];

/**
 * Point the workbench at Cudic's palette (same tokens as the site and the
 * Collab panel). VS Code reads these variables on `.monaco-workbench`, so
 * overriding them here is the supported way to recolour a part without
 * out-specificity hacks on every internal class.
 */
export function styleActivityBar(sr: ShadowRoot): void {
  root = sr;
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
  sr.appendChild(style);
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
 * Selecting any built-in tab means "show that view". A Cudic panel covering the
 * sidebar has to get out of the way, otherwise Explorer/Search look broken.
 */
export function onOtherTabSelected(fn: () => void): void {
  closers.push(fn);
}

function arm(act: HTMLElement): void {
  if (armedFor === act) return;
  armedFor = act;
  act.addEventListener(
    'click',
    (ev) => {
      const el = ev.target as HTMLElement | null;
      const item = el && el.closest ? (el.closest('.action-item') as HTMLElement | null) : null;
      if (item == null || item.classList.contains('cudic-tab')) return;
      for (const fn of closers) {
        try {
          fn();
        } catch {
          /* a closer failing must not block the tab the user actually clicked */
        }
      }
    },
    true
  );
}

/**
 * Put every mounted tab back where it belongs. Runs on a slow timer because the
 * workbench rebuilds the activity bar on layout and view changes, and the rows
 * it did not create are dropped in the process — a mounted tab that vanishes
 * looks exactly like a tab that was never added.
 */
function ensure(): void {
  if (entries.length === 0 || root == null) return;
  const act = root.querySelector('.part.activitybar') as HTMLElement | null;
  if (act == null) return;
  arm(act);
  const list = mountedList != null && mountedList.isConnected ? mountedList : actionList(act);
  if (list == null) return;
  mountedList = list;
  for (const e of entries) {
    // Same node, re-attached: the click listener and the caller's reference to
    // the button both survive, so active state keeps working.
    if (e.li.parentElement !== list) list.appendChild(e.li);
  }
}

/**
 * Append a tab to the activity bar and hand back its button. Returns null while
 * the workbench has not built the bar yet, so callers can retry.
 */
export function mountTab(sr: ShadowRoot, act: HTMLElement, o: TabOptions): HTMLButtonElement | null {
  styleActivityBar(sr);
  const found = entries.find((e) => e.btn.id === o.id);
  if (found != null) {
    arm(act);
    ensure();
    return found.btn;
  }
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

  mountedList = list;
  entries.push({ li, btn });
  arm(act);
  if (watchdog == null) watchdog = setInterval(ensure, 1000);
  return btn;
}

/** Active state: left accent bar + faint tint, on the site's lime. */
export function setTabActive(btn: HTMLButtonElement | null, on: boolean): void {
  if (btn == null) return;
  const li = btn.parentElement;
  if (li == null) return;
  li.classList.toggle('on', on);
}
