import { Ajv } from 'ajv';
import { paymentMethodSchema, paymentOrderSchema } from '../../packages/protocol-core/src/payments.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { AccountDatabase } from '../provider-simulator/src/database.ts';
import { ProviderEngine } from '../provider-simulator/src/engine.ts';
import { actorFor } from '../../packages/backend-kit/src/context.ts';
import { validateRequest } from '../../packages/protocol-core/src/request-validation.ts';
import { paymentOverview, buildPaymentPreview, paymentDigest } from '../agent-core/src/payment-accounts.ts';
import { verifyBillerReference } from '../provider-simulator/src/payment-ownership.ts';
import type { ProviderClient } from '../../packages/backend-kit/src/provider-client.ts';
import type { PaymentOverview } from '../../packages/protocol-core/src/payments.ts';

test('payment contracts reject raw card data, extra price/source overrides, invalid presets and stale-shaped versions', () => {
  const body = { accountId: 'acc_alice', requestKey: 'request_key_01', preset: 'approved', nickname: 'Home' };
  assert.equal(validateRequest('agent-core','POST','/api/payments/methods',{},body), undefined);
  for (const changed of [{ ...body, pan: 'not-a-card' }, { ...body, preset: 'external' }, { ...body, nickname: '\n' }, { ...body, accountId: 100 }]) assert.equal(validateRequest('agent-core','POST','/api/payments/methods',{},changed)?.status,400);
  const review = { accountId: 'acc_alice', payableId: 'dewa:bill:bill_01', methodId: 'wallet', expectedMethodVersion: 1 };
  assert.equal(validateRequest('agent-core','POST','/api/payments/preview',{},review),undefined);
  for (const changed of [{ ...review, amountMinor: -1 }, { ...review, source: 'demo_approved' }, { ...review, expectedMethodVersion: 1.1 }, { ...review, expectedMethodVersion: Infinity }]) assert.equal(validateRequest('agent-core','POST','/api/payments/preview',{},changed)?.status,400);
});

test('saved cards/defaults persist, use account-bound tokens and never move wallet funds', t => {
  const dir = mkdtempSync(join(tmpdir(),'cityside-methods-')); t.after(() => rmSync(dir,{recursive:true,force:true}));
  const path = join(dir,'payments.sqlite'); let db = new AccountDatabase(path), engine = new ProviderEngine('payments',db);
  t.after(() => db.close());
  const alice = actorFor({sub:'method-alice'}), bob = actorFor({sub:'method-bob'});
  for (const actor of [alice,bob]) { db.accounts(actor.sub); engine.seed(actor); }
  const post = (body: Record<string,unknown>, route='/payment-methods', actor=alice) => db.transaction(() => engine.execute(actor,'POST',route,body)).data;
  const method = post({preset:'approved',nickname:'Everyday'}).method;
  assert.equal(method.accountId,alice.accountId); assert.equal(method.last4,'4242'); assert.ok(!Object.hasOwn(method,'pan'));
  assert.throws(() => post({methodId:method.id,expectedVersion:1},'/payment-methods/default',bob), /not found/);
  post({methodId:method.id,expectedVersion:1},'/payment-methods/default');
  assert.throws(() => post({methodId:method.id,expectedVersion:1,status:'REMOVED'},'/payment-methods/status'),/another default/);
  post({methodId:method.id,expectedVersion:1,status:'DISABLED'},'/payment-methods/status');
  assert.throws(() => post({methodId:method.id,expectedVersion:1,status:'ACTIVE'},'/payment-methods/status'),/changed/);
  db.close(); db = new AccountDatabase(path); engine = new ProviderEngine('payments',db);
  const restored = engine.execute(alice,'GET','/payment-methods',{}).data;
  assert.equal(restored.defaultMethodId,method.id); assert.equal(restored.methods.find((m:any)=>m.id===method.id).status,'DISABLED');
  assert.equal(engine.execute(bob,'GET','/payment-methods',{}).data.methods.length,1);
  for (const actor of [alice,bob]) assert.equal(engine.execute(actor,'GET','/wallet',{}).data.balanceMinor,150000);
  post({methodId:'wallet',expectedVersion:1},'/payment-methods/default');
  post({methodId:method.id,expectedVersion:2,status:'REMOVED'},'/payment-methods/status');
  assert.throws(() => post({methodId:method.id,expectedVersion:3,status:'ACTIVE'},'/payment-methods/status'),/reactivated/);
});

test('biller linking verifies the current signed owner at the source provider and preserves archived history', async t => {
  const db = new AccountDatabase(':memory:'); t.after(()=>db.close()); const actor = actorFor({sub:'biller-alice'},undefined,'Bearer signed-user');
  db.accounts(actor.sub); const engine = new ProviderEngine('payments',db); engine.seed(actor);
  const calls: unknown[]=[];
  const client = { call: async (provider:string, forwarded:typeof actor, method:string,path:string) => { calls.push([provider,forwarded.authorization,method,path]); return {account:{accountNumber:'OWNED-01'}}; } } as unknown as ProviderClient;
  await verifyBillerReference(client,actor,{provider:'dewa',reference:'OWNED-01'});
  await assert.rejects(verifyBillerReference(client,actor,{provider:'dewa',reference:'OTHER-ACCOUNT'}),/not an eligible owned/);
  assert.deepEqual(calls[0],['dewa','Bearer signed-user','GET','/consumption']);
  const link = db.transaction(()=>engine.execute(actor,'POST','/billing-accounts',{provider:'dewa',reference:'OWNED-01',nickname:'Home'})).data.billingAccount;
  assert.throws(()=>db.transaction(()=>engine.execute(actor,'POST','/billing-accounts',{provider:'dewa',reference:'OWNED-01',nickname:'Duplicate'})),/already linked/);
  db.transaction(()=>engine.execute(actor,'POST','/billing-accounts/archive',{billingAccountId:link.id,expectedVersion:1}));
  assert.equal(engine.execute(actor,'GET','/billing-accounts',{}).data.billingAccounts[0].status,'ARCHIVED');
});

