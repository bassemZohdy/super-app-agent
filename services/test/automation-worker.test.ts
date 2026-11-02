import { removeTemp } from '../../test/support/temp-cleanup.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { JobStore, StaleWorkerError, jobIdentity } from '../automation-worker/src/jobs.ts';
import { AutomationWorker, type ExecutionGateway, type GatewayFailure, type PrepareResult, type ExecutedOrder } from '../automation-worker/src/worker.ts';
import { createWorkerFromEnv } from '../automation-worker/src/index.ts';

const rule = { mandateId: 'mandate_1', policyVersion: 1, occurrenceKey: 'occ_2026_11', target: 'dewa:home' };
const fail = (status: number | undefined, code: string) => Object.assign(new Error(code), { status, code }) as GatewayFailure;
const SECRET = 'secret-bearer-do-not-store';
const cleanup = (dir: string) => { try { removeTemp(dir); } catch { /* Windows may briefly hold the directory */ } };

function gateway(overrides: Partial<ExecutionGateway> = {}) {
  const calls = { prepare: 0, credential: 0, execute: 0, requestKeys: [] as string[], tokens: [] as string[] };
  const g: ExecutionGateway = {
    prepare: async (input): Promise<PrepareResult> => { calls.prepare++; calls.requestKeys.push(input.requestKey); return { id: 'autoexec_1', runId: 'autorn_1', orderId: 'order_1', amountMinor: 10000 }; },
    credential: async () => { calls.credential++; return { accessToken: SECRET, expiresAt: Date.now() + 90_000 }; },
    execute: async (_run, _exec, token): Promise<ExecutedOrder> => { calls.execute++; calls.tokens.push(token); return { id: 'order_1', state: 'SETTLED', fundsCaptured: true, receipt: { amountMinor: 10000, currency: 'AED', receiptNumber: 'receipt_1' } }; },
    ...overrides,
  };
  return { g, calls };
}
const worker = (store: JobStore, g: ExecutionGateway, workerId = 'worker-a', clock = () => Date.now()) =>
  new AutomationWorker(store, g, { workerId, clock, sleep: async () => {}, retryDelayMs: 1, leaseMs: 30_000 });

test('AUTO-05: a job is one rule version, occurrence and target, however often it is enqueued', () => {
  const store = new JobStore(':memory:');
  const a = store.enqueue(rule), b = store.enqueue(rule);
  assert.equal(a.id, b.id);
  assert.equal(store.list().length, 1);
  assert.equal(a.id, jobIdentity(rule).id);
  assert.notEqual(store.enqueue({ ...rule, policyVersion: 2 }).id, a.id, 'a revised rule is a different job');
  assert.notEqual(store.enqueue({ ...rule, occurrenceKey: 'occ_2026_12' }).id, a.id);
  assert.notEqual(store.enqueue({ ...rule, target: 'dewa:office' }).id, a.id);
  assert.throws(() => store.enqueue({ ...rule, occurrenceKey: '../x' }), (e: any) => e.code === 'JOB_INPUT_INVALID');
  assert.throws(() => store.enqueue({ ...rule, policyVersion: 0 }), (e: any) => e.code === 'JOB_INPUT_INVALID');
});

test('AUTO-05: a job settles once through prepare, credential and execute, with one outbox event per outcome', async () => {
  const store = new JobStore(':memory:'), { g, calls } = gateway();
  const job = store.enqueue(rule);
  const done = await worker(store, g).runOnce();
  assert.equal(done!.state, 'SETTLED');
  assert.deepEqual([calls.prepare, calls.credential, calls.execute], [1, 1, 1]);
  assert.equal(calls.requestKeys[0], jobIdentity(rule).requestKey, 'the preparation identity is derived from the job, not invented per attempt');
  assert.deepEqual(store.outbox(job.id).map(e => e.kind), ['PREPARED', 'SETTLED']);
  assert.deepEqual(store.attempts(job.id).map(a => a.step), ['prepare', 'credential', 'execute']);
  assert.equal(await worker(store, g).runOnce(), undefined, 'a settled job is never claimed again');
  assert.equal(calls.execute, 1);
});

