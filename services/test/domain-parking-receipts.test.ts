import test from 'node:test';
import assert from 'node:assert/strict';
import { actorContext, actorFor } from '../../packages/backend-kit/src/context.ts';
import { callDomain, callDomainAsync, domainHandlers, trackDomainOperations, DomainOperationError, type Step } from '../agent-core/src/domain-operations.ts';

test('parking confirmations match the activation or extension and contain usable meter data', async t => {
  const previous = process.env.DOMAIN_TRANSPORT;
  t.after(() => { if (previous === undefined) delete process.env.DOMAIN_TRANSPORT; else process.env.DOMAIN_TRANSPORT = previous; });
  const meter = { ticketId: 'ticket-1', zoneId: 'zone-1', zoneCode: 'A', zoneName: 'Central', plateNumber: 'plate-1', durationHours: 2, totalFee: 4, status: 'ACTIVE', expiresAt: 1900000000000 };
  const cases = [
    ['/mobility/parking/activate', { zoneId: 'zone-1', plateNumber: 'plate-1', durationHours: 2 }, meter, true],
    ['/mobility/parking/activate', { zoneId: 'zone-1', plateNumber: 'plate-1', durationHours: 2 }, { ...meter, zoneId: 'other' }, false],
    ['/mobility/parking/activate', { zoneId: 'zone-1', plateNumber: 'plate-1', durationHours: 2 }, { ...meter, plateNumber: 'other' }, false],
    ['/mobility/parking/activate', { zoneId: 'zone-1', plateNumber: 'plate-1', durationHours: 2 }, { ...meter, durationHours: 3 }, false],
    ['/mobility/parking/extend', { ticketId: 'ticket-1', additionalHours: 1 }, meter, true],
    ['/mobility/parking/extend', { ticketId: 'ticket-1', additionalHours: 1 }, { ...meter, ticketId: 'other' }, false],
    ['/mobility/parking/extend', { ticketId: 'ticket-1', additionalHours: 1 }, { ...meter, status: 'EXPIRED' }, false],
    ['/mobility/parking/extend', { ticketId: 'ticket-1', additionalHours: 1 }, { ...meter, totalFee: -1 }, false],
    ['/mobility/parking/activate', { zoneId: 'zone-1', plateNumber: 'plate-1', durationHours: 2 }, { ...meter, expiresAt: 1e20 }, false],
  ] as const;
  for (const [path, body, receipt, valid] of cases) for (const transport of ['local', 'http'] as const) {
    process.env.DOMAIN_TRANSPORT = transport;
    const steps: Step[] = [], data = { success: true, meter: receipt };
    const local = t.mock.method(domainHandlers, 'ride', () => ({ status: 200, data }));
    const remote = t.mock.method(globalThis, 'fetch', async () => Response.json(data));
    try {
      const run = () => transport === 'local'
        ? Promise.resolve().then(() => callDomain('ride', 'POST', path, {}, body))
        : actorContext.run(actorFor({ sub: 'test-user' }, 'account', 'Bearer test'), () => callDomainAsync('ride', 'POST', path, {}, body));
      const result = trackDomainOperations(steps, run);
      if (valid) { await result; assert.equal(steps[0].state, 'SUCCEEDED'); }
      else { await assert.rejects(result, (error: unknown) => error instanceof DomainOperationError && error.code === 'DOMAIN_OUTCOME_UNKNOWN'); assert.equal(steps[0].state, 'UNKNOWN'); }
    } finally { local.mock.restore(); remote.mock.restore(); }
  }
});

test('real fixture activation and extension pass receipt checks for the same ticket', async t => {
  const previous = process.env.DOMAIN_TRANSPORT;
  process.env.DOMAIN_TRANSPORT = 'local';
  t.after(() => { if (previous === undefined) delete process.env.DOMAIN_TRANSPORT; else process.env.DOMAIN_TRANSPORT = previous; });
  const steps: Step[] = [];
  const activation = await trackDomainOperations(steps, async () => callDomain('ride', 'POST', '/mobility/parking/activate', {}, { zoneId: 'zone_101b', plateNumber: 'TEST-PLATE', durationHours: 2 }));
  const extension = await trackDomainOperations(steps, async () => callDomain('ride', 'POST', '/mobility/parking/extend', {}, { ticketId: activation.data.meter.ticketId, additionalHours: 1 }));
  assert.equal(extension.data.meter.ticketId, activation.data.meter.ticketId);
  assert.equal(extension.data.meter.durationHours, 3);
  assert.deepEqual(steps.map(step => step.state), ['SUCCEEDED', 'SUCCEEDED']);
});
