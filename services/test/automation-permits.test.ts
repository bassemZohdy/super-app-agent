import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { PermitStore, permitOperation, PERMIT_TTL_MS, MAX_PERMIT_ATTEMPTS, type ExecutionView } from '../delegation/src/permits.ts';
import { brokerClient, automationWorkerClient, tokenHash, DelegationError } from '../delegation/src/policy.ts';

const worker = { sub: 'worker-service-account', azp: automationWorkerClient };
const owner = 'linked-owner';
const NOW = Date.parse('2026-10-25T10:00:00.000Z');
const view = (change: Partial<ExecutionView> = {}): ExecutionView => ({
  executionId: 'autoexec_0001', runId: 'autorn_run-1', accountId: 'acct_personal', ownerSub: owner,
  mandate: { id: 'mandate_1', state: 'APPROVED', policyVersion: 1, skipNext: false },
  source: { id: 'wallet', version: 1, current: true },
  biller: { id: 'billing_1', current: true },
  payable: { id: 'bill_1', revision: 'rev_1', amountMinor: 15000, current: true },
  boundDigest: 'a'.repeat(64), preparedAt: new Date(NOW - 1000).toISOString(), admissionExpiresAt: new Date(NOW + 600_000).toISOString(), expired: false,
  ...change,
});
const code = (expected: string) => (error: unknown) => error instanceof DelegationError && error.code === expected;
const exp = (ms: number) => Math.floor((NOW + ms) / 1000);
const fresh = () => new PermitStore(new DatabaseSync(':memory:'));

test('AUTO-03 2b: a permit is issued only from a fresh execution view, with a bounded lifetime', () => {
  const store = fresh();
  const permit = store.issue(worker, view(), NOW);
  assert.equal(permit.state, 'ISSUED');
  assert.equal(permit.owner, owner);
  assert.equal(permit.expiresAt, NOW + PERMIT_TTL_MS, 'the token window never outlives the permit window');
  const short = store.issue(worker, view({ executionId: 'autoexec_0002', admissionExpiresAt: new Date(NOW + 30_000).toISOString() }), NOW);
  assert.equal(short.expiresAt, NOW + 30_000, 'the admission window caps the permit');
  assert.throws(() => store.issue(worker, view({ executionId: 'autoexec_0003', admissionExpiresAt: new Date(NOW + 5_000).toISOString() }), NOW), code('PERMIT_EXPIRED'));
});

test('AUTO-03 2b: every stale authority fact and malformed view refuses the credential', () => {
  const cases: [string, Partial<ExecutionView>][] = [
    ['PERMIT_MANDATE_INACTIVE', { mandate: { id: 'mandate_1', state: 'PAUSED', policyVersion: 1, skipNext: false } }],
    ['PERMIT_MANDATE_INACTIVE', { mandate: { id: 'mandate_1', state: 'REVOKED', policyVersion: 1, skipNext: false } }],
    ['PERMIT_SKIP_PENDING', { mandate: { id: 'mandate_1', state: 'APPROVED', policyVersion: 1, skipNext: true } }],
    ['PERMIT_SOURCE_CHANGED', { source: { id: 'wallet', version: 1, current: false } }],
    ['PERMIT_BILLER_CHANGED', { biller: { id: 'billing_1', current: false } }],
    ['PERMIT_PAYABLE_CHANGED', { payable: { id: 'bill_1', revision: 'rev_1', amountMinor: 15000, current: false } }],
    ['PERMIT_EXPIRED', { expired: true }],
    ['PERMIT_EXPIRED', { admissionExpiresAt: new Date(NOW - 1).toISOString() }],
    ['PERMIT_VIEW_INVALID', { boundDigest: 'not-a-digest' }],
    ['PERMIT_VIEW_INVALID', { ownerSub: '' }],
    ['PERMIT_VIEW_INVALID', { executionId: 'bad id with spaces' }],
    ['PERMIT_VIEW_INVALID', { payable: { id: 'bill_1', revision: 'rev_1', amountMinor: 0, current: true } }],
    ['PERMIT_VIEW_INVALID', { payable: { id: 'bill_1', revision: 'rev_1', amountMinor: 1.5, current: true } }],
    ['PERMIT_VIEW_INVALID', { payable: { id: 'bill_1', revision: 'rev_1', amountMinor: Number.NaN, current: true } }],
    ['PERMIT_VIEW_INVALID', { admissionExpiresAt: 'tomorrow-ish' }],
  ];
  for (const [expected, change] of cases) {
    const store = fresh();
    assert.throws(() => store.issue(worker, view(change), NOW), code(expected), `${expected} for ${JSON.stringify(change).slice(0, 80)}`);
    assert.equal(store.forExecution('autoexec_0001'), undefined, 'a refused request leaves no permit behind');
  }
  const store = fresh();
  for (const bad of [{ sub: worker.sub, azp: 'delegation-runner' }, { sub: worker.sub, azp: 'superapp-shell' }, { sub: '', azp: automationWorkerClient }, undefined as never])
    assert.throws(() => store.issue(bad, view(), NOW), code('PERMIT_WORKER_REQUIRED'));
  assert.throws(() => store.issue(worker, undefined as never, NOW), code('PERMIT_VIEW_INVALID'));
});

