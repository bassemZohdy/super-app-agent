import test from 'node:test';
import assert from 'node:assert/strict';
import { executeRideRequest, salikBalance } from '../service-ride/src/index.ts';
import { callDomain, domainHandlers, DomainOperationError, trackDomainOperations, type Step } from '../agent-core/src/domain-operations.ts';

test('offline toll recharge rejects an unreviewed tag before changing the balance', () => {
  const before = salikBalance;
  const wrong = executeRideRequest('POST', '/mobility/salik/recharge', {}, { amount: 100, expectedTag: 'other-tag' });
  assert.equal(wrong.status, 409); assert.equal(salikBalance, before);
  const good = executeRideRequest('POST', '/mobility/salik/recharge', {}, { amount: 100, expectedTag: 'SLK-8492019' });
  assert.equal(good.status, 200); assert.equal(salikBalance, before + 100);
  const receipt = executeRideRequest('GET', `/mobility/salik/recharges/${good.data.transactionId}`);
  assert.deepEqual(receipt.data.recharge, { transactionId: good.data.transactionId, tagId: 'SLK-8492019', amountMinor: 10000, currency: 'AED' });
  assert.equal(executeRideRequest('GET', '/mobility/salik/recharges/unknown').data.recharge, null);
  assert.equal(salikBalance, before + 100);
});

test('a mismatched toll receipt is unknown and cannot be confirmed', async t => {
  let scenario = 'valid';
  t.mock.method(domainHandlers, 'ride', () => ({ status: 200, data: { success: true, transactionId: 'tx-1', newBalance: 200, tagId: scenario === 'wrong-tag' ? 'other' : 'SLK-8492019', rechargedAmount: scenario === 'wrong-amount' ? 101 : 100 } }));
  const run = () => callDomain('ride', 'POST', '/mobility/salik/recharge', {}, { amount: 100, expectedTag: 'SLK-8492019' });
  assert.equal(run().status, 200);
  for (scenario of ['wrong-tag', 'wrong-amount']) {
    const steps: Step[] = [];
    await trackDomainOperations(steps, async () => assert.throws(run, (error: unknown) => error instanceof DomainOperationError && error.code === 'DOMAIN_OUTCOME_UNKNOWN'));
    assert.equal(steps[0].state, 'UNKNOWN');
  }
});


test('toll receipt lookup is bounded and missing history is not invented', () => {
  const initial = executeRideRequest('POST', '/mobility/salik/recharge', {}, { amount: 0.01, expectedTag: 'SLK-8492019' });
  assert.equal(initial.status, 200);
  for (let i = 0; i < 256; i++) assert.equal(executeRideRequest('POST', '/mobility/salik/recharge', {}, { amount: 0.01, expectedTag: 'SLK-8492019' }).status, 200);
  assert.equal(executeRideRequest('GET', `/mobility/salik/recharges/${initial.data.transactionId}`).data.recharge, null);
});
