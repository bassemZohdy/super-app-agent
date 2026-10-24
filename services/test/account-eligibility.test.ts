import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync,rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Ajv } from 'ajv';
import { actorFor } from '../../packages/backend-kit/src/context.ts';
import type { ProviderClient } from '../../packages/backend-kit/src/provider-client.ts';
import { eligibilitySchema,eligibilityChangeSchema,lifecycleSchema } from '../../packages/protocol-core/src/account-eligibility.ts';
import { MANDATE_ACTOR,type MandatePolicy } from '../../packages/protocol-core/src/payment-mandates.ts';
import { validateRequest } from '../../packages/protocol-core/src/request-validation.ts';
import { AccountDatabase } from '../provider-simulator/src/database.ts';
import { ProviderEngine } from '../provider-simulator/src/engine.ts';
const code=(expected:string)=>(e:any)=>e.code===expected;
const terms=(o:{version:number;approvalDigest:string})=>({expectedVersion:o.version,approvalDigest:o.approvalDigest});
test('session resource reads validate the selected workspace without accepting a subject/path override',()=>{
  assert.equal(validateRequest('agent-core','GET','/api/sessions/session_12345',{accountId:'acct_household'},{}),undefined);
  assert.ok(validateRequest('agent-core','GET','/api/sessions/session_12345',{accountId:'acct_household',sessionId:'another_session'},{}));
  assert.ok(validateRequest('agent-core','DELETE','/api/sessions/session_12345',{accountId:'acct_household'},{}));
});
function fixture(t:any,preset='approved'){
  const root=mkdtempSync(join(tmpdir(),'cityside-eligibility-')),path=join(root,'payments.sqlite'),db=new AccountDatabase(path),source=new AccountDatabase(':memory:');
  const actor=actorFor({sub:'eligibility-owner'},undefined,'Bearer signed-owner'),household=actorFor({sub:actor.sub},undefined,actor.authorization);household.accountId=db.accounts(actor.sub).find(a=>a.id!==actor.accountId)!.id;source.accounts(actor.sub);
  const engine=new ProviderEngine('payments',db),provider=new ProviderEngine('dewa',source);engine.seed(actor);engine.seed(household);provider.seed(actor);
  const post=(path:string,body:any)=>db.transaction(()=>engine.execute(actor,'POST',path,body)).data;
  const card=post('/payment-methods',{preset,nickname:'Retained exact source'}).method,payable=provider.payables!.list(actor.accountId)[0],link=post('/billing-accounts',{provider:'dewa',reference:payable.reference,nickname:'Home'}).billingAccount;
  const eligibility=db.eligibility!,change=(enabled:boolean,kind:'OWNER'|'MEMBERSHIP'='MEMBERSHIP')=>{const s=eligibility.snapshot(actor.accountId);return eligibility.change(actor.accountId,{kind,enabled,expectedVersion:kind==='OWNER'?s.ownerVersion:s.membershipVersion,reason:'Explicit test operator decision'},'operator-sub',crypto.randomUUID());};
  const create=()=>engine.orders!.create(actor,{provider:'dewa',payableId:payable.id,expectedPayableRevision:payable.revision,methodId:card.id,expectedMethodVersion:1},payable);
  const policy=():MandatePolicy=>({actorClientId:MANDATE_ACTOR,audience:'provider-api',operation:'BILL_PAYMENT',purpose:'Pay the exact owned home bill',currency:'AED',target:{kind:'BILLER',billingAccountId:link.id,expectedVersion:1,provider:'dewa',reference:link.reference},sources:[{methodId:card.id,expectedVersion:1}],fallback:{mode:'NONE'},trigger:{type:'INVOICE_DUE',daysBefore:1},timezone:'Asia/Dubai',startsAt:new Date().toISOString(),expiresAt:new Date(Date.now()+86400000).toISOString(),limits:{perPaymentMinor:50000,periodMinor:100000,lifetimeMinor:300000,period:'MONTH',perPeriodCount:3,lifetimeCount:9,cooldownSeconds:3600}});
  t.after(()=>{db.close();source.close();rmSync(root,{recursive:true,force:true});});
  return {db,path,actor,household,engine,provider,card,payable,link,eligibility,post,change,create,policy};
}
test('eligibility defaults are additive and read-only; strict contracts reject supplied owner or epoch authority',t=>{
  const f=fixture(t),before=f.db.db.prepare('SELECT body FROM resources ORDER BY account_id,kind,id').all(),s=f.eligibility.snapshot(f.actor.accountId);
  assert.equal(s.epoch,'1:1');assert.equal(s.active,true);assert.deepEqual(f.db.db.prepare('SELECT * FROM payment_owner_eligibility').all(),[]);assert.deepEqual(f.db.db.prepare('SELECT * FROM payment_membership_eligibility').all(),[]);assert.deepEqual(f.db.db.prepare('SELECT body FROM resources ORDER BY account_id,kind,id').all(),before);
  const ajv=new Ajv({strict:false});assert.equal(ajv.compile(eligibilitySchema)(s),true);const valid=ajv.compile(eligibilityChangeSchema),input={kind:'OWNER',expectedVersion:1,enabled:false,reason:'Owner disabled by operator'};assert.equal(valid(input),true);assert.equal(valid({...input,ownerSub:'another-user'}),false);assert.equal(valid({...input,epoch:'1:1'}),false);assert.equal(valid({...input,reason:'new\nline'}),false);assert.throws(()=>f.eligibility.snapshot('unknown'),code('ACCOUNT_NOT_FOUND'));
});
test('membership and owner changes have separate scope, monotone epochs and canonical exact-key replay',t=>{
  const f=fixture(t),input={kind:'MEMBERSHIP' as const,expectedVersion:1,enabled:false,reason:'Revoke one workspace membership'},key='membership_request_001',first=f.eligibility.change(f.actor.accountId,input,'operator-sub',key);
  assert.equal(first.epoch,'1:2');assert.equal(first.active,false);assert.equal(f.eligibility.snapshot(f.household.accountId).active,true);
  assert.deepEqual(f.eligibility.change(f.actor.accountId,{reason:input.reason,enabled:false,expectedVersion:1,kind:'MEMBERSHIP'},'operator-sub',key),first);assert.throws(()=>f.eligibility.change(f.actor.accountId,input,'another-operator',key),code('ELIGIBILITY_REQUEST_CONFLICT'));
  f.change(true);assert.equal(f.eligibility.snapshot(f.actor.accountId).epoch,'1:3');f.change(false,'OWNER');assert.equal(f.eligibility.snapshot(f.household.accountId).active,false);assert.throws(()=>f.eligibility.require({...f.actor,sub:'another-user'}),code('ACCOUNT_FORBIDDEN'));f.change(true,'OWNER');assert.equal(f.eligibility.snapshot(f.actor.accountId).epoch,'3:3');assert.equal(f.eligibility.snapshot(f.household.accountId).epoch,'3:1');
});
test('two connections enforce version CAS, rollback audit failures, and retain immutable operator evidence',t=>{
  const f=fixture(t),other=new AccountDatabase(f.path);t.after(()=>other.close());new ProviderEngine('payments',other);f.change(false);
  assert.throws(()=>other.eligibility!.change(f.actor.accountId,{kind:'MEMBERSHIP',expectedVersion:1,enabled:true,reason:'Stale operator restore'},'operator-sub','stale_request_001'),code('ELIGIBILITY_CHANGED'));assert.equal(other.eligibility!.snapshot(f.actor.accountId).active,false);
  assert.throws(()=>f.db.db.prepare('DELETE FROM payment_eligibility_audit').run(),/immutable/);assert.throws(()=>f.db.db.prepare("UPDATE payment_eligibility_audit SET body='{}'").run(),/immutable/);
  f.db.db.exec("CREATE TRIGGER reject_test_audit BEFORE INSERT ON payment_eligibility_audit BEGIN SELECT RAISE(ABORT,'test audit outage');END;");assert.throws(()=>f.change(true),/test audit outage/);assert.equal(f.eligibility.snapshot(f.actor.accountId).epoch,'1:2');assert.equal(f.eligibility.snapshot(f.actor.accountId).active,false);
});
test('revoke-and-restore cannot revive an old approval or old in-memory actor epoch; cancellation releases its holds',t=>{
  const f=fixture(t),review=f.create(),approved=f.engine.orders!.approve(f.actor,review.id,terms(review),f.payable),oldActor={...f.actor,eligibilityEpoch:'1:1'};f.change(false);
  assert.throws(()=>f.engine.orders!.beginCapture(f.actor,approved.id,terms(approved),f.payable),code('ACCOUNT_RESTRICTED'));f.change(true);
  assert.throws(()=>f.engine.orders!.beginCapture(f.actor,approved.id,terms(approved),f.payable),code('ELIGIBILITY_CHANGED'));assert.throws(()=>f.eligibility.require(oldActor),code('ELIGIBILITY_CHANGED'));assert.equal(f.db.list(f.actor.accountId,'charge').length,0);assert.equal(f.engine.issuer!.summary(f.actor.accountId,f.card.id).spentMinor,0);
  const impact=f.eligibility.impact(f.actor.accountId);assert.equal(impact.orders[0].id,review.id);assert.deepEqual(impact.orders[0].blockedReasons,['ELIGIBILITY_CHANGED']);assert.equal(new Ajv({strict:false}).compile({type:'object',properties:lifecycleSchema,required:Object.keys(lifecycleSchema),additionalProperties:false})(impact),true);
  f.engine.orders!.cancel(f.actor,approved.id,approved.version);assert.equal(f.engine.issuer!.summary(f.actor.accountId,f.card.id).heldMinor,0);assert.equal(f.create().eligibilityEpoch,'1:3');assert.equal(f.db.get(f.actor.accountId,'default-method')||'wallet','wallet');
});
test('a permission change between committed provider admission and final capture prevents any debit',t=>{
  const f=fixture(t),review=f.create(),approved=f.engine.orders!.approve(f.actor,review.id,terms(review),f.payable),pending=f.engine.orders!.beginCapture(f.actor,review.id,terms(approved),f.payable);
  const prepared=f.provider.admissions!.prepare(f.actor.accountId,f.payable.id,{orderId:pending.id,expectedRevision:f.payable.revision,approvalDigest:pending.approvalDigest,sourceId:f.card.id,sourceVersion:1,expiresAt:pending.authorization!.expiresAt}),attached=f.engine.orders!.attachAdmission(f.actor,pending.id,prepared),admitted=f.provider.admissions!.admit(f.actor.accountId,prepared.id,attached);
  f.change(false);assert.throws(()=>f.engine.orders!.capture(f.actor,review.id,admitted),code('ACCOUNT_RESTRICTED'));f.change(true);assert.throws(()=>f.engine.orders!.capture(f.actor,review.id,admitted),code('ELIGIBILITY_CHANGED'));assert.equal(f.db.list(f.actor.accountId,'charge').length,0);assert.equal(f.engine.issuer!.summary(f.actor.accountId,f.card.id).spentMinor,0);
});
test('an already-captured original ID remains identifiable across revocation and cannot debit twice',t=>{
  const f=fixture(t),review=f.create(),approved=f.engine.orders!.approve(f.actor,review.id,terms(review),f.payable),pending=f.engine.orders!.beginCapture(f.actor,review.id,terms(approved),f.payable);
  const prepared=f.provider.admissions!.prepare(f.actor.accountId,f.payable.id,{orderId:pending.id,expectedRevision:f.payable.revision,approvalDigest:pending.approvalDigest,sourceId:f.card.id,sourceVersion:1,expiresAt:pending.authorization!.expiresAt}),attached=f.engine.orders!.attachAdmission(f.actor,pending.id,prepared),admitted=f.provider.admissions!.admit(f.actor.accountId,prepared.id,attached),captured=f.engine.orders!.capture(f.actor,review.id,admitted);
  f.change(false,'OWNER');const retained=f.eligibility.impact(f.actor.accountId).orders[0];assert.equal(retained.paymentId,captured.paymentId);assert.equal(retained.action,'PRESERVE_ORIGINAL_CAPTURE');assert.deepEqual(f.engine.orders!.capture(f.actor,review.id,admitted),captured);assert.equal(f.engine.issuer!.summary(f.actor.accountId,f.card.id).spentMinor,42040);assert.equal(f.db.list(f.actor.accountId,'charge').length,1);
});
test('wallet funding authority is invalidated while its original review remains cancellable after restore',t=>{
  const f=fixture(t),o=f.engine.funding!.create(f.actor,{amountMinor:5000,methodId:f.card.id,expectedMethodVersion:1}),a=f.engine.funding!.approve(f.actor,o.id,terms(o));f.change(false);assert.throws(()=>f.engine.funding!.execute(f.actor,o.id,terms(a)),code('ACCOUNT_RESTRICTED'));f.change(true);assert.throws(()=>f.engine.funding!.execute(f.actor,o.id,terms(a)),code('ELIGIBILITY_CHANGED'));
  f.engine.funding!.cancel(f.actor,o.id,a.version);assert.equal(f.engine.issuer!.summary(f.actor.accountId,f.card.id).heldMinor,0);assert.equal(f.engine.ledger!.summary(f.actor.accountId).balanceMinor,150000);assert.equal(f.db.list(f.actor.accountId,'transaction').length,0);
});
test('an archived owned biller link cannot authorize a new payment or consent and retains its tombstone',t=>{
  const f=fixture(t);f.post('/billing-accounts/archive',{billingAccountId:f.link.id,expectedVersion:1});
  assert.throws(()=>f.create(),code('BILLER_NOT_LINKED'));assert.throws(()=>f.engine.mandates!.create(f.actor,f.policy()),code('MANDATE_TARGET_CHANGED'));
  assert.equal(f.db.get(f.actor.accountId,'billing-account',f.link.id).status,'ARCHIVED');assert.equal(f.db.get(f.actor.accountId,'billing-account',f.link.id).reference,f.payable.reference);assert.equal(f.db.list(f.actor.accountId,'charge').length,0);assert.equal(f.engine.ledger!.summary(f.actor.accountId).balanceMinor,150000);
});
test('disabled and re-enabled cards cannot answer an old funding challenge or silently choose the wallet',t=>{
  const f=fixture(t,'challenge'),o=f.engine.funding!.create(f.actor,{amountMinor:5000,methodId:f.card.id,expectedMethodVersion:1}),a=f.engine.funding!.approve(f.actor,o.id,terms(o)),answer={...terms(a),challengeId:a.authorization!.challengeId!,decision:'APPROVE' as const};
  f.post('/payment-methods/status',{methodId:f.card.id,expectedVersion:1,status:'DISABLED'});assert.throws(()=>f.engine.funding!.challenge(f.actor,o.id,answer,true),code('METHOD_CHANGED'));f.post('/payment-methods/status',{methodId:f.card.id,expectedVersion:2,status:'ACTIVE'});assert.throws(()=>f.engine.funding!.challenge(f.actor,o.id,answer,true),code('METHOD_CHANGED'));assert.equal(f.engine.ledger!.summary(f.actor.accountId).balanceMinor,150000);assert.equal(f.engine.funding!.get(f.actor,o.id).quote.source.id,f.card.id);
});
test('restored membership needs explicit new mandate consent and never silently rebinds the source or workspace',t=>{
  const f=fixture(t),m=f.engine.mandates!.create(f.actor,f.policy());f.change(false);f.change(true);assert.throws(()=>f.engine.mandates!.approve(f.actor,m.id,m.version,m.approvalDigest),code('ELIGIBILITY_CHANGED'));
  assert.deepEqual(f.eligibility.impact(f.actor.accountId).mandates[0].blockedReasons,['ELIGIBILITY_CHANGED']);const revised=f.engine.mandates!.revise(f.actor,m.id,m.version,f.policy());assert.equal(revised.eligibilityEpoch,'1:3');assert.notEqual(revised.approvalDigest,m.approvalDigest);assert.equal(revised.sourceSnapshots[0].id,f.card.id);assert.equal(revised.accountId,f.actor.accountId);assert.equal(f.engine.mandates!.approve(f.actor,m.id,revised.version,revised.approvalDigest).executionEnabled,false);assert.equal(f.engine.mandates!.history(f.actor,m.id)[0].eligibilityEpoch,'1:1');
});
test('unstarted original-source refund reviews require new authority after access changes',async t=>{
  const f=fixture(t),o=f.engine.funding!.create(f.actor,{amountMinor:5000,methodId:f.card.id,expectedMethodVersion:1}),a=f.engine.funding!.approve(f.actor,o.id,terms(o)),settled=f.engine.funding!.execute(f.actor,o.id,terms(a)),r=f.engine.refunds!.create(f.actor,{origin:'WALLET_FUNDING',orderId:o.id,expectedVersion:settled.version,amountMinor:1000,reason:'Return unused demo funding'});f.change(false);f.change(true);
  await assert.rejects(f.engine.refunds!.execute(f.actor,r.id,terms(r),{} as ProviderClient),code('ELIGIBILITY_CHANGED'));assert.equal(f.engine.refunds!.get(f.actor,r.id).state,'AWAITING_APPROVAL');assert.equal(f.engine.ledger!.summary(f.actor.accountId).balanceMinor,155000);f.engine.refunds!.cancel(f.actor,r.id,r.version);
});
