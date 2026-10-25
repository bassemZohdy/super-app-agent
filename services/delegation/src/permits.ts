/** One-time execution permits for automatic payments (AUTO-03 step 2b).
 *
 *  A permit is the broker's record that one prepared execution was re-checked against current
 *  authority at credential time and may receive exactly one short-lived delegated token. The
 *  worker supplies references only; every fact below comes from the provider-owned execution view.
 *  States: ISSUED (no token yet) → BOUND (token fingerprint registered) → CONSUMED (the provider
 *  admitted it once) → COMPLETED | FAILED | UNKNOWN. Only an ISSUED permit that never produced a
 *  token can be CLOSED and replaced; once a token is bound the execution can never get a second
 *  credential, so an uncertain outcome keeps its reservation until original-ID reconciliation. */
import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { automationOperation } from '../../../packages/protocol-core/src/automation-operation.ts';
import { DelegationError, brokerClient, automationWorkerClient, deny, digest } from './policy.ts';

export type ExecutionView = {
  executionId: string; runId: string; accountId: string; ownerSub: string;
  mandate: { id: string; state: string; policyVersion: number; skipNext: boolean };
  source: { id: string; version: number; current: boolean };
  biller?: { id: string; current: boolean };
  payable: { id: string; revision: string; amountMinor: number; current: boolean };
  boundDigest: string; preparedAt: string; admissionExpiresAt: string; expired: boolean;
  /** The owner's answer to a card challenge the order raised; NONE when there was none. */
  challenge?: 'APPROVED' | 'PENDING' | 'REJECTED' | 'NONE';
};
export type PermitState = 'ISSUED' | 'BOUND' | 'CONSUMED' | 'COMPLETED' | 'FAILED' | 'UNKNOWN' | 'CLOSED';
export type Permit = {
  id: string; executionId: string; runId: string; accountId: string; owner: string; workerSub: string;
  boundDigest: string; operationDigest: string; operation?: ReturnType<typeof permitOperation>; state: PermitState; attempt: number;
  issuedAt: number; expiresAt: number; fingerprint?: string; tokenExp?: number;
  /** Set on the permit that replaced a consumed one after the owner approved its card challenge. */
  resumeOf?: string;
};

/** Lifetime of an unbound permit and the matching assertion window; the grant lane uses the same 90 seconds. */
export const PERMIT_TTL_MS = 90_000;
/** A permit with less than this left cannot complete the exchange and is refused up front. */
export const PERMIT_MIN_REMAINING_MS = 10_000;
export const MAX_PERMIT_ATTEMPTS = 3;

const hex64 = /^[a-f0-9]{64}$/;
const id = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,199}$/;
const isoMs = (value: unknown) => typeof value === 'string' ? Date.parse(value) : NaN;

/** The exact operation a provider must present to consume the permit; nothing in it comes from the worker. */
export function permitOperation(view: Pick<ExecutionView, 'executionId' | 'runId' | 'accountId' | 'boundDigest' | 'source' | 'payable'>) {
  return automationOperation({ executionId: view.executionId, runId: view.runId, accountId: view.accountId, boundDigest: view.boundDigest,
    payableId: view.payable.id, payableRevision: view.payable.revision, amountMinor: view.payable.amountMinor, sourceId: view.source.id, sourceVersion: view.source.version });
}

