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
import { actorFor } from '../../packages/backend-kit/src/context.ts';
import type { ProviderClient } from '../../packages/backend-kit/src/provider-client.ts';
import { JobStore } from '../automation-worker/src/jobs.ts';
import { AutomationWorker, type ExecutionGateway } from '../automation-worker/src/worker.ts';
import { Scheduler, type RuleSource, type ScheduledRule } from '../automation-worker/src/scheduler.ts';

// AUTO-11: an opt-in fine rule pays a fine only when the current record is inside the owner's plate, type, amount and
// count approvals; everything else asks for review, and an automatic and a manual payment settle each fine once.
const owner = { sub: 'auto-owner', authorization: 'Bearer broker-bound' };
const prepared = (r: AutomationPreparation | AutomationSkip) => { assert.equal((r as AutomationSkip).skipped, undefined, `skip ${(r as AutomationSkip).reason}`); return r as AutomationPreparation; };
const skipped = (r: AutomationPreparation | AutomationSkip) => { assert.equal((r as AutomationSkip).skipped, true, 'expected a skip'); return r as AutomationSkip; };

function fixture(t: { after(fn: () => void): void }) {
  const root = mkdtempSync(join(tmpdir(), 'cityside-auto-')), path = join(root, 'payments.sqlite');
  const context = { root, operatorSub: 'automation-operator', workerSub: 'auto-worker', runId: `autorn_${randomUUID()}` };
  const db = new AccountDatabase(path), sourceDb = new AccountDatabase(':memory:'), actor = actorFor({ sub: 'auto-owner' }, undefined, 'Bearer owner');
  const police = new ProviderEngine('police', sourceDb);
  const payments = new ProviderEngine('payments', db, { automationRun: context, automationIo: {
    readPayables: (accountId: string, p: string) => p === 'police' ? police.payables!.list(accountId) : [],
    providerStore: (p: string) => { if (p !== 'police') throw new Error('No isolated store for this provider.'); return sourceDb; },
  } });
  db.accounts(actor.sub); sourceDb.accounts(actor.sub); payments.seed(actor); police.seed(actor);
  t.after(() => { db.close(); sourceDb.close(); try { removeTemp(root); } catch { /* Windows may briefly hold the directory */ } });
  const account = actor.accountId, fines = () => police.payables!.list(account).filter(p => p.kind === 'FINE' && p.status === 'UNPAID');
  const plate = fines()[0]!.reference;
  let linked: { id: string; version: number } | undefined;
  const mandate = (opts: { fineTypes?: string[]; perPaymentMinor?: number; perPeriodCount?: number } = {}) => {
    linked ??= db.transaction(() => payments.execute(actor, 'POST', '/billing-accounts', { provider: 'police', reference: plate, nickname: 'My car' })).data.billingAccount;
    const policy = { actorClientId: 'cityside-automation' as const, audience: 'provider-api' as const, operation: 'FINE_PAYMENT' as const, purpose: 'Pay my approved fines', currency: 'AED' as const,
      target: { kind: 'BILLER' as const, billingAccountId: linked!.id, expectedVersion: linked!.version, provider: 'police' as const, reference: plate }, sources: [{ methodId: 'wallet', expectedVersion: 1 }], fallback: { mode: 'NONE' as const },
      trigger: { type: 'NEW_FINE' as const }, fineTypes: opts.fineTypes ?? ['Speeding'], timezone: 'Asia/Dubai', startsAt: new Date(Date.now() - 60000).toISOString(), expiresAt: new Date(Date.now() + 30 * 86400000).toISOString(),
      limits: { perPaymentMinor: opts.perPaymentMinor ?? 100000, periodMinor: 1000000, lifetimeMinor: 2000000, period: 'MONTH' as const, perPeriodCount: opts.perPeriodCount ?? 5, lifetimeCount: 20, cooldownSeconds: 60 } };
    const created = payments.mandates!.create(actor, policy);
    return payments.mandates!.approve(actor, created.id, created.version, created.approvalDigest);
  };
  const prepare = (mandateId: string, fineId: string) => db.automationRuns!.prepare('auto-worker', { mandateId, occurrenceKey: `FINE:${fineId}`, requestKey: `req_${randomUUID()}` });
  const settlement = new ProviderSettlements(sourceDb, 'police', { call: async (acct, id, action, body: any) => action === 'claim' ? payments.claims!.claim(acct, id, 'police', body) : action === 'ack' ? payments.claims!.acknowledge(acct, id, 'police', body) : payments.claims!.release(acct, id, 'police', body) });
  let effects = 0;
  const client = { call: async (_p: string, _a: unknown, method: string, p: string, body: any = {}, key = 'test') => {
    if (p.endsWith('/payments')) {
      const proof = payments.execute(actor, 'GET', `/charges/${body.paymentId}`, {}).data.charge, fp = createHash('sha256').update(JSON.stringify([method, p, body])).digest('hex');
      return (await settlement.execute(actor, key, fp, proof, claimed => { effects++; return police.execute(actor, method, p, body, claimed); })).data;
    }
    let gatewayOrder;
    if (p.endsWith('/admit') || p.endsWith('/cancel')) { const admission = police.admissions!.get(account, p.split('/')[4]); gatewayOrder = payments.orders!.get(actor, admission.orderId); }
    return sourceDb.transaction(() => police.execute(actor, method, p, body, undefined, undefined, gatewayOrder)).data;
  } } as unknown as ProviderClient;
  const consumed: Record<string, unknown>[] = [];
  const deps = { runs: db.automationRuns!, orders: payments.orders!, funding: payments.funding!, checkout: new PaymentCheckout(payments.orders!, client), client,
    authority: async (_a: string | undefined, op: Record<string, unknown>) => { consumed.push(op); }, session: async () => ({ executionId: String(consumed.at(-1)?.executionId) }) };
  const run = (executionId: string) => executeAutomaticOrder(deps, owner, executionId);
  const backdate = (executionId: string) => { const row = JSON.parse(String(db.db.prepare('SELECT body FROM automation_executions WHERE id=?').get(executionId)!.body)); db.db.prepare('UPDATE automation_executions SET body=? WHERE id=?').run(JSON.stringify({ ...row, preparedAt: new Date(Date.now() - 3600000).toISOString() }), executionId); };
  const wallet = () => payments.ledger!.summary(account).balanceMinor;
  return { db, sourceDb, police, payments, actor, account, plate, fines, mandate, prepare, run, deps, consumed, backdate, wallet, effects: () => effects, status: (id: string) => police.payables!.get(account, id).status };
}
const fineId = (p: { obligationId?: string }) => String(p.obligationId);

