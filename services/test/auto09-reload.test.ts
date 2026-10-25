import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AccountDatabase } from '../provider-simulator/src/database.ts';
import { ProviderEngine } from '../provider-simulator/src/engine.ts';
import { executeAutomaticOrder } from '../provider-simulator/src/automation-execution.ts';
import type { AutomationPreparation, AutomationSkip } from '../provider-simulator/src/automation-runs.ts';
import { actorFor } from '../../packages/backend-kit/src/context.ts';
import { JobStore } from '../automation-worker/src/jobs.ts';
import { AutomationWorker, type ExecutionGateway } from '../automation-worker/src/worker.ts';
import { Scheduler, type RuleSource, type ScheduledRule } from '../automation-worker/src/scheduler.ts';

// AUTO-09: a low wallet balance reloads from an approved card once, within finite caps, without looping on its own
// credits or on refunds, and a decline, challenge or revocation stops further charges.
const owner = { sub: 'auto-owner', authorization: 'Bearer broker-bound' };
const prepared = (r: AutomationPreparation | AutomationSkip) => { assert.equal((r as AutomationSkip).skipped, undefined, `skip ${(r as AutomationSkip).reason}`); return r as AutomationPreparation; };
const skipped = (r: AutomationPreparation | AutomationSkip) => { assert.equal((r as AutomationSkip).skipped, true, 'expected a skip'); return r as AutomationSkip; };
type Trigger = { belowMinor: number; reloadMinor: number; targetBalanceMinor: number };

function fixture(t: { after(fn: () => void): void }, preset = 'approved') {
  const root = mkdtempSync(join(tmpdir(), 'cityside-auto-')), path = join(root, 'payments.sqlite');
  const context = { root, operatorSub: 'automation-operator', workerSub: 'auto-worker', runId: `autorn_${randomUUID()}` };
  const db = new AccountDatabase(path), actor = actorFor({ sub: 'auto-owner' }, undefined, 'Bearer owner');
  const payments = new ProviderEngine('payments', db, { automationRun: context, automationIo: { readPayables: () => [], providerStore: () => { throw new Error('A reload has no source provider.'); } } });
  db.accounts(actor.sub); payments.seed(actor);
  t.after(() => { db.close(); try { rmSync(root, { recursive: true, force: true }); } catch { /* Windows may briefly hold the directory */ } });
  const account = actor.accountId, card = payments.execute(actor, 'POST', '/payment-methods', { preset, nickname: `Reload ${preset}` }).data.method as { id: string; version: number };
  let spendN = 0;
  const wallet = () => payments.ledger!.summary(account).balanceMinor;
  /** A payment from the wallet to someone else: the qualifying external debit. */
  const spendTo = (balanceMinor: number) => { const amount = wallet() - balanceMinor; assert.ok(amount > 0, 'spend lowers the balance'); payments.ledger!.record(account, 'PAYMENT', `charge:spend-${++spendN}`, amount, 'wallet'); };
  const mandate = (trigger: Partial<Trigger> = {}, limits: Record<string, number> = {}, source = card) => {
    const policy = { actorClientId: 'cityside-automation' as const, audience: 'provider-api' as const, operation: 'WALLET_RELOAD' as const, purpose: 'Keep my wallet topped up', currency: 'AED' as const,
      target: { kind: 'WALLET' as const }, sources: [{ methodId: source.id, expectedVersion: source.version }], fallback: { mode: 'NONE' as const },
      trigger: { type: 'LOW_BALANCE' as const, belowMinor: 1000, reloadMinor: 5000, targetBalanceMinor: 20000, ...trigger },
      timezone: 'Asia/Dubai', startsAt: new Date(Date.now() - 60000).toISOString(), expiresAt: new Date(Date.now() + 30 * 86400000).toISOString(),
      limits: { perPaymentMinor: 50000, periodMinor: 100000, lifetimeMinor: 200000, period: 'MONTH' as const, perPeriodCount: 5, lifetimeCount: 20, cooldownSeconds: 60, ...limits } };
    const created = payments.mandates!.create(actor, policy);
    return payments.mandates!.approve(actor, created.id, created.version, created.approvalDigest);
  };
  const prepare = (mandateId: string, occurrenceKey = 'occ_1') => db.automationRuns!.prepare('auto-worker', { mandateId, occurrenceKey, requestKey: `req_${randomUUID()}` });
  const consumed: Record<string, unknown>[] = [];
  const deps = { runs: db.automationRuns!, orders: payments.orders!, funding: payments.funding!, checkout: undefined as never, client: undefined as never,
    authority: async (_a: string | undefined, op: Record<string, unknown>) => { consumed.push(op); }, session: async () => ({ executionId: String(consumed.at(-1)?.executionId) }) };
  const run = (executionId: string) => executeAutomaticOrder(deps, owner, executionId);
  const backdate = (executionId: string) => { const row = JSON.parse(String(db.db.prepare('SELECT body FROM automation_executions WHERE id=?').get(executionId)!.body)); db.db.prepare('UPDATE automation_executions SET body=? WHERE id=?').run(JSON.stringify({ ...row, preparedAt: new Date(Date.now() - 3600000).toISOString() }), executionId); };
  return { db, payments, actor, account, card, wallet, spendTo, mandate, prepare, run, deps, consumed, backdate, spent: () => payments.issuer!.summary(account, card.id).spentMinor };
}

