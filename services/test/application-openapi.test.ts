import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import SwaggerParser from '@apidevtools/swagger-parser';
import { buildApplicationOpenApi, APPLICATION_OPERATIONS, APPLICATION_SERVICES } from '../../packages/backend-kit/src/application-openapi.ts';
import { requestSchema } from '../../packages/protocol-core/src/request-validation.ts';
import { Ajv } from 'ajv';

const checkedIn = new URL('../../packages/backend-kit/openapi/application-apis.openapi.json', import.meta.url);
const handlerSources = ['../../packages/backend-kit/src/application.ts', '../../packages/protocol-core/src/request-validation.ts']
  .map(path => readFileSync(new URL(path, import.meta.url), 'utf8')).join('\n');

test('checked-in application OpenAPI document equals generator output and is valid OpenAPI 3.1', async () => {
  const text = readFileSync(checkedIn, 'utf8');
  assert.equal(text, JSON.stringify(buildApplicationOpenApi(), null, 2) + '\n');
  const document = JSON.parse(text);
  assert.equal(document.openapi, '3.1.0');
  await SwaggerParser.validate(structuredClone(document));
});

test('every documented application path exists in the handler and route sources it was built from', () => {
  for (const operation of APPLICATION_OPERATIONS) {
    assert.ok(operation.service in APPLICATION_SERVICES, `${operation.operationId} has an unknown service`);
    if (!operation.manualSchema) {
      // Validated routes must exist in the protocol-core route table (throws when missing).
      requestSchema(operation.service, operation.method, operation.contract ?? operation.path);
    }
    const staticSegments = operation.path.split('/').filter(segment => segment && !segment.startsWith('{'));
    for (const segment of staticSegments) {
      assert.ok(handlerSources.includes(segment), `${operation.method} ${operation.path}: "${segment}" not found in handler sources`);
    }
  }
});

test('application OpenAPI document documents bearer auth and no duplicate operations', () => {
  const document = buildApplicationOpenApi();
  assert.deepEqual(document.components.securitySchemes.bearerAuth, {
    type: 'http', scheme: 'bearer', bearerFormat: 'JWT',
    description: document.components.securitySchemes.bearerAuth.description,
  });
  const seen = new Set<string>();
  for (const operation of APPLICATION_OPERATIONS) {
    const key = `${operation.method} ${operation.path}`;
    assert.ok(!seen.has(key), `duplicate ${key}`);
    seen.add(key);
  }
});

test('integrated grouped-checkout contracts require the reviewed payable selection', () => {
  const document = buildApplicationOpenApi();
  for(const path of ['/pay/unified','/pay/multi-agency']) {
    const operation = document.paths[path].post as { requestBody: { content: { 'application/json': { schema: { required: string[] } } } } };
    assert.ok(operation.requestBody.content['application/json'].schema.required.includes('expectedPayables'));
  }
});

test('integrated payment receipt contracts describe types and reject malformed success responses', () => {
  const document = buildApplicationOpenApi(), ajv = new Ajv({ strict: false });
  const check = (path: string) => {
    const operation = document.paths[path].post as { responses: { '200': { content: { 'application/json': { schema: object } } } } };
    return ajv.compile(operation.responses['200'].content['application/json'].schema);
  };
  const fines = check('/fines/pay');
  const fineReceipt = { success: true, receiptNumber: 'receipt-1', finesCleared: 1, fineIds: ['fine-1'], amountPaid: 10, remainingBalance: 50 };
  assert.equal(fines(fineReceipt), true);
  for (const invalid of [{ ...fineReceipt, success: false }, { ...fineReceipt, fineIds: 'fine-1' }, { ...fineReceipt, finesCleared: 1.5 }, { ...fineReceipt, amountPaid: '10' }]) assert.equal(fines(invalid), false);
  const bill = check('/utilities/pay');
  const billReceipt = { success: true, bill: { billId: 'bill-1' }, chargedAmount: 45, receipt: { billId: 'bill-1', receiptNumber: 'r1', amountPaid: '45.00', currency: 'AED' } };
  assert.equal(bill(billReceipt), true);
  for (const invalid of [{ ...billReceipt, chargedAmount: '45' }, { ...billReceipt, receipt: { ...billReceipt.receipt, currency: 'USD' } }, { ...billReceipt, receipt: { ...billReceipt.receipt, amountPaid: '45 AED' } }, { ...billReceipt, receipt: { ...billReceipt.receipt, receiptNumber: '' } }, { ...billReceipt, receipt: { ...billReceipt.receipt, receiptNumber: undefined } }]) assert.equal(bill(invalid), false);
  for (const path of ['/mobility/salik/recharge', '/telecom/{provider}/prepaid/recharges']) {
    const recharge = check(path), receipt = { success: true, transactionId: 'tx-1', newBalance: 20, amountRecharged: 10 };
    assert.equal(recharge(receipt), true);
    assert.equal(recharge({ ...receipt, amountRecharged: '10' }), false);
  }
});


test('wallet payment and top-up success schemas require typed transaction evidence', () => {
  const document = buildApplicationOpenApi(), ajv = new Ajv({ strict: false });
  const check = (path: string) => {
    const operation = document.paths[path].post as { responses: { '200': { content: { 'application/json': { schema: object } } } } };
    return ajv.compile(operation.responses['200'].content['application/json'].schema);
  };
  const transaction = { id: 'tx-1', type: 'PAYMENT', amount: 10, currency: 'AED', status: 'SETTLED' };
  const charge = { id: 'tx-1', accountId: 'account-1', amountMinor: 1000, merchant: 'superapp', reference: 'ref-1', source: 'wallet', currency: 'AED', status: 'CAPTURED', refunded: false };
  const payment = { success: true, transaction, charge, remainingBalance: 90 };
  const pay = check('/wallet/pay'); assert.equal(pay(payment), true);
  for (const invalid of [{ ...payment, charge: undefined }, { ...payment, charge: { ...charge, amountMinor: '1000' } }, { ...payment, transaction: { ...transaction, currency: 'USD' } }, { ...payment, transaction: { ...transaction, status: 'PENDING' } }, { ...payment, remainingBalance: '90' }, { ...payment, success: false }]) assert.equal(pay(invalid), false);
  const topup = { success: true, transaction: { ...transaction, type: 'TOPUP' }, newBalance: 110 };
  const fund = check('/wallet/topup'); assert.equal(fund(topup), true);
  for (const invalid of [{ ...topup, transaction: undefined }, { ...topup, transaction: { ...topup.transaction, type: 'PAYMENT' } }, { ...topup, newBalance: -1 }, { ...topup, success: false }]) assert.equal(fund(invalid), false);
});
