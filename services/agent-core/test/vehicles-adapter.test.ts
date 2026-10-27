import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { harness } from './support.ts';
import { AgentError, digest, quoteFor, type ExecutionContext, type Principal } from '../src/orchestrator/contracts.ts';
import { invokeTool } from '../src/orchestrator/fines-adapter.ts';

const granted = ['fines:read', 'fines:pay', 'vehicles:read', 'vehicles:renew'] as const;
async function setup(permissions: readonly string[] = granted) {
  const token = randomBytes(32).toString('hex');
  const identity = { token, subject: 'alice', permissions: [...permissions] as typeof granted[number][], expiresAt: Date.now() + 3600000 };
  const h = await harness({ identities: [identity] });
  const principal: Principal = { subject: 'alice', workload: 'super-app-agent', permissions: [...permissions], expiresAt: identity.expiresAt };
  const ctx: ExecutionContext = { principal, authorization: `Bearer ${token}`, correlationId: randomUUID(), revalidate: async () => principal };
  const payFines = () => {
    const quote = quoteFor(h.store.fines('alice')), key = digest({ subject: 'alice', operation: 'fines.pay.v1', quote }), consentId = randomUUID();
    h.store.consent(consentId, principal, key, quote, Date.now() + 60000);
    h.store.simulatePayment(principal, key, quote, consentId);
  };
  return { h, ctx, principal, payFines };
}

test('the renewal adapter lists vehicles and maps a refused renewal to its real reason', async () => {
  const { h, ctx, principal, payFines } = await setup();
  try {
    const [vehicle] = await invokeTool(h.vehicles.list, {}, ctx);
    assert.deepEqual(vehicle, { id: 'veh-1', description: 'Simulated sedan', renewalFeeMinor: 40000, version: 1 });
    const quote = { vehicleId: vehicle.id, amountMinor: vehicle.renewalFeeMinor, currency: 'AED' as const, version: vehicle.version };
    const key = digest({ subject: 'alice', operation: 'vehicles.renew.v1', quote }), consentId = randomUUID();
    h.store.renewalConsent(consentId, principal, key, quote, Date.now() + 60000);
    await assert.rejects(invokeTool(h.vehicles.renew, { quote, consentId }, ctx, key), (error: AgentError) => error.code === 'FINES_OUTSTANDING' && error.status === 409);
    payFines();
    const receipt = await invokeTool(h.vehicles.renew, { quote, consentId }, ctx, key);
    assert.equal(receipt.idempotencyKey, key); assert.equal(receipt.simulated, true);
    assert.deepEqual(await invokeTool(h.vehicles.renew, { quote, consentId }, ctx, key), receipt);
    assert.deepEqual(await invokeTool(h.vehicles.list, {}, ctx), []);
  } finally { await h.close(); }
});

test('the renewal tools enforce their own permission and require an idempotency key', async () => {
  const { h, ctx } = await setup(['fines:read', 'vehicles:read']);
  try {
    const quote = { vehicleId: 'veh-1', amountMinor: 40000, currency: 'AED' as const, version: 1 };
    await assert.rejects(invokeTool(h.vehicles.renew, { quote, consentId: randomUUID() }, ctx, 'a'.repeat(64)), (error: AgentError) => error.code === 'PERMISSION_DENIED');
    ctx.principal.permissions.push('vehicles:renew');
    await assert.rejects(invokeTool(h.vehicles.renew, { quote, consentId: randomUUID() }, ctx), (error: AgentError) => error.code === 'IDEMPOTENCY_KEY_REQUIRED');
    ctx.principal.permissions = ctx.principal.permissions.filter(permission => permission !== 'vehicles:read');
    await assert.rejects(invokeTool(h.vehicles.list, {}, ctx), (error: AgentError) => error.code === 'PERMISSION_DENIED');
  } finally { await h.close(); }
});

test('an unexpected simulator reply is a safe provider failure, not a renewal', async () => {
  const { h, ctx, principal } = await setup();
  try {
    await invokeTool(h.vehicles.list, {}, ctx);
    const quote = { vehicleId: 'veh-1', amountMinor: 40000, currency: 'AED' as const, version: 1 };
    const key = digest({ subject: 'alice', operation: 'vehicles.renew.v1', quote }), consentId = randomUUID();
    h.store.renewalConsent(consentId, principal, key, quote, Date.now() + 60000);
    // No consent for this id: the simulator answers 403, which must not be reported as a stale quote.
    await assert.rejects(invokeTool(h.vehicles.renew, { quote, consentId: randomUUID() }, ctx, key), (error: AgentError) => error.code === 'PROVIDER_DENIED');
    assert.equal((h.store.db.prepare('SELECT count(*) AS n FROM sa_sim_renewals').get() as { n: number }).n, 0);
  } finally { await h.close(); }
});
