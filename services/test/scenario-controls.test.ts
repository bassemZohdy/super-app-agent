import { removeTemp } from '../../test/support/temp-cleanup.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AccountDatabase } from '../provider-simulator/src/database.ts';
import { ProviderEngine } from '../provider-simulator/src/engine.ts';
import { actorFor } from '../../packages/backend-kit/src/context.ts';
import Ajv from 'ajv';
import { ScenarioControls,scenarioArmSchema } from '../provider-simulator/src/scenario-controls.ts';
import { FAILPOINTS } from '../provider-simulator/src/failpoints.ts';
import { PaymentCheckout } from '../provider-simulator/src/payment-checkout.ts';
import { inspectRun } from '../provider-simulator/src/run-inspector.ts';
import type { ProviderClient } from '../../packages/backend-kit/src/provider-client.ts';
import { ProviderSettlements } from '../provider-simulator/src/provider-settlements.ts';
import { createHash } from 'node:crypto';

function fixture(t:unknown){
  const root=mkdtempSync(join(tmpdir(),'cityside-issuer-')),path=join(root,'payments.sqlite');
  const context={root,operatorSub:'scenario-operator',runId:`simrun_${randomUUID()}`};
  const db=new AccountDatabase(path);
  const actor=actorFor({sub:'scenario-customer'},undefined,'Bearer customer');
  const engine=new ProviderEngine('payments',db,{issuerScenario:context});
  db.accounts(actor.sub);engine.seed(actor);
  t.after(()=>{db.close();try{removeTemp(root);}catch{}});
  const controls=db.scenarioControls!;
  const arm=(subject:string,name:string,times?:number,requestKey?:string)=>controls.arm(subject,{name,times,requestKey:requestKey??`req_${randomUUID()}`});
  const checkout=async(methodId='wallet')=>{
    const payable={id:'dewa:bill:ctrl',provider:'dewa' as const,reference:'ctrl-home',obligationId:'ctrl',kind:'BILL' as const,version:1,label:'Control bill',amountMinor:1000,currency:'AED' as const,status:'UNPAID' as const,revision:'a'.repeat(64)};
    db.transaction(()=>engine.execute(actor,'POST','/payment-orders',{provider:'dewa',payableId:payable.id,expectedPayableRevision:payable.revision,methodId,expectedMethodVersion:1},payable));
    return engine.orders!;
  };
  return {root,path,context,db,engine,actor,controls,arm,checkout};
}

test('SIM-05: only the run operator arms, clears or inspects scenario controls',t=>{
  const f=fixture(t);
  assert.throws(()=>f.arm('scenario-customer','checkout.after-admission'),(e:any)=>e.code==='SCENARIO_OPERATOR_REQUIRED');
  assert.throws(()=>f.arm('another-operator','checkout.after-admission'),(e:any)=>e.code==='SCENARIO_OPERATOR_REQUIRED');
  assert.throws(()=>f.controls.clear('scenario-customer'),(e:any)=>e.code==='SCENARIO_OPERATOR_REQUIRED');
  assert.throws(()=>f.controls.status('scenario-customer'),(e:any)=>e.code==='SCENARIO_OPERATOR_REQUIRED');
});

test('SIM-05: arming is limited to the named failpoint registry with bounded counts and replayable keys',t=>{
  const f=fixture(t);
  assert.throws(()=>f.arm('scenario-operator','/payment-orders/custom-url'),(e:any)=>e.code==='SCENARIO_CONTROL_INVALID');
  assert.throws(()=>f.arm('scenario-operator','checkout.after-admission',1000),(e:any)=>e.code==='SCENARIO_CONTROL_INVALID');
  const armed=f.arm('scenario-operator','checkout.after-admission',2,'req_replay_key_01');
  assert.deepEqual(armed.armed,{name:'checkout.after-admission',times:2,fired:0});
  const replay=f.arm('scenario-operator','checkout.after-admission',2,'req_replay_key_01');
  assert.deepEqual(replay,armed);
  assert.throws(()=>f.arm('scenario-operator','checkout.after-capture-commit',1,'req_replay_key_01'),(e:any)=>e.code==='SCENARIO_CONTROL_CONFLICT');
});

