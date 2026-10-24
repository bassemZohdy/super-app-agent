import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { generateKeyPairSync, sign } from 'node:crypto';
import { SimulationRuns } from '../provider-simulator/src/simulation-run.ts';
import { AccountDatabase } from '../provider-simulator/src/database.ts';
import { verifyJwt } from '../../packages/backend-kit/src/jwt.ts';
const start=Date.parse('2026-10-24T00:00:00.000Z'),owner='trusted-owner';
function memory(t:test.TestContext){const store=new SimulationRuns(':memory:');t.after(()=>store.close());return store;}

test('preview runs persist deterministic seeded fixtures and an injectable instance clock across reopen',t=>{
  const dir=mkdtempSync(join(tmpdir(),'cityside-scenario-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));const path=join(dir,'preview.sqlite');
  let store=new SimulationRuns(path);const first=store.create(owner,'commute',start,'create_key');const another=store.create(owner,'commute',start,'create_two');assert.deepEqual(first.fixtures,another.fixtures);assert.notEqual(first.id,another.id);
  const clock=store.clock(owner,first.id);assert.equal(clock(),start);store.advance(owner,first.id,1,120,'advance_key');assert.equal(clock(),start+120000);store.close();
  store=new SimulationRuns(path);const restored=store.snapshot(owner,first.id);assert.equal(restored.revision,2);assert.equal(restored.events.length,2);assert.equal(restored.businessAt,new Date(start+120000).toISOString());store.close();
});

test('advance emits ordered preview-only due events once and replays the same request without another effect',t=>{
  const store=memory(t),run=store.create(owner,'bills',start,'create_key');
  const at60=store.advance(owner,run.id,1,60,'advance_one');assert.equal(at60.events.length,1);assert.equal(at60.events[0].kind,'bill-due');
  assert.ok(at60.events.every(e=>e.previewOnly));const replay=store.advance(owner,run.id,1,60,'advance_one');assert.equal(replay.replayed,true);assert.equal(store.snapshot(owner,run.id).revision,2);
  assert.throws(()=>store.advance(owner,run.id,1,61,'advance_one'),/different operation/);
  const at180=store.advance(owner,run.id,2,120,'advance_two');assert.equal(at180.events.length,3);assert.deepEqual(at180.events.slice(0,1),at60.events);
  assert.equal(new Set(at180.events.map(e=>e.id)).size,3);assert.equal(store.advance(owner,run.id,3,86400,'advance_day').events.length,4);
});

test('reset affects only the selected preview run and recreates its same fixtures in a new generation',t=>{
  const store=memory(t),one=store.create(owner,'one',start,'create_one'),two=store.create(owner,'two',start,'create_two');
  store.advance(owner,one.id,1,180,'advance_one');const reset=store.reset(owner,one.id,2,'reset_key');
  assert.equal(reset.generation,2);assert.equal(reset.events.length,0);assert.equal(reset.businessAt,one.businessAt);assert.deepEqual(reset.fixtures,one.fixtures);assert.deepEqual(store.snapshot(owner,two.id),two);
  assert.equal(store.reset(owner,one.id,2,'reset_key').replayed,true);assert.equal(store.snapshot(owner,one.id).generation,2);
  const again=store.advance(owner,one.id,3,180,'advance_two');assert.equal(again.events.length,3);assert.ok(again.events.every(e=>e.id.includes(':2:')));
});

test('owner/version/key/bounds reject cross-run modification and excessive or backward clock changes',t=>{
  const store=memory(t),run=store.create(owner,'scope',start,'create_key');
  assert.throws(()=>store.snapshot('other',run.id),/not found/);assert.throws(()=>store.reset('other',run.id,1,'reset_key'),/not found/);
  assert.throws(()=>store.clock('other',run.id),/not found/);assert.throws(()=>store.advance(owner,run.id,2,60,'advance_key'),/changed/);
  for(const seconds of [-1,0,0.5,Infinity,2678401])assert.throws(()=>store.advance(owner,run.id,1,seconds,'advance_key'),/31 days/);
  assert.throws(()=>store.create(owner,'../../unsafe',start,'create_new'),/bounded seed/);assert.throws(()=>store.create(owner,'seed',NaN,'create_new'),/bounded seed/);
  assert.equal(store.create(owner,'scope',start,'create_key').id,run.id);assert.throws(()=>store.create(owner,'changed',start,'create_key'),/different scenario/);
  assert.deepEqual(store.snapshot(owner,run.id),run);
});

test('two connections observe one committed revision and reject a stale duplicate advance',t=>{
  const dir=mkdtempSync(join(tmpdir(),'cityside-scenario-race-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));const path=join(dir,'preview.sqlite');const first=new SimulationRuns(path),second=new SimulationRuns(path);
  const run=first.create(owner,'race',start,'create_key');first.advance(owner,run.id,1,180,'advance_one');assert.throws(()=>second.advance(owner,run.id,1,180,'advance_two'),/changed/);
  const result=second.snapshot(owner,run.id);assert.equal(result.revision,2);assert.equal(result.events.length,3);second.close();first.close();
});

test('preview reset never edits normal provider resource/idempotency records, even in the same database file',t=>{
  const dir=mkdtempSync(join(tmpdir(),'cityside-scenario-containment-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));const path=join(dir,'shared.sqlite');const provider=new AccountDatabase(path);provider.accounts(owner);const account=provider.accounts(owner)[0].id;provider.put(account,'wallet',{balanceMinor:3456,currency:'AED'});
  provider.db.prepare('INSERT INTO idempotency VALUES(?,?,?,?,?)').run(account,'real-key','fingerprint',200,'{"success":true}');const before=provider.db.prepare('SELECT * FROM resources').all();
  const store=new SimulationRuns(path),run=store.create(owner,'containment',start,'create_key');store.advance(owner,run.id,1,180,'advance_key');store.reset(owner,run.id,2,'reset_key');
  assert.deepEqual(provider.db.prepare('SELECT * FROM resources').all(),before);assert.ok(provider.db.prepare('SELECT key FROM idempotency WHERE key=?').get('real-key'));store.close();provider.close();
});

test('business-clock advances do not expire a real-time JWT or revive an expired one',async t=>{
  const previous={DEMO_AUTH:process.env.DEMO_AUTH,KEYCLOAK_ISSUER:process.env.KEYCLOAK_ISSUER,KEYCLOAK_JWKS_URL:process.env.KEYCLOAK_JWKS_URL,KEYCLOAK_INTROSPECTION_CLIENT_ID:process.env.KEYCLOAK_INTROSPECTION_CLIENT_ID,KEYCLOAK_INTROSPECTION_URL:process.env.KEYCLOAK_INTROSPECTION_URL,KEYCLOAK_INTROSPECTION_CLIENT_SECRET:process.env.KEYCLOAK_INTROSPECTION_CLIENT_SECRET,KEYCLOAK_REQUIRED_SCOPES:process.env.KEYCLOAK_REQUIRED_SCOPES};
  t.after(()=>{for(const [k,v]of Object.entries(previous)){if(v===undefined)delete process.env[k];else process.env[k]=v;}});
  process.env.DEMO_AUTH='false';process.env.KEYCLOAK_ISSUER='http://scenario-identity.invalid';process.env.KEYCLOAK_JWKS_URL='http://scenario-identity.invalid/keys';delete process.env.KEYCLOAK_INTROSPECTION_CLIENT_ID;delete process.env.KEYCLOAK_INTROSPECTION_URL;delete process.env.KEYCLOAK_INTROSPECTION_CLIENT_SECRET;process.env.KEYCLOAK_REQUIRED_SCOPES='';
  const pair=generateKeyPairSync('rsa',{modulusLength:2048}),jwk={...pair.publicKey.export({format:'jwk'}),kid:'scenario-key',alg:'RS256',use:'sig'};
  t.mock.method(globalThis,'fetch',async()=>new Response(JSON.stringify({keys:[jwk]})));
  const now=Math.floor(Date.now()/1000),header=Buffer.from(JSON.stringify({alg:'RS256',kid:'scenario-key'})).toString('base64url');
  const jwt=(exp:number)=>{const payload=Buffer.from(JSON.stringify({iss:process.env.KEYCLOAK_ISSUER,sub:'owner',aud:'agent-core',azp:'superapp-shell',typ:'Bearer',iat:now-20,exp})).toString('base64url');return `Bearer ${header}.${payload}.${sign('RSA-SHA256',Buffer.from(`${header}.${payload}`),pair.privateKey).toString('base64url')}`;};
  const store=memory(t),run=store.create(owner,'security',start,'create_key');store.advance(owner,run.id,1,31*86400,'advance_key');
  assert.equal((await verifyJwt(jwt(now+300),'agent-core')).sub,'owner');await assert.rejects(verifyJwt(jwt(now-60),'agent-core'));
});
