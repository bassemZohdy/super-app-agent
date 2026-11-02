import { expect, isolatedTest as test } from '../stack.ts';
import { ProviderClient, UpstreamError } from '../../../packages/backend-kit/src/provider-client.ts';
import { redisSessions } from '../../../services/agent-core/src/session-store.ts';

test('the reviewed composite identity is saved before dispatch and survives a lost wallet response', async ({ residentApi, stack }) => {
  const sessionId = `composite_${crypto.randomUUID()}`;
  const endpoint = `http://localhost:${stack.corePort}`;
  const send = async (path: string, body: Record<string, unknown>) => {
    const response = await fetch(`${endpoint}${path}`, { method: 'POST', headers: { Authorization: `Bearer ${residentApi.token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ ...body, sessionId, accountId: residentApi.accountId }) });
    return { status: response.status, data: await response.json() };
  };
  const review = await send('/api/a2ui/intent', { text: 'Book a ride downtown and order pizza, pay with my wallet' });
  expect(review.status).toBe(200);
  const surface = review.data.surface as { revision: string; view: { children: Array<{ onEvents?: Array<{ payload: Record<string, unknown> }> }> } };
  const binding = surface.view.children.flatMap(child => child.onEvents ?? []).find(event => event.payload.action === 'confirm_composite_checkout')!.payload;
  const expectedOperation = `${surface.revision}:confirm_composite_checkout`;
  const original = ProviderClient.prototype.call;
  let seen = false;
  ProviderClient.prototype.call = async function (provider, actor, method, path, body, key) {
    if (provider === 'payments' && method === 'POST' && path === '/charges') {
      const saved = await redisSessions()!.read(sessionId, actor.sub);
      expect(saved.state.compositeAttempt).toEqual({ operationId: expectedOperation, terms: binding });
      expect(saved.state.reconciliation?.outcome).toBe('UNKNOWN');
      seen = true;
      await original.call(this, provider, actor, method, path, body, key);
      throw new UpstreamError(503, 'PROVIDER_OUTCOME_UNKNOWN', 'Simulated lost response');
    }
    return original.call(this, provider, actor, method, path, body, key);
  };
  try {
    const result = await send('/api/a2ui/action', { surfaceRevision: surface.revision, action: 'confirm_composite_checkout', payload: binding });
    expect(seen).toBe(true);
    expect(result.data.outcome).toBe('UNKNOWN');
    const claims = JSON.parse(Buffer.from(residentApi.token.split('.')[1], 'base64url').toString()) as { sub: string };
    const saved = await redisSessions()!.read(sessionId, claims.sub);
    expect(saved.state.compositeAttempt).toEqual({ operationId: expectedOperation, terms: binding });
    expect(saved.state.reconciliation?.outcome).toBe('UNKNOWN');
    const sessionResponse = await fetch(`${endpoint}/api/sessions/${sessionId}`, { headers: { Authorization: `Bearer ${residentApi.token}` } });
    const sessionData = await sessionResponse.json() as { compositeAttempt: { operationId: string; terms: Record<string, unknown> } };
    expect(sessionResponse.status).toBe(200);
    expect(sessionData.compositeAttempt).toEqual({ operationId: expectedOperation, terms: binding });
    const remove = await fetch(`${endpoint}/api/sessions/${sessionId}`, { method: 'DELETE', headers: { Authorization: `Bearer ${residentApi.token}` } });
    expect(remove.status).toBe(409);
    expect((await redisSessions()!.read(sessionId, claims.sub)).state.compositeAttempt).toEqual({ operationId: expectedOperation, terms: binding });
    const inspected = await fetch(`http://localhost:${stack.corePort + 3}/wallet/operations/${encodeURIComponent(expectedOperation)}`, { headers: { Authorization: `Bearer ${residentApi.token}`, 'X-Account-Id': residentApi.accountId } });
    expect(inspected.status).toBe(200);
    expect((await send('/api/a2ui/intent', { text: 'Book a ride downtown and order pizza, pay with my wallet' })).data.code).toBe('RECONCILIATION_REQUIRED');
  } finally { ProviderClient.prototype.call = original; }
});

test('a pre-dispatch composite refusal clears the saved attempt without moving funds', async ({ residentApi, stack }) => {
  const sessionId = `composite_${crypto.randomUUID()}`, endpoint = `http://localhost:${stack.corePort}`;
  const send = async (path: string, body: Record<string, unknown>) => {
    const response = await fetch(`${endpoint}${path}`, { method: 'POST', headers: { Authorization: `Bearer ${residentApi.token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ ...body, sessionId, accountId: residentApi.accountId }) });
    return { status: response.status, data: await response.json() };
  };
  const review = await send('/api/a2ui/intent', { text: 'Book a ride downtown and order pizza, pay with my wallet' });
  expect(review.status).toBe(200);
  const surface = review.data.surface as { revision: string; view: { children: Array<{ onEvents?: Array<{ payload: Record<string, unknown> }> }> } };
  const binding = surface.view.children.flatMap(child => child.onEvents ?? []).find(event => event.payload.action === 'confirm_composite_checkout')!.payload;
  const before = (await residentApi.call('overview')).data.wallet.balanceMinor;
  const original = ProviderClient.prototype.call;
  ProviderClient.prototype.call = async function (provider, actor, method, path, body, key) {
    const result = await original.call(this, provider, actor, method, path, body, key);
    if (provider === 'rta' && method === 'GET' && path.startsWith('/rides/options')) {
      return { ...result, options: result.options.map((option: { id: string; fare: number }) => option.id === binding.driverId ? { ...option, fare: option.fare + 1 } : option) };
    }
    return result;
  };
  try {
    const result = await send('/api/a2ui/action', { surfaceRevision: surface.revision, action: 'confirm_composite_checkout', payload: binding });
    expect(result.status).toBe(409);
    expect((await residentApi.call('overview')).data.wallet.balanceMinor).toBe(before);
    const claims = JSON.parse(Buffer.from(residentApi.token.split('.')[1], 'base64url').toString()) as { sub: string };
    const saved = await redisSessions()!.read(sessionId, claims.sub);
    expect(saved.state.compositeAttempt).toBeUndefined();
    expect(saved.state.reconciliation).toBeUndefined();
  } finally { ProviderClient.prototype.call = original; }
});
