import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { JobStore } from '../automation-worker/src/jobs.ts';
import { Scheduler, type RuleSource, type ScheduledRule } from '../automation-worker/src/scheduler.ts';

const HOUR = 3_600_000;
const utc = (iso: string) => Date.parse(iso);
const calendar = (change: Partial<ScheduledRule> = {}, monthEnd: 'LAST_DAY' | 'SKIP' = 'LAST_DAY'): ScheduledRule => ({
  mandateId: 'mandate_cal', policyVersion: 1, state: 'APPROVED', trigger: { type: 'CALENDAR', dayOfMonth: 31, hour: 9, minute: 0, monthEnd },
  timezone: 'Asia/Dubai', startsAt: '2026-10-01T00:00:00.000Z', expiresAt: '2027-06-01T00:00:00.000Z', target: 'dewa-home', ...change,
});
const invoice = (change: Partial<ScheduledRule> = {}): ScheduledRule => ({ ...calendar(), mandateId: 'mandate_inv', trigger: { type: 'INVOICE_DUE', daysBefore: 3 }, ...change });
const threshold = (change: Partial<ScheduledRule> = {}): ScheduledRule => ({ ...calendar(), mandateId: 'mandate_thr', trigger: { type: 'LOW_BALANCE', belowMinor: 1000, reloadMinor: 5000, targetBalanceMinor: 10000 }, ...change });
const source = (rules: ScheduledRule[], extra: { invoices?: string[]; balance?: () => number } = {}): RuleSource => ({
  rules: async () => rules, dueInvoices: async () => (extra.invoices ?? []).map(dueDate => ({ dueDate })), balanceMinor: async () => (extra.balance ?? (() => 100000))(),
});
const keys = (store: JobStore, state?: string) => store.list().filter(j => !state || j.state === state).map(j => j.occurrenceKey).sort();

test('AUTO-06: a calendar rule produces exactly one job per month, however often the clock is ticked', async () => {
  const store = new JobStore(':memory:'), scheduler = new Scheduler(store, source([calendar()]));
  assert.deepEqual((await scheduler.tick(utc('2026-10-31T04:59:00Z'))).enqueued, [], 'one minute before 09:00 Dubai nothing is due');
  assert.deepEqual((await scheduler.tick(utc('2026-10-31T05:00:00Z'))).enqueued, ['mandate_cal:CAL:2026-10']);
  for (const at of ['2026-10-31T05:00:00Z', '2026-10-31T05:00:01Z', '2026-11-15T12:00:00Z']) await scheduler.tick(utc(at));
  assert.deepEqual(keys(store), ['CAL:2026-10'], 'duplicate and later ticks add nothing');
  await scheduler.tick(utc('2026-11-30T05:00:00Z'));
  assert.deepEqual(keys(store), ['CAL:2026-10', 'CAL:2026-11'], 'November has 30 days, so LAST_DAY runs on the 30th');
});

test('AUTO-06: stepping the clock and jumping it give deterministic runs, and downtime never becomes a burst', async () => {
  const stepped = new JobStore(':memory:'), jumped = new JobStore(':memory:');
  const a = new Scheduler(stepped, source([calendar()])), b = new Scheduler(jumped, source([calendar()]));
  for (let t = utc('2026-10-30T00:00:00Z'); t <= utc('2026-12-01T00:00:00Z'); t += 6 * HOUR) await a.tick(t);
  assert.deepEqual(keys(stepped, 'QUEUED'), ['CAL:2026-10', 'CAL:2026-11'], 'a scheduler that was up ran each month once');
  // The same rule after a month of downtime: only the latest occurrence stays pending.
  const result = await b.tick(utc('2026-12-01T00:00:00Z'));
  assert.deepEqual(result.enqueued, ['mandate_cal:CAL:2026-11']);
  assert.deepEqual(result.skipped, ['mandate_cal:CAL:2026-10']);
  assert.deepEqual(keys(jumped, 'QUEUED'), ['CAL:2026-11']);
  assert.deepEqual(keys(jumped, 'SKIPPED'), ['CAL:2026-10']);
  assert.equal(jumped.list().find(j => j.state === 'SKIPPED')!.reason, 'MISSED_CATCH_UP');
  assert.deepEqual(jumped.outbox(jumped.list().find(j => j.state === 'SKIPPED')!.id).map(e => e.kind), ['SKIPPED']);
  // Repeating the jump changes nothing, and a skipped occurrence is never caught up later.
  await b.tick(utc('2026-12-01T00:00:00Z')); await b.tick(utc('2026-12-02T00:00:00Z'));
  assert.equal(jumped.list().length, 2);
  // A long outage does not charge every missed month.
  const long = new JobStore(':memory:');
  const late = await new Scheduler(long, source([calendar()])).tick(utc('2027-05-15T00:00:00Z'));
  assert.deepEqual(late.enqueued, ['mandate_cal:CAL:2027-04']);
  assert.equal(long.list().filter(j => j.state === 'QUEUED').length, 1);
});

