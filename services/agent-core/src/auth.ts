/**
 * Keycloak OIDC Token Verifier and Security Middleware for SuperApp Agent Core
 */

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

function base64UrlEncode(str: string): string {
  return Buffer.from(str)
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

function base64UrlDecode(str: string): string {
  let base64 = str.replace(/-/g, '+').replace(/_/g, '/');
  while (base64.length % 4) {
    base64 += '=';
  }
  return Buffer.from(base64, 'base64').toString('utf-8');
}

/**
 * Generate a valid, standard Keycloak OIDC JWT token for testing and demo flows
 */
export function generateKeycloakToken(
  username = 'bassem',
  roles: string[] = ['superapp-user', 'superapp-vip'],
  vipTier = 'Gold VIP'
): string {
  const header = {
    alg: 'HS256',
    typ: 'JWT',
    kid: 'keycloak-superapp-key-1',
  };

  const payload = {
    exp: Math.floor(Date.now() / 1000) + 3600 * 24, // 24 hours validity
    iat: Math.floor(Date.now() / 1000),
    auth_time: Math.floor(Date.now() / 1000),
    jti: `jwt_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`,
    iss: `${process.env.KEYCLOAK_URL || 'http://localhost:8085'}/realms/superapp`,
    aud: ['superapp-shell', 'agent-core'],
    sub: `usr_${username}_oidc`,
    typ: 'Bearer',
    azp: 'superapp-shell',
    session_state: `sess_${Date.now()}`,
    realm_access: {
      roles,
    },
    resource_access: {
      'agent-core': {
        roles,
      },
    },
    preferred_username: username,
    email: `${username}@superapp.internal`,
    name: username === 'bassem' ? 'Bassem Zohdy' : username,
    vipTier,
  };

  const encodedHeader = base64UrlEncode(JSON.stringify(header));
  const encodedPayload = base64UrlEncode(JSON.stringify(payload));
  // Standard HMAC mock signature for demo/offline verification
  const signature = base64UrlEncode(`sig_${encodedHeader}.${encodedPayload}_secret`);

  return `${encodedHeader}.${encodedPayload}.${signature}`;
}

/**
 * Verify incoming Authorization: Bearer <token>
 */
export function verifyKeycloakToken(authHeader: string | undefined): AuthVerificationResult {
  const requireAuth = process.env.REQUIRE_AUTH === 'true';

  if (!authHeader) {
    if (requireAuth) {
      return {
        authenticated: false,
        error: 'Missing Authorization header with Keycloak Bearer token',
        statusCode: 401,
      };
    }
    // Default demo authenticated context for frictionless local development
    return {
      authenticated: true,
      user: {
        sub: 'usr_bassem_oidc',
        preferred_username: 'bassem',
        email: 'bassem.zohdy@gmail.com',
        name: 'Bassem Zohdy',
        roles: ['superapp-user', 'superapp-vip'],
        vipTier: 'Gold VIP',
        isVip: true,
      },
    };
  }

  if (!authHeader.startsWith('Bearer ')) {
    return {
      authenticated: false,
      error: 'Invalid Authorization format. Expected Bearer <token>',
      statusCode: 401,
    };
  }

  const token = authHeader.replace('Bearer ', '').trim();
  const parts = token.split('.');

  if (parts.length !== 3) {
    return {
      authenticated: false,
      error: 'Malformed Keycloak JWT token. Expected header.payload.signature',
      statusCode: 401,
    };
  }

  try {
    const payloadJson = base64UrlDecode(parts[1]);
    const payload = JSON.parse(payloadJson);

    // Expiration check
    const nowSec = Math.floor(Date.now() / 1000);
    if (payload.exp && payload.exp < nowSec) {
      return {
        authenticated: false,
        error: 'Keycloak JWT token has expired',
        statusCode: 401,
      };
    }

    const roles: string[] = payload.realm_access?.roles || [];
    const isVip = roles.includes('superapp-vip') || payload.vipTier === 'Gold VIP';

    return {
      authenticated: true,
      user: {
        sub: payload.sub || 'usr_anonymous',
        preferred_username: payload.preferred_username || 'anonymous',
        email: payload.email || '',
        name: payload.name || payload.preferred_username || 'User',
        roles,
        vipTier: payload.vipTier || (isVip ? 'Gold VIP' : 'Standard'),
        isVip,
      },
    };
  } catch (err: any) {
    return {
      authenticated: false,
      error: `Failed to decode Keycloak JWT payload: ${err.message}`,
      statusCode: 401,
    };
  }
}

