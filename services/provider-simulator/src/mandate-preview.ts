/** Read-only forecast of what a rule would do (AUTO-07).
 *
 *  `forecast` is a pure function of facts the caller has already read: it cannot reserve a budget,
 *  claim an invoice, issue a credential, create an order or call a provider, and an execution never
 *  trusts it: authority, source, biller and invoice are read again when the work is prepared. */
import type { PaymentMandate } from '../../../packages/protocol-core/src/payment-mandates.ts';
import { WALLET_FUNDING_LIMITS, type BillingAccount, type Payable, type PaymentMethod } from '../../../packages/protocol-core/src/payments.ts';
import { invoiceRun, nextCalendarRun, periodKey } from '../../../packages/protocol-core/src/mandate-schedule.ts';

export type PreviewUsage = { periodMinor: number; periodCount: number; lifetimeMinor: number; lifetimeCount: number; lastPreparedAt?: number };
export type PreviewFacts = {
  mandate: PaymentMandate; now: number;
  eligibility: { active: boolean; epoch: string };
  source?: Pick<PaymentMethod, 'id' | 'kind' | 'status' | 'version' | 'expiresMonth' | 'expiresYear'> & { nickname?: string };
  biller?: Pick<BillingAccount, 'status' | 'version'>;
  payables: Payable[]; claimedPayableIds?: ReadonlySet<string>;
  usage: PreviewUsage; walletBalanceMinor: number;
};
export type Candidate = {
  payableId: string; label: string; amountMinor: number; dueDate: string; scheduledRunAt: string;
  decision: 'DUE_NOW' | 'SCHEDULED' | 'SKIP'; reasons: string[]; warnings: string[];
};
export type Forecast = {
  previewOnly: true; zeroEffect: true; asOf: string; mandateId: string; policyVersion: number; state: PaymentMandate['state'];
  wouldRun: boolean; blockers: string[];
  source: { id: string; kind: string; status: string; usable: boolean; reason?: string };
  nextRun: { key: string; runAt: string } | null;
  candidates: Candidate[];
  budget: { periodKey: string; period: { usedMinor: number; limitMinor: number; usedCount: number; limitCount: number }; lifetime: { usedMinor: number; limitMinor: number; usedCount: number; limitCount: number }; cooldownEndsAt?: string };
};
const iso = (ms: number) => new Date(ms).toISOString();

