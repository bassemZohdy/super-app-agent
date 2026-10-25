import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AccountDatabase } from '../provider-simulator/src/database.ts';
import { ProviderEngine } from '../provider-simulator/src/engine.ts';
import { claimAutomationPayable,hasAutomationRun,type AutomationPreparation,type AutomationSkip } from '../provider-simulator/src/automation-runs.ts';
import { actorFor } from '../../packages/backend-kit/src/context.ts';
import { createHash } from 'node:crypto';
import { PaymentCheckout } from '../provider-simulator/src/payment-checkout.ts';
import { ProviderSettlements } from '../provider-simulator/src/provider-settlements.ts';
import { executeAutomaticOrder } from '../provider-simulator/src/automation-execution.ts';
import { permitOperation } from '../delegation/src/permits.ts';
import type { ProviderClient } from '../../packages/backend-kit/src/provider-client.ts';

const prepared=(result:AutomationPreparation|AutomationSkip):AutomationPreparation=>{
  assert.equal((result as AutomationSkip).skipped,undefined,`expected preparation, got skip ${(result as AutomationSkip).reason}`);
  return result as AutomationPreparation;
};
const skipped=(result:AutomationPreparation|AutomationSkip):AutomationSkip=>{
  assert.equal((result as AutomationSkip).skipped,true,'expected a recorded skip');
  return result as AutomationSkip;
};

function fixture(t:unknown){
  const root=mkdtempSync(join(tmpdir(),'cityside-auto-')),path=join(root,'payments.sqlite');
  const context={root,operatorSub:'automation-operator',workerSub:'auto-worker',runId:`autorn_${randomUUID()}`};
  const db=new AccountDatabase(path);
  const dewaDb=new AccountDatabase(':memory:');
  const actor=actorFor({sub:'auto-owner'},undefined,'Bearer owner');
  const dewa=new ProviderEngine('dewa',dewaDb);
  const payments=new ProviderEngine('payments',db,{automationRun:context,automationIo:{
    readPayables:(accountId:string,provider:string)=>provider==='dewa'&&dewa.payables?dewa.payables.list(accountId):[],
    providerStore:(provider:string)=>{if(provider!=='dewa')throw new Error('No isolated store for this provider.');return dewaDb;},
  }});
  db.accounts(actor.sub);dewaDb.accounts(actor.sub);
  payments.seed(actor);dewa.seed(actor);
  t.after(()=>{db.close();dewaDb.close();try{rmSync(root,{recursive:true,force:true});}catch{/* Windows may briefly hold the directory */}});
  const bill=(billId:string,amountAED:number,dueOffsetDays:number,status:'UNPAID'|'PAID'='UNPAID')=>{
    const due=new Date(Date.now()+dueOffsetDays*86400000).toISOString().slice(0,10);
    dewaDb.put(actor.accountId,'bill',{billId,accountNumber:'auto-home',totalAmount:amountAED,status,dueDate:due},billId);
  };
  const mandate=()=>{
    const billing=db.transaction(()=>payments.execute(actor,'POST','/billing-accounts',{provider:'dewa',reference:'auto-home',nickname:'Home'})).data.billingAccount;
    const policy={
      actorClientId:'cityside-automation' as const,audience:'provider-api' as const,operation:'BILL_PAYMENT' as const,
      purpose:'Pay approved DEWA bills automatically',currency:'AED' as const,
      target:{kind:'BILLER' as const,billingAccountId:billing.id,expectedVersion:billing.version,provider:'dewa' as const,reference:'auto-home'},
      sources:[{methodId:'wallet',expectedVersion:1}],fallback:{mode:'NONE' as const},
      trigger:{type:'INVOICE_DUE' as const,daysBefore:3},
      timezone:'Asia/Dubai',startsAt:new Date(Date.now()-60000).toISOString(),expiresAt:new Date(Date.now()+30*86400000).toISOString(),
      limits:{perPaymentMinor:50000,periodMinor:100000,lifetimeMinor:200000,period:'MONTH' as const,perPeriodCount:5,lifetimeCount:20,cooldownSeconds:60},
    };
    const created=payments.mandates!.create(actor,policy);
    return payments.mandates!.approve(actor,created.id,created.version,created.approvalDigest);
  };
  const prepare=(mandateId:string,occurrenceKey?:string,requestKey?:string)=>
    db.automationRuns!.prepare('auto-worker',{mandateId,occurrenceKey:occurrenceKey??'occ_1',requestKey:requestKey??`req_${randomUUID()}`});
  return {root,path,context,db,dewaDb,payments,dewa,actor,bill,mandate,prepare};
}

