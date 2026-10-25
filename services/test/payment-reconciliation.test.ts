import { removeTemp } from '../../test/support/temp-cleanup.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Ajv } from 'ajv';
import { AccountDatabase } from '../provider-simulator/src/database.ts';
import { ProviderEngine } from '../provider-simulator/src/engine.ts';
import { PaymentCheckout } from '../provider-simulator/src/payment-checkout.ts';
import { ProviderSettlements } from '../provider-simulator/src/provider-settlements.ts';
import { actorFor } from '../../packages/backend-kit/src/context.ts';
import { UpstreamError, type ProviderClient } from '../../packages/backend-kit/src/provider-client.ts';
import { recoveryInspectionSchema } from '../../packages/protocol-core/src/payment-reconciliation.ts';
import { validateRequest } from '../../packages/protocol-core/src/request-validation.ts';
const decision=(o:{version:number;approvalDigest:string})=>({expectedVersion:o.version,approvalDigest:o.approvalDigest});
function fixture(t:any, path=':memory:') {
  const actor=actorFor({sub:'recovery-owner'},undefined,'Bearer do-not-save'),db=new AccountDatabase(path),source=new AccountDatabase(':memory:');
  t.after(()=>{db.close();source.close();});for(const d of [db,source])d.accounts(actor.sub);
  const gateway=new ProviderEngine('payments',db),business=new ProviderEngine('dewa',source);gateway.seed(actor);business.seed(actor);
  const p=business.payables!.list(actor.accountId).find(p=>p.status==='UNPAID')!;
  db.transaction(()=>gateway.execute(actor,'POST','/billing-accounts',{provider:'dewa',reference:p.reference,nickname:'Recovery bill'}));
  const settlements=new ProviderSettlements(source,'dewa',{call:async(account,payment,action,body:any)=>action==='claim'?gateway.claims!.claim(account,payment,'dewa',body):action==='ack'?gateway.claims!.acknowledge(account,payment,'dewa',body):gateway.claims!.release(account,payment,'dewa',body)});
  let failure='',unavailable=false,tamper=false;const calls:{verb:string;path:string}[]=[];
  const client={call:async(_provider:string,_actor:typeof actor,verb:string,path:string,body:any={},key='test')=>{
    calls.push({verb,path});if(unavailable)throw new UpstreamError(503,'SOURCE_UNAVAILABLE','Unavailable');
    if(path.startsWith('/payment-reversals/')){
      const id=path.split('/')[2];if(verb==='GET')return {reversal:business.reversals!.get(actor.accountId,id)};
      const reversal=source.transaction(()=>business.reversals!.apply(actor.accountId,gateway.refunds!.get(actor,id)));
      if(failure==='reversal-after'){failure='';throw new UpstreamError(503,'PROVIDER_OUTCOME_UNKNOWN','Lost after reversal');}return{reversal};
    }
    if(failure==='before'&&verb==='POST'){failure='';throw new UpstreamError(503,'PROVIDER_OUTCOME_UNKNOWN','Lost before preparation');}
    if(path.endsWith('/payments')){
      const proof=gateway.execute(actor,'GET',`/charges/${body.paymentId}`,{}).data.charge;
      const result=(await settlements.execute(actor,key,createHash('sha256').update(JSON.stringify([verb,path,body])).digest('hex'),proof,claimed=>business.execute(actor,verb,path,body,claimed))).data;
      if(failure==='after'){failure='';throw new UpstreamError(503,'PROVIDER_OUTCOME_UNKNOWN','Lost after application');}return result;
    }
    let order;if(/\/(admit|cancel|finish)$/.test(path)){const admission=business.admissions!.get(actor.accountId,path.split('/')[4]);order=gateway.orders!.get(actor,admission.orderId);}
    const result=source.transaction(()=>business.execute(actor,verb,path,body,undefined,undefined,order)).data;
    return tamper&&result.admission?{...result,admission:{...result.admission,sourceVersion:999}}:result;
  }} as unknown as ProviderClient;
  const checkout=new PaymentCheckout(gateway.orders!,client),recovery=gateway.reconciliation!;
  const create=()=>{let o=gateway.orders!.create(actor,{provider:'dewa',payableId:p.id,expectedPayableRevision:p.revision,methodId:'wallet',expectedMethodVersion:1},p);o=gateway.orders!.approve(actor,o.id,decision(o),p);return o;};
  const inspect=(id:string,kind:'PAYMENT'|'REFUND'|'FUNDING'|'LEGACY'='PAYMENT')=>recovery.inspect(actor,kind,id,client);
  const act=(i:any,action:any='RECOVER_ORIGINAL')=>recovery.act(actor,i.id,{decisionDigest:i.decisionDigest,action},client,(a,id)=>gateway.execute(a,'POST',`/charges/${id}/refunds`,{reason:'Confirmed non-application'}));
  return{actor,db,source,gateway,business,p,client,checkout,recovery,create,inspect,act,calls,fail:(v:string)=>failure=v,unavailable:(v:boolean)=>unavailable=v,tamper:(v:boolean)=>tamper=v};
}
for(const when of ['before','after'])test(`recovery classifies lost ${when} commit and completes exactly one original capture`,async t=>{
  const f=fixture(t),o=f.create();f.fail(when);const pending=await f.checkout.execute(f.actor,o.id,decision(o));
  const i=await f.inspect(o.id);assert.equal(i.captureState,when==='before'?'NOT_CAPTURED':'COMMITTED');assert.equal(i.classification,when==='before'?'BEFORE_CAPTURE':'PROVIDER_APPLIED');
  assert.equal(new Ajv({strict:false}).compile(recoveryInspectionSchema)(i),true);
  const done=await f.act(i);assert.equal(done.status,'COMPLETED');assert.equal(done.resultState,'SETTLED');assert.equal(done.resultId,o.id);
  assert.equal(f.gateway.orders!.get(f.actor,o.id).paymentId,pending.paymentId);assert.equal(f.db.list(f.actor.accountId,'charge').length,1);assert.equal(f.gateway.ledger!.summary(f.actor.accountId).balanceMinor,107960);
  assert.deepEqual(await f.act(i),done);const phases=f.recovery.audit(f.actor,'PAYMENT',o.id).map(r=>r.phase);assert.ok(phases.includes('ACTION_ADMITTED'));assert.ok(phases.includes('ACTION_OBSERVED'));assert.ok(!JSON.stringify(f.recovery.audit(f.actor,'PAYMENT',o.id)).includes('do-not-save'));
});
test('current source outage and mismatched admission block recovery without creating money effects',async t=>{
  const f=fixture(t),o=f.create();f.fail('after');await f.checkout.execute(f.actor,o.id,decision(o));f.unavailable(true);let i=await f.inspect(o.id);assert.equal(i.classification,'BLOCKED');assert.deepEqual(i.actions,[]);await assert.rejects(f.act(i));f.unavailable(false);f.tamper(true);i=await f.inspect(o.id);assert.equal(i.classification,'INCONSISTENT');assert.deepEqual(i.actions,[]);assert.equal(f.db.list(f.actor.accountId,'charge').length,1);
});
test('owned expired stale and forged decisions fail before a recovery dispatch',async t=>{
  const f=fixture(t),o=f.create();f.fail('before');await f.checkout.execute(f.actor,o.id,decision(o));const i=await f.inspect(o.id),other=actorFor({sub:'other-owner'});f.db.accounts(other.sub);
  assert.throws(()=>f.recovery.get(other,i.id));await assert.rejects(f.recovery.act(f.actor,i.id,{decisionDigest:'0'.repeat(64),action:'RECOVER_ORIGINAL'},f.client,()=>{}));
  t.mock.method(f.recovery,'clock',()=>Date.parse(i.expiresAt)+1);await assert.rejects(f.act(i),(e:any)=>e.code==='RECOVERY_INSPECTION_EXPIRED');t.mock.restoreAll();
  await f.checkout.recover(f.actor,o.id);await assert.rejects(f.act(i),(e:any)=>e.code==='RECOVERY_EVIDENCE_CHANGED');assert.equal(f.db.list(f.actor.accountId,'charge').length,1);
});
test('confirmed payment offers separately approved refund review, replay creates one review and no money return',async t=>{
  const f=fixture(t),o=f.create();await f.checkout.execute(f.actor,o.id,decision(o));const i=await f.inspect(o.id);assert.equal(i.classification,'CONFIRMED');assert.deepEqual(i.actions,['REQUEST_REFUND_REVIEW']);
  const r=await f.act(i,'REQUEST_REFUND_REVIEW');assert.equal(r.resultKind,'REFUND');assert.equal(r.resultState,'AWAITING_APPROVAL');assert.deepEqual(await f.act(i,'REQUEST_REFUND_REVIEW'),r);assert.equal(f.gateway.refunds!.list(f.actor).length,1);assert.equal(f.gateway.ledger!.summary(f.actor.accountId).balanceMinor,107960);
  const review=f.gateway.refunds!.get(f.actor,r.resultId!);assert.equal((await f.gateway.refunds!.execute(f.actor,review.id,decision(review),f.client)).state,'REFUNDED');
});
test('lost provider reversal response is read as return pending and recovers the same refund once',async t=>{
  const f=fixture(t),o=f.create();const paid=await f.checkout.execute(f.actor,o.id,decision(o)),r=f.gateway.refunds!.create(f.actor,{origin:'PAYMENT',orderId:paid.id,expectedVersion:paid.version,amountMinor:paid.quote.totalMinor,reason:'Recovery test'});
  f.fail('reversal-after');assert.equal((await f.gateway.refunds!.execute(f.actor,r.id,decision(r),f.client)).state,'RECONCILIATION_REQUIRED');const i=await f.inspect(r.id,'REFUND');assert.equal(i.classification,'RETURN_PENDING');assert.equal((await f.act(i)).resultState,'REFUNDED');assert.equal(f.gateway.ledger!.summary(f.actor.accountId).balanceMinor,150000);assert.deepEqual((await f.inspect(r.id,'REFUND')).actions,[]);assert.equal(f.db.list(f.actor.accountId,'transaction').filter(t=>t.type==='REFUND').length,1);
});
test('concurrent recovery is fenced and an unknown dispatch retains its original inspection for retry',async t=>{
  const f=fixture(t),o=f.create();f.fail('before');await f.checkout.execute(f.actor,o.id,decision(o));const i=await f.inspect(o.id);
  const results=await Promise.allSettled([f.act(i),f.act(i)]);assert.ok(results.some(r=>r.status==='fulfilled'));assert.equal(f.db.list(f.actor.accountId,'charge').length,1);assert.equal(f.recovery.get(f.actor,i.id).status,'COMPLETED');
});
test('reopen retains evidence and append-only audit while finishing the original payment',async t=>{
  const dir=mkdtempSync(join(tmpdir(),'recovery-reopen-'));t.after(()=>removeTemp(dir));const f=fixture(t,join(dir,'payments.sqlite')),o=f.create();f.fail('after');await f.checkout.execute(f.actor,o.id,decision(o));const i=await f.inspect(o.id);
  const reopened=new AccountDatabase(f.db.path);t.after(()=>reopened.close());const engine=new ProviderEngine('payments',reopened);assert.equal(engine.reconciliation!.get(f.actor,i.id).decisionDigest,i.decisionDigest);
  assert.equal((await engine.reconciliation!.act(f.actor,i.id,{decisionDigest:i.decisionDigest,action:'RECOVER_ORIGINAL'},f.client,()=>{})).resultState,'SETTLED');
  assert.throws(()=>reopened.db.exec('DELETE FROM payment_recovery_audit'),/immutable/);assert.throws(()=>reopened.db.exec("UPDATE payment_recovery_audit SET kind='LEGACY'"),/immutable/);
});
test('more than 100 owned legacy records paginate without loss and do not authorize missing source refunds',async t=>{
  const f=fixture(t);for(let n=0;n<111;n++)f.gateway.execute(f.actor,'POST','/charges',{amountMinor:1,merchant:'dewa',reference:`unapplied:${n}`,source:'wallet'});
  let cursor='',seen:string[]=[];do{const page=f.recovery.list(f.actor,cursor);seen.push(...page.cases.map(c=>c.operationId));cursor=page.nextCursor||'';}while(cursor);assert.equal(seen.length,111);assert.equal(new Set(seen).size,111);
  const i=await f.inspect(seen[0],'LEGACY');assert.equal(i.classification,'BLOCKED');assert.deepEqual(i.actions,[]);assert.equal(f.gateway.ledger!.summary(f.actor.accountId).balanceMinor,149889);
});
test('journal mismatch and persisted decision tampering fail closed',async t=>{
  const f=fixture(t),o=f.create();f.fail('after');await f.checkout.execute(f.actor,o.id,decision(o));const i=await f.inspect(o.id);
  const row=f.db.db.prepare('SELECT body FROM payment_recovery_inspections WHERE id=?').get(i.id)!;const altered={...JSON.parse(String(row.body)),actions:['REFUND_UNAPPLIED_LEGACY']};f.db.db.prepare('UPDATE payment_recovery_inspections SET body=? WHERE id=?').run(JSON.stringify(altered),i.id);assert.throws(()=>f.recovery.get(f.actor,i.id),(e:any)=>e.code==='RECOVERY_INSPECTION_CORRUPT');
  t.mock.method(f.recovery as any,'journal',()=>false);const bad=await f.inspect(o.id);assert.equal(bad.classification,'INCONSISTENT');assert.deepEqual(bad.actions,[]);
});
test('workbench request validation rejects caller-defined money, callbacks, subjects and arbitrary recovery verbs',()=>{
  const base={accountId:'acc_owned',requestKey:'recovery_request',kind:'PAYMENT',operationId:'order_original'};
  assert.equal(validateRequest('agent-core','POST','/api/payments/reconciliation/inspect',{},base),undefined);
  for(const extra of [{amountMinor:1},{callback:'https://example.com'},{sub:'other'},{kind:'ANY'}])assert.equal(validateRequest('agent-core','POST','/api/payments/reconciliation/inspect',{}, {...base,...extra})?.status,400);
  const action={accountId:'acc_owned',requestKey:'recovery_request',inspectionId:'recovery_saved',decisionDigest:'a'.repeat(64),action:'RECOVER_ORIGINAL'};
  assert.equal(validateRequest('agent-core','POST','/api/payments/reconciliation/act',{},action),undefined);assert.equal(validateRequest('agent-core','POST','/api/payments/reconciliation/act',{}, {...action,action:'NEW_CHARGE'})?.status,400);
});

