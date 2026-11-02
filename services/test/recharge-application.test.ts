import { removeTemp } from '../../test/support/temp-cleanup.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { integratedRequest } from '../../packages/backend-kit/src/application.ts';
import { ProviderClient,UpstreamError } from '../../packages/backend-kit/src/provider-client.ts';
import { actorFor } from '../../packages/backend-kit/src/context.ts';
import { buildApplicationOpenApi } from '../../packages/backend-kit/src/application-openapi.ts';
import { Ajv } from 'ajv';
test('legacy Salik resume uses its original recharge intent after a lost provider response, without creating another quote or capture',async t=>{
  const dir=await mkdtemp(join(tmpdir(),'cityside-recharge-application-')),previous=process.env.APP_DATA_DIR;process.env.APP_DATA_DIR=dir;t.after(async()=>{if(previous===undefined)delete process.env.APP_DATA_DIR;else process.env.APP_DATA_DIR=previous;removeTemp(dir);});
  const actor=actorFor({sub:'recharge-application-owner'}),p={id:'rta:recharge:existing',obligationId:'rta:recharge:existing',kind:'RECHARGE',provider:'rta',reference:'owned-tag',amountMinor:10000,currency:'AED',revision:'a'.repeat(64),recharge:{kind:'TOLL',targetVersion:1,balanceBeforeMinor:1400}};
  let created=false,state='AWAITING_APPROVAL',quoteCount=0,captures=0,recoveries=0,changedQuote=false,changedDigest=false;const order=()=>({id:'stored-recharge',ownerSub:actor.sub,accountId:actor.accountId,state,version:2,approvalDigest:(changedDigest?'c':'b').repeat(64),quote:{currency:'AED',source:{id:'wallet',kind:'wallet',accountId:actor.accountId,version:1},totalMinor:10000,terms:{feeMinor:changedQuote?1:0},payable:p},fundsCaptured:state==='RECONCILIATION_REQUIRED'||state==='SETTLED',paymentId:captures?'paid-recharge':undefined,receipt:state==='SETTLED'?{receiptNumber:'paid-recharge',obligationId:p.obligationId,currency:'AED',targetReference:p.reference,amountMinor:10000,providerBalanceMinor:11400}:undefined});
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
  assert.equal((await run()).status,502);
  const reopened = await import('../../packages/backend-kit/src/application.ts?reopened-quote-test');
  changedQuote=true;const altered=await reopened.integratedRequest('service-ride',actor,'POST','/mobility/salik/recharge',{}, {amount:100},()=>({status:404,data:{}}));assert.equal(altered.status,503);assert.equal(altered.data.code,'PROVIDER_OUTCOME_UNKNOWN');assert.equal(recoveries,0);
  changedQuote=false;changedDigest=true;const alteredDigest=await reopened.integratedRequest('service-ride',actor,'POST','/mobility/salik/recharge',{}, {amount:100},()=>({status:404,data:{}}));assert.equal(alteredDigest.status,503);assert.equal(alteredDigest.data.code,'PROVIDER_OUTCOME_UNKNOWN');assert.equal(recoveries,0);changedDigest=false;
  changedQuote=false;const resumed=await run();assert.equal(resumed.status,200);assert.equal(resumed.data.transactionId,'paid-recharge');assert.equal(resumed.data.newBalance,114);assert.equal(captures,1);assert.equal(recoveries,1);assert.equal(quoteCount,1);
  const operation=buildApplicationOpenApi().paths['/mobility/salik/recharge'].post as {responses:{'200':{content:{'application/json':{schema:object}}}}};assert.equal(new Ajv({strict:false}).compile(operation.responses['200'].content['application/json'].schema)(resumed.data),true);
  const substituted=await run(200);assert.equal(substituted.status,409);assert.equal(substituted.data.code,'RECHARGE_INTENT_CONFLICT');assert.equal(captures,1);
});
