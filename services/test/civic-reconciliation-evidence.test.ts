import test from 'node:test';
import assert from 'node:assert/strict';
import { compareCivicEvidence } from '../agent-core/src/civic-evidence.ts';

const review = { billId: 'B1', billAmountMinor: 200, fines: [{ fineId: 'F1', amountMinor: 300 }], tagNumber: 'T1', tollAmountMinor: 10000 };
const steps = [
  { name: 'WALLET', state: 'CONFIRMED', receiptReference: 'W1' },
  { name: 'UTILITY', state: 'CONFIRMED', receiptReference: 'U1' },
  { name: 'FINES', state: 'CONFIRMED', receiptReference: 'F1' },
  { name: 'TOLL', state: 'CONFIRMED', receiptReference: 'T1' },
] as const;
const wallet = { transactions: [{ id: 'W1', type: 'PAYMENT', status: 'SETTLED', currency: 'AED', amount: 102 }, { id: 'F1', type: 'PAYMENT', status: 'SETTLED', currency: 'AED', amount: 3 }] };
const fineReceipt = { receipt: { receiptNumber: 'F1', currency: 'AED', fines: [{ fineId: 'F1', amountMinor: 300 }] } };
const toll = { recharge: { transactionId: 'T1', tagId: 'T1', amountMinor: 10000, currency: 'AED' } };
const bill = { bill: { billId: 'B1', status: 'PAID', receiptNumber: 'U1', totalAmount: 2, currency: 'AED' } };

test('reconciliation compares exact references, amounts and bill identity including the reviewed toll transaction', async () => {
  const result = await compareCivicEvidence(review, steps, async source => source === 'wallet' ? wallet : source === 'food' ? bill : source === 'fine-receipt' ? fineReceipt : toll);
  assert.deepEqual(result, [{ name: 'WALLET', assessment: 'MATCH' }, { name: 'UTILITY', assessment: 'MATCH' }, { name: 'FINES', assessment: 'MATCH' }, { name: 'TOLL', assessment: 'MATCH' }]);
});

test('ambiguous, missing or unavailable records never become matches', async () => {
  const altered = { transactions: [wallet.transactions[0], { ...wallet.transactions[0] }, { ...wallet.transactions[1], amount: 3.01 }] };
  const result = await compareCivicEvidence(review, steps, async source => { if (source === 'food') throw new Error('offline'); return source === 'wallet' ? altered : source === 'fine-receipt' ? fineReceipt : { recharge: { ...toll.recharge, tagId: 'other' } }; });
  assert.deepEqual(result, [{ name: 'WALLET', assessment: 'UNVERIFIABLE' }, { name: 'UTILITY', assessment: 'UNAVAILABLE' }, { name: 'FINES', assessment: 'UNVERIFIABLE' }, { name: 'TOLL', assessment: 'UNVERIFIABLE' }]);
  let reads = 0;
  const pending = await compareCivicEvidence(review, [{ name: 'WALLET', state: 'UNKNOWN' }], async () => { reads++; return wallet; });
  assert.deepEqual(pending, [{ name: 'WALLET', assessment: 'UNVERIFIABLE' }]); assert.equal(reads, 0);
});


test('a missing or unknown toll receipt cannot establish the recharge outcome', async () => {
  const confirmed = [{ name: 'TOLL', state: 'CONFIRMED', receiptReference: 'T1' }] as const;
  assert.deepEqual(await compareCivicEvidence(review, confirmed, async () => ({ recharge: null })), [{ name: 'TOLL', assessment: 'UNVERIFIABLE' }]);
  let reads = 0;
  const unknown = [{ name: 'TOLL', state: 'UNKNOWN' }] as const;
  assert.deepEqual(await compareCivicEvidence(review, unknown, async () => { reads++; return toll; }), [{ name: 'TOLL', assessment: 'UNVERIFIABLE' }]);
  assert.equal(reads, 0);
});


test('a matching fine ledger amount cannot confirm a different or incomplete fine selection', async () => {
  const fineStep = [{ name: 'FINES', state: 'CONFIRMED', receiptReference: 'F1' }] as const;
  const compare = (receipt: unknown) => compareCivicEvidence(review, fineStep, async source => source === 'wallet' ? wallet : receipt);
  for (const receipt of [
    { receipt: { receiptNumber: 'F1', currency: 'AED', fines: [{ fineId: 'OTHER', amountMinor: 300 }] } },
    { receipt: { receiptNumber: 'F1', currency: 'AED', fines: [{ fineId: 'F1', amountMinor: 301 }] } },
    { receipt: { receiptNumber: 'F1', currency: 'AED', fines: [{ fineId: 'F1', amountMinor: 300 }, { fineId: 'F1', amountMinor: 300 }] } },
    { receipt: null },
  ]) assert.deepEqual(await compare(receipt), [{ name: 'FINES', assessment: 'UNVERIFIABLE' }]);
  assert.deepEqual(await compareCivicEvidence(review, fineStep, async source => { if (source === 'fine-receipt') throw new Error('offline'); return wallet; }), [{ name: 'FINES', assessment: 'UNAVAILABLE' }]);
});


