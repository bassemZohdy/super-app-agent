/** Public-client OIDC authorization code + PKCE. No service secrets enter a shell. */
export interface BrowserAuthConfig { enabled: boolean; issuer: string; clientId: string; }
type Tokens = { access_token: string; refresh_token?: string; id_token?: string; expiresAt: number };
const tokenKey = 'cityside.oidc.tokens';
const requestKey = 'cityside.oidc.request';
let loginExchange: Promise<void> | undefined;
let authGeneration = 0;
let refreshExchange: { generation: number; snapshot: string; binding: string; promise: Promise<string> } | undefined;
const encode = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const validToken = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= 16384 && /^[\x21-\x7e]+$/.test(value);
async function readTokenResponse(response: Response): Promise<{ access_token?: unknown; expires_in?: unknown; refresh_token?: unknown; id_token?: unknown }> {
  const reader = response.body?.getReader();
  if (!reader) throw new Error('Invalid sign-in response.');
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let text = '', size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 65536) throw new Error('Response exceeds limit');
      text += decoder.decode(value, { stream: true });
    }
    const parsed: unknown = JSON.parse(text + decoder.decode());
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Invalid response');
    return parsed;
  } catch {
    void reader.cancel().catch(() => {});
    throw new Error('Invalid sign-in response.');
  } finally { reader.releaseLock(); }
}
export class BrowserAuth {
  private config: BrowserAuthConfig;
  constructor(config: BrowserAuthConfig) { this.config = config; }
  get signedIn() { try { return Boolean(JSON.parse(sessionStorage.getItem(tokenKey) || 'null')?.access_token); } catch { return false; } }
  private read(): Tokens | null { try { return JSON.parse(sessionStorage.getItem(tokenKey) || 'null'); } catch { return null; } }
  private async exchange(body: URLSearchParams, generation: number, snapshot: string | null) {
    const response = await fetch(`${this.config.issuer}/protocol/openid-connect/token`, { method: 'POST', redirect: 'error', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body, signal: AbortSignal.timeout(10000) });
    if (!response.ok) throw new Error('Sign-in expired or could not be completed. Sign in again.');
    const data = await readTokenResponse(response);
    if (!validToken(data.access_token) || typeof data.expires_in !== 'number' || !Number.isSafeInteger(data.expires_in) || data.expires_in <= 0 || !Number.isSafeInteger(Date.now() + data.expires_in * 1000) ||
      (data.refresh_token !== undefined && !validToken(data.refresh_token)) || (data.id_token !== undefined && !validToken(data.id_token))) throw new Error('Invalid sign-in response.');
    if (generation !== authGeneration || sessionStorage.getItem(tokenKey) !== snapshot) throw new Error('Sign-in changed. Sign in again.');
    const tokens: Tokens = { access_token: data.access_token, refresh_token: data.refresh_token, id_token: data.id_token, expiresAt: Date.now() + data.expires_in * 1000 };
    sessionStorage.setItem(tokenKey, JSON.stringify(tokens)); return tokens.access_token;
  }
  async completeLogin() {
    if (loginExchange) return loginExchange;
    const pending = this.finishLogin(); loginExchange = pending;
    try { await pending; } finally { if (loginExchange === pending) loginExchange = undefined; }
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
    const generation = ++authGeneration; refreshExchange = undefined;
    await this.exchange(new URLSearchParams({ grant_type: 'authorization_code', client_id: this.config.clientId, code, redirect_uri: request.redirectUri, code_verifier: request.verifier }), generation, sessionStorage.getItem(tokenKey));
  }
  async login() {
    const generation = ++authGeneration; refreshExchange = undefined; loginExchange = undefined;
    const verifier = encode(crypto.getRandomValues(new Uint8Array(32))), state = encode(crypto.getRandomValues(new Uint8Array(24)));
    const challenge = encode(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))));
    if (generation !== authGeneration) throw new Error('Sign-in changed. Sign in again.');
    const redirectUri = location.origin + location.pathname;
    sessionStorage.setItem(requestKey, JSON.stringify({ verifier, state, redirectUri, createdAt: Date.now() }));
    const url = new URL(`${this.config.issuer}/protocol/openid-connect/auth`);
    url.search = new URLSearchParams({ client_id: this.config.clientId, response_type: 'code', scope: 'openid profile email', redirect_uri: redirectUri, state, code_challenge: challenge, code_challenge_method: 'S256', prompt: 'select_account' }).toString();
    location.assign(url);
  }
  async token(): Promise<string> {
    if (!this.config.enabled) return 'demo-local';
    const snapshot = sessionStorage.getItem(tokenKey), tokens = this.read();
    if (!snapshot || !tokens) throw new Error('Sign in to use your city accounts.');
    if (tokens.expiresAt > Date.now() + 30000) return tokens.access_token;
    if (!tokens.refresh_token) { this.clear(); throw new Error('Your session has expired. Sign in again.'); }
    const binding = JSON.stringify([this.config.issuer, this.config.clientId]);
    let active = refreshExchange;
    if (active && active.generation === authGeneration && active.snapshot === snapshot && active.binding !== binding) throw new Error('Sign-in configuration changed. Sign in again.');
    if (!active || active.generation !== authGeneration || active.snapshot !== snapshot) {
      const generation = authGeneration;
      const promise = this.exchange(new URLSearchParams({ grant_type: 'refresh_token', client_id: this.config.clientId, refresh_token: tokens.refresh_token }), generation, snapshot).catch(error => {
        if (generation === authGeneration && sessionStorage.getItem(tokenKey) === snapshot) this.clear();
        throw error;
      });
      active = { generation, snapshot, binding, promise }; refreshExchange = active;
    }
    try { return await active.promise; } finally { if (refreshExchange === active) refreshExchange = undefined; }
  }
  clear() { authGeneration++; refreshExchange = undefined; loginExchange = undefined; sessionStorage.removeItem(tokenKey); sessionStorage.removeItem(requestKey); localStorage.removeItem('KEYCLOAK_ACCESS_TOKEN'); }
  logout() {
    const tokens = this.read(); this.clear();
    const url = new URL(`${this.config.issuer}/protocol/openid-connect/logout`);
    url.search = new URLSearchParams({ client_id: this.config.clientId, post_logout_redirect_uri: location.origin + location.pathname, ...(tokens?.id_token ? { id_token_hint: tokens.id_token } : {}) }).toString();
    location.assign(url);
  }
}
