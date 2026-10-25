import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { PermitStore, permitOperation, type ExecutionView } from '../delegation/src/permits.ts';
import { automationWorkerClient, brokerClient } from '../delegation/src/policy.ts';

// AUTO-14 step 2b (broker): a second credential for an execution exists only after the owner approved the card
// challenge its order raised. The consumed permit it replaces is closed, and a resumed permit is never resumed again.
const now = Date.parse('2026-10-25T12:00:00.000Z');
const worker = { sub: 'service-account-automation', azp: automationWorkerClient };
const owner = 'owner_1';
const exp = Math.floor((now + 90_000) / 1000);
const FIRST = 'a'.repeat(64), RESUMED = 'b'.repeat(64);

function view(over: Partial<ExecutionView> = {}): ExecutionView {
  return {
    executionId: 'autoexec_1', runId: 'autorn_1', accountId: 'acct_1', ownerSub: owner,
    mandate: { id: 'mandate_1', state: 'APPROVED', policyVersion: 1, skipNext: false },
    source: { id: 'pm_1', version: 1, current: true }, payable: { id: 'bill_1', revision: 'r1', amountMinor: 15000, current: true },
    boundDigest: 'c'.repeat(64), preparedAt: new Date(now).toISOString(), admissionExpiresAt: new Date(now + 3_600_000).toISOString(), expired: false,
    challenge: 'NONE', ...over,
  };
}
/** A first credential that the provider has already admitted, so the execution is dispatched and its permit consumed. */
function consumedFirst(store: PermitStore, v = view()) {
  const permit = store.issue(worker, v, now);
  store.bind(permit.id, FIRST, { sub: owner, azp: brokerClient, exp }, now);
  store.authorize(FIRST, owner, brokerClient, permitOperation(v), now);
  return permit;
}
const code = (fn: () => unknown) => { try { fn(); } catch (e) { return (e as { code?: string }).code; } return undefined; };

test('AUTO-14: a resume is refused while the owner has not answered, and refused for a rejected challenge', () => {
  const store = new PermitStore(new DatabaseSync(':memory:'));
  consumedFirst(store);
  assert.equal(code(() => store.issueResume(worker, view({ challenge: 'PENDING' }), now)), 'CHALLENGE_PENDING');
  assert.equal(code(() => store.issueResume(worker, view({ challenge: 'REJECTED' }), now)), 'CHALLENGE_REJECTED');
  assert.equal(code(() => store.issueResume(worker, view({ challenge: 'NONE' }), now)), 'PERMIT_NOT_RESUMABLE');
  assert.equal(store.forExecution('autoexec_1')!.state, 'CONSUMED', 'refusals change nothing');
});

test('AUTO-14: an approved challenge yields one resumed credential, and the replaced token stops being a session', () => {
  const store = new PermitStore(new DatabaseSync(':memory:'));
  const first = consumedFirst(store);
  const resumed = store.issueResume(worker, view({ challenge: 'APPROVED' }), now);
  assert.equal(resumed.resumeOf, first.id);
  assert.equal(store.get(first.id).state, 'CLOSED', 'the replaced permit is closed');
  store.bind(resumed.id, RESUMED, { sub: owner, azp: brokerClient, exp }, now);
  assert.equal(store.markResumed(resumed.id, now).state, 'CONSUMED');
  assert.equal(store.session(RESUMED, owner, brokerClient, now).executionId, 'autoexec_1', 'the resumed token is the execution session');
  assert.equal(code(() => store.session(FIRST, owner, brokerClient, now)), 'PERMIT_NOT_ACTIVE', 'the replaced token is no longer a session');
});

test('AUTO-14: a resumed permit is never resumed again, and the first credential is still never reissued', () => {
  const store = new PermitStore(new DatabaseSync(':memory:'));
  consumedFirst(store);
  const resumed = store.issueResume(worker, view({ challenge: 'APPROVED' }), now);
  store.bind(resumed.id, RESUMED, { sub: owner, azp: brokerClient, exp }, now);
  store.markResumed(resumed.id, now);
  assert.equal(code(() => store.issueResume(worker, view({ challenge: 'APPROVED' }), now)), 'PERMIT_NOT_RESUMABLE');
  assert.equal(code(() => store.issue(worker, view(), now)), 'PERMIT_ALREADY_ISSUED');
});

test('AUTO-14: a resume re-checks current authority and never changes the operation', () => {
  const paused = new PermitStore(new DatabaseSync(':memory:'));
  consumedFirst(paused);
  assert.equal(code(() => paused.issueResume(worker, view({ challenge: 'APPROVED', mandate: { id: 'mandate_1', state: 'PAUSED', policyVersion: 1, skipNext: false } }), now)), 'PERMIT_MANDATE_INACTIVE');

  const changed = new PermitStore(new DatabaseSync(':memory:'));
  consumedFirst(changed);
  assert.equal(code(() => changed.issueResume(worker, view({ challenge: 'APPROVED', payable: { id: 'bill_1', revision: 'r2', amountMinor: 15000, current: true } }), now)), 'PERMIT_OPERATION_MISMATCH');

  const late = new PermitStore(new DatabaseSync(':memory:'));
  consumedFirst(late);
  assert.equal(code(() => late.issueResume(worker, view({ challenge: 'APPROVED', admissionExpiresAt: new Date(now + 5_000).toISOString() }), now)), 'PERMIT_EXPIRED');
});

test('AUTO-14: only the automation workload can ask for a resumed credential, and only for an execution that has a consumed first one', () => {
  const store = new PermitStore(new DatabaseSync(':memory:'));
  assert.equal(code(() => store.issueResume(worker, view({ challenge: 'APPROVED' }), now)), 'PERMIT_NOT_RESUMABLE', 'no first credential exists yet');
  consumedFirst(store);
  assert.equal(code(() => store.issueResume({ sub: 'someone', azp: brokerClient }, view({ challenge: 'APPROVED' }), now)), 'PERMIT_WORKER_REQUIRED');
});
