import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { actorContext, actorFor } from '../../packages/backend-kit/src/context.ts';
import { Telemetry } from '../../packages/backend-kit/src/observability.ts';
import { createApplicationServer } from '../../packages/backend-kit/src/application.ts';
import { callDomainAsync } from '../agent-core/src/domain-operations.ts';

test('a traced domain write carries the original operation identity independently of the trace ID', async t => {
  const previousTransport = process.env.DOMAIN_TRANSPORT, previousIntegration = process.env.PROVIDER_INTEGRATION, previousUrl = process.env.SERVICE_WALLET_URL;
  process.env.DOMAIN_TRANSPORT = 'http'; process.env.PROVIDER_INTEGRATION = 'true';
  const actor = actorFor({ sub: 'identity-test' }, 'account', 'Bearer test');
  actor.requestId = '11111111-1111-4111-8111-111111111111:confirm_composite_checkout';
  let receivedOperation: string | string[] | undefined, receivedTrace: string | string[] | undefined;
  const service = http.createServer((request, response) => {
    receivedOperation = request.headers['x-operation-id']; receivedTrace = request.headers['x-request-id'];
    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ success: true, transaction: { id: 'tx1', type: 'PAYMENT', amount: 1, currency: 'AED', status: 'SETTLED' }, charge: { id: 'tx1', accountId: actor.accountId, amountMinor: 100, currency: 'AED', status: 'CAPTURED', refunded: false, merchant: 'superapp', reference: receivedOperation, source: 'wallet' }, remainingBalance: 50 }));
  });
  await new Promise<void>(resolve => service.listen(0, '127.0.0.1', resolve));
  process.env.SERVICE_WALLET_URL = `http://127.0.0.1:${(service.address() as AddressInfo).port}`;
  const telemetry = new Telemetry('identity-test');
  const gateway = http.createServer(telemetry.handler(async (_request, response) => {
    try { await actorContext.run(actor, () => callDomainAsync('wallet', 'POST', '/wallet/pay', {}, { amount: 1 })); response.writeHead(200).end(); }
    catch { response.writeHead(500).end(); }
  }));
  await new Promise<void>(resolve => gateway.listen(0, '127.0.0.1', resolve));
  t.after(() => { telemetry.close(); gateway.closeAllConnections(); gateway.close(); service.closeAllConnections(); service.close(); if (previousTransport === undefined) delete process.env.DOMAIN_TRANSPORT; else process.env.DOMAIN_TRANSPORT = previousTransport; if (previousIntegration === undefined) delete process.env.PROVIDER_INTEGRATION; else process.env.PROVIDER_INTEGRATION = previousIntegration; if (previousUrl === undefined) delete process.env.SERVICE_WALLET_URL; else process.env.SERVICE_WALLET_URL = previousUrl; });
  const response = await fetch(`http://127.0.0.1:${(gateway.address() as AddressInfo).port}/test`, { headers: { 'X-Request-Id': 'diagnostic-request' } });
  assert.equal(response.status, 200);
  assert.equal(receivedOperation, actor.requestId);
  assert.equal(receivedTrace, 'diagnostic-request');
});

test('application rejects malformed operation identities before invoking a handler', async t => {
  const previous = process.env.PROVIDER_INTEGRATION;
  delete process.env.PROVIDER_INTEGRATION;
  let calls = 0;
  const server = createApplicationServer('service-wallet', () => { calls++; return { status: 200, data: { success: true } }; });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => { server.closeAllConnections(); server.close(); if (previous === undefined) delete process.env.PROVIDER_INTEGRATION; else process.env.PROVIDER_INTEGRATION = previous; });
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/wallet/pay`;
  for (const identity of ['invalid/path', 'invalid identity', 'x'.repeat(201)]) {
    const result = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Operation-Id': identity }, body: '{}' });
    assert.equal(result.status, 400);
    assert.equal(calls, 0);
  }
  const result = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Operation-Id': 'review:action' }, body: '{}' });
  assert.equal(result.status, 200);
  assert.equal(calls, 1);
});
