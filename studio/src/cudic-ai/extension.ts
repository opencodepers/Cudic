/* file: studio/src/cudic-ai/extension.ts
 * what: The Cudic AI panel — provider picker, chat UI, the agent tool loop, and
 *   the calls that route through the /api/ai/fetch proxy.
 * invariants: user-facing strings say CIDE; the tool loop contract is documented
 *   in AGENTS.md and tests pin it — don't restructure it casually.
 * see: AGENTS.md 7, 7 "Agent tool loop" */

// Cudic AI built-in — chat panel mounted straight into the bottom panel
// part. This stack ships no WebviewViewPane, so sidebar webview
// views can never render — direct DOM mount instead, the same proven pattern
// as the title-bar Cudic icon. The UI runs in a sandboxed srcdoc iframe;
// all behavior (LLM, files, settings) stays main-side. No vsix, no worker
// main, no extension host involved at all.
declare module '*.html?raw' {
  const s: string;
  export default s;
}

import * as vscode from 'vscode';
import * as monaco from 'monaco-editor';
import {
  registerAction2,
  Action2,
  MenuId
} from '@codingame/monaco-vscode-api/vscode/vs/platform/actions/common/actions';
import {
  Parts,
  setPartVisibility,
  isPartVisibile
} from '@codingame/monaco-vscode-workbench-service-override';
import chatHtmlRaw from './chat.html?raw';
// Terminal base layer (MIT, vendored inline): type scale + form rhythm for
// the panel's terminal skin. Our rules come after it in chat.html and win.
import terminalCss from 'terminal.css/dist/terminal.min.css?raw';
import { PROVIDERS, presetById, ProviderPreset } from './providers';
import { streamChat, fetchModels, friendlyError, suggestModels, ChatMessage, ToolDef, ToolCall, setSupaToken as setLlmToken } from './llm';
// Agent tools reach outside the panel: gloxRun (opens/reloads the preview
// pane) and createSnapshot(true) (headless project checkpoint). Neither
// imports this module, so no cycle.
import { gloxRun, drainPreviewErrors } from '../glox';
import { createSnapshot } from '../revisions';
import { SKILLS } from './skills';
// MCP: external tool servers (Streamable HTTP). Catalogs are cached in-module
// and refreshed lazily; runTool dispatches mcp_* calls back through the client.
import { aggregateCatalog, callTool, McpServer, McpToolEntry } from './mcp';

// main.ts calls this on boot + every 60s. Forwards the token to llm.ts and
// tells the panel whether a login exists, so /status and the status line
// can say so instead of failing at send time.
let lastSupa: string | null = null;
export function setSupaToken(t: string | null): void {
  lastSupa = t;
  setLlmToken(t);
  postToPanel({ type: 'ai:supa', ok: !!t });
}

export interface AiSettings {
  provider: string;
  model: string;
  baseOverride: string;
  completeOn: boolean;
  completeModel: string;
  keys: Record<string, string>;
  modelLists: Record<string, string[]>;
  fetchedAt: Record<string, number>;
  // Selected premade skill ids appended to the system prompt.
  skills: string[];
  // How much the model may act: 'agent' (all tools, iterate), 'edit'
  // (file write tools only, no delete/rename/preview), 'ask' (answer only).
  mode: string;
  // User's custom system-prompt overlay (yellow box in options). Appended
  // after the built-in discipline section, before the premade skills.
  sysExtra: string;
  // External MCP tool servers (Streamable HTTP). Keys live here too and
  // never leave the page except inside the Authorization header.
  mcp: McpServer[];
  // Named chat transcripts ('/session'). Saved with the account via
  // /api/ai/sessions so they survive panel reloads and new machines.
  sessions: AiSession[];
  activeSession: string;
}

export interface AiSession {
  id: string;
  label: string;
  created: number;
  msgs: { q: string; a: string }[];
}

const SESSIONS_MAX = 20;
function normalizeSessions(raw: unknown): AiSession[] {
  if (!Array.isArray(raw)) return [];
  const out: AiSession[] = [];
  for (const s of raw) {
    if (!s || typeof s !== 'object') continue;
    const o = s as { id?: unknown; label?: unknown; created?: unknown; msgs?: unknown };
    const id = String(o.id || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 40);
    if (!id) continue;
    const msgs = Array.isArray(o.msgs)
      ? (o.msgs as { q?: unknown; a?: unknown }[]).slice(0, 80).map((mm) => ({
        q: typeof mm?.q === 'string' ? mm.q.slice(0, 4000) : '',
        a: typeof mm?.a === 'string' ? mm.a.slice(0, 12000) : ''
      })).filter((mm) => mm.q)
      : [];
    out.push({
      id: id,
      label: String(o.label || '').replace(/\s+/g, ' ').trim().slice(0, 60) || id,
      created: Math.min(Math.max(Number(o.created) || 0, 0), 4102444800000),
      msgs: msgs
    });
    if (out.length >= SESSIONS_MAX) break;
  }
  return out;
}

const STORE_KEY = 'cudic-ai';
const TEXT_EXT = /\.(html|css|js|ts|tsx|jsx|json|md|txt|svg|xml)$/i;

