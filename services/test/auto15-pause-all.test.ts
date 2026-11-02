import test from 'node:test';
import assert from 'node:assert/strict';
import { pauseAllMandates } from '../agent-core/src/mandate-pause-all.ts';
import { validateRequest } from '../../packages/protocol-core/src/request-validation.ts';
import { UpstreamError } from '../../packages/backend-kit/src/provider-client.ts';

// AUTO-15: owner pause-all pauses only the owner's approved rules, each at its current version under its own key,
// and reports every rule it could not pause. Retrying with the same request key pauses only what is still approved.
const owner = { sub: 'owner_1', username: 'owner_1', name: 'Owner', accountId: 'acct_1', requestId: 'req_pause_1' } as any;

test('AUTO-15: pause-all pauses each approved rule at its version and leaves the others alone', async () => {
  const calls: Array<{ path: string; body: any; key?: string }> = [];
  const call = async (_p: string, _a: unknown, method: string, path: string, body?: any, key?: string) => {
    if (method === 'GET') return { success: true, mandates: [
      { id: 'mandate_a', state: 'APPROVED', version: 2 },
      { id: 'mandate_b', state: 'REVOKED', version: 4 },
      { id: 'mandate_c', state: 'PAUSED', version: 1 },
      { id: 'mandate_d', state: 'APPROVED', version: 5 },
    ].map(m => ({ ...m, ownerSub: owner.sub, accountId: owner.accountId })) };
    calls.push({ path, body, key });
    if (path.includes('mandate_d')) throw new UpstreamError(409, 'MANDATE_CHANGED', 'moved on');
    return { success: true, mandate: { id: 'mandate_a', state: 'PAUSED', version: 3, ownerSub: owner.sub, accountId: owner.accountId } };
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
    if (method === 'GET') return { success: true, mandates: [{ id: 'mandate_b', state: 'REVOKED', version: 1, ownerSub: owner.sub, accountId: owner.accountId }] };
    mutated = true; return {};
  };
  assert.deepEqual(await pauseAllMandates(owner, call, 'k'), { success: true, requestId: 'req_pause_1', paused: [], notPaused: [] });
  assert.equal(mutated, false);
});

test('pause-all rejects malformed or cross-owner lists before any pause', async () => {
  const valid = { id: 'mandate_a', state: 'APPROVED', version: 1, ownerSub: owner.sub, accountId: owner.accountId };
  for (const listed of [null, {}, { success: true, mandates: 'bad' },
    { success: true, mandates: [valid, { ...valid, id: 'mandate_b', ownerSub: 'other' }] },
    { success: true, mandates: [valid, { ...valid, id: 'mandate_b', accountId: 'other' }] },
    { success: true, mandates: [valid, { ...valid, id: 'mandate_b', version: '2' }] },
    { success: true, mandates: [valid, valid] }, { success: true, error: 'private-marker', mandates: [valid] }]) {
    let mutations = 0;
    await assert.rejects(pauseAllMandates(owner, async (_p, _a, method) => { if (method === 'POST') mutations++; return listed; }, 'key'),
      (error: unknown) => error instanceof Error && !error.message.includes('private-marker'));
    assert.equal(mutations, 0);
  }
});

test('pause-all reports unverified success and private errors as unknown without exposing upstream text', async () => {
  const valid = { id: 'mandate_a', state: 'APPROVED', version: 1, ownerSub: owner.sub, accountId: owner.accountId };
  for (const result of [{ success: true, mandate: { ...valid, state: 'APPROVED', version: 2 } }, { success: true, mandate: { ...valid, id: 'other', state: 'PAUSED', version: 2 } }, { success: true, error: 'private-marker', mandate: { ...valid, state: 'PAUSED', version: 2 } }]) {
    const out = await pauseAllMandates(owner, async (_p, _a, method) => method === 'GET' ? { success: true, mandates: [valid] } : result, 'key');
    assert.deepEqual(out.paused, []); assert.deepEqual(out.notPaused, [{ mandateId: valid.id, code: 'PAUSE_UNCONFIRMED' }]);
  }
  const out = await pauseAllMandates(owner, async (_p, _a, method) => { if (method === 'GET') return { success: true, mandates: [valid] }; throw Object.assign(new Error('private-marker'), { code: 'private-marker' }); }, 'key');
  assert.deepEqual(out.notPaused, [{ mandateId: valid.id, code: 'PAUSE_UNCONFIRMED' }]);
});

test('pause-all continues with other rules after an unconfirmed pause', async () => {
  const a = { id: 'mandate_a', state: 'APPROVED', version: 1, ownerSub: owner.sub, accountId: owner.accountId };
  const b = { ...a, id: 'mandate_b' };
  const result = await pauseAllMandates(owner, async (_provider, _actor, method, path) => {
    if (method === 'GET') return { success: true, mandates: [a, b] };
    if (path.includes('mandate_a')) throw new Error('unreachable');
    return { success: true, mandate: { ...b, state: 'PAUSED', version: 2 } };
  }, 'key');
  assert.deepEqual(result.paused, ['mandate_b']);
  assert.deepEqual(result.notPaused, [{ mandateId: 'mandate_a', code: 'PAUSE_UNCONFIRMED' }]);
});

test('AUTO-15: the pause-all route takes only the account and a request key', () => {
  assert.equal(validateRequest('agent-core', 'POST', '/api/payments/mandates/pause-all', {}, { accountId: 'acct_1', requestKey: 'stop-now-001' }), undefined);
  assert.equal(validateRequest('agent-core', 'POST', '/api/payments/mandates/pause-all', {}, { accountId: 'acct_1', requestKey: 'stop-now-001', mandateId: 'x' })?.status, 400);
});
