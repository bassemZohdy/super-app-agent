import { removeTemp } from '../../test/support/temp-cleanup.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { integratedRequest } from '../../packages/backend-kit/src/application.ts';
import { ProviderClient, UpstreamError } from '../../packages/backend-kit/src/provider-client.ts';
import { actorFor } from '../../packages/backend-kit/src/context.ts';

test('unified checkout binds the original group, child order, owner and funding source', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'group-binding-')), previous = process.env.APP_DATA_DIR;
  process.env.APP_DATA_DIR = dir;
  t.after(() => { if (previous === undefined) delete process.env.APP_DATA_DIR; else process.env.APP_DATA_DIR = previous; removeTemp(dir); });
  const actor = actorFor({ sub: 'group-binding-user' });
  const source = { id: 'wallet', accountId: actor.accountId, kind: 'wallet', version: 1, currency: 'AED', status: 'ACTIVE' };
  const payable = { id: 'rta:recharge:one', obligationId:'rta:recharge:one', kind:'RECHARGE', recharge:{balanceBeforeMinor:0}, provider: 'rta', reference: 'tag', revision: 'a'.repeat(64) };
  let scenario = 'valid', approvals = 0, runs = 0;
  const group = (state: string) => {
    const quote = { payable: scenario === 'wrong-item' ? { ...payable, id: 'other' } : payable, source, currency: 'AED', totalMinor: 10000, feeMinor: scenario === 'changed-terms' && state === 'READY' || scenario === 'changed-after-reopen' ? 1 : 0 };
    const child = { id: 'child', accountId: actor.accountId, ownerSub: actor.sub, approvalDigest: 'c'.repeat(64), state: state === 'COMPLETED' ? 'SETTLED' : 'AWAITING_APPROVAL', quote, paymentId:state === 'COMPLETED'?'payment':undefined, receipt: state === 'COMPLETED' ? { receiptNumber: 'payment', obligationId:payable.obligationId, amountMinor:10000, currency:'AED', targetReference:scenario==='wrong-receipt'?'other':'tag', providerBalanceMinor:10000 } : undefined };
    return { id: scenario === 'wrong-id' ? 'other' : 'group-original', accountId: scenario === 'wrong-account' ? 'other' : actor.accountId, ownerSub: scenario === 'wrong-owner' ? 'other' : actor.sub, source: scenario === 'wrong-source' ? { ...source, id: 'other' } : source, currency: 'AED', totalMinor: 10000, approvalDigest: 'b'.repeat(64), orderIds: ['child'], excluded: [], orders: [child], state, version: 1 };
  };
  t.mock.method(ProviderClient.prototype, 'call', async (_provider, _actor, _method, route) => {
    if (route === '/payables') return { payables: [] };
    if (route.startsWith('/recharge-intents/')) return { payable };
    if (route === '/billing-accounts') return { billingAccounts: [{ provider: 'rta', reference: 'tag', status: 'ACTIVE' }] };
    if (route === `/payables/${encodeURIComponent(payable.id)}`) return { payable };
    if (route === '/checkout-groups') return { group: { id: 'group-original' } };
    if (route === '/checkout-groups/group-original') return { group: group('AWAITING_APPROVAL') };
    if (route.endsWith('/approve')) { approvals++; return { group: group('READY') }; }
    if (route.endsWith('/execute')) { runs++; return { group: group('COMPLETED') }; }
    if (route === '/wallet') return { balance: 10 };
    throw new UpstreamError(503, 'UNEXPECTED', 'Unexpected provider call');
  });
  const run = () => integratedRequest('service-wallet', actor, 'POST', '/pay/unified', {}, { items:[{ agency:'demo', purpose:'test', amount:100 }] }, () => ({ status:404, data:{} }));
  for (scenario of ['wrong-id', 'wrong-account', 'wrong-owner', 'wrong-source', 'wrong-item']) {
    const beforeApprovals=approvals, beforeRuns=runs, result=await run(); assert.equal(result.status,503); assert.equal(result.data.code,'PROVIDER_OUTCOME_UNKNOWN'); assert.equal(approvals,beforeApprovals); assert.equal(runs,beforeRuns);
  }
  scenario='changed-terms'; const beforeRuns=runs, changed=await run(); assert.equal(changed.status,503); assert.equal(changed.data.code,'PROVIDER_OUTCOME_UNKNOWN'); assert.equal(runs,beforeRuns);
  const reopened=await import('../../packages/backend-kit/src/application.ts?group-binding-reopened'); scenario='changed-after-reopen'; const beforeReopen=approvals; const altered=await reopened.integratedRequest('service-wallet',actor,'POST','/pay/unified',{}, {items:[{agency:'demo',purpose:'test',amount:100}]},()=>({status:404,data:{}})); assert.equal(altered.status,503);assert.equal(altered.data.code,'PROVIDER_OUTCOME_UNKNOWN');assert.equal(approvals,beforeReopen);
  scenario='wrong-receipt'; const badReceipt=await run();assert.equal(badReceipt.status,503);assert.equal(badReceipt.data.code,'PROVIDER_OUTCOME_UNKNOWN');
  scenario='valid'; const beforeValid=runs; const result=await run(); assert.equal(result.status,200); assert.equal(result.data.govTransactionHash,'group-original'); assert.equal(runs,beforeValid+1);
});
