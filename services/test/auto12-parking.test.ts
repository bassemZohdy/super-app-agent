import { removeTemp } from '../../test/support/temp-cleanup.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AccountDatabase } from '../provider-simulator/src/database.ts';
import { ProviderEngine } from '../provider-simulator/src/engine.ts';
import { PaymentCheckout } from '../provider-simulator/src/payment-checkout.ts';
import { ProviderSettlements } from '../provider-simulator/src/provider-settlements.ts';
import { executeAutomaticOrder } from '../provider-simulator/src/automation-execution.ts';
import type { AutomationPreparation, AutomationSkip } from '../provider-simulator/src/automation-runs.ts';
import { parkingZones } from '../provider-simulator/src/fixtures.ts';
import { actorFor } from '../../packages/backend-kit/src/context.ts';
import type { ProviderClient } from '../../packages/backend-kit/src/provider-client.ts';
import { JobStore } from '../automation-worker/src/jobs.ts';
import { AutomationWorker, type ExecutionGateway } from '../automation-worker/src/worker.ts';
import { Scheduler, type RuleSource, type ScheduledRule } from '../automation-worker/src/scheduler.ts';

// AUTO-12: a bounded rule extends only the one parking session the owner bound, only while it runs, and never past the
// rule's own hours, end time or budget; departure, expiry, revocation and the maximum all stop it, and nothing is inferred.
const HOUR = 3_600_000;
const owner = { sub: 'auto-owner', authorization: 'Bearer broker-bound' };
const prepared = (r: AutomationPreparation | AutomationSkip) => { assert.equal((r as AutomationSkip).skipped, undefined, `skip ${(r as AutomationSkip).reason}`); return r as AutomationPreparation; };
const skipped = (r: AutomationPreparation | AutomationSkip) => { assert.equal((r as AutomationSkip).skipped, true, 'expected a skip'); return r as AutomationSkip; };
const zone = parkingZones[0]!, tariffMinor = Math.round(zone.tariffPerHour * 100);

