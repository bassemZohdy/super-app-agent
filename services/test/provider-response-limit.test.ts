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


test('contradictory or ambiguous provider write replies remain unknown', async t => {
  const actor = actorFor({ sub: 'test-user' }, 'test-account', 'Bearer test');
  const client = new ProviderClient('test-client', '');
  const cases = [
    { status: 200, data: { success: true, error: 'contradictory' } },
    { status: 200, data: { success: false, code: 'DECLINED', error: 'declined' } },
    { status: 409, data: { success: true, error: 'contradictory' } },
    { status: 409, data: { code: 'UNCLASSIFIED' } },
    { status: 409, data: { success: false, code: 'PROVIDER_OUTCOME_UNKNOWN', error: 'unconfirmed' } },
    { status: 408, data: { success: false, code: 'TIMEOUT', error: 'timed out' } },
    { status: 503, data: { success: false, code: 'UNAVAILABLE', error: 'unavailable' } },
  ];
  for (const sample of cases) {
    const fetchMock = t.mock.method(globalThis, 'fetch', async () => Response.json(sample.data, { status: sample.status }));
    try {
      await assert.rejects(client.call('dewa', actor, 'POST', '/payments', {}),
        (error: unknown) => error instanceof UpstreamError && error.status === 503 && error.code === 'PROVIDER_OUTCOME_UNKNOWN');
    } finally { fetchMock.mock.restore(); }
  }
  const fetchMock = t.mock.method(globalThis, 'fetch', async () => Response.json({ success: false, code: 'PAYABLE_CHANGED', error: 'changed' }, { status: 409 }));
  try {
    await assert.rejects(client.call('dewa', actor, 'POST', '/payments', {}),
      (error: unknown) => error instanceof UpstreamError && error.status === 409 && error.code === 'PAYABLE_CHANGED');
  } finally { fetchMock.mock.restore(); }
});


test('provider rejection text is not exposed in application errors', async t => {
  const actor = actorFor({ sub: 'test-user' }, 'test-account', 'Bearer test');
  const client = new ProviderClient('test-client', '');
  const privateDetail = 'example-private-provider-detail';
  t.mock.method(globalThis, 'fetch', async () => Response.json({ success: false, code: 'PAYABLE_CHANGED', error: `Internal detail: ${privateDetail}` }, { status: 409 }));
  await assert.rejects(client.call('dewa', actor, 'POST', '/payments', {}), (error: unknown) => {
    if (!(error instanceof UpstreamError)) return false;
    assert.equal(error.status, 409);
    assert.equal(error.code, 'PAYABLE_CHANGED');
    assert.equal(error.message.includes(privateDetail), false);
    return true;
  });
});
