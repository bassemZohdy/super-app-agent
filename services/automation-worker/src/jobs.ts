/** Persistent automation jobs (AUTO-05).
 *
 *  One job per rule version, occurrence and target. A job is claimed under a lease with a fencing
 *  number; every transition must present that number while the lease is live, so a stale worker
 *  can neither finish nor overwrite a newer holder's job. State and attempts are written before the
 *  step they describe is dispatched, and nothing here stores a credential: a token that is lost
 *  with its process leaves the job held for reconciliation, never retried with a fresh identity. */
import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export type JobState = 'QUEUED' | 'PREPARING' | 'PREPARED' | 'CREDENTIALING' | 'EXECUTING' | 'SETTLED' | 'SKIPPED' | 'FAILED' | 'HELD';
/** States a worker still has to move; the rest are final for the worker. HELD waits for reconciliation outside it. */
export const ACTIVE_STATES: readonly JobState[] = ['QUEUED', 'PREPARING', 'PREPARED', 'CREDENTIALING', 'EXECUTING'];
export type Job = {
  id: string; mandateId: string; policyVersion: number; occurrenceKey: string; target: string;
  state: JobState; runId?: string; executionId?: string; orderId?: string; reason?: string;
  leaseOwner?: string; leaseExpiresAt: number; fence: number; attempts: number; createdAt: number; updatedAt: number;
};
export type Claim = { job: Job; fence: number; workerId: string };

export class StaleWorkerError extends Error { readonly code = 'STALE_WORKER'; constructor() { super('This worker no longer holds the job lease.'); } }
export class JobError extends Error { readonly code: string; constructor(code: string, message: string) { super(message); this.code = code; } }

const token = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,100}$/;
const row = (r: Record<string, unknown>): Job => ({
  id: String(r.id), mandateId: String(r.mandate_id), policyVersion: Number(r.policy_version), occurrenceKey: String(r.occurrence_key), target: String(r.target),
  state: String(r.state) as JobState, runId: r.run_id == null ? undefined : String(r.run_id), executionId: r.execution_id == null ? undefined : String(r.execution_id),
  orderId: r.order_id == null ? undefined : String(r.order_id), reason: r.reason == null ? undefined : String(r.reason),
  leaseOwner: r.lease_owner == null ? undefined : String(r.lease_owner), leaseExpiresAt: Number(r.lease_expires_at), fence: Number(r.fence),
  attempts: Number(r.attempts), createdAt: Number(r.created_at), updatedAt: Number(r.updated_at),
});

/** The stable identity of one occurrence of one rule version against one target. */
export function jobIdentity(input: { mandateId: string; policyVersion: number; occurrenceKey: string; target: string }) {
  const hash = createHash('sha256').update(JSON.stringify(['automation-job', input.mandateId, input.policyVersion, input.occurrenceKey, input.target])).digest('hex').slice(0, 32);
  return { id: `job_${hash}`, requestKey: `req_${hash}` };
}

