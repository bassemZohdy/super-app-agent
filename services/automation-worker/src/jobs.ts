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
  state: JobState; runId?: string; executionId?: string; orderId?: string; amountMinor?: number; reason?: string;
  leaseOwner?: string; leaseExpiresAt: number; fence: number; attempts: number; createdAt: number; updatedAt: number;
};
export type Claim = { job: Job; fence: number; workerId: string };
/** The reason a held job carries while its order waits for the owner's answer to a card challenge. */
export const CHALLENGE_REASON = 'REQUIRES_ACTION';

export class StaleWorkerError extends Error { readonly code = 'STALE_WORKER'; constructor() { super('This worker no longer holds the job lease.'); } }
export class JobError extends Error { readonly code: string; constructor(code: string, message: string) { super(message); this.code = code; } }

const token = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,100}$/;
const row = (r: Record<string, unknown>): Job => ({
  id: String(r.id), mandateId: String(r.mandate_id), policyVersion: Number(r.policy_version), occurrenceKey: String(r.occurrence_key), target: String(r.target),
  state: String(r.state) as JobState, runId: r.run_id == null ? undefined : String(r.run_id), executionId: r.execution_id == null ? undefined : String(r.execution_id),
  orderId: r.order_id == null ? undefined : String(r.order_id), amountMinor: r.amount_minor == null ? undefined : Number(r.amount_minor), reason: r.reason == null ? undefined : String(r.reason),
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
        run_id TEXT,execution_id TEXT,order_id TEXT,amount_minor INTEGER,reason TEXT,lease_owner TEXT,lease_expires_at INTEGER NOT NULL DEFAULT 0,fence INTEGER NOT NULL DEFAULT 0,
        attempts INTEGER NOT NULL DEFAULT 0,created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL,UNIQUE(mandate_id,policy_version,occurrence_key,target));
      CREATE TABLE IF NOT EXISTS job_attempts(seq INTEGER PRIMARY KEY AUTOINCREMENT,job_id TEXT NOT NULL REFERENCES jobs(id),fence INTEGER NOT NULL,worker_id TEXT NOT NULL,step TEXT NOT NULL,at INTEGER NOT NULL,outcome TEXT);
      CREATE TABLE IF NOT EXISTS job_outbox(seq INTEGER PRIMARY KEY AUTOINCREMENT,job_id TEXT NOT NULL REFERENCES jobs(id),kind TEXT NOT NULL,body TEXT NOT NULL,at INTEGER NOT NULL,delivered_at INTEGER,UNIQUE(job_id,kind));
      CREATE TABLE IF NOT EXISTS job_notices(mandate_id TEXT NOT NULL,occurrence_key TEXT NOT NULL,kind TEXT NOT NULL,body TEXT NOT NULL,at INTEGER NOT NULL,PRIMARY KEY(mandate_id,occurrence_key,kind));
      CREATE TABLE IF NOT EXISTS kill_switch(id TEXT PRIMARY KEY CHECK(id='global'),engaged INTEGER NOT NULL CHECK(engaged IN (0,1)),reason TEXT,at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS job_store_run(id TEXT PRIMARY KEY CHECK(id='global'),run_id TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS threshold_state(mandate_id TEXT NOT NULL,policy_version INTEGER NOT NULL,armed INTEGER NOT NULL DEFAULT 1 CHECK(armed IN (0,1)),seq INTEGER NOT NULL DEFAULT 0,debit_mark INTEGER,PRIMARY KEY(mandate_id,policy_version));
      CREATE TRIGGER IF NOT EXISTS job_attempts_no_update BEFORE UPDATE OF job_id,fence,worker_id,step,at ON job_attempts BEGIN SELECT RAISE(ABORT,'Attempts are append-only');END;
      CREATE TRIGGER IF NOT EXISTS job_attempts_no_delete BEFORE DELETE ON job_attempts BEGIN SELECT RAISE(ABORT,'Attempts are append-only');END;`);
    this.migrate();
  }
  close() { this.db.close(); }
  private migrate() {
    try { this.db.exec('ALTER TABLE threshold_state ADD COLUMN debit_mark INTEGER'); } catch { /* already present */ }
    const hasAmount = () => this.db.prepare('PRAGMA table_info(jobs)').all().some(column => column.name === 'amount_minor');
    if (!hasAmount()) try { this.db.exec('ALTER TABLE jobs ADD COLUMN amount_minor INTEGER'); } catch (error) { if (!hasAmount()) throw error; }
  }
  private atomic<T>(fn: () => T): T { this.db.exec('BEGIN IMMEDIATE'); try { const out = fn(); this.db.exec('COMMIT'); return out; } catch (e) { this.db.exec('ROLLBACK'); throw e; } }

  /** Bind scheduling history and queued jobs to one run before either worker or scheduler starts. */
  bindRun(runId: string) {
    if (!/^autorn_[a-f0-9-]{36}$/.test(runId)) throw new JobError('RUN_INVALID', 'Name the isolated automation run.');
    this.atomic(() => {
      const bound = this.db.prepare("SELECT run_id FROM job_store_run WHERE id='global'").get();
      if (bound) {
        if (bound.run_id !== runId) throw new JobError('RUN_MISMATCH', 'This job store belongs to another run.');
        return;
      }
      const ambiguous = this.db.prepare('SELECT 1 FROM jobs LIMIT 1').get()
        || this.db.prepare('SELECT 1 FROM job_notices LIMIT 1').get()
        || this.db.prepare('SELECT 1 FROM threshold_state LIMIT 1').get();
      if (ambiguous) throw new JobError('RUN_UNKNOWN', 'The existing job store has jobs whose run cannot be safely bound.');
      this.db.prepare("INSERT INTO job_store_run(id,run_id) VALUES('global',?)").run(runId);
    });
  }

  get(id: string): Job | undefined { const r = this.db.prepare('SELECT * FROM jobs WHERE id=?').get(id); return r ? row(r) : undefined; }
  list(): Job[] { return this.db.prepare('SELECT * FROM jobs ORDER BY created_at,id').all().map(row); }
  outbox(jobId?: string) {
    const rows = jobId ? this.db.prepare('SELECT * FROM job_outbox WHERE job_id=? ORDER BY seq').all(jobId) : this.db.prepare('SELECT * FROM job_outbox ORDER BY seq').all();
    return rows.map(r => ({ seq: Number(r.seq), jobId: String(r.job_id), kind: String(r.kind), body: JSON.parse(String(r.body)) as Record<string, unknown>, at: Number(r.at), deliveredAt: r.delivered_at == null ? undefined : Number(r.delivered_at) }));
  }
  attempts(jobId: string) { return this.db.prepare('SELECT fence,worker_id,step,outcome FROM job_attempts WHERE job_id=? ORDER BY seq').all(jobId).map(r => ({ fence: Number(r.fence), workerId: String(r.worker_id), step: String(r.step), outcome: r.outcome == null ? undefined : String(r.outcome) })); }
  /** A lost or interrupted preparation may have reserved the occurrence even if a later request is refused. */
  hasUnconfirmedPreparation(jobId: string): boolean {
    return !!this.db.prepare("SELECT 1 FROM job_attempts WHERE job_id=? AND step='prepare' AND (outcome IS NULL OR outcome='unavailable') LIMIT 1").get(jobId);
  }

  /** The operator's global kill switch (AUTO-15). Persisted, so a restart keeps it engaged until someone releases it. */
  killSwitch(): { engaged: boolean; reason?: string; at?: number } {
    const r = this.db.prepare("SELECT engaged,reason,at FROM kill_switch WHERE id='global'").get();
    return r ? { engaged: Number(r.engaged) === 1, reason: r.reason == null ? undefined : String(r.reason), at: Number(r.at) } : { engaged: false };
  }
  setKillSwitch(engaged: boolean, reason = '', now = Date.now()) {
    this.db.prepare("INSERT INTO kill_switch(id,engaged,reason,at) VALUES('global',?,?,?) ON CONFLICT(id) DO UPDATE SET engaged=excluded.engaged,reason=excluded.reason,at=MAX(excluded.at,kill_switch.at+1)")
      .run(engaged ? 1 : 0, reason.slice(0, 120), now);
  }

  /** Apply a newer authority state without racing a concurrent local override. */
  applyDesiredKillSwitch(engaged: boolean, reason: string, at: number) {
    if (!Number.isSafeInteger(at) || at <= 0) return;
    this.db.prepare("INSERT INTO kill_switch(id,engaged,reason,at) VALUES('global',?,?,?) ON CONFLICT(id) DO UPDATE SET engaged=excluded.engaged,reason=excluded.reason,at=excluded.at WHERE excluded.at>kill_switch.at")
      .run(engaged ? 1 : 0, reason.slice(0, 120), at);
  }

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

  /** Atomically retain at most the newest unclaimed periodic occurrence; never replace dispatched or held work. */
  schedulePeriodic(base: { mandateId: string; policyVersion: number; target: string }, occurrences: string[], now = Date.now()): { enqueued: string[]; skipped: string[] } {
    if (![base.mandateId, base.target, ...occurrences].every(v => typeof v === 'string' && token.test(v)) || !Number.isSafeInteger(base.policyVersion) || base.policyVersion < 1)
      throw new JobError('JOB_INPUT_INVALID', 'Use bounded identifiers and a positive policy version.');
    const keys = [...new Set(occurrences)].sort();
    if (!keys.length) return { enqueued: [], skipped: [] };
    const prefix = keys[0]!.startsWith('CAL:') ? 'CAL:' : 'INV:';
    if (!keys.every(key => key.startsWith(prefix))) throw new JobError('JOB_INPUT_INVALID', 'Use one periodic occurrence type.');
    return this.atomic(() => {
      const jobs = this.db.prepare('SELECT * FROM jobs WHERE mandate_id=?').all(base.mandateId).map(row);
      const blocked = jobs.some(job => ['PREPARING', 'PREPARED', 'CREDENTIALING', 'EXECUTING', 'HELD'].includes(job.state) || (job.state === 'QUEUED' && (job.fence > 0 || !job.occurrenceKey.startsWith(prefix))));
      const unclaimed = jobs.filter(job => job.state === 'QUEUED' && job.fence === 0 && job.occurrenceKey.startsWith(prefix));
      const existing = new Set(jobs.map(job => job.occurrenceKey));
      const available = [...new Set([...keys.filter(key => !existing.has(key)), ...unclaimed.map(job => job.occurrenceKey)])].sort();
      const latest = [...keys, ...jobs.filter(job => job.occurrenceKey.startsWith(prefix)).map(job => job.occurrenceKey)].sort().at(-1);
      const keep = !blocked && latest === available.at(-1) && !jobs.some(job => job.occurrenceKey === latest && !(job.state === 'QUEUED' && job.fence === 0)) ? latest : undefined;
      const keepId = unclaimed.filter(job => job.occurrenceKey === keep).sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id))[0]?.id;
      const reason = blocked ? 'PRIOR_UNRESOLVED' : 'MISSED_CATCH_UP';
      const result = { enqueued: [] as string[], skipped: [] as string[] };
      for (const job of unclaimed) {
        if (job.id === keepId) continue;
        const skipReason = !blocked && job.occurrenceKey === latest && jobs.filter(other => other.occurrenceKey === latest).length > 1 ? 'DUPLICATE_OCCURRENCE' : reason;
        this.db.prepare("UPDATE jobs SET state='SKIPPED',reason=?,updated_at=? WHERE id=? AND state='QUEUED' AND fence=0").run(skipReason, now, job.id);
        this.db.prepare('INSERT OR IGNORE INTO job_outbox(job_id,kind,body,at) VALUES(?,?,?,?)').run(job.id, 'SKIPPED', JSON.stringify({ reason: skipReason }), now);
        result.skipped.push(job.occurrenceKey);
      }
      for (const key of keys) {
        if (existing.has(key)) continue;
        const { id } = jobIdentity({ ...base, occurrenceKey: key }), skipped = key !== keep;
        this.db.prepare('INSERT INTO jobs(id,mandate_id,policy_version,occurrence_key,target,state,reason,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)')
          .run(id, base.mandateId, base.policyVersion, key, base.target, skipped ? 'SKIPPED' : 'QUEUED', skipped ? reason : null, now, now);
        if (skipped) {
          this.db.prepare('INSERT INTO job_outbox(job_id,kind,body,at) VALUES(?,?,?,?)').run(id, 'SKIPPED', JSON.stringify({ reason }), now);
          result.skipped.push(key);
        } else result.enqueued.push(key);
      }
      return result;
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
      // A job parked on an owner's card challenge is polled again after its wait; nothing else held is ever claimed.
      const found = this.db.prepare(`SELECT * FROM jobs WHERE (state IN ('QUEUED','PREPARING','PREPARED','CREDENTIALING','EXECUTING') OR (state='HELD' AND reason=?)) AND lease_expires_at<=? ORDER BY created_at,id LIMIT 1`).get(CHALLENGE_REASON, now);
      if (!found) return undefined;
      const fence = Number(found.fence) + 1;
      this.db.prepare('UPDATE jobs SET lease_owner=?,lease_expires_at=?,fence=?,attempts=attempts+1,updated_at=? WHERE id=?').run(workerId, now + ttlMs, fence, now, String(found.id));
      return { job: this.get(String(found.id))!, fence, workerId };
    });
  }

  private fenced(claim: Claim, now: number) {
    const r = this.db.prepare('SELECT lease_owner,lease_expires_at,fence,state,reason FROM jobs WHERE id=?').get(claim.job.id);
    if (!r || r.lease_owner !== claim.workerId || Number(r.fence) !== claim.fence || Number(r.lease_expires_at) <= now) throw new StaleWorkerError();
    return { state: String(r.state) as JobState, reason: r.reason == null ? undefined : String(r.reason) };
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
  /** Move the job to a new state under the fence, optionally attaching facts and one outbox event.
   *  `parkMs` keeps a job held on a card challenge claimable again after that wait instead of making it final. */
  transition(claim: Claim, state: JobState, patch: { runId?: string; executionId?: string; orderId?: string; amountMinor?: number; reason?: string } = {}, event?: { kind: string; body?: Record<string, unknown> }, now = Date.now(), parkMs = 0): Job {
    return this.atomic(() => {
      const current = this.fenced(claim, now);
      const parkable = current.state === 'HELD' && current.reason === CHALLENGE_REASON;
      if (!ACTIVE_STATES.includes(current.state) && !parkable) throw new JobError('JOB_FINAL', 'This job already reached a final state.');
      const parked = state === 'HELD' && patch.reason === CHALLENGE_REASON && parkMs > 0;
      const final = !ACTIVE_STATES.includes(state) && !parked;
      this.db.prepare('UPDATE jobs SET state=?,run_id=COALESCE(?,run_id),execution_id=COALESCE(?,execution_id),order_id=COALESCE(?,order_id),amount_minor=COALESCE(?,amount_minor),reason=?,lease_expires_at=CASE WHEN ? THEN 0 WHEN ? THEN ? ELSE lease_expires_at END,updated_at=? WHERE id=?')
        .run(state, patch.runId ?? null, patch.executionId ?? null, patch.orderId ?? null, patch.amountMinor ?? null, patch.reason ?? null, final ? 1 : 0, parked ? 1 : 0, now + parkMs, now, claim.job.id);
      if (event) this.db.prepare('INSERT OR IGNORE INTO job_outbox(job_id,kind,body,at) VALUES(?,?,?,?)').run(claim.job.id, event.kind, JSON.stringify(event.body ?? {}), now);
      return this.get(claim.job.id)!;
    });
  }
  /** Record how the last attempt ended (never a credential). */
  outcome(claim: Claim, outcome: string) {
    this.db.prepare('UPDATE job_attempts SET outcome=? WHERE seq=(SELECT max(seq) FROM job_attempts WHERE job_id=? AND fence=?)').run(outcome.slice(0, 80), claim.job.id, claim.fence);
  }
}
