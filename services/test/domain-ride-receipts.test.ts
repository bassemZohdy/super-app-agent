import test from 'node:test';
import assert from 'node:assert/strict';
import { actorContext, actorFor } from '../../packages/backend-kit/src/context.ts';
import { callDomain, callDomainAsync, domainHandlers, trackDomainOperations, DomainOperationError, type Step } from '../agent-core/src/domain-operations.ts';

test('ride confirmation matches the requested driver and supplied route in both transports', async t => {
  const previous = process.env.DOMAIN_TRANSPORT;
  t.after(() => { if (previous === undefined) delete process.env.DOMAIN_TRANSPORT; else process.env.DOMAIN_TRANSPORT = previous; });
  const body = { driverId: 'driver-1', pickup: 'Origin', dropoff: 'Destination' };
  const booking = { bookingId: 'booking-1', status: 'DISPATCHED', driver: { id: 'driver-1' }, pickup: 'Origin', dropoff: 'Destination' };
  const cases = [
    [booking, true],
    [{ ...booking, driver: { id: 'driver-2' } }, false],
    [{ ...booking, driver: {} }, false],
    [{ ...booking, pickup: 'Other origin' }, false],
    [{ ...booking, dropoff: 'Other destination' }, false],
    [{ ...booking, status: 'CANCELLED' }, false],
    [{ ...booking, bookingId: '' }, false],
  ] as const;
  for (const [receipt, valid] of cases) for (const transport of ['local', 'http'] as const) {
    process.env.DOMAIN_TRANSPORT = transport;
    const steps: Step[] = [], data = { success: true, booking: receipt };
    const local = t.mock.method(domainHandlers, 'ride', () => ({ status: 200, data }));
    const remote = t.mock.method(globalThis, 'fetch', async () => Response.json(data));
    try {
      const run = () => transport === 'local'
        ? Promise.resolve().then(() => callDomain('ride', 'POST', '/rides/book', {}, body))
        : actorContext.run(actorFor({ sub: 'test-user' }, 'account', 'Bearer test'), () => callDomainAsync('ride', 'POST', '/rides/book', {}, body));
      const result = trackDomainOperations(steps, run);
      if (valid) { await result; assert.equal(steps[0].state, 'SUCCEEDED'); }
      else { await assert.rejects(result, (error: unknown) => error instanceof DomainOperationError && error.code === 'DOMAIN_OUTCOME_UNKNOWN'); assert.equal(steps[0].state, 'UNKNOWN'); }
    } finally { local.mock.restore(); remote.mock.restore(); }
  }
  process.env.DOMAIN_TRANSPORT = 'local';
  const local = t.mock.method(domainHandlers, 'ride', () => ({ status: 200, data: { success: true, booking } }));
  try {
    const steps: Step[] = [];
    await trackDomainOperations(steps, async () => callDomain('ride', 'POST', '/rides/book', {}, { driverId: 'driver-1' }));
    assert.equal(steps[0].state, 'SUCCEEDED');
  } finally { local.mock.restore(); }
});