/** Every authority fact that must hold, right now, before any credential for this execution exists. */
function admission(view: ExecutionView, now: number) {
  if (view.expired || isoMs(view.admissionExpiresAt) <= now) deny('PERMIT_EXPIRED', 'The prepared execution is past its admission window.');
  if (view.mandate.state !== 'APPROVED') deny('PERMIT_MANDATE_INACTIVE', 'The mandate is not currently approved.');
  if (view.mandate.skipNext) deny('PERMIT_SKIP_PENDING', 'The owner asked to skip the next occurrence.');
  if (!view.source.current) deny('PERMIT_SOURCE_CHANGED', 'The funding source changed after preparation.');
  if (view.biller && !view.biller.current) deny('PERMIT_BILLER_CHANGED', 'The linked biller changed after preparation.');
  if (!view.payable.current) deny('PERMIT_PAYABLE_CHANGED', 'The payable changed or was settled after preparation.');
  const operationDigest = digest(permitOperation(view));
  const expiresAt = Math.min(isoMs(view.admissionExpiresAt), now + PERMIT_TTL_MS);
  if (expiresAt - now < PERMIT_MIN_REMAINING_MS) deny('PERMIT_EXPIRED', 'Too little of the admission window remains to complete credential issuance.');
  return { operationDigest, expiresAt };
}

function checkedView(view: ExecutionView) {
  const text = (value: unknown, pattern = id) => typeof value === 'string' && pattern.test(value);
  if (!view || typeof view !== 'object' || !text(view.executionId) || !text(view.runId) || !text(view.accountId) || !text(view.ownerSub) ||
    !view.mandate || !text(view.mandate.id) || !Number.isSafeInteger(view.mandate.policyVersion) ||
    !view.source || !text(view.source.id) || !Number.isSafeInteger(view.source.version) ||
    !view.payable || !text(view.payable.id) || !text(view.payable.revision) || !Number.isSafeInteger(view.payable.amountMinor) || view.payable.amountMinor < 1 ||
    !hex64.test(String(view.boundDigest)) || !Number.isFinite(isoMs(view.preparedAt)) || !Number.isFinite(isoMs(view.admissionExpiresAt)))
    deny('PERMIT_VIEW_INVALID', 'The prepared execution view is incomplete or malformed; no credential is issued.');
}

export class PermitStore {
  readonly db: DatabaseSync;
  constructor(db: DatabaseSync) {
    this.db = db;
    db.exec(`CREATE TABLE IF NOT EXISTS permits(id TEXT PRIMARY KEY,execution_id TEXT NOT NULL,state TEXT NOT NULL,fingerprint TEXT UNIQUE,body TEXT NOT NULL);
      CREATE UNIQUE INDEX IF NOT EXISTS permits_one_live_per_execution ON permits(execution_id) WHERE state!='CLOSED';
      CREATE TABLE IF NOT EXISTS permit_audit(seq INTEGER PRIMARY KEY AUTOINCREMENT,at INTEGER NOT NULL,permit_id TEXT NOT NULL,event TEXT NOT NULL,body TEXT NOT NULL);
      CREATE TRIGGER IF NOT EXISTS permit_audit_no_update BEFORE UPDATE ON permit_audit BEGIN SELECT RAISE(ABORT,'Permit audit is immutable');END;
      CREATE TRIGGER IF NOT EXISTS permit_audit_no_delete BEFORE DELETE ON permit_audit BEGIN SELECT RAISE(ABORT,'Permit audit is immutable');END;`);
  }
  private atomic<T>(fn: () => T): T { this.db.exec('BEGIN IMMEDIATE'); try { const out = fn(); this.db.exec('COMMIT'); return out; } catch (e) { this.db.exec('ROLLBACK'); throw e; } }
  private audit(permitId: string, event: string, body: unknown = {}, now = Date.now()) {
    this.db.prepare('INSERT INTO permit_audit(at,permit_id,event,body) VALUES(?,?,?,?)').run(now, permitId, event, JSON.stringify(body));
  }
  private read(row: { body: string; state: string; fingerprint?: string | null } | undefined): Permit {
    if (!row) return deny('PERMIT_NOT_FOUND', 'No such execution permit exists.');
    return { ...JSON.parse(row.body) as Permit, state: row.state as PermitState, fingerprint: row.fingerprint ?? undefined };
  }
  private save(permit: Permit) {
    this.db.prepare('UPDATE permits SET state=?,fingerprint=?,body=? WHERE id=?').run(permit.state, permit.fingerprint ?? null, JSON.stringify({ ...permit, fingerprint: undefined }), permit.id);
  }
  get(permitId: string): Permit { return this.read(this.db.prepare('SELECT body,state,fingerprint FROM permits WHERE id=?').get(permitId) as never); }
  /** The permit bound to a token fingerprint, without changing it. */
  byFingerprint(fingerprint: string): Permit | undefined {
    const row = this.db.prepare('SELECT body,state,fingerprint FROM permits WHERE fingerprint=?').get(fingerprint) as never;
    return row ? this.read(row) : undefined;
  }
  /** The newest permit for an execution, for inspection and reconciliation. */
  forExecution(executionId: string): Permit | undefined {
    const row = this.db.prepare('SELECT body,state,fingerprint FROM permits WHERE execution_id=? ORDER BY rowid DESC LIMIT 1').get(executionId) as never;
    return row ? this.read(row) : undefined;
  }

