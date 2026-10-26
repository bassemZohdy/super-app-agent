import { demoPortOffset, gatewayUrl, keycloakIssuerUrl } from './endpoints.ts';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
const login=await fetch(`${keycloakIssuerUrl}/protocol/openid-connect/token`,{method:'POST',body:new URLSearchParams({grant_type:'password',client_id:'superapp-shell',username:'bassem',password:'demo123',scope:'openid'})});assert.equal(login.status,200);const token=(await login.json() as any).access_token;
const auth={Authorization:`Bearer ${token}`,'Content-Type':'application/json'};
const discovered=await(await fetch(`${gatewayUrl}/api/accounts`,{headers:auth})).json() as any;
const account=discovered.accounts.find((a:any)=>a.label==='Household account').id;
async function api(port:number,path:string,method='GET',body?:any,key=randomUUID()):Promise<any>{
 const response=await fetch(`http://localhost:${port+demoPortOffset}${path}`,{method,headers:{...auth,'X-Account-Id':account,'X-Request-Id':key},...(body?{body:JSON.stringify(body)}:{})});const data=await response.json() as any;
 assert.equal(response.status,200,`${method} ${path}: ${JSON.stringify(data)}`);assert.equal(data.success,true);return data;
}
const wallet=async()=>(await api(4003,'/wallet/balance')).balanceMinor;
const profile=(await api(4005,'/profile')).profile;assert.equal(profile.uaePassVerified,false);assert.equal(profile.emiratesId,undefined);
const key=randomUUID(),parking={zoneId:'zone_302a',durationHours:2,plateNumber:profile.smartCityAssets.vehicles[0].plate};
let before=await wallet();const meter=await api(4001,'/mobility/parking/activate','POST',parking,key);assert.equal(await wallet(),before-800);
const duplicate=await api(4001,'/mobility/parking/activate','POST',parking,key);assert.equal(duplicate.meter.ticketId,meter.meter.ticketId);assert.equal(await wallet(),before-800);
console.log('PASS: RTA parking uses a captured exact tariff; request replay does not double debit');
const utility=(await api(4002,'/utilities/bill')).bill;before=await wallet();await api(4002,'/utilities/pay','POST',{billId:utility.billId});assert.equal((await api(4002,'/utilities/bill')).bill.status,'PAID');assert.equal(await wallet(),before-(utility.status==='UNPAID'?Math.round(utility.totalAmount*100):0));
console.log('PASS: DEWA capture, provider proof verification and persisted bill settlement');
for(const provider of ['etisalat','du']){
 const bill=(await api(4006,`/telecom/${provider}/bills`)).bills[0];before=await wallet();await api(4006,`/telecom/${provider}/bills/${bill.billId}/payments`,'POST',{});assert.equal(await wallet(),before-(bill.status==='UNPAID'?Math.round(bill.totalAmount*100):0));assert.equal((await api(4006,`/telecom/${provider}/bills`)).bills[0].status,'PAID');
}
console.log('PASS: Etisalat and du bill settlement through the payment simulator');
const fines=await api(4003,'/fines/check');if(fines.fines.length){before=await wallet();await api(4003,'/fines/pay','POST',{fineIds:fines.fines.map((f:any)=>f.fineId)});assert.equal(await wallet(),before-Math.round(fines.totalPayable*100));}assert.equal((await api(4003,'/fines/check')).count,0);
await api(4003,'/wallet/topup','POST',{amount:500});before=await wallet();
const checkout=await api(4003,'/pay/unified','POST',{items:[{agency:'ignored client quote',purpose:'server authoritative totals',amount:0.01}]});assert.equal(checkout.grandTotal,100);assert.equal(await wallet(),before-10000);
console.log('PASS: fine settlement and unified checkout avoid double payment of previously settled bills/fines');
const contract=(await api(4004,'/housing/ejari')).contract;
const move=await api(4004,'/housing/move-in','POST',{contractNumber:contract.contractNumber});assert.equal(move.dewaConnected.status,'CONNECTED_ACTIVE');assert.equal(move.residentialParking.status,'ISSUED');
console.log('PASS: DLD tenancy, DEWA connection and RTA residential permit integration');
console.log('Full provider journey verification passed. All funds and records are simulated.');
