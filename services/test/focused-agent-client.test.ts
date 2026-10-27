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
  await assert.rejects(new FocusedAgentClient('local-test-value').inspect(id, signal), failure => failure instanceof AgentClientError && !failure.message.includes('private-upstream-detail'));
});
