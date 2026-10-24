import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp,rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { integratedRequest } from '../../packages/backend-kit/src/application.ts';
import { ProviderClient,UpstreamError } from '../../packages/backend-kit/src/provider-client.ts';
import { actorFor } from '../../packages/backend-kit/src/context.ts';
test('legacy Salik resume uses its original recharge intent after a lost provider response, without creating another quote or capture',async t=>{
  const dir=await mkdtemp(join(tmpdir(),'cityside-recharge-application-')),previous=process.env.APP_DATA_DIR;process.env.APP_DATA_DIR=dir;t.after(async()=>{if(previous===undefined)delete process.env.APP_DATA_DIR;else process.env.APP_DATA_DIR=previous;await rm(dir,{recursive:true,force:true});});
  const actor=actorFor({sub:'recharge-application-owner'}),p={id:'rta:recharge:existing',obligationId:'rta:recharge:existing',kind:'RECHARGE',provider:'rta',reference:'owned-tag',amountMinor:10000,revision:'a'.repeat(64),recharge:{targetVersion:1,balanceBeforeMinor:1400}};
  let created=false,state='AWAITING_APPROVAL',quoteCount=0,captures=0,recoveries=0;const order=()=>({id:'stored-recharge',state,version:2,approvalDigest:'b'.repeat(64),quote:{totalMinor:10000},fundsCaptured:state==='RECONCILIATION_REQUIRED'||state==='SETTLED',paymentId:captures?'paid-recharge':undefined,receipt:state==='SETTLED'?{receiptNumber:'paid-recharge',amountMinor:10000,providerBalanceMinor:11400}:undefined});
  t.mock.method(ProviderClient.prototype,'call',async(provider,_actor,method,path,body)=>{
    if(provider==='rta'&&path==='/salik')return{tagNumber:'owned-tag',balance:created?114:14};
    if(provider==='rta'&&path.startsWith('/recharge-intents/')){if(!created)throw new UpstreamError(404,'RECHARGE_INTENT_NOT_FOUND','Not started.');return{payable:p};}
    if(provider==='rta'&&path==='/recharge-targets'){assert.equal(created,false,'Resume must not replace the original target version.');return{targets:[{reference:'owned-tag',version:1}]};}
    if(provider==='rta'&&method==='POST'&&path==='/recharge-quotes'){quoteCount++;assert.equal(body.expectedTargetVersion,1);created=true;return{payable:p};}
    if(provider==='payments'&&path==='/billing-accounts')return{billingAccounts:[{status:'ACTIVE',provider:'rta',reference:'owned-tag'}]};
    if(provider==='payments'&&path==='/payment-orders')return{order:order()};
    if(provider==='payments'&&path==='/payment-orders/stored-recharge')return{order:order()};
    if(path.endsWith('/approve')){state='AUTHORIZED';return{order:order()};}
    if(path.endsWith('/execute')){captures++;state='RECONCILIATION_REQUIRED';return{order:order()};}
    if(path.endsWith('/recover')){recoveries++;state='SETTLED';return{order:order()};}
    throw new Error(`Unexpected recharge mapping: ${provider} ${path}`);
  });
  const run=(amount=100)=>integratedRequest('service-ride',actor,'POST','/mobility/salik/recharge',{}, {amount},()=>({status:404,data:{}}));
  assert.equal((await run()).status,502);const resumed=await run();assert.equal(resumed.status,200);assert.equal(resumed.data.transactionId,'paid-recharge');assert.equal(resumed.data.newBalance,114);assert.equal(captures,1);assert.equal(recoveries,1);assert.equal(quoteCount,1);
  const substituted=await run(200);assert.equal(substituted.status,409);assert.equal(substituted.data.code,'RECHARGE_INTENT_CONFLICT');assert.equal(captures,1);
});
