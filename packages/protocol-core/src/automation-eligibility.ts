/** Which capabilities an approved financial mandate may ever act on (AUTO-13).
 *
 *  Default deny. A mandate authorizes one exact operation on one exact approved target; it never
 *  extends to another capability, however similar. Anything not listed here stays review-required:
 *  the owner decides each time, through the normal confirmation flow, and no automation credential,
 *  permit or budget applies to it. */
import type { MandateOperation } from './payment-mandates.ts';

/** Capability ids (the service catalog's, plus the telecom renewal which has no catalog entry yet) a mandate operation covers. */
export const AUTOMATIC_CAPABILITIES: Readonly<Record<string, MandateOperation>> = {
  'utilities.bill.pay': 'BILL_PAYMENT',
  'citizenpay.wallet.topup': 'WALLET_RELOAD',
  'mobility.toll.recharge': 'RECHARGE',
  'citizenpay.fines.pay': 'FINE_PAYMENT',
  'mobility.parking.extend': 'PARKING_EXTENSION',
  'telecom.subscription.renew': 'SUBSCRIPTION_RENEWAL',
};
/** Named for the record and for tests: these stay review-required whatever mandates exist. */
export const REVIEW_REQUIRED_CAPABILITIES: readonly string[] = [
  'telecom.subscription.change-plan', 'housing.move-in.execute', 'utilities.activation.start', 'mobility.ride.book', 'dining.order.create',
  'mobility.parking.activate', 'mobility.ev.start', 'citizenpay.wallet.pay', 'citizenpay.unified.pay',
];

export type Eligibility =
  | { automatic: true; operation: MandateOperation }
  | { automatic: false; reviewRequired: true; reason: 'NO_FINANCIAL_MANDATE' };
export function automationEligibility(capabilityId: string): Eligibility {
  const operation = Object.hasOwn(AUTOMATIC_CAPABILITIES, capabilityId) ? AUTOMATIC_CAPABILITIES[capabilityId] : undefined;
  return operation ? { automatic: true, operation } : { automatic: false, reviewRequired: true, reason: 'NO_FINANCIAL_MANDATE' };
}

export type RenewalFacts = {
  /** The billing period this occurrence renews, `YYYY-MM`. */
  period: string;
  subscription?: { status: string; monthlyAmountMinor: number };
  /** Every invoice the provider holds for the subscription. */
  invoices: { id: string; period?: string; status: string; amountMinor: number; paymentRestricted?: boolean }[];
};
export type RenewalVerdict = { eligible: true; invoiceId: string; amountMinor: number } | { eligible: false; reason: string };

/** One approved period renews at the current tariff, from an issued invoice, for an active subscription; nothing else renews. */
export function renewalEligibility(f: RenewalFacts): RenewalVerdict {
  if (!automationEligibility('telecom.subscription.renew').automatic) return { eligible: false, reason: 'CAPABILITY_REVIEW_REQUIRED' };
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(f.period)) return { eligible: false, reason: 'RENEWAL_PERIOD_INVALID' };
  if (!f.subscription || f.subscription.status !== 'ACTIVE') return { eligible: false, reason: 'SUBSCRIPTION_NOT_ACTIVE' };
  const forPeriod = f.invoices.filter(i => i.period === f.period);
  if (!forPeriod.length) return { eligible: false, reason: 'RENEWAL_NOT_INVOICED' };
  const open = forPeriod.filter(i => i.status === 'UNPAID');
  if (!open.length) return { eligible: false, reason: forPeriod.some(i => i.status === 'PAID') ? 'RENEWAL_ALREADY_PAID' : 'RENEWAL_NOT_PAYABLE' };
  if (open.length > 1) return { eligible: false, reason: 'RENEWAL_AMBIGUOUS' };
  const invoice = open[0]!;
  if (invoice.paymentRestricted) return { eligible: false, reason: 'RENEWAL_REQUIRES_REVIEW' };
  // The invoice must be exactly the current plan's price: a different amount is a plan change or a repricing, which only the owner approves.
  if (invoice.amountMinor !== f.subscription.monthlyAmountMinor) return { eligible: false, reason: 'TARIFF_CHANGED' };
  return { eligible: true, invoiceId: invoice.id, amountMinor: invoice.amountMinor };
}
