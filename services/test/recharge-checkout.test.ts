import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync,rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { AccountDatabase } from '../provider-simulator/src/database.ts';
import { ProviderEngine } from '../provider-simulator/src/engine.ts';
import { PaymentCheckout } from '../provider-simulator/src/payment-checkout.ts';
import { ProviderSettlements } from '../provider-simulator/src/provider-settlements.ts';
import { actorFor } from '../../packages/backend-kit/src/context.ts';
import { UpstreamError,type ProviderClient } from '../../packages/backend-kit/src/provider-client.ts';
import type { RechargeProvider,Payable,PaymentAuthorizationReview } from '../../packages/protocol-core/src/payments.ts';
const input=(o:PaymentAuthorizationReview)=>({expectedVersion:o.version,approvalDigest:o.approvalDigest});
function fixture(t:any,providerId:RechargeProvider='rta',kind='wallet',sourcePath=':memory:'){
  let time=Date.now(),failure='';const db=new AccountDatabase(':memory:'),source=new AccountDatabase(sourcePath);t.after(()=>{db.close();source.close();});
  const actor=actorFor({sub:'recharge-owner'},undefined,'Bearer current-owner');for(const d of [db,source])d.accounts(actor.sub);
  const gateway=new ProviderEngine('payments',db,{authorizationClock:()=>time}),provider=new ProviderEngine(providerId,source,{businessClock:()=>time});gateway.seed(actor);provider.seed(actor);
  const target=provider.recharges!.targets(actor.accountId)[0],method=kind==='wallet'?{id:'wallet',version:1}:db.transaction(()=>gateway.execute(actor,'POST','/payment-methods',{preset:kind,nickname:'Recharge card'})).data.method;
  db.transaction(()=>gateway.execute(actor,'POST','/billing-accounts',{provider:providerId,reference:target.reference,nickname:'Owned provider target'}));
  const quote=(intentId=crypto.randomUUID())=>{const current=provider.recharges!.targets(actor.accountId)[0];return provider.recharges!.quote(actor.accountId,{targetReference:target.reference,amountMinor:target.denominationsMinor[0],expectedTargetVersion:current.version,intentId});};
  const create=(p:Payable)=>gateway.orders!.create(actor,{provider:providerId,payableId:p.id,expectedPayableRevision:p.revision,methodId:method.id,expectedMethodVersion:1},p);
  const approve=(p:Payable)=>{const o=create(p);return gateway.orders!.approve(actor,o.id,input(o),p);};
  const local=new ProviderSettlements(source,providerId,{call:async(account,id,action,body:any)=>action==='claim'?gateway.claims!.claim(account,id,providerId,body):action==='ack'?gateway.claims!.acknowledge(account,id,providerId,body):gateway.claims!.release(account,id,providerId,body)});
  const client={call:async(_provider:string,_actor:typeof actor,method:string,path:string,body:any={},key='test')=>{
    if(path.endsWith('/finish')&&failure==='finish'){failure='';throw new UpstreamError(503,'LOST_FINALIZATION','Lost target confirmation.');}
    if(path.endsWith('/payments')){
      if(failure==='before'){failure='';throw new UpstreamError(503,'PROVIDER_OUTCOME_UNKNOWN','Lost before provider credit.');}
      const proof=gateway.execute(actor,'GET',`/charges/${body.paymentId}`,{}).data.charge,fp=createHash('sha256').update(JSON.stringify([method,path,body])).digest('hex');
      const result=await local.execute(actor,key,fp,proof,claimed=>provider.execute(actor,method,path,body,claimed));if(failure==='after'){failure='';throw new UpstreamError(503,'PROVIDER_OUTCOME_UNKNOWN','Lost after provider credit.');}return result.data;
    }
    let order;if(['/admit','/cancel','/finish'].some(action=>path.endsWith(action))){const a=provider.admissions!.get(actor.accountId,path.split('/')[4]);order=gateway.orders!.get(actor,a.orderId);}
    return source.transaction(()=>provider.execute(actor,method,path,body,undefined,undefined,order)).data;
  }} as unknown as ProviderClient;
  return {db,source,actor,gateway,provider,target,method,quote,create,approve,checkout:new PaymentCheckout(gateway.orders!,client),now:()=>time,advance:(ms:number)=>{time+=ms;},fail:(when:string)=>{failure=when;}};
}
for(const provider of ['rta','etisalat','du'] as const)for(const method of ['wallet','approved'])test(`${provider} ${method} recharge credits only its exact target once and preserves source accounting`,async t=>{
  const f=fixture(t,provider,method),p=f.quote(),o=f.approve(p);assert.equal(f.provider.recharges!.targets(f.actor.accountId)[0].balanceMinor,f.target.balanceMinor);
  const paid=await f.checkout.execute(f.actor,o.id,input(o));assert.equal(paid.state,'SETTLED');assert.equal(paid.sourceFinalizationPending,false);assert.equal(paid.receipt!.targetReference,f.target.reference);assert.equal(paid.receipt!.providerBalanceMinor,f.target.balanceMinor+p.amountMinor);
  assert.equal(f.provider.recharges!.targets(f.actor.accountId)[0].balanceMinor,f.target.balanceMinor+p.amountMinor);assert.equal(f.gateway.ledger!.summary(f.actor.accountId).balanceMinor,150000-(method==='wallet'?p.amountMinor:0));if(method!=='wallet')assert.equal(f.gateway.issuer!.summary(f.actor.accountId,f.method.id).spentMinor,p.amountMinor);
  assert.equal((await f.checkout.recover(f.actor,o.id)).paymentId,paid.paymentId);assert.equal(f.db.list(f.actor.accountId,'charge').length,1);assert.equal(f.gateway.claims!.get(f.actor.accountId,paid.paymentId!)!.state,'APPLIED');
  const next=f.quote();assert.notEqual(next.id,p.id);assert.equal(next.recharge!.balanceBeforeMinor,f.target.balanceMinor+p.amountMinor);
});
test('recharge challenge and decline never produce provider credit before explicit successful capture',async t=>{
  const f=fixture(t,'du','challenge'),p=f.quote();let o=f.approve(p);assert.equal(o.state,'REQUIRES_ACTION');await assert.rejects(f.checkout.execute(f.actor,o.id,input(o)));
  o=f.gateway.orders!.challenge(f.actor,o.id,{...input(o),challengeId:o.authorization!.challengeId!,decision:'APPROVE'},p,true);assert.equal((await f.checkout.execute(f.actor,o.id,input(o))).state,'SETTLED');
  const declined=fixture(t,'etisalat','declined'),rejected=declined.approve(declined.quote());assert.equal(rejected.state,'FAILED');assert.equal(declined.provider.recharges!.targets(declined.actor.accountId)[0].balanceMinor,5000);
});
for(const when of ['before','after'])test(`lost ${when}-credit response blocks new intents until original recharge recovery`,async t=>{
  const f=fixture(t),p=f.quote(),o=f.approve(p);f.fail(when);const pending=await f.checkout.execute(f.actor,o.id,input(o));assert.equal(pending.state,'RECONCILIATION_REQUIRED');assert.equal(pending.fundsCaptured,true);assert.throws(()=>f.quote(),(e:any)=>e.code==='PAYABLE_RESERVED');
  const paid=await f.checkout.recover(f.actor,o.id);assert.equal(paid.state,'SETTLED');assert.equal(paid.sourceFinalizationPending,false);assert.equal(paid.paymentId,pending.paymentId);assert.equal(f.db.list(f.actor.accountId,'charge').length,1);assert.equal(f.provider.recharges!.targets(f.actor.accountId)[0].balanceMinor,f.target.balanceMinor+p.amountMinor);assert.doesNotThrow(()=>f.quote());
});
test('a lost final confirmation retains a truthful receipt and recoverable target fence without a second credit',async t=>{
  const f=fixture(t),p=f.quote(),o=f.approve(p);f.fail('finish');const paid=await f.checkout.execute(f.actor,o.id,input(o));assert.equal(paid.state,'SETTLED');assert.equal(paid.sourceFinalizationPending,true);assert.throws(()=>f.quote(),(e:any)=>e.code==='PAYABLE_RESERVED');
  const final=await f.checkout.recover(f.actor,o.id);assert.equal(final.sourceFinalizationPending,false);assert.equal(final.paymentId,paid.paymentId);assert.equal(f.provider.recharges!.targets(f.actor.accountId)[0].balanceMinor,f.target.balanceMinor+p.amountMinor);assert.doesNotThrow(()=>f.quote());
});
test('quotes reject wrong targets, denominations, stale versions, intent substitution, expiry and provider balance overflow',t=>{
  const f=fixture(t),body={targetReference:f.target.reference,amountMinor:5000,expectedTargetVersion:1,intentId:'one-intent'};
  for(const change of [{targetReference:'foreign-tag'},{amountMinor:1},{amountMinor:NaN},{expectedTargetVersion:2}])assert.throws(()=>f.provider.recharges!.quote(f.actor.accountId,{...body,...change}));
  const p=f.provider.recharges!.quote(f.actor.accountId,body);assert.equal(f.provider.recharges!.quote(f.actor.accountId,body).id,p.id);assert.throws(()=>f.provider.recharges!.quote(f.actor.accountId,{...body,amountMinor:10000}),(e:any)=>e.code==='RECHARGE_INTENT_CONFLICT');
  f.advance(300001);assert.throws(()=>f.provider.recharges!.inspect(f.actor.accountId,p.id,p.revision));
  const raw=f.source.get(f.actor.accountId,'salik');f.source.put(f.actor.accountId,'salik',{...raw,balance:1000000});assert.throws(()=>f.quote(),(e:any)=>e.code==='RECHARGE_BALANCE_LIMIT');
});
test('a target changing after approval prevents capture without funding fallback',async t=>{
  const f=fixture(t,'etisalat','approved');
  const subscription=f.source.list(f.actor.accountId,'subscription')[0],bill=f.provider.payables!.issueBill(f.actor.accountId,{billId:'cycle:recharge:literal',reference:subscription.subscriptionId,amountMinor:1000,dueDate:'2026-12-31',period:'2026-12'});
  assert.equal(f.provider.execute(f.actor,'GET',`/payables/${encodeURIComponent(bill.id)}`,{}).data.payable.kind,'BILL');
  const p=f.quote(),o=f.approve(p),raw=f.source.get(f.actor.accountId,'prepaid-line',f.target.reference);f.source.put(f.actor.accountId,'prepaid-line',{...raw,status:'CLOSED',version:2},f.target.reference);
  await assert.rejects(f.checkout.execute(f.actor,o.id,input(o)),(e:any)=>e.code==='PAYABLE_CHANGED');assert.equal(f.db.list(f.actor.accountId,'charge').length,0);assert.equal(f.gateway.issuer!.summary(f.actor.accountId,f.method.id).spentMinor,0);
});
test('competing quotes for one target cannot capture twice and legacy credit cannot bypass its admission',async t=>{
  const f=fixture(t),p=f.quote(),other=f.quote(),first=f.approve(p);assert.throws(()=>f.approve(other),(e:any)=>e.code==='PAYABLE_RESERVED');f.gateway.orders!.beginCapture(f.actor,first.id,input(first),p);
  const prep=f.provider.admissions!.prepare(f.actor.accountId,p.id,{orderId:first.id,expectedRevision:p.revision,approvalDigest:first.approvalDigest,sourceId:'wallet',sourceVersion:1,expiresAt:first.authorization!.expiresAt}),attached=f.gateway.orders!.attachAdmission(f.actor,first.id,prep);f.provider.admissions!.admit(f.actor.accountId,prep.id,attached);
  assert.throws(()=>f.source.transaction(()=>f.provider.execute(f.actor,'POST','/salik/recharges',{amount:50,reference:'bypass',paymentId:'forged'})),(e:any)=>e.code==='PAYABLE_RESERVED');
  assert.throws(()=>f.provider.admissions!.finish(f.actor.accountId,prep.id,attached),(e:any)=>e.code==='RECHARGE_NOT_CONFIRMED');assert.throws(()=>f.provider.admissions!.prepare(f.actor.accountId,other.id,{orderId:'competing-source-order',expectedRevision:other.revision,approvalDigest:'a'.repeat(64),sourceId:'wallet',sourceVersion:1,expiresAt:first.authorization!.expiresAt}),(e:any)=>e.code==='PAYABLE_RESERVED');
  assert.equal((await f.checkout.recover(f.actor,first.id)).state,'SETTLED');assert.equal(f.db.list(f.actor.accountId,'charge').length,1);
});
test('a captured proof cannot be reused against another recharge target or quote',async t=>{
  const f=fixture(t,'du'),p=f.quote(),o=f.approve(p),paid=await f.checkout.execute(f.actor,o.id,input(o)),proof=f.db.get(f.actor.accountId,'charge',paid.paymentId!),next=f.quote(),second=f.approve(next);
  f.gateway.orders!.beginCapture(f.actor,second.id,input(second),next);const prep=f.provider.admissions!.prepare(f.actor.accountId,next.id,{orderId:second.id,expectedRevision:next.revision,approvalDigest:second.approvalDigest,sourceId:'wallet',sourceVersion:1,expiresAt:second.authorization!.expiresAt}),attached=f.gateway.orders!.attachAdmission(f.actor,second.id,prep);f.provider.admissions!.admit(f.actor.accountId,prep.id,attached);
  assert.throws(()=>f.provider.admissions!.settle(f.actor.accountId,prep.id,proof.id,proof),(e:any)=>e.code==='INVALID_ADMITTED_CAPTURE');assert.equal(f.provider.recharges!.targets(f.actor.accountId)[0].balanceMinor,f.target.balanceMinor+p.amountMinor);
});
test('source credit and receipt roll back together on persistence failure and reuse the same captured payment',async t=>{
  const f=fixture(t,'du'),p=f.quote(),o=f.approve(p);f.source.db.exec("CREATE TRIGGER fail_recharge_receipt BEFORE UPDATE ON provider_recharge_quotes BEGIN SELECT RAISE(ABORT,'injected recharge persistence');END");
  const pending=await f.checkout.execute(f.actor,o.id,input(o));assert.equal(pending.state,'RECONCILIATION_REQUIRED');assert.equal(f.provider.recharges!.targets(f.actor.accountId)[0].balanceMinor,f.target.balanceMinor);f.source.db.exec('DROP TRIGGER fail_recharge_receipt');
  const paid=await f.checkout.recover(f.actor,o.id);assert.equal(paid.state,'SETTLED');assert.equal(paid.paymentId,pending.paymentId);assert.equal(f.db.list(f.actor.accountId,'charge').length,1);
});
test('source reopen preserves an applied but unconfirmed target fence and immutable quote intent',async t=>{
  const dir=mkdtempSync(join(tmpdir(),'cityside-recharge-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));const f=fixture(t,'rta','wallet',join(dir,'rta.sqlite')),p=f.quote(),o=f.approve(p);f.fail('finish');await f.checkout.execute(f.actor,o.id,input(o));
  const other=new AccountDatabase(f.source.path);t.after(()=>other.close());const restored=new ProviderEngine('rta',other);assert.equal(restored.recharges!.get(f.actor.accountId,p.id).status,'PAID');assert.throws(()=>restored.recharges!.quote(f.actor.accountId,{targetReference:f.target.reference,amountMinor:5000,expectedTargetVersion:2,intentId:'another-intent'}),(e:any)=>e.code==='PAYABLE_RESERVED');
  await f.checkout.recover(f.actor,o.id);assert.doesNotThrow(()=>restored.recharges!.quote(f.actor.accountId,{targetReference:f.target.reference,amountMinor:5000,expectedTargetVersion:2,intentId:'another-intent'}));
});
