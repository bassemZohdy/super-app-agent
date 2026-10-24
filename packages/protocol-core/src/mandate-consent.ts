import type { PaymentMandate } from './payment-mandates.ts';

/**
 * Read-only consent summary for one payment mandate.
 *
 * Fields read (see mandateRecordSchema / mandatePolicySchema in payment-mandates.ts):
 *   record: id, state, executionEnabled, policy, sourceSnapshots, billerSnapshot, reviewExpiresAt
 *   policy: operation, purpose, target, sources, fallback, trigger, timezone, startsAt, expiresAt, limits
 * Nothing else is read. Missing or unexpected values never throw; they render as "not stated".
 *
 * Revocation wording is taken from docs/architecture/payment-automation-demo.md (section "Automation
 * and authority", line 85): "revoke/pause prevents new admissions and cancels queued work; an operation
 * already admitted may finish and must be shown as in-flight. Neither revocation nor stopping a worker
 * reverses a captured payment." Those are the documented rules for the execution permit; this release
 * keeps automatic execution disabled (executionEnabled: false), so the text is a conservative summary.
 */

export type MandateConsent = {
  title: string;
  status: string;
  trigger: string;
  target: string;
  funding: string;
  caps: string[];
  expiry: string;
  revocation: string;
};

type Loose = Record<string, unknown>;

const STATE_LABELS: Record<string, string> = {
  APPROVED: 'Approved',
  AWAITING_APPROVAL: 'Awaiting your approval',
  REVOKED: 'Revoked',
  EXPIRED: 'Expired',
};

const asObject = (value: unknown): Loose => (value && typeof value === 'object' && !Array.isArray(value) ? (value as Loose) : {});
const asArray = (value: unknown): Loose[] => (Array.isArray(value) ? value.map(asObject) : []);
const text = (value: unknown): string => (typeof value === 'string' && value.trim() !== '' ? value : 'not stated');
const isCount = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) >= 0;
const plural = (count: number, unit: string): string => `${count} ${unit}${count === 1 ? '' : 's'}`;

/** Formats fils as "AED 12.34". Never throws; invalid input renders as a neutral label. */
function money(minor: unknown): string {
  return isCount(minor) ? `AED ${(minor / 100).toFixed(2)}` : 'amount not stated';
}

function describeTrigger(raw: unknown, timezone: unknown): string {
  const trigger = asObject(raw);
  const zone = typeof timezone === 'string' && timezone ? ` · schedule time zone ${timezone}` : '';
  switch (trigger.type) {
    case 'INVOICE_DUE':
      return `${isCount(trigger.daysBefore) ? plural(trigger.daysBefore, 'day') : 'a set number of days'} before the invoice is due${zone}`;
    case 'CALENDAR':
      return `Day ${text(trigger.dayOfMonth)} of each month at ${text(trigger.hour)}:${text(trigger.minute)} · month-end rule ${text(trigger.monthEnd)}${zone}`;
    case 'LOW_BALANCE':
      return `When the wallet balance falls below ${money(trigger.belowMinor)}, reload ${money(trigger.reloadMinor)} toward ${money(trigger.targetBalanceMinor)}${zone}`;
    case 'NEW_FINE':
      return `When a new eligible fine is issued${zone}`;
    case 'PARKING_ENDING':
      return `${isCount(trigger.minutesBefore) ? plural(trigger.minutesBefore, 'minute') : 'a set time'} before parking ends${zone}`;
    default:
      return `Trigger not stated${zone}`;
  }
}

function describeTarget(raw: unknown, biller: Loose): string {
  const target = asObject(raw);
  switch (target.kind) {
    case 'WALLET':
      return 'Wallet';
    case 'BILLER': {
      const name = typeof biller.nickname === 'string' && biller.nickname ? biller.nickname : 'Biller account';
      return `${name} · ${text(target.provider)} · reference ${text(target.reference)}`;
    }
    case 'PARKING':
      return `Parking ticket ${text(target.ticketId)} · plate ${text(target.plateNumber)} · zone ${text(target.zoneId)} · up to ${isCount(target.maximumHours) ? plural(target.maximumHours, 'hour') : 'a set duration'} · ends ${text(target.endAt)}`;
    default:
      return 'Target not stated';
  }
}

