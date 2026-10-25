import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AccountDatabase } from '../provider-simulator/src/database.ts';
import { ProviderEngine } from '../provider-simulator/src/engine.ts';
import { PaymentCheckout } from '../provider-simulator/src/payment-checkout.ts';
import { ProviderSettlements } from '../provider-simulator/src/provider-settlements.ts';
import { executeAutomaticOrder } from '../provider-simulator/src/automation-execution.ts';
import type { AutomationPreparation, AutomationSkip } from '../provider-simulator/src/automation-runs.ts';
import { calendarCatchUp } from '../../packages/protocol-core/src/mandate-schedule.ts';
import { actorFor } from '../../packages/backend-kit/src/context.ts';
import type { ProviderClient } from '../../packages/backend-kit/src/provider-client.ts';
import { JobStore } from '../automation-worker/src/jobs.ts';
import { AutomationWorker, type ExecutionGateway } from '../automation-worker/src/worker.ts';
import { Scheduler, type RuleSource, type ScheduledRule } from '../automation-worker/src/scheduler.ts';

// AUTO-13: one approved billing period renews at the current plan price, from its own invoice and inside the cap, with a
// receipt; a plan change, a repricing, a lapsed subscription or a missing invoice goes to the owner and moves nothing.
type Telecom = 'etisalat' | 'du';
const DAY = 86_400_000;
const owner = { sub: 'auto-owner', authorization: 'Bearer broker-bound' };
const prepared = (r: AutomationPreparation | AutomationSkip) => { assert.equal((r as AutomationSkip).skipped, undefined, `skip ${(r as AutomationSkip).reason}`); return r as AutomationPreparation; };
const skipped = (r: AutomationPreparation | AutomationSkip) => { assert.equal((r as AutomationSkip).skipped, true, 'expected a skip'); return r as AutomationSkip; };