test('AUTO-03: preparation resolves the server-owned due invoice, reserves shared authority once and replays idempotently',t=>{
  const f=fixture(t),m=f.mandate();f.bill('auto-bill-1',150,1);
  const first=prepared(f.prepare(m.id));
  assert.equal(first.state,'PREPARED');
  assert.equal(first.payableId,'dewa:bill:auto-bill-1');
  assert.equal(first.amountMinor,15000);
  assert.equal(first.sourceId,'wallet');
  assert.equal(first.boundDigest.length,64);
  assert.ok(Date.parse(first.admissionExpiresAt)>Date.parse(first.preparedAt));
  const replay=prepared(f.prepare(m.id,'occ_1',`req_${randomUUID()}`));
  assert.equal(replay.id,first.id,'exact occurrence retry returns the stored execution');
  const sameKey=prepared(f.prepare(m.id,'occ_1',`req_replay_key_01`));
  assert.equal(sameKey.id,first.id);
  assert.deepEqual(prepared(f.prepare(m.id,'occ_1',`req_replay_key_01`)),sameKey,'same request key replays its stored outcome');
  assert.throws(()=>f.prepare(m.id,'occ_2',`req_replay_key_01`),(e:any)=>e.code==='AUTOMATION_REQUEST_CONFLICT');
  assert.equal(hasAutomationRun(f.db),true);
  const view=f.db.automationRuns!.inspect('auto-owner',f.actor.accountId,m.id);
  assert.equal(view.length,1);
  assert.equal(view[0]!.amountMinor,15000);
  const status=f.db.automationRuns!.status('automation-operator');
  assert.equal(status.executionCount,1);
  assert.equal(status.reservedMinor,15000);
});

test('AUTO-03: only the exact workload identity prepares and only the run operator reads status',t=>{
  const f=fixture(t),m=f.mandate();f.bill('auto-bill-1',150,1);
  assert.throws(()=>f.db.automationRuns!.prepare('automation-operator',{mandateId:m.id,occurrenceKey:'occ_x',requestKey:`req_${randomUUID()}`}),(e:any)=>e.code==='AUTOMATION_WORKER_REQUIRED');
  assert.throws(()=>f.db.automationRuns!.prepare('some-other-worker',{mandateId:m.id,occurrenceKey:'occ_x',requestKey:`req_${randomUUID()}`}),(e:any)=>e.code==='AUTOMATION_WORKER_REQUIRED');
  assert.throws(()=>f.db.automationRuns!.status('auto-worker'),(e:any)=>e.code==='AUTOMATION_OPERATOR_REQUIRED');
  assert.throws(()=>f.db.automationRuns!.inspect('other-user',f.actor.accountId),(e:any)=>e.code==='ACCOUNT_FORBIDDEN');
  assert.equal(f.db.automationRuns!.inspect('auto-owner',f.actor.accountId,'mandate_unknown').length,0);
});

test('AUTO-03: skips record a reason without consuming the occurrence or reserving capacity',t=>{
  const f=fixture(t),m=f.mandate();
  assert.equal(skipped(f.prepare(m.id,'occ_none')).reason,'NO_DUE_INVOICE');
  f.bill('auto-bill-paid',100,-2,'PAID');
  assert.equal(skipped(f.prepare(m.id,'occ_paid',`req_${randomUUID()}`)).reason,'NO_DUE_INVOICE','a paid bill is not a due invoice');
  f.bill('auto-bill-big',600,1);
  assert.equal(skipped(f.prepare(m.id,'occ_big',`req_${randomUUID()}`)).reason,'OVER_PER_PAYMENT_CAP');
  assert.equal(f.db.automationRuns!.status('automation-operator').executionCount,0);
  assert.equal(f.db.automationRuns!.inspect('auto-owner',f.actor.accountId).length,0);
});

