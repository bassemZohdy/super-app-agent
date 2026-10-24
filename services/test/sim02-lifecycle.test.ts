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

// SIM-02 lifecycle criteria: source-owned state and quotes agree, repeated delivery
// does not repeat money effects, and stale events cannot revive a paid or withdrawn obligation.
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

test('SIM-02 quote agreement: provider GET, order quote and source bill record agree on amount, status and revision', t => {
  const f = fixture(t), account = f.actor.accountId;
  const record = f.source.get<any>(account, 'bill')!;
  const sourceMinor = record.amountMinor ?? Math.round(Number(record.totalAmount) * 100);
  const shown = f.provider.execute(f.actor, 'GET', `/payables/${encodeURIComponent(f.p.id)}`, {}).data.payable;
  const order = f.create();
  assert.equal(record.status, 'UNPAID');
  assert.equal(shown.amountMinor, sourceMinor);
  assert.equal(shown.status, record.status);
  assert.equal(shown.revision, f.p.revision);
  assert.equal(order.quote.payable.revision, shown.revision);
  assert.equal(order.quote.payable.amountMinor, sourceMinor);
  assert.equal(order.quote.totalMinor, sourceMinor);
});

test('SIM-02 repeated delivery of one provider payment event applies once: one inbox record, one debit, unchanged source bill', async t => {
  const f = fixture(t), account = f.actor.accountId;
  const paid = await f.pay();
  const settled = f.orderEvents(paid.id).at(-1)!;
  assert.equal(settled.state, 'SETTLED');
  const debitedBalance = f.balance(), billBefore = f.sourceBill();
  const headers = signPaymentEvent(settled, keys);
  const first = f.receive(settled, headers), second = f.receive(settled, headers), third = f.receive(settled);
  assert.equal(first.disposition, 'APPLIED');
  for (const replay of [second, third]) {
    assert.equal(replay.disposition, 'DUPLICATE');
    assert.equal(replay.eventId, settled.id);
  }
  assert.equal(f.events.status(account).received, 1);
  assert.equal(f.balance(), debitedBalance);
  assert.equal(f.db.list(account, 'charge').length, 1);
  assert.equal(f.sourceBill(), billBefore);
  assert.equal(f.gateway.orders!.get(f.actor, paid.id).state, 'SETTLED');
});

test('SIM-02 stale older event cannot re-open a paid obligation or re-debit it', async t => {
  const f = fixture(t), account = f.actor.accountId;
  const paid = await f.pay();
  const all = f.orderEvents(paid.id), latest = all.at(-1)!, older = all.slice(0, -1).reverse();
  assert.equal(latest.state, 'SETTLED');
  assert.ok(older.length >= 2, 'the lifecycle must contain earlier states');
  const debitedBalance = f.balance(), billBefore = f.sourceBill();
  assert.equal(f.receive(latest).disposition, 'APPLIED');
  for (const stale of older) assert.equal(f.receive(stale).disposition, 'STALE', stale.state);
  assert.equal(f.gateway.orders!.get(f.actor, paid.id).state, 'SETTLED');
  assert.equal(f.balance(), debitedBalance);
  assert.equal(f.db.list(account, 'charge').length, 1);
  assert.equal(f.sourceBill(), billBefore);
  assert.equal(f.provider.payables!.get(account, f.p.id).status, 'PAID');
  assert.equal(f.events.status(account).updates[0].observedState, 'SETTLED');
});

test('SIM-02 never-delivered older event cannot revive a withdrawn (refunded) obligation or re-debit it', async t => {
  const f = fixture(t), account = f.actor.accountId;
  const paid = await f.pay();
  const older = f.orderEvents(paid.id).slice(0, -1);
  assert.ok(older.length >= 2, 'the lifecycle must contain earlier states');
  const original = f.gateway.orders!.get(f.actor, paid.id);
  const refund = f.gateway.refunds!.create(f.actor, { origin: 'PAYMENT', orderId: original.id, expectedVersion: original.version, amountMinor: original.quote.totalMinor, reason: 'SIM-02 withdrawal' });
  assert.equal((await f.gateway.refunds!.execute(f.actor, refund.id, decision(refund), f.client)).state, 'REFUNDED');
  const withdrawn = f.provider.payables!.get(account, f.p.id);
  assert.equal(withdrawn.status, 'CANCELLED');
  const stateBefore = f.gateway.orders!.get(f.actor, paid.id).state, debitedBalance = f.balance(), billBefore = f.sourceBill();
  for (const stale of older) assert.equal(f.receive(stale).disposition, 'STALE', stale.state);
  assert.equal(f.gateway.orders!.get(f.actor, paid.id).state, stateBefore);
  assert.equal(f.balance(), debitedBalance);
  assert.equal(f.sourceBill(), billBefore);
  assert.equal(f.provider.payables!.get(account, f.p.id).status, 'CANCELLED');
  assert.throws(() => f.provider.payables!.inspect(account, f.p.id, withdrawn.revision), code('PAYABLE_UNAVAILABLE'));
});

test('SIM-02 stale revision cannot revive or settle a withdrawn provider obligation', t => {
  const f = fixture(t), account = f.actor.accountId, book = f.provider.payables!;
  const open = book.get(account, f.p.id);
  const withdrawn = book.amend(account, f.p.id, open.revision, { status: 'CANCELLED' });
  assert.equal(withdrawn.status, 'CANCELLED');
  const billBefore = f.sourceBill();
  const proof = { id: 'sim02-late-proof', accountId: account, currency: 'AED', status: 'CAPTURED', refunded: false, merchant: 'dewa', reference: book.settlementReference(withdrawn), amountMinor: withdrawn.amountMinor };
  assert.throws(() => book.amend(account, f.p.id, open.revision, { status: 'CANCELLED' }), code('PAYABLE_CHANGED'));
  assert.throws(() => book.amend(account, f.p.id, withdrawn.revision, { status: 'CANCELLED' }), code('PAYABLE_UNAVAILABLE'));
  assert.throws(() => book.settle(account, f.p.id, open.revision, proof.id, proof), code('PAYABLE_CHANGED'));
  assert.throws(() => book.settle(account, f.p.id, withdrawn.revision, proof.id, proof), code('PAYABLE_UNAVAILABLE'));
  assert.equal(book.get(account, f.p.id).status, 'CANCELLED');
  assert.equal(f.sourceBill(), billBefore);
});
