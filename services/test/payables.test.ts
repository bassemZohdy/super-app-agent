import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Ajv } from 'ajv';
import { AccountDatabase } from '../provider-simulator/src/database.ts';
import { ProviderEngine } from '../provider-simulator/src/engine.ts';
import { ProviderPayables, PayableError, type PayableProvider } from '../provider-simulator/src/payables.ts';
import { actorFor } from '../../packages/backend-kit/src/context.ts';
import { operations } from '../provider-simulator/src/contracts.ts';
const start=Date.parse('2026-10-24T00:00:00.000Z');
function fixture(t: any,provider: PayableProvider='dewa') {
  const db=new AccountDatabase(':memory:');t.after(()=>db.close());const actor=actorFor({sub:'payable-owner'});db.accounts(actor.sub);
  let time=start;const engine=new ProviderEngine(provider,db,{businessClock:()=>time});engine.seed(actor);
  return {db,actor,engine,book:engine.payables!,advance:(ms:number)=>{time+=ms;}};
}
const error=(code:string)=>(e:unknown)=>e instanceof PayableError && e.code===code;

test('provider-owned revisioned payables conform to schemas and retain labelled prior cycles without changing the current bill',t=>{
  const ajv=new Ajv({strict:false});
  for(const provider of ['dewa','etisalat','du','police'] as const) {
    const {db,actor,engine,book}=fixture(t,provider),before=JSON.stringify(db.get(actor.accountId,'bill'));
    const result=engine.execute(actor,'GET','/payables',{}).data;
    const operation=operations[provider].find(o=>o.id==='listVersionedPayables')!;
    assert.equal(ajv.compile(operation.result.payables)(result.payables),true);
    assert.equal(result.payables.length,2);assert.equal(new Set(result.payables.map((p:any)=>p.id)).size,2);
    if(provider!=='police') {assert.equal(result.payables[0].status,'UNPAID');assert.equal(result.payables[1].status,'PAID');assert.equal(result.payables[1].openingFixture,true);}
    for(let n=0;n<3;n++)engine.seed(actor);
    assert.equal(book.list(actor.accountId).length,2);assert.equal(JSON.stringify(db.get(actor.accountId,'bill')),before);
  }
});

test('issue and amend multiple owned bill cycles; revisions change without identity reuse or terminal resurrection',t=>{
  const {actor,book,db,engine}=fixture(t),account=actor.accountId;
  const initial=book.list(account)[0],input={billId:'invoice-december',reference:initial.reference,amountMinor:12345,dueDate:'2026-12-31',period:'2026-12'};
  const issued=book.issueBill(account,input);assert.equal(issued.amountMinor,12345);assert.equal(book.list(account).length,3);
  assert.throws(()=>book.issueBill(account,input),error('BILL_EXISTS'));
  assert.throws(()=>book.issueBill(account,{...input,billId:'foreign',reference:'foreign-owner'}),error('BILLER_NOT_OWNED'));
  for(const value of [0,-1,1.5,NaN,Infinity,100000001])assert.throws(()=>book.amend(account,issued.id,issued.revision,{amountMinor:value}),error('INVALID_PAYABLE'));
  const changed=book.amend(account,issued.id,issued.revision,{amountMinor:23456});assert.notEqual(changed.revision,issued.revision);assert.equal(changed.version,2);
  assert.throws(()=>book.inspect(account,issued.id,issued.revision),error('PAYABLE_CHANGED'));
  assert.throws(()=>book.amend(account,issued.id,issued.revision,{amountMinor:1}),error('PAYABLE_CHANGED'));
  const cancelled=book.amend(account,issued.id,changed.revision,{status:'CANCELLED'});assert.equal(cancelled.dueState,'CLOSED');
  assert.throws(()=>book.inspect(account,issued.id,cancelled.revision),error('PAYABLE_UNAVAILABLE'));
  assert.throws(()=>book.amend(account,issued.id,cancelled.revision,{amountMinor:1}),error('PAYABLE_UNAVAILABLE'));
  assert.throws(()=>book.issueBill(account,input),error('BILL_EXISTS'));
  assert.throws(()=>db.transaction(()=>engine.execute(actor,'POST',`/bills/${input.billId}/payments`,{paymentId:'unused-proof'})),(e:any)=>e.code==='PAYABLE_UNAVAILABLE');
  assert.equal(db.get(account,'bill').billId,initial.obligationId);
});

test('fine discounts and expiry use business time; stale revision and the legacy amount both follow current policy',t=>{
  const {actor,book,engine,advance}=fixture(t,'police'),account=actor.accountId;
  const initial=book.list(account).find(p=>p.discountMinor)!;
  const discounted=book.amend(account,initial.id,initial.revision,{discountExpiresAt:'2026-10-24T00:01:00.000Z'});
  assert.equal(discounted.amountMinor,27000);advance(60000);
  const full=book.list(account).find(p=>p.id===initial.id)!;assert.equal(full.amountMinor,30000);assert.equal(full.discountEligible,false);assert.notEqual(full.revision,discounted.revision);
  assert.throws(()=>book.inspect(account,full.id,discounted.revision),error('PAYABLE_CHANGED'));
  assert.equal(engine.execute(actor,'GET','/fines',{}).data.fines.find((f:any)=>f.fineId===initial.obligationId).payableAmount,300);
  const expired=book.amend(account,full.id,full.revision,{expiresAt:'2026-10-24T00:02:00.000Z'});advance(60000);
  assert.equal(book.list(account).find(p=>p.id===initial.id)!.status,'EXPIRED');
  assert.throws(()=>book.inspect(account,expired.id,expired.revision),error('PAYABLE_CHANGED'));
  assert.ok(!engine.execute(actor,'GET','/fines',{}).data.fines.some((f:any)=>f.fineId===initial.obligationId));
});

