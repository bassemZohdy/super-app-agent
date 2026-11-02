import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { ProviderClient, UpstreamError } from '../../packages/backend-kit/src/provider-client.ts';
import { actorFor } from '../../packages/backend-kit/src/context.ts';

test('provider client does not follow redirects for reads or writes', async t => {
  const previous = process.env.PROVIDER_DEWA_URL;
  const paths: string[] = [];
  const server = http.createServer((request, response) => {
    paths.push(request.url || '');
    if (request.url?.endsWith('/bills')) {
      response.writeHead(307, { Location: '/unexpected' }); response.end();
    } else {
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ success: true }));
    }
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => {
    server.closeAllConnections(); server.close();
    if (previous === undefined) delete process.env.PROVIDER_DEWA_URL; else process.env.PROVIDER_DEWA_URL = previous;
  });
  process.env.PROVIDER_DEWA_URL = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const actor = actorFor({ sub: 'test-user' }, 'test-account', 'Bearer test');
  const client = new ProviderClient('test-client', '');
  for (const [method, code] of [['GET', 'PROVIDER_UNAVAILABLE'], ['POST', 'PROVIDER_OUTCOME_UNKNOWN']] as const) {
    await assert.rejects(client.call('dewa', actor, method, '/bills', method === 'POST' ? {} : undefined),
      (error: unknown) => error instanceof UpstreamError && error.code === code);
  }
  assert.deepEqual(paths, ['/v1/accounts/test-account/bills', '/v1/accounts/test-account/bills']);
});


test('provider paths cannot escape the selected account', async t => {
  const actor = actorFor({ sub: 'test-user' }, 'test-account', 'Bearer test');
  const client = new ProviderClient('test-client', '');
  const paths: string[] = [];
  t.mock.method(globalThis, 'fetch', async input => {
    paths.push(new URL(String(input)).pathname);
    return Response.json({ success: true });
  });
  for (const path of ['/../../other', '/%2e%2e/%2e%2e/other', '/\\..\\..\\other', '/items/%2f..%2fother', 'relative']) {
    await assert.rejects(client.call('dewa', actor, 'POST', path, {}),
      (error: unknown) => error instanceof UpstreamError && error.code === 'PROVIDER_PATH_INVALID');
  }
  await client.call('dewa', actor, 'GET', '/bills');
  await client.call('dewa', actor, 'GET', '/payables/dewa%3Abill%3Aone?view=current');
  await client.call('dewa', actor, 'GET', '/v1/accounts');
  assert.deepEqual(paths, ['/v1/accounts/test-account/bills', '/v1/accounts/test-account/payables/dewa%3Abill%3Aone', '/v1/accounts']);
});

test('provider client refuses unsupported methods and write access to the account bootstrap route', async t => {
  const actor = actorFor({ sub: 'test-user' }, 'test-account', 'Bearer test');
  const client = new ProviderClient('test-client', '');
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => { calls++; return Response.json({ success: true }); });
  for (const method of ['PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS', 'post', 'get']) {
    await assert.rejects(client.call('dewa', actor, method, '/bills', {}),
      (error: unknown) => error instanceof UpstreamError && error.code === 'PROVIDER_METHOD_INVALID');
  }
  await assert.rejects(client.call('payments', actor, 'POST', '/v1/accounts', {}),
    (error: unknown) => error instanceof UpstreamError && error.code === 'PROVIDER_PATH_INVALID');
  assert.equal(calls, 0);
  await client.call('payments', actor, 'GET', '/v1/accounts');
  await client.call('dewa', actor, 'POST', '/bills', {});
  assert.equal(calls, 2);
});
