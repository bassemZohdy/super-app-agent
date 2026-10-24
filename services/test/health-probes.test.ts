import test from 'node:test';
import assert from 'node:assert/strict';
import type { Server } from 'node:http';
import { once } from 'node:events';
import { createApplicationServer } from '../../packages/backend-kit/src/application.ts';
import { createProviderServer } from '../provider-simulator/src/index.ts';

// Starts a server on an ephemeral loopback port and returns a base URL.
async function listen(server: Server, t: test.TestContext) {
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => { server.closeAllConnections(); server.close(); });
  return `http://127.0.0.1:${(server.address() as { port: number }).port}`;
}

test('application probes: /live and /ready answer without auth and /health is unchanged', async t => {
  const previous = process.env.PROVIDER_INTEGRATION;
  process.env.PROVIDER_INTEGRATION = 'true'; // integrated mode requires a JWT for business routes, probes must not
  t.after(() => { if (previous === undefined) delete process.env.PROVIDER_INTEGRATION; else process.env.PROVIDER_INTEGRATION = previous; });
  const root = await listen(createApplicationServer('service-probe', () => ({ status: 200, data: {} })), t);

  const live = await fetch(`${root}/live`);
  assert.equal(live.status, 200);
  assert.equal(live.headers.get('cache-control'), 'no-store');
  assert.deepEqual(await live.json(), { status: 'live', service: 'service-probe' });

  const ready = await fetch(`${root}/ready`);
  assert.equal(ready.status, 200);
  assert.deepEqual(await ready.json(), { status: 'ready', service: 'service-probe' });

  const health = await fetch(`${root}/health`);
  assert.equal(health.status, 200);
  assert.deepEqual(await health.json(), { status: 'ok', service: 'service-probe', integration: 'rest-providers' });
});

test('application readiness returns 503 without internal details when its handler dependency is missing', async t => {
  const root = await listen(createApplicationServer('service-probe', undefined as never), t);
  const ready = await fetch(`${root}/ready`);
  const body = await ready.text();
  assert.equal(ready.status, 503);
  assert.deepEqual(JSON.parse(body), { status: 'not_ready', service: 'service-probe' });
  assert.doesNotMatch(body, /stack|\/Users\/|\.ts|at /);
  assert.equal((await fetch(`${root}/live`)).status, 200);
});

test('provider probes: /live and /ready return 200 while the SQLite store is open, /health is unchanged', async t => {
  const { server, store } = createProviderServer('payments', ':memory:');
  t.after(() => store.close());
  const root = await listen(server, t);

  const live = await fetch(`${root}/live`);
  assert.equal(live.status, 200);
  assert.deepEqual(await live.json(), { status: 'live', provider: 'payments' });

  const ready = await fetch(`${root}/ready`);
  assert.equal(ready.status, 200);
  assert.equal(ready.headers.get('cache-control'), 'no-store');
  assert.deepEqual(await ready.json(), { status: 'ready', provider: 'payments', storage: 'sqlite' });

  const health = await fetch(`${root}/health`);
  assert.equal(health.status, 200);
  assert.deepEqual(await health.json(), { status: 'ok', provider: 'payments', storage: 'sqlite' });
});

test('provider readiness returns 503 without internal details once the SQLite store is closed, while liveness stays 200', async t => {
  // Real failure, not a mock: the store is closed so the trivial query throws inside the probe.
  const { server, store } = createProviderServer('payments', ':memory:');
  const root = await listen(server, t);
  store.close();

  const ready = await fetch(`${root}/ready`);
  const body = await ready.text();
  assert.equal(ready.status, 503);
  assert.deepEqual(JSON.parse(body), { status: 'not_ready', provider: 'payments', storage: 'sqlite' });
  assert.doesNotMatch(body, /closed|database|stack|\/Users\/|\.ts|at /i);
  assert.equal((await fetch(`${root}/live`)).status, 200);
});
