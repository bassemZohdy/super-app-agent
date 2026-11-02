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
