/** Mutates only the isolated qualification stack's synthetic household account. */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { demoPortOffset, gatewayUrl, keycloakIssuerUrl, walletServiceUrl, foodServiceUrl, rideServiceUrl } from '../endpoints.ts';
import { toMinor } from '../../packages/protocol-core/src/request-validation.ts';

assert.equal(demoPortOffset, 30000, 'Run through the isolated qualification stack.');
for (const [value, port] of [[gatewayUrl, 34000], [keycloakIssuerUrl, 38085], [walletServiceUrl, 34003], [foodServiceUrl, 34002], [rideServiceUrl, 34001]] as const) {
  const url = new URL(value); assert.equal(url.protocol, 'http:'); assert.ok(['localhost', '127.0.0.1'].includes(url.hostname)); assert.equal(Number(url.port), port);
}
const login = await fetch(`${keycloakIssuerUrl}/protocol/openid-connect/token`, { method:'POST', body:new URLSearchParams({grant_type:'password',client_id:'superapp-shell',username:'bassem',password:'demo123',scope:'openid'}) });
assert.equal(login.status,200,'Synthetic login failed.');
const token = (await login.json() as { access_token?:string }).access_token; assert.ok(token);
const auth = { Authorization:`Bearer ${token}`, 'Content-Type':'application/json' };
const accountsResponse=await fetch(`${gatewayUrl}/api/accounts`,{headers:auth}); assert.equal(accountsResponse.status,200);
const accounts=await accountsResponse.json() as { accounts:Array<{id:string;label:string}> };
const account=accounts.accounts.find(item=>item.label==='Household account')?.id; assert.ok(account);
async function request<T>(base:string,path:string,method='GET',body?:unknown,requestId=randomUUID()):Promise<{status:number;data:T}>{
  const response=await fetch(`${base}${path}`,{method,headers:{...auth,'X-Account-Id':account!, 'X-Request-Id':requestId},...(body===undefined?{}:{body:JSON.stringify(body)})});
  return {status:response.status,data:await response.json() as T};
}
type Fine={fineId:string;payableId:string;payableRevision:string;payableAmount:number};
type FineReport={fines:Fine[]};
type Wallet={balanceMinor:number};
type Bill={bill:{billId:string;status:string}};
type Salik={tagNumber:string;version?:number;balance:number};
const readFines=async()=>{const r=await request<FineReport>(walletServiceUrl,'/fines/check');assert.equal(r.status,200);return r.data.fines;};
const readWallet=async()=>{const r=await request<Wallet>(walletServiceUrl,'/wallet/balance');assert.equal(r.status,200);return r.data.balanceMinor;};
const originalFines=await readFines(); assert.ok(originalFines.length>=2,'A fresh synthetic household account needs at least two fines.');
const originalBalance=await readWallet(), originalBill=(await request<Bill>(foodServiceUrl,'/utilities/bill')).data.bill;
const originalTag=(await request<Salik>(rideServiceUrl,'/mobility/salik/balance')).data;
const chosen=originalFines[0], payable={provider:'police',payableId:chosen.payableId,expectedRevision:chosen.payableRevision};
const totalMinor=10000+toMinor(chosen.payableAmount);
const base={items:[{agency:'City services',purpose:'Reviewed fine and toll recharge',amount:totalMinor/100}],expectedPayables:[payable],targetReference:originalTag.tagNumber,expectedTargetVersion:originalTag.version||1};
for(const [label,body,status] of [
  ['missing selection',{items:base.items,targetReference:base.targetReference,expectedTargetVersion:base.expectedTargetVersion},400],
  ['duplicate selection',{...base,expectedPayables:[payable,payable]},400],
  ['stale revision',{...base,expectedPayables:[{...payable,expectedRevision:'0'.repeat(64)}]},409],
  ['unknown payable',{...base,expectedPayables:[{...payable,payableId:'not-owned'}]},409],
  ['changed total',{...base,items:[{...base.items[0],amount:(totalMinor-1)/100}]},409],
] as const) {
  const result=await request<{code?:string}>(walletServiceUrl,'/pay/unified','POST',body);
  assert.equal(result.status,status,`${label} was not refused.`);
}
assert.equal(await readWallet(),originalBalance);
assert.deepEqual((await readFines()).map(fine=>fine.fineId).sort(),originalFines.map(fine=>fine.fineId).sort());
assert.equal((await request<Bill>(foodServiceUrl,'/utilities/bill')).data.bill.status,originalBill.status);
const requestId=randomUUID();
const paid=await request<{group:{id:string};grandTotal:number}>(walletServiceUrl,'/pay/unified','POST',base,requestId);
assert.equal(paid.status,200,'Selected checkout did not complete.');assert.equal(toMinor(paid.data.grandTotal),totalMinor);
const afterFines=await readFines();assert.deepEqual(afterFines.map(fine=>fine.fineId).sort(),originalFines.filter(fine=>fine.fineId!==chosen.fineId).map(fine=>fine.fineId).sort());
assert.equal(await readWallet(),originalBalance-totalMinor);
assert.equal((await request<Bill>(foodServiceUrl,'/utilities/bill')).data.bill.status,originalBill.status);
assert.equal(toMinor((await request<Salik>(rideServiceUrl,'/mobility/salik/balance')).data.balance),toMinor(originalTag.balance)+10000);
const replay=await request<{group:{id:string}}>(walletServiceUrl,'/pay/unified','POST',base,requestId);
assert.equal(replay.status,200,'Original checkout could not be replayed.');assert.equal(replay.data.group.id,paid.data.group.id);assert.equal(await readWallet(),originalBalance-totalMinor);
console.log('PASS: isolated grouped checkout rejects stale, unknown, duplicate and changed selections without moving funds.');
console.log('PASS: the selected fine and toll target settle once; other fines and the utility bill remain unchanged.');
console.log('PASS: replay returns the original group without another debit.');
