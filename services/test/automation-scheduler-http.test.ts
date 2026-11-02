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
      { success: true, balanceMinor: 2000, qualifyingDebits: 0, code: 'BALANCE_UNAVAILABLE' },
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

test('scheduler rejects invalid invoice, fine and parking readings before creating jobs', async t => {
  const previous = process.env.KEYCLOAK_TOKEN_URL;
  process.env.KEYCLOAK_TOKEN_URL = 'http://127.0.0.1/token';
  t.after(() => { if (previous === undefined) delete process.env.KEYCLOAK_TOKEN_URL; else process.env.KEYCLOAK_TOKEN_URL = previous; });
  const invoiceRule = { ...rule, trigger: { type: 'INVOICE_DUE' as const, daysBefore: 3 } };
  const fineRule = { ...rule, trigger: { type: 'NEW_FINE' as const } };
  const parkRule = { ...rule, trigger: { type: 'PARKING_ENDING' as const, minutesBefore: 30 } };
  let selectedRule: typeof invoiceRule | typeof fineRule | typeof parkRule = invoiceRule;
  let payload: unknown;
  t.mock.method(globalThis, 'fetch', async input => {
    const path = new URL(String(input)).pathname;
    if (path === '/token') return Response.json({ access_token: 'fixture-service-token', expires_in: 300 });
    if (path.endsWith('/rules')) return Response.json({ success: true, rules: [selectedRule] });
    return Response.json(payload);
  });
  const source = new HttpRuleSource({ runId: 'autorn_00000000-0000-4000-8000-000000000000', paymentsUrl: 'http://127.0.0.1', clientSecret: 'fixture-secret' });
  const now = Date.parse('2026-11-13T05:00:00Z');
  const examples: { selected: typeof selectedRule; body: unknown }[] = [
    { selected: invoiceRule, body: { success: true, invoices: [{ dueDate: '2026-11-15' }, { dueDate: '2026-02-30' }] } },
    { selected: invoiceRule, body: { success: true, invoices: [null] } },
    { selected: fineRule, body: { success: true, fines: [{ fineId: 'fine_1' }, { fineId: '../bad' }] } },
    { selected: fineRule, body: { success: true, fines: [{ fineId: 'fine_1' }, { fineId: 'fine_1' }] } },
    { selected: parkRule, body: { success: true, session: { ticketId: 'ticket_1', status: 'ACTIVE', expiresAt: String(now + 1000) } } },
    { selected: parkRule, body: { success: true, session: { ticketId: '../bad', status: 'ACTIVE', expiresAt: now + 1000 } } },
  ];
  for (const example of examples) {
    selectedRule = example.selected; payload = example.body;
    const store = new JobStore(':memory:');
    try { await assert.rejects(new Scheduler(store, source).tick(now)); assert.deepEqual(store.list(), []); }
    finally { store.close(); }
  }
  payload = { success: true, invoices: [{ dueDate: '2026-11-15' }] }; selectedRule = invoiceRule;
  assert.deepEqual(await source.dueInvoices(invoiceRule), [{ dueDate: '2026-11-15' }]);
  payload = { success: true, fines: [{ fineId: 'fine_1' }] }; selectedRule = fineRule;
  assert.deepEqual(await source.newFines(fineRule), [{ fineId: 'fine_1' }]);
  payload = { success: true, session: { ticketId: 'ticket_1', status: 'ACTIVE', expiresAt: now + 1000 } }; selectedRule = parkRule;
  assert.deepEqual(await source.parkingSession(parkRule), { ticketId: 'ticket_1', status: 'ACTIVE', expiresAt: now + 1000 });
});

