import { removeTemp } from '../../test/support/temp-cleanup.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Ajv } from 'ajv';
import { AccountDatabase } from '../provider-simulator/src/database.ts';
import { ProviderEngine } from '../provider-simulator/src/engine.ts';
import { PaymentCheckout } from '../provider-simulator/src/payment-checkout.ts';
import { ProviderSettlements } from '../provider-simulator/src/provider-settlements.ts';
import { actorFor } from '../../packages/backend-kit/src/context.ts';
import { UpstreamError,type ProviderClient } from '../../packages/backend-kit/src/provider-client.ts';
import { paymentReceiptReady,formatStatementAED,historyOperationSchema,statementEntrySchema,statementSummarySchema } from '../../packages/protocol-core/src/payment-history.ts';
import { validateRequest } from '../../packages/protocol-core/src/request-validation.ts';
const terms=(o:{version:number;approvalDigest:string})=>({expectedVersion:o.version,approvalDigest:o.approvalDigest});
function fixture(t:any,path=':memory:'){
  const actor=actorFor({sub:'history-owner'}),db=new AccountDatabase(path);db.accounts(actor.sub);const gateway=new ProviderEngine('payments',db);gateway.seed(actor);
  const sources=new Map<string,{db:AccountDatabase;engine:ProviderEngine;settlements:ProviderSettlements}>();
  for(const name of ['dewa','du'] as const){const source=new AccountDatabase(':memory:');source.accounts(actor.sub);const engine=new ProviderEngine(name,source);engine.seed(actor);const p=engine.payables!.list(actor.accountId).find(p=>p.status==='UNPAID')!;gateway.execute(actor,'POST','/billing-accounts',{provider:name,reference:p.reference,nickname:`Original ${name} link`});const settlements=new ProviderSettlements(source,name,{call:async(account,id,action,body:any)=>action==='claim'?gateway.claims!.claim(account,id,name,body):action==='ack'?gateway.claims!.acknowledge(account,id,name,body):gateway.claims!.release(account,id,name,body)});sources.set(name,{db:source,engine,settlements});}
  t.after(()=>{db.close();for(const s of sources.values())s.db.close();});let fail='';
  const client={call:async(provider:string,_a:typeof actor,verb:string,path:string,body:any={},key='history')=>{
    const s=sources.get(provider)!;
    if(path.startsWith('/payment-reversals/')){const id=path.split('/')[2];if(verb==='GET')return{reversal:s.engine.reversals!.get(actor.accountId,id)};return{reversal:s.db.transaction(()=>s.engine.reversals!.apply(actor.accountId,gateway.refunds!.get(actor,id)))};}
    if(path.endsWith('/payments')){const charge=gateway.execute(actor,'GET',`/charges/${body.paymentId}`,{}).data.charge;const result=(await s.settlements.execute(actor,key,createHash('sha256').update(JSON.stringify([verb,path,body])).digest('hex'),charge,proof=>s.engine.execute(actor,verb,path,body,proof))).data;if(fail===provider){fail='';throw new UpstreamError(503,'PROVIDER_OUTCOME_UNKNOWN','Lost after commit');}return result;}
    let order;if(/\/(admit|cancel|finish)$/.test(path)){const admission=s.engine.admissions!.get(actor.accountId,path.split('/')[4]);order=gateway.orders!.get(actor,admission.orderId);}return s.db.transaction(()=>s.engine.execute(actor,verb,path,body,undefined,undefined,order)).data;
  }} as unknown as ProviderClient;
  const checkout=new PaymentCheckout(gateway.orders!,client),history=gateway.history!;
  const payable=(provider='dewa')=>sources.get(provider)!.engine.payables!.list(actor.accountId).find(p=>p.status==='UNPAID')!;
  const create=(methodId='wallet',provider='dewa')=>{const p=payable(provider);return gateway.orders!.create(actor,{provider:p.provider,payableId:p.id,expectedPayableRevision:p.revision,methodId,expectedMethodVersion:1},p);};
  const pay=async(methodId='wallet',provider='dewa')=>{let o=create(methodId,provider);o=gateway.orders!.approve(actor,o.id,terms(o),payable(provider));return checkout.execute(actor,o.id,terms(o));};
  const card=()=>gateway.execute(actor,'POST','/payment-methods',{preset:'approved',nickname:'Original history card'}).data.method;
  return{actor,db,gateway,sources,client,checkout,history,payable,create,pay,card,fail:(provider:string)=>fail=provider};
}
test('statement credits/debits, clearing and running balances match wallet funding, bill and original-source refund',async t=>{
  const f=fixture(t),card=f.card();let funding=f.gateway.funding!.create(f.actor,{methodId:card.id,expectedMethodVersion:1,amountMinor:5000});funding=f.gateway.funding!.approve(f.actor,funding.id,terms(funding));funding=f.gateway.funding!.execute(f.actor,funding.id,terms(funding));assert.equal(funding.state,'SETTLED');
  const paid=await f.pay(),r=f.gateway.refunds!.create(f.actor,{origin:'PAYMENT',orderId:paid.id,expectedVersion:paid.version,amountMinor:paid.quote.totalMinor,reason:'Statement refund'});await f.gateway.refunds!.execute(f.actor,r.id,terms(r),f.client);
  const statement=f.history.statement(f.actor);assert.equal(statement.summary.entryCount,4);assert.deepEqual(statement.entries.map(e=>e.walletDeltaMinor),[150000,5000,-42040,42040]);assert.deepEqual(statement.entries.map(e=>e.balanceAfterMinor),[150000,155000,112960,155000]);assert.equal(statement.summary.creditsMinor,47040);assert.equal(statement.summary.debitsMinor,42040);assert.equal(statement.summary.balanceMinor,155000);assert.equal(statement.summary.walletMinor+statement.summary.externalClearingMinor+statement.summary.merchantClearingMinor,0);assert.equal(statement.summary.balanced,true);
  const validate=new Ajv({strict:false});for(const e of statement.entries)assert.equal(validate.compile(statementEntrySchema)(e),true);assert.equal(validate.compile(statementSummarySchema)(statement.summary),true);
  assert.equal(f.history.detail(f.actor,'REFUND',r.id).completeReceipt,true);assert.equal(f.history.detail(f.actor,'PAYMENT',paid.id).refundedMinor,42040);
});
test('more than 100 immutable journal and mixed activity records paginate once despite inserted/backdated records',t=>{
  const f=fixture(t);for(let n=0;n<111;n++)f.gateway.execute(f.actor,'POST','/charges',{amountMinor:1,merchant:'rta',reference:`parking:history-${n}`,source:'wallet'});
  const first=f.history.statement(f.actor),activity=f.history.activity(f.actor);assert.equal(first.entries.length,25);assert.equal(first.summary.entryCount,112);
  const newCharge=f.gateway.execute(f.actor,'POST','/charges',{amountMinor:1,merchant:'rta',reference:'parking:new-after-snapshot',source:'wallet'}).data.charge;f.db.put(f.actor.accountId,'charge',{...newCharge,createdAt:'2000-01-01T00:00:00.000Z'},newCharge.id);
  const entries=[...first.entries];let cursor=first.nextCursor;while(cursor){const p=f.history.statement(f.actor,cursor);assert.deepEqual(p.summary,first.summary);entries.push(...p.entries);cursor=p.nextCursor;}
  assert.equal(entries.length,112);assert.equal(new Set(entries.map(e=>e.id)).size,112);assert.equal(entries.at(-1)!.balanceAfterMinor,149889);
  const ops=[...activity.operations];cursor=activity.nextCursor;while(cursor){const p=f.history.activity(f.actor,cursor);ops.push(...p.operations);cursor=p.nextCursor;}assert.equal(ops.length,111);assert.equal(new Set(ops.map(o=>o.id)).size,111);assert.ok(!ops.some(o=>o.id===newCharge.id));assert.equal(f.history.statement(f.actor).summary.entryCount,113);
});
test('cursor belongs to its owner/account and stream; malformed/path/extra request inputs deny',t=>{
  const f=fixture(t);for(let n=0;n<27;n++)f.gateway.execute(f.actor,'POST','/charges',{amountMinor:1,merchant:'rta',reference:`cursor:${n}`,source:'wallet'});const cursor=f.history.statement(f.actor).nextCursor!;
  const household={...f.actor,accountId:f.db.accounts(f.actor.sub).find(a=>a.id!==f.actor.accountId)!.id};f.gateway.seed(household);assert.throws(()=>f.history.statement(household,cursor),(e:any)=>e.code==='HISTORY_CURSOR_INVALID');assert.throws(()=>f.history.activity(f.actor,cursor));assert.throws(()=>f.history.statement(f.actor,'%%%'));assert.throws(()=>f.history.statement(f.actor,Buffer.from('null').toString('base64url')),(e:any)=>e.code==='HISTORY_CURSOR_INVALID');assert.throws(()=>f.history.detail(actorFor({sub:'foreign-owner'}),'LEGACY','any'));
  assert.equal(validateRequest('agent-core','GET','/api/payments/statement',{accountId:f.actor.accountId,cursor},{}),undefined);assert.equal(validateRequest('agent-core','GET','/api/payments/statement',{accountId:f.actor.accountId,amountMinor:'1'},{} )?.status,400);assert.equal(validateRequest('agent-core','GET','/api/payments/history/detail',{accountId:f.actor.accountId,kind:'ANY',operationId:'x'},{} )?.status,400);
});
test('pending, declined, challenge and unknown outcomes cannot display a completed provider receipt',async t=>{
  const f=fixture(t);const review=f.create();assert.equal(f.history.detail(f.actor,'PAYMENT',review.id).completeReceipt,false);f.gateway.orders!.cancel(f.actor,review.id,review.version);
  const declined=f.gateway.execute(f.actor,'POST','/payment-methods',{preset:'declined',nickname:'Decline'}).data.method;let o=f.create(declined.id);o=f.gateway.orders!.approve(f.actor,o.id,terms(o),f.payable());assert.equal(f.history.detail(f.actor,'PAYMENT',o.id).settlementState,'NOT_APPLIED');
  const challenge=f.gateway.execute(f.actor,'POST','/payment-methods',{preset:'challenge',nickname:'Challenge'}).data.method;o=f.create(challenge.id);o=f.gateway.orders!.approve(f.actor,o.id,terms(o),f.payable());assert.equal(f.history.detail(f.actor,'PAYMENT',o.id).state,'REQUIRES_ACTION');assert.equal(f.history.detail(f.actor,'PAYMENT',o.id).completeReceipt,false);f.gateway.orders!.cancel(f.actor,o.id,o.version);
  f.fail('dewa');const unknown=await f.pay();const detail=f.history.detail(f.actor,'PAYMENT',unknown.id);assert.equal(detail.captureState,'CAPTURED');assert.equal(detail.settlementState,'UNKNOWN');assert.equal(detail.completeReceipt,false);assert.equal(detail.receiptReference,undefined);assert.equal(f.history.statement(f.actor).entries.at(-1)!.operation!.completeReceipt,false);
  assert.equal((f.gateway.execute(f.actor,'GET','/transactions',{}).data.transactions.find((tx:any)=>tx.id===unknown.paymentId)).status,'RECONCILIATION_REQUIRED');
  await f.checkout.recover(f.actor,unknown.id);assert.equal(f.history.detail(f.actor,'PAYMENT',unknown.id).completeReceipt,true);
});
test('immutable masked source and original biller terms survive card removal and link archival',async t=>{
  const f=fixture(t),card=f.card(),paid=await f.pay(card.id),before=f.history.detail(f.actor,'PAYMENT',paid.id);
  f.gateway.execute(f.actor,'POST','/payment-methods/status',{methodId:card.id,expectedVersion:1,status:'REMOVED'});f.gateway.execute(f.actor,'POST','/billing-accounts/archive',{billingAccountId:paid.quote.billingAccount.id,expectedVersion:paid.quote.billingAccount.version});
  const after=f.history.detail(f.actor,'PAYMENT',paid.id);assert.deepEqual(after.source,before.source);assert.deepEqual(after.biller,before.biller);assert.equal(after.source.last4,'4242');assert.equal(after.source.label,'Original history card');assert.equal(after.completeReceipt,true);assert.equal(f.history.statement(f.actor).summary.balanceMinor,150000);
});
test('partial group totals are derived from children and never double counted as a journal effect',async t=>{
  const f=fixture(t),p=[f.payable('dewa'),f.payable('du')];let g=f.gateway.groups!.create(f.actor,{items:p.map(p=>({provider:p.provider,payableId:p.id,expectedPayableRevision:p.revision})),methodId:'wallet',expectedMethodVersion:1},p);g=f.gateway.groups!.approve(f.actor,g.id,terms(g));f.fail('du');g=await f.gateway.groups!.execute(f.actor,g.id,terms(g),f.checkout,f.client);
  const detail=f.history.detail(f.actor,'GROUP',g.id);assert.equal(detail.settlementState,'PARTIAL');assert.equal(detail.completeReceipt,false);assert.equal(detail.capturedMinor,71940);assert.equal(detail.settledMinor,42040);assert.equal(detail.related.length,2);assert.equal(f.history.statement(f.actor).summary.entryCount,3);assert.equal(f.history.activity(f.actor).operations.length,3);
  const validate=new Ajv({strict:false}).compile(historyOperationSchema);assert.equal(validate(detail),true);
});
test('pure receipt guard rejects pending final acknowledgement and forged/absent receipt fields',async t=>{
  const f=fixture(t),o=await f.pay();assert.equal(paymentReceiptReady(o),true);for(const altered of [{...o,sourceFinalizationPending:true},{...o,state:'CAPTURED'},{...o,receipt:undefined},{...o,receipt:{...o.receipt,amountMinor:1}},{...o,receipt:{...o.receipt,receiptNumber:'another'}}])assert.equal(paymentReceiptReady(altered as any),false);
});
test('history is read-only and journal cursor/detail results survive database reopen',async t=>{
  const dir=mkdtempSync(join(tmpdir(),'statement-reopen-'));t.after(()=>removeTemp(dir));const f=fixture(t,join(dir,'payments.sqlite')),o=await f.pay();
  const snapshot=()=>JSON.stringify(f.db.db.prepare('SELECT * FROM resources ORDER BY account_id,kind,id').all());const before=snapshot(),statement=f.history.statement(f.actor),detail=f.history.detail(f.actor,'PAYMENT',o.id);f.history.activity(f.actor);assert.equal(snapshot(),before);
  const db=new AccountDatabase(f.db.path);t.after(()=>db.close());const restored=new ProviderEngine('payments',db);assert.deepEqual(restored.history!.statement(f.actor),statement);assert.deepEqual(restored.history!.detail(f.actor,'PAYMENT',o.id),detail);
});
test('unclaimed raw capture and declined legacy attempt have truthful history without invented service receipts',t=>{
  const f=fixture(t),c=f.gateway.execute(f.actor,'POST','/charges',{amountMinor:100,merchant:'rta',reference:'parking:unclaimed',source:'wallet'}).data.charge,declined=f.gateway.execute(f.actor,'POST','/charges',{amountMinor:999999,merchant:'rta',reference:'parking:declined',source:'wallet'}).data;
  assert.equal(declined.success,false);const detail=f.history.detail(f.actor,'LEGACY',c.id);assert.equal(detail.captureState,'CAPTURED');assert.equal(detail.settlementState,'UNKNOWN');assert.equal(detail.completeReceipt,false);assert.equal(f.gateway.execute(f.actor,'GET','/transactions',{}).data.transactions[0].completeReceipt,false);
});

