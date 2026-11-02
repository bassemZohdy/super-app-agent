import { removeTemp } from '../../test/support/temp-cleanup.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { integratedRequest } from '../../packages/backend-kit/src/application.ts';
import { ProviderClient, UpstreamError } from '../../packages/backend-kit/src/provider-client.ts';
import { actorFor, assetsFor } from '../../packages/backend-kit/src/context.ts';
import { validateRequest } from '../../packages/protocol-core/src/request-validation.ts';
import { executeWalletRequest } from '../service-wallet/src/index.ts';

test('manual grouped checkout plans only the explicitly reviewed bills and fines', async t => {
  const dir=await mkdtemp(join(tmpdir(),'group-selected-')),previous=process.env.APP_DATA_DIR; process.env.APP_DATA_DIR=dir;
  t.after(()=>{if(previous===undefined)delete process.env.APP_DATA_DIR;else process.env.APP_DATA_DIR=previous;removeTemp(dir);});
  const revision='a'.repeat(64), bill=(id:string)=>({id,provider:'dewa',kind:'BILL',status:'UNPAID',currency:'AED',reference:'premise',revision,amountMinor:2000}), fine=(id:string)=>({id,obligationId:id,provider:'police',kind:'FINE',status:'UNPAID',currency:'AED',reference:'plate',revision,amountMinor:3000});
  const bills=[bill('bill-one'),bill('bill-two')],fines=[fine('fine-one'),fine('fine-two')];
  const selectedFine={id:'police:selection:one',obligationId:'selection-one',items:[{obligationId:'fine-two'}],provider:'police',kind:'FINE_SET',status:'UNPAID',currency:'AED',reference:'plate',revision,amountMinor:3000};
  const recharge={id:'rta:recharge:one',provider:'rta',kind:'RECHARGE',status:'UNPAID',currency:'AED',reference:'tag',revision,amountMinor:10000,recharge:{kind:'TOLL',targetVersion:1,balanceBeforeMinor:0}};
  let fineSelection:string[]=[],groupItems:string[]=[],quoteCalls=0,groupCalls=0;
  t.mock.method(ProviderClient.prototype,'call',async(provider,_actor,_method,path,body)=>{
    const asset=assetsFor(_actor.accountId), plate=asset.plate, scopedBills=bills.map(b=>({...b,reference:asset.utilityAccount})), scopedFines=fines.map(f=>({...f,reference:plate})), scopedSelection={...selectedFine,reference:plate};
    if(path==='/payables')return{payables:provider==='dewa'?scopedBills:scopedFines};
    if(path==='/fine-selections'){fineSelection=body.items.map((i:{payableId:string})=>i.payableId);return{payable:scopedSelection};}
    if(path.startsWith('/recharge-intents/'))return{payable:recharge};
    if(path.startsWith('/payables/')){const id=decodeURIComponent(path.slice('/payables/'.length));return{payable:[...scopedBills,...scopedFines,scopedSelection,recharge].find(p=>p.id===id)};}
    if(path==='/billing-accounts')return{billingAccounts:[{provider:'dewa',reference:asset.utilityAccount,status:'ACTIVE'},{provider:'police',reference:plate,status:'ACTIVE'},{provider:'rta',reference:'tag',status:'ACTIVE'}]};
    if(path==='/checkout-groups'){groupCalls++;groupItems=body.items.map((i:{payableId:string})=>i.payableId);throw new UpstreamError(503,'PROVIDER_OUTCOME_UNKNOWN','Stopped before payment.');}
    if(path==='/recharge-quotes'){quoteCalls++;throw new Error('Unexpected quote');}
    throw new Error('Unexpected operation');
  });
  const items=[{agency:'reviewed',purpose:'total',amount:150}],selection=[{provider:'dewa',payableId:'bill-one',expectedRevision:revision},{provider:'police',payableId:'fine-two',expectedRevision:revision}],legacy=()=>({status:404,data:{}});
  const run=(sub:string,expectedPayables?:unknown,amount=150)=>integratedRequest('service-wallet',actorFor({sub}),'POST','/pay/unified',{}, {items:[{...items[0],amount}],...(expectedPayables===undefined?{}:{expectedPayables})},legacy);
  const offlineIdentity = await integratedRequest('service-wallet', actorFor({ sub: 'offline-identity-denied' }), 'POST', '/pay/unified', {}, { items, expectedPayables: selection, operationId: 'CIVIC-test' }, legacy);
  assert.equal(offlineIdentity.status, 400); assert.equal(groupCalls, 0);
  assert.equal((await integratedRequest('service-wallet', actorFor({ sub: 'offline-lookup-denied' }), 'GET', '/wallet/unified-operations/CIVIC-test', {}, {}, legacy)).status, 404);
  assert.equal(validateRequest('service-wallet','POST','/pay/unified',{}, {items,expectedPayables:selection}),undefined);
  const missing=await run('missing');assert.equal(missing.status,400);assert.equal(groupCalls,0);
  const duplicate=await run('duplicate',[selection[0],selection[0]]);assert.equal(duplicate.status,400);assert.equal(groupCalls,0);
  const stale=await run('stale',[{...selection[0],expectedRevision:'b'.repeat(64)}]);assert.equal(stale.status,409);assert.equal(groupCalls,0);
  const foreign=await run('foreign',[{...selection[0],payableId:'unowned'}]);assert.equal(foreign.status,409);assert.equal(groupCalls,0);
  await run('selected',selection);assert.deepEqual(fineSelection,['fine-two']);assert.deepEqual(groupItems,['bill-one','police:selection:one','rta:recharge:one']);assert.equal(groupCalls,1);assert.equal(quoteCalls,0);
  fineSelection=[];await run('recharge-only',[],100);assert.deepEqual(fineSelection,[]);assert.deepEqual(groupItems,['rta:recharge:one']);assert.equal(groupCalls,2);
});

test('offline grouped fixture does not pretend to honor selected payables',()=>{
  const before=executeWalletRequest('GET','/wallet/balance').data.balance;
  const result=executeWalletRequest('POST','/pay/unified',{}, {items:[{agency:'RTA',purpose:'Review',amount:1}],expectedPayables:[]});
  assert.equal(result.status,400);assert.equal(executeWalletRequest('GET','/wallet/balance').data.balance,before);
});
