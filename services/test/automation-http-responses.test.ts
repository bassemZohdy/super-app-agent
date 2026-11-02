import test from 'node:test';
import assert from 'node:assert/strict';
import { HttpExecutionGateway } from '../automation-worker/src/http-gateway.ts';
import { AutomationWorker } from '../automation-worker/src/worker.ts';
import { JobStore } from '../automation-worker/src/jobs.ts';

test('automation HTTP errors remain sanitized and uncertain credential results are held', async t => {
  const previous = process.env.KEYCLOAK_TOKEN_URL;
  process.env.KEYCLOAK_TOKEN_URL = 'http://127.0.0.1/token';
  t.after(() => { if (previous === undefined) delete process.env.KEYCLOAK_TOKEN_URL; else process.env.KEYCLOAK_TOKEN_URL = previous; });
  let status = 403, payload: unknown = {}, credentialCalls = 0, executeCalls = 0, phase: 'credential' | 'execute' = 'credential';
  t.mock.method(globalThis, 'fetch', async input => {
    const path = new URL(String(input)).pathname;
    if (path === '/token') return Response.json({ access_token: 'fixture-service-token', expires_in: 300 });
    if (path.endsWith('/kill-switch')) return Response.json({ success: false, code: 'NO_DESIRED_STATE' }, { status: 404 });
    if (path.endsWith('/prepare')) return Response.json({ success: true, id: 'autoexec_1', orderId: 'order_1', runId: 'autorn_00000000-0000-4000-8000-000000000000', mandateId: 'mandate_1', occurrenceKey: 'occ_1', policyVersion: 1, state: 'PREPARED', amountMinor: 10000, currency: 'AED' });
    if (path.endsWith('/credential')) {
      credentialCalls++;
      if (phase === 'execute') return Response.json({ success: true, accessToken: 'fixture-execution-token', expiresAt: Date.now() + 60000 });
    }
    if (path.endsWith('/execute')) executeCalls++;
    return Response.json(payload, { status });
  });
  const runId = 'autorn_00000000-0000-4000-8000-000000000000';
  const gateway = new HttpExecutionGateway({ runId, paymentsUrl: 'http://127.0.0.1/', brokerUrl: 'http://127.0.0.1/', clientSecret: 'fixture-secret' });
  const rule = { mandateId: 'mandate_1', policyVersion: 1, occurrenceKey: 'occ_1', target: 'dewa:home' };
  for (const example of [
    { status: 403, body: { success: false, code: 'PRIVATE_TOKEN_MARKER', error: 'private-token-marker' } },
    { status: 403, body: { success: false, code: 'PRIVATE_TOKEN_MARKER', error: 'x'.repeat(70000) } },
    { status: 200, body: { success: false, code: 'PERMIT_EXPIRED', error: 'private-token-marker' } },
    { status: 403, body: null },
    ...['', ' ', 'x'.repeat(17000)].map(accessToken => ({ status: 200, body: { success: true, accessToken, expiresAt: Date.now() + 60000 } })),
    { status: 200, body: { success: true, accessToken: 'fixture-execution-token', expiresAt: Date.now() + 60000, error: 'private-token-marker' } },
    { status: 200, body: { success: true, accessToken: 'fixture-execution-token', expiresAt: Date.now() - 1 } },
  ]) {
    status = example.status; payload = example.body; credentialCalls = 0;
    const store = new JobStore(':memory:');
    try {
      const job = store.enqueue(rule);
      const worker = new AutomationWorker(store, gateway, { workerId: 'worker-a', stepRetries: 1, sleep: async () => {} });
      const result = await worker.runOnce();
      assert.equal(result?.state, 'HELD');
      assert.equal(result?.reason, 'CREDENTIAL_UNKNOWN');
      assert.equal(credentialCalls, 1);
      assert.doesNotMatch(JSON.stringify([store.get(job.id), store.outbox(job.id), store.attempts(job.id)]), /private.token.marker/i);
    } finally { store.close(); }
  }
  phase = 'execute';
  for (const example of [
    { status: 403, body: { success: false, code: 'PRIVATE_TOKEN_MARKER', error: 'private-token-marker' } },
    { status: 200, body: { success: true, order: { id: 'order_other', state: 'SETTLED', fundsCaptured: true } } },
    { status: 200, body: { success: true, order: { id: 'order_1', state: 'SETTLED' } } },
    { status: 200, body: { success: true, order: { id: 'order_1', state: 'SETTLED', fundsCaptured: false } } },
    { status: 200, body: { success: true, order: { id: 'order_1', state: 'REQUIRES_ACTION', fundsCaptured: true } } },
    { status: 200, body: { success: true, order: { id: 'order_1', state: 'FAILED', fundsCaptured: false, failureCode: 'private-token-marker' } } },
    { status: 200, body: { success: true, error: 'private-token-marker', order: { id: 'order_1', state: 'SETTLED', fundsCaptured: true, receipt: { amountMinor: 10000, currency: 'AED', receiptNumber: 'receipt_1' } } } },
    ...[undefined, { amountMinor: 9999, currency: 'AED', receiptNumber: 'receipt_1' }, { amountMinor: 10000, currency: 'USD', receiptNumber: 'receipt_1' }, { amountMinor: 10000, currency: 'AED', receiptNumber: '' }].map(receipt => ({ status: 200, body: { success: true, order: { id: 'order_1', state: 'SETTLED', fundsCaptured: true, receipt } } })),
  ]) {
    status = example.status; payload = example.body; executeCalls = 0;
    const store = new JobStore(':memory:');
    try {
      const job = store.enqueue(rule);
      const worker = new AutomationWorker(store, gateway, { workerId: 'worker-a', stepRetries: 1, sleep: async () => {} });
      const result = await worker.runOnce();
      assert.equal(result?.state, 'HELD'); assert.equal(result?.reason, 'OUTCOME_UNKNOWN');
      assert.equal(executeCalls, 1);
      assert.doesNotMatch(JSON.stringify([store.get(job.id), store.outbox(job.id), store.attempts(job.id)]), /private.token.marker|fixture-execution-token/i);
    } finally { store.close(); }
  }
  status = 200; payload = { success: true, order: { id: 'order_1', state: 'SETTLED', fundsCaptured: true, receipt: { amountMinor: 10000, currency: 'AED', receiptNumber: 'receipt_1' } } };
  const settledStore = new JobStore(':memory:');
  try {
    settledStore.enqueue(rule);
    assert.equal((await new AutomationWorker(settledStore, gateway, { workerId: 'worker-a', stepRetries: 1, sleep: async () => {} }).runOnce())?.state, 'SETTLED');
  } finally { settledStore.close(); }
  phase = 'credential';
  status = 409; payload = { success: false, code: 'PERMIT_ALREADY_ISSUED', error: 'private-token-marker' };
  await assert.rejects(gateway.credential(runId, 'autoexec_1'), (error: unknown) => {
    assert.ok(error instanceof Error);
    assert.equal((error as { code?: string }).code, 'PERMIT_ALREADY_ISSUED');
    assert.doesNotMatch(error.message, /private-token-marker/);
    return true;
  });
  payload = { success: false, code: 'CHALLENGE_PENDING', error: 'private-token-marker' };
  assert.deepEqual(await gateway.resume(runId, 'autoexec_1'), { state: 'PENDING' });
  status = 200;
  for (const invalid of [
    { success: true, accessToken: '', expiresAt: Date.now() + 60000 },
    { success: true, accessToken: 'fixture-execution-token', expiresAt: Date.now() - 1 },
    { success: true, accessToken: 'fixture-execution-token', expiresAt: Date.now() + 60000, error: 'private-token-marker' },
  ]) { payload = invalid; await assert.rejects(gateway.resume(runId, 'autoexec_1')); }
  payload = { success: true, accessToken: 'fixture-execution-token', expiresAt: Date.now() + 60000 };
  assert.equal((await gateway.resume(runId, 'autoexec_1')).state, 'APPROVED');
});