test('card capture and refund statements carry exact value while wallet movement stays zero',async t=>{
  const f=fixture(t),card=f.card(),o=await f.pay(card.id),r=f.gateway.refunds!.create(f.actor,{origin:'PAYMENT',orderId:o.id,expectedVersion:o.version,amountMinor:o.quote.totalMinor,reason:'Card return'});await f.gateway.refunds!.execute(f.actor,r.id,terms(r),f.client);
  const page=f.history.statement(f.actor);assert.deepEqual(page.entries.map(e=>e.walletDeltaMinor),[150000,0,0]);assert.equal(page.entries[1].amountMinor,42040);assert.equal(page.entries[2].amountMinor,42040);assert.equal(page.summary.balanceMinor,150000);assert.equal(page.summary.creditsMinor,0);assert.equal(page.summary.debitsMinor,0);assert.equal(page.entries[1].operation!.refundedMinor,42040);assert.equal(page.entries[2].operation!.source.last4,'4242');
});
test('partial wallet-funding return is a wallet debit, not an additional credit or a new capture',async t=>{
  const f=fixture(t),card=f.card();let o=f.gateway.funding!.create(f.actor,{methodId:card.id,expectedMethodVersion:1,amountMinor:5000});o=f.gateway.funding!.approve(f.actor,o.id,terms(o));o=f.gateway.funding!.execute(f.actor,o.id,terms(o));
  const r=f.gateway.refunds!.create(f.actor,{origin:'WALLET_FUNDING',orderId:o.id,expectedVersion:o.version,amountMinor:2000,reason:'Partial unused funding'});await f.gateway.refunds!.execute(f.actor,r.id,terms(r),f.client);
  const page=f.history.statement(f.actor);assert.equal(page.summary.balanceMinor,153000);assert.equal(page.summary.creditsMinor,5000);assert.equal(page.summary.debitsMinor,2000);assert.equal(page.entries.at(-1)!.walletDeltaMinor,-2000);assert.equal(f.history.detail(f.actor,'FUNDING',o.id).refundedMinor,2000);assert.equal(f.history.detail(f.actor,'REFUND',r.id).completeReceipt,true);
});
test('capture metadata disagreement denies a completed history receipt despite a sealed money entry',async t=>{
  const f=fixture(t),o=await f.pay(),charge=f.db.get(f.actor.accountId,'charge',o.paymentId!);f.db.put(f.actor.accountId,'charge',{...charge,sourceVersion:999},charge.id);
  const detail=f.history.detail(f.actor,'PAYMENT',o.id);assert.equal(detail.captureState,'INCONSISTENT');assert.equal(detail.completeReceipt,false);assert.equal(detail.receiptReference,undefined);
});

test('signed statement formatting retains exact cents for negative and cumulative safe integers',()=>{
  assert.equal(formatStatementAED(-42040),'AED -420.40');assert.equal(formatStatementAED(0),'AED 0.00');assert.equal(formatStatementAED(Number.MAX_SAFE_INTEGER),'AED 90071992547409.91');
  for(const value of [NaN,Infinity,1.5,Number.MAX_SAFE_INTEGER+1])assert.throws(()=>formatStatementAED(value));
});