test('AUTO-03: unsupported operations fail closed and revoked authority never prepares',t=>{
  const f=fixture(t),m=f.mandate();
  const reloadPolicy=JSON.parse(JSON.stringify(m.policy));
  reloadPolicy.operation='WALLET_RELOAD';
  reloadPolicy.target={kind:'WALLET'};
  reloadPolicy.trigger={type:'LOW_BALANCE',belowMinor:1000,reloadMinor:5000,targetBalanceMinor:50000};
  const card=f.db.transaction(()=>f.payments.execute(f.actor,'POST','/payment-methods',{preset:'approved',nickname:'Reload card'})).data.method;
  reloadPolicy.sources=[{methodId:card.id,expectedVersion:card.version}];
  const created=f.payments.mandates!.create(f.actor,reloadPolicy);
  f.payments.mandates!.approve(f.actor,created.id,created.version,created.approvalDigest);
  assert.throws(()=>f.prepare(created.id,'occ_reload'),(e:any)=>e.code==='AUTOMATION_UNSUPPORTED');
  f.payments.mandates!.revoke(f.actor,m.id,m.version);
  f.bill('auto-bill-1',150,1);
  assert.equal(skipped(f.prepare(m.id,'occ_revoked',`req_${randomUUID()}`)).reason,'MANDATE_NOT_ACTIVE');
  assert.equal(f.db.automationRuns!.inspect('auto-owner',f.actor.accountId).length,0);
});

test('AUTO-03: shared budgets, counts and cooldown bound repeated preparations',t=>{
  const f=fixture(t),m=f.mandate();
  f.bill('auto-bill-1',300,1);
  f.bill('auto-bill-2',300,2);
  f.bill('auto-bill-3',500,3);
  const first=prepared(f.prepare(m.id,'occ_1'));
  assert.equal(first.amountMinor,30000);
  assert.throws(()=>f.prepare(m.id,'occ_2',`req_${randomUUID()}`),(e:any)=>e.code==='AUTOMATION_COOLDOWN');
  const base=Date.now();
  let shift=61000;
  const clock=t.mock.method(Date,'now',()=>base+shift);
  try{
    const second=prepared(f.prepare(m.id,'occ_2',`req_${randomUUID()}`));
    assert.equal(second.amountMinor,30000);
    shift=122000;
    assert.equal(skipped(f.prepare(m.id,'occ_3',`req_${randomUUID()}`)).reason,'OVER_PERIOD_BUDGET');
    const status=f.db.automationRuns!.status('automation-operator');
    assert.equal(status.executionCount,2);
    assert.equal(status.reservedMinor,60000);
  }finally{clock.mock.restore();}
});

test('AUTO-03: a prepared payable blocks the manual provider admission and a manual admission blocks preparation',t=>{
  const f=fixture(t),m=f.mandate();f.bill('auto-bill-1',150,1);
  const first=prepared(f.prepare(m.id));
  assert.equal(claimAutomationPayable(f.dewaDb,f.actor.accountId,first.payableId,'autoexec_other'),'HELD_AUTOMATION');
  assert.throws(()=>f.dewa.admissions!.prepare(f.actor.accountId,first.payableId,
    {orderId:'order_manual',expectedRevision:first.payableRevision,approvalDigest:'0'.repeat(64),sourceId:'wallet',sourceVersion:1,expiresAt:new Date(Date.now()+60000).toISOString()}),
    (e:any)=>e.code==='PAYABLE_RESERVED');
  f.bill('auto-bill-2',120,2);
  const manual=f.dewa.admissions!.prepare(f.actor.accountId,'dewa:bill:auto-bill-2',
    {orderId:'order_manual_2',expectedRevision:f.dewa.payables!.get(f.actor.accountId,'dewa:bill:auto-bill-2').revision,approvalDigest:'0'.repeat(64),sourceId:'wallet',sourceVersion:1,expiresAt:new Date(Date.now()+60000).toISOString()});
  assert.equal(manual.state,'PREPARED');
  const base=Date.now();
  const clock=t.mock.method(Date,'now',()=>base+61000);
  try{assert.throws(()=>f.prepare(m.id,'occ_2',`req_${randomUUID()}`),(e:any)=>e.code==='AUTOMATION_PAYABLE_RESERVED');}
  finally{clock.mock.restore();}
});

