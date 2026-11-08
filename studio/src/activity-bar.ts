/* file: studio/src/activity-bar.ts
 * what: Cudic's own activity-bar strip — the Chat / Collab / Source Control tabs,
 *   mounted inside .content, directly after .composite-bar (#cudic-activity-tabs).
 * invariants: NEVER append an <li> to VS Code's ul.actions-container. Its parallel
 *   arrays desync and the entire activity bar renders empty (fixed in ce241b4).
 *   Every consumer imports mountTab / setTabActive / onOtherTabSelected from here.
 * see: AGENTS.md 12.20 */

// Cudic's own tabs in the activity bar.
//
// History matters here, because two earlier attempts broke the bar:
//
//  1. Absolutely positioned buttons at guessed `bottom:` offsets drifted into
//     the account avatar.
//  2. Appending `li.action-item` rows into the workbench's own
//     `ul.actions-container`. The workbench keeps its action list and that
//     container in step one entry per action; a foreign row desyncs it, its
//     re-render then fails part-way, and the whole icon column disappears —
//     leaving only the account/settings cluster. That is why the bar went
//     empty.
//
// So: Cudic's tabs live in their own strip. It is a sibling of the workbench's
// icon list, never a child of it, so a re-render of VS Code's actions cannot
// touch it, and it cannot corrupt their bookkeeping. It goes inside `.content`
// (the bar's 100%-height flex column), directly after `.composite-bar`; beside
// `.content` instead and it lands below a full-height box, off the bottom of
// the bar, which is how both tabs went missing. The strip is in normal
// flow (no absolute offsets), one 48px row per tab — the same height the
// workbench uses for its own icons — so the spacing matches by construction.

let styled = false;
let root: ShadowRoot | null = null;
let wrap: HTMLElement | null = null;
let armedFor: HTMLElement | null = null;
let watchdog: ReturnType<typeof setInterval> | null = null;

const closers: Array<() => void> = [];
const tabs: HTMLButtonElement[] = [];

/**
 * Point the workbench at Cudic's palette (same tokens as the site and the
 * panels). VS Code reads these variables on `.monaco-workbench`, which is the
 * supported way to recolour a part without out-specificity hacks.
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
    '#cudic-activity-tabs{' +
    'display:flex;flex-direction:column;flex:0 0 auto;width:100%;' +
    'padding:6px 0 0;margin:0;overflow:visible;' +
    '}' +
    '#cudic-activity-tabs .cudic-tab{' +
    'width:100%;height:48px;flex:0 0 auto;display:flex;align-items:center;justify-content:center;' +
    'padding:0;background:transparent;border:0;border-left:2px solid transparent;' +
    'color:var(--vscode-activityBar-inactiveForeground,#8b8d94);cursor:pointer;' +
    'transition:color .12s steps(2),background .12s steps(2);' +
    '}' +
    '#cudic-activity-tabs .cudic-tab:hover{' +
    'color:#f7f5ec;background:rgba(184,242,58,.06);' +
    '}' +
    '#cudic-activity-tabs .cudic-tab.on{' +
    'color:#f7f5ec;background:rgba(184,242,58,.08);border-left-color:#b8f23a;' +
    '}' +
    '#cudic-activity-tabs .cudic-tab svg{width:22px;height:22px;display:block;color:inherit}' +
    '#cudic-activity-tabs .cudic-tab:focus-visible{outline:1px solid #b8f23a;outline-offset:-2px}' +
    '#cudic-activitybar-theme{display:none}';
  sr.appendChild(style);
}

export interface TabOptions {
  id: string;
  title: string;
  /** inner SVG markup, inheriting currentColor */
  svg: string;
  onClick: () => void;
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
      // Our own buttons are not `.action-item`: only the workbench's tabs close
      // a panel, never a click on Collab or Source Control itself.
      if (item == null) return;
      for (const fn of closers) {
        try {
          fn();
        } catch {
          /* a closer failing must not eat the click the user made */
        }
      }
    },
    true
  );
}

/** Keep the strip inside the bar: the workbench rebuilds the bar's contents. */
function place(act: HTMLElement): void {
  if (wrap == null) return;
  const composite = act.querySelector('.composite-bar') as HTMLElement | null;
  const content = act.querySelector('.content') as HTMLElement | null;
  if (composite != null) {
    // Directly under the workbench's own icons, inside the same column.
    // `.activitybar > .content` is height:100%, so inserting after `.content`
    // puts the strip under a full-height box — off the bottom of the bar,
    // where neither tab is visible. `.composite-bar` has margin-bottom:auto,
    // so the strip lands immediately beneath the icon list. Checked, not just
    // "is it connected": a rebuilt bar can append a new icon list after us.
    if (composite.nextElementSibling !== wrap) composite.insertAdjacentElement('afterend', wrap);
  } else if (content != null) {
    if (wrap.parentElement !== content) content.appendChild(wrap);
  } else if (wrap.parentElement !== act) {
    act.appendChild(wrap);
  }
}

/**
 * Append a tab to Cudic's strip and hand back its button. Returns null while
 * the workbench has not built the activity bar yet, so callers can retry.
 */
export function mountTab(sr: ShadowRoot, act: HTMLElement, o: TabOptions): HTMLButtonElement | null {
  styleActivityBar(sr);
  const existing = tabs.find((b) => b.id === o.id);
  if (existing != null) {
    place(act);
    return existing;
  }
  if (wrap == null) {
    wrap = document.createElement('div');
    wrap.id = 'cudic-activity-tabs';
    wrap.setAttribute('role', 'toolbar');
    wrap.setAttribute('aria-label', 'Cudic');
  }
  const btn = document.createElement('button');
  btn.id = o.id;
  btn.type = 'button';
  btn.className = 'cudic-tab';
  btn.title = o.title;
  btn.setAttribute('aria-label', o.title);
  btn.innerHTML = o.svg;
  btn.addEventListener('click', () => o.onClick());
  wrap.appendChild(btn);
  tabs.push(btn);

  place(act);
  arm(act);
  if (watchdog == null) {
    watchdog = setInterval(() => {
      const bar = root?.querySelector('.part.activitybar') as HTMLElement | null;
      if (bar != null) place(bar);
    }, 1000);
  }
  return btn;
}

/** Active state: left accent bar + faint tint, on the site's lime. */
export function setTabActive(btn: HTMLButtonElement | null, on: boolean): void {
  if (btn == null) return;
  btn.classList.toggle('on', on);
}
