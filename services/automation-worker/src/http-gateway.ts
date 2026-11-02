/** HTTP edge of the automation worker: the `automation-worker` service account talks to the isolated
 *  payments run and to the credential broker. The execution credential is returned to the caller and
 *  never logged or stored here. */
import { tracedFetch as fetch } from '../../../packages/backend-kit/src/observability.ts';
import { ClientCredentials } from '../../../packages/backend-kit/src/oauth.ts';
import { boundedJsonResponse } from '../../../packages/backend-kit/src/bounded-json.ts';
import { hasEffectEvidence } from '../../../packages/backend-kit/src/outcome.ts';
import { AUTOMATION_ORDER_STATES, type ChallengeAnswer, type ExecutedOrder, type ExecutionGateway, type GatewayFailure, type PrepareResult } from './worker.ts';

export type HttpGatewayConfig = { runId: string; paymentsUrl: string; brokerUrl: string; clientSecret: string; clientId?: string };

function endpoint(raw: string) {
  const url = new URL(raw);
  if (url.username || url.password || !['http:', 'https:'].includes(url.protocol) || (process.env.NODE_ENV === 'production' && url.protocol !== 'https:')) throw new Error('Invalid automation endpoint');
  return url;
}
const failure = (status: number | undefined, code: string, message: string) => Object.assign(new Error(message), { status, code }) as GatewayFailure;
const usableCredential = (data: Record<string, unknown>): data is Record<string, unknown> & { accessToken: string; expiresAt: number } =>
  typeof data.accessToken === 'string' && data.accessToken.length > 0 && data.accessToken.length <= 16384 && !/\s/.test(data.accessToken) &&
  typeof data.expiresAt === 'number' && Number.isSafeInteger(data.expiresAt) && data.expiresAt > Date.now() + 5000;
// Only documented codes are retained; arbitrary provider text must not enter job history.
const REFUSALS = new Set([
  'AUTOMATION_COOLDOWN', 'AUTOMATION_ADMISSION_REJECTED', 'AUTOMATION_ALREADY_DISPATCHED', 'AUTOMATION_EXECUTION_RELEASED', 'AUTOMATION_OWNER_MISMATCH',
  'PERMIT_ALREADY_ISSUED', 'PERMIT_EXPIRED', 'PERMIT_MANDATE_INACTIVE', 'PERMIT_SKIP_PENDING', 'PERMIT_SOURCE_CHANGED', 'PERMIT_BILLER_CHANGED',
  'PERMIT_PAYABLE_CHANGED', 'PERMIT_VIEW_INVALID', 'PERMIT_NOT_FOUND', 'PERMIT_WORKER_REQUIRED', 'PERMIT_OPERATION_MISMATCH',
  'PERMIT_ATTEMPTS_EXHAUSTED', 'PERMIT_NOT_RESUMABLE', 'CHALLENGE_PENDING', 'CHALLENGE_REJECTED', 'AUTOMATION_WORKER_REQUIRED',
]);

