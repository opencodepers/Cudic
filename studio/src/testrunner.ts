/* file: studio/src/testrunner.ts
 * what: Finds a project's test files, runs them in a sandboxed frame with a
 *   tiny test()/assert harness, and hands pass/fail back to the caller.
 * invariants: tests run against the compiled project, the frame is
 *   allow-scripts only so a test never gets a live parent, and every run ends —
 *   a hung test is killed by the timeout instead of freezing Studio.
 * see: AGENTS.md 8, public/docs.html#npm */

import { compileTypes, generatedPath, isTypeScript } from './build';
import {
  drainModuleSlots,
  mapModuleImports,
  moduleDataUrls,
  moduleId,
  type ModuleSlots
} from './npmutil';

export interface TestFile {
  path: string;
  code: string;
}

export interface TestResult {
  name: string;
  ok: boolean;
  ms: number;
  error?: string;
}

export interface TestRun {
  results: TestResult[];
  loadErrors: Array<{ file: string; error: string }>;
  ms: number;
}

const TEST_NAME = /\.test\.[cm]?[jt]sx?$/i;

// Any `*.test.js` (or ts/tsx/jsx), plus everything under tests/ or test/.
// A TypeScript source is only run through its compiled sibling, never raw.
export function testFiles(files: Record<string, string | Uint8Array>): TestFile[] {
  return Object.keys(files)
    .filter((p) => typeof files[p] === 'string')
    .filter((p) => /\.[cm]?[jt]sx?$/i.test(p) && !/\.d\.ts$/i.test(p))
    .filter((p) => TEST_NAME.test(p) || /(^|\/)(test|tests)\//i.test(p))
    .filter((p) => !(isTypeScript(p) && files[generatedPath(p)] != null))
    .sort()
    .map((p) => ({ path: p, code: String(files[p]) }));
}

// Globals a test file can use. Kept deliberately small: this is a harness, not
// a framework, and anything it does not promise is Studio-internal.
const HARNESS =
  '<script>window.__cudicTests=[];window.__cudicLoadErrors=[];' +
  "window.test=function(name,fn){window.__cudicTests.push({name:String(name),fn:fn});};" +
  "window.assert=function(cond,why){if(!cond)throw new Error(why||'assertion failed');};" +
  'window.assert.equal=function(a,b,why){if(a!==b)throw new Error((why?why+\': \':\'\')+\'expected \'+JSON.stringify(b)+\', got \'+JSON.stringify(a));};' +
  '</script>';

export function runnerHtml(files: Record<string, string | Uint8Array>): string {
  const find = (ref: string): string | null => {
    const n = ref.trim().split(/[?#]/)[0].replace(/^\.\//, '').replace(/^\/+/, '').toLowerCase();
    const hit = Object.keys(files).find(
      (k) => k.toLowerCase() === n || k.toLowerCase().endsWith('/' + n)
    );
    return hit ?? null;
  };
  const mods: ModuleSlots = {};
  const tests = testFiles(files);
  for (const t of tests) {
    const id = moduleId(t.path);
    mods[id] = { path: t.path, code: mapModuleImports(t.code, t.path, find, mods) };
  }
  drainModuleSlots(files as Record<string, string>, mods, find);
  const ids = tests.map((t) => moduleId(t.path));
  const map = JSON.stringify({ imports: moduleDataUrls(mods) });
  const run =
    '<script type="module">' +
    'const ids=' + JSON.stringify(ids) + ';' +
    'const results=[];const boot=Date.now();' +
    'for(const id of ids){try{await import(id);}catch(e){window.__cudicLoadErrors.push({file:id,error:String((e&&e.message)||e)});}}' +
    'for(const t of window.__cudicTests){const at=Date.now();' +
    'try{await t.fn();results.push({name:t.name,ok:true,ms:Date.now()-at});}' +
    'catch(e){results.push({name:t.name,ok:false,ms:Date.now()-at,error:String((e&&e.message)||e)});}}' +
    "parent.postMessage({type:'cudic-tests',results:results,loadErrors:window.__cudicLoadErrors,ms:Date.now()-boot},'*');" +
    '</script>';
  return (
    '<!DOCTYPE html><html><head><meta charset="utf-8"></head><body>' +
    HARNESS +
    '<script type="importmap">' + map + '</script>' +
    run +
    '</body></html>'
  );
}

// Compile first so a .test.ts and its imports run as the preview would run them.
export async function runTests(files: Record<string, string | Uint8Array>): Promise<TestRun> {
  const built = await compileTypes(files);
  const tests = testFiles(built.files);
  if (tests.length === 0) return { results: [], loadErrors: [], ms: 0 };
  const html = runnerHtml(built.files);
  return await new Promise<TestRun>((resolve, reject) => {
    const frame = document.createElement('iframe');
    frame.setAttribute('sandbox', 'allow-scripts');
    frame.style.cssText = 'position:fixed;left:-9999px;top:0;width:8px;height:8px;border:0;';
    const timer = setTimeout(() => {
      done();
      reject(new Error('tests did not finish within 30s'));
    }, 30000);
    function onMsg(e: MessageEvent): void {
      const d = e.data as { type?: string; results?: TestResult[]; loadErrors?: TestRun['loadErrors']; ms?: number };
      if (d == null || d.type !== 'cudic-tests') return;
      done();
      resolve({ results: d.results ?? [], loadErrors: d.loadErrors ?? [], ms: d.ms ?? 0 });
    }
    function done(): void {
      clearTimeout(timer);
      window.removeEventListener('message', onMsg);
      frame.remove();
    }
    window.addEventListener('message', onMsg);
    frame.srcdoc = html;
    document.body.appendChild(frame);
  });
}
