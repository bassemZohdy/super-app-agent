/** Narrowing a rule's per-payment cap (AUTO-04). Narrowing is a plain owner action with no model involved: it only ever lowers
 *  the cap, and the narrowed rule still needs the owner's explicit approval of its new review before it runs again. */
import type { MandatePolicy } from './payment-mandates.ts';

export type NarrowResult = { ok: true; policy: MandatePolicy } | { ok: false; reason: string };

export function narrowPerPayment(policy: MandatePolicy, newPerPaymentMinor: number): NarrowResult {
  if (!Number.isSafeInteger(newPerPaymentMinor) || newPerPaymentMinor < 1)
    return { ok: false, reason: 'The cap must be a whole amount of at least AED 0.01.' };
  if (newPerPaymentMinor >= policy.limits.perPaymentMinor)
    return { ok: false, reason: 'Narrowing lowers the cap. To raise it, create a new rule.' };
  return { ok: true, policy: { ...policy, limits: { ...policy.limits, perPaymentMinor: newPerPaymentMinor } } };
}

/** Parses an AED amount typed by the owner into integer fils, refusing anything that is not a positive amount with at most two decimals. */
export function aedToMinor(text: string): number | undefined {
  const trimmed = text.trim();
  if (!/^\d+(\.\d{1,2})?$/.test(trimmed)) return undefined;
  return Math.round(Number(trimmed) * 100);
}

/** Expanding a rule raises its per-payment cap. The change is a new review: the rule waits for the owner's approval before it runs again. */
export function expandPerPayment(policy: MandatePolicy, newPerPaymentMinor: number): NarrowResult {
  if (!Number.isSafeInteger(newPerPaymentMinor) || newPerPaymentMinor < 1)
    return { ok: false, reason: 'The cap must be a whole amount of at least AED 0.01.' };
  if (newPerPaymentMinor <= policy.limits.perPaymentMinor)
    return { ok: false, reason: 'Expanding raises the cap. To lower it, narrow the rule instead.' };
  // The budgets must contain the cap, so they grow with it; the review shows the new budgets before approval.
  const periodMinor = Math.max(policy.limits.periodMinor, newPerPaymentMinor);
  const lifetimeMinor = Math.max(policy.limits.lifetimeMinor, periodMinor);
  return { ok: true, policy: { ...policy, limits: { ...policy.limits, perPaymentMinor: newPerPaymentMinor, periodMinor, lifetimeMinor } } };
}

/** Changing the funding source is a new review: the rule waits for the owner's approval of the new source before it runs again. */
export function changeSource(policy: MandatePolicy, source: { methodId: string; version: number }): NarrowResult {
  const current = policy.sources[0];
  if (policy.sources.length === 1 && current.methodId === source.methodId && current.expectedVersion === source.version)
    return { ok: false, reason: 'The rule already pays from this source.' };
  return { ok: true, policy: { ...policy, sources: [{ methodId: source.methodId, expectedVersion: source.version }] } };
}
