import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { RedisSessionStore } from '../../services/agent-core/src/session-store.ts';
import { accountIdFor } from '../../packages/backend-kit/src/context.ts';
import { createA2UIMessage } from '../../packages/protocol-core/src/index.ts';

test('Redis persists empty arrays, isolates owners/accounts, fences locks and replays across clients', async t => {
  const prefix=`cityside-test:${randomUUID()}:`, url=process.env.TEST_REDIS_URL || 'redis://127.0.0.1:6379';
  const a=new RedisSessionStore(url,60,prefix), b=new RedisSessionStore(url,60,prefix);
  t.after(async()=>{ await a.connect(); const keys=await a.client.keys(`${prefix}*`); if(keys.length) await a.client.del(keys); await a.close(); await b.close(); });
  const sid=`redis_${randomUUID()}`, account=accountIdFor('alice');
  const state=await a.claim(sid,'alice',account);
  await assert.rejects(()=>b.claim(sid,'bob',accountIdFor('bob')),/different user/);
  await assert.rejects(()=>b.claim(sid,'alice',accountIdFor('alice','household')),/switching accounts/);
  const lock=await a.acquire(sid); await assert.rejects(()=>b.acquire(sid),/already running/);
  state.currentSurface={version:'1.0.0',sessionId:sid,timestamp:Date.now(),revision:randomUUID(),view:{type:'SurfaceCard',id:'root',children:[{type:'DataTable',id:'table',properties:{columns:[],rows:[]}}]}};
  await lock.save(state); await lock.release();
  const restored=await b.read(sid,'alice'); assert.deepEqual(restored.state.messages,[]); assert.deepEqual(restored.state.currentSurface?.view.children?.[0].properties?.rows,[]);
  const stale=await a.acquire(sid); await a.client.del(`${prefix}session:${sid}:lock`); const current=await b.acquire(sid);
  await assert.rejects(()=>stale.save(state),/could not be saved/); await stale.release(); await current.assert(); await current.release();
  let received!:()=>void; const eventArrived=new Promise<void>(resolve=>{received=resolve;});
  const off=await b.subscribe(sid,()=>received());
  const one=createA2UIMessage('A2UI_STREAM_DELTA',sid,{text:'one'}),two=createA2UIMessage('A2UI_STREAM_DELTA',sid,{text:'two'});
  await a.publish(sid,one); await a.publish(sid,two); await eventArrived;
  assert.deepEqual((await b.after(sid,one.id))?.map(e=>e.id),[two.id]); await off();
  assert.equal((await b.list('alice')).length,1);
  await b.remove(sid,'alice'); await assert.rejects(()=>a.read(sid,'alice'),/expired/);
});


test('civic coordination survives client restart and only its owner can release it', async t => {
  const prefix = `cityside-civic-test:${randomUUID()}:`, url = process.env.TEST_REDIS_URL || 'redis://127.0.0.1:6379';
  const first = new RedisSessionStore(url, 60, prefix), second = new RedisSessionStore(url, 60, prefix);
  t.after(async () => { await second.connect(); const keys = await second.client.keys(`${prefix}*`); if (keys.length) await second.client.del(keys); await first.close(); await second.close(); });
  const owner = { subject: 'owner', accountId: 'account', sessionId: 'test_civic_session', action: 'confirm_smartcity_checkout' as const };
  const held = await first.acquireCivicFence(owner);
  assert.equal(await first.client.ttl(`${prefix}offline-civic-fence`), -1, 'uncertain effects must never unlock on a timer');
  await assert.rejects(() => second.acquireCivicFence(owner), /civic payment/i);
  await first.close();
  await assert.rejects(() => second.acquireCivicFence(owner), /civic payment/i, 'a restart retains the fence');
  await held.release();
  const current = await second.acquireCivicFence(owner);
  await held.release();
  await assert.rejects(() => first.acquireCivicFence(owner), /civic payment/i, 'an old token cannot release a newer fence');
  await current.release();
  const fresh = await first.acquireCivicFence(owner);
  await fresh.release();
});


test('civic fence inspection exposes journey details only to its owner and account', async t => {
  const prefix = `cityside-civic-owner-test:${randomUUID()}:`, url = process.env.TEST_REDIS_URL || 'redis://127.0.0.1:6379';
  const store = new RedisSessionStore(url, 60, prefix);
  t.after(async () => { await store.connect(); const key = `${prefix}offline-civic-fence`; await store.client.del(key); await store.close(); });
  const owner = { subject: 'alice', accountId: accountIdFor('alice'), sessionId: 'civic_owner_session', action: 'confirm_smartcity_checkout' as const };
  assert.deepEqual(await store.inspectCivicFence(owner.subject, owner.accountId), { status: 'CLEAR' });
  const fence = await store.acquireCivicFence(owner);
  assert.deepEqual(await store.inspectCivicFence(owner.subject, owner.accountId), { status: 'BLOCKED', sessionId: owner.sessionId, action: owner.action });
  assert.deepEqual(await store.inspectCivicFence('bob', owner.accountId), { status: 'BLOCKED' });
  assert.deepEqual(await store.inspectCivicFence(owner.subject, accountIdFor('alice', 'household')), { status: 'BLOCKED' });
  await fence.release();
  await store.client.set(`${prefix}offline-civic-fence`, 'legacy-unattributed-token');
  assert.deepEqual(await store.inspectCivicFence(owner.subject, owner.accountId), { status: 'BLOCKED' });
});
