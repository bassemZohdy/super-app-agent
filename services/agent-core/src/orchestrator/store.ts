import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import type { Database } from 'better-sqlite3';
import { z } from 'zod/v4';
import { AgentError, Fine, Quote, Receipt, RenewalQuote, RenewalReceipt, Vehicle, authorize, digest, quoteFor, type Principal } from './contracts.ts';

type Thread = { subject: string; workload: string; expires_at: number; cancelled: number };
type Consent = { quote: string; expires_at: number };
type Operation = { subject: string; quote: string; receipt: string | null };
export class Store {
  private readonly active = new Set<string>();
  readonly db: Database;
  constructor(db: Database) { this.db = db; }
  setup() {
    this.db.pragma('journal_mode=WAL');
    this.db.pragma('synchronous=FULL');
    this.db.pragma('foreign_keys=ON');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS sa_threads (
        id TEXT PRIMARY KEY, subject TEXT NOT NULL, workload TEXT NOT NULL,
        expires_at INTEGER NOT NULL, cancelled INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE IF NOT EXISTS sa_requests (
        thread_id TEXT REFERENCES sa_threads(id), request_id TEXT NOT NULL,
        fingerprint TEXT NOT NULL, response TEXT, PRIMARY KEY(thread_id,request_id));
      CREATE TABLE IF NOT EXISTS sa_consents (
        id TEXT PRIMARY KEY, subject TEXT NOT NULL, workload TEXT NOT NULL,
        operation_key TEXT NOT NULL, quote TEXT NOT NULL, expires_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS sa_operations (
        key TEXT PRIMARY KEY, subject TEXT NOT NULL, quote TEXT NOT NULL,
        status TEXT NOT NULL CHECK(status IN ('pending','unknown','complete')), receipt TEXT);
      CREATE TABLE IF NOT EXISTS sa_sim_accounts (subject TEXT PRIMARY KEY);
      CREATE TABLE IF NOT EXISTS sa_sim_fines (
        subject TEXT NOT NULL, id TEXT NOT NULL, fine TEXT NOT NULL,
        receipt_id TEXT, PRIMARY KEY(subject,id));
      CREATE TABLE IF NOT EXISTS sa_sim_payments (
        key TEXT PRIMARY KEY, subject TEXT NOT NULL, quote TEXT NOT NULL, receipt TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS sa_sim_vehicle_accounts (subject TEXT PRIMARY KEY);
      CREATE TABLE IF NOT EXISTS sa_sim_vehicles (
        subject TEXT NOT NULL, id TEXT NOT NULL, vehicle TEXT NOT NULL,
        renewal_id TEXT, PRIMARY KEY(subject,id));
      CREATE TABLE IF NOT EXISTS sa_sim_renewals (
        key TEXT PRIMARY KEY, subject TEXT NOT NULL, quote TEXT NOT NULL, receipt TEXT NOT NULL);
    `);
  }
  ready() { this.db.prepare('SELECT 1').get(); }
  createThread(principal: Principal) {
    const id = randomUUID();
    this.db.prepare('INSERT INTO sa_threads(id,subject,workload,expires_at) VALUES(?,?,?,?)').run(id, principal.subject, principal.workload, Date.now() + 86400000);
    return id;
  }
  checkThread(id: string, principal: Principal, allowCancelled = false) {
    const row = this.db.prepare('SELECT * FROM sa_threads WHERE id=? AND subject=? AND workload=?').get(id, principal.subject, principal.workload) as Thread | undefined;
    if (!row) throw new AgentError('THREAD_NOT_FOUND', 404);
    if (row.expires_at <= Date.now()) throw new AgentError('THREAD_EXPIRED', 410);
    if (row.cancelled && !allowCancelled) throw new AgentError('THREAD_CANCELLED', 409);
    return row;
  }
  /** Single-process demo: reject overlapping transitions instead of queuing unbounded work. */
  async exclusive<T>(id: string, fn: () => Promise<T>): Promise<T> {
    if (this.active.has(id) || this.active.size >= 8) throw new AgentError('AGENT_BUSY', 409);
    this.active.add(id);
    try { return await fn(); } finally { this.active.delete(id); }
  }
  request(id: string, requestId: string): { fingerprint: string; response: unknown } | undefined {
    const row = this.db.prepare('SELECT fingerprint,response FROM sa_requests WHERE thread_id=? AND request_id=?').get(id, requestId) as { fingerprint: string; response: string | null } | undefined;
    return row ? { fingerprint: row.fingerprint, response: row.response ? JSON.parse(row.response) : null } : undefined;
  }
  saveRequest(id: string, requestId: string, fingerprint: string, response?: unknown) {
    this.db.prepare('INSERT INTO sa_requests VALUES(?,?,?,?) ON CONFLICT(thread_id,request_id) DO UPDATE SET response=excluded.response').run(id, requestId, fingerprint, response ? JSON.stringify(response) : null);
  }
  cancelThread(id: string) { this.db.prepare('UPDATE sa_threads SET cancelled=1 WHERE id=?').run(id); }
  consent(id: string, principal: Principal, key: string, quote: Quote, expiresAt: number) {
    authorize(principal, 'fines:pay');
    if (expiresAt <= Date.now()) throw new AgentError('APPROVAL_EXPIRED', 410);
    this.db.prepare('INSERT INTO sa_consents VALUES(?,?,?,?,?,?) ON CONFLICT(id) DO NOTHING').run(id, principal.subject, principal.workload, key, JSON.stringify(quote), expiresAt);
  }
  verifyConsent(id: string, principal: Principal, key: string, quote: Quote) {
    authorize(principal, 'fines:pay');
    this.checkConsent(id, principal, key, Quote, quote);
  }
  renewalConsent(id: string, principal: Principal, key: string, quote: RenewalQuote, expiresAt: number) {
    authorize(principal, 'vehicles:renew');
    if (expiresAt <= Date.now()) throw new AgentError('APPROVAL_EXPIRED', 410);
    this.db.prepare('INSERT INTO sa_consents VALUES(?,?,?,?,?,?) ON CONFLICT(id) DO NOTHING').run(id, principal.subject, principal.workload, key, JSON.stringify(quote), expiresAt);
  }
  verifyRenewalConsent(id: string, principal: Principal, key: string, quote: RenewalQuote) {
    authorize(principal, 'vehicles:renew');
    this.checkConsent(id, principal, key, RenewalQuote, quote);
  }
  /** The stored quote must equal the quote being executed, whichever service it is for. */
  private checkConsent<T>(id: string, principal: Principal, key: string, schema: z.ZodType<T>, quote: T) {
    const row = this.db.prepare('SELECT quote,expires_at FROM sa_consents WHERE id=? AND subject=? AND workload=? AND operation_key=?').get(id, principal.subject, principal.workload, key) as Consent | undefined;
    if (!row || row.expires_at <= Date.now() || digest(schema.parse(JSON.parse(row.quote))) !== digest(schema.parse(quote))) throw new AgentError('CONSENT_REQUIRED_OR_EXPIRED', 403);
  }
  operation(key: string, subject: string, quote: Quote): Receipt | undefined {
    this.db.prepare("INSERT INTO sa_operations VALUES(?,?,?,'pending',NULL) ON CONFLICT(key) DO NOTHING").run(key, subject, JSON.stringify(quote));
    const row = this.db.prepare('SELECT * FROM sa_operations WHERE key=?').get(key) as Operation;
    if (row.subject !== subject || digest(Quote.parse(JSON.parse(row.quote))) !== digest(quote)) throw new AgentError('IDEMPOTENCY_CONFLICT', 409);
    return row.receipt ? Receipt.parse(JSON.parse(row.receipt)) : undefined;
  }
  finish(key: string, receipt?: Receipt) {
    if (receipt) this.db.prepare("UPDATE sa_operations SET status='complete',receipt=? WHERE key=?").run(JSON.stringify(receipt), key);
    else this.db.prepare("UPDATE sa_operations SET status='unknown' WHERE key=? AND status!='complete'").run(key);
  }
  fines(subject: string): Fine[] {
    return this.db.transaction(() => {
      const created = this.db.prepare('INSERT INTO sa_sim_accounts VALUES(?) ON CONFLICT DO NOTHING').run(subject);
      if (created.changes) {
        const fixtures = z.array(Fine).parse(JSON.parse(readFileSync(new URL('../../fixtures/fines.json', import.meta.url), 'utf8')));
        for (const fine of fixtures) this.db.prepare('INSERT INTO sa_sim_fines VALUES(?,?,?,NULL)').run(subject, fine.id, JSON.stringify(fine));
      }
      const rows = this.db.prepare('SELECT fine FROM sa_sim_fines WHERE subject=? AND receipt_id IS NULL ORDER BY id').all(subject) as Array<{ fine: string }>;
      return rows.map(row => Fine.parse(JSON.parse(row.fine)));
    })();
  }
  /** Business effects and idempotency receipt commit in ONE SQLite transaction. */
  simulatePayment(principal: Principal, key: string, quote: Quote, consentId: string): Receipt {
    return this.db.transaction(() => {
      this.verifyConsent(consentId, principal, key, quote);
      const existing = this.db.prepare('SELECT * FROM sa_sim_payments WHERE key=?').get(key) as Operation | undefined;
      if (existing) {
        if (existing.subject !== principal.subject || digest(Quote.parse(JSON.parse(existing.quote))) !== digest(quote)) throw new AgentError('IDEMPOTENCY_CONFLICT', 409);
        return Receipt.parse(JSON.parse(existing.receipt!));
      }
      const rows = quote.fineIds.map(id => this.db.prepare('SELECT fine,receipt_id FROM sa_sim_fines WHERE subject=? AND id=?').get(principal.subject, id) as { fine: string; receipt_id: string | null } | undefined);
      if (rows.some(row => !row || row.receipt_id) || digest(quoteFor(rows.map(row => Fine.parse(JSON.parse(row!.fine))))) !== digest(quote)) throw new AgentError('QUOTE_STALE', 409);
      const receipt = Receipt.parse({ id: randomUUID(), simulated: true, quote, idempotencyKey: key });
      for (const id of quote.fineIds) this.db.prepare('UPDATE sa_sim_fines SET receipt_id=? WHERE subject=? AND id=?').run(receipt.id, principal.subject, id);
      this.db.prepare('INSERT INTO sa_sim_payments VALUES(?,?,?,?)').run(key, principal.subject, JSON.stringify(quote), JSON.stringify(receipt));
      return receipt;
    }).immediate();
  }
  vehicles(subject: string): Vehicle[] {
    return this.db.transaction(() => {
      const created = this.db.prepare('INSERT INTO sa_sim_vehicle_accounts VALUES(?) ON CONFLICT DO NOTHING').run(subject);
      if (created.changes) {
        const fixtures = z.array(Vehicle).parse(JSON.parse(readFileSync(new URL('../../fixtures/vehicles.json', import.meta.url), 'utf8')));
        for (const vehicle of fixtures) this.db.prepare('INSERT INTO sa_sim_vehicles VALUES(?,?,?,NULL)').run(subject, vehicle.id, JSON.stringify(vehicle));
      }
      const rows = this.db.prepare('SELECT vehicle FROM sa_sim_vehicles WHERE subject=? AND renewal_id IS NULL ORDER BY id').all(subject) as Array<{ vehicle: string }>;
      return rows.map(row => Vehicle.parse(JSON.parse(row.vehicle)));
    })();
  }
  /** Renewal is a separate effect from fines payment: it commits on its own and only while no fine is outstanding. */
  simulateRenewal(principal: Principal, key: string, quote: RenewalQuote, consentId: string): RenewalReceipt {
    return this.db.transaction(() => {
      this.verifyRenewalConsent(consentId, principal, key, quote);
      const existing = this.db.prepare('SELECT * FROM sa_sim_renewals WHERE key=?').get(key) as Operation | undefined;
      if (existing) {
        if (existing.subject !== principal.subject || digest(RenewalQuote.parse(JSON.parse(existing.quote))) !== digest(quote)) throw new AgentError('IDEMPOTENCY_CONFLICT', 409);
        return RenewalReceipt.parse(JSON.parse(existing.receipt!));
      }
      const row = this.db.prepare('SELECT vehicle,renewal_id FROM sa_sim_vehicles WHERE subject=? AND id=?').get(principal.subject, quote.vehicleId) as { vehicle: string; renewal_id: string | null } | undefined;
      const vehicle = row && Vehicle.parse(JSON.parse(row.vehicle));
      if (!row || row.renewal_id || !vehicle || vehicle.renewalFeeMinor !== quote.amountMinor || vehicle.version !== quote.version) throw new AgentError('QUOTE_STALE', 409);
      if (this.fines(principal.subject).length) throw new AgentError('FINES_OUTSTANDING', 409);
      const receipt = RenewalReceipt.parse({ id: randomUUID(), simulated: true, quote, idempotencyKey: key });
      this.db.prepare('UPDATE sa_sim_vehicles SET renewal_id=? WHERE subject=? AND id=?').run(receipt.id, principal.subject, quote.vehicleId);
      this.db.prepare('INSERT INTO sa_sim_renewals VALUES(?,?,?,?)').run(key, principal.subject, JSON.stringify(quote), JSON.stringify(receipt));
      return receipt;
    }).immediate();
  }
}
