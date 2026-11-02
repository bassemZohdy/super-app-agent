import { removeTemp } from '../../test/support/temp-cleanup.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { integratedRequest } from '../../packages/backend-kit/src/application.ts';
import { ProviderClient, UpstreamError } from '../../packages/backend-kit/src/provider-client.ts';
import { actorFor, assetsFor } from '../../packages/backend-kit/src/context.ts';

test('integrated parking preserves uncertainty after capture and verifies the payment and meter', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'parking-outcome-')), previous = process.env.APP_DATA_DIR;
  process.env.APP_DATA_DIR = dir;
  t.after(() => { if (previous === undefined) delete process.env.APP_DATA_DIR; else process.env.APP_DATA_DIR = previous; removeTemp(dir); });
  const actor = actorFor({ sub: 'parking-outcome-test' }), asset = assetsFor(actor.accountId);
  let scenario = '', effects = 0, charges = 0;
  t.mock.method(ProviderClient.prototype, 'call', async (provider, _actor, method, path, request) => {
    if (provider === 'rta' && method === 'GET' && path === '/parking/zones') return { zones: [{ id: 'zone-1', tariffPerHour: 4 }] };
    if (provider === 'rta' && method === 'GET' && path === '/parking/sessions') return { meters: [{ ticketId: 'ticket-1', zoneId: 'zone-1', plateNumber: scenario === 'wrong-prior-plate' ? 'other' : asset.plate, durationHours: 2, totalFee: 8, expiresAt: 1900000000000, status: 'ACTIVE' }] };
    if (provider === 'payments' && path === '/charges') {
      charges++;
      if (scenario === 'charge-refusal') throw new UpstreamError(402, 'INSUFFICIENT_FUNDS', 'insufficient');
      const charge = { id: 'pay-1', accountId: actor.accountId, currency: 'AED', status: 'CAPTURED', refunded: false, merchant: 'rta', reference: (request as { reference: string }).reference, amountMinor: (request as { amountMinor: number }).amountMinor, source: 'wallet' };
      const changes: Record<string, object> = { 'wrong-charge': { amountMinor: charge.amountMinor + 1 }, 'wrong-account': { accountId: 'other' }, 'wrong-reference': { reference: 'other' }, 'wrong-currency': { currency: 'USD' }, 'wrong-status': { status: 'PENDING' }, 'wrong-id': { id: '' } };
      return { charge: { ...charge, ...changes[scenario] } };
    }
    if (provider === 'rta' && method === 'POST') {
      effects++;
      if (scenario === 'provider-refusal') throw new UpstreamError(409, 'METER_CHANGED', 'private provider details');
      const extending = path.endsWith('/extensions');
      return { meter: { ticketId: scenario === 'wrong-meter' ? 'different' : 'ticket-1', zoneId: scenario === 'wrong-zone' ? 'other' : 'zone-1', plateNumber: scenario === 'wrong-plate' ? 'other' : asset.plate, durationHours: extending ? 3 : 2, totalFee: scenario === 'wrong-fee' ? 99 : extending ? 12 : 8, expiresAt: scenario === 'wrong-expiry' ? 1900000000000 : 1900003600000, status: 'ACTIVE' }, ...(extending ? { previousDurationHours: 2 } : {}) };
    }
    throw new Error('unexpected provider call');
  });
  for (const path of ['/mobility/parking/activate', '/mobility/parking/extend']) {
    const body = path.endsWith('/activate') ? { zoneId: 'zone-1', plateNumber: asset.plate, durationHours: 2 } : { ticketId: 'ticket-1', additionalHours: 1 };
    const run = () => integratedRequest('service-ride', actor, 'POST', path, {}, body, () => ({ status: 404, data: {} }));
    for (const name of ['charge-refusal', 'wrong-charge', 'wrong-account', 'wrong-reference', 'wrong-currency', 'wrong-status', 'wrong-id', 'provider-refusal', 'wrong-fee', ...(path.endsWith('/extend') ? ['wrong-meter', 'wrong-zone', 'wrong-plate', 'wrong-expiry'] : [])]) {
      scenario = name; effects = 0;
      const result = await run();
      if (name === 'charge-refusal') assert.equal(result.status, 402);
      else { assert.equal(result.status, 503, name); assert.equal(result.data.code, 'PROVIDER_OUTCOME_UNKNOWN', name); }
      assert.equal(effects, ['provider-refusal', 'wrong-meter', 'wrong-zone', 'wrong-plate', 'wrong-expiry', 'wrong-fee'].includes(name) ? 1 : 0, name);
      assert.ok(!JSON.stringify(result).includes('private provider details'));
    }
    if (path.endsWith('/extend')) { scenario = 'wrong-prior-plate'; effects = 0; charges = 0; assert.equal((await run()).status, 400); assert.equal(effects, 0); assert.equal(charges, 0); }
    scenario = 'valid'; effects = 0;
    assert.equal((await run()).status, 200);
    assert.equal(effects, 1);
  }
});
