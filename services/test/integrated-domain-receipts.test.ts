import { removeTemp } from '../../test/support/temp-cleanup.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import { Ajv } from 'ajv';
import { buildApplicationOpenApi } from '../../packages/backend-kit/src/application-openapi.ts';
import { mkdtemp } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { actorContext, actorFor } from '../../packages/backend-kit/src/context.ts';
import { integratedRequest } from '../../packages/backend-kit/src/application.ts';
import { ProviderClient, providerOperationKey } from '../../packages/backend-kit/src/provider-client.ts';
import { AccountDatabase } from '../provider-simulator/src/database.ts';
import { ProviderEngine } from '../provider-simulator/src/engine.ts';
import { callDomainAsync, trackDomainOperations, type Step } from '../agent-core/src/domain-operations.ts';

test('integrated ride and food responses pass the compatibility adapter with their selected resources', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'integrated-domain-'));
  const previousDir = process.env.APP_DATA_DIR, previousTransport = process.env.DOMAIN_TRANSPORT;
  process.env.APP_DATA_DIR = dir; process.env.DOMAIN_TRANSPORT = 'http';
  const store = new AccountDatabase(':memory:'), actor = actorFor({ sub: 'integrated-receipt-test' }, undefined, 'Bearer test');
  const engine = new ProviderEngine('rta', store); store.accounts(actor.sub); engine.seed(actor);
  t.after(() => { store.close(); if (previousDir === undefined) delete process.env.APP_DATA_DIR; else process.env.APP_DATA_DIR = previousDir; if (previousTransport === undefined) delete process.env.DOMAIN_TRANSPORT; else process.env.DOMAIN_TRANSPORT = previousTransport; removeTemp(dir); });
  t.mock.method(ProviderClient.prototype, 'call', async (_provider, _actor, method, path, body) => store.transaction(() => engine.execute(actor, method, path, body)).data);
  assert.throws(() => store.transaction(() => engine.execute(actor, 'POST', '/rides/bookings', { driverId: 'drv_1', expectedFareMinor: 1 })));
  const wrongFood = await integratedRequest('service-food', actor, 'POST', '/orders/create', {}, { restaurantId: 'rest_1', items: ['item_diavola'], deliveryAddress: 'Address', expectedAmountMinor: 1 }, () => ({ status: 404, data: {} }));
  assert.equal(wrongFood.status, 409);
  const changedComponents = await integratedRequest('service-food', actor, 'POST', '/orders/create', {}, { restaurantId: 'rest_1', items: ['item_diavola'], deliveryAddress: 'Address', expectedAmountMinor: 2099, expectedItemPriceMinor: 1801, expectedDeliveryFeeMinor: 298 }, () => ({ status: 404, data: {} }));
  assert.equal(changedComponents.status, 409);
  t.mock.method(globalThis, 'fetch', async (input, init) => {
    const path = new URL(String(input)).pathname;
    const service = path.startsWith('/rides/') ? 'service-ride' : 'service-food';
    const result = await integratedRequest(service, actor, 'POST', path, {}, JSON.parse(String(init?.body)), () => ({ status: 404, data: {} }));
    return Response.json(result.data, { status: result.status });
  });
  const steps: Step[] = [];
  const document = buildApplicationOpenApi(), ajv = new Ajv({ strict: false });
  const schema = (path: string, method: 'get' | 'post') => {
    const operation = document.paths[path][method] as { responses: { '200': { content: { 'application/json': { schema: object } } } } };
    return ajv.compile(operation.responses['200'].content['application/json'].schema);
  };
  const run = () => actorContext.run(actor, async () => {
    const ride = await callDomainAsync('ride', 'POST', '/rides/book', {}, { driverId: 'drv_1', pickup: 'Origin', dropoff: 'Destination' });
    assert.equal(ride.data.booking.driver.id, 'drv_1');
    const booking = schema('/rides/book', 'post');
    assert.equal(booking(ride.data), true);
    assert.equal(booking({ ...ride.data, booking: { ...ride.data.booking, fare: '22' } }), false);
    assert.equal(booking({ ...ride.data, booking: { ...ride.data.booking, driver: {} } }), false);
    const operationId = 'ride-operation-1';
    store.db.prepare('INSERT INTO idempotency(account_id,key,fingerprint,status,body) VALUES(?,?,?,?,?)')
      .run(actor.accountId, providerOperationKey(operationId, 'rta', '/rides/bookings'), 'a'.repeat(64), 200, JSON.stringify(ride.data));
    const recovered = await integratedRequest('service-ride', actor, 'GET', `/rides/operations/${operationId}`, {}, {}, () => ({ status: 404, data: {} }));
    assert.equal(recovered.status, 200);
    const inspect = schema('/rides/operations/{operationId}', 'get');
    assert.equal(inspect(recovered.data), true);
    assert.equal(inspect({ ...recovered.data, operationId: '' }), false);
    assert.equal(inspect({ ...recovered.data, booking: { ...ride.data.booking, status: 'PENDING' } }), false);
    const food = await callDomainAsync('food', 'POST', '/orders/create', {}, { restaurantId: 'rest_1', items: ['item_diavola'], deliveryAddress: 'Address' });
    assert.equal(food.data.order.restaurantId, 'rest_1');
    assert.equal(food.data.order.deliveryAddress, 'Address');
  });
  await trackDomainOperations(steps, run);
  assert.deepEqual(steps.map(step => step.state), ['SUCCEEDED', 'SUCCEEDED']);
});