function fixture(t: { after(fn: () => void): void }, opts: { maximumHours?: number; endInHours?: number; sessionHours?: number; endsInMinutes?: number } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'cityside-auto-')), path = join(root, 'payments.sqlite');
  const context = { root, operatorSub: 'automation-operator', workerSub: 'auto-worker', runId: `autorn_${randomUUID()}` };
  const db = new AccountDatabase(path), sourceDb = new AccountDatabase(':memory:'), actor = actorFor({ sub: 'auto-owner' }, undefined, 'Bearer owner');
  const rta = new ProviderEngine('rta', sourceDb);
  const payments = new ProviderEngine('payments', db, { automationRun: context, automationIo: {
    readPayables: () => [],
    parkingExtensions: (p: string) => p === 'rta' ? rta.parkingExtensions : undefined,
    providerStore: (p: string) => { if (p !== 'rta') throw new Error('No isolated store for this provider.'); return sourceDb; },
  } });
  db.accounts(actor.sub); sourceDb.accounts(actor.sub); payments.seed(actor); rta.seed(actor);
  t.after(() => { db.close(); sourceDb.close(); try { removeTemp(root); } catch { /* Windows may briefly hold the directory */ } });
  const account = actor.accountId, ticketId = 'ticket-auto-1', plate = 'DXB A-1234';
  const now = Date.now();
  const meter = { ticketId, zoneId: zone.id, zoneCode: zone.code, zoneName: zone.name, plateNumber: plate, durationHours: opts.sessionHours ?? 1, totalFee: zone.tariffPerHour, startTime: now - HOUR / 2, expiresAt: now + (opts.endsInMinutes ?? 5) * 60000, status: 'ACTIVE' };
  sourceDb.put(account, 'parking', meter, ticketId);
  const session = () => sourceDb.get(account, 'parking', ticketId) as typeof meter;
  const mandate = (change: Record<string, unknown> = {}, target: Record<string, unknown> = {}) => {
    const policy = { actorClientId: 'cityside-automation' as const, audience: 'provider-api' as const, operation: 'PARKING_EXTENSION' as const, purpose: 'Keep my parking running', currency: 'AED' as const,
      target: { kind: 'PARKING' as const, ticketId, plateNumber: plate, zoneId: zone.id, maximumHours: opts.maximumHours ?? 3, endAt: new Date(now + (opts.endInHours ?? 6) * HOUR).toISOString(), ...target },
      sources: [{ methodId: 'wallet', expectedVersion: 1 }], fallback: { mode: 'NONE' as const }, trigger: { type: 'PARKING_ENDING' as const, minutesBefore: 10 },
      timezone: 'Asia/Dubai', startsAt: new Date(now - 60000).toISOString(), expiresAt: new Date(now + 8 * HOUR).toISOString(),
      limits: { perPaymentMinor: 5000, periodMinor: 100000, lifetimeMinor: 200000, period: 'MONTH' as const, perPeriodCount: 10, lifetimeCount: 20, cooldownSeconds: 60 }, ...change };
    const created = payments.mandates!.create(actor, policy);
    return payments.mandates!.approve(actor, created.id, created.version, created.approvalDigest);
  };
  const prepare = (mandateId: string, occurrenceKey = `PARK:${ticketId}:${session().expiresAt}`) => db.automationRuns!.prepare('auto-worker', { mandateId, occurrenceKey, requestKey: `req_${randomUUID()}` });
  const settlement = new ProviderSettlements(sourceDb, 'rta', { call: async (acct, id, action, body: any) => action === 'claim' ? payments.claims!.claim(acct, id, 'rta', body) : action === 'ack' ? payments.claims!.acknowledge(acct, id, 'rta', body) : payments.claims!.release(acct, id, 'rta', body) });
  let effects = 0;
  const client = { call: async (_p: string, _a: unknown, method: string, p: string, body: any = {}, key = 'test') => {
    if (p.endsWith('/payments')) {
      const proof = payments.execute(actor, 'GET', `/charges/${body.paymentId}`, {}).data.charge, fp = createHash('sha256').update(JSON.stringify([method, p, body])).digest('hex');
      return (await settlement.execute(actor, key, fp, proof, claimed => { effects++; return rta.execute(actor, method, p, body, claimed); })).data;
    }
    let gatewayOrder;
    if (p.endsWith('/admit') || p.endsWith('/cancel')) { const admission = rta.admissions!.get(account, p.split('/')[4]); gatewayOrder = payments.orders!.get(actor, admission.orderId); }
    return sourceDb.transaction(() => rta.execute(actor, method, p, body, undefined, undefined, gatewayOrder)).data;
  } } as unknown as ProviderClient;
  const consumed: Record<string, unknown>[] = [];
  const deps = { runs: db.automationRuns!, orders: payments.orders!, funding: payments.funding!, checkout: new PaymentCheckout(payments.orders!, client), client,
    authority: async (_a: string | undefined, op: Record<string, unknown>) => { consumed.push(op); }, session: async () => ({ executionId: String(consumed.at(-1)?.executionId) }) };
  const run = (executionId: string) => executeAutomaticOrder(deps, owner, executionId);
  const backdate = (executionId: string) => { const row = JSON.parse(String(db.db.prepare('SELECT body FROM automation_executions WHERE id=?').get(executionId)!.body)); db.db.prepare('UPDATE automation_executions SET body=? WHERE id=?').run(JSON.stringify({ ...row, preparedAt: new Date(Date.now() - 3600000).toISOString() }), executionId); };
  const wallet = () => payments.ledger!.summary(account).balanceMinor;
  return { db, sourceDb, rta, payments, actor, account, ticketId, plate, session, mandate, prepare, run, deps, consumed, backdate, wallet, effects: () => effects, depart: () => rta.lifecycle!.ingest(account, { kind: 'PARKING_DEPARTED', eventId: `depart-${randomUUID()}`, ticketId }) };
}

