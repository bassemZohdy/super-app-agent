/** Trusted source-provider lifecycle events (SIM-02): recurring invoices, fine discount changes,
 *  prepaid and toll usage, and parking departure.
 *
 *  Every event carries a stable id. Delivering it again returns the first outcome without a second
 *  bill, balance change or state change; reusing the id with different content is a conflict. An event
 *  that no longer applies (the bill was paid or withdrawn, the revision moved on, the session ended)
 *  is recorded as rejected, so a stale event can never revive a closed obligation. */
import { createHash } from 'node:crypto';
import type { AccountDatabase } from './database.ts';
import { PayableError, type ProviderPayables } from './payables.ts';
import type { ProviderRecharges } from './recharges.ts';

export type LifecycleEvent =
  | { kind: 'INVOICE_ISSUED'; eventId: string; billId: string; reference: string; amountMinor: number; dueDate: string; period: string }
  | { kind: 'INVOICE_CYCLE'; eventId: string; reference: string; startPeriod: string; periods: number; amountMinor: number; dueDay: number }
  | { kind: 'FINE_DISCOUNT_CHANGED'; eventId: string; payableId: string; expectedRevision: string; discountMinor: number; discountExpiresAt?: string }
  | { kind: 'USAGE_RECORDED'; eventId: string; targetReference: string; usageMinor: number }
  | { kind: 'PARKING_DEPARTED'; eventId: string; ticketId: string };
export type LifecycleResult = { eventId: string; kind: LifecycleEvent['kind']; outcome: 'APPLIED' | 'REJECTED'; replayed: boolean; code?: string; detail?: Record<string, unknown> };

