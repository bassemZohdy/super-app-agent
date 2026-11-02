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
