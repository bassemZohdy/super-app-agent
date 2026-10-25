import test from 'node:test';
import assert from 'node:assert/strict';
import { narrowPerPayment, aedToMinor } from '../../packages/protocol-core/src/mandate-narrow.ts';

// AUTO-04: narrowing lowers a rule's per-payment cap without any model call, and refuses anything that would raise it.
const policy = { limits: { perPaymentMinor: 50000, periodMinor: 100000, lifetimeMinor: 200000, period: 'MONTH', perPeriodCount: 5, lifetimeCount: 20, cooldownSeconds: 60 } } as any;

test('AUTO-04: narrowing lowers the per-payment cap and leaves every other limit as it was', () => {
  const out = narrowPerPayment(policy, 20000);
  assert.equal(out.ok, true);
  assert.equal((out as any).policy.limits.perPaymentMinor, 20000);
  assert.equal((out as any).policy.limits.periodMinor, 100000);
  assert.equal(policy.limits.perPaymentMinor, 50000, 'the original policy is not mutated');
});

test('AUTO-04: narrowing refuses to raise, to keep, or to take an invalid amount', () => {
  for (const amount of [50000, 60000, 0, -5, 12.5, Number.NaN]) {
    const out = narrowPerPayment(policy, amount);
    assert.equal(out.ok, false, `amount ${amount} must be refused`);
  }
});

test('AUTO-04: owner amounts in AED become whole fils, with at most two decimals', () => {
  assert.equal(aedToMinor('150'), 15000);
  assert.equal(aedToMinor(' 12.5 '), 1250);
  assert.equal(aedToMinor('0.01'), 1);
  assert.equal(aedToMinor('1.234'), undefined);
  assert.equal(aedToMinor('-3'), undefined);
  assert.equal(aedToMinor('abc'), undefined);
});
