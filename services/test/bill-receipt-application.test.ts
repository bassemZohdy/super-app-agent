import { removeTemp } from '../../test/support/temp-cleanup.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { integratedRequest } from '../../packages/backend-kit/src/application.ts';
import { ProviderClient } from '../../packages/backend-kit/src/provider-client.ts';
import { actorFor } from '../../packages/backend-kit/src/context.ts';

test('integrated bill settlement refuses a different frozen quote or provider receipt', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'bill-contract-')), previous = process.env.APP_DATA_DIR;
  process.env.APP_DATA_DIR = dir;
  t.after(() => { if (previous === undefined) delete process.env.APP_DATA_DIR; else process.env.APP_DATA_DIR = previous; removeTemp(dir); });
  let scenario = 'valid', provider = 'dewa', approvals = 0, executions = 0;
  const payable = () => ({ id: `${provider}:bill:bill123`, kind: 'BILL', provider, obligationId: 'bill123', reference: 'owned', revision: 'a'.repeat(64), status: 'UNPAID', amountMinor: 115 });
  const order = (state: string) => ({ id: 'original', state, version: 1, approvalDigest: 'digest', quote: { totalMinor: 115, payable: scenario === 'wrong-quote' || scenario === 'wrong-authorized' && state === 'AUTHORIZED' || scenario === 'wrong-settled' && state === 'SETTLED' ? { ...payable(), obligationId: 'other' } : payable() }, receipt: { receiptNumber: 'receipt', obligationId: scenario === 'wrong-receipt' ? 'other' : 'bill123', amountMinor: scenario === 'wrong-amount' ? 116 : 115, currency: 'AED' } });
  t.mock.method(ProviderClient.prototype, 'call', async (name, _actor, _method, route) => {
    if (name === provider && route === '/bills') return { bills: [{ billId: 'bill123', status: 'UNPAID', totalAmount: 1.15 }] };
    if (name === provider && route === '/payables') return { payables: [payable()] };
    if (route === '/billing-accounts') return { billingAccounts: [{ status: 'ACTIVE', provider, reference: 'owned' }] };
    if (route === '/payment-orders') return { order: { id: 'original' } };
    if (route === '/payment-orders/original') return { order: order('AWAITING_APPROVAL') };
    if (route.endsWith('/approve')) { approvals++; return { order: order('AUTHORIZED') }; }
    if (route.endsWith('/execute')) { executions++; return { order: order('SETTLED') }; }
    if (route === '/wallet') return { balance: 10 };
    throw new Error('Unexpected provider operation');
  });
  const actor = actorFor({ sub: 'bill-contract-user' }), legacy = () => ({ status: 404, data: {} });
  for (provider of ['dewa', 'du', 'etisalat']) {
    const run = () => provider === 'dewa'
      ? integratedRequest('service-food', actor, 'POST', '/utilities/pay', {}, { billId: 'bill123', expectedAmountMinor: 115 }, legacy)
      : integratedRequest('service-telecom', actor, 'POST', `/telecom/${provider}/bills/bill123/payments`, {}, { expectedAmountMinor: 115 }, legacy);
    scenario = 'valid'; const good = await run(); assert.equal(good.status, 200); assert.equal(good.data.receipt.billId, 'bill123');
    scenario = 'wrong-quote'; const beforeApprovals = approvals, beforeExecutions = executions;
    const wrong = await run(); assert.equal(wrong.status, 503); assert.equal(wrong.data.code, 'PROVIDER_OUTCOME_UNKNOWN'); assert.equal(approvals, beforeApprovals); assert.equal(executions, beforeExecutions);
    scenario = 'wrong-authorized'; const priorExecutions = executions; const authorized = await run(); assert.equal(authorized.status, 503); assert.equal(authorized.data.code, 'PROVIDER_OUTCOME_UNKNOWN'); assert.equal(executions, priorExecutions);
    for (scenario of ['wrong-settled', 'wrong-receipt', 'wrong-amount']) { const bad = await run(); assert.equal(bad.status, 503); assert.equal(bad.data.code, 'PROVIDER_OUTCOME_UNKNOWN'); }
  }
});
