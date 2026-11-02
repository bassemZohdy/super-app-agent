import test from 'node:test';
import assert from 'node:assert/strict';
import { actorContext, actorFor } from '../../packages/backend-kit/src/context.ts';
import { callDomainAsync, DomainOperationError, trackDomainOperations, type Step } from '../agent-core/src/domain-operations.ts';

test('oversized streamed domain responses are cancelled and writes remain unknown', async t => {
  const previous = process.env.DOMAIN_TRANSPORT;
  process.env.DOMAIN_TRANSPORT = 'http';
  t.after(() => { if (previous === undefined) delete process.env.DOMAIN_TRANSPORT; else process.env.DOMAIN_TRANSPORT = previous; });
  for (const [method, path, code] of [['GET', '/wallet/balance', 'DOMAIN_UNAVAILABLE'], ['POST', '/wallet/pay', 'DOMAIN_OUTCOME_UNKNOWN']] as const) {
    let cancelled = false, offset = 0;
    const content = new TextEncoder().encode(JSON.stringify({ success: true, transaction: { id: 'receipt' }, remainingBalance: 1, padding: 'x'.repeat(2 * 1024 * 1024) }));
    const fetchMock = t.mock.method(globalThis, 'fetch', async () => new Response(new ReadableStream<Uint8Array>({
      pull(controller) {
        if (offset >= content.length) { controller.close(); return; }
        controller.enqueue(content.subarray(offset, offset + 65536)); offset += 65536;
      },
      cancel() { cancelled = true; },
    }), { headers: { 'Content-Type': 'application/json' } }));
    try {
      const steps: Step[] = [];
      const result = trackDomainOperations(steps, () => actorContext.run(actorFor({ sub: 'test-user' }, 'account', 'Bearer test'),
        () => callDomainAsync('wallet', method, path)));
      await assert.rejects(result, (error: unknown) => error instanceof DomainOperationError && error.code === code);
      if (method === 'POST') assert.equal(steps[0].state, 'UNKNOWN');
      assert.equal(cancelled, true);
      assert.ok(offset < content.length, 'reading stops before the entire oversized body');
    } finally { fetchMock.mock.restore(); }
  }
});
