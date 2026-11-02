import test from 'node:test';
import assert from 'node:assert/strict';
import { BrowserAuth } from '../src/oidc-client.ts';

test('browser token exchanges bound streamed responses and do not expose malformed bodies', async t => {
  const values = new Map<string, string>();
  const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); }, removeItem: (key: string) => { values.delete(key); } };
  for (const key of ['sessionStorage', 'localStorage']) {
    const previous = Object.getOwnPropertyDescriptor(globalThis, key);
    Object.defineProperty(globalThis, key, { value: storage, configurable: true });
    t.after(() => { if (previous) Object.defineProperty(globalThis, key, previous); else Reflect.deleteProperty(globalThis, key); });
  }
  let nextResponse!: Response;
  t.mock.method(globalThis, 'fetch', async () => nextResponse);
  const auth = new BrowserAuth({ enabled: true, issuer: 'http://issuer.invalid', clientId: 'browser-client' });
  const setExpired = () => storage.setItem('cityside.oidc.tokens', JSON.stringify({ access_token: 'old', refresh_token: 'refresh', expiresAt: 0 }));
  let cancelled = false;
  const encoded = new TextEncoder().encode(JSON.stringify({ access_token: 'access', expires_in: 300, padding: 'x'.repeat(70000) }));
  nextResponse = new Response(new ReadableStream({ start(controller) { controller.enqueue(encoded.subarray(0, 32000)); controller.enqueue(encoded.subarray(32000)); }, cancel() { cancelled = true; return new Promise(() => {}); } }), { headers: { 'Content-Length': '10' } });
  setExpired();
  await assert.rejects(Promise.race([auth.token(), new Promise((_, reject) => setTimeout(() => reject(new Error('cancellation blocked')), 500))]), /invalid sign-in response/i);
  assert.equal(cancelled, true); assert.equal(auth.signedIn, false);
  nextResponse = new Response('{"secret":"do-not-expose", bad json');
  setExpired();
  await assert.rejects(auth.token(), error => error instanceof Error && error.message === 'Invalid sign-in response.');
  assert.equal(auth.signedIn, false);
  const valid = new TextEncoder().encode(JSON.stringify({ access_token: 'valid-access', expires_in: 300, padding: 'x'.repeat(63000) }));
  nextResponse = new Response(new ReadableStream({ start(controller) { controller.enqueue(valid.subarray(0, 20000)); controller.enqueue(valid.subarray(20000)); controller.close(); } }));
  setExpired(); assert.equal(await auth.token(), 'valid-access');
});
