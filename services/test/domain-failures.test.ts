import test from 'node:test';
import assert from 'node:assert/strict';
import { executeCoreRequest as core, getOrCreateSession, sseClients, server } from '../agent-core/src/index.ts';
import { domainHandlers, callDomain, trackDomainOperations, type Step } from '../agent-core/src/domain-operations.ts';
import { executeWalletRequest as wallet, balance, transactions, policeFines } from '../service-wallet/src/index.ts';
import { activeOrders, executeFoodRequest as food, restaurants } from '../service-food/src/index.ts';
import { activeRides, activeParkingMeters, executeRideRequest as ride } from '../service-ride/src/index.ts';
import { readEventStream } from '../../packages/protocol-core/src/sse-client.ts';

const composite = 'Book a ride downtown and order pizza, pay with my wallet';
const intent = (sid: string, text = composite) => core('POST', '/api/a2ui/intent', {}, { sessionId: sid, text });
const offered=(sid:string,action:string)=>getOrCreateSession(sid).currentSurface!.view.children!.find((n:any)=>n.onEvents?.some((e:any)=>e.payload?.action===action))?.onEvents?.find((e:any)=>e.payload.action===action)?.payload||{};
const originalBindings = new Map<string, object>();
const action = (sid: string, action = 'confirm_composite_checkout') => {
  const key = `${sid}:${action}`, binding = offered(sid, action);
  if (binding.action === action) originalBindings.set(key, binding);
  return core('POST', '/api/a2ui/action', {}, { sessionId: sid, surfaceRevision: getOrCreateSession(sid).currentSurface?.revision, action, payload: originalBindings.get(key) || binding });
};
function ensureFunds() { if (balance < 50) assert.equal(wallet('POST', '/wallet/topup', {}, { amount: 100 }).status, 200); }

test('P1-13: standalone food orders use the restaurant of the selected reviewed dish', async t => {
  const realFood = domainHandlers.food;
  t.mock.method(domainHandlers, 'food', (method, path, query, body) => {
    const result = realFood(method, path, query, body);
    return method === 'GET' && path === '/restaurants/search'
      ? { ...result, data: { ...result.data, restaurants: [...result.data.restaurants, restaurants[1]] } } : result;
  });
  const sid = 'food_selected_restaurant';
  assert.equal((await intent(sid, 'Find a restaurant for dinner')).status, 200);
  const surface = getOrCreateSession(sid).currentSurface!;
  const delivery = surface.view.children!.find(node => node.id === 'food_delivery_address')!.properties!.text as string;
  assert.equal(delivery, 'Delivery address: 100 Market St, Apt 4B');
  const result = await core('POST', '/api/a2ui/action', {}, { sessionId: sid, surfaceRevision: surface.revision, action: 'order_food', payload: { selectedChoice: 'item_salmon_roll' } });
  assert.equal(result.status, 200);
  const reference = result.data.surface.view.children.find((node: { id: string }) => node.id === 'order_id').properties.value as string;
  assert.equal(activeOrders.get(reference)?.restaurantId, 'rest_2');
  assert.equal(activeOrders.get(reference)?.items[0].item.id, 'item_salmon_roll');
  assert.equal(activeOrders.get(reference)?.deliveryAddress, delivery.slice('Delivery address: '.length));
});

test('P1-13: a food review without a restaurant binding cannot dispatch an order', async t => {
  const realFood = domainHandlers.food;
  t.mock.method(domainHandlers, 'food', (method, path, query, body) => {
    const result = realFood(method, path, query, body);
    return method === 'GET' && path === '/restaurants/search'
      ? { ...result, data: { ...result.data, restaurants: result.data.restaurants.map((restaurant: { id: string }) => ({ ...restaurant, id: '' })) } } : result;
  });
  const sid = 'food_missing_restaurant_binding';
  assert.equal((await intent(sid, 'Find a restaurant for dinner')).status, 200);
  const surface = getOrCreateSession(sid).currentSurface!;
  const choices = surface.view.children!.find(node => node.id === 'food_choices')!.properties!.options as Array<{ id: string; metadata?: { restaurantId: string } }>;
  const choice = choices[0];
  const before = activeOrders.size;
  const result = await core('POST', '/api/a2ui/action', {}, { sessionId: sid, surfaceRevision: surface.revision, action: 'order_food', payload: { selectedChoice: choice.id } });
  assert.equal(result.status, 409);
  assert.equal(activeOrders.size, before);
});

