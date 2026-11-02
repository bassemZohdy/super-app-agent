import test from 'node:test';
import assert from 'node:assert/strict';
import { completeCivicSteps } from '../agent-core/src/civic-resolution.ts';

const review = { billId: 'B1', billAmountMinor: 200, fines: [{ fineId: 'F1', amountMinor: 300 }], tagNumber: 'T1', tollAmountMinor: 10000 };
const steps = [
  { name: 'WALLET', state: 'CONFIRMED', receiptReference: 'W1' },
  { name: 'UTILITY', state: 'CONFIRMED', receiptReference: 'U1' },
  { name: 'FINES', state: 'CONFIRMED', receiptReference: 'F1' },
  { name: 'TOLL', state: 'CONFIRMED', receiptReference: 'T1' },
] as const;

test('only the complete ordered set of confirmed reviewed steps can be resolved', () => {
  assert.equal(completeCivicSteps(review, steps), true);
  assert.equal(completeCivicSteps(review, steps.slice(0, 3)), false);
  assert.equal(completeCivicSteps(review, [steps[1], steps[0], steps[2], steps[3]]), false);
  assert.equal(completeCivicSteps(review, [...steps, steps[3]]), false);
  assert.equal(completeCivicSteps(review, steps.map((step, i) => i === 2 ? { ...step, state: 'UNKNOWN' } : step)), false);
  assert.equal(completeCivicSteps(review, steps.map((step, i) => i === 3 ? { ...step, receiptReference: undefined } : step)), false);
  assert.equal(completeCivicSteps({ ...review, billAmountMinor: 0, fines: [] }, [steps[0], steps[3]]), true);
});
