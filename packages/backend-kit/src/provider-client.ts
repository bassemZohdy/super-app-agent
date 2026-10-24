import { ClientCredentials } from './oauth.ts';
import type { Actor } from './context.ts';
export class UpstreamError extends Error {
  status: number; code: string;
  constructor(status: number, code: string, message: string) { super(message); this.status = status; this.code = code; }
}
const ports: Record<string, number> = { rta: 4101, dewa: 4102, etisalat: 4103, du: 4104, police: 4105, dld: 4106, payments: 4107 };
export class ProviderClient {
  readonly credentials: ClientCredentials;
  constructor(clientId: string, secret: string) { this.credentials = new ClientCredentials(clientId, secret); }
  async call(provider: string, actor: Actor, method: string, path: string, body?: unknown, idempotencyKey?: string): Promise<any> {
    const base = process.env[`PROVIDER_${provider.toUpperCase()}_URL`] || `http://localhost:${ports[provider]}`;
    const url = new URL(path === '/v1/accounts' ? path : `/v1/accounts/${encodeURIComponent(actor.accountId)}${path}`, base);
    if (process.env.NODE_ENV === 'production' && url.protocol !== 'https:') throw new UpstreamError(503, 'HTTPS_REQUIRED', 'Provider HTTPS is required.');
    const send = async () => fetch(url, {
      method, signal: AbortSignal.timeout(8000),
      headers: { Authorization: actor.authorization || `Bearer ${await this.credentials.token()}`, 'Content-Type': 'application/json',
        ...(!actor.authorization ? { 'X-User-Subject': actor.sub, 'X-User-Name': Buffer.from(actor.name).toString('base64url') } : {}),
        ...(method === 'POST' ? { 'Idempotency-Key': idempotencyKey || `${actor.requestId}:${provider}:${path}` } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    let response: Response;
    try {
      response = await send();
      if (response.status === 401 && !actor.authorization) { this.credentials.invalidate(); response = await send(); }
    } catch { throw new UpstreamError(503, method === 'POST' ? 'PROVIDER_OUTCOME_UNKNOWN' : 'PROVIDER_UNAVAILABLE', `The ${provider} simulator is unavailable.`); }
    const data = await response.json() as any;
    if (!response.ok || data.success !== true) throw new UpstreamError(response.status, typeof data.code === 'string' ? data.code : 'PROVIDER_REJECTED', typeof data.error === 'string' ? data.error : `The ${provider} request was rejected.`);
    return data;
  }
}
