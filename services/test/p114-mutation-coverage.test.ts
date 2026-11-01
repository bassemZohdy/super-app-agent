import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { APPLICATION_OPERATIONS } from '../../packages/backend-kit/src/application-openapi.ts';

// P1-14: a contract is only proved when something runs it. Every mutating application operation must be driven by at least one
// behavior test or verifier script, not only by the generic input-validation sweeps, so that its success and its refusals are
// checked against the running code. A new write route without a test that calls it fails here.
const SKIP = new Set(['node_modules', 'dist', 'build', '.data', '.angular', '.git']);
const GENERIC = /(openapi|hostile|tool-mapping|mutation-coverage|input-validation|verify-application-contract|application-auth-matrix)/;

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (SKIP.has(name)) continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path, out);
    else if (/\.(ts|tsx|mjs)$/.test(path)) out.push(path);
  }
  return out;
}

const sources = [...walk('scripts'), ...walk('test'), ...walk('services/test')]
  .map(path => path.split('\\').join('/'))
  .filter(path => !GENERIC.test(path))
  .map(path => ({ path, text: readFileSync(path, 'utf8') }));

test('P1-14: every mutating application operation is driven by a behavior test or verifier', () => {
  const writes = APPLICATION_OPERATIONS.filter(operation => operation.method === 'POST');
  assert.ok(writes.length >= 15, `the mutating operations are enumerated (${writes.length})`);
  const uncovered: string[] = [];
  for (const operation of writes) {
    const base = (operation.contract ?? operation.path).replace(/\/\{[^}]+\}.*$/, '');
    const last = operation.path.split('/').filter(segment => segment && !segment.startsWith('{')).slice(-1)[0];
    const driven = sources.filter(({ text }) => text.includes(base + (operation.path.includes('{') ? '/' : '')) || text.includes(`'${base}'`) || text.includes(`/${last}`));
    if (driven.length === 0) uncovered.push(`${operation.method} ${operation.path}`);
  }
  assert.deepEqual(uncovered, [], `these write routes have no behavior test or verifier that calls them: ${uncovered.join(', ')}`);
});