export class JobStore {
  readonly db: DatabaseSync;
  constructor(path: string) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec(`PRAGMA journal_mode=WAL;PRAGMA busy_timeout=5000;PRAGMA foreign_keys=ON;
      CREATE TABLE IF NOT EXISTS jobs(id TEXT PRIMARY KEY,mandate_id TEXT NOT NULL,policy_version INTEGER NOT NULL,occurrence_key TEXT NOT NULL,target TEXT NOT NULL,
        state TEXT NOT NULL CHECK(state IN ('QUEUED','PREPARING','PREPARED','CREDENTIALING','EXECUTING','SETTLED','SKIPPED','FAILED','HELD')),
        run_id TEXT,execution_id TEXT,order_id TEXT,reason TEXT,lease_owner TEXT,lease_expires_at INTEGER NOT NULL DEFAULT 0,fence INTEGER NOT NULL DEFAULT 0,
        attempts INTEGER NOT NULL DEFAULT 0,created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL,UNIQUE(mandate_id,policy_version,occurrence_key,target));
      CREATE TABLE IF NOT EXISTS job_attempts(seq INTEGER PRIMARY KEY AUTOINCREMENT,job_id TEXT NOT NULL REFERENCES jobs(id),fence INTEGER NOT NULL,worker_id TEXT NOT NULL,step TEXT NOT NULL,at INTEGER NOT NULL,outcome TEXT);
      CREATE TABLE IF NOT EXISTS job_outbox(seq INTEGER PRIMARY KEY AUTOINCREMENT,job_id TEXT NOT NULL REFERENCES jobs(id),kind TEXT NOT NULL,body TEXT NOT NULL,at INTEGER NOT NULL,delivered_at INTEGER,UNIQUE(job_id,kind));
      CREATE TABLE IF NOT EXISTS job_notices(mandate_id TEXT NOT NULL,occurrence_key TEXT NOT NULL,kind TEXT NOT NULL,body TEXT NOT NULL,at INTEGER NOT NULL,PRIMARY KEY(mandate_id,occurrence_key,kind));
      CREATE TABLE IF NOT EXISTS threshold_state(mandate_id TEXT NOT NULL,policy_version INTEGER NOT NULL,armed INTEGER NOT NULL DEFAULT 1 CHECK(armed IN (0,1)),seq INTEGER NOT NULL DEFAULT 0,debit_mark INTEGER,PRIMARY KEY(mandate_id,policy_version));
      CREATE TRIGGER IF NOT EXISTS job_attempts_no_update BEFORE UPDATE OF job_id,fence,worker_id,step,at ON job_attempts BEGIN SELECT RAISE(ABORT,'Attempts are append-only');END;
      CREATE TRIGGER IF NOT EXISTS job_attempts_no_delete BEFORE DELETE ON job_attempts BEGIN SELECT RAISE(ABORT,'Attempts are append-only');END;`);
    this.migrate();
  }
  close() { this.db.close(); }
  private migrate() { try { this.db.exec('ALTER TABLE threshold_state ADD COLUMN debit_mark INTEGER'); } catch { /* already present */ } }
  private atomic<T>(fn: () => T): T { this.db.exec('BEGIN IMMEDIATE'); try { const out = fn(); this.db.exec('COMMIT'); return out; } catch (e) { this.db.exec('ROLLBACK'); throw e; } }

  get(id: string): Job | undefined { const r = this.db.prepare('SELECT * FROM jobs WHERE id=?').get(id); return r ? row(r) : undefined; }
  list(): Job[] { return this.db.prepare('SELECT * FROM jobs ORDER BY created_at,id').all().map(row); }
  outbox(jobId?: string) {
    const rows = jobId ? this.db.prepare('SELECT * FROM job_outbox WHERE job_id=? ORDER BY seq').all(jobId) : this.db.prepare('SELECT * FROM job_outbox ORDER BY seq').all();
    return rows.map(r => ({ seq: Number(r.seq), jobId: String(r.job_id), kind: String(r.kind), body: JSON.parse(String(r.body)) as Record<string, unknown>, at: Number(r.at), deliveredAt: r.delivered_at == null ? undefined : Number(r.delivered_at) }));
  }
  attempts(jobId: string) { return this.db.prepare('SELECT fence,worker_id,step,outcome FROM job_attempts WHERE job_id=? ORDER BY seq').all(jobId).map(r => ({ fence: Number(r.fence), workerId: String(r.worker_id), step: String(r.step), outcome: r.outcome == null ? undefined : String(r.outcome) })); }

  /** Idempotent: the same rule version, occurrence and target is the same job, whoever asks and however often. */
  enqueue(input: { mandateId: string; policyVersion: number; occurrenceKey: string; target: string }, now = Date.now()): Job {
    if (![input.mandateId, input.occurrenceKey, input.target].every(v => typeof v === 'string' && token.test(v)) || !Number.isSafeInteger(input.policyVersion) || input.policyVersion < 1)
      throw new JobError('JOB_INPUT_INVALID', 'Use bounded identifiers and a positive policy version.');
    const { id } = jobIdentity(input);
    return this.atomic(() => {
      this.db.prepare("INSERT OR IGNORE INTO jobs(id,mandate_id,policy_version,occurrence_key,target,state,created_at,updated_at) VALUES(?,?,?,?,?,'QUEUED',?,?)").run(id, input.mandateId, input.policyVersion, input.occurrenceKey, input.target, now, now);
      return this.get(id)!;
    });
  }

  /** Occurrence keys already turned into a job for this rule under any of its versions, so a revision never repeats an occurrence. */
  handledKeys(mandateId: string): Set<string> {
    return new Set(this.db.prepare('SELECT occurrence_key FROM jobs WHERE mandate_id=?').all(mandateId).map(r => String(r.occurrence_key)));
  }
  /** A missed occurrence that is deliberately not run: recorded as a final SKIPPED job so it is visible and never caught up later. */
  enqueueSkipped(input: { mandateId: string; policyVersion: number; occurrenceKey: string; target: string }, reason: string, now = Date.now()): Job {
    const job = this.enqueue(input, now);
    return this.atomic(() => {
      this.db.prepare("UPDATE jobs SET state='SKIPPED',reason=?,updated_at=? WHERE id=? AND state='QUEUED' AND fence=0").run(reason.slice(0, 80), now, job.id);
      const current = this.get(job.id)!;
      // Only a job that is actually recorded as skipped gets the event; an occurrence that already ran is left alone.
      if (current.state === 'SKIPPED') this.db.prepare('INSERT OR IGNORE INTO job_outbox(job_id,kind,body,at) VALUES(?,?,?,?)').run(job.id, 'SKIPPED', JSON.stringify({ reason }), now);
      return current;
    });
  }
  /** A notice about an occurrence before it exists as a job (for example the pre-run reminder); at most one per rule, occurrence and kind. */
  recordNotice(mandateId: string, occurrenceKey: string, kind: string, body: Record<string, unknown>, now = Date.now()): boolean {
    return this.db.prepare('INSERT OR IGNORE INTO job_notices(mandate_id,occurrence_key,kind,body,at) VALUES(?,?,?,?,?)').run(mandateId, occurrenceKey, kind, JSON.stringify(body), now).changes > 0;
  }
  notices(mandateId?: string) {
    const rows = mandateId ? this.db.prepare('SELECT * FROM job_notices WHERE mandate_id=? ORDER BY at,occurrence_key').all(mandateId) : this.db.prepare('SELECT * FROM job_notices ORDER BY at,mandate_id,occurrence_key').all();
    return rows.map(r => ({ mandateId: String(r.mandate_id), occurrenceKey: String(r.occurrence_key), kind: String(r.kind), body: JSON.parse(String(r.body)) as Record<string, unknown>, at: Number(r.at) }));
  }
  thresholdState(mandateId: string, policyVersion: number) {
    const r = this.db.prepare('SELECT armed,seq FROM threshold_state WHERE mandate_id=? AND policy_version=?').get(mandateId, policyVersion);
    return { armed: r ? Number(r.armed) === 1 : true, seq: r ? Number(r.seq) : 0 };
  }
  /** Fire once: disarm, advance the sequence and enqueue the job in one transaction, or do nothing when already disarmed.
   *  With `debits` (the count of qualifying external debits so far) it also refuses to fire again until that count has grown past the one recorded at the last fire. */
  fireThreshold(rule: { mandateId: string; policyVersion: number; target: string }, now = Date.now(), debits?: number): Job | undefined {
    return this.atomic(() => {
      this.db.prepare('INSERT OR IGNORE INTO threshold_state(mandate_id,policy_version) VALUES(?,?)').run(rule.mandateId, rule.policyVersion);
      const moved = this.db.prepare('UPDATE threshold_state SET armed=0,seq=seq+1,debit_mark=COALESCE(?,debit_mark) WHERE mandate_id=? AND policy_version=? AND armed=1 AND (? IS NULL OR debit_mark IS NULL OR ? > debit_mark)').run(debits ?? null, rule.mandateId, rule.policyVersion, debits ?? null, debits ?? null);
      if (!moved.changes) return undefined;
      const seq = this.thresholdState(rule.mandateId, rule.policyVersion).seq;
      const { id } = jobIdentity({ ...rule, occurrenceKey: `THR:${seq}` });
      this.db.prepare("INSERT OR IGNORE INTO jobs(id,mandate_id,policy_version,occurrence_key,target,state,created_at,updated_at) VALUES(?,?,?,?,?,'QUEUED',?,?)").run(id, rule.mandateId, rule.policyVersion, `THR:${seq}`, rule.target, now, now);
      return this.get(id)!;
    });
  }
  /** The balance recovered above the threshold, so the next dip may fire again. */
  rearmThreshold(mandateId: string, policyVersion: number) {
    this.atomic(() => {
      this.db.prepare('INSERT OR IGNORE INTO threshold_state(mandate_id,policy_version) VALUES(?,?)').run(mandateId, policyVersion);
      this.db.prepare('UPDATE threshold_state SET armed=1 WHERE mandate_id=? AND policy_version=?').run(mandateId, policyVersion);
    });
  }

  /** Claim the oldest runnable job: queued, or active with an expired lease. The fence rises on every claim. */
  claim(workerId: string, ttlMs: number, now = Date.now()): Claim | undefined {
    if (!token.test(workerId) || !Number.isSafeInteger(ttlMs) || ttlMs < 1000) throw new JobError('CLAIM_INVALID', 'Use a named worker and a lease of at least one second.');
    return this.atomic(() => {
      const found = this.db.prepare(`SELECT * FROM jobs WHERE state IN ('QUEUED','PREPARING','PREPARED','CREDENTIALING','EXECUTING') AND lease_expires_at<=? ORDER BY created_at,id LIMIT 1`).get(now);
      if (!found) return undefined;
      const fence = Number(found.fence) + 1;
      this.db.prepare('UPDATE jobs SET lease_owner=?,lease_expires_at=?,fence=?,attempts=attempts+1,updated_at=? WHERE id=?').run(workerId, now + ttlMs, fence, now, String(found.id));
      return { job: this.get(String(found.id))!, fence, workerId };
    });
  }

  private fenced(claim: Claim, now: number) {
    const r = this.db.prepare('SELECT lease_owner,lease_expires_at,fence,state FROM jobs WHERE id=?').get(claim.job.id);
    if (!r || r.lease_owner !== claim.workerId || Number(r.fence) !== claim.fence || Number(r.lease_expires_at) <= now) throw new StaleWorkerError();
    return String(r.state) as JobState;
  }
  /** Extend a live lease; a stale holder cannot. */
  renew(claim: Claim, ttlMs: number, now = Date.now()) {
    this.atomic(() => { this.fenced(claim, now); this.db.prepare('UPDATE jobs SET lease_expires_at=?,updated_at=? WHERE id=?').run(now + ttlMs, now, claim.job.id); });
  }
  /** Give the lease back after a transient failure so another claim may retry after `retryAfterMs`. */
  yield(claim: Claim, retryAfterMs: number, now = Date.now()) {
    this.atomic(() => { this.fenced(claim, now); this.db.prepare('UPDATE jobs SET lease_expires_at=?,updated_at=? WHERE id=?').run(now + retryAfterMs, now, claim.job.id); });
  }
  /** Record the step about to be dispatched, before dispatching it. */
  begin(claim: Claim, step: string, now = Date.now()) {
    this.atomic(() => { this.fenced(claim, now); this.db.prepare('INSERT INTO job_attempts(job_id,fence,worker_id,step,at) VALUES(?,?,?,?,?)').run(claim.job.id, claim.fence, claim.workerId, step, now); });
  }
  /** Move the job to a new state under the fence, optionally attaching facts and one outbox event. */
  transition(claim: Claim, state: JobState, patch: { runId?: string; executionId?: string; orderId?: string; reason?: string } = {}, event?: { kind: string; body?: Record<string, unknown> }, now = Date.now()): Job {
    return this.atomic(() => {
      const current = this.fenced(claim, now);
      if (!ACTIVE_STATES.includes(current)) throw new JobError('JOB_FINAL', 'This job already reached a final state.');
      const final = !ACTIVE_STATES.includes(state);
      this.db.prepare('UPDATE jobs SET state=?,run_id=COALESCE(?,run_id),execution_id=COALESCE(?,execution_id),order_id=COALESCE(?,order_id),reason=?,lease_expires_at=CASE WHEN ? THEN 0 ELSE lease_expires_at END,updated_at=? WHERE id=?')
        .run(state, patch.runId ?? null, patch.executionId ?? null, patch.orderId ?? null, patch.reason ?? null, final ? 1 : 0, now, claim.job.id);
      if (event) this.db.prepare('INSERT OR IGNORE INTO job_outbox(job_id,kind,body,at) VALUES(?,?,?,?)').run(claim.job.id, event.kind, JSON.stringify(event.body ?? {}), now);
      return this.get(claim.job.id)!;
    });
  }
  /** Record how the last attempt ended (never a credential). */
  outcome(claim: Claim, outcome: string) {
    this.db.prepare('UPDATE job_attempts SET outcome=? WHERE seq=(SELECT max(seq) FROM job_attempts WHERE job_id=? AND fence=?)').run(outcome.slice(0, 80), claim.job.id, claim.fence);
  }
}
