/** Public-client OIDC authorization code + PKCE. No service secrets enter a shell. */
export interface BrowserAuthConfig { enabled: boolean; issuer: string; clientId: string; }
type Tokens = { access_token: string; refresh_token?: string; id_token?: string; expiresAt: number };
const tokenKey = 'cityside.oidc.tokens';
const requestKey = 'cityside.oidc.request';
let loginExchange: Promise<void> | undefined;
const encode = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
export class BrowserAuth {
  private config: BrowserAuthConfig;
  private refresh?: Promise<string>;
  constructor(config: BrowserAuthConfig) { this.config = config; }
  get signedIn() { try { return Boolean(JSON.parse(sessionStorage.getItem(tokenKey) || 'null')?.access_token); } catch { return false; } }
  private read(): Tokens | null { try { return JSON.parse(sessionStorage.getItem(tokenKey) || 'null'); } catch { return null; } }
  private async exchange(body: URLSearchParams) {
    const response = await fetch(`${this.config.issuer}/protocol/openid-connect/token`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body, signal: AbortSignal.timeout(10000) });
    if (!response.ok) throw new Error('Sign-in expired or could not be completed. Sign in again.');
    const data = await response.json();
    if (typeof data.access_token !== 'string' || typeof data.expires_in !== 'number') throw new Error('Invalid sign-in response.');
    const tokens: Tokens = { access_token: data.access_token, refresh_token: data.refresh_token, id_token: data.id_token, expiresAt: Date.now() + data.expires_in * 1000 };
    sessionStorage.setItem(tokenKey, JSON.stringify(tokens)); return tokens.access_token;
  }
  async completeLogin() {
    if (loginExchange) return loginExchange;
    loginExchange = this.finishLogin();
    try { await loginExchange; } finally { loginExchange = undefined; }
  }
  private async finishLogin() {
    const url = new URL(location.href);
    if (!url.searchParams.has('code') && !url.searchParams.has('error')) return;
    const request = JSON.parse(sessionStorage.getItem(requestKey) || 'null');
    const code = url.searchParams.get('code'), state = url.searchParams.get('state');
    for (const key of ['code','state','session_state','iss','error','error_description']) url.searchParams.delete(key);
    history.replaceState(null, '', url.pathname + url.search + url.hash);
    sessionStorage.removeItem(requestKey);
    if (!request || request.state !== state || Date.now() - request.createdAt > 600000 || !code) throw new Error('Sign-in was cancelled or expired. Try again.');
    await this.exchange(new URLSearchParams({ grant_type: 'authorization_code', client_id: this.config.clientId, code, redirect_uri: request.redirectUri, code_verifier: request.verifier }));
  }
  async login() {
    const verifier = encode(crypto.getRandomValues(new Uint8Array(32))), state = encode(crypto.getRandomValues(new Uint8Array(24)));
    const challenge = encode(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))));
    const redirectUri = location.origin + location.pathname;
    sessionStorage.setItem(requestKey, JSON.stringify({ verifier, state, redirectUri, createdAt: Date.now() }));
    const url = new URL(`${this.config.issuer}/protocol/openid-connect/auth`);
    url.search = new URLSearchParams({ client_id: this.config.clientId, response_type: 'code', scope: 'openid profile email', redirect_uri: redirectUri, state, code_challenge: challenge, code_challenge_method: 'S256', prompt: 'select_account' }).toString();
    location.assign(url);
  }
  async token(): Promise<string> {
    if (!this.config.enabled) return 'demo-local';
    const tokens = this.read();
    if (!tokens) throw new Error('Sign in to use your city accounts.');
    if (tokens.expiresAt > Date.now() + 30000) return tokens.access_token;
    if (!tokens.refresh_token) { this.clear(); throw new Error('Your session has expired. Sign in again.'); }
    this.refresh ||= this.exchange(new URLSearchParams({ grant_type: 'refresh_token', client_id: this.config.clientId, refresh_token: tokens.refresh_token })).catch(error => { this.clear(); throw error; });
    try { return await this.refresh; } finally { this.refresh = undefined; }
  }
  clear() { sessionStorage.removeItem(tokenKey); localStorage.removeItem('KEYCLOAK_ACCESS_TOKEN'); }
  logout() {
    const tokens = this.read(); this.clear();
    const url = new URL(`${this.config.issuer}/protocol/openid-connect/logout`);
    url.search = new URLSearchParams({ client_id: this.config.clientId, post_logout_redirect_uri: location.origin + location.pathname, ...(tokens?.id_token ? { id_token_hint: tokens.id_token } : {}) }).toString();
    location.assign(url);
  }
}
