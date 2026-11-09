/* file: studio/src/build.ts
 * what: The project build step — compiles a project's TypeScript/TSX to .js and
 *   points markup at the compiled files, in memory for the preview and on disk
 *   for Save.
 * invariants: a .js this module did not generate is never overwritten, .d.ts is
 *   never compiled, and preview/save/publish all call this one function, so what
 *   you test is what ships.
 * see: AGENTS.md 8, public/docs.html#npm */

export const GENERATED_HEAD = '// generated from ';

export interface Transpiler {
  (code: string, path: string): string;
}

export function isTypeScript(path: string): boolean {
  return /\.tsx?$/i.test(path) && !/\.d\.ts$/i.test(path);
}

export function generatedPath(path: string): string {
  return path.replace(/\.tsx?$/i, '.js');
}

export function isGenerated(code: unknown): boolean {
  return typeof code === 'string' && code.startsWith(GENERATED_HEAD);
}

// Only import specifiers and src/href attributes: a game that prints "level.ts"
// on its own screen must not have that string rewritten.
export function rewriteTsRefs(code: string): string {
  const toJs = (spec: string): string =>
    /\.tsx?$/i.test(spec) && !/\.d\.ts$/i.test(spec) ? spec.replace(/\.tsx?$/i, '.js') : spec;
  return code
    .replace(/(\b(?:src|href)\s*=\s*)(["'])([^"']+)\2/gi, (m, pre: string, q: string, ref: string) => pre + q + toJs(ref) + q)
    .replace(/(\b(?:from\s+|import\s*\(\s*|import\s+))(["'])([^"']+)\2/g, (m, pre: string, q: string, spec: string) => pre + q + toJs(spec) + q);
}

const TS_URL = 'https://esm.sh/typescript@5.4.5';
let tsPromise: Promise<unknown> | null = null;

// Vite must not try to bundle the compiler: a literal import() of a URL is a
// build-time dependency, a Function-wrapped one is the browser's.
async function typeScript(): Promise<Record<string, any>> {
  if (tsPromise == null) {
    const load = new Function('u', 'return import(u)') as (u: string) => Promise<Record<string, any>>;
    tsPromise = load(TS_URL);
  }
  return (await tsPromise) as Record<string, any>;
}

// The compiler is ~7MB on esm.sh and only loads when a project has .ts in it.
export async function tsTranspiler(): Promise<Transpiler> {
  const ts = await typeScript();
  return (code: string, path: string): string =>
    ts.transpileModule(code, {
      fileName: path,
      reportDiagnostics: false,
      compilerOptions: {
        target: ts.ScriptTarget.ES2020,
        module: ts.ModuleKind.ESNext,
        jsx: ts.JsxEmit.ReactJSX,
        isolatedModules: true,
        sourceMap: false
      }
    }).outputText as string;
}

export interface BuildResult {
  files: Record<string, string | Uint8Array>;
  generated: string[];
}

export async function compileTypes(
  files: Record<string, string | Uint8Array>,
  transpile?: Transpiler
): Promise<BuildResult> {
  const sources = Object.keys(files).filter((p) => typeof files[p] === 'string' && isTypeScript(p));
  if (!sources.length) return { files, generated: [] };
  const run = transpile ?? (await tsTranspiler());
  const out: Record<string, string | Uint8Array> = { ...files };
  const generated: string[] = [];
  for (const path of sources) {
    const target = generatedPath(path);
    // A hand-written .js is not ours to replace.
    if (typeof files[target] === 'string' && !isGenerated(files[target])) continue;
    const js = rewriteTsRefs(run(String(files[path]), path)).replace(/<\/script/gi, '<\\/script');
    out[target] = GENERATED_HEAD + path + ' by Cudic — edit the .ts file, not this one\n' + js;
    generated.push(target);
  }
  // Markup and scripts that still name the source now name the build output.
  for (const path of Object.keys(out)) {
    if (!/\.(html?|m?js)$/i.test(path) || isGenerated(out[path])) continue;
    out[path] = rewriteTsRefs(String(out[path]));
  }
  return { files: out, generated };
}
