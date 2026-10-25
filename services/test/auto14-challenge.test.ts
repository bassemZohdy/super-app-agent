import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
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

// AUTO-14 step 2: a held card challenge on an automation order is answered only by the signed-in owner.
// Approve authorizes the same order; reject closes it with no money moved. The worker cannot answer.
const owner = { sub: 'auto-owner', authorization: 'Bearer broker-bound' };
const prepared = (r: AutomationPreparation | AutomationSkip) => { assert.equal((r as AutomationSkip).skipped, undefined, `skip ${(r as AutomationSkip).reason}`); return r as AutomationPreparation; };

function held(t: { after(fn: () => void): void }) {
  const root = mkdtempSync(join(tmpdir(), 'cityside-auto-')), path = join(root, 'payments.sqlite');
  const context = { root, operatorSub: 'automation-operator', workerSub: 'auto-worker', runId: `autorn_${randomUUID()}` };
  const db = new AccountDatabase(path), sourceDb = new AccountDatabase(':memory:'), actor = actorFor({ sub: 'auto-owner' }, undefined, 'Bearer owner');
  const source = new ProviderEngine('dewa', sourceDb);
  const payments = new ProviderEngine('payments', db, { automationRun: context, automationIo: {
    readPayables: (accountId: string, p: string) => p === 'dewa' ? source.payables!.list(accountId) : [],
    providerStore: (p: string) => { if (p !== 'dewa') throw new Error('No isolated store for this provider.'); return sourceDb; },
  } });
  db.accounts(actor.sub); sourceDb.accounts(actor.sub); payments.seed(actor); source.seed(actor);
  t.after(() => { db.close(); sourceDb.close(); try { rmSync(root, { recursive: true, force: true }); } catch { /* Windows may briefly hold the directory */ } });
  const account = actor.accountId, reference = String(sourceDb.get(account, 'consumption')!.accountNumber);
  const card = payments.execute(actor, 'POST', '/payment-methods', { preset: 'challenge', nickname: 'Challenge card' }).data.method as { id: string; version: number };
  const billing = db.transaction(() => payments.execute(actor, 'POST', '/billing-accounts', { provider: 'dewa', reference, nickname: 'Home' })).data.billingAccount;
  const due = new Date(Date.now() + 86400000).toISOString().slice(0, 10), billId = `held-${randomUUID().slice(0, 8)}`;
  sourceDb.put(account, 'bill', { billId, accountNumber: reference, totalAmount: 150, status: 'UNPAID', dueDate: due }, billId);
  const policy = { actorClientId: 'cityside-automation' as const, audience: 'provider-api' as const, operation: 'BILL_PAYMENT' as const, purpose: 'Pay my DEWA bill automatically', currency: 'AED' as const,
    target: { kind: 'BILLER' as const, billingAccountId: billing.id, expectedVersion: billing.version, provider: 'dewa' as const, reference }, sources: [{ methodId: card.id, expectedVersion: card.version }], fallback: { mode: 'NONE' as const },
    trigger: { type: 'INVOICE_DUE' as const, daysBefore: 3 }, timezone: 'Asia/Dubai', startsAt: new Date(Date.now() - 60000).toISOString(), expiresAt: new Date(Date.now() + 30 * 86400000).toISOString(),
    limits: { perPaymentMinor: 50000, periodMinor: 100000, lifetimeMinor: 200000, period: 'MONTH' as const, perPeriodCount: 5, lifetimeCount: 20, cooldownSeconds: 60 } };
  const created = payments.mandates!.create(actor, policy);
  const m = payments.mandates!.approve(actor, created.id, created.version, created.approvalDigest);
  const settlement = new ProviderSettlements(sourceDb, 'dewa', { call: async (acct, id, action, body: any) => action === 'claim' ? payments.claims!.claim(acct, id, 'dewa', body) : action === 'ack' ? payments.claims!.acknowledge(acct, id, 'dewa', body) : payments.claims!.release(acct, id, 'dewa', body) });
  const client = { call: async (_p: string, _a: unknown, method: string, p: string, body: any = {}, key = 'test') => {
    if (p.endsWith('/payments')) {
      const proof = payments.execute(actor, 'GET', `/charges/${body.paymentId}`, {}).data.charge;
      return (await settlement.execute(actor, key, `${method}:${p}:${key}`, proof, claimed => source.execute(actor, method, p, body, claimed))).data;
    }
    let gatewayOrder;
    if (p.endsWith('/admit') || p.endsWith('/cancel')) { const admission = source.admissions!.get(account, p.split('/')[4]); gatewayOrder = payments.orders!.get(actor, admission.orderId); }
    return sourceDb.transaction(() => source.execute(actor, method, p, body, undefined, undefined, gatewayOrder)).data;
  } } as unknown as ProviderClient;
  const deps = { runs: db.automationRuns!, orders: payments.orders!, funding: payments.funding!, checkout: new PaymentCheckout(payments.orders!, client), client,
    authority: async () => undefined, session: async () => ({ executionId: String(execution?.id) }) };
  let execution: AutomationPreparation | undefined;
  const start = async () => {
    execution = prepared(db.automationRuns!.prepare('auto-worker', { mandateId: m.id, occurrenceKey: 'occ_held', requestKey: `req_${randomUUID()}` }));
    const state = await executeAutomaticOrder(deps, owner, execution.id);
    assert.equal(state.state, 'REQUIRES_ACTION');
    return { order: payments.orders!.get(actor, execution.orderId!), execution };
  };
  return { db, sourceDb, source, payments, actor, account, payableId: () => execution!.payableId, start, status: (id: string) => source.payables!.get(account, id).status, wallet: () => payments.ledger!.summary(account).balanceMinor };
}