const eventId = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,120}$/;
const period = /^(\d{4})-(0[1-9]|1[0-2])$/;
const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const deny = (status: number, code: string, message: string): never => { throw new PayableError(status, code, message); };
const addMonths = (value: string, months: number) => {
  const m = period.exec(value)!, index = Number(m[1]) * 12 + Number(m[2]) - 1 + months;
  return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, '0')}`;
};
const lastDay = (value: string) => { const m = period.exec(value)!; return new Date(Date.UTC(Number(m[1]), Number(m[2]), 0)).getUTCDate(); };

export class LifecycleEvents {
  readonly store: AccountDatabase; readonly provider: string; private readonly payables?: ProviderPayables; private readonly recharges?: ProviderRecharges; private readonly clock: () => number; private sequence = 0;
  constructor(store: AccountDatabase, provider: string, parts: { payables?: ProviderPayables; recharges?: ProviderRecharges; clock?: () => number }) {
    this.clock = parts.clock ?? Date.now; this.store = store; this.provider = provider; this.payables = parts.payables; this.recharges = parts.recharges;
    store.db.exec(`CREATE TABLE IF NOT EXISTS provider_lifecycle_events(account_id TEXT NOT NULL REFERENCES accounts(id),event_id TEXT NOT NULL,kind TEXT NOT NULL,fingerprint TEXT NOT NULL,outcome TEXT NOT NULL CHECK(outcome IN ('APPLIED','REJECTED')),result TEXT NOT NULL,PRIMARY KEY(account_id,event_id));
      CREATE TRIGGER IF NOT EXISTS provider_lifecycle_events_no_update BEFORE UPDATE ON provider_lifecycle_events BEGIN SELECT RAISE(ABORT,'Lifecycle events are immutable');END;
      CREATE TRIGGER IF NOT EXISTS provider_lifecycle_events_no_delete BEFORE DELETE ON provider_lifecycle_events BEGIN SELECT RAISE(ABORT,'Lifecycle events are immutable');END;`);
  }
  private atomic<T>(fn: () => T): T {
    if (!this.store.db.isTransaction) return this.store.transaction(fn);
    const name = `lifecycle_${++this.sequence}`; this.store.db.exec(`SAVEPOINT ${name}`);
    try { const out = fn(); this.store.db.exec(`RELEASE ${name}`); return out; } catch (e) { this.store.db.exec(`ROLLBACK TO ${name}`); this.store.db.exec(`RELEASE ${name}`); throw e; }
  }
  private record(account: string, event: LifecycleEvent, fingerprint: string, outcome: 'APPLIED' | 'REJECTED', result: Omit<LifecycleResult, 'replayed'>) {
    this.store.db.prepare('INSERT INTO provider_lifecycle_events VALUES(?,?,?,?,?,?)').run(account, event.eventId, event.kind, fingerprint, outcome, JSON.stringify(result));
  }
  history(account: string) {
    return this.store.db.prepare('SELECT event_id,kind,outcome,result FROM provider_lifecycle_events WHERE account_id=? ORDER BY rowid').all(account).map(r => ({ eventId: String(r.event_id), kind: String(r.kind), outcome: String(r.outcome), result: JSON.parse(String(r.result)) as LifecycleResult }));
  }

  /** Apply an event once. A repeat returns the stored outcome; a rejected event stays rejected. */
  ingest(account: string, event: LifecycleEvent): LifecycleResult {
    if (!event || typeof event !== 'object' || typeof event.eventId !== 'string' || !eventId.test(event.eventId)) return deny(400, 'EVENT_INVALID', 'Use a stable bounded event id.');
    const fingerprint = digest(event);
    const prior = this.store.db.prepare('SELECT fingerprint,result FROM provider_lifecycle_events WHERE account_id=? AND event_id=?').get(account, event.eventId);
    if (prior) {
      if (prior.fingerprint !== fingerprint) return deny(409, 'EVENT_CONFLICT', 'This event id was already used with different content.');
      return { ...JSON.parse(String(prior.result)) as LifecycleResult, replayed: true };
    }
    try {
      return this.atomic(() => {
        const detail = this.apply(account, event);
        const result = { eventId: event.eventId, kind: event.kind, outcome: 'APPLIED' as const, detail };
        this.record(account, event, fingerprint, 'APPLIED', result);
        return { ...result, replayed: false };
      });
    } catch (e) {
      // A malformed event (400) is a caller error and leaves no record; a state-based refusal is remembered under the same id.
      if (!(e instanceof PayableError) || e.status === 400) throw e;
      const result = { eventId: event.eventId, kind: event.kind, outcome: 'REJECTED' as const, code: e.code };
      this.atomic(() => this.record(account, event, fingerprint, 'REJECTED', result));
      return { ...result, replayed: false };
    }
  }

  private apply(account: string, event: LifecycleEvent): Record<string, unknown> {
    switch (event.kind) {
      case 'INVOICE_ISSUED': {
        if (!this.payables || this.provider === 'police') return deny(400, 'EVENT_UNSUPPORTED', 'This provider does not issue invoices.');
        const payable = this.payables.issueBill(account, event);
        return { payableId: payable.id, revision: payable.revision, amountMinor: payable.amountMinor, dueDate: payable.dueDate };
      }
      case 'INVOICE_CYCLE': {
        if (!this.payables || this.provider === 'police') return deny(400, 'EVENT_UNSUPPORTED', 'This provider does not issue invoices.');
        if (!period.test(event.startPeriod) || !Number.isInteger(event.periods) || event.periods < 1 || event.periods > 12 || !Number.isInteger(event.dueDay) || event.dueDay < 1 || event.dueDay > 28)
          return deny(400, 'EVENT_INVALID', 'Use a start period, 1 to 12 periods and a due day from 1 to 28.');
        const issued: string[] = [], skipped: string[] = [], tag = digest(event.reference).slice(0, 8);
        for (let i = 0; i < event.periods; i++) {
          const p = addMonths(event.startPeriod, i), billId = `CYC-${tag}-${p}`;
          const dueDate = `${p}-${String(Math.min(event.dueDay, lastDay(p))).padStart(2, '0')}`;
          // A period that already exists, in any state, is never recreated: a paid or withdrawn invoice stays closed.
          if (this.store.list(account, 'bill').some((b: { billId?: string }) => b.billId === billId)) { skipped.push(p); continue; }
          this.payables.issueBill(account, { billId, reference: event.reference, amountMinor: event.amountMinor, dueDate, period: p });
          issued.push(p);
        }
        return { issued, skipped };
      }
      case 'FINE_DISCOUNT_CHANGED': {
        if (this.provider !== 'police' || !this.payables) return deny(400, 'EVENT_UNSUPPORTED', 'Only fines carry a discount.');
        const payable = this.payables.amend(account, event.payableId, event.expectedRevision, { discountMinor: event.discountMinor, ...(event.discountExpiresAt ? { discountExpiresAt: event.discountExpiresAt } : {}) });
        return { payableId: payable.id, revision: payable.revision, amountMinor: payable.amountMinor, discountMinor: payable.discountMinor };
      }
      case 'USAGE_RECORDED': {
        if (!this.recharges) return deny(400, 'EVENT_UNSUPPORTED', 'This provider has no consumable balance.');
        return { targetReference: event.targetReference, ...this.recharges.recordUsage(account, event.targetReference, event.usageMinor) };
      }
      case 'PARKING_DEPARTED': {
        if (this.provider !== 'rta') return deny(400, 'EVENT_UNSUPPORTED', 'Only parking sessions depart.');
        const meter = this.store.get(account, 'parking', event.ticketId);
        if (!meter) return deny(404, 'SESSION_NOT_FOUND', 'Parking session not found in this account.');
        if (meter.status !== 'ACTIVE') return deny(409, 'SESSION_ALREADY_ENDED', 'This parking session already ended.');
        const endedAt = this.clock();
        this.store.put(account, 'parking', { ...meter, status: 'ENDED', endedAt, expiresAt: Math.min(Number(meter.expiresAt), endedAt) }, event.ticketId);
        return { ticketId: event.ticketId, endedAt };
      }
      default: return deny(400, 'EVENT_UNSUPPORTED', 'Unknown lifecycle event.');
    }
  }
}
