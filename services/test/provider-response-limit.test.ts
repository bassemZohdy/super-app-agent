import test from 'node:test';
import assert from 'node:assert/strict';
import { ProviderClient, UpstreamError } from '../../packages/backend-kit/src/provider-client.ts';
import { actorFor } from '../../packages/backend-kit/src/context.ts';

test('provider responses are bounded and unreadable writes remain unknown', async t => {
  const actor = actorFor({ sub: 'test-user' }, 'test-account', 'Bearer test');
  const client = new ProviderClient('test-client', '');
  for (const mode of ['oversized', 'malformed', 'non-object'] as const) {
    for (const [method, code] of [['GET', 'PROVIDER_UNAVAILABLE'], ['POST', 'PROVIDER_OUTCOME_UNKNOWN']] as const) {
      let cancelled = false, offset = 0;
      const content = new TextEncoder().encode(mode === 'oversized'
        ? JSON.stringify({ success: true, padding: 'x'.repeat(2 * 1024 * 1024) })
        : mode === 'malformed' ? '{invalid' : 'null');
      const fetchMock = t.mock.method(globalThis, 'fetch', async () => new Response(new ReadableStream<Uint8Array>({
        pull(controller) {
          if (offset >= content.length) { controller.close(); return; }
          controller.enqueue(content.subarray(offset, offset + 65536)); offset += 65536;
        },
        cancel() { cancelled = true; },
      }), { headers: { 'Content-Type': 'application/json' } }));
      try {
        await assert.rejects(client.call('dewa', actor, method, '/bills', method === 'POST' ? {} : undefined),
          (error: unknown) => error instanceof UpstreamError && error.status === 503 && error.code === code);
        if (mode === 'oversized') { assert.equal(cancelled, true); assert.ok(offset < content.length); }
      } finally { fetchMock.mock.restore(); }
    }
  }
  const fetchMock = t.mock.method(globalThis, 'fetch', async () => Response.json({ success: true, bills: [] }));
  try { assert.deepEqual((await client.call('dewa', actor, 'GET', '/bills')).bills, []); }
  finally { fetchMock.mock.restore(); }
});