test('atomic card wallet funding is inspected without adding credit and offers only an approval review',async t=>{
  const f=fixture(t),card=f.gateway.execute(f.actor,'POST','/payment-methods',{preset:'approved',nickname:'Funding source'}).data.method;
  let o=f.gateway.funding!.create(f.actor,{amountMinor:5000,methodId:card.id,expectedMethodVersion:1});o=f.gateway.funding!.approve(f.actor,o.id,decision(o));o=f.gateway.funding!.execute(f.actor,o.id,decision(o));
  const before=f.gateway.ledger!.summary(f.actor.accountId).balanceMinor,i=await f.inspect(o.id,'FUNDING');assert.equal(i.captureState,'COMMITTED');assert.equal(i.classification,'CONFIRMED');assert.deepEqual(i.actions,['REQUEST_REFUND_REVIEW']);
  await f.act(i,'REQUEST_REFUND_REVIEW');assert.equal(f.gateway.ledger!.summary(f.actor.accountId).balanceMinor,before);assert.equal(before,155000);assert.equal(f.gateway.issuer!.summary(f.actor.accountId,card.id).spentMinor,5000);
});
test('exact provider release plus gateway fence permits one audited legacy return; missing evidence never does',async t=>{
  const f=fixture(t),c=f.gateway.execute(f.actor,'POST','/charges',{amountMinor:500,merchant:'dewa',reference:'legacy:released',source:'wallet'}).data.charge;
  const settlements=new ProviderSettlements(f.source,'dewa',{call:async(account,payment,action,body:any)=>action==='claim'?f.gateway.claims!.claim(account,payment,'dewa',body):action==='ack'?f.gateway.claims!.acknowledge(account,payment,'dewa',body):f.gateway.claims!.release(account,payment,'dewa',body)});
  await settlements.execute(f.actor,'release-case','a'.repeat(64),c,()=>{throw new UpstreamError(409,'RESOURCE_CHANGED','Rejected before application');});
  const client={call:async()=>({settlement:await settlements.inspect(f.actor,c.id)})} as unknown as ProviderClient;
  const i=await f.recovery.inspect(f.actor,'LEGACY',c.id,client);assert.deepEqual(i.actions,['REFUND_UNAPPLIED_LEGACY']);
  const act=()=>f.recovery.act(f.actor,i.id,{decisionDigest:i.decisionDigest,action:'REFUND_UNAPPLIED_LEGACY'},client,(a,id)=>f.gateway.execute(a,'POST',`/charges/${id}/refunds`,{reason:'Provider-confirmed release'}));
  assert.equal((await act()).resultState,'REFUNDED');await act();assert.equal(f.gateway.ledger!.summary(f.actor.accountId).balanceMinor,150000);assert.equal(f.db.list(f.actor.accountId,'transaction').filter(t=>t.type==='REFUND').length,1);
  assert.ok(f.recovery.audit(f.actor,'LEGACY',c.id).some(r=>r.phase==='ACTION_OBSERVED'&&r.state==='REFUNDED'));
});
test('unknown original dispatch remains retryable on its saved inspection after reopening evidence',async t=>{
  const f=fixture(t),o=f.create();f.fail('before');await f.checkout.execute(f.actor,o.id,decision(o));const i=await f.inspect(o.id);f.fail('before');
  const first=await f.act(i);assert.equal(first.status,'UNKNOWN');assert.equal(first.resultState,'CAPTURING');assert.equal(f.db.list(f.actor.accountId,'charge').length,0);
  const done=await f.act(first);assert.equal(done.id,i.id);assert.equal(done.status,'COMPLETED');assert.equal(done.attempts,2);assert.equal(f.db.list(f.actor.accountId,'charge').length,1);
});
test('audit persistence failure prevents legacy return and leaves original funds intact',async t=>{
  const f=fixture(t),c=f.gateway.execute(f.actor,'POST','/charges',{amountMinor:500,merchant:'dewa',reference:'legacy:release-audit',source:'wallet'}).data.charge;
  const claimed=f.gateway.claims!.claim(f.actor.accountId,c.id,'dewa',{attemptId:'released-attempt',reference:c.reference,amountMinor:c.amountMinor});f.gateway.claims!.release(f.actor.accountId,c.id,'dewa',{attemptId:'released-attempt',claimId:claimed.claim.claimId,reason:'NOT_APPLIED'});
  const client={call:async()=>({settlement:{paymentId:c.id,attemptId:'released-attempt',state:'RELEASED',gatewayConfirmed:true}})} as unknown as ProviderClient;
  const i=await f.recovery.inspect(f.actor,'LEGACY',c.id,client);
  f.db.db.exec("CREATE TRIGGER fail_recovery_outcome BEFORE INSERT ON payment_recovery_audit WHEN json_extract(NEW.body,'$.phase')='ACTION_OBSERVED' BEGIN SELECT RAISE(ABORT,'audit persistence failed');END");
  await assert.rejects(f.recovery.act(f.actor,i.id,{decisionDigest:i.decisionDigest,action:'REFUND_UNAPPLIED_LEGACY'},client,(a,id)=>f.gateway.execute(a,'POST',`/charges/${id}/refunds`,{reason:'Released'})),/audit persistence failed/);
  assert.equal(f.gateway.ledger!.summary(f.actor.accountId).balanceMinor,149500);assert.equal(f.db.get(f.actor.accountId,'charge',c.id).refunded,false);assert.equal(f.recovery.get(f.actor,i.id).status,'UNKNOWN');
});
