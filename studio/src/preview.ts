/* file: studio/src/preview.ts
 * what: The preview document builder — inlines a project's local css/js, maps
 *   multi-file ES modules, applies package.json pins, builds TypeScript and
 *   swaps binary siblings for data: URLs.
 * invariants: the open file's live editor text overlays its slot; remote and
 *   absolute refs pass through untouched; data: URLs only, because the preview
 *   frame is sandboxed without allow-same-origin.
 * see: AGENTS.md 8, public/run.html (same algorithm for published games) */

import { collectBinaryFiles, collectTextFiles, mimeOf } from './project';
import {
  importMapNames,
  needsModule,
  splitImports,
  rewriteBareImports,
  mapModuleImports,
  drainModuleSlots,
  moduleDataUrls,
  finishModuleMap,
  parsePackageJson,
  dependencyPins,
  dependencyImportMap,
  type ModuleSlots
} from './npmutil';
import { compileTypes, generatedPath, isTypeScript } from './build';

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function normalizeRef(ref: string): string {
  return ref
    .trim()
    // 'app.js?v=3' names app.js — same rule as the player (public/run.html).
    .split(/[?#]/)[0]
    .replace(/^\.\//, '')
    .replace(/^\/+/, '')
    .replace(/^workspace\//i, '');
}

// Rewrite relative asset references (src/href/poster/url()) to data: URLs
// of the binary siblings in the workspace — HTML/CSS static refs only;
// paths constructed in JS need absolute game-assets URLs after save.
// data: URLs (not blob:) because the preview iframe is sandboxed without
// allow-same-origin — parent-created blob URLs are blocked there by design.
function toDataUrl(mime: string, bytes: Uint8Array): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as string);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(new Blob([bytes as unknown as BlobPart], { type: mime }));
  });
}

