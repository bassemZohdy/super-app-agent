import test from 'node:test';
import assert from 'node:assert/strict';

import { executeRideRequest } from '../service-ride/src/index.ts';
import { executeFoodRequest } from '../service-food/src/index.ts';
import { executeWalletRequest } from '../service-wallet/src/index.ts';
import { executeCatalogRequest } from '../service-catalog/src/index.ts';

test('service-ride: health, ride options, booking and tracking', () => {
  const health = executeRideRequest('GET', '/health');
  assert.strictEqual(health.status, 200);
  assert.strictEqual(health.data.service, 'service-ride');

  const options = executeRideRequest('GET', '/rides/options', { destination: 'Airport' });
  assert.strictEqual(options.status, 200);
  assert.strictEqual(options.data.success, true);
  assert.ok(options.data.options.length >= 2);

  const book = executeRideRequest('POST', '/rides/book', {}, {
    driverId: options.data.options[0].id,
    dropoff: 'Airport Terminal 2',
  });
  assert.strictEqual(book.status, 200);
  assert.strictEqual(book.data.success, true);
  assert.strictEqual(book.data.booking.status, 'DISPATCHED');
  assert.ok(book.data.booking.bookingId);

  const tracking = executeRideRequest('GET', `/rides/track/${book.data.booking.bookingId}`);
  assert.strictEqual(tracking.status, 200);
  assert.strictEqual(tracking.data.success, true);
  assert.ok(tracking.data.currentLocation);

  const mcp = executeRideRequest('GET', '/mcp');
  assert.strictEqual(mcp.status, 200);
  assert.strictEqual(mcp.data.protocol, 'mcp-1.0');
  assert.ok(mcp.data.tools.some((t: any) => t.name === 'ride_getOptions'));
});

test('service-food: health, restaurant search, create order and tracking', () => {
  const health = executeFoodRequest('GET', '/health');
  assert.strictEqual(health.status, 200);
  assert.strictEqual(health.data.service, 'service-food');

  const search = executeFoodRequest('GET', '/restaurants/search', { query: 'pizza' });
  assert.strictEqual(search.status, 200);
  assert.strictEqual(search.data.success, true);
  assert.ok(search.data.restaurants.length > 0);

  const rest = search.data.restaurants[0];
  const order = executeFoodRequest('POST', '/orders/create', {}, {
    restaurantId: rest.id,
    items: [rest.items[0].id],
  });
  assert.strictEqual(order.status, 200);
  assert.strictEqual(order.data.success, true);
  assert.strictEqual(order.data.order.status, 'ACCEPTED_BY_KITCHEN');
  assert.ok(order.data.order.totalAmount > 0);

  const tracking = executeFoodRequest('GET', `/orders/track/${order.data.order.orderId}`);
  assert.strictEqual(tracking.status, 200);
  assert.strictEqual(tracking.data.success, true);

  const mcp = executeFoodRequest('GET', '/mcp');
  assert.strictEqual(mcp.status, 200);
  assert.ok(mcp.data.tools.some((t: any) => t.name === 'food_searchRestaurants'));
});

test('service-wallet: health, balance, payment and topup', () => {
  const health = executeWalletRequest('GET', '/health');
  assert.strictEqual(health.status, 200);
  assert.strictEqual(health.data.service, 'service-wallet');

  const balBefore = executeWalletRequest('GET', '/wallet/balance');
  assert.strictEqual(balBefore.status, 200);
  const initialBalance = balBefore.data.balance;
  assert.ok(initialBalance > 0);

  const pay = executeWalletRequest('POST', '/wallet/pay', {}, {
    amount: 15.0,
    purpose: 'Test Ride Payment',
  });
  assert.strictEqual(pay.status, 200);
  assert.strictEqual(pay.data.remainingBalance, Math.round((initialBalance - 15.0) * 100) / 100);

  const topup = executeWalletRequest('POST', '/wallet/topup', {}, {
    amount: 50.0,
    source: 'Apple Pay',
  });
  assert.strictEqual(topup.status, 200);
  assert.strictEqual(topup.data.newBalance, Math.round((initialBalance - 15.0 + 50.0) * 100) / 100);

  const ledger = executeWalletRequest('GET', '/wallet/transactions');
  assert.strictEqual(ledger.status, 200);
  assert.ok(ledger.data.transactions.length >= 4);

  const mcp = executeWalletRequest('GET', '/mcp');
  assert.strictEqual(mcp.status, 200);
  assert.ok(mcp.data.tools.some((t: any) => t.name === 'wallet_getBalance'));
});

test('service-catalog: health, miniapps list and tool registry', () => {
  const health = executeCatalogRequest('GET', '/health');
  assert.strictEqual(health.status, 200);
  assert.strictEqual(health.data.service, 'service-catalog');

  const apps = executeCatalogRequest('GET', '/miniapps');
  assert.strictEqual(apps.status, 200);
  assert.strictEqual(apps.data.count, 3);
  assert.ok(apps.data.miniApps.some((a: any) => a.id === 'org.superapp.ride'));

  const single = executeCatalogRequest('GET', '/miniapps/org.superapp.ride');
  assert.strictEqual(single.status, 200);
  assert.strictEqual(single.data.miniApp.name, 'Ride & Mobility');

  const tools = executeCatalogRequest('GET', '/tools');
  assert.strictEqual(tools.status, 200);
  assert.strictEqual(tools.data.success, true);
  assert.ok(tools.data.registeredTools.length >= 9);
});
