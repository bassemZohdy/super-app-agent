import { removeTemp } from '../../test/support/temp-cleanup.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { integratedRequest } from '../../packages/backend-kit/src/application.ts';
import { ProviderClient } from '../../packages/backend-kit/src/provider-client.ts';
import { actorFor } from '../../packages/backend-kit/src/context.ts';

test('recharge orders and receipts stay bound to the selected target', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'recharge-binding-')), previous = process.env.APP_DATA_DIR;
  process.env.APP_DATA_DIR = dir;
  t.after(() => { if (previous === undefined) delete process.env.APP_DATA_DIR; else process.env.APP_DATA_DIR = previous; removeTemp(dir); });
  let provider = 'rta', scenario = 'valid', approvals = 0, executions = 0;
  const payable = () => ({ id: `${provider}:recharge:one`, kind: 'RECHARGE', provider, obligationId: `${provider}:recharge:one`, reference: 'owned-target', revision: 'a'.repeat(64), amountMinor: 10000, currency: 'AED', recharge: { kind: provider === 'rta' ? 'TOLL' : 'PREPAID', targetVersion: 1, balanceBeforeMinor: 1400 } });
  const order = (state: string) => ({ id: 'original', ownerSub: actor.sub, accountId: actor.accountId, state, version: 1, approvalDigest: 'a'.repeat(64), paymentId: 'payment', quote: { currency:'AED', source:{ id:'wallet', kind:'wallet', accountId:actor.accountId, version:1 }, totalMinor: 10000, payable: scenario === 'wrong-order' || scenario === 'wrong-authorized' && state === 'AUTHORIZED' ? { ...payable(), reference: 'other' } : payable() }, receipt: { receiptNumber: 'payment', obligationId: payable().obligationId, amountMinor: 10000, currency: 'AED', targetReference: scenario === 'wrong-receipt' ? 'other' : 'owned-target', providerBalanceMinor: scenario === 'wrong-balance' ? 11401 : 11400 } });
  t.mock.method(ProviderClient.prototype, 'call', async (name, _actor, _method, route) => {
    if (name === 'rta' && route === '/salik') return { tagNumber: 'owned-target' };
    if (name === provider && route.startsWith('/recharge-intents/')) return { payable: scenario === 'wrong-quote' ? { ...payable(), provider: 'other' } : payable() };
    if (route === '/billing-accounts') return { billingAccounts: [{ status: 'ACTIVE', provider, reference: 'owned-target' }] };
    if (route === '/payment-orders') return { order: { id: 'original' } };
    if (route === '/payment-orders/original') return { order: order('AWAITING_APPROVAL') };
    if (route.endsWith('/approve')) { approvals++; return { order: order('AUTHORIZED') }; }
    if (route.endsWith('/execute')) { executions++; return { order: order('SETTLED') }; }
    throw new Error('Unexpected provider operation');
  });
  const actor = actorFor({ sub: 'recharge-binding-user' }), legacy = () => ({ status: 404, data: {} });
  for (provider of ['rta', 'du', 'etisalat']) {
    const run = () => provider === 'rta'
      ? integratedRequest('service-ride', actor, 'POST', '/mobility/salik/recharge', {}, { amount: 100 }, legacy)
      : integratedRequest('service-telecom', actor, 'POST', `/telecom/${provider}/prepaid/recharges`, {}, { lineId: 'owned-target', amountMinor: 10000, expectedTargetVersion: 1 }, legacy);
    scenario = 'valid'; const good = await run(); assert.equal(good.status, 200); assert.equal(good.data.newBalance, 114);
    for (scenario of ['wrong-quote', 'wrong-order']) { const beforeApproval = approvals, beforeExecution = executions; const bad = await run(); assert.notEqual(bad.status, 200); assert.equal(approvals, beforeApproval); assert.equal(executions, beforeExecution); }
    scenario = 'wrong-authorized'; const priorExecution = executions; const changed = await run(); assert.equal(changed.status, 503); assert.equal(changed.data.code, 'PROVIDER_OUTCOME_UNKNOWN'); assert.equal(executions, priorExecution);
    for (scenario of ['wrong-receipt', 'wrong-balance']) { const bad = await run(); assert.equal(bad.status, 503); assert.equal(bad.data.code, 'PROVIDER_OUTCOME_UNKNOWN'); }
  }
});
