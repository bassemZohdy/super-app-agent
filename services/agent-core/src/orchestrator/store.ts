import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import type { Database } from 'better-sqlite3';
import { z } from 'zod/v4';
import { AgentError, Fine, Quote, Receipt, RenewalQuote, RenewalReceipt, Vehicle, authorize, digest, quoteFor, type Principal } from './contracts.ts';

type Thread = { subject: string; workload: string; expires_at: number; cancelled: number };
type Consent = { quote: string; expires_at: number };
type Operation = { subject: string; quote: string; status: 'pending' | 'unknown' | 'complete'; receipt: string | null };
const MAX_ACTIVE_THREADS_PER_SUBJECT = 64;
const MAX_ACTIVE_THREADS = 1024;
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
      CREATE INDEX IF NOT EXISTS sa_threads_subject_activity ON sa_threads(subject,cancelled,expires_at);
      CREATE INDEX IF NOT EXISTS sa_threads_activity ON sa_threads(cancelled,expires_at);
      CREATE TABLE IF NOT EXISTS sa_requests (
        thread_id TEXT REFERENCES sa_threads(id), request_id TEXT NOT NULL,
        fingerprint TEXT NOT NULL, response TEXT, PRIMARY KEY(thread_id,request_id));
      CREATE TABLE IF NOT EXISTS sa_consents (
        id TEXT PRIMARY KEY, subject TEXT NOT NULL, workload TEXT NOT NULL,
        operation_key TEXT NOT NULL, quote TEXT NOT NULL, expires_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS sa_operations (
        key TEXT PRIMARY KEY, subject TEXT NOT NULL, quote TEXT NOT NULL,
        status TEXT NOT NULL CHECK(status IN ('pending','unknown','complete')), receipt TEXT);
      CREATE TABLE IF NOT EXISTS sa_operation_owners (
        operation_key TEXT PRIMARY KEY REFERENCES sa_operations(key) ON DELETE CASCADE, consent_id TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS sa_thread_operations (
        thread_id TEXT NOT NULL REFERENCES sa_threads(id), operation_key TEXT NOT NULL, consent_id TEXT NOT NULL,
        PRIMARY KEY(thread_id,operation_key,consent_id));
      CREATE INDEX IF NOT EXISTS sa_operations_subject_status ON sa_operations(subject,status);
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
      -- Upgrade legacy unresolved rows only when one consent can be identified without guessing.
      INSERT OR IGNORE INTO sa_operation_owners(operation_key, consent_id)
        SELECT o.key, MIN(c.id) FROM sa_operations o JOIN sa_consents c ON c.operation_key=o.key AND c.subject=o.subject
        WHERE o.status IN ('pending','unknown') GROUP BY o.key HAVING COUNT(*)=1;
      -- Recover legacy links only from a saved approval response belonging to the same subject.
      INSERT OR IGNORE INTO sa_thread_operations(thread_id,operation_key,consent_id)
        SELECT r.thread_id, o.key, own.consent_id FROM sa_requests r
        JOIN sa_threads t ON t.id=r.thread_id
        JOIN sa_operations o ON o.subject=t.subject AND o.status IN ('pending','unknown')
        JOIN sa_operation_owners own ON own.operation_key=o.key
        WHERE (json_extract(CASE WHEN json_valid(r.response) THEN r.response ELSE '{}' END,'$.approval.id')=own.consent_id
          AND json_extract(CASE WHEN json_valid(r.response) THEN r.response ELSE '{}' END,'$.approval.key')=o.key)
        OR (json_extract(CASE WHEN json_valid(r.response) THEN r.response ELSE '{}' END,'$.renewalApproval.id')=own.consent_id
          AND json_extract(CASE WHEN json_valid(r.response) THEN r.response ELSE '{}' END,'$.renewalApproval.key')=o.key);
    `);
  }
  ready() { this.db.prepare('SELECT 1').get(); }
  createThread(principal: Principal) {
    return this.db.transaction(() => {
      const now = Date.now();
      // An expired conversation linked to an unresolved operation still occupies a slot: it must remain inspectable.
      const active = `t.cancelled=0 AND (t.expires_at>? OR EXISTS (SELECT 1 FROM sa_thread_operations link
        JOIN sa_operations op ON op.key=link.operation_key AND op.subject=t.subject AND op.status IN ('pending','unknown')
        JOIN sa_operation_owners owner ON owner.operation_key=op.key AND owner.consent_id=link.consent_id
        WHERE link.thread_id=t.id))`;
      const subjectCount = this.db.prepare(`SELECT count(*) AS n FROM sa_threads t WHERE t.subject=? AND ${active}`).get(principal.subject, now) as { n: number };
      const totalCount = this.db.prepare(`SELECT count(*) AS n FROM sa_threads t WHERE ${active}`).get(now) as { n: number };
      if (subjectCount.n >= MAX_ACTIVE_THREADS_PER_SUBJECT || totalCount.n >= MAX_ACTIVE_THREADS) throw new AgentError('THREAD_LIMIT_REACHED', 429);
      const id = randomUUID();
      this.db.prepare('INSERT INTO sa_threads(id,subject,workload,expires_at) VALUES(?,?,?,?)').run(id, principal.subject, principal.workload, now + 86400000);
      return id;
    }).immediate();
  }
  checkThread(id: string, principal: Principal, allowCancelled = false) {
    const row = this.db.prepare('SELECT * FROM sa_threads WHERE id=? AND subject=? AND workload=?').get(id, principal.subject, principal.workload) as Thread | undefined;
    if (!row) throw new AgentError('THREAD_NOT_FOUND', 404);
    if (row.expires_at <= Date.now()) {
      const unresolved = !row.cancelled && this.db.prepare(`SELECT 1 FROM sa_thread_operations link
        JOIN sa_operations op ON op.key=link.operation_key AND op.subject=? AND op.status IN ('pending','unknown')
        JOIN sa_operation_owners owner ON owner.operation_key=op.key AND owner.consent_id=link.consent_id
        WHERE link.thread_id=? LIMIT 1`).get(principal.subject, id);
      if (!unresolved) throw new AgentError('THREAD_EXPIRED', 410);
      row.expires_at = Date.now() + 86400000;
      this.db.prepare('UPDATE sa_threads SET expires_at=? WHERE id=?').run(row.expires_at, id);
    }
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
  linkThreadOperation(threadId: string, operationKey: string, consentId: string) {
    this.db.prepare('INSERT OR IGNORE INTO sa_thread_operations VALUES(?,?,?)').run(threadId, operationKey, consentId);
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
  /** A prior operation may already have taken effect even when recovery cannot reauthorize it. */
  hasOperation(key: string, subject: string): boolean {
    return !!this.db.prepare('SELECT 1 FROM sa_operations WHERE key=? AND subject=?').get(key, subject);
  }
  hasUnresolvedOperation(subject: string): boolean {
    return !!this.db.prepare("SELECT 1 FROM sa_operations WHERE subject=? AND status IN ('pending','unknown') LIMIT 1").get(subject);
  }
  /** Atomically reserve one operation per subject, binding retries to its original consent. */
  private reserveOperation<T>(key: string, subject: string, quote: T, consentId: string, schema: z.ZodType<T>): string | null {
    return this.db.transaction(() => {
      const row = this.db.prepare('SELECT * FROM sa_operations WHERE key=?').get(key) as Operation | undefined;
      if (row) {
        if (row.subject !== subject || digest(schema.parse(JSON.parse(row.quote))) !== digest(quote)) throw new AgentError('IDEMPOTENCY_CONFLICT', 409);
        if (row.status === 'complete') return row.receipt;
        let owner = this.db.prepare('SELECT consent_id FROM sa_operation_owners WHERE operation_key=?').get(key) as { consent_id: string } | undefined;
        if (!owner) {
          // Older databases have no owner record. Recover only when the original consent is unambiguous.
          const candidates = this.db.prepare('SELECT id FROM sa_consents WHERE operation_key=? AND subject=? LIMIT 2').all(key, subject) as Array<{ id: string }>;
          if (candidates.length !== 1) throw new AgentError('OPERATION_OWNER_AMBIGUOUS', 409);
          if (candidates[0].id !== consentId) throw new AgentError('OTHER_OPERATION_PENDING', 409);
          this.db.prepare('INSERT INTO sa_operation_owners VALUES(?,?)').run(key, consentId);
          owner = { consent_id: consentId };
        }
        if (owner.consent_id !== consentId) throw new AgentError('OTHER_OPERATION_PENDING', 409);
        return null;
      }
      if (this.hasUnresolvedOperation(subject)) throw new AgentError('OTHER_OPERATION_PENDING', 409);
      this.db.prepare("INSERT INTO sa_operations VALUES(?,?,?,'pending',NULL)").run(key, subject, JSON.stringify(quote));
      this.db.prepare('INSERT INTO sa_operation_owners VALUES(?,?)').run(key, consentId);
      return null;
    }).immediate();
  }
  operation(key: string, subject: string, quote: Quote, consentId: string): Receipt | undefined {
    const receipt = this.reserveOperation(key, subject, quote, consentId, Quote);
    return receipt ? Receipt.parse(JSON.parse(receipt)) : undefined;
  }
  renewalOperation(key: string, subject: string, quote: RenewalQuote, consentId: string): RenewalReceipt | undefined {
    const receipt = this.reserveOperation(key, subject, quote, consentId, RenewalQuote);
    return receipt ? RenewalReceipt.parse(JSON.parse(receipt)) : undefined;
  }
  /** Only an initial, explicit refusal can release a reservation with no effect. */
  releaseRefusedOperation(key: string, subject: string, consentId: string) {
    this.db.prepare("DELETE FROM sa_operations WHERE key=? AND subject=? AND status='pending' AND EXISTS (SELECT 1 FROM sa_operation_owners WHERE operation_key=? AND consent_id=?)").run(key, subject, key, consentId);
  }
  finish(key: string, receipt?: Receipt | RenewalReceipt) {
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
