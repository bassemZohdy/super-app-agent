import test from 'node:test';
import assert from 'node:assert/strict';
import { actorFor } from '../../packages/backend-kit/src/context.ts';
import { integratedRequest } from '../../packages/backend-kit/src/application.ts';
import { executeFoodRequest, activeUtilityBill } from '../service-food/src/index.ts';
import { executeWalletRequest, policeFines, balance, transactions } from '../service-wallet/src/index.ts';
import { executeRideRequest, salikBalance } from '../service-ride/src/index.ts';
import { callDomain, DomainOperationError, trackDomainOperations, type Step } from '../agent-core/src/domain-operations.ts';

test('offline fixtures reject an operation from a different service lifetime before mutation', async () => {
  const utilityEpoch = executeFoodRequest('GET', '/utilities/payment-epoch').data.serviceEpoch;
  const fineEpoch = executeWalletRequest('GET', '/fines/payment-epoch').data.serviceEpoch;
  const walletEpoch = executeWalletRequest('GET', '/wallet/unified-epoch').data.serviceEpoch;
  const tollEpoch = executeRideRequest('GET', '/mobility/salik/recharge-epoch').data.serviceEpoch;
  for (const epoch of [utilityEpoch, fineEpoch, tollEpoch, walletEpoch]) assert.match(epoch, /^[0-9a-f-]{36}$/);
  const unrelated = '00000000-0000-4000-8000-000000000000';
  assert.notEqual(utilityEpoch, unrelated); assert.notEqual(fineEpoch, unrelated); assert.notEqual(tollEpoch, unrelated);
  const before = balance, count = transactions.length, tollBefore = salikBalance;
  const fine = policeFines.find(item => item.status === 'UNPAID')!;
  const utility = executeFoodRequest('POST', '/utilities/pay', {}, { billId: activeUtilityBill.billId, expectedAmountMinor: Math.round(activeUtilityBill.totalAmount * 100), operationId: 'CIVIC-epoch-u', expectedServiceEpoch: unrelated });
  const fines = executeWalletRequest('POST', '/fines/pay', {}, { fineIds: [fine.fineId], expectedAmountMinor: Math.round(fine.payableAmount * 100), operationId: 'CIVIC-epoch-f', expectedServiceEpoch: unrelated });
  const wallet = executeWalletRequest('POST', '/pay/unified', {}, { items: [{ agency: 'RTA Salik', purpose: 'Demo toll recharge', amount: 100 }], operationId: 'CIVIC-epoch-w', expectedServiceEpoch: unrelated });
  const toll = executeRideRequest('POST', '/mobility/salik/recharge', {}, { amount: 100, expectedTag: executeRideRequest('GET', '/mobility/salik/balance').data.tagId, operationId: 'CIVIC-epoch-t', expectedServiceEpoch: unrelated });
  for (const result of [utility, fines, toll, wallet]) { assert.equal(result.status, 409); assert.equal(result.data.code, 'FIXTURE_EPOCH_CHANGED'); }

  const mutations = [
    ['food', '/utilities/pay', { billId: activeUtilityBill.billId, expectedAmountMinor: Math.round(activeUtilityBill.totalAmount * 100), operationId: 'CIVIC-epoch-u', expectedServiceEpoch: unrelated }],
    ['wallet', '/fines/pay', { fineIds: [fine.fineId], expectedAmountMinor: Math.round(fine.payableAmount * 100), operationId: 'CIVIC-epoch-f', expectedServiceEpoch: unrelated }],
    ['wallet', '/pay/unified', { items: [{ agency: 'RTA Salik', purpose: 'Demo toll recharge', amount: 100 }], operationId: 'CIVIC-epoch-w', expectedServiceEpoch: unrelated }],
    ['ride', '/mobility/salik/recharge', { amount: 100, expectedTag: executeRideRequest('GET', '/mobility/salik/balance').data.tagId, operationId: 'CIVIC-epoch-t', expectedServiceEpoch: unrelated }],
  ] as const;
  for (const [service, path, body] of mutations) {
    const steps: Step[] = [];
    await assert.rejects(trackDomainOperations(steps, async () => callDomain(service, 'POST', path, {}, body)), (error: unknown) => error instanceof DomainOperationError && error.code === 'DOMAIN_OUTCOME_UNKNOWN');
    assert.equal(steps[0].state, 'UNKNOWN');
  }

  assert.equal(activeUtilityBill.status, 'UNPAID'); assert.equal(fine.status, 'UNPAID'); assert.equal(balance, before); assert.equal(transactions.length, count); assert.equal(salikBalance, tollBefore);
  const actor = actorFor({ sub: 'epoch-mode-test' }), legacy = () => ({ status: 404, data: {} });
  const attempts = [
    ['service-food', '/utilities/pay', { billId: activeUtilityBill.billId, expectedAmountMinor: Math.round(activeUtilityBill.totalAmount * 100), operationId: 'CIVIC-epoch-u', expectedServiceEpoch: utilityEpoch }],
    ['service-wallet', '/pay/unified', { items: [{ agency: 'RTA Salik', purpose: 'Demo toll recharge', amount: 100 }], operationId: 'CIVIC-epoch-w', expectedServiceEpoch: walletEpoch }],
    ['service-wallet', '/fines/pay', { fineIds: [fine.fineId], expectedAmountMinor: Math.round(fine.payableAmount * 100), operationId: 'CIVIC-epoch-f', expectedServiceEpoch: fineEpoch }],
    ['service-ride', '/mobility/salik/recharge', { amount: 100, expectedTag: executeRideRequest('GET', '/mobility/salik/balance').data.tagId, operationId: 'CIVIC-epoch-t', expectedServiceEpoch: tollEpoch }],
  ] as const;
  for (const [service, path, body] of attempts) assert.equal((await integratedRequest(service, actor, 'POST', path, {}, body, legacy)).status, 400);
  for (const [service, path] of [['service-food', '/utilities/payment-epoch'], ['service-wallet', '/fines/payment-epoch'], ['service-wallet', '/wallet/unified-epoch'], ['service-ride', '/mobility/salik/recharge-epoch']] as const) assert.equal((await integratedRequest(service, actor, 'GET', path, {}, {}, legacy)).status, 404);

});
