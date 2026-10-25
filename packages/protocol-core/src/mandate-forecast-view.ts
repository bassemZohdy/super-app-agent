/** Plain-language view of a rule forecast (AUTO-07), shared by every shell so the same facts read the same everywhere.
 *  Pure: it formats what the provider already computed and decides nothing itself. */
export type ForecastLike = {
  asOf?: string; wouldRun?: boolean; blockers?: string[];
  source?: { id?: string; kind?: string; status?: string; usable?: boolean; reason?: string };
  nextRun?: { key?: string; runAt?: string } | null;
  candidates?: { payableId?: string; label?: string; amountMinor?: number; dueDate?: string; scheduledRunAt?: string; decision?: string; reasons?: string[]; warnings?: string[] }[];
  budget?: { period?: { usedMinor?: number; limitMinor?: number; usedCount?: number; limitCount?: number }; lifetime?: { usedMinor?: number; limitMinor?: number; usedCount?: number; limitCount?: number }; cooldownEndsAt?: string };
};
export type ForecastView = {
  headline: string; blockers: string[]; source: string; nextRun: string; budget: string[];
  candidates: { label: string; amount: string; due: string; runs: string; outcome: string; reasons: string[]; warnings: string[] }[];
  note: string;
};

const REASONS: Record<string, string> = {
  AWAITING_OWNER_APPROVAL: 'The rule is a draft until you approve it.',
  MANDATE_PAUSED: 'The rule is paused.', MANDATE_REVOKED: 'The rule was revoked.', MANDATE_EXPIRED: 'The rule has expired.',
  OWNER_SKIP_PENDING: 'You asked to skip the next occurrence.', NOT_STARTED: 'The rule has not started yet.', EXPIRED: 'The rule has expired.',
  AUTHORITY_CHANGED: 'Your access or workspace permission changed; approve the rule again.',
  SOURCE_CHANGED: 'The funding source changed or is unavailable.', SOURCE_EXPIRED: 'The funding card has expired.',
  BILLER_CHANGED: 'The linked account changed or is unavailable.',
  EXECUTION_NOT_SUPPORTED_YET: 'Automatic payment is not available for this kind of rule yet.',
  SESSION_ENDED: 'The parking session has ended.', SESSION_EXPIRED: 'The parking session already expired; a new session is a new purchase.', SESSION_MISMATCH: 'The session no longer matches the approved plate and zone.', SESSION_NOT_FOUND: 'The approved parking session was not found.', SESSION_NOT_ENDING: 'The session is not close enough to ending.',
  MAXIMUM_DURATION_REACHED: 'The session reached the maximum hours you approved.', END_TIME_REACHED: 'Another hour would pass the end time you approved.',
  FINE_REQUIRES_REVIEW: 'This fine needs your review before it can be paid.', FINE_TYPE_NOT_APPROVED: 'This kind of fine is not one you approved for automatic payment.', FINE_NOT_FOUND: 'This fine is no longer on your plate.', FINE_NOT_PAYABLE: 'This fine is already paid or withdrawn.',
  TARGET_UNAVAILABLE: 'The linked tag or number is unavailable.', DENOMINATION_UNAVAILABLE: 'The approved recharge amount is not offered for this target.', WOULD_EXCEED_TARGET_BALANCE: 'The recharge would take the balance past its target.',
  BALANCE_ABOVE_THRESHOLD: 'The wallet balance is above the reload threshold.', NOTHING_TO_RELOAD: 'The wallet is already at or near its target balance.', SOURCE_NOT_A_CARD: 'A reload must be funded by a saved card.',
  OVER_PER_PAYMENT_CAP: 'Above the per-payment cap.', OVER_PERIOD_BUDGET: 'Would exceed this period’s budget.', OVER_LIFETIME_BUDGET: 'Would exceed the lifetime budget.',
  COOLDOWN: 'Waiting for the cooldown between payments.', ALREADY_RESERVED: 'Already reserved by another payment.',
  WALLET_BALANCE_LOW: 'The wallet balance is below this amount; the payment would need your attention.',
};
const text = (code: string) => REASONS[code] ?? code.replace(/_/g, ' ').toLowerCase().replace(/^./, (c: string) => c.toUpperCase()) + '.';
const aed = (minor: unknown) => Number.isSafeInteger(minor) ? `AED ${((minor as number) / 100).toFixed(2)}` : 'unknown amount';
const when = (iso: unknown) => typeof iso === 'string' && Number.isFinite(Date.parse(iso)) ? iso.replace('T', ' ').replace(/:\d\d\.\d+Z$/, ' UTC').replace(/:\d\dZ$/, ' UTC') : 'not scheduled';
const share = (used: unknown, limit: unknown, usedCount: unknown, limitCount: unknown) => `${aed(used)} of ${aed(limit)} used, ${Number(usedCount ?? 0)} of ${Number(limitCount ?? 0)} payments`;

export function describeForecast(forecast: ForecastLike | undefined): ForecastView {
  const f = forecast ?? {}, source = f.source ?? {}, budget = f.budget ?? {};
  const blockers = (f.blockers ?? []).map(text);
  return {
    headline: f.wouldRun ? 'This rule would pay when its run time arrives.' : 'This rule would not pay right now.',
    blockers,
    source: `${source.kind === 'wallet' ? 'Wallet' : source.kind === 'card' ? 'Saved card' : 'Funding source'} ${source.id ?? ''} · ${source.usable ? 'usable' : text(source.reason ?? 'SOURCE_CHANGED')}`.replace('  ', ' '),
    nextRun: f.nextRun?.runAt ? `${when(f.nextRun.runAt)} (${f.nextRun.key})` : 'No further run is scheduled.',
    budget: [
      `This period: ${share(budget.period?.usedMinor, budget.period?.limitMinor, budget.period?.usedCount, budget.period?.limitCount)}`,
      `Lifetime: ${share(budget.lifetime?.usedMinor, budget.lifetime?.limitMinor, budget.lifetime?.usedCount, budget.lifetime?.limitCount)}`,
      ...(budget.cooldownEndsAt ? [`Cooldown until ${when(budget.cooldownEndsAt)}`] : []),
    ],
    candidates: (f.candidates ?? []).map(c => ({
      label: c.label ?? c.payableId ?? 'Invoice', amount: aed(c.amountMinor), due: c.dueDate ?? 'no due date', runs: when(c.scheduledRunAt),
      outcome: c.decision === 'DUE_NOW' ? 'Would be paid at the next run' : c.decision === 'SCHEDULED' ? 'Scheduled for its own run' : 'Would be skipped',
      reasons: (c.reasons ?? []).map(text), warnings: (c.warnings ?? []).map(text),
    })),
    note: 'Preview only: nothing was reserved, charged or changed. Everything is checked again when a payment is actually prepared.',
  };
}
