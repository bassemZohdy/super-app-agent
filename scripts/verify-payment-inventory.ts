/** Signed read-only inventory check against the current local demo. No transaction or rule is executed. */
import assert from 'node:assert/strict';
const issuer='http://localhost:8085/realms/superapp';
const login=await fetch(`${issuer}/protocol/openid-connect/token`,{method:'POST',body:new URLSearchParams({grant_type:'password',client_id:'superapp-shell',username:'demo-commuter',password:'demo123'}),signal:AbortSignal.timeout(10000)});
assert.equal(login.status,200,'Local demo login failed.');const token=(await login.json() as {access_token:string}).access_token;
async function read(url:string){const response=await fetch(url,{headers:{Authorization:`Bearer ${token}`},signal:AbortSignal.timeout(10000)});assert.equal(response.status,200,`Inventory read failed (${response.status}).`);return await response.json() as any;}
const accounts=await read('http://localhost:4000/api/accounts');const account=accounts.accounts.find((a:{label:string})=>a.label==='Personal account');assert.ok(account);
const path=`http://localhost:4107/v1/accounts/${encodeURIComponent(account.id)}`;
const before=await read(path+'/wallet'),transactions=await read(path+'/transactions');
const overview=await read(`http://localhost:4000/api/payments/overview?accountId=${encodeURIComponent(account.id)}`);
for(const provider of ['etisalat','du'])assert.ok(overview.candidates.some((c:{provider:string;reference:string;balanceMinor?:number})=>c.provider===provider&&c.reference.startsWith(`PRE-${provider}-`)&&Number.isSafeInteger(c.balanceMinor)));
assert.ok(overview.candidates.some((c:{provider:string})=>c.provider==='police'));
assert.ok(Array.isArray(overview.rechargeTargets));for(const provider of ['rta','etisalat','du']){const target=overview.rechargeTargets.find((t:any)=>t.provider===provider);assert.ok(target);assert.equal(target.currency,'AED');assert.ok(Number.isSafeInteger(target.balanceMinor));assert.ok(target.denominationsMinor.length>0);}
assert.ok(Array.isArray(overview.dependencies));assert.ok(Array.isArray(overview.orders));assert.ok(Array.isArray(overview.cardBalances));assert.equal(overview.contractVersion,'1.9.0');
for(const balance of overview.cardBalances)assert.equal(balance.limitMinor-balance.heldMinor-balance.spentMinor,balance.availableMinor);
for(const order of overview.orders){assert.equal(order.accountId,account.id);assert.equal(typeof order.fundsCaptured,'boolean');if(order.state==='SETTLED'){assert.equal(order.fundsCaptured,true);assert.equal(order.receipt.amountMinor,order.quote.totalMinor);}}
const reviews=await read(`http://localhost:4000/api/payments/orders?accountId=${encodeURIComponent(account.id)}`);assert.ok(Array.isArray(reviews.orders));
for(const [provider,port] of [['dewa',4102],['etisalat',4103],['du',4104],['police',4105]] as const) {
  const source=await read(`http://localhost:${port}/v1/accounts/${encodeURIComponent(account.id)}/payables`);
  for(const payable of source.payables) {
    assert.match(payable.revision,/^[a-f0-9]{64}$/);assert.ok(Number.isSafeInteger(payable.amountMinor)&&payable.amountMinor>0);assert.ok(Number.isSafeInteger(payable.version)&&payable.version>0);
    const visible=overview.payables.find((p:{id:string;provider:string})=>p.id===payable.id&&p.provider===provider);assert.deepEqual(visible,payable);
  }
  if(provider!=='police')assert.ok(source.payables.some((p:{openingFixture?:boolean})=>p.openingFixture));
}

const control=await fetch('http://localhost:4107/internal/issuer-scenarios/simrun_00000000-0000-4000-8000-000000000000',{headers:{Authorization:`Bearer ${token}`},signal:AbortSignal.timeout(5000)});assert.equal(control.status,404,'Normal provider must not expose issuer scenario controls.');
assert.deepEqual(await read(path+'/wallet'),before);assert.deepEqual(await read(path+'/transactions'),transactions);
console.log('PASS: actual local signed-owner prepaid/vehicle inventory, authorization read models, lifecycle reads and provider-owned payable revisions; wallet funds and transaction history unchanged.');
