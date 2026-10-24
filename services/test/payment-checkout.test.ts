import test from 'node:test';
import assert from 'node:assert/strict';
import { AccountDatabase } from '../provider-simulator/src/database.ts';
import { ProviderEngine } from '../provider-simulator/src/engine.ts';
import { PaymentCheckout } from '../provider-simulator/src/payment-checkout.ts';
import { ProviderSettlements } from '../provider-simulator/src/provider-settlements.ts';
import { actorFor } from '../../packages/backend-kit/src/context.ts';
import { UpstreamError,type ProviderClient } from '../../packages/backend-kit/src/provider-client.ts';
import { createHash } from 'node:crypto';
import { mkdtempSync,rmSync,existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { PaymentOrders } from '../provider-simulator/src/payment-orders.ts';
import { PaymentIssuer } from '../provider-simulator/src/payment-issuer.ts';
import { PaymentLedger } from '../provider-simulator/src/payment-ledger.ts';
import { PaymentResourceUses } from '../provider-simulator/src/payment-resource-uses.ts';
function fixture(t:any,kind='approved'){
  const payments=new AccountDatabase(':memory:'),source=new AccountDatabase(':memory:');t.after(()=>{payments.close();source.close();});const actor=actorFor({sub:'checkout-owner'},undefined,'Bearer current-owner');for(const db of [payments,source])db.accounts(actor.sub);
  const gateway=new ProviderEngine('payments',payments),provider=new ProviderEngine('dewa',source);gateway.seed(actor);provider.seed(actor);
  const p=provider.payables!.list(actor.accountId)[0],method=kind==='wallet'?{id:'wallet',version:1}:payments.transaction(()=>gateway.execute(actor,'POST','/payment-methods',{preset:kind,nickname:'Selected card'})).data.method;
  payments.transaction(()=>gateway.execute(actor,'POST','/billing-accounts',{provider:'dewa',reference:p.reference,nickname:'Home'}));
  const order=gateway.orders!.create(actor,{provider:'dewa',payableId:p.id,expectedPayableRevision:p.revision,methodId:method.id,expectedMethodVersion:1},p),approved=gateway.orders!.approve(actor,order.id,{expectedVersion:order.version,approvalDigest:order.approvalDigest},p);
  const local=new ProviderSettlements(source,'dewa',{call:async(account,id,action,body:any)=>action==='claim'?gateway.claims!.claim(account,id,'dewa',body):action==='ack'?gateway.claims!.acknowledge(account,id,'dewa',body):gateway.claims!.release(account,id,'dewa',body)});
  let failBeforePayment=false,failAfterPayment=false;let effects=0;
  const client={call:async(_provider:string,_actor:typeof actor,method:string,path:string,body:any={},key='test')=>{
    if(path.endsWith('/payments')){
      if(failBeforePayment){failBeforePayment=false;throw new UpstreamError(503,'PROVIDER_OUTCOME_UNKNOWN','Lost before source commit');}
      const proof=gateway.execute(actor,'GET',`/charges/${body.paymentId}`,{}).data.charge,fp=createHash('sha256').update(JSON.stringify([method,path,body])).digest('hex');
      const result=await local.execute(actor,key,fp,proof,claimed=>{effects++;return provider.execute(actor,method,path,body,claimed);});
      if(failAfterPayment){failAfterPayment=false;throw new UpstreamError(503,'PROVIDER_OUTCOME_UNKNOWN','Lost after source commit');}return result.data;
    }
    let gatewayOrder;
    if(path.endsWith('/admit')||path.endsWith('/cancel')){const admission=provider.admissions!.get(actor.accountId,path.split('/')[4]);gatewayOrder=gateway.orders!.get(actor,admission.orderId);}
    return source.transaction(()=>provider.execute(actor,method,path,body,undefined,undefined,gatewayOrder)).data;
  }} as unknown as ProviderClient;
  return {payments,source,actor,gateway,provider,p,method,approved,checkout:new PaymentCheckout(gateway.orders!,client),failure:(when:'before'|'after')=>{if(when==='before')failBeforePayment=true;else failAfterPayment=true;},effects:()=>effects};
}
const input=(o:{version:number;approvalDigest:string})=>({expectedVersion:o.version,approvalDigest:o.approvalDigest});

for(const kind of ['wallet','approved'])test(`${kind} bill checkout captures exact approved funds and provider settlement once`,async t=>{
  const f=fixture(t,kind),settled=await f.checkout.execute(f.actor,f.approved.id,input(f.approved));assert.equal(settled.state,'SETTLED');assert.equal(settled.fundsCaptured,true);assert.equal(settled.receipt!.amountMinor,42040);
  assert.equal(f.provider.payables!.get(f.actor.accountId,f.p.id).status,'PAID');assert.equal(f.gateway.ledger!.summary(f.actor.accountId).balanceMinor,kind==='wallet'?107960:150000);
  if(kind!=='wallet'){const balance=f.gateway.issuer!.summary(f.actor.accountId,f.method.id);assert.equal(balance.spentMinor,42040);assert.equal(balance.heldMinor,0);}
  assert.equal(f.gateway.claims!.get(f.actor.accountId,settled.paymentId!)!.state,'APPLIED');assert.equal(f.gateway.claims!.get(f.actor.accountId,settled.paymentId!)!.orderId,settled.id);assert.equal(f.gateway.claims!.get(f.actor.accountId,settled.paymentId!)!.captureAttemptId,`capture_${settled.id}`);assert.equal(f.payments.get(f.actor.accountId,'charge',settled.paymentId!).quoteDigest,f.approved.approvalDigest);assert.equal(f.gateway.resourceUses!.list(f.actor.accountId).length,0);
  assert.equal((await f.checkout.recover(f.actor,settled.id)).state,'SETTLED');assert.equal(f.effects(),1);assert.equal(f.payments.list(f.actor.accountId,'transaction').length,1);
  assert.throws(()=>f.payments.transaction(()=>f.gateway.execute(f.actor,'POST',`/charges/${settled.paymentId}/refunds`,{reason:'Cannot refund paid invoice'})),(e:any)=>e.code==='SETTLEMENT_IN_USE');
});

for(const when of ['before','after'] as const)test(`lost ${when}-provider-commit response recovers the original card capture without another debit`,async t=>{
  const f=fixture(t);f.failure(when);const pending=await f.checkout.execute(f.actor,f.approved.id,input(f.approved));assert.equal(pending.state,'RECONCILIATION_REQUIRED');assert.equal(pending.fundsCaptured,true);
  assert.equal(f.gateway.issuer!.summary(f.actor.accountId,f.method.id).spentMinor,42040);assert.throws(()=>f.gateway.orders!.cancel(f.actor,pending.id,pending.version));
  const settled=await f.checkout.recover(f.actor,pending.id);assert.equal(settled.state,'SETTLED');assert.equal(settled.paymentId,pending.paymentId);assert.equal(f.effects(),1);assert.equal(f.payments.list(f.actor.accountId,'transaction').length,1);
});

test('changed source terms deny capture without creating a payment',async t=>{
  const f=fixture(t);f.provider.payables!.amend(f.actor.accountId,f.p.id,f.p.revision,{amountMinor:42041});
  await assert.rejects(f.checkout.execute(f.actor,f.approved.id,input(f.approved)),(e:any)=>e.code==='PAYABLE_CHANGED');assert.equal(f.payments.list(f.actor.accountId,'charge').length,0);assert.equal(f.gateway.issuer!.summary(f.actor.accountId,f.method.id).spentMinor,0);
  await f.checkout.cancel(f.actor,f.approved.id,f.approved.version);assert.equal(f.gateway.issuer!.summary(f.actor.accountId,f.method.id).heldMinor,0);
});

test('provider admission freezes terms and rejects substitution, unfenced cancellation and a non-admitted capture',t=>{
  const f=fixture(t),pending=f.gateway.orders!.beginCapture(f.actor,f.approved.id,input(f.approved),f.p);
  const admission=f.provider.admissions!.prepare(f.actor.accountId,f.p.id,{orderId:pending.id,expectedRevision:f.p.revision,approvalDigest:pending.approvalDigest,sourceId:f.method.id,sourceVersion:1,expiresAt:pending.authorization!.expiresAt});
  assert.throws(()=>f.provider.payables!.amend(f.actor.accountId,f.p.id,f.p.revision,{amountMinor:1}),(e:any)=>e.code==='PAYABLE_RESERVED');
  assert.throws(()=>f.provider.admissions!.admit(f.actor.accountId,admission.id,{...pending,admissionId:'wrong'}),(e:any)=>e.code==='ORDER_NOT_ADMITTED');
  const attached=f.gateway.orders!.attachAdmission(f.actor,pending.id,admission);assert.throws(()=>f.gateway.orders!.capture(f.actor,pending.id,admission),(e:any)=>e.code==='CAPTURE_NOT_ADMITTED');
  const admitted=f.provider.admissions!.admit(f.actor.accountId,admission.id,attached);assert.throws(()=>f.provider.admissions!.cancel(f.actor.accountId,admission.id,attached),(e:any)=>e.code==='CAPTURE_NOT_FENCED');
  const cancelled=f.gateway.orders!.cancel(f.actor,pending.id,attached.version);f.provider.admissions!.cancel(f.actor.accountId,admitted.id,cancelled);
  assert.throws(()=>f.gateway.orders!.capture(f.actor,pending.id,admitted),(e:any)=>e.code==='CAPTURE_NOT_ADMITTED');assert.equal(f.gateway.issuer!.summary(f.actor.accountId,f.method.id).heldMinor,0);
});

test('an admitted capture still rejects an expired funding hold before any journal debit',t=>{
  const f=fixture(t,'wallet'),pending=f.gateway.orders!.beginCapture(f.actor,f.approved.id,input(f.approved),f.p);
  const prepared=f.provider.admissions!.prepare(f.actor.accountId,f.p.id,{orderId:pending.id,expectedRevision:f.p.revision,approvalDigest:pending.approvalDigest,sourceId:'wallet',sourceVersion:1,expiresAt:pending.authorization!.expiresAt});
  const attached=f.gateway.orders!.attachAdmission(f.actor,pending.id,prepared),admitted=f.provider.admissions!.admit(f.actor.accountId,prepared.id,attached);
  t.mock.method(f.gateway.orders!,'clock',()=>Date.parse(attached.authorization!.expiresAt)+1);
  assert.throws(()=>f.gateway.orders!.capture(f.actor,pending.id,admitted),(e:any)=>e.code==='CAPTURE_NOT_ADMITTED');assert.equal(f.gateway.ledger!.summary(f.actor.accountId).balanceMinor,150000);assert.equal(f.payments.list(f.actor.accountId,'charge').length,0);
});

test('order capture schema migration preserves old review IDs, snapshots and financial resources on reopen',t=>{
  const dir=mkdtempSync(join(tmpdir(),'cityside-order-v2-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));const path=join(dir,'payments.sqlite'),db=new AccountDatabase(path);t.after(()=>db.close());const actor=actorFor({sub:'order-migration'});db.accounts(actor.sub);db.put(actor.accountId,'wallet',{balanceMinor:150000,currency:'AED'});
  const legacy={id:'old-review',ownerSub:actor.sub,accountId:actor.accountId,version:1,state:'AWAITING_APPROVAL',fundsCaptured:false,expiresAt:new Date(Date.now()+300000).toISOString(),quote:{immutable:'retained'},approvalDigest:'a'.repeat(64)};
  db.db.exec("CREATE TABLE payment_authorization_orders(id TEXT PRIMARY KEY,account_id TEXT NOT NULL,provider TEXT NOT NULL,payable_id TEXT NOT NULL,state TEXT NOT NULL CHECK(state IN ('AWAITING_APPROVAL','REQUIRES_ACTION','AUTHORIZED','FAILED','CANCELLED')),expires_at INTEGER NOT NULL,body TEXT NOT NULL)");db.db.prepare('INSERT INTO payment_authorization_orders VALUES(?,?,?,?,?,?,?)').run(legacy.id,actor.accountId,'dewa','dewa:bill:retained',legacy.state,Date.parse(legacy.expiresAt),JSON.stringify(legacy));
  const ledger=new PaymentLedger(db),issuer=new PaymentIssuer(db),uses=new PaymentResourceUses(db),orders=new PaymentOrders(db,issuer,ledger,uses);assert.deepEqual(orders.get(actor,legacy.id),legacy);assert.ok(existsSync(path+'.before-order-capture-v2.sqlite'));assert.equal(ledger.summary(actor.accountId).balanceMinor,150000);
  const reopened=new AccountDatabase(path);t.after(()=>reopened.close());const restored=new PaymentOrders(reopened,new PaymentIssuer(reopened),new PaymentLedger(reopened),new PaymentResourceUses(reopened));assert.deepEqual(restored.get(actor,legacy.id),legacy);assert.equal(reopened.db.prepare('SELECT count(*) n FROM payment_authorization_orders').get()!.n,1);
});