test('AUTO-03 2b: replay returns the same unbound permit; a different execution fact never does', () => {
  const store = fresh();
  const first = store.issue(worker, view(), NOW);
  assert.equal(store.issue(worker, view(), NOW + 1000).id, first.id, 'replay before any token exists returns the same permit');
  assert.throws(() => store.issue({ ...worker, sub: 'another-service-account' }, view(), NOW + 1000), code('PERMIT_OPERATION_MISMATCH'));
  assert.throws(() => store.issue(worker, view({ payable: { id: 'bill_1', revision: 'rev_1', amountMinor: 20000, current: true } }), NOW + 1000), code('PERMIT_OPERATION_MISMATCH'));
  assert.throws(() => store.issue(worker, view({ boundDigest: 'b'.repeat(64) }), NOW + 1000), code('PERMIT_OPERATION_MISMATCH'));
  assert.equal(store.get(first.id).state, 'ISSUED', 'a mismatched request does not disturb the live permit');
});

test('AUTO-03 2b: an expired unbound permit is replaced, but attempts are bounded', () => {
  const store = fresh();
  let now = NOW;
  const ids = new Set<string>(); let last = '';
  for (let attempt = 1; attempt <= MAX_PERMIT_ATTEMPTS; attempt++) {
    const permit = store.issue(worker, view(), now);
    assert.equal(permit.attempt, attempt);
    ids.add(permit.id); last = permit.id;
    now += PERMIT_TTL_MS + 1000;
  }
  assert.equal(ids.size, MAX_PERMIT_ATTEMPTS);
  assert.throws(() => store.issue(worker, view(), now), code('PERMIT_ATTEMPTS_EXHAUSTED'));
  assert.throws(() => store.bind(last, tokenHash('late'), { sub: owner, azp: brokerClient, exp: exp(PERMIT_TTL_MS) }, now), code('PERMIT_EXPIRED'), 'the last permit expired unbound and cannot receive a token');
});

test('AUTO-03 2b: binding requires the owner, the broker client and a token inside the permit window', () => {
  const fingerprint = tokenHash('controlled-automation-token');
  const bad: [string, { sub: string; azp: string; exp: number }, string?][] = [
    ['wrong subject', { sub: 'someone-else', azp: brokerClient, exp: exp(60_000) }],
    ['wrong client', { sub: owner, azp: 'delegation-runner', exp: exp(60_000) }],
    ['already expired', { sub: owner, azp: brokerClient, exp: exp(-1000) }],
    ['outlives the permit', { sub: owner, azp: brokerClient, exp: exp(PERMIT_TTL_MS + 5000) }],
    ['not an integer', { sub: owner, azp: brokerClient, exp: 1.5 }],
    ['bad fingerprint', { sub: owner, azp: brokerClient, exp: exp(60_000) }, 'not-hex'],
  ];
  for (const [label, token, fp] of bad) {
    const store = fresh(); const permit = store.issue(worker, view(), NOW);
    assert.throws(() => store.bind(permit.id, fp ?? fingerprint, token, NOW), code('PERMIT_BINDING_MISMATCH'), label);
    assert.equal(store.get(permit.id).state, 'ISSUED', `${label}: a refused bind changes nothing`);
  }
  const store = fresh(); const permit = store.issue(worker, view(), NOW);
  assert.throws(() => store.bind(permit.id, fingerprint, { sub: owner, azp: brokerClient, exp: exp(60_000) }, permit.expiresAt + 1), code('PERMIT_EXPIRED'));
  const bound = store.bind(permit.id, fingerprint, { sub: owner, azp: brokerClient, exp: exp(60_000) }, NOW);
  assert.equal(bound.state, 'BOUND');
  assert.throws(() => store.bind(permit.id, tokenHash('second'), { sub: owner, azp: brokerClient, exp: exp(60_000) }, NOW), code('PERMIT_ALREADY_ISSUED'), 'a permit receives one token');
  const other = store.issue(worker, view({ executionId: 'autoexec_0009' }), NOW);
  assert.throws(() => store.bind(other.id, fingerprint, { sub: owner, azp: brokerClient, exp: exp(60_000) }, NOW), code('PERMIT_BINDING_MISMATCH'), 'one token cannot bind two permits');
});

