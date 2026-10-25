// Pure schedule calculator for automation mandates (AUTO-06). No clock, no I/O: callers pass UTC instants.
// Business time is the mandate's IANA zone; security time (expiry of grants) is handled elsewhere.
import type { MandateTrigger } from './payment-mandates.ts';

export type CalendarTrigger = Extract<MandateTrigger, { type: 'CALENDAR' }>;
export const DEFAULT_TIMEZONE = 'Asia/Dubai';
export const INVOICE_RUN_HOUR = 9;
const MAX_CATCH_UP_MONTHS = 24;

const formatters = new Map<string, Intl.DateTimeFormat>();
function formatter(tz: string): Intl.DateTimeFormat {
  let f = formatters.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-CA', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
    formatters.set(tz, f);
  }
  return f;
}

export type LocalParts = { year: number; month: number; day: number; hour: number; minute: number };

export function assertTimezone(tz: string): void {
  try { formatter(tz); } catch { throw new RangeError(`Unknown IANA time zone: ${tz}`); }
}

export function localParts(utcMs: number, tz: string): LocalParts {
  const p: Record<string, number> = {};
  for (const part of formatter(tz).formatToParts(new Date(utcMs))) if (part.type !== 'literal') p[part.type] = Number(part.value);
  return { year: p.year!, month: p.month!, day: p.day!, hour: p.hour!, minute: p.minute! };
}

function offsetMs(utcMs: number, tz: string): number {
  const l = localParts(utcMs, tz);
  return Date.UTC(l.year, l.month - 1, l.day, l.hour, l.minute) - Math.floor(utcMs / 60000) * 60000;
}

/** Wall-clock time in `tz` to a UTC instant. A time skipped by a DST gap moves forward; a repeated time uses the first. */
export function zonedToUtc(year: number, month: number, day: number, hour: number, minute: number, tz: string): number {
  const wall = Date.UTC(year, month - 1, day, hour, minute);
  let guess = wall - offsetMs(wall, tz);
  guess = wall - offsetMs(guess, tz);
  const back = localParts(guess, tz);
  if (back.hour !== hour || back.minute !== minute) guess = wall - offsetMs(guess - 86400000, tz); // inside a gap: use the pre-transition offset
  return guess;
}

export function daysInMonth(year: number, month: number): number { return new Date(Date.UTC(year, month, 0)).getUTCDate(); }
const monthKey = (y: number, m: number) => `${y}-${String(m).padStart(2, '0')}`;
const dayKey = (y: number, m: number, d: number) => `${monthKey(y, m)}-${String(d).padStart(2, '0')}`;

export type Occurrence = { key: string; runAtUtc: number };

/** The occurrence of a calendar trigger in one local month, or null when LAST_DAY/SKIP says the month has none. */
export function calendarOccurrence(t: CalendarTrigger, tz: string, year: number, month: number): Occurrence | null {
  const last = daysInMonth(year, month);
  let day = t.dayOfMonth;
  if (day > last) { if (t.monthEnd === 'SKIP') return null; day = last; }
  return { key: `CAL:${monthKey(year, month)}`, runAtUtc: zonedToUtc(year, month, day, t.hour, t.minute, tz) };
}

function* monthsFrom(utcMs: number, tz: string, forward: boolean, limit: number): Generator<[number, number]> {
  const l = localParts(utcMs, tz);
  let idx = l.year * 12 + (l.month - 1);
  for (let i = 0; i < limit; i++, idx += forward ? 1 : -1) yield [Math.floor(idx / 12), (idx % 12) + 1];
}

/** First occurrence strictly after `afterUtc`, not before `startsAt`, and before `expiresAt`. */
export function nextCalendarRun(t: CalendarTrigger, tz: string, afterUtc: number, startsAtUtc: number, expiresAtUtc: number): Occurrence | null {
  const from = Math.max(afterUtc, startsAtUtc - 1);
  for (const [y, m] of monthsFrom(from, tz, true, 14)) {
    const o = calendarOccurrence(t, tz, y, m);
    if (o && o.runAtUtc > from && o.runAtUtc < expiresAtUtc) return o;
  }
  return null;
}

/** INVOICE_DUE: run `daysBefore` local days ahead of the due date at 09:00 local; a past run time is not caught up as a burst. */
export function invoiceRun(dueDate: string, daysBefore: number, tz: string): Occurrence {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dueDate);
  if (!m) throw new RangeError('dueDate must be YYYY-MM-DD');
  const due = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const d = new Date(due - daysBefore * 86400000);
  return { key: `INV:${dueDate}`, runAtUtc: zonedToUtc(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate(), INVOICE_RUN_HOUR, 0, tz) };
}

export type CatchUp = { pending: Occurrence | null; skipped: string[] };

/**
 * Bounded catch-up after downtime: of all calendar occurrences that are due, unhandled and inside the mandate window,
 * only the latest becomes pending; earlier ones are reported as skipped and are never charged as a burst.
 */
export function calendarCatchUp(t: CalendarTrigger, tz: string, nowUtc: number, startsAtUtc: number, expiresAtUtc: number, handled: ReadonlySet<string>): CatchUp {
  if (nowUtc < startsAtUtc) return { pending: null, skipped: [] };
  const due: Occurrence[] = [];
  for (const [y, m] of monthsFrom(nowUtc, tz, false, MAX_CATCH_UP_MONTHS)) {
    const o = calendarOccurrence(t, tz, y, m);
    if (!o || o.runAtUtc > nowUtc || o.runAtUtc >= expiresAtUtc) continue;
    if (o.runAtUtc < startsAtUtc) break;
    if (!handled.has(o.key)) due.push(o);
  }
  const [pending, ...older] = due; // newest first
  return { pending: pending ?? null, skipped: older.map((o) => o.key).reverse() };
}

/** Budget period key in the mandate zone: DAY → `D:YYYY-MM-DD`, MONTH → `M:YYYY-MM`. */
export function periodKey(period: 'DAY' | 'MONTH', tz: string, utcMs: number): string {
  const l = localParts(utcMs, tz);
  return period === 'DAY' ? `D:${dayKey(l.year, l.month, l.day)}` : `M:${monthKey(l.year, l.month)}`;
}

/** Start of the next budget period (the reset instant) in UTC. */
export function nextPeriodStart(period: 'DAY' | 'MONTH', tz: string, utcMs: number): number {
  const l = localParts(utcMs, tz);
  if (period === 'MONTH') return l.month === 12 ? zonedToUtc(l.year + 1, 1, 1, 0, 0, tz) : zonedToUtc(l.year, l.month + 1, 1, 0, 0, tz);
  const d = new Date(Date.UTC(l.year, l.month - 1, l.day) + 86400000);
  return zonedToUtc(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate(), 0, 0, tz);
}

export const cooldownEndsAt = (lastExecutionUtc: number, cooldownSeconds: number): number => lastExecutionUtc + cooldownSeconds * 1000;
