import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { removeTemp } from '../../test/support/temp-cleanup.ts';
import { executeWalletRequest, policeFines } from '../service-wallet/src/index.ts';
import { integratedRequest } from '../../packages/backend-kit/src/application.ts';
import { actorFor, assetsFor } from '../../packages/backend-kit/src/context.ts';
import { ProviderClient } from '../../packages/backend-kit/src/provider-client.ts';

test('offline fine lookup returns only the requested plate and matching totals', t => {
  const extra = { ...policeFines[0], fineId: 'OTHER-PLATE-FINE', plateNumber: 'Dubai C-99999', payableAmount: 0.1, originalAmount: 0.1, discountAmount: 0 };
  const second = { ...extra, fineId: 'OTHER-PLATE-FINE-2', payableAmount: 0.2, originalAmount: 0.2 };
  policeFines.push(extra, second);
  t.after(() => { for (const fine of [extra, second]) { const index = policeFines.indexOf(fine); if (index >= 0) policeFines.splice(index, 1); } });
  for (const path of ['/fines/check', '/fines']) {
    const result = executeWalletRequest('GET', path, { plateNumber: extra.plateNumber });
    assert.equal(result.status, 200);
    assert.deepEqual(result.data.fines.map((fine: { fineId: string }) => fine.fineId), [extra.fineId, second.fineId]);
    assert.deepEqual([result.data.count, result.data.totalOriginal, result.data.totalPayable], [2, 0.3, 0.3]);
    const missing = executeWalletRequest('GET', path, { plateNumber: 'Dubai X-00000' });
    assert.equal(missing.data.count, 0);
    assert.deepEqual(missing.data.fines, []);
    assert.ok(executeWalletRequest('GET', path).data.fines.every((fine: { plateNumber: string }) => fine.plateNumber === 'Dubai B-74892'));
  }
});

test('integrated fine lookup refuses another plate without calling the provider', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'fines-plate-')), previous = process.env.APP_DATA_DIR;
  process.env.APP_DATA_DIR = directory;
  t.after(() => { if (previous === undefined) delete process.env.APP_DATA_DIR; else process.env.APP_DATA_DIR = previous; removeTemp(directory); });
  const actor = actorFor({ sub: 'plate-owner' }), plate = assetsFor(actor.accountId).plate;
  let calls = 0, malformed = false;
  t.mock.method(ProviderClient.prototype, 'call', async () => { calls++; return { fines: [
    { fineId: 'owned', plateNumber: plate, originalAmount: 15, payableAmount: 12, discountAmount: malformed ? 4 : 3 },
    { fineId: 'other', plateNumber: 'Dubai C-99999', originalAmount: 30, payableAmount: 20, discountAmount: 10 },
  ], count: 2, totalOriginal: 45, totalDiscount: 13, totalPayable: 32 }; });
  const run = (path: string, requested?: string) => integratedRequest('service-wallet', actor, 'GET', path, requested === undefined ? {} : { plateNumber: requested }, {}, () => ({ status: 404, data: {} }));
  for (const path of ['/fines/check', '/fines']) {
    const before = calls;
    assert.equal((await run(path, 'Dubai X-00000')).status, 404);
    assert.equal(calls, before);
    const own = await run(path, plate);
    assert.equal(own.status, 200);
    assert.equal(own.data.plateNumber, plate);
    assert.deepEqual(own.data.fines.map((fine: { fineId: string }) => fine.fineId), ['owned']);
    assert.deepEqual([own.data.count, own.data.totalOriginal, own.data.totalPayable, own.data.totalDiscount], [1, 15, 12, 3]);
    assert.deepEqual((await run(path)).data.fines.map((fine: { fineId: string }) => fine.fineId), ['owned']);
    malformed = true;
    assert.equal((await run(path, plate)).status, 503);
    malformed = false;
  }
});


test('integrated fine reports reject missing or duplicate resource identities before showing totals', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'fines-identity-')), previous = process.env.APP_DATA_DIR;
  process.env.APP_DATA_DIR = directory;
  t.after(() => { if (previous === undefined) delete process.env.APP_DATA_DIR; else process.env.APP_DATA_DIR = previous; removeTemp(directory); });
  const actor = actorFor({ sub: 'fine-report-identity' }), plate = assetsFor(actor.accountId).plate;
  const fine = { fineId: 'fine-1', plateNumber: plate, originalAmount: 15, payableAmount: 12, discountAmount: 3 };
  let fines: unknown[] = [];
  t.mock.method(ProviderClient.prototype, 'call', async () => ({ fines }));
  for (const path of ['/fines/check', '/fines']) {
    for (const malformed of [
      [{ ...fine, fineId: '' }], [{ ...fine, fineId: '   ' }], [{ ...fine, fineId: 1 }],
      [fine, { ...fine }], [fine, { ...fine, plateNumber: 'Dubai C-99999' }],
    ]) {
      fines = malformed;
      const result = await integratedRequest('service-wallet', actor, 'GET', path, {}, {}, () => ({ status: 404, data: {} }));
      assert.equal(result.status, 503);
      assert.equal(result.data.code, 'PROVIDER_UNAVAILABLE');
      assert.equal(result.data.fines, undefined);
    }
    fines = [fine, { ...fine, fineId: 'fine-2' }];
    const valid = await integratedRequest('service-wallet', actor, 'GET', path, {}, {}, () => ({ status: 404, data: {} }));
    assert.equal(valid.status, 200);
    assert.equal(valid.data.count, 2);
    assert.equal(valid.data.totalPayable, 24);
  }
});
