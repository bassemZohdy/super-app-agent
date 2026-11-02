import { removeTemp } from '../../test/support/temp-cleanup.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { integratedRequest } from '../../packages/backend-kit/src/application.ts';
import { ProviderClient } from '../../packages/backend-kit/src/provider-client.ts';
import { actorFor, assetsFor } from '../../packages/backend-kit/src/context.ts';
import { restaurants } from '../service-food/src/index.ts';
import { buildApplicationOpenApi } from '../../packages/backend-kit/src/application-openapi.ts';
import { Ajv } from 'ajv';

function receiptSchema(path: string) {
  const operation = buildApplicationOpenApi().paths[path].post as { responses: { '200': { content: { 'application/json': { schema: object } } } } };
  return new Ajv({ strict: false }).compile(operation.responses['200'].content['application/json'].schema);
}

// Exercise the actual application mapping, not an invented UI receipt fixture.
test('integrated receipt mappings preserve utility premise, owned fine plate/discount and dining delivery fields', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'cityside-receipt-'));
  const previous = process.env.APP_DATA_DIR; process.env.APP_DATA_DIR = dir;
  t.after(async () => { if (previous === undefined) delete process.env.APP_DATA_DIR; else process.env.APP_DATA_DIR = previous; removeTemp(dir); });
  let status = 'UNPAID'; let captures = 0;
  const actor = actorFor({ sub: 'receipt-contract-user' }), asset = assetsFor(actor.accountId);
  const bill = { billId: 'dewa_contract_bill', premiseId: asset.premiseId, accountNumber: asset.utilityAccount, status, totalAmount: 420.4 };
  const payable = { id:'dewa:bill:dewa_contract_bill', obligationId:bill.billId, kind:'BILL', provider:'dewa', reference:asset.utilityAccount, amountMinor:42040, status:'UNPAID', revision:'a'.repeat(64) };
  let orderState='AWAITING_APPROVAL';
  const mappingOrder=()=>({id:'mapping-order',ownerSub:actor.sub,accountId:actor.accountId,state:orderState,version:orderState==='AWAITING_APPROVAL'?1:2,approvalDigest:'a'.repeat(64),fundsCaptured:orderState==='SETTLED',quote:{currency:'AED',source:{id:'wallet',kind:'wallet',accountId:actor.accountId,version:1},totalMinor:42040,payable},receipt:{receiptNumber:'receipt_contract_capture',obligationId:bill.billId,amountMinor:42040,currency:'AED'}});
  t.mock.method(ProviderClient.prototype, 'call', async (provider, _actor, method, route) => {
    if (provider === 'police' && method === 'GET') return { fines: [{ plateNumber: assetsFor(actor.accountId).plate, originalAmount: 450, discountAmount: 30, payableAmount: 420 }], count: 1, totalOriginal: 450, totalDiscount: 30, totalPayable: 420 };
    if (provider === 'dewa' && method === 'GET' && route === '/bills') { const currentStatus = status === 'UNPAID' && orderState === 'SETTLED' ? 'PAID' : status; return { bills: [{ ...bill, status: currentStatus, ...(currentStatus === 'PAID' ? { receiptNumber: 'receipt_contract_capture' } : {}) }] }; }
    if(provider==='dewa'&&route==='/payables')return{payables:[payable]};
    if(provider==='payments'&&route==='/billing-accounts')return{billingAccounts:[{status:'ACTIVE',provider:'dewa',reference:asset.utilityAccount}]};
    if(provider==='payments'&&route==='/payment-orders')return{order:mappingOrder()};
    if(provider==='payments'&&route==='/payment-orders/mapping-order')return{order:mappingOrder()};
    if(provider==='payments'&&route.endsWith('/approve')){orderState='AUTHORIZED';return{order:mappingOrder()};}
    if(provider==='payments'&&route.endsWith('/execute')){orderState='SETTLED';captures++;return{order:mappingOrder()};}
    if(provider==='payments'&&route==='/wallet')return{balance:1079.6};
    if (provider === 'dewa' && method === 'POST') return { success: true, receipt: { billId: bill.billId, receiptNumber: 'receipt_contract_capture', amountPaid: '420.40' } };
    throw new Error('Unexpected provider operation');
  });
  const legacy = () => ({ status: 404, data: {} });
  const currentBill = await integratedRequest('service-food', actor, 'GET', '/utilities/bill', {}, {}, legacy);
  assert.equal(currentBill.data.bill.payableId, payable.id); assert.equal(currentBill.data.bill.payableRevision, payable.revision);
  const pay = () => integratedRequest('service-food', actor, 'POST', '/utilities/pay', {}, { billId: bill.billId }, legacy);
  const paid = await pay(); assert.equal(paid.status, 200); assert.equal(paid.data.receipt.premiseId, bill.premiseId);
  status = 'PAID'; const replay = await pay(); assert.equal(replay.data.receipt.premiseId, bill.premiseId); assert.equal(captures, 1);
  const validReceipt = receiptSchema('/utilities/pay'); assert.equal(validReceipt(paid.data), true); assert.equal(validReceipt(replay.data), true);
  const mismatch = await integratedRequest('service-food', actor, 'POST', '/utilities/pay', {}, { billId: bill.billId, expectedAmountMinor: 42041 }, legacy);
  assert.equal(mismatch.status, 409); assert.equal(mismatch.data.code, 'PAYABLE_CHANGED'); assert.equal(captures, 1);
  const matching = await integratedRequest('service-food', actor, 'POST', '/utilities/pay', {}, { billId: bill.billId, expectedAmountMinor: 42040 }, legacy);
  assert.equal(matching.status, 200); assert.equal(captures, 1);
  status = 'CANCELLED'; const withdrawn=await pay();assert.equal(withdrawn.status,409);assert.equal(withdrawn.data.code,'PAYABLE_UNAVAILABLE');assert.equal(captures,1);
  const fines = await integratedRequest('service-wallet', actor, 'GET', '/fines/check', {}, {}, legacy);
  assert.equal(fines.data.plateNumber, assetsFor(actor.accountId).plate); assert.equal(fines.data.earlyDiscountAED, 30);
  const restaurant = restaurants[0];
  const order = await integratedRequest('service-food', actor, 'POST', '/orders/create', {}, { restaurantId: restaurant.id, items: [restaurant.items[0].id] }, legacy);
  assert.equal(order.status, 200); assert.equal(order.data.order.estimatedDeliveryTime, '25 min');
});