test('AUTO-12: a session about to end is extended by one hour, charged and applied exactly once', async t => {
  const f = fixture(t), m = f.mandate(), before = f.wallet(), start = f.session();
  const execution = prepared(f.prepare(m.id));
  assert.equal(execution.kind, 'PARKING_EXTENSION');
  assert.equal(execution.amountMinor, tariffMinor);
  assert.equal(f.session().expiresAt, start.expiresAt, 'preparation changed nothing');
  const order = f.payments.orders!.get(f.actor, execution.orderId!);
  assert.equal(order.quote.payable.kind, 'PARKING_EXTENSION');
  assert.throws(() => f.payments.orders!.approve(f.actor, order.id, { expectedVersion: order.version, approvalDigest: order.approvalDigest }, undefined), (e: any) => e.code === 'ORDER_AUTOMATIC');
  const settled = await f.run(execution.id);
  assert.equal(settled.state, 'SETTLED', JSON.stringify(settled));
  assert.equal(f.session().expiresAt, start.expiresAt + HOUR);
  assert.equal(f.session().durationHours, start.durationHours + 1);
  assert.equal(f.wallet(), before - tariffMinor);
  assert.equal(f.effects(), 1);
  assert.equal((await f.run(execution.id)).state, 'SETTLED', 'redelivery returns the settled order');
  assert.equal(f.session().expiresAt, start.expiresAt + HOUR, 'and extends nothing twice');
  assert.equal(f.wallet(), before - tariffMinor);
  assert.equal(f.consumed.length, 1);
});

test('AUTO-12: every stop condition skips with a reason and extends nothing', async t => {
  const notYet = fixture(t, { endsInMinutes: 60 }), mn = notYet.mandate();
  assert.equal(skipped(notYet.prepare(mn.id)).reason, 'SESSION_NOT_ENDING', 'it does not extend a session that is far from ending');
  const expired = fixture(t, { endsInMinutes: -5 }), me = expired.mandate();
  assert.equal(skipped(expired.prepare(me.id)).reason, 'SESSION_EXPIRED', 'an expired session is never revived');
  const left = fixture(t), ml = left.mandate();
  assert.equal(left.depart().outcome, 'APPLIED');
  assert.equal(skipped(left.prepare(ml.id)).reason, 'SESSION_ENDED', 'departure stops future runs');
  const maxed = fixture(t, { maximumHours: 3, sessionHours: 3 }), mm = maxed.mandate();
  assert.equal(skipped(maxed.prepare(mm.id)).reason, 'MAXIMUM_DURATION_REACHED');
  const late = fixture(t, { endInHours: 0.1 }), mt = late.mandate();
  assert.equal(skipped(late.prepare(mt.id)).reason, 'END_TIME_REACHED', 'the rule never extends past its own end time');
  const wrong = fixture(t), mw = wrong.mandate({}, { plateNumber: 'ANOTHER-PLATE' });
  assert.equal(skipped(wrong.prepare(mw.id)).reason, 'SESSION_MISMATCH', 'only the bound plate and zone count');
  const missing = fixture(t), mi = missing.mandate({}, { ticketId: 'ticket-does-not-exist' });
  assert.equal(skipped(missing.prepare(mi.id, 'PARK:ticket-does-not-exist:1')).reason, 'SESSION_NOT_FOUND', 'a session is never created or inferred');
  const dear = fixture(t), md = dear.mandate({ limits: { perPaymentMinor: tariffMinor - 1, periodMinor: 100000, lifetimeMinor: 200000, period: 'MONTH', perPeriodCount: 10, lifetimeCount: 20, cooldownSeconds: 60 } });
  assert.equal(skipped(dear.prepare(md.id)).reason, 'OVER_PER_PAYMENT_CAP');
  for (const f of [notYet, expired, left, maxed, late, wrong, missing, dear]) assert.equal(f.db.automationRuns!.status('automation-operator').executionCount, 0, 'a skip reserves nothing');
});