// Save-path sanitizer: whitelisted entries only, keys preserved when the
// panel resaves without them (e.g. after a model switch).
function mergeMcpServers(current: McpServer[], incoming: unknown): McpServer[] {
  if (!Array.isArray(incoming)) return (current || []).slice(0, 6);
  const out: McpServer[] = [];
  for (const raw of incoming) {
    if (!raw || typeof raw !== 'object') continue;
    const url = String((raw as { url?: unknown }).url || '').trim().replace(/\/+$/, '');
    if (!/^https?:\/\//.test(url)) continue;
    const existing = (current || []).find((c) => c.url === url);
    const key = (raw as { key?: unknown }).key;
    out.push({ url: url, key: typeof key === 'string' && key.trim() ? key.trim() : existing?.key });
    if (out.length >= 6) break;
  }
  return out;
}

function loadSettings(): AiSettings {
  const d: AiSettings = { provider: 'zen', model: '', baseOverride: '', completeOn: true, completeModel: '', keys: {}, modelLists: {}, fetchedAt: {}, skills: ['cudic'], mode: 'agent', sysExtra: '', mcp: [], sessions: [{ id: 'main', label: 'main', created: 0, msgs: [] }], activeSession: 'main' };
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<AiSettings>;
      const merged: AiSettings = { ...d, ...parsed };
      merged.sessions = normalizeSessions(parsed.sessions);
      if (!merged.sessions.length) merged.sessions = d.sessions;
      if (!merged.sessions.some((s) => s.id === merged.activeSession)) merged.activeSession = merged.sessions[0].id;
      return merged;
    }
  } catch { /* private mode */ }
  return d;
}
function saveSettings(s: AiSettings): void {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(s));
  } catch { /* private mode */ }
}
function publicSettings(s: AiSettings) {
  const active = s.sessions.find((x) => x.id === s.activeSession) || s.sessions[0];
  return {
    provider: s.provider, model: s.model, baseOverride: s.baseOverride,
    completeOn: s.completeOn, completeModel: s.completeModel,
    skills: s.skills, mode: s.mode,
    hasSysExtra: !!(s.sysExtra || '').trim(), sysExtra: s.sysExtra || '',
    // Sessions: meta for the switcher plus the full transcript of the active
    // session so the panel can restore the scrollback after a panel reload.
    activeSession: active?.id || 'main',
    sessionsMeta: s.sessions.map((x) => ({ id: x.id, label: x.label, count: x.msgs.length, created: x.created })),
    history: (active?.msgs || []).slice(-80),
    // Cached catalogs (model IDs only, never keys) ride along so the
    // provider list shows real lineups on boot instead of the curated
    // first model alone.
    modelLists: s.modelLists || {},
    // MCP servers, keys presence-only (same rule as provider keys).
    // toolCount comes from the live catalog cache so chips show what's ready.
    mcp: (s.mcp || []).map((srv) => ({
      url: srv.url, hasKey: !!srv.key,
      label: srv.url.replace(/^[a-z]+:\/\//, '').split('/').filter(Boolean).pop() || srv.url,
      toolCount: (mcpTools || []).filter((t) => t.server.url === srv.url).length
    })),
    hasKey: !!(s.keys[s.provider] || presetById(s.provider).keyOptional),
    // Presence only (never values) so the list screen knows which
    // companies can load their full catalog.
    keyed: Object.keys(s.keys).filter((k) => !!s.keys[k])
  };
}

function nonce(): string {
  const a = new Uint8Array(16);
  crypto.getRandomValues(a);
  return Array.from(a, (b) => b.toString(16).padStart(2, '0')).join('');
}

async function gatherContext(attachActive: boolean): Promise<{ tree: string; activePath: string | null; activeText: string; selection: string }> {
  let activePath: string | null = null, activeText = '', selection = '';
  try {
    const ed = vscode.window.activeTextEditor;
    if (attachActive && ed && ed.document.uri.scheme === 'file' && TEXT_EXT.test(ed.document.uri.path)) {
      activePath = ed.document.uri.path;
      activeText = ed.document.getText().slice(0, 12000);
      if (!ed.selection.isEmpty) selection = ed.document.getText(ed.selection).slice(0, 4000);
    }
  } catch { /* no editor */ }
  let tree = '';
  try {
    const files = await vscode.workspace.findFiles('**/*', '**/{node_modules,.git}/**', 300);
    tree = files.map((u) => u.path).filter((p) => TEXT_EXT.test(p)).slice(0, 120).join('\n');
  } catch {
    try {
      tree = vscode.workspace.textDocuments.map((d) => d.uri.path).filter((p) => TEXT_EXT.test(p)).join('\n');
    } catch { /* empty */ }
  }
  return { tree, activePath, activeText, selection };
}

function systemPrompt(
  ctx: { tree: string; activePath: string | null; activeText: string; selection: string },
  skillIds: string[],
  withTools: boolean,
  extra?: string
): string {
  let s = 'You are Cudic AI, a coding assistant inside CIDE (Cudic IDE, a browser VS Code for small web games). Be concise. ';
  s += 'When you provide a complete file, open its fence as ```lang:/workspace/path so the user can Apply it.';
  if (withTools) {
    s += '\n\nTools you can call on the open project:\n' +
      '- save_file(path, content): create or overwrite a project file (project-root relative, e.g. index.html or src/game.js). Call it with the COMPLETE new file content, never partial diffs, then reply briefly with what you saved.\n' +
      '- read_file(path): inspect any project file.\n' +
      '- list_files(): the project\'s text-file paths.\n' +
      '- search_project(query): regex search; results are path:line: text.\n' +
      '- delete_file(path) / rename_file(from, to): caret work. Deleting or renaming the project\'s only HTML entry point is blocked server-side — rewrite its contents instead.\n' +
      '- run_preview(): opens/reloads the Cudic Preview pane. Call it after your last edit so the user sees the result.\n' +
      '- get_preview_errors(): the runtime errors the current Preview run threw (uncaught errors, unhandled rejections, console.error). Call right after run_preview() when playtesting.\n' +
      '- snapshot(label): checkpoints the whole project headless. Call it BEFORE deleting or rewriting several files — the user can restore it.\n' +
      '- ask_user(question, options): one card the user clicks; use sparingly for real design branches (theme, mechanics), never for trivia.\n' +
      'Work like an agent: list/search before you edit, one file at a time with complete content, snapshot before mass rewrites, run_preview when finished, then summarize what changed in 2-3 lines. Tell the user to save their project afterwards. Use fences only when the user wants to review before applying.';
  }
  // User's custom system-prompt overlay rides right after the hand-written
  // discipline section (before skills) so both sides read coherently.
  const custom = (extra || '').trim().slice(0, 4000);
  if (custom) s += '\n\nAdditional instructions from the user (treat as first-party):\n' + custom;
  for (const id of skillIds) {
    const sk = SKILLS.find((x) => x.id === id);
    if (sk) s += '\n\n' + sk.text;
  }
  if (ctx.tree) s += '\n\nProject files:\n' + ctx.tree;
  if (ctx.activePath) s += '\n\nActive file ' + ctx.activePath + ':\n```\n' + ctx.activeText + '\n```';
  if (ctx.selection) s += '\n\nUser selection:\n```\n' + ctx.selection + '\n```';
  return s;
}

// Tools the chat can invoke directly. Paths go through the same
// normalizeApplyPath guard as the Apply button.
const TOOL_DEFS: ToolDef[] = [
  {
    name: 'save_file',
    description: 'Create or overwrite a file in the open project. Path is project-root relative.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Project-relative path, e.g. index.html or src/game.js' },
        content: { type: 'string', description: 'The complete new file content' }
      },
      required: ['path', 'content']
    }
  },
  {
    name: 'read_file',
    description: 'Read a text file from the open project to inspect its current contents.',
    parameters: {
      type: 'object',
      properties: { path: { type: 'string', description: 'Project-relative path' } },
      required: ['path']
    }
  },
  {
    name: 'list_files',
    description: 'List the text files in the open project (paths only, up to 120).',
    parameters: { type: 'object', properties: {} }
  },
  {
    name: 'search_project',
    description: 'Regex search across all project text files. Returns matching lines with path:line prefix so you can locate code fast.',
    parameters: {
      type: 'object',
      properties: { query: { type: 'string', description: 'JavaScript regular expression, e.g. "function\\s+spawn"' } },
      required: ['query']
    }
  },
  {
    name: 'delete_file',
    description: 'Delete a text file from the open project. Refuses words like node_modules, .git, package-lock.json and anything that is not a project text file.',
    parameters: {
      type: 'object',
      properties: { path: { type: 'string', description: 'Project-relative path' } },
      required: ['path']
    }
  },
  {
    name: 'rename_file',
    description: 'Move or rename a file inside the open project (read + write + delete under the hood).',
    parameters: {
      type: 'object',
      properties: {
        from: { type: 'string', description: 'Current project-relative path' },
        to: { type: 'string', description: 'New project-relative path' }
      },
      required: ['from', 'to']
    }
  },
  {
    name: 'run_preview',
    description: 'Open or reload the Cudic Preview pane with the active game file. Call this after file edits so the user can see (and you can assume) the game runs.',
    parameters: { type: 'object', properties: {} }
  },
  {
    name: 'get_preview_errors',
    description: 'Playtester feed: returns the runtime errors thrown since the current Preview run began (uncaught errors, unhandled promise rejections, console.error). Call run_preview first when you need a fresh boot, then this to read what it said.',
    parameters: { type: 'object', properties: {} }
  },
  {
    name: 'snapshot',
    description: 'Save a version snapshot of the whole project (headless, everything staged, fixed label). Do this BEFORE deleting or rewriting several files so the user can restore.',
    parameters: {
      type: 'object',
      properties: { label: { type: 'string', description: 'Short label, e.g. "before enemy refactor"' } }
    }
  },
  {
    name: 'ask_user',
    description: 'Ask the user a question mid-task when the design genuinely branches (e.g. which theme). Offer 2-3 choices, not open questions.',
    parameters: {
      type: 'object',
      properties: {
        question: { type: 'string', description: 'One-line question' },
        options: { type: 'array', items: { type: 'string' }, description: '2-3 short options' }
      },
      required: ['question', 'options']
    }
  }
];

