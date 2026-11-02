import test from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { server, sseClients } from '../agent-core/src/index.ts';
import { redisSessions } from '../agent-core/src/session-store.ts';

test('pending subscriptions reserve capacity and late completion is released after disconnect', { timeout: 15000 }, async t => {
  const settings = { SESSION_STORE: 'redis', REDIS_URL: 'redis://127.0.0.1:1', SESSION_KEY_PREFIX: 'stream-admission-test:', DEMO_AUTH: 'true', NODE_ENV: 'test' };
  for (const [key, value] of Object.entries(settings)) {
    const previous = process.env[key]; process.env[key] = value;
    t.after(() => { if (previous === undefined) delete process.env[key]; else process.env[key] = previous; });
  }
  const store = redisSessions()!;
  t.mock.method(store, 'claim', async () => ({} as never));
  let started = 0, unsubscribed = 0, release!: () => void;
  const pending = new Promise<void>(resolve => { release = resolve; });
  t.mock.method(store, 'subscribe', async () => { started++; await pending; return async () => { unsubscribed++; }; });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); });
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/a2ui/stream?sessionId=stream_pending_123`;
  const controllers = Array.from({ length: 5 }, () => new AbortController());
  const requests = controllers.map(controller => fetch(url, { signal: controller.signal }).catch(() => undefined));
  const deadline = Date.now() + 5000;
  try {
    while (started < 5 && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 10));
    assert.equal(started, 5);
    assert.equal((await fetch(url)).status, 429);
    controllers.forEach(controller => controller.abort());
    await Promise.all(requests);
    while (sseClients.has('stream_pending_123') && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 10));
    assert.equal(sseClients.has('stream_pending_123'), false);
    release();
    while (unsubscribed < 5 && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 10));
    assert.equal(unsubscribed, 5);
    const replacement = new AbortController(); controllers.push(replacement);
    assert.equal((await fetch(url, { signal: replacement.signal })).status, 200);
  } finally { controllers.forEach(controller => controller.abort()); release(); }
});
