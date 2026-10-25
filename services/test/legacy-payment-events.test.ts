import { removeTemp } from '../../test/support/temp-cleanup.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash,randomUUID } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Ajv } from 'ajv';
import { AccountDatabase } from '../provider-simulator/src/database.ts';
import { ProviderEngine } from '../provider-simulator/src/engine.ts';
import { ProviderSettlements } from '../provider-simulator/src/provider-settlements.ts';
import { PaymentEvents,signPaymentEvent,type EventKeys } from '../provider-simulator/src/payment-events.ts';
import { paymentEventSchema,type PaymentEvent } from '../../packages/protocol-core/src/payment-events.ts';
import { legacyCaptureDigest } from '../../packages/backend-kit/src/legacy-payment-binding.ts';
import { actorFor } from '../../packages/backend-kit/src/context.ts';
import type { ProviderClient } from '../../packages/backend-kit/src/provider-client.ts';
import { inspectLegacyPayment } from '../agent-core/src/legacy-payment-status.ts';
const keys:EventKeys=producer=>`legacy-events-${producer}`.padEnd(48,'x');
function fixture(t:any,path=':memory:'){
  const actor=actorFor({sub:'legacy-event-owner'},undefined,'Bearer not-persisted'),db=new AccountDatabase(path),rtaDb=new AccountDatabase(':memory:');t.after(()=>{db.close();rtaDb.close();});for(const d of [db,rtaDb])d.accounts(actor.sub);
  const gateway=new ProviderEngine('payments',db),rta=new ProviderEngine('rta',rtaDb);gateway.seed(actor);rta.seed(actor);let holdAck=true;
  const provider=new ProviderSettlements(rtaDb,'rta',{call:async(account,id,action,body:any)=>{if(action==='ack'&&holdAck)throw new Error('Held acknowledgement');return action==='claim'?gateway.claims!.claim(account,id,'rta',body):action==='ack'?gateway.claims!.acknowledge(account,id,'rta',body):gateway.claims!.release(account,id,'rta',body);}});
  const charge=(amount=800,reference='parking:original')=>gateway.execute(actor,'POST','/charges',{amountMinor:amount,merchant:'rta',reference,source:'wallet'}).data.charge;
  const apply=async(c:any,extend?:string)=>{const body=extend?{additionalHours:1,paymentId:c.id,reference:c.reference.slice('parking-extension:'.length)}:{zoneId:'zone_302a',durationHours:2,plateNumber:rta.execute(actor,'GET','/parking/zones',{}).data.zones[0].id,paymentId:c.id,reference:c.reference.slice('parking:'.length)};
    if(!extend){const {assetsFor}=await import('../../packages/backend-kit/src/context.ts');body.plateNumber=assetsFor(actor.accountId).plate;}
    const route=extend?`/parking/sessions/${extend}/extensions`:'/parking/sessions',fp=createHash('sha256').update(JSON.stringify([route,body])).digest('hex');return provider.execute(actor,`apply:${c.id}`,fp,c,proof=>rta.execute(actor,'POST',route,body,proof));};
  const rows=(d=db)=>d.db.prepare('SELECT body FROM payment_event_outbox ORDER BY rowid').all().map(r=>JSON.parse(String(r.body)) as PaymentEvent);
  const receive=(e:PaymentEvent)=>db.events!.receive(e,signPaymentEvent(e,keys),keys);
  return {actor,db,rtaDb,gateway,rta,provider,charge,apply,rows,receive,releaseAck:()=>holdAck=false};
}
test('legacy capture/decline/refund events commit once with journal/resource state and contain no approval credential',t=>{
  const f=fixture(t),c=f.charge();assert.equal(f.gateway.ledger!.summary(f.actor.accountId).balanceMinor,149200);assert.equal(f.rows()[0].schemaVersion,2);assert.equal(f.rows()[0].subject.kind,'LEGACY_PAYMENT');assert.equal(f.rows()[0].binding.approvalDigest,undefined);assert.equal(f.rows()[0].binding.captureDigest,legacyCaptureDigest(c));
  assert.equal(f.gateway.execute(f.actor,'POST','/charges',{amountMinor:999999,merchant:'rta',reference:'decline',source:'wallet'}).status,402);f.gateway.execute(f.actor,'POST',`/charges/${c.id}/refunds`,{reason:'No application'});
  assert.deepEqual(f.rows().map(e=>e.state),['CAPTURED','DECLINED','REFUNDED']);assert.deepEqual(f.rows().filter(e=>e.subject.id===c.id).map(e=>e.subject.version),[1,2]);assert.equal(f.gateway.ledger!.summary(f.actor.accountId).balanceMinor,150000);assert.ok(!JSON.stringify(f.rows()).includes('not-persisted'));
});
test('failed outbox append rolls back legacy capture, journal, resource, transaction and event version together',t=>{
  const f=fixture(t);f.db.db.exec("CREATE TRIGGER fail_legacy_event BEFORE INSERT ON payment_event_outbox BEGIN SELECT RAISE(ABORT,'injected event failure');END");assert.throws(()=>f.charge(),/event failure/);assert.equal(f.gateway.ledger!.summary(f.actor.accountId).balanceMinor,150000);assert.equal(f.db.list(f.actor.accountId,'charge').length,0);assert.equal(f.db.list(f.actor.accountId,'transaction').length,0);assert.equal(f.db.db.prepare('SELECT count(*) n FROM payment_legacy_event_versions').get()!.n,0);
});
test('parking application and extension emit exact admitted legacy events atomically, callback never acknowledges settlement',async t=>{
  const f=fixture(t),c=f.charge();t.mock.method(f.rtaDb.events!,'clock',()=>Date.now()-86400000);const result=await f.apply(c),e=f.rows(f.rtaDb)[0];assert.ok(Date.parse(e.occurredAt)<Date.now()-86000000);assert.equal(e.type,'LEGACY_SETTLEMENT_CHANGED');assert.equal(e.binding.claimId,f.gateway.claims!.get(f.actor.accountId,c.id)!.claimId);assert.equal(f.receive(e).disposition,'APPLIED');assert.equal(f.gateway.claims!.get(f.actor.accountId,c.id)!.state,'CLAIMED');assert.equal(f.db.events!.status(f.actor.accountId).updates[0].currentState,'RECONCILIATION_REQUIRED');assert.equal(f.gateway.ledger!.summary(f.actor.accountId).balanceMinor,149200);
  f.releaseAck();await f.provider.inspect(f.actor,c.id);assert.equal(f.gateway.claims!.get(f.actor.accountId,c.id)!.state,'APPLIED');assert.equal(f.db.events!.status(f.actor.accountId).updates[0].currentState,'SETTLED');assert.equal(f.rows(f.rtaDb).length,1);
  const ext=f.charge(400,'parking-extension:original-extension');await f.apply(ext,result.data.meter.ticketId);assert.equal(f.rows(f.rtaDb).length,2);assert.equal(f.rtaDb.get(f.actor.accountId,'parking',result.data.meter.ticketId).durationHours,3);assert.equal(f.gateway.ledger!.summary(f.actor.accountId).balanceMinor,148800);
});
test('source outbox failure rolls back a real parking effect, retry keeps the admitted capture and creates one meter',async t=>{
  const f=fixture(t),c=f.charge();f.rtaDb.db.exec("CREATE TRIGGER fail_legacy_source_event BEFORE INSERT ON payment_event_outbox BEGIN SELECT RAISE(ABORT,'source event failure');END");await assert.rejects(f.apply(c),/event failure/);assert.equal(f.rtaDb.list(f.actor.accountId,'parking').length,0);assert.equal(f.gateway.claims!.get(f.actor.accountId,c.id)!.state,'CLAIMED');f.rtaDb.db.exec('DROP TRIGGER fail_legacy_source_event');await f.apply(c);assert.equal(f.rtaDb.list(f.actor.accountId,'parking').length,1);assert.equal(f.rows(f.rtaDb).length,1);assert.equal(f.db.list(f.actor.accountId,'charge').length,1);
});
test('signed invented or substituted legacy subjects, claims, attempts, digests, amounts and producers are rejected',async t=>{
  const f=fixture(t),c=f.charge();await f.apply(c);const e=f.rows(f.rtaDb)[0];
  const variants=[{...e,accountId:'acc_foreign'},{...e,subject:{...e.subject,id:'missing'}},{...e,binding:{...e.binding,claimId:'other'}},{...e,binding:{...e.binding,settlementAttemptId:'other'}},{...e,binding:{...e.binding,captureDigest:'0'.repeat(64)}},{...e,binding:{...e.binding,amountMinor:1}},{...e,binding:{...e.binding,paymentId:'other'}},{...e,producer:'du' as const}];
  for(const wrong of variants)assert.throws(()=>f.receive(wrong));assert.equal(f.db.events!.status(f.actor.accountId).received,0);assert.equal(f.gateway.ledger!.summary(f.actor.accountId).balanceMinor,149200);
  const unclaimed=f.charge(400,'parking:unclaimed');assert.throws(()=>f.receive({...e,id:`evt_${randomUUID()}`,subject:{...e.subject,id:unclaimed.id},binding:{...e.binding,paymentId:unclaimed.id,amountMinor:400,captureDigest:legacyCaptureDigest(unclaimed)}}));
});
test('duplicate and forged delivery cannot mutate a legacy claim, meter, charge or wallet',async t=>{
  const f=fixture(t),c=f.charge();await f.apply(c);const e=f.rows(f.rtaDb)[0];f.receive(e);const before=JSON.stringify([f.db.list(f.actor.accountId,'charge'),f.gateway.claims!.get(f.actor.accountId,c.id),f.rtaDb.list(f.actor.accountId,'parking'),f.gateway.ledger!.summary(f.actor.accountId)]);assert.equal(f.receive(e).disposition,'DUPLICATE');assert.throws(()=>f.db.events!.receive(e,{...signPaymentEvent(e,keys),signature:'0'.repeat(64)},keys));assert.equal(JSON.stringify([f.db.list(f.actor.accountId,'charge'),f.gateway.claims!.get(f.actor.accountId,c.id),f.rtaDb.list(f.actor.accountId,'parking'),f.gateway.ledger!.summary(f.actor.accountId)]),before);
});
test('reordered capture/refund events retain authoritative REFUNDED state without recrediting',t=>{
  const f=fixture(t),c=f.charge();f.gateway.execute(f.actor,'POST',`/charges/${c.id}/refunds`,{reason:'No effect'});const [capture,refund]=f.rows();assert.equal(f.receive(refund).disposition,'APPLIED');assert.equal(f.receive(capture).disposition,'STALE');assert.equal(f.db.events!.status(f.actor.accountId).updates[0].currentState,'REFUNDED');assert.equal(f.gateway.ledger!.summary(f.actor.accountId).balanceMinor,150000);
});
test('source rejection emits a release hint; delayed release after an authorized original refund cannot regress funds',async t=>{
  const f=fixture(t),c=f.charge();await f.provider.execute(f.actor,'reject',createHash('sha256').update('reject').digest('hex'),c,()=>{const e=new Error('Wrong owned resource') as Error&{status:number;code:string};e.status=409;e.code='RESOURCE_CHANGED';throw e;});const e=f.rows(f.rtaDb)[0];assert.equal(e.state,'RELEASED');assert.equal(f.gateway.claims!.get(f.actor.accountId,c.id)!.state,'RELEASED');f.gateway.execute(f.actor,'POST',`/charges/${c.id}/refunds`,{reason:'Confirmed non-application'});assert.equal(f.receive(e).disposition,'STALE');assert.equal(f.gateway.ledger!.summary(f.actor.accountId).balanceMinor,150000);
});
test('legacy delivery survives database reopen and stale lease acknowledgements while keeping original event identity',t=>{
  const dir=mkdtempSync(join(tmpdir(),'legacy-event-reopen-'));t.after(()=>removeTemp(dir));const f=fixture(t,join(dir,'payments.sqlite'));f.charge();let now=Date.now()+10;const one=new PaymentEvents(f.db,'payments',()=>now),first=one.claim(1)[0],other=new AccountDatabase(f.db.path);t.after(()=>other.close());const two=new PaymentEvents(other,'payments',()=>now);now+=15001;const retry=two.claim(1)[0];assert.equal(retry.event.id,first.event.id);assert.equal(one.finish(first,true),false);assert.equal(two.finish(retry,true),true);assert.equal(f.gateway.ledger!.summary(f.actor.accountId).balanceMinor,149200);
});
test('upgrading pre-event legacy records creates no event history or version backfill and leaves business rows unchanged',t=>{
  const f=fixture(t),c=f.charge();f.db.db.exec('DELETE FROM payment_event_outbox;DELETE FROM payment_legacy_event_versions;');const before=JSON.stringify(f.db.db.prepare('SELECT * FROM resources ORDER BY account_id,kind,id').all());new PaymentEvents(f.db,'payments');assert.equal(f.rows().length,0);assert.equal(f.db.db.prepare('SELECT count(*) n FROM payment_legacy_event_versions').get()!.n,0);assert.equal(JSON.stringify(f.db.db.prepare('SELECT * FROM resources ORDER BY account_id,kind,id').all()),before);assert.equal(f.db.get(f.actor.accountId,'charge',c.id).status,'CAPTURED');
});
test('versioned contract retains v1 stored events and disallows legacy fingerprints masquerading as approval',t=>{
  const f=fixture(t);f.charge();const e=f.rows()[0],validate=new Ajv({strict:false}).compile(paymentEventSchema);assert.equal(validate(e),true);assert.equal(validate({...e,schemaVersion:1}),false);assert.equal(validate({...e,binding:{...e.binding,approvalDigest:'a'.repeat(64)}}),false);assert.equal(validate({...e,subject:{...e.subject,kind:'PAYMENT'}}),false);
});
test('owned legacy status inspection re-reads existing provider attempt and never starts another payment/service effect',async t=>{
  const f=fixture(t),c=f.charge();await f.apply(c);const methods:string[]=[],source={call:async(provider:string,_actor:unknown,method:string,path:string)=>{methods.push(method);if(provider==='payments')return f.gateway.execute(f.actor,method,path,{}).data;return{settlement:await f.provider.inspect(f.actor,path.split('/')[2])};}} as unknown as ProviderClient;
  let view=await inspectLegacyPayment(f.actor,c.id,source);assert.equal(view.state,'RECONCILIATION_REQUIRED');f.releaseAck();view=await inspectLegacyPayment(f.actor,c.id,source);assert.equal(view.state,'SETTLED');assert.ok(methods.every(m=>m==='GET'));assert.equal(f.db.list(f.actor.accountId,'charge').length,1);assert.equal(f.rtaDb.list(f.actor.accountId,'parking').length,1);assert.equal(f.gateway.ledger!.summary(f.actor.accountId).balanceMinor,149200);
});
test('even an exactly bound signed APPLIED hint cannot invent provider application or acknowledge its pending claim',t=>{
  const f=fixture(t),c=f.charge(),{claim}=f.gateway.claims!.claim(f.actor.accountId,c.id,'rta',{attemptId:'pending-only',reference:c.reference,amountMinor:c.amountMinor});
  const event:PaymentEvent={id:`evt_${randomUUID()}`,schemaVersion:2,producer:'rta',accountId:f.actor.accountId,subject:{kind:'LEGACY_PAYMENT',id:c.id,version:1},type:'LEGACY_SETTLEMENT_CHANGED',state:'APPLIED',occurredAt:new Date().toISOString(),binding:{captureDigest:legacyCaptureDigest(c),amountMinor:c.amountMinor,currency:'AED',paymentId:c.id,provider:'rta',claimId:claim.claimId,settlementAttemptId:claim.attemptId}};
  assert.equal(f.receive(event).disposition,'APPLIED');assert.equal(f.gateway.claims!.get(f.actor.accountId,c.id)!.state,'CLAIMED');assert.equal(f.db.events!.status(f.actor.accountId).updates[0].currentState,'RECONCILIATION_REQUIRED');assert.equal(f.rtaDb.list(f.actor.accountId,'parking').length,0);assert.equal(f.db.list(f.actor.accountId,'charge').length,1);assert.equal(f.gateway.ledger!.summary(f.actor.accountId).balanceMinor,149200);
});
