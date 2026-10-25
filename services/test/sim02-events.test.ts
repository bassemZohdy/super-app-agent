import test from 'node:test';
import assert from 'node:assert/strict';
import { AccountDatabase } from '../provider-simulator/src/database.ts';
import { ProviderEngine } from '../provider-simulator/src/engine.ts';
import { actorFor } from '../../packages/backend-kit/src/context.ts';
import type { ProviderId } from '../provider-simulator/src/contracts.ts';

// SIM-02: recurring invoices, fine discounts, prepaid and toll usage and parking departure arrive as
// idempotent source-owned events. Redelivery changes nothing, and a stale event cannot revive a closed obligation.
const actor = actorFor({ sub: 'sim02-events-owner' }, undefined, 'Bearer never-persisted');
function source(t: { after(fn: () => void): void }, provider: ProviderId) {
  const db = new AccountDatabase(':memory:'); t.after(() => db.close()); db.accounts(actor.sub);
  const engine = new ProviderEngine(provider, db); engine.seed(actor);
  return { db, engine, account: actor.accountId, events: engine.lifecycle! };
}
const code = (value: string) => (e: any) => e.code === value;
const dewaReference = (s: ReturnType<typeof source>) => String(s.db.get(s.account, 'consumption')!.accountNumber);

test('SIM-02 recurring cycle: each period is one invoice, redelivery adds none, and closed periods are never recreated', t => {
  const s = source(t, 'dewa'), reference = dewaReference(s);
  const cycle = { kind: 'INVOICE_CYCLE' as const, eventId: 'cycle-2026-q4', reference, startPeriod: '2026-11', periods: 3, amountMinor: 15000, dueDay: 20 };
  const first = s.events.ingest(s.account, cycle);
  assert.deepEqual([first.outcome, first.replayed, first.detail!.issued], ['APPLIED', false, ['2026-11', '2026-12', '2027-01']]);
  const cyc = () => s.engine.payables!.list(s.account).filter(p => p.obligationId!.startsWith('CYC-'));
  assert.deepEqual(cyc().map(p => p.dueDate).sort(), ['2026-11-20', '2026-12-20', '2027-01-20']);
  assert.ok(cyc().every(p => p.amountMinor === 15000 && p.status === 'UNPAID' && p.reference === reference), 'source records and quotes agree');
  const revisions = cyc().map(p => p.revision).sort();
  const again = s.events.ingest(s.account, cycle);
  assert.deepEqual([again.outcome, again.replayed], ['APPLIED', true]);
  assert.equal(cyc().length, 3, 'redelivery created no second bill');
  assert.deepEqual(cyc().map(p => p.revision).sort(), revisions, 'and changed no revision');
  assert.throws(() => s.events.ingest(s.account, { ...cycle, amountMinor: 99900 }), code('EVENT_CONFLICT'));
  // One period is paid and another withdrawn at the source; a later overlapping cycle must not reopen either.
  const [nov, dec] = cyc().sort((a, b) => a.dueDate!.localeCompare(b.dueDate!));
  s.db.put(s.account, 'bill', { ...s.db.get(s.account, 'bill', nov.obligationId!)!, status: 'PAID' }, nov.obligationId);
  s.engine.payables!.amend(s.account, dec.id, dec.revision, { status: 'CANCELLED' });
  const overlap = s.events.ingest(s.account, { ...cycle, eventId: 'cycle-2026-q4-retry', periods: 5 });
  assert.deepEqual(overlap.detail!.skipped, ['2026-11', '2026-12', '2027-01']);
  assert.deepEqual(overlap.detail!.issued, ['2027-02', '2027-03']);
  const byPeriod = new Map(cyc().map(p => [p.period, p.status]));
  assert.equal(byPeriod.get('2026-11'), 'PAID');
  assert.equal(byPeriod.get('2026-12'), 'CANCELLED');
  assert.equal(cyc().length, 5);
});

test('SIM-02 cycle bounds, month ends and ownership are enforced and remembered', t => {
  const s = source(t, 'dewa'), reference = dewaReference(s);
  assert.throws(() => s.events.ingest(s.account, { kind: 'INVOICE_CYCLE', eventId: 'bad-1', reference, startPeriod: '2026-13', periods: 3, amountMinor: 1000, dueDay: 20 }), code('EVENT_INVALID'));
  assert.throws(() => s.events.ingest(s.account, { kind: 'INVOICE_CYCLE', eventId: 'bad-2', reference, startPeriod: '2026-11', periods: 13, amountMinor: 1000, dueDay: 20 }), code('EVENT_INVALID'));
  assert.throws(() => s.events.ingest(s.account, { kind: 'INVOICE_CYCLE', eventId: 'bad-3', reference, startPeriod: '2026-11', periods: 2, amountMinor: 1000, dueDay: 31 }), code('EVENT_INVALID'));
  const feb = s.events.ingest(s.account, { kind: 'INVOICE_CYCLE', eventId: 'feb', reference, startPeriod: '2027-02', periods: 1, amountMinor: 1000, dueDay: 28 });
  assert.equal(s.engine.payables!.list(s.account).find(p => p.period === '2027-02')!.dueDate, '2027-02-28');
  assert.equal(feb.outcome, 'APPLIED');
  const foreign = { kind: 'INVOICE_ISSUED' as const, eventId: 'foreign', billId: 'FOREIGN-1', reference: 'not-this-account', amountMinor: 1000, dueDate: '2026-12-01', period: '2026-12' };
  const rejected = s.events.ingest(s.account, foreign);
  assert.deepEqual([rejected.outcome, rejected.code], ['REJECTED', 'BILLER_NOT_OWNED']);
  assert.equal(s.engine.payables!.list(s.account).some(p => p.obligationId === 'FOREIGN-1'), false);
  const replay = s.events.ingest(s.account, foreign);
  assert.deepEqual([replay.outcome, replay.code, replay.replayed], ['REJECTED', 'BILLER_NOT_OWNED', true], 'a rejected event stays rejected on redelivery');
  assert.throws(() => s.events.ingest(s.account, { kind: 'USAGE_RECORDED', eventId: '../x', targetReference: 'a', usageMinor: 1 }), code('EVENT_INVALID'));
});

