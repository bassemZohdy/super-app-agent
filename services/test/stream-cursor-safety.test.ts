import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { connectEventStream, readEventStream } from '../../packages/protocol-core/src/sse-client.ts';

test('coalesced small events are accepted while oversized frames remain bounded', async () => {
  const frame = `data: ${'x'.repeat(1000)}\n\n`;
  const response = new Response(new ReadableStream<Uint8Array>({
    start(controller) { controller.enqueue(new TextEncoder().encode(frame.repeat(1100))); controller.close(); },
  }));
  let count = 0;
  for await (const event of readEventStream(response)) { assert.equal(event.data.length, 1000); count++; }
  assert.equal(count, 1100);
  const oversized = new Response(new ReadableStream<Uint8Array>({
    start(controller) { controller.enqueue(new TextEncoder().encode('data: ' + 'x'.repeat(600_000))); controller.enqueue(new TextEncoder().encode('x'.repeat(400_001))); controller.close(); },
  }));
  await assert.rejects(readEventStream(oversized).next(), /Stream frame exceeds client limit/);
  const multiline = new Response(`data: ${'x'.repeat(500_001)}\ndata: ${'y'.repeat(500_001)}\n\n`);
  await assert.rejects(readEventStream(multiline).next(), /Stream frame exceeds client limit/);
});

test('invalid cursor values reset replay without stopping later events', async () => {
  const response = new Response('id: previous-1\ndata: first\n\nid: ' + 'x'.repeat(129) + '\ndata: second\n\nid: valid_3\ndata: third\n\n');
  const frames = [];
  for await (const frame of readEventStream(response)) frames.push(frame);
  assert.deepEqual(frames, [
    { id: 'previous-1', data: 'first' },
    { id: undefined, invalidId: true, data: 'second' },
    { id: 'valid_3', data: 'third' },
  ]);
});

for (const [cursor, validJson] of [['x'.repeat(129), true], ['unicode-\u0645', true], ['bad\u0000id', true], ['bad\tid', false]] as const) {
  test(`unsafe replay cursor is cleared for ${validJson ? 'readable' : 'unreadable'} events`, async t => {
    const requests: Headers[] = [], delivered: unknown[] = [], errors: string[] = [];
    t.mock.method(globalThis, 'fetch', async (_url, init) => {
      requests.push(new Headers(init?.headers));
      if (requests.length > 1) return new Response('', { status: 401 });
      const data = validJson ? '{"sessionId":"test-session","type":"test"}' : '{invalid';
      return new Response(`id: previous-1\ndata: {"sessionId":"test-session","type":"test"}\n\nid: ${cursor}\ndata: ${data}\n\n`, { headers: { 'Content-Type': 'text/event-stream' } });
    });
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 3000);
    try { await connectEventStream({ url: 'http://localhost/stream', sessionId: 'test-session', getToken: () => 'test', signal: controller.signal, onMessage: message => delivered.push(message), onError: error => errors.push(error.message) }); }
    finally { clearTimeout(timer); }
    assert.equal(requests.length, 2);
    assert.equal(requests[1].get('Last-Event-ID'), null, 'reconnect requests a fresh snapshot without an unsafe or stale cursor');
    assert.equal(delivered.length, validJson ? 2 : 1);
    assert.ok(errors.some(message => /cursor/i.test(message)));
  });
}


test('real HTTP reconnect requests a fresh snapshot after an invalid event ID', async t => {
  const cursors: Array<string | undefined> = [], delivered: number[] = [];
  const server = http.createServer((request, response) => {
    cursors.push(request.headers['last-event-id'] as string | undefined);
    response.writeHead(200, { 'Content-Type': 'text/event-stream' });
    if (cursors.length === 1) response.end(`id: good-1\ndata: {"sessionId":"test-session","n":1}\n\nid: ${'x'.repeat(129)}\ndata: {"sessionId":"test-session","n":2}\n\n`);
    else response.end('data: {"sessionId":"test-session","n":3}\n\n');
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => { server.closeAllConnections(); server.close(); });
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 5000);
  try {
    await connectEventStream({ url: `http://127.0.0.1:${(server.address() as AddressInfo).port}/stream`, sessionId: 'test-session', getToken: () => 'test', signal: controller.signal, onMessage: message => {
      const n = (message as unknown as { n: number }).n; delivered.push(n); if (n === 3) controller.abort();
    } });
  } finally { clearTimeout(timer); }
  assert.deepEqual(cursors, [undefined, undefined]);
  assert.deepEqual(delivered, [1, 2, 3]);
});

test('a failed handler retains the last successfully handled cursor', async t => {
  const cursors: Array<string | null> = [];
  t.mock.method(globalThis, 'fetch', async (_url, init) => {
    cursors.push(new Headers(init?.headers).get('Last-Event-ID'));
    if (cursors.length > 1) return new Response('', { status: 401 });
    return new Response(`id: handled-1\ndata: {"sessionId":"test-session","n":1}\n\nid: ${'x'.repeat(129)}\ndata: {"sessionId":"test-session","n":2}\n\n`, { headers: { 'Content-Type': 'text/event-stream' } });
  });
  await connectEventStream({ url: 'http://localhost/stream', sessionId: 'test-session', getToken: () => 'test', signal: new AbortController().signal, onMessage: message => {
    if ((message as unknown as { n: number }).n === 2) throw new Error('handler failed');
  } });
  assert.deepEqual(cursors, [null, 'handled-1']);
});
