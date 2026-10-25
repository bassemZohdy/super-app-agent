/** Credential issuance for one prepared automatic execution (AUTO-03 step 2b-ii).
 *
 *  The worker names an execution; everything else comes from the provider-owned view and the permit
 *  store. The dependencies are injected so the whole decision path runs offline: `readView` is the
 *  provider read made with the worker's own token and `mint` is the Keycloak exchange. */
import { DelegationError, automationWorkerClient, deny } from './policy.ts';
import { PermitStore, permitOperation, type ExecutionView, type Permit } from './permits.ts';

export type MintedToken = { accessToken: string; sub: string; azp: string; exp: number; fingerprint: string };
export type AutomationDeps = {
  permits: PermitStore;
  readView(runId: string, executionId: string, authorization: string): Promise<ExecutionView>;
  /** Exchange for the one bound token; throw MintRefused only when no token can exist. */
  mint(permit: Permit, view: ExecutionView): Promise<MintedToken>;
  /** Current owner/workspace permission, re-read just before the exchange. */
  eligible(view: ExecutionView): Promise<void>;
};
export type Worker = { sub: string; azp: string; scope?: string; preferred_username?: string; act?: unknown };

const ids = /^[A-Za-z0-9][A-Za-z0-9_-]{0,199}$/;
/** An exchange that definitively produced no token (rejected, never reached the issuer). */
export class MintRefused extends Error {}

export function requireWorker(claims: Worker) {
  if (claims.azp !== automationWorkerClient || claims.act !== undefined || !String(claims.preferred_username || '').startsWith('service-account-') ||
    !String(claims.scope || '').split(' ').includes('automation.execute')) deny('AUTOMATION_WORKER_REQUIRED', 'Only the dedicated automation workload with the execute scope may request an execution credential.');
}

/** `FIRST` is the one credential of a prepared execution; `RESUME` replaces a consumed one once its card challenge was approved. */
export async function issueExecutionCredential(deps: AutomationDeps, worker: Worker, authorization: string, input: { runId?: unknown; executionId?: unknown }, mode: 'FIRST' | 'RESUME' = 'FIRST') {
  requireWorker(worker);
  if (typeof input.runId !== 'string' || !/^autorn_[a-f0-9-]{36}$/.test(input.runId) || typeof input.executionId !== 'string' || !ids.test(input.executionId))
    throw new DelegationError(400, 'VALIDATION_ERROR', 'Name one run and one prepared execution.');
  const view = await deps.readView(input.runId, input.executionId, authorization);
  if (view.runId !== input.runId || view.executionId !== input.executionId) deny('PERMIT_VIEW_INVALID', 'The provider returned a different execution than requested.');
  const permit = mode === 'RESUME' ? deps.permits.issueResume({ sub: worker.sub, azp: worker.azp }, view) : deps.permits.issue({ sub: worker.sub, azp: worker.azp }, view);
  try { await deps.eligible(view); } catch (e) { deps.permits.close(permit.id, 'ELIGIBILITY'); throw e; }
  let minted: MintedToken;
  try { minted = await deps.mint(permit, view); } catch (e) {
    // Only a proven refusal frees the attempt; anything else stays ISSUED until it expires and cannot yield a second bound token.
    if (e instanceof MintRefused) deps.permits.close(permit.id, 'EXCHANGE_REFUSED');
    throw e instanceof DelegationError ? e : new DelegationError(503, 'AUTOMATION_EXCHANGE_FAILED', 'The execution credential could not be issued; retry only the same execution.');
  }
  let bound = deps.permits.bind(permit.id, minted.fingerprint, { sub: minted.sub, azp: minted.azp, exp: minted.exp });
  if (mode === 'RESUME') bound = deps.permits.markResumed(bound.id);
  return { accessToken: minted.accessToken, permitId: bound.id, expiresAt: minted.exp * 1000, attempt: bound.attempt, operation: permitOperation(view) };
}