test('AUTO-06: month ends follow LAST_DAY or SKIP, including February and leap years', async () => {
  const last = new JobStore(':memory:'), skip = new JobStore(':memory:');
  const rule = (monthEnd: 'LAST_DAY' | 'SKIP') => calendar({ startsAt: '2027-01-01T00:00:00.000Z' }, monthEnd);
  const a = new Scheduler(last, source([rule('LAST_DAY')])), b = new Scheduler(skip, source([rule('SKIP')]));
  for (let t = utc('2027-01-30T00:00:00Z'); t <= utc('2027-03-02T00:00:00Z'); t += 12 * HOUR) { await a.tick(t); await b.tick(t); }
  assert.deepEqual(keys(last), ['CAL:2027-01', 'CAL:2027-02'], 'LAST_DAY runs on 28 February 2027');
  assert.deepEqual(keys(skip), ['CAL:2027-01'], 'SKIP has no February occurrence');
  assert.equal((await a.nextRun(rule('LAST_DAY'), utc('2027-02-01T00:00:00Z')))!.runAtUtc, utc('2027-03-31T05:00:00Z'), 'February is already handled, so the next run is March');
  assert.equal((await b.nextRun(rule('SKIP'), utc('2027-02-01T00:00:00Z')))!.key, 'CAL:2027-03');
});

test('AUTO-06: only an approved rule inside its window schedules, and a revised rule never repeats an occurrence', async () => {
  const store = new JobStore(':memory:');
  const at = utc('2026-10-31T05:00:00Z');
  for (const rule of [calendar({ state: 'PAUSED' }), calendar({ state: 'REVOKED' }), calendar({ startsAt: '2026-11-01T00:00:00.000Z' }), calendar({ expiresAt: '2026-10-31T05:00:00.000Z' })])
    assert.deepEqual((await new Scheduler(store, source([rule])).tick(at)).enqueued, []);
  assert.equal(store.list().length, 0);
  await new Scheduler(store, source([calendar()])).tick(at);
  const revised = await new Scheduler(store, source([calendar({ policyVersion: 2 })])).tick(at + HOUR);
  assert.deepEqual(revised.enqueued, [], 'version 2 does not run the occurrence version 1 already handled');
  assert.equal(store.list().length, 1);
  assert.equal(await new Scheduler(store, source([calendar({ state: 'PAUSED' })])).nextRun(calendar({ state: 'PAUSED' }), at), null);
});

test('AUTO-06: two schedulers over one database produce one job per occurrence', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'cityside-sched-')), path = join(dir, 'jobs.sqlite');
  const a = new JobStore(path), b = new JobStore(path);
  try {
    const at = utc('2026-10-31T05:00:00Z');
    await Promise.all([new Scheduler(a, source([calendar()])).tick(at), new Scheduler(b, source([calendar()])).tick(at)]);
    assert.deepEqual(keys(a), ['CAL:2026-10']);
    await Promise.all([new Scheduler(a, source([invoice()], { invoices: ['2026-11-15'] })).tick(utc('2026-11-12T05:00:00Z')), new Scheduler(b, source([invoice()], { invoices: ['2026-11-15'] })).tick(utc('2026-11-12T05:00:00Z'))]);
    assert.deepEqual(keys(a), ['CAL:2026-10', 'INV:2026-11-15']);
  } finally { a.close(); b.close(); try { rmSync(dir, { recursive: true, force: true }); } catch { /* Windows may briefly hold the directory */ } }
});

