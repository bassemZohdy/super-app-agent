import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { DesiredKillSwitchStore, authorizeKillSwitchRead, authorizeKillSwitchWrite } from '../delegation/src/kill-switch.ts';
import { automationAdminClient, automationWorkerClient, brokerClient } from '../delegation/src/policy.ts';

// AUTO-15 step 3b-ii: only the admin client (with its admin scope) sets the desired kill-switch state, and only the
// automation worker (with its execute scope) reads it. Every other caller, including a delegated or mis-scoped token, is refused.
const admin = { sub: 'service-account-automation-admin', azp: automationAdminClient, scope: 'automation.admin' };
const worker = { sub: 'service-account-automation-worker', azp: automationWorkerClient, scope: 'automation.execute' };
const code = (fn: () => unknown) => { try { fn(); } catch (e) { return (e as { code?: string; status?: number }).code; } return undefined; };

test('AUTO-15 3b-ii: the desired state is stored once, replaced by the admin, and survives reopening the same database', () => {
  const db = new DatabaseSync(':memory:');
  const store = new DesiredKillSwitchStore(db);
  assert.equal(store.get(), undefined, 'no state until the admin sets one');
  const engaged = store.set(true, 'suspected bad source', admin.sub, 1000);
  assert.deepEqual([engaged.engaged, engaged.reason, engaged.at], [true, 'suspected bad source', 1000]);
  store.set(false, '', admin.sub, 2000);
  assert.equal(store.get()!.engaged, false);
  assert.equal(new DesiredKillSwitchStore(db).get()!.at, 2000, 'reopening keeps the same single state');
});

test('AUTO-15 3b-ii: only the admin client with its admin scope may write the desired state', () => {
  assert.doesNotThrow(() => authorizeKillSwitchWrite(admin));
  assert.equal(code(() => authorizeKillSwitchWrite(worker)), 'KILL_SWITCH_ADMIN_REQUIRED', 'the worker cannot change its own switch');
  assert.equal(code(() => authorizeKillSwitchWrite({ ...admin, scope: 'delegation.write' })), 'KILL_SWITCH_ADMIN_REQUIRED', 'the admin client without its scope is refused');
  assert.equal(code(() => authorizeKillSwitchWrite({ ...admin, act: { sub: 'someone' } })), 'KILL_SWITCH_ADMIN_REQUIRED', 'a delegated chain is refused');
  assert.equal(code(() => authorizeKillSwitchWrite({ ...admin, azp: brokerClient })), 'KILL_SWITCH_ADMIN_REQUIRED', 'the broker cannot write it either');
});

test('AUTO-15 3b-ii: only the worker with its execute scope may read the desired state', () => {
  assert.doesNotThrow(() => authorizeKillSwitchRead(worker));
  assert.equal(code(() => authorizeKillSwitchRead(admin)), 'KILL_SWITCH_WORKER_REQUIRED', 'the admin client reads nothing through the worker route');
  assert.equal(code(() => authorizeKillSwitchRead({ ...worker, scope: 'delegation.write' })), 'KILL_SWITCH_WORKER_REQUIRED');
  assert.equal(code(() => authorizeKillSwitchRead({ ...worker, act: { sub: 'x' } })), 'KILL_SWITCH_WORKER_REQUIRED');
});
