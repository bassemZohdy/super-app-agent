/** Source-owned parking extension quotes (AUTO-12). A quote is not an extension: the session only changes when an
 *  admitted, captured and settled order applies it, and only while the session is exactly as it was quoted. */
import { createHash, randomUUID } from 'node:crypto';
import type { AccountDatabase } from './database.ts';
import { MAX_PAYMENT_MINOR, type Payable, type PaymentReceipt } from '../../../packages/protocol-core/src/payments.ts';
import { PayableError } from './payables.ts';
import { parkingZones } from './fixtures.ts';

const deny = (code: string, message: string, status = 409): never => { throw new PayableError(status, code, message); };
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
type Quote = { payable: Payable; intentId: string; expiresAt: string; receipt?: PaymentReceipt };
export type ParkingMeter = { ticketId: string; zoneId: string; plateNumber: string; durationHours: number; totalFee: number; startTime: number; expiresAt: number; status: string };

export class ProviderParkingExtensions {
  readonly store: AccountDatabase; readonly clock: () => number; private sequence = 0;
  constructor(store: AccountDatabase, clock = Date.now) {
    this.store = store; this.clock = clock;
    store.db.exec('CREATE TABLE IF NOT EXISTS provider_parking_quotes(id TEXT PRIMARY KEY,account_id TEXT NOT NULL REFERENCES accounts(id),intent_id TEXT NOT NULL,body TEXT NOT NULL,UNIQUE(account_id,intent_id))');
  }
  private atomic<T>(fn: () => T): T {
    if (!this.store.db.isTransaction) return this.store.transaction(fn);
    const name = `parking_${++this.sequence}`; this.store.db.exec(`SAVEPOINT ${name}`);
    try { const out = fn(); this.store.db.exec(`RELEASE ${name}`); return out; } catch (e) { this.store.db.exec(`ROLLBACK TO ${name}`); this.store.db.exec(`RELEASE ${name}`); throw e; }
  }
  session(account: string, ticketId: string): ParkingMeter | undefined { return this.store.get<ParkingMeter>(account, 'parking', ticketId) ?? undefined; }
  tariffMinor(zoneId: string): number { const zone = parkingZones.find(z => z.id === zoneId); return zone ? Math.round(zone.tariffPerHour * 100) : 0; }
  private saved(account: string, id: string): Quote {
    const row = this.store.db.prepare('SELECT body FROM provider_parking_quotes WHERE account_id=? AND id=?').get(account, id);
    if (!row) return deny('PAYABLE_NOT_FOUND', 'Parking extension quote not found in this workspace.', 404);
    return JSON.parse(String(row.body)) as Quote;
  }
  private save(account: string, q: Quote) { this.store.db.prepare('UPDATE provider_parking_quotes SET body=? WHERE account_id=? AND id=?').run(JSON.stringify(q), account, q.payable.id); }

