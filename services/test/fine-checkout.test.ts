import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { AccountDatabase } from '../provider-simulator/src/database.ts';
import { ProviderEngine } from '../provider-simulator/src/engine.ts';
import { PaymentCheckout } from '../provider-simulator/src/payment-checkout.ts';
import { ProviderSettlements } from '../provider-simulator/src/provider-settlements.ts';
import { actorFor } from '../../packages/backend-kit/src/context.ts';
import { UpstreamError,type ProviderClient } from '../../packages/backend-kit/src/provider-client.ts';
import type { Payable,PaymentAuthorizationReview } from '../../packages/protocol-core/src/payments.ts';
const input=(o:PaymentAuthorizationReview)=>({expectedVersion:o.version,approvalDigest:o.approvalDigest});
function fixture(t:any,kind='wallet'){
  let time=Date.now(),failure='';const db=new AccountDatabase(':memory:'),source=new AccountDatabase(':memory:');t.after(()=>{db.close();source.close();});
  const actor=actorFor({sub:'fine-checkout-owner'},undefined,'Bearer current-owner');for(const d of [db,source])d.accounts(actor.sub);
  const gateway=new ProviderEngine('payments',db,{authorizationClock:()=>time}),provider=new ProviderEngine('police',source,{businessClock:()=>time});gateway.seed(actor);provider.seed(actor);
  const fines=provider.payables!.list(actor.accountId),method=kind==='wallet'?{id:'wallet',version:1}:db.transaction(()=>gateway.execute(actor,'POST','/payment-methods',{preset:kind,nickname:'Fine payment card'})).data.method;
  db.transaction(()=>gateway.execute(actor,'POST','/billing-accounts',{provider:'police',reference:fines[0].reference,nickname:'My vehicle fines'}));
  const selection=(items=fines)=>provider.payables!.selectFines(actor.accountId,items.map(p=>({payableId:p.id,expectedRevision:p.revision})));
  const create=(p:Payable)=>gateway.orders!.create(actor,{provider:'police',payableId:p.id,expectedPayableRevision:p.revision,methodId:method.id,expectedMethodVersion:1},p);
  const approve=(p:Payable)=>{const o=create(p);return gateway.orders!.approve(actor,o.id,input(o),p);};
  const local=new ProviderSettlements(source,'police',{call:async(account,id,action,body:any)=>action==='claim'?gateway.claims!.claim(account,id,'police',body):action==='ack'?gateway.claims!.acknowledge(account,id,'police',body):gateway.claims!.release(account,id,'police',body)});
  const client={call:async(_provider:string,_actor:typeof actor,method:string,path:string,body:any={},key='test')=>{
    if(path.endsWith('/payments')){
      if(failure==='before'){failure='';throw new UpstreamError(503,'PROVIDER_OUTCOME_UNKNOWN','Lost before fine commit.');}
      const proof=gateway.execute(actor,'GET',`/charges/${body.paymentId}`,{}).data.charge,fp=createHash('sha256').update(JSON.stringify([method,path,body])).digest('hex');
      const result=await local.execute(actor,key,fp,proof,claimed=>provider.execute(actor,method,path,body,claimed));
      if(failure==='after'){failure='';throw new UpstreamError(503,'PROVIDER_OUTCOME_UNKNOWN','Lost after fine commit.');}return result.data;
    }
    let order;if(path.endsWith('/admit')||path.endsWith('/cancel')){const a=provider.admissions!.get(actor.accountId,path.split('/')[4]);order=gateway.orders!.get(actor,a.orderId);}
    return source.transaction(()=>provider.execute(actor,method,path,body,undefined,undefined,order)).data;
  }} as unknown as ProviderClient;
  const checkout=new PaymentCheckout(gateway.orders!,client);
  return {db,source,actor,gateway,provider,fines,method,selection,create,approve,checkout,setTime:(value:number)=>{time=value;},now:()=>time,fail:(when:string)=>{failure=when;}};
}
for(const source of ['wallet','approved','challenge'])test(`${source} pays the exact fine set once with one confirmed receipt and correct source effects`,async t=>{
  const f=fixture(t,source),p=f.selection();assert.equal(p.amountMinor,42000);assert.equal(p.discountMinor,3000);let o=f.approve(p);
  if(source==='challenge'){assert.equal(o.state,'REQUIRES_ACTION');await assert.rejects(f.checkout.execute(f.actor,o.id,input(o)));o=f.gateway.orders!.challenge(f.actor,o.id,{...input(o),challengeId:o.authorization!.challengeId!,decision:'APPROVE'},p,true);}
  const paid=await f.checkout.execute(f.actor,o.id,input(o));assert.equal(paid.state,'SETTLED');assert.equal(paid.receipt!.amountMinor,42000);assert.equal(f.provider.payables!.list(f.actor.accountId).filter(p=>p.status==='PAID').length,2);
  assert.equal(f.gateway.ledger!.summary(f.actor.accountId).balanceMinor,source==='wallet'?108000:150000);if(source!=='wallet')assert.equal(f.gateway.issuer!.summary(f.actor.accountId,f.method.id).spentMinor,42000);
  assert.equal(f.gateway.claims!.get(f.actor.accountId,paid.paymentId!)!.state,'APPLIED');assert.equal((await f.checkout.recover(f.actor,paid.id)).paymentId,paid.paymentId);assert.equal(f.db.list(f.actor.accountId,'charge').length,1);assert.equal(f.db.list(f.actor.accountId,'transaction').length,1);
});
test('fine selection rejects duplicate, nested, foreign, restricted, withdrawn and stale items before funds move',t=>{
  const f=fixture(t);assert.throws(()=>f.selection([f.fines[0],f.fines[0]]),(e:any)=>e.code==='INVALID_FINE_SELECTION');
  const p=f.selection();assert.throws(()=>f.selection([p]));assert.throws(()=>f.selection([{...f.fines[0],id:'police:fine:another-owner'}]));
  let fine=f.provider.payables!.amend(f.actor.accountId,f.fines[0].id,f.fines[0].revision,{paymentRestricted:true});assert.throws(()=>f.selection([fine]),(e:any)=>e.code==='PAYABLE_RESTRICTED');
  fine=f.provider.payables!.amend(f.actor.accountId,fine.id,fine.revision,{paymentRestricted:false});assert.throws(()=>f.selection([f.fines[0]]),(e:any)=>e.code==='PAYABLE_CHANGED');
  fine=f.provider.payables!.amend(f.actor.accountId,fine.id,fine.revision,{status:'CANCELLED'});assert.throws(()=>f.selection([fine]),(e:any)=>e.code==='PAYABLE_UNAVAILABLE');assert.equal(f.db.list(f.actor.accountId,'charge').length,0);
});
test('a changed fine or expired discount invalidates an already-approved selection before capture',async t=>{
  const f=fixture(t,'approved');const fine=f.provider.payables!.amend(f.actor.accountId,f.fines.find(p=>p.discountMinor)!.id,f.fines.find(p=>p.discountMinor)!.revision,{discountExpiresAt:new Date(f.now()+1000).toISOString()});
  const p=f.selection([fine]),o=f.approve(p);f.setTime(f.now()+1000);await assert.rejects(f.checkout.execute(f.actor,o.id,input(o)),(e:any)=>e.code==='PAYABLE_CHANGED');assert.equal(f.db.list(f.actor.accountId,'charge').length,0);assert.equal(f.gateway.issuer!.summary(f.actor.accountId,f.method.id).spentMinor,0);
});
test('overlapping single/group selections reserve each fine before capture, blocking legacy settlement and amendment',async t=>{
  const f=fixture(t),p=f.selection(),group=f.approve(p);assert.throws(()=>f.approve(f.fines[0]),(e:any)=>e.code==='PAYABLE_RESERVED');const pending=f.gateway.orders!.beginCapture(f.actor,group.id,input(group),p);
  const prepared=f.provider.admissions!.prepare(f.actor.accountId,p.id,{orderId:group.id,expectedRevision:p.revision,approvalDigest:group.approvalDigest,sourceId:'wallet',sourceVersion:1,expiresAt:group.authorization!.expiresAt}),attached=f.gateway.orders!.attachAdmission(f.actor,group.id,prepared);
  const admitted=f.provider.admissions!.admit(f.actor.accountId,prepared.id,attached);
  assert.equal(pending.state,'CAPTURING');assert.throws(()=>f.provider.payables!.amend(f.actor.accountId,f.fines[0].id,f.fines[0].revision,{amountMinor:1}),(e:any)=>e.code==='PAYABLE_RESERVED');
  assert.throws(()=>f.source.transaction(()=>f.provider.execute(f.actor,'POST','/fine-payments',{fineIds:[f.fines[0].obligationId],paymentId:'foreign'})),(e:any)=>e.code==='PAYABLE_RESERVED');
  assert.throws(()=>f.provider.admissions!.prepare(f.actor.accountId,f.fines[0].id,{orderId:'competing-source-order',expectedRevision:f.fines[0].revision,approvalDigest:'a'.repeat(64),sourceId:'wallet',sourceVersion:1,expiresAt:group.authorization!.expiresAt}),(e:any)=>e.code==='PAYABLE_RESERVED');assert.equal(f.db.list(f.actor.accountId,'charge').length,0);assert.equal(f.gateway.ledger!.summary(f.actor.accountId).heldMinor,p.amountMinor);
  f.gateway.orders!.capture(f.actor,group.id,admitted);assert.equal((await f.checkout.recover(f.actor,group.id)).state,'SETTLED');assert.equal(f.db.list(f.actor.accountId,'charge').length,1);
});
for(const scenario of ['deadline','captured'])test(`fine ${scenario} enforces the discount deadline and honors already-captured frozen terms`,async t=>{
  const f=fixture(t),discounted=f.fines.find(p=>p.discountMinor)!,fine=f.provider.payables!.amend(f.actor.accountId,discounted.id,discounted.revision,{discountExpiresAt:new Date(f.now()+1000).toISOString()}),p=f.selection([fine]),o=f.approve(p);
  f.gateway.orders!.beginCapture(f.actor,o.id,input(o),p);const prep=f.provider.admissions!.prepare(f.actor.accountId,p.id,{orderId:o.id,expectedRevision:p.revision,approvalDigest:o.approvalDigest,sourceId:'wallet',sourceVersion:1,expiresAt:o.authorization!.expiresAt}),attached=f.gateway.orders!.attachAdmission(f.actor,o.id,prep),admitted=f.provider.admissions!.admit(f.actor.accountId,prep.id,attached);
  const before=f.now();if(scenario==='deadline'){f.setTime(before+1000);assert.throws(()=>f.gateway.orders!.capture(f.actor,o.id,admitted),(e:any)=>e.code==='CAPTURE_NOT_ADMITTED');return;}
  f.setTime(before+500);f.gateway.orders!.capture(f.actor,o.id,admitted);f.setTime(before+2000);const paid=await f.checkout.recover(f.actor,o.id);assert.equal(paid.state,'SETTLED');assert.equal(paid.receipt!.amountMinor,27000);assert.equal(f.provider.payables!.get(f.actor.accountId,fine.id).amountMinor,27000);
});
for(const when of ['before','after'])test(`lost ${when}-commit fine settlement response recovers the original capture`,async t=>{
  const f=fixture(t,'approved'),o=f.approve(f.selection());f.fail(when);const unknown=await f.checkout.execute(f.actor,o.id,input(o));assert.equal(unknown.state,'RECONCILIATION_REQUIRED');assert.equal(unknown.fundsCaptured,true);
  const paid=await f.checkout.recover(f.actor,o.id);assert.equal(paid.state,'SETTLED');assert.equal(paid.paymentId,unknown.paymentId);assert.equal(f.db.list(f.actor.accountId,'charge').length,1);assert.equal(f.gateway.issuer!.summary(f.actor.accountId,f.method.id).spentMinor,42000);
});
test('fine application rolls back the whole selection on a partial database failure and recovers without another capture',async t=>{
  const f=fixture(t),p=f.selection(),o=f.approve(p),put=f.source.put.bind(f.source);const mock=t.mock.method(f.source,'put',(account:string,kind:string,value:any,id?:string)=>{if(kind==='fine'&&value.fineId===p.items![1].obligationId&&value.status==='PAID')throw new Error('injected second-fine failure');return put(account,kind,value,id);});
  const pending=await f.checkout.execute(f.actor,o.id,input(o));assert.equal(pending.state,'RECONCILIATION_REQUIRED');assert.equal(f.provider.payables!.list(f.actor.accountId).filter(p=>p.status==='PAID').length,0);mock.mock.restore();
  assert.equal((await f.checkout.recover(f.actor,o.id)).state,'SETTLED');assert.equal(f.db.list(f.actor.accountId,'charge').length,1);assert.equal(f.gateway.ledger!.summary(f.actor.accountId).balanceMinor,108000);
});
test('reopening a source with old admissions backfills item locks without changing saved terms',t=>{
  const f=fixture(t),p=f.fines[0],o=f.approve(p);const prepared=f.provider.admissions!.prepare(f.actor.accountId,p.id,{orderId:o.id,expectedRevision:p.revision,approvalDigest:o.approvalDigest,sourceId:'wallet',sourceVersion:1,expiresAt:o.authorization!.expiresAt});
  f.source.db.exec('DROP TABLE provider_admission_items');const reopened=new ProviderEngine('police',f.source);assert.deepEqual(reopened.admissions!.get(f.actor.accountId,prepared.id),prepared);
  assert.throws(()=>reopened.payables!.amend(f.actor.accountId,f.fines[0].id,f.fines[0].revision,{amountMinor:1}),(e:any)=>e.code==='PAYABLE_RESERVED');
});
test('fenced cancellation and prepared expiry release all fine item reservations',async t=>{
  const f=fixture(t),p=f.selection(),o=f.approve(p);f.gateway.orders!.beginCapture(f.actor,o.id,input(o),p);
  const prepared=f.provider.admissions!.prepare(f.actor.accountId,p.id,{orderId:o.id,expectedRevision:p.revision,approvalDigest:o.approvalDigest,sourceId:'wallet',sourceVersion:1,expiresAt:o.authorization!.expiresAt}),attached=f.gateway.orders!.attachAdmission(f.actor,o.id,prepared);
  f.provider.admissions!.admit(f.actor.accountId,prepared.id,attached);await f.checkout.cancel(f.actor,o.id,attached.version);
  assert.equal(f.source.db.prepare('SELECT count(*) n FROM provider_admission_items WHERE active=1').get()!.n,0);assert.equal(f.gateway.ledger!.summary(f.actor.accountId).heldMinor,0);
  const next=f.approve(p);f.provider.admissions!.prepare(f.actor.accountId,p.id,{orderId:next.id,expectedRevision:p.revision,approvalDigest:next.approvalDigest,sourceId:'wallet',sourceVersion:1,expiresAt:next.authorization!.expiresAt});f.setTime(f.now()+120001);
  assert.doesNotThrow(()=>f.provider.payables!.amend(f.actor.accountId,f.fines[0].id,f.fines[0].revision,{amountMinor:40000}));assert.equal(f.source.db.prepare('SELECT count(*) n FROM provider_admission_items WHERE active=1').get()!.n,0);
});
