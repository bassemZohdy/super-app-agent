import test from 'node:test';
import assert from 'node:assert/strict';
import { readEventStream, connectEventStream } from '../../packages/protocol-core/src/sse-client.ts';
import { AgentClientError, FocusedAgentClient } from '../../packages/protocol-core/src/focused-agent-client.ts';

async function within<T>(promise: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try { return await Promise.race([promise, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('stream cancellation blocked')), 3000); })]); }
  finally { clearTimeout(timer); }
}

function uncooperativeResponse(bytes: string, status = 200) {
  let cancelled = false;
  const response = new Response(new ReadableStream<Uint8Array>({
    start(controller) { if (bytes) controller.enqueue(new TextEncoder().encode(bytes)); },
    cancel() { cancelled = true; return new Promise<void>(() => {}); },
  }), { status, headers: { 'Content-Type': 'text/event-stream' } });
  return { response, wasCancelled: () => cancelled };
}

test('oversized streams and early consumer exit do not wait for cancellation', async () => {
  const oversized = uncooperativeResponse('data: ' + 'x'.repeat(1_000_001));
  await assert.rejects(within(readEventStream(oversized.response).next()), /Stream frame exceeds client limit/);
  assert.equal(oversized.wasCancelled(), true);
  const normal = uncooperativeResponse('data: first\n\n');
  const stream = readEventStream(normal.response);
  assert.equal((await stream.next()).value?.data, 'first');
  assert.equal((await within(stream.return(undefined))).done, true);
  assert.equal(normal.wasCancelled(), true);
});

test('an event with excessive empty data lines is bounded and cancelled', async () => {
  const oversized = uncooperativeResponse('data:\n'.repeat(10_001));
  await assert.rejects(within(readEventStream(oversized.response).next()), /Stream frame exceeds client limit/);
  assert.equal(oversized.wasCancelled(), true);
});

test('multiline event size includes inserted newline separators', async () => {
  const line = `data: ${'x'.repeat(100)}\n`;
  await assert.rejects(readEventStream(new Response(line.repeat(10_000) + '\n')).next(), /Stream frame exceeds client limit/);
});

test('the data-line budget resets between events', async () => {
  const stream = readEventStream(new Response(('data:\n'.repeat(10_000) + '\n').repeat(2)));
  for (let i = 0; i < 2; i++) {
    const result = await stream.next();
    assert.equal(result.done, false);
    assert.equal(result.value!.data.length, 9_999);
  }
  assert.equal((await stream.next()).done, true);
});

test('focused authorization failures do not wait for upstream cancellation', async t => {
  const refused = uncooperativeResponse('private response', 403);
  t.mock.method(globalThis, 'fetch', async () => refused.response);
  await assert.rejects(within(new FocusedAgentClient('local-test').inspect('00000000-0000-4000-8000-000000000001', new AbortController().signal)),
    (error: unknown) => error instanceof AgentClientError && error.code === 'ACCESS_UNAVAILABLE');
  assert.equal(refused.wasCancelled(), true);
});

test('terminal stream authorization responses are cancelled without consuming their bodies', async t => {
  const refused = uncooperativeResponse('private response', 401);
  t.mock.method(globalThis, 'fetch', async () => refused.response);
  const errors: string[] = [];
  await within(connectEventStream({ url: 'http://localhost/stream', sessionId: 'test-session', getToken: () => 'test', signal: new AbortController().signal, onMessage: () => {}, onError: error => errors.push(error.message) }));
  assert.deepEqual(errors, ['Stream authorization/request rejected (401)']);
  assert.equal(refused.wasCancelled(), true);
});


test('focused stream errors remain unconfirmed without waiting for cancellation or retrying', async t => {
  const failed = uncooperativeResponse('event: error\ndata: {"code":"PRIVATE"}\n\n');
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => { calls++; return failed.response; });
  await assert.rejects(within(new FocusedAgentClient('local-test').transition('00000000-0000-4000-8000-000000000001', 'resume', {}, new AbortController().signal, () => {})),
    (error: unknown) => error instanceof AgentClientError && /not confirmed/.test(error.message));
  assert.equal(failed.wasCancelled(), true); assert.equal(calls, 1);
});

test('focused actions discard a non-streaming response without retrying', async t => {
  let cancelled = false, calls = 0;
  t.mock.method(globalThis, 'fetch', async () => {
    calls++;
    return new Response(new ReadableStream<Uint8Array>({ cancel() { cancelled = true; return new Promise<void>(() => {}); } }), { headers: { 'Content-Type': 'application/json' } });
  });
  await assert.rejects(within(new FocusedAgentClient('local-test').transition('00000000-0000-4000-8000-000000000001', 'resume', {}, new AbortController().signal, () => {})),
    (error: unknown) => error instanceof AgentClientError && /stream was interrupted/.test(error.message));
  assert.equal(cancelled, true); assert.equal(calls, 1);
});

test('stale cursor and terminal responses are cancelled before reconnect or stop', async t => {
  const stale = uncooperativeResponse('stale response', 409), refused = uncooperativeResponse('private response', 401);
  const requests: Headers[] = [];
  t.mock.method(globalThis, 'fetch', async (_url, init) => {
    requests.push(new Headers(init?.headers));
    if (requests.length === 1) return new Response('id: cursor-1\ndata: {"id":"event-1","type":"A2UI_STREAM_DELTA","timestamp":1,"data":{"phase":"TOOL_EXECUTION","text":"test"},"sessionId":"test-session"}\n\n', { headers: { 'Content-Type': 'text/event-stream' } });
    return requests.length === 2 ? stale.response : refused.response;
  });
  await within(connectEventStream({ url: 'http://localhost/stream', sessionId: 'test-session', getToken: () => 'test', signal: new AbortController().signal, onMessage: () => {} }));
  assert.equal(requests[1].get('Last-Event-ID'), 'cursor-1');
  assert.equal(requests[2].get('Last-Event-ID'), null);
  assert.equal(stale.wasCancelled(), true); assert.equal(refused.wasCancelled(), true);
});


test('closing a stream while token acquisition is pending returns promptly and never connects', async t => {
  const controller = new AbortController();
  let release!: (value: string) => void, fetches = 0, started = false;
  const token = new Promise<string>(resolve => { release = resolve; });
  t.mock.method(globalThis, 'fetch', async () => { fetches++; return new Response('', { status: 401 }); });
  const run = connectEventStream({ url: 'http://localhost/stream', sessionId: 'test-session', getToken: () => { started = true; return token; }, signal: controller.signal, onMessage: () => {} });
  await Promise.resolve(); assert.equal(started, true);
  controller.abort();
  await within(run);
  release('late-test-token');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(fetches, 0, 'late authentication must not start a request after closure');
});

test('closing a stream tolerates a later rejected token request', async t => {
  const controller = new AbortController();
  let rejectToken!: (error: Error) => void, fetches = 0, started = false;
  const token = new Promise<string>((_resolve, reject) => { rejectToken = reject; });
  t.mock.method(globalThis, 'fetch', async () => { fetches++; return new Response('', { status: 401 }); });
  const run = connectEventStream({ url: 'http://localhost/stream', sessionId: 'test-session', getToken: () => { started = true; return token; }, signal: controller.signal, onMessage: () => {} });
  await Promise.resolve(); assert.equal(started, true);
  controller.abort();
  await within(run);
  rejectToken(new Error('private token failure'));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(fetches, 0);
});
