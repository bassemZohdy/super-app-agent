/** HTTP edge of the automation worker: the `automation-worker` service account talks to the isolated
 *  payments run and to the credential broker. The execution credential is returned to the caller and
 *  never logged or stored here. */
import { tracedFetch as fetch } from '../../../packages/backend-kit/src/observability.ts';
import { ClientCredentials } from '../../../packages/backend-kit/src/oauth.ts';
import type { ChallengeAnswer, ExecutedOrder, ExecutionGateway, GatewayFailure, PrepareResult } from './worker.ts';

export type HttpGatewayConfig = { runId: string; paymentsUrl: string; brokerUrl: string; clientSecret: string; clientId?: string };

function endpoint(raw: string) {
  const url = new URL(raw);
  if (url.username || url.password || !['http:', 'https:'].includes(url.protocol) || (process.env.NODE_ENV === 'production' && url.protocol !== 'https:')) throw new Error('Invalid automation endpoint');
  return url;
}
const failure = (status: number | undefined, code: string, message: string) => Object.assign(new Error(message), { status, code }) as GatewayFailure;

export class HttpExecutionGateway implements ExecutionGateway {
  private readonly credentials: ClientCredentials; private readonly config: HttpGatewayConfig;
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
    const data = await response.json().catch(() => ({})) as Record<string, any>;
    if (!response.ok || data.success === false) throw failure(response.status, typeof data.code === 'string' ? data.code : 'REJECTED', typeof data.error === 'string' ? data.error : 'The request was rejected.');
    return data;
  }
  private run(path = '') { return `/internal/automation-runs/${this.config.runId}${path}`; }

  async prepare(input: { mandateId: string; occurrenceKey: string; requestKey: string }): Promise<PrepareResult> {
    const data = await this.call(this.config.paymentsUrl, this.run('/prepare'), await this.credentials.token(), input);
    if (data.skipped === true) return { skipped: true, reason: String(data.reason) };
    if (typeof data.id !== 'string' || typeof data.orderId !== 'string') throw failure(502, 'PREPARATION_INVALID', 'The preparation response was incomplete.');
    return { id: data.id, runId: this.config.runId, orderId: data.orderId };
  }
  async credential(runId: string, executionId: string) {
    const data = await this.call(this.config.brokerUrl, `/api/delegation/automation/executions/${encodeURIComponent(executionId)}/credential`, await this.credentials.token(), { runId });
    if (typeof data.accessToken !== 'string' || !Number.isFinite(data.expiresAt)) throw failure(502, 'CREDENTIAL_INVALID', 'The credential response was incomplete.');
    return { accessToken: data.accessToken as string, expiresAt: Number(data.expiresAt) };
  }
  /** One poll for the owner's answer. The broker refuses a pending or rejected answer before it issues anything. */
  async resume(runId: string, executionId: string): Promise<ChallengeAnswer> {
    if (runId !== this.config.runId) throw failure(400, 'RUN_MISMATCH', 'The job belongs to another run.');
    try {
      const data = await this.call(this.config.brokerUrl, `/api/delegation/automation/executions/${encodeURIComponent(executionId)}/resume-credential`, await this.credentials.token(), { runId });
      if (typeof data.accessToken !== 'string' || !Number.isFinite(data.expiresAt)) throw failure(502, 'CREDENTIAL_INVALID', 'The credential response was incomplete.');
      return { state: 'APPROVED', accessToken: data.accessToken as string, expiresAt: Number(data.expiresAt) };
    } catch (e) {
      const code = (e as GatewayFailure).code;
      if (code === 'CHALLENGE_PENDING') return { state: 'PENDING' };
      if (code === 'CHALLENGE_REJECTED') return { state: 'REJECTED' };
      throw e;
    }
  }
  async execute(runId: string, executionId: string, accessToken: string): Promise<ExecutedOrder> {
    if (runId !== this.config.runId) throw failure(400, 'RUN_MISMATCH', 'The job belongs to another run.');
    const data = await this.call(this.config.paymentsUrl, this.run(`/execution/${encodeURIComponent(executionId)}/execute`), accessToken, {}, 60000);
    const order = data.order as ExecutedOrder | undefined;
    if (!order || typeof order.state !== 'string') throw failure(502, 'ORDER_INVALID', 'The execution response was incomplete.');
    return { id: String(order.id), state: order.state, fundsCaptured: order.fundsCaptured === true, failureCode: order.failureCode };
  }
}