function fixture(t: { after(fn: () => void): void }, provider: Telecom = 'etisalat') {
  const root = mkdtempSync(join(tmpdir(), 'cityside-auto-')), path = join(root, 'payments.sqlite');
  const context = { root, operatorSub: 'automation-operator', workerSub: 'auto-worker', runId: `autorn_${randomUUID()}` };
  const db = new AccountDatabase(path), sourceDb = new AccountDatabase(':memory:'), actor = actorFor({ sub: 'auto-owner' }, undefined, 'Bearer owner');
  const source = new ProviderEngine(provider, sourceDb);
  const payments = new ProviderEngine('payments', db, { automationRun: context, automationIo: {
    readPayables: (accountId: string, p: string) => p === provider ? source.payables!.list(accountId) : [],
    providerStore: (p: string) => { if (p !== provider) throw new Error('No isolated store for this provider.'); return sourceDb; },
  } });
  db.accounts(actor.sub); sourceDb.accounts(actor.sub); payments.seed(actor); source.seed(actor);
  t.after(() => { db.close(); sourceDb.close(); try { rmSync(root, { recursive: true, force: true }); } catch { /* Windows may briefly hold the directory */ } });
  const account = actor.accountId;
  const subscription = () => sourceDb.list(account, 'subscription').find((x: { status?: string }) => x.status === 'ACTIVE') as { subscriptionId: string; monthlyAmount: number; planId: string; status: string };
  const reference = subscription().subscriptionId;
  let linked: { id: string; version: number } | undefined, n = 0;
  const invoice = (period: string, amountMinor = 29900) => {
    const result = source.lifecycle!.ingest(account, { kind: 'INVOICE_ISSUED', eventId: `renew-${++n}`, billId: `RENEW-${period}-${n}`, reference, amountMinor, dueDate: `${period}-28`, period });
    assert.equal(result.outcome, 'APPLIED', JSON.stringify(result));
    return `${provider}:bill:RENEW-${period}-${n}`;
  };
  const mandate = (opts: { perPaymentMinor?: number; dayOfMonth?: number; expiresInDays?: number } = {}) => {
    linked ??= db.transaction(() => payments.execute(actor, 'POST', '/billing-accounts', { provider, reference, nickname: 'Mobile' })).data.billingAccount;
    const policy = { actorClientId: 'cityside-automation' as const, audience: 'provider-api' as const, operation: 'SUBSCRIPTION_RENEWAL' as const, purpose: 'Renew my plan each month', currency: 'AED' as const,
      target: { kind: 'BILLER' as const, billingAccountId: linked!.id, expectedVersion: linked!.version, provider, reference }, sources: [{ methodId: 'wallet', expectedVersion: 1 }], fallback: { mode: 'NONE' as const },
      trigger: { type: 'CALENDAR' as const, dayOfMonth: opts.dayOfMonth ?? 28, hour: 9, minute: 0, monthEnd: 'LAST_DAY' as const }, timezone: 'Asia/Dubai',
      startsAt: new Date(Date.now() - 60000).toISOString(), expiresAt: new Date(Date.now() + (opts.expiresInDays ?? 90) * DAY).toISOString(),
      limits: { perPaymentMinor: opts.perPaymentMinor ?? 50000, periodMinor: 1000000, lifetimeMinor: 2000000, period: 'MONTH' as const, perPeriodCount: 5, lifetimeCount: 20, cooldownSeconds: 60 } };
    const created = payments.mandates!.create(actor, policy);
    return payments.mandates!.approve(actor, created.id, created.version, created.approvalDigest);
  };
  const prepare = (mandateId: string, occurrenceKey: string) => db.automationRuns!.prepare('auto-worker', { mandateId, occurrenceKey, requestKey: `req_${randomUUID()}` });
  const settlement = new ProviderSettlements(sourceDb, provider, { call: async (acct, id, action, body: any) => action === 'claim' ? payments.claims!.claim(acct, id, provider, body) : action === 'ack' ? payments.claims!.acknowledge(acct, id, provider, body) : payments.claims!.release(acct, id, provider, body) });
  let effects = 0;
  const client = { call: async (_p: string, _a: unknown, method: string, p: string, body: any = {}, key = 'test') => {
    if (p.endsWith('/payments')) {
      const proof = payments.execute(actor, 'GET', `/charges/${body.paymentId}`, {}).data.charge, fp = createHash('sha256').update(JSON.stringify([method, p, body])).digest('hex');
      return (await settlement.execute(actor, key, fp, proof, claimed => { effects++; return source.execute(actor, method, p, body, claimed); })).data;
    }
    let gatewayOrder;
    if (p.endsWith('/admit') || p.endsWith('/cancel')) { const admission = source.admissions!.get(account, p.split('/')[4]); gatewayOrder = payments.orders!.get(actor, admission.orderId); }
    return sourceDb.transaction(() => source.execute(actor, method, p, body, undefined, undefined, gatewayOrder)).data;
  } } as unknown as ProviderClient;
  const consumed: Record<string, unknown>[] = [];
  const deps = { runs: db.automationRuns!, orders: payments.orders!, funding: payments.funding!, checkout: new PaymentCheckout(payments.orders!, client), client,
    authority: async (_a: string | undefined, op: Record<string, unknown>) => { consumed.push(op); }, session: async () => ({ executionId: String(consumed.at(-1)?.executionId) }) };
  const run = (executionId: string) => executeAutomaticOrder(deps, owner, executionId);
  const backdate = (executionId: string) => { const row = JSON.parse(String(db.db.prepare('SELECT body FROM automation_executions WHERE id=?').get(executionId)!.body)); db.db.prepare('UPDATE automation_executions SET body=? WHERE id=?').run(JSON.stringify({ ...row, preparedAt: new Date(Date.now() - 3600000).toISOString() }), executionId); };
  const wallet = () => payments.ledger!.summary(account).balanceMinor;
  return { db, sourceDb, source, payments, actor, account, provider, reference, subscription, invoice, mandate, prepare, run, deps, consumed, backdate, wallet, effects: () => effects, status: (id: string) => source.payables!.get(account, id).status };
}

