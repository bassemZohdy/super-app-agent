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
