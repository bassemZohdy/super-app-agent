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
