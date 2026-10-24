import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generateKeyPairSync, sign, randomUUID } from 'node:crypto';
import http from 'node:http';
import { once } from 'node:events';
import SwaggerParser from '@apidevtools/swagger-parser';
import { AccountDatabase } from '../provider-simulator/src/database.ts';
import { ProviderEngine } from '../provider-simulator/src/engine.ts';
import { createProviderServer, callers } from '../provider-simulator/src/index.ts';
import { openApi, providerIds } from '../provider-simulator/src/contracts.ts';
import { actorFor, accountIdFor } from '../../packages/backend-kit/src/context.ts';
import { ClientCredentials } from '../../packages/backend-kit/src/oauth.ts';

function database(t: test.TestContext, path = ':memory:') { const db = new AccountDatabase(path); t.after(() => db.close()); return db; }
function seeded(t: test.TestContext, provider: 'payments'|'dewa'|'rta') {
  const store = database(t), engine = new ProviderEngine(provider, store), actor = actorFor({ sub: 'citizen-alice', name: 'Alice' });
  store.accounts(actor.sub); engine.seed(actor); return { store, engine, actor };
}

test('all seven checked-in OpenAPI 3.1 contracts are valid and match the runtime', async () => {
  for (const provider of providerIds) {
    const document = JSON.parse(readFileSync(new URL(`../provider-simulator/openapi/${provider}.openapi.json`, import.meta.url), 'utf8'));
    assert.deepEqual(document, openApi(provider));
    await SwaggerParser.validate(structuredClone(document));
  }
});

test('provider databases persist independently and scope every wallet by account', t => {
  const folder = mkdtempSync(join(tmpdir(), 'cityside-provider-')); t.after(() => rmSync(folder, { recursive: true, force: true }));
  const path = join(folder, 'payments.sqlite'); let store = new AccountDatabase(path), engine = new ProviderEngine('payments', store);
  const alice = actorFor({ sub: 'alice' }), bob = actorFor({ sub: 'bob' });
  for (const actor of [alice,bob]) { store.accounts(actor.sub); engine.seed(actor); }
  store.transaction(() => engine.execute(alice, 'POST', '/topups', { amountMinor: 5000, source: 'demo_approved' }));
  assert.equal(engine.execute(bob, 'GET', '/wallet', {}).data.balanceMinor, 150000);
  assert.equal(store.owns('bob', alice.accountId), false);
  store.close(); store = new AccountDatabase(path); engine = new ProviderEngine('payments', store);
  assert.equal(engine.execute(alice, 'GET', '/wallet', {}).data.balanceMinor, 155000);
  store.close();
  const otherProvider = database(t, join(folder, 'rta.sqlite')); otherProvider.accounts(alice.sub);
  assert.equal(otherProvider.get(alice.accountId, 'wallet'), undefined);
});

test('payments preserve integer balances, persist declines and prevent double refunds', t => {
  const { engine, store, actor } = seeded(t, 'payments');
  const charge = store.transaction(() => engine.execute(actor, 'POST', '/charges', { amountMinor: 101, merchant: 'dewa', reference: 'bill:123', source: 'wallet' })).data.charge;
  assert.equal(engine.execute(actor, 'GET', '/wallet', {}).data.balanceMinor, 149899);
  assert.equal(store.transaction(() => engine.execute(actor, 'POST', '/charges', { amountMinor: 999999, merchant: 'dewa', reference: 'bill:456', source: 'wallet' })).status, 402);
  assert.equal(engine.execute(actor, 'GET', '/wallet', {}).data.balanceMinor, 149899);
  store.transaction(() => engine.execute(actor, 'POST', `/charges/${charge.id}/refunds`, { reason: 'test' }));
  assert.equal(engine.execute(actor, 'GET', '/wallet', {}).data.balanceMinor, 150000);
  assert.throws(() => store.transaction(() => engine.execute(actor, 'POST', `/charges/${charge.id}/refunds`, { reason: 'again' })), /cannot be refunded/);
});

