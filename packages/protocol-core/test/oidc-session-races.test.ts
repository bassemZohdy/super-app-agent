import test from 'node:test';
import assert from 'node:assert/strict';
import { BrowserAuth } from '../src/oidc-client.ts';

function setup(t: test.TestContext) {
  const values = new Map<string, string>();
  const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); }, removeItem: (key: string) => { values.delete(key); } };
  const globals = { sessionStorage: storage, localStorage: storage, location: { href: 'http://app.invalid/fines?code=test-code&state=test-state', origin: 'http://app.invalid', pathname: '/fines', assign: () => {} }, history: { replaceState: () => {} } };
  for (const [key, value] of Object.entries(globals)) {
    const previous = Object.getOwnPropertyDescriptor(globalThis, key);
    Object.defineProperty(globalThis, key, { value, configurable: true, writable: true });
    t.after(() => { if (previous) Object.defineProperty(globalThis, key, previous); else Reflect.deleteProperty(globalThis, key); });
  }
  const config = { enabled: true, issuer: 'http://issuer.invalid', clientId: 'browser-client' };
  const old = JSON.stringify({ access_token: 'old-access', refresh_token: 'old-refresh', expiresAt: 0 });
  const current = JSON.stringify({ access_token: 'current-access', refresh_token: 'current-refresh', expiresAt: Date.now() + 600000 });
  return { storage, config, old, current };
}

test('a late refresh cannot restore a signed-out session', async t => {
  const { storage, config, old } = setup(t); storage.setItem('cityside.oidc.tokens', old);
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  t.mock.method(globalThis, 'fetch', async () => { await gate; return Response.json({ access_token: 'late-access', refresh_token: 'late-refresh', expires_in: 300 }); });
  const auth = new BrowserAuth(config), pending = auth.token(); void pending.catch(() => {});
  try {
    storage.setItem('cityside.oidc.request', 'pending');
    auth.logout(); release();
    await assert.rejects(pending, /sign-in changed/i);
    assert.equal(auth.signedIn, false); assert.equal(storage.getItem('cityside.oidc.tokens'), null);
    assert.equal(storage.getItem('cityside.oidc.request'), null);
  } finally { release(); await Promise.allSettled([pending]); }
});

test('a newer completed login survives a late refresh', async t => {
  const { storage, config, old } = setup(t); storage.setItem('cityside.oidc.tokens', old);
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  t.mock.method(globalThis, 'fetch', async (_url: string | URL | Request, init?: RequestInit) => {
    const body = init?.body as URLSearchParams;
    if (body.get('grant_type') === 'refresh_token') { await gate; return Response.json({ access_token: 'late-access', expires_in: 300 }); }
    return Response.json({ access_token: 'new-login', refresh_token: 'new-refresh', expires_in: 300 });
  });
  const auth = new BrowserAuth(config), pending = auth.token(); void pending.catch(() => {});
  try {
    storage.setItem('cityside.oidc.request', JSON.stringify({ state: 'test-state', verifier: 'test-verifier', redirectUri: 'http://app.invalid/fines', createdAt: Date.now() }));
    await auth.completeLogin();
    release(); await assert.rejects(pending, /sign-in changed/i);
    assert.equal(await auth.token(), 'new-login');
  } finally { release(); await Promise.allSettled([pending]); }
});

for (const fail of [false, true]) test(`an old refresh cannot overwrite or clear a newer session (upstream failure: ${fail})`, async t => {
  const { storage, config, old, current } = setup(t); storage.setItem('cityside.oidc.tokens', old);
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  t.mock.method(globalThis, 'fetch', async () => { await gate; return fail ? new Response('', { status: 401 }) : Response.json({ access_token: 'late-access', expires_in: 300 }); });
  const auth = new BrowserAuth(config), pending = auth.token(); void pending.catch(() => {});
  try {
    storage.setItem('cityside.oidc.tokens', current); release();
    await assert.rejects(pending);
    assert.equal(storage.getItem('cityside.oidc.tokens'), current);
    assert.equal(await auth.token(), 'current-access');
  } finally { release(); await Promise.allSettled([pending]); }
});

test('two browser-auth instances coalesce refresh for the same session', async t => {
  const { storage, config, old } = setup(t); storage.setItem('cityside.oidc.tokens', old);
  let release!: () => void, calls = 0;
  const gate = new Promise<void>(resolve => { release = resolve; });
  t.mock.method(globalThis, 'fetch', async () => { calls++; await gate; return Response.json({ access_token: 'new-access', refresh_token: 'new-refresh', expires_in: 300 }); });
  const first = new BrowserAuth(config).token(), second = new BrowserAuth(config).token();
  try {
    await new Promise<void>(resolve => setImmediate(resolve)); assert.equal(calls, 1);
    release(); assert.deepEqual(await Promise.all([first, second]), ['new-access', 'new-access']);
  } finally { release(); await Promise.allSettled([first, second]); }
});

test('a login exchange completing after sign-out does not restore the session', async t => {
  const { storage, config } = setup(t);
  storage.setItem('cityside.oidc.request', JSON.stringify({ state: 'test-state', verifier: 'test-verifier', redirectUri: 'http://app.invalid/fines', createdAt: Date.now() }));
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  t.mock.method(globalThis, 'fetch', async () => { await gate; return Response.json({ access_token: 'late-access', expires_in: 300 }); });
  const auth = new BrowserAuth(config), pending = auth.completeLogin(); void pending.catch(() => {});
  try {
    auth.clear(); release(); await assert.rejects(pending, /sign-in changed/i);
    assert.equal(auth.signedIn, false); assert.equal(storage.getItem('cityside.oidc.tokens'), null);
  } finally { release(); await Promise.allSettled([pending]); }
});
