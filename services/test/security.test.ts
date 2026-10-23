import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import { verifyKeycloakToken } from '../agent-core/src/auth.ts';
import { getOrCreateSession, executeCoreRequest } from '../agent-core/src/index.ts';

test('security: rejects fabricated JWTs instead of trusting decoded claims', async () => {
  const fakePayload = Buffer.from(JSON.stringify({
    iss: process.env.KEYCLOAK_ISSUER, sub: 'admin', exp: Math.floor(Date.now() / 1000) + 3600,
    aud: 'agent-core', realm_access: { roles: ['superapp-admin'] },
  })).toString('base64url');
  const fakeHeader = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
  const result = await verifyKeycloakToken('Bearer ' + fakeHeader + '.' + fakePayload + '.unsigned');
  assert.strictEqual(result.authenticated, false);
  assert.strictEqual(result.statusCode, 401);
});

test('security: verified JWT sessions belong to the authenticated subject', async t => {
  const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const jwk: any = publicKey.export({ format: 'jwk' });
  jwk.kid = 'test-signing-key';
  jwk.use = 'sig';
  jwk.alg = 'RS256';
  const oldFetch = globalThis.fetch;
  const previousIssuer = process.env.KEYCLOAK_ISSUER;
  const previousJwks = process.env.KEYCLOAK_JWKS_URL;
  const previousAudience = process.env.KEYCLOAK_AUDIENCE;
  globalThis.fetch = async () => new Response(JSON.stringify({ keys: [jwk] }), { status: 200 });
  process.env.KEYCLOAK_ISSUER = 'https://issuer.example/realms/superapp';
  process.env.KEYCLOAK_JWKS_URL = 'https://issuer.example/keys';
  process.env.KEYCLOAK_AUDIENCE = 'agent-core';
  t.after(() => {
    globalThis.fetch = oldFetch;
    if (previousIssuer === undefined) delete process.env.KEYCLOAK_ISSUER;
    else process.env.KEYCLOAK_ISSUER = previousIssuer;
    if (previousJwks === undefined) delete process.env.KEYCLOAK_JWKS_URL;
    else process.env.KEYCLOAK_JWKS_URL = previousJwks;
    if (previousAudience === undefined) delete process.env.KEYCLOAK_AUDIENCE;
    else process.env.KEYCLOAK_AUDIENCE = previousAudience;
  });
  const mint = (sub: string, claims: Record<string, unknown> = {}) => {
    const header = Buffer.from(JSON.stringify({ alg: 'RS256', kid: 'test-signing-key', typ: 'JWT' })).toString('base64url');
    const payload = Buffer.from(JSON.stringify({
      iss: process.env.KEYCLOAK_ISSUER, aud: 'agent-core', typ: 'Bearer', sub,
      exp: Math.floor(Date.now() / 1000) + 3600,
      ...claims,
    })).toString('base64url');
    const raw = header + '.' + payload;
    const signature = sign('RSA-SHA256', Buffer.from(raw), privateKey).toString('base64url');
    return 'Bearer ' + raw + '.' + signature;
  };
  const alice = mint('user-alice');
  const bob = mint('user-bob');
  const accepted = await verifyKeycloakToken(alice);
  assert.strictEqual(accepted.authenticated, true);
  assert.strictEqual(accepted.user?.sub, 'user-alice');
  const forged = await verifyKeycloakToken(alice.slice(0, -3) + 'abc');
  assert.strictEqual(forged.authenticated, false);
  const wrongAudience = await verifyKeycloakToken(mint('user-alice', { aud: 'different-client' }));
  assert.strictEqual(wrongAudience.authenticated, false);
  const expired = await verifyKeycloakToken(mint('user-alice', { exp: 1 }));
  assert.strictEqual(expired.authenticated, false);
  const sid = 'sess_auth_isolation_001';
  const create = await executeCoreRequest('POST', '/api/a2ui/intent', {}, {
    sessionId: sid, text: 'Show my wallet balance',
  }, { authorization: alice });
  assert.strictEqual(create.status, 200);
  const denied = await executeCoreRequest('POST', '/api/a2ui/intent', {}, {
    sessionId: sid, text: 'Show my wallet balance',
  }, { authorization: bob });
  assert.strictEqual(denied.status, 403);
  const forbidden = await executeCoreRequest('POST', '/api/a2ui/action', {}, {
    sessionId: sid, surfaceRevision: getOrCreateSession(sid).currentSurface?.revision, action: 'pay_police_fines', payload: {},
  }, { authorization: alice });
  assert.strictEqual(forbidden.status, 403);
});
