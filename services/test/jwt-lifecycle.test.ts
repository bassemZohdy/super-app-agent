import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import { verifyJwt } from '../../packages/backend-kit/src/jwt.ts';

function setup(t: test.TestContext, name: string) {
  const issuer = `https://${name}.example/realm`;
  const env = { KEYCLOAK_ISSUER: issuer, KEYCLOAK_JWKS_URL: `${issuer}/keys` };
  for (const [key, value] of Object.entries(env)) {
    const previous = process.env[key]; process.env[key] = value;
    t.after(() => { if (previous === undefined) delete process.env[key]; else process.env[key] = previous; });
  }
  const pair = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const jwk = { ...pair.publicKey.export({ format: 'jwk' }), kid: 'key1', use: 'sig', alg: 'RS256' };
  const mint = (claims: Record<string, unknown> = {}, kid = jwk.kid, privateKey = pair.privateKey) => {
    const head = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT', kid })).toString('base64url');
    const payload = Buffer.from(JSON.stringify({ iss: process.env.KEYCLOAK_ISSUER, aud: 'agent-core', sub: 'alice',
      typ: 'Bearer', iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 300,
      realm_access: { roles: ['superapp-user'] }, ...claims })).toString('base64url');
    return `Bearer ${head}.${payload}.${sign('RSA-SHA256', Buffer.from(`${head}.${payload}`), privateKey).toString('base64url')}`;
  };
  return { issuer, jwk, mint };
}

test('access tokens reject wrong type, malformed time claims, oversized headers and invalid scope shapes', async t => {
  const { jwk, mint } = setup(t, 'token-types');
  t.mock.method(globalThis, 'fetch', async () => Response.json({ keys: [jwk] }));
  assert.equal((await verifyJwt(mint(), 'agent-core')).sub, 'alice');
  for (const claims of [{ typ: 'ID' }, { exp: null }, { nbf: '0' }, { iat: null },
    { exp: 1e100 }, { scope: ['openid'] }, { realm_access: { roles: [42] } }]) {
    await assert.rejects(() => verifyJwt(mint(claims), 'agent-core'));
  }
  await assert.rejects(() => verifyJwt(mint({}, 'x'.repeat(1000)), 'agent-core'));
});

test('JWKS requests deduplicate, unknown keys are throttled and issuer changes isolate caches', async t => {
  const { jwk, mint } = setup(t, 'key-coordination');
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => { calls++; await new Promise(resolve => setTimeout(resolve, 10)); return Response.json({ keys: [jwk] }); });
  await Promise.all(Array.from({ length: 20 }, () => verifyJwt(mint(), 'agent-core')));
  assert.equal(calls, 1);
  for (let i = 0; i < 10; i++) await assert.rejects(() => verifyJwt(mint({}, `unknown-${i}`), 'agent-core'));
  assert.equal(calls, 1);
  process.env.KEYCLOAK_ISSUER = 'https://changed-issuer.example/realm';
  await verifyJwt(mint(), 'agent-core');
  assert.equal(calls, 2);
});

test('JWKS rotation refreshes once after cooldown and an expired cache fails closed on outage', async t => {
  const { jwk, mint } = setup(t, 'key-rotation');
  const next = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const nextKey = { ...next.publicKey.export({ format: 'jwk' }), kid: 'key2', use: 'sig', alg: 'RS256' };
  let now = Date.now(), calls = 0, unavailable = false;
  t.mock.method(Date, 'now', () => now);
  t.mock.method(globalThis, 'fetch', async () => { calls++; if (unavailable) return new Response('', { status: 503 }); return Response.json({ keys: calls === 1 ? [jwk] : [jwk, nextKey] }); });
  await verifyJwt(mint(), 'agent-core');
  now += 6000;
  await Promise.all(Array.from({ length: 10 }, () => verifyJwt(mint({}, 'key2', next.privateKey), 'agent-core')));
  assert.equal(calls, 2);
  now += 301000; unavailable = true;
  await assert.rejects(() => verifyJwt(mint(), 'agent-core'));
});

test('configured online token checks reject revoked tokens without exposing introspection errors', async t => {
  const { issuer, jwk, mint } = setup(t, 'online-token');
  const values = { KEYCLOAK_INTROSPECTION_URL: `${issuer}/introspect`, KEYCLOAK_INTROSPECTION_CLIENT_ID: 'verifier', KEYCLOAK_INTROSPECTION_CLIENT_SECRET: 'test-secret' };
  for (const [key, value] of Object.entries(values)) { const previous = process.env[key]; process.env[key] = value; t.after(() => { if (previous === undefined) delete process.env[key]; else process.env[key] = previous; }); }
  let active = true;
  t.mock.method(globalThis, 'fetch', async (url: string | URL | Request, init?: RequestInit) => {
    if (String(url).endsWith('/keys')) return Response.json({ keys: [jwk] });
    assert.equal(String(url), values.KEYCLOAK_INTROSPECTION_URL);
    assert.equal(init?.method, 'POST');
    return Response.json({ active });
  });
  await verifyJwt(mint(), 'agent-core');
  active = false;
  await assert.rejects(() => verifyJwt(mint(), 'agent-core'));
});
