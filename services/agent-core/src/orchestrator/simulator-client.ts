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
    if (response.status === 409 && reasons.length) {
      const reason = await boundedJson(response).then(value => (value as { code?: unknown })?.code, () => undefined);
      if (typeof reason === 'string' && reasons.includes(reason)) throw new AgentError(reason, 409);
    }
    throw new AgentError(response.status === 409 ? 'QUOTE_STALE' : response.status === 403 ? 'PROVIDER_DENIED' : 'PROVIDER_FAILURE', response.status);
  }
  return boundedJson(response);
}