test('AUTO-03 2b: the bound token is consumed once, for exactly the issued operation', () => {
  const store = fresh(); const v = view();
  const permit = store.issue(worker, v, NOW); const fingerprint = tokenHash('controlled-automation-token');
  const operation = permitOperation(v);
  assert.throws(() => store.authorize(fingerprint, owner, brokerClient, operation, NOW), code('TOKEN_NOT_BOUND'), 'an unbound token is refused');
  store.bind(permit.id, fingerprint, { sub: owner, azp: brokerClient, exp: exp(60_000) }, NOW);
  const variants: [string, Parameters<PermitStore['authorize']>][] = [
    ['another subject', [fingerprint, 'someone-else', brokerClient, operation, NOW]],
    ['another client', [fingerprint, owner, 'delegation-runner', operation, NOW]],
    ['another amount', [fingerprint, owner, brokerClient, { ...operation, amountMinor: operation.amountMinor + 1 }, NOW]],
    ['another payable', [fingerprint, owner, brokerClient, { ...operation, payableId: 'bill_2' }, NOW]],
    ['another payable revision', [fingerprint, owner, brokerClient, { ...operation, payableRevision: 'rev_2' }, NOW]],
    ['another execution', [fingerprint, owner, brokerClient, { ...operation, executionId: 'autoexec_other' }, NOW]],
    ['another account', [fingerprint, owner, brokerClient, { ...operation, accountId: 'acct_household' }, NOW]],
    ['another source version', [fingerprint, owner, brokerClient, { ...operation, sourceVersion: 2 }, NOW]],
    ['another bound digest', [fingerprint, owner, brokerClient, { ...operation, boundDigest: 'c'.repeat(64) }, NOW]],
    ['after the token expired', [fingerprint, owner, brokerClient, operation, NOW + 61_000]],
  ];
  for (const [label, args] of variants) assert.throws(() => store.authorize(...args), (e: unknown) => e instanceof DelegationError, label);
  assert.equal(store.get(permit.id).state, 'BOUND', 'refused attempts consume nothing');
  assert.equal(store.authorize(fingerprint, owner, brokerClient, operation, NOW).state, 'CONSUMED');
  assert.throws(() => store.authorize(fingerprint, owner, brokerClient, operation, NOW), code('PERMIT_ALREADY_CONSUMED'), 'a second admission is refused');
});

test('AUTO-03 2b: once a token exists the execution never gets a second credential, and uncertainty is held', () => {
  const store = fresh(); const v = view();
  const permit = store.issue(worker, v, NOW); const fingerprint = tokenHash('controlled-automation-token');
  store.bind(permit.id, fingerprint, { sub: owner, azp: brokerClient, exp: exp(60_000) }, NOW);
  assert.throws(() => store.issue(worker, v, NOW + 120_000), code('PERMIT_ALREADY_ISSUED'), 'a bound permit blocks a replacement even after it expired');
  assert.throws(() => store.close(permit.id, 'cleanup', NOW), code('PERMIT_STATE_CHANGED'), 'a permit with a token cannot be quietly closed');
  assert.throws(() => store.settle(permit.id, 'COMPLETED', NOW), code('PERMIT_STATE_CHANGED'), 'an unconsumed permit has no outcome');
  store.authorize(fingerprint, owner, brokerClient, permitOperation(v), NOW);
  assert.equal(store.settle(permit.id, 'UNKNOWN', NOW).state, 'UNKNOWN');
  assert.equal(store.settle(permit.id, 'UNKNOWN', NOW).state, 'UNKNOWN', 'recording uncertainty twice is idempotent');
  assert.throws(() => store.issue(worker, v, NOW + 1000), code('PERMIT_ALREADY_ISSUED'), 'an uncertain outcome holds the execution');
  assert.equal(store.settle(permit.id, 'COMPLETED', NOW).state, 'COMPLETED', 'reconciliation can resolve it');
  assert.throws(() => store.settle(permit.id, 'FAILED', NOW), code('PERMIT_STATE_CHANGED'), 'a completed execution cannot later fail');
  assert.throws(() => store.issue(worker, v, NOW + 1000), code('PERMIT_ALREADY_ISSUED'));

  const failed = store.issue(worker, view({ executionId: 'autoexec_0002' }), NOW); const fp2 = tokenHash('second-token');
  store.bind(failed.id, fp2, { sub: owner, azp: brokerClient, exp: exp(60_000) }, NOW);
  store.authorize(fp2, owner, brokerClient, permitOperation(view({ executionId: 'autoexec_0002' })), NOW);
  assert.equal(store.settle(failed.id, 'FAILED', NOW).state, 'FAILED');
  assert.throws(() => store.issue(worker, view({ executionId: 'autoexec_0002' }), NOW + 1000), code('PERMIT_ALREADY_ISSUED'), 'a definitive failure needs a new preparation, not a new credential');
});

