import { tracedFetch as fetch } from './observability.ts';
/** UI/MCP facade only: this process has no issuer keys or grant database. */
export async function proxyDelegation(method: string, path: string, body: unknown, authorization?: string) {
  if (!path.startsWith('/api/delegation')) return undefined;
  if (process.env.DELEGATION_ENABLED !== 'true') return { status: 404, data: { success: false, code: 'DELEGATION_DISABLED' } };
  // Internal authorization and key endpoints are never exposed through the conversational facade.
  if (!/^\/api\/delegation\/grants(?:\/[a-f0-9-]{36}(?:\/(?:execute|history|operations|narrow))?)?$/.test(path)) return { status: 404, data: { success: false, code: 'NOT_FOUND' } };
  try {
    const response = await fetch(new URL(path, process.env.DELEGATION_AUTHORITY_URL || 'http://localhost:4010'), { method, redirect: 'error', signal: AbortSignal.timeout(14000), headers: { Authorization: authorization || '', 'Content-Type': 'application/json' }, ...(method === 'POST' ? { body: JSON.stringify(body) } : {}) });
    return { status: response.status, data: await response.json() };
  } catch { return { status: 503, data: { success: false, code: 'DELEGATION_UNAVAILABLE' } }; }
}
