import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { AccountDatabase } from '../provider-simulator/src/database.ts';
import { ProviderEngine } from '../provider-simulator/src/engine.ts';
import { PaymentCheckout } from '../provider-simulator/src/payment-checkout.ts';
import { ProviderSettlements } from '../provider-simulator/src/provider-settlements.ts';
import { signPaymentEvent, type EventKeys } from '../provider-simulator/src/payment-events.ts';
import { actorFor } from '../../packages/backend-kit/src/context.ts';
import type { ProviderClient } from '../../packages/backend-kit/src/provider-client.ts';
import type { PaymentEvent } from '../../packages/protocol-core/src/payment-events.ts';

// Reuse the SIM-02 lifecycle fixture and entry points without changing the existing suite.
const keys: EventKeys = (producer, kid) => kid === 'v1' ? `sim02-test-key-${producer}-`.padEnd(48, 'x') : undefined;
const decision = (o: { version: number; approvalDigest: string }) => ({ expectedVersion: o.version, approvalDigest: o.approvalDigest });
const code = (value: string) => (e: any) => e.code === value;

function fixture(t: any) {
  const actor = actorFor({ sub: 'sim02-owner' }, undefined, 'Bearer sim02-never-persist');
  const db = new AccountDatabase(':memory:'), source = new AccountDatabase(':memory:');
  t.after(() => { db.close(); source.close(); });
  for (const d of [db, source]) d.accounts(actor.sub);
  const gateway = new ProviderEngine('payments', db), provider = new ProviderEngine('dewa', source);
  gateway.seed(actor); provider.seed(actor);
  const p = provider.payables!.list(actor.accountId).find(x => x.status === 'UNPAID')!;
  db.transaction(() => gateway.execute(actor, 'POST', '/billing-accounts', { provider: 'dewa', reference: p.reference, nickname: 'Home' }));
  const create = () => gateway.orders!.create(actor, { provider: 'dewa', payableId: p.id, expectedPayableRevision: p.revision, methodId: 'wallet', expectedMethodVersion: 1 }, p);
  const settlement = new ProviderSettlements(source, 'dewa', { call: async (account: string, payment: string, action: string, body: any) => action === 'claim' ? gateway.claims!.claim(account, payment, 'dewa', body) : action === 'ack' ? gateway.claims!.acknowledge(account, payment, 'dewa', body) : gateway.claims!.release(account, payment, 'dewa', body) });
  const client = { call: async (_provider: string, _actor: typeof actor, method: string, path: string, body: any = {}, key = 'test') => {
    if (path.startsWith('/payment-reversals/')) { const id = path.split('/')[2]; return { reversal: method === 'GET' ? provider.reversals!.get(actor.accountId, id) : source.transaction(() => provider.reversals!.apply(actor.accountId, gateway.refunds!.get(actor, id))) }; }
    if (path.endsWith('/payments')) {
      const proof = gateway.execute(actor, 'GET', `/charges/${body.paymentId}`, {}).data.charge;
      const result = await settlement.execute(actor, key, createHash('sha256').update(JSON.stringify([method, path, body])).digest('hex'), proof, claimed => provider.execute(actor, method, path, body, claimed));
      return result.data;
    }
    let order; if (path.endsWith('/admit') || path.endsWith('/cancel')) { const admission = provider.admissions!.get(actor.accountId, path.split('/')[4]); order = gateway.orders!.get(actor, admission.orderId); }
    return source.transaction(() => provider.execute(actor, method, path, body, undefined, undefined, order)).data;
  } } as unknown as ProviderClient;
  const checkout = new PaymentCheckout(gateway.orders!, client);
  const events = db.events!;
  const pay = async () => { let o = create(); o = gateway.orders!.approve(actor, o.id, decision(o), p); return checkout.execute(actor, o.id, decision(o)); };
  const receive = (event: PaymentEvent, headers = signPaymentEvent(event, keys)) => events.receive(event, headers, keys);
  // Gateway outbox events for one order, in commit order (oldest first).
  const orderEvents = (orderId: string) => db.db.prepare('SELECT body FROM payment_event_outbox ORDER BY rowid').all()
    .map(row => JSON.parse(String(row.body)) as PaymentEvent).filter(e => e.subject.kind === 'PAYMENT' && e.subject.id === orderId);
  const balance = () => gateway.ledger!.summary(actor.accountId).balanceMinor;
  const sourceBill = () => JSON.stringify(source.get(actor.accountId, 'bill'));
  return { actor, db, source, gateway, provider, p, create, checkout, events, pay, receive, orderEvents, balance, sourceBill, client };
}

test('SIM-02 refunded bill status reads agree with the source and gateway, and a second refund is rejected', async t => {
  const f = fixture(t), account = f.actor.accountId;
  assert.equal(f.source.get<any>(account, 'bill')!.status, 'UNPAID');
  const paid = await f.pay();
  assert.equal(paid.state, 'SETTLED');
  assert.equal(f.provider.payables!.get(account, f.p.id).status, 'PAID');

  const original = f.gateway.orders!.get(f.actor, paid.id);
  const refund = f.gateway.refunds!.create(f.actor, { origin: 'PAYMENT', orderId: original.id, expectedVersion: original.version, amountMinor: original.quote.totalMinor, reason: 'SIM-02 refund status read' });
  const result = await f.gateway.refunds!.execute(f.actor, refund.id, decision(refund), f.client);
  assert.equal(result.state, 'REFUNDED');

  const record = f.source.get<any>(account, 'bill')!;
  const path = `/payables/${encodeURIComponent(f.p.id)}`;
  const shown = f.provider.execute(f.actor, 'GET', path, {}).data.payable;
  const order = f.gateway.orders!.get(f.actor, paid.id);
  assert.equal(record.status, 'CANCELLED');
  assert.equal(record.refundId, result.id);
  assert.equal(record.reversedAmountMinor, original.quote.totalMinor);
  assert.equal(shown.obligationId, record.billId);
  assert.equal(shown.status, record.status);
  assert.equal(shown.version, record.payableVersion);
  assert.deepEqual(shown, f.provider.payables!.get(account, f.p.id));
  assert.deepEqual(f.provider.execute(f.actor, 'GET', path, {}).data.payable, shown);
  assert.equal(order.state, 'SETTLED');
  assert.equal(order.refundState, result.state);
  assert.equal(order.refundedMinor, original.quote.totalMinor);

  // payment-refunds.ts:35 rejects cumulative refunds exceeding the captured total.
  // Use the current version so this exercises REFUND_LIMIT, not a stale-version error.
  assert.throws(() => f.gateway.refunds!.create(f.actor, { origin: 'PAYMENT', orderId: order.id, expectedVersion: order.version, amountMinor: order.quote.totalMinor, reason: 'SIM-02 second refund' }), code('REFUND_LIMIT'));
  assert.deepEqual(f.provider.execute(f.actor, 'GET', path, {}).data.payable, shown);
  assert.deepEqual(f.gateway.orders!.get(f.actor, paid.id), order);
});
