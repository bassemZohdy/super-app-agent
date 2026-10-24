/** Run inside the local agent-core container: controlled-key negative tests, no JWT output. */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { signedJwt, assertionTimes } from '../services/delegation/src/keys.ts';
import { issuerName, grantStore } from '../services/delegation/src/service.ts';
import { brokerClient, digest, tokenHash } from '../services/delegation/src/policy.ts';
import { accountIdFor } from '../packages/backend-kit/src/context.ts';
const issuer = process.env.KEYCLOAK_ISSUER!;
const endpoint = process.env.KEYCLOAK_TOKEN_URL!;
async function login() {
  const response = await fetch(endpoint, { method: 'POST', body: new URLSearchParams({ grant_type: 'password', client_id: 'superapp-shell', username: 'bassem', password: 'demo123' }) });
  assert.equal(response.status, 200); const data = await response.json() as any;
  return { token: data.access_token as string, sub: JSON.parse(Buffer.from(data.access_token.split('.')[1], 'base64url').toString()).sub as string };
}
const human = await login();
const payload = () => ({ ...assertionTimes(Date.now() + 90000), iss: issuerName(), sub: `cityside:${human.sub}`, aud: issuer, scope: 'delegation.read' });
async function exchange(assertion: string, scope = 'delegation.read') {
  const response = await fetch(endpoint, { method: 'POST', body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', client_id: brokerClient, assertion, scope, client_assertion_type: 'urn:ietf:params:oauth:client-assertion-type:jwt-bearer', client_assertion: signedJwt('client', { ...assertionTimes(Date.now() + 60000), iss: brokerClient, sub: brokerClient, aud: issuer }) }) });
  return { status: response.status, data: await response.json() as any };
}
async function denied(name: string, assertion: string, scope?: string) { const r = await exchange(assertion, scope); assert.ok(r.status >= 400 && !r.data.access_token, `${name}: expected rejection`); console.log(`PASS: ${name}`); }
const validAssertion = signedJwt('issuer', payload());
const valid = await exchange(validAssertion); assert.equal(valid.status, 200, `Valid exchange failed (${valid.data.error})`); assert.equal(valid.data.refresh_token, undefined);
const claims = JSON.parse(Buffer.from(valid.data.access_token.split('.')[1], 'base64url').toString());
assert.equal(claims.sub, human.sub); assert.equal(claims.azp, brokerClient); assert.equal(claims.act, undefined); assert.equal(claims.scope, 'delegation.read');
assert.ok((Array.isArray(claims.aud) ? claims.aud : [claims.aud]).every((a: string) => ['provider-api', 'cityside-verifier'].includes(a)));
console.log('PASS: linked internal user, actual broker azp, minimal scope/audience, no act or refresh token');
await denied('replayed assertion jti', validAssertion);
await denied('unknown linked subject', signedJwt('issuer', { ...payload(), sub: `unlinked-${randomUUID()}` }));
await denied('wrong issuer', signedJwt('issuer', { ...payload(), iss: 'https://untrusted.example' }));
await denied('wrong audience', signedJwt('issuer', { ...payload(), aud: 'https://wrong.example' }));
await denied('multiple audiences', signedJwt('issuer', { ...payload(), aud: [issuer, 'https://wrong.example'] }));
await denied('expired assertion', signedJwt('issuer', { ...payload(), iat: Math.floor(Date.now() / 1000) - 100, nbf: Math.floor(Date.now() / 1000) - 100, exp: Math.floor(Date.now() / 1000) - 10 }));
await denied('future assertion', signedJwt('issuer', { ...payload(), nbf: Math.floor(Date.now() / 1000) + 60 }));
await denied('wrong signing key/kid', signedJwt('client', payload()));
await denied('scope expansion', signedJwt('issuer', payload()), 'delegation.read delegation.write');
const noJti = { ...payload() } as Record<string, unknown>; delete noJti.jti;
await denied('missing jti', signedJwt('issuer', noJti));
const noExp = { ...payload() } as Record<string, unknown>; delete noExp.exp;
await denied('missing expiration', signedJwt('issuer', noExp));
const wrongClient = await fetch(endpoint, { method: 'POST', body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', client_id: 'delegation-runner', client_secret: readFileSync('.data/delegation/runner-secret', 'utf8'), assertion: signedJwt('issuer', payload()), scope: 'delegation.read' }) });
assert.ok(wrongClient.status >= 400); console.log('PASS: assertion cannot be exchanged by the runner client');
const longLived = await exchange(signedJwt('issuer', { ...payload(), exp: Math.floor(Date.now() / 1000) + 600 }));
if (longLived.status === 200) {
  const longClaims = JSON.parse(Buffer.from(longLived.data.access_token.split('.')[1], 'base64url').toString());
  assert.ok(longClaims.exp <= Math.floor(Date.now() / 1000) + 90);
  console.log('OBSERVED: long assertion accepted; independent client access-token lifetime cap remains 90 seconds. Issuer must enforce its own 90-second assertion bound.');
} else console.log('PASS: overlong assertion rejected');
const target = `${process.env.PROVIDER_PAYMENTS_URL}/v1/accounts/${accountIdFor(human.sub)}/wallet`;
assert.equal((await fetch(target, { headers: { Authorization: `Bearer ${valid.data.access_token}`, 'X-User-Subject': human.sub } })).status, 403);
console.log('PASS: valid but unregistered user token cannot authorize a delegated provider operation');
const store = grantStore();
const grant = store.create(human.sub, { accountId: accountIdFor(human.sub), provider: 'payments', method: 'GET', path: '/wallet', body: {}, purpose: 'Verify immediate consent withdrawal', expiresInSeconds: 300, maxOperations: 2 });
try {
  const job = store.start(grant.id, randomUUID());
  store.bind(tokenHash(valid.data.access_token), { grantId: grant.id, version: grant.version, sub: human.sub, actor: brokerClient, exp: claims.exp, operationId: job.job.id, requestDigest: digest({ provider: grant.provider, method: grant.method, path: grant.path, body: grant.body }) });
  store.revoke(grant.id, human.sub);
  const introspection = await fetch(process.env.KEYCLOAK_INTROSPECTION_URL!, { method: 'POST', body: new URLSearchParams({ client_id: process.env.KEYCLOAK_INTROSPECTION_CLIENT_ID!, client_secret: process.env.KEYCLOAK_INTROSPECTION_CLIENT_SECRET!, token: valid.data.access_token }) });
  assert.equal((await introspection.json() as any).active, true);
  assert.equal((await fetch(target, { headers: { Authorization: `Bearer ${valid.data.access_token}` } })).status, 403);
  console.log('PASS: already-issued introspection-active token denied after online grant revocation');
} finally { store.revoke(grant.id, human.sub); store.close(); }