test('automation preparation is bound to the queued rule, occurrence, version and run before credential issuance', async t => {
  const previous = process.env.KEYCLOAK_TOKEN_URL;
  process.env.KEYCLOAK_TOKEN_URL = 'http://127.0.0.1/token';
  t.after(() => { if (previous === undefined) delete process.env.KEYCLOAK_TOKEN_URL; else process.env.KEYCLOAK_TOKEN_URL = previous; });
  const runId = 'autorn_00000000-0000-4000-8000-000000000000';
  const correct = { success: true, id: 'autoexec_1', orderId: 'order_1', runId, mandateId: 'mandate_1', occurrenceKey: 'occ_1', policyVersion: 1, state: 'PREPARED', amountMinor: 10000, currency: 'AED' };
  let preparation: Record<string, unknown> = correct, credentialCalls = 0, posted: unknown;
  t.mock.method(globalThis, 'fetch', async (input, init) => {
    const path = new URL(String(input)).pathname;
    if (path === '/token') return Response.json({ access_token: 'fixture-service-token', expires_in: 300 });
    if (path.endsWith('/kill-switch')) return Response.json({ success: false }, { status: 404 });
    if (path.endsWith('/prepare')) { posted = JSON.parse(String(init?.body)); return Response.json(preparation); }
    credentialCalls++;
    return Response.json({ success: false, code: 'PERMIT_ALREADY_ISSUED' }, { status: 409 });
  });
  const gateway = new HttpExecutionGateway({ runId, paymentsUrl: 'http://127.0.0.1/', brokerUrl: 'http://127.0.0.1/', clientSecret: 'fixture-secret' });
  const rule = { mandateId: 'mandate_1', policyVersion: 1, occurrenceKey: 'occ_1', target: 'dewa:home' };
  for (const changed of [
    { runId: 'autorn_11111111-1111-4111-8111-111111111111' }, { mandateId: 'mandate_other' }, { occurrenceKey: 'occ_other' },
    { policyVersion: 2 }, { state: 'SETTLED' }, { id: '' }, { orderId: '' }, { amountMinor: 0 }, { currency: 'USD' },
    { skipped: true, reason: 'NO_DUE_INVOICE', mandateId: 'mandate_other' }, { skipped: true, reason: 'NO_DUE_INVOICE' },
  ]) {
    preparation = { ...correct, ...changed }; credentialCalls = 0;
    const store = new JobStore(':memory:');
    try {
      const job = store.enqueue(rule);
      const worker = new AutomationWorker(store, gateway, { workerId: 'worker-a', maxAttempts: 1, sleep: async () => {} });
      const result = await worker.runOnce();
      assert.equal(result?.state, 'HELD'); assert.equal(result?.reason, 'PREPARATION_UNKNOWN');
      assert.equal(store.get(job.id)?.runId, runId);
      assert.equal(credentialCalls, 0);
      assert.ok(!store.outbox(job.id).some(event => event.kind === 'PREPARED'));
      assert.deepEqual(posted, { mandateId: 'mandate_1', occurrenceKey: 'occ_1', requestKey: job.id.replace(/^job_/, 'req_') });
    } finally { store.close(); }
  }
  for (const orderId of ['order_1', 'funding_1']) {
    preparation = { ...correct, orderId };
    const store = new JobStore(':memory:');
    try {
      store.enqueue(rule); credentialCalls = 0;
      const result = await new AutomationWorker(store, gateway, { workerId: 'worker-a', stepRetries: 1, sleep: async () => {} }).runOnce();
      assert.equal(result?.state, 'HELD'); assert.equal(result?.reason, 'CREDENTIAL_ALREADY_ISSUED');
      assert.equal(credentialCalls, 1);
    } finally { store.close(); }
  }
  preparation = { success: true, skipped: true, mandateId: 'mandate_1', occurrenceKey: 'occ_1', reason: 'NO_DUE_INVOICE' };
  const skippedStore = new JobStore(':memory:');
  try {
    skippedStore.enqueue(rule); credentialCalls = 0;
    const result = await new AutomationWorker(skippedStore, gateway, { workerId: 'worker-a', sleep: async () => {} }).runOnce();
    assert.equal(result?.state, 'SKIPPED'); assert.equal(result?.reason, 'NO_DUE_INVOICE');
    assert.equal(credentialCalls, 0);
  } finally { skippedStore.close(); }
  preparation = { ...preparation, reason: 'private-token-marker' };
  const unknownStore = new JobStore(':memory:');
  try {
    const job = unknownStore.enqueue(rule); credentialCalls = 0;
    const result = await new AutomationWorker(unknownStore, gateway, { workerId: 'worker-a', sleep: async () => {} }).runOnce();
    assert.equal(result?.state, 'HELD'); assert.equal(result?.reason, 'PREPARATION_UNKNOWN');
    assert.equal(credentialCalls, 0);
    assert.doesNotMatch(JSON.stringify([unknownStore.get(job.id), unknownStore.outbox(job.id), unknownStore.attempts(job.id)]), /private-token-marker/i);
  } finally { unknownStore.close(); }
});

