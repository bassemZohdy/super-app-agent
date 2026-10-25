/** Automation worker (AUTO-05): drives one leased job through prepare → credential → execute.
 *
 *  The worker holds no authority of its own. It names a rule occurrence, asks the broker for the
 *  one credential of the prepared execution, and presents that credential to the dedicated route.
 *  The credential lives only in this process: if the process dies, the job is held for
 *  reconciliation. It is never re-requested, and no payment identity is ever created here. */
import { CHALLENGE_REASON, JobStore, StaleWorkerError, jobIdentity, type Claim, type Job } from './jobs.ts';

export type GatewayFailure = Error & { status?: number; code?: string };
export type PrepareResult = { skipped: true; reason: string } | { id: string; runId: string; orderId: string };
export type ExecutedOrder = { id: string; state: string; fundsCaptured: boolean; failureCode?: string };
/** The owner's answer to a held card challenge, asked for once per poll; APPROVED carries the one new credential. */
export type ChallengeAnswer = { state: 'PENDING' } | { state: 'REJECTED' } | { state: 'APPROVED'; accessToken: string; expiresAt: number };
/** The worker's whole view of the world; HTTP in production, a fake in tests. */
export interface ExecutionGateway {
  prepare(input: { mandateId: string; occurrenceKey: string; requestKey: string }): Promise<PrepareResult>;
  credential(runId: string, executionId: string): Promise<{ accessToken: string; expiresAt: number }>;
  execute(runId: string, executionId: string, accessToken: string): Promise<ExecutedOrder>;
  resume(runId: string, executionId: string): Promise<ChallengeAnswer>;
  /** The kill switch an authority wants the worker to hold (AUTO-15 step 3b). Absent means no desired state is known. */
  killSwitch?(): Promise<{ engaged: boolean; reason: string } | undefined>;
}
export type WorkerOptions = { workerId: string; leaseMs?: number; maxAttempts?: number; stepRetries?: number; retryDelayMs?: number; challengeWaitMs?: number; clock?: () => number; sleep?: (ms: number) => Promise<void> };

/** Failures only the owner can fix: the worker records them as requiring action and never tries another source or amount. */
export const OWNER_ACTION_CODES: ReadonlySet<string> = new Set(['CARD_DECLINED', 'CARD_LIMIT_EXCEEDED', 'INSUFFICIENT_AVAILABLE_FUNDS', 'METHOD_EXPIRED', 'METHOD_CHANGED', 'CARD_EXPIRED']);
/** Skips that mean the owner should look: the rule did not pay, and only a person can decide whether it should. */
export const REVIEW_SKIP_REASONS: ReadonlySet<string> = new Set(['FINE_TYPE_NOT_APPROVED', 'FINE_REQUIRES_REVIEW', 'OVER_PER_PAYMENT_CAP', 'MAXIMUM_DURATION_REACHED', 'END_TIME_REACHED', 'TARIFF_CHANGED', 'RENEWAL_NOT_INVOICED', 'RENEWAL_REQUIRES_REVIEW', 'RENEWAL_AMBIGUOUS', 'SUBSCRIPTION_NOT_ACTIVE']);
const transient = (e: unknown) => { const status = (e as GatewayFailure).status; return status === undefined || status >= 500; };
const codeOf = (e: unknown) => String((e as GatewayFailure).code || 'REJECTED').slice(0, 80);

export class AutomationWorker {
  readonly store: JobStore; readonly gateway: ExecutionGateway; readonly opts: Required<WorkerOptions>;
  constructor(store: JobStore, gateway: ExecutionGateway, options: WorkerOptions) {
    this.store = store; this.gateway = gateway;
    this.opts = { leaseMs: 60_000, maxAttempts: 5, stepRetries: 3, retryDelayMs: 500, challengeWaitMs: 60_000, clock: Date.now, sleep: ms => new Promise(done => setTimeout(done, ms)), ...options };
  }