test('AUTO-14: the worker cannot answer a held challenge on an automation order', async t => {
  const f = held(t), { order } = await f.start();
  const decide = { expectedVersion: order.version, approvalDigest: order.approvalDigest, challengeId: order.authorization!.challengeId!, decision: 'APPROVE' as const };
  assert.throws(() => f.payments.orders!.challenge(f.actor, order.id, decide, f.source.payables!.get(f.account, f.payableId()), false), (e: any) => e.code === 'ORDER_AUTOMATIC');
  assert.equal(f.payments.orders!.get(f.actor, order.id).state, 'REQUIRES_ACTION', 'the refusal changed nothing');
});

test('AUTO-14: the signed-in owner approves the held challenge and the same order becomes authorized, not paid twice', async t => {
  const f = held(t), before = f.wallet(), { order } = await f.start();
  const answered = f.payments.orders!.challenge(f.actor, order.id, { expectedVersion: order.version, approvalDigest: order.approvalDigest, challengeId: order.authorization!.challengeId!, decision: 'APPROVE' }, f.source.payables!.get(f.account, f.payableId()), true);
  assert.equal(answered.state, 'AUTHORIZED');
  assert.equal(f.status(f.payableId()), 'UNPAID', 'approving the challenge is not the payment itself');
  assert.equal(f.wallet(), before, 'no money moved by the answer');
});

test('AUTO-14: the owner rejects the held challenge and the order closes with its reservation released and nothing paid', async t => {
  const f = held(t), before = f.wallet(), { order } = await f.start();
  const answered = f.payments.orders!.challenge(f.actor, order.id, { expectedVersion: order.version, approvalDigest: order.approvalDigest, challengeId: order.authorization!.challengeId!, decision: 'REJECT' }, f.source.payables!.get(f.account, f.payableId()), true);
  assert.equal(answered.state, 'FAILED');
  assert.equal(f.status(f.payableId()), 'UNPAID');
  assert.equal(f.wallet(), before);
});

test('AUTO-14: the execution view tells the broker whether the owner has answered, approved or rejected the challenge', async t => {
  const f = held(t), { order, execution } = await f.start();
  const answer = () => f.db.automationRuns!.readExecution('auto-worker', execution!.id).challenge;
  assert.equal(answer(), 'PENDING');
  f.payments.orders!.challenge(f.actor, order.id, { expectedVersion: order.version, approvalDigest: order.approvalDigest, challengeId: order.authorization!.challengeId!, decision: 'APPROVE' }, f.source.payables!.get(f.account, f.payableId()), true);
  assert.equal(answer(), 'APPROVED');
});

test('AUTO-14: a rejected challenge reads as REJECTED, so the broker never resumes it', async t => {
  const f = held(t), { order, execution } = await f.start();
  f.payments.orders!.challenge(f.actor, order.id, { expectedVersion: order.version, approvalDigest: order.approvalDigest, challengeId: order.authorization!.challengeId!, decision: 'REJECT' }, f.source.payables!.get(f.account, f.payableId()), true);
  assert.equal(f.db.automationRuns!.readExecution('auto-worker', execution!.id).challenge, 'REJECTED');
});
