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
