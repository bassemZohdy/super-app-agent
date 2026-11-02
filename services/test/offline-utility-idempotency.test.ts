import test from 'node:test';
import assert from 'node:assert/strict';
import { callDomain, domainHandlers, DomainOperationError } from '../agent-core/src/domain-operations.ts';
import { activeUtilityBill, executeFoodRequest } from '../service-food/src/index.ts';

test('offline utility settlement binds one operation to the reviewed bill and amount', () => {
  const body = { operationId: 'CIVIC-utility-1', billId: activeUtilityBill.billId, expectedAmountMinor: Math.round(activeUtilityBill.totalAmount * 100) };
  assert.equal(executeFoodRequest('POST', '/utilities/pay', {}, { operationId: 'CIVIC-unbound', billId: body.billId }).status, 400);
  assert.equal(activeUtilityBill.status, 'UNPAID');
  const first = executeFoodRequest('POST', '/utilities/pay', {}, body);
  assert.equal(first.status, 200); assert.equal(first.data.operationId, body.operationId);
  const second = executeFoodRequest('POST', '/utilities/pay', {}, body);
  assert.equal(second.status, 200); assert.equal(second.data.receipt.receiptNumber, first.data.receipt.receiptNumber);
  first.data.receipt.receiptNumber = 'tampered';
  const stable = executeFoodRequest('POST', '/utilities/pay', {}, body);
  assert.equal(stable.data.receipt.receiptNumber, second.data.receipt.receiptNumber);
  const changed = executeFoodRequest('POST', '/utilities/pay', {}, { ...body, expectedAmountMinor: body.expectedAmountMinor + 1 });
  assert.equal(changed.status, 409);
  const lookup = executeFoodRequest('GET', `/utilities/payment-operations/${body.operationId}`);
  assert.deepEqual(lookup.data.operation, { operationId: body.operationId, status: 'SETTLED', billId: body.billId, amountMinor: body.expectedAmountMinor, receiptReference: second.data.receipt.receiptNumber });
  assert.equal(executeFoodRequest('GET', '/utilities/payment-operations/unknown').data.operation, null);
});


test('a utility response naming a different operation stays unknown', t => {
  t.mock.method(domainHandlers, 'food', () => ({ status: 200, data: { success: true, operationId: 'different', receipt: { billId: 'B1', receiptNumber: 'R1', amountPaid: '1.00 AED' } } }));
  assert.throws(() => callDomain('food', 'POST', '/utilities/pay', {}, { billId: 'B1', expectedAmountMinor: 100, operationId: 'CIVIC-op' }),
    (error: unknown) => error instanceof DomainOperationError && error.code === 'DOMAIN_OUTCOME_UNKNOWN');
});