test('credential requests for a different run are rejected before authentication or network access', async t => {
  let calls = 0; t.mock.method(globalThis, 'fetch', async () => { calls++; throw new Error('unexpected network call'); });
  const runId = 'autorn_00000000-0000-4000-8000-000000000000';
  const gateway = new HttpExecutionGateway({ runId, paymentsUrl: 'http://127.0.0.1/', brokerUrl: 'http://127.0.0.1/', clientSecret: 'fixture-secret' });
  await assert.rejects(gateway.credential('autorn_11111111-1111-4111-8111-111111111111', 'autoexec_1'), /another run/i);
  assert.equal(calls, 0);
});

test('automation execution HTTP responses require a readable order identity and capture flag', async t => {
  let order: unknown;
  t.mock.method(globalThis, 'fetch', async () => Response.json({ success: true, order }));
  const runId = 'autorn_00000000-0000-4000-8000-000000000000';
  const gateway = new HttpExecutionGateway({ runId, paymentsUrl: 'http://127.0.0.1/', brokerUrl: 'http://127.0.0.1/', clientSecret: 'fixture-secret' });
  for (const bad of [
    { state: 'SETTLED', fundsCaptured: true },
    { id: '', state: 'SETTLED', fundsCaptured: true },
    { id: 'order_1', state: 'SETTLED' },
    { id: 'order_1', state: 'FAILED', fundsCaptured: 'false' },
    { id: 'order_1', state: '', fundsCaptured: false },
    { id: 'order_1', state: 'UNRECOGNIZED', fundsCaptured: false },
    null, [],
  ]) {
    order = bad;
    await assert.rejects(gateway.execute(runId, 'autoexec_1', 'fixture-execution-token'), /incomplete/i);
  }
  order = { id: 'order_1', state: 'SETTLED', fundsCaptured: true };
  assert.deepEqual(await gateway.execute(runId, 'autoexec_1', 'fixture-execution-token'), { id: 'order_1', state: 'SETTLED', fundsCaptured: true, failureCode: undefined, receipt: undefined });
});

