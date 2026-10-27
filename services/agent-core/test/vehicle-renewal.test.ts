import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { harness } from './support.ts';
import { digest, quoteFor, type Principal } from '../src/orchestrator/contracts.ts';

const permissions = ['fines:read', 'fines:pay', 'vehicles:read', 'vehicles:renew'] as const;
const identity = (subject: string, granted: readonly string[] = permissions) => ({ token: randomBytes(32).toString('hex'), subject, permissions: [...granted] as typeof permissions[number][], expiresAt: Date.now() + 3600000 });
const renewalKey = (subject: string, quote: unknown) => digest({ subject, operation: 'vehicles.renew.v1', quote });

async function setup() {
  const alice = identity('alice'), bob = identity('bob', ['vehicles:read']);
  const h = await harness({ identities: [alice, bob] });
  const principal: Principal = { subject: 'alice', workload: 'super-app-agent', permissions: [...permissions], expiresAt: alice.expiresAt };
  const headers = { 'X-Agent-Key': h.workloadKey };
  const renew = (quote: unknown, consentId: string, key: string, token = alice.token) => h.req('/simulator/v1/renewals', { quote, consentId }, { token, key, headers });
  const approve = (quote: Parameters<typeof h.store.renewalConsent>[3]) => {
    const consentId = randomUUID(), key = renewalKey('alice', quote);
    h.store.renewalConsent(consentId, principal, key, quote, Date.now() + 60000);
    return { consentId, key };
  };
  const payFines = () => {
    const quote = quoteFor(h.store.fines('alice')), key = digest({ subject: 'alice', operation: 'fines.pay.v1', quote }), consentId = randomUUID();
    h.store.consent(consentId, principal, key, quote, Date.now() + 60000);
    h.store.simulatePayment(principal, key, quote, consentId);
  };
  return { h, alice, bob, headers, renew, approve, payFines };
}
const count = (h: Awaited<ReturnType<typeof setup>>['h'], table: string) => (h.store.db.prepare(`SELECT count(*) AS n FROM ${table}`).get() as { n: number }).n;

test('the simulator lists only the caller’s vehicle and needs both the permission and the workload key', async () => {
  const { h, alice, headers } = await setup();
  try {
    const list = await h.req('/simulator/v1/vehicles', undefined, { token: alice.token, headers });
    assert.equal(list.status, 200);
    assert.deepEqual(list.data, [{ id: 'veh-1', description: 'Simulated sedan', renewalFeeMinor: 40000, version: 1 }]);
    assert.equal((await h.req('/simulator/v1/vehicles', undefined, { token: alice.token })).status, 403);
    const finesOnly = identity('carol', ['fines:read']);
    h.identities.push(finesOnly);
    assert.equal((await h.req('/simulator/v1/vehicles', undefined, { token: finesOnly.token, headers })).status, 403);
  } finally { await h.close(); }
});

test('renewal is refused while fines are outstanding, then succeeds exactly once and replays by its original key', async () => {
  const { h, headers, renew, approve, payFines } = await setup();
  try {
    const [vehicle] = (await h.req('/simulator/v1/vehicles', undefined, { headers })).data as unknown as Array<{ id: string; renewalFeeMinor: number; version: number }>;
    const quote = { vehicleId: vehicle.id, amountMinor: vehicle.renewalFeeMinor, currency: 'AED' as const, version: vehicle.version };
    const first = approve(quote);
    const blocked = await renew(quote, first.consentId, first.key);
    assert.equal(blocked.status, 409); assert.equal(blocked.data.code, 'FINES_OUTSTANDING');
    assert.equal(count(h, 'sa_sim_renewals'), 0);
    payFines();
    const done = await renew(quote, first.consentId, first.key);
    assert.equal(done.status, 200); assert.equal(done.data.simulated, true); assert.equal(done.data.idempotencyKey, first.key);
    assert.deepEqual((await renew(quote, first.consentId, first.key)).data, done.data);
    assert.equal(count(h, 'sa_sim_renewals'), 1);
    // A second approval of the identical quote is the same operation key, so it replays the original receipt.
    const again = approve(quote);
    assert.equal(again.key, first.key);
    assert.deepEqual((await renew(quote, again.consentId, again.key)).data, done.data);
    // A different quote for the already renewed vehicle is a new operation and cannot create a second effect.
    const changed = { ...quote, version: 2 }, other = approve(changed);
    const stale = await renew(changed, other.consentId, other.key);
    assert.equal(stale.status, 409); assert.equal(stale.data.code, 'QUOTE_STALE');
    assert.equal(count(h, 'sa_sim_renewals'), 1);
  } finally { await h.close(); }
});

test('renewal needs matching consent, an unchanged quote and the renew permission', async () => {
  const { h, bob, renew, approve, payFines } = await setup();
  try {
    payFines();
    const quote = { vehicleId: 'veh-1', amountMinor: 40000, currency: 'AED' as const, version: 1 };
    const { consentId, key } = approve(quote);
    assert.equal((await renew(quote, randomUUID(), key)).data.code, 'CONSENT_REQUIRED_OR_EXPIRED');
    assert.equal((await renew({ ...quote, amountMinor: 1 }, consentId, key)).data.code, 'CONSENT_REQUIRED_OR_EXPIRED');
    assert.equal((await renew(quote, consentId, key, bob.token)).status, 403);
    assert.equal((await renew({ ...quote, vehicleId: 'veh-9' }, consentId, renewalKey('alice', { ...quote, vehicleId: 'veh-9' }))).status, 403);
    const changed = { ...quote, amountMinor: 1 }, other = approve(changed);
    assert.equal((await renew(changed, other.consentId, other.key)).data.code, 'QUOTE_STALE');
    assert.equal(count(h, 'sa_sim_renewals'), 0);
  } finally { await h.close(); }
});