test('AUTO-03 2b: an unbound permit can be closed after a definitive exchange failure and then replaced', () => {
  const store = fresh();
  const first = store.issue(worker, view(), NOW);
  assert.equal(store.close(first.id, 'keycloak rejected the exchange', NOW).state, 'CLOSED');
  const second = store.issue(worker, view(), NOW + 1000);
  assert.notEqual(second.id, first.id);
  assert.equal(second.attempt, 2);
  assert.throws(() => store.bind(first.id, tokenHash('late'), { sub: owner, azp: brokerClient, exp: exp(60_000) }, NOW), code('PERMIT_ALREADY_ISSUED'), 'a closed permit cannot receive a token');
});

test('AUTO-03 2b: two connections issue one permit, state survives restart and the audit is immutable', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cityside-permits-')), path = join(dir, 'grants.sqlite');
  let a = new PermitStore(new DatabaseSync(path)); const b = new PermitStore(new DatabaseSync(path));
  try {
    const first = a.issue(worker, view(), NOW);
    assert.equal(b.issue(worker, view(), NOW).id, first.id, 'a parallel connection sees the same permit');
    const fingerprint = tokenHash('controlled-automation-token');
    b.bind(first.id, fingerprint, { sub: owner, azp: brokerClient, exp: exp(60_000) }, NOW);
    assert.throws(() => a.bind(first.id, tokenHash('racing'), { sub: owner, azp: brokerClient, exp: exp(60_000) }, NOW), code('PERMIT_ALREADY_ISSUED'));
    a.db.close(); a = new PermitStore(new DatabaseSync(path));
    assert.equal(a.get(first.id).state, 'BOUND', 'bound state persists across restart');
    assert.equal(a.authorize(fingerprint, owner, brokerClient, permitOperation(view()), NOW).state, 'CONSUMED');
    assert.throws(() => b.authorize(fingerprint, owner, brokerClient, permitOperation(view()), NOW), code('PERMIT_ALREADY_CONSUMED'), 'the other connection cannot consume it again');
    const audit = a.db.prepare('SELECT event,body FROM permit_audit ORDER BY seq').all() as { event: string; body: string }[];
    assert.deepEqual(audit.map(row => row.event), ['permit.issued', 'permit.bound', 'permit.consumed']);
    assert.ok(audit.every(row => !/Bearer|access_token|eyJ/.test(row.body)), 'no token material reaches the audit');
    assert.throws(() => a.db.exec('UPDATE permit_audit SET event=\'x\''), /immutable/);
    assert.throws(() => a.db.exec('DELETE FROM permit_audit'), /immutable/);
  } finally { a.db.close(); b.db.close(); rmSync(dir, { recursive: true, force: true }); }
});

test('AUTO-03 3b: only an admitted, unexpired token keeps a session, and it names its one operation', () => {
  const store = fresh();
  const permit = store.issue(worker, view(), NOW);
  const token = { sub: owner, azp: brokerClient, exp: exp(60_000) };
  const fingerprint = tokenHash('session-token');
  store.bind(permit.id, fingerprint, token, NOW);
  assert.throws(() => store.session(fingerprint, owner, brokerClient, NOW), code('PERMIT_NOT_ACTIVE'), 'a bound but unconsumed token has no session');
  store.authorize(fingerprint, owner, brokerClient, permitOperation(view()), NOW);
  const session = store.session(fingerprint, owner, brokerClient, NOW);
  assert.equal(session.operation!.payableId, 'bill_1');
  assert.equal(session.operation!.executionId, 'autoexec_0001');
  assert.throws(() => store.session(fingerprint, 'someone-else', brokerClient, NOW), code('PERMIT_EXPIRED'));
  assert.throws(() => store.session(fingerprint, owner, 'delegation-runner', NOW), code('PERMIT_EXPIRED'));
  assert.throws(() => store.session(fingerprint, owner, brokerClient, NOW + 61_000), code('PERMIT_EXPIRED'));
  assert.throws(() => store.session(tokenHash('unknown'), owner, brokerClient, NOW), code('TOKEN_NOT_BOUND'));
});