test('AUTO-03: the isolated run cannot arm on normal or copied data, rebind identity, or reopen without context',t=>{
  const f=fixture(t);
  const other=new AccountDatabase(f.path);
  t.after(()=>other.close());
  assert.throws(()=>new ProviderEngine('payments',other),/original isolated run context/);
  assert.throws(()=>new ProviderEngine('payments',other,{automationRun:{...f.context,operatorSub:'another-operator'},automationIo:{readPayables:()=>[],providerStore:()=>other}}));
  const outside=mkdtempSync(join(tmpdir(),'normal-payments-'));
  t.after(()=>{try{rmSync(outside,{recursive:true,force:true});}catch{}});
  const plain=new AccountDatabase(join(outside,'payments.sqlite'));
  t.after(()=>plain.close());
  assert.throws(()=>new ProviderEngine('payments',plain,{automationRun:f.context,automationIo:{readPayables:()=>[],providerStore:()=>plain}}));
  const copyRoot=mkdtempSync(join(tmpdir(),'cityside-auto-copy-'));
  t.after(()=>{try{rmSync(copyRoot,{recursive:true,force:true});}catch{}});
  const copied=new AccountDatabase(join(copyRoot,'payments.sqlite'));
  t.after(()=>copied.close());
  copied.accounts(f.actor.sub);
  assert.throws(()=>new ProviderEngine('payments',copied,{automationRun:f.context,automationIo:{readPayables:()=>[],providerStore:()=>copied}}));
  assert.equal(copied.db.prepare("SELECT name FROM sqlite_master WHERE name='automation_runs'").get(),undefined);
});

test('AUTO-04: preparation refuses paused rules and honors the one-shot owner skip',t=>{
  const f=fixture(t),m=f.mandate();f.bill('auto-bill-1',150,1);
  const paused=f.payments.mandates!.pause(f.actor,m.id,m.version);
  assert.equal(skipped(f.prepare(m.id,'occ_paused',`req_${randomUUID()}`)).reason,'MANDATE_NOT_ACTIVE');
  const resumed=f.payments.mandates!.resume(f.actor,m.id,paused.version);
  assert.equal(resumed.state,'APPROVED');
  f.payments.mandates!.skipNext(f.actor,m.id,resumed.version);
  assert.equal(skipped(f.prepare(m.id,'occ_skip',`req_${randomUUID()}`)).reason,'OPERATOR_SKIP_NEXT');
  const next=prepared(f.prepare(m.id,'occ_next',`req_${randomUUID()}`));
  assert.equal(next.state,'PREPARED','the skip was one-shot; the following occurrence prepares');
  const current=f.payments.mandates!.get(f.actor,m.id);
  assert.equal(current.skipNext,false);
});

test('AUTO-03 checkpoint 2: the exact worker reads the immutable preparation with current authority freshness',t=>{
  const f=fixture(t),m=f.mandate();f.bill('auto-bill-1',150,1);
  const first=prepared(f.prepare(m.id,'occ_read'));
  const view=f.db.automationRuns!.readExecution('auto-worker',first.id);
  assert.equal(view.executionId,first.id);
  assert.equal(view.ownerSub,'auto-owner','the broker needs the workspace owner to name the delegated subject');
  assert.equal(view.mandate.state,'APPROVED');
  assert.equal(view.payable.current,true);
  assert.equal(view.source.current,true);
  assert.equal(view.biller!.current,true);
  assert.equal(view.boundDigest,first.boundDigest);
  assert.equal(view.expired,false);
  assert.throws(()=>f.db.automationRuns!.readExecution('automation-operator',first.id),(e:any)=>e.code==='AUTOMATION_WORKER_REQUIRED');
  assert.throws(()=>f.db.automationRuns!.readExecution('auto-worker','autoexec_missing'),(e:any)=>e.code==='AUTOMATION_EXECUTION_NOT_FOUND');
  f.payments.mandates!.pause(f.actor,m.id,m.version);
  const paused=f.db.automationRuns!.readExecution('auto-worker',first.id);
  assert.equal(paused.mandate.state,'PAUSED','freshness is read at credential time, not trusted from the preparation');
  assert.equal(paused.expired,false);
});

