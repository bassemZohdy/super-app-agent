import test from 'node:test';
import assert from 'node:assert/strict';
import { compareCompositeEvidence } from '../agent-core/src/composite-evidence.ts';

const operationId = '11111111-1111-4111-8111-111111111111:confirm_composite_checkout';
const accountId = 'account-1';
const terms = { action: 'confirm_composite_checkout', driverId: 'drv_3', dropoff: 'Downtown Dining', restaurantId: 'rest_1', itemId: 'item_diavola', rideAmountMinor: 2800, itemAmountMinor: 1800, deliveryFeeMinor: 299, mealAmountMinor: 2099, amountMinor: 4899, currency: 'AED' };
const wallet = { success: true, operationId, charge: { id: 'charge-1', accountId, amountMinor: 4899, currency: 'AED', merchant: 'superapp', reference: operationId, source: 'wallet', status: 'CAPTURED', refunded: false }, transaction: { id: 'charge-1', type: 'PAYMENT', amount: 48.99, currency: 'AED', status: 'SETTLED', referenceId: operationId, purpose: operationId } };
const ride = { success: true, operationId, booking: { bookingId: 'ride-1', driver: { id: 'drv_3' }, dropoff: 'Downtown Dining', fare: 28, status: 'CONFIRMED' } };
const food = { success: true, operationId, order: { orderId: 'food-1', restaurantId: 'rest_1', deliveryAddress: 'Downtown Dining', status: 'CONFIRMED', items: [{ id: 'item_diavola', price: 18 }], totalAmount: 20.99 } };
const expected = [{ step: 'WALLET', assessment: 'MATCH' }, { step: 'RIDE', assessment: 'MATCH' }, { step: 'FOOD', assessment: 'MATCH' }];

test('composite inspection compares each independent result with the original reviewed terms', async () => {
  const values = { wallet, ride, food };
  assert.deepEqual(await compareCompositeEvidence({ operationId, terms }, accountId, async source => values[source]), expected);
  for (const [source, altered] of [
    ['wallet', { ...wallet, charge: { ...wallet.charge, amountMinor: 4900 } }],
    ['ride', { ...ride, booking: { ...ride.booking, dropoff: 'Other destination' } }],
    ['food', { ...food, order: { ...food.order, deliveryAddress: 'Other address' } }],
    ['food', { ...food, order: { ...food.order, items: [{ id: 'item_diavola', price: 19 }], totalAmount: 20.99 } }],
    ['wallet', { ...wallet, error: 'Contradictory response' }],
  ] as const) {
    const result = await compareCompositeEvidence({ operationId, terms }, accountId, async name => name === source ? altered : values[name]);
    assert.equal(result.find(item => item.step === source.toUpperCase())?.assessment, 'UNCONFIRMED');
  }
  const missing = await compareCompositeEvidence({ operationId, terms }, accountId, async source => { if (source === 'ride') throw new Error('Unavailable'); return values[source]; });
  assert.equal(missing[1].assessment, 'UNCONFIRMED');
});

test('malformed saved terms or operation identity never produce matching evidence', async () => {
  let calls = 0;
  for (const attempt of [{ operationId: '../invalid', terms }, { operationId, terms: { ...terms, amountMinor: 1 } }, { operationId, terms: { ...terms, currency: 'USD' } }]) {
    const result = await compareCompositeEvidence(attempt, accountId, async () => { calls++; return wallet; });
    assert.ok(result.every(item => item.assessment === 'UNCONFIRMED'));
  }
  assert.equal(calls, 0);
});
