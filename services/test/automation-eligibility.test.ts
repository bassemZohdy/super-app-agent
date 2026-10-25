import test from 'node:test';
import assert from 'node:assert/strict';
import { capabilities } from '../service-catalog/src/capabilities.ts';
import { AUTOMATIC_CAPABILITIES, REVIEW_REQUIRED_CAPABILITIES, automationEligibility, renewalEligibility } from '../../packages/protocol-core/src/automation-eligibility.ts';

// AUTO-13: a financial mandate covers exactly the operations it names. Everything else stays review-required.
test('AUTO-13: only the listed operations are automatic; every other financial or mutating capability is review-required', () => {
  const ids = new Set(capabilities.map(c => c.id));
  for (const id of Object.keys(AUTOMATIC_CAPABILITIES)) if (id !== 'telecom.subscription.renew') assert.ok(ids.has(id), `${id} is a real catalog capability`);
  for (const capability of capabilities) {
    const verdict = automationEligibility(capability.id);
    if (capability.risk.level === 'financial' || capability.risk.level === 'high-impact' || capability.risk.mutates) {
      assert.equal(verdict.automatic, Object.hasOwn(AUTOMATIC_CAPABILITIES, capability.id), capability.id);
    } else {
      assert.equal(verdict.automatic, false, `${capability.id}: reads and searches are not financial authority`);
    }
    assert.equal(capability.consent.delegationAllowed, false, `${capability.id}: no catalog capability allows delegation`);
  }
  for (const id of REVIEW_REQUIRED_CAPABILITIES) assert.deepEqual(automationEligibility(id), { automatic: false, reviewRequired: true, reason: 'NO_FINANCIAL_MANDATE' }, id);
  for (const id of ['mobility.ride.book', 'dining.order.create', 'housing.move-in.execute', 'mobility.parking.activate', 'telecom.subscription.change-plan', 'utilities.activation.start'])
    assert.equal(automationEligibility(id).automatic, false, `${id} stays review-required`);
  assert.equal(automationEligibility('not.a.capability').automatic, false, 'unknown is denied by default');
  assert.equal(automationEligibility('__proto__').automatic, false);
  assert.equal(automationEligibility('constructor').automatic, false);
});

const sub = { status: 'ACTIVE', monthlyAmountMinor: 29900 };
const invoice = (change: Partial<{ id: string; period: string; status: string; amountMinor: number; paymentRestricted: boolean }> = {}) => ({ id: 'du:bill:b1', period: '2026-11', status: 'UNPAID', amountMinor: 29900, ...change });

test('AUTO-13: one period renews only from its own unpaid invoice at exactly the current plan price', () => {
  assert.deepEqual(renewalEligibility({ period: '2026-11', subscription: sub, invoices: [invoice()] }), { eligible: true, invoiceId: 'du:bill:b1', amountMinor: 29900 });
  const cases: [string, Parameters<typeof renewalEligibility>[0], string][] = [
    ['not invoiced yet', { period: '2026-12', subscription: sub, invoices: [invoice()] }, 'RENEWAL_NOT_INVOICED'],
    ['already paid', { period: '2026-11', subscription: sub, invoices: [invoice({ status: 'PAID' })] }, 'RENEWAL_ALREADY_PAID'],
    ['withdrawn', { period: '2026-11', subscription: sub, invoices: [invoice({ status: 'CANCELLED' })] }, 'RENEWAL_NOT_PAYABLE'],
    ['plan upgraded', { period: '2026-11', subscription: { status: 'ACTIVE', monthlyAmountMinor: 49900 }, invoices: [invoice()] }, 'TARIFF_CHANGED'],
    ['repriced invoice', { period: '2026-11', subscription: sub, invoices: [invoice({ amountMinor: 39900 })] }, 'TARIFF_CHANGED'],
    ['lapsed subscription', { period: '2026-11', subscription: { status: 'CANCELLED', monthlyAmountMinor: 29900 }, invoices: [invoice()] }, 'SUBSCRIPTION_NOT_ACTIVE'],
    ['no subscription', { period: '2026-11', invoices: [invoice()] }, 'SUBSCRIPTION_NOT_ACTIVE'],
    ['restricted', { period: '2026-11', subscription: sub, invoices: [invoice({ paymentRestricted: true })] }, 'RENEWAL_REQUIRES_REVIEW'],
    ['two open invoices', { period: '2026-11', subscription: sub, invoices: [invoice(), invoice({ id: 'du:bill:b2' })] }, 'RENEWAL_AMBIGUOUS'],
    ['bad period', { period: '2026-13', subscription: sub, invoices: [invoice()] }, 'RENEWAL_PERIOD_INVALID'],
  ];
  for (const [name, facts, reason] of cases) assert.deepEqual(renewalEligibility(facts), { eligible: false, reason }, name);
  // A different period's invoice is never used for this one.
  assert.deepEqual(renewalEligibility({ period: '2026-12', subscription: sub, invoices: [invoice({ period: '2026-11' }), invoice({ id: 'du:bill:b3', period: '2026-12', status: 'PAID' })] }), { eligible: false, reason: 'RENEWAL_ALREADY_PAID' });
});