test('AUTO-03 step 3: preparation creates the real gateway order, which ordinary APIs cannot decide',t=>{
  const f=fixture(t),m=f.mandate();f.bill('auto-bill-1',150,1);
  const first=prepared(f.prepare(m.id,'occ_order'));
  assert.ok(first.orderId,'the preparation names its gateway order');
  const order=f.payments.orders!.get(f.actor,first.orderId!);
  assert.equal(order.state,'AWAITING_APPROVAL');
  assert.equal(order.quote.totalMinor,first.amountMinor);
  assert.equal(order.quote.source.id,first.sourceId);
  assert.deepEqual(order.automation,{executionId:first.id,mandateId:m.id,boundDigest:first.boundDigest});
  assert.equal(prepared(f.prepare(m.id,'occ_order',`req_${randomUUID()}`)).orderId,first.orderId,'a retry returns the same order, never a second');
  const decide={expectedVersion:order.version,approvalDigest:order.approvalDigest};
  const refused=(e:any)=>e.code==='ORDER_AUTOMATIC';
  assert.throws(()=>f.payments.orders!.approve(f.actor,order.id,decide,undefined),refused);
  assert.throws(()=>f.payments.orders!.beginCapture(f.actor,order.id,decide,undefined as never),refused);
  assert.throws(()=>f.payments.orders!.challenge(f.actor,order.id,{...decide,challengeId:'c1',decision:'APPROVE'},undefined,true),refused);
  assert.throws(()=>f.payments.orders!.cancel(f.actor,order.id,order.version),refused);
  assert.equal(f.payments.orders!.get(f.actor,order.id).state,'AWAITING_APPROVAL','refusals change nothing');
});

function execution(f:ReturnType<typeof fixture>){
  const local=new ProviderSettlements(f.dewaDb,'dewa',{call:async(account,id,action,body:any)=>action==='claim'?f.payments.claims!.claim(account,id,'dewa',body):action==='ack'?f.payments.claims!.acknowledge(account,id,'dewa',body):f.payments.claims!.release(account,id,'dewa',body)});
  let effects=0;
  const client={call:async(_p:string,_a:unknown,method:string,path:string,body:any={},key='test')=>{
    if(path.endsWith('/payments')){
      const proof=f.payments.execute(f.actor,'GET',`/charges/${body.paymentId}`,{}).data.charge,fp=createHash('sha256').update(JSON.stringify([method,path,body])).digest('hex');
      return (await local.execute(f.actor,key,fp,proof,claimed=>{effects++;return f.dewa.execute(f.actor,method,path,body,claimed);})).data;
    }
    let gatewayOrder;
    if(path.endsWith('/admit')||path.endsWith('/cancel')){const admission=f.dewa.admissions!.get(f.actor.accountId,path.split('/')[4]);gatewayOrder=f.payments.orders!.get(f.actor,admission.orderId);}
    return f.dewaDb.transaction(()=>f.dewa.execute(f.actor,method,path,body,undefined,undefined,gatewayOrder)).data;
  }} as unknown as ProviderClient;
  const consumed:Record<string,unknown>[]=[];let deny=false;
  const deps={runs:f.db.automationRuns!,orders:f.payments.orders!,checkout:new PaymentCheckout(f.payments.orders!,client),client,
    authority:async(_a:string|undefined,op:Record<string,unknown>)=>{if(deny)throw new Error('denied');consumed.push(op);},
    session:async()=>({executionId:String(consumed.at(-1)?.executionId)})};
  return {deps,consumed,effects:()=>effects,deny:(v:boolean)=>{deny=v;}};
}
const owner={sub:'auto-owner',authorization:'Bearer broker-bound'};

