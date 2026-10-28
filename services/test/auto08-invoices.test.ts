import { removeTemp } from '../../test/support/temp-cleanup.ts';
import test, { beforeEach } from 'node:test';
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

// AUTO-08: an eligible current utility or telecom invoice settles once within limits; paid, withdrawn, over-cap
// and expired-source cases skip with a reason; declines, challenges and short funds stay visible and never fall back.
type Bills = 'dewa' | 'etisalat' | 'du';
// Seeded month-end invoices must not enter this suite's due window as the wall clock advances.
beforeEach(t => t.mock.timers.enable({ apis: ['Date'], now: Date.UTC(2026, 9, 24, 12) }));
const owner = { sub: 'auto-owner', authorization: 'Bearer broker-bound' };
const prepared = (r: AutomationPreparation | AutomationSkip) => { assert.equal((r as AutomationSkip).skipped, undefined, `skip ${(r as AutomationSkip).reason}`); return r as AutomationPreparation; };
const skipped = (r: AutomationPreparation | AutomationSkip) => { assert.equal((r as AutomationSkip).skipped, true, 'expected a skip'); return r as AutomationSkip; };

function fixture(t: { after(fn: () => void): void }, provider: Bills = 'dewa') {
  const root = mkdtempSync(join(tmpdir(), 'cityside-auto-')), path = join(root, 'payments.sqlite');
  const context = { root, operatorSub: 'automation-operator', workerSub: 'auto-worker', runId: `autorn_${randomUUID()}` };
  const db = new AccountDatabase(path), sourceDb = new AccountDatabase(':memory:'), actor = actorFor({ sub: 'auto-owner' }, undefined, 'Bearer owner');
  const source = new ProviderEngine(provider, sourceDb);
  const payments = new ProviderEngine('payments', db, { automationRun: context, automationIo: {
    readPayables: (accountId: string, p: string) => p === provider ? source.payables!.list(accountId) : [],
    providerStore: (p: string) => { if (p !== provider) throw new Error('No isolated store for this provider.'); return sourceDb; },
  } });
  db.accounts(actor.sub); sourceDb.accounts(actor.sub); payments.seed(actor); source.seed(actor);
  t.after(() => { db.close(); sourceDb.close(); try { removeTemp(root); } catch { /* Windows may briefly hold the directory */ } });
  const account = actor.accountId;
  const reference = provider === 'dewa' ? String(sourceDb.get(account, 'consumption')!.accountNumber) : String((sourceDb.list(account, 'subscription').find((s: { status?: string }) => s.status === 'ACTIVE') as { subscriptionId: string }).subscriptionId);
  let n = 0;
  const bill = (amountAED: number, dueOffsetDays = 1) => {
    const billId = `bill-${++n}`, dueDate = new Date(Date.now() + dueOffsetDays * 86400000).toISOString().slice(0, 10);
    const result = source.lifecycle!.ingest(account, { kind: 'INVOICE_ISSUED', eventId: `issue-${billId}`, billId, reference, amountMinor: Math.round(amountAED * 100), dueDate, period: dueDate.slice(0, 7) });
    assert.equal(result.outcome, 'APPLIED', JSON.stringify(result));
    return `${provider}:bill:${billId}`;
  };
  const card = (preset: string) => payments.execute(actor, 'POST', '/payment-methods', { preset, nickname: `Auto ${preset}` }).data.method as { id: string; version: number };
  let linked: { id: string; version: number } | undefined;
  const mandate = (opts: { source?: { id: string; version: number }; perPaymentMinor?: number } = {}) => {
    linked ??= db.transaction(() => payments.execute(actor, 'POST', '/billing-accounts', { provider, reference, nickname: 'Home' })).data.billingAccount;
    const billing = linked!;
    const funding = opts.source ?? { id: 'wallet', version: 1 };
    const policy = { actorClientId: 'cityside-automation' as const, audience: 'provider-api' as const, operation: 'BILL_PAYMENT' as const, purpose: 'Pay approved bills automatically', currency: 'AED' as const,
      target: { kind: 'BILLER' as const, billingAccountId: billing.id, expectedVersion: billing.version, provider, reference }, sources: [{ methodId: funding.id, expectedVersion: funding.version }], fallback: { mode: 'NONE' as const },
      trigger: { type: 'INVOICE_DUE' as const, daysBefore: 3 }, timezone: 'Asia/Dubai', startsAt: new Date(Date.now() - 60000).toISOString(), expiresAt: new Date(Date.now() + 30 * 86400000).toISOString(),
      limits: { perPaymentMinor: opts.perPaymentMinor ?? 50000, periodMinor: 1000000, lifetimeMinor: 2000000, period: 'MONTH' as const, perPeriodCount: 5, lifetimeCount: 20, cooldownSeconds: 60 } };
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
    if (p.endsWith('/admit') || p.endsWith('/cancel')) { const admission = source.admissions!.get(account, p.split('/')[4]); gatewayOrder = payments.orders!.get(actor, admission.orderId); }
    return sourceDb.transaction(() => source.execute(actor, method, p, body, undefined, undefined, gatewayOrder)).data;
  } } as unknown as ProviderClient;
  const consumed: Record<string, unknown>[] = [];
  const deps = { runs: db.automationRuns!, orders: payments.orders!, funding: payments.funding!, checkout: new PaymentCheckout(payments.orders!, client), client,
    authority: async (_a: string | undefined, op: Record<string, unknown>) => { consumed.push(op); }, session: async () => ({ executionId: String(consumed.at(-1)?.executionId) }) };
  const wallet = () => payments.ledger!.summary(account).balanceMinor;
  return { db, sourceDb, source, payments, actor, account, provider, bill, card, mandate, prepare, deps, consumed, effects: () => effects, wallet, status: (id: string) => source.payables!.get(account, id).status };
}
const run = (f: ReturnType<typeof fixture>, executionId: string) => executeAutomaticOrder(f.deps, owner, executionId);

