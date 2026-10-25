import { removeTemp } from '../../test/support/temp-cleanup.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { AccountDatabase } from '../provider-simulator/src/database.ts';
import { ProviderEngine } from '../provider-simulator/src/engine.ts';
import { PaymentCheckout } from '../provider-simulator/src/payment-checkout.ts';
import { ProviderSettlements } from '../provider-simulator/src/provider-settlements.ts';
import { actorFor } from '../../packages/backend-kit/src/context.ts';
import { UpstreamError,type ProviderClient } from '../../packages/backend-kit/src/provider-client.ts';
import { validateRequest } from '../../packages/protocol-core/src/request-validation.ts';
import type { PaymentRefund } from '../../packages/protocol-core/src/payments.ts';
const decision=(o:{version:number;approvalDigest:string})=>({expectedVersion:o.version,approvalDigest:o.approvalDigest});
function fixture(t:any,provider:'dewa'|'etisalat'|'du'|'police'|'rta'='dewa',kind='wallet',dir?:string){
  const actor=actorFor({sub:'refund-owner'},undefined,'Bearer owner'),db=new AccountDatabase(dir?join(dir,'payments.sqlite'):':memory:'),source=new AccountDatabase(dir?join(dir,'source.sqlite'):':memory:');for(const d of [db,source])d.accounts(actor.sub);t.after(()=>{db.close();source.close();});
  const gateway=new ProviderEngine('payments',db),business=new ProviderEngine(provider,source);gateway.seed(actor);business.seed(actor);
  const method=kind==='wallet'?{id:'wallet',version:1}:db.transaction(()=>gateway.execute(actor,'POST','/payment-methods',{preset:kind,nickname:'Refund card'})).data.method;
  let p;
  if(business.recharges){const target=business.recharges.targets(actor.accountId)[0];p=business.recharges.quote(actor.accountId,{targetReference:target.reference,amountMinor:provider==='rta'?10000:5000,expectedTargetVersion:target.version,intentId:'refund-recharge'});}
  else if(provider==='police'){const fines=business.payables!.list(actor.accountId).filter(p=>p.status==='UNPAID');p=business.payables!.selectFines(actor.accountId,fines.map(p=>({payableId:p.id,expectedRevision:p.revision})));}
  else p=business.payables!.list(actor.accountId).find(p=>p.status==='UNPAID')!;
  db.transaction(()=>gateway.execute(actor,'POST','/billing-accounts',{provider,reference:p.reference,nickname:provider}));
  const settlements=new ProviderSettlements(source,provider,{call:async(account,payment,action,body:any)=>action==='claim'?gateway.claims!.claim(account,payment,provider,body):action==='ack'?gateway.claims!.acknowledge(account,payment,provider,body):gateway.claims!.release(account,payment,provider,body)});
  let failure='',tamper=false;
  const client={call:async(_provider:string,_actor:typeof actor,verb:string,path:string,body:any={},key='test')=>{
    if(path.startsWith('/payment-reversals/')){
      const id=path.split('/')[2];
      if(verb==='GET'){const reversal=business.reversals!.get(actor.accountId,id);return{reversal:tamper?{...reversal,receipt:{...reversal.receipt,amountMinor:1}}:reversal};}
      if(failure==='before'){failure='';throw new UpstreamError(503,'PROVIDER_OUTCOME_UNKNOWN','Lost before reversal');}
      const reversal=source.transaction(()=>business.reversals!.apply(actor.accountId,gateway.refunds!.get(actor,id)));
      if(failure==='after'){failure='';throw new UpstreamError(503,'PROVIDER_OUTCOME_UNKNOWN','Lost after reversal');}return{reversal};
    }
    if(path.endsWith('/payments')){const proof=gateway.execute(actor,'GET',`/charges/${body.paymentId}`,{}).data.charge;return(await settlements.execute(actor,key,createHash('sha256').update(JSON.stringify([verb,path,body])).digest('hex'),proof,claimed=>business.execute(actor,verb,path,body,claimed))).data;}
    let order;if(/\/(admit|cancel|finish)$/.test(path)){const admission=business.admissions!.get(actor.accountId,path.split('/')[4]);order=gateway.orders!.get(actor,admission.orderId);}
    return source.transaction(()=>business.execute(actor,verb,path,body,undefined,undefined,order)).data;
  }} as unknown as ProviderClient;
  const checkout=new PaymentCheckout(gateway.orders!,client),refunds=gateway.refunds!;
  const pay=async()=>{let o=gateway.orders!.create(actor,{provider,payableId:p.id,expectedPayableRevision:p.revision,methodId:method.id,expectedMethodVersion:1},p);o=gateway.orders!.approve(actor,o.id,decision(o),p);return checkout.execute(actor,o.id,decision(o));};
  const review=(id:string,amount:number,origin:'PAYMENT'|'WALLET_FUNDING'='PAYMENT')=>{const o=origin==='PAYMENT'?gateway.orders!.get(actor,id):gateway.funding!.get(actor,id);return refunds.create(actor,{origin,orderId:id,expectedVersion:o.version,amountMinor:amount,reason:'Demo reversal'});};
  const run=(r:PaymentRefund)=>refunds.execute(actor,r.id,decision(r),client);
  return{actor,db,source,gateway,business,method,p,pay,refunds,review,run,client,fail:(at:string)=>{failure=at;},tamper:(on:boolean)=>{tamper=on;}};
}
for(const provider of ['dewa','police'] as const)for(const kind of ['wallet','approved'])test(`${provider} full ${kind} reversal cancels exact paid obligations and refunds original source once`,async t=>{
  const f=fixture(t,provider,kind),o=await f.pay(),r=f.review(o.id,o.quote.totalMinor);assert.equal(f.gateway.ledger!.summary(f.actor.accountId).balanceMinor,kind==='wallet'?150000-o.quote.totalMinor:150000);
  const result=await f.run(r);assert.equal(result.state,'REFUNDED');assert.equal(f.gateway.ledger!.summary(f.actor.accountId).balanceMinor,150000);assert.equal(f.business.payables!.get(f.actor.accountId,f.p.id).status,'CANCELLED');assert.equal(f.gateway.orders!.get(f.actor,o.id).refundedMinor,o.quote.totalMinor);assert.equal(f.gateway.claims!.get(f.actor.accountId,o.paymentId!)!.reversedMinor,o.quote.totalMinor);
  if(kind==='approved'){const card=f.gateway.issuer!.summary(f.actor.accountId,f.method.id);assert.equal(card.spentMinor,0);assert.equal(card.refundedMinor,o.quote.totalMinor);}
  assert.equal((await f.refunds.recover(f.actor,r.id,f.client)).state,'REFUNDED');assert.equal(f.db.list(f.actor.accountId,'transaction').filter(t=>t.type==='REFUND').length,1);assert.throws(()=>f.review(o.id,1));
});
for(const provider of ['rta','etisalat','du'] as const)test(`${provider} partial then remaining recharge refund stays within capture and never credits card refunds to wallet`,async t=>{
  const f=fixture(t,provider,'approved'),o=await f.pay(),before=f.business.recharges!.targets(f.actor.accountId)[0].balanceMinor,first=await f.run(f.review(o.id,1000));assert.equal(first.state,'REFUNDED');assert.equal(f.business.recharges!.targets(f.actor.accountId)[0].balanceMinor,before-1000);assert.equal(f.gateway.orders!.get(f.actor,o.id).refundState,'PARTIALLY_REFUNDED');assert.equal(f.gateway.ledger!.summary(f.actor.accountId).balanceMinor,150000);
  assert.throws(()=>f.review(o.id,o.quote.totalMinor));const rest=await f.run(f.review(o.id,o.quote.totalMinor-1000));assert.equal(rest.state,'REFUNDED');assert.equal(f.business.recharges!.targets(f.actor.accountId)[0].balanceMinor,before-o.quote.totalMinor);assert.equal(f.gateway.issuer!.summary(f.actor.accountId,f.method.id).spentMinor,0);assert.equal(f.business.recharges!.get(f.actor.accountId,f.p.id).status,'CANCELLED');
});
for(const when of ['before','after'])test(`lost ${when} provider reversal response keeps money blocked and resumes original reversal`,async t=>{
  const f=fixture(t,'dewa'),o=await f.pay(),r=f.review(o.id,o.quote.totalMinor);f.fail(when);const unknown=await f.run(r);assert.equal(unknown.state,'RECONCILIATION_REQUIRED');assert.equal(f.gateway.ledger!.summary(f.actor.accountId).balanceMinor,107960);assert.throws(()=>f.review(o.id,o.quote.totalMinor),(e:any)=>e.code==='REFUND_IN_PROGRESS');
  const done=await f.refunds.recover(f.actor,r.id,f.client);assert.equal(done.state,'REFUNDED');assert.equal(f.gateway.ledger!.summary(f.actor.accountId).balanceMinor,150000);assert.equal(Number(f.source.db.prepare("SELECT count(*) n FROM provider_payment_reversals WHERE state='APPLIED'").get()!.n),1);
});
test('provider permanently rejects reversing spent credit and a replay cannot apply after balance replenishment',async t=>{
  const f=fixture(t,'du'),o=await f.pay(),line=f.source.get(f.actor.accountId,'prepaid-line',f.p.reference);f.source.put(f.actor.accountId,'prepaid-line',{...line,balanceMinor:100},f.p.reference);const r=f.review(o.id,1000),rejected=await f.run(r);assert.equal(rejected.state,'FAILED');assert.equal(rejected.failureCode,'RECHARGE_CREDIT_UNAVAILABLE');assert.equal(f.gateway.ledger!.summary(f.actor.accountId).balanceMinor,145000);
  f.source.put(f.actor.accountId,'prepaid-line',{...line,balanceMinor:20000},f.p.reference);assert.equal((await f.refunds.recover(f.actor,r.id,f.client)).state,'FAILED');assert.equal(f.business.reversals!.get(f.actor.accountId,r.id).state,'REJECTED');assert.equal(f.business.recharges!.targets(f.actor.accountId)[0].balanceMinor,20000);
});
test('forged/wrong-owner/source refund context and altered reversal receipt cannot return funds',async t=>{
  const f=fixture(t,'dewa'),o=await f.pay(),r=f.review(o.id,o.quote.totalMinor),other=actorFor({sub:'refund-other'});f.db.accounts(other.sub);assert.throws(()=>f.refunds.get(other,r.id),(e:any)=>e.status===404);assert.throws(()=>f.business.reversals!.apply(f.actor.accountId,{...r,state:'REVERSING',ownerSub:other.sub}),(e:any)=>e.code==='REFUND_NOT_ADMITTED');await assert.rejects(f.refunds.execute(f.actor,r.id,{...decision(r),approvalDigest:'a'.repeat(64)},f.client));
  f.tamper(true);assert.equal((await f.run(r)).state,'RECONCILIATION_REQUIRED');assert.equal(f.gateway.ledger!.summary(f.actor.accountId).balanceMinor,107960);f.tamper(false);assert.equal((await f.refunds.recover(f.actor,r.id,f.client)).state,'REFUNDED');
});
test('refund journal/issuer/original-state persistence failure rolls back funds then recovers confirmed source reversal',async t=>{
  const f=fixture(t,'rta','approved'),o=await f.pay(),r=f.review(o.id,1000);f.db.db.exec("CREATE TRIGGER fail_refund_transaction BEFORE INSERT ON resources WHEN NEW.kind='transaction' AND json_extract(NEW.body,'$.type')='REFUND' BEGIN SELECT RAISE(ABORT,'injected refund persistence');END");const pending=await f.run(r);assert.equal(pending.state,'RECONCILIATION_REQUIRED');assert.equal(f.gateway.issuer!.summary(f.actor.accountId,f.method.id).refundedMinor,0);assert.equal(f.gateway.orders!.get(f.actor,o.id).refundedMinor,undefined);f.db.db.exec('DROP TRIGGER fail_refund_transaction');assert.equal((await f.refunds.recover(f.actor,r.id,f.client)).state,'REFUNDED');assert.equal(f.gateway.issuer!.summary(f.actor.accountId,f.method.id).refundedMinor,1000);
});
test('concurrent refund execute/recovery cannot double reverse, credit or exceed cumulative capture',async t=>{
  const f=fixture(t,'dewa','approved'),o=await f.pay(),r=f.review(o.id,o.quote.totalMinor);await Promise.allSettled([f.run(r),f.run(r)]);const result=await f.refunds.recover(f.actor,r.id,f.client);assert.equal(result.state,'REFUNDED');assert.equal(f.gateway.issuer!.summary(f.actor.accountId,f.method.id).refundedMinor,o.quote.totalMinor);assert.equal(f.db.list(f.actor.accountId,'transaction').filter(t=>t.type==='REFUND').length,1);
});
test('disabled/removed original card can receive refund without a replacement source or new authority',async t=>{
  const f=fixture(t,'dewa','approved'),o=await f.pay();f.db.transaction(()=>f.gateway.execute(f.actor,'POST','/payment-methods/status',{methodId:f.method.id,expectedVersion:1,status:'REMOVED'}));const done=await f.run(f.review(o.id,o.quote.totalMinor));assert.equal(done.state,'REFUNDED');assert.equal(done.quote.source.id,f.method.id);assert.equal(f.gateway.issuer!.summary(f.actor.accountId,f.method.id).spentMinor,0);assert.equal(f.gateway.ledger!.summary(f.actor.accountId).balanceMinor,150000);
});
test('wallet-funding partial refunds debit available wallet and return only to its original captured card',async t=>{
  const f=fixture(t,'dewa','approved');let o=f.gateway.funding!.create(f.actor,{amountMinor:5000,methodId:f.method.id,expectedMethodVersion:1});o=f.gateway.funding!.approve(f.actor,o.id,decision(o));o=f.gateway.funding!.execute(f.actor,o.id,decision(o));assert.equal(f.gateway.ledger!.summary(f.actor.accountId).balanceMinor,155000);
  assert.equal((await f.run(f.review(o.id,2000,'WALLET_FUNDING'))).state,'REFUNDED');assert.equal(f.gateway.ledger!.summary(f.actor.accountId).balanceMinor,153000);assert.equal(f.gateway.issuer!.summary(f.actor.accountId,f.method.id).spentMinor,3000);assert.equal((await f.run(f.review(o.id,3000,'WALLET_FUNDING'))).state,'REFUNDED');assert.equal(f.gateway.ledger!.summary(f.actor.accountId).balanceMinor,150000);
});
test('spent or held wallet funding cannot be refunded into an overdraft or returned card value',async t=>{
  const f=fixture(t,'dewa','approved');let o=f.gateway.funding!.create(f.actor,{amountMinor:5000,methodId:f.method.id,expectedMethodVersion:1});o=f.gateway.funding!.approve(f.actor,o.id,decision(o));o=f.gateway.funding!.execute(f.actor,o.id,decision(o));f.gateway.ledger!.record(f.actor.accountId,'PAYMENT','spend-wallet',154000,'wallet');f.gateway.ledger!.reserve(f.actor.accountId,'another-review',1000,Date.now()+60000);const r=f.review(o.id,2000,'WALLET_FUNDING'),done=await f.run(r);assert.equal(done.state,'FAILED');assert.equal(done.failureCode,'INSUFFICIENT_AVAILABLE_FUNDS');assert.equal(f.gateway.ledger!.summary(f.actor.accountId).balanceMinor,1000);assert.equal(f.gateway.issuer!.summary(f.actor.accountId,f.method.id).refundedMinor,0);
});
test('refund source and gateway reopen preserve unknown identity and original cumulative settlement',async t=>{
  const dir=mkdtempSync(join(tmpdir(),'refund-reopen-'));t.after(()=>removeTemp(dir));const f=fixture(t,'dewa','wallet',dir),o=await f.pay(),r=f.review(o.id,o.quote.totalMinor);f.fail('after');await f.run(r);const db=new AccountDatabase(f.db.path),source=new AccountDatabase(f.source.path);t.after(()=>{db.close();source.close();});const restored=new ProviderEngine('payments',db),business=new ProviderEngine('dewa',source);assert.equal(restored.refunds!.get(f.actor,r.id).state,'RECONCILIATION_REQUIRED');assert.equal(business.reversals!.get(f.actor.accountId,r.id).state,'APPLIED');assert.equal((await f.refunds.recover(f.actor,r.id,f.client)).state,'REFUNDED');assert.equal(restored.orders!.get(f.actor,o.id).refundedMinor,42040);
});
test('partial bills/fines, invalid money, source overrides, unapproved and expired refunds deny',async t=>{
  const f=fixture(t),o=await f.pay();for(const amount of [0,-1,1.5,NaN,Infinity,42041,1])assert.throws(()=>f.review(o.id,amount));const r=f.review(o.id,42040);await assert.rejects(f.refunds.recover(f.actor,r.id,f.client),(e:any)=>e.code==='REFUND_APPROVAL_REQUIRED');t.mock.method(f.gateway.orders!,'clock',()=>Date.parse(r.expiresAt)+1);await assert.rejects(f.run(r),(e:any)=>e.code==='REFUND_CLOSED');assert.equal(f.gateway.ledger!.summary(f.actor.accountId).balanceMinor,107960);
  const body={accountId:'acc_1',requestKey:'refund_key_1',origin:'PAYMENT',orderId:'order_1',expectedVersion:1,amountMinor:100,reason:'Demo'};assert.equal(validateRequest('agent-core','POST','/api/payments/refunds',{},body),undefined);for(const changed of [{...body,source:'wallet'},{...body,amountMinor:0},{...body,origin:'CUSTOM'}])assert.equal(validateRequest('agent-core','POST','/api/payments/refunds',{},changed)?.status,400);
});

test('payment request keys are durably reserved before asynchronous refund effects and deny changed terms across reopen',async t=>{
  const dir=mkdtempSync(join(tmpdir(),'refund-request-key-'));t.after(()=>removeTemp(dir));const f=fixture(t,'dewa','wallet',dir),o=await f.pay(),r=f.review(o.id,42040);
  f.refunds.reserveRequest(f.actor.accountId,'one-owner-action','a'.repeat(64));f.refunds.reserveRequest(f.actor.accountId,'one-owner-action','a'.repeat(64));assert.throws(()=>f.refunds.reserveRequest(f.actor.accountId,'one-owner-action','b'.repeat(64)),(e:any)=>e.code==='IDEMPOTENCY_CONFLICT');
  const db=new AccountDatabase(f.db.path);t.after(()=>db.close());const restored=new ProviderEngine('payments',db);assert.throws(()=>restored.refunds!.reserveRequest(f.actor.accountId,'one-owner-action','b'.repeat(64)),(e:any)=>e.code==='IDEMPOTENCY_CONFLICT');assert.equal(f.gateway.ledger!.summary(f.actor.accountId).balanceMinor,107960);assert.equal((await f.run(r)).state,'REFUNDED');
});
