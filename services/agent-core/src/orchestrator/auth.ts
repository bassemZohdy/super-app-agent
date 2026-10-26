import { timingSafeEqual } from 'node:crypto';
import { z } from 'zod/v4';
import { verifyJwt } from '../../../../packages/backend-kit/src/jwt.ts';
import { AgentError, Id, type Principal } from './contracts.ts';

export interface Authenticator { authenticate(authorization: string | undefined): Promise<Principal> }
export const TestIdentity = z.object({ token: z.string().min(32).max(200), subject: Id, permissions: z.array(z.enum(['fines:read', 'fines:pay'])).max(2), expiresAt: z.number().int().positive() }).strict();
export type TestIdentity = z.infer<typeof TestIdentity>;
export function equalSecret(a: string, b: string): boolean {
  const left = Buffer.from(a), right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}
/** Isolated opaque-token test authority, with no default identity or permission. */
export class TestAuthenticator implements Authenticator {
  private readonly identities: TestIdentity[]; private readonly workload: string;
  constructor(identities: TestIdentity[], workload: string) {
    this.identities = identities; this.workload = workload;
    if (process.env.NODE_ENV === 'production') throw new AgentError('TEST_AUTH_FORBIDDEN');
    z.array(TestIdentity).min(1).max(20).parse(identities);
  }
  async authenticate(header: string | undefined): Promise<Principal> {
    if (process.env.NODE_ENV === 'production') throw new AgentError('TEST_AUTH_FORBIDDEN', 401);
    const identity = this.identities.find(item => equalSecret(header || '', `Bearer ${item.token}`));
    if (!identity || identity.expiresAt <= Date.now()) throw new AgentError('AUTHENTICATION_REQUIRED', 401);
    return { subject: identity.subject, workload: this.workload, permissions: [...identity.permissions], expiresAt: identity.expiresAt };
  }
}
export class KeycloakAuthenticator implements Authenticator {
  private readonly workload: string;
  constructor(workload: string) { this.workload = workload; }
  async authenticate(header: string | undefined): Promise<Principal> {
    try {
      const claims = await verifyJwt(header, process.env.KEYCLOAK_AUDIENCE || 'agent-core');
      if (String(claims.preferred_username || '').startsWith('service-account-')) throw new Error('Human subject required');
      return { subject: claims.sub, workload: this.workload, permissions: String(claims.scope || '').split(/\s+/).filter(scope => ['fines:read', 'fines:pay'].includes(scope)), expiresAt: claims.exp * 1000 };
    } catch { throw new AgentError('AUTHENTICATION_REQUIRED', 401); }
  }
}
