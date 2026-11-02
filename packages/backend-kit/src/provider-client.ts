import { boundedJsonResponse } from './bounded-json.ts';
import { tracedFetch as fetch } from './observability.ts';
import { PROVIDER_PORTS } from './local-endpoints.ts';
import { ClientCredentials } from './oauth.ts';
import type { Actor } from './context.ts';
import { recordCall } from './connections.ts';
export class UpstreamError extends Error {
  status: number; code: string;
  constructor(status: number, code: string, message: string) { super(message); this.status = status; this.code = code; }
}
const ports: Record<string, number> = PROVIDER_PORTS;
export class ProviderClient {
  readonly credentials: ClientCredentials;
  constructor(clientId: string, secret: string) { this.credentials = new ClientCredentials(clientId, secret); }
  async call(provider: string, actor: Actor, method: string, path: string, body?: unknown, idempotencyKey?: string): Promise<any> {
    const base = process.env[`PROVIDER_${provider.toUpperCase()}_URL`] || `http://localhost:${ports[provider]}`;
    const bootstrap = path === '/v1/accounts';
    const accountPrefix = `/v1/accounts/${encodeURIComponent(actor.accountId)}`;
    const rawPath = path.split('?', 1)[0];
    if (!path.startsWith('/') || path.startsWith('//') || /[\\#\x00-\x1f\x7f]/.test(path) || /%2f|%5c/i.test(rawPath))
      throw new UpstreamError(400, 'PROVIDER_PATH_INVALID', 'The provider path is invalid.');
    const url = new URL(bootstrap ? path : `${accountPrefix}${path}`, base);
    if (!bootstrap && !url.pathname.startsWith(`${accountPrefix}/`))
      throw new UpstreamError(400, 'PROVIDER_PATH_INVALID', 'The provider path is invalid.');
    if (process.env.NODE_ENV === 'production' && url.protocol !== 'https:') throw new UpstreamError(503, 'HTTPS_REQUIRED', 'Provider HTTPS is required.');
    const send = async () => fetch(url, {
      method, redirect: 'error', signal: AbortSignal.timeout(8000),
      headers: { Authorization: actor.authorization || `Bearer ${await this.credentials.token()}`, 'Content-Type': 'application/json',
        ...(!actor.authorization ? { 'X-User-Subject': actor.sub, 'X-User-Name': Buffer.from(actor.name).toString('base64url') } : {}),
        ...(method === 'POST' ? { 'Idempotency-Key': idempotencyKey || `${actor.requestId}:${provider}:${path}` } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const started = Date.now();
    // What was called and what came back, for the Connections view: the owner's own calls, with no account or object id.
    const record = (status: number, code?: string) => recordCall(actor.sub, { at: started, provider, method, path: url.pathname, status, ...(code ? { code } : {}), ms: Date.now() - started });
    let response: Response;
    try {
      response = await send();
      if (response.status === 401 && !actor.authorization) { this.credentials.invalidate(); response = await send(); }
    } catch { record(503, method === 'POST' ? 'PROVIDER_OUTCOME_UNKNOWN' : 'PROVIDER_UNAVAILABLE'); throw new UpstreamError(503, method === 'POST' ? 'PROVIDER_OUTCOME_UNKNOWN' : 'PROVIDER_UNAVAILABLE', `The ${provider} simulator is unavailable.`); }
    let data: Record<string, unknown>;
    try {
      const parsed = await boundedJsonResponse(response);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Invalid provider response');
      data = parsed as Record<string, unknown>;
    } catch {
      const code = method === 'POST' ? 'PROVIDER_OUTCOME_UNKNOWN' : 'PROVIDER_UNAVAILABLE';
      record(503, code);
      throw new UpstreamError(503, code, `The ${provider} simulator response could not be read.`);
    }
    if (response.ok && data.success === true && !Object.hasOwn(data, 'error')) {
      record(response.status);
      return data;
    }
    const upstreamCode = typeof data.code === 'string' ? data.code : '';
    const unknownCode = upstreamCode === 'OUTCOME_UNKNOWN' || upstreamCode.endsWith('_OUTCOME_UNKNOWN');
    const rejection = response.status >= 400 && response.status < 500 && response.status !== 408 &&
      data.success !== true && !unknownCode && (data.success === false || typeof data.error === 'string' && data.error.length > 0);
    if (!rejection) {
      const code = method === 'POST' ? 'PROVIDER_OUTCOME_UNKNOWN' : 'PROVIDER_UNAVAILABLE';
      record(503, code);
      throw new UpstreamError(503, code, `The ${provider} simulator response could not be confirmed.`);
    }
    const code = upstreamCode || 'PROVIDER_REJECTED';
    record(response.status, code);
    throw new UpstreamError(response.status, code, typeof data.error === 'string' ? data.error : `The ${provider} request was rejected.`);
  }
}