for (const provider of ['etisalat', 'du'] as const) test(`AUTO-13 ${provider}: the approved period renews once at the current plan price and leaves a receipt`, async t => {
  const f = fixture(t, provider), m = f.mandate(), id = f.invoice('2026-11'), other = f.invoice('2026-12'), before = f.wallet();
  assert.equal(f.subscription().monthlyAmount * 100, 29900);
  const execution = prepared(f.prepare(m.id, 'CAL:2026-11'));
  assert.equal(execution.kind, 'SUBSCRIPTION_RENEWAL');
  assert.equal(execution.payableId, id, 'the invoice of exactly that period');
  const settled = await f.run(execution.id);
  assert.equal(settled.state, 'SETTLED');
  assert.equal(f.status(id), 'PAID');
  assert.equal(f.status(other), 'UNPAID', 'the next period is untouched');
  assert.equal(f.wallet(), before - 29900);
  assert.deepEqual([settled.receipt!.amountMinor, id.endsWith(`:${settled.receipt!.obligationId}`), settled.receipt!.currency], [29900, true, 'AED'], 'a receipt for the renewed invoice');
  assert.equal((await f.run(execution.id)).state, 'SETTLED', 'redelivery returns the settled renewal');
  assert.equal(f.wallet(), before - 29900);
  assert.equal(f.effects(), 1);
});

test('AUTO-13: a plan change, repricing, lapse or missing invoice is skipped with a reason, asks the owner and moves nothing', async t => {
  const f = fixture(t), m = f.mandate(), before = f.wallet();
  assert.equal(skipped(f.prepare(m.id, 'CAL:2026-11')).reason, 'RENEWAL_NOT_INVOICED');
  const repriced = f.invoice('2026-10', 39900);
  assert.equal(skipped(f.prepare(m.id, 'CAL:2026-10')).reason, 'TARIFF_CHANGED', 'a repriced invoice is not the current plan price');
  assert.equal(f.status(repriced), 'UNPAID');
  // The owner upgrades the plan: the old-price invoice is no longer the current tariff.
  const old = f.invoice('2026-11');
  const sub = f.subscription();
  f.sourceDb.put(f.account, 'subscription', { ...sub, planId: 'premium_499', monthlyAmount: 499 }, sub.subscriptionId);
  assert.equal(skipped(f.prepare(m.id, 'CAL:2026-11')).reason, 'TARIFF_CHANGED', 'a plan upgrade is review-required');
  f.sourceDb.put(f.account, 'subscription', { ...sub, status: 'CANCELLED' }, sub.subscriptionId);
  assert.equal(skipped(f.prepare(m.id, 'CAL:2026-11')).reason, 'SUBSCRIPTION_NOT_ACTIVE');
  assert.equal(f.status(old), 'UNPAID');
  assert.equal(f.wallet(), before);
  assert.equal(f.db.automationRuns!.status('automation-operator').executionCount, 0, 'skips reserved nothing');
  assert.throws(() => f.prepare(m.id, 'occ_1'), (e: any) => e.code === 'AUTOMATION_OCCURRENCE_INVALID');
  assert.throws(() => f.prepare(m.id, 'CAL:2026-13'), (e: any) => e.code === 'AUTOMATION_OCCURRENCE_INVALID');
  const capped = fixture(t), mc = capped.mandate({ perPaymentMinor: 29899 });
  capped.invoice('2026-11');
  assert.equal(skipped(capped.prepare(mc.id, 'CAL:2026-11')).reason, 'OVER_PER_PAYMENT_CAP', 'the cap holds');
  const paid = fixture(t), mp = paid.mandate();
  const settledId = paid.invoice('2026-11');
  assert.equal((await paid.run(prepared(paid.prepare(mp.id, 'CAL:2026-11')).id)).state, 'SETTLED');
  assert.equal(paid.status(settledId), 'PAID');
});

test('AUTO-13: an already-paid period is never paid again', async t => {
  const f = fixture(t), m = f.mandate();
  f.invoice('2026-11');
  const first = prepared(f.prepare(m.id, 'CAL:2026-11'));
  await f.run(first.id);
  f.backdate(first.id);
  const again = f.db.automationRuns!.prepare('auto-worker', { mandateId: m.id, occurrenceKey: 'CAL:2026-11', requestKey: `req_${randomUUID()}` });
  assert.equal((again as AutomationPreparation).id, first.id, 'the same period is the same execution, not a second renewal');
  f.sourceDb.put(f.account, 'subscription', { ...f.subscription() }, f.subscription().subscriptionId);
  assert.equal(f.effects(), 1);
});

