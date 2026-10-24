import { tracedFetch as fetch } from './observability.ts';
/** Per-process service token cache; never stores an end-user bearer token. */
export class ClientCredentials {
  private cached?: { value: string; until: number };
  private pending?: Promise<string>;
  private clientId: string;
  private secret: string;
  constructor(clientId: string, secret: string) { this.clientId = clientId; this.secret = secret; }
  invalidate() { this.cached = undefined; }
  async token(): Promise<string> {
    if (this.cached && Date.now() < this.cached.until) return this.cached.value;
    if (this.pending) return this.pending;
    this.pending = this.fetchToken();
    try { return await this.pending; } finally { this.pending = undefined; }
  }
  private async fetchToken() {
    if (!this.secret) throw new Error('Service client secret is not configured');
    const url = process.env.KEYCLOAK_TOKEN_URL || `${process.env.KEYCLOAK_ISSUER}/protocol/openid-connect/token`;
    if (process.env.NODE_ENV === 'production' && new URL(url).protocol !== 'https:') throw new Error('HTTPS required');
    const response = await fetch(url, {
      method: 'POST', signal: AbortSignal.timeout(5000),
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'client_credentials', client_id: this.clientId, client_secret: this.secret }),
    });
    if (!response.ok) throw new Error(`Service authentication failed (${response.status})`);
    const data = await response.json() as any;
    if (typeof data.access_token !== 'string' || typeof data.expires_in !== 'number' || data.expires_in <= 0) throw new Error('Invalid service token response');
    this.cached = { value: data.access_token, until: Date.now() + Math.max(0, data.expires_in - 30) * 1000 };
    return data.access_token;
  }
}
