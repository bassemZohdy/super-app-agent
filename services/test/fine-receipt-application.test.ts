import { removeTemp } from '../../test/support/temp-cleanup.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { integratedRequest } from '../../packages/backend-kit/src/application.ts';
import { ProviderClient, UpstreamError } from '../../packages/backend-kit/src/provider-client.ts';
import { actorFor, assetsFor } from '../../packages/backend-kit/src/context.ts';
import { buildApplicationOpenApi } from '../../packages/backend-kit/src/application-openapi.ts';
import { Ajv } from 'ajv';

test('compatibility fine receipts use the exact frozen and settled selection', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'fines-contract-')), previous = process.env.APP_DATA_DIR;
  process.env.APP_DATA_DIR = dir;
  t.after(() => { if (previous === undefined) delete process.env.APP_DATA_DIR; else process.env.APP_DATA_DIR = previous; removeTemp(dir); });
  const actor = actorFor({ sub: 'fine-contract-user' }), plate = assetsFor(actor.accountId).plate;
  const items = [{ obligationId: 'fine-one' }, { obligationId: 'fine-two' }];
  const selection = { id: 'police:selection:one', provider: 'police', kind: 'FINE_SET', reference: plate, revision: 'a'.repeat(64), obligationId: 'FINESET-one', amountMinor: 115, items };
  let scenario = 'valid', orders = 0, approvals = 0, executions = 0, selections = 0;
  const order = (state: string) => ({ id: 'original', ownerSub: actor.sub, accountId: actor.accountId, state, version: 1, approvalDigest: 'a'.repeat(64), quote: { currency:'AED', source:{ id:'wallet', kind:'wallet', accountId:actor.accountId, version:1 }, totalMinor: scenario === 'wrong-total' ? 116 : 115, payable: scenario === 'wrong-order' || scenario === 'wrong-authorized' && state === 'AUTHORIZED' ? { ...selection, items: [{ obligationId: 'other' }, items[1]] } : selection }, receipt: { receiptNumber: 'receipt', obligationId: scenario === 'wrong-receipt' ? 'other' : selection.obligationId, amountMinor: 115, currency: 'AED' } });
  t.mock.method(ProviderClient.prototype, 'call', async (provider, _actor, _method, route) => {
    if (provider === 'police' && route === '/fines') return { fines: [ { fineId: 'fine-one', plateNumber: plate, payableId: 'one', payableRevision: 'a' }, { fineId: scenario === 'duplicate-fine' ? 'fine-one' : 'fine-two', plateNumber: plate, payableId: scenario === 'duplicate-payable' ? 'one' : 'two', payableRevision: scenario === 'missing-revision' ? '' : 'b' } ] };
    if (provider === 'police' && route === '/fine-selections') { selections++; return { payable: scenario === 'wrong-selection' ? { ...selection, items: [{ obligationId: 'fine-one' }, { obligationId: 'other' }] } : selection }; }
    if (route === '/billing-accounts') return { billingAccounts: [{ status: 'ACTIVE', provider: 'police', reference: plate }] };
    if (route === '/payment-orders') { orders++; return { order: { id: 'original' } }; }
    if (route === '/payment-orders/original') return { order: order('AWAITING_APPROVAL') };
    if (route.endsWith('/approve')) { approvals++; return { order: order('AUTHORIZED') }; }
    if (route.endsWith('/execute')) { executions++; return { order: order('SETTLED') }; }
    if (route === '/wallet') {
      if (scenario === 'wallet-404') throw new UpstreamError(404, 'NOT_FOUND', 'not found');
      if (scenario === 'wallet-403') throw new UpstreamError(403, 'ACCOUNT_FORBIDDEN', 'forbidden');
      return { balance: scenario === 'wallet-bad' ? 1.001 : 10 };
    }
    throw new Error('Unexpected provider operation');
  });
  const run = () => integratedRequest('service-wallet', actor, 'POST', '/fines/pay', {}, { fineIds: ['fine-one', 'fine-two'], expectedAmountMinor: 115 }, () => ({ status: 404, data: {} }));
  const good = await run(); assert.equal(good.status, 200); assert.deepEqual(good.data.fineIds, ['fine-one', 'fine-two']);
  const operation = buildApplicationOpenApi().paths['/fines/pay'].post as { responses: { '200': { content: { 'application/json': { schema: object } } } } };
  assert.equal(new Ajv({ strict: false }).compile(operation.responses['200'].content['application/json'].schema)(good.data), true);
  for (scenario of ['duplicate-fine', 'duplicate-payable', 'missing-revision']) {
    const beforeSelections = selections, beforeOrders = orders;
    const malformed = await run(); assert.equal(malformed.status, 503); assert.equal(malformed.data.code, 'PROVIDER_UNAVAILABLE');
    assert.equal(selections, beforeSelections); assert.equal(orders, beforeOrders);
  }
  scenario = 'wrong-selection'; const before = orders; const badSelection = await run(); assert.notEqual(badSelection.status, 200); assert.equal(orders, before);
  for (scenario of ['wrong-order', 'wrong-total']) { const beforeApproval = approvals, beforeExecution = executions; const bad = await run(); assert.equal(bad.status, 503); assert.equal(bad.data.code, 'PROVIDER_OUTCOME_UNKNOWN'); assert.equal(approvals, beforeApproval); assert.equal(executions, beforeExecution); }
  scenario = 'wrong-authorized'; const priorExecution = executions; const changed = await run(); assert.equal(changed.status, 503); assert.equal(changed.data.code, 'PROVIDER_OUTCOME_UNKNOWN'); assert.equal(executions, priorExecution);
  scenario = 'wrong-receipt'; const bad = await run(); assert.equal(bad.status, 503); assert.equal(bad.data.code, 'PROVIDER_OUTCOME_UNKNOWN');
  for (scenario of ['wallet-404', 'wallet-403', 'wallet-bad']) {
    const prior = executions, result = await run(); assert.equal(result.status, 503); assert.equal(result.data.code, 'PROVIDER_OUTCOME_UNKNOWN'); assert.equal(executions, prior + 1);
  }
});
