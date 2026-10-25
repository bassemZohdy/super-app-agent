import test from 'node:test';
import assert from 'node:assert/strict';
import { calendarOccurrence, nextCalendarRun, calendarCatchUp, invoiceRun, periodKey, nextPeriodStart, zonedToUtc, localParts, cooldownEndsAt, assertTimezone } from '../../packages/protocol-core/src/mandate-schedule.ts';

const DXB = 'Asia/Dubai';
const t = (dayOfMonth: number, monthEnd: 'LAST_DAY' | 'SKIP' = 'LAST_DAY') => ({ type: 'CALENDAR' as const, dayOfMonth, hour: 9, minute: 30, monthEnd });
const iso = (ms: number) => new Date(ms).toISOString();

test('calendar run is wall-clock in the mandate zone (UTC+4)', () => {
  assert.equal(iso(calendarOccurrence(t(15), DXB, 2026, 11)!.runAtUtc), '2026-11-15T05:30:00.000Z');
});

test('month-end: day 31 clamps in LAST_DAY mode and is skipped in SKIP mode', () => {
  assert.equal(iso(calendarOccurrence(t(31), DXB, 2026, 2)!.runAtUtc), '2026-02-28T05:30:00.000Z');
  assert.equal(iso(calendarOccurrence(t(31), DXB, 2028, 2)!.runAtUtc), '2028-02-29T05:30:00.000Z');
  assert.equal(calendarOccurrence(t(31, 'SKIP'), DXB, 2026, 4), null);
  assert.ok(calendarOccurrence(t(31, 'SKIP'), DXB, 2026, 5));
});

test('leap-year clamp uses Feb 29', () => {
  assert.equal(iso(calendarOccurrence(t(30), DXB, 2028, 2)!.runAtUtc), '2028-02-29T05:30:00.000Z');
});

test('nextCalendarRun respects startsAt, expiresAt and strictly-after', () => {
  const start = Date.parse('2026-10-25T00:00:00Z'), end = Date.parse('2027-01-10T00:00:00Z');
  const first = nextCalendarRun(t(15), DXB, start, start, end)!;
  assert.equal(first.key, 'CAL:2026-11');
  const second = nextCalendarRun(t(15), DXB, first.runAtUtc, start, end)!;
  assert.equal(second.key, 'CAL:2026-12');
  assert.equal(nextCalendarRun(t(15), DXB, second.runAtUtc, start, end), null); // Jan 15 is past expiry
  assert.equal(nextCalendarRun(t(15), DXB, 0, start, end)!.key, 'CAL:2026-11'); // never before startsAt
});

test('downtime never produces a burst: only the latest missed occurrence is pending', () => {
  const start = Date.parse('2026-01-01T00:00:00Z'), end = Date.parse('2027-12-31T00:00:00Z');
  const now = Date.parse('2026-06-20T00:00:00Z');
  const r = calendarCatchUp(t(15), DXB, now, start, end, new Set(['CAL:2026-01']));
  assert.equal(r.pending!.key, 'CAL:2026-06');
  assert.deepEqual(r.skipped, ['CAL:2026-02', 'CAL:2026-03', 'CAL:2026-04', 'CAL:2026-05']);
});

test('handled and not-yet-due occurrences are not pending; duplicate triggers are idempotent', () => {
  const start = Date.parse('2026-01-01T00:00:00Z'), end = Date.parse('2027-12-31T00:00:00Z');
  const now = Date.parse('2026-06-10T00:00:00Z');
  const all = new Set(['CAL:2026-01', 'CAL:2026-02', 'CAL:2026-03', 'CAL:2026-04', 'CAL:2026-05']);
  assert.deepEqual(calendarCatchUp(t(15), DXB, now, start, end, all), { pending: null, skipped: [] });
  const again = calendarCatchUp(t(15), DXB, Date.parse('2026-06-16T00:00:00Z'), start, end, all);
  assert.equal(again.pending!.key, 'CAL:2026-06');
  assert.deepEqual(calendarCatchUp(t(15), DXB, Date.parse('2026-06-16T00:00:00Z'), start, end, new Set([...all, 'CAL:2026-06'])).pending, null);
});

test('nothing is pending before start or at/after expiry', () => {
  const start = Date.parse('2026-06-01T00:00:00Z'), end = Date.parse('2026-06-15T00:00:00Z');
  assert.equal(calendarCatchUp(t(15), DXB, start - 1, start, end, new Set()).pending, null);
  assert.equal(calendarCatchUp(t(15), DXB, Date.parse('2026-08-01T00:00:00Z'), start, end, new Set()).pending, null);
});

test('invoice run is daysBefore local days earlier at 09:00', () => {
  assert.equal(iso(invoiceRun('2026-11-10', 3, DXB).runAtUtc), '2026-11-07T05:00:00.000Z');
  assert.equal(invoiceRun('2026-11-10', 0, DXB).key, 'INV:2026-11-10');
  assert.throws(() => invoiceRun('10/11/2026', 1, DXB), RangeError);
});

test('period keys and resets follow the local zone, not UTC', () => {
  const lateUtc = Date.parse('2026-10-31T21:30:00Z'); // 01:30 on 1 Nov in Dubai
  assert.equal(periodKey('MONTH', DXB, lateUtc), 'M:2026-11');
  assert.equal(periodKey('MONTH', 'UTC', lateUtc), 'M:2026-10');
  assert.equal(periodKey('DAY', DXB, lateUtc), 'D:2026-11-01');
  assert.equal(iso(nextPeriodStart('MONTH', DXB, lateUtc)), '2026-11-30T20:00:00.000Z');
  assert.equal(iso(nextPeriodStart('DAY', DXB, lateUtc)), '2026-11-01T20:00:00.000Z');
  assert.equal(iso(nextPeriodStart('MONTH', DXB, Date.parse('2026-12-15T00:00:00Z'))), '2026-12-31T20:00:00.000Z');
});

test('DST zones: skipped wall time moves forward, repeated time uses the first', () => {
  const ny = 'America/New_York';
  assert.equal(iso(zonedToUtc(2026, 3, 8, 2, 30, ny)), '2026-03-08T07:30:00.000Z'); // 02:30 does not exist
  assert.equal(iso(zonedToUtc(2026, 11, 1, 1, 30, ny)), '2026-11-01T05:30:00.000Z'); // first 01:30 (EDT)
  assert.deepEqual(localParts(Date.parse('2026-07-01T12:00:00Z'), ny), { year: 2026, month: 7, day: 1, hour: 8, minute: 0 });
});

test('cooldown end and timezone validation', () => {
  assert.equal(cooldownEndsAt(1000, 60), 61000);
  assert.throws(() => assertTimezone('Mars/Olympus'), RangeError);
  assertTimezone(DXB);
});
