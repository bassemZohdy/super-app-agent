import test from 'node:test';
import assert from 'node:assert/strict';
import { pauseAllMandates } from '../agent-core/src/mandate-pause-all.ts';
import { validateRequest } from '../../packages/protocol-core/src/request-validation.ts';

// AUTO-15: owner pause-all pauses only the owner's approved rules, each at its current version under its own key,
// and reports every rule it could not pause. Retrying with the same request key pauses only what is still approved.
const owner = { sub: 'owner_1', username: 'owner_1', name: 'Owner', accountId: 'acct_1', requestId: 'req_pause_1' } as any;

test('AUTO-15: pause-all pauses each approved rule at its version and leaves the others alone', async () => {
  const calls: Array<{ path: string; body: any; key?: string }> = [];
  const call = async (_p: string, _a: unknown, method: string, path: string, body?: any, key?: string) => {
    if (method === 'GET') return { mandates: [
      { id: 'mandate_a', state: 'APPROVED', version: 2 },
      { id: 'mandate_b', state: 'REVOKED', version: 4 },
      { id: 'mandate_c', state: 'PAUSED', version: 1 },
      { id: 'mandate_d', state: 'APPROVED', version: 5 },
    ] };
    calls.push({ path, body, key });
    if (path.includes('mandate_d')) throw Object.assign(new Error('moved on'), { code: 'MANDATE_CHANGED' });
    return { ok: true };
  };
  const out = await pauseAllMandates(owner, call, 'stop-now');
  assert.deepEqual(out.paused, ['mandate_a']);
  assert.deepEqual(out.notPaused, [{ mandateId: 'mandate_d', code: 'MANDATE_CHANGED' }]);
  assert.equal(out.requestId, 'req_pause_1');
  assert.deepEqual(calls.map(c => c.path), ['/payment-mandates/mandate_a/pause', '/payment-mandates/mandate_d/pause']);
  assert.deepEqual(calls[0].body, { expectedVersion: 2 });
  assert.equal(calls[0].key, 'pause-all:stop-now:mandate_a', 'each pause has its own key derived from the request');
});

test('AUTO-15: pause-all with no approved rules changes nothing', async () => {
  let mutated = false;
  const call = async (_p: string, _a: unknown, method: string) => {
    if (method === 'GET') return { mandates: [{ id: 'mandate_b', state: 'REVOKED', version: 1 }] };
    mutated = true; return {};
  };
  assert.deepEqual(await pauseAllMandates(owner, call, 'k'), { success: true, requestId: 'req_pause_1', paused: [], notPaused: [] });
  assert.equal(mutated, false);
});

test('AUTO-15: the pause-all route takes only the account and a request key', () => {
  assert.equal(validateRequest('agent-core', 'POST', '/api/payments/mandates/pause-all', {}, { accountId: 'acct_1', requestKey: 'stop-now-001' }), undefined);
  assert.equal(validateRequest('agent-core', 'POST', '/api/payments/mandates/pause-all', {}, { accountId: 'acct_1', requestKey: 'stop-now-001', mandateId: 'x' })?.status, 400);
});
