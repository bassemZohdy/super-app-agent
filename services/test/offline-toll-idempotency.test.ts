import test from 'node:test';
import assert from 'node:assert/strict';
import { actorFor } from '../../packages/backend-kit/src/context.ts';
import { integratedRequest } from '../../packages/backend-kit/src/application.ts';
import { executeRideRequest, salikBalance } from '../service-ride/src/index.ts';
import { callDomain, domainHandlers, DomainOperationError } from '../agent-core/src/domain-operations.ts';

test('offline toll identity binds the exact tag and amount and deduplicates repeats', async () => {
  const tag = executeRideRequest('GET', '/mobility/salik/balance').data.tagId;
  const body = { operationId: 'CIVIC-toll-1', amount: 100, expectedTag: tag }, before = salikBalance;
  const first = executeRideRequest('POST', '/mobility/salik/recharge', {}, body);
  assert.equal(first.status, 200); assert.equal(first.data.operationId, body.operationId);
  const again = executeRideRequest('POST', '/mobility/salik/recharge', {}, body);
  assert.equal(again.data.transactionId, first.data.transactionId); assert.equal(salikBalance, before + 100);
  assert.equal(executeRideRequest('POST', '/mobility/salik/recharge', {}, { ...body, amount: 101 }).status, 409);
  assert.equal(executeRideRequest('POST', '/mobility/salik/recharge', {}, { ...body, expectedTag: 'other' }).status, 409);
  assert.equal(executeRideRequest('POST', '/mobility/salik/recharge', {}, { operationId: 'CIVIC-missing', amount: 100 }).status, 400);
  const result = executeRideRequest('GET', `/mobility/salik/recharge-operations/${body.operationId}`);
  assert.equal(result.data.operation.receiptReference, first.data.transactionId); assert.equal(result.data.operation.tagId, tag); assert.equal(result.data.operation.amountMinor, 10000);
  result.data.operation.tagId = 'tampered'; assert.equal(executeRideRequest('GET', `/mobility/salik/recharge-operations/${body.operationId}`).data.operation.tagId, tag);
  assert.equal(executeRideRequest('GET', '/mobility/salik/recharge-operations/unknown').data.operation, null);
  const legacy = () => ({ status: 404, data: {} });
  assert.equal((await integratedRequest('service-ride', actorFor({ sub: 'toll-identity-test' }), 'POST', '/mobility/salik/recharge', {}, body, legacy)).status, 400);
  assert.equal((await integratedRequest('service-ride', actorFor({ sub: 'toll-identity-test' }), 'GET', `/mobility/salik/recharge-operations/${body.operationId}`, {}, {}, legacy)).status, 404);
});

test('a toll response naming a different operation remains unknown', t => {
  t.mock.method(domainHandlers, 'ride', () => ({ status: 200, data: { success: true, transactionId: 'r1', newBalance: 1, rechargedAmount: 100, tagId: 'T1', operationId: 'other' } }));
  assert.throws(() => callDomain('ride', 'POST', '/mobility/salik/recharge', {}, { amount: 100, expectedTag: 'T1', operationId: 'CIVIC-toll-2' }),
    (error: unknown) => error instanceof DomainOperationError && error.code === 'DOMAIN_OUTCOME_UNKNOWN');
});