test('P1-13: standalone food reviews include delivery and reject changed price components', async () => {
  const sid = 'food_reviewed_price_components';
  assert.equal((await intent(sid, 'Find a restaurant for dinner')).status, 200);
  const surface = getOrCreateSession(sid).currentSurface!;
  const choices = surface.view.children!.find(node => node.id === 'food_choices')!.properties!.options as Array<{ id: string; price: string; subtitle: string }>;
  const choice = choices.find(item => item.id === 'item_diavola')!;
  assert.equal(choice.price, 'USD 20.99');
  assert.match(choice.subtitle, /delivery USD 2\.99/i);
  const restaurant = restaurants[0], item = restaurant.items.find(entry => entry.id === choice.id)!;
  const originalPrice = item.price, originalFee = restaurant.deliveryFee, before = activeOrders.size;
  try {
    item.price = 19;
    restaurant.deliveryFee = 1.99;
    const result = await core('POST', '/api/a2ui/action', {}, { sessionId: sid, surfaceRevision: surface.revision, action: 'order_food', payload: { selectedChoice: choice.id } });
    assert.equal(result.status, 409);
    assert.equal(activeOrders.size, before);
  } finally { item.price = originalPrice; restaurant.deliveryFee = originalFee; }
});

test('P1-13: composite checkout charges the reviewed total and books the reviewed ride and meal', async () => {
  ensureFunds();
  const sid = 'composite_reviewed_selection';
  const review = await intent(sid);
  assert.equal(review.status, 200);
  const binding = offered(sid, 'confirm_composite_checkout');
  assert.equal(binding.driverId, 'drv_3');
  assert.equal(binding.restaurantId, 'rest_1');
  assert.equal(binding.itemId, 'item_diavola');
  assert.equal(binding.amountMinor, 4899);
  assert.equal(binding.currency, 'USD');
  assert.equal(binding.dropoff, 'Downtown Dining');
  const destination = getOrCreateSession(sid).currentSurface!.view.children!.find(node => node.id === 'comp_ride_destination');
  assert.equal(destination?.properties?.text, `Ride and meal delivery destination: ${binding.dropoff}`);
  const before = balance, rideIds = new Set(activeRides.keys()), orderIds = new Set(activeOrders.keys());
  const result = await action(sid);
  assert.equal(result.status, 200);
  assert.equal(balance, Math.round((before - 48.99) * 100) / 100);
  const booked = [...activeRides.entries()].find(([id]) => !rideIds.has(id))?.[1];
  const order = [...activeOrders.entries()].find(([id]) => !orderIds.has(id))?.[1];
  assert.equal(booked?.driver.id, binding.driverId);
  assert.equal(booked?.dropoff, binding.dropoff);
  assert.equal(order?.restaurantId, binding.restaurantId);
  assert.equal(order?.items[0].item.id, binding.itemId);
  assert.equal(order?.deliveryAddress, binding.dropoff);
});

test('P1-13: integrated composite checkout refuses dispatch without persistent session storage', async t => {
  ensureFunds();
  const sid = 'composite_needs_persistent_session';
  assert.equal((await intent(sid)).status, 200);
  const previous = process.env.PROVIDER_INTEGRATION;
  process.env.PROVIDER_INTEGRATION = 'true';
  t.after(() => { if (previous === undefined) delete process.env.PROVIDER_INTEGRATION; else process.env.PROVIDER_INTEGRATION = previous; });
  const before = { balance, rides: activeRides.size, orders: activeOrders.size };
  const result = await action(sid);
  assert.equal(result.status, 503);
  assert.equal(result.data.code, 'SESSION_STORE_UNAVAILABLE');
  assert.deepEqual({ balance, rides: activeRides.size, orders: activeOrders.size }, before);
});

test('P1-13: composite confirmation displays estimates from the booked ride and ordered meal', async t => {
  ensureFunds();
  const sid = 'composite_receipt_estimates';
  assert.equal((await intent(sid)).status, 200);
  const realRide = domainHandlers.ride, realFood = domainHandlers.food;
  t.mock.method(domainHandlers, 'ride', (method, path, query, body) => {
    const result = realRide(method, path, query, body);
    return method === 'POST' && path === '/rides/book' && result.status === 200
      ? { ...result, data: { ...result.data, booking: { ...result.data.booking, etaMinutes: 13 } } } : result;
  });
  t.mock.method(domainHandlers, 'food', (method, path, query, body) => {
    const result = realFood(method, path, query, body);
    return method === 'POST' && path === '/orders/create' && result.status === 200
      ? { ...result, data: { ...result.data, order: { ...result.data.order, estimatedDeliveryTime: '41 mins' } } } : result;
  });
  const result = await action(sid);
  assert.equal(result.status, 200);
  const children = result.data.surface.view.children as Array<{ id: string; properties: { value: string; label: string } }>;
  assert.equal(children.find(node => node.id === 'widget_ride_eta')?.properties.value, '13 mins');
  assert.equal(children.find(node => node.id === 'widget_food_eta')?.properties.value, '41 mins');
  assert.equal(children.find(node => node.id === 'widget_food_eta')?.properties.label, `${activeOrders.get([...activeOrders.keys()].at(-1)!)!.restaurantName} Delivery`);
});

