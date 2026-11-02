import { removeTemp } from '../../test/support/temp-cleanup.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { integratedRequest } from '../../packages/backend-kit/src/application.ts';
import { ProviderClient, UpstreamError } from '../../packages/backend-kit/src/provider-client.ts';
import { actorFor } from '../../packages/backend-kit/src/context.ts';
import { validateRequest } from '../../packages/protocol-core/src/request-validation.ts';
import { executeWalletRequest } from '../service-wallet/src/index.ts';

test('unified checkout requires an unambiguous or explicitly selected recharge target', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'group-target-')), previous = process.env.APP_DATA_DIR;
  process.env.APP_DATA_DIR = dir;
  t.after(() => { if (previous === undefined) delete process.env.APP_DATA_DIR; else process.env.APP_DATA_DIR = previous; removeTemp(dir); });
  const targets = [{ reference:'tag-one', version:1 }, { reference:'tag-two', version:2 }];
  let mode='multiple', quoteCalls=0, groupCalls=0, quoted='';
  const p = (reference:string,version:number) => ({ id:'rta:recharge:one', provider:'rta', kind:'RECHARGE', obligationId:'rta:recharge:one', reference, revision:'a'.repeat(64), status:'UNPAID', amountMinor:10000, currency:'AED', recharge:{kind:'TOLL',targetVersion:version,balanceBeforeMinor:0} });
  t.mock.method(ProviderClient.prototype, 'call', async (_provider,_actor,_method,route,body) => {
    if(route==='/payables')return{payables:[]};
    if(route.startsWith('/recharge-intents/')) { if(mode==='existing-wrong')return{payable:p('tag-one',1)}; throw new UpstreamError(404,'NOT_FOUND','No quote'); }
    if(route==='/recharge-targets')return{targets:mode==='single'?[targets[0]]:mode==='duplicate'?[targets[1],targets[1]]:targets};
    if(route==='/recharge-quotes'){quoteCalls++;quoted=body.targetReference;return{payable:mode==='quote-wrong'?p('tag-one',1):p(body.targetReference,body.expectedTargetVersion)};}
    if(route==='/billing-accounts')return{billingAccounts:[{provider:'rta',reference:'tag-two',status:'ACTIVE'},{provider:'rta',reference:'tag-one',status:'ACTIVE'}]};
    if(route.startsWith('/payables/'))return{payable:p(quoted,quoted==='tag-two'?2:1)};
    if(route==='/checkout-groups'){groupCalls++;throw new UpstreamError(503,'PROVIDER_OUTCOME_UNKNOWN','Stopped before payment.');}
    throw new Error('Unexpected operation');
  });
  const items=[{agency:'RTA',purpose:'Review',amount:100}], legacy=()=>({status:404,data:{}});
  const run=(subject:string,extra:Record<string,unknown>={})=>integratedRequest('service-wallet',actorFor({sub:subject}),'POST','/pay/unified',{}, {items,expectedPayables:[],...extra},legacy);
  assert.equal(validateRequest('service-wallet','POST','/pay/unified',{}, {items,targetReference:'tag-two',expectedTargetVersion:2}),undefined);
  assert.ok(validateRequest('service-wallet','POST','/pay/unified',{}, {items,targetReference:'tag-two'}));
  const ambiguous=await run('ambiguous');assert.equal(ambiguous.status,409);assert.equal(ambiguous.data.code,'RECHARGE_TARGET_REQUIRED');assert.equal(quoteCalls,0);
  const missing=await run('missing',{targetReference:'missing',expectedTargetVersion:2});assert.equal(missing.status,404);assert.equal(quoteCalls,0);
  const stale=await run('stale',{targetReference:'tag-two',expectedTargetVersion:1});assert.equal(stale.status,409);assert.equal(quoteCalls,0);
  mode='duplicate';const duplicate=await run('duplicate',{targetReference:'tag-two',expectedTargetVersion:2});assert.equal(duplicate.status,503);assert.equal(quoteCalls,0);
  mode='quote-wrong';const wrong=await run('wrong',{targetReference:'tag-two',expectedTargetVersion:2});assert.equal(wrong.status,503);assert.equal(groupCalls,0);
  mode='existing-wrong';const existing=await run('existing',{targetReference:'tag-two',expectedTargetVersion:2});assert.equal(existing.status,409);assert.equal(groupCalls,0);
  mode='multiple';await run('selected',{targetReference:'tag-two',expectedTargetVersion:2});assert.equal(quoted,'tag-two');assert.equal(groupCalls,1);
  mode='single';await run('single');assert.equal(quoted,'tag-one');assert.equal(groupCalls,2);
});

test('offline fixture rejects target-specific checkout without changing the wallet', () => {
  const before=executeWalletRequest('GET','/wallet/balance').data.balance;
  for(const path of ['/pay/unified','/pay/multi-agency']) {
    const result=executeWalletRequest('POST',path,{}, {items:[{agency:'RTA',purpose:'Review',amount:1}],targetReference:'tag-two',expectedTargetVersion:2});
    assert.equal(result.status,400); assert.equal(executeWalletRequest('GET','/wallet/balance').data.balance,before);
  }
});
