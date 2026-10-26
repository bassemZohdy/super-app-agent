/** `npm run tokens:generate` writes every shell's design constants from packages/ui-tokens/src/tokens.source.json;
 *  `npm run tokens:check` regenerates them in memory and fails when a committed output has drifted from the source (P2-13). */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { outputs, validateSource, type Layered } from '../packages/ui-tokens/src/build.ts';

const normalize = (text: string) => text.replaceAll('\r\n', '\n');

export function loadSource(): Layered {
  const source = JSON.parse(readFileSync('packages/ui-tokens/src/tokens.source.json', 'utf8')) as Layered;
  validateSource(source);
  return source;
}

/** Outputs whose committed text differs from what the source produces. */
export function drift(source: Layered, read = (path: string) => existsSync(path) ? readFileSync(path, 'utf8') : undefined): string[] {
  return Object.entries(outputs(source)).filter(([path, text]) => { const current = read(path); return current === undefined || normalize(current) !== text; }).map(([path]) => path);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const source = loadSource();
  if (process.argv.includes('--check')) {
    const stale = drift(source);
    if (stale.length) { console.error(`Design tokens are out of date; run npm run tokens:generate. Drifted: ${stale.join(', ')}`); process.exitCode = 1; }
    else console.log('PASS: generated CSS, JSON and Dart tokens match tokens.source.json.');
  } else {
    for (const [path, text] of Object.entries(outputs(source))) { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, text); console.log(`wrote ${path}`); }
  }
}
