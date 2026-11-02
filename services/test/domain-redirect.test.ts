import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { actorContext, actorFor } from '../../packages/backend-kit/src/context.ts';
import { callDomainAsync, DomainOperationError, trackDomainOperations, type Step } from '../agent-core/src/domain-operations.ts';

test('authenticated domain reads and writes do not follow redirects', async t => {
  const previousTransport = process.env.DOMAIN_TRANSPORT, previousUrl = process.env.SERVICE_WALLET_URL;
  const received: string[] = [];
  const server = http.createServer((request, response) => {
    received.push(`${request.method} ${request.url}`);
    if (request.url === '/wallet/pay' || request.url === '/wallet/balance') {
      response.writeHead(307, { Location: '/unexpected-target' }); response.end();
    } else {
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ success: true, transaction: { id: 'unintended' }, remainingBalance: 1 }));
    }
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => {
    server.closeAllConnections(); server.close();
    if (previousTransport === undefined) delete process.env.DOMAIN_TRANSPORT; else process.env.DOMAIN_TRANSPORT = previousTransport;
    if (previousUrl === undefined) delete process.env.SERVICE_WALLET_URL; else process.env.SERVICE_WALLET_URL = previousUrl;
  });
  process.env.DOMAIN_TRANSPORT = 'http';
  process.env.SERVICE_WALLET_URL = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  for (const [method, path, code] of [['GET', '/wallet/balance', 'DOMAIN_UNAVAILABLE'], ['POST', '/wallet/pay', 'DOMAIN_OUTCOME_UNKNOWN']] as const) {
    const steps: Step[] = [];
    const result = trackDomainOperations(steps, () => actorContext.run(actorFor({ sub: 'test-user' }, 'account', 'Bearer test'),
      () => callDomainAsync('wallet', method, path)));
    await assert.rejects(result, (error: unknown) => error instanceof DomainOperationError && error.code === code);
    if (method === 'POST') assert.equal(steps[0].state, 'UNKNOWN');
  }
  assert.deepEqual(received, ['GET /wallet/balance', 'POST /wallet/pay']);
});


test('domain paths cannot override the configured service address', async t => {
  const previousTransport = process.env.DOMAIN_TRANSPORT, previousUrl = process.env.SERVICE_WALLET_URL;
  process.env.DOMAIN_TRANSPORT = 'http';
  process.env.SERVICE_WALLET_URL = 'http://127.0.0.1:4011';
  t.after(() => {
    if (previousTransport === undefined) delete process.env.DOMAIN_TRANSPORT; else process.env.DOMAIN_TRANSPORT = previousTransport;
    if (previousUrl === undefined) delete process.env.SERVICE_WALLET_URL; else process.env.SERVICE_WALLET_URL = previousUrl;
  });
  const dispatched: string[] = [];
  t.mock.method(globalThis, 'fetch', async input => {
    dispatched.push(String(input));
    return Response.json({ success: true, balance: 10 });
  });
  for (const path of ['http://untrusted.example/wallet/balance', '//untrusted.example/wallet/balance', '/\\untrusted.example/wallet/balance', '/wallet/balance?override=1', '/wallet/balance#fragment']) {
    const steps: Step[] = [];
    const result = trackDomainOperations(steps, () => actorContext.run(actorFor({ sub: 'test-user' }, 'account', 'Bearer test'),
      () => callDomainAsync('wallet', 'POST', path)));
    await assert.rejects(result, (error: unknown) => error instanceof DomainOperationError && error.code === 'DOMAIN_PATH_INVALID');
    assert.deepEqual(steps, []);
  }
  const result = await actorContext.run(actorFor({ sub: 'test-user' }, 'account', 'Bearer test'),
    () => callDomainAsync('wallet', 'GET', '/wallet/balance'));
  assert.equal(result.data.balance, 10);
  assert.deepEqual(dispatched, ['http://127.0.0.1:4011/wallet/balance']);
});