test('AUTO-09: a low balance reloads once from the approved card, and ordinary funding APIs cannot touch the automatic order', async t => {
  const f = fixture(t), m = f.mandate();
  assert.equal(skipped(f.prepare(m.id, 'occ_high')).reason, 'BALANCE_ABOVE_THRESHOLD');
  f.spendTo(800);
  const execution = prepared(f.prepare(m.id, 'occ_low'));
  assert.equal(execution.kind, 'WALLET_RELOAD');
  assert.equal(execution.amountMinor, 5000);
  assert.equal(execution.sourceId, f.card.id);
  const order = f.payments.funding!.get(f.actor, execution.orderId!);
  assert.equal(order.state, 'AWAITING_APPROVAL');
  const decide = { expectedVersion: order.version, approvalDigest: order.approvalDigest };
  const refused = (e: any) => e.code === 'ORDER_AUTOMATIC';
  assert.throws(() => f.payments.funding!.approve(f.actor, order.id, decide), refused);
  assert.throws(() => f.payments.funding!.execute(f.actor, order.id, decide), refused);
  assert.throws(() => f.payments.funding!.challenge(f.actor, order.id, { ...decide, challengeId: 'c', decision: 'APPROVE' }, true), refused);
  assert.throws(() => f.payments.funding!.cancel(f.actor, order.id, order.version), refused);
  assert.equal(f.wallet(), 800, 'preparation and refused calls moved nothing');
  const settled = await f.run(execution.id);
  assert.equal(settled.state, 'SETTLED');
  assert.equal(f.wallet(), 5800);
  assert.equal(f.spent(), 5000);
  assert.equal((await f.run(execution.id)).state, 'SETTLED', 'redelivery returns the settled reload');
  assert.equal(f.wallet(), 5800, 'and credits nothing twice');
  assert.equal(f.consumed.length, 1);
});

test('AUTO-09: the reload is finite: capped by the target balance, the per-payment cap and the budget', async t => {
  const a = fixture(t), ma = a.mandate({ belowMinor: 19999, reloadMinor: 5000, targetBalanceMinor: 20000 });
  a.spendTo(18500);
  assert.equal(prepared(a.prepare(ma.id)).amountMinor, 1500, 'never past the target balance');
  const b = fixture(t), mb = b.mandate({ belowMinor: 19999, reloadMinor: 5000, targetBalanceMinor: 20000 });
  b.spendTo(19950);
  assert.equal(skipped(b.prepare(mb.id)).reason, 'NOTHING_TO_RELOAD');
  // A reload larger than the per-payment cap cannot even be approved as a rule.
  assert.throws(() => fixture(t).mandate({}, { perPaymentMinor: 3000 }), (e: any) => e.code === 'INVALID_RELOAD_POLICY');
  const d = fixture(t), md = d.mandate({}, { perPaymentMinor: 5000, periodMinor: 7000 });
  d.spendTo(800);
  const first = prepared(d.prepare(md.id, 'occ_a'));
  await d.run(first.id);
  d.backdate(first.id);
  d.spendTo(600);
  assert.equal(skipped(d.prepare(md.id, 'occ_b')).reason, 'OVER_PERIOD_BUDGET', 'a second reload would pass the period budget');
  assert.equal(d.spent(), 5000);
});

