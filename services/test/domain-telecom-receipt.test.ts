import test from 'node:test';
import assert from 'node:assert/strict';
import { actorContext, actorFor } from '../../packages/backend-kit/src/context.ts';
import { callDomainAsync, DomainOperationError, trackDomainOperations, type Step } from '../agent-core/src/domain-operations.ts';

test('telecom payment requires a receipt for the selected bill before success', async t => {
  const previous = process.env.DOMAIN_TRANSPORT;
  process.env.DOMAIN_TRANSPORT = 'http';
  t.after(() => { if (previous === undefined) delete process.env.DOMAIN_TRANSPORT; else process.env.DOMAIN_TRANSPORT = previous; });
  const receipt = { billId: 'bill/123', receiptNumber: 'receipt-1', amountPaid: '45.00', currency: 'AED' };
  const cases = [
    { data: { success: true }, valid: false },
    { data: { success: true, receipt: { ...receipt, billId: 'other' } }, valid: false },
    { data: { success: true, receipt: { ...receipt, receiptNumber: '' } }, valid: false },
    { data: { success: true, receipt: { ...receipt, amountPaid: 'invalid' } }, valid: false },
    { data: { success: true, receipt: { ...receipt, currency: 'USD' } }, valid: false },
    { data: { success: true, receipt }, valid: true },
  ];
  for (const provider of ['du', 'etisalat']) for (const sample of cases) {
    const steps: Step[] = [];
    const fetchMock = t.mock.method(globalThis, 'fetch', async () => Response.json(sample.data));
    try {
      const run = () => actorContext.run(actorFor({ sub: 'test-user' }, 'account', 'Bearer test'),
        () => callDomainAsync('telecom', 'POST', `/telecom/${provider}/bills/bill%2F123/payments`));
      const result = trackDomainOperations(steps, run);
      if (sample.valid) { await result; assert.equal(steps[0].state, 'SUCCEEDED'); }
      else {
        await assert.rejects(result, (error: unknown) => error instanceof DomainOperationError && error.code === 'DOMAIN_OUTCOME_UNKNOWN');
        assert.equal(steps[0].state, 'UNKNOWN');
      }
    } finally { fetchMock.mock.restore(); }
  }
});


test('telecom receipt must match the reviewed amount when one was supplied', async t => {
  const previous = process.env.DOMAIN_TRANSPORT;
  process.env.DOMAIN_TRANSPORT = 'http';
  t.after(() => { if (previous === undefined) delete process.env.DOMAIN_TRANSPORT; else process.env.DOMAIN_TRANSPORT = previous; });
  for (const sample of [
    { amount: '45.00', expected: 4500, valid: true },
    { amount: '45.01', expected: 4500, valid: false },
    { amount: '45.00', expected: 4501, valid: false },
    { amount: '90071992547409.92', expected: 9007199254740991, valid: false },
  ]) {
    const steps: Step[] = [];
    const receipt = { billId: 'bill-123', receiptNumber: 'receipt-1', amountPaid: sample.amount, currency: 'AED' };
    const fetchMock = t.mock.method(globalThis, 'fetch', async () => Response.json({ success: true, receipt }));
    try {
      const result = trackDomainOperations(steps, () => actorContext.run(actorFor({ sub: 'test-user' }, 'account', 'Bearer test'),
        () => callDomainAsync('telecom', 'POST', '/telecom/du/bills/bill-123/payments', {}, { expectedAmountMinor: sample.expected })));
      if (sample.valid) { await result; assert.equal(steps[0].state, 'SUCCEEDED'); }
      else {
        await assert.rejects(result, (error: unknown) => error instanceof DomainOperationError && error.code === 'DOMAIN_OUTCOME_UNKNOWN');
        assert.equal(steps[0].state, 'UNKNOWN');
      }
    } finally { fetchMock.mock.restore(); }
  }
});
