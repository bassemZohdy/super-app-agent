import test from 'node:test';
import assert from 'node:assert/strict';
import { EligibilityClient,EligibilityReadError } from '../../packages/backend-kit/src/eligibility-client.ts';
import { ProviderClient } from '../../packages/backend-kit/src/provider-client.ts';
import { actorFor } from '../../packages/backend-kit/src/context.ts';
const accountId='acct_eligibility_client',snapshot={accountId,ownerSub:'client-owner',ownerEnabled:true,membershipEnabled:true,ownerVersion:1,membershipVersion:1,epoch:'1:1',active:true};
const actor=actorFor({sub:snapshot.ownerSub},accountId,'Bearer signed-owner');
test('current eligibility is never positively cached and rejects revoked, mismatched or stale authority',async t=>{
  const client=new EligibilityClient();t.mock.method(client.credentials,'token',async()=>'workload-token');let current={...snapshot};const calls=t.mock.method(globalThis,'fetch',async()=>new Response(JSON.stringify({success:true,eligibility:current}),{status:200}));
  assert.equal((await client.require(actor,'1:1')).active,true);current={...current,membershipEnabled:false,membershipVersion:2,epoch:'1:2',active:false};await assert.rejects(client.require(actor),e=>e instanceof EligibilityReadError&&e.status===403);
  current={...current,membershipEnabled:true,membershipVersion:3,epoch:'1:3',active:true};await assert.rejects(client.require(actor,'1:1'),e=>e instanceof EligibilityReadError&&e.status===409);await assert.rejects(client.require({...actor,sub:'another-user'}),e=>e instanceof EligibilityReadError&&e.status===403);assert.equal((await client.require(actor,'1:3')).epoch,'1:3');assert.equal(calls.mock.calls.length,5);
});
test('authority outage, malformed authority and workload authentication failure never become an active permission',async t=>{
  const client=new EligibilityClient();t.mock.method(client.credentials,'token',async()=>'workload-token');let status=503,payload:unknown={success:true,eligibility:snapshot};let calls=0;
  t.mock.method(globalThis,'fetch',async()=>{calls++;return new Response(JSON.stringify(payload),{status});});await assert.rejects(client.require(actor),e=>e instanceof EligibilityReadError&&e.status===503);status=403;await assert.rejects(client.require(actor),e=>e instanceof EligibilityReadError&&e.status===503);
  status=200;for(const invalid of [{...snapshot,ownerVersion:0},{...snapshot,active:false},{...snapshot,epoch:'1:4'},{...snapshot,ownerSub:''},{...snapshot,extraAuthority:true}]){payload={success:true,eligibility:invalid};await assert.rejects(client.require(actor));}
  status=401;const invalidate=t.mock.method(client.credentials,'invalidate',()=>{}),before=calls;await assert.rejects(client.require(actor),e=>e instanceof EligibilityReadError&&e.status===503);assert.equal(calls-before,2);assert.equal(invalidate.mock.calls.length,1);
});
test('unknown accounts may bootstrap only through the forwarded interactive account-discovery lane',async t=>{
  const client=new EligibilityClient();t.mock.method(client.credentials,'token',async()=>'workload-token');let exists=false;
  t.mock.method(globalThis,'fetch',async()=>new Response(JSON.stringify({success:true,eligibility:snapshot}),{status:exists?200:404}));const bootstrap=t.mock.method(ProviderClient.prototype,'call',async(provider:string,owner:typeof actor,verb:string,path:string)=>{assert.equal(provider,'payments');assert.equal(owner.authorization,actor.authorization);assert.equal(verb,'GET');assert.equal(path,'/v1/accounts');exists=true;return {success:true};});
  await assert.rejects(client.bootstrap({...actor,authorization:undefined}),e=>e instanceof EligibilityReadError&&e.status===404);assert.equal(bootstrap.mock.calls.length,0);assert.equal((await client.bootstrap(actor)).accountId,accountId);assert.equal(bootstrap.mock.calls.length,1);
});
