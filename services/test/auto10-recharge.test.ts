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

// AUTO-10: a toll tag or prepaid number is recharged once per eligible low-balance occurrence, only by usage on the
// exact approved target, within cost, count and cooldown caps, and never by borrowing from another source or rule.
type Source = 'rta' | 'etisalat' | 'du';
const owner = { sub: 'auto-owner', authorization: 'Bearer broker-bound' };
const prepared = (r: AutomationPreparation | AutomationSkip) => { assert.equal((r as AutomationSkip).skipped, undefined, `skip ${(r as AutomationSkip).reason}`); return r as AutomationPreparation; };
const skipped = (r: AutomationPreparation | AutomationSkip) => { assert.equal((r as AutomationSkip).skipped, true, 'expected a skip'); return r as AutomationSkip; };

function fixture(t: { after(fn: () => void): void }, provider: Source = 'rta', preset?: string) {
  const root = mkdtempSync(join(tmpdir(), 'cityside-auto-')), path = join(root, 'payments.sqlite');
  const context = { root, operatorSub: 'automation-operator', workerSub: 'auto-worker', runId: `autorn_${randomUUID()}` };
  const db = new AccountDatabase(path), sourceDb = new AccountDatabase(':memory:'), actor = actorFor({ sub: 'auto-owner' }, undefined, 'Bearer owner');
  const source = new ProviderEngine(provider, sourceDb);
  const payments = new ProviderEngine('payments', db, { automationRun: context, automationIo: {
    readPayables: () => [],
    recharges: (p: string) => p === provider ? source.recharges : undefined,
    providerStore: (p: string) => { if (p !== provider) throw new Error('No isolated store for this provider.'); return sourceDb; },
  } });
  db.accounts(actor.sub); sourceDb.accounts(actor.sub); payments.seed(actor); source.seed(actor);
  t.after(() => { db.close(); sourceDb.close(); try { removeTemp(root); } catch { /* Windows may briefly hold the directory */ } });
  const account = actor.accountId, target = source.recharges!.targets(account)[0]!;
  const card = preset ? payments.execute(actor, 'POST', '/payment-methods', { preset, nickname: `Recharge ${preset}` }).data.method as { id: string; version: number } : undefined;
  let n = 0, linked: { id: string; version: number } | undefined;
  const usage = (usageMinor: number, reference = target.reference) => source.lifecycle!.ingest(account, { kind: 'USAGE_RECORDED', eventId: `use-${++n}`, targetReference: reference, usageMinor });
  const balance = (reference = target.reference) => source.recharges!.targets(account).find(t => t.reference === reference)!.balanceMinor;
  const wallet = () => payments.ledger!.summary(account).balanceMinor;
  const mandate = (trigger: Partial<{ belowMinor: number; reloadMinor: number; targetBalanceMinor: number }> = {}, limits: Record<string, number> = {}, reference = target.reference) => {
    linked ??= db.transaction(() => payments.execute(actor, 'POST', '/billing-accounts', { provider, reference, nickname: 'Tag' })).data.billingAccount;
    const funding = card ?? { id: 'wallet', version: 1 };
    const policy = { actorClientId: 'cityside-automation' as const, audience: 'provider-api' as const, operation: 'RECHARGE' as const, purpose: 'Keep my tag or number recharged', currency: 'AED' as const,
      target: { kind: 'BILLER' as const, billingAccountId: linked!.id, expectedVersion: linked!.version, provider, reference }, sources: [{ methodId: funding.id, expectedVersion: funding.version }], fallback: { mode: 'NONE' as const },
      trigger: { type: 'LOW_BALANCE' as const, belowMinor: 1000, reloadMinor: target.denominationsMinor[0]!, targetBalanceMinor: 100000, ...trigger },
      timezone: 'Asia/Dubai', startsAt: new Date(Date.now() - 60000).toISOString(), expiresAt: new Date(Date.now() + 30 * 86400000).toISOString(),
      limits: { perPaymentMinor: 50000, periodMinor: 1000000, lifetimeMinor: 2000000, period: 'MONTH' as const, perPeriodCount: 5, lifetimeCount: 20, cooldownSeconds: 60, ...limits } };
    const created = payments.mandates!.create(actor, policy);
    return payments.mandates!.approve(actor, created.id, created.version, created.approvalDigest);
  };
  const prepare = (mandateId: string, occurrenceKey = 'occ_1') => db.automationRuns!.prepare('auto-worker', { mandateId, occurrenceKey, requestKey: `req_${randomUUID()}` });
  const settlement = new ProviderSettlements(sourceDb, provider, { call: async (acct, id, action, body: any) => action === 'claim' ? payments.claims!.claim(acct, id, provider, body) : action === 'ack' ? payments.claims!.acknowledge(acct, id, provider, body) : payments.claims!.release(acct, id, provider, body) });
  let effects = 0;
  const client = { call: async (_p: string, _a: unknown, method: string, p: string, body: any = {}, key = 'test') => {
    if (p.endsWith('/payments')) {
      const proof = payments.execute(actor, 'GET', `/charges/${body.paymentId}`, {}).data.charge, fp = createHash('sha256').update(JSON.stringify([method, p, body])).digest('hex');
      return (await settlement.execute(actor, key, fp, proof, claimed => { effects++; return source.execute(actor, method, p, body, claimed); })).data;
    }
    let gatewayOrder;
    if (p.endsWith('/admit') || p.endsWith('/cancel') || p.endsWith('/finish')) { const admission = source.admissions!.get(account, p.split('/')[4]); gatewayOrder = payments.orders!.get(actor, admission.orderId); }
    return sourceDb.transaction(() => source.execute(actor, method, p, body, undefined, undefined, gatewayOrder)).data;
  } } as unknown as ProviderClient;
  const consumed: Record<string, unknown>[] = [];
  const deps = { runs: db.automationRuns!, orders: payments.orders!, funding: payments.funding!, checkout: new PaymentCheckout(payments.orders!, client), client,
    authority: async (_a: string | undefined, op: Record<string, unknown>) => { consumed.push(op); }, session: async () => ({ executionId: String(consumed.at(-1)?.executionId) }) };
  const run = (executionId: string) => executeAutomaticOrder(deps, owner, executionId);
  const backdate = (executionId: string) => { const row = JSON.parse(String(db.db.prepare('SELECT body FROM automation_executions WHERE id=?').get(executionId)!.body)); db.db.prepare('UPDATE automation_executions SET body=? WHERE id=?').run(JSON.stringify({ ...row, preparedAt: new Date(Date.now() - 3600000).toISOString() }), executionId); };
  return { db, sourceDb, source, payments, actor, account, target, card, usage, balance, wallet, mandate, prepare, run, deps, consumed, backdate, effects: () => effects };
}

