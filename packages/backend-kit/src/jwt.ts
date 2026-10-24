import { tracedFetch as fetch } from './observability.ts';
import { createPublicKey, verify, type JsonWebKey } from 'node:crypto';

export type JwtClaims = Record<string, any> & { sub: string; exp: number; iss: string };
type SigningKey = JsonWebKey & { kid: string; alg?: string; use?: string };
type Entry = { keys: SigningKey[]; until: number; refreshAfter: number; pending?: Promise<void> };
const cache = new Map<string, Entry>();
const MAX_TOKEN_BYTES = 16384;
const MAX_LIFETIME_SECONDS = 86400;
const REFRESH_INTERVAL_MS = 5000;

function record(value: unknown): value is Record<string, any> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
function part(raw: string, max: number) {
  if (raw.length > max || !/^[A-Za-z0-9_-]+$/.test(raw)) throw new Error('Invalid bearer encoding');
  const parsed: unknown = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
  if (!record(parsed) || Object.keys(parsed).length > 100) throw new Error('Invalid bearer object');
  return parsed;
}
async function boundedJson(response: Response): Promise<unknown> {
  if (!response.body) throw new Error('Empty identity response');
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = []; let bytes = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read(); if (done) break;
      bytes += value.byteLength;
      if (bytes > 65536) { await reader.cancel(); throw new Error('Identity response exceeds limit'); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}
function endpoint(raw: string) {
  const url = new URL(raw);
  if (url.username || url.password || !['http:', 'https:'].includes(url.protocol) ||
      (process.env.NODE_ENV === 'production' && url.protocol !== 'https:')) throw new Error('Invalid identity endpoint');
  return url.href;
}
async function signingKey(issuer: string, url: string, kid: string) {
  const identity = `${issuer}\n${url}`;
  let entry = cache.get(identity);
  if (!entry) {
    if (cache.size >= 16) {
      const idle = [...cache].find(([, item]) => !item.pending);
      if (!idle) throw new Error('Identity cache is busy');
      cache.delete(idle[0]);
    }
    entry = { keys: [], until: 0, refreshAfter: 0 }; cache.set(identity, entry);
  }
  const now = Date.now();
  if (entry.until <= now || !entry.keys.some(key => key.kid === kid)) {
    if (!entry.pending && now >= entry.refreshAfter) {
      entry.refreshAfter = now + REFRESH_INTERVAL_MS;
      const target = entry;
      target.pending = (async () => {
        const response = await fetch(url, { signal: AbortSignal.timeout(5000), redirect: 'error' });
        if (!response.ok) throw new Error('Identity provider unavailable');
        const data = await boundedJson(response);
        if (!record(data) || !Array.isArray(data.keys) || !data.keys.length || data.keys.length > 50) throw new Error('Invalid signing keys');
        const keys = data.keys.filter((key: unknown): key is SigningKey => record(key) && key.kty === 'RSA' &&
          typeof key.kid === 'string' && key.kid.length > 0 && key.kid.length <= 128 &&
          typeof key.n === 'string' && key.n.length <= 2048 && typeof key.e === 'string' && key.e.length <= 16 &&
          (!key.use || key.use === 'sig') && (!key.alg || key.alg === 'RS256'));
        if (!keys.length || new Set(keys.map(key => key.kid)).size !== keys.length) throw new Error('Invalid signing keys');
        target.keys = keys; target.until = Date.now() + 300000;
      })();
      void target.pending.finally(() => { target.pending = undefined; }).catch(() => {});
    }
    if (entry.pending) await entry.pending;
  }
  if (entry.until <= Date.now()) throw new Error('Signing keys unavailable');
  const key = entry.keys.find(key => key.kid === kid);
  if (!key) throw new Error('Signing key unavailable');
  return createPublicKey({ key, format: 'jwk' });
}

async function checkOnline(token: string, claims: JwtClaims) {
  const configured = process.env.KEYCLOAK_INTROSPECTION_URL;
  if (!configured && process.env.NODE_ENV !== 'production') return;
  const clientId = process.env.KEYCLOAK_INTROSPECTION_CLIENT_ID;
  const secret = process.env.KEYCLOAK_INTROSPECTION_CLIENT_SECRET;
  if (!clientId || !secret) throw new Error('Online identity verification is not configured');
  const url = endpoint(configured || `${claims.iss}/protocol/openid-connect/token/introspect`);
  const response = await fetch(url, { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(5000),
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: clientId, client_secret: secret, token, token_type_hint: 'access_token' }),
  });
  if (!response.ok) throw new Error('Online identity verification unavailable');
  const result = await boundedJson(response);
  if (!record(result) || result.active !== true || (result.sub !== undefined && result.sub !== claims.sub)) throw new Error('Access token is inactive');
}

