import test from 'node:test';
import assert from 'node:assert/strict';
import { ProviderClient, UpstreamError } from '../../packages/backend-kit/src/provider-client.ts';
import { actorFor } from '../../packages/backend-kit/src/context.ts';
import { callsFor, clearCalls } from '../../packages/backend-kit/src/connections.ts';

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
    { status: 409, data: { success: false, code: 'UNCLASSIFIED', error: 'unclassified' } },
    { status: 403, data: { success: false, error: 'unclassified' } },
    { status: 403, data: { success: false, code: 'ACCOUNT_RESTRICTED', error: 'restricted' } },
    { status: 403, data: { success: false, code: 'PAYABLE_CHANGED', error: 'forbidden' } },
    { status: 409, data: { success: false, code: 'ELIGIBILITY_CHANGED', error: 'permission changed' } },
    { status: 404, data: { success: false, code: 'ACCOUNT_NOT_FOUND', error: 'account unavailable' } },
    { status: 429, data: { success: false, code: 'PAYABLE_CHANGED', error: 'rate limited' } },
    { status: 400, data: { code: 'PAYABLE_CHANGED', error: 'changed' } },
    ...['ALREADY_APPLIED', 'ALREADY_CAPTURED', 'ALREADY_DECIDED', 'ALREADY_PAID', 'PAYMENT_ALREADY_USED', 'AUTOMATION_ALREADY_DISPATCHED', 'IDEMPOTENCY_CONFLICT'].map(code => ({ status: 409, data: { success: false, code, error: 'already recorded' } })),
    { status: 409, data: { success: false, code: 'PROVIDER_OUTCOME_UNKNOWN', error: 'unconfirmed' } },
    { status: 409, data: { success: false, code: 'SETTLEMENT_STATUS_UNKNOWN', error: 'unconfirmed' } },
    { status: 409, data: { success: false, code: 'OBLIGATION_RECONCILIATION_REQUIRED', error: 'reconcile' } },
    { status: 409, data: { success: false, code: 'SETTLEMENT_NOT_CONFIRMED', error: 'unconfirmed' } },
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


test('unrecognized provider error codes do not escape into errors or connection records', async t => {
  const actor = actorFor({ sub: 'private-code-test' }, 'test-account', 'Bearer test');
  const client = new ProviderClient('test-client', '');
  const privateCode = 'PRIVATE_CREDENTIAL_MARKER_741852';
  clearCalls(); t.after(clearCalls);
  t.mock.method(globalThis, 'fetch', async () => Response.json({ success: false, code: privateCode, error: 'Rejected' }, { status: 409 }));
  await assert.rejects(client.call('dewa', actor, 'POST', '/payments', {}), (error: unknown) => {
    if (!(error instanceof UpstreamError)) return false;
    assert.equal(error.status, 503);
    assert.equal(error.code, 'PROVIDER_OUTCOME_UNKNOWN');
    assert.equal(error.message.includes(privateCode), false);
    return true;
  });
  assert.equal(callsFor(actor.sub)[0].code, 'PROVIDER_OUTCOME_UNKNOWN');
  await assert.rejects(client.call('dewa', actor, 'GET', '/payments'), (error: unknown) =>
    error instanceof UpstreamError && error.status === 409 && error.code === 'PROVIDER_REJECTED' && !error.message.includes(privateCode));
});

test('known provider rejection codes remain available to callers', async t => {
  const actor = actorFor({ sub: 'known-code-test' }, 'test-account', 'Bearer test');
  const client = new ProviderClient('test-client', '');
  for (const code of ['BILLER_ALREADY_LINKED', 'PAYABLE_CHANGED']) {
    const mock = t.mock.method(globalThis, 'fetch', async () => Response.json({ success: false, code, error: 'Rejected' }, { status: 409 }));
    try { await assert.rejects(client.call('dewa', actor, 'POST', '/payments', {}), (error: unknown) => error instanceof UpstreamError && error.code === code); }
    finally { mock.mock.restore(); }
  }
});

