import test from 'node:test';
import assert from 'node:assert/strict';
import { actorContext, actorFor } from '../../packages/backend-kit/src/context.ts';
import { callDomain, callDomainAsync, domainHandlers, trackDomainOperations, DomainOperationError, type Step } from '../agent-core/src/domain-operations.ts';

test('food confirmations match the restaurant, item quantities and supplied address in both transports', async t => {
  const previous = process.env.DOMAIN_TRANSPORT;
  t.after(() => { if (previous === undefined) delete process.env.DOMAIN_TRANSPORT; else process.env.DOMAIN_TRANSPORT = previous; });
  const body = { restaurantId: 'restaurant-1', items: ['pizza', 'pizza', 'salad'], deliveryAddress: 'Address' };
  const pizza = { item: { id: 'pizza' }, quantity: 1 }, salad = { item: { id: 'salad' }, quantity: 1 };
  const order = { orderId: 'order-1', restaurantId: 'restaurant-1', items: [pizza, salad, pizza], deliveryAddress: 'Address', status: 'ACCEPTED_BY_KITCHEN', totalAmount: 25 };
  const cases = [
    [order, true],
    [{ ...order, items: [{ item: { id: 'pizza' }, quantity: 2 }, salad] }, true],
    [{ ...order, status: 'CONFIRMED', items: [{ id: 'pizza' }, { id: 'salad' }, { id: 'pizza' }] }, true],
    [{ ...order, status: 'CONFIRMED', items: [{ id: 'pizza', quantity: 2 }, { id: 'salad' }, { id: 'pizza' }] }, false],
    [{ ...order, restaurantId: 'restaurant-2' }, false],
    [{ ...order, items: [pizza, salad] }, false],
    [{ ...order, items: [pizza, pizza, pizza] }, false],
    [{ ...order, items: [pizza, salad, { item: { id: 'pizza' }, quantity: 2 }] }, false],
    [{ ...order, deliveryAddress: 'Other' }, false],
    [{ ...order, status: 'CANCELLED' }, false],
    [{ ...order, totalAmount: -1 }, false],
  ] as const;
  for (const [receipt, valid] of cases) for (const transport of ['local', 'http'] as const) {
    process.env.DOMAIN_TRANSPORT = transport;
    const steps: Step[] = [], data = { success: true, order: receipt };
    const local = t.mock.method(domainHandlers, 'food', () => ({ status: 200, data }));
    const remote = t.mock.method(globalThis, 'fetch', async () => Response.json(data));
    try {
      const run = () => transport === 'local'
        ? Promise.resolve().then(() => callDomain('food', 'POST', '/orders/create', {}, body))
        : actorContext.run(actorFor({ sub: 'test-user' }, 'account', 'Bearer test'), () => callDomainAsync('food', 'POST', '/orders/create', {}, body));
      const result = trackDomainOperations(steps, run);
      if (valid) { await result; assert.equal(steps[0].state, 'SUCCEEDED'); }
      else { await assert.rejects(result, (error: unknown) => error instanceof DomainOperationError && error.code === 'DOMAIN_OUTCOME_UNKNOWN'); assert.equal(steps[0].state, 'UNKNOWN'); }
    } finally { local.mock.restore(); remote.mock.restore(); }
  }
});