test('revision-bound settlement rejects substituted identity, source proof, amount, currency and stale lifecycle before recording a receipt',t=>{
  const {actor,book,engine,db}=fixture(t),account=actor.accountId,payable=book.list(account)[0];
  const proof={id:'captured-payment',accountId:account,currency:'AED',status:'CAPTURED',refunded:false,merchant:'dewa',reference:book.settlementReference(payable),amountMinor:payable.amountMinor};
  for(const change of [{accountId:'another-account'},{id:'another-payment'},{currency:'USD'},{status:'DECLINED'},{refunded:true},{merchant:'du'},{reference:`bill:${payable.obligationId}`},{amountMinor:1}]) assert.throws(()=>book.settle(account,payable.id,payable.revision,proof.id,{...proof,...change}),error('INVALID_PAYMENT_PROOF'));
  assert.throws(()=>book.inspect('another-account',payable.id,payable.revision),error('PAYABLE_NOT_FOUND'));
  const route=`/payables/${payable.id}/payments`;
  const settled=db.transaction(()=>engine.execute(actor,'POST',route,{expectedRevision:payable.revision,paymentId:proof.id},proof)).data;
  assert.equal(settled.receipt.amountMinor,payable.amountMinor);assert.equal(settled.payable.status,'PAID');
  assert.throws(()=>book.settle(account,payable.id,payable.revision,proof.id,proof),error('PAYABLE_CHANGED'));
  assert.throws(()=>book.inspect(account,payable.id,settled.payable.revision),error('PAYABLE_UNAVAILABLE'));
});

test('discounted paid history retains captured value after discount expiration; restricted fine cannot settle',t=>{
  const {actor,book,advance}=fixture(t,'police'),account=actor.accountId;
  const initial=book.list(account).find(p=>p.discountMinor)!;
  const p=book.amend(account,initial.id,initial.revision,{discountExpiresAt:'2026-10-24T00:01:00.000Z'});
  const proof={id:'fine-payment',accountId:account,currency:'AED',status:'CAPTURED',refunded:false,merchant:'police',reference:book.settlementReference(p),amountMinor:p.amountMinor};
  book.settle(account,p.id,p.revision,proof.id,proof);advance(60000);
  const history=book.list(account).find(row=>row.id===p.id)!;assert.equal(history.amountMinor,27000);assert.equal(history.discountMinor,3000);
  const other=book.list(account).find(row=>row.status==='UNPAID')!;
  const restricted=book.amend(account,other.id,other.revision,{paymentRestricted:true});
  assert.throws(()=>book.inspect(account,restricted.id,restricted.revision),error('PAYABLE_RESTRICTED'));
});

test('provider lifecycle changes persist and competing connections reject a stale reviewer',t=>{
  const dir=mkdtempSync(join(tmpdir(),'cityside-payables-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
  const path=join(dir,'dewa.sqlite'),a=new AccountDatabase(path),b=new AccountDatabase(path);t.after(()=>{a.close();b.close();});
  const actor=actorFor({sub:'durable-payables'});a.accounts(actor.sub);const engine=new ProviderEngine('dewa',a);engine.seed(actor);
  const first=engine.payables!,second=new ProviderPayables(b,'dewa'),p=first.list(actor.accountId)[0];
  const changed=first.amend(actor.accountId,p.id,p.revision,{amountMinor:12300});
  assert.throws(()=>second.inspect(actor.accountId,p.id,p.revision),error('PAYABLE_CHANGED'));
  assert.throws(()=>second.amend(actor.accountId,p.id,p.revision,{status:'CANCELLED'}),error('PAYABLE_CHANGED'));
  assert.equal(second.list(actor.accountId)[0].revision,changed.revision);
  const reopened=new AccountDatabase(path);t.after(()=>reopened.close());assert.equal(new ProviderPayables(reopened,'dewa').list(actor.accountId)[0].amountMinor,12300);
});

test('invalid dates, amounts, changes and caller execution overrides fail without editing provider records',t=>{
  const {actor,book}=fixture(t),account=actor.accountId,p=book.list(account)[0],before=JSON.stringify(book.list(account));
  for(const change of [{dueDate:'2026-02-30'},{expiresAt:'yesterday'},{amountMinor:0},{status:'UNPAID'},{reference:'other'},{paymentRestricted:true}])assert.throws(()=>book.amend(account,p.id,p.revision,change as any));
  const review=operations.dewa.find(o=>o.id==='reviewVersionedPayable')!;
  const validate=new Ajv({strict:false}).compile(review.body!);
  assert.equal(validate({expectedRevision:p.revision}),true);assert.equal(validate({expectedRevision:p.revision,amountMinor:1}),false);assert.equal(validate({expectedRevision:'stale'}),false);
  assert.equal(JSON.stringify(book.list(account)),before);
});