function overview(): PaymentOverview {
  const accountId='acc_alice'; return { contractVersion:'1.0.0',accountId,previewOnly:true,defaultMethodId:'wallet',presets:[],wallet:{balanceMinor:150000,heldMinor:0,availableMinor:150000,currency:'AED'},candidates:[],
    methods:[{id:'wallet',accountId,kind:'wallet',nickname:'Wallet',status:'ACTIVE',version:1,currency:'AED'}],
    billingAccounts:[{id:'ba_owned',accountId,provider:'dewa',reference:'OWNED',nickname:'Home',status:'ACTIVE',version:1,createdAt:'2026-01-01T00:00:00Z'}],
    payables:[{id:'dewa:bill:bill_1',provider:'dewa',reference:'OWNED',label:'DEWA bill',amountMinor:42040,currency:'AED',status:'UNPAID',revision:'revision_1'}] };
}
test('review snapshots bind owned biller/source/current amount, are non-executable and do not mutate inputs', () => {
  const data=overview(), initial=structuredClone(data), input={payableId:data.payables[0].id,methodId:'wallet',expectedMethodVersion:1};
  const quote=buildPaymentPreview(data,input,Date.parse('2026-10-24T00:00:00Z'));
  assert.equal(quote.previewOnly,true);assert.equal(quote.totalMinor,42040);assert.equal(quote.feeMinor,0);assert.deepEqual(data,initial);
  const {digest,...snapshot}=quote;assert.equal(digest,paymentDigest(snapshot));
  snapshot.source.version++;assert.notEqual(digest,paymentDigest(snapshot));
  assert.throws(()=>buildPaymentPreview(data,{...input,expectedMethodVersion:2}),/changed/);
  assert.throws(()=>buildPaymentPreview(data,{...input,payableId:'dewa:bill:someone-else'}),/current unpaid/);
  data.methods[0].accountId='acc_bob';assert.throws(()=>buildPaymentPreview(data,input),/active payment method/);data.methods[0].accountId='acc_alice';
  data.billingAccounts[0].accountId='acc_bob';assert.throws(()=>buildPaymentPreview(data,input),/Link this owned/);data.billingAccounts[0].accountId='acc_alice';
  for(const amountMinor of [-1,0,Infinity,1.5,100000001]) {data.payables[0].amountMinor=amountMinor;assert.throws(()=>buildPaymentPreview(data,input),/outside the demo/);}
});

test('provider-backed overview preserves signed identity and reads current rather than hardcoded amounts', async () => {
  const actor=actorFor({sub:'overview-alice'},undefined,'Bearer signed');
  const client={call:async(provider:string,forwarded:typeof actor,method:string,path:string)=>{
    assert.equal(forwarded.authorization,'Bearer signed');assert.equal(method,'GET');
    if(path==='/payment-methods') return {methods:[],defaultMethodId:'wallet',presets:[]};
    if(path==='/billing-accounts') return {billingAccounts:[]};if(path==='/wallet')return{balanceMinor:120000,heldMinor:0,availableMinor:120000};
    if(path==='/consumption')return{account:{accountNumber:'DEWA-own'}};
    if(path==='/subscriptions')return{subscriptions:[{subscriptionId:`${provider}-own`,status:'ACTIVE',name:'Internet'}]};
    if(path==='/bills')return{bills:[{billId:`${provider}-current`,subscriptionId:`${provider}-own`,status:'UNPAID',totalAmount:123.45}]};
    if(path==='/salik')return{tagNumber:'toll-own'};if(path==='/fines')return{fines:[]};throw new Error('unexpected path');
  }} as unknown as ProviderClient;
  const data=await paymentOverview(actor,client);assert.equal(data.payables.length,3);assert.ok(data.payables.every(p=>p.amountMinor===12345));assert.equal(data.wallet.balanceMinor,120000);
});

test('versioned method and future-order response contracts reject invented card fields and invalid states/money', () => {
  const ajv = new Ajv({strict:false}), validateMethod = ajv.compile(paymentMethodSchema), validateOrder = ajv.compile(paymentOrderSchema);
  const wallet = overview().methods[0];assert.equal(validateMethod(wallet),true);
  assert.equal(validateMethod({...wallet,pan:'forbidden'}),false);assert.equal(validateMethod({...wallet,kind:'card'}),false);
  const order = {id:'order_1',accountId:'acc_alice',ownerSub:'alice',quoteId:'quote_1',quoteDigest:'a'.repeat(64),payableId:'dewa:bill:1',payableRevision:'revision_1',sourceId:'wallet',sourceVersion:1,amountMinor:100,feeMinor:0,totalMinor:100,refundedMinor:0,currency:'AED',state:'DRAFT',settlementState:'UNCLAIMED',createdAt:'2026-10-24T00:00:00.000Z',updatedAt:'2026-10-24T00:00:00.000Z'};
  assert.equal(validateOrder(order),true);
  for(const mutation of [{state:'MAGIC_SUCCESS'},{currency:'USD'},{amountMinor:0},{totalMinor:1.5},{sourceVersion:0},{rawToken:'forbidden'}])assert.equal(validateOrder({...order,...mutation}),false);
});
