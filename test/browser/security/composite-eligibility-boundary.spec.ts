import { expect, isolatedTest as test } from '../stack.ts';
import { ProviderClient, UpstreamError } from '../../../packages/backend-kit/src/provider-client.ts';

for (const boundary of ['application', 'provider'] as const) {
  test(`a changed approval permission stops continuation at the ${boundary} boundary`, async ({ residentApi, stack }) => {
    const sessionId = `composite_${crypto.randomUUID()}`, endpoint = `http://localhost:${stack.corePort}`;
    const send = async (path: string, body: Record<string, unknown>) => {
      const response = await fetch(`${endpoint}${path}`, { method: 'POST', headers: { Authorization: `Bearer ${residentApi.token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ ...body, sessionId, accountId: residentApi.accountId }) });
      return { status: response.status, data: await response.json() };
    };
    const invalid = await fetch(`http://localhost:${stack.corePort + 1}/rides/book`, { method: 'POST', headers: { Authorization: `Bearer ${residentApi.token}`, 'X-Account-Id': residentApi.accountId, 'X-Eligibility-Epoch': 'invalid', 'Content-Type': 'application/json' }, body: JSON.stringify({ driverId: 'driver-economy' }) });
    expect(invalid.status).toBe(400);
    const invalidProvider = await fetch(`http://localhost:${stack.corePort + 101}/v1/accounts/${residentApi.accountId}/rides/bookings`, { method: 'POST', headers: { Authorization: `Bearer ${residentApi.token}`, 'Idempotency-Key': crypto.randomUUID(), 'X-Eligibility-Epoch': 'invalid', 'Content-Type': 'application/json' }, body: JSON.stringify({ driverId: 'driver-economy' }) });
    expect(invalidProvider.status).toBe(400);
    const review = await send('/api/a2ui/intent', { text: 'Book a ride downtown and order pizza, pay with my wallet' });
    const surface = review.data.surface as { revision: string; view: { children: Array<{ onEvents?: Array<{ payload: Record<string, unknown> }> }> } };
    const binding = surface.view.children.flatMap(child => child.onEvents ?? []).find(event => event.payload.action === 'confirm_composite_checkout')!.payload;
    const operationId = `${surface.revision}:confirm_composite_checkout`, originalCall = ProviderClient.prototype.call, originalFetch = globalThis.fetch;
    let lostWallet = false, switched = false;
    const changePermission = () => {
      const eligibility = stack.payments.eligibility!;
      for (const enabled of [false, true]) {
        const snapshot = eligibility.snapshot(residentApi.accountId);
        eligibility.change(residentApi.accountId, { kind: 'MEMBERSHIP', enabled, expectedVersion: snapshot.membershipVersion, reason: 'Explicit test permission change' }, 'test-operator', crypto.randomUUID());
      }
      switched = true;
    };
    ProviderClient.prototype.call = async function (provider, actor, method, path, body, key) {
      if (provider === 'payments' && method === 'POST' && path === '/charges' && !lostWallet) {
        lostWallet = true; await originalCall.call(this, provider, actor, method, path, body, key); throw new UpstreamError(503, 'PROVIDER_OUTCOME_UNKNOWN', 'Lost wallet response');
      }
      if (boundary === 'provider' && provider === 'rta' && method === 'POST' && path === '/rides/bookings' && !switched) changePermission();
      return originalCall.call(this, provider, actor, method, path, body, key);
    };
    globalThis.fetch = async (input, init) => {
      const url = new URL(input instanceof Request ? input.url : input.toString());
      if (boundary === 'application' && url.port === String(stack.corePort + 1) && url.pathname === '/rides/book' && init?.method === 'POST' && !switched) changePermission();
      return originalFetch(input, init);
    };
    try {
      expect((await send('/api/a2ui/action', { surfaceRevision: surface.revision, action: 'confirm_composite_checkout', payload: binding })).data.outcome).toBe('UNKNOWN');
      expect((await send('/api/composite/reconciliation/continue', { operationId, step: 'RIDE' })).status).toBe(503);
      expect(switched).toBe(true);
      expect(stack.stores.get('payments')!.list(residentApi.accountId, 'charge')).toHaveLength(1);
      expect(stack.stores.get('rta')!.list(residentApi.accountId, 'ride')).toHaveLength(0);
    } finally { ProviderClient.prototype.call = originalCall; globalThis.fetch = originalFetch; }
  });
}