test('P1-13: composite confirmation does not invent unavailable estimates', async t => {
  ensureFunds();
  const sid = 'composite_missing_estimates';
  assert.equal((await intent(sid)).status, 200);
  const realRide = domainHandlers.ride, realFood = domainHandlers.food;
  t.mock.method(domainHandlers, 'ride', (method, path, query, body) => {
    const result = realRide(method, path, query, body);
    return method === 'POST' && path === '/rides/book' && result.status === 200
      ? { ...result, data: { ...result.data, booking: { ...result.data.booking, etaMinutes: -1 } } } : result;
  });
  t.mock.method(domainHandlers, 'food', (method, path, query, body) => {
    const result = realFood(method, path, query, body);
    return method === 'POST' && path === '/orders/create' && result.status === 200
      ? { ...result, data: { ...result.data, order: { ...result.data.order, estimatedDeliveryTime: '' } } } : result;
  });
  const result = await action(sid);
  assert.equal(result.status, 200);
  const children = result.data.surface.view.children as Array<{ id: string; properties: { value: string } }>;
  assert.equal(children.find(node => node.id === 'widget_ride_eta')?.properties.value, 'Unavailable');
  assert.equal(children.find(node => node.id === 'widget_food_eta')?.properties.value, 'Unavailable');
});

test('P1-13: composite review rejects modified bindings and changed prices before a wallet effect', async t => {
  ensureFunds();
  const sid = 'composite_stale_review';
  assert.equal((await intent(sid)).status, 200);
  const binding = offered(sid, 'confirm_composite_checkout'), revision = getOrCreateSession(sid).currentSurface?.revision;
  const before = balance, realWallet = domainHandlers.wallet, realRide = domainHandlers.ride;
  let writes = 0;
  t.mock.method(domainHandlers, 'wallet', (method, path, query, body) => { if (method === 'POST') writes++; return realWallet(method, path, query, body); });
  const altered = await core('POST', '/api/a2ui/action', {}, { sessionId: sid, surfaceRevision: revision, action: 'confirm_composite_checkout', payload: { ...binding, amountMinor: binding.amountMinor + 1 } });
  assert.equal(altered.status, 403);
  const alteredDestination = await core('POST', '/api/a2ui/action', {}, { sessionId: sid, surfaceRevision: revision, action: 'confirm_composite_checkout', payload: { ...binding, dropoff: 'Other destination' } });
  assert.equal(alteredDestination.status, 403);
  t.mock.method(domainHandlers, 'ride', (method, path, query, body) => {
    const result = realRide(method, path, query, body);
    if (method !== 'GET' || path !== '/rides/options') return result;
    return { ...result, data: { ...result.data, options: result.data.options.map((option: { id: string; fare: number }) => option.id === binding.driverId ? { ...option, fare: option.fare + 1 } : option) } };
  });
  const stale = await action(sid);
  assert.equal(stale.status, 409);
  assert.equal(writes, 0);
  assert.equal(balance, before);
});

test('P1-13: offsetting meal and delivery price changes require a fresh composite review', async t => {
  ensureFunds();
  const sid = 'composite_offsetting_prices';
  assert.equal((await intent(sid)).status, 200);
  const binding = offered(sid, 'confirm_composite_checkout');
  assert.equal(binding.itemAmountMinor, 1800);
  assert.equal(binding.deliveryFeeMinor, 299);
  const realFood = domainHandlers.food, realWallet = domainHandlers.wallet, before = balance;
  let writes = 0;
  t.mock.method(domainHandlers, 'wallet', (method, path, query, body) => { if (method === 'POST') writes++; return realWallet(method, path, query, body); });
  t.mock.method(domainHandlers, 'food', (method, path, query, body) => {
    const result = realFood(method, path, query, body);
    if (method !== 'GET' || path !== '/restaurants/search') return result;
    return { ...result, data: { ...result.data, restaurants: result.data.restaurants.map((restaurant: { id: string; deliveryFee: number; items: Array<{ id: string; price: number }> }) => restaurant.id !== binding.restaurantId ? restaurant : { ...restaurant, deliveryFee: restaurant.deliveryFee - 1, items: restaurant.items.map(item => item.id === binding.itemId ? { ...item, price: item.price + 1 } : item) }) } };
  });
  assert.equal((await action(sid)).status, 409);
  assert.equal(writes, 0);
  assert.equal(balance, before);
});

