import test from 'node:test';
import assert from 'node:assert/strict';
import { AgentClientError, FocusedAgentClient } from '../../packages/protocol-core/src/focused-agent-client.ts';
import { readEventStream } from '../../packages/protocol-core/src/sse-client.ts';

const id = '00000000-0000-4000-8000-000000000001';
const value = {
  threadId: id, status: 'complete', reply: 'Outstanding fines', messages: [{ role: 'assistant', content: 'Outstanding fines' }], approval: null, receipt: null, next: [], uiContract: 'cityside-compat-v1',
  surface: { version: '1.0.0', sessionId: id, timestamp: 1, view: { id: 'fines', type: 'SurfaceCard', children: [{ id: 'reply', type: 'Text', properties: { text: 'Outstanding fines' } }] } },
};
const signal = new AbortController().signal;

test('focused client uses authenticated POST SSE, preserves event types and waits for the authoritative result', async t => {
  const token = 'local-client-test-value';
  const client = new FocusedAgentClient(token);
  const nodes: string[] = [];
  t.mock.method(globalThis, 'fetch', async (url: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
    assert.equal(url, `/api/agent/threads/${id}/messages`);
    assert.equal(new Headers(init?.headers).get('Authorization'), `Bearer ${token}`);
    assert.equal(new Headers(init?.headers).get('Accept'), 'text/event-stream');
    assert.match(new Headers(init?.headers).get('Idempotency-Key') || '', /^[a-f0-9-]{36}$/);
    assert.equal(String(init?.body).includes(token), false);
    assert.equal(init?.redirect, 'error');
    return new Response(`event: progress\ndata: {"node":"list"}\n\nevent: result\ndata: ${JSON.stringify(value)}\n\n`, { headers: { 'Content-Type': 'text/event-stream' } });
  });
  const result = await client.transition(id, 'messages', { message: 'Show fines' }, signal, node => nodes.push(node));
  assert.equal(result.threadId, id); assert.deepEqual(nodes, ['list']);
});

test('a renewal approval and receipt are validated, and a server that sends neither yields null', async t => {
  const client = new FocusedAgentClient('local-test-value');
  const respond = (body: unknown) => t.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } }));
  respond(value);
  const plain = await client.inspect(id, signal);
  assert.equal(plain.renewalApproval, null); assert.equal(plain.renewal, null);
  const renewalApproval = { id, quote: { vehicleId: 'veh-1', amountMinor: 40000, currency: 'AED' }, expiresAt: Date.now() + 1000 };
  respond({ ...value, renewalApproval, renewal: { id, simulated: true, quote: { amountMinor: 40000, currency: 'AED' } } });
  const renewing = await client.inspect(id, signal);
  assert.equal(renewing.renewalApproval?.quote.vehicleId, 'veh-1'); assert.equal(renewing.renewal?.simulated, true);
  for (const bad of [{ renewalApproval: { ...renewalApproval, quote: { ...renewalApproval.quote, amountMinor: 0 } } }, { renewalApproval: { ...renewalApproval, quote: { amountMinor: 40000, currency: 'AED' } } }, { renewalApproval: { ...renewalApproval, expiresAt: 'soon' } }, { renewal: { id, simulated: false, quote: { amountMinor: 40000, currency: 'AED' } } }]) {
    respond({ ...value, ...bad });
    await assert.rejects(client.inspect(id, signal), AgentClientError);
  }
});

test('named SSE events reset at frame boundaries without changing unnamed event compatibility', async () => {
  const frames = [];
  for await (const frame of readEventStream(new Response('event: progress\r\ndata: one\r\n\r\ndata: two\n\n'))) frames.push(frame);
  assert.deepEqual(frames, [{ data: 'one', id: undefined, event: 'progress' }, { data: 'two', id: undefined }]);
});

test('a lost result, stream error or invalid owner/surface is refused with no automatic mutation retry', async t => {
  const client = new FocusedAgentClient('local-test-value');
  for (const body of [
    'event: progress\ndata: {"node":"execute"}\n\n',
    'event: error\ndata: {"code":"PRIVATE_FAILURE"}\n\n',
    `event: result\ndata: ${JSON.stringify({ ...value, threadId: 'another-owner-thread' })}\n\n`,
    `event: result\ndata: ${JSON.stringify({ ...value, surface: { ...value.surface, sessionId: 'another-owner-thread' } })}\n\n`,
  ]) {
    let calls = 0;
    t.mock.method(globalThis, 'fetch', async () => { calls++; return new Response(body, { headers: { 'Content-Type': 'text/event-stream' } }); });
    await assert.rejects(client.transition(id, 'resume', { approvalId: id, decision: 'approve' }, signal, () => {}), AgentClientError);
    assert.equal(calls, 1, 'never replay an unknown payment automatically');
  }
});

test('HTTP authorization failures discard upstream details', async t => {
  t.mock.method(globalThis, 'fetch', async () => new Response('private-upstream-detail', { status: 403 }));
  await assert.rejects(new FocusedAgentClient('local-test-value').inspect(id, signal), failure => failure instanceof AgentClientError && failure.code === 'ACCESS_UNAVAILABLE' && !failure.message.includes('private-upstream-detail'));
});

test('comparison shells never display malformed fine money from a focused result', async t => {
  const client = new FocusedAgentClient('local-test-value');
  for (const amountMinor of [1.5, -1, '15000']) {
    t.mock.method(globalThis, 'fetch', async () => Response.json({ ...value, fines: [{ id: 'fine-1', description: 'Synthetic fine', amountMinor }] }));
    await assert.rejects(client.inspect(id, signal), AgentClientError);
  }
});