function describeFunding(sources: unknown, fallbackRaw: unknown, snapshots: Loose[]): string {
  const labels = asArray(sources).map((source) => {
    const methodId = text(source.methodId);
    const snapshot = snapshots.find((method) => method.id === source.methodId);
    if (!snapshot) return `${methodId} (snapshot unavailable)`;
    const last4 = typeof snapshot.last4 === 'string' && snapshot.last4 ? ` •••• ${snapshot.last4}` : '';
    return `${text(snapshot.nickname)}${last4}`;
  });
  const sourceText = labels.length > 0 ? `Sources: ${labels.join(', ')}` : 'Sources: none stated';
  const fallback = asObject(fallbackRaw);
  const on = Array.isArray(fallback.on) ? fallback.on.map(String).join(' or ') : '';
  const fallbackText = fallback.mode === 'ORDERED' && on
    ? `Fallback enabled on ${on}`
    : fallback.mode === 'NONE' ? 'No fallback source' : 'Fallback not stated';
  return `${sourceText}. ${fallbackText}.`;
}

function describeCaps(raw: unknown): string[] {
  const limits = asObject(raw);
  const caps: string[] = [];
  if (isCount(limits.perPaymentMinor)) caps.push(`Up to ${money(limits.perPaymentMinor)} per payment`);
  if (isCount(limits.periodMinor)) {
    const period = text(limits.period);
    const count = isCount(limits.perPeriodCount) ? `, at most ${plural(limits.perPeriodCount, 'payment')} per ${period}` : '';
    caps.push(`Up to ${money(limits.periodMinor)} per ${period}${count}`);
  }
  if (isCount(limits.lifetimeMinor)) {
    const count = isCount(limits.lifetimeCount) ? `, at most ${plural(limits.lifetimeCount, 'payment')} in total` : '';
    caps.push(`Up to ${money(limits.lifetimeMinor)} in total${count}`);
  }
  if (isCount(limits.cooldownSeconds)) caps.push(`Cooldown of ${limits.cooldownSeconds} seconds between payments`);
  return caps;
}

function describeExpiry(state: unknown, policy: Loose, record: Loose): string {
  const window = `Window ${text(policy.startsAt)} to ${text(policy.expiresAt)}`;
  if (state === 'EXPIRED') return `Expired: window ended ${text(policy.expiresAt)}`;
  if (state === 'AWAITING_APPROVAL') return `Awaiting approval; review expires ${text(record.reviewExpiresAt)}. ${window}`;
  if (state === 'REVOKED') return `${window}; revoked`;
  return window;
}

function describeRevocation(state: unknown): string {
  if (state === 'REVOKED') {
    return 'Revoked: no new runs are admitted under this rule. Captured payments are not reversed by revocation.';
  }
  if (state === 'EXPIRED') {
    return 'Expired: no new runs are admitted after the window ends. Payments already captured are not reversed.';
  }
  return 'Revoking stops new admissions for this rule. An operation already admitted may finish and is shown as in-flight; revoking does not reverse a captured payment.';
}

/**
 * Describes what a mandate authorises and what changing it would mean, for display only.
 * Never throws: any missing or unexpected field renders as "not stated".
 */
export function describeMandateConsent(record: Partial<PaymentMandate> | null | undefined): MandateConsent {
  const mandate = asObject(record);
  const policy = asObject(mandate.policy);
  const snapshots = asArray(mandate.sourceSnapshots);
  const biller = asObject(mandate.billerSnapshot);
  const label = typeof mandate.state === 'string' ? STATE_LABELS[mandate.state] ?? 'Unknown state' : 'Unknown state';
  const disabledNote = mandate.executionEnabled === true ? '' : ' · automatic execution disabled';
  const purpose = text(policy.purpose);
  return {
    title: `${text(policy.operation)} · ${purpose}`,
    status: `${label}${disabledNote}`,
    trigger: describeTrigger(policy.trigger, policy.timezone),
    target: describeTarget(policy.target, biller),
    funding: describeFunding(policy.sources, policy.fallback, snapshots),
    caps: describeCaps(policy.limits),
    expiry: describeExpiry(mandate.state, policy, mandate),
    revocation: describeRevocation(mandate.state),
  };
}
