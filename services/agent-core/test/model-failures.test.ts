import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { CompatiblePlanner } from '../src/orchestrator/planner.ts';
import { harness } from './support.ts';

const turns = [{ role: 'user' as const, content: 'Review paying fines' }];
const valid = '{"intent":"pay_fines","fineIds":[]}';
const envelope = (content = valid, extra: Record<string, unknown> = {}) => ({ choices: [{ message: { content }, ...extra }] });
const unavailable = (error: unknown) => error instanceof Error && error.message === 'MODEL_UNAVAILABLE_OR_INVALID_PLAN';

test('compatible planner rejects incomplete or filtered output even when its JSON parses', async t => {
  for (const finish_reason of ['length', 'content_filter', 'tool_calls', null]) {
    let calls = 0;
    t.mock.method(globalThis, 'fetch', async () => { calls++; return Response.json(envelope(valid, { finish_reason })); });
    await assert.rejects(new CompatiblePlanner(new URL('http://localhost:9000/v1/'), 'synthetic').plan(turns, []), unavailable);
    assert.equal(calls, 1);
    t.mock.restoreAll();
  }
});

test('compatible planner rejects reported completion-token overrun and sends the exact bounded allowance', async t => {
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async (_url: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
    calls++;
    assert.equal(JSON.parse(String(init?.body)).max_tokens, 64);
    return Response.json({ ...envelope(), usage: { completion_tokens: 65 } });
  });
  await assert.rejects(new CompatiblePlanner(new URL('http://localhost:9000/v1/'), 'synthetic', undefined, 1000, 64).plan(turns, []), unavailable);
  assert.equal(calls, 1);
});

test('compatible planner rejects malformed, invented and oversized outputs without retry or raw error text', async t => {
  for (const content of ['not-json', '{"intent":', '{"intent":"execute_anything","fineIds":[]}', '{"intent":"pay_fines","fineIds":[],"permissions":["admin"]}', '{"intent":"pay_fines","fineIds":["fine-unrequested"]}', ' '.repeat(4001)]) {
    let calls = 0;
    t.mock.method(globalThis, 'fetch', async () => { calls++; return Response.json(envelope(content)); });
    await assert.rejects(new CompatiblePlanner(new URL('http://localhost:9000/v1/'), 'synthetic').plan(turns, []), unavailable);
    assert.equal(calls, 1);
    t.mock.restoreAll();
  }
  let cancelled = false;
  t.mock.method(globalThis, 'fetch', async () => new Response(new ReadableStream({
    start(controller) { controller.enqueue(new Uint8Array(65537)); },
    cancel() { cancelled = true; },
  })));
  await assert.rejects(new CompatiblePlanner(new URL('http://localhost:9000/v1/'), 'synthetic').plan(turns, []), unavailable);
  assert.equal(cancelled, true);
});

for (const afterHeaders of [false, true]) {
  test(`compatible planner deadline covers ${afterHeaders ? 'a stalled body after headers' : 'a provider that never sends headers'}`, async () => {
    let calls = 0;
    const server = http.createServer((request, response) => {
      calls++; request.resume();
      if (afterHeaders) { response.writeHead(200, { 'Content-Type': 'application/json' }); response.write('{"choices":'); }
    });
    await new Promise<void>(done => server.listen(0, '127.0.0.1', done));
    try {
      const port = (server.address() as { port: number }).port;
      const started = performance.now();
      await assert.rejects(new CompatiblePlanner(new URL(`http://127.0.0.1:${port}/v1/`), 'synthetic', undefined, 100).plan(turns, []), unavailable);
      assert.ok(performance.now() - started < 1500, 'The model deadline must cover response consumption');
      assert.equal(calls, 1);
    } finally {
      server.closeAllConnections();
      await new Promise<void>(done => server.close(() => done()));
    }
  });
}

test('a truncated compatible-model plan never falls back to fixtures, creates consent or reaches a business tool', async t => {
  const original = globalThis.fetch;
  let modelCalls = 0;
  t.mock.method(globalThis, 'fetch', async (url: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
    if (String(url).startsWith('http://localhost:9000/')) { modelCalls++; return Response.json(envelope(valid, { finish_reason: 'length' })); }
    return original(url, init);
  });
  const h = await harness({ planner: new CompatiblePlanner(new URL('http://localhost:9000/v1/'), 'synthetic') });
  try {
    const id = await h.thread();
    const result = await h.req(`/api/agent/threads/${id}/messages`, { message: 'Pay all my fines' });
    assert.equal(result.status, 200);
    assert.equal(result.data.status, 'model_unavailable');
    assert.equal(result.data.approval, null);
    assert.equal(result.data.receipt, null);
    for (const table of ['sa_consents', 'sa_sim_fines', 'sa_sim_payments', 'sa_sim_renewals']) {
      assert.equal((h.store.db.prepare(`SELECT count(*) AS n FROM ${table}`).get() as { n: number }).n, 0);
    }
    assert.equal(modelCalls, 1);
  } finally { await h.close(); }
});