test('AUTO-03 step 3: the dedicated route settles the automatic order once for the operation the broker would permit',async t=>{
  const f=fixture(t),m=f.mandate();f.bill('auto-bill-1',150,1);
  const first=prepared(f.prepare(m.id,'occ_exec')),x=execution(f);
  const before=f.payments.ledger!.summary(f.actor.accountId).balanceMinor;
  const settled=await executeAutomaticOrder(x.deps,owner,first.id);
  assert.equal(settled.state,'SETTLED',String((settled as {failureCode?:string}).failureCode));
  assert.equal(settled.fundsCaptured,true);
  assert.equal(settled.quote.totalMinor,15000);
  assert.equal(f.dewa.payables!.get(f.actor.accountId,first.payableId).status,'PAID');
  assert.equal(f.payments.ledger!.summary(f.actor.accountId).balanceMinor,before-15000);
  assert.equal(x.effects(),1);
  // The provider and the broker derive the same operation independently.
  const view=f.db.automationRuns!.readExecution('auto-worker',first.id);
  assert.deepEqual(x.consumed,[permitOperation(view as never)]);
  // The permit is spent: a second call spends nothing, re-admits nothing and only returns the settled order.
  const again=await executeAutomaticOrder(x.deps,owner,first.id);
  assert.equal(again.state,'SETTLED');
  assert.equal(x.consumed.length,1,'the permit was consumed exactly once');
  assert.equal(x.effects(),1);
  assert.equal(f.payments.ledger!.summary(f.actor.accountId).balanceMinor,before-15000);
});

test('AUTO-03 step 3: wrong owner, missing permit and stale authority execute nothing',async t=>{
  const f=fixture(t),m=f.mandate();f.bill('auto-bill-1',150,1);
  const first=prepared(f.prepare(m.id,'occ_stale')),x=execution(f),before=f.payments.ledger!.summary(f.actor.accountId).balanceMinor;
  await assert.rejects(executeAutomaticOrder(x.deps,{...owner,sub:'someone-else'},first.id),(e:any)=>e.code==='AUTOMATION_OWNER_MISMATCH');
  x.deny(true);
  await assert.rejects(executeAutomaticOrder(x.deps,owner,first.id),(e:any)=>e.code==='AUTOMATION_PERMIT_DENIED');
  x.deny(false);
  assert.equal(x.consumed.length,0);
  assert.equal(f.payments.orders!.get(f.actor,first.orderId!).state,'AWAITING_APPROVAL');
  f.payments.mandates!.pause(f.actor,m.id,m.version);
  await assert.rejects(executeAutomaticOrder(x.deps,owner,first.id),(e:any)=>e.code==='AUTOMATION_ADMISSION_REJECTED');
  assert.equal(f.payments.orders!.get(f.actor,first.orderId!).state,'AWAITING_APPROVAL','a paused mandate captures nothing');
  assert.equal(f.payments.ledger!.summary(f.actor.accountId).balanceMinor,before);
  assert.equal(x.effects(),0);
  await assert.rejects(executeAutomaticOrder(x.deps,owner,first.id),(e:any)=>e.code==='AUTOMATION_ALREADY_DISPATCHED','the rejection is recorded and final for this execution');
});

test('AUTO-03 step 3: a lost response resumes the same order with the same spent permit, never a second effect',async t=>{
  const f=fixture(t),m=f.mandate();f.bill('auto-bill-1',150,1);
  const first=prepared(f.prepare(m.id,'occ_resume')),x=execution(f),before=f.payments.ledger!.summary(f.actor.accountId).balanceMinor;
  // The permit is spent and the admission recorded, but the snapshot read is lost before the order moves.
  const real=x.deps.client.call.bind(x.deps.client);let lose=true;
  x.deps.client.call=async(...args:Parameters<typeof real>)=>{if(lose&&args[2]==='GET'&&/\/payables\/[^/]+$/.test(args[3])){lose=false;throw new Error('connection lost');}return real(...args);};
  await assert.rejects(executeAutomaticOrder(x.deps,owner,first.id),/connection lost/);
  assert.equal(f.db.automationRuns!.dispatchState(first.id),'ADMITTED');
  assert.equal(f.payments.orders!.get(f.actor,first.orderId!).state,'AWAITING_APPROVAL');
  assert.equal(f.payments.ledger!.summary(f.actor.accountId).balanceMinor,before);
  const settled=await executeAutomaticOrder(x.deps,owner,first.id);
  assert.equal(settled.state,'SETTLED');
  assert.equal(x.consumed.length,1,'the retry did not spend another permit');
  assert.equal(x.effects(),1);
  assert.equal(f.payments.ledger!.summary(f.actor.accountId).balanceMinor,before-15000);
  // A token without a session for this execution cannot resume it.
  x.deps.session=async()=>{throw new Error('no session');};
  await assert.rejects(executeAutomaticOrder(x.deps,owner,first.id),(e:any)=>e.code==='AUTOMATION_PERMIT_DENIED');
});