test('AUTO-11: a fine of an approved type within the cap is paid once from the wallet; the other fine is left alone', async t => {
  const f = fixture(t), [speeding, overstay] = [f.fines().find(p => p.violation === 'Speeding')!, f.fines().find(p => p.violation === 'Parking overstay')!];
  assert.ok(speeding && overstay, 'the demo plate has both kinds of fine');
  const m = f.mandate(), before = f.wallet();
  const execution = prepared(f.prepare(m.id, fineId(speeding)));
  assert.equal(execution.payableId, speeding.id);
  assert.equal(execution.amountMinor, speeding.amountMinor);
  const settled = await f.run(execution.id);
  assert.equal(settled.state, 'SETTLED');
  assert.equal(f.status(speeding.id), 'PAID');
  assert.equal(f.wallet(), before - speeding.amountMinor);
  assert.equal(f.effects(), 1);
  assert.equal((await f.run(execution.id)).state, 'SETTLED', 'redelivery returns the settled order');
  assert.equal(f.wallet(), before - speeding.amountMinor);
  assert.equal(f.status(overstay.id), 'UNPAID', 'a fine the rule did not approve is never paid');
});

test('AUTO-11: excluded, unknown, closed and over-cap fines are skipped with a reason and move nothing', async t => {
  const f = fixture(t), speeding = f.fines().find(p => p.violation === 'Speeding')!, overstay = f.fines().find(p => p.violation === 'Parking overstay')!, before = f.wallet();
  const m = f.mandate({ fineTypes: ['Speeding'], perPaymentMinor: speeding.amountMinor - 1 });
  assert.equal(skipped(f.prepare(m.id, fineId(overstay))).reason, 'FINE_TYPE_NOT_APPROVED');
  assert.equal(skipped(f.prepare(m.id, fineId(speeding))).reason, 'OVER_PER_PAYMENT_CAP');
  assert.equal(skipped(f.prepare(m.id, 'NO-SUCH-FINE')).reason, 'FINE_NOT_FOUND');
  f.police.payables!.amend(f.account, overstay.id, overstay.revision, { status: 'CANCELLED' });
  assert.equal(skipped(f.prepare(m.id, fineId(overstay))).reason, 'FINE_NOT_PAYABLE', 'a withdrawn fine is not payable');
  assert.throws(() => f.db.automationRuns!.prepare('auto-worker', { mandateId: m.id, occurrenceKey: 'occ_1', requestKey: `req_${randomUUID()}` }), (e: any) => e.code === 'AUTOMATION_OCCURRENCE_INVALID');
  assert.equal(f.wallet(), before);
  assert.equal(f.db.automationRuns!.status('automation-operator').executionCount, 0, 'skips reserved nothing');
  assert.equal(f.status(speeding.id), 'UNPAID');
});