test('P1-13: local ride and meal handlers reject changed reviewed prices before booking', () => {
  const rides = activeRides.size, orders = activeOrders.size;
  assert.equal(ride('POST', '/rides/book', {}, { driverId: 'drv_3', expectedFareMinor: 1 }).status, 409);
  assert.equal(food('POST', '/orders/create', {}, { restaurantId: 'rest_1', items: ['item_diavola'], expectedAmountMinor: 1 }).status, 409);
  assert.equal(food('POST', '/orders/create', {}, { restaurantId: 'rest_1', items: ['item_diavola'], expectedAmountMinor: 2099, expectedItemPriceMinor: 1801, expectedDeliveryFeeMinor: 298 }).status, 409);
  assert.equal(activeRides.size, rides);
  assert.equal(activeOrders.size, orders);
});

test('P0-12: insufficient funds returns failure JSON and failure SSE surface without clearing fines', async () => {
  const sid = 'failure_fines_session';
  assert.equal((await intent(sid, 'Check my police fines')).status, 200);
  const before = JSON.stringify({ balance, transactions, policeFines });
  const events: any[] = [];
  sseClients.set(sid, new Set([event => events.push(event)]));
  try {
    const result = await action(sid, 'pay_police_fines');
    assert.equal(result.status, 400);
    assert.equal(result.data.success, false);
    assert.equal(result.data.code, 'DOMAIN_REJECTED');
    assert.equal(result.data.outcome, 'FAILED');
    assert.equal(result.data.surface.view.id, 'execution_outcome_card');
    assert.equal(result.data.steps[0].state, 'FAILED');
    assert.equal(JSON.stringify({ balance, transactions, policeFines }), before);
    const render = events.filter(event => event.type === 'A2UI_RENDER_SURFACE').at(-1);
    assert.equal(render.data.surface.view.id, 'execution_outcome_card');
    assert.equal(render.data.outcome, result.data.outcome);
    assert.equal(render.data.code, result.data.code);
    assert.ok(!getOrCreateSession(sid).messages.some(message => message.content.includes('All traffic fines cleared')));
  } finally { sseClients.delete(sid); }
});

test('P0-12: composite stops at rejected second effect and records exact partial outcome', async t => {
  ensureFunds();
  const sid = 'failure_partial_session';
  assert.equal((await intent(sid)).status, 200);
  const realRide = domainHandlers.ride, realFood = domainHandlers.food;
  let foodEffects = 0;
  t.mock.method(domainHandlers, 'ride', (method, path, query, body) => method === 'POST'
    ? { status: 409, data: { error: 'Ride no longer available' } } : realRide(method, path, query, body));
  t.mock.method(domainHandlers, 'food', (method, path, query, body) => {
    if (method === 'POST') foodEffects++;
    return realFood(method, path, query, body);
  });
  const before = balance, rides = activeRides.size, orders = activeOrders.size, ledger = transactions.length;
  const result = await action(sid);
  assert.equal(result.status, 409);
  assert.equal(result.data.outcome, 'PARTIALLY_COMPLETED');
  assert.equal(result.data.code, 'PARTIAL_EXECUTION');
  assert.deepEqual(result.data.steps.map((step: Step) => [step.service, step.state]), [['wallet', 'SUCCEEDED'], ['ride', 'FAILED']]);
  assert.equal(balance, Math.round((before - 48.99) * 100) / 100);
  assert.equal(transactions.length, ledger + 1);
  assert.equal(activeRides.size, rides); assert.equal(activeOrders.size, orders); assert.equal(foodEffects, 0);
  assert.deepEqual(result.data.retry, { allowed: false, next: 'reconcile' });
  assert.equal(result.data.surface.view.style.variant, 'warning');
  assert.equal((await intent(sid)).data.code, 'RECONCILIATION_REQUIRED');
  assert.equal(balance, Math.round((before - 48.99) * 100) / 100);
});

