import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { SettlementClient } from '../provider-simulator/src/settlement-client.ts';
import { SettlementError } from '../provider-simulator/src/payment-claims.ts';

const body = { attemptId: 'attempt_1', reference: 'bill:one', amountMinor: 10000 };
const claim = { claimId: 'claim_1', paymentId: 'payment_1', provider: 'dewa', attemptId: body.attemptId, reference: body.reference, amountMinor: body.amountMinor, currency: 'AED', orderId: 'order_1', captureAttemptId: 'capture_1', state: 'CLAIMED', createdAt: '2026-01-01T00:00:00.000Z' };
const charge = { id: 'payment_1', accountId: 'account_1', merchant: 'dewa', reference: body.reference, amountMinor: body.amountMinor, currency: 'AED', status: 'CAPTURED', refunded: false };
const unknown = (error: unknown) => error instanceof SettlementError && error.code === 'SETTLEMENT_OUTCOME_UNKNOWN' && !error.message.includes('private-marker');

test('settlement HTTP client holds unconfirmed outcomes and never follows redirects or retries 401 writes', async t => {
  const client = new SettlementClient('dewa');
  t.mock.method(client.credentials, 'token', async () => 'fixture-token');
  let payload: unknown = {}, status = 401, calls = 0, redirect: RequestRedirect | undefined;
  t.mock.method(globalThis, 'fetch', async (_input, init) => { calls++; redirect = init?.redirect; return Response.json(payload, { status }); });
  for (const example of [
    { status: 401, payload: { success: false, error: 'private-marker' } },
    { status: 409, payload: { success: false, code: 'CLAIM_CONFLICT', error: 'private-marker' } },
    { status: 200, payload: { success: true, error: 'private-marker', claim, charge } },
    { status: 200, payload: { success: true, claim: { ...claim, amountMinor: 9999 }, charge } },
    { status: 200, payload: { success: true, claim: { ...claim, claimId: '../other' }, charge } },
    { status: 200, payload: { success: true, claim, charge: { ...charge, accountId: 'other' } } },
    { status: 200, payload: { success: true, claim, charge, padding: 'x'.repeat(70000) } },
  ]) {
    status = example.status; payload = example.payload; calls = 0;
    await assert.rejects(client.call('account_1', 'payment_1', 'claim', body), unknown);
    assert.equal(calls, 1); assert.equal(redirect, 'error');
  }
  status = 200; payload = { success: true, claim, charge };
  assert.equal((await client.call('account_1', 'payment_1', 'claim', body)).claim.claimId, 'claim_1');
});

test('settlement requests do not forward credentials through an HTTP redirect', async t => {
  const previous = process.env.PROVIDER_PAYMENTS_URL;
  let received = 0, redirected = 0;
  const server = http.createServer((request, response) => {
    if (request.url === '/redirect-target') { redirected++; response.writeHead(200); response.end(); return; }
    received++; response.writeHead(307, { Location: '/redirect-target' }); response.end();
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => { server.closeAllConnections(); server.close(); if (previous === undefined) delete process.env.PROVIDER_PAYMENTS_URL; else process.env.PROVIDER_PAYMENTS_URL = previous; });
  process.env.PROVIDER_PAYMENTS_URL = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const client = new SettlementClient('dewa');
  t.mock.method(client.credentials, 'token', async () => 'fixture-token');
  await assert.rejects(client.call('account_1', 'payment_1', 'claim', body), unknown);
  assert.equal(received, 1); assert.equal(redirected, 0);
});

test('settlement HTTP client binds acknowledgement and release to the original claim and state', async t => {
  const client = new SettlementClient('dewa');
  t.mock.method(client.credentials, 'token', async () => 'fixture-token');
  let result: unknown;
  t.mock.method(globalThis, 'fetch', async () => Response.json(result));
  const input = { attemptId: body.attemptId, claimId: claim.claimId, receiptDigest: 'receipt_1' };
  for (result of [
    { success: true, claim: { ...claim, state: 'CLAIMED' } },
    { success: true, claim: { ...claim, claimId: 'other', state: 'APPLIED', receiptDigest: input.receiptDigest } },
    { success: true, claim: { ...claim, state: 'APPLIED', receiptDigest: 'other' } },
  ]) await assert.rejects(client.call('account_1', 'payment_1', 'ack', input), unknown);
  result = { success: true, claim: { ...claim, state: 'APPLIED', receiptDigest: input.receiptDigest } };
  assert.equal((await client.call('account_1', 'payment_1', 'ack', input)).claim.state, 'APPLIED');
  result = { success: true, claim: { ...claim, state: 'RELEASED' } };
  assert.equal((await client.call('account_1', 'payment_1', 'release', { attemptId: body.attemptId, claimId: claim.claimId, reason: 'NOT_APPLIED' })).claim.state, 'RELEASED');
});

test('settlement HTTP client refuses incomplete attempt terms before credentials or dispatch', async t => {
  const client = new SettlementClient('dewa');
  let tokens = 0, requests = 0;
  t.mock.method(client.credentials, 'token', async () => { tokens++; return 'fixture-token'; });
  t.mock.method(globalThis, 'fetch', async () => { requests++; return Response.json({ success: true }); });
  for (const [action, input] of [
    ['claim', { reference: body.reference, amountMinor: 10000 }],
    ['claim', { ...body, amountMinor: 0 }],
    ['ack', { attemptId: body.attemptId, claimId: claim.claimId }],
    ['release', { attemptId: body.attemptId, claimId: claim.claimId, reason: 'UNKNOWN' }],
  ] as const) {
    await assert.rejects(client.call('account_1', 'payment_1', action, input),
      (error: unknown) => error instanceof SettlementError && error.code === 'SETTLEMENT_INPUT_INVALID');
  }
  assert.equal(tokens, 0); assert.equal(requests, 0);
});

test('settlement transport rejects path-changing identifiers before obtaining credentials', async t => {
  const client = new SettlementClient('dewa');
  let tokens = 0, requests = 0;
  t.mock.method(client.credentials, 'token', async () => { tokens++; return 'fixture-token'; });
  t.mock.method(globalThis, 'fetch', async () => { requests++; return Response.json({ success: true }); });
  for (const bad of ['..', '.', '../other', '%2e%2e', 'account/other', 'account?other', 'account#other']) {
    await assert.rejects(client.call(bad, 'payment_1', 'claim', body),
      (error: unknown) => error instanceof SettlementError && error.code === 'SETTLEMENT_INPUT_INVALID');
    await assert.rejects(client.call('account_1', bad, 'claim', body),
      (error: unknown) => error instanceof SettlementError && error.code === 'SETTLEMENT_INPUT_INVALID');
    await assert.rejects(client.call('account_1', 'payment_1', 'claim', { ...body, attemptId: bad }),
      (error: unknown) => error instanceof SettlementError && error.code === 'SETTLEMENT_INPUT_INVALID');
    await assert.rejects(client.call('account_1', 'payment_1', 'ack', { attemptId: body.attemptId, claimId: bad, receiptDigest: 'receipt_1' }),
      (error: unknown) => error instanceof SettlementError && error.code === 'SETTLEMENT_INPUT_INVALID');
  }
  assert.equal(tokens, 0); assert.equal(requests, 0);
});