// Prefix/suffix hunk diff for tool cards: the changed middle rendered as
// -/＋ lines with counts. Bounded so a full-file rewrite can't flood chat.
function hunkDiff(before: string, after: string, cap = 40): { added: number; removed: number; text: string } {
  const a = before.split('\n');
  const b = after.split('\n');
  let pre = 0;
  while (pre < a.length && pre < b.length && a[pre] === b[pre]) pre++;
  let suf = 0;
  while (suf < a.length - pre && suf < b.length - pre && a[a.length - 1 - suf] === b[b.length - 1 - suf]) suf++;
  const del = a.slice(pre, a.length - suf);
  const ins = b.slice(pre, b.length - suf);
  const lines: string[] = [];
  for (const l of del) {
    if (lines.length >= cap) break;
    lines.push('-' + l);
  }
  for (const l of ins) {
    if (lines.length >= cap) break;
    lines.push('+' + l);
  }
  let text = lines.join('\n');
  if (del.length + ins.length > lines.length) {
    text += '\n… (' + (del.length + ins.length - lines.length) + ' more lines)';
  }
  return { added: ins.length, removed: del.length, text };
}

async function runTool(call: ToolCall): Promise<{ ok: boolean; summary: string; payload: string; diff?: string; added?: number; removed?: number }> {
  try {
    const args = JSON.parse(call.args || '{}') as Record<string, unknown>;
    // Pathless tools first — the /workspace path guard below would reject
    // them before they ever do anything useful.
    if (call.name === 'list_files') {
      const ctx = await gatherContext(false);
      const paths = ctx.tree ? ctx.tree.split('\n') : [];
      return { ok: true, summary: 'project has ' + paths.length + ' text file(s)', payload: JSON.stringify({ files: paths }) };
    }
    if (call.name === 'search_project') {
      const q = String(args.query ?? '').trim();
      if (!q) return { ok: false, summary: 'empty query', payload: JSON.stringify({ error: 'query required' }) };
      let re: RegExp;
      try { re = new RegExp(q); } catch (e) { return { ok: false, summary: 'bad regex: ' + q, payload: JSON.stringify({ error: 'Invalid regex: ' + q }) }; }
      const files = (await vscode.workspace.findFiles('**/*', '**/{node_modules,.git}/**', 150))
        .filter((u) => TEXT_EXT.test(u.path));
      const hits: string[] = [];
      for (const f of files) {
        if (hits.length >= 60) break;
        try {
          const text = new TextDecoder().decode(await vscode.workspace.fs.readFile(f)).slice(0, 200000);
          const lines = text.split('\n');
          for (let i = 0; i < lines.length && hits.length < 60; i++) {
            if (re.test(lines[i])) hits.push(f.path + ':' + (i + 1) + ': ' + lines[i].substring(0, 240));
          }
        } catch { /* unreadable */ }
      }
      if (!hits.length) return { ok: true, summary: 'no matches for ' + q, payload: JSON.stringify({ matches: [] }) };
      return { ok: true, summary: hits.length + ' match(es) for ' + q, payload: JSON.stringify({ matches: hits }) };
    }
    if (call.name === 'run_preview') {
      await gloxRun();
      return { ok: true, summary: 'preview opened/reloaded', payload: JSON.stringify({ ok: true }) };
    }
    if (call.name === 'get_preview_errors') {
      await gloxRun(); // observe the freshest build, not a stale frame
      await new Promise<void>((r) => setTimeout(r, 1500)); // let the boot speak
      const errs = drainPreviewErrors();
      return {
        ok: true,
        summary: errs.length ? errs.length + ' runtime error(s) since boot' : 'no runtime errors since boot',
        payload: JSON.stringify({ errors: errs })
      };
    }
    if (call.name === 'snapshot') {
      const label = String(args.label ?? '').slice(0, 80);
      const ok = await createSnapshot(true, label);
      return { ok: ok, summary: ok ? 'snapshot saved' : 'snapshot failed (project not saved / nothing changed / not signed in)', payload: JSON.stringify({ ok }) };
    }
    if (call.name === 'ask_user') {
      const question = String(args.question || '').substring(0, 240);
      const options = (Array.isArray(args.options) ? args.options : []).map(String).slice(0, 3);
      const qid = 'ask' + (++askSeq);
      postToPanel({ type: 'ai:ask', id: qid, question: question, options: options.length ? options : ['continue', 'change plan'] });
      const choice = await new Promise<string>((resolve) => {
        askResolvers.set(qid, resolve);
        window.setTimeout(() => {
          if (askResolvers.get(qid) === resolve) {
            askResolvers.delete(qid);
            resolve('(no answer — user left it pending)');
          }
        }, 120000);
      });
      return { ok: true, summary: 'user replied: ' + choice, payload: JSON.stringify({ choice }) };
    }
    if (call.name.startsWith('mcp_')) {
      // Dispatch by full tool name against the catalog cache; unknown or
      // uncached names trigger a refresh so the next attempt can succeed.
      const fail = (summary: string, error?: string) => {
        void refreshMcpCatalogs();
        return { ok: false, summary: summary, payload: JSON.stringify({ ok: false, error: error || summary }) };
      };
      const hit = (mcpTools || []).find((t) => t.full === call.name);
      if (!hit) return fail('mcp tool ' + call.name + ' not in roster — tray refresh triggered, retry after /status');
      const res = await callTool(hit.server, hit.toolName, args);
      if (!res.ok) return fail('mcp ' + hit.toolName + ' failed — ' + res.text.slice(0, 100), res.text);
      return { ok: true, summary: hit.serverId + ':' + hit.toolName + ' → ' + res.text.slice(0, 80), payload: JSON.stringify({ ok: true, result: res.text }) };
    }
    const target = normalizeApplyPath(String(args.path ?? ''));
    if (!target) {
      const p = String(args.path ?? '');
      return { ok: false, summary: 'unsafe or unsupported path "' + p + '"', payload: JSON.stringify({ error: 'Unsafe or unsupported path: ' + p }) };
    }
    const rel = target.replace(/^\/workspace\//, '');
    if (call.name === 'save_file') {
      const next = String(args.content ?? '');
      let before = '';
      try {
        before = new TextDecoder().decode(await vscode.workspace.fs.readFile(vscode.Uri.file(target)));
      } catch {
        // New file: everything counts as added.
      }
      await vscode.workspace.fs.writeFile(vscode.Uri.file(target), new TextEncoder().encode(next));
      const d = hunkDiff(before, next);
      const stat = before === next ? ' (no changes)' : ' (+' + d.added + ' −' + d.removed + ')';
      return { ok: true, summary: 'saved ' + rel + stat, payload: JSON.stringify({ ok: true, path: rel }), diff: d.text, added: d.added, removed: d.removed };
    }
    if (call.name === 'read_file') {
      const bytes = await vscode.workspace.fs.readFile(vscode.Uri.file(target));
      const text = new TextDecoder().decode(bytes).slice(0, 30000);
      return { ok: true, summary: 'read ' + rel, payload: JSON.stringify({ path: rel, content: text }) };
    }
    if (call.name === 'delete_file') {
      // Never let the model delete the project's only HTML entry point or
      // any file it cannot name as a project text file.
      if (/package-lock\.json$/i.test(target))
        return { ok: false, summary: 'refused ' + rel, payload: JSON.stringify({ error: 'package-lock.json is not deletable.' }) };
      const others = (await vscode.workspace.findFiles('**/*.html', '**/{node_modules,.git}/**', 10))
        .filter((u) => TEXT_EXT.test(u.path));
      if (/\.html?$/i.test(target) && (others.length <= 1 || others[0].path === target))
        return { ok: false, summary: 'refused ' + rel, payload: JSON.stringify({ error: 'Refusing to delete the last HTML file — the project needs an entry point. Rewrite its contents instead.' }) };
      await vscode.workspace.fs.delete(vscode.Uri.file(target));
      return { ok: true, summary: 'deleted ' + rel, payload: JSON.stringify({ ok: true, path: rel }) };
    }
    if (call.name === 'rename_file') {
      const dest = normalizeApplyPath(String(args.to ?? ''));
      if (!dest) return { ok: false, summary: 'unsafe destination', payload: JSON.stringify({ error: 'Unsafe or unsupported destination path.' }) };
      const bytes = await vscode.workspace.fs.readFile(vscode.Uri.file(target));
      await vscode.workspace.fs.writeFile(vscode.Uri.file(dest), bytes);
      if (dest !== target) await vscode.workspace.fs.delete(vscode.Uri.file(target));
      return { ok: true, summary: 'renamed ' + rel + ' → ' + dest.replace(/^\/workspace\//, ''), payload: JSON.stringify({ ok: true, from: rel, to: dest.replace(/^\/workspace\//, '') }) };
    }
    return { ok: false, summary: 'unknown tool ' + call.name, payload: JSON.stringify({ error: 'Unknown tool: ' + call.name }) };
  } catch (e) {
    const msg = (e as Error).message || String(e);
    return { ok: false, summary: msg.slice(0, 120), payload: JSON.stringify({ error: msg }) };
  }
}

function normalizeApplyPath(p: string): string | null {
  const clean = p.trim().replace(/^\/+/, '').replace(/^workspace\//i, '');
  if (!clean || clean.includes('..') || !TEXT_EXT.test(clean)) return null;
  return '/workspace/' + clean;
}

let panelEl: HTMLElement | null = null;
let iframeEl: HTMLIFrameElement | null = null;

// ── MCP catalog cache (refreshed lazily, posted to the panel) ──
let mcpTools: McpToolEntry[] = [];
let mcpServers: McpServer[] = [];
let mcpFetchedAt = 0;
let mcpInflight = false;
const MCP_TTL = 10 * 60 * 1000;

function mcpToolDefs(): ToolDef[] {
  return (mcpTools || []).map((t) => ({
    name: t.full,
    description: (t.description || '') + ' [via MCP server ' + t.serverId + ']',
    parameters: t.schema as ToolDef['parameters']
  } as ToolDef));
}

async function refreshMcpCatalogs(): Promise<void> {
  if (mcpInflight) return;
  mcpInflight = true;
  try {
    const servers = loadSettings().mcp || [];
    mcpServers = servers;
    if (!servers.length) {
      mcpTools = []; mcpFetchedAt = Date.now();
      return;
    }
    const agg = await aggregateCatalog(servers);
    mcpTools = agg.tools;
    mcpFetchedAt = Date.now();
    postToPanel({
      type: 'ai:mcpState',
      lines: mcpStateLines(agg.errors.map((e) => e.url + ': ' + e.error))
    });
  } catch (e) {
    postToPanel({ type: 'ai:mcpState', lines: ['MCP refresh failed: ' + ((e as Error).message || String(e))] });
  } finally {
    mcpInflight = false;
  }
}

function mcpStateLines(errs: string[] = []): string[] {
  const st = loadSettings();
  const servers = st.mcp || [];
  if (!servers.length) return ['MCP: no tool servers configured — /mcp add <url> [key] to plug one in.'];
  const lines = ['MCP — ' + servers.length + ' server(s), ' + mcpTools.length + ' tool(s) ready.'];
  for (const url of servers.map((s) => s.url)) {
    const count = (mcpTools || []).filter((t) => t.server.url === url).length;
    lines.push('· ' + url.replace(/^[a-z]+:\/\//, '') + ' — ' + count + ' tool(s)');
  }
  for (const e of errs) lines.push('⚠ ' + e);
  return lines;
}

function postToPanel(m: unknown): void {
  try {
    iframeEl?.contentWindow?.postMessage(m, '*');
  } catch { /* panel hidden */ }
}

// Model catalogs older than this refetch in the background (see ai:ready).
// Model catalogs older than this refetch in the background (see ai:ready).
const MODEL_LIST_TTL = 24 * 3600 * 1000;

// Account sync for chat sessions: PUT the archive, and pull once per boot.
// Fire-and-forget — a failed sync never blocks chatting (local store wins).
function syncSessions(sessions: AiSession[]): void {
  if (!lastSupa) return;
  try {
    void fetch('/api/ai/sessions', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + lastSupa },
      // Capability check wrapper so 401s land in .catch, not console noise.
      keepalive: true,
      body: JSON.stringify({ sessions: sessions.map((s) => ({ id: s.id, label: s.label, created: s.created, msgs: s.msgs.slice(-80) })) })
    }).catch(() => undefined);
  } catch { /* offline */ }
}
async function pullSessions(): Promise<void> {
  if (!lastSupa) return;
  try {
    const r = await fetch('/api/ai/sessions', { headers: { Authorization: 'Bearer ' + lastSupa } });
    if (!r.ok) return;
    const j = await r.json() as { sessions?: unknown };
    const remote = normalizeSessions(j.sessions);
    if (!remote.length) return;
    const cur = loadSettings();
    const local = normalizeSessions(cur.sessions);
    // Union by id; whichever side has more turns wins per session.
    const byId = new Map<string, AiSession>();
    for (const s of local) byId.set(s.id, s);
    for (const s of remote) {
      const l = byId.get(s.id);
      if (!l || s.msgs.length > l.msgs.length) byId.set(s.id, s);
    }
    cur.sessions = [...byId.values()].slice(0, SESSIONS_MAX);
    if (!cur.sessions.some((s) => s.id === cur.activeSession)) cur.activeSession = cur.sessions[0].id;
    saveSettings(cur);
    postToPanel({ type: 'ai:state', settings: publicSettings(cur) });
  } catch { /* offline */ }
}

async function refreshModels(pid: string, st: AiSettings): Promise<void> {
  const target = presetById(pid);
  const tkey = st.keys[pid] ?? '';
  try {
    const models = await fetchModels(target, tkey, pid === st.provider ? st.baseOverride || undefined : undefined);
    const next = loadSettings();
    next.modelLists = { ...next.modelLists, [pid]: models.slice(0, 500) };
    next.fetchedAt = { ...next.fetchedAt, [pid]: Date.now() };
    saveSettings(next);
    postToPanel({ type: 'ai:modelsResult', provider: pid, models });
  } catch (e) {
    postToPanel({ type: 'ai:modelsResult', provider: pid, error: friendlyError(target.name, (e as Error).message) });
  }
}

async function handlePanelMessage(m: Record<string, unknown>): Promise<void> {
  const st = loadSettings();
  const preset: ProviderPreset = presetById(st.provider);
  const key = st.keys[st.provider] ?? '';
  if (m.type === 'ai:ready') {
    postToPanel({
      type: 'ai:init', presets: PROVIDERS, settings: publicSettings(st),
      skills: SKILLS.map((s) => ({ id: s.id, label: s.label, blurb: s.blurb }))
    });
    postToPanel({ type: 'ai:supa', ok: !!lastSupa });
    void pullSessions(); // /session archive follows the account across machines
    // MCP roster: warm the cache on boot (result lands via ai:mcpState) so
    // agent mode has external tools ready on the first chat.
    if ((st.mcp || []).length && Date.now() - mcpFetchedAt > MCP_TTL) void refreshMcpCatalogs();
    // Daily catalog refresh: stale or missing lineups for listable companies
    // (public, local, or keyed) refetch quietly in the background, staggered
    // so providers don't get hammered. Results land via ai:modelsResult.
    void (async () => {
      const cur = loadSettings();
      const due = PROVIDERS.filter((p) => {
        if (!p.modelsPath) return false;
        if (!(p.publicModels || p.loopback || cur.keys[p.id])) return false;
        const at = (cur.fetchedAt ?? {})[p.id] ?? 0;
        return Date.now() - at > MODEL_LIST_TTL;
      });
      for (let i = 0; i < due.length; i++) {
        if (i > 0) await new Promise((r) => setTimeout(r, 800));
        await refreshModels(due[i].id, loadSettings());
      }
    })();
    return;
  }
  if (m.type === 'ai:mode') {
    const want = String(m.mode || '');
    const next = loadSettings();
    if (want === 'agent' || want === 'edit' || want === 'ask') next.mode = want;
    saveSettings(next);
    postToPanel({ type: 'ai:state', settings: publicSettings(next) });
    return;
  }
  if (m.type === 'ai:mcp') {
    const next = loadSettings();
    const servers = next.mcp || [];
    const op = String(m.op || 'list');
    if (op === 'add') {
      let url = String(m.url || '').trim().replace(/\/+$/, '');
      if (!/^https?:\/\//.test(url)) {
        postToPanel({ type: 'ai:mcpState', lines: ['MCP add failed — url must start with http:// or https://'] });
        return;
      }
      if (servers.length >= 6) {
        postToPanel({ type: 'ai:mcpState', lines: ['MCP add failed — 6 servers max, remove one first.'] });
        return;
      }
      // Retyping a url without a key must not silently drop the stored one.
      const existing = servers.find((s) => s.url === url);
      const key = typeof m.key === 'string' && m.key.trim()
        ? m.key.trim()
        : existing?.key;
      next.mcp = servers.filter((s) => s.url !== url).concat([{ url: url, key: key }]);
    } else if (op === 'remove') {
      const url = String(m.url || '').trim().replace(/\/+$/, '');
      next.mcp = servers.filter((s) => s.url !== url);
    }
    saveSettings(next);
    postToPanel({ type: 'ai:state', settings: publicSettings(next) });
    if (op === 'add' || op === 'remove') {
      void refreshMcpCatalogs(); // result lands later via ai:mcpState
      return;
    }
    postToPanel({ type: 'ai:mcpState', lines: mcpStateLines() });
    return;
  }
  if (m.type === 'ai:saveSettings') {
    const next: AiSettings = {
      provider: String(m.provider || 'zen'),
      model: String(m.model || ''),
      baseOverride: String(m.baseOverride || ''),
      completeOn: m.completeOn !== false,
      completeModel: String(m.completeModel || ''),
      keys: { ...st.keys },
      modelLists: { ...st.modelLists },
      fetchedAt: { ...st.fetchedAt },
      skills: Array.isArray(m.skills)
        ? (m.skills as unknown[]).filter((x): x is string => typeof x === 'string').slice(0, 8)
        : st.skills,
      mode: typeof m.mode === 'string' && ['agent', 'edit', 'ask'].indexOf(m.mode) !== -1 ? m.mode : st.mode,
      sysExtra: typeof m.sysExtra === 'string' ? m.sysExtra.slice(0, 4000) : st.sysExtra,
      mcp: mergeMcpServers(st.mcp, m.mcp),
      sessions: st.sessions,
      activeSession: st.activeSession
    };
    void refreshMcpCatalogs();
    if (typeof m.key === 'string' && m.key) next.keys[next.provider] = m.key;
    saveSettings(next);
    postToPanel({ type: 'ai:state', settings: publicSettings(next) });
    return;
  }
  if (m.type === 'ai:session') {
    // /session ops: create | switch | rename | delete. Transcripts live
    // host-side so they survive panel reloads and sync to the account.
    const next = loadSettings();
    let sessions = normalizeSessions(next.sessions);
    if (!sessions.length) sessions = [{ id: 'main', label: 'main', created: 0, msgs: [] }];
    const op = String(m.op || '');
    if (op === 'create') {
      if (sessions.length >= SESSIONS_MAX) {
        postToPanel({ type: 'ai:state', settings: publicSettings({ ...next, sessions: sessions, activeSession: sessions.find((s) => s.id === next.activeSession) ? next.activeSession : sessions[0].id }) });
        return;
      }
      const label = String(m.label || '').replace(/\s+/g, ' ').trim().slice(0, 60) || 'session-' + (sessions.length + 1);
      const id = 's' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
      sessions.push({ id: id, label: label, created: Date.now(), msgs: [] });
      next.activeSession = id;
    } else if (op === 'switch') {
      const id = String(m.id || '');
      if (sessions.some((s) => s.id === id)) next.activeSession = id;
    } else if (op === 'rename') {
      const id = String(m.id || '');
      const label = String(m.label || '').replace(/\s+/g, ' ').trim().slice(0, 60);
      const target = sessions.find((s) => s.id === id);
      if (target && label) {
        target.label = label;
        if (next.activeSession === id) next.activeSession = id;
      }
    } else if (op === 'delete') {
      const id = String(m.id || '');
      if (sessions.length > 1) {
        sessions = sessions.filter((s) => s.id !== id);
        if (next.activeSession === id) next.activeSession = sessions[0].id;
      }
    }
    next.sessions = sessions;
    saveSettings(next);
    void syncSessions(next.sessions);
    postToPanel({ type: 'ai:state', settings: publicSettings(next) });
    return;
  }
  if (m.type === 'ai:saveHistory') {
    // Panel finished an exchange (or cleared): fold its transcript into the
    // active session and sync the blob to the account, fire-and-forget.
    const next = loadSettings();
    const sessions = normalizeSessions(next.sessions);
    if (!sessions.length) sessions.push({ id: 'main', label: 'main', created: 0, msgs: [] });
    const active = sessions.find((s) => s.id === next.activeSession) || sessions[0];
    next.activeSession = active.id;
    next.sessions = sessions;
    active.msgs = (Array.isArray(m.msgs) ? m.msgs : [])
      .slice(-80)
      .map((mm) => {
        const p = mm as { q?: unknown; a?: unknown };
        return {
          q: typeof p.q === 'string' ? p.q.slice(0, 4000) : '',
          a: typeof p.a === 'string' ? p.a.slice(0, 12000) : ''
        };
      })
      .filter((mm) => mm.q);
    saveSettings(next);
    void syncSessions(next.sessions);
    return;
  }
  if (m.type === 'ai:models') {
    // Optional provider override lets the list screen load another
    // company's lineup without switching the active provider.
    const pid = typeof m.provider === 'string' && m.provider ? m.provider : st.provider;
    await refreshModels(pid, st);
    return;
  }
  // Resolve the model, validating against the last live list so a stale or
  // typo'd ID fails here with suggestions instead of a doomed request.
  function resolveModel(): string {
    const typed = st.model.trim() || preset.models[0] || '';
    const list = st.modelLists[st.provider];
    if (typed && list && list.length && !list.includes(typed)) {
      const sug = suggestModels(typed, list);
      throw new Error(
        '\u201C' + typed + '\u201D isn\u2019t on ' + preset.name +
        (sug.length ? ' — did you mean ' + sug.join(', ') + '?' : ' — hit \u27F3 for the live list.')
      );
    }
    return typed;
  }
  if (m.type === 'ai:test') {
    try {
      const ctl = new AbortController();
      const text = await streamChat({
        preset, baseOverride: st.baseOverride || undefined, key,
        model: resolveModel(),
        messages: [{ role: 'user', content: 'Reply with exactly: ok' }],
        signal: ctl.signal, onToken: () => undefined, temperature: 0, maxTokens: 8
      });
      postToPanel({ type: 'ai:testResult', ok: true, text: text.trim().slice(0, 60) });
    } catch (e) {
      postToPanel({ type: 'ai:testResult', ok: false, error: friendlyError(preset.name, (e as Error).message) });
    }
    return;
  }
  if (m.type === 'ai:chat') {
    const id = String(m.id);
    const ctl = new AbortController();
    controllers.set(id, ctl);
    try {
      const model = resolveModel();
      const ctx = await gatherContext(m.attachActive !== false);
      const skillIds = Array.isArray(m.skills)
        ? (m.skills as unknown[]).filter((x): x is string => typeof x === 'string')
        : st.skills;
      // Tools ride only the openai-chat wire format (llm.ts gates them too).
      // Mode gates how far the model may act: ask = no tools, edit = file
      // writes only, agent = everything.
      const mode = st.mode || 'agent';
      const withTools = preset.format === 'openai-chat' && mode !== 'ask';
      // MCP tools pull from the catalog cache and only in agent mode (edit
      // mode keeps file tools only). A stale cache refreshes in the
      // background and lands for the next message, not this one.
      const mcpConfigs = withTools ? (st.mcp || []) : [];
      const mcpDefs = mode === 'agent' ? mcpToolDefs() : [];
      const tools = withTools ? TOOL_DEFS.concat(mcpDefs) : undefined;
      if (mcpDefs.length && Date.now() - mcpFetchedAt > MCP_TTL) void refreshMcpCatalogs();
      // Multi-turn memory: the panel sends its last exchanges; cap so huge
      // sessions can't blow the context window.
      const prior = Array.isArray(m.history) ? (m.history as unknown[]).slice(-8) : [];
      const messages: ChatMessage[] = [
        { role: 'system', content: systemPrompt(ctx, skillIds, withTools, st.sysExtra) }
      ];
      for (const h of prior) {
        const p = h as { q?: unknown; a?: unknown };
        const q = typeof p.q === 'string' ? p.q.trim() : '';
        const a = typeof p.a === 'string' ? p.a.trim() : '';
        if (q) messages.push({ role: 'user', content: q });
        if (a) messages.push({ role: 'assistant', content: a });
      }
      messages.push({ role: 'user', content: String(m.text || '') });
      // Tool rounds: the model may act on the project, then continue
      // chatting with the results. Bounded so a confused model can't loop.
      for (let round = 0; round < 12; round++) {
        const toolCalls: ToolCall[] = [];
        const out = await streamChat({
          preset, baseOverride: st.baseOverride || undefined, key,
          model, messages, signal: ctl.signal,
          tools: tools,
          onTools: (calls) => { toolCalls.push(...calls); },
          onToken: (t) => postToPanel({ type: 'ai:chunk', id, token: t })
        });
        if (!toolCalls.length) break;
        messages.push({ role: 'assistant', content: out, toolCalls });
        for (const tc of toolCalls) {
          const r = await runTool(tc);
          postToPanel({ type: 'ai:tool', id, name: tc.name, ok: r.ok, summary: r.summary, diff: r.diff, added: r.added, removed: r.removed });
          messages.push({ role: 'tool', toolCallId: tc.id, content: r.payload });
        }
        if (ctl.signal.aborted) throw new Error('Stopped.');
      }
      postToPanel({ type: 'ai:done', id, q: String(m.text || '') });
    } catch (e) {
      postToPanel({ type: 'ai:error', id, error: friendlyError(preset.name, (e as Error).message) });
    } finally {
      controllers.delete(id);
    }
    return;
  }
  if (m.type === 'ai:stop') {
    controllers.get(String(m.id))?.abort();
    return;
  }
  if (m.type === 'ai:answer') {
    const r = askResolvers.get(String(m.id || ''));
    if (r) {
      askResolvers.delete(String(m.id || ''));
      r(String(m.choice || ''));
    }
    return;
  }
  if (m.type === 'ai:apply') {
    const target = normalizeApplyPath(String(m.path || ''));
    if (!target) {
      postToPanel({ type: 'ai:applied', path: String(m.path || ''), ok: false, error: 'Unsafe or unknown path.' });
      return;
    }
    try {
      await vscode.workspace.fs.writeFile(vscode.Uri.file(target), new TextEncoder().encode(String(m.content ?? '')));
      void vscode.window.showInformationMessage('Cudic AI wrote ' + target);
      postToPanel({ type: 'ai:applied', path: target, ok: true });
    } catch (e) {
      postToPanel({ type: 'ai:applied', path: target, ok: false, error: (e as Error).message });
    }
  }
}
const controllers = new Map<string, AbortController>();
// Inline permission answers. ask_user is the first sender (agent tooling);
// unmatched answers are ignored.
const askResolvers = new Map<string, (choice: string) => void>();
let askSeq = 0;

function showPanel(): void {
  if (!panelEl) return;
  try {
    setPartVisibility(Parts.PANEL_PART, true);
  } catch { /* part api hiccup */ }
  panelEl.style.display = 'flex';
  // The part API fails silently (see try above): verify it actually opened
  // and say so out loud instead of swallowing the click.
  try {
    if (!isPartVisibile(Parts.PANEL_PART)) {
      vscode.window.showInformationMessage(
        'Cudic AI is on, but the bottom panel stayed shut — open it with View > Appearance > Panel, then press ✦ again.'
      );
    }
  } catch { /* unreadable state; the panel may still show */ }
}

function hidePanel(): void {
  if (panelEl) panelEl.style.display = 'none';
}

function el(html: string): HTMLElement {
  const t = document.createElement('template');
  t.innerHTML = html;
  return t.content.firstElementChild as HTMLElement;
}

// Mounts the chat panel as an overlay filling the bottom panel part.
// Called with the workbench shadow root; retries until the part exists.
export function registerCudicAi(shadowRoot: ShadowRoot): void {
  const mount = (): boolean => {
    const part = shadowRoot.querySelector('.part.panel') as HTMLElement | null;
    if (!part) return false;
    if (!panelEl) {
      if (getComputedStyle(part).position === 'static') part.style.position = 'relative';
      panelEl = el(
        '<div id="cudic-ai-panel" style="position:absolute;inset:0;display:none;flex-direction:column;' +
        'background:var(--vscode-sideBar-background,#181818);color:var(--vscode-foreground,#dbe4ff);' +
        'font-family:var(--vscode-font-family,sans-serif);font-size:13px;z-index:5;"></div>'
      );
      const bar = el(
        '<div style="display:flex;align-items:center;gap:8px;padding:8px 10px 8px 14px;font-size:11px;' +
        'font-weight:700;letter-spacing:.08em;border-bottom:1px solid var(--vscode-sideBarSectionHeader-border,#2d2d2d);">' +
        '<span>✦ CUDIC AI</span><span style="flex:1"></span></div>'
      );
      const hide = el(
        '<button title="Hide panel" style="background:transparent;border:none;cursor:pointer;font-size:15px;' +
        'color:inherit;opacity:.7;padding:2px 6px;">×</button>'
      );
      hide.addEventListener('click', hidePanel);
      bar.append(hide);
      iframeEl = document.createElement('iframe');
      iframeEl.setAttribute('sandbox', 'allow-scripts');
      iframeEl.setAttribute('title', 'Cudic AI chat');
      iframeEl.style.cssText = 'flex:1;border:none;width:100%;min-height:0;background:transparent;';
      iframeEl.srcdoc = chatHtmlRaw
        .replaceAll('__NONCE__', nonce())
        .replace('/*__TERMINAL_CSS__*/', terminalCss);
      panelEl.append(bar, iframeEl);
      part.appendChild(panelEl);
      window.addEventListener('message', (e: MessageEvent) => {
        if (e.source !== iframeEl?.contentWindow) return;
        void handlePanelMessage((e.data || {}) as Record<string, unknown>);
      });
      // No title-bar button: entry is the command palette + right-click
      // menus (cudic-ai.openChat below).
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
          id: 'cudic-ai.openChat',
          title: { value: 'Cudic AI: Open chat', original: 'Cudic AI: Open chat' },
          menu: [
            { id: MenuId.CommandPalette },
            // Right-click a file in the Explorer
            { id: MenuId.ExplorerContext, group: 'navigation' },
            // Right-click inside an editor
            { id: MenuId.EditorContext, group: 'navigation' }
          ]
        });
      }
      async run(): Promise<void> {
        mount();
        showPanel();
        // Temporary diagnostic: proves the command ran and reports what the
        // layout service thinks. Remove once opening is confirmed working.
        try {
          const vis = isPartVisibile(Parts.PANEL_PART);
          void vscode.window.showInformationMessage(
            'Cudic AI: command ran — bottom panel reads ' + (vis ? 'VISIBLE' : 'HIDDEN') + '.'
          );
        } catch { /* layout service unreadable */ }
      }
    }
  );

  // Ghost autocomplete — same provider brain, Tab to accept. Monaco-level
  // API (not the vscode layer) so it works in every workbench editor.
  let runSerial = 0;
  monaco.languages.registerInlineCompletionsProvider(
    { scheme: 'file', pattern: '**' },
    {
      async provideInlineCompletions(model, position, _context, token) {
        const st = loadSettings();
        if (!st.completeOn) return;
        if (!TEXT_EXT.test(model.uri.path)) return;
        const preset = presetById(st.provider);
        const key = st.keys[st.provider] ?? '';
        const cmodel = st.completeModel.trim() || st.model.trim();
        if (!cmodel || (!key && !preset.keyOptional)) return;
        const text = model.getValue();
        const offset = model.getOffsetAt(position);
        if (offset < 25 || token.isCancellationRequested) return;
        const myRun = ++runSerial;
        await new Promise((r) => setTimeout(r, 450));
        if (myRun !== runSerial || token.isCancellationRequested) return;
        const prefix = text.slice(Math.max(0, offset - 1500), offset);
        if (prefix.trim().length < 10) return;
        const suffix = text.slice(offset, offset + 500);
        try {
          const ctl = new AbortController();
          const sub = token.onCancellationRequested(() => ctl.abort());
          const out = await streamChat({
            preset, baseOverride: st.baseOverride || undefined, key, model: cmodel,
            messages: [
              { role: 'system', content: 'You are a code completion engine. Output ONLY the code that continues at <CURSOR>. No fences, no explanations, no repetition of existing code.' },
              { role: 'user', content: '```\n' + prefix + '⟦CURSOR⟧' + suffix + '\n```' }
            ],
            signal: ctl.signal, onToken: () => undefined, temperature: 0, maxTokens: 96
          });
          sub.dispose();
          let insert = out.replace(/^```\w*\n?/, '').replace(/\n?```$/, '').replace(/\s+$/, '');
          if (!insert) return;
          // Don't suggest what's already typed ahead.
          if (suffix.trimStart().startsWith(insert.trim()) && insert.trim()) return;
          return { items: [{ insertText: insert, range: new monaco.Range(position.lineNumber, position.column, position.lineNumber, position.column) }] };
        } catch {
          return;
        }
      }
    }
  );
}
