import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { contractRoutes, matchTemplate } from '../../packages/protocol-core/src/request-validation.ts';

// P1-14: the shells and the shared clients call the gateway by path. A path a client uses that the gateway has no request contract
// for would be a request nothing validates, or a call that can only 404. Every `/api/...` path the clients use must match a gateway
// contract. The focused agent is the one exception by design: it is served by the orchestrator router, so its client is checked
// against that router's actions instead.
const SKIP = new Set(['node_modules', 'dist', 'build', '.data', '.angular', '.git', '.dart_tool', 'test']);
const slash = (path: string) => path.split('\\').join('/');

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (SKIP.has(name)) continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path, out);
    else if (/\.(ts|tsx|dart)$/.test(path) && !/\.g\.dart$/.test(path)) out.push(path);
  }
  return out;
}

const clientSources = [...walk('apps/shell-react/src'), ...walk('apps/shell-angular/src'), ...walk('apps/shell-flutter/lib'), ...walk('packages/protocol-core/src')]
  .map(slash)
  .filter(path => !path.endsWith('request-validation.ts'));

test('P1-14: every gateway path a client calls has a gateway request contract', () => {
  const gateway = contractRoutes('agent-core');
  const used = new Map<string, Set<string>>();
  for (const file of clientSources) {
    for (const match of readFileSync(file, 'utf8').matchAll(/['"`](\/api\/[A-Za-z0-9_\-/${}.]*)/g)) {
      const path = match[1].replace(/\$\{[^}]*\}/g, 'x1').replace(/\$[A-Za-z_]+/g, 'x1').replace(/\/$/, '');
      if (path.startsWith('/api/agent')) continue; // the focused agent: checked below
      used.set(path, (used.get(path) ?? new Set()).add(file));
    }
  }
  assert.ok(used.size >= 3, `the clients' literal gateway paths are enumerated (${used.size})`);
  const unmatched = [...used].filter(([path]) => !gateway.some(route => matchTemplate(route.path, path) !== undefined))
    .map(([path, files]) => `${path} (used in ${[...files][0]})`);
  assert.deepEqual(unmatched, [], `paths a client calls that the gateway has no contract for: ${unmatched.join('; ')}`);
});

test('P1-14: every payment call the React shell makes maps to a gateway request contract', () => {
  // The payment panels call `api('overview')`, `mutate('orders/approve', ...)` and `mutate(`orders/${action}`, ...)`, which the shell
  // sends to /api/payments/<name>. A name with a placeholder (an action chosen at run time) must at least have a route family there.
  const gateway = contractRoutes('agent-core');
  const names = new Map<string, string>();
  for (const file of readdirSync('apps/shell-react/src').filter(name => /\.tsx?$/.test(name))) {
    for (const match of readFileSync(join('apps/shell-react/src', file), 'utf8').matchAll(/\b(?:api|mutate|read)\(\s*(['"`])([a-z][^'"`]*)\1/g)) {
      names.set(match[2].replace(/\$\{[^}]*\}/g, 'x1'), file);
    }
  }
  assert.ok(names.size >= 30, `the React payment calls are enumerated (${names.size})`);
  const unmatched: string[] = [];
  for (const [name, file] of names) {
    const path = `/api/payments/${name}`;
    const exact = gateway.some(route => matchTemplate(route.path, path) !== undefined);
    const family = name.endsWith('/x1') && gateway.some(route => route.path.startsWith(`/api/payments/${name.slice(0, -2)}`));
    if (!exact && !family) unmatched.push(`${name} (${file})`);
  }
  assert.deepEqual(unmatched, [], `payment calls with no gateway contract: ${unmatched.join('; ')}`);
});

test('P1-14: the focused agent client calls exactly the actions the orchestrator router serves', () => {
  const client = readFileSync('packages/protocol-core/src/focused-agent-client.ts', 'utf8');
  const router = readFileSync('services/agent-core/src/orchestrator/http.ts', 'utf8');
  const clientActions = /export type AgentAction = ([^;]+);/.exec(client)?.[1].match(/'([a-z]+)'/g)?.map(item => item.replaceAll("'", '')).sort();
  const routerActions = /threads\\\/\(\[a-f0-9-\]\{36\}\)\(\?:\\\/\(([a-z|]+)\)\)\?/.exec(router)?.[1].split('|').sort();
  assert.ok(clientActions && routerActions, 'both action lists were found');
  assert.deepEqual(clientActions, routerActions, 'the client and the router agree on the thread actions');
  assert.ok(client.includes('`/api/agent${path}`') && router.includes("'/api/agent/threads'"), 'both sides use the /api/agent thread paths');
});