  /** Claim and run at most one job. Returns the job's state afterwards, or undefined when nothing was runnable. */
  async runOnce(): Promise<Job | undefined> {
    await this.applyDesiredKillSwitch();
    // AUTO-15: an engaged kill switch admits no new step; nothing is claimed, so nothing is prepared, requested or executed.
    if (this.store.killSwitch().engaged) return undefined;
    const claim = this.store.claim(this.opts.workerId, this.opts.leaseMs, this.opts.clock());
    if (!claim) return undefined;
    try { await this.run(claim); } catch (e) {
      // A fenced-out worker simply stops: the newer holder owns the job and any step already dispatched is idempotent.
      if (!(e instanceof StaleWorkerError)) throw e;
    }
    return this.store.get(claim.job.id);
  }
  /** The worker is the only writer of its own kill switch. An authority's desired state is applied when it is known; an unreadable
   *  or absent state changes nothing, so a switch is never released on a failed read. */
  private async applyDesiredKillSwitch() {
    if (!this.gateway.killSwitch) return;
    let desired: { engaged: boolean; reason: string } | undefined;
    try { desired = await this.gateway.killSwitch(); } catch { return; }
    if (!desired) return;
    const current = this.store.killSwitch();
    if (current.engaged === desired.engaged) return;
    this.store.setKillSwitch(desired.engaged, desired.reason, this.now());
  }
  async drain(limit = 100) { let n = 0; while (n < limit && await this.runOnce()) n++; return n; }

  private now() { return this.opts.clock(); }
  private async run(claim: Claim) {
    const { store } = this, state = claim.job.state;
    if (state === 'CREDENTIALING' || state === 'EXECUTING') {
      // The credential died with the process that held it. Asking again can only be refused; the execution stays held for reconciliation.
      store.transition(claim, 'HELD', { reason: 'CREDENTIAL_LOST_AFTER_RESTART' }, { kind: 'HELD', body: { reason: 'CREDENTIAL_LOST_AFTER_RESTART', executionId: claim.job.executionId } }, this.now());
      return;
    }
    // A kill switch engaged between steps stops this job where it stands: no effect has begun, and the job waits untouched.
    if (this.store.killSwitch().engaged) { store.yield(claim, 0, this.now()); return; }
    // Only a job parked on a card challenge is claimed while held; it resumes when the owner has answered.
    if (state === 'HELD') return this.resume(claim);
    let job = claim.job;
    if (state === 'QUEUED' || state === 'PREPARING') {
      const prepared = await this.prepare(claim);
      if (!prepared) return;
      job = prepared;
      if (this.store.killSwitch().engaged) { store.yield(claim, 0, this.now()); return; }
    }
    const runId = job.runId!, executionId = job.executionId!;
    const credential = await this.credential(claim, runId, executionId);
    if (!credential) return;
    await this.execute(claim, runId, executionId, credential);
  }