test('read-only authority denials retain their status and code', async t => {
  const actor = actorFor({ sub: 'read-denial-test' }, 'test-account', 'Bearer test');
  const client = new ProviderClient('test-client', '');
  t.mock.method(globalThis, 'fetch', async () => Response.json({ success: false, code: 'ACCOUNT_RESTRICTED', error: 'Restricted' }, { status: 403 }));
  await assert.rejects(client.call('dewa', actor, 'GET', '/bills'), (error: unknown) => error instanceof UpstreamError && error.status === 403 && error.code === 'ACCOUNT_RESTRICTED');
});

test('service-token 401 never automatically repeats a provider write', async t => {
  const previous = process.env.KEYCLOAK_TOKEN_URL;
  process.env.KEYCLOAK_TOKEN_URL = 'http://127.0.0.1/token';
  t.after(() => { if (previous === undefined) delete process.env.KEYCLOAK_TOKEN_URL; else process.env.KEYCLOAK_TOKEN_URL = previous; });
  const actor = actorFor({ sub: 'test-user' }, 'test-account');
  const client = new ProviderClient('test-client', 'fixture-secret');
  let tokens = 0, writes = 0, reads = 0;
  t.mock.method(globalThis, 'fetch', async (input, init) => {
    const path = new URL(String(input)).pathname;
    if (path === '/token') { tokens++; return Response.json({ access_token: `fixture-token-${tokens}`, expires_in: 300 }); }
    if (init?.method === 'POST') {
      writes++;
      return Response.json({ success: false, code: 'ACTOR_REQUIRED' }, { status: 401 });
    }
    reads++;
    return Response.json({ success: true, bills: [] });
  });
  await assert.rejects(client.call('dewa', actor, 'POST', '/payments', {}, 'original-key'),
    (error: unknown) => error instanceof UpstreamError && error.code === 'PROVIDER_OUTCOME_UNKNOWN');
  assert.equal(writes, 1); assert.equal(tokens, 1);
  await client.call('dewa', actor, 'GET', '/bills');
  assert.equal(tokens, 2, 'the rejected service token is invalidated for later reads');
  assert.equal(reads, 1);
});

test('an end-user 401 leaves a write unconfirmed without retry', async t => {
  const actor = actorFor({ sub: 'test-user' }, 'test-account', 'Bearer test');
  const client = new ProviderClient('test-client', '');
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => { calls++; return Response.json({ success: false, code: 'ACTOR_REQUIRED' }, { status: 401 }); });
  await assert.rejects(client.call('dewa', actor, 'POST', '/payments', {}, 'original-key'),
    (error: unknown) => error instanceof UpstreamError && error.code === 'PROVIDER_OUTCOME_UNKNOWN');
  assert.equal(calls, 1);
});

test('a service-token 401 on a read may refresh and retry', async t => {
  const previous = process.env.KEYCLOAK_TOKEN_URL;
  process.env.KEYCLOAK_TOKEN_URL = 'http://127.0.0.1/token';
  t.after(() => { if (previous === undefined) delete process.env.KEYCLOAK_TOKEN_URL; else process.env.KEYCLOAK_TOKEN_URL = previous; });
  const actor = actorFor({ sub: 'test-user' }, 'test-account');
  const client = new ProviderClient('test-client', 'fixture-secret');
  let tokens = 0, reads = 0;
  t.mock.method(globalThis, 'fetch', async input => {
    if (new URL(String(input)).pathname === '/token') { tokens++; return Response.json({ access_token: `fixture-token-${tokens}`, expires_in: 300 }); }
    reads++;
    return reads === 1 ? Response.json({ success: false }, { status: 401 }) : Response.json({ success: true, bills: [] });
  });
  assert.deepEqual((await client.call('dewa', actor, 'GET', '/bills')).bills, []);
  assert.equal(tokens, 2); assert.equal(reads, 2);
});
