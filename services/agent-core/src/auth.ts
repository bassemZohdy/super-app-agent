/**
 * Keycloak access-token verification.
 * Production uses RS256 JWKS validation. Demo identities are explicitly opt-in
 * and NEVER accepted in NODE_ENV=production.
 */
import { verifyJwt } from '../../../packages/backend-kit/src/jwt.ts';

export interface KeycloakUserClaims {
  sub: string;
  preferred_username: string;
  email: string;
  name: string;
  roles: string[];
  vipTier: string;
  isVip: boolean;
  expiresAt?: number;
}
export interface AuthVerificationResult {
  authenticated: boolean;
  user?: KeycloakUserClaims;
  error?: string;
  statusCode?: number;
}
export function isDemoAuthEnabled(): boolean {
  return process.env.DEMO_AUTH === 'true' && process.env.NODE_ENV !== 'production';
}
function denied(message: string): AuthVerificationResult {
  return { authenticated: false, error: message, statusCode: 401 };
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
  const parts = authHeader.slice(7).split('.');
  if (parts.length !== 3 || parts.some(part => !part)) return denied('Malformed Keycloak JWT token');
  try {
    const payload = await verifyJwt(authHeader, process.env.KEYCLOAK_AUDIENCE || 'agent-core');
    if ((process.env.PROVIDER_INTEGRATION === 'true' || process.env.NODE_ENV === 'production') &&
        (!payload.realm_access?.roles?.includes('superapp-user') || String(payload.preferred_username || '').startsWith('service-account-'))) {
      return denied('A signed-in user permission is required');
    }
    const roles: string[] = Array.isArray(payload.realm_access?.roles) ? payload.realm_access.roles : [];
    const isVip = roles.includes('superapp-vip');
    return { authenticated: true, user: {
      sub: payload.sub, expiresAt: payload.exp * 1000,
      preferred_username: String(payload.preferred_username || payload.sub),
      email: String(payload.email || ''),
      name: String(payload.name || payload.preferred_username || payload.sub),
      roles, vipTier: isVip ? 'Gold VIP' : 'Standard', isVip,
    }};
  } catch {
    return denied('Invalid or unverifiable Keycloak access token');
  }
}