for (const provider of ['rta', 'etisalat', 'du'] as const) test(`AUTO-10 ${provider}: usage that takes the exact target below its threshold recharges it once`, async t => {
  const f = fixture(t, provider), m = f.mandate();
  assert.equal(skipped(f.prepare(m.id, 'occ_high')).reason, 'BALANCE_ABOVE_THRESHOLD');
  f.usage(f.balance() - 800);
  assert.equal(f.balance(), 800);
  const walletBefore = f.wallet(), reload = f.target.denominationsMinor[0]!;
  const execution = prepared(f.prepare(m.id, 'occ_low'));
  assert.equal(execution.kind, 'RECHARGE');
  assert.equal(execution.amountMinor, reload);
  assert.equal(f.payments.orders!.get(f.actor, execution.orderId!).state, 'AWAITING_APPROVAL');
  const order = f.payments.orders!.get(f.actor, execution.orderId!);
  assert.throws(() => f.payments.orders!.approve(f.actor, order.id, { expectedVersion: order.version, approvalDigest: order.approvalDigest }, undefined), (e: any) => e.code === 'ORDER_AUTOMATIC');
  assert.equal(f.balance(), 800, 'preparation moved nothing');
  const settled = await f.run(execution.id);
  assert.equal(settled.state, 'SETTLED', JSON.stringify(settled));
  assert.equal(f.balance(), 800 + reload);
  assert.equal(f.wallet(), walletBefore - reload);
  assert.equal(f.effects(), 1);
  assert.equal((await f.run(execution.id)).state, 'SETTLED', 'redelivery returns the settled recharge');
  assert.equal(f.balance(), 800 + reload);
  assert.equal(f.wallet(), walletBefore - reload);
  assert.equal(f.consumed.length, 1);
});

