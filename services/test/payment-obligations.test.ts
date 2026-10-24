import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync,rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { actorFor } from '../../packages/backend-kit/src/context.ts';
import type { Payable,PaymentAuthorizationReview } from '../../packages/protocol-core/src/payments.ts';
import { AccountDatabase } from '../provider-simulator/src/database.ts';
import { ProviderEngine } from '../provider-simulator/src/engine.ts';
const code=(value:string)=>(e:any)=>e.code===value;
const terms=(o:PaymentAuthorizationReview)=>({expectedVersion:o.version,approvalDigest:o.approvalDigest});
function fixture(t:any,provider:'dewa'|'police'|'rta'='dewa'){
  const root=mkdtempSync(join(tmpdir(),'cityside-obligation-')),path=join(root,'payments.sqlite'),db=new AccountDatabase(path),source=new AccountDatabase(':memory:'),actor=actorFor({sub:'reservation-owner'},undefined,'Bearer owner');
  for(const d of [db,source])d.accounts(actor.sub);let now=Date.now();const gateway=new ProviderEngine('payments',db,{authorizationClock:()=>now}),business=new ProviderEngine(provider,source);gateway.seed(actor);business.seed(actor);
  const post=(path:string,body:any)=>db.transaction(()=>gateway.execute(actor,'POST',path,body)).data;
  const method=post('/payment-methods',{preset:'approved',nickname:'Reserved source'}).method;
  const quote=()=>provider==='rta'?business.recharges!.quote(actor.accountId,{targetReference:business.recharges!.targets(actor.accountId)[0].reference,amountMinor:5000,expectedTargetVersion:business.recharges!.targets(actor.accountId)[0].version,intentId:crypto.randomUUID()}):business.payables!.list(actor.accountId).find(p=>p.status==='UNPAID')!;
  const payable=quote(),link=post('/billing-accounts',{provider,reference:payable.reference,nickname:'Reserved owned target'}).billingAccount;
  const create=(p=payable)=>gateway.orders!.create(actor,{provider,payableId:p.id,expectedPayableRevision:p.revision,methodId:method.id,expectedMethodVersion:1},p);
  const prepare=(o:PaymentAuthorizationReview,p=payable)=>{const approved=gateway.orders!.approve(actor,o.id,terms(o),p),pending=gateway.orders!.beginCapture(actor,o.id,terms(approved),p),prepared=business.admissions!.prepare(actor.accountId,p.id,{orderId:o.id,expectedRevision:p.revision,approvalDigest:o.approvalDigest,sourceId:method.id,sourceVersion:1,expiresAt:pending.authorization!.expiresAt}),attached=gateway.orders!.attachAdmission(actor,o.id,prepared),admitted=business.admissions!.admit(actor.accountId,prepared.id,attached);return {pending,admitted};};
  t.after(()=>{db.close();source.close();rmSync(root,{recursive:true,force:true});});return {db,source,path,actor,gateway,business,method,link,payable,quote,create,prepare,advance:(ms:number)=>now+=ms};
}
test('canonical business identity prevents quote aliases and revisions from reserving the same unpaid obligation',t=>{
  const f=fixture(t),o=f.create();for(const p of [{...f.payable,id:'dewa:bill:new-alias'},{...f.payable,id:'dewa:bill:another-alias',revision:'b'.repeat(64)}])assert.throws(()=>f.create(p),code('PAYABLE_RESERVED'));
  assert.equal(f.gateway.orders!.list(f.actor).length,1);assert.equal(f.gateway.resourceUses!.list(f.actor.accountId).length,2);assert.equal(f.gateway.issuer!.summary(f.actor.accountId,f.method.id).heldMinor,0);assert.equal(f.gateway.orders!.obligations.list(f.actor).obligations[0].orderId,o.id);
});
test('different connections cannot reserve overlapping fine groups and failed creation leaves no partial order or uses',t=>{
  const f=fixture(t,'police'),fines=f.business.payables!.list(f.actor.accountId).filter(p=>p.status==='UNPAID'),group=f.business.payables!.selectFines(f.actor.accountId,fines.map(p=>({payableId:p.id,expectedRevision:p.revision}))),o=f.create(group),other=new AccountDatabase(f.path);t.after(()=>other.close());const e=new ProviderEngine('payments',other);
  assert.throws(()=>e.orders!.create(f.actor,{provider:'police',payableId:fines[0].id,expectedPayableRevision:fines[0].revision,methodId:f.method.id,expectedMethodVersion:1},fines[0]),code('PAYABLE_RESERVED'));
  assert.equal(e.orders!.list(f.actor).length,1);assert.equal(e.resourceUses!.list(f.actor.accountId).length,2);assert.equal(e.orders!.obligations.list(f.actor).obligations.length,2);assert.ok(e.orders!.obligations.list(f.actor).obligations.every(r=>r.orderId===o.id));
});
test('two recharge intents at one target version cannot open competing funding holds',t=>{
  const f=fixture(t,'rta'),other=f.quote(),first=f.create();assert.throws(()=>f.create(other),code('PAYABLE_RESERVED'));assert.equal(f.gateway.orders!.obligations.list(f.actor).obligations.length,2);
  f.gateway.orders!.cancel(f.actor,first.id,first.version);assert.doesNotThrow(()=>f.create(other));assert.equal(f.gateway.issuer!.summary(f.actor.accountId,f.method.id).heldMinor,0);
});
test('fine constituents reject duplicate, nested, mismatched resource and altered-total source shapes atomically',t=>{
  const f=fixture(t,'police'),fines=f.business.payables!.list(f.actor.accountId).filter(p=>p.status==='UNPAID'),p=f.business.payables!.selectFines(f.actor.accountId,fines.map(p=>({payableId:p.id,expectedRevision:p.revision})));
  for(const invalid of [{...p,items:[fines[0],fines[0]],amountMinor:2*fines[0].amountMinor},{...p,items:[{...fines[0],provider:'du'}]},{...p,items:[{...fines[0],items:[fines[1]]}]},{...p,amountMinor:p.amountMinor+1}])assert.throws(()=>f.create(invalid as Payable),code('INVALID_OBLIGATION'));
  assert.equal(f.gateway.orders!.list(f.actor).length,0);assert.equal(f.gateway.resourceUses!.list(f.actor.accountId).length,0);assert.equal(f.gateway.orders!.obligations.list(f.actor).obligations.length,0);
});
test('capture identity is durable before dispatch; unknown admission blocks replacement after expiry and reopen',t=>{
  const f=fixture(t),o=f.create(),{pending}=f.prepare(o),before=f.gateway.orders!.obligations.list(f.actor).attempts[0];assert.equal(before.paymentId,pending.paymentId);assert.equal(before.id,`capture_${o.id}`);assert.equal(before.state,'PREPARING');assert.equal(before.inferred,false);assert.equal(before.fundsCaptured,false);
  f.gateway.orders!.unresolved(f.actor,o.id,'ADMISSION_RESPONSE_LOST');f.advance(600000);const other=new AccountDatabase(f.path);t.after(()=>other.close());const e=new ProviderEngine('payments',other,{authorizationClock:()=>Date.parse(pending.expiresAt)+600000});
  assert.equal(e.orders!.obligations.list(f.actor).attempts[0].state,'UNKNOWN');assert.equal(e.orders!.get(f.actor,o.id).paymentId,pending.paymentId);assert.throws(()=>e.orders!.create(f.actor,{provider:'dewa',payableId:f.payable.id,expectedPayableRevision:f.payable.revision,methodId:f.method.id,expectedMethodVersion:1},f.payable),code('PAYABLE_RESERVED'));assert.equal(e.issuer!.summary(f.actor.accountId,f.method.id).spentMinor,0);
});
test('final capture rollback retains the planned original attempt without a debit or committed reservation',t=>{
  const f=fixture(t),o=f.create(),{admitted}=f.prepare(o),put=f.db.put.bind(f.db);const mock=t.mock.method(f.db,'put',(account:string,kind:string,value:any,id?:string)=>{if(kind==='charge')throw Error('injected capture persistence loss');return put(account,kind,value,id);});
  assert.throws(()=>f.gateway.orders!.capture(f.actor,o.id,admitted),/injected capture/);mock.mock.restore();assert.equal(f.gateway.issuer!.summary(f.actor.accountId,f.method.id).spentMinor,0);assert.equal(f.gateway.orders!.obligations.list(f.actor).attempts[0].state,'PREPARING');assert.equal(f.gateway.orders!.obligations.list(f.actor).obligations[0].state,'RESERVED');assert.equal(f.gateway.orders!.capture(f.actor,o.id,admitted).fundsCaptured,true);
});
test('committed and uncertain work retains business exclusion and one attempt through settlement and restart',t=>{
  const f=fixture(t),o=f.create(),{admitted}=f.prepare(o),captured=f.gateway.orders!.capture(f.actor,o.id,admitted);f.gateway.orders!.unresolved(f.actor,o.id,'SOURCE_RESPONSE_LOST');assert.equal(f.gateway.orders!.obligations.list(f.actor).attempts[0].state,'UNKNOWN');assert.equal(f.gateway.orders!.obligations.list(f.actor).obligations[0].state,'COMMITTED');
  const charge=f.db.get(f.actor.accountId,'charge',captured.paymentId!);f.source.transaction(()=>f.business.admissions!.settle(f.actor.accountId,admitted.id,captured.paymentId!,charge));f.gateway.orders!.complete(f.actor,o.id,f.business.admissions!.get(f.actor.accountId,admitted.id));
  const other=new AccountDatabase(f.path);t.after(()=>other.close());const e=new ProviderEngine('payments',other),view=e.orders!.obligations.list(f.actor);assert.equal(view.attempts.length,1);assert.equal(view.attempts[0].state,'SETTLED');assert.equal(view.attempts[0].fundsCaptured,true);assert.equal(view.attempts[0].paymentId,captured.paymentId);assert.equal(view.obligations[0].state,'COMMITTED');assert.equal(e.issuer!.summary(f.actor.accountId,f.method.id).spentMinor,f.payable.amountMinor);
});
test('explicit pre-capture cancellation permanently closes the attempt and releases only its reservation',t=>{
  const f=fixture(t),o=f.create(),{pending}=f.prepare(o),cancelled=f.gateway.orders!.cancel(f.actor,o.id,f.gateway.orders!.get(f.actor,o.id).version);assert.equal(cancelled.state,'CANCELLED');const v=f.gateway.orders!.obligations.list(f.actor);assert.equal(v.attempts[0].state,'CANCELLED');assert.equal(v.attempts[0].paymentId,pending.paymentId);assert.equal(v.obligations[0].state,'RELEASED');assert.doesNotThrow(()=>f.create());assert.equal(f.gateway.issuer!.summary(f.actor.accountId,f.method.id).heldMinor,0);
});
test('capture attempt and obligation identity fields cannot be rebound by an update',t=>{
  const f=fixture(t),o=f.create();f.prepare(o);assert.throws(()=>f.db.db.prepare("UPDATE payment_capture_attempts SET payment_id='replacement'").run(),/immutable/);assert.throws(()=>f.db.db.prepare("UPDATE payment_order_obligations SET order_id='replacement'").run(),/immutable/);assert.throws(()=>f.gateway.orders!.obligations.list({...f.actor,sub:'another-owner'}),code('ACCOUNT_FORBIDDEN'));
});
test('legacy overlapping reviews survive migration byte-for-byte and block new authorization until explicitly cancelled',t=>{
  const f=fixture(t,'police'),fines=f.business.payables!.list(f.actor.accountId).filter(p=>p.status==='UNPAID'),first=f.create(),selection=f.business.payables!.selectFines(f.actor.accountId,fines.map(p=>({payableId:p.id,expectedRevision:p.revision}))),legacy={...first,id:`order_${crypto.randomUUID()}`,quote:{...first.quote,payable:selection,amountMinor:selection.amountMinor,totalMinor:selection.amountMinor},approvalDigest:'c'.repeat(64)};
  f.db.db.prepare('INSERT INTO payment_authorization_orders VALUES(?,?,?,?,?,?,?)').run(legacy.id,f.actor.accountId,'police',selection.id,legacy.state,Date.parse(legacy.expiresAt),JSON.stringify(legacy));for(const [resourceType,resourceId] of [['METHOD',f.method.id],['BILLER',f.link.id]] as const)f.gateway.resourceUses!.bind(f.actor.accountId,{resourceType,resourceId,resourceVersion:1,dependentKind:'ORDER',dependentId:legacy.id});
  const before=f.db.db.prepare('SELECT * FROM payment_authorization_orders ORDER BY id').all(),other=new AccountDatabase(f.path);t.after(()=>other.close());const e=new ProviderEngine('payments',other);assert.deepEqual(other.db.prepare('SELECT * FROM payment_authorization_orders ORDER BY id').all(),before);assert.ok(e.orders!.obligations.list(f.actor).obligations.some(r=>r.orderId===legacy.id&&r.state==='BLOCKED'));
  assert.throws(()=>e.orders!.approve(f.actor,legacy.id,terms(legacy),selection),code('OBLIGATION_RECONCILIATION_REQUIRED'));e.orders!.cancel(f.actor,first.id,first.version);assert.throws(()=>e.orders!.create(f.actor,{provider:'police',payableId:fines[0].id,expectedPayableRevision:fines[0].revision,methodId:f.method.id,expectedMethodVersion:1},fines[0]),code('PAYABLE_RESERVED'));e.orders!.cancel(f.actor,legacy.id,legacy.version);assert.doesNotThrow(()=>e.orders!.create(f.actor,{provider:'police',payableId:fines[0].id,expectedPayableRevision:fines[0].revision,methodId:f.method.id,expectedMethodVersion:1},fines[0]));
});

test('old captured orders derive labelled attempt metadata without rewriting original financial history',t=>{
  const f=fixture(t),o=f.create(),{admitted}=f.prepare(o),captured=f.gateway.orders!.capture(f.actor,o.id,admitted);
  const tables=['payment_authorization_orders','payment_card_authorizations','payment_journal_entries','resources'],snapshot=()=>tables.map(table=>f.db.db.prepare('SELECT * FROM '+table+' ORDER BY 1').all()),before=snapshot();
  f.db.db.exec('DROP TABLE payment_capture_attempts;DROP TABLE payment_order_obligations;');const other=new AccountDatabase(f.path);t.after(()=>other.close());const e=new ProviderEngine('payments',other),view=e.orders!.obligations.list(f.actor);
  assert.deepEqual(snapshot(),before);assert.equal(view.attempts[0].inferred,true);assert.equal(view.attempts[0].paymentId,captured.paymentId);assert.equal(view.attempts[0].state,'CAPTURED');assert.equal(view.obligations[0].state,'COMMITTED');assert.equal(view.obligations[0].legacy,true);
});
