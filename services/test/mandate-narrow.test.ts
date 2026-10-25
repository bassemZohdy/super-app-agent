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

test('AUTO-04: expanding raises the cap and refuses to lower or keep it', async () => {
  const { expandPerPayment, changeSource } = await import('../../packages/protocol-core/src/mandate-narrow.ts');
  const out = expandPerPayment(policy, 60000);
  assert.equal(out.ok, true);
  assert.equal((out as any).policy.limits.perPaymentMinor, 60000);
  assert.equal(expandPerPayment(policy, 50000).ok, false, 'keeping the cap is not an expansion');
  assert.equal(expandPerPayment(policy, 40000).ok, false, 'lowering is narrowing, not expanding');
});

test('AUTO-04: a source change names the new source and refuses a no-op change', async () => {
  const { changeSource } = await import('../../packages/protocol-core/src/mandate-narrow.ts');
  const withWallet = { ...policy, sources: [{ methodId: 'wallet', expectedVersion: 1 }] };
  const out = changeSource(withWallet, { methodId: 'card_1', version: 3 });
  assert.equal(out.ok, true);
  assert.deepEqual((out as any).policy.sources, [{ methodId: 'card_1', expectedVersion: 3 }]);
  assert.equal(changeSource(withWallet, { methodId: 'wallet', version: 1 }).ok, false);
});

test('AUTO-04: expanding keeps the budgets ordered: the cap never exceeds the period or lifetime budget', async () => {
  const { expandPerPayment } = await import('../../packages/protocol-core/src/mandate-narrow.ts');
  const out = expandPerPayment(policy, 300000) as any;
  assert.equal(out.ok, true);
  assert.ok(out.policy.limits.perPaymentMinor <= out.policy.limits.periodMinor, 'per-payment fits the period budget');
  assert.ok(out.policy.limits.periodMinor <= out.policy.limits.lifetimeMinor, 'period fits the lifetime budget');
  assert.equal(out.policy.limits.lifetimeMinor, 300000, 'the lifetime budget grew to the new cap');
});