test('DEWA rejects mismatched captured proofs and settles only its own exact bill', t => {
  const { engine, store, actor } = seeded(t, 'dewa');
  const bill = engine.execute(actor, 'GET', '/bills', {}).data.bills[0];
  const proof = { id: 'pay-1', status: 'CAPTURED', merchant: 'dewa', reference: `bill:${bill.billId}`, amountMinor: 42040, refunded: false };
  assert.throws(() => store.transaction(() => engine.execute(actor, 'POST', `/bills/${bill.billId}/payments`, { paymentId: proof.id }, { ...proof, amountMinor: 1 })), /matching captured payment/);
  assert.equal(engine.execute(actor, 'GET', '/bills', {}).data.bills[0].status, 'UNPAID');
  const paid = store.transaction(() => engine.execute(actor, 'POST', `/bills/${bill.billId}/payments`, { paymentId: proof.id }, proof));
  assert.equal(paid.data.bill.status, 'PAID');
  assert.throws(() => store.transaction(() => engine.execute(actor, 'POST', `/bills/${bill.billId}/payments`, { paymentId: proof.id }, proof)), /already settled/);
});

test('client credential requests coalesce, cache and refresh without end-user secrets', async t => {
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async (_url, options: any) => { calls++; assert.equal(options.body.get('grant_type'), 'client_credentials'); assert.equal(options.body.get('client_id'), 'service-test'); return Response.json({ access_token: `token-${calls}`, expires_in: 300 }); });
  const client = new ClientCredentials('service-test', 'demo-secret');
  const [a,b] = await Promise.all([client.token(), client.token()]); assert.equal(a,b); assert.equal(calls,1);
  assert.equal(await client.token(),a); client.invalidate(); assert.equal(await client.token(),'token-2');
});