test('AUTO-12: repeated extensions stop at the rule\'s maximum hours', async t => {
  const f = fixture(t, { maximumHours: 3 }), m = f.mandate();
  for (const hours of [2, 3]) {
    const execution = prepared(f.prepare(m.id));
    assert.equal((await f.run(execution.id)).state, 'SETTLED');
    assert.equal(f.session().durationHours, hours);
    f.backdate(execution.id);
    f.sourceDb.put(f.account, 'parking', { ...f.session(), expiresAt: Date.now() + 5 * 60000 }, f.ticketId);
    // The session is ending again, now on its new expiry, and the fixture clock is pulled back so the next window opens.
    f.sourceDb.put(f.account, 'parking', { ...f.session(), expiresAt: Date.now() + 5 * 60000 }, f.ticketId);
  }
  assert.equal(skipped(f.prepare(m.id)).reason, 'MAXIMUM_DURATION_REACHED');
  assert.equal(f.session().durationHours, 3);
  assert.equal(f.effects(), 2);
});

test('AUTO-12: departure, expiry or revocation after preparation stop the extension before any money moves', async t => {
  const left = fixture(t), ml = left.mandate(), beforeLeft = left.wallet();
  const a = prepared(left.prepare(ml.id));
  left.depart();
  await assert.rejects(left.run(a.id), (e: any) => e.code === 'AUTOMATION_ADMISSION_REJECTED');
  assert.equal(left.wallet(), beforeLeft);
  assert.equal(left.session().status, 'ENDED');
  assert.equal(left.db.automationRuns!.released(a.id), true);
  assert.equal(left.effects(), 0);
  const expired = fixture(t), me = expired.mandate(), beforeExpired = expired.wallet();
  const b = prepared(expired.prepare(me.id));
  expired.sourceDb.put(expired.account, 'parking', { ...expired.session(), expiresAt: Date.now() - 1000 }, expired.ticketId);
  await assert.rejects(expired.run(b.id), (e: any) => e.code === 'AUTOMATION_ADMISSION_REJECTED');
  assert.equal(expired.wallet(), beforeExpired);
  const revoked = fixture(t), mr = revoked.mandate(), beforeRevoked = revoked.wallet();
  const c = prepared(revoked.prepare(mr.id));
  revoked.payments.mandates!.revoke(revoked.actor, mr.id, mr.version);
  await assert.rejects(revoked.run(c.id), (e: any) => e.code === 'AUTOMATION_ADMISSION_REJECTED');
  assert.equal(revoked.wallet(), beforeRevoked);
  assert.equal(revoked.effects(), 0);
});

test('AUTO-12: one open extension per rule; manual orders cannot take a parking quote; short funds fail without extending', async t => {
  const f = fixture(t), m = f.mandate();
  const first = prepared(f.prepare(m.id));
  assert.equal(prepared(f.prepare(m.id)).id, first.id, 'the same occurrence is the same execution');
  f.backdate(first.id);
  assert.throws(() => f.prepare(m.id, `PARK:${f.ticketId}:other`), (e: any) => e.code === 'AUTOMATION_EXTENSION_IN_PROGRESS');
  assert.equal(f.db.automationRuns!.status('automation-operator').executionCount, 1);
  const quote = f.rta.parkingExtensions!.get(f.account, first.payableId);
  assert.throws(() => f.payments.orders!.create(f.actor, { provider: 'rta', payableId: quote.id, expectedPayableRevision: quote.revision, methodId: 'wallet', expectedMethodVersion: 1 }, quote), (e: any) => ['PAYABLE_NOT_SUPPORTED', 'PAYABLE_RESERVED'].includes(e.code));
  const poor = fixture(t), mp = poor.mandate();
  poor.payments.ledger!.record(poor.account, 'PAYMENT', 'charge:drain', poor.wallet() - 50, 'wallet');
  const before = poor.session().expiresAt, execution = prepared(poor.prepare(mp.id)), failed = await poor.run(execution.id);
  assert.equal(failed.state, 'FAILED');
  assert.equal((failed as { failureCode?: string }).failureCode, 'INSUFFICIENT_AVAILABLE_FUNDS');
  assert.equal(poor.session().expiresAt, before, 'the session was not extended');
  assert.equal(poor.db.automationRuns!.released(execution.id), true);
});

