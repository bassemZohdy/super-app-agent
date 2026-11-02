import { tracedFetch as fetch } from './observability.ts';
import { boundedJsonResponse } from './bounded-json.ts';
/** OAuth error members make an apparent token response contradictory. */
export const hasOAuthError = (body: Record<string, unknown>) => ['error', 'error_description', 'error_uri'].some(key => Object.hasOwn(body, key));

/** Per-process service token cache; never stores an end-user bearer token. */
export class ClientCredentials {
  private cached?: { value: string; until: number };
  private pending?: Promise<string>;
  private generation = 0;
  private clientId: string;
  private secret: string;
  private scope?: string;
  constructor(clientId: string, secret: string, scope?: string) { this.clientId = clientId; this.secret = secret; this.scope = scope; }
  invalidate() { this.generation++; this.cached = undefined; this.pending = undefined; }
  async token(): Promise<string> {
    if (this.cached && Date.now() < this.cached.until) return this.cached.value;
    if (this.pending) return this.pending;
    const generation = this.generation;
    const pending = this.fetchToken().then(result => {
      if (generation !== this.generation) throw new Error('Service authentication invalidated');
      this.cached = result;
      return result.value;
    });
    this.pending = pending;
    try { return await pending; } finally { if (this.pending === pending) this.pending = undefined; }
  }
  private async fetchToken() {
    if (!this.secret) throw new Error('Service client secret is not configured');
    const url = process.env.KEYCLOAK_TOKEN_URL || `${process.env.KEYCLOAK_ISSUER}/protocol/openid-connect/token`;
    if (process.env.NODE_ENV === 'production' && new URL(url).protocol !== 'https:') throw new Error('HTTPS required');
    const response = await fetch(url, {
      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(5000),
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'client_credentials', client_id: this.clientId, client_secret: this.secret, ...(this.scope ? { scope: this.scope } : {}) }),
    });
    if (!response.ok) { void response.body?.cancel().catch(() => {}); throw new Error(`Service authentication failed (${response.status})`); }
    let data: unknown;
    try { data = await boundedJsonResponse(response, 65536); }
    catch { throw new Error('Invalid service token response'); }
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('Invalid service token response');
    const body = data as Record<string, unknown>;
    if (hasOAuthError(body)) throw new Error('Invalid service token response');
    const { access_token: token, expires_in: lifetime } = body;
    if (typeof token !== 'string' || !/^[\x21-\x7e]{1,16384}$/.test(token) ||
        typeof lifetime !== 'number' || !Number.isSafeInteger(lifetime) || lifetime <= 0 || lifetime > 86400) throw new Error('Invalid service token response');
    return { value: token, until: Date.now() + Math.max(0, lifetime - 30) * 1000 };
  }
}
