import test from 'node:test';
import assert from 'node:assert/strict';
import { executeWalletRequest, policeFines, balance } from '../service-wallet/src/index.ts';

test('offline fine receipt lookup identifies the exact paid selection without another debit', () => {
  assert.equal(executeWalletRequest('POST', '/wallet/topup', {}, { amount: 5000 }).status, 200);
  const selected = policeFines.filter(fine => fine.status === 'UNPAID').slice(0, 1);
  const payment = executeWalletRequest('POST', '/fines/pay', {}, { fineIds: selected.map(fine => fine.fineId) });
  assert.equal(payment.status, 200); const before = balance;
  const receipt = executeWalletRequest('GET', `/fines/receipts/${payment.data.receiptNumber}`);
  assert.deepEqual(receipt.data.receipt, { receiptNumber: payment.data.receiptNumber, currency: 'AED', fines: selected.map(fine => ({ fineId: fine.fineId, amountMinor: Math.round(fine.payableAmount * 100) })) });
  assert.equal(executeWalletRequest('GET', '/fines/receipts/unknown').data.receipt, null);
  assert.equal(balance, before);
});