test('preparation inspection reads the original identity without dispatching or accepting mismatched evidence', async t => {
  const previous = process.env.KEYCLOAK_TOKEN_URL; process.env.KEYCLOAK_TOKEN_URL = 'http://127.0.0.1/token';
  t.after(() => { if (previous === undefined) delete process.env.KEYCLOAK_TOKEN_URL; else process.env.KEYCLOAK_TOKEN_URL = previous; });
  const runId = 'autorn_00000000-0000-4000-8000-000000000000', input = { mandateId: 'mandate_1', occurrenceKey: 'occ_1', policyVersion: 1, requestKey: 'req_original_1' };
  const prepared = { id: 'autoexec_1', orderId: 'order_1', runId, mandateId: input.mandateId, occurrenceKey: input.occurrenceKey, policyVersion: 1, state: 'PREPARED', amountMinor: 10000, currency: 'AED' };
  let body: unknown = { success: true, found: false }, method = '', path = '';
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    path = new URL(String(url)).pathname;
    if (path === '/token') return Response.json({ access_token: 'fixture-service-token', expires_in: 300 });
    method = init?.method || 'GET'; return Response.json(body);
  });
  const gateway = new HttpExecutionGateway({ runId, paymentsUrl: 'http://127.0.0.1/', brokerUrl: 'http://127.0.0.1/', clientSecret: 'fixture-secret' });
  assert.equal(await gateway.inspectPreparation(input), undefined);
  assert.equal(method, 'GET'); assert.equal(path, `/internal/automation-runs/${runId}/requests/${input.requestKey}`);
  body = { success: true, found: true, preparation: prepared };
  assert.deepEqual(await gateway.inspectPreparation(input), { id: 'autoexec_1', runId, orderId: 'order_1', amountMinor: 10000 });
  body = { success: true, found: true, preparation: { mandateId: input.mandateId, occurrenceKey: input.occurrenceKey, skipped: true, reason: 'NO_DUE_INVOICE' } };
  assert.deepEqual(await gateway.inspectPreparation(input), { skipped: true, reason: 'NO_DUE_INVOICE' });
  for (const invalid of [{ success: true, found: false, preparation: prepared }, { success: true, found: true, preparation: { ...prepared, occurrenceKey: 'other' } }, { success: true, found: true, preparation: { ...prepared, runId: 'other' } }, { success: false, found: true, preparation: prepared }, { success: true, error: 'private-token-marker', found: true, preparation: prepared }]) {
    body = invalid; await assert.rejects(gateway.inspectPreparation(input));
  }
});
