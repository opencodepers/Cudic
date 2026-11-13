/* file: studio/src/icons.ts
 * what: Lucide line icons for Cudic's Studio chrome — activity tabs, title-bar
 *   actions and panel controls.
 * invariants: icons inherit currentColor and use the 24px Lucide grid; import
 *   them one by one so Vite can tree-shake the icon package.
 * see: AGENTS.md 2b, 12.17 */

import {
  Check,
  Copy,
  FolderOpen,
  GitBranch,
  LogOut,
  Pencil,
  Play,
  Plus,
  RefreshCw,
  Save,
  Search,
  Users,
  X as XIcon,
  createElement
} from 'lucide';

const ICONS = {
  check: Check,
  copy: Copy,
  'folder-open': FolderOpen,
  'git-branch': GitBranch,
  'log-out': LogOut,
  pencil: Pencil,
  play: Play,
  plus: Plus,
  'refresh-cw': RefreshCw,
  save: Save,
  search: Search,
  users: Users,
  x: XIcon
} as const;

export type IconName = keyof typeof ICONS;

/** Serialize a Lucide icon for the innerHTML-based panels and activity tabs. */
export function icon(name: IconName, size = 22, strokeWidth = 1.6): string {
  const el = createElement(ICONS[name]);
  el.setAttribute('width', String(size));
  el.setAttribute('height', String(size));
  el.setAttribute('stroke-width', String(strokeWidth));
  el.setAttribute('aria-hidden', 'true');
  el.setAttribute('focusable', 'false');
  el.removeAttribute('class');
  return el.outerHTML;
}
