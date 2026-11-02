import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { server } from '../../services/agent-core/src/index.ts';
import { redisSessions } from '../../services/agent-core/src/session-store.ts';
import { accountIdFor } from '../../packages/backend-kit/src/context.ts';
import { createA2UIMessage } from '../../packages/protocol-core/src/a2-ui.ts';
import { readEventStream } from '../../packages/protocol-core/src/sse-client.ts';

test('Redis reconnect overlaps replay and live publication without loss or duplicates', { timeout: 15000 }, async t => {
  const previous = { ...process.env }, prefix = `stream-race:${randomUUID()}:`, sid = `stream_${randomUUID()}`;
  Object.assign(process.env, { SESSION_STORE: 'redis', REDIS_URL: process.env.TEST_REDIS_URL || 'redis://127.0.0.1:6379', SESSION_KEY_PREFIX: prefix, DEMO_AUTH: 'true', NODE_ENV: 'test' });
  const store = redisSessions()!, controller = new AbortController();
  try {
    await store.claim(sid, 'local-demo-user', accountIdFor('local-demo-user'));
    const make = (text: string) => createA2UIMessage('A2UI_STREAM_DELTA', sid, { phase: 'TOOL_EXECUTION', text });
    const previousEvent = make('previous'), overlap = make('overlap'), live = make('live');
    await store.publish(sid, previousEvent);
    const original = store.after.bind(store);
    t.mock.method(store, 'after', async (session, cursor) => { await store.publish(sid, overlap); return original(session, cursor); });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const response = await fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}/api/a2ui/stream?sessionId=${sid}`, { headers: { 'Last-Event-ID': previousEvent.id }, signal: controller.signal });
    assert.equal(response.status, 200);
    const stream = readEventStream(response);
    assert.equal(JSON.parse((await stream.next()).value!.data).type, 'A2UI_HANDSHAKE_ACK');
    assert.equal(JSON.parse((await stream.next()).value!.data).data.text, 'overlap');
    await store.publish(sid, live);
    assert.equal(JSON.parse((await stream.next()).value!.data).data.text, 'live');
    await stream.return(undefined);
  } finally {
    controller.abort(); server.closeAllConnections();
    if (server.listening) await new Promise<void>(resolve => server.close(() => resolve()));
    await store.connect(); const keys = await store.client.keys(`${prefix}*`); if (keys.length) await store.client.del(keys);
    await store.close();
    for (const key of ['SESSION_STORE', 'REDIS_URL', 'SESSION_KEY_PREFIX', 'DEMO_AUTH', 'NODE_ENV']) {
      if (previous[key] === undefined) delete process.env[key]; else process.env[key] = previous[key];
    }
  }
});