export function forecast(f: PreviewFacts): Forecast {
  const { mandate: m, now } = f, policy = m.policy, limits = policy.limits, tz = policy.timezone;
  const startsAt = Date.parse(policy.startsAt), expiresAt = Date.parse(policy.expiresAt);
  const blockers: string[] = [];
  if (m.state !== 'APPROVED') blockers.push(m.state === 'AWAITING_APPROVAL' ? 'AWAITING_OWNER_APPROVAL' : `MANDATE_${m.state}`);
  if (m.skipNext) blockers.push('OWNER_SKIP_PENDING');
  if (now < startsAt) blockers.push('NOT_STARTED');
  if (now >= expiresAt) blockers.push('EXPIRED');
  if (!f.eligibility.active || f.eligibility.epoch !== (m.eligibilityEpoch || '1:1')) blockers.push('AUTHORITY_CHANGED');

  const wanted = policy.sources[0];
  let sourceView: Forecast['source'] = { id: wanted.methodId, kind: wanted.methodId === 'wallet' ? 'wallet' : 'card', status: 'MISSING', usable: false, reason: 'SOURCE_CHANGED' };
  const source = f.source;
  if (source) {
    const date = new Date(now);
    const expired = source.kind === 'card' && source.expiresYear !== undefined && source.expiresMonth !== undefined &&
      (source.expiresYear < date.getUTCFullYear() || source.expiresYear === date.getUTCFullYear() && source.expiresMonth < date.getUTCMonth() + 1);
    const reason = source.status !== 'ACTIVE' || source.version !== wanted.expectedVersion ? 'SOURCE_CHANGED' : expired ? 'SOURCE_EXPIRED' : undefined;
    sourceView = { id: source.id, kind: source.kind, status: source.status, usable: !reason, ...(reason ? { reason } : {}) };
  }
  if (!sourceView.usable) blockers.push(sourceView.reason!);

  const target = policy.target;
  if (target.kind === 'BILLER' && (!f.biller || f.biller.status !== 'ACTIVE' || f.biller.version !== target.expectedVersion)) blockers.push('BILLER_CHANGED');
  const supported = policy.operation === 'BILL_PAYMENT' && target.kind === 'BILLER' && ['dewa', 'etisalat', 'du'].includes(target.provider) && policy.trigger.type === 'INVOICE_DUE';
  const reload = policy.operation === 'WALLET_RELOAD' && target.kind === 'WALLET' && policy.trigger.type === 'LOW_BALANCE';
  if (!supported && !reload) blockers.push('EXECUTION_NOT_SUPPORTED_YET');

  let nextRun: Forecast['nextRun'] = null;
  const candidates: Candidate[] = [];
  const key = periodKey(limits.period, tz, now);
  let periodMinor = f.usage.periodMinor, periodCount = f.usage.periodCount, lifetimeMinor = f.usage.lifetimeMinor, lifetimeCount = f.usage.lifetimeCount;
  const cooldownEnd = f.usage.lastPreparedAt === undefined ? undefined : f.usage.lastPreparedAt + limits.cooldownSeconds * 1000;
  const cooling = cooldownEnd !== undefined && cooldownEnd > now;
  let wallet = f.walletBalanceMinor;

  if (policy.trigger.type === 'CALENDAR') {
    const run = nextCalendarRun(policy.trigger, tz, now, startsAt, expiresAt);
    if (run) nextRun = { key: run.key, runAt: iso(run.runAtUtc) };
  } else if (reload && policy.trigger.type === 'LOW_BALANCE') {
    // A reload is event-driven: it would run now only if the balance is below the threshold, for the finite amount that stays within the target.
    const trigger = policy.trigger, balance = f.walletBalanceMinor;
    const amount = Math.max(0, Math.min(trigger.reloadMinor, trigger.targetBalanceMinor - balance, WALLET_FUNDING_LIMITS.maxMinor));
    const reasons: string[] = [], warnings: string[] = [];
    if (balance >= trigger.belowMinor) reasons.push('BALANCE_ABOVE_THRESHOLD');
    else if (amount < WALLET_FUNDING_LIMITS.minMinor) reasons.push('NOTHING_TO_RELOAD');
    if (sourceView.kind !== 'card') reasons.push('SOURCE_NOT_A_CARD');
    if (amount > limits.perPaymentMinor) reasons.push('OVER_PER_PAYMENT_CAP');
    if (periodMinor + amount > limits.periodMinor || periodCount + 1 > limits.perPeriodCount) reasons.push('OVER_PERIOD_BUDGET');
    if (lifetimeMinor + amount > limits.lifetimeMinor || lifetimeCount + 1 > limits.lifetimeCount) reasons.push('OVER_LIFETIME_BUDGET');
    if (cooling) reasons.push('COOLDOWN');
    candidates.push({ payableId: 'wallet-reload', label: 'Wallet reload', amountMinor: amount, dueDate: iso(now).slice(0, 10), scheduledRunAt: iso(now), reasons, warnings,
      decision: reasons.length || blockers.length ? 'SKIP' : 'DUE_NOW' });
  } else if (policy.trigger.type === 'INVOICE_DUE' && target.kind === 'BILLER') {
    const trigger = policy.trigger;
    const invoices = f.payables.filter(p => p.reference === target.reference && p.status === 'UNPAID' && typeof p.dueDate === 'string')
      .sort((a, b) => String(a.dueDate).localeCompare(String(b.dueDate)) || a.id.localeCompare(b.id));
    for (const p of invoices) {
      const run = invoiceRun(p.dueDate!, trigger.daysBefore, tz);
      const reasons: string[] = [], warnings: string[] = [];
      if (f.claimedPayableIds?.has(p.id)) reasons.push('ALREADY_RESERVED');
      if (p.amountMinor > limits.perPaymentMinor) reasons.push('OVER_PER_PAYMENT_CAP');
      if (periodMinor + p.amountMinor > limits.periodMinor || periodCount + 1 > limits.perPeriodCount) reasons.push('OVER_PERIOD_BUDGET');
      if (lifetimeMinor + p.amountMinor > limits.lifetimeMinor || lifetimeCount + 1 > limits.lifetimeCount) reasons.push('OVER_LIFETIME_BUDGET');
      if (cooling) reasons.push('COOLDOWN');
      const open = reasons.length === 0 && blockers.length === 0;
      if (reasons.length === 0) {
        // Budget is only counted against later candidates when this one would actually run.
        if (open) { periodMinor += p.amountMinor; periodCount++; lifetimeMinor += p.amountMinor; lifetimeCount++; }
        if (wanted.methodId === 'wallet') { if (wallet < p.amountMinor) warnings.push('WALLET_BALANCE_LOW'); else if (open) wallet -= p.amountMinor; }
      }
      candidates.push({ payableId: p.id, label: p.label, amountMinor: p.amountMinor, dueDate: p.dueDate!, scheduledRunAt: iso(run.runAtUtc), reasons, warnings,
        decision: reasons.length || blockers.length ? 'SKIP' : run.runAtUtc <= now ? 'DUE_NOW' : 'SCHEDULED' });
    }
    const upcoming = invoices.map(p => invoiceRun(p.dueDate!, trigger.daysBefore, tz)).filter(r => r.runAtUtc > now && r.runAtUtc < expiresAt)[0];
    const due = candidates.find(c => c.decision === 'DUE_NOW');
    if (due) nextRun = { key: `INV:${due.dueDate}`, runAt: due.scheduledRunAt };
    else if (upcoming) nextRun = { key: upcoming.key, runAt: iso(upcoming.runAtUtc) };
  }
  return {
    previewOnly: true, zeroEffect: true, asOf: iso(now), mandateId: m.id, policyVersion: m.policyVersion, state: m.state,
    wouldRun: blockers.length === 0 && candidates.some(c => c.decision !== 'SKIP'), blockers: [...new Set(blockers)],
    source: sourceView, nextRun, candidates,
    budget: {
      periodKey: key,
      period: { usedMinor: f.usage.periodMinor, limitMinor: limits.periodMinor, usedCount: f.usage.periodCount, limitCount: limits.perPeriodCount },
      lifetime: { usedMinor: f.usage.lifetimeMinor, limitMinor: limits.lifetimeMinor, usedCount: f.usage.lifetimeCount, limitCount: limits.lifetimeCount },
      ...(cooldownEnd !== undefined && cooling ? { cooldownEndsAt: iso(cooldownEnd) } : {}),
    },
  };
}