  /** Quote `hours` more on a session that is active, unexpired and exactly as the caller saw it. */
  quote(account: string, input: { ticketId: string; hours: number; expectedExpiresAt: number; intentId: string }): Payable {
    return this.atomic(() => {
      const previous = this.store.db.prepare('SELECT body FROM provider_parking_quotes WHERE account_id=? AND intent_id=?').get(account, input.intentId);
      if (previous) {
        const q = JSON.parse(String(previous.body)) as Quote, p = q.payable.parking!;
        if (p.ticketId !== input.ticketId || p.hours !== input.hours || p.expiresAtBefore !== input.expectedExpiresAt) return deny('EXTENSION_INTENT_CONFLICT', 'This intent already has different terms.');
        return q.payable;
      }
      if (!Number.isInteger(input.hours) || input.hours < 1 || input.hours > 24) return deny('EXTENSION_INVALID', 'Extend by 1 to 24 whole hours.', 400);
      const meter = this.session(account, input.ticketId);
      if (!meter) return deny('SESSION_NOT_FOUND', 'Parking session not found in this workspace.', 404);
      if (meter.status !== 'ACTIVE') return deny('SESSION_ENDED', 'This parking session has ended and cannot be extended.');
      if (meter.expiresAt <= this.clock()) return deny('SESSION_EXPIRED', 'This parking session already expired; a new session is a new purchase.');
      if (meter.expiresAt !== input.expectedExpiresAt) return deny('SESSION_CHANGED', 'The session changed since it was read.');
      if (meter.durationHours + input.hours > 720) return deny('DURATION_LIMIT', 'Maximum duration is 720 hours.');
      const amountMinor = this.tariffMinor(meter.zoneId) * input.hours;
      if (!Number.isSafeInteger(amountMinor) || amountMinor < 1 || amountMinor > MAX_PAYMENT_MINOR) return deny('EXTENSION_INVALID', 'The zone has no usable tariff.');
      // One unexpired, unapplied quote per session state: a second intent for the same expiry waits for the first.
      for (const row of this.store.db.prepare('SELECT body FROM provider_parking_quotes WHERE account_id=?').all(account)) {
        const q = JSON.parse(String(row.body)) as Quote;
        if (!q.receipt && q.payable.parking!.ticketId === input.ticketId && q.payable.parking!.expiresAtBefore === meter.expiresAt && Date.parse(q.expiresAt) > this.clock())
          return deny('EXTENSION_IN_PROGRESS', 'An earlier extension quote for this session is still open.');
      }
      const id = `rta:parking:${randomUUID()}`, expiresAt = new Date(this.clock() + 300000).toISOString();
      const payable: Payable = { id, obligationId: id, provider: 'rta', reference: meter.ticketId, kind: 'PARKING_EXTENSION', version: 1,
        parking: { ticketId: meter.ticketId, zoneId: meter.zoneId, plateNumber: meter.plateNumber, hours: input.hours, expiresAtBefore: meter.expiresAt, durationBefore: meter.durationHours },
        label: `Parking extension · ${meter.plateNumber} · ${input.hours} h`, amountMinor, originalAmountMinor: amountMinor, discountMinor: 0, discountEligible: false, currency: 'AED', status: 'UNPAID',
        dueState: 'CURRENT', expiresAt, revision: hash([account, id, meter.ticketId, input.hours, meter.expiresAt, amountMinor, expiresAt]) };
      this.store.db.prepare('INSERT INTO provider_parking_quotes VALUES(?,?,?,?)').run(id, account, input.intentId, JSON.stringify({ payable, intentId: input.intentId, expiresAt }));
      return payable;
    });
  }
  get(account: string, id: string): Payable {
    const q = this.saved(account, id), p = q.payable, parking = p.parking!;
    if (q.receipt) return { ...p, status: 'PAID', dueState: 'CLOSED', revision: hash([p.revision, 'PAID']) };
    const meter = this.session(account, parking.ticketId);
    const changed = !meter || meter.status !== 'ACTIVE' || meter.expiresAt !== parking.expiresAtBefore || meter.expiresAt <= this.clock();
    const status = this.clock() >= Date.parse(q.expiresAt) ? 'EXPIRED' : changed ? 'CANCELLED' : 'UNPAID';
    return status === 'UNPAID' ? p : { ...p, status, dueState: status === 'EXPIRED' ? 'EXPIRED' : 'CLOSED', revision: hash([p.revision, status]) };
  }
  inspect(account: string, id: string, revision: string) {
    const p = this.get(account, id);
    if (p.revision !== revision || p.status !== 'UNPAID') return deny('PAYABLE_CHANGED', 'The parking session or quote changed. Review a new current quote.');
    return p;
  }
  /** Runs only for an admitted, captured order: the one place a session grows. */
  applyAdmitted(account: string, p: Payable, paymentId: string, _at: number) {
    return this.atomic(() => {
      const q = this.saved(account, p.id), parking = q.payable.parking!, meter = this.session(account, parking.ticketId);
      if (q.receipt || q.payable.revision !== p.revision) return deny('EXTENSION_CHANGED', 'This extension was already applied or its terms changed.');
      if (!meter || meter.status !== 'ACTIVE' || meter.expiresAt !== parking.expiresAtBefore || meter.durationHours !== parking.durationBefore || meter.expiresAt <= this.clock())
        return deny('EXTENSION_SESSION_CHANGED', 'The session ended, expired or changed after the quote; nothing was extended.');
      this.store.put(account, 'parking', { ...meter, durationHours: meter.durationHours + parking.hours, totalFee: Math.round(meter.totalFee * 100 + p.amountMinor) / 100, expiresAt: meter.expiresAt + parking.hours * 3600000 }, meter.ticketId);
      q.receipt = { receiptNumber: paymentId, obligationId: p.id, amountMinor: p.amountMinor, currency: 'AED', targetReference: parking.ticketId };
      this.save(account, q);
      return { payable: this.get(account, p.id), receipt: q.receipt };
    });
  }
}
