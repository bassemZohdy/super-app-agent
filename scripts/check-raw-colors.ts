/** Raw-color ratchet for the shells (P2-13). Shell source should take colors from the generated design tokens, not repeat
 *  hex, rgb or hsl values or Flutter color literals. Today's raw colors are recorded per file in a baseline; this check fails
 *  when a file gains one (or a new file has any) and when a file loses some without the baseline being lowered, so the count
 *  only goes down. `--update` rewrites the baseline. The baseline reaches empty when the shells are migrated. */
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export type Scan = { name: string; roots: string[]; files: RegExp; pattern: RegExp; skip?: RegExp };
export const SCANS: readonly Scan[] = [
  { name: 'react', roots: ['apps/shell-react/src'], files: /\.(?:css|scss|ts|tsx|html)$/, pattern: /#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{3}\b|\b(?:rgba?|hsla?)\(\s*\d/g },
  { name: 'angular', roots: ['apps/shell-angular/src'], files: /\.(?:css|scss|ts|html)$/, pattern: /#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{3}\b|\b(?:rgba?|hsla?)\(\s*\d/g },
  { name: 'flutter', roots: ['apps/shell-flutter/lib'], files: /\.dart$/, pattern: /\bColor\(0x[0-9A-Fa-f]{6,8}\)|\bColors\.(?!transparent\b)[a-zA-Z]+/g, skip: /(?:^|\/)tokens\.g\.dart$/ },
];
export const BASELINE = 'packages/ui-tokens/raw-colors.baseline.json';
export type SourceFile = { path: string; text: string };

export function countRawColors(files: readonly SourceFile[], scans: readonly Scan[] = SCANS): Record<string, number> {
  const out: Record<string, number> = {};
  for (const { path: raw, text } of files) {
    const path = raw.replaceAll('\\', '/'), scan = scans.find(s => s.roots.some(root => path.startsWith(`${root}/`)) && s.files.test(path) && !s.skip?.test(path));
    if (!scan) continue;
    const count = (text.match(scan.pattern) || []).length;
    if (count) out[path] = count;
  }
  return Object.fromEntries(Object.entries(out).sort(([a], [b]) => a.localeCompare(b)));
}

export type Verdict = { regressions: string[]; stale: string[] };
export function compareToBaseline(current: Record<string, number>, baseline: Record<string, number>): Verdict {
  const regressions: string[] = [], stale: string[] = [];
  for (const [path, count] of Object.entries(current)) if (count > (baseline[path] ?? 0)) regressions.push(`${path}: ${count} raw colors, baseline ${baseline[path] ?? 0}`);
  for (const [path, was] of Object.entries(baseline)) if ((current[path] ?? 0) < was) stale.push(`${path}: now ${current[path] ?? 0}, baseline ${was}`);
  return { regressions, stale };
}

function walk(dir: string, found: string[] = []): string[] {
  if (!existsSync(dir)) return found;
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === 'dist' || name === '.dart_tool') continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, found); else found.push(full);
  }
  return found;
}

export function collect(): SourceFile[] {
  return SCANS.flatMap(scan => scan.roots.flatMap(root => walk(root))).filter(path => statSync(path).size <= 2_000_000).map(path => ({ path, text: readFileSync(path, 'utf8') }));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const current = countRawColors(collect());
  if (process.argv.includes('--update')) { writeFileSync(BASELINE, `${JSON.stringify(current, null, 2)}\n`); console.log(`wrote ${BASELINE} (${Object.values(current).reduce((a, b) => a + b, 0)} raw colors in ${Object.keys(current).length} files)`); }
  else {
    const baseline = existsSync(BASELINE) ? JSON.parse(readFileSync(BASELINE, 'utf8')) as Record<string, number> : {};
    const { regressions, stale } = compareToBaseline(current, baseline);
    for (const line of regressions) console.error(`RAW_COLOR ${line}: use a generated design token`);
    for (const line of stale) console.error(`STALE_BASELINE ${line}: run npm run colors:baseline to lock in the improvement`);
    if (regressions.length || stale.length) process.exitCode = 1;
    else console.log(`PASS: raw shell colors stay within the baseline (${Object.values(current).reduce((a, b) => a + b, 0)} in ${Object.keys(current).length} files).`);
  }
}
