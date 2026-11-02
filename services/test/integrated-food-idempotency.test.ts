import { removeTemp } from '../../test/support/temp-cleanup.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { actorFor } from '../../packages/backend-kit/src/context.ts';
import { createApplicationServer, integratedRequest } from '../../packages/backend-kit/src/application.ts';
import { AccountDatabase } from '../provider-simulator/src/database.ts';
import { restaurants } from '../service-food/src/index.ts';
import { buildApplicationOpenApi } from '../../packages/backend-kit/src/application-openapi.ts';
import { Ajv } from 'ajv';
import { createHash } from 'node:crypto';

test('integrated food order retries retain the original order across application restart', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'food-idempotency-')), previous = process.env.APP_DATA_DIR;
  process.env.APP_DATA_DIR = dir;
  const actor = actorFor({ sub: 'food-order-owner' }); actor.requestId = 'review:food-order';
  const other = actorFor({ sub: 'another-owner' }); other.requestId = actor.requestId;
  const body = { restaurantId: 'rest_1', items: ['item_diavola'], deliveryAddress: '100 Market St, Apt 4B', expectedAmountMinor: 2099, expectedItemPriceMinor: 1800, expectedDeliveryFeeMinor: 299 };
  const legacy = () => ({ status: 404, data: {} });
  const run = (who = actor, input = body) => integratedRequest('service-food', who, 'POST', '/orders/create', {}, input, legacy);
  const price = restaurants[0].items[0].price;
  t.after(() => { restaurants[0].items[0].price = price; if (previous === undefined) delete process.env.APP_DATA_DIR; else process.env.APP_DATA_DIR = previous; removeTemp(dir); });
  const { deliveryAddress: _address, ...withoutAddress } = body;
  const omitted = await run(actor, withoutAddress as typeof body);
  assert.equal(omitted.status, 400, 'a new order needs an explicit delivery address');
  const reordered = { expectedDeliveryFeeMinor: 299, expectedItemPriceMinor: 1800, expectedAmountMinor: 2099, deliveryAddress: body.deliveryAddress, items: ['item_diavola'], restaurantId: 'rest_1' };
  const [first, replay] = await Promise.all([run(), run(actor, reordered)]);
  assert.equal(first.status, 200); assert.deepEqual(replay.data, first.data);
  const inspect = (who = actor, operationId = actor.requestId) => integratedRequest('service-food', who, 'GET', `/orders/operations/${encodeURIComponent(operationId)}`, {}, {}, legacy);
  const inspected = await inspect(); assert.equal(inspected.status, 200); assert.deepEqual(inspected.data.order, first.data.order);
  const document = buildApplicationOpenApi(), ajv = new Ajv({ strict: false });
  const responseSchema = (path: string, method: 'get' | 'post') => {
    const operation = document.paths[path][method] as { responses: { '200': { content: { 'application/json': { schema: object } } } } };
    return ajv.compile(operation.responses['200'].content['application/json'].schema);
  };
  const createSchema = responseSchema('/orders/create', 'post'), inspectSchema = responseSchema('/orders/operations/{operationId}', 'get');
  assert.equal(createSchema(first.data), true, 'the generated contract accepts the real created order');
  assert.equal(inspectSchema(inspected.data), true, 'the generated contract accepts the real recovery response');
  for (const invalid of [
    { ...first.data, order: { ...first.data.order, orderId: '' } },
    { ...first.data, order: { ...first.data.order, items: 'item_diavola' } },
    { ...first.data, order: { ...first.data.order, items: [{ ...first.data.order.items[0], price: '18' }] } },
    { ...first.data, order: { ...first.data.order, totalAmount: '20.99' } },
    { ...first.data, order: { ...first.data.order, status: 'PENDING' } },
    { ...first.data, success: false },
  ]) assert.equal(createSchema(invalid), false, 'malformed order evidence must not satisfy the contract');
  assert.equal(inspectSchema({ ...inspected.data, operationId: '' }), false);

  assert.equal((await inspect(other)).status, 404, 'another account cannot inspect the original operation');
  assert.equal((await inspect(actor, 'missing-operation')).status, 404);
  assert.equal((await inspect(actor, '../invalid')).status, 400);
  const inspector = new AccountDatabase(join(dir, 'service-food.sqlite')); t.after(() => inspector.close());
  assert.equal(inspector.list(actor.accountId, 'order').length, 1);
  const conflict = await run(actor, { ...body, expectedAmountMinor: 2100 });
  assert.equal(conflict.status, 409); assert.equal(conflict.data.code, 'IDEMPOTENCY_CONFLICT');
  assert.equal(inspector.list(actor.accountId, 'order').length, 1);
  restaurants[0].items[0].price = price + 1;
  assert.deepEqual((await run()).data, first.data, 'the original receipt survives later price changes');
  restaurants[0].items[0].price = price;
  const secondAccount = await run(other); assert.equal(secondAccount.status, 200);
  assert.notEqual(secondAccount.data.order.orderId, first.data.order.orderId);
  const server = createApplicationServer('service-food', legacy);
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  await new Promise<void>(resolve => server.close(() => resolve()));
  const reopened = await run(); assert.deepEqual(reopened.data, first.data);
  assert.equal(inspector.list(actor.accountId, 'order').length, 1);
  const original = inspector.get<Record<string, unknown>>(actor.accountId, 'order', first.data.order.orderId)!;
  inspector.put(actor.accountId, 'order', { ...original, totalAmount: 999 }, first.data.order.orderId);
  const altered = await run(); assert.equal(altered.status, 503); assert.equal(altered.data.code, 'PROVIDER_OUTCOME_UNKNOWN');
  assert.equal((await inspect()).status, 503, 'inspection must not present altered evidence as confirmed');
  assert.equal(inspector.list(actor.accountId, 'order').length, 1, 'changed evidence never creates a replacement order');
  inspector.put(actor.accountId, 'order', original, first.data.order.orderId);
  const row = inspector.db.prepare("SELECT id, body FROM resources WHERE account_id=? AND kind='food-order-operation'").get(actor.accountId) as { id: string; body: string };
  const saved = JSON.parse(row.body) as { fingerprint: string; orderId: string; receiptDigest?: string; version?: number; request?: Record<string, unknown> };
  assert.equal(saved.version, 2);
  assert.deepEqual(saved.request, body, 'new order records retain the original request for later inspection');
  const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value, (_key, item: unknown) => item && typeof item === 'object' && !Array.isArray(item) ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)) : item)).digest('hex');
  for (const invalid of [
    { ...original, status: 'PENDING' }, { ...original, deliveryAddress: '' }, { ...original, restaurantId: '' },
    { ...original, items: [] }, { ...original, totalAmount: 0.01 }, { ...original, totalAmount: 20.999 },
    { ...original, items: [{ ...first.data.order.items[0], price: 18.001 }] },
    { ...original, items: [first.data.order.items[0], first.data.order.items[0]] },
  ]) {
    inspector.put(actor.accountId, 'order', invalid, first.data.order.orderId);
    inspector.put(actor.accountId, 'food-order-operation', { ...saved, receiptDigest: digest(invalid) }, row.id);
    assert.equal((await inspect()).status, 503, 'matching but malformed order evidence is not confirmed');
    assert.equal((await run()).status, 503, 'malformed original cannot be replayed as success');
    assert.equal((await run({ ...actor, requestId: 'new-food-operation' })).status, 503, 'malformed evidence holds new orders');
    assert.deepEqual((await run(other)).data, secondAccount.data, 'another account can replay its own order');
  }
  for (const mismatch of [
    { ...original, restaurantId: 'rest_2' }, { ...original, deliveryAddress: 'Different destination' },
    { ...original, items: [{ ...first.data.order.items[0], id: 'item_margherita' }] },
    { ...original, totalAmount: 21.99 },
    { ...original, items: [{ ...first.data.order.items[0], price: 18.01 }], totalAmount: 20.99 },
  ]) {
    inspector.put(actor.accountId, 'order', mismatch, first.data.order.orderId);
    inspector.put(actor.accountId, 'food-order-operation', { ...saved, receiptDigest: digest(mismatch) }, row.id);
    const outcome = await run();
    assert.equal(outcome.status, 503, 'a coherent receipt for different requested terms cannot be replayed');
    assert.equal(outcome.data.code, 'PROVIDER_OUTCOME_UNKNOWN');
    assert.equal((await inspect()).status, 503, 'inspection checks the persisted original request');
    assert.equal((await run({ ...actor, requestId: 'new-food-operation' })).status, 503, 'a mismatched binding holds new orders');
    assert.equal(inspector.list(actor.accountId, 'order').length, 1);
  }
  inspector.put(actor.accountId, 'order', original, first.data.order.orderId);
  inspector.put(actor.accountId, 'food-order-operation', saved, row.id);
  for (const request of [undefined, null, { ...body, deliveryAddress: 'Different destination' }]) {
    inspector.put(actor.accountId, 'food-order-operation', { ...saved, request }, row.id);
    assert.equal((await inspect()).status, 503, 'a versioned binding with a missing or altered request remains unconfirmed');
    assert.equal((await run()).status, 503);
  }
  const { version: _version, request: _request, ...olderBinding } = saved;
  inspector.put(actor.accountId, 'food-order-operation', { ...saved, request: null }, row.id);
  inspector.put(actor.accountId, 'food-order-operation', olderBinding, 'duplicate-old-binding');
  assert.equal((await run({ ...actor, requestId: 'new-food-operation' })).status, 503, 'an older duplicate cannot hide a damaged versioned binding');
  inspector.db.prepare("DELETE FROM resources WHERE account_id=? AND kind='food-order-operation' AND id='duplicate-old-binding'").run(actor.accountId);
  const olderMismatch = { ...original, deliveryAddress: 'Different destination' };
  inspector.put(actor.accountId, 'order', olderMismatch, first.data.order.orderId);
  inspector.put(actor.accountId, 'food-order-operation', { ...olderBinding, receiptDigest: digest(olderMismatch) }, row.id);
  assert.equal((await run()).status, 503, 'a mismatched older receipt cannot be upgraded');
  assert.equal(inspector.get<{ version?: number }>(actor.accountId, 'food-order-operation', row.id)?.version, undefined);
  inspector.put(actor.accountId, 'order', original, first.data.order.orderId);
  const legacyFingerprint = digest(withoutAddress);
  inspector.put(actor.accountId, 'food-order-operation', { ...olderBinding, fingerprint: legacyFingerprint }, row.id);
  assert.deepEqual((await run(actor, withoutAddress as typeof body)).data, first.data, 'the exact older request can replay without creating another order');
  assert.deepEqual(inspector.get<{ request?: unknown }>(actor.accountId, 'food-order-operation', row.id)?.request, withoutAddress);
  assert.deepEqual((await run(actor, withoutAddress as typeof body)).data, first.data, 'the upgraded older request remains replayable');
  assert.equal(inspector.list(actor.accountId, 'order').length, 1);
  inspector.put(actor.accountId, 'food-order-operation', olderBinding, row.id);
  assert.equal((await inspect()).status, 200, 'older records remain inspectable');
  assert.deepEqual((await run()).data, first.data, 'a matching original retry upgrades the record without a new order');
  const upgraded = inspector.get<{ version?: number; request?: unknown }>(actor.accountId, 'food-order-operation', row.id);
  assert.equal(upgraded?.version, 2); assert.deepEqual(upgraded?.request, body);
  inspector.put(actor.accountId, 'food-order-operation', saved, row.id);
  const { receiptDigest: _receiptDigest, ...legacyRecord } = saved;
  inspector.put(actor.accountId, 'food-order-operation', legacyRecord, row.id);
  const unbound = await run(); assert.equal(unbound.status, 503); assert.equal(unbound.data.code, 'PROVIDER_OUTCOME_UNKNOWN');
  inspector.put(actor.accountId, 'food-order-operation', null, row.id);
  const malformed = await run(); assert.equal(malformed.status, 503); assert.equal(malformed.data.code, 'PROVIDER_OUTCOME_UNKNOWN');
  assert.equal(inspector.list(actor.accountId, 'order').length, 1, 'malformed operation data never creates a replacement');
  inspector.put(actor.accountId, 'food-order-operation', saved, row.id);
  inspector.db.prepare("DELETE FROM resources WHERE account_id=? AND kind='food-order-operation' AND id=?").run(actor.accountId, row.id);
  try {
    assert.equal((await inspect()).status, 503, 'an orphaned order makes missing operation evidence uncertain');
    const attempts = await Promise.all([run(), run()]);
    for (const attempt of attempts) { assert.equal(attempt.status, 503); assert.equal(attempt.data.code, 'PROVIDER_OUTCOME_UNKNOWN'); }
    assert.equal(inspector.list(actor.accountId, 'order').length, 1, 'an orphaned order cannot be replaced');
    inspector.db.prepare("UPDATE resources SET body='{' WHERE account_id=? AND kind='order' AND id=?").run(actor.accountId, first.data.order.orderId);
    inspector.db.prepare("INSERT INTO resources(account_id,kind,id,body) VALUES(?,'food-order-operation','unreadable','{')").run(actor.accountId);
    assert.equal((await run()).status, 503, 'unreadable orphan evidence remains held');
    inspector.db.prepare("DELETE FROM resources WHERE account_id=? AND kind='food-order-operation' AND id='unreadable'").run(actor.accountId);
    inspector.put(actor.accountId, 'order', original, first.data.order.orderId);
    inspector.put(actor.accountId, 'food-order-operation', { orderId: first.data.order.orderId }, 'incomplete-binding');
    assert.equal((await run()).status, 503, 'an incomplete unrelated binding does not prove an order is linked');
    inspector.put(actor.accountId, 'food-order-operation', { ...saved, receiptDigest: '0'.repeat(64) }, 'incomplete-binding');
    assert.equal((await run()).status, 503, 'a binding must match the original receipt');
    inspector.db.prepare("DELETE FROM resources WHERE account_id=? AND kind='food-order-operation' AND id='incomplete-binding'").run(actor.accountId);
    const independent = { ...actor, requestId: 'another:food-order' };
    assert.equal((await run(independent)).status, 503, 'unlinked orders conservatively hold other new orders');
    assert.equal((await inspect(other, 'missing-operation')).status, 404, 'another account is unaffected');
    assert.deepEqual((await run(other)).data, secondAccount.data, 'another account can replay its own order');
    assert.equal((await run({ ...other, requestId: 'independent-order' })).status, 200, 'another account can create its own order');
  } finally {
    inspector.put(actor.accountId, 'food-order-operation', saved, row.id);
  }
  assert.deepEqual((await run()).data, first.data, 'restoring evidence permits the original replay');
  inspector.db.prepare("DELETE FROM resources WHERE account_id=? AND kind='order' AND id=?").run(actor.accountId, first.data.order.orderId);
  const missing = await run(); assert.equal(missing.status, 503); assert.equal(missing.data.code, 'PROVIDER_OUTCOME_UNKNOWN');
  assert.equal(inspector.list(actor.accountId, 'order').length, 0, 'missing evidence never causes a replacement order');
});