test('AUTO-12: the preview shows the extension a rule would buy and why it would not', t => {
  const f = fixture(t), m = f.mandate();
  const ready = f.payments.mandatePreview(f.actor, m.id, []);
  assert.ok(!ready.blockers.includes('EXECUTION_NOT_SUPPORTED_YET'));
  assert.deepEqual(ready.candidates.map(c => [c.amountMinor, c.decision]), [[tariffMinor, 'DUE_NOW']]);
  f.depart();
  const gone = f.payments.mandatePreview(f.actor, m.id, []);
  assert.deepEqual(gone.candidates.map(c => [c.decision, c.reasons]), [['SKIP', ['SESSION_ENDED']]]);
  assert.equal(f.session().status, 'ENDED');
});

/** The scheduler and worker driven against one run, in-process. */
function loop(f: ReturnType<typeof fixture>, mandateId: string, clock: { now: number }) {
  const w = 'auto-worker', runs = f.db.automationRuns!, store = new JobStore(':memory:');
  const rule = () => runs.rules(w).find(r => r.mandateId === mandateId)! as unknown as ScheduledRule;
  const src: RuleSource = { rules: async () => [rule()], dueInvoices: async () => [], balanceMinor: async () => 0, parkingSession: async () => runs.parkingSession(w, mandateId) };
  const gateway: ExecutionGateway = {
    prepare: async input => { const r = runs.prepare(w, { mandateId: input.mandateId, occurrenceKey: input.occurrenceKey, requestKey: input.requestKey }); return 'skipped' in r ? { skipped: true, reason: r.reason } : { id: r.id, runId: r.runId, orderId: r.orderId! }; },
    credential: async () => ({ accessToken: 'in-process', expiresAt: clock.now + 90_000 }),
    execute: async (_run, executionId) => { const o = await f.run(executionId); return { id: o.id, state: o.state, fundsCaptured: o.fundsCaptured, failureCode: (o as { failureCode?: string }).failureCode }; },
  };
  const scheduler = new Scheduler(store, src), worker = new AutomationWorker(store, gateway, { workerId: 'w1', clock: () => clock.now, sleep: async () => {}, leaseMs: 30_000 });
  return { store, scheduler, tick: () => scheduler.tick(clock.now), drain: () => worker.drain(), jobs: () => store.list().map(j => [j.occurrenceKey.replace(/^PARK:[^:]+:/, 'PARK@'), j.state]) };
}

test('AUTO-12: the scheduler announces each session expiry once and stops when the session ends', async t => {
  const far = fixture(t, { endsInMinutes: 60 }), mf = far.mandate(), clockFar = { now: Date.now() }, lf = loop(far, mf.id, clockFar);
  await lf.tick();
  assert.deepEqual(lf.jobs(), [], 'a session far from ending schedules nothing');
  assert.ok((await lf.scheduler.nextRun(far.db.automationRuns!.rules('auto-worker')[0] as unknown as ScheduledRule, clockFar.now))!.runAtUtc > clockFar.now, 'the next run is the ending window');
  const f = fixture(t), m = f.mandate(), clock = { now: Date.now() }, l = loop(f, m.id, clock);
  const firstExpiry = f.session().expiresAt;
  await Promise.all([l.tick(), l.tick()]);
  assert.equal(l.store.list().length, 1, 'concurrent evaluations announce the expiry once');
  await l.drain();
  assert.deepEqual(l.store.list().map(j => j.state), ['SETTLED']);
  assert.equal(f.session().expiresAt, firstExpiry + HOUR);
  await l.tick(); await l.drain();
  assert.equal(l.store.list().length, 1, 'the extended session is not ending yet');
  // Time passes until the new expiry is near: it is announced as a new occurrence, and departure ends the chain.
  f.backdate(l.store.list()[0]!.executionId!);
  clock.now = firstExpiry + HOUR - 5 * 60000;
  await l.tick();
  assert.equal(l.store.list().length, 2);
  f.depart();
  await l.drain();
  assert.equal(l.store.list()[1]!.state, 'SKIPPED');
  assert.equal(l.store.list()[1]!.reason, 'SESSION_ENDED');
  await l.tick();
  assert.equal(l.store.list().length, 2, 'an ended session is never announced again');
});
