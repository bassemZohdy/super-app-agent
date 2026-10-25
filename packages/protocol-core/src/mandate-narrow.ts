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