test('SIM-02 fine discount change applies once; a stale revision or a paid fine rejects it', t => {
  const s = source(t, 'police');
  const fine = s.engine.payables!.list(s.account).find(p => p.status === 'UNPAID')!;
  const change = { kind: 'FINE_DISCOUNT_CHANGED' as const, eventId: 'discount-1', payableId: fine.id, expectedRevision: fine.revision, discountMinor: 5000 };
  const applied = s.events.ingest(s.account, change);
  assert.equal(applied.outcome, 'APPLIED');
  const now = s.engine.payables!.get(s.account, fine.id);
  assert.equal(now.discountMinor, 5000);
  assert.equal(now.amountMinor, fine.originalAmountMinor! - 5000, 'the payable amount follows the discount');
  assert.notEqual(now.revision, fine.revision);
  assert.equal(s.events.ingest(s.account, change).replayed, true);
  assert.equal(s.engine.payables!.get(s.account, fine.id).revision, now.revision, 'redelivery did not move the revision again');
  const stale = s.events.ingest(s.account, { ...change, eventId: 'discount-stale', discountMinor: 9000 });
  assert.deepEqual([stale.outcome, stale.code], ['REJECTED', 'PAYABLE_CHANGED']);
  assert.equal(s.engine.payables!.get(s.account, fine.id).discountMinor, 5000);
  s.db.put(s.account, 'fine', { ...s.db.get(s.account, 'fine', fine.obligationId!)!, status: 'PAID', paidAmount: now.amountMinor / 100 }, fine.obligationId);
  const closed = s.events.ingest(s.account, { ...change, eventId: 'discount-after-paid', expectedRevision: s.engine.payables!.get(s.account, fine.id).revision, discountMinor: 1000 });
  assert.deepEqual([closed.outcome, closed.code], ['REJECTED', 'PAYABLE_UNAVAILABLE'], 'a paid fine cannot be reopened by a late discount');
  assert.equal(s.engine.payables!.get(s.account, fine.id).status, 'PAID');
});

for (const provider of ['rta', 'etisalat'] as const) test(`SIM-02 ${provider} usage lowers the balance once, never below zero, and stales an open recharge quote`, t => {
  const s = source(t, provider), target = s.engine.recharges!.targets(s.account)[0], start = target.balanceMinor;
  const quote = s.engine.recharges!.quote(s.account, { targetReference: target.reference, amountMinor: target.denominationsMinor[0], expectedTargetVersion: target.version, intentId: `intent-${provider}` });
  assert.equal(s.engine.recharges!.get(s.account, quote.id).status, 'UNPAID');
  const usage = { kind: 'USAGE_RECORDED' as const, eventId: `use-${provider}-1`, targetReference: target.reference, usageMinor: 500 };
  const applied = s.events.ingest(s.account, usage);
  assert.deepEqual([applied.outcome, applied.detail!.appliedMinor, applied.detail!.balanceMinor], ['APPLIED', 500, start - 500]);
  assert.equal(s.engine.recharges!.targets(s.account)[0].balanceMinor, start - 500);
  assert.equal(s.engine.recharges!.targets(s.account)[0].version, target.version + 1);
  assert.equal(s.events.ingest(s.account, usage).replayed, true);
  assert.equal(s.engine.recharges!.targets(s.account)[0].balanceMinor, start - 500, 'redelivery used nothing twice');
  assert.equal(s.engine.recharges!.get(s.account, quote.id).status, 'CANCELLED', 'a quote built on the old balance can no longer be paid');
  const drained = s.events.ingest(s.account, { ...usage, eventId: `use-${provider}-2`, usageMinor: start * 10 });
  assert.equal(drained.detail!.balanceMinor, 0);
  assert.equal(drained.detail!.appliedMinor, start - 500, 'usage cannot take more than the balance');
  assert.throws(() => s.events.ingest(s.account, { ...usage, eventId: `use-${provider}-3`, usageMinor: 0 }), code('USAGE_INVALID'));
  assert.deepEqual([s.events.ingest(s.account, { ...usage, eventId: `use-${provider}-4`, targetReference: 'unknown-target' }).code], ['RECHARGE_TARGET_NOT_FOUND']);
});