test('focused create and inspect bound streamed JSON without trusting content length or waiting for cancellation', async t => {
  const client = new FocusedAgentClient('local-test-value');
  for (const mode of ['create', 'inspect'] as const) {
    let cancelled = false, calls = 0, produced = 0;
    const mock = t.mock.method(globalThis, 'fetch', async () => {
      calls++;
      return new Response(new ReadableStream<Uint8Array>({
        pull(controller) { if (produced >= 6) return new Promise<void>(() => {}); produced++; controller.enqueue(new Uint8Array(1024 * 1024)); },
        cancel() { cancelled = true; return new Promise<void>(() => {}); },
      }), { headers: { 'Content-Length': '1', 'Content-Type': 'application/json' } });
    });
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const deadline = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('response rejection timed out')), 3000); });
      const request = mode === 'create' ? client.create(signal) : client.inspect(id, signal);
      await assert.rejects(Promise.race([request, deadline]), error => error instanceof AgentClientError && !error.message.includes('private-upstream-detail'));
      assert.equal(cancelled, true); assert.equal(calls, 1); assert.ok(produced <= 6);
    } finally { clearTimeout(timer); mock.mock.restore(); }
  }
});

test('focused JSON accepts bounded multibyte responses and rejects invalid UTF-8 without exposing it', async t => {
  const client = new FocusedAgentClient('local-test-value');
  let mock = t.mock.method(globalThis, 'fetch', async () => Response.json({ ...value, padding: '😀'.repeat(500000) }));
  assert.equal((await client.inspect(id, signal)).threadId, id);
  mock.mock.restore();
  const [prefix, suffix] = JSON.stringify({ ...value, reply: 'bad-utf8-marker' }).split('bad-utf8-marker');
  const bytes = Buffer.concat([Buffer.from(prefix), Buffer.from([255]), Buffer.from(suffix)]);
  mock = t.mock.method(globalThis, 'fetch', async () => new Response(bytes));
  try { await assert.rejects(client.inspect(id, signal), error => error instanceof AgentClientError && !error.message.includes('private-upstream-detail')); }
  finally { mock.mock.restore(); }
});


test('focused create and inspection discard responses arriving after cancellation', async t => {
  const client = new FocusedAgentClient('local-test-value');
  for (const mode of ['create', 'inspect'] as const) {
    let release!: (response: Response) => void, calls = 0;
    const mock = t.mock.method(globalThis, 'fetch', async () => { calls++; return new Promise<Response>(resolve => { release = resolve; }); });
    const controller = new AbortController();
    const request = mode === 'create' ? client.create(controller.signal) : client.inspect(id, controller.signal);
    controller.abort();
    release(Response.json(mode === 'create' ? { threadId: id } : value));
    try { await assert.rejects(request, error => error instanceof Error && error.name === 'AbortError'); assert.equal(calls, 1); }
    finally { mock.mock.restore(); }
  }
});

test('focused actions discard progress and results that arrive after cancellation without retry', async t => {
  const controller = new AbortController(), progress: string[] = [];
  let send!: (data: Uint8Array) => void, calls = 0;
  t.mock.method(globalThis, 'fetch', async () => {
    calls++;
    return new Response(new ReadableStream<Uint8Array>({ start(stream) { send = data => { stream.enqueue(data); stream.close(); }; } }), { headers: { 'Content-Type': 'text/event-stream' } });
  });
  const pending = new FocusedAgentClient('local-test-value').transition(id, 'resume', {}, controller.signal, node => progress.push(node));
  await new Promise(resolve => setImmediate(resolve));
  controller.abort();
  send(new TextEncoder().encode(`event: progress\ndata: {"node":"execute"}\n\nevent: result\ndata: ${JSON.stringify(value)}\n\n`));
  await assert.rejects(pending, error => error instanceof Error && error.name === 'AbortError');
  assert.deepEqual(progress, []); assert.equal(calls, 1);
});


test('focused JSON bodies arriving after cancellation are not applied', async t => {
  const client = new FocusedAgentClient('local-test-value');
  for (const mode of ['create', 'inspect'] as const) {
    let send!: (bytes: Uint8Array) => void;
    const mock = t.mock.method(globalThis, 'fetch', async () => new Response(new ReadableStream<Uint8Array>({ start(stream) { send = bytes => { stream.enqueue(bytes); stream.close(); }; } })));
    const controller = new AbortController();
    const request = mode === 'create' ? client.create(controller.signal) : client.inspect(id, controller.signal);
    await new Promise(resolve => setImmediate(resolve));
    controller.abort();
    send(new TextEncoder().encode(JSON.stringify(mode === 'create' ? { threadId: id } : value)));
    try { await assert.rejects(request, error => error instanceof Error && error.name === 'AbortError'); }
    finally { mock.mock.restore(); }
  }
});

test('a pre-cancelled focused request is never dispatched', async t => {
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => { calls++; return Response.json({ threadId: id }); });
  const controller = new AbortController(); controller.abort();
  await assert.rejects(new FocusedAgentClient('local-test-value').create(controller.signal), error => error instanceof Error && error.name === 'AbortError');
  assert.equal(calls, 0);
});


test('aborted focused JSON reads report cancellation rather than a stale response error', async t => {
  let fail!: () => void;
  t.mock.method(globalThis, 'fetch', async () => new Response(new ReadableStream<Uint8Array>({ start(stream) { fail = () => stream.error(new Error('private upstream failure')); } })));
  const controller = new AbortController();
  const request = new FocusedAgentClient('local-test-value').inspect(id, controller.signal);
  await new Promise(resolve => setImmediate(resolve));
  controller.abort(); fail();
  await assert.rejects(request, error => error instanceof Error && error.name === 'AbortError');
});