test('P0-12: effect applied then exception yields UNKNOWN; no later effect or unsafe retry', async t => {
  ensureFunds();
  const sid = 'failure_unknown_session';
  assert.equal((await intent(sid)).status, 200);
  const realWallet = domainHandlers.wallet;
  t.mock.method(domainHandlers, 'wallet', (method, path, query, body) => {
    const result = realWallet(method, path, query, body);
    if (method === 'POST') throw new Error('Internal credential=never-expose');
    return result;
  });
  const before = balance, rides = activeRides.size, orders = activeOrders.size;
  const result = await action(sid);
  assert.equal(result.status, 502);
  assert.equal(result.data.outcome, 'UNKNOWN');
  assert.equal(result.data.code, 'DOMAIN_OUTCOME_UNKNOWN');
  assert.equal(result.data.steps[0].state, 'UNKNOWN');
  assert.equal(balance, Math.round((before - 48.99) * 100) / 100);
  assert.equal(activeRides.size, rides); assert.equal(activeOrders.size, orders);
  assert.ok(!JSON.stringify(result).includes('never-expose'));
  assert.deepEqual(result.data.retry, { allowed: false, next: 'reconcile' });
  assert.equal((await action(sid)).data.code, 'RECONCILIATION_REQUIRED');
  assert.equal(balance, Math.round((before - 48.99) * 100) / 100);
});

test('P1-02: an unknown settlement after a wallet effect blocks later effects and a replacement', async t => {
  ensureFunds();
  const sid = 'failure_uncertain_409_session';
  assert.equal((await intent(sid)).status, 200);
  const realWallet = domainHandlers.wallet;
  t.mock.method(domainHandlers, 'wallet', (method, path, query, body) => {
    const result = realWallet(method, path, query, body);
    return method === 'POST' ? { status: 409, data: { code: 'SETTLEMENT_STATUS_UNKNOWN', error: 'outcome not confirmed' } } : result;
  });
  const before = balance, rides = activeRides.size, orders = activeOrders.size;
  const result = await action(sid);
  assert.equal(result.data.outcome, 'UNKNOWN');
  assert.equal(result.data.steps[0].state, 'UNKNOWN');
  assert.deepEqual(result.data.retry, { allowed: false, next: 'reconcile' });
  assert.equal(balance, Math.round((before - 48.99) * 100) / 100);
  assert.equal(activeRides.size, rides);
  assert.equal(activeOrders.size, orders);
  assert.equal((await action(sid)).data.code, 'RECONCILIATION_REQUIRED');
  assert.equal(balance, Math.round((before - 48.99) * 100) / 100);
});

test('P1-02: a rejected response containing an applied transaction blocks replacement checkout', async t => {
  ensureFunds();
  const sid = 'failure_contradictory_transaction';
  assert.equal((await intent(sid)).status, 200);
  const realWallet = domainHandlers.wallet;
  t.mock.method(domainHandlers, 'wallet', (method, path, query, body) => {
    const result = realWallet(method, path, query, body);
    return method === 'POST' ? { status: 409, data: { success: false, error: 'Rejected', transaction: result.data.transaction } } : result;
  });
  const before = balance, rides = activeRides.size, orders = activeOrders.size;
  const result = await action(sid);
  assert.equal(result.data.outcome, 'UNKNOWN');
  assert.equal(result.data.steps[0].state, 'UNKNOWN');
  assert.equal(balance, Math.round((before - 48.99) * 100) / 100);
  assert.equal(activeRides.size, rides); assert.equal(activeOrders.size, orders);
  assert.equal((await action(sid)).data.code, 'RECONCILIATION_REQUIRED');
  assert.equal(balance, Math.round((before - 48.99) * 100) / 100);
});

test('P1-02: an authority denial after a wallet effect keeps the checkout unconfirmed', async t => {
  for (const [status, code] of [[403, 'ACCOUNT_RESTRICTED'], [409, 'ELIGIBILITY_CHANGED']] as const) {
    ensureFunds();
    const sid = `failure_authority_${status}_session`;
    assert.equal((await intent(sid)).status, 200);
    const realWallet = domainHandlers.wallet;
    const mock = t.mock.method(domainHandlers, 'wallet', (method, path, query, body) => {
      const result = realWallet(method, path, query, body);
      return method === 'POST' ? { status, data: { success: false, code, error: 'Permission changed' } } : result;
    });
    try {
      const before = balance, rides = activeRides.size, orders = activeOrders.size;
      const result = await action(sid);
      assert.equal(result.data.outcome, 'UNKNOWN');
      assert.equal(result.data.steps[0].state, 'UNKNOWN');
      assert.equal(balance, Math.round((before - 48.99) * 100) / 100);
      assert.equal(activeRides.size, rides); assert.equal(activeOrders.size, orders);
      assert.equal((await action(sid)).data.code, 'RECONCILIATION_REQUIRED');
    } finally { mock.mock.restore(); }
  }
});

