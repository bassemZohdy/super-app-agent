import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { BrowserAuth } from '../src/oidc-client.ts';

test('browser login and refresh refuse token endpoint redirects without forwarding credentials', async t => {
  let targetCalls = 0, issuerCalls = 0, status = 307, replaced = '';
  const target = http.createServer((request, response) => {
    targetCalls++; request.resume(); response.setHeader('Content-Type', 'application/json'); response.end(JSON.stringify({ access_token: 'test-access', refresh_token: 'test-refresh', expires_in: 300 }));
  });
  await new Promise<void>(resolve => target.listen(0, '127.0.0.1', resolve));
  const issuer = http.createServer((request, response) => {
    issuerCalls++; request.resume();
    if (status !== 200) { response.writeHead(status, { Location: `http://127.0.0.1:${(target.address() as AddressInfo).port}/token` }); response.end(); return; }
    response.setHeader('Content-Type', 'application/json'); response.end(JSON.stringify({ access_token: 'test-access', refresh_token: 'test-refresh', expires_in: 300 }));
  });
  await new Promise<void>(resolve => issuer.listen(0, '127.0.0.1', resolve));
  const values = new Map<string, string>();
  const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); }, removeItem: (key: string) => { values.delete(key); } };
  const globals = { sessionStorage: storage, localStorage: storage, location: { href: 'http://app.invalid/fines?code=test-code&state=test-state', origin: 'http://app.invalid', pathname: '/fines' }, history: { replaceState: (_a: unknown, _b: string, value: string) => { replaced = value; } } };
  for (const [key, value] of Object.entries(globals)) {
    const previous = Object.getOwnPropertyDescriptor(globalThis, key);
    Object.defineProperty(globalThis, key, { value, configurable: true, writable: true });
    t.after(() => { if (previous) Object.defineProperty(globalThis, key, previous); else Reflect.deleteProperty(globalThis, key); });
  }
  t.after(async () => {
    target.closeAllConnections(); issuer.closeAllConnections();
    await Promise.all([new Promise<void>(resolve => target.close(() => resolve())), new Promise<void>(resolve => issuer.close(() => resolve()))]);
  });
  const auth = new BrowserAuth({ enabled: true, issuer: `http://127.0.0.1:${(issuer.address() as AddressInfo).port}`, clientId: 'browser-client' });
  for (status of [307, 308]) {
    storage.setItem('cityside.oidc.request', JSON.stringify({ state: 'test-state', verifier: 'test-verifier', redirectUri: 'http://app.invalid/fines', createdAt: Date.now() }));
    await assert.rejects(() => auth.completeLogin());
    assert.equal(targetCalls, 0); assert.equal(replaced, '/fines');
    storage.setItem('cityside.oidc.tokens', JSON.stringify({ access_token: 'old-access', refresh_token: 'old-refresh', expiresAt: 0 }));
    await assert.rejects(() => auth.token());
    assert.equal(targetCalls, 0); assert.equal(auth.signedIn, false);
  }
  status = 200;
  storage.setItem('cityside.oidc.request', JSON.stringify({ state: 'test-state', verifier: 'test-verifier', redirectUri: 'http://app.invalid/fines', createdAt: Date.now() }));
  await auth.completeLogin();
  assert.equal(await auth.token(), 'test-access');
  assert.equal(issuerCalls, 5); assert.equal(targetCalls, 0);
});