test('the worker records its run before dispatching a preparation and holds the original run on loss', async () => {
  const runId = 'autorn_00000000-0000-4000-8000-000000000000', store = new JobStore(':memory:'), job = store.enqueue(rule);
  const { g, calls } = gateway({ runId, prepare: async () => { assert.equal(store.get(job.id)?.runId, runId); throw fail(503, 'LOST'); } });
  try {
    const done = await new AutomationWorker(store, g, { workerId: 'worker', maxAttempts: 1, sleep: async () => {} }).runOnce();
    assert.equal(done?.state, 'HELD'); assert.equal(done?.runId, runId); assert.equal(done?.reason, 'PREPARATION_UNKNOWN');
    assert.equal(calls.credential + calls.execute, 0);
  } finally { store.close(); }
});

test('a different run or an unbound legacy in-flight preparation cannot be retried or credentialed', async () => {
  const original = 'autorn_00000000-0000-4000-8000-000000000000', other = 'autorn_11111111-1111-4111-8111-111111111111', t0 = 1_000_000;
  for (const mode of ['preparing', 'prepared', 'legacy'] as const) {
    const store = new JobStore(':memory:'); store.enqueue(rule);
    const claim = store.claim('old-worker', 1000, t0)!;
    store.transition(claim, 'PREPARING', mode === 'legacy' ? {} : { runId: original }, undefined, t0);
    if (mode === 'legacy') store.begin(claim, 'prepare', t0);
    if (mode === 'prepared') store.transition(claim, 'PREPARED', { runId: original, executionId: 'autoexec_1', orderId: 'order_1', amountMinor: 10000 }, undefined, t0);
    const { g, calls } = gateway({ runId: other });
    try {
      const done = await worker(store, g, 'new-worker', () => t0 + 2000).runOnce();
      assert.equal(done?.state, 'HELD'); assert.equal(done?.reason, 'PREPARATION_UNKNOWN');
      assert.equal(done?.runId, mode === 'legacy' ? undefined : original);
      assert.deepEqual([calls.prepare, calls.credential, calls.execute], [0, 0, 0]);
    } finally { store.close(); }
  }
});

test('AUTO-05: mismatched or contradictory order results remain held under the original execution', async () => {
  const invalid: ExecutedOrder[] = [
    { id: 'order_other', state: 'SETTLED', fundsCaptured: true },
    { id: 'order_1', state: 'SETTLED', fundsCaptured: false },
    { id: 'order_1', state: 'SETTLED', fundsCaptured: true, failureCode: 'CARD_DECLINED' },
    { id: 'order_1', state: 'REQUIRES_ACTION', fundsCaptured: true },
    { id: 'order_1', state: 'FAILED', fundsCaptured: undefined as unknown as boolean },
    { id: 'order_1', state: 'UNKNOWN_PROVIDER_STATE', fundsCaptured: false },
  ];
  for (const order of invalid) {
    const store = new JobStore(':memory:'), { g, calls } = gateway({ execute: async () => { calls.execute++; return order; } });
    try {
      const job = store.enqueue(rule);
      const done = await new AutomationWorker(store, g, { workerId: 'worker-a', stepRetries: 1, sleep: async () => {} }).runOnce();
      assert.equal(done?.state, 'HELD'); assert.equal(done?.reason, 'OUTCOME_UNKNOWN');
      assert.equal(calls.execute, 1);
      assert.ok(!store.outbox(job.id).some(event => ['SETTLED', 'FAILED', 'REQUIRES_ACTION'].includes(event.kind)));
      assert.equal((await worker(store, g).runOnce()), undefined);
    } finally { store.close(); }
  }
});

