import { removeTemp } from '../../test/support/temp-cleanup.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { JobStore } from '../automation-worker/src/jobs.ts';
import { AutomationWorker, type ExecutionGateway, type ExecutedOrder } from '../automation-worker/src/worker.ts';

// AUTO-15: the operator's kill switch admits no new step. It stops claims, stops a job between steps and holds (never
// replays) a job whose credential was issued while it engaged. It survives a restart and is released explicitly.
const rule = { mandateId: 'mandate_1', policyVersion: 1, occurrenceKey: 'occ_2026_11', target: 'dewa:home' };
const cleanup = (dir: string) => { try { removeTemp(dir); } catch { /* Windows may briefly hold the directory */ } };

function harness(store: JobStore, hooks: { onPrepare?: () => void; onCredential?: () => void } = {}) {
  const calls = { prepare: 0, credential: 0, execute: 0 };
  const g: ExecutionGateway = {
    prepare: async () => { calls.prepare++; hooks.onPrepare?.(); return { id: 'autoexec_1', runId: 'autorn_1', orderId: 'order_1' }; },
    credential: async () => { calls.credential++; hooks.onCredential?.(); return { accessToken: 'secret-bearer-do-not-store', expiresAt: Date.now() + 600_000 }; },
    execute: async (): Promise<ExecutedOrder> => { calls.execute++; return { id: 'order_1', state: 'SETTLED', fundsCaptured: true }; },
    resume: async () => { throw new Error('not expected'); },
  };
  const w = new AutomationWorker(store, g, { workerId: 'worker-a', clock: () => Date.now(), sleep: async () => {}, retryDelayMs: 1, leaseMs: 30_000 });
  return { w, calls };
}

test('AUTO-15: an engaged kill switch claims nothing, survives a restart, and resumes work once released', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'cityside-kill-')), path = join(dir, 'jobs.sqlite');
  try {
    const store = new JobStore(path);
    const job = store.enqueue(rule);
    store.setKillSwitch(true, 'operator stop');
    const { w, calls } = harness(store);
    assert.equal(await w.runOnce(), undefined, 'nothing is claimed while the switch is engaged');
    assert.equal(calls.prepare, 0);
    store.close();

    const reopened = new JobStore(path);
    assert.equal(reopened.killSwitch().engaged, true, 'the switch survives a restart');
    assert.equal(reopened.killSwitch().reason, 'operator stop');
    reopened.setKillSwitch(false);
    const again = harness(reopened);
    assert.equal((await again.w.runOnce())!.state, 'SETTLED');
    assert.equal(reopened.get(job.id)!.state, 'SETTLED');
    reopened.close();
  } finally { cleanup(dir); }
});

test('AUTO-15: a kill switch engaged between steps stops the job where it is, with no credential requested', async () => {
  const store = new JobStore(':memory:');
  const job = store.enqueue(rule);
  const { w, calls } = harness(store, { onPrepare: () => store.setKillSwitch(true, 'stop after prepare') });
  await w.runOnce();
  assert.equal(store.get(job.id)!.state, 'PREPARED', 'the prepared job waits untouched');
  assert.deepEqual([calls.prepare, calls.credential, calls.execute], [1, 0, 0]);

  store.setKillSwitch(false);
  assert.equal((await w.runOnce())!.state, 'SETTLED', 'the same preparation carries on after release');
  assert.deepEqual([calls.prepare, calls.credential, calls.execute], [1, 1, 1]);
});

test('AUTO-15: an engage while a credential is in flight holds the job and never presents that credential', async () => {
  const store = new JobStore(':memory:');
  const job = store.enqueue(rule);
  const { w, calls } = harness(store, { onCredential: () => store.setKillSwitch(true, 'stop mid-credential') });
  const done = await w.runOnce();
  assert.equal(done!.state, 'HELD');
  assert.equal(done!.reason, 'KILL_SWITCH_ENGAGED');
  assert.deepEqual([calls.credential, calls.execute], [1, 0], 'the issued credential is not presented');
  assert.equal(store.outbox(job.id).at(-1)!.kind, 'HELD');
  store.setKillSwitch(false);
  assert.equal(await w.runOnce(), undefined, 'a held job is not replayed with a fresh credential');
  assert.equal(calls.credential, 1);
});
