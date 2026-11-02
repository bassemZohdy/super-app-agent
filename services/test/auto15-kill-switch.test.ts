import { removeTemp } from '../../test/support/temp-cleanup.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { JobStore } from '../automation-worker/src/jobs.ts';
import { AutomationWorker, type ExecutionGateway, type ExecutedOrder } from '../automation-worker/src/worker.ts';
import { DatabaseSync } from 'node:sqlite';
import { DesiredKillSwitchStore } from '../delegation/src/kill-switch.ts';

// AUTO-15: the operator's kill switch admits no new step. It stops claims, stops a job between steps and holds (never
// replays) a job whose credential was issued while it engaged. It survives a restart and is released explicitly.
const rule = { mandateId: 'mandate_1', policyVersion: 1, occurrenceKey: 'occ_2026_11', target: 'dewa:home' };
const cleanup = (dir: string) => { try { removeTemp(dir); } catch { /* Windows may briefly hold the directory */ } };

function harness(store: JobStore, hooks: { onPrepare?: () => void; onCredential?: () => void } = {}) {
  const calls = { prepare: 0, credential: 0, execute: 0 };
  const g: ExecutionGateway = {
    prepare: async () => { calls.prepare++; hooks.onPrepare?.(); return { id: 'autoexec_1', runId: 'autorn_1', orderId: 'order_1', amountMinor: 10000 }; },
    credential: async () => { calls.credential++; hooks.onCredential?.(); return { accessToken: 'secret-bearer-do-not-store', expiresAt: Date.now() + 600_000 }; },
    execute: async (): Promise<ExecutedOrder> => { calls.execute++; return { id: 'order_1', state: 'SETTLED', fundsCaptured: true, receipt: { amountMinor: 10000, currency: 'AED', receiptNumber: 'receipt_1' } }; },
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

test('AUTO-15 step 3b: a desired kill-switch state from an authority is applied to the worker\'s own store, and an unknown read changes nothing', async () => {
  const store = new JobStore(':memory:');
  const job = store.enqueue(rule);
  let desired: { engaged: boolean; reason: string; at: number } | undefined | 'FAIL' = { engaged: true, reason: 'authority stop', at: Date.now() - 2000 };
  const calls = { prepare: 0 };
  const g: ExecutionGateway = {
    prepare: async () => { calls.prepare++; return { id: 'autoexec_1', runId: 'autorn_1', orderId: 'order_1', amountMinor: 10000 }; },
    credential: async () => ({ accessToken: 'secret-bearer-do-not-store', expiresAt: Date.now() + 600_000 }),
    execute: async (): Promise<ExecutedOrder> => ({ id: 'order_1', state: 'SETTLED', fundsCaptured: true, receipt: { amountMinor: 10000, currency: 'AED', receiptNumber: 'receipt_1' } }),
    resume: async () => { throw new Error('not expected'); },
    killSwitch: async () => { if (desired === 'FAIL') throw new Error('authority unreachable'); return desired; },
  };
  const w = new AutomationWorker(store, g, { workerId: 'worker-a', clock: () => Date.now(), sleep: async () => {}, retryDelayMs: 1, leaseMs: 30_000 });

  assert.equal(await w.runOnce(), undefined, 'the desired engaged state stops claims');
  assert.equal(store.killSwitch().engaged, true);
  assert.equal(store.killSwitch().reason, 'authority stop');
  assert.equal(calls.prepare, 0);

  desired = 'FAIL';
  assert.equal(await w.runOnce(), undefined, 'an unreadable authority does not release the switch');
  assert.equal(store.killSwitch().engaged, true);

  desired = undefined;
  assert.equal(await w.runOnce(), undefined, 'an absent desired state changes nothing');
  assert.equal(store.killSwitch().engaged, true);

  desired = { engaged: false, reason: '', at: Date.now() + 60_000 };
  assert.equal((await w.runOnce())!.state, 'SETTLED', 'a released desired state lets the worker run again');
  assert.equal(store.get(job.id)!.state, 'SETTLED');
  store.close();
});

test('AUTO-15 step 3b-i: an older authority engage never undoes a newer local release', async () => {
  const store = new JobStore(':memory:');
  store.enqueue(rule);
  const older = { engaged: true, reason: 'authority stop', at: Date.now() - 60_000 };
  const g: ExecutionGateway = {
    prepare: async () => ({ id: 'autoexec_1', runId: 'autorn_1', orderId: 'order_1', amountMinor: 10000 }),
    credential: async () => ({ accessToken: 'secret-bearer-do-not-store', expiresAt: Date.now() + 600_000 }),
    execute: async (): Promise<ExecutedOrder> => ({ id: 'order_1', state: 'SETTLED', fundsCaptured: true, receipt: { amountMinor: 10000, currency: 'AED', receiptNumber: 'receipt_1' } }),
    resume: async () => { throw new Error('not expected'); },
    killSwitch: async () => older,
  };
  const w = new AutomationWorker(store, g, { workerId: 'worker-a', clock: () => Date.now(), sleep: async () => {}, retryDelayMs: 1, leaseMs: 30_000 });
  assert.equal(await w.runOnce(), undefined, 'the authority engage is applied first');
  assert.equal(store.killSwitch().engaged, true);
  store.setKillSwitch(false, 'operator released it', Date.now());
  assert.equal((await w.runOnce())!.state, 'SETTLED', 'the local release holds against the older authority state');
  assert.equal(store.killSwitch().engaged, false);
  store.close();
});

test('AUTO-15: delayed authority changes retain source order and local overrides remain newer', async () => {
  const store = new JobStore(':memory:');
  try {
    let desired = { engaged: true, reason: 'authority stop', at: 1000 };
    const g: ExecutionGateway = {
      prepare: async () => { throw new Error('no job expected'); },
      credential: async () => { throw new Error('no job expected'); },
      execute: async () => { throw new Error('no job expected'); },
      resume: async () => { throw new Error('no job expected'); },
      killSwitch: async () => desired,
    };
    const w = new AutomationWorker(store, g, { workerId: 'worker-a', clock: () => 5000 });
    await w.runOnce();
    assert.deepEqual(store.killSwitch(), { engaged: true, reason: 'authority stop', at: 1000 });
    desired = { engaged: false, reason: '', at: 1001 };
    await w.runOnce();
    assert.equal(store.killSwitch().engaged, false, 'a newer authority release is not hidden by delayed polling');
    store.setKillSwitch(true, 'local stop', 900);
    assert.equal(store.killSwitch().at, 1002, 'a local change is newer even if its clock regresses');
    await w.runOnce();
    assert.equal(store.killSwitch().engaged, true, 'the earlier authority release cannot undo the local stop');
  } finally { store.close(); }
});

test('AUTO-15: an already-engaged authority state is recorded before a later local release', async () => {
  const store = new JobStore(':memory:');
  try {
    store.setKillSwitch(true, 'local stop', 500);
    const g: ExecutionGateway = {
      prepare: async () => { throw new Error('no job expected'); },
      credential: async () => { throw new Error('no job expected'); },
      execute: async () => { throw new Error('no job expected'); },
      resume: async () => { throw new Error('no job expected'); },
      killSwitch: async () => ({ engaged: true, reason: 'authority stop', at: 1000 }),
    };
    const w = new AutomationWorker(store, g, { workerId: 'worker-a', clock: () => 900 });
    await w.runOnce();
    assert.equal(store.killSwitch().at, 1000);
    store.setKillSwitch(false, 'local release', 900);
    await w.runOnce();
    assert.equal(store.killSwitch().engaged, false, 'the observed older authority state is not replayed');
  } finally { store.close(); }
});

test('AUTO-15: authority writes atomically reject stale or invalid revisions', () => {
  const store = new JobStore(':memory:');
  try {
    store.setKillSwitch(true, 'local stop', 1001);
    for (const at of [1000, 1001, 0, -1, 1001.5, Number.MAX_SAFE_INTEGER + 1]) {
      store.applyDesiredKillSwitch(false, 'old release', at);
      assert.deepEqual(store.killSwitch(), { engaged: true, reason: 'local stop', at: 1001 });
    }
    store.applyDesiredKillSwitch(false, 'new release', 1002);
    assert.deepEqual(store.killSwitch(), { engaged: false, reason: 'new release', at: 1002 });
  } finally { store.close(); }
});

test('AUTO-15: a second database connection cannot overwrite a newer local stop', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cityside-kill-order-')), path = join(dir, 'jobs.sqlite');
  const first = new JobStore(path), second = new JobStore(path);
  try {
    first.setKillSwitch(false, 'initial', 1000);
    first.setKillSwitch(true, 'local stop', 1001);
    second.applyDesiredKillSwitch(false, 'stale authority release', 1000);
    assert.deepEqual(first.killSwitch(), { engaged: true, reason: 'local stop', at: 1001 });
    second.applyDesiredKillSwitch(false, 'new authority release', 1002);
    assert.equal(first.killSwitch().engaged, false);
  } finally { second.close(); first.close(); cleanup(dir); }
});

test('AUTO-15: broker changes reach a delayed worker in order despite a repeated or backward clock', async () => {
  const db = new DatabaseSync(':memory:'), broker = new DesiredKillSwitchStore(db), store = new JobStore(':memory:');
  try {
    const g: ExecutionGateway = {
      prepare: async () => { throw new Error('no job expected'); },
      credential: async () => { throw new Error('no job expected'); },
      execute: async () => { throw new Error('no job expected'); },
      resume: async () => { throw new Error('no job expected'); },
      killSwitch: async () => broker.get(),
    };
    const w = new AutomationWorker(store, g, { workerId: 'worker-a', clock: () => 5000 });
    broker.set(true, 'first stop', 'admin', 1000);
    await w.runOnce(); assert.equal(store.killSwitch().engaged, true);
    broker.set(false, '', 'admin', 1000);
    await w.runOnce(); assert.equal(store.killSwitch().engaged, false);
    broker.set(true, 'second stop', 'admin', 900);
    await w.runOnce(); assert.equal(store.killSwitch().engaged, true);
    assert.equal(store.killSwitch().at, 1002);
  } finally { store.close(); db.close(); }
});