test('AUTO-05: two workers never hold one job; a stale worker is fenced out after its lease expires', () => {
  const store = new JobStore(':memory:');
  store.enqueue(rule);
  const t0 = 1_000_000;
  const first = store.claim('worker-a', 30_000, t0)!;
  assert.equal(first.fence, 1);
  assert.equal(store.claim('worker-b', 30_000, t0 + 1000), undefined, 'a live lease cannot be taken');
  const second = store.claim('worker-b', 30_000, t0 + 31_000)!;
  assert.equal(second.fence, 2, 'redelivery after expiry rises the fence');
  assert.throws(() => store.begin(first, 'prepare', t0 + 32_000), StaleWorkerError);
  assert.throws(() => store.transition(first, 'PREPARED', {}, undefined, t0 + 32_000), StaleWorkerError);
  assert.throws(() => store.renew(first, 30_000, t0 + 32_000), StaleWorkerError);
  store.transition(second, 'PREPARING', {}, undefined, t0 + 32_000);
  assert.equal(store.get(first.job.id)!.leaseOwner, 'worker-b');
  // A holder whose lease lapsed without anyone reclaiming is also fenced: it must renew in time.
  assert.throws(() => store.begin(second, 'prepare', t0 + 70_000), StaleWorkerError);
});

test('AUTO-05: two workers racing over the same file database run the job once', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'cityside-jobs-')), path = join(dir, 'jobs.sqlite');
  const a = new JobStore(path), b = new JobStore(path);
  try {
    a.enqueue(rule);
    const { g, calls } = gateway();
    const results = await Promise.all([worker(a, g, 'worker-a').runOnce(), worker(b, g, 'worker-b').runOnce()]);
    assert.equal(results.filter(Boolean).length, 1, 'only one worker obtained the job');
    assert.deepEqual([calls.prepare, calls.credential, calls.execute], [1, 1, 1]);
    assert.equal(b.get(jobIdentity(rule).id)!.state, 'SETTLED');
  } finally { a.close(); b.close(); cleanup(dir); }
});

test('AUTO-05: a skip is final and requests no credential', async () => {
  const store = new JobStore(':memory:'), { g, calls } = gateway({ prepare: async () => ({ skipped: true, reason: 'NO_DUE_INVOICE' }) });
  const job = store.enqueue(rule);
  const done = await worker(store, g).runOnce();
  assert.equal(done!.state, 'SKIPPED');
  assert.equal(done!.reason, 'NO_DUE_INVOICE');
  assert.equal(calls.credential + calls.execute, 0);
  assert.deepEqual(store.outbox(job.id).map(e => e.kind), ['SKIPPED']);
});

test('AUTO-05: a restart after the credential was requested holds the job and never asks again', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'cityside-jobs-')), path = join(dir, 'jobs.sqlite');
  const first = new JobStore(path);
  try {
    first.enqueue(rule);
    const t0 = 5_000_000, claim = first.claim('worker-a', 30_000, t0)!;
    first.transition(claim, 'PREPARING', {}, undefined, t0);
    first.transition(claim, 'PREPARED', { runId: 'autorn_1', executionId: 'autoexec_1', orderId: 'order_1' }, undefined, t0);
    first.transition(claim, 'CREDENTIALING', {}, undefined, t0); // the process dies here, mid-request
    first.close();
    const reopened = new JobStore(path), { g, calls } = gateway();
    const done = await worker(reopened, g, 'worker-b', () => t0 + 60_000).runOnce();
    assert.equal(done!.state, 'HELD');
    assert.equal(done!.reason, 'CREDENTIAL_LOST_AFTER_RESTART');
    assert.deepEqual([calls.prepare, calls.credential, calls.execute], [0, 0, 0], 'no step is repeated after a restart');
    assert.deepEqual(reopened.outbox(done!.id).map(e => e.kind), ['HELD']);
    assert.equal(await worker(reopened, g, 'worker-c', () => t0 + 120_000).runOnce(), undefined, 'held jobs wait for reconciliation, not another worker');
    reopened.close();
  } finally { cleanup(dir); }
});

test('AUTO-05: a restart after the preparation was stored resumes at the credential without preparing again', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'cityside-prepared-jobs-')), path = join(dir, 'jobs.sqlite');
  const store = new JobStore(path), t0 = 9_000_000;
  try {
    store.enqueue(rule);
    const claim = store.claim('worker-a', 30_000, t0)!;
    store.transition(claim, 'PREPARING', {}, undefined, t0);
    store.transition(claim, 'PREPARED', { runId: 'autorn_1', executionId: 'autoexec_1', orderId: 'order_1', amountMinor: 10000 }, undefined, t0);
    store.close();
    const reopened = new JobStore(path), { g, calls } = gateway();
    try {
      const done = await worker(reopened, g, 'worker-b', () => t0 + 60_000).runOnce();
      assert.equal(done!.state, 'SETTLED'); assert.equal(done!.amountMinor, 10000);
      assert.deepEqual([calls.prepare, calls.credential, calls.execute], [0, 1, 1]);
    } finally { reopened.close(); }
  } finally { cleanup(dir); }
});

