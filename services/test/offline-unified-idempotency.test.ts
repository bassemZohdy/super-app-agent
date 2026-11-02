import test from 'node:test';
import assert from 'node:assert/strict';
import { callDomain, domainHandlers, DomainOperationError } from '../agent-core/src/domain-operations.ts';
import { balance, transactions, executeWalletRequest } from '../service-wallet/src/index.ts';

test('offline unified payments bind one operation identity to one set of terms', () => {
  assert.equal(executeWalletRequest('POST', '/wallet/topup', {}, { amount: 1000 }).status, 200);
  const body = { operationId: 'CIVIC-op-1', items: [{ agency: 'RTA Salik', purpose: 'Demo toll recharge', amount: 100 }] };
  const before = balance, count = transactions.length;
  const first = executeWalletRequest('POST', '/pay/unified', {}, body);
  assert.equal(first.status, 200); assert.equal(first.data.operationId, body.operationId);
  const again = executeWalletRequest('POST', '/pay/unified', {}, body);
  assert.equal(again.status, 200); assert.equal(again.data.govTransactionHash, first.data.govTransactionHash);
  assert.equal(balance, before - 100); assert.equal(transactions.length, count + 1);
  const changed = executeWalletRequest('POST', '/pay/unified', {}, { ...body, items: [{ ...body.items[0], amount: 101 }] });
  assert.equal(changed.status, 409); assert.equal(balance, before - 100); assert.equal(transactions.length, count + 1);
  first.data.breakdown[0].amount = 999;
  const lookup = executeWalletRequest('GET', `/wallet/unified-operations/${body.operationId}`);
  assert.equal(lookup.data.operation.operationId, body.operationId); assert.deepEqual(lookup.data.operation.items, body.items);
  assert.equal(lookup.data.operation.receiptReference, first.data.govTransactionHash);
  assert.equal(executeWalletRequest('GET', '/wallet/unified-operations/unknown').data.operation, null);
});


test('an operation response naming a different identity stays unknown', t => {
  t.mock.method(domainHandlers, 'wallet', () => ({ status: 200, data: { success: true, govTransactionHash: 'tx1', settlementPlatform: 'demo', grandTotal: 100, remainingBalance: 1, operationId: 'another-operation' } }));
  assert.throws(() => callDomain('wallet', 'POST', '/pay/unified', {}, { operationId: 'CIVIC-op-2', items: [{ agency: 'RTA Salik', purpose: 'Demo toll recharge', amount: 100 }] }),
    (error: unknown) => error instanceof DomainOperationError && error.code === 'DOMAIN_OUTCOME_UNKNOWN');
});
