import { removeTemp } from '../../test/support/temp-cleanup.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { integratedRequest } from '../../packages/backend-kit/src/application.ts';
import { ProviderClient, UpstreamError } from '../../packages/backend-kit/src/provider-client.ts';
import { actorFor, assetsFor } from '../../packages/backend-kit/src/context.ts';

test('integrated move-in stops and stays unconfirmed when a later effect fails or a response conflicts', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'movein-outcome-')), previous = process.env.APP_DATA_DIR;
  process.env.APP_DATA_DIR = dir;
  t.after(() => { if (previous === undefined) delete process.env.APP_DATA_DIR; else process.env.APP_DATA_DIR = previous; removeTemp(dir); });
  const actor = actorFor({ sub: 'movein-outcome-test' }), asset = assetsFor(actor.accountId);
  const body = { contractNumber: asset.contractNumber, expectedPremiseId: asset.premiseId };
  let scenario = '', calls: string[] = [];
  t.mock.method(ProviderClient.prototype, 'call', async (provider, _actor, _method, path) => {
    calls.push(provider);
    if (scenario === 'first-refusal' && provider === 'dld' || scenario === 'connection-refusal' && provider === 'dewa' || scenario === 'permit-refusal' && provider === 'rta')
      throw new UpstreamError(409, 'PREMISE_CHANGED', 'private provider details');
    if (provider === 'dld' && path === '/move-ins') return { ejariContract: scenario === 'wrong-contract' ? 'different' : body.contractNumber, unit: 'Unit' };
    if (provider === 'dewa' && path === '/connections') return { connection: { premiseId: scenario === 'wrong-premise' ? 'different' : body.expectedPremiseId, status: 'CONNECTED_ACTIVE', depositWaived: true } };
    if (provider === 'rta' && path === '/residential-permits') return { permit: { permitNumber: 'permit', status: scenario === 'wrong-status' ? 'PENDING' : 'ISSUED' } };
    throw new Error('unexpected provider');
  });
  for (const [name, expectedCalls] of [['first-refusal', ['dld']], ['wrong-contract', ['dld']], ['connection-refusal', ['dld', 'dewa']], ['wrong-premise', ['dld', 'dewa']], ['permit-refusal', ['dld', 'dewa', 'rta']], ['wrong-status', ['dld', 'dewa', 'rta']]] as const) {
    scenario = name; calls = [];
    const result = await integratedRequest('service-catalog', actor, 'POST', '/housing/move-in', {}, body, () => ({ status: 404, data: {} }));
    assert.deepEqual(calls, expectedCalls, name);
    if (name === 'first-refusal') assert.equal(result.status, 409);
    else { assert.equal(result.status, 503, name); assert.equal(result.data.code, 'PROVIDER_OUTCOME_UNKNOWN', name); }
    assert.ok(!JSON.stringify(result).includes('private provider details'));
  }
  scenario = 'valid'; calls = [];
  const success = await integratedRequest('service-catalog', actor, 'POST', '/housing/move-in', {}, body, () => ({ status: 404, data: {} }));
  assert.equal(success.status, 200);
  assert.deepEqual(calls, ['dld', 'dewa', 'rta']);
});
