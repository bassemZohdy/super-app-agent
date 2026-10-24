import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync,rmSync,existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { AccountDatabase } from '../provider-simulator/src/database.ts';
import { ProviderEngine,ApiError } from '../provider-simulator/src/engine.ts';
import { PaymentLedger } from '../provider-simulator/src/payment-ledger.ts';
import { PaymentClaims,SettlementError,claimantFor } from '../provider-simulator/src/payment-claims.ts';
import { ProviderSettlements } from '../provider-simulator/src/provider-settlements.ts';
import type { ClaimTransport } from '../provider-simulator/src/settlement-client.ts';
import { actorFor } from '../../packages/backend-kit/src/context.ts';
const fp=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
function fixture(t:any,paths:{payment?:string;source?:string}={}){
  const payment=new AccountDatabase(paths.payment||':memory:'),source=new AccountDatabase(paths.source||':memory:');t.after(()=>{payment.close();source.close();});
  const actor=actorFor({sub:'claims-owner'});for(const db of [payment,source])db.accounts(actor.sub);
  const gateway=new ProviderEngine('payments',payment),provider=new ProviderEngine('dewa',source);gateway.seed(actor);provider.seed(actor);
  const bill=source.get(actor.accountId,'bill'),charge=payment.transaction(()=>gateway.execute(actor,'POST','/charges',{amountMinor:42040,merchant:'dewa',reference:`bill:${bill.billId}`,source:'wallet'})).data.charge;
  const transport:ClaimTransport={call:async(account,id,action,body:any)=>action==='claim'?gateway.claims!.claim(account,id,'dewa',body):action==='ack'?gateway.claims!.acknowledge(account,id,'dewa',body):gateway.claims!.release(account,id,'dewa',body)};
  const coordinator=new ProviderSettlements(source,'dewa',transport);
  const apply=(proof:any)=>provider.execute(actor,'POST',`/bills/${bill.billId}/payments`,{paymentId:charge.id},proof);
  const refund=()=>payment.transaction(()=>gateway.execute(actor,'POST',`/charges/${charge.id}/refunds`,{reason:'claim test'}));
  return {payment,source,actor,gateway,provider,bill,charge,transport,coordinator,apply,refund};
}
const code=(expected:string)=>(e:any)=>e.code===expected;

test('a stale captured GET cannot settle after refund; gateway claim checks current state under the writer transaction',async t=>{
  const f=fixture(t),stale=structuredClone(f.charge);f.refund();
  await assert.rejects(f.coordinator.execute(f.actor,'request',fp('request'),stale,f.apply),code('PAYMENT_UNAVAILABLE'));
  assert.equal(f.source.get(f.actor.accountId,'bill').status,'UNPAID');assert.equal(f.gateway.ledger!.summary(f.actor.accountId).balanceMinor,150000);
});

test('admitted claim blocks concurrent refund; application and acknowledgement persist exactly once',async t=>{
  const f=fixture(t);let applied=0;
  const transport:ClaimTransport={call:async(account,id,action,body)=>{const result=await f.transport.call(account,id,action,body);if(action==='claim')assert.throws(f.refund,code('SETTLEMENT_IN_USE'));return result;}};
  const source=new ProviderSettlements(f.source,'dewa',transport),request=fp('owned-bill');
  const result=await source.execute(f.actor,'request',request,f.charge,proof=>{applied++;return f.apply(proof);});
  assert.equal(result.status,200);assert.equal(f.gateway.claims!.get(f.actor.accountId,f.charge.id)!.state,'APPLIED');
  assert.deepEqual(await source.execute(f.actor,'request',request,f.charge,f.apply),result);assert.equal(applied,1);
  await assert.rejects(source.execute(f.actor,'another-key',request,f.charge,f.apply),code('PAYMENT_ALREADY_USED'));
  assert.throws(f.refund,code('SETTLEMENT_IN_USE'));assert.equal(f.gateway.ledger!.summary(f.actor.accountId).balanceMinor,107960);
});

test('lost claim response retains the original pending attempt and blocks refund until exact retry resolves it',async t=>{
  const f=fixture(t);let lose=true;
  const source=new ProviderSettlements(f.source,'dewa',{call:async(...args)=>{const result=await f.transport.call(...args);if(args[2]==='claim'&&lose){lose=false;throw new SettlementError(503,'SETTLEMENT_OUTCOME_UNKNOWN','Lost after commit');}return result;}});
  await assert.rejects(source.execute(f.actor,'request',fp('pending'),f.charge,f.apply),code('SETTLEMENT_OUTCOME_UNKNOWN'));
  assert.equal(f.gateway.claims!.get(f.actor.accountId,f.charge.id)!.state,'CLAIMED');assert.equal(f.source.get(f.actor.accountId,'bill').status,'UNPAID');assert.throws(f.refund,code('SETTLEMENT_IN_USE'));
  const before=await source.inspect(f.actor,f.charge.id);assert.equal(before.state,'PENDING');
  assert.equal((await source.execute(f.actor,'request',fp('pending'),f.charge,f.apply)).status,200);assert.equal((await source.inspect(f.actor,f.charge.id)).attemptId,before.attemptId);
});