test('scheduler validates the entire HTTP rule list before acting on any rule', async t => {
  const previous = process.env.KEYCLOAK_TOKEN_URL;
  process.env.KEYCLOAK_TOKEN_URL = 'http://127.0.0.1/token';
  t.after(() => { if (previous === undefined) delete process.env.KEYCLOAK_TOKEN_URL; else process.env.KEYCLOAK_TOKEN_URL = previous; });
  let rules: unknown[] = [];
  t.mock.method(globalThis, 'fetch', async input => {
    const path = new URL(String(input)).pathname;
    if (path === '/token') return Response.json({ access_token: 'fixture-service-token', expires_in: 300 });
    if (path.endsWith('/rules')) return Response.json({ success: true, rules });
    return Response.json({ success: true, balanceMinor: 500, qualifyingDebits: 0 });
  });
  const source = new HttpRuleSource({ runId: 'autorn_00000000-0000-4000-8000-000000000000', paymentsUrl: 'http://127.0.0.1', clientSecret: 'fixture-secret' });
  const invalid = [
    null, { ...rule, mandateId: '../bad' }, { ...rule, policyVersion: 0 }, { ...rule, policyVersion: 1001 }, { ...rule, state: 'UNKNOWN' },
    { ...rule, executionEnabled: true },
    { ...rule, timezone: 'Invalid/Zone' }, { ...rule, startsAt: '2026-02-30T00:00:00Z' },
    { ...rule, trigger: { type: 'CALENDAR', dayOfMonth: 32, hour: 9, minute: 0, monthEnd: 'LAST_DAY' } },
    { ...rule, trigger: { type: 'INVOICE_DUE', daysBefore: -1 } },
    { ...rule, trigger: { type: 'LOW_BALANCE', belowMinor: '1000', reloadMinor: 5000, targetBalanceMinor: 10000 } },
    { ...rule, trigger: { type: 'LOW_BALANCE', belowMinor: 10000, reloadMinor: 5000, targetBalanceMinor: 10000 } },
    { ...rule, trigger: { type: 'LOW_BALANCE', belowMinor: 10001, reloadMinor: 5000, targetBalanceMinor: 10000 } },
    { ...rule, trigger: { type: 'LOW_BALANCE', belowMinor: 1000, reloadMinor: 10001, targetBalanceMinor: 10000 } },
    { ...rule, trigger: { type: 'PARKING_ENDING', minutesBefore: 0 } },
    { ...rule, trigger: { type: 'UNKNOWN' } },
    { ...rule, trigger: { type: 'NEW_FINE', unexpected: 'value' } },
    { ...rule, trigger: { type: 'CALENDAR', dayOfMonth: 1, hour: 9, minute: 0, monthEnd: 'SKIP', daysBefore: 2 } },
    { ...rule, trigger: { ...rule.trigger, unexpected: true } },
  ];
  for (const candidate of invalid) {
    const second = candidate && typeof candidate === 'object' && candidate.mandateId === rule.mandateId ? { ...candidate, mandateId: 'mandate_2' } : candidate;
    rules = [rule, second];
    const store = new JobStore(':memory:');
    try {
      await assert.rejects(new Scheduler(store, source).tick(Date.parse('2026-11-01T00:00:00Z')));
      assert.deepEqual(store.list(), []);
      assert.deepEqual(store.thresholdState(rule.mandateId, 1), { armed: true, seq: 0 });
    } finally { store.close(); }
  }
  rules = [rule, { ...rule }];
  await assert.rejects(source.rules());
  rules = [rule];
  assert.deepEqual(await source.rules(), [rule]);
  rules = [{ ...rule, policyVersion: 1000 }];
  assert.deepEqual(await source.rules(), rules);
  for (const supported of [
    { type: 'CALENDAR', dayOfMonth: 31, hour: 9, minute: 0, monthEnd: 'SKIP' },
    { type: 'INVOICE_DUE', daysBefore: 3 }, { type: 'NEW_FINE' }, { type: 'PARKING_ENDING', minutesBefore: 10 },
    { type: 'LOW_BALANCE', belowMinor: 9999, reloadMinor: 10000, targetBalanceMinor: 10000 },
  ]) {
    rules = [{ ...rule, trigger: supported }];
    assert.deepEqual(await source.rules(), rules);
  }
});


test('scheduler does not act on rules paired with a contradictory error code', async t => {
  const previous = process.env.KEYCLOAK_TOKEN_URL;
  process.env.KEYCLOAK_TOKEN_URL = 'http://127.0.0.1/token';
  t.after(() => { if (previous === undefined) delete process.env.KEYCLOAK_TOKEN_URL; else process.env.KEYCLOAK_TOKEN_URL = previous; });
  let balanceReads = 0;
  t.mock.method(globalThis, 'fetch', async input => {
    const path = new URL(String(input)).pathname;
    if (path === '/token') return Response.json({ access_token: 'fixture-service-token', expires_in: 300 });
    if (path.endsWith('/rules')) return Response.json({ success: true, rules: [rule], code: 'RULES_UNAVAILABLE' });
    balanceReads++; return Response.json({ success: true, balanceMinor: 500, qualifyingDebits: 0 });
  });
  const store = new JobStore(':memory:');
  try {
    const source = new HttpRuleSource({ runId: 'autorn_00000000-0000-4000-8000-000000000000', paymentsUrl: 'http://127.0.0.1', clientSecret: 'fixture-secret' });
    await assert.rejects(new Scheduler(store, source).tick(Date.parse('2026-11-01T00:00:00Z')));
    assert.equal(balanceReads, 0); assert.deepEqual(store.list(), []);
    assert.deepEqual(store.thresholdState(rule.mandateId, 1), { armed: true, seq: 0 });
  } finally { store.close(); }
});