test('SIM-05: an armed failpoint loses the checkout response and recovery keeps one debit; clear resets counters',async t=>{
  const f=fixture(t);
  f.controls.clear('scenario-operator');
  const dewaDb=new AccountDatabase(':memory:');
  const dewa=new ProviderEngine('dewa',dewaDb);dewaDb.accounts(f.actor.sub);dewa.seed(f.actor);
  t.after(()=>dewaDb.close());
  dewaDb.put(f.actor.accountId,'bill',{billId:'ctrl',accountNumber:'ctrl-home',totalAmount:10,status:'UNPAID',dueDate:new Date(Date.now()+86400000).toISOString().slice(0,10)},'ctrl');
  const p=dewa.payables!.get(f.actor.accountId,'dewa:bill:ctrl');
  f.db.transaction(()=>f.engine.execute(f.actor,'POST','/billing-accounts',{provider:'dewa',reference:p.reference,nickname:'Home'}));
  const order=f.engine.orders!.create(f.actor,{provider:'dewa',payableId:p.id,expectedPayableRevision:p.revision,methodId:'wallet',expectedMethodVersion:1},p);
  f.arm('scenario-operator','checkout.after-capture-commit',1);
  const local=new ProviderSettlements(dewaDb,'dewa',{call:async(account:string,id:string,action:string,body:any)=>action==='claim'?f.engine.claims!.claim(account,id,'dewa',body):action==='ack'?f.engine.claims!.acknowledge(account,id,'dewa',body):f.engine.claims!.release(account,id,'dewa',body)});
  const client={call:async(_provider:string,_actor:unknown,method:string,path:string,body:any={},key='test')=>{
    if(path.endsWith('/payments')){
      const proof=f.engine.execute(f.actor,'GET',`/charges/${body.paymentId}`,{}).data.charge;
      const fingerprint=createHash('sha256').update(JSON.stringify([method,path,body])).digest('hex');
      const result=await local.execute(f.actor,key,fingerprint,proof,claimed=>dewa.execute(f.actor,method,path,body,claimed));
      return result.data;
    }
    let gatewayOrder;
    if(path.endsWith('/admit')||path.endsWith('/cancel')){const admission=dewa.admissions!.get(f.actor.accountId,path.split('/')[4]);gatewayOrder=f.engine.orders!.get(f.actor,admission.orderId);}
    return dewaDb.transaction(()=>dewa.execute(f.actor,method,path,body,undefined,undefined,gatewayOrder)).data;
  }} as unknown as ProviderClient;
  const checkout=new PaymentCheckout(f.engine.orders!,client);
  const approved=f.db.transaction(()=>f.engine.orders!.approve(f.actor,order.id,{expectedVersion:order.version,approvalDigest:order.approvalDigest},p));
  const input={expectedVersion:approved.version,approvalDigest:approved.approvalDigest};
  const pending=await checkout.execute(f.actor,approved.id,input);
  assert.equal(pending.state,'RECONCILIATION_REQUIRED');
  assert.equal(pending.fundsCaptured,true);
  const status=f.controls.status('scenario-operator');
  assert.equal(status.armed.find((a:{name:string})=>a.name==='checkout.after-capture-commit')!.fired,1);
  assert.ok(status.audit.some((entry:{event:string})=>entry.event==='ARMED'));
  const settled=await checkout.recover(f.actor,pending.id);
  assert.equal(settled.state,'SETTLED');
  assert.equal(f.engine.ledger!.summary(f.actor.accountId).balanceMinor,149000,'exactly one debit');
  f.controls.clear('scenario-operator');
  assert.equal(f.controls.status('scenario-operator').armed.every((a:{fired:number})=>a.fired===0),true);
});

test('SIM-05: controls exist only inside an isolated run',t=>{
  const root=mkdtempSync(join(tmpdir(),'normal-payments-'));
  const db=new AccountDatabase(join(root,'payments.sqlite'));
  t.after(()=>{db.close();try{removeTemp(root);}catch{}});
  const actor=actorFor({sub:'plain-owner'},undefined,'Bearer x');
  const engine=new ProviderEngine('payments',db);
  db.accounts(actor.sub);engine.seed(actor);
  assert.equal(db.scenarioControls,undefined);
  assert.throws(()=>new ScenarioControls(db,{context:{runId:'simrun_x',operatorSub:'op',root}} as never),(e:any)=>/operator|run/i.test(e.message));
});

