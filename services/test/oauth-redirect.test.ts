import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { ClientCredentials } from '../../packages/backend-kit/src/oauth.ts';

test('service credentials never follow redirects to another token endpoint', async t => {
  let targetCalls = 0, issuerCalls = 0, status = 307;
  const target = http.createServer((request, response) => {
    targetCalls++; request.resume(); response.setHeader('Content-Type', 'application/json'); response.end(JSON.stringify({ access_token: 'test-token', expires_in: 60 }));
  });
  await new Promise<void>(resolve => target.listen(0, '127.0.0.1', resolve));
  const issuer = http.createServer((request, response) => {
    issuerCalls++; request.resume();
    if (status !== 200) { response.writeHead(status, { Location: `http://127.0.0.1:${(target.address() as AddressInfo).port}/token` }); response.end(); return; }
    response.setHeader('Content-Type', 'application/json'); response.end(JSON.stringify({ access_token: 'test-token', expires_in: 60 }));
  });
  await new Promise<void>(resolve => issuer.listen(0, '127.0.0.1', resolve));
  const previous = process.env.KEYCLOAK_TOKEN_URL;
  process.env.KEYCLOAK_TOKEN_URL = `http://127.0.0.1:${(issuer.address() as AddressInfo).port}/token`;
  t.after(async () => {
    if (previous === undefined) delete process.env.KEYCLOAK_TOKEN_URL; else process.env.KEYCLOAK_TOKEN_URL = previous;
    target.closeAllConnections(); issuer.closeAllConnections();
    await Promise.all([new Promise<void>(resolve => target.close(() => resolve())), new Promise<void>(resolve => issuer.close(() => resolve()))]);
  });
  const secret = randomBytes(32).toString('hex');
  for (status of [301, 302, 303, 307, 308]) {
    await assert.rejects(() => new ClientCredentials('local-client', secret).token());
    assert.equal(targetCalls, 0);
  }
  status = 200;
  assert.equal(await new ClientCredentials('local-client', secret).token(), 'test-token');
  assert.equal(issuerCalls, 6); assert.equal(targetCalls, 0);
});
