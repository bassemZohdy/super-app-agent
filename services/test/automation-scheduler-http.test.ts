import test from 'node:test';
import assert from 'node:assert/strict';
import { HttpRuleSource } from '../automation-worker/src/http-rules.ts';
import { Scheduler } from '../automation-worker/src/scheduler.ts';
import { JobStore } from '../automation-worker/src/jobs.ts';

const rule = { mandateId: 'mandate_1', policyVersion: 1, state: 'APPROVED', trigger: { type: 'LOW_BALANCE' as const, belowMinor: 1000, reloadMinor: 5000, targetBalanceMinor: 10000 }, timezone: 'Asia/Dubai', startsAt: '2026-01-01T00:00:00Z', expiresAt: '2027-01-01T00:00:00Z', target: 'wallet:1' };

test('scheduler rejects untrustworthy HTTP balance readings without changing threshold history', async t => {
  const previous = process.env.KEYCLOAK_TOKEN_URL;
  process.env.KEYCLOAK_TOKEN_URL = 'http://127.0.0.1/token';
  t.after(() => { if (previous === undefined) delete process.env.KEYCLOAK_TOKEN_URL; else process.env.KEYCLOAK_TOKEN_URL = previous; });
  let payload: unknown = { success: true, balanceMinor: 500, qualifyingDebits: 0 };
  t.mock.method(globalThis, 'fetch', async input => {
    const path = new URL(String(input)).pathname;
    if (path === '/token') return Response.json({ access_token: 'fixture-service-token', expires_in: 300 });
    if (path.endsWith('/rules')) return Response.json({ success: true, rules: [rule] });
    return Response.json(payload);
  });
  const source = new HttpRuleSource({ runId: 'autorn_00000000-0000-4000-8000-000000000000', paymentsUrl: 'http://127.0.0.1', clientSecret: 'fixture-secret' });
  const store = new JobStore(':memory:'), scheduler = new Scheduler(store, source), now = Date.parse('2026-11-01T00:00:00Z');
  try {
    await scheduler.tick(now);
    const before = store.thresholdState(rule.mandateId, rule.policyVersion);
    assert.deepEqual(before, { armed: false, seq: 1 });
    for (payload of [
      { success: true, balanceMinor: '2000', qualifyingDebits: 1 },
      { success: true, balanceMinor: 2000, qualifyingDebits: null },
      { success: true, balanceMinor: -1, qualifyingDebits: 0 },
      { success: true, balanceMinor: 500, qualifyingDebits: 0.5 },
      { success: true, balanceMinor: 2000, qualifyingDebits: 0, error: 'private-marker' },
      { balanceMinor: 2000, qualifyingDebits: 0 },
      { success: true, balanceMinor: 2000, qualifyingDebits: 0, extra: 'x'.repeat(70000) },
    ]) {
      await assert.rejects(scheduler.tick(now + 1000), (error: unknown) => error instanceof Error && !error.message.includes('private-marker'));
      assert.deepEqual(store.thresholdState(rule.mandateId, rule.policyVersion), before);
      assert.equal(store.list().length, 1);
    }
    payload = { success: true, balanceMinor: 2000, qualifyingDebits: 0 };
    await scheduler.tick(now + 2000);
    assert.equal(store.thresholdState(rule.mandateId, rule.policyVersion).armed, true);
  } finally { store.close(); }
});
