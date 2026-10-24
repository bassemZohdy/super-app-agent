import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { integratedRequest } from '../../packages/backend-kit/src/application.ts';
import { ProviderClient } from '../../packages/backend-kit/src/provider-client.ts';
import { actorFor, assetsFor } from '../../packages/backend-kit/src/context.ts';
import { restaurants } from '../service-food/src/index.ts';

// Exercise the actual application mapping, not an invented UI receipt fixture.
test('integrated receipt mappings preserve utility premise, owned fine plate/discount and dining delivery fields', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'cityside-receipt-'));
  const previous = process.env.APP_DATA_DIR; process.env.APP_DATA_DIR = dir;
  t.after(async () => { if (previous === undefined) delete process.env.APP_DATA_DIR; else process.env.APP_DATA_DIR = previous; await rm(dir, { recursive: true, force: true }); });
  let status = 'UNPAID'; let captures = 0;
  const bill = { billId: 'dewa_contract_bill', premiseId: 'DEWA-CONTRACT-PREMISE', status, totalAmount: 420.4 };
  let orderState='AWAITING_APPROVAL';
  const mappingOrder=()=>({id:'mapping-order',state:orderState,version:orderState==='AWAITING_APPROVAL'?1:2,approvalDigest:'a'.repeat(64),fundsCaptured:orderState==='SETTLED',quote:{totalMinor:42040},receipt:{receiptNumber:'receipt_contract_capture',amountMinor:42040}});
  t.mock.method(ProviderClient.prototype, 'call', async (provider, _actor, method, route) => {
    if (provider === 'police' && method === 'GET') return { fines: [], count: 0, totalOriginal: 450, totalDiscount: 30, totalPayable: 420 };
    if (provider === 'dewa' && method === 'GET' && route === '/bills') return { bills: [{ ...bill, status }] };
    if(provider==='dewa'&&route==='/payables')return{payables:[{id:'dewa:bill:dewa_contract_bill',obligationId:bill.billId,provider:'dewa',reference:'owned-dewa',amountMinor:42040,status:'UNPAID',revision:'a'.repeat(64)}]};
    if(provider==='payments'&&route==='/billing-accounts')return{billingAccounts:[{status:'ACTIVE',provider:'dewa',reference:'owned-dewa'}]};
    if(provider==='payments'&&route==='/payment-orders')return{order:mappingOrder()};
    if(provider==='payments'&&route==='/payment-orders/mapping-order')return{order:mappingOrder()};
    if(provider==='payments'&&route.endsWith('/approve')){orderState='AUTHORIZED';return{order:mappingOrder()};}
    if(provider==='payments'&&route.endsWith('/execute')){orderState='SETTLED';captures++;return{order:mappingOrder()};}
    if(provider==='payments'&&route==='/wallet')return{balance:1079.6};
    if (provider === 'dewa' && method === 'POST') return { success: true, receipt: { billId: bill.billId, receiptNumber: 'receipt_contract_capture', amountPaid: '420.40' } };
    throw new Error('Unexpected provider operation');
  });
  const actor = actorFor({ sub: 'receipt-contract-user' });
  const legacy = () => ({ status: 404, data: {} });
  const pay = () => integratedRequest('service-food', actor, 'POST', '/utilities/pay', {}, { billId: bill.billId }, legacy);
  const paid = await pay(); assert.equal(paid.status, 200); assert.equal(paid.data.receipt.premiseId, bill.premiseId);
  status = 'PAID'; const replay = await pay(); assert.equal(replay.data.receipt.premiseId, bill.premiseId); assert.equal(captures, 1);
  status = 'CANCELLED'; const withdrawn=await pay();assert.equal(withdrawn.status,409);assert.equal(withdrawn.data.code,'PAYABLE_UNAVAILABLE');assert.equal(captures,1);
  const fines = await integratedRequest('service-wallet', actor, 'GET', '/fines/check', {}, {}, legacy);
  assert.equal(fines.data.plateNumber, assetsFor(actor.accountId).plate); assert.equal(fines.data.earlyDiscountAED, 30);
  const restaurant = restaurants[0];
  const order = await integratedRequest('service-food', actor, 'POST', '/orders/create', {}, { restaurantId: restaurant.id, items: [restaurant.items[0].id] }, legacy);
  assert.equal(order.status, 200); assert.equal(order.data.order.estimatedDeliveryTime, '25 min');
});
