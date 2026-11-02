import test from 'node:test';
import assert from 'node:assert/strict';
import type { RedisClientType } from 'redis';
import { RedisSessionStore } from '../agent-core/src/session-store.ts';
import { createA2UIMessage } from '../../packages/protocol-core/src/a2-ui.ts';

test('concurrent subscriptions wait for connection and an in-flight unsubscribe', async t => {
  const store = new RedisSessionStore('redis://127.0.0.1:1');
  let connect!: () => void, finishUnsubscribe!: () => void, connected = false, subscribingBeforeConnect = false;
  const connecting = new Promise<void>(resolve => { connect = resolve; });
  let unsubscribeStarted = false;
  const unsubscribing = new Promise<void>(resolve => { finishUnsubscribe = resolve; });
  const handlers = new Map<string, (raw: string) => void>();
  const client = {
    on() { return this; },
    async connect() { await connecting; connected = true; },
    async subscribe(channel: string, callback: (raw: string) => void) { if (!connected) { subscribingBeforeConnect = true; throw new Error('not connected'); } handlers.set(channel, callback); },
    async unsubscribe(channel: string) { unsubscribeStarted = true; await unsubscribing; handlers.delete(channel); },
  };
  t.mock.method(store, 'connect', async () => {});
  t.mock.method(store.client, 'duplicate', () => client as unknown as RedisClientType);
  const received: string[] = [];
  const first = store.subscribe('session_one', () => received.push('first'));
  const second = store.subscribe('session_two', () => received.push('second'));
  await new Promise(resolve => setImmediate(resolve));
  connect();
  const [offFirst, offSecond] = await Promise.all([first, second]);
  assert.equal(subscribingBeforeConnect, false);
  handlers.get('superapp:session:session_one:channel')?.(JSON.stringify(createA2UIMessage('A2UI_STREAM_DELTA', 'session_one', { text: 'a' })));
  handlers.get('superapp:session:session_two:channel')?.(JSON.stringify(createA2UIMessage('A2UI_STREAM_DELTA', 'session_two', { text: 'b' })));
  assert.deepEqual(received, ['first', 'second']);
  const closing = offFirst();
  while (!unsubscribeStarted) await new Promise(resolve => setImmediate(resolve));
  const replacement = store.subscribe('session_one', () => received.push('replacement'));
  finishUnsubscribe();
  await closing;
  const offReplacement = await replacement;
  handlers.get('superapp:session:session_one:channel')?.(JSON.stringify(createA2UIMessage('A2UI_STREAM_DELTA', 'session_one', { text: 'c' })));
  assert.deepEqual(received, ['first', 'second', 'replacement']);
  await offReplacement(); await offSecond();
});

test('a failed channel subscription does not leave a false registered listener', async t => {
  const store = new RedisSessionStore('redis://127.0.0.1:1');
  let attempts = 0, called = 0;
  let deliver: ((raw: string) => void) | undefined;
  const client = {
    on() { return this; }, async connect() {},
    async subscribe(_channel: string, callback: (raw: string) => void) { if (++attempts === 1) throw new Error('subscribe failed'); deliver = callback; },
    async unsubscribe() {},
  };
  t.mock.method(store, 'connect', async () => {});
  t.mock.method(store.client, 'duplicate', () => client as unknown as RedisClientType);
  await assert.rejects(store.subscribe('session_one', () => { called++; }), /subscribe failed/);
  const off = await store.subscribe('session_one', () => { called++; });
  assert.equal(attempts, 2);
  deliver?.(JSON.stringify(createA2UIMessage('A2UI_STREAM_DELTA', 'session_one', { text: 'test' })));
  assert.equal(called, 1);
  await off();
});

test('closing during a pending connection cannot attach it to a new generation', async t => {
  const store = new RedisSessionStore('redis://127.0.0.1:1');
  let release!: () => void, connectingStarted!: () => void;
  const pending = new Promise<void>(resolve => { release = resolve; });
  const started = new Promise<void>(resolve => { connectingStarted = resolve; });
  let made = 0, subscriptions = 0;
  t.mock.method(store, 'connect', async () => {});
  t.mock.method(store.client, 'duplicate', () => {
    const generation = ++made;
    return { isOpen: false, on() { return this; }, async connect() { if (generation === 1) { connectingStarted(); await pending; } },
      async subscribe() { subscriptions++; }, async unsubscribe() {} } as unknown as RedisClientType;
  });
  const old = store.subscribe('session_one', () => {});
  const rejected = assert.rejects(old, /subscription was closed/);
  await started;
  await store.close();
  const off = await store.subscribe('session_one', () => {});
  release(); await rejected;
  assert.equal(made, 2); assert.equal(subscriptions, 1);
  await off();
});