test('AUTO-11: a simulated restriction sends the fine to review, and a reserved fine cannot change under the rule', async t => {
  const f = fixture(t), speeding = f.fines().find(p => p.violation === 'Speeding')!, overstay = f.fines().find(p => p.violation === 'Parking overstay')!, before = f.wallet();
  const m = f.mandate({ fineTypes: ['Speeding', 'Parking overstay'] });
  const restricted = f.police.payables!.amend(f.account, overstay.id, overstay.revision, { paymentRestricted: true });
  assert.equal(skipped(f.prepare(m.id, fineId(overstay))).reason, 'FINE_REQUIRES_REVIEW');
  assert.equal(f.status(restricted.id), 'UNPAID');
  assert.equal(f.wallet(), before);
  // Once a fine is reserved by a prepared execution the source refuses to amend or restrict it under the rule.
  const execution = prepared(f.prepare(m.id, fineId(speeding)));
  assert.throws(() => f.police.payables!.amend(f.account, speeding.id, speeding.revision, { paymentRestricted: true }), (e: any) => e.code === 'PAYABLE_RESERVED');
  assert.equal((await f.run(execution.id)).state, 'SETTLED');
  assert.equal(f.wallet(), before - speeding.amountMinor);
});

test('AUTO-11: a discount applied before preparation is honored, so the rule pays the current amount', async t => {
  const f = fixture(t), speeding = f.fines().find(p => p.violation === 'Speeding')!, before = f.wallet();
  const discounted = f.police.payables!.amend(f.account, speeding.id, speeding.revision, { discountMinor: 5000 });
  assert.ok(discounted.amountMinor < speeding.amountMinor);
  const m = f.mandate();
  const execution = prepared(f.prepare(m.id, fineId(discounted)));
  assert.equal(execution.amountMinor, discounted.amountMinor);
  assert.equal((await f.run(execution.id)).state, 'SETTLED');
  assert.equal(f.wallet(), before - discounted.amountMinor);
});

test('AUTO-11: automatic and manual payments of one fine settle it once, in either order', async t => {
  const a = fixture(t), fineA = a.fines().find(p => p.violation === 'Speeding')!, ma = a.mandate();
  // The owner started paying by hand first: the rule cannot take the same fine.
  const manual = a.payments.orders!.create(a.actor, { provider: 'police', payableId: fineA.id, expectedPayableRevision: fineA.revision, methodId: 'wallet', expectedMethodVersion: 1 }, fineA);
  assert.throws(() => a.prepare(ma.id, fineId(fineA)), (e: any) => e.code === 'AUTOMATION_PAYABLE_RESERVED');
  assert.equal(manual.state, 'AWAITING_APPROVAL');
  assert.equal(a.db.automationRuns!.status('automation-operator').executionCount, 0);
  // The rule took the fine first: a manual review of the same fine is refused, and the fine is paid once.
  const b = fixture(t), fineB = b.fines().find(p => p.violation === 'Speeding')!, mb = b.mandate(), before = b.wallet();
  const execution = prepared(b.prepare(mb.id, fineId(fineB)));
  assert.throws(() => b.payments.orders!.create(b.actor, { provider: 'police', payableId: fineB.id, expectedPayableRevision: fineB.revision, methodId: 'wallet', expectedMethodVersion: 1 }, fineB), (e: any) => e.code === 'PAYABLE_RESERVED');
  assert.equal((await b.run(execution.id)).state, 'SETTLED');
  assert.equal(b.wallet(), before - fineB.amountMinor, 'one debit only');
  assert.throws(() => b.payments.orders!.create(b.actor, { provider: 'police', payableId: fineB.id, expectedPayableRevision: fineB.revision, methodId: 'wallet', expectedMethodVersion: 1 }, b.police.payables!.get(b.account, fineB.id)), (e: any) => ['PAYABLE_CHANGED', 'PAYABLE_UNAVAILABLE', 'PAYABLE_RESERVED'].includes(e.code));
  assert.equal(b.effects(), 1);
});

