import { createPublicKey, verify, type JsonWebKey } from 'node:crypto';
export type JwtClaims = Record<string, any> & { sub: string; exp: number; iss: string };
const cache = new Map<string, { until: number; keys: Array<JsonWebKey & { kid?: string; alg?: string; use?: string }> }>();
export async function verifyJwt(authorization: string | undefined, audience: string): Promise<JwtClaims> {
  if (!authorization?.startsWith('Bearer ')) throw new Error('Bearer authentication required');
  const parts = authorization.slice(7).split('.');
  if (parts.length !== 3 || parts.some(p => !/^[A-Za-z0-9_-]+$/.test(p))) throw new Error('Invalid bearer token');
  const header = JSON.parse(Buffer.from(parts[0], 'base64url').toString());
  const claims = JSON.parse(Buffer.from(parts[1], 'base64url').toString());
  const issuer = process.env.KEYCLOAK_ISSUER;
  const now = Math.floor(Date.now() / 1000);
  if (header.alg !== 'RS256' || typeof header.kid !== 'string' || !issuer || claims.iss !== issuer ||
      !(Array.isArray(claims.aud) ? claims.aud : [claims.aud]).includes(audience) ||
      typeof claims.sub !== 'string' || !claims.sub || typeof claims.exp !== 'number' || claims.exp <= now ||
      (claims.nbf !== undefined && (typeof claims.nbf !== 'number' || claims.nbf > now)) ||
      (claims.iat !== undefined && (typeof claims.iat !== 'number' || claims.iat > now + 60))) throw new Error('Invalid bearer claims');
  const jwks = process.env.KEYCLOAK_JWKS_URL || `${issuer}/protocol/openid-connect/certs`;
  if (process.env.NODE_ENV === 'production' && new URL(jwks).protocol !== 'https:') throw new Error('HTTPS required');
  let entry = cache.get(jwks);
  if (!entry || entry.until < Date.now() || !entry.keys.some(k => k.kid === header.kid)) {
    const res = await fetch(jwks, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) throw new Error('Identity provider unavailable');
    const data = await res.json() as any;
    if (!Array.isArray(data.keys)) throw new Error('Invalid JWKS');
    entry = { until: Date.now() + 300_000, keys: data.keys }; cache.set(jwks, entry);
  }
  const key = entry.keys.find(k => k.kid === header.kid && k.kty === 'RSA' && (!k.alg || k.alg === 'RS256') && (!k.use || k.use === 'sig'));
  if (!key || !verify('RSA-SHA256', Buffer.from(`${parts[0]}.${parts[1]}`), createPublicKey({ key, format: 'jwk' }), Buffer.from(parts[2], 'base64url'))) throw new Error('Invalid bearer signature');
  return claims;
}