export class HttpExecutionGateway implements ExecutionGateway {
  private readonly credentials: ClientCredentials; private readonly config: HttpGatewayConfig;
  get runId() { return this.config.runId; }
  constructor(config: HttpGatewayConfig) {
    if (!/^autorn_[a-f0-9-]{36}$/.test(config.runId)) throw new Error('Name the isolated automation run.');
    endpoint(config.paymentsUrl); endpoint(config.brokerUrl);
    this.config = config;
    this.credentials = new ClientCredentials(config.clientId || 'automation-worker', config.clientSecret, 'automation.execute');
  }
  private async call(base: string, path: string, bearer: string, body: unknown, timeoutMs = 15000) {
    let response: Response;
    try {
      response = await fetch(new URL(path, endpoint(base)), { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(timeoutMs),
        headers: { Authorization: `Bearer ${bearer}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    } catch { throw failure(undefined, 'UNREACHABLE', 'The automation endpoint could not be reached.'); }
    let bodyData: unknown;
    try { bodyData = await boundedJsonResponse(response, 65536); }
    catch { throw failure(502, 'AUTOMATION_RESPONSE_UNCERTAIN', 'The automation response could not be confirmed.'); }
    if (!bodyData || typeof bodyData !== 'object' || Array.isArray(bodyData)) throw failure(502, 'AUTOMATION_RESPONSE_UNCERTAIN', 'The automation response could not be confirmed.');
    const data = bodyData as Record<string, unknown>;
    if (!response.ok || data.success !== true || Object.hasOwn(data, 'error') || Object.hasOwn(data, 'code')) {
      const contradictory = hasEffectEvidence(data) || ['accessToken', 'expiresAt', 'id', 'orderId', 'runId', 'state', 'amountMinor'].some(key => Object.hasOwn(data, key));
      if (response.status >= 400 && response.status < 500 && data.success === false && !contradictory && typeof data.code === 'string' && REFUSALS.has(data.code)) throw failure(response.status, data.code, 'The automation request was refused.');
      throw failure(502, 'AUTOMATION_RESPONSE_UNCERTAIN', 'The automation response could not be confirmed.');
    }
    return data;
  }
  private run(path = '') { return `/internal/automation-runs/${this.config.runId}${path}`; }

  async prepare(input: { mandateId: string; policyVersion: number; occurrenceKey: string; requestKey: string }): Promise<PrepareResult> {
    const data = await this.call(this.config.paymentsUrl, this.run('/prepare'), await this.credentials.token(), { mandateId: input.mandateId, occurrenceKey: input.occurrenceKey, requestKey: input.requestKey });
    return this.preparation(data, input);
  }
  private preparation(data: Record<string, unknown>, input: { mandateId: string; policyVersion: number; occurrenceKey: string }): PrepareResult {
    if (data.mandateId !== input.mandateId || data.occurrenceKey !== input.occurrenceKey) throw failure(502, 'PREPARATION_INVALID', 'The preparation response was incomplete.');
    if (data.skipped === true) {
      if (typeof data.reason !== 'string' || ['id', 'orderId', 'runId', 'policyVersion', 'state', 'amountMinor', 'currency'].some(key => Object.hasOwn(data, key))) throw failure(502, 'PREPARATION_INVALID', 'The preparation response was incomplete.');
      return { skipped: true, reason: data.reason };
    }
    if (data.runId !== this.config.runId || data.policyVersion !== input.policyVersion || data.state !== 'PREPARED' || typeof data.id !== 'string' || !/^autoexec_[A-Za-z0-9_-]{1,100}$/.test(data.id) || typeof data.orderId !== 'string' || !/^(?:order|funding)_[A-Za-z0-9_-]{1,100}$/.test(data.orderId) || typeof data.amountMinor !== 'number' || !Number.isSafeInteger(data.amountMinor) || data.amountMinor <= 0 || data.amountMinor > 100000000 || data.currency !== 'AED') throw failure(502, 'PREPARATION_INVALID', 'The preparation response was incomplete.');
    return { id: data.id, runId: this.config.runId, orderId: data.orderId, amountMinor: data.amountMinor };
  }
  /** Read only: absence is not proof that an earlier in-flight request will not later commit. */
  async inspectPreparation(input: { mandateId: string; policyVersion: number; occurrenceKey: string; requestKey: string }): Promise<PrepareResult | undefined> {
    if (!/^[A-Za-z0-9_-]{8,100}$/.test(input.requestKey)) throw failure(400, 'PREPARATION_INVALID', 'Name the original preparation request.');
    const bearer = await this.credentials.token();
    let response: Response;
    try {
      response = await fetch(new URL(this.run(`/requests/${encodeURIComponent(input.requestKey)}`), endpoint(this.config.paymentsUrl)), { method: 'GET', redirect: 'error', signal: AbortSignal.timeout(5000), headers: { Authorization: `Bearer ${bearer}` } });
    } catch { throw failure(undefined, 'UNREACHABLE', 'The preparation could not be inspected.'); }
    if (!response.ok) { void response.body?.cancel().catch(() => {}); throw failure(502, 'PREPARATION_INVALID', 'The preparation could not be inspected.'); }
    let body: unknown;
    try { body = await boundedJsonResponse(response, 65536); } catch { throw failure(502, 'PREPARATION_INVALID', 'The preparation could not be inspected.'); }
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw failure(502, 'PREPARATION_INVALID', 'The preparation could not be inspected.');
    const data = body as Record<string, unknown>;
    if (data.success !== true || Object.hasOwn(data, 'error') || Object.hasOwn(data, 'code') || typeof data.found !== 'boolean') throw failure(502, 'PREPARATION_INVALID', 'The preparation could not be inspected.');
    if (!data.found) {
      if (Object.hasOwn(data, 'preparation')) throw failure(502, 'PREPARATION_INVALID', 'The preparation could not be inspected.');
      return undefined;
    }
    if (!data.preparation || typeof data.preparation !== 'object' || Array.isArray(data.preparation)) throw failure(502, 'PREPARATION_INVALID', 'The preparation could not be inspected.');
    return this.preparation(data.preparation as Record<string, unknown>, input);
  }
  async credential(runId: string, executionId: string) {
    if (runId !== this.config.runId) throw failure(400, 'RUN_MISMATCH', 'The job belongs to another run.');
    const data = await this.call(this.config.brokerUrl, `/api/delegation/automation/executions/${encodeURIComponent(executionId)}/credential`, await this.credentials.token(), { runId });
    if (!usableCredential(data)) throw failure(502, 'CREDENTIAL_INVALID', 'The credential response was incomplete.');
    return { accessToken: data.accessToken, expiresAt: data.expiresAt };
  }
  /** One poll for the owner's answer. The broker refuses a pending or rejected answer before it issues anything. */
  async resume(runId: string, executionId: string): Promise<ChallengeAnswer> {
    if (runId !== this.config.runId) throw failure(400, 'RUN_MISMATCH', 'The job belongs to another run.');
    try {
      const data = await this.call(this.config.brokerUrl, `/api/delegation/automation/executions/${encodeURIComponent(executionId)}/resume-credential`, await this.credentials.token(), { runId });
      if (!usableCredential(data)) throw failure(502, 'CREDENTIAL_INVALID', 'The credential response was incomplete.');
      return { state: 'APPROVED', accessToken: data.accessToken, expiresAt: data.expiresAt };
    } catch (e) {
      const code = (e as GatewayFailure).code;
      if (code === 'CHALLENGE_PENDING') return { state: 'PENDING' };
      if (code === 'CHALLENGE_REJECTED') return { state: 'REJECTED' };
      throw e;
    }
  }
  /** The broker's desired kill-switch state. 404 means no state was ever set, which the worker reads as "change nothing". */
  async killSwitch(): Promise<{ engaged: boolean; reason: string; at: number } | undefined> {
    const bearer = await this.credentials.token();
    let response: Response;
    try {
      response = await fetch(new URL('/api/delegation/automation/kill-switch', endpoint(this.config.brokerUrl)), { method: 'GET', redirect: 'error', signal: AbortSignal.timeout(5000),
        headers: { Authorization: `Bearer ${bearer}` } });
    } catch { throw failure(undefined, 'UNREACHABLE', 'The kill-switch state could not be read.'); }
    if (!response.ok) {
      void response.body?.cancel().catch(() => {});
      if (response.status === 404) return undefined;
      throw failure(response.status, 'KILL_SWITCH_UNREADABLE', 'The kill-switch state response was invalid.');
    }
    let body: unknown;
    try { body = await boundedJsonResponse(response, 65536); }
    catch { throw failure(response.status, 'KILL_SWITCH_UNREADABLE', 'The kill-switch state response was invalid.'); }
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw failure(response.status, 'KILL_SWITCH_UNREADABLE', 'The kill-switch state response was invalid.');
    const data = body as Record<string, unknown>;
    if (Object.keys(data).some(key => !['success', 'engaged', 'reason', 'at'].includes(key)) || data.success !== true || typeof data.engaged !== 'boolean' || typeof data.at !== 'number' || !Number.isSafeInteger(data.at) || data.at <= 0 || typeof data.reason !== 'string' || data.reason.length > 120 || (data.engaged && !data.reason.trim())) throw failure(response.status, 'KILL_SWITCH_UNREADABLE', 'The kill-switch state response was invalid.');
    return { engaged: data.engaged, reason: data.reason, at: data.at };
  }
  async execute(runId: string, executionId: string, accessToken: string): Promise<ExecutedOrder> {
    if (runId !== this.config.runId) throw failure(400, 'RUN_MISMATCH', 'The job belongs to another run.');
    const data = await this.call(this.config.paymentsUrl, this.run(`/execution/${encodeURIComponent(executionId)}/execute`), accessToken, {}, 60000);
    if (!data.order || typeof data.order !== 'object' || Array.isArray(data.order)) throw failure(502, 'ORDER_INVALID', 'The execution response was incomplete.');
    const order = data.order as Record<string, unknown>;
    if (typeof order.id !== 'string' || !order.id || order.id.length > 200 || typeof order.state !== 'string' || !AUTOMATION_ORDER_STATES.has(order.state) || typeof order.fundsCaptured !== 'boolean' || (order.failureCode !== undefined && typeof order.failureCode !== 'string')) throw failure(502, 'ORDER_INVALID', 'The execution response was incomplete.');
    const receipt = order.receipt && typeof order.receipt === 'object' && !Array.isArray(order.receipt) ? order.receipt as Record<string, unknown> : undefined;
    return { id: order.id, state: order.state, fundsCaptured: order.fundsCaptured, failureCode: order.failureCode as string | undefined,
      receipt: receipt && typeof receipt.amountMinor === 'number' && typeof receipt.currency === 'string' && typeof receipt.receiptNumber === 'string' ? { amountMinor: receipt.amountMinor, currency: receipt.currency, receiptNumber: receipt.receiptNumber } : undefined };
  }
}
