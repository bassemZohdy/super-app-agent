import test from 'node:test';
import assert from 'node:assert/strict';
import { actorFor } from '../../packages/backend-kit/src/context.ts';
import { providerOperationKey } from '../../packages/backend-kit/src/provider-client.ts';
import { AccountDatabase } from '../provider-simulator/src/database.ts';
import { ProviderEngine } from '../provider-simulator/src/engine.ts';

test('damaged matching ride evidence remains unconfirmed and blocks replacement only for its owner', t => {
  const store = new AccountDatabase(':memory:'), engine = new ProviderEngine('rta', store);
  const owner = actorFor({ sub: 'ride-evidence-owner' }), other = actorFor({ sub: 'ride-evidence-other' });
  store.accounts(owner.sub); store.accounts(other.sub); engine.seed(owner); engine.seed(other);
  t.after(() => store.close());
  const saved = store.transaction(() => engine.execute(owner, 'POST', '/rides/bookings', { driverId: 'drv_1', pickup: 'Start', dropoff: 'Finish' })).data;
  const operation = 'ride-original', key = providerOperationKey(operation, 'rta', '/rides/bookings');
  const put = (booking: object) => {
    store.put(owner.accountId, 'ride', booking, saved.booking.bookingId);
    store.db.prepare('INSERT OR REPLACE INTO idempotency(account_id,key,fingerprint,status,body) VALUES(?,?,?,?,?)')
      .run(owner.accountId, key, 'a'.repeat(64), 200, JSON.stringify({ success: true, booking }));
  };
  const inspect = () => store.transaction(() => engine.execute(owner, 'GET', `/rides/operations/${operation}`, {}));
  put(saved.booking);
  assert.deepEqual(inspect().data.booking, saved.booking);
  for (const change of [{ status: 'PENDING' }, { driver: {} }, { pickup: '' }, { dropoff: '' }, { fare: -1 }, { fare: 22.001 }]) {
    put({ ...saved.booking, ...change });
    assert.throws(inspect, /original ride could not be confirmed/i);
    assert.throws(() => store.transaction(() => engine.execute(owner, 'POST', '/rides/bookings', { driverId: 'drv_1' })), /original ride could not be confirmed/i);
  }
  assert.equal(store.transaction(() => engine.execute(other, 'POST', '/rides/bookings', { driverId: 'drv_1' })).status, 200);
  put(saved.booking);
  assert.deepEqual(inspect().data.booking, saved.booking);
});