  /** Issue the single permit for a prepared execution after re-checking every authority fact in the view. */
  issue(worker: { sub: string; azp: string }, view: ExecutionView, now = Date.now()): Permit {
    if (worker?.azp !== automationWorkerClient || typeof worker.sub !== 'string' || !worker.sub) deny('PERMIT_WORKER_REQUIRED', 'Only the dedicated automation workload may request an execution credential.');
    checkedView(view);
    const { operationDigest, expiresAt } = admission(view, now);
    return this.atomic(() => {
      const rows = this.db.prepare('SELECT body,state,fingerprint FROM permits WHERE execution_id=? ORDER BY rowid DESC').all(view.executionId) as never[];
      const live = rows.map(row => this.read(row)).find(permit => permit.state !== 'CLOSED');
      if (live) {
        if (live.state !== 'ISSUED') deny('PERMIT_ALREADY_ISSUED', 'This execution already received its one credential. Inspect its original operation instead of requesting another.');
        // A prepared execution is immutable, so any difference is an inconsistency, never a reason to re-issue.
        if (live.operationDigest !== operationDigest || live.workerSub !== worker.sub) deny('PERMIT_OPERATION_MISMATCH', 'The execution differs from the one this permit was issued for.');
        // Replay is safe only while no token exists: the same worker gets the same permit back.
        if (live.expiresAt > now) return live;
        live.state = 'CLOSED'; this.save(live); this.audit(live.id, 'permit.closed', { reason: 'EXPIRED' }, now);
      }
      if (rows.length >= MAX_PERMIT_ATTEMPTS) deny('PERMIT_ATTEMPTS_EXHAUSTED', 'This execution used all of its credential attempts.');
      const permit: Permit = {
        id: `permit_${randomUUID()}`, executionId: view.executionId, runId: view.runId, accountId: view.accountId, owner: view.ownerSub,
        workerSub: worker.sub, boundDigest: view.boundDigest, operationDigest, operation: permitOperation(view), state: 'ISSUED', attempt: rows.length + 1, issuedAt: now, expiresAt,
      };
      this.db.prepare('INSERT INTO permits(id,execution_id,state,fingerprint,body) VALUES(?,?,?,NULL,?)').run(permit.id, permit.executionId, permit.state, JSON.stringify(permit));
      this.audit(permit.id, 'permit.issued', { executionId: permit.executionId, attempt: permit.attempt, operation: operationDigest, workerSub: worker.sub }, now);
      return permit;
    });
  }

