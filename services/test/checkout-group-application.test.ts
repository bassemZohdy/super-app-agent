import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp,rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { integratedRequest } from '../../packages/backend-kit/src/application.ts';
import { ProviderClient,UpstreamError } from '../../packages/backend-kit/src/provider-client.ts';
import { actorFor } from '../../packages/backend-kit/src/context.ts';
test('legacy unified checkout persists one group plan and resumes original children after lost response, with one chosen source',async t=>{
  const dir=await mkdtemp(join(tmpdir(),'group-application-')),previous=process.env.APP_DATA_DIR;process.env.APP_DATA_DIR=dir;t.after(async()=>{if(previous===undefined)delete process.env.APP_DATA_DIR;else process.env.APP_DATA_DIR=previous;await rm(dir,{recursive:true,force:true});});
  const actor=actorFor({sub:'group-application-owner'}),p={id:'rta:recharge:original',provider:'rta',reference:'tag',revision:'a'.repeat(64)},source={id:'card-owned',version:1};let intent=false,groupCreated=0,runs=0,group:any;
  t.mock.method(ProviderClient.prototype,'call',async(provider,_actor,method,path,body)=>{
    if(path==='/payables')return{payables:[]};
    if(path.startsWith('/recharge-intents/')){if(!intent)throw new UpstreamError(404,'NOT_FOUND','No intent');return{payable:p};}
    if(path==='/recharge-targets')return{targets:[{reference:'tag',version:1}]};
    if(path==='/recharge-quotes'){assert.equal(intent,false);intent=true;return{payable:p};}
    if(path==='/billing-accounts')return{billingAccounts:[{provider:'rta',reference:'tag',status:'ACTIVE'}]};
    if(path===`/payables/${encodeURIComponent(p.id)}`)return{payable:p};
    if(path==='/checkout-groups'){groupCreated++;assert.equal(body.methodId,source.id);assert.equal(body.items[0].payableId,p.id);group={id:'group-original',state:'AWAITING_APPROVAL',version:1,approvalDigest:'b'.repeat(64),totalMinor:10000,orders:[]};return{group};}
    if(path==='/checkout-groups/group-original')return{group};
    if(path.endsWith('/approve')){group={...group,version:2,state:'READY'};return{group};}
    if(path.endsWith('/execute')){runs++;group={...group,state:'COMPLETED',orders:[{id:'child-original',state:'SETTLED',quote:{totalMinor:10000,payable:p},receipt:{receiptNumber:'payment-original'}}]};if(runs===1)throw new UpstreamError(503,'PROVIDER_OUTCOME_UNKNOWN','Lost after group commit');return{group};}
    if(path==='/wallet')return{balance:1500};throw new Error(`Unexpected ${provider} ${method} ${path}`);
  });
  const body={items:[{agency:'demo',purpose:'reviewed',amount:100}],methodId:source.id,expectedMethodVersion:1};
  const run=(input=body)=>integratedRequest('service-wallet',actor,'POST','/pay/unified',{},input,()=>({status:404,data:{}}));
  assert.equal((await run()).status,503);const resumed=await run();assert.equal(resumed.status,200);assert.equal(resumed.data.govTransactionHash,'group-original');assert.equal(resumed.data.steps[0].receipt.receiptNumber,'payment-original');assert.equal(resumed.data.grandTotal,100);assert.equal(groupCreated,1);assert.equal(runs,1);
  assert.equal((await run({...body,methodId:'another-card'})).status,409);assert.equal(groupCreated,1);
  const alias=await integratedRequest('service-wallet',actor,'POST','/pay/multi-agency',{},body,()=>({status:404,data:{}}));assert.equal(alias.status,200);assert.equal(alias.data.govTransactionHash,'group-original');assert.equal(groupCreated,1);
});
