import { expect, isolatedTest as test } from '../stack.ts';

test('wallet operation identity survives different trace IDs and rejects changed terms', async ({ residentApi, stack }) => {
  const wallet = () => residentApi.call('overview').then(result => result.data.wallet.balanceMinor as number);
  const before = await wallet();
  const charges = () => stack.stores.get('payments')!.list(residentApi.accountId, 'charge') as Array<{ id: string }>;
  const previousCharges = charges().length;
  const operation = '11111111-1111-4111-8111-111111111111:replay_test';
  const request = async (trace: string, amount: number) => {
    const response = await fetch(`http://localhost:${stack.corePort + 3}/wallet/pay`, {
      method: 'POST', headers: { Authorization: `Bearer ${residentApi.token}`, 'Content-Type': 'application/json', 'X-Account-Id': residentApi.accountId, 'X-Request-Id': trace, 'X-Operation-Id': operation },
      body: JSON.stringify({ amount, purpose: 'Replay test' }),
    });
    return { status: response.status, data: await response.json() as { charge?: { id: string }; code?: string } };
  };
  const first = await request('trace-first', 1), second = await request('trace-second', 1);
  expect(first.status).toBe(200);
  expect(second.status).toBe(200);
  expect(first.data.charge?.id).toEqual(expect.any(String));
  expect(second.data.charge?.id).toBe(first.data.charge?.id);
  expect(charges()).toHaveLength(previousCharges + 1);
  expect(await wallet()).toBe(before - 100);
  const changed = await request('trace-third', 2);
  expect(changed.status).toBe(503);
  expect(changed.data.code).toBe('PROVIDER_OUTCOME_UNKNOWN');
  expect(await wallet()).toBe(before - 100);
  expect(charges()).toHaveLength(previousCharges + 1);
});

test('food operation replay returns the original order across trace IDs and refuses changed terms', async ({ residentApi, stack }) => {
  const operation = '22222222-2222-4222-8222-222222222222:food_order';
  const request = async (trace: string, items: string[]) => {
    const response = await fetch(`http://localhost:${stack.corePort + 2}/orders/create`, {
      method: 'POST', headers: { Authorization: `Bearer ${residentApi.token}`, 'Content-Type': 'application/json', 'X-Account-Id': residentApi.accountId, 'X-Request-Id': trace, 'X-Operation-Id': operation },
      body: JSON.stringify({ restaurantId: 'rest_1', items }),
    });
    return { status: response.status, data: await response.json() as { order?: { orderId: string }; code?: string } };
  };
  const first = await request('trace-first', ['item_diavola']), replay = await request('trace-second', ['item_diavola']);
  expect(first.status).toBe(200);
  expect(first.data.order?.orderId).toEqual(expect.any(String));
  expect(replay.status).toBe(200);
  expect(replay.data.order?.orderId).toBe(first.data.order?.orderId);
  const inspect = async (identity: string) => fetch(`http://localhost:${stack.corePort + 2}/orders/operations/${encodeURIComponent(identity)}`, { headers: { Authorization: `Bearer ${residentApi.token}`, 'X-Account-Id': residentApi.accountId } });
  const found = await inspect(operation);
  expect(found.status).toBe(200);
  expect(((await found.json()) as { order: { orderId: string } }).order.orderId).toBe(first.data.order?.orderId);
  expect((await inspect('missing-operation')).status).toBe(404);
  const changed = await request('trace-third', ['item_margherita']);
  expect(changed.status).toBe(409);
  expect(changed.data.code).toBe('IDEMPOTENCY_CONFLICT');
});

test('ride operation replay returns one booking across trace IDs and refuses a changed destination', async ({ residentApi, stack }) => {
  const operation = 'r'.repeat(200);
  const rides = () => stack.stores.get('rta')!.list(residentApi.accountId, 'ride') as Array<{ bookingId: string; dropoff: string }>;
  const before = rides().length;
  const request = async (trace: string, dropoff: string, identity = operation) => {
    const response = await fetch(`http://localhost:${stack.corePort + 1}/rides/book`, {
      method: 'POST', headers: { Authorization: `Bearer ${residentApi.token}`, 'Content-Type': 'application/json', 'X-Account-Id': residentApi.accountId, 'X-Request-Id': trace, 'X-Operation-Id': identity },
      body: JSON.stringify({ driverId: 'drv_3', dropoff, expectedFareMinor: 2800 }),
    });
    return { status: response.status, data: await response.json() as { booking?: { bookingId: string; dropoff: string }; code?: string } };
  };
  const [first, replay] = await Promise.all([request('trace-first', 'Downtown Dining'), request('trace-second', 'Downtown Dining')]);
  expect(first.status).toBe(200);
  expect(replay.status).toBe(200);
  expect(first.data.booking?.bookingId).toEqual(expect.any(String));
  expect(replay.data.booking).toEqual(first.data.booking);
  expect(first.data.booking?.dropoff).toBe('Downtown Dining');
  expect(rides()).toHaveLength(before + 1);
  const changed = await request('trace-third', 'Other destination');
  expect(changed.status).toBe(503);
  expect(changed.data.code).toBe('PROVIDER_OUTCOME_UNKNOWN');
  expect(rides()).toHaveLength(before + 1);
  const separate = await request('trace-fourth', 'Downtown Dining', `${'r'.repeat(199)}s`);
  expect(separate.status).toBe(200);
  expect(separate.data.booking?.bookingId).not.toBe(first.data.booking?.bookingId);
  expect(rides()).toHaveLength(before + 2);
});
