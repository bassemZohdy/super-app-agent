import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { PermitStore, type ExecutionView } from '../delegation/src/permits.ts';
import { issueExecutionCredential, MintRefused, type AutomationDeps, type Worker } from '../delegation/src/automation.ts';
import { automationWorkerClient, brokerClient, tokenHash, DelegationError } from '../delegation/src/policy.ts';

const owner = 'linked-owner';
const runId = 'autorn_' + '1'.repeat(8) + '-' + '1'.repeat(4) + '-' + '1'.repeat(4) + '-' + '1'.repeat(4) + '-' + '1'.repeat(12);
const claims: Worker = { sub: 'svc-worker', azp: automationWorkerClient, scope: 'automation.execute', preferred_username: 'service-account-automation-worker' };
const view = (change: Partial<ExecutionView> = {}): ExecutionView => ({
  executionId: 'autoexec_0001', runId, accountId: 'acct_personal', ownerSub: owner,
  mandate: { id: 'm1', state: 'APPROVED', policyVersion: 1, skipNext: false }, source: { id: 'wallet', version: 1, current: true },
  payable: { id: 'bill_1', revision: 'r1', amountMinor: 15000, current: true },
  boundDigest: 'b'.repeat(64), preparedAt: new Date(Date.now() - 1000).toISOString(), admissionExpiresAt: new Date(Date.now() + 600_000).toISOString(), expired: false, ...change,
});
function deps(overrides: Partial<AutomationDeps> = {}) {
  const calls = { read: 0, mint: 0, eligible: 0 };
  const d: AutomationDeps = {
    permits: new PermitStore(new DatabaseSync(':memory:')),
    readView: async () => { calls.read++; return view(); },
    mint: async () => { calls.mint++; const token = `token-${calls.mint}`; return { accessToken: token, sub: owner, azp: brokerClient, exp: Math.floor(Date.now() / 1000) + 60, fingerprint: tokenHash(token) }; },
    eligible: async () => { calls.eligible++; },
    ...overrides,
  };
  return { d, calls };
}
const code = (expected: string) => (error: unknown) => error instanceof DelegationError && error.code === expected;
const ask = (d: AutomationDeps, who: Worker = claims, input: Record<string, unknown> = { runId, executionId: 'autoexec_0001' }) => issueExecutionCredential(d, who, 'Bearer worker', input);

test('AUTO-03 2b-ii: only the execute-scoped automation service account may ask, before any provider read', async () => {
  const { d, calls } = deps();
  for (const bad of [{ ...claims, azp: 'delegation-runner' }, { ...claims, scope: 'openid' }, { ...claims, preferred_username: 'alice' }, { ...claims, act: { sub: 'x' } }])
    await assert.rejects(ask(d, bad), code('AUTOMATION_WORKER_REQUIRED'));
  assert.equal(calls.read, 0);
  for (const input of [{}, { runId, executionId: '../x' }, { runId: 'other', executionId: 'autoexec_0001' }]) await assert.rejects(ask(d, claims, input), code('VALIDATION_ERROR'));
});

test('AUTO-03 2b-ii: issues one bound token for the operation derived from the provider view', async () => {
  const { d, calls } = deps();
  const out = await ask(d);
  assert.equal(out.accessToken, 'token-1');
  assert.equal(out.operation.amountMinor, 15000);
  assert.equal(d.permits.get(out.permitId).state, 'BOUND');
  assert.equal(JSON.stringify(d.permits.db.prepare('SELECT body FROM permits').all()).includes('token-1'), false, 'the raw token is never stored');
  // The execution already has its one credential: a second request cannot mint another.
  await assert.rejects(ask(d), code('PERMIT_ALREADY_ISSUED'));
  assert.equal(calls.mint, 1);
  d.permits.authorize(tokenHash('token-1'), owner, brokerClient, out.operation);
});

test('AUTO-03 2b-ii: a provider answering for another execution, or stale authority, yields no credential', async () => {
  const wrong = deps({ readView: async () => view({ executionId: 'autoexec_9999' }) });
  await assert.rejects(ask(wrong.d), code('PERMIT_VIEW_INVALID'));
  const stale = deps({ readView: async () => view({ mandate: { id: 'm1', state: 'REVOKED', policyVersion: 2, skipNext: false } }) });
  await assert.rejects(ask(stale.d), code('PERMIT_MANDATE_INACTIVE'));
  assert.equal(stale.calls.mint, 0);
});

test('AUTO-03 2b-ii: lost eligibility or a refused exchange frees the attempt; an unknown exchange does not mint twice', async () => {
  let allow = false;
  const gated = deps({ eligible: async () => { if (!allow) throw new DelegationError(403, 'ELIGIBILITY_DENIED', 'no'); } });
  await assert.rejects(ask(gated.d), code('ELIGIBILITY_DENIED'));
  assert.equal(gated.d.permits.forExecution('autoexec_0001')!.state, 'CLOSED');
  allow = true;
  assert.equal((await ask(gated.d)).attempt, 2);

  const refused = deps({ mint: async () => { throw new MintRefused('rejected'); } });
  await assert.rejects(ask(refused.d), code('AUTOMATION_EXCHANGE_FAILED'));
  assert.equal(refused.d.permits.forExecution('autoexec_0001')!.state, 'CLOSED');

  let first = true;
  const lost = deps({ mint: async () => { if (first) { first = false; throw new Error('socket closed'); } return { accessToken: 't2', sub: owner, azp: brokerClient, exp: Math.floor(Date.now() / 1000) + 60, fingerprint: tokenHash('t2') }; } });
  await assert.rejects(ask(lost.d), code('AUTOMATION_EXCHANGE_FAILED'));
  assert.equal(lost.d.permits.forExecution('autoexec_0001')!.state, 'ISSUED', 'an unknown exchange keeps the permit; replay can only bind one token');
  assert.equal((await ask(lost.d)).attempt, 1);
});

test('AUTO-03 2b-ii: a token for another owner or client is refused at binding', async () => {
  const bad = deps({ mint: async () => ({ accessToken: 'x', sub: 'someone-else', azp: brokerClient, exp: Math.floor(Date.now() / 1000) + 60, fingerprint: tokenHash('x') }) });
  await assert.rejects(ask(bad.d), code('PERMIT_BINDING_MISMATCH'));
  assert.equal(bad.d.permits.forExecution('autoexec_0001')!.state, 'ISSUED');
});
