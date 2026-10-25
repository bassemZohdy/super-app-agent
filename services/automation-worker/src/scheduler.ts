/** Turns approved rules, the clock and the schedule calculator into jobs (AUTO-06).
 *
 *  `tick(now)` is a pure function of the rules, the occurrence keys already recorded and `now`, so
 *  repeating it, running it from two processes or advancing time in any number of steps gives the
 *  same jobs. Downtime never becomes a burst: of all missed occurrences only the latest stays
 *  pending and the rest are recorded as skipped. */
import { calendarCatchUp, invoiceRun, nextCalendarRun } from '../../../packages/protocol-core/src/mandate-schedule.ts';
import type { MandateTrigger } from '../../../packages/protocol-core/src/payment-mandates.ts';
import type { JobStore } from './jobs.ts';

export type ScheduledRule = {
  mandateId: string; policyVersion: number; state: string; trigger: MandateTrigger;
  timezone: string; startsAt: string; expiresAt: string; target: string;
};
/** What the scheduler may read about the world; the worker-facing provider read in production, a fake in tests. */
export interface RuleSource {
  rules(): Promise<ScheduledRule[]>;
  /** Unpaid invoices of the rule's biller, by due date (YYYY-MM-DD). */
  dueInvoices(rule: ScheduledRule): Promise<{ dueDate: string }[]>;
  /** Current wallet balance in integer fils, for threshold triggers. */
  balanceMinor(rule: ScheduledRule): Promise<number>;
}
export type TickResult = { enqueued: string[]; skipped: string[] };
const MISSED = 'MISSED_CATCH_UP';

export class Scheduler {
  readonly store: JobStore; readonly source: RuleSource; readonly leadMs: number;
  /** `leadMs` is how far ahead of a run the owner is told about it. */
  constructor(store: JobStore, source: RuleSource, options: { leadMs?: number } = {}) { this.store = store; this.source = source; this.leadMs = options.leadMs ?? 24 * 3_600_000; }

  async tick(now: number): Promise<TickResult> {
    const out: TickResult = { enqueued: [], skipped: [] };
    for (const rule of await this.source.rules()) {
      const startsAt = Date.parse(rule.startsAt), expiresAt = Date.parse(rule.expiresAt);
      // Only a currently approved rule inside its window schedules anything; consent is not revived by time.
      if (rule.state !== 'APPROVED' || !(startsAt <= now && now < expiresAt)) continue;
      const base = { mandateId: rule.mandateId, policyVersion: rule.policyVersion, target: rule.target };
      const enqueue = (key: string) => { this.store.enqueue({ ...base, occurrenceKey: key }, now); out.enqueued.push(`${rule.mandateId}:${key}`); };
      const skip = (key: string) => { this.store.enqueueSkipped({ ...base, occurrenceKey: key }, MISSED, now); out.skipped.push(`${rule.mandateId}:${key}`); };
      const handled = this.store.handledKeys(rule.mandateId);
      const trigger = rule.trigger;
      if (trigger.type === 'CALENDAR') {
        const { pending, skipped } = calendarCatchUp(trigger, rule.timezone, now, startsAt, expiresAt, handled);
        skipped.forEach(skip);
        if (pending) enqueue(pending.key);
      } else if (trigger.type === 'INVOICE_DUE') {
        // One occurrence per due date: invoices sharing a due date are one scheduled run, and the provider picks the invoice at preparation.
        const runs = new Map((await this.source.dueInvoices(rule)).map(i => invoiceRun(i.dueDate, trigger.daysBefore, rule.timezone)).map(o => [o.key, o]));
        const due = [...runs.values()].filter(o => o.runAtUtc <= now && !handled.has(o.key)).sort((a, b) => a.runAtUtc - b.runAtUtc || a.key.localeCompare(b.key));
        const newest = due.pop();
        due.forEach(o => skip(o.key));
        if (newest) enqueue(newest.key);
      } else if (trigger.type === 'LOW_BALANCE') {
        const balance = await this.source.balanceMinor(rule);
        if (balance >= trigger.belowMinor) this.store.rearmThreshold(rule.mandateId, rule.policyVersion);
        else if (this.store.fireThreshold(base, now)) out.enqueued.push(`${rule.mandateId}:THR:${this.store.thresholdState(rule.mandateId, rule.policyVersion).seq}`);
      }
      // Pre-run notification: once per rule and occurrence, when the next run is inside the lead time and has not started.
      const upcoming = await this.nextRun(rule, now);
      if (upcoming && upcoming.runAtUtc > now && upcoming.runAtUtc - now <= this.leadMs)
        this.store.recordNotice(rule.mandateId, upcoming.key, 'UPCOMING_RUN', { runAt: new Date(upcoming.runAtUtc).toISOString(), policyVersion: rule.policyVersion, target: rule.target }, now);
      // NEW_FINE and PARKING_ENDING are event-driven and belong to their own tasks; they schedule nothing here.
    }
    return out;
  }

  /** The next time this rule would run after `now`, for previews; null when nothing further is scheduled. */
  async nextRun(rule: ScheduledRule, now: number): Promise<{ key: string; runAtUtc: number } | null> {
    const startsAt = Date.parse(rule.startsAt), expiresAt = Date.parse(rule.expiresAt), trigger = rule.trigger;
    if (rule.state !== 'APPROVED' || now >= expiresAt) return null;
    const handled = this.store.handledKeys(rule.mandateId);
    if (trigger.type === 'CALENDAR') {
      let after = now;
      for (let i = 0; i < 24; i++) {
        const next = nextCalendarRun(trigger, rule.timezone, after, startsAt, expiresAt);
        if (!next) return null;
        if (!handled.has(next.key)) return next;
        after = next.runAtUtc;
      }
      return null;
    }
    if (trigger.type === 'INVOICE_DUE') {
      const upcoming = (await this.source.dueInvoices(rule)).map(i => invoiceRun(i.dueDate, trigger.daysBefore, rule.timezone))
        .filter(o => o.runAtUtc > now && o.runAtUtc < expiresAt && !handled.has(o.key)).sort((a, b) => a.runAtUtc - b.runAtUtc);
      return upcoming[0] ?? null;
    }
    return null;
  }
}