test('P1-02: a rate-limit response after a wallet effect blocks later effects and a replacement', async t => {
  ensureFunds();
  const sid = 'failure_rate_limit_after_effect';
  assert.equal((await intent(sid)).status, 200);
  const realWallet = domainHandlers.wallet;
  t.mock.method(domainHandlers, 'wallet', (method, path, query, body) => {
    const result = realWallet(method, path, query, body);
    return method === 'POST' ? { status: 429, data: { code: 'RATE_LIMITED', error: 'rate limit exceeded' } } : result;
  });
  const before = balance, rides = activeRides.size, orders = activeOrders.size;
  const result = await action(sid);
  assert.equal(result.data.outcome, 'UNKNOWN');
  assert.equal(result.data.steps[0].state, 'UNKNOWN');
  assert.deepEqual(result.data.retry, { allowed: false, next: 'reconcile' });
  assert.equal(balance, Math.round((before - 48.99) * 100) / 100);
  assert.equal(activeRides.size, rides);
  assert.equal(activeOrders.size, orders);
  assert.equal((await action(sid)).data.code, 'RECONCILIATION_REQUIRED');
  assert.equal(balance, Math.round((before - 48.99) * 100) / 100);
});

test('P1-13: a mismatched wallet receipt after a debit blocks later effects and a replacement', async t => {
  ensureFunds();
  const sid = 'failure_wallet_receipt_mismatch';
  assert.equal((await intent(sid)).status, 200);
  const realWallet = domainHandlers.wallet;
  t.mock.method(domainHandlers, 'wallet', (method, path, query, body) => {
    const result = realWallet(method, path, query, body);
    return method === 'POST' ? { ...result, data: { ...result.data, transaction: { ...result.data.transaction, amount: 39 } } } : result;
  });
  const before = balance, rides = activeRides.size, orders = activeOrders.size;
  const result = await action(sid);
  assert.equal(result.data.outcome, 'UNKNOWN');
  assert.equal(result.data.steps[0].state, 'UNKNOWN');
  assert.equal(balance, Math.round((before - 48.99) * 100) / 100);
  assert.equal(activeRides.size, rides);
  assert.equal(activeOrders.size, orders);
  assert.equal((await action(sid)).data.code, 'RECONCILIATION_REQUIRED');
  assert.equal(balance, Math.round((before - 48.99) * 100) / 100);
});

test('P1-13: a mismatched ride receipt stops composite checkout and blocks replacement', async t => {
  ensureFunds();
  const sid = 'failure_ride_receipt_mismatch';
  assert.equal((await intent(sid)).status, 200);
  const realRide = domainHandlers.ride;
  t.mock.method(domainHandlers, 'ride', (method, path, query, body) => {
    const result = realRide(method, path, query, body);
    return method === 'POST' ? { ...result, data: { ...result.data, booking: { ...result.data.booking, driver: { id: 'other-driver' } } } } : result;
  });
  const before = balance, rides = activeRides.size, orders = activeOrders.size;
  const result = await action(sid);
  assert.equal(result.data.outcome, 'UNKNOWN');
  assert.deepEqual(result.data.steps.map((step: Step) => [step.service, step.state]), [['wallet', 'SUCCEEDED'], ['ride', 'UNKNOWN']]);
  assert.equal(balance, Math.round((before - 48.99) * 100) / 100);
  assert.equal(activeRides.size, rides + 1);
  assert.equal(activeOrders.size, orders);
  assert.equal((await action(sid)).data.code, 'RECONCILIATION_REQUIRED');
  assert.equal(activeRides.size, rides + 1);
});

test('P1-13: a ride receipt for a different destination stops the composite meal and blocks replacement', async t => {
  ensureFunds();
  const sid = 'failure_ride_destination_mismatch';
  assert.equal((await intent(sid)).status, 200);
  const realRide = domainHandlers.ride;
  t.mock.method(domainHandlers, 'ride', (method, path, query, body) => {
    const result = realRide(method, path, query, body);
    return method === 'POST' ? { ...result, data: { ...result.data, booking: { ...result.data.booking, dropoff: 'Other destination' } } } : result;
  });
  const rides = activeRides.size, orders = activeOrders.size;
  const result = await action(sid);
  assert.equal(result.data.outcome, 'UNKNOWN');
  assert.deepEqual(result.data.steps.map((step: Step) => [step.service, step.state]), [['wallet', 'SUCCEEDED'], ['ride', 'UNKNOWN']]);
  assert.equal(activeRides.size, rides + 1);
  assert.equal(activeOrders.size, orders);
  assert.equal((await action(sid)).data.code, 'RECONCILIATION_REQUIRED');
});

