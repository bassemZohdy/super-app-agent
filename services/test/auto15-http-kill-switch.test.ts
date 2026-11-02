import test from 'node:test';
import assert from 'node:assert/strict';
import { HttpExecutionGateway } from '../automation-worker/src/http-gateway.ts';
import { AutomationWorker, type ExecutionGateway } from '../automation-worker/src/worker.ts';
import { JobStore } from '../automation-worker/src/jobs.ts';

test('AUTO-15: unreadable or contradictory HTTP switch responses cannot release a stopped worker', async t => {
  const prior = process.env.KEYCLOAK_TOKEN_URL;
  process.env.KEYCLOAK_TOKEN_URL = 'http://127.0.0.1/token';
  t.after(() => { if (prior === undefined) delete process.env.KEYCLOAK_TOKEN_URL; else process.env.KEYCLOAK_TOKEN_URL = prior; });
  let status = 200, payload: unknown = {};
  t.mock.method(globalThis, 'fetch', async input => {
    if (new URL(String(input)).pathname === '/token') return Response.json({ access_token: 'fixture-token', expires_in: 300 });
    return Response.json(payload, { status });
  });
  const http = new HttpExecutionGateway({ runId: 'autorn_00000000-0000-4000-8000-000000000000', paymentsUrl: 'http://127.0.0.1/', brokerUrl: 'http://127.0.0.1/', clientSecret: 'fixture-secret' });
  const store = new JobStore(':memory:');
  try {
    store.setKillSwitch(true, 'local stop', 1000);
    const g: ExecutionGateway = {
      prepare: async () => { throw new Error('no job expected'); },
      credential: async () => { throw new Error('no job expected'); },
      execute: async () => { throw new Error('no job expected'); },
      resume: async () => { throw new Error('no job expected'); },
      killSwitch: () => http.killSwitch(),
    };
    const worker = new AutomationWorker(store, g, { workerId: 'worker-a', clock: () => 2000 });
    for (const invalid of [
      { success: false, engaged: false, reason: '', at: 1001 },
      { engaged: false, reason: '', at: 1001 },
      { success: true, engaged: false, reason: '', at: 0 },
      { success: true, engaged: false, reason: '', at: 1001.5 },
      { success: true, engaged: false, reason: '', at: Number.MAX_SAFE_INTEGER + 1 },
      { success: true, engaged: false, reason: {}, at: 1001 },
      { success: true, engaged: true, reason: '', at: 1001 },
      { success: true, engaged: false, reason: 'x'.repeat(70000), at: 1001 },
      null, [],
    ]) {
      payload = invalid;
      await assert.rejects(http.killSwitch(), /KILL_SWITCH_UNREADABLE|invalid/i);
      await worker.runOnce();
      assert.equal(store.killSwitch().engaged, true);
    }
    status = 404; payload = { success: false, code: 'NO_DESIRED_STATE' };
    assert.equal(await http.killSwitch(), undefined);
    await worker.runOnce(); assert.equal(store.killSwitch().engaged, true);
    status = 503; payload = { error: 'secret-bearing-provider-error' };
    await assert.rejects(http.killSwitch(), (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.doesNotMatch(error.message, /secret-bearing-provider-error/);
      return true;
    });
    await worker.runOnce(); assert.equal(store.killSwitch().engaged, true);
    status = 200; payload = { success: true, engaged: false, reason: '', at: 1001 };
    await worker.runOnce(); assert.equal(store.killSwitch().engaged, false);
  } finally { store.close(); }
});