test('AUTO-10: only the exact approved target counts: another line or another provider cannot trigger a recharge', t => {
  const f = fixture(t, 'etisalat'), m = f.mandate();
  f.sourceDb.put(f.account, 'prepaid-line', { ...f.sourceDb.list(f.account, 'prepaid-line')[0], lineId: 'other-line', balanceMinor: 100 }, 'other-line');
  assert.ok(f.balance('other-line') < 1000, 'another line is low');
  assert.equal(skipped(f.prepare(m.id, 'occ_other')).reason, 'BALANCE_ABOVE_THRESHOLD', 'the approved line is healthy, so a low neighbour changes nothing');
  f.usage(100, 'other-line');
  assert.deepEqual(f.db.automationRuns!.balanceMinor('auto-worker', m.id), { balanceMinor: f.balance(), qualifyingDebits: 0 }, 'usage on another line is not usage on this target');
  f.usage(f.balance() - 500);
  assert.deepEqual(f.db.automationRuns!.balanceMinor('auto-worker', m.id), { balanceMinor: 500, qualifyingDebits: 1 });
  // Usage recorded at a different provider (a toll event with the same reference) is not usage of this rule's provider.
  const rta = fixture(t, 'rta');
  rta.usage(100, f.target.reference);
  assert.equal(f.db.automationRuns!.balanceMinor('auto-worker', m.id).qualifyingDebits, 1, 'only events at the rule\'s own provider count');
});

test('AUTO-10: the amount, target ceiling, per-payment cap, count and cooldown all hold', async t => {
  const a = fixture(t), ma = a.mandate({ belowMinor: 1000, targetBalanceMinor: 5100 });
  a.usage(a.balance() - 200);
  assert.equal(skipped(a.prepare(ma.id)).reason, 'WOULD_EXCEED_TARGET_BALANCE', 'a recharge may not carry the balance past its target');
  const b = fixture(t), mb = b.mandate({ reloadMinor: b.target.denominationsMinor[0]! }, { cooldownSeconds: 60, perPeriodCount: 1 });
  b.usage(b.balance() - 500);
  const first = prepared(b.prepare(mb.id, 'occ_a'));
  assert.equal((await b.run(first.id)).state, 'SETTLED');
  b.backdate(first.id);
  b.usage(b.balance() - 500);
  assert.equal(skipped(b.prepare(mb.id, 'occ_b')).reason, 'OVER_PERIOD_BUDGET', 'the per-period count is one');
  const c = fixture(t), mc = c.mandate({}, { cooldownSeconds: 3600 });
  c.usage(c.balance() - 500);
  prepared(c.prepare(mc.id, 'occ_a'));
  assert.throws(() => c.prepare(mc.id, 'occ_b'), (e: any) => e.code === 'AUTOMATION_RECHARGE_IN_PROGRESS' || e.code === 'AUTOMATION_COOLDOWN');
  assert.throws(() => fixture(t).mandate({ reloadMinor: 99999 }, { perPaymentMinor: 5000 }), (e: any) => e.code === 'INVALID_RELOAD_POLICY');
});

test('AUTO-10: one recharge is open per rule; a second occurrence cannot start another until the first finishes', async t => {
  const f = fixture(t), m = f.mandate();
  f.usage(f.balance() - 500);
  const first = prepared(f.prepare(m.id, 'occ_a'));
  assert.equal(prepared(f.prepare(m.id, 'occ_a')).id, first.id, 'the same occurrence is the same execution');
  f.backdate(first.id);
  assert.throws(() => f.prepare(m.id, 'occ_b'), (e: any) => e.code === 'AUTOMATION_RECHARGE_IN_PROGRESS');
  assert.equal(f.db.automationRuns!.status('automation-operator').executionCount, 1);
  assert.equal((await f.run(first.id)).state, 'SETTLED');
  f.usage(f.balance() - 500);
  prepared(f.prepare(m.id, 'occ_b'));
});

