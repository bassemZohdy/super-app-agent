import test from 'node:test';
import assert from 'node:assert/strict';
import { runWorkerLoop } from '../automation-worker/src/loop.ts';
import { JobStore } from '../automation-worker/src/jobs.ts';
import { AutomationWorker } from '../automation-worker/src/worker.ts';

function gate() {
  let release!: () => void;
  const waiting = new Promise<void>(resolve => { release = resolve; });
  return { waiting, release };
}

test('stopping during a scheduler read does not claim a new job', async () => {
  const controller = new AbortController(), entered = gate(), unblock = gate(); let claims = 0;
  const run = runWorkerLoop({ runOnce: async () => { claims++; return false; } }, { tick: async () => { entered.release(); await unblock.waiting; } }, controller.signal);
  await entered.waiting; controller.abort(); unblock.release(); await run;
  assert.equal(claims, 0);
});

test('stopping lets an in-flight job finish without starting another', async () => {
  const controller = new AbortController(), entered = gate(), unblock = gate(); let claims = 0, completed = false;
  const run = runWorkerLoop({ runOnce: async () => { claims++; entered.release(); await unblock.waiting; completed = true; return true; } }, undefined, controller.signal);
  await entered.waiting; controller.abort(); unblock.release(); await run;
  assert.equal(claims, 1); assert.equal(completed, true);
});

test('stopping wakes an idle worker without waiting for its polling interval', { timeout: 1000 }, async () => {
  const controller = new AbortController(), entered = gate();
  const run = runWorkerLoop({ runOnce: async () => { entered.release(); return false; } }, undefined, controller.signal, { idleMs: 60_000 });
  await entered.waiting; controller.abort(); await run;
});


test('stopping during the worker authority read leaves the queued job unclaimed', async () => {
  const store = new JobStore(':memory:'), controller = new AbortController(), entered = gate(), unblock = gate();
  const job = store.enqueue({ mandateId: 'mandate_1', policyVersion: 1, occurrenceKey: 'occ_1', target: 'dewa:home' });
  let preparations = 0;
  const worker = new AutomationWorker(store, {
    killSwitch: async () => { entered.release(); await unblock.waiting; return undefined; },
    prepare: async () => { preparations++; throw new Error('must not dispatch'); },
    credential: async () => { throw new Error('must not dispatch'); },
    execute: async () => { throw new Error('must not dispatch'); },
  }, { workerId: 'worker' });
  try {
    const run = runWorkerLoop(worker, undefined, controller.signal);
    await entered.waiting; controller.abort(); unblock.release(); await run;
    assert.equal(preparations, 0); assert.equal(store.get(job.id)?.state, 'QUEUED');
  } finally { store.close(); }
});
