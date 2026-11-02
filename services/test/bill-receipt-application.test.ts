import { removeTemp } from '../../test/support/temp-cleanup.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { integratedRequest } from '../../packages/backend-kit/src/application.ts';
import { ProviderClient } from '../../packages/backend-kit/src/provider-client.ts';
import { actorFor, assetsFor } from '../../packages/backend-kit/src/context.ts';

test('integrated bill settlement refuses a different frozen quote or provider receipt', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'bill-contract-')), previous = process.env.APP_DATA_DIR;
  process.env.APP_DATA_DIR = dir;
  t.after(() => { if (previous === undefined) delete process.env.APP_DATA_DIR; else process.env.APP_DATA_DIR = previous; removeTemp(dir); });
  let scenario = 'valid', provider = 'dewa', approvals = 0, executions = 0, creations = 0, billAmount: unknown = 1.15, executed = false;
  const payable = () => ({ id: `${provider}:bill:bill123`, kind: 'BILL', provider, obligationId: 'bill123', reference: provider === 'dewa' ? assetsFor(actor.accountId).utilityAccount : 'owned', revision: 'a'.repeat(64), status: 'UNPAID', amountMinor: 115 });
  const order = (state: string) => ({ id: scenario === 'wrong-id' || scenario === 'changed-id' && state === 'AUTHORIZED' ? 'other' : `${provider}_original`, ownerSub: scenario === 'wrong-owner' ? 'other' : actor.sub, accountId: scenario === 'wrong-account' ? 'other' : actor.accountId, state, version: 1, approvalDigest: scenario === 'changed-digest' && state === 'AUTHORIZED' ? 'b'.repeat(64) : 'a'.repeat(64), quote: { currency:scenario === 'wrong-currency' ? 'USD' : 'AED', source:{ id: scenario === 'wrong-source' ? 'other' : 'wallet', kind:'wallet', accountId:scenario === 'wrong-source-account' ? 'other' : actor.accountId, version:scenario === 'wrong-source-version' ? 2 : 1 }, terms:{ feeMinor: scenario === 'changed-terms' && state === 'AUTHORIZED' ? 1 : 0 }, totalMinor: 115, payable: scenario === 'wrong-quote' || scenario === 'wrong-authorized' && state === 'AUTHORIZED' || scenario === 'wrong-settled' && state === 'SETTLED' ? { ...payable(), obligationId: 'other' } : payable() }, receipt: { receiptNumber: scenario === 'blank-reference' ? '   ' : scenario === 'long-reference' ? 'r'.repeat(201) : 'receipt', obligationId: scenario === 'wrong-receipt' ? 'other' : 'bill123', amountMinor: scenario === 'wrong-amount' ? 116 : 115, currency: 'AED' } });
  t.mock.method(ProviderClient.prototype, 'call', async (name, _actor, _method, route) => {
    if (name === provider && route === '/bills') {
      if (executed && scenario === 'post-unavailable') throw new Error('provider unavailable');
      const bill = { billId: 'bill123', status: executed && scenario !== 'post-unpaid' ? 'PAID' : 'UNPAID', totalAmount: executed && scenario === 'post-amount' ? 1.16 : executed && scenario === 'post-fraction' ? 1.151 : billAmount, accountNumber: executed && scenario === 'post-owner' ? 'other' : assetsFor(actor.accountId).utilityAccount, ...(executed && scenario !== 'post-no-reference' ? { receiptNumber: scenario === 'post-reference' ? 'other' : 'receipt' } : {}) };
      if (executed && scenario === 'post-malformed') return { bills: null };
      if (executed && scenario === 'post-missing') return { bills: [] };
      return { bills: scenario === 'duplicate-bill' || executed && scenario === 'post-duplicate' ? [bill, { ...bill, totalAmount: 9 }] : [bill] };
    }
    if (name === provider && route === '/payables') return { payables: scenario === 'duplicate-payable' ? [payable(), { ...payable(), id: 'conflicting-payable' }] : [payable()] };
    if (route === '/billing-accounts') return { billingAccounts: [{ status: 'ACTIVE', provider, reference: payable().reference }] };
    if (route === '/payment-orders') { creations++; return { order: { id: scenario === 'bad-created-id' ? '../other' : `${provider}_original` } }; }
    if (route === `/payment-orders/${provider}_original`) return { order: order('AWAITING_APPROVAL') };
    if (route.endsWith('/approve')) { approvals++; const approved = order('AUTHORIZED'); if (scenario === 'reordered-quote') approved.quote = Object.fromEntries(Object.entries(approved.quote).reverse()) as typeof approved.quote; return { order: approved }; }
    if (route.endsWith('/execute')) { executions++; executed = true; return { order: order('SETTLED') }; }
    if (route === '/wallet') return { balance: 10 };
    throw new Error('Unexpected provider operation');
  });
  const actor = actorFor({ sub: 'bill-contract-user' }), legacy = () => ({ status: 404, data: {} });
  for (provider of ['dewa', 'du', 'etisalat']) {
    const run = () => { executed = false; return provider === 'dewa'
      ? integratedRequest('service-food', actor, 'POST', '/utilities/pay', {}, { billId: 'bill123', expectedAmountMinor: 115 }, legacy)
      : integratedRequest('service-telecom', actor, 'POST', `/telecom/${provider}/bills/bill123/payments`, {}, { expectedAmountMinor: 115 }, legacy); };
    for (const invalid of [1.151, '1.15', -1.15, NaN]) {
      billAmount = invalid; const beforeCreations = creations;
      const badBill = await run(); assert.equal(badBill.status, 503); assert.equal(badBill.data.code, 'PROVIDER_UNAVAILABLE'); assert.equal(creations, beforeCreations);
    }
    billAmount = 1.15;
    for (scenario of ['duplicate-bill', 'duplicate-payable']) {
      const beforeCreations = creations;
      const ambiguous = await run(); assert.equal(ambiguous.status, 503); assert.equal(ambiguous.data.code, 'PROVIDER_UNAVAILABLE'); assert.equal(creations, beforeCreations);
    }
    scenario = 'valid'; const good = await run(); assert.equal(good.status, 200); assert.equal(good.data.receipt.billId, 'bill123');
    scenario = 'reordered-quote'; assert.equal((await run()).status, 200);
    for (scenario of ['wrong-quote', 'wrong-id', 'wrong-owner', 'wrong-account', 'wrong-source', 'wrong-source-account', 'wrong-source-version', 'wrong-currency', 'bad-created-id']) { const beforeApprovals = approvals, beforeExecutions = executions;
      const wrong = await run(); assert.equal(wrong.status, 503); assert.equal(wrong.data.code, 'PROVIDER_OUTCOME_UNKNOWN'); assert.equal(approvals, beforeApprovals); assert.equal(executions, beforeExecutions); }
    scenario = 'wrong-authorized'; const priorExecutions = executions; const authorized = await run(); assert.equal(authorized.status, 503); assert.equal(authorized.data.code, 'PROVIDER_OUTCOME_UNKNOWN'); assert.equal(executions, priorExecutions);
    for (scenario of ['changed-id', 'changed-digest', 'changed-terms']) { const beforeChanged = executions; const changed = await run(); assert.equal(changed.status, 503); assert.equal(changed.data.code, 'PROVIDER_OUTCOME_UNKNOWN'); assert.equal(executions, beforeChanged); }
    for (scenario of ['wrong-settled', 'wrong-receipt', 'wrong-amount', 'blank-reference', 'long-reference']) { const bad = await run(); assert.equal(bad.status, 503); assert.equal(bad.data.code, 'PROVIDER_OUTCOME_UNKNOWN'); }
    for (scenario of ['post-unavailable', 'post-malformed', 'post-missing', 'post-duplicate', 'post-unpaid', 'post-reference', 'post-no-reference', 'post-amount', 'post-fraction', ...(provider === 'dewa' ? ['post-owner'] : [])]) {
      const prior = executions, bad = await run(); assert.equal(bad.status, 503); assert.equal(bad.data.code, 'PROVIDER_OUTCOME_UNKNOWN'); assert.equal(executions, prior + 1);
    }
  }
});