  /** A second permit for the same execution, only after the owner approved the card challenge its order raised.
   *  The consumed permit it replaces is closed, so its token stops being a session. Each execution resumes at most once:
   *  a resumed permit is never resumed again, so an uncertain resume is held for reconciliation, not repeated. */
  issueResume(worker: { sub: string; azp: string }, view: ExecutionView, now = Date.now()): Permit {
    if (worker?.azp !== automationWorkerClient || typeof worker.sub !== 'string' || !worker.sub) deny('PERMIT_WORKER_REQUIRED', 'Only the dedicated automation workload may request an execution credential.');
    checkedView(view);
    if (view.challenge === 'PENDING') throw new DelegationError(409, 'CHALLENGE_PENDING', 'The owner has not answered the held card challenge yet.');
    if (view.challenge === 'REJECTED') throw new DelegationError(409, 'CHALLENGE_REJECTED', 'The owner rejected the held card challenge; nothing was paid.');
    if (view.challenge !== 'APPROVED') deny('PERMIT_NOT_RESUMABLE', 'Only an execution whose card challenge was approved can resume.');
    const { operationDigest, expiresAt } = admission(view, now);
    return this.atomic(() => {
      const rows = this.db.prepare('SELECT body,state,fingerprint FROM permits WHERE execution_id=? ORDER BY rowid DESC').all(view.executionId) as never[];
      const live = rows.map(row => this.read(row)).find(permit => permit.state !== 'CLOSED');
      if (!live || live.state !== 'CONSUMED' || live.resumeOf) deny('PERMIT_NOT_RESUMABLE', 'This execution has no consumed credential that can be resumed.');
      if (live.operationDigest !== operationDigest || live.workerSub !== worker.sub) deny('PERMIT_OPERATION_MISMATCH', 'The execution differs from the one this permit was issued for.');
      if (rows.length >= MAX_PERMIT_ATTEMPTS) deny('PERMIT_ATTEMPTS_EXHAUSTED', 'This execution used all of its credential attempts.');
      live.state = 'CLOSED'; this.save(live); this.audit(live.id, 'permit.closed', { reason: 'CHALLENGE_RESUMED' }, now);
      const permit: Permit = {
        id: `permit_${randomUUID()}`, executionId: view.executionId, runId: view.runId, accountId: view.accountId, owner: view.ownerSub,
        workerSub: worker.sub, boundDigest: view.boundDigest, operationDigest, operation: permitOperation(view), state: 'ISSUED', attempt: rows.length + 1, issuedAt: now, expiresAt,
        resumeOf: live.id,
      };
      this.db.prepare('INSERT INTO permits(id,execution_id,state,fingerprint,body) VALUES(?,?,?,NULL,?)').run(permit.id, permit.executionId, permit.state, JSON.stringify(permit));
      this.audit(permit.id, 'permit.issued', { executionId: permit.executionId, attempt: permit.attempt, operation: operationDigest, workerSub: worker.sub, resumeOf: live.id }, now);
      return permit;
    });
  }
  /** The resumed token is the provider's session for its own execution, which the provider admitted already, so the bound permit is consumed here. */
  markResumed(permitId: string, now = Date.now()): Permit {
    return this.atomic(() => {
      const permit = this.get(permitId);
      if (permit.state !== 'BOUND' || !permit.resumeOf) deny('PERMIT_STATE_CHANGED', 'Only a bound resumed permit can be marked consumed.');
      permit.state = 'CONSUMED'; this.save(permit);
      this.audit(permit.id, 'permit.resumed', { resumeOf: permit.resumeOf }, now);
      return permit;
    });
  }

  /** Register the fingerprint of the one token minted for this permit; the raw token is never stored. */
  bind(permitId: string, fingerprint: string, token: { sub: string; azp: string; exp: number }, now = Date.now()): Permit {
    return this.atomic(() => {
      const permit = this.get(permitId);
      if (!hex64.test(fingerprint) || !Number.isSafeInteger(token?.exp)) deny('PERMIT_BINDING_MISMATCH', 'The issued token cannot be bound to this permit.');
      if (permit.state !== 'ISSUED') deny('PERMIT_ALREADY_ISSUED', 'This permit already has a token or is closed.');
      if (permit.expiresAt <= now) deny('PERMIT_EXPIRED', 'The permit expired before its token was bound.');
      if (token.sub !== permit.owner || token.azp !== brokerClient || token.exp * 1000 <= now || token.exp * 1000 > permit.expiresAt + 1000) deny('PERMIT_BINDING_MISMATCH', 'The issued token does not match the permit owner, client or lifetime.');
      if (this.db.prepare('SELECT 1 FROM permits WHERE fingerprint=?').get(fingerprint)) deny('PERMIT_BINDING_MISMATCH', 'This token is already bound.');
      permit.state = 'BOUND'; permit.fingerprint = fingerprint; permit.tokenExp = token.exp; this.save(permit);
      this.audit(permit.id, 'permit.bound', { fingerprint, exp: token.exp }, now);
      return permit;
    });
  }