test('lost acknowledgement and reopen preserve a paid obligation with refund blocked; current status retries ACK',async t=>{
  const dir=mkdtempSync(join(tmpdir(),'cityside-claim-ack-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
  const f=fixture(t,{source:join(dir,'dewa.sqlite')});let lose=true;
  const transport:ClaimTransport={call:async(...args)=>{if(args[2]==='ack'&&lose)throw new SettlementError(503,'SETTLEMENT_OUTCOME_UNKNOWN','ACK unavailable');return f.transport.call(...args);}};
  const source=new ProviderSettlements(f.source,'dewa',transport);await source.execute(f.actor,'request',fp('ack'),f.charge,f.apply);
  assert.equal(f.source.get(f.actor.accountId,'bill').status,'PAID');assert.equal(f.gateway.claims!.get(f.actor.accountId,f.charge.id)!.state,'CLAIMED');assert.throws(f.refund,code('SETTLEMENT_IN_USE'));
  const reopened=new AccountDatabase(join(dir,'dewa.sqlite'));t.after(()=>reopened.close());lose=false;
  const recovered=new ProviderSettlements(reopened,'dewa',transport),status=await recovered.inspect(f.actor,f.charge.id);
  assert.equal(status.gatewayConfirmed,true);assert.equal(f.gateway.claims!.get(f.actor.accountId,f.charge.id)!.state,'APPLIED');assert.throws(f.refund,code('SETTLEMENT_IN_USE'));
});

test('definitive provider rejection fences non-application before release; a refunded capture cannot later apply',async t=>{
  const f=fixture(t);let lateEffects=0;
  const result=await f.coordinator.execute(f.actor,'request',fp('reject'),f.charge,()=>{throw new ApiError(409,'PAYABLE_CHANGED','Changed');});
  assert.equal(result.status,409);assert.equal(f.gateway.claims!.get(f.actor.accountId,f.charge.id)!.state,'RELEASED');f.refund();
  const replay=await f.coordinator.execute(f.actor,'retry',fp('reject'),f.charge,()=>{lateEffects++;return {status:200,data:{success:true}};});
  assert.deepEqual(replay,result);assert.equal(lateEffects,0);assert.equal(f.source.get(f.actor.accountId,'bill').status,'UNPAID');assert.equal(f.gateway.ledger!.summary(f.actor.accountId).balanceMinor,150000);
});

test('release-versus-late-application across two source connections cannot produce both paid and refunded',async t=>{
  const dir=mkdtempSync(join(tmpdir(),'cityside-claim-race-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));const path=join(dir,'dewa.sqlite'),f=fixture(t,{source:path});
  let resume:()=>void=()=>{},admitted:()=>void=()=>{};const reached=new Promise<void>(resolve=>{admitted=resolve;});const gate=new Promise<void>(resolve=>{resume=resolve;});let first=true;
  const transport:ClaimTransport={call:async(...args)=>{const result=await f.transport.call(...args);if(args[2]==='claim'&&first){first=false;admitted();await gate;}return result;}};
  const slow=new ProviderSettlements(f.source,'dewa',transport);let effects=0;
  const late=slow.execute(f.actor,'slow',fp('same-attempt'),f.charge,proof=>{effects++;return f.apply(proof);});await reached;
  const second=new AccountDatabase(path);t.after(()=>second.close());const reject=new ProviderSettlements(second,'dewa',f.transport);
  const rejected=await reject.execute(f.actor,'fast',fp('same-attempt'),f.charge,()=>{throw new ApiError(409,'PAYABLE_CHANGED','Withdrawn');});assert.equal(rejected.status,409);f.refund();resume();
  assert.equal((await late).status,409);assert.equal(effects,0);assert.equal(f.source.get(f.actor.accountId,'bill').status,'UNPAID');assert.equal(f.gateway.ledger!.summary(f.actor.accountId).balanceMinor,150000);
});

test('unknown source exception rolls back local application and retains a conservative admitted claim',async t=>{
  const f=fixture(t);
  await assert.rejects(f.coordinator.execute(f.actor,'request',fp('unknown'),f.charge,proof=>{f.apply(proof);throw new Error('simulated crash before commit');}),/simulated crash/);
  assert.equal(f.source.get(f.actor.accountId,'bill').status,'UNPAID');assert.equal(f.source.get(f.actor.accountId,'used-payment',f.charge.id),undefined);assert.equal(f.gateway.claims!.get(f.actor.accountId,f.charge.id)!.state,'CLAIMED');assert.throws(f.refund,code('SETTLEMENT_IN_USE'));
  assert.equal((await f.coordinator.execute(f.actor,'request',fp('unknown'),f.charge,f.apply)).status,200);
});

test('gateway denies another provider, substituted attempts/terms/receipts, applied release and post-release acknowledgement',t=>{
  const f=fixture(t),claims=f.gateway.claims!,body={attemptId:'owned-attempt',reference:f.charge.reference,amountMinor:42040};
  assert.throws(()=>claims.claim(f.actor.accountId,f.charge.id,'du',body),code('CLAIM_PROVIDER_FORBIDDEN'));
  assert.throws(()=>claims.claim(f.actor.accountId,f.charge.id,'dewa',{...body,amountMinor:1}),code('CLAIM_TERMS_CHANGED'));
  const c=claims.claim(f.actor.accountId,f.charge.id,'dewa',body).claim;
  assert.throws(()=>claims.claim(f.actor.accountId,f.charge.id,'dewa',{...body,attemptId:'other'}),code('CLAIM_CONFLICT'));
  assert.throws(()=>claims.release(f.actor.accountId,f.charge.id,'dewa',{attemptId:body.attemptId,claimId:'forged',reason:'NOT_APPLIED'}),code('CLAIM_MISMATCH'));
  claims.acknowledge(f.actor.accountId,f.charge.id,'dewa',{attemptId:body.attemptId,claimId:c.claimId,receiptDigest:'a'.repeat(64)});
  assert.equal(claims.claim(f.actor.accountId,f.charge.id,'dewa',body).claim.state,'APPLIED');
  assert.throws(()=>claims.release(f.actor.accountId,f.charge.id,'dewa',{attemptId:body.attemptId,claimId:c.claimId,reason:'NOT_APPLIED'}),code('CLAIM_NOT_RELEASABLE'));
  assert.throws(()=>claims.acknowledge(f.actor.accountId,f.charge.id,'dewa',{attemptId:body.attemptId,claimId:c.claimId,receiptDigest:'b'.repeat(64)}),code('RECEIPT_CONFLICT'));
  assert.equal(claimantFor({azp:'provider-dewa-settlement',realm_access:{roles:['payment-settlement:dewa']}}),'dewa');assert.equal(claimantFor({azp:'provider-du-settlement',realm_access:{roles:['payment-settlement:dewa']}}),undefined);assert.equal(claimantFor({azp:'provider-settlements',realm_access:{roles:['provider:payments:read']}}),undefined);
});

test('legacy captures gain conservative unknown claims and backup without altering financial resources; old paid effects reconcile as applied',async t=>{
  const dir=mkdtempSync(join(tmpdir(),'cityside-claim-migration-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));const path=join(dir,'payments.sqlite'),db=new AccountDatabase(path);t.after(()=>db.close());
  const actor=actorFor({sub:'legacy-claim'});db.accounts(actor.sub);db.put(actor.accountId,'wallet',{balanceMinor:150000,currency:'AED'});const ledger=new PaymentLedger(db);ledger.record(actor.accountId,'PAYMENT','legacy-capture',42040,'wallet');
  const charge={id:'legacy-paid',accountId:actor.accountId,amountMinor:42040,merchant:'dewa',reference:'bill:legacy-bill',source:'wallet',status:'CAPTURED',currency:'AED',refunded:false};db.put(actor.accountId,'charge',charge,charge.id);
  const before=fp(db.db.prepare('SELECT * FROM resources ORDER BY account_id,kind,id').all()),claims=new PaymentClaims(db);assert.equal(fp(db.db.prepare('SELECT * FROM resources ORDER BY account_id,kind,id').all()),before);assert.ok(existsSync(path+'.before-settlement-claims-v1.sqlite'));assert.equal(claims.get(actor.accountId,charge.id)!.state,'LEGACY_UNKNOWN');assert.throws(()=>claims.assertRefundable(actor.accountId,charge.id),code('SETTLEMENT_STATUS_UNKNOWN'));
  const other=new AccountDatabase(path);t.after(()=>other.close());assert.equal(new PaymentClaims(other).get(actor.accountId,charge.id)!.claimId,claims.get(actor.accountId,charge.id)!.claimId);
  const source=new AccountDatabase(':memory:');t.after(()=>source.close());source.accounts(actor.sub);source.put(actor.accountId,'used-payment',true,charge.id);
  const transport:ClaimTransport={call:async(account,id,action,body:any)=>action==='claim'?claims.claim(account,id,'dewa',body):action==='ack'?claims.acknowledge(account,id,'dewa',body):claims.release(account,id,'dewa',body)};
  const coordinator=new ProviderSettlements(source,'dewa',transport);assert.equal((await coordinator.inspect(actor,charge.id,charge)).state,'APPLIED');assert.equal(claims.get(actor.accountId,charge.id)!.state,'APPLIED');assert.throws(()=>claims.assertRefundable(actor.accountId,charge.id),code('SETTLEMENT_IN_USE'));assert.equal(ledger.summary(actor.accountId).balanceMinor,107960);
});
