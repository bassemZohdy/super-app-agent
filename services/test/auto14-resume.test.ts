import test from 'node:test';
import assert from 'node:assert/strict';
import { JobStore } from '../automation-worker/src/jobs.ts';
import { AutomationWorker, type ChallengeAnswer, type ExecutionGateway, type ExecutedOrder, type GatewayFailure, type PrepareResult } from '../automation-worker/src/worker.ts';

// AUTO-14 step 2b: a job held on the owner's card challenge is parked, polled after its wait, and resumed only
// once the owner approved. Each answer is recorded once as an outbox event; no resumed credential is requested twice.
const rule = { mandateId: 'mandate_1', policyVersion: 1, occurrenceKey: 'occ_2026_11', target: 'dewa:home' };
const SECRET = 'secret-bearer-do-not-store';
const WAIT = 60_000;

function gateway(answers: Array<ChallengeAnswer | Error>) {
  const calls = { credential: 0, execute: 0, resume: 0, tokens: [] as string[] };
  let executed = 0;
  const g: ExecutionGateway = {
    prepare: async (): Promise<PrepareResult> => ({ id: 'autoexec_1', runId: 'autorn_1', orderId: 'order_1' }),
    credential: async () => { calls.credential++; return { accessToken: `${SECRET}-first`, expiresAt: Date.now() + 600_000 }; },
    // The first execution is challenged; every later execution of the same order settles it.
    execute: async (_run, _exec, token): Promise<ExecutedOrder> => {
      calls.execute++; calls.tokens.push(token);
      return executed++ === 0 ? { id: 'order_1', state: 'REQUIRES_ACTION', fundsCaptured: false } : { id: 'order_1', state: 'SETTLED', fundsCaptured: true };
    },
    resume: async (): Promise<ChallengeAnswer> => {
      calls.resume++;
      const next = answers.shift();
      if (!next) throw new Error('unexpected resume');
      if (next instanceof Error) throw next;
      return next;
    },
  };
  return { g, calls };
}
const fail = (status: number | undefined, code: string) => Object.assign(new Error(code), { status, code }) as GatewayFailure;

function clocked() {
  const c = { now: 1_000_000 };
  return { c, clock: () => c.now };
}
const workerFor = (store: JobStore, g: ExecutionGateway, clock: () => number, workerId = 'worker-a') =>
  new AutomationWorker(store, g, { workerId, clock, sleep: async () => {}, retryDelayMs: 1, leaseMs: 30_000, challengeWaitMs: WAIT });

test('AUTO-14: a challenged job is parked, not claimed during its wait, then resumes once approved and settles the same order', async () => {
  const store = new JobStore(':memory:'), { c, clock } = clocked();
  const job = store.enqueue(rule);
  const { g, calls } = gateway([{ state: 'PENDING' }, { state: 'APPROVED', accessToken: `${SECRET}-resumed`, expiresAt: c.now + 600_000 }]);
  const w = workerFor(store, g, clock);

  assert.equal((await w.runOnce())!.state, 'HELD');
  assert.equal(store.get(job.id)!.reason, 'REQUIRES_ACTION');
  assert.equal(await w.runOnce(), undefined, 'a parked job is not claimed during its wait');

  c.now += WAIT;
  assert.equal((await w.runOnce())!.state, 'HELD', 'the owner has not answered yet');
  assert.equal(calls.resume, 1);
  assert.equal(store.outbox(job.id).some(e => e.kind === 'CHALLENGE_ANSWERED'), false, 'a pending answer records nothing');

  c.now += WAIT;
  assert.equal((await w.runOnce())!.state, 'SETTLED');
  assert.equal(calls.credential, 1, 'no second credential was requested for the first attempt');
  assert.equal(calls.execute, 2, 'the same order is executed once more with the resumed credential');
  assert.deepEqual(calls.tokens, [`${SECRET}-first`, `${SECRET}-resumed`]);
  assert.deepEqual(store.outbox(job.id).map(e => e.kind), ['PREPARED', 'REQUIRES_ACTION', 'CHALLENGE_ANSWERED', 'SETTLED']);
  assert.deepEqual(store.outbox(job.id).find(e => e.kind === 'CHALLENGE_ANSWERED')!.body, { decision: 'APPROVE' });
  assert.equal(await w.runOnce(), undefined, 'a settled job is never resumed again');
});

test('AUTO-14: the owner rejects the challenge, the job fails with the answer recorded, and nothing is executed again', async () => {
  const store = new JobStore(':memory:'), { c, clock } = clocked();
  const job = store.enqueue(rule);
  const { g, calls } = gateway([{ state: 'REJECTED' }]);
  const w = workerFor(store, g, clock);
  await w.runOnce();
  c.now += WAIT;
  const done = await w.runOnce();
  assert.equal(done!.state, 'FAILED');
  assert.equal(done!.reason, 'CHALLENGE_REJECTED');
  assert.equal(calls.execute, 1, 'only the original challenged execution ran');
  assert.equal(calls.credential, 1);
  const answer = store.outbox(job.id).find(e => e.kind === 'CHALLENGE_ANSWERED')!;
  assert.deepEqual(answer.body, { decision: 'REJECT', reason: 'CHALLENGE_REJECTED' });
});

test('AUTO-14: an unreachable resume is held for reconciliation and never asked again', async () => {
  const store = new JobStore(':memory:'), { c, clock } = clocked();
  store.enqueue(rule);
  const { g, calls } = gateway([fail(503, 'UNREACHABLE')]);
  const w = workerFor(store, g, clock);
  await w.runOnce();
  c.now += WAIT;
  const held = await w.runOnce();
  assert.equal(held!.state, 'HELD');
  assert.equal(held!.reason, 'CREDENTIAL_UNKNOWN');
  c.now += 10 * WAIT;
  assert.equal(await w.runOnce(), undefined, 'a held job is final once its resume is unknown');
  assert.equal(calls.resume, 1);
});

test('AUTO-14: a definitive refusal to resume holds the job with its reason and no second request', async () => {
  const store = new JobStore(':memory:'), { c, clock } = clocked();
  store.enqueue(rule);
  const { g, calls } = gateway([fail(403, 'PERMIT_NOT_RESUMABLE')]);
  const w = workerFor(store, g, clock);
  await w.runOnce();
  c.now += WAIT;
  assert.equal((await w.runOnce())!.reason, 'PERMIT_NOT_RESUMABLE');
  c.now += 10 * WAIT;
  assert.equal(await w.runOnce(), undefined);
  assert.equal(calls.resume, 1);
  assert.equal(calls.execute, 1);
});

test('AUTO-14: a crash while the resumed credential is being requested is held for reconciliation, not asked again', async () => {
  const store = new JobStore(':memory:'), { c, clock } = clocked();
  store.enqueue(rule);
  const { g, calls } = gateway([]);
  await workerFor(store, g, clock).runOnce();
  c.now += WAIT;
  // A worker claims the parked job, records that a credential is being requested, and dies before it hears back.
  const crashed = store.claim('crashed-worker', 30_000, c.now)!;
  store.transition(crashed, 'CREDENTIALING', {}, undefined, c.now);
  c.now += 60_000;
  const next = await workerFor(store, g, clock, 'worker-b').runOnce();
  assert.equal(next!.state, 'HELD');
  assert.equal(next!.reason, 'CREDENTIAL_LOST_AFTER_RESTART');
  assert.equal(calls.resume, 0, 'the resumed credential is never requested after a crash');
});
