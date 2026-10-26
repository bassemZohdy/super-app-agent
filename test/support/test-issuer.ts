/** TEST-ONLY OIDC issuer (P2-10). It drives the real verification and token-client code over HTTP in milliseconds,
 *  with no Docker. It is NOT Keycloak evidence: the real-Keycloak suites stay the release gate. Ephemeral RSA keys,
 *  authorization code with mandatory S256 PKCE and single-use codes, refresh rotation with reuse revocation,
 *  client credentials, and the RFC 7523 jwt-bearer grant with assertion-reuse refusal. Listens on loopback only. */
import { createHash, createPublicKey, generateKeyPairSync, randomBytes, randomUUID, sign, timingSafeEqual, verify, type JsonWebKey, type KeyObject } from 'node:crypto';
import http from 'node:http';
import type { AddressInfo } from 'node:net';

export type TestClient = { secret?: string; redirectUris?: string[]; clientKey?: JsonWebKey; roles?: string[]; audience?: string[]; grants: string[] };
export type TestUser = { sub: string; username: string; roles: string[] };
export type TestIssuerOptions = {
  clients: Record<string, TestClient>; users?: Record<string, TestUser>;
  /** Issuers whose signed assertions the jwt-bearer grant accepts, with their public keys. */
  trustedIssuers?: Record<string, JsonWebKey[]>;
  now?: () => number; accessTtlSeconds?: number; codeTtlSeconds?: number;
};
export type TestIssuer = {
  issuer: string; jwksUrl: string; tokenUrl: string; authorizeUrl: string;
  /** Mint an access token directly, for negative cases (wrong audience, expired, unknown claims). */
  mint(claims?: Record<string, unknown>, header?: Record<string, unknown>): string;
  /** A token signed by a key this issuer does not publish. */
  mintForeign(claims?: Record<string, unknown>): string;
  close(): Promise<void>;
};

const b64 = (value: unknown) => Buffer.from(typeof value === 'string' ? value : JSON.stringify(value)).toString('base64url');
const s256 = (verifier: string) => createHash('sha256').update(verifier).digest('base64url');
const same = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

function signJwt(key: KeyObject, kid: string, claims: Record<string, unknown>, header: Record<string, unknown> = {}) {
  const head = b64({ alg: 'RS256', typ: 'JWT', kid, ...header }), body = b64(claims);
  return `${head}.${body}.${sign('RSA-SHA256', Buffer.from(`${head}.${body}`), key).toString('base64url')}`;
}

/** Verifies an RS256 JWT against a public JWK and returns its claims, or undefined for any defect. */
function verifySigned(token: string, keys: JsonWebKey[]): Record<string, any> | undefined {
  const parts = token.split('.');
  if (parts.length !== 3) return undefined;
  try {
    const header = JSON.parse(Buffer.from(parts[0], 'base64url').toString()), claims = JSON.parse(Buffer.from(parts[1], 'base64url').toString());
    if (header.alg !== 'RS256') return undefined;
    const ok = keys.some(jwk => verify('RSA-SHA256', Buffer.from(`${parts[0]}.${parts[1]}`), createPublicKey({ key: jwk, format: 'jwk' }), Buffer.from(parts[2], 'base64url')));
    return ok ? claims : undefined;
  } catch { return undefined; }
}