test('older prepared jobs without a stored amount are held without requesting a credential', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'cityside-legacy-jobs-')), path = join(dir, 'jobs.sqlite');
  const first = new JobStore(path), t0 = 9_000_000;
  try {
    const job = first.enqueue(rule), claim = first.claim('worker-a', 30_000, t0)!;
    first.transition(claim, 'PREPARING', {}, undefined, t0);
    first.transition(claim, 'PREPARED', { runId: 'autorn_1', executionId: 'autoexec_1', orderId: 'order_1' }, undefined, t0);
    first.db.exec('ALTER TABLE jobs DROP COLUMN amount_minor');
    first.close();
    const reopened = new JobStore(path), { g, calls } = gateway();
    try {
      const done = await worker(reopened, g, 'worker-b', () => t0 + 60_000).runOnce();
      assert.equal(done?.state, 'HELD'); assert.equal(done?.reason, 'PREPARATION_UNKNOWN');
      assert.deepEqual([calls.prepare, calls.credential, calls.execute], [0, 0, 0]);
      assert.deepEqual(reopened.outbox(job.id).map(event => event.kind), ['HELD']);
    } finally { reopened.close(); }
  } finally { cleanup(dir); }
});

test('AUTO-05: a lost execute response retries only the same credential, then holds as unknown', async () => {
  const store = new JobStore(':memory:');
  const { g, calls } = gateway({ execute: async (_r, _e, token) => { calls.execute++; calls.tokens.push(token); throw fail(undefined, 'NETWORK'); } });
  const job = store.enqueue(rule);
  const done = await worker(store, g).runOnce();
  assert.equal(done!.state, 'HELD');
  assert.equal(done!.reason, 'OUTCOME_UNKNOWN');
  assert.equal(calls.execute, 3);
  assert.equal(calls.credential, 1, 'no fresh credential was requested');
  assert.deepEqual([...new Set(calls.tokens)], [SECRET]);
  assert.equal(calls.prepare, 1);
  assert.ok(store.attempts(job.id).filter(a => a.step === 'execute').every(a => a.outcome === 'error:NETWORK'));
  // A retry that succeeds uses the very same token.
  const second = new JobStore(':memory:'), flaky = gateway();
  let lost = true;
  const wrapped: ExecutionGateway = { ...flaky.g, execute: async (...args) => { if (lost) { lost = false; throw fail(503, 'UNAVAILABLE'); } return flaky.g.execute(...args); } };
  second.enqueue(rule);
  assert.equal((await worker(second, wrapped).runOnce())!.state, 'SETTLED');
  assert.equal(flaky.calls.credential, 1);
  assert.deepEqual([...new Set(flaky.calls.tokens)], [SECRET]);
});

