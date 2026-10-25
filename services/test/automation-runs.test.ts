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
import { armFailpoint,clearFailpoints } from '../provider-simulator/src/failpoints.ts';
import { UpstreamError } from '../../packages/backend-kit/src/provider-client.ts';
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
  assert.equal(skipped(f.prepare(created.id,'occ_reload')).reason,'BALANCE_ABOVE_THRESHOLD','a reload rule with a healthy wallet prepares nothing');
  const calendarPolicy=JSON.parse(JSON.stringify(m.policy));
  calendarPolicy.trigger={type:'CALENDAR',dayOfMonth:1,hour:9,minute:0,monthEnd:'LAST_DAY'};
  calendarPolicy.purpose='Calendar bill rule';
  const calendar=f.payments.mandates!.create(f.actor,calendarPolicy);
  f.payments.mandates!.approve(f.actor,calendar.id,calendar.version,calendar.approvalDigest);
  assert.throws(()=>f.prepare(calendar.id,'occ_calendar'),(e:any)=>e.code==='AUTOMATION_UNSUPPORTED','a trigger that cannot execute yet fails closed');
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
  const deps={runs:f.db.automationRuns!,orders:f.payments.orders!,funding:f.payments.funding!,checkout:new PaymentCheckout(f.payments.orders!,client),client,
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
  assert.equal(f.payments.orders!.get(f.actor,first.orderId!).state,'CANCELLED','a paused mandate captures nothing and its order is closed');
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

test('AUTO-03 step 4: a spent permit with no recorded admission continues once; without a session it stays held',async t=>{
  const f=fixture(t),m=f.mandate();f.bill('auto-bill-1',150,1);
  const first=prepared(f.prepare(m.id,'occ_crash')),x=execution(f),before=f.payments.ledger!.summary(f.actor.accountId).balanceMinor;
  // The broker consumed the permit, then the provider crashed before recording the admission.
  x.consumed.push({executionId:first.id});
  const denyConsume=x.deps.authority;x.deps.authority=async()=>{throw new Error('permit already consumed');};
  assert.equal(f.db.automationRuns!.dispatchState(first.id),undefined);
  const settled=await executeAutomaticOrder(x.deps,owner,first.id);
  assert.equal(settled.state,'SETTLED');
  assert.equal(f.db.automationRuns!.dispatchState(first.id),'ADMITTED');
  assert.equal(x.effects(),1);
  assert.equal(f.payments.ledger!.summary(f.actor.accountId).balanceMinor,before-15000);
  x.deps.authority=denyConsume;
  // A token that never had a consumed permit (no session) cannot admit, and nothing moves.
  const g=fixture(t),n=g.mandate();g.bill('auto-bill-2',150,1);
  const second=prepared(g.prepare(n.id,'occ_held')),y=execution(g);
  y.deps.authority=async()=>{throw new Error('broker unreachable');};y.deps.session=async()=>{throw new Error('no session');};
  await assert.rejects(executeAutomaticOrder(y.deps,owner,second.id),(e:any)=>e.code==='AUTOMATION_PERMIT_DENIED');
  assert.equal(g.db.automationRuns!.dispatchState(second.id),undefined);
  assert.equal(g.payments.orders!.get(g.actor,second.orderId!).state,'AWAITING_APPROVAL');
  assert.equal(y.effects(),0);
});

const claimCount=(f:ReturnType<typeof fixture>)=>Number(f.dewaDb.db.prepare("SELECT count(*) n FROM automation_payable_claims").get()!.n);

test('AUTO-03 step 5: a definitive pre-funds failure releases the claim and budget but never reuses the occurrence',async t=>{
  const f=fixture(t),m=f.mandate();f.bill('auto-bill-1',150,1);
  const first=prepared(f.prepare(m.id,'occ_release')),x=execution(f);
  assert.equal(claimCount(f),1);
  assert.equal(f.db.automationRuns!.status('automation-operator').reservedMinor,15000);
  f.payments.mandates!.pause(f.actor,m.id,m.version);
  await assert.rejects(executeAutomaticOrder(x.deps,owner,first.id),(e:any)=>e.code==='AUTOMATION_ADMISSION_REJECTED');
  assert.equal(f.db.automationRuns!.released(first.id),true);
  assert.equal(f.payments.orders!.get(f.actor,first.orderId!).state,'CANCELLED');
  assert.equal(claimCount(f),0,'the source provider claim is gone');
  assert.equal(f.db.automationRuns!.status('automation-operator').reservedMinor,0,'the budget reservation is freed');
  assert.equal(f.dewa.payables!.get(f.actor.accountId,first.payableId).status,'UNPAID');
  // No credential or admission remains for the released execution.
  assert.throws(()=>f.db.automationRuns!.readExecution('auto-worker',first.id),(e:any)=>e.code==='AUTOMATION_EXECUTION_RELEASED');
  assert.equal(f.db.automationRuns!.reconcile(first.id),'RELEASED','reconciling again is idempotent');
  assert.equal(x.effects(),0);
});

test('AUTO-03 step 5: an unknown outcome after funds moved is held, never released or retried',async t=>{
  const f=fixture(t),m=f.mandate();f.bill('auto-bill-1',150,1);
  const first=prepared(f.prepare(m.id,'occ_unknown')),x=execution(f),real=x.deps.client.call.bind(x.deps.client);
  x.deps.client.call=async(...args:Parameters<typeof real>)=>{if(args[3].endsWith('/payments'))throw new UpstreamError(503,'PROVIDER_OUTCOME_UNKNOWN','Lost before source commit');return real(...args);};
  const held=await executeAutomaticOrder(x.deps,owner,first.id);
  assert.equal(held.state,'RECONCILIATION_REQUIRED');
  assert.equal(held.fundsCaptured,true);
  assert.equal(f.db.automationRuns!.released(first.id),false);
  assert.equal(f.db.automationRuns!.reconcile(first.id),'HELD');
  assert.equal(claimCount(f),1,'the claim and reservation stay while the outcome is unknown');
  assert.equal(f.db.automationRuns!.status('automation-operator').reservedMinor,15000);
  // Recovery with the original order finishes it; the same reconciliation still never releases captured work.
  x.deps.client.call=real;
  const recovered=await x.deps.checkout.recover({...f.actor,sub:'auto-owner'},first.orderId!);
  assert.equal(recovered.state,'SETTLED');
  assert.equal(x.effects(),1);
  assert.equal(f.db.automationRuns!.reconcile(first.id),'HELD');
});

test('AUTO-03 step 5: an admission rejected before funds moves releases; an expired window is swept on the next preparation',async t=>{
  const f=fixture(t),m=f.mandate();f.bill('auto-bill-1',150,1);f.bill('auto-bill-2',160,1);
  const first=prepared(f.prepare(m.id,'occ_a')),x=execution(f),real=x.deps.client.call.bind(x.deps.client);
  x.deps.client.call=async(...args:Parameters<typeof real>)=>{if(args[3].endsWith('/admit'))throw new UpstreamError(409,'ADMISSION_CLOSED','The source closed the reservation');return real(...args);};
  const failed=await executeAutomaticOrder(x.deps,owner,first.id);
  assert.equal(failed.state,'FAILED');
  assert.equal(failed.fundsCaptured,false);
  assert.equal(f.db.automationRuns!.released(first.id),true);
  assert.equal(claimCount(f),0);
  assert.throws(()=>f.prepare(m.id,'occ_a'),(e:any)=>e.code==='AUTOMATION_OCCURRENCE_RELEASED','the failed occurrence is final and never retried with a fresh identity');
  // Backdate the first preparation so the mandate cooldown does not mask the sweep under test.
  const firstBody=JSON.parse(String(f.db.db.prepare('SELECT body FROM automation_executions WHERE id=?').get(first.id)!.body));
  f.db.db.prepare('UPDATE automation_executions SET body=? WHERE id=?').run(JSON.stringify({...firstBody,preparedAt:new Date(Date.now()-3600000).toISOString()}),first.id);
  // An execution nobody admitted before its window closed is released by the next preparation's sweep.
  const stale=prepared(f.db.automationRuns!.prepare('auto-worker',{mandateId:m.id,occurrenceKey:'occ_b',requestKey:`req_${randomUUID()}`}).valueOf());
  assert.equal(claimCount(f),1);
  const body=JSON.parse(String(f.db.db.prepare('SELECT body FROM automation_executions WHERE id=?').get(stale.id)!.body));
  f.db.db.prepare('UPDATE automation_executions SET body=? WHERE id=?').run(JSON.stringify({...body,admissionExpiresAt:new Date(Date.now()-1000).toISOString()}),stale.id);
  f.db.automationRuns!.sweepExpired();
  assert.equal(f.db.automationRuns!.released(stale.id),true);
  assert.equal(f.payments.orders!.get(f.actor,stale.orderId!).state,'CANCELLED');
  assert.equal(claimCount(f),0);
  assert.equal(f.db.automationRuns!.status('automation-operator').reservedMinor,0);
});

for(const point of ['checkout.after-admission','checkout.after-capture-commit','checkout.after-settlement-request'] as const)
test(`AUTO-03 step 5: a crash at ${point} holds the automatic order and recovery settles it once`,async t=>{
  const f=fixture(t),m=f.mandate();f.bill('auto-bill-1',150,1);
  const first=prepared(f.prepare(m.id,`occ_${point}`)),x=execution(f),before=f.payments.ledger!.summary(f.actor.accountId).balanceMinor;
  t.after(()=>clearFailpoints());armFailpoint(point,1);
  const interrupted=await executeAutomaticOrder(x.deps,owner,first.id);
  assert.notEqual(interrupted.state,'FAILED','a lost response is never a definitive failure');
  assert.equal(f.db.automationRuns!.released(first.id),false,'nothing is released while the outcome is unknown');
  assert.equal(claimCount(f),1);
  assert.equal(x.consumed.length,1);
  // Resume with the same spent permit session: the original order and identities finish, with one debit.
  const settled=await executeAutomaticOrder(x.deps,owner,first.id);
  assert.equal(settled.state,'SETTLED');
  assert.equal(settled.id,first.orderId);
  assert.equal(x.consumed.length,1,'no second permit was spent');
  assert.equal(x.effects(),1);
  assert.equal(f.payments.ledger!.summary(f.actor.accountId).balanceMinor,before-15000);
});

test('AUTO-06: the worker-scoped scheduling view lists rules, unclaimed due invoices and the wallet balance, and nothing else may read it',t=>{
  const f=fixture(t),m=f.mandate();f.bill('auto-bill-1',150,1);f.bill('auto-bill-2',90,40,'PAID');
  f.db.automationRuns!.io.walletBalanceMinor=accountId=>f.payments.ledger!.summary(accountId).balanceMinor;
  const rules=f.db.automationRuns!.rules('auto-worker');
  assert.equal(rules.length,1);
  assert.equal(rules[0]!.mandateId,m.id);
  assert.equal(rules[0]!.state,'APPROVED');
  assert.equal(rules[0]!.trigger.type,'INVOICE_DUE');
  assert.match(rules[0]!.target,/^dewa-/);
  assert.deepEqual(f.db.automationRuns!.dueInvoices('auto-worker',m.id).map(i=>i.dueDate.length),[10],'only the unpaid bill is a due invoice');
  assert.deepEqual(f.db.automationRuns!.balanceMinor('auto-worker',m.id),{balanceMinor:f.payments.ledger!.summary(f.actor.accountId).balanceMinor,qualifyingDebits:0});
  for(const who of ['automation-operator','auto-owner','someone-else']){
    assert.throws(()=>f.db.automationRuns!.rules(who),(e:any)=>e.code==='AUTOMATION_WORKER_REQUIRED');
    assert.throws(()=>f.db.automationRuns!.dueInvoices(who,m.id),(e:any)=>e.code==='AUTOMATION_WORKER_REQUIRED');
  }
  // Once an execution holds the invoice, it is no longer offered to the scheduler.
  prepared(f.prepare(m.id,'occ_view'));
  assert.deepEqual(f.db.automationRuns!.dueInvoices('auto-worker',m.id),[]);
});

const dump=(db:AccountDatabase)=>(db.db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all() as {name:string}[])
  .map(t=>[t.name,db.db.prepare(`SELECT * FROM "${t.name}"`).all()]);

test('AUTO-07: a preview shows amount, source, eligibility, next run and skip reasons while changing nothing',t=>{
  const f=fixture(t),m=f.mandate();f.bill('auto-bill-1',150,1);f.bill('auto-bill-2',700,2);f.bill('auto-bill-3',100,5);
  const payables=f.dewa.payables!.list(f.actor.accountId);
  const before=[dump(f.db),dump(f.dewaDb)];
  const forecast=f.payments.mandatePreview(f.actor,m.id,payables);
  assert.deepEqual([dump(f.db),dump(f.dewaDb)],before,'a preview wrote nothing to the gateway or the source provider');
  assert.equal(forecast.previewOnly,true);
  assert.equal(forecast.zeroEffect,true);
  assert.equal(forecast.wouldRun,true);
  assert.deepEqual(forecast.blockers,[]);
  assert.deepEqual(forecast.source,{id:'wallet',kind:'wallet',status:'ACTIVE',usable:true});
  const byId=new Map(forecast.candidates.map(c=>[c.payableId,c]));
  const small=byId.get('dewa:bill:auto-bill-1')!,big=byId.get('dewa:bill:auto-bill-2')!,far=byId.get('dewa:bill:auto-bill-3')!;
  assert.deepEqual([small.amountMinor,small.decision,small.reasons],[15000,'DUE_NOW',[]]);
  assert.deepEqual([big.amountMinor,big.decision,big.reasons],[70000,'SKIP',['OVER_PER_PAYMENT_CAP']]);
  assert.equal(far.decision,'SCHEDULED','a later invoice is forecast for its own run time');
  assert.ok(Date.parse(far.scheduledRunAt)>Date.now());
  assert.equal(forecast.nextRun!.key,`INV:${small.dueDate}`);
  assert.equal(forecast.budget.period.limitMinor,100000);
  assert.equal(forecast.budget.period.usedMinor,0);
  // Asking again, or later, is the same read and still reserves nothing.
  assert.deepEqual(f.payments.mandatePreview(f.actor,m.id,payables,Date.parse(forecast.asOf)),forecast);
  assert.deepEqual([dump(f.db),dump(f.dewaDb)],before);
});

test('AUTO-07: a preview counts real reservations and honors the same caps and cooldown that preparation enforces',t=>{
  const f=fixture(t),m=f.mandate();f.bill('auto-bill-1',150,1);f.bill('auto-bill-2',400,2);f.bill('auto-bill-3',480,3);
  prepared(f.prepare(m.id,'occ_used'));
  const forecast=f.payments.mandatePreview(f.actor,m.id,f.dewa.payables!.list(f.actor.accountId));
  assert.equal(forecast.budget.period.usedMinor,15000,'the reservation held by the first execution is counted');
  assert.ok(forecast.budget.cooldownEndsAt,'the mandate cooldown is shown');
  const open=forecast.candidates.filter(c=>c.decision==='SKIP');
  assert.ok(open.length>0&&open.every(c=>c.reasons.includes('COOLDOWN')||c.reasons.includes('ALREADY_RESERVED')));
  assert.ok(forecast.candidates.find(c=>c.payableId==='dewa:bill:auto-bill-1')!.reasons.includes('ALREADY_RESERVED'));
  assert.equal(forecast.wouldRun,false,'nothing can run during the cooldown');
});

test('AUTO-07: drafts, paused rules and stale sources are shown as blockers, never as ready to run',t=>{
  const f=fixture(t),m=f.mandate();f.bill('auto-bill-1',150,1);
  const payables=f.dewa.payables!.list(f.actor.accountId);
  f.payments.mandates!.pause(f.actor,m.id,m.version);
  const paused=f.payments.mandatePreview(f.actor,m.id,payables);
  assert.equal(paused.wouldRun,false);
  assert.ok(paused.blockers.includes('MANDATE_PAUSED'));
  assert.equal(paused.candidates[0]!.decision,'SKIP');
  const draft=f.payments.mandates!.create(f.actor,{...f.payments.mandates!.get(f.actor,m.id).policy,purpose:'Draft DEWA rule'});
  const preview=f.payments.mandatePreview(f.actor,draft.id,payables);
  assert.deepEqual(preview.blockers,['AWAITING_OWNER_APPROVAL']);
  assert.equal(preview.wouldRun,false);
  // A preview never grants more than the rule: another owner's rule is not readable at all.
  assert.throws(()=>f.payments.mandatePreview({...f.actor,sub:'someone-else',accountId:f.actor.accountId},m.id,payables));
  assert.throws(()=>f.payments.mandatePreview(f.actor,'mandate_missing',payables));
});

test('AUTO-07: the preview does not authorize anything; execution re-reads current state and skips what changed after it',t=>{
  const f=fixture(t),m=f.mandate();f.bill('auto-bill-1',150,1);
  const forecast=f.payments.mandatePreview(f.actor,m.id,f.dewa.payables!.list(f.actor.accountId));
  assert.equal(forecast.candidates[0]!.decision,'DUE_NOW');
  assert.equal(f.dewaDb.db.prepare("SELECT count(*) n FROM sqlite_master WHERE name='automation_payable_claims'").get()!.n===0||Number(f.dewaDb.db.prepare('SELECT count(*) n FROM automation_payable_claims').get()!.n)===0,true,'the preview claimed nothing');
  // The bill is paid elsewhere after the preview: preparation finds nothing due rather than trusting the forecast.
  f.bill('auto-bill-1',150,1,'PAID');
  assert.equal(skipped(f.prepare(m.id,'occ_after_preview')).reason,'NO_DUE_INVOICE');
  assert.equal(f.db.automationRuns!.status('automation-operator').executionCount,0);
});