async function injectAssetUrls(html: string): Promise<string> {
  const bins = await collectBinaryFiles();
  const keys = Object.keys(bins);
  if (keys.length === 0 && !/__SCRATCH_ASSETS__/.test(html)) return html;
  const data = new Map<string, string>();
  for (const k of keys) {
    data.set(k, await toDataUrl(mimeOf(k), bins[k]));
  }
  // Runtime-fetched assets (Scratch imports) name their files by path, and a
  // sandboxed frame can't fetch workspace files — hand the runtime the map.
  if (/__CUDIC_BIN__|__SCRATCH_ASSETS__/.test(html)) {
    const map: Record<string, string> = {};
    for (const [k, v] of data) map[k] = v;
    const tag = '<script>window.__CUDIC_BIN__ = ' + JSON.stringify(map).replace(/<\//g, '<\\/') + ';<\/script>';
    html = /<\/head\s*>/i.test(html) ? html.replace(/<\/head\s*>/i, tag + '</head>') : tag + html;
  }
  // Scratch projects: project.json is no longer inlined in assets.js, so
  // inject it as __SCRATCH_PROJECT__ for the preview frame.
  if (/__SCRATCH_ASSETS__/.test(html)) {
    const textFiles = await collectTextFiles();
    const pj = textFiles['project.json'];
    if (typeof pj === 'string') {
      const tag = '<script>window.__SCRATCH_PROJECT__ = ' + pj.replace(/<\//g, '<\\/') + ';<\/script>';
      html = /<\/head\s*>/i.test(html) ? html.replace(/<\/head\s*>/i, tag + '</head>') : tag + html;
    }
  }
  const byNorm = new Map(keys.map((k) => [k.toLowerCase(), k]));
  const swap = (raw: string): string => {
    const hit = byNorm.get(normalizeRef(raw).toLowerCase());
    return hit != null ? (data.get(hit) as string) : raw;
  };
  const external = /^(https?:|data:|blob:|#)/i;
  return html
    .replace(/(src|href|poster)\s*=\s*(["'])([^"']+)\2/gi, (m, a, q, ref) => {
      if (external.test(ref)) return m;
      return a + '=' + q + swap(ref) + q;
    })
    .replace(/url\(\s*(["']?)([^)"']+)\1\s*\)/gi, (m, q, ref) => {
      if (external.test(ref)) return m;
      return 'url(' + (q || '') + swap(ref) + (q || '') + ')';
    });
}

function lookupFile(project: Record<string, string>, ref: string): string | null {
  const n = normalizeRef(ref);
  if (project[n] != null) return n;
  const l = n.toLowerCase();
  for (const k of Object.keys(project)) {
    if (k.toLowerCase() === l) return k;
  }
  return null;
}

const REMOTE_REF = /^(https?:|data:|blob:|#|[a-z][a-z0-9+.-]*:|\/\/)/i;

// Preview runs the project: local css/js siblings get inlined, the open
// file's live editor text overlays its slot (no save needed). Remote URLs,
// CDNs and importmaps pass through untouched.
async function assemble(baseHtml: string, selfName: string, selfCode: string): Promise<string> {
  const project = await collectTextFiles();
  // The open file's live editor text wins over what is on disk.
  const files: Record<string, string> = { ...project };
  if (selfName) files[selfName] = selfCode;
  // TypeScript/TSX projects build before every render, in memory: the preview
  // runs the same generated .js that Save writes. A project with no .ts files
  // never loads the compiler.
  let all: Record<string, string> = files;
  try {
    all = (await compileTypes(files)).files as Record<string, string>;
  } catch {
    // Compiler unavailable (offline): preview the sources unchanged.
  }
  const selfKey = selfName !== '' && isTypeScript(selfName) ? generatedPath(selfName) : selfName;
  const selfJs = isTypeScript(selfName) ? (all[selfKey] ?? selfCode) : selfCode;
  const selfLower = selfKey.toLowerCase();
  const find = (ref: string): string | null => lookupFile(all, ref);
  const mods: ModuleSlots = {};
  const basePath = /\.html?$/i.test(selfName) ? selfName : 'index.html';
  let cssUsed = false;
  let jsUsed = false;
  const sibling = (ref: string, markUsed: () => void): { path: string; code: string } | null => {
    const hit = find(ref);
    if (hit == null) return null;
    if (hit.toLowerCase() === selfLower) markUsed();
    return { path: hit, code: all[hit] };
  };
  let html = baseHtml.replace(
    /<link\b[^>]*rel\s*=\s*(["'])stylesheet\1[^>]*href\s*=\s*(["'])([^"']+)\2[^>]*>/gi,
    (m, _q1, _q2, ref) => {
      if (REMOTE_REF.test(ref)) return m;
      const css = sibling(ref, () => {
        cssUsed = true;
      });
      if (css == null) return m;
      return '<style>' + css.code.replace(/<\/style/gi, '<\\/style') + '</style>';
    }
  );
  html = html.replace(
    /<script\b([^>]*)src\s*=\s*(["'])([^"']+)\2([^>]*)>\s*<\/script\s*>/gi,
    (m, pre, _q, ref, post) => {
      if (REMOTE_REF.test(ref)) return m;
      const js = sibling(ref, () => {
        jsUsed = true;
      });
      if (js == null) return m;
      return scriptTag(pre + post, mapModuleImports(js.code, js.path, find, mods));
    }
  );
  if (/\.css$/i.test(selfName) && !cssUsed) {
    const tag = '<style>' + selfCode.replace(/<\/style/gi, '<\\/style') + '</style>';
    html = /<\/head\s*>/i.test(html) ? html.replace(/<\/head\s*>/i, tag + '</head>') : html + tag;
  }
  if ((/\.m?jsx?$/i.test(selfName) || isTypeScript(selfName)) && !jsUsed) {
    const tag = scriptTag('', mapModuleImports(selfJs, selfKey, find, mods));
    html = /<\/body\s*>/i.test(html) ? html.replace(/<\/body\s*>/i, tag + '</body>') : html + tag;
  }
  // `package.json` dependencies become import-map entries at the version the
  // project declared, so a project runs the React it was written against, not
  // today's latest. Bare specifiers then stay bare — the browser resolves them.
  const pkg = parsePackageJson(files['package.json']);
  const pins = dependencyPins(pkg);
  const pkgMap = dependencyImportMap(pkg);
  const declared = importMapNames(baseHtml);
  const pinMap: Record<string, string> = {};
  // A hand-written importmap in the project wins over the file: the author
  // said what they meant.
  for (const key of Object.keys(pkgMap)) if (!declared.has(key)) pinMap[key] = pkgMap[key];
  // Our ids must survive the npm pass, which would otherwise read `cudic~a.js`
  // as a package name and point it at esm.sh.
  const skip = new Set([...declared, ...Object.keys(mods), ...Object.keys(pins)]);
  html = rewriteBareImports(html, skip, (ref) => REMOTE_REF.test(ref) || ref.startsWith('.'));
  // `<script>` blocks written straight into the HTML resolve from its own folder.
  html = html.replace(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi, (m, attrs: string, code: string) =>
    /\bsrc\s*=/.test(attrs) ? m : '<script' + attrs + '>' + mapModuleImports(code, basePath, find, mods) + '</script>'
  );
  drainModuleSlots(all, mods, find);
  html = finishModuleMap(html, { ...pinMap, ...moduleDataUrls(mods) });
  return injectAssetUrls(html);
}

// Inline JS carrying static import/export (or import.meta) needs
// type="module" — a plain <script> throws on it. Existing type= wins.
function scriptTag(attrs: string, js: string): string {
  const safe = js.replace(/<\/script/gi, '<\\/script');
  if (needsModule(js) && !/\btype\s*=/i.test(attrs)) attrs += ' type="module"';
  return '<script' + attrs + '>' + safe + '</script>';
}

function legacySingle(name: string, code: string): string {
  if (/\.css$/.test(name)) {
    return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>${code}</style></head><body><h1>style preview</h1></body></html>`;
  }
  if (/\.m?jsx?$/.test(name) || name === 'untitled') {
    // Static imports can't sit inside try{} (only module top level is
    // legal), so hoist them above the console shims. Always a module:
    // harmless for plain scripts, required for import/export ones.
    const parts = splitImports(code);
    const head = parts.head ? parts.head.replace(/<\/script/gi, '<\\/script') + '\n' : '';
    const body = parts.body.replace(/<\/script/gi, '<\\/script');
    return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>body{background:#0d1021;color:#dbe4ff;font-family:monospace;padding:12px}#err{color:#ff7b7b;white-space:pre-wrap}</style></head><body><div id="out"></div><div id="err"></div><script type="module">
${head}const out=document.getElementById('out'),err=document.getElementById('err');
const show=(v)=>{const d=document.createElement('div');d.textContent=typeof v==='object'?JSON.stringify(v):String(v);out.append(d);};
console.log=(...a)=>a.forEach(show);console.error=(...a)=>{const d=document.createElement('div');d.style.color='#ff7b7b';d.textContent=a.join(' ');err.append(d);};
window.onerror=(m)=>{err.textContent=String(m);};
try{${body}\n}catch(e){err.textContent=String(e&&e.stack||e);}</script></body></html>`;
  }
  return `<!DOCTYPE html><html><body><pre>${esc(code)}</pre></body></html>`;
}

// Preview always runs the project's index.html when one exists.
export async function previewHtmlFor(name: string, code: string): Promise<string> {
  if (/\.html?$/.test(name)) return assemble(code, name, code);
  const project = await collectTextFiles();
  const entry = project['index.html'];
  if (entry == null) return legacySingle(name, code);
  if (/\.css$/i.test(name) || /\.[cm]?[jt]sx?$/i.test(name)) return assemble(entry, name, code);
  return assemble(entry, '', '');
}