test('AUTO-05: refusals, rejections and captured-but-unsettled orders land in the right final state', async () => {
  const outcomes: [string, Partial<ExecutionGateway>, string, string][] = [
    ['definitive credential refusal', { credential: async () => { throw fail(403, 'PERMIT_MANDATE_INACTIVE'); } }, 'FAILED', 'PERMIT_MANDATE_INACTIVE'],
    ['credential already issued', { credential: async () => { throw fail(403, 'PERMIT_ALREADY_ISSUED'); } }, 'HELD', 'CREDENTIAL_ALREADY_ISSUED'],
    ['credential outage', { credential: async () => { throw fail(503, 'DOWN'); } }, 'HELD', 'CREDENTIAL_UNKNOWN'],
    ['admission rejected', { execute: async () => { throw fail(409, 'AUTOMATION_ADMISSION_REJECTED'); } }, 'FAILED', 'AUTOMATION_ADMISSION_REJECTED'],
    ['order failed before funds', { execute: async () => ({ id: 'order_1', state: 'FAILED', fundsCaptured: false, failureCode: 'CARD_DECLINED' }) }, 'FAILED', 'CARD_DECLINED'],
    ['funds captured, outcome unknown', { execute: async () => ({ id: 'order_1', state: 'RECONCILIATION_REQUIRED', fundsCaptured: true }) }, 'HELD', 'OUTCOME_UNKNOWN'],
    ['card challenge', { execute: async () => ({ id: 'order_1', state: 'REQUIRES_ACTION', fundsCaptured: false }) }, 'HELD', 'REQUIRES_ACTION'],
    ['preparation rejected', { prepare: async () => { throw fail(409, 'AUTOMATION_UNSUPPORTED'); } }, 'FAILED', 'AUTOMATION_UNSUPPORTED'],
  ];
  for (const [name, patch, state, reason] of outcomes) {
    const store = new JobStore(':memory:'), { g, calls } = gateway(patch);
    store.enqueue(rule);
    const done = await worker(store, g).runOnce();
    assert.equal(done!.state, state, name);
    assert.equal(done!.reason, reason, name);
    assert.equal(await worker(store, g).runOnce(), undefined, `${name}: not retried by another claim`);
    assert.ok(calls.credential <= 3, name);
  }
});

test('AUTO-05: preparation outages back off under the same identity and remain held when unresolved', async () => {
  const store = new JobStore(':memory:'), keys: string[] = [];
  const { g, calls } = gateway({ prepare: async input => { keys.push(input.requestKey); throw fail(503, 'DOWN'); } });
  const job = store.enqueue(rule);
  let now = 1_000;
  const w = new AutomationWorker(store, g, { workerId: 'w', clock: () => now, sleep: async () => {}, retryDelayMs: 100, leaseMs: 30_000, maxAttempts: 3 });
  for (let i = 0; i < 3; i++) { await w.runOnce(); now += 10_000; }
  const done = store.get(job.id)!;
  assert.equal(done.state, 'HELD');
  assert.equal(done.reason, 'PREPARATION_UNKNOWN');
  assert.deepEqual(store.outbox(job.id).map(event => event.kind), ['HELD']);
  assert.deepEqual([...new Set(keys)], [jobIdentity(rule).requestKey], 'every retry reused the original identity');
  assert.equal(calls.credential + calls.execute, 0);
  assert.equal(await w.runOnce(), undefined);
});

test('a later preparation refusal cannot erase an earlier lost or interrupted response', async () => {
  for (const interrupted of [false, true]) {
    const store = new JobStore(':memory:'), job = store.enqueue(rule), t0 = 1_000_000;
    const claim = store.claim('old-worker', 1000, t0)!;
    store.transition(claim, 'PREPARING', {}, undefined, t0);
    store.begin(claim, 'prepare', t0);
    if (!interrupted) store.outcome(claim, 'unavailable');
    const { g, calls } = gateway({ prepare: async () => { throw fail(403, 'AUTOMATION_WORKER_REQUIRED'); } });
    try {
      const done = await worker(store, g, 'new-worker', () => t0 + 2000).runOnce();
      assert.equal(done?.state, 'HELD'); assert.equal(done?.reason, 'PREPARATION_UNKNOWN');
      assert.deepEqual(store.outbox(job.id).map(event => event.kind), ['HELD']);
      assert.equal(calls.credential + calls.execute, 0);
    } finally { store.close(); }
  }
});

test('AUTO-05: no credential reaches the database, the outbox or the attempt log, and history is append-only', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'cityside-jobs-')), path = join(dir, 'jobs.sqlite');
  const store = new JobStore(path), { g } = gateway();
  try {
    const job = store.enqueue(rule);
    await worker(store, g).runOnce();
    store.db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
    const files = readdirSync(dir).filter(f => f.startsWith('jobs.sqlite')).map(f => readFileSync(join(dir, f)).toString('latin1')).join('');
    assert.equal(files.includes(SECRET), false);
    assert.throws(() => store.db.prepare('DELETE FROM job_attempts').run(), /append-only/);
    assert.throws(() => store.db.prepare("UPDATE job_attempts SET step='x'").run(), /append-only/);
    assert.equal(store.get(job.id)!.state, 'SETTLED');
  } finally { store.close(); cleanup(dir); }
});