  /** Consume the permit once for exactly the operation it was issued for. */
  authorize(fingerprint: string, sub: string, actor: string, operation: ReturnType<typeof permitOperation>, now = Date.now()): Permit {
    return this.atomic(() => {
      const row = this.db.prepare('SELECT body,state,fingerprint FROM permits WHERE fingerprint=?').get(fingerprint) as never;
      if (!row) return deny('TOKEN_NOT_BOUND', 'No execution permit is bound to this token.');
      const permit = this.read(row);
      if (permit.state !== 'BOUND') deny('PERMIT_ALREADY_CONSUMED', 'This permit is not available for admission.');
      if (permit.tokenExp! * 1000 <= now || permit.expiresAt + 1000 <= now) deny('PERMIT_EXPIRED', 'The permit or its token expired.');
      if (sub !== permit.owner || actor !== brokerClient || digest(operation) !== permit.operationDigest) deny('PERMIT_OPERATION_MISMATCH', 'The presented operation is not the one this permit authorizes.');
      permit.state = 'CONSUMED'; this.save(permit);
      this.audit(permit.id, 'permit.consumed', { operation: permit.operationDigest }, now);
      return permit;
    });
  }

  /** A consumed permit lets the provider chain finish exactly its own operation until the token expires; nothing else. */
  session(fingerprint: string, sub: string, actor: string, now = Date.now()): Permit {
    const permit = this.byFingerprint(fingerprint);
    if (!permit) return deny('TOKEN_NOT_BOUND', 'No execution permit is bound to this token.');
    if (!['CONSUMED', 'UNKNOWN'].includes(permit.state)) deny('PERMIT_NOT_ACTIVE', 'This permit has not been admitted or is closed.');
    if (permit.tokenExp! * 1000 <= now || sub !== permit.owner || actor !== brokerClient || !permit.operation) deny('PERMIT_EXPIRED', 'The permit session is not valid for this token.');
    return permit;
  }

  /** Record the outcome of a consumed permit. An uncertain outcome is never retried with a fresh credential. */
  settle(permitId: string, outcome: 'COMPLETED' | 'FAILED' | 'UNKNOWN', now = Date.now()): Permit {
    return this.atomic(() => {
      const permit = this.get(permitId);
      if (permit.state === outcome) return permit;
      if (!['CONSUMED', 'UNKNOWN'].includes(permit.state)) deny('PERMIT_STATE_CHANGED', 'Only a consumed or uncertain permit can record an outcome.');
      permit.state = outcome; this.save(permit);
      this.audit(permit.id, `permit.${outcome.toLowerCase()}`, {}, now);
      return permit;
    });
  }

  /** Abandon an ISSUED permit whose exchange definitively produced no token. */
  close(permitId: string, reason: string, now = Date.now()): Permit {
    return this.atomic(() => {
      const permit = this.get(permitId);
      if (permit.state !== 'ISSUED') deny('PERMIT_STATE_CHANGED', 'Only a permit without a token can be closed.');
      permit.state = 'CLOSED'; this.save(permit);
      this.audit(permit.id, 'permit.closed', { reason: reason.slice(0, 80) }, now);
      return permit;
    });
  }
}