test('AUTO-11: the count approval holds: a second approved fine is skipped once the period count is used', async t => {
  const f = fixture(t), all = f.fines(), m = f.mandate({ fineTypes: ['Speeding', 'Parking overstay'], perPeriodCount: 1 });
  const first = prepared(f.prepare(m.id, fineId(all[0]!)));
  await f.run(first.id);
  f.backdate(first.id);
  assert.equal(skipped(f.prepare(m.id, fineId(all[1]!))).reason, 'OVER_PERIOD_BUDGET');
  assert.equal(f.status(all[1]!.id), 'UNPAID');
});

test('AUTO-11: the preview shows which fines the rule would pay and why the others wait for review', t => {
  const f = fixture(t), m = f.mandate();
  const view = f.payments.mandatePreview(f.actor, m.id, f.police.payables!.list(f.account));
  assert.ok(!view.blockers.includes('EXECUTION_NOT_SUPPORTED_YET'));
  const byLabel = new Map(view.candidates.map(c => [c.label.split(' · ')[0], c]));
  assert.equal(byLabel.get('Speeding')!.decision, 'DUE_NOW');
  assert.deepEqual([byLabel.get('Parking overstay')!.decision, byLabel.get('Parking overstay')!.reasons], ['SKIP', ['FINE_TYPE_NOT_APPROVED']]);
});

/** The scheduler and worker driven against one run, in-process. */
function loop(f: ReturnType<typeof fixture>, mandateId: string, clock: { now: number }) {
  const w = 'auto-worker', runs = f.db.automationRuns!, store = new JobStore(':memory:');
  const rule = () => runs.rules(w).find(r => r.mandateId === mandateId)! as unknown as ScheduledRule;
  const src: RuleSource = { rules: async () => [rule()], dueInvoices: async () => [], balanceMinor: async () => 0, newFines: async () => runs.fines(w, mandateId) };
  const gateway: ExecutionGateway = {
    prepare: async input => { const r = f.db.automationRuns!.prepare(w, { mandateId: input.mandateId, occurrenceKey: input.occurrenceKey, requestKey: input.requestKey }); return 'skipped' in r ? { skipped: true, reason: r.reason } : { id: r.id, runId: r.runId, orderId: r.orderId! }; },
    credential: async () => ({ accessToken: 'in-process', expiresAt: clock.now + 90_000 }),
    execute: async (_run, executionId) => { const o = await f.run(executionId); return { id: o.id, state: o.state, fundsCaptured: o.fundsCaptured, failureCode: (o as { failureCode?: string }).failureCode }; },
  };
  const scheduler = new Scheduler(store, src), worker = new AutomationWorker(store, gateway, { workerId: 'w1', clock: () => clock.now, sleep: async () => {}, leaseMs: 30_000 });
  return { store, tick: () => scheduler.tick(clock.now), drain: () => worker.drain(), jobs: () => store.list().map(j => [j.occurrenceKey.replace(/^FINE:.*-(\d+)$/, 'FINE#$1'), j.state]) };
}

test('AUTO-11: each fine is its own occurrence; fines arriving together are paid one at a time after the cooldown, never as a burst', async t => {
  const f = fixture(t), m = f.mandate({ fineTypes: ['Speeding', 'Parking overstay'] }), clock = { now: Date.now() }, l = loop(f, m.id, clock);
  await Promise.all([l.tick(), l.tick()]);
  assert.equal(l.store.list().length, 2, 'two fines, two occurrences, however many evaluations');
  await l.drain();
  assert.deepEqual(l.store.list().map(j => j.state).sort(), ['PREPARING', 'SETTLED'], 'the second fine waits out the cooldown instead of failing');
  assert.equal(f.fines().length, 1);
  f.backdate(l.store.list().find(j => j.state === 'SETTLED')!.executionId!);
  clock.now += 31_000;
  await l.drain();
  assert.deepEqual(l.store.list().map(j => j.state), ['SETTLED', 'SETTLED']);
  assert.equal(f.fines().length, 0);
  assert.equal(f.effects(), 2);
  await l.tick(); await l.drain();
  assert.equal(l.store.list().length, 2, 'paid fines are not announced again');
});
