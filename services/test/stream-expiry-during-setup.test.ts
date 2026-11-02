import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { server, sseClients } from '../agent-core/src/index.ts';
import { redisSessions } from '../agent-core/src/session-store.ts';

for (const stage of ['subscription', 'replay'] as const) test(`a token expiring during ${stage} cannot open a stream or retain capacity`, { timeout: 10000 }, async t => {
  const issuer = `https://stream-setup-expiry.example/realms/${stage}`;
  const settings = { SESSION_STORE: 'redis', REDIS_URL: 'redis://127.0.0.1:1', SESSION_KEY_PREFIX: 'stream-expiry-setup:', DEMO_AUTH: 'false', NODE_ENV: 'test', KEYCLOAK_ISSUER: issuer, KEYCLOAK_JWKS_URL: `${issuer}/certs`, KEYCLOAK_AUDIENCE: 'agent-core' };
  for (const [key, value] of Object.entries(settings)) {
    const old = process.env[key]; process.env[key] = value;
    t.after(() => { if (old === undefined) delete process.env[key]; else process.env[key] = old; });
  }
  const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'expiry-setup', alg: 'RS256' };
  const originalFetch = globalThis.fetch;
  t.mock.method(globalThis, 'fetch', (input, init) => String(input) === `${issuer}/certs` ? Promise.resolve(Response.json({ keys: [jwk] })) : originalFetch(input, init));
  const store = redisSessions()!;
  t.mock.method(store, 'claim', async () => ({} as never));
  let release!: () => void, unsubscribed = 0;
  const pending = new Promise<void>(resolve => { release = resolve; });
  t.mock.method(store, 'subscribe', async () => { if (stage === 'subscription') await pending; return async () => { unsubscribed++; }; });
  t.mock.method(store, 'after', async () => { if (stage === 'replay') await pending; return []; });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); });
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', kid: 'expiry-setup' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({ iss: issuer, aud: 'agent-core', typ: 'Bearer', sub: 'expiry-owner', exp: Math.floor(Date.now() / 1000) + 3 })).toString('base64url');
  const token = `${header}.${payload}.${sign('RSA-SHA256', Buffer.from(`${header}.${payload}`), privateKey).toString('base64url')}`;
  const timer = setTimeout(release, 4200);
  try {
    const response = await fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}/api/a2ui/stream?sessionId=expiry_pending_123`, { headers: { Authorization: `Bearer ${token}`, ...(stage === 'replay' ? { 'Last-Event-ID': 'previous' } : {}) } });
    assert.equal(response.status, 401);
    release();
    const deadline = Date.now() + 3000;
    while (unsubscribed < 1 && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 10));
    assert.equal(unsubscribed, 1);
    assert.equal(sseClients.has('expiry_pending_123'), false);
  } finally { clearTimeout(timer); release(); }
});