test('AUTO-13: the preview shows which period would renew, at what price, and why a change waits for the owner', t => {
  const f = fixture(t), m = f.mandate({ dayOfMonth: 1 });
  const month = new Date().toISOString().slice(0, 7);
  f.invoice(month);
  const show = () => f.payments.mandatePreview(f.actor, m.id, f.source.payables!.list(f.account));
  const ready = show();
  assert.ok(!ready.blockers.includes('EXECUTION_NOT_SUPPORTED_YET'));
  assert.deepEqual(ready.candidates.map(c => [c.amountMinor, c.decision === 'SKIP' ? 'SKIP' : 'RUN', c.reasons]), [[29900, 'RUN', []]]);
  const sub = f.subscription();
  f.sourceDb.put(f.account, 'subscription', { ...sub, planId: 'premium_499', monthlyAmount: 499 }, sub.subscriptionId);
  const upgraded = show();
  assert.deepEqual(upgraded.candidates.map(c => [c.decision, c.reasons]), [['SKIP', ['TARIFF_CHANGED']]]);
  assert.equal(upgraded.wouldRun, false);
});

/** The scheduler and worker driven against one run, in-process. */
function loop(f: ReturnType<typeof fixture>, mandateId: string, clock: { now: number }) {
  const w = 'auto-worker', runs = f.db.automationRuns!, store = new JobStore(':memory:');
  const rule = () => runs.rules(w).find(r => r.mandateId === mandateId)! as unknown as ScheduledRule;
  const src: RuleSource = { rules: async () => [rule()], dueInvoices: async () => [], balanceMinor: async () => 0 };
  const gateway: ExecutionGateway = {
    prepare: async input => { const r = runs.prepare(w, { mandateId: input.mandateId, occurrenceKey: input.occurrenceKey, requestKey: input.requestKey }); return 'skipped' in r ? { skipped: true, reason: r.reason } : { id: r.id, runId: r.runId, orderId: r.orderId! }; },
    credential: async () => ({ accessToken: 'in-process', expiresAt: clock.now + 90_000 }),
    execute: async (_run, executionId) => { const o = await f.run(executionId); return { id: o.id, state: o.state, fundsCaptured: o.fundsCaptured, failureCode: (o as { failureCode?: string }).failureCode }; },
  };
  const scheduler = new Scheduler(store, src), worker = new AutomationWorker(store, gateway, { workerId: 'w1', clock: () => clock.now, sleep: async () => {}, leaseMs: 30_000 });
  return { store, tick: () => scheduler.tick(clock.now), drain: () => worker.drain() };
}

test('AUTO-13: the calendar schedules one renewal per period; downtime skips older periods and an uninvoiced period asks the owner', async t => {
  const f = fixture(t), m = f.mandate({ expiresInDays: 200 });
  const rule = f.db.automationRuns!.rules('auto-worker').find(r => r.mandateId === m.id)! as unknown as ScheduledRule;
  const clock = { now: Date.now() };
  // Step to the first monthly run after the rule started.
  const start = Date.parse(rule.startsAt), horizon = start + 70 * DAY;
  let key = '', at = start;
  for (; at < horizon && !key; at += 6 * 3_600_000) key = calendarCatchUp(rule.trigger as never, rule.timezone, at, start, Date.parse(rule.expiresAt), new Set()).pending?.key ?? '';
  assert.match(key, /^CAL:\d{4}-\d{2}$/);
  clock.now = at;
  const period = key.slice(4), l = loop(f, m.id, clock);
  f.invoice(period);
  await Promise.all([l.tick(), l.tick()]);
  assert.equal(l.store.list().length, 1, 'one renewal per period however often the clock is read');
  const before = f.wallet();
  await l.drain();
  assert.equal(l.store.list()[0]!.state, 'SETTLED');
  assert.equal(f.wallet(), before - 29900);
  assert.deepEqual(l.store.outbox(l.store.list()[0]!.id).map(e => e.kind), ['PREPARED', 'SETTLED']);
  // A month later nobody issued the invoice: the run is skipped and the owner is asked, nothing is paid.
  f.backdate(l.store.list()[0]!.executionId!);
  clock.now += 31 * DAY;
  await l.tick(); await l.drain();
  const jobs = l.store.list();
  assert.equal(jobs.length, 2);
  assert.equal(jobs[1]!.state, 'SKIPPED');
  assert.equal(jobs[1]!.reason, 'RENEWAL_NOT_INVOICED');
  assert.deepEqual(l.store.outbox(jobs[1]!.id).map(e => e.kind), ['REQUIRES_ACTION']);
  assert.equal(f.wallet(), before - 29900, 'only one period was paid');
});