export async function startTestIssuer(options: TestIssuerOptions): Promise<TestIssuer> {
  const now = options.now ?? (() => Date.now()), seconds = () => Math.floor(now() / 1000);
  const accessTtl = options.accessTtlSeconds ?? 300, codeTtl = options.codeTtlSeconds ?? 60;
  const pair = generateKeyPairSync('rsa', { modulusLength: 2048 }), foreign = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const kid = `test-${randomBytes(4).toString('hex')}`;
  const jwk = { ...pair.publicKey.export({ format: 'jwk' }), kid, use: 'sig', alg: 'RS256' };
  const codes = new Map<string, { clientId: string; redirectUri: string; challenge: string; user: TestUser; scope: string; until: number }>();
  const refresh = new Map<string, { family: string; clientId: string; user: TestUser; scope: string; used: boolean }>();
  const revokedFamilies = new Set<string>(), usedAssertions = new Set<string>();
  let base = '';

  const access = (client: string, sub: string, extra: Record<string, unknown>) => signJwt(pair.privateKey, kid, {
    iss: base, aud: options.clients[client]?.audience ?? ['agent-core'], sub, azp: client, typ: 'Bearer', iat: seconds(), exp: seconds() + accessTtl, jti: randomUUID(), ...extra });
  const oauthError = (res: http.ServerResponse, status: number, error: string, description = '') => {
    res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }).end(JSON.stringify({ error, error_description: description }));
  };
  const tokens = (client: string, user: TestUser, scope: string, withRefresh: boolean, family = randomUUID()) => {
    const body: Record<string, unknown> = { token_type: 'Bearer', expires_in: accessTtl, scope,
      access_token: access(client, user.sub, { scope, preferred_username: user.username, realm_access: { roles: user.roles } }) };
    if (withRefresh) { const token = randomBytes(24).toString('base64url'); refresh.set(token, { family, clientId: client, user, scope, used: false }); body.refresh_token = token; }
    return body;
  };

  const handle = async (req: http.IncomingMessage, res: http.ServerResponse) => {
    const url = new URL(req.url || '/', base), path = url.pathname.replace('/realms/test', '');
    if (req.method === 'GET' && path === '/.well-known/openid-configuration')
      return void res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ issuer: base, jwks_uri: `${base}/certs`, token_endpoint: `${base}/token`, authorization_endpoint: `${base}/authorize`, code_challenge_methods_supported: ['S256'] }));
    if (req.method === 'GET' && path === '/certs') return void res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ keys: [jwk] }));

    if (req.method === 'GET' && path === '/authorize') {
      const q = url.searchParams, client = options.clients[q.get('client_id') || ''], redirect = q.get('redirect_uri') || '';
      // An unregistered client or redirect is never redirected to: the error stays on the issuer.
      if (!client || !client.redirectUris?.includes(redirect)) return oauthError(res, 400, 'invalid_request', 'unregistered client or redirect_uri');
      const back = (params: Record<string, string>) => { const target = new URL(redirect); for (const [k, v] of Object.entries({ ...params, ...(q.get('state') ? { state: q.get('state')! } : {}) })) target.searchParams.set(k, v); res.writeHead(302, { Location: target.href }).end(); };
      const user = options.users?.[q.get('login_hint') || ''];
      if (q.get('response_type') !== 'code') return back({ error: 'unsupported_response_type' });
      if (!q.get('state')) return back({ error: 'invalid_request', error_description: 'state required' });
      if (q.get('code_challenge_method') !== 'S256' || !/^[A-Za-z0-9_-]{43}$/.test(q.get('code_challenge') || '')) return back({ error: 'invalid_request', error_description: 'S256 PKCE required' });
      if (!user) return back({ error: 'access_denied' });
      const code = randomBytes(24).toString('base64url');
      codes.set(code, { clientId: q.get('client_id')!, redirectUri: redirect, challenge: q.get('code_challenge')!, user, scope: q.get('scope') || 'openid', until: now() + codeTtl * 1000 });
      return back({ code });
    }

    if (req.method === 'POST' && path === '/token') {
      const chunks: Buffer[] = []; let size = 0;
      for await (const chunk of req) { size += chunk.length; if (size > 16384) return oauthError(res, 413, 'invalid_request', 'body too large'); chunks.push(chunk); }
      const form = new URLSearchParams(Buffer.concat(chunks).toString()), grant = form.get('grant_type') || '', clientId = form.get('client_id') || '', client = options.clients[clientId];
      if (!client || !client.grants.includes(grant)) return oauthError(res, 400, client ? 'unauthorized_client' : 'invalid_client');
      const authenticated = () => {
        if (client.secret !== undefined) return same(form.get('client_secret') || '', client.secret);
        if (client.clientKey) {
          const claims = form.get('client_assertion_type') === 'urn:ietf:params:oauth:client-assertion-type:jwt-bearer' ? verifySigned(form.get('client_assertion') || '', [client.clientKey]) : undefined;
          return !!claims && claims.iss === clientId && claims.sub === clientId && [claims.aud].flat().includes(base) && claims.exp > seconds();
        }
        return true;
      };
      if (!authenticated()) return oauthError(res, 401, 'invalid_client');

      if (grant === 'authorization_code') {
        const code = codes.get(form.get('code') || '');
        codes.delete(form.get('code') || '');
        if (!code || code.until <= now() || code.clientId !== clientId || code.redirectUri !== form.get('redirect_uri') || !same(s256(form.get('code_verifier') || ''), code.challenge))
          return oauthError(res, 400, 'invalid_grant', 'code is invalid, used, expired or the verifier does not match');
        return void res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }).end(JSON.stringify(tokens(clientId, code.user, code.scope, true)));
      }
      if (grant === 'refresh_token') {
        const record = refresh.get(form.get('refresh_token') || '');
        if (!record || record.clientId !== clientId || revokedFamilies.has(record.family)) return oauthError(res, 400, 'invalid_grant');
        if (record.used) { revokedFamilies.add(record.family); return oauthError(res, 400, 'invalid_grant', 'refresh token reuse revokes the session'); }
        record.used = true;
        return void res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }).end(JSON.stringify(tokens(clientId, record.user, record.scope, true, record.family)));
      }
      if (grant === 'client_credentials') {
        const body = { token_type: 'Bearer', expires_in: accessTtl, scope: form.get('scope') || '', access_token: access(clientId, `service-account-${clientId}`, { scope: form.get('scope') || '', preferred_username: `service-account-${clientId}`, realm_access: { roles: client.roles ?? [] } }) };
        return void res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }).end(JSON.stringify(body));
      }
      if (grant === 'urn:ietf:params:oauth:grant-type:jwt-bearer') {
        const raw = form.get('assertion') || '', unverified = (() => { try { return JSON.parse(Buffer.from(raw.split('.')[1] || '', 'base64url').toString()); } catch { return {}; } })();
        const keys = options.trustedIssuers?.[String(unverified.iss)] ?? [], claims = keys.length ? verifySigned(raw, keys) : undefined;
        if (!claims || ![claims.aud].flat().includes(base) || !(claims.exp > seconds()) || claims.iat > seconds() + 60 || typeof claims.sub !== 'string')
          return oauthError(res, 400, 'invalid_grant', 'assertion is not trusted, not for this issuer, expired or malformed');
        // Reuse is keyed on the assertion's own jti, or its signature when it has none, so a replay is refused either way.
        const id = typeof claims.jti === 'string' ? `${claims.iss}:${claims.jti}` : `sig:${raw.split('.')[2]}`;
        if (usedAssertions.has(id)) return oauthError(res, 400, 'invalid_grant', 'assertion already used');
        usedAssertions.add(id);
        const scope = form.get('scope') || String(claims.scope || ''), subject = claims.sub.replace(/^cityside:/, '');
        const body = { token_type: 'Bearer', expires_in: accessTtl, scope, access_token: access(clientId, subject, { scope, exp: Math.min(seconds() + accessTtl, claims.exp), aud: client.audience ?? ['provider-api'], preferred_username: subject, realm_access: { roles: client.roles ?? [] } }) };
        return void res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }).end(JSON.stringify(body));
      }
      return oauthError(res, 400, 'unsupported_grant_type');
    }
    res.writeHead(404).end();
  };
  const server = http.createServer((req, res) => { void handle(req, res).catch(() => { if (!res.headersSent) res.writeHead(500); res.end(); }); });
  await new Promise<void>(done => server.listen(0, '127.0.0.1', done));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/realms/test`;
  return {
    issuer: base, jwksUrl: `${base}/certs`, tokenUrl: `${base}/token`, authorizeUrl: `${base}/authorize`,
    mint: (claims = {}, header = {}) => signJwt(pair.privateKey, kid, { iss: base, aud: ['agent-core'], sub: 'test-user', typ: 'Bearer', iat: seconds(), exp: seconds() + accessTtl, ...claims }, header),
    mintForeign: (claims = {}) => signJwt(foreign.privateKey, kid, { iss: base, aud: ['agent-core'], sub: 'test-user', typ: 'Bearer', iat: seconds(), exp: seconds() + accessTtl, ...claims }),
    close: () => new Promise<void>(done => { server.closeAllConnections(); server.close(() => done()); }),
  };
}

/** The browser's authorization-code flow with S256 PKCE, run against the test issuer for one named user. */
export async function signInWithPkce(issuer: TestIssuer, clientId: string, redirectUri: string, loginHint: string): Promise<{ access_token: string; refresh_token?: string }> {
  const verifier = randomBytes(32).toString('base64url');
  const redirect = await fetch(`${issuer.authorizeUrl}?${new URLSearchParams({ response_type: 'code', client_id: clientId, redirect_uri: redirectUri, state: randomUUID(), code_challenge: s256(verifier), code_challenge_method: 'S256', login_hint: loginHint, scope: 'openid' })}`, { redirect: 'manual' });
  const code = new URL(redirect.headers.get('location') || 'http://invalid.test/').searchParams.get('code');
  if (!code) throw new Error('The test issuer did not issue a code.');
  const response = await fetch(issuer.tokenUrl, { method: 'POST', body: new URLSearchParams({ grant_type: 'authorization_code', client_id: clientId, code, redirect_uri: redirectUri, code_verifier: verifier }) });
  if (!response.ok) throw new Error(`The test issuer refused the code (${response.status}).`);
  return await response.json() as { access_token: string; refresh_token?: string };
}

/** A client_credentials token for a service client, from the test issuer. */
export async function serviceToken(issuer: TestIssuer, clientId: string, secret: string, scope = ''): Promise<string> {
  const response = await fetch(issuer.tokenUrl, { method: 'POST', body: new URLSearchParams({ grant_type: 'client_credentials', client_id: clientId, client_secret: secret, ...(scope ? { scope } : {}) }) });
  if (!response.ok) throw new Error(`The test issuer refused the client (${response.status}).`);
  return (await response.json() as { access_token: string }).access_token;
}
