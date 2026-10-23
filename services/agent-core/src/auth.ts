/**
 * Keycloak access-token verification.
 * Production uses RS256 JWKS validation. Demo identities are explicitly opt-in
 * and NEVER accepted in NODE_ENV=production.
 */
import { createPublicKey, verify as verifySignature } from 'node:crypto';

export interface KeycloakUserClaims {
  sub: string;
  preferred_username: string;
  email: string;
  name: string;
  roles: string[];
  vipTier: string;
  isVip: boolean;
}
export interface AuthVerificationResult {
  authenticated: boolean;
  user?: KeycloakUserClaims;
  error?: string;
  statusCode?: number;
}
type JwtHeader = { alg?: string; kid?: string; typ?: string };
type JsonWebKeySet = { keys: Array<JsonWebKey & { kid?: string; use?: string; alg?: string }> };
let cachedKeys: JsonWebKeySet | undefined;
let keysUntil = 0;

export function isDemoAuthEnabled(): boolean {
  return process.env.DEMO_AUTH === 'true' && process.env.NODE_ENV !== 'production';
}
function denied(message: string): AuthVerificationResult {
  return { authenticated: false, error: message, statusCode: 401 };
}
function parseJwtPart(part: string): Record<string, any> {
  if (!/^[a-zA-Z0-9_-]+$/.test(part)) throw new Error('Malformed JWT encoding');
  return JSON.parse(Buffer.from(part, 'base64url').toString('utf8'));
}
async function getPublicKey(kid: string, issuer: string): Promise<ReturnType<typeof createPublicKey>> {
  if (!cachedKeys || Date.now() > keysUntil || !cachedKeys.keys.some(k => k.kid === kid)) {
    const url = process.env.KEYCLOAK_JWKS_URL ||
      issuer.replace(/\/$/, '') + '/protocol/openid-connect/certs';
    if (process.env.NODE_ENV === 'production' && !url.startsWith('https://')) {
      throw new Error('HTTPS is required for production JWKS retrieval');
    }
    const response = await fetch(url, { signal: AbortSignal.timeout(5000) });
    if (!response.ok) throw new Error('Unable to retrieve Keycloak signing keys');
    const data: unknown = await response.json();
    if (!data || typeof data !== 'object' || !Array.isArray((data as JsonWebKeySet).keys)) {
      throw new Error('Invalid JWKS response');
    }
    cachedKeys = data as JsonWebKeySet;
    keysUntil = Date.now() + 300_000;
  }
  const jwk = cachedKeys!.keys.find(k =>
    k.kid === kid && k.kty === 'RSA' && (!k.use || k.use === 'sig') && (!k.alg || k.alg === 'RS256')
  );
  if (!jwk) throw new Error('Signing key unavailable');
  return createPublicKey({ key: jwk, format: 'jwk' });
}

/** Rejects unsigned, forged, wrong-issuer, wrong-audience and expired tokens. */
export async function verifyKeycloakToken(authHeader: string | undefined): Promise<AuthVerificationResult> {
  if (isDemoAuthEnabled() && (!authHeader || authHeader === 'Bearer demo-local')) {
    return { authenticated: true, user: {
      sub: 'local-demo-user', preferred_username: 'demo', email: '',
      name: 'Demo User', roles: ['superapp-user'], vipTier: 'Standard', isVip: false,
    }};
  }
  if (!authHeader) return denied('Missing Authorization header');
  if (!authHeader.startsWith('Bearer ')) return denied('Invalid Authorization format. Expected Bearer <token>');
  const token = authHeader.slice(7).trim();
  const parts = token.split('.');
  if (parts.length !== 3 || parts.some(x => !x)) return denied('Malformed Keycloak JWT token');
  try {
    const header = parseJwtPart(parts[0]) as JwtHeader;
    const payload = parseJwtPart(parts[1]);
    if (header.alg !== 'RS256' || !header.kid) return denied('Unsupported token signing algorithm');
    const issuer = process.env.KEYCLOAK_ISSUER;
    if (!issuer || payload.iss !== issuer) return denied('Invalid token issuer');
    const audience = process.env.KEYCLOAK_AUDIENCE || 'agent-core';
    const audiences = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
    if (!audiences.includes(audience)) return denied('Invalid token audience');
    const now = Math.floor(Date.now() / 1000);
    if (typeof payload.exp !== 'number' || payload.exp <= now) return denied('Keycloak JWT token has expired');
    if (typeof payload.nbf === 'number' && payload.nbf > now) return denied('Token not yet valid');
    if (typeof payload.iat === 'number' && payload.iat > now + 60) return denied('Invalid token issue time');
    if (typeof payload.sub !== 'string' || !payload.sub) return denied('Missing subject');
    const publicKey = await getPublicKey(header.kid, issuer);
    if (!verifySignature('RSA-SHA256', Buffer.from(parts[0] + '.' + parts[1]), publicKey,
      Buffer.from(parts[2], 'base64url'))) return denied('Invalid JWT signature');
    const roles: string[] = Array.isArray(payload.realm_access?.roles) ? payload.realm_access.roles : [];
    const isVip = roles.includes('superapp-vip');
    return { authenticated: true, user: {
      sub: payload.sub,
      preferred_username: String(payload.preferred_username || payload.sub),
      email: String(payload.email || ''),
      name: String(payload.name || payload.preferred_username || payload.sub),
      roles, vipTier: isVip ? 'Gold VIP' : 'Standard', isVip,
    }};
  } catch {
    return denied('Invalid or unverifiable Keycloak access token');
  }
}
