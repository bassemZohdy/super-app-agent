import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Ajv } from 'ajv';
import { actorFor } from '../../packages/backend-kit/src/context.ts';
import type { ProviderClient } from '../../packages/backend-kit/src/provider-client.ts';
import { mandateSchemas, mandateRecordSchema, MANDATE_ACTOR, type MandatePolicy } from '../../packages/protocol-core/src/payment-mandates.ts';
import { validateRequest } from '../../packages/protocol-core/src/request-validation.ts';
import { AccountDatabase } from '../provider-simulator/src/database.ts';
import { ProviderEngine } from '../provider-simulator/src/engine.ts';
import { PaymentMandates } from '../provider-simulator/src/payment-mandates.ts';
import { verifyMandateTarget } from '../provider-simulator/src/mandate-targets.ts';
import { openApi } from '../provider-simulator/src/contracts.ts';

function fixture(t:any){
  const root=mkdtempSync(join(tmpdir(),'cityside-mandates-')),path=join(root,'payments.sqlite'),db=new AccountDatabase(path),engine=new ProviderEngine('payments',db),actor=actorFor({sub:'mandate-owner'},undefined,'Bearer owner');
  db.accounts(actor.sub);engine.seed(actor);let now=Date.now();const mandates=new PaymentMandates(db,engine.resourceUses!,()=>now);
  const post=(path:string,body:any)=>db.transaction(()=>engine.execute(actor,'POST',path,body)).data;
  const card=post('/payment-methods',{preset:'approved',nickname:'Exact approved source'}).method;
  const link=post('/billing-accounts',{provider:'dewa',reference:'owned-home',nickname:'Home'}).billingAccount;
  const policy=():MandatePolicy=>({actorClientId:MANDATE_ACTOR,audience:'provider-api',operation:'BILL_PAYMENT',purpose:'Pay my linked home bills',currency:'AED',
    target:{kind:'BILLER',billingAccountId:link.id,expectedVersion:link.version,provider:'dewa',reference:link.reference},sources:[{methodId:card.id,expectedVersion:card.version}],fallback:{mode:'NONE'},
    trigger:{type:'INVOICE_DUE',daysBefore:1},timezone:'Asia/Dubai',startsAt:new Date(now).toISOString(),expiresAt:new Date(now+30*86400000).toISOString(),
    limits:{perPaymentMinor:50000,periodMinor:100000,lifetimeMinor:300000,period:'MONTH',perPeriodCount:3,lifetimeCount:9,cooldownSeconds:3600}});
  t.after(()=>{db.close();rmSync(root,{recursive:true,force:true});});
  return {db,engine,actor,mandates,card,link,policy,post,path,advance:(ms:number)=>now+=ms};
}
const code=(value:string)=>(e:any)=>e.code===value;
test('mandate approval is exact, versioned, durable and carries zero money/credential effect',t=>{
  const f=fixture(t),before=JSON.stringify(f.engine.ledger!.summary(f.actor.accountId));let m=f.mandates.create(f.actor,f.policy());
  assert.equal(m.state,'AWAITING_APPROVAL');assert.equal(m.executionEnabled,false);assert.throws(()=>f.mandates.approve(f.actor,m.id,m.version,'0'.repeat(64)),code('MANDATE_APPROVAL_INVALID'));
  m=f.mandates.approve(f.actor,m.id,m.version,m.approvalDigest);assert.equal(m.state,'APPROVED');assert.equal(m.version,2);assert.equal(m.policyVersion,1);
  f.post('/payment-methods/default',{methodId:'wallet',expectedVersion:1});assert.deepEqual(f.mandates.get(f.actor,m.id),m);
  const db2=new AccountDatabase(f.path);t.after(()=>db2.close());const restored=new ProviderEngine('payments',db2);assert.deepEqual(restored.mandates!.get(f.actor,m.id),m);
  assert.equal(JSON.stringify(f.engine.ledger!.summary(f.actor.accountId)),before);assert.equal(f.db.list(f.actor.accountId,'charge').length,0);assert.equal(f.db.list(f.actor.accountId,'transaction').length,0);assert.equal(f.db.db.prepare('SELECT count(*) n FROM payment_card_authorizations').get()!.n,0);
  assert.equal(new Ajv({strict:false}).compile(mandateRecordSchema)(m),true);assert.equal(JSON.stringify(f.mandates.history(f.actor,m.id)).includes('Bearer'),false);
});
test('source/target/cap revision withdraws prior consent and preserves every immutable historical snapshot',t=>{
  const f=fixture(t);let m=f.mandates.create(f.actor,f.policy());m=f.mandates.approve(f.actor,m.id,m.version,m.approvalDigest);const old=m;
  const next={...f.policy(),sources:[{methodId:'wallet',expectedVersion:1}],limits:{...f.policy().limits,perPaymentMinor:60000}};
  m=f.mandates.revise(f.actor,m.id,m.version,next);assert.equal(m.state,'AWAITING_APPROVAL');assert.equal(m.policyVersion,2);assert.notEqual(m.approvalDigest,old.approvalDigest);assert.equal(m.approvedAt,undefined);
  assert.throws(()=>f.mandates.approve(f.actor,m.id,m.version,old.approvalDigest),code('MANDATE_APPROVAL_INVALID'));assert.throws(()=>f.mandates.approve(f.actor,m.id,old.version,m.approvalDigest),code('MANDATE_CHANGED'));
  const refs=f.engine.resourceUses!.list(f.actor.accountId);assert.equal(refs.some(r=>r.resourceId===f.card.id),false);assert.equal(refs.some(r=>r.resourceId==='wallet'),true);
  assert.deepEqual(f.mandates.history(f.actor,m.id).map(v=>[v.version,v.policyVersion,v.state]),[[1,1,'AWAITING_APPROVAL'],[2,1,'APPROVED'],[3,2,'AWAITING_APPROVAL']]);assert.equal(f.mandates.history(f.actor,m.id)[1].sourceSnapshots[0].last4,'4242');
  assert.throws(()=>f.db.db.prepare('UPDATE payment_mandate_versions SET body=? WHERE id=?').run('{}',m.id),/immutable/);assert.throws(()=>f.db.db.prepare('DELETE FROM payment_mandate_versions WHERE id=?').run(m.id),/immutable/);
});
test('active mandate references block source/biller removal; revocation releases only that policy references',t=>{
  const f=fixture(t),first=f.mandates.create(f.actor,f.policy()),second=f.mandates.create(f.actor,f.policy());
  assert.throws(()=>f.post('/payment-methods/status',{methodId:f.card.id,expectedVersion:1,status:'REMOVED'}),code('RESOURCE_IN_USE'));assert.throws(()=>f.post('/billing-accounts/archive',{billingAccountId:f.link.id,expectedVersion:1}),code('RESOURCE_IN_USE'));
  f.mandates.revoke(f.actor,first.id,first.version);assert.equal(f.engine.resourceUses!.list(f.actor.accountId).length,2);const closed=f.mandates.revoke(f.actor,second.id,second.version);assert.equal(closed.state,'REVOKED');assert.equal(f.engine.resourceUses!.list(f.actor.accountId).length,0);
  f.post('/payment-methods/status',{methodId:f.card.id,expectedVersion:1,status:'REMOVED'});assert.equal(f.mandates.history(f.actor,first.id)[0].sourceSnapshots[0].last4,'4242');assert.throws(()=>f.mandates.revise(f.actor,first.id,closed.version,f.policy()),code('MANDATE_CLOSED'));
});
test('another user/workspace and an unattended actor cannot create, approve or read owner consent',t=>{
  const f=fixture(t),m=f.mandates.create(f.actor,f.policy()),other=actorFor({sub:'another-user'},undefined,'Bearer other');f.db.accounts(other.sub);
  assert.throws(()=>f.mandates.get(other,m.id),code('MANDATE_NOT_FOUND'));assert.throws(()=>f.mandates.get({...other,accountId:f.actor.accountId},m.id),code('ACCOUNT_FORBIDDEN'));
  for(const method of [()=>f.mandates.create({...f.actor,authorization:undefined},f.policy()),()=>f.mandates.approve({...f.actor,authorization:undefined},m.id,m.version,m.approvalDigest)])assert.throws(method,code('INTERACTIVE_CONSENT_REQUIRED'));
  assert.throws(()=>f.mandates.create(other,f.policy()),code('MANDATE_SOURCE_CHANGED'));
});
test('changed/disabled/expired sources or archived links cannot be approved or substituted',t=>{
  const f=fixture(t),m=f.mandates.create(f.actor,f.policy());f.post('/payment-methods/status',{methodId:f.card.id,expectedVersion:1,status:'DISABLED'});
  assert.throws(()=>f.mandates.approve(f.actor,m.id,m.version,m.approvalDigest),code('MANDATE_SOURCE_CHANGED'));assert.equal(f.mandates.get(f.actor,m.id).state,'AWAITING_APPROVAL');
  const expired=f.post('/payment-methods',{preset:'expired',nickname:'Expired source'}).method;assert.throws(()=>f.mandates.create(f.actor,{...f.policy(),sources:[{methodId:expired.id,expectedVersion:1}]}),code('MANDATE_SOURCE_CHANGED'));
  assert.throws(()=>f.mandates.create(f.actor,{...f.policy(),sources:[{methodId:'wallet',expectedVersion:1}],target:{...f.policy().target,expectedVersion:99} as any}),code('MANDATE_TARGET_CHANGED'));
});
test('review and mandate expiration use real consent time and release lifecycle locks after reopen',t=>{
  const f=fixture(t),m=f.mandates.create(f.actor,f.policy());f.advance(300001);assert.equal(f.mandates.get(f.actor,m.id).state,'EXPIRED');assert.equal(f.engine.resourceUses!.list(f.actor.accountId).length,0);
  let approved=f.mandates.create(f.actor,{...f.policy(),expiresAt:new Date(Date.now()+600000).toISOString()});approved=f.mandates.approve(f.actor,approved.id,approved.version,approved.approvalDigest);f.advance(600001);assert.equal(f.mandates.get(f.actor,approved.id).state,'EXPIRED');assert.equal(f.engine.resourceUses!.list(f.actor.accountId).length,0);
});
test('strict policies reject unbounded, malformed, wildcard and inconsistent consent',t=>{
  const f=fixture(t),p=f.policy(),bad:any[]=[{...p,actorClientId:'any-agent'},{...p,operation:'ANY'},{...p,currency:'USD'},{...p,expiresAt:'forever'},{...p,timezone:'unknown/zone'},
    {...p,expiresAt:'2030-01-01T00:00:00.000Z'},{...p,startsAt:'2026-02-30T00:00:00.000Z'},{...p,limits:{...p.limits,perPaymentMinor:0}},{...p,limits:{...p.limits,periodMinor:1}},
    {...p,limits:{...p.limits,lifetimeCount:1}},{...p,limits:{...p.limits,cooldownSeconds:0}},{...p,limits:{...p.limits,perPaymentMinor:1.5}},{...p,limits:{...p.limits,perPaymentMinor:NaN}},
    {...p,limits:{...p.limits,perPaymentMinor:Number.MAX_SAFE_INTEGER}},{...p,sources:[]},{...p,sources:[...p.sources,...p.sources]},{...p,source:'default'},{...p,grantId:'read-grant'},{...p,url:'https://untrusted.invalid'},
    {...p,trigger:{type:'NEW_FINE'}},{...p,fineTypes:['Speeding']},{...p,target:{kind:'WALLET'}},{...p,fallback:{mode:'ORDERED',on:['CARD_DECLINED']}}];
  for(const policy of bad)assert.throws(()=>f.mandates.create(f.actor,policy),undefined,JSON.stringify(policy));assert.equal(f.mandates.list(f.actor).length,0);assert.equal(f.engine.resourceUses!.list(f.actor.accountId).length,0);
});
test('fallback sources are exact and ordered; challenge/unknown cannot be fallback conditions',t=>{
  const f=fixture(t),p={...f.policy(),sources:[...f.policy().sources,{methodId:'wallet',expectedVersion:1}],fallback:{mode:'ORDERED' as const,on:['CARD_DECLINED' as const]}};
  assert.equal(f.mandates.create(f.actor,p).sourceSnapshots[1].id,'wallet');assert.throws(()=>f.mandates.create(f.actor,{...p,fallback:{mode:'NONE'}}),code('INVALID_MANDATE_SOURCES'));
  assert.throws(()=>f.mandates.create(f.actor,{...p,fallback:{mode:'ORDERED',on:['TIMEOUT']} as any}),code('INVALID_MANDATE'));
});
test('all six operation families require their matching finite target and trigger',t=>{
  const f=fixture(t),p=f.policy(),link=(provider:string,reference:string)=>f.post('/billing-accounts',{provider,reference,nickname:'Owned target'}).billingAccount;
  const target=(provider:string,reference:string)=>{const b=link(provider,reference);return {kind:'BILLER' as const,billingAccountId:b.id,expectedVersion:1,provider:provider as any,reference};};
  const policies:MandatePolicy[]=[p,{...p,operation:'WALLET_RELOAD',target:{kind:'WALLET'},trigger:{type:'LOW_BALANCE',belowMinor:1000,reloadMinor:5000,targetBalanceMinor:10000}},
    {...p,operation:'RECHARGE',target:target('rta','tag'),trigger:{type:'LOW_BALANCE',belowMinor:1000,reloadMinor:5000,targetBalanceMinor:10000}},
    {...p,operation:'FINE_PAYMENT',target:target('police','plate'),trigger:{type:'NEW_FINE'},fineTypes:['Parking overstay']},
    {...p,operation:'SUBSCRIPTION_RENEWAL',target:target('du','subscription'),trigger:{type:'CALENDAR',dayOfMonth:31,hour:9,minute:0,monthEnd:'LAST_DAY'}},
    {...p,operation:'PARKING_EXTENSION',target:{kind:'PARKING',ticketId:'ticket',zoneId:'zone',plateNumber:'plate',maximumHours:4,endAt:new Date(Date.now()+7200000).toISOString()},trigger:{type:'PARKING_ENDING',minutesBefore:10}}];
  for(const policy of policies)assert.equal(f.mandates.create(f.actor,policy).policy.operation,policy.operation);
  assert.throws(()=>f.mandates.create(f.actor,{...policies[1],sources:[{methodId:'wallet',expectedVersion:1}]}),code('INVALID_WALLET_RELOAD'));
  assert.throws(()=>f.mandates.create(f.actor,{...policies[3],fineTypes:undefined}),code('INVALID_FINE_POLICY'));
});
test('concurrent connection revisions serialize against one expected head; a failed update retains consent and locks',t=>{
  const f=fixture(t),m=f.mandates.create(f.actor,f.policy()),second=new AccountDatabase(f.path);t.after(()=>second.close());const engine=new ProviderEngine('payments',second);
  const next=f.mandates.revise(f.actor,m.id,m.version,{...f.policy(),purpose:'Changed current purpose'});assert.throws(()=>engine.mandates!.approve(f.actor,m.id,m.version,m.approvalDigest),code('MANDATE_CHANGED'));
  assert.equal(f.mandates.history(f.actor,m.id).length,2);assert.deepEqual(engine.mandates!.get(f.actor,m.id),next);assert.equal(f.engine.resourceUses!.list(f.actor.accountId).length,2);
});
test('provider-owned eligibility uses fixed reads and cannot accept foreign or closed resource references',async t=>{
  const f=fixture(t),calls:string[]=[],client={call:async(provider:string,_actor:unknown,_method:string,path:string)=>{calls.push(`${provider}:${path}`);return {account:{accountNumber:'owned-home'}};}} as ProviderClient;
  await verifyMandateTarget(client,f.actor,f.policy());assert.deepEqual(calls,['dewa:/consumption']);await assert.rejects(verifyMandateTarget(client,f.actor,{...f.policy(),target:{...f.policy().target,reference:'foreign'} as any}),code('MANDATE_TARGET_UNAVAILABLE'));
  await verifyMandateTarget(client,f.actor,{...f.policy(),operation:'WALLET_RELOAD',target:{kind:'WALLET'}});assert.equal(calls.length,2);
});
test('OpenAPI and gateway contracts share strict mandate request/response schemas',t=>{
  const f=fixture(t),p=f.policy(),validate=new Ajv({strict:false}).compile(mandateSchemas.create);assert.equal(validate({policy:p}),true);assert.equal(validate({policy:p,approved:true}),false);
  const body={accountId:f.actor.accountId,requestKey:'mandate_key_01',policy:p};assert.equal(validateRequest('agent-core','POST','/api/payments/mandates',{},body),undefined);assert.ok(validateRequest('agent-core','POST','/api/payments/mandates',{},{...body,authorization:'consent'}));
  const contract=openApi('payments');assert.ok(contract.paths['/v1/accounts/{accountId}/payment-mandates']);assert.equal(contract.info.version,'2.15.0');
});
test('failed lifecycle binding rolls back the entire mandate head, history and all new references',t=>{
  const f=fixture(t),original=f.engine.resourceUses!.bind.bind(f.engine.resourceUses!);let calls=0;
  t.mock.method(f.engine.resourceUses!,'bind',(...args:Parameters<typeof original>)=>{original(...args);if(++calls===2)throw new Error('Injected binding persistence failure');});
  assert.throws(()=>f.mandates.create(f.actor,f.policy()),/persistence failure/);assert.equal(f.mandates.list(f.actor).length,0);assert.equal(f.db.db.prepare('SELECT count(*) n FROM payment_mandate_versions').get()!.n,0);assert.equal(f.engine.resourceUses!.list(f.actor.accountId).length,0);
});
test('current source-owned eligibility rejects prepaid/subscription confusion, wrong denominations and departed parking',async t=>{
  const f=fixture(t),base=f.policy(),client={call:async()=>({targets:[{reference:'tag',status:'ACTIVE',denominationsMinor:[5000]}],subscriptions:[{subscriptionId:'subscription',status:'ACTIVE'}],vehicles:[{plateNumber:'plate',status:'ACTIVE'}],meters:[{ticketId:'ticket',plateNumber:'plate',zoneId:'zone',status:'DEPARTED',expiresAt:Date.now()+3600000}]})} as unknown as ProviderClient;
  const target=(provider:string,reference:string)=>({kind:'BILLER' as const,billingAccountId:'link',expectedVersion:1,provider:provider as any,reference});
  const recharge:MandatePolicy={...base,operation:'RECHARGE',target:target('rta','tag'),trigger:{type:'LOW_BALANCE',belowMinor:1000,reloadMinor:5000,targetBalanceMinor:10000}};
  await verifyMandateTarget(client,f.actor,recharge);await assert.rejects(verifyMandateTarget(client,f.actor,{...recharge,trigger:{type:'LOW_BALANCE',belowMinor:1000,reloadMinor:2500,targetBalanceMinor:10000}}),code('MANDATE_TARGET_UNAVAILABLE'));
  await assert.rejects(verifyMandateTarget(client,f.actor,{...base,operation:'SUBSCRIPTION_RENEWAL',target:target('du','prepaid-line')}),code('MANDATE_TARGET_UNAVAILABLE'));
  await assert.rejects(verifyMandateTarget(client,f.actor,{...base,operation:'PARKING_EXTENSION',target:{kind:'PARKING',ticketId:'ticket',plateNumber:'plate',zoneId:'zone',maximumHours:2,endAt:base.expiresAt}}),code('MANDATE_TARGET_UNAVAILABLE'));
});