  private async prepare(claim: Claim): Promise<Job | undefined> {
    const { store } = this, job = claim.job, identity = jobIdentity(job);
    if (job.state === 'QUEUED') store.transition(claim, 'PREPARING', {}, undefined, this.now());
    store.begin(claim, 'prepare', this.now());
    try {
      const result = await this.gateway.prepare({ mandateId: job.mandateId, occurrenceKey: job.occurrenceKey, requestKey: identity.requestKey });
      if ('skipped' in result) {
        store.outcome(claim, `skipped:${result.reason}`);
        store.transition(claim, 'SKIPPED', { reason: result.reason }, { kind: REVIEW_SKIP_REASONS.has(result.reason) ? 'REQUIRES_ACTION' : 'SKIPPED', body: { reason: result.reason } }, this.now());
        return undefined;
      }
      store.outcome(claim, 'prepared');
      return store.transition(claim, 'PREPARED', { runId: result.runId, executionId: result.id, orderId: result.orderId }, { kind: 'PREPARED', body: { executionId: result.id, orderId: result.orderId } }, this.now());
    } catch (e) {
      // The mandate's cooldown between preparations is a wait, not a failure: the same occurrence is tried again after it, under the same identity.
      if (codeOf(e) === 'AUTOMATION_COOLDOWN') { store.outcome(claim, 'cooldown'); store.yield(claim, Math.max(this.opts.retryDelayMs, 30_000), this.now()); return undefined; }
      if (transient(e)) {
        store.outcome(claim, 'unavailable');
        // Nothing is known to have moved, and the request key makes the retry the same preparation.
        if (claim.job.attempts >= this.opts.maxAttempts) store.transition(claim, 'FAILED', { reason: 'PREPARE_UNAVAILABLE' }, { kind: 'FAILED', body: { reason: 'PREPARE_UNAVAILABLE' } }, this.now());
        else store.yield(claim, this.opts.retryDelayMs * claim.job.attempts, this.now());
        return undefined;
      }
      store.outcome(claim, `rejected:${codeOf(e)}`);
      store.transition(claim, 'FAILED', { reason: codeOf(e) }, { kind: 'FAILED', body: { reason: codeOf(e) } }, this.now());
      return undefined;
    }
  }

  private async credential(claim: Claim, runId: string, executionId: string): Promise<{ accessToken: string; expiresAt: number } | undefined> {
    const { store } = this;
    // Persisted before the request: a crash after this point is a held job, never a second credential.
    store.transition(claim, 'CREDENTIALING', {}, undefined, this.now());
    for (let attempt = 1; attempt <= this.opts.stepRetries; attempt++) {
      store.renew(claim, this.opts.leaseMs, this.now());
      store.begin(claim, 'credential', this.now());
      try {
        const credential = await this.gateway.credential(runId, executionId);
        store.outcome(claim, 'issued');
        return credential;
      } catch (e) {
        const code = codeOf(e);
        if (!transient(e) && code !== 'PERMIT_ALREADY_ISSUED') {
          // Definitive: authority said no, so no credential exists.
          store.outcome(claim, `refused:${code}`);
          store.transition(claim, 'FAILED', { reason: code }, { kind: 'FAILED', body: { reason: code } }, this.now());
          return undefined;
        }
        if (code === 'PERMIT_ALREADY_ISSUED') {
          store.outcome(claim, 'already-issued');
          store.transition(claim, 'HELD', { reason: 'CREDENTIAL_ALREADY_ISSUED' }, { kind: 'HELD', body: { reason: 'CREDENTIAL_ALREADY_ISSUED', executionId } }, this.now());
          return undefined;
        }
        store.outcome(claim, 'unavailable');
        if (attempt < this.opts.stepRetries) await this.opts.sleep(this.opts.retryDelayMs * attempt);
      }
    }
    store.transition(claim, 'HELD', { reason: 'CREDENTIAL_UNKNOWN' }, { kind: 'HELD', body: { reason: 'CREDENTIAL_UNKNOWN', executionId } }, this.now());
    return undefined;
  }

  /** Ask the broker whether the owner answered the held challenge. The job is CREDENTIALING before the request, so a crash
   *  mid-request is held for reconciliation rather than asked again: a resumed credential is never requested twice. */
  private async resume(claim: Claim) {
    const { store } = this, { runId, executionId } = claim.job;
    store.transition(claim, 'CREDENTIALING', {}, undefined, this.now());
    store.begin(claim, 'resume', this.now());
    let answer: ChallengeAnswer;
    try { answer = await this.gateway.resume(runId!, executionId!); } catch (e) {
      const code = transient(e) ? 'CREDENTIAL_UNKNOWN' : codeOf(e);
      store.outcome(claim, `error:${code}`);
      store.transition(claim, 'HELD', { reason: code }, { kind: 'HELD', body: { reason: code, executionId } }, this.now());
      return;
    }
    if (answer.state === 'PENDING') {
      store.outcome(claim, 'pending');
      store.transition(claim, 'HELD', { reason: CHALLENGE_REASON }, undefined, this.now(), this.opts.challengeWaitMs);
      return;
    }
    if (answer.state === 'REJECTED') {
      store.outcome(claim, 'rejected');
      store.transition(claim, 'FAILED', { reason: 'CHALLENGE_REJECTED' }, { kind: 'CHALLENGE_ANSWERED', body: { decision: 'REJECT', reason: 'CHALLENGE_REJECTED' } }, this.now());
      return;
    }
    store.outcome(claim, 'approved');
    await this.execute(claim, runId!, executionId!, answer, { kind: 'CHALLENGE_ANSWERED', body: { decision: 'APPROVE' } });
  }

