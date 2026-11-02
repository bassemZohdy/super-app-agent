import test from 'node:test';
import assert from 'node:assert/strict';
import { actorFor } from '../../packages/backend-kit/src/context.ts';
import { integratedRequest } from '../../packages/backend-kit/src/application.ts';
import { balance, transactions, executeWalletRequest } from '../service-wallet/src/index.ts';
import { callDomain, domainHandlers, DomainOperationError } from '../agent-core/src/domain-operations.ts';

test('offline fine settlement binds its identity to the exact set and amount', async () => {
  assert.equal(executeWalletRequest('POST', '/wallet/topup', {}, { amount: 1000 }).status, 200);
  const fines = executeWalletRequest('GET', '/fines/check').data.fines;
  const ids = fines.map((fine: { fineId: string }) => fine.fineId);
  const amount = fines.reduce((sum: number, fine: { payableAmount: number }) => sum + Math.round(fine.payableAmount * 100), 0);
  const body = { operationId: 'CIVIC-fines-1', fineIds: ids, expectedAmountMinor: amount };
  const before = balance, count = transactions.length;
  const first = executeWalletRequest('POST', '/fines/pay', {}, body);
  assert.equal(first.status, 200); assert.equal(first.data.operationId, body.operationId);
  const again = executeWalletRequest('POST', '/fines/pay', {}, { ...body, fineIds: [...ids].reverse() });
  assert.equal(again.status, 200); assert.equal(again.data.receiptNumber, first.data.receiptNumber);
  assert.equal(balance, before - amount / 100); assert.equal(transactions.length, count + 1);
  assert.equal(executeWalletRequest('POST', '/fines/pay', {}, { ...body, fineIds: [ids[0]] }).status, 409);
  assert.equal(executeWalletRequest('POST', '/fines/pay', {}, { ...body, expectedAmountMinor: amount + 1 }).status, 409);
  assert.equal(executeWalletRequest('POST', '/fines/pay', {}, { operationId: 'CIVIC-missing', fineIds: ids }).status, 400);
  const lookup = executeWalletRequest('GET', `/fines/payment-operations/${body.operationId}`);
  assert.equal(lookup.data.operation.receiptReference, first.data.receiptNumber);
  assert.deepEqual(lookup.data.operation.fines.map((fine: { fineId: string }) => fine.fineId).sort(), [...ids].sort());
  lookup.data.operation.fines[0].fineId = 'tampered';
  assert.notEqual(executeWalletRequest('GET', `/fines/payment-operations/${body.operationId}`).data.operation.fines[0].fineId, 'tampered');
  assert.equal(executeWalletRequest('GET', '/fines/payment-operations/unknown').data.operation, null);
  const legacy = () => ({ status: 404, data: {} });
  assert.equal((await integratedRequest('service-wallet', actorFor({ sub: 'fine-id-test' }), 'POST', '/fines/pay', {}, body, legacy)).status, 400);
  assert.equal((await integratedRequest('service-wallet', actorFor({ sub: 'fine-id-test' }), 'GET', `/fines/payment-operations/${body.operationId}`, {}, {}, legacy)).status, 404);
});

test('a fine response naming a different operation remains unknown', t => {
  t.mock.method(domainHandlers, 'wallet', () => ({ status: 200, data: { success: true, receiptNumber: 'r1', remainingBalance: 1, finesCleared: 1, fineIds: ['f1'], amountPaid: 10, operationId: 'other' } }));
  assert.throws(() => callDomain('wallet', 'POST', '/fines/pay', {}, { fineIds: ['f1'], expectedAmountMinor: 1000, operationId: 'CIVIC-fines-2' }),
    (error: unknown) => error instanceof DomainOperationError && error.code === 'DOMAIN_OUTCOME_UNKNOWN');
});
