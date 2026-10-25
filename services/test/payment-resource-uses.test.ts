import { removeTemp } from '../../test/support/temp-cleanup.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AccountDatabase } from '../provider-simulator/src/database.ts';
import { ProviderEngine } from '../provider-simulator/src/engine.ts';
import { PaymentResourceUses } from '../provider-simulator/src/payment-resource-uses.ts';
import { actorFor } from '../../packages/backend-kit/src/context.ts';
function setup(t:test.TestContext,path=':memory:'){
  const db=new AccountDatabase(path);t.after(()=>db.close());const engine=new ProviderEngine('payments',db),alice=actorFor({sub:'dependent-alice'}),bob=actorFor({sub:'dependent-bob'});
  for(const actor of [alice,bob]){db.accounts(actor.sub);engine.seed(actor);}
  const post=(path:string,body:Record<string,unknown>)=>db.transaction(()=>engine.execute(alice,'POST',path,body)).data;
  const method=post('/payment-methods',{preset:'approved',nickname:'Dependent card'}).method;
  const link=post('/billing-accounts',{provider:'dewa',reference:'owner-biller',nickname:'Home'}).billingAccount;
  return {db,engine,alice,bob,post,method,link,uses:engine.resourceUses!};
}

test('active order/hold/mandate references block removal/archive and return related items',t=>{
  const f=setup(t);
  for(const kind of ['ORDER','HOLD','MANDATE'] as const){
    f.uses.bind(f.alice.accountId,{resourceType:'METHOD',resourceId:f.method.id,resourceVersion:1,dependentKind:kind,dependentId:`dependent-${kind}`});
    f.uses.bind(f.alice.accountId,{resourceType:'BILLER',resourceId:f.link.id,resourceVersion:1,dependentKind:kind,dependentId:`dependent-${kind}`});
  }
  const beforeDefault=f.db.db.prepare('SELECT * FROM payment_resource_uses').all();
  f.post('/payment-methods/default',{methodId:f.method.id,expectedVersion:1});f.post('/payment-methods/default',{methodId:'wallet',expectedVersion:1});assert.deepEqual(f.db.db.prepare('SELECT * FROM payment_resource_uses').all(),beforeDefault);
  assert.equal(f.engine.execute(f.alice,'GET','/payment-methods',{}).data.dependencies.length,3);
  assert.equal(f.engine.execute(f.alice,'GET','/billing-accounts',{}).data.dependencies.length,3);
  assert.throws(()=>f.post('/payment-methods/status',{methodId:f.method.id,expectedVersion:1,status:'REMOVED'}),/active payment/);
  assert.throws(()=>f.post('/billing-accounts/archive',{billingAccountId:f.link.id,expectedVersion:1}),/active payment/);
  f.post('/payment-methods/status',{methodId:f.method.id,expectedVersion:1,status:'DISABLED'});
  assert.equal(f.uses.list(f.alice.accountId,'METHOD',f.method.id).length,3); // disable blocks new use, preserves admitted work
  assert.throws(()=>f.uses.bind(f.alice.accountId,{resourceType:'METHOD',resourceId:f.method.id,resourceVersion:2,dependentKind:'ORDER',dependentId:'new-order'}),/unavailable or changed/);
  for(const kind of ['ORDER','HOLD','MANDATE'] as const){
    f.uses.release(f.alice.accountId,'METHOD',f.method.id,kind,`dependent-${kind}`);f.uses.release(f.alice.accountId,'BILLER',f.link.id,kind,`dependent-${kind}`);
  }
  assert.equal(f.post('/payment-methods/status',{methodId:f.method.id,expectedVersion:2,status:'REMOVED'}).method.status,'REMOVED');
  assert.equal(f.post('/billing-accounts/archive',{billingAccountId:f.link.id,expectedVersion:1}).billingAccount.status,'ARCHIVED');
});

test('dependency binding enforces account/version, idempotency and final release without resurrection',t=>{
  const f=setup(t),binding={resourceType:'METHOD' as const,resourceId:f.method.id,resourceVersion:1,dependentKind:'HOLD' as const,dependentId:'hold-1'};
  f.uses.bind(f.alice.accountId,binding);f.uses.bind(f.alice.accountId,binding);assert.equal(f.uses.list(f.alice.accountId).length,1);
  assert.throws(()=>f.uses.bind(f.bob.accountId,binding),/not found/);assert.equal(f.uses.list(f.bob.accountId).length,0);
  assert.throws(()=>f.uses.bind(f.alice.accountId,{...binding,resourceVersion:2}),/changed/);
  f.uses.release(f.alice.accountId,'METHOD',f.method.id,'HOLD','hold-1');f.uses.release(f.alice.accountId,'METHOD',f.method.id,'HOLD','hold-1');
  assert.throws(()=>f.uses.bind(f.alice.accountId,binding),/cannot be reopened/);assert.equal(f.uses.list(f.alice.accountId).length,0);
});

test('guard state persists and a second connection cannot archive then admit a stale use',t=>{
  const dir=mkdtempSync(join(tmpdir(),'cityside-related-'));t.after(()=>removeTemp(dir));const path=join(dir,'payments.sqlite'),f=setup(t,path);
  f.uses.bind(f.alice.accountId,{resourceType:'BILLER',resourceId:f.link.id,resourceVersion:1,dependentKind:'MANDATE',dependentId:'rule-1'});
  const second=new AccountDatabase(path);t.after(()=>second.close());const uses=new PaymentResourceUses(second);
  assert.equal(uses.list(f.alice.accountId).length,1);assert.throws(()=>uses.assertRemovable(f.alice.accountId,'BILLER',f.link.id),/active payment/);
  uses.release(f.alice.accountId,'BILLER',f.link.id,'MANDATE','rule-1');f.post('/billing-accounts/archive',{billingAccountId:f.link.id,expectedVersion:1});
  assert.throws(()=>uses.bind(f.alice.accountId,{resourceType:'BILLER',resourceId:f.link.id,resourceVersion:1,dependentKind:'ORDER',dependentId:'order-stale'}),/unavailable or changed/);
});
