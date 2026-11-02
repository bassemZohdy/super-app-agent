import { AgentError, boundedJson, type ExecutionContext } from './contracts.ts';

/** One governed REST call to the in-process simulator. `reasons` lists the 409 codes a service may report as its own. */
export async function simulatorRequest(base: URL, workloadKey: string, path: string, ctx: ExecutionContext, signal: AbortSignal, options: { body?: unknown; key?: string; reasons?: readonly string[] } = {}): Promise<unknown> {
  const { body, key, reasons = [] } = options;
  const response = await fetch(new URL(path, base), {
    method: body ? 'POST' : 'GET', redirect: 'error', signal,
    headers: { Authorization: ctx.authorization, 'X-Agent-Key': workloadKey, 'X-Correlation-ID': ctx.correlationId, 'Content-Type': 'application/json', ...(key ? { 'Idempotency-Key': key } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  if (!response.ok) {
    if (response.status === 409 || response.status === 403) {
      const reason = await boundedJson(response).then(value => (value as { code?: unknown })?.code, () => undefined);
      if (response.status === 409 && typeof reason === 'string' && reasons.includes(reason)) throw new AgentError(reason, 409);
      if (response.status === 403 && typeof reason === 'string' && ['PERMISSION_DENIED', 'WORKLOAD_REQUIRED', 'CONSENT_REQUIRED_OR_EXPIRED', 'ORIGIN_NOT_ALLOWED'].includes(reason)) throw new AgentError('PROVIDER_DENIED', 403);
      // An unrecognized refusal cannot prove that a write did not commit.
      throw new AgentError('PROVIDER_FAILURE', 502);
    }
    throw new AgentError('PROVIDER_FAILURE', response.status);
  }
  return boundedJson(response);
}