test('AUTO-08: failures only the owner can fix are recorded as requiring action and never retried with another source', async () => {
  for (const code of ['CARD_DECLINED', 'CARD_LIMIT_EXCEEDED', 'INSUFFICIENT_AVAILABLE_FUNDS']) {
    const store = new JobStore(':memory:'), { g, calls } = gateway({ execute: async () => ({ id: 'order_1', state: 'FAILED', fundsCaptured: false, failureCode: code }) });
    const job = store.enqueue(rule);
    const done = await worker(store, g).runOnce();
    assert.equal(done!.state, 'FAILED', code);
    assert.equal(done!.reason, code);
    assert.deepEqual(store.outbox(job.id).map(e => e.kind), ['PREPARED', 'REQUIRES_ACTION'], code);
    assert.equal(await worker(store, g).runOnce(), undefined, 'no second attempt, with this or any other source');
    assert.deepEqual([calls.prepare, calls.credential], [1, 1]);
  }
  // A failure that needs no owner action stays an ordinary failure.
  const store = new JobStore(':memory:'), { g } = gateway({ execute: async () => ({ id: 'order_1', state: 'FAILED', fundsCaptured: false, failureCode: 'APPROVAL_EXPIRED' }) });
  const job = store.enqueue(rule);
  await worker(store, g).runOnce();
  assert.deepEqual(store.outbox(job.id).map(e => e.kind), ['PREPARED', 'FAILED']);
});

test('AUTO-11: a cooldown is a wait, not a failure: the same occurrence is retried after it under the same identity', async () => {
  const store = new JobStore(':memory:'), keys: string[] = [];
  let cooling = true;
  const { g, calls } = gateway({ prepare: async input => { keys.push(input.requestKey); if (cooling) throw fail(409, 'AUTOMATION_COOLDOWN'); return { id: 'autoexec_1', runId: 'autorn_1', orderId: 'order_1', amountMinor: 10000 }; } });
  const job = store.enqueue(rule);
  let now = 1_000_000;
  const w = new AutomationWorker(store, g, { workerId: 'w', clock: () => now, sleep: async () => {}, retryDelayMs: 1, leaseMs: 30_000, maxAttempts: 2 });
  for (let i = 0; i < 4; i++) { await w.runOnce(); now += 31_000; }
  assert.equal(store.get(job.id)!.state, 'PREPARING', 'cooling down repeatedly never fails the job, even past the attempt limit');
  cooling = false;
  await w.runOnce();
  assert.equal(store.get(job.id)!.state, 'SETTLED');
  assert.deepEqual([...new Set(keys)], [jobIdentity(rule).requestKey]);
  assert.equal(calls.credential, 1);
});

test('AUTO-11: skips that need the owner to decide are recorded as requiring action', async () => {
  for (const reason of ['FINE_TYPE_NOT_APPROVED', 'FINE_REQUIRES_REVIEW', 'OVER_PER_PAYMENT_CAP']) {
    const store = new JobStore(':memory:'), { g } = gateway({ prepare: async () => ({ skipped: true, reason }) });
    const job = store.enqueue(rule);
    const done = await worker(store, g).runOnce();
    assert.equal(done!.state, 'SKIPPED');
    assert.deepEqual(store.outbox(job.id).map(e => e.kind), ['REQUIRES_ACTION'], reason);
  }
  const store = new JobStore(':memory:'), { g } = gateway({ prepare: async () => ({ skipped: true, reason: 'NO_DUE_INVOICE' }) });
  const job = store.enqueue(rule);
  await worker(store, g).runOnce();
  assert.deepEqual(store.outbox(job.id).map(e => e.kind), ['SKIPPED'], 'an ordinary skip needs no one');
});