test('a lost wallet response can be observed only by its saved operation and exact terms', async () => {
  const operationId = 'CIVIC-123';
  const unknown = [{ name: 'WALLET', state: 'UNKNOWN', operationId }] as const;
  const operation = { operation: { operationId, status: 'SETTLED', receiptReference: 'W1', items: [{ agency: 'DEWA', purpose: 'Demo utility settlement', amount: 2 }, { agency: 'RTA Salik', purpose: 'Demo toll recharge', amount: 100 }] } };
  const ledger = { transactions: [{ ...wallet.transactions[0], operationId }] };
  const read = async (source: string) => source === 'wallet-operation' ? operation : ledger;
  assert.deepEqual(await compareCivicEvidence(review, unknown, read), [{ name: 'WALLET', assessment: 'OBSERVED', observedReceiptReference: 'W1' }]);
  const changed = { operation: { ...operation.operation, items: [{ ...operation.operation.items[0], amount: 2.01 }, operation.operation.items[1]] } };
  assert.deepEqual(await compareCivicEvidence(review, unknown, async source => source === 'wallet-operation' ? changed : ledger), [{ name: 'WALLET', assessment: 'UNVERIFIABLE' }]);
  assert.deepEqual(await compareCivicEvidence(review, unknown, async source => source === 'wallet-operation' ? operation : wallet), [{ name: 'WALLET', assessment: 'UNVERIFIABLE' }]);
  assert.deepEqual(await compareCivicEvidence(review, unknown, async source => source === 'wallet-operation' ? { operation: null } : ledger), [{ name: 'WALLET', assessment: 'UNVERIFIABLE' }]);
  assert.deepEqual(await compareCivicEvidence(review, unknown, async source => source === 'wallet-operation' ? operation : { transactions: [ledger.transactions[0], ledger.transactions[0]] }), [{ name: 'WALLET', assessment: 'UNVERIFIABLE' }]);
});


test('a confirmed wallet receipt requires its original operation and exact reviewed items', async () => {
  const confirmed = [{ name: 'WALLET', state: 'CONFIRMED', receiptReference: 'W1', operationId: 'CIVIC-123' }] as const;
  assert.deepEqual(await compareCivicEvidence(review, confirmed, async () => wallet), [{ name: 'WALLET', assessment: 'UNVERIFIABLE' }]);
  const ledger = { transactions: [{ ...wallet.transactions[0], operationId: 'CIVIC-123' }] };
  const operation = { operation: { operationId: 'CIVIC-123', status: 'SETTLED', receiptReference: 'W1', items: [{ agency: 'DEWA', purpose: 'Demo utility settlement', amount: 2 }, { agency: 'RTA Salik', purpose: 'Demo toll recharge', amount: 100 }] } };
  const read = (value: unknown) => async (source: string) => source === 'wallet-operation' ? value : ledger;
  assert.deepEqual(await compareCivicEvidence(review, confirmed, read(operation)), [{ name: 'WALLET', assessment: 'MATCH' }]);
  const changed = { operation: { ...operation.operation, items: [{ ...operation.operation.items[0], amount: 3 }, { ...operation.operation.items[1], amount: 99 }] } };
  for (const value of [changed, { operation: null }, { operation: { ...operation.operation, receiptReference: 'other' } }, { operation: { ...operation.operation, operationId: 'other' } }])
    assert.deepEqual(await compareCivicEvidence(review, confirmed, read(value)), [{ name: 'WALLET', assessment: 'UNVERIFIABLE' }]);
  assert.deepEqual(await compareCivicEvidence(review, confirmed, async source => { if (source === 'wallet-operation') throw new Error('offline'); return ledger; }), [{ name: 'WALLET', assessment: 'UNAVAILABLE' }]);
});


