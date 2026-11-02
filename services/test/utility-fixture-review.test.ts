import test from 'node:test';
import assert from 'node:assert/strict';
import { activeUtilityBill, executeFoodRequest } from '../service-food/src/index.ts';

test('offline utility settlement rejects changed terms, unsupported revisions and already-paid repeats', () => {
  const billId = activeUtilityBill.billId, amount = Math.round(activeUtilityBill.totalAmount * 100);
  const before = JSON.stringify(activeUtilityBill);
  for (const path of ['/utilities/pay', '/bill/pay']) {
    assert.equal(executeFoodRequest('POST', path, {}, { billId, expectedAmountMinor: amount + 1 }).status, 409);
    assert.equal(executeFoodRequest('POST', path, {}, { billId, expectedPayableRevision: 'a'.repeat(64) }).status, 400);
    assert.equal(JSON.stringify(activeUtilityBill), before);
  }
  const paid = executeFoodRequest('POST', '/utilities/pay', {}, { billId, expectedAmountMinor: amount });
  assert.equal(paid.status, 200);
  assert.equal(activeUtilityBill.status, 'PAID');
  const settled = JSON.stringify(activeUtilityBill), receipt = paid.data.receipt.receiptNumber;
  for (const path of ['/utilities/pay', '/bill/pay']) {
    const repeated = executeFoodRequest('POST', path, {}, { billId, expectedAmountMinor: amount });
    assert.equal(repeated.status, 409);
    assert.equal(JSON.stringify(activeUtilityBill), settled);
    assert.equal(activeUtilityBill.receiptNumber, receipt);
  }
});