test('AUTO-09: concurrent threshold events create one reload; a second occurrence cannot open another while one is active', async t => {
  const f = fixture(t), m = f.mandate();
  f.spendTo(800);
  const first = prepared(f.prepare(m.id, 'occ_a')), again = prepared(f.prepare(m.id, 'occ_a'));
  assert.equal(again.id, first.id, 'the same occurrence is the same execution');
  f.backdate(first.id);
  assert.throws(() => f.prepare(m.id, 'occ_b'), (e: any) => e.code === 'FUNDING_IN_PROGRESS');
  assert.equal(f.db.automationRuns!.status('automation-operator').executionCount, 1, 'the refused occurrence reserved nothing');
  assert.equal((await f.run(first.id)).state, 'SETTLED');
  assert.equal(f.wallet(), 5800);
});

test('AUTO-09: a decline fails visibly and releases; a challenge holds; neither charges or credits anything', async t => {
  const declined = fixture(t, 'declined'), md = declined.mandate();
  declined.spendTo(800);
  const failed = await declined.run(prepared(declined.prepare(md.id)).id);
  assert.equal(failed.state, 'FAILED');
  assert.equal((failed as { failureCode?: string }).failureCode, 'CARD_DECLINED');
  assert.equal(declined.wallet(), 800);
  assert.equal(declined.db.automationRuns!.status('automation-operator').reservedMinor, 0, 'the reservation was released');
  assert.equal(declined.spent(), 0);
  const challenged = fixture(t, 'challenge'), mc = challenged.mandate();
  challenged.spendTo(800);
  const execution = prepared(challenged.prepare(mc.id));
  const held = await challenged.run(execution.id);
  assert.equal(held.state, 'REQUIRES_ACTION');
  assert.equal(challenged.wallet(), 800);
  assert.equal(challenged.db.automationRuns!.released(execution.id), false, 'the challenge keeps its reservation');
  assert.equal((await challenged.run(execution.id)).state, 'REQUIRES_ACTION', 'redelivery neither answers it nor charges');
});

test('AUTO-09: revoking the rule, or a balance that recovered, stops the reload at admission', async t => {
  const revoked = fixture(t), mr = revoked.mandate();
  revoked.spendTo(800);
  const first = prepared(revoked.prepare(mr.id));
  revoked.payments.mandates!.revoke(revoked.actor, mr.id, mr.version);
  await assert.rejects(revoked.run(first.id), (e: any) => e.code === 'AUTOMATION_ADMISSION_REJECTED');
  assert.equal(revoked.wallet(), 800);
  assert.equal(revoked.spent(), 0);
  const healed = fixture(t), mh = healed.mandate();
  healed.spendTo(800);
  const second = prepared(healed.prepare(mh.id));
  healed.payments.ledger!.record(healed.account, 'TOPUP', 'wallet-funding:owner-topped-up', 10000, 'external');
  await assert.rejects(healed.run(second.id), (e: any) => e.code === 'AUTOMATION_ADMISSION_REJECTED');
  assert.equal(healed.wallet(), 10800, 'the reload is not applied on top of an owner top-up');
  assert.equal(healed.spent(), 0);
  assert.equal(healed.db.automationRuns!.released(second.id), true);
});

/** The scheduler and worker driven against one run, in-process: the same loop the real worker runs over HTTP. */
function loop(f: ReturnType<typeof fixture>, mandateId: string, store = new JobStore(':memory:')) {
  const w = 'auto-worker', runs = f.db.automationRuns!;
  const rule = () => runs.rules(w).find(r => r.mandateId === mandateId)! as unknown as ScheduledRule;
  const source: RuleSource = { rules: async () => [rule()], dueInvoices: async () => [], balanceMinor: async () => runs.balanceMinor(w, mandateId).balanceMinor, balance: async () => runs.balanceMinor(w, mandateId) };
  const gateway: ExecutionGateway = {
    prepare: async input => { const r = f.prepare(input.mandateId, input.occurrenceKey); return 'skipped' in r ? { skipped: true, reason: r.reason } : { id: r.id, runId: r.runId, orderId: r.orderId! }; },
    credential: async () => ({ accessToken: 'in-process', expiresAt: Date.now() + 90_000 }),
    execute: async (_run, executionId) => { const o = await f.run(executionId); return { id: o.id, state: o.state, fundsCaptured: o.fundsCaptured, failureCode: (o as { failureCode?: string }).failureCode }; },
  };
  const scheduler = new Scheduler(store, source), worker = new AutomationWorker(store, gateway, { workerId: 'w1', sleep: async () => {}, leaseMs: 30_000 });
  return { store, tick: (at = Date.now()) => scheduler.tick(at), drain: () => worker.drain(), jobs: () => store.list().map(j => [j.occurrenceKey, j.state]) };
}