test('a lost utility response can be observed only for the saved operation and reviewed bill', async () => {
  const operationId = 'CIVIC-utility';
  const unknown = [{ name: 'UTILITY', state: 'UNKNOWN', operationId }] as const;
  const operation = { operation: { operationId, status: 'SETTLED', billId: 'B1', amountMinor: 200, receiptReference: 'U1' } };
  assert.deepEqual(await compareCivicEvidence(review, unknown, async source => source === 'utility-operation' ? operation : bill), [{ name: 'UTILITY', assessment: 'OBSERVED', observedReceiptReference: 'U1' }]);
  const changed = { operation: { ...operation.operation, billId: 'other' } };
  assert.deepEqual(await compareCivicEvidence(review, unknown, async source => source === 'utility-operation' ? changed : bill), [{ name: 'UTILITY', assessment: 'UNVERIFIABLE' }]);
  assert.deepEqual(await compareCivicEvidence(review, unknown, async source => source === 'utility-operation' ? operation : { bill: { ...bill.bill, receiptNumber: 'other' } }), [{ name: 'UTILITY', assessment: 'UNVERIFIABLE' }]);
});

test('a lost fine response requires the same operation, exact fine receipt and ledger identity', async () => {
  const operationId = 'CIVIC-fine', unknown = [{ name: 'FINES', state: 'UNKNOWN', operationId }] as const;
  const operation = { operation: { operationId, status: 'SETTLED', receiptReference: 'F1', fines: [{ fineId: 'F1', amountMinor: 300 }] } };
  const ledger = { transactions: [{ ...wallet.transactions[1], operationId }] };
  const read = (op: unknown, receipt: unknown, rows: unknown) => async (source: string) => source === 'fine-operation' ? op : source === 'fine-receipt' ? receipt : rows;
  assert.deepEqual(await compareCivicEvidence(review, unknown, read(operation, fineReceipt, ledger)), [{ name: 'FINES', assessment: 'OBSERVED', observedReceiptReference: 'F1' }]);
  for (const bad of [{ operation: null }, { operation: { ...operation.operation, operationId: 'other' } }, { operation: { ...operation.operation, fines: [{ fineId: 'other', amountMinor: 300 }] } }, { operation: { ...operation.operation, fines: [{ fineId: 'F1', amountMinor: 301 }] } }])
    assert.deepEqual(await compareCivicEvidence(review, unknown, read(bad, fineReceipt, ledger)), [{ name: 'FINES', assessment: 'UNVERIFIABLE' }]);
  assert.deepEqual(await compareCivicEvidence(review, unknown, read(operation, fineReceipt, wallet)), [{ name: 'FINES', assessment: 'UNVERIFIABLE' }]);
  assert.deepEqual(await compareCivicEvidence(review, unknown, read(operation, { receipt: null }, ledger)), [{ name: 'FINES', assessment: 'UNVERIFIABLE' }]);
  assert.deepEqual(await compareCivicEvidence(review, unknown, async source => { if (source === 'fine-operation') throw new Error('offline'); return ledger; }), [{ name: 'FINES', assessment: 'UNAVAILABLE' }]);
  assert.deepEqual(await compareCivicEvidence(review, unknown, async source => { if (source === 'fine-receipt') throw new Error('offline'); return source === 'fine-operation' ? operation : ledger; }), [{ name: 'FINES', assessment: 'UNAVAILABLE' }]);
});

test('a lost toll response requires the original operation and matching recharge receipt', async () => {
  const operationId = 'CIVIC-toll', unknown = [{ name: 'TOLL', state: 'UNKNOWN', operationId }] as const;
  const operation = { operation: { operationId, status: 'SETTLED', receiptReference: 'T1', tagId: 'T1', amountMinor: 10000 } };
  const read = (op: unknown, receipt: unknown) => async (source: string) => source === 'toll-operation' ? op : receipt;
  assert.deepEqual(await compareCivicEvidence(review, unknown, read(operation, toll)), [{ name: 'TOLL', assessment: 'OBSERVED', observedReceiptReference: 'T1' }]);
  for (const bad of [{ operation: null }, { operation: { ...operation.operation, operationId: 'other' } }, { operation: { ...operation.operation, tagId: 'other' } }, { operation: { ...operation.operation, amountMinor: 10001 } }])
    assert.deepEqual(await compareCivicEvidence(review, unknown, read(bad, toll)), [{ name: 'TOLL', assessment: 'UNVERIFIABLE' }]);
  assert.deepEqual(await compareCivicEvidence(review, unknown, read(operation, { recharge: { ...toll.recharge, tagId: 'other' } })), [{ name: 'TOLL', assessment: 'UNVERIFIABLE' }]);
  assert.deepEqual(await compareCivicEvidence(review, unknown, async source => { if (source === 'toll-operation') throw new Error('offline'); return toll; }), [{ name: 'TOLL', assessment: 'UNAVAILABLE' }]);
  assert.deepEqual(await compareCivicEvidence(review, unknown, async source => { if (source === 'ride') throw new Error('offline'); return operation; }), [{ name: 'TOLL', assessment: 'UNAVAILABLE' }]);
});
