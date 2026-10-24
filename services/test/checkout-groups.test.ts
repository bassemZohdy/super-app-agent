import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AccountDatabase } from '../provider-simulator/src/database.ts';
import { ProviderEngine } from '../provider-simulator/src/engine.ts';
import { PaymentCheckout } from '../provider-simulator/src/payment-checkout.ts';
import { ProviderSettlements } from '../provider-simulator/src/provider-settlements.ts';
import { actorFor } from '../../packages/backend-kit/src/context.ts';
import { UpstreamError,type ProviderClient } from '../../packages/backend-kit/src/provider-client.ts';
import type { Payable,CheckoutGroupView } from '../../packages/protocol-core/src/payments.ts';
import { validateRequest } from '../../packages/protocol-core/src/request-validation.ts';
const decision=(g:{version:number;approvalDigest:string})=>({expectedVersion:g.version,approvalDigest:g.approvalDigest});
function fixture(t:any,kind='wallet',path=':memory:'){
  const actor=actorFor({sub:'group-owner'},undefined,'Bearer owner'),db=new AccountDatabase(path),gateway=new ProviderEngine('payments',db);
  db.accounts(actor.sub);gateway.seed(actor);t.after(()=>db.close());
  const providers=new Map<string,ProviderEngine>(),settlements=new Map<string,ProviderSettlements>();
  for(const id of ['dewa','etisalat','police','rta'] as const){const source=new AccountDatabase(':memory:');t.after(()=>source.close());source.accounts(actor.sub);const provider=new ProviderEngine(id,source);provider.seed(actor);providers.set(id,provider);settlements.set(id,new ProviderSettlements(source,id,{call:async(account,payment,action,body:any)=>action==='claim'?gateway.claims!.claim(account,payment,id,body):action==='ack'?gateway.claims!.acknowledge(account,payment,id,body):gateway.claims!.release(account,payment,id,body)}));}
  const p=[providers.get('dewa')!.payables!.list(actor.accountId).find(p=>p.status==='UNPAID')!,providers.get('etisalat')!.payables!.list(actor.accountId).find(p=>p.status==='UNPAID')!];
  const police=providers.get('police')!,fines=police.payables!.list(actor.accountId).filter(p=>p.kind==='FINE'&&p.status==='UNPAID');p.push(police.payables!.selectFines(actor.accountId,fines.map(p=>({payableId:p.id,expectedRevision:p.revision}))));
  const rta=providers.get('rta')!,target=rta.recharges!.targets(actor.accountId)[0];p.push(rta.recharges!.quote(actor.accountId,{targetReference:target.reference,amountMinor:10000,expectedTargetVersion:1,intentId:'group-recharge'}));
  for(const payable of p)db.transaction(()=>gateway.execute(actor,'POST','/billing-accounts',{provider:payable.provider,reference:payable.reference,nickname:payable.provider}));
  const method=kind==='wallet'?{id:'wallet',version:1}:db.transaction(()=>gateway.execute(actor,'POST','/payment-methods',{preset:kind,nickname:'Group card'})).data.method;
  let failProvider='',failWhen='',gate:undefined|(()=>Promise<void>);
  const client={call:async(provider:string,_actor:typeof actor,method:string,path:string,body:any={},key='test')=>{
    if(gate){const wait=gate;gate=undefined;await wait();}
    const source=providers.get(provider)!;
    if(path.endsWith('/payments')){
      if(failProvider===provider&&failWhen==='before'){failProvider='';throw new UpstreamError(503,'PROVIDER_OUTCOME_UNKNOWN','Lost before commit');}
      const proof=gateway.execute(actor,'GET',`/charges/${body.paymentId}`,{}).data.charge,fp=createHash('sha256').update(JSON.stringify([method,path,body])).digest('hex');
      const result=await settlements.get(provider)!.execute(actor,key,fp,proof,claimed=>source.execute(actor,method,path,body,claimed));
      if(failProvider===provider&&failWhen==='after'){failProvider='';throw new UpstreamError(503,'PROVIDER_OUTCOME_UNKNOWN','Lost after commit');}return result.data;
    }
    let gatewayOrder;
    if(/\/(admit|cancel|finish)$/.test(path)){const a=source.admissions!.get(actor.accountId,path.split('/')[4]);gatewayOrder=gateway.orders!.get(actor,a.orderId);}
    return source.store.transaction(()=>source.execute(actor,method,path,body,undefined,undefined,gatewayOrder)).data;
  }} as unknown as ProviderClient;
  const checkout=new PaymentCheckout(gateway.orders!,client),groups=gateway.groups!;
  const create=(payables:Payable[]=p)=>groups.create(actor,{items:payables.map(p=>({provider:p.provider,payableId:p.id,expectedPayableRevision:p.revision})),methodId:method.id,expectedMethodVersion:1},payables);
  const approve=(g:CheckoutGroupView)=>groups.approve(actor,g.id,decision(g));
  const run=(g:CheckoutGroupView)=>groups.execute(actor,g.id,decision(g),checkout,client);
  return {actor,db,gateway,providers,p,method,checkout,client,groups,create,approve,run,fail:(provider:string,when:string)=>{failProvider=provider;failWhen=when;},gate:(wait:()=>Promise<void>)=>{gate=wait;}};
}
for(const source of ['wallet','approved'])test(`${source} mixed-provider group settles each original child exactly once`,async t=>{
  const f=fixture(t,source),created=f.create();assert.equal(created.totalMinor,123940);assert.equal(f.gateway.ledger!.summary(f.actor.accountId).balanceMinor,150000);
  await assert.rejects(f.run(created),(e:any)=>e.code==='CHECKOUT_APPROVAL_REQUIRED');
  const group=await f.run(f.approve(created));assert.equal(group.state,'COMPLETED');assert.equal(group.settledMinor,123940);assert.equal(new Set(group.orders.map(o=>o.receipt!.receiptNumber)).size,4);assert.ok(group.orders.every(o=>o.quote.source.id===f.method.id));
  assert.equal(f.gateway.ledger!.summary(f.actor.accountId).balanceMinor,source==='wallet'?26060:150000);
  if(source!=='wallet')assert.equal(f.gateway.issuer!.summary(f.actor.accountId,f.method.id).spentMinor,123940);
  const again=await f.run(group);assert.equal(again.state,'COMPLETED');assert.deepEqual(again.orders.map(o=>o.paymentId),group.orders.map(o=>o.paymentId));assert.equal(f.db.list(f.actor.accountId,'charge').length,4);
});
for(const when of ['before','after'])test(`lost ${when} second settlement stops later lines and resumes the original capture`,async t=>{
  const f=fixture(t),approved=f.approve(f.create());f.fail('etisalat',when);const pending=await f.run(approved);
  assert.equal(pending.state,'RECONCILIATION_REQUIRED');assert.equal(pending.orders[0].state,'SETTLED');assert.equal(pending.orders[1].state,'RECONCILIATION_REQUIRED');assert.equal(pending.orders[2].state,'AWAITING_APPROVAL');assert.equal(f.db.list(f.actor.accountId,'charge').length,2);
  const again=await f.run(pending);assert.equal(again.state,'COMPLETED');assert.equal(again.orders[1].paymentId,pending.orders[1].paymentId);assert.equal(f.db.list(f.actor.accountId,'charge').length,4);assert.equal(f.gateway.ledger!.summary(f.actor.accountId).balanceMinor,26060);
});
test('each challenged group line pauses before later authorization and needs its own owner decision',async t=>{
  const f=fixture(t,'challenge');let group=f.approve(f.create(f.p.slice(0,2)));
  for(let i=0;i<2;i++){group=await f.run(group);assert.equal(group.state,'REQUIRES_ACTION');const o=group.orders[i];assert.equal(o.state,'REQUIRES_ACTION');assert.equal(f.db.list(f.actor.accountId,'charge').length,i);if(i===0)assert.equal(group.orders[1].state,'AWAITING_APPROVAL');
    f.gateway.orders!.challenge(f.actor,o.id,{...decision(o),challengeId:o.authorization!.challengeId!,decision:'APPROVE'},f.p[i],true);
  }
  group=await f.run(group);assert.equal(group.state,'COMPLETED');assert.equal(f.gateway.ledger!.summary(f.actor.accountId).balanceMinor,150000);assert.equal(f.gateway.issuer!.summary(f.actor.accountId,f.method.id).spentMinor,71940);
});
test('later finite-card decline preserves prior receipt and never silently falls back to the wallet',async t=>{
  const f=fixture(t,'limited');f.p[0]=f.providers.get('dewa')!.payables!.amend(f.actor.accountId,f.p[0].id,f.p[0].revision,{amountMinor:5000});f.p[1]=f.providers.get('etisalat')!.payables!.amend(f.actor.accountId,f.p[1].id,f.p[1].revision,{amountMinor:7000});
  const partial=await f.run(f.approve(f.create()));assert.equal(partial.state,'PARTIAL');assert.equal(partial.settledMinor,5000);assert.equal(partial.orders[1].state,'FAILED');assert.equal(partial.orders[2].state,'AWAITING_APPROVAL');await f.run(partial);
  assert.equal(f.db.list(f.actor.accountId,'charge').length,1);assert.equal(f.gateway.ledger!.summary(f.actor.accountId).balanceMinor,150000);assert.equal(f.gateway.issuer!.summary(f.actor.accountId,f.method.id).spentMinor,5000);
});
test('already-paid items are excluded, duplicate/overlapping and changed terms roll back group and child creation',t=>{
  const f=fixture(t),paid=f.providers.get('dewa')!.payables!.list(f.actor.accountId).find(p=>p.status==='PAID')!;
  const original=f.gateway.orders!.list(f.actor).length;
  assert.throws(()=>f.create([f.p[0],f.p[0]]),(e:any)=>e.code==='DUPLICATE_CHECKOUT_ITEM');assert.equal(f.gateway.orders!.list(f.actor).length,original);
  assert.throws(()=>f.create([f.p[0],{...f.p[1],revision:'a'.repeat(63)}]));assert.equal(f.gateway.orders!.list(f.actor).length,original);
  const fine=f.p[2].items![0];assert.throws(()=>f.create([f.p[2],fine]),(e:any)=>e.code==='DUPLICATE_CHECKOUT_ITEM');assert.equal(f.gateway.orders!.list(f.actor).length,original);
  assert.throws(()=>f.create([paid]),(e:any)=>e.code==='CHECKOUT_EMPTY');
  const group=f.create([paid,f.p[0]]);assert.equal(group.excluded.length,1);assert.equal(group.orders.length,1);assert.equal(group.totalMinor,f.p[0].amountMinor);
});
test('source amendment stops the affected line, preserves earlier receipts and exposes a reason',async t=>{
  const f=fixture(t),g=f.approve(f.create());f.providers.get('etisalat')!.payables!.amend(f.actor.accountId,f.p[1].id,f.p[1].revision,{amountMinor:30000});const partial=await f.run(g);
  assert.equal(partial.state,'PARTIAL');assert.equal(partial.lastFailureCode,'PAYABLE_CHANGED');assert.equal(partial.orders[0].state,'SETTLED');assert.equal(partial.orders[2].state,'AWAITING_APPROVAL');assert.equal(f.db.list(f.actor.accountId,'charge').length,1);
});
test('wrong owner/digest/version cannot approve or run a group and source disable prevents new capture',async t=>{
  const f=fixture(t,'approved'),g=f.create(),other=actorFor({sub:'other-owner'});f.db.accounts(other.sub);
  assert.throws(()=>f.groups.get(other,g.id),(e:any)=>e.status===404);assert.throws(()=>f.groups.get({...f.actor,sub:other.sub},g.id),(e:any)=>e.status===403);
  assert.throws(()=>f.groups.approve(f.actor,g.id,{...decision(g),approvalDigest:'0'.repeat(64)}),(e:any)=>e.code==='CHECKOUT_CHANGED');
  const approved=f.approve(g);await assert.rejects(f.run(g),(e:any)=>e.code==='CHECKOUT_CHANGED');f.db.transaction(()=>f.gateway.execute(f.actor,'POST','/payment-methods/status',{methodId:f.method.id,expectedVersion:1,status:'DISABLED'}));
  const stopped=await f.run(approved);assert.equal(stopped.state,'STOPPED');assert.equal(stopped.orders[0].state,'FAILED');assert.equal(f.db.list(f.actor.accountId,'charge').length,0);
});
test('concurrent group execution uses the same child identities and cannot duplicate any capture',async t=>{
  const f=fixture(t),g=f.approve(f.create());await Promise.allSettled([f.run(g),f.run(g)]);let current=f.groups.get(f.actor,g.id);if(current.state!=='COMPLETED')current=await f.run(current);assert.equal(current.state,'COMPLETED');assert.equal(f.db.list(f.actor.accountId,'charge').length,4);assert.equal(f.gateway.ledger!.summary(f.actor.accountId).balanceMinor,26060);
});
test('cancel fences an in-flight preflight before authorization and leaves no new group effect',async t=>{
  const f=fixture(t),g=f.approve(f.create());let release!:()=>void,entered!:()=>void;const held=new Promise<void>(r=>{release=r;}),started=new Promise<void>(r=>{entered=r;});f.gate(async()=>{entered();await held;});const running=f.run(g);await started;await f.groups.cancel(f.actor,g.id,g.version,f.checkout);release();const cancelled=await running;assert.equal(cancelled.state,'CANCELLED');assert.ok(cancelled.orders.every(o=>o.state==='CANCELLED'));assert.equal(f.db.list(f.actor.accountId,'charge').length,0);
});
test('reopened group retains partial receipts and original captured child recovery references',async t=>{
  const dir=mkdtempSync(join(tmpdir(),'group-reopen-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));const f=fixture(t,'wallet',join(dir,'payments.sqlite')),g=f.approve(f.create());f.fail('etisalat','after');const pending=await f.run(g);
  const reopened=new AccountDatabase(f.db.path);t.after(()=>reopened.close());const restored=new ProviderEngine('payments',reopened).groups!.get(f.actor,g.id);assert.equal(restored.state,'RECONCILIATION_REQUIRED');assert.deepEqual(restored.orders.map(o=>o.paymentId),pending.orders.map(o=>o.paymentId));assert.equal(restored.orders[0].receipt!.receiptNumber,pending.orders[0].paymentId);assert.equal((await f.run(restored)).state,'COMPLETED');
});
test('group contracts reject price overrides, mixed sources, duplicate item shapes and unbounded selection',()=>{
  const body={accountId:'acc_test',requestKey:'group_key_1',methodId:'wallet',expectedMethodVersion:1,items:[{provider:'dewa',payableId:'dewa:bill:one',expectedPayableRevision:'a'.repeat(64)}]};
  assert.equal(validateRequest('agent-core','POST','/api/payments/checkout-groups',{},body),undefined);
  for(const changed of [{...body,amountMinor:1},{...body,items:[]},{...body,items:Array(11).fill(body.items[0])},{...body,items:[{...body.items[0],methodId:'other'}]},{...body,items:[body.items[0],body.items[0]]}])assert.equal(validateRequest('agent-core','POST','/api/payments/checkout-groups',{},changed)?.status,400);
});
