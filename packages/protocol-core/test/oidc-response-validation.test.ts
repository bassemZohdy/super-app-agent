import test from 'node:test';
import assert from 'node:assert/strict';
import { BrowserAuth } from '../src/oidc-client.ts';

test('refresh rejects malformed token responses and clears the expired session', async t => {
  const values = new Map<string, string>();
  const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); }, removeItem: (key: string) => { values.delete(key); } };
  for (const key of ['sessionStorage', 'localStorage']) {
    const previous = Object.getOwnPropertyDescriptor(globalThis, key);
    Object.defineProperty(globalThis, key, { value: storage, configurable: true });
    t.after(() => { if (previous) Object.defineProperty(globalThis, key, previous); else Reflect.deleteProperty(globalThis, key); });
  }
  let response: Record<string, unknown> = {};
  t.mock.method(globalThis, 'fetch', async () => Response.json(response));
  const auth = new BrowserAuth({ enabled: true, issuer: 'http://issuer.invalid', clientId: 'browser-client' });
  const invalid = [
    { access_token: '', expires_in: 300 },
    { access_token: 'with space', expires_in: 300 },
    { access_token: 'x'.repeat(16385), expires_in: 300 },
    { access_token: 'access', expires_in: 0 },
    { access_token: 'access', expires_in: -1 },
    { access_token: 'access', expires_in: 0.5 },
    { access_token: 'access', expires_in: 9007199254740991 },
    { access_token: 'access', expires_in: 300, refresh_token: '' },
    { access_token: 'access', expires_in: 300, id_token: 42 },
  ];
  for (const item of invalid) {
    storage.setItem('cityside.oidc.tokens', JSON.stringify({ access_token: 'old', refresh_token: 'refresh', expiresAt: 0 }));
    response = item;
    await assert.rejects(auth.token(), /invalid sign-in response/i);
    assert.equal(storage.getItem('cityside.oidc.tokens'), null);
    assert.equal(auth.signedIn, false);
  }
  storage.setItem('cityside.oidc.tokens', JSON.stringify({ access_token: 'old', refresh_token: 'refresh', expiresAt: 0 }));
  response = { access_token: 'valid.access-token', refresh_token: 'valid-refresh', id_token: 'valid-id', expires_in: 300 };
  assert.equal(await auth.token(), 'valid.access-token');
});