test('AUTO-10: insufficient funds fail visibly, release the reservation and trigger no other charge', async t => {
  const f = fixture(t), m = f.mandate();
  f.usage(f.balance() - 500);
  f.payments.ledger!.record(f.account, 'PAYMENT', 'charge:drain', f.wallet() - 100, 'wallet');
  const walletBefore = f.wallet(), targetBefore = f.balance();
  const execution = prepared(f.prepare(m.id));
  const failed = await f.run(execution.id);
  assert.equal(failed.state, 'FAILED');
  assert.equal((failed as { failureCode?: string }).failureCode, 'INSUFFICIENT_AVAILABLE_FUNDS');
  assert.equal(f.wallet(), walletBefore);
  assert.equal(f.balance(), targetBefore, 'the target was not recharged from anywhere else');
  assert.equal(f.db.automationRuns!.released(execution.id), true);
  assert.equal(f.db.automationRuns!.status('automation-operator').executionCount, 0, 'nothing stays reserved');
  assert.equal(f.effects(), 0);
});

test('AUTO-10: a recharge that went stale before admission, or a revoked rule, charges nothing', async t => {
  const stale = fixture(t), ms = stale.mandate();
  stale.usage(stale.balance() - 500);
  const execution = prepared(stale.prepare(ms.id));
  const staleWallet = stale.wallet();
  stale.usage(1); // the balance moves after preparation, so the provider quote no longer matches
  await assert.rejects(stale.run(execution.id), (e: any) => e.code === 'AUTOMATION_ADMISSION_REJECTED');
  assert.equal(stale.wallet(), staleWallet, 'a stale quote moved no wallet money');
  assert.equal(stale.effects(), 0);
  assert.equal(stale.db.automationRuns!.released(execution.id), true);
  const revoked = fixture(t), mr = revoked.mandate();
  revoked.usage(revoked.balance() - 500);
  const second = prepared(revoked.prepare(mr.id));
  const walletBefore = revoked.wallet();
  revoked.payments.mandates!.revoke(revoked.actor, mr.id, mr.version);
  await assert.rejects(revoked.run(second.id), (e: any) => e.code === 'AUTOMATION_ADMISSION_REJECTED');
  assert.equal(revoked.wallet(), walletBefore);
  assert.equal(revoked.effects(), 0);
});

test('AUTO-10: a declined card fails as requiring action and is not retried or replaced by the wallet', async t => {
  const f = fixture(t, 'rta', 'declined'), m = f.mandate();
  f.usage(f.balance() - 500);
  const walletBefore = f.wallet(), targetBefore = f.balance();
  const failed = await f.run(prepared(f.prepare(m.id)).id);
  assert.equal(failed.state, 'FAILED');
  assert.equal((failed as { failureCode?: string }).failureCode, 'CARD_DECLINED');
  assert.equal(f.wallet(), walletBefore, 'no wallet fallback');
  assert.equal(f.balance(), targetBefore);
});

/** The scheduler and worker driven against one run, in-process. */
function loop(f: ReturnType<typeof fixture>, mandateId: string) {
  const w = 'auto-worker', runs = f.db.automationRuns!, store = new JobStore(':memory:');
  const rule = () => runs.rules(w).find(r => r.mandateId === mandateId)! as unknown as ScheduledRule;
  const src: RuleSource = { rules: async () => [rule()], dueInvoices: async () => [], balanceMinor: async () => runs.balanceMinor(w, mandateId).balanceMinor, balance: async () => runs.balanceMinor(w, mandateId) };
  const gateway: ExecutionGateway = {
    prepare: async input => { const r = f.prepare(input.mandateId, input.occurrenceKey); return 'skipped' in r ? { skipped: true, reason: r.reason } : { id: r.id, runId: r.runId, orderId: r.orderId! }; },
    credential: async () => ({ accessToken: 'in-process', expiresAt: Date.now() + 90_000 }),
    execute: async (_run, executionId) => { const o = await f.run(executionId); return { id: o.id, state: o.state, fundsCaptured: o.fundsCaptured, failureCode: (o as { failureCode?: string }).failureCode }; },
  };
  const scheduler = new Scheduler(store, src), worker = new AutomationWorker(store, gateway, { workerId: 'w1', sleep: async () => {}, leaseMs: 30_000 });
  return { store, tick: () => scheduler.tick(Date.now()), drain: () => worker.drain(), jobs: () => store.list().map(j => [j.occurrenceKey, j.state]) };
}

