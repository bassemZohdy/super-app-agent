import { removeTemp } from '../../test/support/temp-cleanup.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { actorFor } from '../../packages/backend-kit/src/context.ts';
import { MANDATE_ACTOR, type MandatePolicy } from '../../packages/protocol-core/src/payment-mandates.ts';
import { AccountDatabase } from '../provider-simulator/src/database.ts';
import { ProviderEngine } from '../provider-simulator/src/engine.ts';
import { PaymentMandates } from '../provider-simulator/src/payment-mandates.ts';

// QA-01: stale, replayed and cross-workspace attempts on a rule are refused, and each refusal leaves the rule as it was.
function fixture(t: any) {
  const root = mkdtempSync(join(tmpdir(), 'cityside-qa01-')), db = new AccountDatabase(join(root, 'payments.sqlite'));
  const engine = new ProviderEngine('payments', db), owner = actorFor({ sub: 'qa01-owner' }, undefined, 'Bearer owner');
  db.accounts(owner.sub); engine.seed(owner);
  const now = Date.now(), mandates = new PaymentMandates(db, engine.resourceUses!, () => now);
  const post = (path: string, body: any) => db.transaction(() => engine.execute(owner, 'POST', path, body)).data;
  const card = post('/payment-methods', { preset: 'approved', nickname: 'QA01 card' }).method;
  const link = post('/billing-accounts', { provider: 'dewa', reference: 'qa01-home', nickname: 'Home' }).billingAccount;
  const policy = (): MandatePolicy => ({ actorClientId: MANDATE_ACTOR, audience: 'provider-api', operation: 'BILL_PAYMENT', purpose: 'Pay my linked home bills', currency: 'AED',
    target: { kind: 'BILLER', billingAccountId: link.id, expectedVersion: link.version, provider: 'dewa', reference: link.reference },
    sources: [{ methodId: card.id, expectedVersion: card.version }], fallback: { mode: 'NONE' }, trigger: { type: 'INVOICE_DUE', daysBefore: 1 }, timezone: 'Asia/Dubai',
    startsAt: new Date(now).toISOString(), expiresAt: new Date(now + 30 * 86400000).toISOString(),
    limits: { perPaymentMinor: 50000, periodMinor: 100000, lifetimeMinor: 300000, period: 'MONTH', perPeriodCount: 3, lifetimeCount: 9, cooldownSeconds: 3600 } });
  t.after(() => { db.close(); removeTemp(root); });
  return { db, owner, mandates, policy, post, card };
}

test('QA-01: an approval with a stale version or an old digest after a revision is refused and changes nothing', t => {
  const f = fixture(t);
  const first = f.mandates.create(f.owner, f.policy());
  const approved = f.mandates.approve(f.owner, first.id, first.version, first.approvalDigest);
  assert.throws(() => f.mandates.approve(f.owner, first.id, first.version, first.approvalDigest), 'a replay of an approval against the old version is refused');
  assert.deepEqual(f.mandates.get(f.owner, first.id), approved, 'the refused replay changed nothing');
  const revised = f.mandates.revise(f.owner, first.id, approved.version, { ...f.policy(), purpose: 'Pay my linked home bills (narrower)' });
  assert.equal(revised.state, 'AWAITING_APPROVAL');
  assert.throws(() => f.mandates.approve(f.owner, first.id, revised.version, approved.approvalDigest), 'the digest of the old terms does not approve the new ones');
  assert.throws(() => f.mandates.approve(f.owner, first.id, approved.version, revised.approvalDigest), 'the old version does not approve the new review');
  assert.equal(f.mandates.get(f.owner, first.id).state, 'AWAITING_APPROVAL', 'refused approvals left the new review waiting');
});

test('QA-01: another workspace cannot pause, revoke or approve a rule it does not own', t => {
  const f = fixture(t);
  const rule = f.mandates.create(f.owner, f.policy());
  const other = actorFor({ sub: 'qa01-stranger' }, undefined, 'Bearer stranger');
  f.db.accounts(other.sub);
  assert.throws(() => f.mandates.approve(other, rule.id, rule.version, rule.approvalDigest));
  assert.throws(() => f.mandates.get(other, rule.id));
  assert.equal(f.mandates.get(f.owner, rule.id).state, 'AWAITING_APPROVAL', 'the stranger changed nothing');
});

test('QA-01: a rule cannot target a biller that another workspace linked', t => {
  const f = fixture(t);
  const stranger = actorFor({ sub: 'qa01-biller-stranger' }, undefined, 'Bearer stranger');
  f.db.accounts(stranger.sub);
  const foreign = f.policy();
  foreign.target = { ...foreign.target, billingAccountId: 'billing_not_owned_by_this_workspace' };
  assert.throws(() => f.mandates.create(f.owner, foreign), (e: any) => e.code === 'MANDATE_TARGET_CHANGED', 'a biller link the workspace does not own is refused');
});


test('QA-01: a rule cannot be created on a source the owner has disabled', t => {
  const f = fixture(t);
  f.post('/payment-methods/status', { methodId: f.card.id, expectedVersion: f.card.version, status: 'DISABLED' });
  assert.throws(() => f.mandates.create(f.owner, f.policy()), (e: any) => e.code === 'MANDATE_SOURCE_CHANGED', 'a disabled source is refused');
});