for (const provider of ['dewa', 'etisalat', 'du'] as const) test(`AUTO-08 ${provider}: an eligible current invoice settles once from the wallet within limits`, async t => {
  const f = fixture(t, provider), m = f.mandate(), id = f.bill(150), before = f.wallet();
  const execution = prepared(f.prepare(m.id));
  assert.equal(execution.payableId, id);
  const settled = await run(f, execution.id);
  assert.equal(settled.state, 'SETTLED');
  assert.equal(f.status(id), 'PAID');
  assert.equal(f.wallet(), before - 15000);
  assert.equal(f.effects(), 1);
  assert.equal((await run(f, execution.id)).state, 'SETTLED', 'redelivery returns the settled order');
  assert.equal(f.effects(), 1);
  assert.equal(f.wallet(), before - 15000);
  // The paid invoice is not offered again: the next occurrence skips with a reason.
  assert.equal(skipped(f.prepare(m.id, 'occ_next')).reason, 'NO_DUE_INVOICE');
});

test('AUTO-08: paid, withdrawn, over-cap and expired-source cases skip with a reason and move nothing', async t => {
  const f = fixture(t), before = f.wallet();
  const m = f.mandate({ perPaymentMinor: 20000 });
  assert.equal(skipped(f.prepare(m.id, 'occ_none')).reason, 'NO_DUE_INVOICE');
  const big = f.bill(500);
  assert.equal(skipped(f.prepare(m.id, 'occ_cap')).reason, 'OVER_PER_PAYMENT_CAP');
  assert.equal(f.status(big), 'UNPAID');
  const withdrawn = f.bill(100, 1);
  f.source.payables!.amend(f.account, withdrawn, f.source.payables!.get(f.account, withdrawn).revision, { status: 'CANCELLED' });
  const small = f.bill(100, 2);
  const only = prepared(f.prepare(m.id, 'occ_small'));
  assert.equal(only.payableId, small, 'a withdrawn invoice is never the one prepared');
  assert.equal(f.wallet(), before, 'preparation alone moves nothing');
  // A card that expires after the rule was approved is skipped with a reason, never replaced by another source.
  const card = f.card('approved'), cardRule = f.mandate({ source: card });
  f.db.put(f.account, 'payment-method', { ...f.db.get(f.account, 'payment-method', card.id)!, expiresYear: 2020, expiresMonth: 1 }, card.id);
  assert.equal(skipped(f.prepare(cardRule.id, 'occ_expired')).reason, 'SOURCE_EXPIRED');
  assert.equal(f.wallet(), before);
});