test('job databases bind atomically to one isolated run and reject ambiguous legacy history', () => {
  const runA = 'autorn_00000000-0000-4000-8000-000000000000', runB = 'autorn_11111111-1111-4111-8111-111111111111';
  const dir = mkdtempSync(join(tmpdir(), 'worker-run-binding-')), path = join(dir, 'jobs.sqlite');
  const first = new JobStore(path), second = new JobStore(path);
  try {
    first.bindRun(runA);
    second.bindRun(runA);
    first.enqueue(rule);
    assert.throws(() => second.bindRun(runB), /run/i);
    assert.equal(second.list()[0].state, 'QUEUED');
  } finally { first.close(); second.close(); cleanup(dir); }
  const legacy = new JobStore(':memory:');
  try {
    legacy.enqueue(rule);
    assert.throws(() => legacy.bindRun(runA), /run/i);
  } finally { legacy.close(); }
});

test('worker startup refuses a different run before scheduling or claiming queued work', () => {
  const runA = 'autorn_00000000-0000-4000-8000-000000000000', runB = 'autorn_11111111-1111-4111-8111-111111111111';
  const dir = mkdtempSync(join(tmpdir(), 'worker-run-startup-')), path = join(dir, 'jobs.sqlite');
  const env = { AUTOMATION_WORKER_ENABLED: 'true', AUTOMATION_SCHEDULE_ENABLED: 'true', AUTOMATION_WORKER_CLIENT_SECRET: 'test-secret', AUTOMATION_JOBS_DB: path, AUTOMATION_RUN_ID: runA };
  try {
    const first = createWorkerFromEnv(env);
    first.store.enqueue(rule);
    first.store.close();
    assert.throws(() => createWorkerFromEnv({ ...env, AUTOMATION_RUN_ID: runB }), /another run/i);
    const again = createWorkerFromEnv(env);
    try { assert.equal(again.store.list()[0].state, 'QUEUED'); } finally { again.store.close(); }
  } finally { cleanup(dir); }
});

test('claims suppress duplicate occurrences across versions without the scheduler', async () => {
  const store = new JobStore(':memory:'), { g, calls } = gateway();
  try {
    const first = store.enqueue(rule, 1), duplicate = store.enqueue({ ...rule, policyVersion: 2 }, 2);
    const done = await worker(store, g).runOnce();
    assert.equal(done?.id, first.id); assert.equal(done?.state, 'SETTLED');
    assert.equal(store.get(duplicate.id)?.state, 'SKIPPED');
    assert.equal(store.get(duplicate.id)?.reason, 'DUPLICATE_OCCURRENCE');
    assert.deepEqual(store.outbox(duplicate.id).map(event => event.kind), ['SKIPPED']);
    assert.equal(await worker(store, g).runOnce(), undefined);
    assert.deepEqual([calls.prepare, calls.credential, calls.execute], [1, 1, 1]);
  } finally { store.close(); }
  const held = new JobStore(':memory:'), other = gateway();
  try {
    const first = held.enqueue(rule, 1), claim = held.claim('old-worker', 1000, 2)!;
    held.transition(claim, 'HELD', { reason: 'PREPARATION_UNKNOWN' }, undefined, 3);
    const duplicate = held.enqueue({ ...rule, policyVersion: 2 }, 4);
    const next = held.enqueue({ ...rule, occurrenceKey: 'occ_next' }, 5);
    const done = await worker(held, other.g).runOnce();
    assert.equal(done?.id, next.id);
    assert.equal(held.get(first.id)?.state, 'HELD');
    assert.equal(held.get(duplicate.id)?.state, 'SKIPPED');
    assert.equal(other.calls.prepare, 1);
  } finally { held.close(); }
});

test('competing stores cannot claim two versions of the same occurrence', () => {
  const dir = mkdtempSync(join(tmpdir(), 'worker-occurrence-')), path = join(dir, 'jobs.sqlite');
  const a = new JobStore(path), b = new JobStore(path);
  try {
    a.enqueue(rule, 1); const duplicate = b.enqueue({ ...rule, policyVersion: 2 }, 2);
    assert.ok(a.claim('worker-a', 30_000, 3));
    assert.equal(b.claim('worker-b', 30_000, 3), undefined);
    assert.equal(b.get(duplicate.id)?.reason, 'DUPLICATE_OCCURRENCE');
  } finally { a.close(); b.close(); cleanup(dir); }
});
