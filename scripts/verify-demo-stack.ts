import { demoPortOffset, gatewayUrl, keycloakIssuerUrl, providerDewaUrl, providerPaymentsUrl, telecomServiceUrl } from './endpoints.ts';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { accountIdFor } from '../packages/backend-kit/src/context.ts';
const base = gatewayUrl;
const issuer = keycloakIssuerUrl;
const json = async (response: Response) => ({ status: response.status, data: await response.json() as any });
async function user(username: string) {
  const response = await fetch(`${issuer}/protocol/openid-connect/token`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'password', client_id: 'superapp-shell', username, password: process.env.DEMO_USER_PASSWORD || 'demo123', scope: 'openid' }) });
  const data = await response.json() as any;
  assert.equal(response.status, 200, `Keycloak login failed for ${username}: ${data.error_description || data.error || response.status}`);
  const payload = JSON.parse(Buffer.from(data.access_token.split('.')[1], 'base64url').toString());
  return { token: data.access_token, sub: payload.sub };
}
async function service(clientId: string, secret: string) {
  const response = await fetch(`${issuer}/protocol/openid-connect/token`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'client_credentials', client_id: clientId, client_secret: secret }) });
  const data = await response.json() as any; assert.equal(response.status, 200, `Service authentication failed for ${clientId}`); return data.access_token as string;
}
const alice = await user('bassem'), bob = await user('demo-commuter');
const call = async (path: string, token: string, method = 'GET', body?: any) => json(await fetch(base + path, { method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) }));
const a = await call('/api/accounts', alice.token); assert.equal(a.status, 200); assert.equal(a.data.accounts.length, 2);
const accountId = accountIdFor(alice.sub), bobAccount = accountIdFor(bob.sub);
assert.ok(a.data.accounts.some((account: any) => account.id === accountId));
console.log('PASS: two user logins and account discovery');
const sessionId = `verify_${randomUUID()}`;
const intent = await call('/api/a2ui/intent', alice.token, 'POST', { sessionId, accountId, text: 'Show my wallet balance' });
assert.equal(intent.status, 200, JSON.stringify(intent.data)); assert.ok(intent.data.surface?.revision);
assert.equal((await call('/api/a2ui/intent', bob.token, 'POST', { sessionId, text: 'Show my wallet' })).status, 403);
assert.equal((await call('/api/a2ui/intent', alice.token, 'POST', { sessionId, accountId: bobAccount, text: 'Show my wallet' })).status, 403);
const restored = await call(`/api/sessions/${sessionId}`, alice.token); assert.equal(restored.status, 200); assert.equal(restored.data.surface.revision, intent.data.surface.revision);
console.log('PASS: Redis session ownership, account isolation and restore');
const serviceToken = await service('service-wallet', 'demo-wallet-secret');
const paymentsToken = alice.token;
const provider = async (path: string, token = paymentsToken, method = 'GET', body?: any, key = randomUUID(), account = accountId) => json(await fetch(`${providerPaymentsUrl}/v1/accounts/${account}${path}`, { method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'Idempotency-Key': key }, ...(body ? { body: JSON.stringify(body) } : {}) }));
const before = await provider('/wallet'); assert.equal(before.status, 200, JSON.stringify(before.data));
const key = randomUUID(), chargeBody = { amountMinor: 123, merchant: 'superapp', reference: key, source: 'wallet' };
const charge = await provider('/charges', paymentsToken, 'POST', chargeBody, key); assert.equal(charge.status, 200);
const replay = await provider('/charges', paymentsToken, 'POST', chargeBody, key); assert.equal(replay.data.charge.id, charge.data.charge.id);
assert.equal((await provider('/wallet')).data.balanceMinor, before.data.balanceMinor - 123);
assert.equal((await provider('/charges', paymentsToken, 'POST', { ...chargeBody, amountMinor: 124 }, key)).status, 409);
assert.equal((await provider('/charges', paymentsToken, 'POST', { ...chargeBody, source: 'demo_declined' })).status, 402);
const refund = await provider(`/charges/${charge.data.charge.id}/refunds`, paymentsToken, 'POST', { reason: 'Integration verification' }); assert.equal(refund.status, 200);
assert.equal((await provider('/wallet')).data.balanceMinor, before.data.balanceMinor);
assert.equal((await provider('/wallet', serviceToken)).status, 403);
assert.equal((await provider('/wallet', paymentsToken, 'GET', undefined, randomUUID(), bobAccount)).status, 403);
const rideToken = await service('service-ride', 'demo-ride-secret');
const denied = await fetch(`${providerDewaUrl}/v1/accounts/${accountId}/bills`, { headers: { Authorization: `Bearer ${rideToken}`, 'X-User-Subject': alice.sub } }); assert.equal(denied.status, 403);
console.log('PASS: signed human identity, service impersonation rejection, payment capture/decline/refund and idempotency');
for (const [port, providerName] of [[4103,'etisalat'],[4104,'du']] as const) {
  const doc = await fetch(`http://localhost:${port + demoPortOffset}/openapi.json`); assert.equal((await doc.json() as any).openapi, '3.1.0');
  const response = await fetch(`${telecomServiceUrl}/telecom/${providerName}/bills`, { headers: { Authorization: `Bearer ${alice.token}`, 'X-Account-Id': accountId } }); assert.equal(response.status, 200); assert.ok((await response.json() as any).bills[0].billId);
}
console.log('PASS: Etisalat and du REST integration and OpenAPI discovery');
const topup = await call('/api/a2ui/action', alice.token, 'POST', { sessionId, accountId, surfaceRevision: intent.data.surface.revision, action: 'topup_wallet', payload: { amount: 50 } }); assert.equal(topup.status, 200, JSON.stringify(topup.data));
assert.equal((await call('/api/a2ui/action', alice.token, 'POST', { sessionId, accountId, surfaceRevision: intent.data.surface.revision, action: 'topup_wallet', payload: { amount: 50 } })).status, 409);
assert.equal((await call(`/api/sessions/${sessionId}`, alice.token, 'DELETE')).status, 200);
console.log('PASS: application → microservice → provider mutation and stale-action rejection');
console.log('Demo stack verification passed.');