test('AUTO-10: usage drives the loop: one recharge per dip, none while it stays low, none for other targets, and a later usage triggers the next', async t => {
  const f = fixture(t, 'etisalat'), m = f.mandate(), l = loop(f, m.id);
  await l.tick();
  assert.deepEqual(l.jobs(), [], 'a healthy target schedules nothing');
  f.sourceDb.put(f.account, 'prepaid-line', { ...f.sourceDb.list(f.account, 'prepaid-line')[0], lineId: 'other-line', balanceMinor: 100 }, 'other-line');
  f.usage(50, 'other-line');
  await l.tick();
  assert.deepEqual(l.jobs(), [], 'a neighbour running low is not this rule');
  f.usage(f.balance() - 500);
  assert.equal((await Promise.all([l.tick(), l.tick()])).flatMap(r => r.enqueued).length, 1, 'concurrent evaluations of one dip fire once');
  await l.drain();
  assert.deepEqual(l.jobs(), [['THR:1', 'SETTLED']]);
  const recharged = f.balance();
  assert.ok(recharged >= 1000, 'the recharge lifted the target above its threshold');
  await l.tick(); await l.tick();
  assert.deepEqual(l.jobs(), [['THR:1', 'SETTLED']], 'the recharge never triggers itself');
  f.backdate(l.store.list()[0]!.executionId!);
  f.usage(recharged - 400);
  await l.tick(); await l.drain();
  assert.deepEqual(l.jobs(), [['THR:1', 'SETTLED'], ['THR:2', 'SETTLED']]);
  assert.equal(f.effects(), 2);
});

test('AUTO-10: a failed recharge starts no reload or other chain', async t => {
  const f = fixture(t), m = f.mandate(), l = loop(f, m.id);
  f.payments.ledger!.record(f.account, 'PAYMENT', 'charge:drain', f.wallet() - 100, 'wallet');
  f.usage(f.balance() - 500);
  await l.tick(); await l.drain();
  assert.deepEqual(l.jobs(), [['THR:1', 'FAILED']]);
  for (let i = 0; i < 3; i++) { await l.tick(); await l.drain(); }
  assert.deepEqual(l.jobs(), [['THR:1', 'FAILED']], 'the job failed once and nothing chained from it');
  assert.deepEqual(l.store.outbox(l.store.list()[0]!.id).map(e => e.kind), ['PREPARED', 'REQUIRES_ACTION']);
  assert.equal(f.db.automationRuns!.status('automation-operator').executionCount, 0);
});

test('AUTO-10: the preview forecasts the recharge a rule would make from usage on its exact target', t => {
  const f = fixture(t, 'etisalat'), m = f.mandate();
  const show = () => f.payments.mandatePreview(f.actor, m.id, []);
  const healthy = show();
  assert.ok(!healthy.blockers.includes('EXECUTION_NOT_SUPPORTED_YET'));
  assert.deepEqual(healthy.candidates.map(c => [c.decision, c.reasons]), [['SKIP', ['BALANCE_ABOVE_THRESHOLD']]]);
  f.usage(f.balance() - 500);
  const low = show();
  assert.equal(low.wouldRun, true);
  assert.deepEqual(low.candidates.map(c => [c.amountMinor, c.decision]), [[f.target.denominationsMinor[0], 'DUE_NOW']]);
  assert.equal(f.balance(), 500, 'previewing a recharge moves nothing');
  assert.equal(f.db.automationRuns!.status('automation-operator').executionCount, 0);
});