test('P1-13: a mismatched food receipt after order creation blocks replacement checkout', async t => {
  ensureFunds();
  const sid = 'failure_food_receipt_mismatch';
  assert.equal((await intent(sid)).status, 200);
  const realFood = domainHandlers.food;
  t.mock.method(domainHandlers, 'food', (method, path, query, body) => {
    const result = realFood(method, path, query, body);
    return method === 'POST' ? { ...result, data: { ...result.data, order: { ...result.data.order, restaurantId: 'other-restaurant' } } } : result;
  });
  const before = balance, rides = activeRides.size, orders = activeOrders.size;
  const result = await action(sid);
  assert.equal(result.data.outcome, 'UNKNOWN');
  assert.deepEqual(result.data.steps.map((step: Step) => [step.service, step.state]), [['wallet', 'SUCCEEDED'], ['ride', 'SUCCEEDED'], ['food', 'UNKNOWN']]);
  assert.equal(balance, Math.round((before - 48.99) * 100) / 100);
  assert.equal(activeRides.size, rides + 1);
  assert.equal(activeOrders.size, orders + 1);
  assert.equal((await action(sid)).data.code, 'RECONCILIATION_REQUIRED');
  assert.equal(activeOrders.size, orders + 1);
});

test('P1-13: a composite food receipt for another delivery destination stays unconfirmed', async t => {
  ensureFunds();
  const sid = 'failure_food_delivery_mismatch';
  assert.equal((await intent(sid)).status, 200);
  const realFood = domainHandlers.food;
  t.mock.method(domainHandlers, 'food', (method, path, query, body) => {
    const result = realFood(method, path, query, body);
    return method === 'POST' ? { ...result, data: { ...result.data, order: { ...result.data.order, deliveryAddress: 'Other address' } } } : result;
  });
  const orders = activeOrders.size;
  const result = await action(sid);
  assert.equal(result.data.outcome, 'UNKNOWN');
  assert.deepEqual(result.data.steps.map((step: Step) => [step.service, step.state]), [['wallet', 'SUCCEEDED'], ['ride', 'SUCCEEDED'], ['food', 'UNKNOWN']]);
  assert.equal(activeOrders.size, orders + 1);
  assert.equal((await action(sid)).data.code, 'RECONCILIATION_REQUIRED');
  assert.equal(activeOrders.size, orders + 1);
});

test('P0-12: unavailable read rejects the intent without fabricated surface or upstream details', async t => {
  t.mock.method(domainHandlers, 'profile', () => ({ status: 503, data: { error: 'private database connection string' } }));
  const result = await intent('failure_unavailable_session');
  assert.equal(result.status, 503);
  assert.equal(result.data.code, 'DOMAIN_UNAVAILABLE');
  assert.equal(result.data.outcome, 'FAILED');
  assert.deepEqual(result.data.steps, []);
  assert.equal(result.data.retry.allowed, true);
  assert.ok(!JSON.stringify(result).includes('database connection string'));
  assert.equal(result.data.surface.view.id, 'execution_outcome_card');
});

test('P0-12: nominal 200/error mutation response is not accepted as success', async t => {
  ensureFunds();
  const sid = 'failure_invalid_success';
  assert.equal((await intent(sid)).status, 200);
  const original = domainHandlers.wallet;
  t.mock.method(domainHandlers, 'wallet', (method, path, query, body) => method === 'POST'
    ? { status: 200, data: { success: true, error: 'conflicting result' } } : original(method, path, query, body));
  const before = balance, rides = activeRides.size;
  const result = await action(sid);
  assert.equal(result.status, 502); assert.equal(result.data.outcome, 'UNKNOWN');
  assert.equal(balance, before); assert.equal(activeRides.size, rides);
});

test('P0-12: incomplete mutation receipt is UNKNOWN rather than an undefined-value success card', async t => {
  ensureFunds();
  const sid = 'failure_missing_receipt';
  assert.equal((await intent(sid)).status, 200);
  const original = domainHandlers.wallet;
  t.mock.method(domainHandlers, 'wallet', (method, path, query, body) => method === 'POST'
    ? { status: 200, data: { success: true } } : original(method, path, query, body));
  const result = await action(sid);
  assert.equal(result.status, 502);
  assert.equal(result.data.outcome, 'UNKNOWN');
  assert.equal(result.data.surface.view.id, 'execution_outcome_card');
});

test('P0-12: operation tracking remains isolated between interleaved requests', async () => {
  const a: Step[] = [], b: Step[] = [];
  await Promise.all([
    trackDomainOperations(a, async () => { await Promise.resolve(); callDomain('wallet', 'POST', '/wallet/topup', {}, { amount: 0.01 }); }),
    trackDomainOperations(b, async () => { await Promise.resolve(); assert.throws(() => callDomain('ride', 'POST', '/rides/book', {}, { driverId: 'missing' })); }),
  ]);
  assert.deepEqual(a.map(step => step.state), ['SUCCEEDED']);
  assert.deepEqual(b.map(step => step.state), ['FAILED']);
});