test('AUTO-08: a card pays an eligible invoice once and the wallet stays untouched', async t => {
  const f = fixture(t), card = f.card('approved'), m = f.mandate({ source: card }), id = f.bill(150), before = f.wallet();
  const settled = await run(f, prepared(f.prepare(m.id)).id);
  assert.equal(settled.state, 'SETTLED');
  assert.equal(f.status(id), 'PAID');
  assert.equal(f.payments.issuer!.summary(f.account, card.id).spentMinor, 15000);
  assert.equal(f.wallet(), before, 'no wallet money moved for a card-funded rule');
});

test('AUTO-08: a declined or over-limit card fails visibly, releases the reservation and never falls back to the wallet', async t => {
  for (const [preset, expected] of [['declined', 'CARD_DECLINED'], ['limited', 'CARD_LIMIT_EXCEEDED']] as const) {
    const f = fixture(t), card = f.card(preset), m = f.mandate({ source: card }), id = f.bill(150), before = f.wallet();
    const execution = prepared(f.prepare(m.id));
    const failed = await run(f, execution.id);
    assert.equal(failed.state, 'FAILED', preset);
    assert.equal(failed.failureCode, expected, preset);
    assert.equal(failed.fundsCaptured, false);
    assert.equal(f.wallet(), before, `${preset}: the wallet was not used as a fallback`);
    assert.equal(f.status(id), 'UNPAID');
    assert.equal(f.effects(), 0);
    assert.equal(f.db.automationRuns!.released(execution.id), true, `${preset}: the reservation was released`);
  }
});

test('AUTO-08: a card challenge stays visible as requiring action, holds its reservation and moves no money', async t => {
  const f = fixture(t), card = f.card('challenge'), m = f.mandate({ source: card }), id = f.bill(150), before = f.wallet();
  const execution = prepared(f.prepare(m.id));
  const pending = await run(f, execution.id);
  assert.equal(pending.state, 'REQUIRES_ACTION');
  assert.equal(pending.fundsCaptured, false);
  assert.equal(f.wallet(), before);
  assert.equal(f.status(id), 'UNPAID');
  assert.equal(f.effects(), 0);
  assert.equal(f.db.automationRuns!.released(execution.id), false, 'the held challenge keeps its reservation');
  assert.equal((await run(f, execution.id)).state, 'REQUIRES_ACTION', 'redelivery neither answers the challenge nor charges');
  assert.equal(f.consumed.length, 1);
});

test('AUTO-08: short wallet funds fail visibly without borrowing from a card or lowering the amount', async t => {
  const f = fixture(t), m = f.mandate({ perPaymentMinor: 500000 }), id = f.bill(1800), before = f.wallet();
  assert.ok(before < 180000, 'the demo wallet holds less than this invoice');
  const execution = prepared(f.prepare(m.id));
  const failed = await run(f, execution.id);
  assert.equal(failed.state, 'FAILED');
  assert.ok(failed.failureCode, 'the failure names its cause');
  assert.equal(f.wallet(), before);
  assert.equal(f.status(id), 'UNPAID');
  assert.equal(f.effects(), 0);
  assert.equal(f.db.automationRuns!.released(execution.id), true);
  console.log(`  insufficient-funds failure code: ${failed.failureCode}`);
});