test('AUTO-06: invoice-due runs fire three local days before the due date and catch up as one pending run', async () => {
  const store = new JobStore(':memory:');
  const rule = invoice();
  assert.equal((await new Scheduler(store, source([rule], { invoices: ['2026-11-15'] })).nextRun(rule, utc('2026-11-01T00:00:00Z')))!.key, 'INV:2026-11-15');
  assert.deepEqual((await new Scheduler(store, source([rule], { invoices: ['2026-11-15'] })).tick(utc('2026-11-12T04:59:00Z'))).enqueued, []);
  assert.deepEqual((await new Scheduler(store, source([rule], { invoices: ['2026-11-15'] })).tick(utc('2026-11-12T05:00:00Z'))).enqueued, ['mandate_inv:INV:2026-11-15']);
  assert.equal(await new Scheduler(store, source([rule], { invoices: ['2026-11-15'] })).nextRun(rule, utc('2026-11-13T00:00:00Z')), null, 'a handled invoice has no further run');
  // Three overdue invoices after downtime: the newest run stays pending, the others are recorded as skipped.
  const late = new JobStore(':memory:');
  const result = await new Scheduler(late, source([invoice({ mandateId: 'mandate_late' })], { invoices: ['2026-11-05', '2026-11-15', '2026-11-25'] })).tick(utc('2026-11-27T00:00:00Z'));
  assert.deepEqual(result.enqueued, ['mandate_late:INV:2026-11-25']);
  assert.deepEqual(result.skipped.sort(), ['mandate_late:INV:2026-11-05', 'mandate_late:INV:2026-11-15']);
  assert.equal(late.list().filter(j => j.state === 'QUEUED').length, 1);
});

test('AUTO-06: a balance threshold fires once per dip, re-arms only after recovery, and survives duplicate evaluation', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'cityside-thr-')), path = join(dir, 'jobs.sqlite');
  const a = new JobStore(path), b = new JobStore(path);
  try {
    let balance = 5000;
    const rule = threshold(), read = source([rule], { balance: () => balance });
    const sa = new Scheduler(a, read), sb = new Scheduler(b, read), now = utc('2026-11-01T00:00:00Z');
    assert.deepEqual((await sa.tick(now)).enqueued, [], 'above the threshold nothing fires');
    balance = 400;
    const both = await Promise.all([sa.tick(now + HOUR), sb.tick(now + HOUR)]);
    assert.equal(both.flatMap(r => r.enqueued).length, 1, 'two evaluators of the same dip fire one job');
    for (let i = 2; i < 6; i++) await sa.tick(now + i * HOUR);
    assert.deepEqual(keys(a), ['THR:1'], 'staying below the threshold never fires again');
    assert.equal(a.thresholdState(rule.mandateId, 1).armed, false);
    balance = 1000;
    await sa.tick(now + 7 * HOUR);
    assert.equal(a.thresholdState(rule.mandateId, 1).armed, true, 'recovery re-arms');
    balance = 200;
    assert.deepEqual((await sb.tick(now + 8 * HOUR)).enqueued, ['mandate_thr:THR:2']);
    assert.deepEqual(keys(b), ['THR:1', 'THR:2']);
    // A revised rule starts from its own armed state under its own version.
    balance = 100;
    assert.equal((await new Scheduler(a, source([threshold({ policyVersion: 2 })], { balance: () => balance })).tick(now + 9 * HOUR)).enqueued.length, 1);
  } finally { a.close(); b.close(); try { rmSync(dir, { recursive: true, force: true }); } catch { /* Windows may briefly hold the directory */ } }
});

test('AUTO-06: event-driven triggers schedule nothing here', async () => {
  const store = new JobStore(':memory:');
  const rules = [calendar({ mandateId: 'm_fine', trigger: { type: 'NEW_FINE' } }), calendar({ mandateId: 'm_park', trigger: { type: 'PARKING_ENDING', minutesBefore: 10 } })];
  assert.deepEqual(await new Scheduler(store, source(rules)).tick(utc('2026-11-01T00:00:00Z')), { enqueued: [], skipped: [] });
  assert.equal(store.list().length, 0);
});

test('AUTO-06: invoices sharing a due date are one scheduled run, not a run and its own skips', async () => {
  const store = new JobStore(':memory:');
  const result = await new Scheduler(store, source([invoice()], { invoices: ['2026-11-15', '2026-11-15', '2026-11-15'] })).tick(utc('2026-11-13T00:00:00Z'));
  assert.deepEqual(result, { enqueued: ['mandate_inv:INV:2026-11-15'], skipped: [] });
  assert.deepEqual(store.list().map(j => [j.occurrenceKey, j.state]), [['INV:2026-11-15', 'QUEUED']]);
});