test('P0-12: actual HTTP action and SSE render expose the same failed outcome', async t => {
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); });
  const sid = 'failure_http_fines_session';
  const base = `http://127.0.0.1:${(server.address() as any).port}`;
  const post = (path: string, body: any) => fetch(base + path, { method: 'POST',
    headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  assert.equal((await post('/api/a2ui/intent', { sessionId: sid, text: 'Check police fines' })).status, 200);
  const abort = new AbortController();
  const response = await fetch(base + '/api/a2ui/stream?sessionId=' + sid, { signal: AbortSignal.any([abort.signal, AbortSignal.timeout(5000)]) });
  const stream = readEventStream(response);
  await stream.next(); await stream.next(); // handshake + snapshot
  const actionResponse = await post('/api/a2ui/action', { sessionId: sid, surfaceRevision: getOrCreateSession(sid).currentSurface?.revision, action: 'pay_police_fines', payload: offered(sid,'pay_police_fines') });
  assert.equal(actionResponse.status, 400);
  const result = await actionResponse.json();
  while (true) {
    const event = await stream.next(); assert.equal(event.done, false);
    const message = JSON.parse(event.value!.data);
    if (message.type === 'A2UI_RENDER_SURFACE') {
      assert.equal(message.data.surface.view.id, result.surface.view.id);
      assert.equal(message.data.surface.view.id, 'execution_outcome_card');
      break;
    }
  }
  abort.abort(); await stream.return(undefined);
});

test('P0-12: move-in planning does not claim activation before approval', async () => {
  const result = await intent('failure_movein_plan_session', 'I signed my Ejari lease; connect my utilities and parking');
  assert.equal(result.status, 200);
  assert.equal(result.data.outcome, 'SUCCEEDED');
  assert.deepEqual(result.data.steps, [], 'Planning must have no effects');
  assert.ok(result.data.surface.view.children.some((node: any) => node.id === 'dewa_connection_metric' && node.properties.value === 'Pending approval'));
});

test('P1-13: a move-in receipt for another contract blocks parking and a replacement', async t => {
  const sid = 'failure_movein_receipt_mismatch';
  assert.equal((await intent(sid, 'I signed my Ejari lease; connect my utilities and parking')).status, 200);
  const realCatalog = domainHandlers.catalog;
  t.mock.method(domainHandlers, 'catalog', (method, path, query, body) => {
    const result = realCatalog(method, path, query, body);
    return method === 'POST' ? { ...result, data: { ...result.data, ejariContract: 'other-contract' } } : result;
  });
  const before = activeParkingMeters.size;
  const review = offered(sid, 'confirm_movein');
  const result = await action(sid, 'confirm_movein');
  assert.equal(result.data.outcome, 'UNKNOWN');
  assert.equal(result.data.steps[0].state, 'UNKNOWN');
  assert.equal(activeParkingMeters.size, before);
  assert.equal((await core('POST', '/api/a2ui/action', {}, { sessionId: sid, surfaceRevision: getOrCreateSession(sid).currentSurface?.revision, action: 'confirm_movein', payload: review })).data.code, 'RECONCILIATION_REQUIRED');
  assert.equal(activeParkingMeters.size, before);
});

test('P1-13: move-in approval binds the reviewed tenancy and premise and refuses changed details', async t => {
  const sid = 'failure_movein_changed_review';
  assert.equal((await intent(sid, 'I signed my Ejari lease; connect my utilities and parking')).status, 200);
  const review = offered(sid, 'confirm_movein');
  assert.ok(review.contractNumber);
  assert.ok(review.premiseId);
  const altered = await core('POST', '/api/a2ui/action', {}, { sessionId: sid, surfaceRevision: getOrCreateSession(sid).currentSurface?.revision, action: 'confirm_movein', payload: { ...review, premiseId: 'other-premise' } });
  assert.equal(altered.status, 403);
  const realCatalog = domainHandlers.catalog;
  let writes = 0;
  t.mock.method(domainHandlers, 'catalog', (method, path, query, body) => {
    if (method === 'POST') writes++;
    const result = realCatalog(method, path, query, body);
    return method === 'GET' && path === '/housing/ejari'
      ? { ...result, data: { ...result.data, contract: { ...result.data.contract, property: { ...result.data.contract.property, premiseId: 'changed-premise' } } } }
      : result;
  });
  const before = activeParkingMeters.size;
  const result = await action(sid, 'confirm_movein');
  assert.equal(result.status, 409);
  assert.equal(writes, 0);
  assert.equal(activeParkingMeters.size, before);
});