test('AUTO-09: the reload never loops on its own credit or on a refund; only a new payment can trigger the next one', async t => {
  const f = fixture(t), m = f.mandate(), l = loop(f, m.id);
  await l.tick();
  assert.deepEqual(l.jobs(), [], 'a healthy wallet schedules nothing');
  f.spendTo(800);
  assert.equal((await Promise.all([l.tick(), l.tick()])).flatMap(r => r.enqueued).length, 1, 'concurrent evaluations of one dip fire once');
  await l.drain();
  assert.deepEqual(l.jobs(), [['THR:1', 'SETTLED']]);
  assert.equal(f.wallet(), 5800);
  // The reload's own credit lifts the wallet above the threshold: the trigger re-arms and nothing fires.
  await l.tick(); await l.tick();
  assert.deepEqual(l.jobs(), [['THR:1', 'SETTLED']]);
  assert.equal(f.spent(), 5000, 'the reload did not charge itself again');
  // Refunding the reload drops the balance below the threshold without any new payment: still nothing fires.
  f.payments.ledger!.reverseFunding(f.account, 'refund-of-reload', 5000);
  assert.equal(f.wallet(), 800);
  await l.tick(); await l.tick();
  assert.deepEqual(l.jobs(), [['THR:1', 'SETTLED']], 'a refund is not a qualifying debit');
  // A new payment from the wallet is: the next dip reloads once more.
  const first = l.store.list()[0]!;
  f.backdate(first.executionId!);
  f.spendTo(700);
  await l.tick(); await l.drain();
  assert.deepEqual(l.jobs(), [['THR:1', 'SETTLED'], ['THR:2', 'SETTLED']]);
  assert.equal(f.wallet(), 5700);
  assert.equal(f.spent(), 10000);
});

test('AUTO-09: a declined card stops the loop: the occurrence is not retried and later dips do not charge until the wallet recovers', async t => {
  const f = fixture(t, 'declined'), m = f.mandate(), l = loop(f, m.id);
  f.spendTo(800);
  await l.tick(); await l.drain();
  assert.deepEqual(l.jobs(), [['THR:1', 'FAILED']]);
  assert.equal(l.store.get(l.store.list()[0]!.id)!.reason, 'CARD_DECLINED');
  assert.deepEqual(l.store.outbox(l.store.list()[0]!.id).map(e => e.kind), ['PREPARED', 'REQUIRES_ACTION']);
  for (let i = 0; i < 3; i++) { await l.tick(); await l.drain(); }
  f.spendTo(500);
  await l.tick(); await l.drain();
  assert.deepEqual(l.jobs(), [['THR:1', 'FAILED']], 'still below the threshold, so the trigger stays disarmed');
  assert.equal(f.spent(), 0);
  assert.equal(f.wallet(), 500);
});

test('AUTO-09: the preview shows the finite reload a rule would make, and why it would not', t => {
  const f = fixture(t), m = f.mandate();
  const show = () => f.payments.mandatePreview(f.actor, m.id, []);
  const healthy = show();
  assert.equal(healthy.wouldRun, false);
  assert.deepEqual(healthy.candidates.map(c => [c.amountMinor, c.decision, c.reasons]), [[0, 'SKIP', ['BALANCE_ABOVE_THRESHOLD']]]);
  assert.ok(!healthy.blockers.includes('EXECUTION_NOT_SUPPORTED_YET'), 'reload rules are supported');
  f.spendTo(800);
  const low = show();
  assert.equal(low.wouldRun, true);
  assert.deepEqual(low.candidates.map(c => [c.amountMinor, c.decision, c.reasons]), [[5000, 'DUE_NOW', []]]);
  assert.equal(low.source.usable, true);
  assert.equal(f.wallet(), 800, 'previewing a reload moves nothing');
});