/** One bounded verifier for core, application and provider access tokens. */
export async function verifyJwt(authorization: string | undefined, audience: string): Promise<JwtClaims> {
  if (!authorization?.startsWith('Bearer ') || Buffer.byteLength(authorization) > MAX_TOKEN_BYTES) throw new Error('Bearer authentication required');
  const token = authorization.slice(7);
  const parts = token.split('.');
  if (parts.length !== 3 || parts[2].length > 2048 || !/^[A-Za-z0-9_-]+$/.test(parts[2])) throw new Error('Invalid bearer token');
  const header = part(parts[0], 2048), claims = part(parts[1], 12000);
  const issuer = process.env.KEYCLOAK_ISSUER;
  const now = Math.floor(Date.now() / 1000);
  const audiences = typeof claims.aud === 'string' ? [claims.aud] : claims.aud;
  if (header.alg !== 'RS256' || typeof header.kid !== 'string' || !header.kid || header.kid.length > 128 ||
      (header.typ !== undefined && !['JWT', 'at+jwt'].includes(header.typ)) || header.jku !== undefined || header.jwk !== undefined ||
      !issuer || claims.iss !== issuer || claims.typ !== 'Bearer' ||
      !Array.isArray(audiences) || audiences.length > 10 || audiences.some((item: unknown) => typeof item !== 'string') || !audiences.includes(audience) ||
      typeof claims.sub !== 'string' || !claims.sub || claims.sub.length > 256 ||
      !Number.isSafeInteger(claims.exp) || claims.exp <= now || claims.exp > now + MAX_LIFETIME_SECONDS ||
      (claims.nbf !== undefined && (!Number.isSafeInteger(claims.nbf) || claims.nbf > now)) ||
      (claims.iat !== undefined && (!Number.isSafeInteger(claims.iat) || claims.iat > now + 60 || claims.iat > claims.exp)) ||
      (claims.scope !== undefined && (typeof claims.scope !== 'string' || claims.scope.length > 2048)) ||
      (claims.realm_access !== undefined && (!record(claims.realm_access) || !Array.isArray(claims.realm_access.roles) ||
        claims.realm_access.roles.length > 100 || claims.realm_access.roles.some((role: unknown) => typeof role !== 'string' || role.length > 128)))) throw new Error('Invalid bearer claims');
  const requiredScopes = (process.env.KEYCLOAK_REQUIRED_SCOPES || '').split(/\s+/).filter(Boolean);
  const scopes = new Set((claims.scope || '').split(/\s+/));
  if (requiredScopes.some(scope => !scopes.has(scope))) throw new Error('Required permission missing');
  const url = endpoint(process.env.KEYCLOAK_JWKS_URL || `${issuer}/protocol/openid-connect/certs`);
  const key = await signingKey(issuer, url, header.kid);
  if (!verify('RSA-SHA256', Buffer.from(`${parts[0]}.${parts[1]}`), key, Buffer.from(parts[2], 'base64url'))) throw new Error('Invalid bearer signature');
  await checkOnline(token, claims as JwtClaims);
  return claims as JwtClaims;
}