test('SIM-06: the operator inspects run-wide funds, holds, orders and mismatch reasons read-only',async t=>{
  const f=fixture(t);
  f.controls.clear('scenario-operator');
  const dewaDb=new AccountDatabase(':memory:');
  const dewa=new ProviderEngine('dewa',dewaDb);dewaDb.accounts(f.actor.sub);dewa.seed(f.actor);
  t.after(()=>dewaDb.close());
  dewaDb.put(f.actor.accountId,'bill',{billId:'inspect',accountNumber:'ctrl-home',totalAmount:20,status:'UNPAID',dueDate:new Date(Date.now()+86400000).toISOString().slice(0,10)},'inspect');
  const p=dewa.payables!.get(f.actor.accountId,'dewa:bill:inspect');
  f.db.transaction(()=>f.engine.execute(f.actor,'POST','/billing-accounts',{provider:'dewa',reference:p.reference,nickname:'Home'}));
  const order=f.engine.orders!.create(f.actor,{provider:'dewa',payableId:p.id,expectedPayableRevision:p.revision,methodId:'wallet',expectedMethodVersion:1},p);
  const approved=f.db.transaction(()=>f.engine.orders!.approve(f.actor,order.id,{expectedVersion:order.version,approvalDigest:order.approvalDigest},p));
  f.arm('scenario-operator','checkout.after-capture-commit',1);
  const local=new ProviderSettlements(dewaDb,'dewa',{call:async(account:string,id:string,action:string,body:any)=>action==='claim'?f.engine.claims!.claim(account,id,'dewa',body):action==='ack'?f.engine.claims!.acknowledge(account,id,'dewa',body):f.engine.claims!.release(account,id,'dewa',body)});
  const client={call:async(_provider:string,_actor:unknown,method:string,path:string,body:any={},key='test')=>{
    if(path.endsWith('/payments')){
      const proof=f.engine.execute(f.actor,'GET',`/charges/${body.paymentId}`,{}).data.charge;
      const fingerprint=createHash('sha256').update(JSON.stringify([method,path,body])).digest('hex');
      const result=await local.execute(f.actor,key,fingerprint,proof,claimed=>dewa.execute(f.actor,method,path,body,claimed));
      return result.data;
    }
    let gatewayOrder;
    if(path.endsWith('/admit')||path.endsWith('/cancel')){const admission=dewa.admissions!.get(f.actor.accountId,path.split('/')[4]);gatewayOrder=f.engine.orders!.get(f.actor,admission.orderId);}
    return dewaDb.transaction(()=>dewa.execute(f.actor,method,path,body,undefined,undefined,gatewayOrder)).data;
  }} as unknown as ProviderClient;
  const checkout=new PaymentCheckout(f.engine.orders!,client);
  await checkout.execute(f.actor,approved.id,{expectedVersion:approved.version,approvalDigest:approved.approvalDigest});
  const view=buildInspection(f);
  assert.equal(view.accounts.length,1);
  assert.equal(view.accounts[0]!.walletMinor,148000,'the capture committed before the lost response; the inspector explains the 20.00 debit');
  const entry=view.accounts[0]!.orders.find((o:{order:{id:string}})=>o.order.id===approved.id);
  assert.ok(entry,'the non-terminal order is listed');
  assert.equal(entry!.order.state,'RECONCILIATION_REQUIRED');
  assert.ok(entry!.mismatches.some((m:string)=>m.startsWith('CAPTURE_COMMITTED_SETTLEMENT_PENDING')));
  assert.equal(view.pendingEvents.count>=0,true);
  assert.throws(()=>f.controls.status('scenario-customer'),(e:any)=>e.code==='SCENARIO_OPERATOR_REQUIRED','only the run operator reads the inspection');
});


function buildInspection(f:ReturnType<typeof fixture>){
  return inspectRun(f.db,{orders:f.engine.orders!,ledger:f.engine.ledger!,issuer:f.engine.issuer,claims:f.engine.claims,
    methods:(accountId:string)=>f.db.list(accountId,'payment-method') as {id:string;kind:string;status:string}[]});
}

test('SIM-04: the armed wallet-path failpoint loses the response after the real commit and the replay credits once',t=>{
  const f=fixture(t);
  f.controls.clear('scenario-operator');
  const method=f.db.transaction(()=>f.engine.execute(f.actor,'POST','/payment-methods',{preset:'approved',nickname:'Funding card'})).data.method;
  const configured=f.db.issuerScenarios!.configure('scenario-operator',{accountId:f.actor.accountId,methodId:method.id,expectedMethodVersion:method.version,expectedRevision:0,preset:'approved',requestKey:`req_${randomUUID()}`});
  const created=f.engine.funding!.create(f.actor,{amountMinor:5000,methodId:configured.method.id,expectedMethodVersion:configured.method.version});
  const approved=f.engine.funding!.approve(f.actor,created.id,{expectedVersion:created.version,approvalDigest:created.approvalDigest});
  assert.equal(approved.state,'AUTHORIZED');
  f.arm('scenario-operator','funding.after-commit',1);
  const input={expectedVersion:approved.version,approvalDigest:approved.approvalDigest};
  assert.throws(()=>f.engine.funding!.execute(f.actor,approved.id,input),(e:any)=>e.code==='PROVIDER_OUTCOME_UNKNOWN');
  assert.equal(f.engine.ledger!.summary(f.actor.accountId).balanceMinor,155000,'the credit committed before the lost response');
  const replayed=f.engine.funding!.execute(f.actor,approved.id,input);
  assert.equal(replayed.state,'SETTLED');
  assert.equal(f.engine.ledger!.summary(f.actor.accountId).balanceMinor,155000,'the replay returns the settled order without a second credit');
  assert.equal(f.controls.status('scenario-operator').armed.find((a:{name:string})=>a.name==='funding.after-commit')!.fired,1);
  f.controls.clear('scenario-operator');
});

test('SIM-05: the HTTP arm schema is derived from the failpoint registry, so every registered failpoint can be armed',()=>{
  const ajv=new Ajv({strict:false,allErrors:true});
  assert.deepEqual(scenarioArmSchema.properties.name.enum,[...FAILPOINTS]);
  for(const name of FAILPOINTS)assert.equal(ajv.validate(scenarioArmSchema,{name,requestKey:'req_registry_1'}),true,`${name} must be armable`);
  for(const bad of [{name:'checkout.unknown',requestKey:'req_registry_1'},{name:FAILPOINTS[0],requestKey:'short'},{name:FAILPOINTS[0],requestKey:'req_registry_1',times:101},{name:FAILPOINTS[0],requestKey:'req_registry_1',url:'http://elsewhere'}])
    assert.equal(ajv.validate(scenarioArmSchema,bad),false,JSON.stringify(bad));
});
