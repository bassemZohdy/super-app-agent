import test from 'node:test';
import assert from 'node:assert/strict';
import { describeMandateConsent } from '../../packages/protocol-core/src/mandate-consent.ts';

const card = {
  id: 'method-card-1', accountId: 'acct-1', kind: 'card', nickname: 'Everyday card', version: 2, status: 'ACTIVE', currency: 'AED',
  preset: 'approved', last4: '4242', expiresMonth: 12, expiresYear: 2030, createdAt: '2026-01-01T00:00:00.000Z',
};

function record(overrides: Record<string, any> = {}, policyOverrides: Record<string, any> = {}): any {
  const policy = {
    actorClientId: 'cityside-automation', audience: 'provider-api', operation: 'BILL_PAYMENT', purpose: 'Pay my home bills',
    currency: 'AED',
    target: { kind: 'BILLER', billingAccountId: 'biller-1', expectedVersion: 1, provider: 'dewa', reference: 'owned-home' },
    sources: [{ methodId: 'method-card-1', expectedVersion: 2 }],
    fallback: { mode: 'NONE' },
    trigger: { type: 'INVOICE_DUE', daysBefore: 3 },
    timezone: 'Asia/Dubai',
    startsAt: '2026-01-01T00:00:00.000Z',
    expiresAt: '2027-01-01T00:00:00.000Z',
    limits: { perPaymentMinor: 50000, periodMinor: 100000, lifetimeMinor: 300000, period: 'MONTH', perPeriodCount: 3, lifetimeCount: 9, cooldownSeconds: 3600 },
    ...policyOverrides,
  };
  return {
    id: 'mandate-1', accountId: 'acct-1', ownerSub: 'owner-1', version: 3, policyVersion: 2, state: 'APPROVED',
    executionEnabled: false, policy, sourceSnapshots: [card], billerSnapshot: { id: 'biller-1', nickname: 'Home DEWA' },
    approvalDigest: 'a'.repeat(64), reviewExpiresAt: '2026-02-01T00:00:00.000Z', createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-02T00:00:00.000Z', approvedAt: '2026-01-02T00:00:00.000Z',
    ...overrides,
  };
}

test('active approved mandate describes trigger, target, funding, caps and expiry', () => {
  const view = describeMandateConsent(record());
  assert.match(view.title, /BILL_PAYMENT/);
  assert.match(view.trigger, /3 days before the invoice is due/);
  assert.match(view.trigger, /Asia\/Dubai/);
  assert.match(view.target, /Home DEWA/);
  assert.match(view.target, /dewa/);
  assert.match(view.target, /owned-home/);
  assert.match(view.funding, /Everyday card/);
  assert.match(view.funding, /4242/);
  assert.match(view.funding, /No fallback/);
  assert.ok(view.caps.some((c) => c.includes('AED 500.00 per payment')));
  assert.ok(view.caps.some((c) => c.includes('AED 1000.00') && c.includes('MONTH') && c.includes('3 payments')));
  assert.ok(view.caps.some((c) => c.includes('AED 3000.00') && c.includes('9 payments')));
  assert.ok(view.caps.some((c) => c.includes('3600')));
  assert.match(view.expiry, /2027-01-01/);
  assert.equal(view.status, 'Approved · automatic execution disabled');
});

test('awaiting approval mandate reports the review deadline and does not claim consent', () => {
  const view = describeMandateConsent(record({ state: 'AWAITING_APPROVAL', approvedAt: undefined }));
  assert.match(view.status, /^Awaiting your approval/);
  assert.match(view.expiry, /review expires 2026-02-01/);
});

test('expired mandate is labelled expired and states that no new runs are admitted', () => {
  const view = describeMandateConsent(record({ state: 'EXPIRED' }));
  assert.match(view.status, /^Expired/);
  assert.match(view.expiry, /^Expired/);
  assert.match(view.revocation, /no new runs/i);
});

test('revoked mandate states that future runs are stopped and does not claim reversal', () => {
  const view = describeMandateConsent(record({ state: 'REVOKED' }));
  assert.match(view.status, /^Revoked/);
  assert.match(view.revocation, /Revoked/);
  assert.match(view.revocation, /no new runs/i);
  assert.match(view.revocation, /not reversed/);
});

test('approved mandate revocation text uses the documented in-flight and no-reversal rules', () => {
  const view = describeMandateConsent(record());
  assert.match(view.revocation, /Revoking stops new admissions/);
  assert.match(view.revocation, /in-flight/);
  assert.match(view.revocation, /does not reverse a captured payment/);
});

test('wallet target, fallback order and parking trigger are rendered from policy fields', () => {
  const view = describeMandateConsent(record({ sourceSnapshots: [] }, {
    operation: 'PARKING_EXTENSION', purpose: 'Extend parking',
    target: { kind: 'PARKING', ticketId: 'ticket-9', plateNumber: 'A 12345', zoneId: 'zone-2', maximumHours: 2, endAt: '2026-03-01T10:00:00.000Z' },
    trigger: { type: 'PARKING_ENDING', minutesBefore: 10 },
    sources: [{ methodId: 'method-card-1', expectedVersion: 2 }, { methodId: 'wallet', expectedVersion: 1 }],
    fallback: { mode: 'ORDERED', on: ['INSUFFICIENT_FUNDS', 'CARD_DECLINED'] },
  }));
  assert.match(view.trigger, /10 minutes before parking ends/);
  assert.match(view.target, /ticket-9/);
  assert.match(view.target, /A 12345/);
  assert.match(view.target, /zone-2/);
  assert.match(view.target, /2 hours/);
  assert.match(view.funding, /method-card-1 \(snapshot unavailable\)/);
  assert.match(view.funding, /wallet \(snapshot unavailable\)/);
  assert.match(view.funding, /INSUFFICIENT_FUNDS/);
  assert.match(view.funding, /CARD_DECLINED/);
});

test('wallet target uses wallet wording', () => {
  const view = describeMandateConsent(record({}, { operation: 'WALLET_RELOAD', target: { kind: 'WALLET' }, trigger: { type: 'LOW_BALANCE', belowMinor: 5000, reloadMinor: 20000, targetBalanceMinor: 30000 } }));
  assert.match(view.target, /Wallet/);
  assert.match(view.trigger, /AED 50\.00/);
  assert.match(view.trigger, /AED 200\.00/);
});

test('never throws on missing optional fields or unknown enum values', () => {
  const minimal = { id: 'm', state: 'APPROVED', policy: { operation: 'BILL_PAYMENT' } };
  assert.doesNotThrow(() => describeMandateConsent(minimal as any));
  const bare = describeMandateConsent({} as any);
  assert.equal(typeof bare.trigger, 'string');
  assert.ok(Array.isArray(bare.caps));
  assert.doesNotThrow(() => describeMandateConsent(record({ billerSnapshot: undefined, sourceSnapshots: undefined }) as any));
  assert.doesNotThrow(() => describeMandateConsent(record({}, { limits: undefined, fallback: undefined, trigger: undefined, target: undefined }) as any));
  assert.doesNotThrow(() => describeMandateConsent(record({ state: 'SOMETHING_NEW' }) as any));
  assert.doesNotThrow(() => describeMandateConsent(null as any));
});
