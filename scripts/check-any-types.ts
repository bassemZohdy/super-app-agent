/** `any` ratchet (P2-05). Explicit `any` switches the compiler off for a value, so new code should name a type or use `unknown` and
 *  narrow it. Today's uses are recorded per file in a baseline; this check fails when a file gains one (or a new file has any) and when
 *  a file loses some without the baseline being lowered, so the count only goes down. `--update` rewrites the baseline. */
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const BASELINE = 'scripts/any-types.baseline.json';
export const ROOTS = ['apps', 'packages', 'services', 'scripts', 'test', 'mini-apps'];
/** A type position holding `any`: after `:`, `as`, `<`, `,`, `|`, `&` or `=` (type alias), or as an array element type. Comments and strings are removed first. */
export const ANY_PATTERN = /(?:[:<,|&=]|\bas)\s*any\b(?!\s*[:(])|\bany\[\]/g;
export type SourceFile = { path: string; text: string };

const stripNoise = (text: string) => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1').replace(/'(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"|`(?:[^`\\]|\\[\s\S])*`/g, "''");

export function countAny(files: readonly SourceFile[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const { path: raw, text } of files) {
    const path = raw.replaceAll('\\', '/');
    if (!/\.(?:ts|tsx)$/.test(path) || /\.d\.ts$/.test(path)) continue;
    const count = (stripNoise(text).match(ANY_PATTERN) || []).length;
    if (count) out[path] = count;
  }
  return Object.fromEntries(Object.entries(out).sort(([a], [b]) => a.localeCompare(b)));
}

export type Verdict = { regressions: string[]; stale: string[] };
export function compareToBaseline(current: Record<string, number>, baseline: Record<string, number>): Verdict {
  const regressions: string[] = [], stale: string[] = [];
  for (const [path, count] of Object.entries(current)) if (count > (baseline[path] ?? 0)) regressions.push(`${path}: ${count} uses of any, baseline ${baseline[path] ?? 0}`);
  for (const [path, was] of Object.entries(baseline)) if ((current[path] ?? 0) < was) stale.push(`${path}: now ${current[path] ?? 0}, baseline ${was}`);
  return { regressions, stale };
}

function walk(dir: string, found: string[] = []): string[] {
  if (!existsSync(dir)) return found;
  for (const name of readdirSync(dir)) {
    if (['node_modules', 'dist', 'build', '.angular', '.turbo', '.dart_tool', '.data'].includes(name)) continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, found); else found.push(full);
  }
  return found;
}

export function collect(): SourceFile[] {
  return ROOTS.flatMap(root => walk(root)).filter(path => /\.(?:ts|tsx)$/.test(path) && statSync(path).size <= 2_000_000).map(path => ({ path, text: readFileSync(path, 'utf8') }));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const current = countAny(collect());
  const total = Object.values(current).reduce((a, b) => a + b, 0);
  if (process.argv.includes('--update')) { writeFileSync(BASELINE, `${JSON.stringify(current, null, 2)}\n`); console.log(`wrote ${BASELINE} (${total} uses of any in ${Object.keys(current).length} files)`); }
  else {
    const baseline = existsSync(BASELINE) ? JSON.parse(readFileSync(BASELINE, 'utf8')) as Record<string, number> : {};
    const { regressions, stale } = compareToBaseline(current, baseline);
    for (const line of regressions) console.error(`ANY_TYPE ${line}: name a type or use unknown and narrow it`);
    for (const line of stale) console.error(`STALE_BASELINE ${line}: run npm run any:baseline to lock in the improvement`);
    if (regressions.length || stale.length) process.exitCode = 1;
    else console.log(`PASS: explicit any stays within the baseline (${total} in ${Object.keys(current).length} files).`);
  }
}
