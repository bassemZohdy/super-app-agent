import test from 'node:test';
import assert from 'node:assert/strict';
import { executeWalletRequest, policeFines, balance, transactions } from '../service-wallet/src/index.ts';

test('reviewed individual fine amounts cannot be swapped while the total stays unchanged', () => {
  assert.equal(executeWalletRequest('POST', '/wallet/topup', {}, { amount: 1000 }).status, 200);
  const selected = policeFines.filter(fine => fine.status === 'UNPAID'); assert.ok(selected.length >= 2);
  const expectedFineAmounts = selected.map(fine => ({ fineId: fine.fineId, amountMinor: Math.round(fine.payableAmount * 100) }));
  const amount = expectedFineAmounts.reduce((sum, fine) => sum + fine.amountMinor, 0), before = balance, count = transactions.length;
  selected[0].payableAmount += 1; selected[1].payableAmount -= 1;
  try {
    const result = executeWalletRequest('POST', '/fines/pay', {}, { fineIds: expectedFineAmounts.map(f => f.fineId), expectedAmountMinor: amount, expectedFineAmounts, operationId: 'CIVIC-fines-amount-test' });
    assert.equal(result.status, 409); assert.equal(result.data.code, 'PAYABLE_CHANGED'); assert.equal(balance, before); assert.equal(transactions.length, count);
  } finally { selected[0].payableAmount -= 1; selected[1].payableAmount += 1; }
});
