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
const bill = { bill: { billId: 'B1', status: 'PAID', receiptNumber: 'U1', totalAmount: 2, currency: 'AED' } };

test('reconciliation compares exact references, amounts and bill identity without claiming toll evidence', async () => {
  const result = await compareCivicEvidence(review, steps, async source => source === 'wallet' ? wallet : bill);
  assert.deepEqual(result, [{ name: 'WALLET', assessment: 'MATCH' }, { name: 'UTILITY', assessment: 'MATCH' }, { name: 'FINES', assessment: 'MATCH' }, { name: 'TOLL', assessment: 'UNSUPPORTED' }]);
});

test('ambiguous, missing or unavailable records never become matches', async () => {
  const altered = { transactions: [wallet.transactions[0], { ...wallet.transactions[0] }, { ...wallet.transactions[1], amount: 3.01 }] };
  const result = await compareCivicEvidence(review, steps, async source => { if (source === 'food') throw new Error('offline'); return altered; });
  assert.deepEqual(result, [{ name: 'WALLET', assessment: 'UNVERIFIABLE' }, { name: 'UTILITY', assessment: 'UNAVAILABLE' }, { name: 'FINES', assessment: 'UNVERIFIABLE' }, { name: 'TOLL', assessment: 'UNSUPPORTED' }]);
  let reads = 0;
  const pending = await compareCivicEvidence(review, [{ name: 'WALLET', state: 'UNKNOWN' }], async () => { reads++; return wallet; });
  assert.deepEqual(pending, [{ name: 'WALLET', assessment: 'UNVERIFIABLE' }]); assert.equal(reads, 0);
});
