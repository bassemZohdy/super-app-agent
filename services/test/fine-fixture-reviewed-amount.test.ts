import test from 'node:test';
import assert from 'node:assert/strict';
import { balance, transactions, policeFines, executeWalletRequest } from '../service-wallet/src/index.ts';

test('offline fine payment rejects a changed reviewed amount before any debit or settlement', () => {
  const fine = policeFines.find(item => item.status === 'UNPAID')!;
  assert.equal(executeWalletRequest('POST', '/wallet/topup', {}, { amount: fine.payableAmount }).status, 200);
  const before = JSON.stringify({ balance, transactions, policeFines });
  for (const path of ['/fines/pay', '/fines/settle']) {
    const result = executeWalletRequest('POST', path, {}, { fineIds: [fine.fineId], expectedAmountMinor: Math.round(fine.payableAmount * 100) + 1 });
    assert.equal(result.status, 409);
    assert.equal(JSON.stringify({ balance, transactions, policeFines }), before);
    const revision = executeWalletRequest('POST', path, {}, { fineIds: [fine.fineId], expectedPayables: [{ payableId: fine.fineId, expectedRevision: 'a'.repeat(64) }] });
    assert.equal(revision.status, 400);
    assert.equal(JSON.stringify({ balance, transactions, policeFines }), before);
  }
  const amount = fine.payableAmount, previous = balance;
  const paid = executeWalletRequest('POST', '/fines/pay', {}, { fineIds: [fine.fineId], expectedAmountMinor: Math.round(amount * 100) });
  assert.equal(paid.status, 200);
  assert.equal(Math.round((previous - balance) * 100), Math.round(amount * 100));
  assert.equal(fine.status, 'PAID');
});