  private async execute(claim: Claim, runId: string, executionId: string, credential: { accessToken: string; expiresAt: number }, event?: { kind: string; body?: Record<string, unknown> }) {
    const { store } = this;
    // The credential was issued but never presented: nothing was admitted, and the held credential is not reused.
    // The provider's permit stays unconsumed until its admission window closes, and that release is its own sweep.
    if (this.store.killSwitch().engaged) {
      store.transition(claim, 'HELD', { reason: 'KILL_SWITCH_ENGAGED' }, { kind: 'HELD', body: { reason: 'KILL_SWITCH_ENGAGED', executionId } }, this.now());
      return;
    }
    store.transition(claim, 'EXECUTING', {}, event, this.now());
    let last = 'OUTCOME_UNKNOWN';
    for (let attempt = 1; attempt <= this.opts.stepRetries; attempt++) {
      // The same credential is the only thing ever retried, and only while it is alive.
      if (this.now() >= credential.expiresAt - 5000) break;
      store.renew(claim, this.opts.leaseMs, this.now());
      store.begin(claim, 'execute', this.now());
      try {
        const order = await this.gateway.execute(runId, executionId, credential.accessToken);
        store.outcome(claim, `order:${order.state}`);
        if (order.state === 'SETTLED') { store.transition(claim, 'SETTLED', {}, { kind: 'SETTLED', body: { orderId: order.id } }, this.now()); return; }
        if (['FAILED', 'CANCELLED'].includes(order.state) && !order.fundsCaptured) {
          const reason = order.failureCode || order.state;
          store.transition(claim, 'FAILED', { reason }, { kind: OWNER_ACTION_CODES.has(reason) ? 'REQUIRES_ACTION' : 'FAILED', body: { reason, orderId: order.id } }, this.now());
          return;
        }
        const reason = order.state === 'REQUIRES_ACTION' ? 'REQUIRES_ACTION' : order.fundsCaptured ? 'OUTCOME_UNKNOWN' : `ORDER_${order.state}`;
        // A card challenge is parked, not final: the owner's answer is polled for after the wait.
        store.transition(claim, 'HELD', { reason }, { kind: order.state === 'REQUIRES_ACTION' ? 'REQUIRES_ACTION' : 'HELD', body: { reason, orderId: order.id } }, this.now(), order.state === 'REQUIRES_ACTION' ? this.opts.challengeWaitMs : 0);
        return;
      } catch (e) {
        const code = codeOf(e);
        last = transient(e) ? 'OUTCOME_UNKNOWN' : code;
        store.outcome(claim, `error:${code}`);
        if (['AUTOMATION_ADMISSION_REJECTED', 'AUTOMATION_ALREADY_DISPATCHED', 'AUTOMATION_EXECUTION_RELEASED', 'AUTOMATION_OWNER_MISMATCH'].includes(code)) {
          // The provider decided before any funds moved, and it released the reservation itself.
          store.transition(claim, 'FAILED', { reason: code }, { kind: 'FAILED', body: { reason: code } }, this.now());
          return;
        }
        if (attempt < this.opts.stepRetries) await this.opts.sleep(this.opts.retryDelayMs * attempt);
      }
    }
    store.transition(claim, 'HELD', { reason: last }, { kind: 'HELD', body: { reason: last, executionId } }, this.now());
  }
}
