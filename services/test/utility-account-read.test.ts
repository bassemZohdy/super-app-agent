import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { removeTemp } from '../../test/support/temp-cleanup.ts';
import { integratedRequest } from '../../packages/backend-kit/src/application.ts';
import { actorFor, assetsFor } from '../../packages/backend-kit/src/context.ts';
import { ProviderClient } from '../../packages/backend-kit/src/provider-client.ts';

test('utility reads and implicit settlement use only the selected account', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'utility-account-read-')), previous = process.env.APP_DATA_DIR;
  process.env.APP_DATA_DIR = directory;
  t.after(() => { if (previous === undefined) delete process.env.APP_DATA_DIR; else process.env.APP_DATA_DIR = previous; removeTemp(directory); });
  const actor = actorFor({ sub: 'utility-read-owner' }), asset = assetsFor(actor.accountId);
  const bill = { billId: 'owned', accountNumber: asset.utilityAccount, premiseId: asset.premiseId, status: 'PAID', totalAmount: 1, receiptNumber: 'receipt' };
  let scenario = 'mixed', payableCalls = 0;
  t.mock.method(ProviderClient.prototype, 'call', async (_provider, _actor, _method, path) => {
    if (path === '/bills') {
      if (scenario === 'malformed') return { bills: null };
      if (scenario === 'absent') return { bills: [{ ...bill, accountNumber: 'other' }] };
      return { bills: [{ ...bill, billId: 'foreign', accountNumber: 'other' }, { ...bill, billId: 'wrong-premise', premiseId: 'other' }, bill] };
    }
    if (path === '/payables') { payableCalls++; return { payables: [{ id: 'wrong', provider: 'dewa', kind: 'BILL', obligationId: bill.billId, reference: 'other', revision: 'a'.repeat(64) }, { id: 'correct', provider: 'dewa', kind: 'BILL', obligationId: bill.billId, reference: asset.utilityAccount, revision: 'b'.repeat(64) }] }; }
    if (path === '/consumption') return { account: { accountNumber: scenario === 'absent' ? 'other' : asset.utilityAccount, premiseId: scenario === 'wrong-premise' ? 'other' : asset.premiseId }, ecoStatus: 'snapshot' };
    throw new Error('Unexpected provider call');
  });
  const legacy = () => ({ status: 404, data: {} });
  const get = (path: string) => integratedRequest('service-food', actor, 'GET', path, {}, {}, legacy);
  const result = await get('/utilities/bill'); assert.equal(result.status, 200); assert.equal(result.data.bill.billId, 'owned'); assert.equal(result.data.bill.payableId, 'correct');
  const paid = await integratedRequest('service-food', actor, 'POST', '/utilities/pay', {}, {}, legacy); assert.equal(paid.status, 200); assert.equal(paid.data.bill.billId, 'owned');
  assert.equal((await get('/utilities/consumption')).status, 200);
  scenario = 'absent'; const before = payableCalls; assert.equal((await get('/utilities/bill')).status, 404); assert.equal(payableCalls, before); assert.equal((await get('/utilities/consumption')).status, 404);
  scenario = 'wrong-premise'; assert.equal((await get('/utilities/consumption')).status, 404);
  scenario = 'malformed'; assert.equal((await get('/utilities/bill')).status, 503);
});