test('integrated wallet payment and top-up receipts pass with AED and the requested amount', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'integrated-wallet-'));
  const previousDir = process.env.APP_DATA_DIR, previousTransport = process.env.DOMAIN_TRANSPORT, previousIntegration = process.env.PROVIDER_INTEGRATION;
  process.env.APP_DATA_DIR = dir; process.env.DOMAIN_TRANSPORT = 'http'; process.env.PROVIDER_INTEGRATION = 'true';
  const store = new AccountDatabase(':memory:'), actor = actorFor({ sub: 'integrated-wallet-receipt' }, undefined, 'Bearer test');
  const engine = new ProviderEngine('payments', store); store.accounts(actor.sub); engine.seed(actor);
  t.after(() => { store.close(); if (previousDir === undefined) delete process.env.APP_DATA_DIR; else process.env.APP_DATA_DIR = previousDir; if (previousTransport === undefined) delete process.env.DOMAIN_TRANSPORT; else process.env.DOMAIN_TRANSPORT = previousTransport; if (previousIntegration === undefined) delete process.env.PROVIDER_INTEGRATION; else process.env.PROVIDER_INTEGRATION = previousIntegration; removeTemp(dir); });
  t.mock.method(ProviderClient.prototype, 'call', async (_provider, _actor, method, path, body) => store.transaction(() => engine.execute(actor, method, path, body)).data);
  t.mock.method(globalThis, 'fetch', async (input, init) => {
    const result = await integratedRequest('service-wallet', actor, 'POST', new URL(String(input)).pathname, {}, JSON.parse(String(init?.body)), () => ({ status: 404, data: {} }));
    return Response.json(result.data, { status: result.status });
  });
  const steps: Step[] = [], document = buildApplicationOpenApi(), ajv = new Ajv({ strict: false });
  const schema = (path: string) => {
    const operation = document.paths[path].post as { responses: { '200': { content: { 'application/json': { schema: object } } } } };
    return ajv.compile(operation.responses['200'].content['application/json'].schema);
  };
  await trackDomainOperations(steps, () => actorContext.run(actor, async () => {
    const payment = await callDomainAsync('wallet', 'POST', '/wallet/pay', {}, { amount: 10, purpose: 'Demo' });
    assert.equal(payment.data.transaction.currency, 'AED');
    assert.equal(schema('/wallet/pay')(payment.data), true);
    const topup = await callDomainAsync('wallet', 'POST', '/wallet/topup', {}, { amount: 5 });
    assert.equal(topup.data.transaction.currency, 'AED');
    assert.equal(schema('/wallet/topup')(topup.data), true);
  }));
  assert.deepEqual(steps.map(step => step.state), ['SUCCEEDED', 'SUCCEEDED']);
});
