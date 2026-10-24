/** Run only inside the isolated trusted issuer container; raw tokens/assertions never leave this process. */
import assert from 'node:assert/strict';
import { signedJwt,assertionTimes } from '../services/delegation/src/keys.ts';
import { grantStore,issuerName } from '../services/delegation/src/service.ts';
import { brokerClient,tokenHash,digest } from '../services/delegation/src/policy.ts';
import { accountIdFor } from '../packages/backend-kit/src/context.ts';
assert.equal(process.env.DELEGATION_DB_PATH,'/tmp/automation-security.sqlite','Use only the isolated authority test database');
const endpoint=process.env.KEYCLOAK_TOKEN_URL!,issuer=process.env.KEYCLOAK_ISSUER!;
const login=await fetch(endpoint,{method:'POST',body:new URLSearchParams({grant_type:'password',client_id:'superapp-shell',username:'bassem',password:'demo123'}),signal:AbortSignal.timeout(10000)});assert.equal(login.status,200);const user=(await login.json() as any).access_token as string,owner=JSON.parse(Buffer.from(user.split('.')[1],'base64url').toString()).sub as string;
const accountId=accountIdFor(owner),base=`${process.env.PROVIDER_PAYMENTS_URL}/v1/accounts/${accountId}`;
const mint=async(scope:string)=>{const r=await fetch(endpoint,{method:'POST',body:new URLSearchParams({grant_type:'urn:ietf:params:oauth:grant-type:jwt-bearer',client_id:brokerClient,assertion:signedJwt('issuer',{...assertionTimes(Date.now()+90000),iss:issuerName(),sub:`cityside:${owner}`,aud:issuer,scope}),scope,client_assertion_type:'urn:ietf:params:oauth:client-assertion-type:jwt-bearer',client_assertion:signedJwt('client',{...assertionTimes(Date.now()+60000),iss:brokerClient,sub:brokerClient,aud:issuer})}),signal:AbortSignal.timeout(10000)});assert.equal(r.status,200,'Supported local assertion exchange failed');const data=await r.json() as any;assert.equal(data.refresh_token,undefined);return data.access_token as string;};
const call=(path:string,bearer:string,body?:unknown)=>fetch(`${base}${path}`,{method:body?'POST':'GET',headers:{Authorization:`Bearer ${bearer}`,'Content-Type':'application/json','Idempotency-Key':crypto.randomUUID()},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(10000)});
const s=grantStore(),read={accountId,provider:'payments' as const,method:'GET' as const,path:'/wallet',body:{},purpose:'Verify exact bounded read authority',expiresInSeconds:300,maxOperations:1};
try{
  const unbound=await mint('delegation.write');assert.equal((await call('/topups',unbound,{amountMinor:100,source:'demo_approved'})).status,403);assert.equal((await call('/payment-orders',unbound,{})).status,403);
  console.log('PASS: exact-image supported write-scope JWT without an independent bound grant cannot credit or capture money.');
  const g=s.create(owner,read),job=s.start(g.id,crypto.randomUUID()).job,bearer=await mint('delegation.read'),c=JSON.parse(Buffer.from(bearer.split('.')[1],'base64url').toString());assert.equal(c.azp,brokerClient);assert.equal(c.act,undefined);
  s.bind(tokenHash(bearer),{grantId:g.id,version:g.version,sub:owner,actor:brokerClient,exp:c.exp,operationId:job.id,requestDigest:digest({provider:g.provider,method:g.method,path:g.path,body:g.body})});
  assert.equal((await call('/transactions',bearer)).status,403);assert.equal((await call('/topups',bearer,{amountMinor:100,source:'demo_approved'})).status,403);assert.equal(s.get(g.id).used,0);assert.equal((await call('/wallet',bearer)).status,200);assert.equal((await call('/wallet',bearer)).status,403);s.finish(job,{success:true,readOnly:true},true);
  assert.ok(!JSON.stringify(s.history(g.id,owner)).includes(bearer));console.log('PASS: bound bearer cannot substitute path/method and admits its exact read once, with no raw credential in audit.');
  const revoked=s.create(owner,read),revokedJob=s.start(revoked.id,crypto.randomUUID()).job,token=await mint('delegation.read'),claims=JSON.parse(Buffer.from(token.split('.')[1],'base64url').toString());s.bind(tokenHash(token),{grantId:revoked.id,version:revoked.version,sub:owner,actor:brokerClient,exp:claims.exp,operationId:revokedJob.id,requestDigest:digest({provider:revoked.provider,method:revoked.method,path:revoked.path,body:revoked.body})});s.revoke(revoked.id,owner);assert.equal((await call('/wallet',token)).status,403);assert.equal(s.get(revoked.id).used,0);
  console.log('PASS: already-issued token is denied after current online grant revocation.');
}finally{s.close();}
