import test from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { server } from '../agent-core/src/index.ts';
import { redisSessions } from '../agent-core/src/session-store.ts';
import { createA2UIMessage, type A2UIMessageEnvelope } from '../../packages/protocol-core/src/a2-ui.ts';
import { readEventStream } from '../../packages/protocol-core/src/sse-client.ts';

test('reconnect delivers replay and live events in order without a subscribe gap or duplicates', { timeout: 10000 }, async t => {
  for (const [key, value] of Object.entries({ SESSION_STORE: 'redis', REDIS_URL: 'redis://127.0.0.1:1', SESSION_KEY_PREFIX: 'replay-race-test:', DEMO_AUTH: 'true', NODE_ENV: 'test' })) {
    const previous = process.env[key]; process.env[key] = value;
    t.after(() => { if (previous === undefined) delete process.env[key]; else process.env[key] = previous; });
  }
  const sid = 'replay_race_session', store = redisSessions()!;
  t.mock.method(store, 'claim', async () => ({} as never));
  const event = (text: string) => createA2UIMessage('A2UI_STREAM_DELTA', sid, { phase: 'TOOL_EXECUTION', text });
  const replay = Array.from({ length: 40 }, (_, index) => event(`replay-${index}`)), overlap = event('overlap'), live = event('live');
  let callback: ((event: A2UIMessageEnvelope) => void) | undefined, subscribed = false;
  t.mock.method(store, 'subscribe', async (_sid, listener) => { callback = listener; subscribed = true; listener(overlap); return async () => {}; });
  t.mock.method(store, 'after', async () => subscribed ? [...replay, overlap] : replay);
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); });
  const controller = new AbortController();
  try {
    const response = await fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}/api/a2ui/stream?sessionId=${sid}`, { headers: { 'Last-Event-ID': 'previous' }, signal: controller.signal });
    assert.equal(response.status, 200);
    const stream = readEventStream(response);
    assert.equal(JSON.parse((await stream.next()).value!.data).type, 'A2UI_HANDSHAKE_ACK');
    const events = [];
    for (let index = 0; index < 41; index++) events.push(JSON.parse((await stream.next()).value!.data).data.text);
    await new Promise(resolve => setTimeout(resolve, 20));
    callback!(overlap); callback!(live);
    events.push(JSON.parse((await stream.next()).value!.data).data.text);
    assert.deepEqual(events, [...replay.map(item => item.data.text), 'overlap', 'live']);
    await stream.return(undefined);
  } finally { controller.abort(); }
});
