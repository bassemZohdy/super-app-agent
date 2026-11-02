import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { removeTemp } from '../../test/support/temp-cleanup.ts';
import { integratedRequest } from '../../packages/backend-kit/src/application.ts';
import { actorFor, assetsFor } from '../../packages/backend-kit/src/context.ts';
import { ProviderClient } from '../../packages/backend-kit/src/provider-client.ts';

test('standalone and grouped fine settlement refuse other plates before payment', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'fine-plate-pay-')), previous = process.env.APP_DATA_DIR;
  process.env.APP_DATA_DIR = directory;
  t.after(() => { if (previous === undefined) delete process.env.APP_DATA_DIR; else process.env.APP_DATA_DIR = previous; removeTemp(directory); });
  const actor = actorFor({ sub: 'fine-plate-owner' }), plate = assetsFor(actor.accountId).plate, revision = 'a'.repeat(64);
  let scenario = '', selections = 0, payments = 0;
  t.mock.method(ProviderClient.prototype, 'call', async (provider, _actor, _method, path) => {
    if (provider === 'police' && path === '/fines') return { fines: [{ fineId: 'fine-one', plateNumber: scenario === 'other-fine' ? 'Dubai X-00000' : plate, payableId: 'police:fine:one', payableRevision: revision }] };
    if (path === '/payables') return { payables: provider === 'police' ? [{ id: 'police:fine:one', provider: 'police', kind: 'FINE', status: 'UNPAID', reference: scenario === 'other-fine' ? 'Dubai X-00000' : plate, revision, obligationId: 'fine-one', amountMinor: 100, currency: 'AED' }] : [] };
    if (path === '/fine-selections') { selections++; return { payable: { id: 'selection', provider: 'police', kind: 'FINE_SET', reference: 'Dubai X-00000', revision, obligationId: 'set-one', amountMinor: 100, items: [{ obligationId: 'fine-one' }] } }; }
    if (path === '/payment-orders' || path === '/checkout-groups') { payments++; throw new Error('Unexpected payment'); }
    throw new Error('Unexpected provider call');
  });
  const legacy = () => ({ status: 404, data: {} });
  const standalone = () => integratedRequest('service-wallet', actor, 'POST', '/fines/pay', {}, { fineIds: ['fine-one'], expectedAmountMinor: 100 }, legacy);
  const grouped = () => integratedRequest('service-wallet', actor, 'POST', '/pay/unified', {}, { items: [{ agency: 'Police', purpose: 'Review', amount: 1 }], expectedPayables: [{ provider: 'police', payableId: 'police:fine:one', expectedRevision: revision }] }, legacy);
  for (const [run, refusedStatus] of [[standalone, 404], [grouped, 409]] as const) {
    scenario = 'other-fine'; const before = selections;
    assert.equal((await run()).status, refusedStatus);
    assert.equal(selections, before, 'an off-plate fine is refused before creating a selection');
    scenario = 'wrong-quote';
    const result = await run();
    assert.equal(result.status, 503);
    assert.equal(selections, before + 1, 'the wrong provider quote was inspected');
    assert.equal(payments, 0, 'an off-plate provider quote cannot create a payment');
  }
});
