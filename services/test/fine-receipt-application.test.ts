import { removeTemp } from '../../test/support/temp-cleanup.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { integratedRequest } from '../../packages/backend-kit/src/application.ts';
import { ProviderClient } from '../../packages/backend-kit/src/provider-client.ts';
import { actorFor } from '../../packages/backend-kit/src/context.ts';

test('compatibility fine receipts use the exact frozen and settled selection', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'fines-contract-')), previous = process.env.APP_DATA_DIR;
  process.env.APP_DATA_DIR = dir;
  t.after(() => { if (previous === undefined) delete process.env.APP_DATA_DIR; else process.env.APP_DATA_DIR = previous; removeTemp(dir); });
  const items = [{ obligationId: 'fine-one' }, { obligationId: 'fine-two' }];
  const selection = { id: 'police:selection:one', provider: 'police', kind: 'FINE_SET', reference: 'plate', revision: 'a'.repeat(64), obligationId: 'FINESET-one', amountMinor: 115, items };
  let scenario = 'valid', orders = 0, approvals = 0, executions = 0;
  const order = (state: string) => ({ id: 'original', ownerSub: actor.sub, accountId: actor.accountId, state, version: 1, approvalDigest: 'digest', quote: { currency:'AED', source:{ id:'wallet', kind:'wallet', accountId:actor.accountId, version:1 }, totalMinor: scenario === 'wrong-total' ? 116 : 115, payable: scenario === 'wrong-order' || scenario === 'wrong-authorized' && state === 'AUTHORIZED' ? { ...selection, items: [{ obligationId: 'other' }, items[1]] } : selection }, receipt: { receiptNumber: 'receipt', obligationId: scenario === 'wrong-receipt' ? 'other' : selection.obligationId, amountMinor: 115, currency: 'AED' } });
  t.mock.method(ProviderClient.prototype, 'call', async (provider, _actor, _method, route) => {
    if (provider === 'police' && route === '/fines') return { fines: [ { fineId: 'fine-one', payableId: 'one', payableRevision: 'a' }, { fineId: 'fine-two', payableId: 'two', payableRevision: 'b' } ] };
    if (provider === 'police' && route === '/fine-selections') return { payable: scenario === 'wrong-selection' ? { ...selection, items: [{ obligationId: 'fine-one' }, { obligationId: 'other' }] } : selection };
    if (route === '/billing-accounts') return { billingAccounts: [{ status: 'ACTIVE', provider: 'police', reference: 'plate' }] };
    if (route === '/payment-orders') { orders++; return { order: { id: 'original' } }; }
    if (route === '/payment-orders/original') return { order: order('AWAITING_APPROVAL') };
    if (route.endsWith('/approve')) { approvals++; return { order: order('AUTHORIZED') }; }
    if (route.endsWith('/execute')) { executions++; return { order: order('SETTLED') }; }
    if (route === '/wallet') return { balance: 10 };
    throw new Error('Unexpected provider operation');
  });
  const actor = actorFor({ sub: 'fine-contract-user' });
  const run = () => integratedRequest('service-wallet', actor, 'POST', '/fines/pay', {}, { fineIds: ['fine-one', 'fine-two'], expectedAmountMinor: 115 }, () => ({ status: 404, data: {} }));
  const good = await run(); assert.equal(good.status, 200); assert.deepEqual(good.data.fineIds, ['fine-one', 'fine-two']);
  scenario = 'wrong-selection'; const before = orders; const badSelection = await run(); assert.notEqual(badSelection.status, 200); assert.equal(orders, before);
  for (scenario of ['wrong-order', 'wrong-total']) { const beforeApproval = approvals, beforeExecution = executions; const bad = await run(); assert.equal(bad.status, 503); assert.equal(bad.data.code, 'PROVIDER_OUTCOME_UNKNOWN'); assert.equal(approvals, beforeApproval); assert.equal(executions, beforeExecution); }
  scenario = 'wrong-authorized'; const priorExecution = executions; const changed = await run(); assert.equal(changed.status, 503); assert.equal(changed.data.code, 'PROVIDER_OUTCOME_UNKNOWN'); assert.equal(executions, priorExecution);
  scenario = 'wrong-receipt'; const bad = await run(); assert.equal(bad.status, 503); assert.equal(bad.data.code, 'PROVIDER_OUTCOME_UNKNOWN');
});