test('already-paid utility and telecom bills require a usable original receipt and exact amount without creating another payment', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'cityside-paid-bill-')), previous = process.env.APP_DATA_DIR;
  process.env.APP_DATA_DIR = dir;
  t.after(() => { if (previous === undefined) delete process.env.APP_DATA_DIR; else process.env.APP_DATA_DIR = previous; removeTemp(dir); });
  const actor = actorFor({ sub: 'paid-bill-evidence' }), asset = assetsFor(actor.accountId), legacy = () => ({ status: 404, data: {} });
  let receipt: unknown = 'paid-123', amount: unknown = 45, writes = 0, duplicate = false;
  t.mock.method(ProviderClient.prototype, 'call', async (_provider, _actor, method, route) => {
    if (method !== 'GET') writes++;
    if (method === 'GET' && route === '/bills') { const bill = { billId: 'bill123', status: 'PAID', totalAmount: amount, receiptNumber: receipt, accountNumber: asset.utilityAccount }; return { bills: duplicate ? [bill, { ...bill, receiptNumber: 'different' }] : [bill] }; }
    throw new Error('Unexpected provider operation');
  });
  for (const provider of ['dewa', 'du', 'etisalat']) {
    const pay = () => provider === 'dewa'
      ? integratedRequest('service-food', actor, 'POST', '/utilities/pay', {}, { billId: 'bill123', expectedAmountMinor: 4500 }, legacy)
      : integratedRequest('service-telecom', actor, 'POST', `/telecom/${provider}/bills/bill123/payments`, {}, { expectedAmountMinor: 4500 }, legacy);
    for (const invalid of [undefined, '', '   ', 123]) {
      receipt = invalid; amount = 45;
      const result = await pay(); assert.equal(result.status, 503); assert.equal(result.data.code, 'PROVIDER_OUTCOME_UNKNOWN');
    }
    receipt = 'paid-123';
    for (const invalid of [NaN, -45, 45.001, '45']) {
      amount = invalid;
      const result = await pay(); assert.equal(result.status, 503); assert.equal(result.data.code, 'PROVIDER_OUTCOME_UNKNOWN');
    }
    amount = 45; duplicate = true; const ambiguous = await pay(); assert.equal(ambiguous.status, 503); assert.equal(ambiguous.data.code, 'PROVIDER_UNAVAILABLE'); duplicate = false;
    amount = 45; const result = await pay(); assert.equal(result.status, 200); assert.equal(result.data.receipt.receiptNumber, 'paid-123'); assert.equal(result.data.chargedAmount, 0);
  }
  assert.equal(writes, 0);
});


test('paid telecom bill refuses a mismatched reviewed amount without creating an order', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'cityside-paid-telecom-'));
  const previous = process.env.APP_DATA_DIR; process.env.APP_DATA_DIR = dir;
  t.after(() => { if (previous === undefined) delete process.env.APP_DATA_DIR; else process.env.APP_DATA_DIR = previous; removeTemp(dir); });
  let writes = 0;
  t.mock.method(ProviderClient.prototype, 'call', async (provider, _actor, method, route) => {
    if (method !== 'GET') writes++;
    if (['du', 'etisalat'].includes(provider) && method === 'GET' && route === '/bills')
      return { bills: [{ billId: 'bill123', status: 'PAID', totalAmount: 45, receiptNumber: 'paid-123' }] };
    throw new Error('Unexpected provider operation');
  });
  const actor = actorFor({ sub: 'paid-telecom-user' });
  const legacy = () => ({ status: 404, data: {} });
  for (const provider of ['du', 'etisalat']) {
    const pay = (expectedAmountMinor: number) => integratedRequest('service-telecom', actor, 'POST', `/telecom/${provider}/bills/bill123/payments`, {}, { expectedAmountMinor }, legacy);
    const mismatch = await pay(4501);
    assert.equal(mismatch.status, 409); assert.equal(mismatch.data.code, 'PAYABLE_CHANGED');
    const matching = await pay(4500);
    assert.equal(matching.status, 200); assert.equal(matching.data.receipt.billId, 'bill123');
    assert.equal(receiptSchema('/telecom/{provider}/bills/{billId}/payments')(matching.data), true);
  }
  assert.equal(writes, 0);
});