test('provider HTTP endpoints verify signed service roles, ownership, schemas and idempotency', async t => {
  const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const jwk: any = publicKey.export({ format: 'jwk' }); jwk.kid = 'provider-test'; jwk.use = 'sig'; jwk.alg = 'RS256';
  const jwks = http.createServer((_req,res) => { res.setHeader('Content-Type','application/json'); res.end(JSON.stringify({keys:[jwk]})); });
  jwks.listen(0,'127.0.0.1'); await once(jwks,'listening'); t.after(() => jwks.close());
  const previous = { KEYCLOAK_ISSUER: process.env.KEYCLOAK_ISSUER, KEYCLOAK_JWKS_URL: process.env.KEYCLOAK_JWKS_URL };
  process.env.KEYCLOAK_ISSUER='http://test-issuer'; process.env.KEYCLOAK_JWKS_URL=`http://127.0.0.1:${(jwks.address() as any).port}`;
  t.after(() => { for (const [key,value] of Object.entries(previous)) { if(value === undefined) delete process.env[key]; else process.env[key]=value; } });
  const mint = (claims: any = {}) => {
    const a=Buffer.from(JSON.stringify({alg:'RS256',kid:jwk.kid})).toString('base64url');
    const b=Buffer.from(JSON.stringify({iss:'http://test-issuer',sub:'machine',typ:'Bearer',aud:'provider-api',azp:'service-wallet',realm_access:{roles:['provider:payments']},exp:Math.floor(Date.now()/1000)+300,...claims})).toString('base64url');
    return `${a}.${b}.${sign('RSA-SHA256',Buffer.from(`${a}.${b}`),privateKey).toString('base64url')}`;
  };
  const { server, store } = createProviderServer('payments', ':memory:'); server.listen(0,'127.0.0.1'); await once(server,'listening'); t.after(() => { server.close(); store.close(); });
  const root=`http://127.0.0.1:${(server.address() as any).port}/v1/accounts/${accountIdFor('alice')}`;
  const request = (path: string, token=mint(), method='GET', body?:any,key=randomUUID()) => fetch(root+path,{method,headers:{Authorization:`Bearer ${token}`,'X-User-Subject':'alice','Content-Type':'application/json','Idempotency-Key':key},...(body?{body:JSON.stringify(body)}:{})});
  assert.equal((await request('/wallet',mint({aud:'agent-core'}))).status,401);
  assert.equal((await request('/wallet',mint({azp:'superapp-shell'}))).status,403);
  assert.equal((await request('/wallet',mint({realm_access:{roles:[]}}))).status,403);
  assert.equal((await request('/topups',mint(),'POST',{amountMinor:-1,source:'demo_approved'})).status,400);
  assert.equal((await request('/payment-orders',mint(),'POST',{provider:'dewa',payableId:'dewa:bill:owned',expectedPayableRevision:'a'.repeat(64),methodId:'wallet',expectedMethodVersion:1})).status,403);
  const body={amountMinor:50,source:'demo_approved'},key=randomUUID();
  const first=await (await request('/topups',mint(),'POST',body,key)).json();
  const second=await (await request('/topups',mint(),'POST',body,key)).json(); assert.deepEqual(first,second);
  assert.equal((await request('/topups',mint(),'POST',{...body,amountMinor:51},key)).status,409);
  const forbidden=await fetch(`http://127.0.0.1:${(server.address() as any).port}/v1/accounts/${accountIdFor('bob')}/wallet`,{headers:{Authorization:`Bearer ${mint()}`,'X-User-Subject':'alice'}}); assert.equal(forbidden.status,403);
  const capture=await (await request('/charges',mint(),'POST',{amountMinor:100,merchant:'dewa',reference:'claim-http-test',source:'wallet'})).json() as any;
  const paymentId=capture.charge.id,claimPath=`/charges/${paymentId}/settlement/claim`,claimBody={attemptId:'http-source-attempt',reference:'claim-http-test',amountMinor:100},claimKey=randomUUID();
  const claimant=mint({azp:'provider-dewa-settlement',realm_access:{roles:['payment-settlement:dewa']}});
  assert.equal((await request(claimPath,mint({azp:'superapp-shell',sub:'alice',realm_access:{roles:['superapp-user']}}),'POST',claimBody)).status,403);
  assert.equal((await request(claimPath,mint({azp:'provider-settlements',realm_access:{roles:['provider:payments:read']}}),'POST',claimBody)).status,403);
  const admittedResponse=await fetch(root+claimPath,{method:'POST',headers:{Authorization:`Bearer ${claimant}`,'Content-Type':'application/json','Idempotency-Key':claimKey},body:JSON.stringify(claimBody)});assert.equal(admittedResponse.status,200);const admitted=await admittedResponse.json() as any;
  const otherClaimant=mint({azp:'provider-du-settlement',realm_access:{roles:['payment-settlement:du']}});
  assert.equal((await request(claimPath,otherClaimant,'POST',claimBody,claimKey)).status,403);
  assert.equal((await request('/wallet',claimant)).status,403);
  assert.equal((await request(`/charges/${paymentId}/refunds`,mint(),'POST',{reason:'race refund'})).status,409);
  assert.equal((await request(claimPath,claimant,'POST',{...claimBody,amountMinor:101},claimKey)).status,409);
  const ack={claimId:admitted.claim.claimId,attemptId:claimBody.attemptId,receiptDigest:'a'.repeat(64)};
  assert.equal((await request(`/charges/${paymentId}/settlement/ack`,claimant,'POST',ack)).status,200);
  const current=await (await request(claimPath,claimant,'POST',claimBody,claimKey)).json() as any;assert.equal(current.claim.state,'APPLIED');
  assert.equal((await request(`/charges/${paymentId}/settlement/release`,claimant,'POST',{claimId:ack.claimId,attemptId:ack.attemptId,reason:'NOT_APPLIED'})).status,409);

});


test('Keycloak provider grants and provider client allowlists agree for every seeded service', () => {
  const realm = JSON.parse(readFileSync(new URL('../keycloak/realm-export.json', import.meta.url), 'utf8'));
  for (const user of realm.users.filter((u: any) => u.serviceAccountClientId)) {
    for (const role of user.realmRoles) {
      if (!role.startsWith('provider:')) continue;
      const provider = role.split(':')[1] as keyof typeof callers;
      assert.ok(callers[provider].includes(user.serviceAccountClientId), `${user.serviceAccountClientId} has ${role} but is absent from the provider allowlist`);
    }
  }
});

test('ride receipts persist the selected driver ETA instead of dropping or hardcoding arrival time', t => {
  const { engine, store, actor } = seeded(t, 'rta');
  const options = engine.execute(actor, 'GET', '/rides/options', {}).data.options;
  for (const driver of options.slice(0, 2)) {
    const booking = store.transaction(() => engine.execute(actor, 'POST', '/rides/bookings', { driverId: driver.id })).data.booking;
    assert.equal(booking.etaMinutes, driver.etaMinutes);
    assert.equal(booking.estimatedArrival, `${driver.etaMinutes} min`);
    assert.equal(engine.execute(actor, 'GET', `/rides/bookings/${booking.bookingId}`, {}).data.booking.etaMinutes, driver.etaMinutes);
  }
});
