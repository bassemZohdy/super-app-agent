import test from 'node:test';
import assert from 'node:assert/strict';
import { boundedJson } from '../agent-core/src/orchestrator/contracts.ts';
import { CompatiblePlanner } from '../agent-core/src/orchestrator/planner.ts';

async function bounded<T>(promise: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([promise, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('rejection did not complete')), 1000); })]);
  } finally { clearTimeout(timer); }
}

test('oversized focused responses reject even when cancellation never finishes or fails', async () => {
  for (const behavior of ['hang', 'reject'] as const) {
    let cancelled = false;
    const response = new Response(new ReadableStream<Uint8Array>({
      start(controller) { controller.enqueue(new Uint8Array(65537)); },
      cancel() { cancelled = true; return behavior === 'hang' ? new Promise<void>(() => {}) : Promise.reject(new Error('private cancellation failure')); },
    }));
    await assert.rejects(bounded(boundedJson(response)), (error: unknown) => error instanceof Error && error.message === 'RESPONSE_TOO_LARGE');
    assert.equal(cancelled, true);
  }
});

test('oversized model responses release active slots even when cancellation hangs', async t => {
  let calls = 0, cancelled = 0;
  t.mock.method(globalThis, 'fetch', async () => {
    calls++;
    if (calls > 2) return Response.json({ choices: [{ message: { content: '{"intent":"list_fines","fineIds":[]}' } }] });
    return new Response(new ReadableStream<Uint8Array>({
      start(controller) { controller.enqueue(new Uint8Array(65537)); },
      cancel() { cancelled++; return new Promise<void>(() => {}); },
    }));
  });
  const planner = new CompatiblePlanner(new URL('http://localhost:9000/v1/'), 'synthetic');
  const messages = [{ role: 'user' as const, content: 'show fines' }];
  for (let i = 0; i < 2; i++) await assert.rejects(bounded(planner.plan(messages, [])), (error: unknown) => error instanceof Error && error.message === 'MODEL_UNAVAILABLE_OR_INVALID_PLAN');
  assert.equal((await bounded(planner.plan(messages, []))).intent, 'list_fines');
  assert.equal(cancelled, 2); assert.equal(calls, 3);
});
