import test from 'node:test';
import assert from 'node:assert/strict';
import { billRulePolicy } from '../../packages/protocol-core/src/bill-rule.ts';
import { validateRequest } from '../../packages/protocol-core/src/request-validation.ts';

// AUTO-04: the rule the owner creates is a valid mandate request, its budgets are multiples of the reviewed cap, and it pays
// only the linked biller from the one source the owner chose.
const now = Date.parse('2026-10-26T09:00:00.000Z');
const policy = billRulePolicy({ billing: { id: 'billing_1', version: 2, provider: 'dewa', reference: 'home-001' }, source: { methodId: 'wallet', version: 1 }, perPaymentMinor: 15000, now });

test('AUTO-04: the created rule is a valid mandate request for the linked biller and the chosen source only', () => {
  assert.equal(validateRequest('agent-core', 'POST', '/api/payments/mandates', {}, { accountId: 'acct_1', requestKey: 'create-0001', policy }), undefined);
  assert.deepEqual(policy.target, { kind: 'BILLER', billingAccountId: 'billing_1', expectedVersion: 2, provider: 'dewa', reference: 'home-001' });
  assert.deepEqual(policy.sources, [{ methodId: 'wallet', expectedVersion: 1 }]);
  assert.deepEqual(policy.fallback, { mode: 'NONE' }, 'no other source can be used when the chosen one fails');
});

test('AUTO-04: every budget is at least the reviewed per-payment cap, so one rule cannot spend less room than it was reviewed for', () => {
  assert.equal(policy.limits.perPaymentMinor, 15000);
  assert.ok(policy.limits.periodMinor >= policy.limits.perPaymentMinor);
  assert.ok(policy.limits.lifetimeMinor >= policy.limits.periodMinor);
});
