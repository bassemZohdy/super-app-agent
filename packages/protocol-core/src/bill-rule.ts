/** The standard automatic bill rule the owner creates in the panel (AUTO-04). It pays one linked biller's invoice when it falls
 *  due, from one funding source, never above the per-payment cap the owner typed. The period and lifetime budgets are fixed
 *  multiples of that cap, so one rule cannot spend more than the owner reviewed. */
import { MANDATE_ACTOR, type MandatePolicy } from './payment-mandates.ts';

type BillerProvider = Extract<MandatePolicy['target'], { kind: 'BILLER' }>['provider'];

export type BillRuleInput = {
  billing: { id: string; version: number; provider: BillerProvider; reference: string };
  source: { methodId: string; version: number };
  perPaymentMinor: number;
  now: number;
};

export function billRulePolicy(input: BillRuleInput): MandatePolicy {
  const { billing, source, perPaymentMinor, now } = input;
  return {
    actorClientId: MANDATE_ACTOR, audience: 'provider-api', operation: 'BILL_PAYMENT', purpose: `Pay my ${billing.provider.toUpperCase()} bill automatically`, currency: 'AED',
    target: { kind: 'BILLER', billingAccountId: billing.id, expectedVersion: billing.version, provider: billing.provider, reference: billing.reference },
    sources: [{ methodId: source.methodId, expectedVersion: source.version }], fallback: { mode: 'NONE' },
    trigger: { type: 'INVOICE_DUE', daysBefore: 3 }, timezone: 'Asia/Dubai',
    startsAt: new Date(now - 60_000).toISOString(), expiresAt: new Date(now + 30 * 86_400_000).toISOString(),
    limits: { perPaymentMinor, periodMinor: perPaymentMinor * 2, lifetimeMinor: perPaymentMinor * 4, period: 'MONTH', perPeriodCount: 5, lifetimeCount: 20, cooldownSeconds: 60 },
  };
}
