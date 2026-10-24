import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash,randomUUID } from 'node:crypto';
import { mkdtempSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AccountDatabase } from '../provider-simulator/src/database.ts';
import { ProviderEngine } from '../provider-simulator/src/engine.ts';
import { PaymentCheckout } from '../provider-simulator/src/payment-checkout.ts';
import { ProviderSettlements } from '../provider-simulator/src/provider-settlements.ts';
import { PaymentEvents,signPaymentEvent,eventKeys,type EventKeys } from '../provider-simulator/src/payment-events.ts';
import { actorFor } from '../../packages/backend-kit/src/context.ts';
import { UpstreamError,type ProviderClient } from '../../packages/backend-kit/src/provider-client.ts';
import type { PaymentEvent } from '../../packages/protocol-core/src/payment-events.ts';
const keys:EventKeys=(producer,kid)=>kid==='v1'?`event-test-key-${producer}-`.padEnd(48,'x'):undefined;
const decision=(o:{version:number;approvalDigest:string})=>({expectedVersion:o.version,approvalDigest:o.approvalDigest});
function fixture(t:any,path=':memory:'){
  const actor=actorFor({sub:'event-owner'},undefined,'Bearer never-persist'),db=new AccountDatabase(path),source=new AccountDatabase(':memory:');t.after(()=>{db.close();source.close();});for(const d of [db,source])d.accounts(actor.sub);
  const gateway=new ProviderEngine('payments',db),provider=new ProviderEngine('dewa',source);gateway.seed(actor);provider.seed(actor);
  const p=provider.payables!.list(actor.accountId).find(p=>p.status==='UNPAID')!;db.transaction(()=>gateway.execute(actor,'POST','/billing-accounts',{provider:'dewa',reference:p.reference,nickname:'Home'}));
  const create=()=>gateway.orders!.create(actor,{provider:'dewa',payableId:p.id,expectedPayableRevision:p.revision,methodId:'wallet',expectedMethodVersion:1},p);
  const settlement=new ProviderSettlements(source,'dewa',{call:async(account,payment,action,body:any)=>action==='claim'?gateway.claims!.claim(account,payment,'dewa',body):action==='ack'?gateway.claims!.acknowledge(account,payment,'dewa',body):gateway.claims!.release(account,payment,'dewa',body)});
  let loseResponse=false;
  const client={call:async(_provider:string,_actor:typeof actor,method:string,path:string,body:any={},key='test')=>{
    if(path.startsWith('/payment-reversals/')){const id=path.split('/')[2];return{reversal:method==='GET'?provider.reversals!.get(actor.accountId,id):source.transaction(()=>provider.reversals!.apply(actor.accountId,gateway.refunds!.get(actor,id)))};}
    if(path.endsWith('/payments')){const proof=gateway.execute(actor,'GET',`/charges/${body.paymentId}`,{}).data.charge,result=await settlement.execute(actor,key,createHash('sha256').update(JSON.stringify([method,path,body])).digest('hex'),proof,claimed=>provider.execute(actor,method,path,body,claimed));if(loseResponse){loseResponse=false;throw new UpstreamError(503,'PROVIDER_OUTCOME_UNKNOWN','Lost after source commit');}return result.data;}
    let order;if(path.endsWith('/admit')||path.endsWith('/cancel')){const admission=provider.admissions!.get(actor.accountId,path.split('/')[4]);order=gateway.orders!.get(actor,admission.orderId);}
    return source.transaction(()=>provider.execute(actor,method,path,body,undefined,undefined,order)).data;
  }} as unknown as ProviderClient;
  const checkout=new PaymentCheckout(gateway.orders!,client),events=db.events!,sourceEvent=()=>JSON.parse(String(source.db.prepare('SELECT body FROM payment_event_outbox').get()!.body)) as PaymentEvent;
  const pay=async(lost=false)=>{let o=create();o=gateway.orders!.approve(actor,o.id,decision(o),p);loseResponse=lost;return checkout.execute(actor,o.id,decision(o));};
  const receive=(event:PaymentEvent,headers=signPaymentEvent(event,keys))=>events.receive(event,headers,keys);
  return{actor,db,source,gateway,provider,p,create,checkout,events,pay,sourceEvent,receive,client};
}
test('order transitions and stable event identities commit together; transport data excludes credentials',t=>{
  const f=fixture(t),o=f.create(),approved=f.gateway.orders!.approve(f.actor,o.id,decision(o),f.p),rows=f.db.db.prepare('SELECT body FROM payment_event_outbox ORDER BY rowid').all();assert.equal(rows.length,2);assert.deepEqual(rows.map(row=>JSON.parse(String(row.body)).state),['AWAITING_APPROVAL','AUTHORIZED']);assert.ok(!JSON.stringify(rows).includes('never-persist'));
  const event=JSON.parse(String(rows[0].body)) as PaymentEvent,{id:_id,occurredAt:_time,schemaVersion:_schema,producer:_producer,...content}=event;const same=f.db.transaction(()=>f.events.emit(content));assert.equal(same.id,event.id);assert.throws(()=>f.db.transaction(()=>f.events.emit({...content,state:'FAILED'})),(e:any)=>e.code==='EVENT_VERSION_CONFLICT');assert.equal(f.gateway.orders!.get(f.actor,o.id).version,approved.version);
});
test('outbox persistence failure rolls back a wallet capture and recovers its original admitted order',async t=>{
  const f=fixture(t),created=f.create(),o=f.gateway.orders!.approve(f.actor,created.id,decision(created),f.p);f.db.db.exec("CREATE TRIGGER fail_capture_event BEFORE INSERT ON payment_event_outbox WHEN json_extract(NEW.body,'$.state')='CAPTURED' BEGIN SELECT RAISE(ABORT,'injected outbox failure');END");
  const pending=await f.checkout.execute(f.actor,o.id,decision(o));assert.equal(pending.state,'CAPTURING');assert.equal(f.gateway.ledger!.summary(f.actor.accountId).balanceMinor,150000);assert.equal(f.db.list(f.actor.accountId,'charge').length,0);f.db.db.exec('DROP TRIGGER fail_capture_event');const paid=await f.checkout.recover(f.actor,o.id);assert.equal(paid.state,'SETTLED');assert.equal(f.gateway.ledger!.summary(f.actor.accountId).balanceMinor,107960);assert.equal(f.db.list(f.actor.accountId,'charge').length,1);
});
test('source application and callback outbox roll back together before replaying the original capture',async t=>{
  const f=fixture(t);f.source.db.exec("CREATE TRIGGER fail_source_event BEFORE INSERT ON payment_event_outbox BEGIN SELECT RAISE(ABORT,'injected source outbox failure');END");const pending=await f.pay();assert.equal(pending.state,'RECONCILIATION_REQUIRED');assert.equal(f.provider.payables!.get(f.actor.accountId,f.p.id).status,'UNPAID');assert.equal(f.source.db.prepare('SELECT count(*) n FROM payment_event_outbox').get()!.n,0);f.source.db.exec('DROP TRIGGER fail_source_event');const done=await f.checkout.recover(f.actor,pending.id);assert.equal(done.state,'SETTLED');assert.equal(done.paymentId,pending.paymentId);assert.equal(f.source.db.prepare('SELECT count(*) n FROM payment_event_outbox').get()!.n,1);
});
test('a signed provider callback is an inspection hint and cannot settle a captured unknown order',async t=>{
  const f=fixture(t),pending=await f.pay(true),event=f.sourceEvent(),before=f.gateway.ledger!.summary(f.actor.accountId);assert.equal(pending.state,'RECONCILIATION_REQUIRED');assert.equal(f.receive(event).disposition,'APPLIED');assert.equal(f.gateway.orders!.get(f.actor,pending.id).state,'RECONCILIATION_REQUIRED');assert.deepEqual(f.gateway.ledger!.summary(f.actor.accountId),before);assert.equal(f.events.status(f.actor.accountId).updates[0].needsInspection,true);
  assert.equal((await f.checkout.recover(f.actor,pending.id)).state,'SETTLED');assert.equal(f.events.status(f.actor.accountId).updates[0].needsInspection,false);assert.equal(f.db.list(f.actor.accountId,'charge').length,1);
  const original=f.gateway.orders!.get(f.actor,pending.id),refund=f.gateway.refunds!.create(f.actor,{origin:'PAYMENT',orderId:original.id,expectedVersion:original.version,amountMinor:42040,reason:'Reverse recovered payment'});assert.equal((await f.gateway.refunds!.execute(f.actor,refund.id,decision(refund),f.client)).state,'REFUNDED');assert.equal(f.receive(event).disposition,'DUPLICATE');assert.equal(f.events.status(f.actor.accountId).updates[0].currentState,'REFUNDED');assert.equal(f.provider.payables!.get(f.actor.accountId,f.p.id).status,'CANCELLED');assert.equal(f.gateway.ledger!.summary(f.actor.accountId).balanceMinor,150000);
});
test('exact and fresh-signature duplicate deliveries apply one inbox record without another money effect',async t=>{
  const f=fixture(t);await f.pay(true);const e=f.sourceEvent(),h=signPaymentEvent(e,keys);assert.equal(f.receive(e,h).disposition,'APPLIED');assert.equal(f.receive(e,h).disposition,'DUPLICATE');assert.equal(f.receive(e).disposition,'DUPLICATE');assert.equal(f.events.status(f.actor.accountId).received,1);assert.equal(f.db.list(f.actor.accountId,'charge').length,1);assert.equal(f.gateway.ledger!.summary(f.actor.accountId).balanceMinor,107960);
});
test('forged signatures, expired timestamps, untrusted key IDs, malformed bodies and cross-producer signing deny',async t=>{
  const f=fixture(t);await f.pay(true);const e=f.sourceEvent(),now=Date.now();t.mock.method(f.events,'clock',()=>now);const h=signPaymentEvent(e,keys,now);
  for(const headers of [{...h,signature:'0'.repeat(64)},{...h,kid:'unknown'},{...h,source:'du'},signPaymentEvent(e,keys,now-60001),signPaymentEvent(e,keys,now+60001),signPaymentEvent(e,()=>keys('du','v1'))])assert.throws(()=>f.receive(e,headers),(error:any)=>error.status===401);
  assert.throws(()=>f.receive({...e,binding:{...e.binding,amountMinor:1}} as PaymentEvent,h),(error:any)=>error.status===401);assert.throws(()=>f.receive({...e,extra:'untrusted'} as PaymentEvent),(error:any)=>error.status===400);assert.equal(f.events.status(f.actor.accountId).received,0);
});
test('correctly signed but substituted owner, original payment, amount or producer authority cannot enter the inbox',async t=>{
  const f=fixture(t);await f.pay(true);const e=f.sourceEvent();
  for(const changed of [{...e,accountId:'acc_foreign'},{...e,subject:{...e.subject,id:'order_foreign'}},{...e,binding:{...e.binding,amountMinor:1}},{...e,binding:{...e.binding,paymentId:'another-capture'}},{...e,producer:'du' as const},{...e,type:'ORDER_CHANGED' as const}])assert.throws(()=>f.receive(changed));assert.equal(f.events.status(f.actor.accountId).received,0);assert.equal(f.db.list(f.actor.accountId,'charge').length,1);
});
test('signed event ID, delivery nonce and same-version collisions fail without changing an accepted hint',async t=>{
  const f=fixture(t);await f.pay(true);const e=f.sourceEvent(),h=signPaymentEvent(e,keys);f.receive(e,h);
  const changed={...e,occurredAt:new Date(Date.now()-1000).toISOString()};assert.throws(()=>f.receive(changed),(error:any)=>error.code==='EVENT_ID_CONFLICT');
  const second={...e,id:`evt_${randomUUID()}`};assert.throws(()=>f.receive(second,signPaymentEvent(second,keys,Date.now(),h.nonce)),(error:any)=>error.code==='EVENT_NONCE_CONFLICT');assert.throws(()=>f.receive(second),(error:any)=>error.code==='EVENT_VERSION_CONFLICT');assert.equal(f.events.status(f.actor.accountId).received,1);
});
test('reordered gateway state events and delayed provider callbacks cannot regress a confirmed terminal payment',async t=>{
  const f=fixture(t),paid=await f.pay(),all=f.db.db.prepare('SELECT body FROM payment_event_outbox ORDER BY rowid').all().map(row=>JSON.parse(String(row.body)) as PaymentEvent),latest=all.at(-1)!;assert.equal(latest.state,'SETTLED');assert.equal(f.receive(latest).disposition,'APPLIED');for(const e of all.slice(0,-1).reverse())assert.equal(f.receive(e).disposition,'STALE');assert.equal(f.receive(f.sourceEvent()).disposition,'STALE');assert.equal(f.events.status(f.actor.accountId).updates[0].observedState,'SETTLED');assert.equal(f.gateway.orders!.get(f.actor,paid.id).state,'SETTLED');
});
test('source notification cannot assert application before an original capture or admission exists',t=>{
  const f=fixture(t),o=f.create(),e:PaymentEvent={id:`evt_${randomUUID()}`,schemaVersion:1,producer:'dewa',accountId:f.actor.accountId,subject:{kind:'PAYMENT',id:o.id,version:1},type:'PROVIDER_APPLIED',state:'APPLIED',occurredAt:new Date().toISOString(),binding:{approvalDigest:o.approvalDigest,amountMinor:o.quote.totalMinor,currency:'AED',paymentId:'invented',admissionId:'invented',provider:'dewa'}};assert.throws(()=>f.receive(e),(error:any)=>error.code==='EVENT_BINDING_MISMATCH');assert.equal(f.gateway.orders!.get(f.actor,o.id).state,'AWAITING_APPROVAL');assert.equal(f.gateway.ledger!.summary(f.actor.accountId).balanceMinor,150000);
});
test('two connections fence delivery leases and stale acknowledgements; crash/reopen reclaims the original event',t=>{
  const dir=mkdtempSync(join(tmpdir(),'event-lease-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));const f=fixture(t,join(dir,'payments.sqlite'));f.create();let now=Date.now()+100;const one=new PaymentEvents(f.db,'payments',()=>now),otherDb=new AccountDatabase(f.db.path);t.after(()=>otherDb.close());const two=new PaymentEvents(otherDb,'payments',()=>now),first=one.claim(1)[0];assert.equal(two.claim(1).length,0);now+=15001;assert.equal(one.finish(first,true),false,'Expired leases cannot acknowledge even before another worker reclaims them.');const second=two.claim(1)[0];assert.equal(second.event.id,first.event.id);assert.equal(one.finish(first,true),false);assert.equal(two.finish(second,true),true);assert.equal(one.status(f.actor.accountId).pending,0);
});
test('lost callback response retries with a fresh signature and the same event ID after persisted backoff',async t=>{
  const f=fixture(t);await f.pay(true);let now=Date.now()+100;const sender=new PaymentEvents(f.source,'dewa',()=>now),first=sender.claim(1)[0];f.receive(first.event);sender.finish(first,false);assert.equal(sender.claim(1).length,0);now+=1001;const retry=sender.claim(1)[0];assert.equal(retry.event.id,first.event.id);assert.equal(f.receive(retry.event).disposition,'DUPLICATE');sender.finish(retry,true);assert.equal(sender.status(f.actor.accountId).pending,0);assert.equal(f.events.status(f.actor.accountId).received,1);
});
test('bounded delivery retries become visible failed delivery without releasing funds or inventing receipts',t=>{
  const f=fixture(t);f.create();let now=Date.now()+100;const sender=new PaymentEvents(f.db,'payments',()=>now);for(let i=0;i<20;i++){const d=sender.claim(1)[0];assert.ok(d);sender.finish(d,false);now+=60001;}assert.equal(sender.status(f.actor.accountId).failed,1);assert.equal(sender.claim(1).length,0);assert.equal(f.gateway.ledger!.summary(f.actor.accountId).balanceMinor,150000);assert.equal(f.db.list(f.actor.accountId,'charge').length,0);
});
test('receiver key rollover accepts the configured previous key ID then rejects it after retirement',async t=>{
  const f=fixture(t);await f.pay(true);const event=f.sourceEvent(),headers=signPaymentEvent(event,keys),names=['PAYMENT_EVENT_DEWA_KEY','PAYMENT_EVENT_DEWA_KEY_ID','PAYMENT_EVENT_DEWA_PREVIOUS_KEY','PAYMENT_EVENT_DEWA_PREVIOUS_KEY_ID'],old=Object.fromEntries(names.map(n=>[n,process.env[n]]));t.after(()=>{for(const n of names){if(old[n]===undefined)delete process.env[n];else process.env[n]=old[n];}});
  process.env.PAYMENT_EVENT_DEWA_KEY='new-receiver-current-key'.padEnd(48,'z');process.env.PAYMENT_EVENT_DEWA_KEY_ID='v2';process.env.PAYMENT_EVENT_DEWA_PREVIOUS_KEY=keys('dewa','v1');process.env.PAYMENT_EVENT_DEWA_PREVIOUS_KEY_ID='v1';assert.equal(f.events.receive(event,headers,eventKeys).disposition,'APPLIED');delete process.env.PAYMENT_EVENT_DEWA_PREVIOUS_KEY;assert.throws(()=>f.events.receive(event,headers,eventKeys),(e:any)=>e.status===401);
});
