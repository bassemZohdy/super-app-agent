import test from 'node:test';
import assert from 'node:assert/strict';
import type { Server } from 'node:http';
import { once } from 'node:events';
import { createApplicationServer } from '../../packages/backend-kit/src/application.ts';

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

async function listen(server: Server, t: test.TestContext) {
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => { server.closeAllConnections(); server.close(); });
  return `http://127.0.0.1:${(server.address() as { port: number }).port}`;
}

test('application probes carry a generated X-Request-Id', async t => {
  const root = await listen(createApplicationServer('service-probe', () => ({ status: 200, data: {} })), t);
  const ids = new Set<string>();
  for (const path of ['/health', '/live', '/ready']) {
    const response = await fetch(`${root}${path}`);
    assert.equal(response.status, 200);
    const requestId = response.headers.get('x-request-id');
    assert.match(requestId ?? '', uuidPattern);
    assert.ok(!ids.has(requestId!));
    ids.add(requestId!);
    await response.arrayBuffer();
  }
});

test('application echoes a valid supplied X-Request-Id unchanged', async t => {
  const root = await listen(createApplicationServer('service-probe', () => ({ status: 200, data: {} })), t);
  for (const requestId of ['caller-ABC_123.id', 'a'.repeat(200)]) {
    const response = await fetch(`${root}/live`, { headers: { 'X-Request-Id': requestId } });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('x-request-id'), requestId);
    await response.arrayBuffer();
  }
});

test('application replaces invalid X-Request-Id headers with fresh IDs', async t => {
  const root = await listen(createApplicationServer('service-probe', () => ({ status: 200, data: {} })), t);
  const ids = new Set<string>();
  for (const supplied of ['a'.repeat(201), 'bad id', 'bad"id']) {
    const response = await fetch(`${root}/live`, { headers: { 'X-Request-Id': supplied } });
    assert.equal(response.status, 200);
    const requestId = response.headers.get('x-request-id');
    assert.notEqual(requestId, supplied);
    assert.match(requestId ?? '', uuidPattern);
    assert.ok(!ids.has(requestId!));
    ids.add(requestId!);
    await response.arrayBuffer();
  }
});

test('unauthenticated integrated business requests carry X-Request-Id', async t => {
  const previous = process.env.PROVIDER_INTEGRATION;
  process.env.PROVIDER_INTEGRATION = 'true';
  t.after(() => { if (previous === undefined) delete process.env.PROVIDER_INTEGRATION; else process.env.PROVIDER_INTEGRATION = previous; });
  const root = await listen(createApplicationServer('service-wallet', () => ({ status: 200, data: {} })), t);
  const response = await fetch(`${root}/wallet/balance`);
  assert.equal(response.status, 401);
  assert.match(response.headers.get('x-request-id') ?? '', uuidPattern);
  assert.deepEqual(await response.json(), { success: false, code: 'UNAUTHENTICATED', error: 'A signed-in user token is required.' });
});
