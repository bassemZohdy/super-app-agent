import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { removeTemp } from '../../test/support/temp-cleanup.ts';
import { integratedRequest } from '../../packages/backend-kit/src/application.ts';
import { actorFor, assetsFor } from '../../packages/backend-kit/src/context.ts';
import { ProviderClient } from '../../packages/backend-kit/src/provider-client.ts';

test('utility settlement refuses bills and payables outside the account before payment', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'utility-account-pay-')), previous = process.env.APP_DATA_DIR;
  process.env.APP_DATA_DIR = directory;
  t.after(() => { if (previous === undefined) delete process.env.APP_DATA_DIR; else process.env.APP_DATA_DIR = previous; removeTemp(directory); });
  const actor = actorFor({ sub: 'utility-owner' }), asset = assetsFor(actor.accountId), revision = 'a'.repeat(64);
  let scenario = '', payableReads = 0, payments = 0;
  t.mock.method(ProviderClient.prototype, 'call', async (provider, _actor, _method, path) => {
    if (provider === 'dewa' && path === '/bills') return { bills: [{ billId: 'bill-one', accountNumber: scenario === 'other-bill' || scenario === 'paid-other' ? 'other' : asset.utilityAccount, premiseId: scenario === 'other-premise' ? 'other' : asset.premiseId, status: scenario === 'paid-other' ? 'PAID' : 'UNPAID', totalAmount: 1 }] };
    if (path === '/payables') { payableReads++; return { payables: provider === 'dewa' ? [{ id: 'dewa:bill:one', provider: 'dewa', kind: 'BILL', status: 'UNPAID', reference: scenario === 'other-payable' ? 'other' : asset.utilityAccount, revision, obligationId: 'bill-one', amountMinor: 100, currency: 'AED' }] : [] }; }
    if (path === '/payment-orders' || path === '/checkout-groups') { payments++; throw new Error('Unexpected payment'); }
    throw new Error('Unexpected provider call');
  });
  const legacy = () => ({ status: 404, data: {} });
  const standalone = () => integratedRequest('service-food', actor, 'POST', '/utilities/pay', {}, { billId: 'bill-one', expectedAmountMinor: 100 }, legacy);
  const grouped = () => integratedRequest('service-wallet', actor, 'POST', '/pay/unified', {}, { items: [{ agency: 'DEWA', purpose: 'Review', amount: 1 }], expectedPayables: [{ provider: 'dewa', payableId: 'dewa:bill:one', expectedRevision: revision }] }, legacy);
  for (scenario of ['other-bill', 'paid-other', 'other-premise']) { const before = payableReads; assert.equal((await standalone()).status, 404); assert.equal(payableReads, before); }
  scenario = 'other-payable'; assert.equal((await standalone()).status, 409); assert.equal((await grouped()).status, 409);
  assert.equal(payments, 0);
});
