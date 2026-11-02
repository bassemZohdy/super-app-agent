import test from 'node:test';
import assert from 'node:assert/strict';
import { Ajv } from 'ajv';
import { buildApplicationOpenApi } from '../../packages/backend-kit/src/application-openapi.ts';
import { integratedRequest } from '../../packages/backend-kit/src/application.ts';
import { actorFor } from '../../packages/backend-kit/src/context.ts';
import { ProviderClient, walletChargeKey } from '../../packages/backend-kit/src/provider-client.ts';
import { AccountDatabase } from '../provider-simulator/src/database.ts';
import { ProviderEngine } from '../provider-simulator/src/engine.ts';

test('wallet operation inspection schema matches real captured evidence and rejects malformed fields', async t => {
  const store = new AccountDatabase(':memory:'); t.after(() => store.close());
  const engine = new ProviderEngine('payments', store), actor = actorFor({ sub: 'schema-wallet-owner' });
  actor.requestId = 'schema:wallet:operation';
  store.accounts(actor.sub); engine.seed(actor);
  const captured = store.transaction(() => engine.execute(actor, 'POST', '/charges', { amountMinor: 1025, merchant: 'superapp', reference: 'reference-1', operationId: actor.requestId, source: 'wallet' }));
  assert.equal(captured.status, 200);
  store.db.prepare('INSERT INTO idempotency(account_id,key,fingerprint,status,body) VALUES(?,?,?,?,?)').run(actor.accountId, walletChargeKey(actor.accountId, 'superapp', actor.requestId), 'a'.repeat(64), 200, JSON.stringify(captured.data));
  t.mock.method(ProviderClient.prototype, 'call', async (provider, who, method, path) => {
    assert.equal(provider, 'payments');
    return store.transaction(() => engine.execute(who, method, path, {})).data;
  });
  const result = await integratedRequest('service-wallet', actor, 'GET', `/wallet/operations/${actor.requestId}`, {}, {}, () => ({ status: 404, data: {} }));
  assert.equal(result.status, 200);
  const operation = buildApplicationOpenApi().paths['/wallet/operations/{operationId}'].get as { responses: { '200': { content: { 'application/json': { schema: object } } } } };
  const validate = new Ajv({ strict: false }).compile(operation.responses['200'].content['application/json'].schema);
  assert.equal(validate(result.data), true, 'actual confirmed provider evidence meets the contract');
  const { charge, transaction } = result.data;
  for (const invalid of [
    { ...result.data, success: false }, { ...result.data, operationId: '' }, { ...result.data, operationId: '../escape' },
    { ...result.data, charge: { ...charge, amountMinor: '1025' } }, { ...result.data, charge: { ...charge, currency: 'USD' } },
    { ...result.data, charge: { ...charge, status: 'DECLINED' } }, { ...result.data, charge: { ...charge, refunded: true } },
    { ...result.data, transaction: { ...transaction, amount: '10.25' } }, { ...result.data, transaction: { ...transaction, status: 'PENDING' } },
    { ...result.data, transaction: { ...transaction, referenceId: undefined } }, { ...result.data, transaction: { ...transaction, purpose: undefined } },
  ]) assert.equal(validate(invalid), false, 'malformed recovery evidence must not satisfy the contract');
  // A verified pre-operation-ID record uses the original reference as its lookup identity.
  const { operationId: _chargeOperationId, ...legacyCharge } = charge;
  const { operationId: _transactionOperationId, ...legacyTransaction } = transaction;
  store.put(actor.accountId, 'charge', legacyCharge, legacyCharge.id);
  store.put(actor.accountId, 'transaction', legacyTransaction, legacyTransaction.id);
  store.db.prepare('INSERT INTO idempotency(account_id,key,fingerprint,status,body) VALUES(?,?,?,?,?)').run(actor.accountId, walletChargeKey(actor.accountId, 'superapp', legacyCharge.reference), 'b'.repeat(64), 200, JSON.stringify({ success: true, charge: legacyCharge, transaction: legacyTransaction }));
  const legacy = await integratedRequest('service-wallet', actor, 'GET', `/wallet/operations/${legacyCharge.reference}`, {}, {}, () => ({ status: 404, data: {} }));
  assert.equal(legacy.status, 200); assert.equal(validate(legacy.data), true, 'verified legacy evidence remains documented');
});