test('SIM-02 parking departure ends the session once and a later extension is refused', t => {
  const s = source(t, 'rta');
  const meter = { ticketId: 'ticket-1', zoneId: 'z1', zoneCode: 'A', zoneName: 'Zone', plateNumber: 'X-1', durationHours: 2, totalFee: 8, startTime: Date.now(), expiresAt: Date.now() + 7200000, status: 'ACTIVE' };
  s.db.put(s.account, 'parking', meter, meter.ticketId);
  const depart = { kind: 'PARKING_DEPARTED' as const, eventId: 'depart-1', ticketId: meter.ticketId };
  const applied = s.events.ingest(s.account, depart);
  assert.equal(applied.outcome, 'APPLIED');
  const ended = s.db.get(s.account, 'parking', meter.ticketId)!;
  assert.equal(ended.status, 'ENDED');
  assert.ok(Number(ended.expiresAt) <= Date.now() + 1000, 'the paid-until time no longer runs past departure');
  assert.equal(s.events.ingest(s.account, depart).replayed, true);
  const second = s.events.ingest(s.account, { ...depart, eventId: 'depart-2' });
  assert.deepEqual([second.outcome, second.code], ['REJECTED', 'SESSION_ALREADY_ENDED']);
  const missing = s.events.ingest(s.account, { ...depart, eventId: 'depart-3', ticketId: 'no-such-ticket' });
  assert.deepEqual([missing.outcome, missing.code], ['REJECTED', 'SESSION_NOT_FOUND']);
  assert.throws(() => s.engine.execute(actor, 'POST', `/parking/sessions/${meter.ticketId}/extensions`, { additionalHours: 1, reference: 'ext-1' }), code('SESSION_ENDED'));
});

test('SIM-02 events are rejected where they do not belong and the ledger of events is immutable', t => {
  const rta = source(t, 'rta'), police = source(t, 'police');
  assert.throws(() => rta.events.ingest(rta.account, { kind: 'INVOICE_ISSUED', eventId: 'e1', billId: 'B1', reference: 'x', amountMinor: 1000, dueDate: '2026-12-01', period: '2026-12' }), code('EVENT_UNSUPPORTED'));
  assert.throws(() => police.events.ingest(police.account, { kind: 'USAGE_RECORDED', eventId: 'e2', targetReference: 'x', usageMinor: 1 }), code('EVENT_UNSUPPORTED'));
  assert.throws(() => police.events.ingest(police.account, { kind: 'PARKING_DEPARTED', eventId: 'e3', ticketId: 't' }), code('EVENT_UNSUPPORTED'));
  rta.events.ingest(rta.account, { kind: 'USAGE_RECORDED', eventId: 'ok-1', targetReference: rta.engine.recharges!.targets(rta.account)[0].reference, usageMinor: 100 });
  assert.equal(rta.events.history(rta.account).length, 1);
  assert.throws(() => rta.db.db.prepare("UPDATE provider_lifecycle_events SET outcome='REJECTED'").run(), /immutable/);
  assert.throws(() => rta.db.db.prepare('DELETE FROM provider_lifecycle_events').run(), /immutable/);
});

for (const provider of ['etisalat', 'du'] as const) test(`SIM-02 ${provider} subscription renewal cycles issue one invoice per period for the owned subscription only`, t => {
  const s = source(t, provider), subscription = s.db.list(s.account, 'subscription').find((x: { status?: string }) => x.status === 'ACTIVE') as { subscriptionId: string };
  const renewal = { kind: 'INVOICE_CYCLE' as const, eventId: `renew-${provider}`, reference: subscription.subscriptionId, startPeriod: '2026-12', periods: 2, amountMinor: 29900, dueDay: 5 };
  assert.deepEqual(s.events.ingest(s.account, renewal).detail!.issued, ['2026-12', '2027-01']);
  const bills = s.engine.payables!.list(s.account).filter(p => p.obligationId!.startsWith('CYC-'));
  assert.deepEqual(bills.map(p => [p.reference, p.amountMinor, p.dueDate]).sort(), [[subscription.subscriptionId, 29900, '2026-12-05'], [subscription.subscriptionId, 29900, '2027-01-05']]);
  assert.equal(s.events.ingest(s.account, renewal).replayed, true);
  assert.equal(s.engine.payables!.list(s.account).filter(p => p.obligationId!.startsWith('CYC-')).length, 2);
  // A cycle for a subscription this account does not own is refused and remembered.
  const foreign = s.events.ingest(s.account, { ...renewal, eventId: `renew-${provider}-foreign`, reference: 'sub_not_mine' });
  assert.deepEqual([foreign.outcome, foreign.code], ['REJECTED', 'BILLER_NOT_OWNED']);
  assert.equal(s.engine.payables!.list(s.account).filter(p => p.obligationId!.startsWith('CYC-')).length, 2, 'nothing was issued for the foreign reference');
});
