import test from 'node:test';
import assert from 'node:assert/strict';
import { BrowserAuth } from '../src/oidc-client.ts';

test('browser login consumes only a fresh, complete, single-use request', async t => {
  const values = new Map<string, string>();
  const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); }, removeItem: (key: string) => { values.delete(key); } };
  const globals = { sessionStorage: storage, localStorage: storage, location: { href: 'http://app.invalid/fines?code=code&state=state', origin: 'http://app.invalid', pathname: '/fines' }, history: { replaceState: () => { scrubbed++; } } };
  let scrubbed = 0, calls = 0;
  for (const [key, value] of Object.entries(globals)) {
    const previous = Object.getOwnPropertyDescriptor(globalThis, key);
    Object.defineProperty(globalThis, key, { value, configurable: true, writable: true });
    t.after(() => { if (previous) Object.defineProperty(globalThis, key, previous); else Reflect.deleteProperty(globalThis, key); });
  }
  const now = 1700000000000; t.mock.method(Date, 'now', () => now);
  t.mock.method(globalThis, 'fetch', async () => { calls++; return Response.json({ access_token: 'access', expires_in: 300 }); });
  const auth = new BrowserAuth({ enabled: true, issuer: 'http://issuer.invalid', clientId: 'browser-client' });
  const request = { state: 'state', verifier: 'verifier', redirectUri: 'http://app.invalid/fines', createdAt: now };
  const invalid = [
    '{malformed', JSON.stringify({ ...request, createdAt: now - 300001 }), JSON.stringify({ ...request, createdAt: now + 1 }),
    JSON.stringify({ ...request, createdAt: 'not-a-date' }), JSON.stringify({ ...request, createdAt: null }),
    JSON.stringify({ ...request, state: '' }), JSON.stringify({ ...request, verifier: '' }),
    JSON.stringify({ ...request, redirectUri: 'http://other.invalid/' }),
  ];
  for (const value of invalid) {
    storage.setItem('cityside.oidc.request', value);
    await assert.rejects(auth.completeLogin(), /sign-in was cancelled or expired/i);
    assert.equal(storage.getItem('cityside.oidc.request'), null);
    assert.equal(calls, 0);
  }
  assert.equal(scrubbed, invalid.length);
  storage.setItem('cityside.oidc.request', JSON.stringify({ ...request, createdAt: now - 299999 }));
  await auth.completeLogin(); assert.equal(calls, 1);
  assert.equal(storage.getItem('cityside.oidc.request'), null);
  await assert.rejects(auth.completeLogin(), /sign-in was cancelled or expired/i);
  assert.equal(calls, 1);
});
