import { tracedFetch as fetch } from './observability.ts';
/** Online grant check, separate from Keycloak token introspection; never positive-cache. */
export async function authorizeDelegatedProvider(authorization: string | undefined, provider: string, accountId: string, method: string, path: string, body: Record<string, unknown>) {
  const endpoint = new URL('/api/delegation/authorize', process.env.DELEGATION_AUTHORITY_URL || 'http://localhost:4010');
  if (process.env.NODE_ENV === 'production') throw new Error('Demo delegation cannot run in production');
  const response = await fetch(endpoint, { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(3000), headers: { Authorization: authorization || '', 'Content-Type': 'application/json' }, body: JSON.stringify({ provider, accountId, method, path, body }) });
  const data = await response.json() as { success: boolean; sub: string; actor: string };
  if (!response.ok || data.success !== true || typeof data.sub !== 'string') throw new Error('Current delegated authority denied');
  return data;
}

/** Consumes the broker-bound automation permit for exactly this operation; denial or outage means no execution. */
export async function authorizeAutomationPermit(authorization: string | undefined, operation: Record<string, unknown>) {
  if (process.env.NODE_ENV === 'production') throw new Error('Demo delegation cannot run in production');
  const endpoint = new URL('/api/delegation/automation/authorize', process.env.DELEGATION_AUTHORITY_URL || 'http://localhost:4010');
  const response = await fetch(endpoint, { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(3000), headers: { Authorization: authorization || '', 'Content-Type': 'application/json' }, body: JSON.stringify({ operation }) });
  const data = await response.json() as { success: boolean; permitId?: string };
  if (!response.ok || data.success !== true) throw new Error('Execution permit denied');
  return data;
}

export type AutomationSession = { permitId: string; executionId: string; operation: { accountId: string; payableId: string; executionId: string; runId: string } };
/** Reads what an already-admitted per-execution token may still do; a missing, closed or expired permit throws. */
export async function readAutomationSession(authorization: string | undefined): Promise<AutomationSession> {
  if (process.env.NODE_ENV === 'production') throw new Error('Demo delegation cannot run in production');
  const endpoint = new URL('/api/delegation/automation/session', process.env.DELEGATION_AUTHORITY_URL || 'http://localhost:4010');
  const response = await fetch(endpoint, { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(3000), headers: { Authorization: authorization || '', 'Content-Type': 'application/json' }, body: '{}' });
  const data = await response.json() as { success: boolean } & Partial<AutomationSession>;
  if (!response.ok || data.success !== true || !data.operation) throw new Error('No active execution session');
  return data as AutomationSession;
}
