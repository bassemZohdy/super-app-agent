import { keycloakIssuerUrl } from '../endpoints.ts';
/** Real signed owners, isolated providers and retained consent; no automation worker or model call. */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { startEnvironment } from './environment.ts';
import { MANDATE_ACTOR, type MandatePolicy, type PaymentMandate } from '../../packages/protocol-core/src/payment-mandates.ts';
let env:Awaited<ReturnType<typeof startEnvironment>>|undefined;
try{
  env=await startEnvironment();
  const login=async(username:string)=>{const r=await fetch(`${keycloakIssuerUrl}/protocol/openid-connect/token`,{method:'POST',body:new URLSearchParams({grant_type:'password',client_id:'superapp-shell',username,password:'demo123'}),signal:AbortSignal.timeout(10000)});assert.equal(r.status,200);return(await r.json() as any).access_token as string;};
  const [token,other]=await Promise.all([login('bassem'),login('demo-commuter')]);
  const request=async(url:string,body?:unknown,bearer=token,key=randomUUID())=>{const r=await fetch(url,{method:body?'POST':'GET',headers:{Authorization:`Bearer ${bearer}`,'Content-Type':'application/json','Idempotency-Key':key},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(30000)});return{status:r.status,data:await r.json() as any};};
  const accounts=(await request(`${env.coreUrl}/api/accounts`)).data.accounts,accountId=accounts.find((a:any)=>a.label==='Personal account').id,household=accounts.find((a:any)=>a.label==='Household account').id;
  const api=(path:string,body?:Record<string,unknown>,bearer=token,account=accountId)=>request(`${env!.coreUrl}/api/payments/${path}${body?'':`?accountId=${account}`}`,body?{accountId:account,requestKey:randomUUID(),...body}:undefined,bearer);
  const provider=(name:string,path:string,body?:unknown,bearer=token)=>request(`http://localhost:${env!.corePort+101+['rta','dewa','etisalat','du','police','dld','payments'].indexOf(name)}/v1/accounts/${accountId}${path}`,body,bearer);
  const realm=JSON.parse(await readFile('services/keycloak/realm-export.json','utf8'));
  const machineResponse=await fetch(`${keycloakIssuerUrl}/protocol/openid-connect/token`,{method:'POST',body:new URLSearchParams({grant_type:'client_credentials',client_id:'service-wallet',client_secret:realm.clients.find((c:any)=>c.clientId==='service-wallet').secret}),signal:AbortSignal.timeout(10000)});assert.equal(machineResponse.status,200);
  const machine=(await machineResponse.json() as any).access_token;assert.equal((await provider('payments','/payment-mandates',undefined,machine)).status,403);
  const first=(await api('overview')).data,card=(await api('methods',{preset:'approved',nickname:'Mandate source'})).data.method;
  const links=new Map<string,any>();for(const candidate of first.candidates){const result=await api('billing-accounts',{provider:candidate.provider,reference:candidate.reference,nickname:candidate.label});assert.equal(result.status,200);links.set(`${candidate.provider}:${candidate.reference}`,result.data.billingAccount);}
  // Set up one real synthetic parking session before the zero-effect consent baseline.
  const zones=(await provider('rta','/parking/zones')).data.zones,zone=zones[0],reference=randomUUID(),plate=first.candidates.find((c:any)=>c.provider==='police').reference;
  const charge=(await provider('payments','/charges',{amountMinor:Math.round(zone.tariffPerHour*100),merchant:'rta',reference:`parking:${reference}`,source:'wallet'})).data.charge;
  const meter=(await provider('rta','/parking/sessions',{zoneId:zone.id,durationHours:1,plateNumber:plate,paymentId:charge.id,reference})).data.meter;assert.ok(meter);
  const beforeWallet=(await provider('payments','/wallet')).data,beforeTransactions=(await provider('payments','/transactions')).data;
  const now=Date.now(),base:MandatePolicy={actorClientId:MANDATE_ACTOR,audience:'provider-api',operation:'BILL_PAYMENT',purpose:'Pay this owned biller within my finite budget',currency:'AED',
    target:{kind:'WALLET'},sources:[{methodId:card.id,expectedVersion:card.version}],fallback:{mode:'NONE'},trigger:{type:'INVOICE_DUE',daysBefore:1},timezone:'Asia/Dubai',startsAt:new Date(now).toISOString(),expiresAt:new Date(now+30*86400000).toISOString(),
    limits:{perPaymentMinor:50000,periodMinor:100000,lifetimeMinor:300000,period:'MONTH',perPeriodCount:4,lifetimeCount:12,cooldownSeconds:3600}};
  const target=(provider:string,reference?:string)=>{const b=[...links.values()].find(b=>b.provider===provider&&(!reference||b.reference===reference));assert.ok(b);return{kind:'BILLER' as const,billingAccountId:b.id,expectedVersion:b.version,provider:b.provider,reference:b.reference};};
  const recharge=first.rechargeTargets.find((t:any)=>t.provider==='rta'),sub=first.candidates.find((c:any)=>c.provider==='du'&&!('balanceMinor' in c));
  const policies:MandatePolicy[]=[{...base,target:target('dewa')},{...base,operation:'WALLET_RELOAD',target:{kind:'WALLET'},trigger:{type:'LOW_BALANCE',belowMinor:1000,reloadMinor:5000,targetBalanceMinor:10000}},
    {...base,operation:'RECHARGE',target:target('rta',recharge.reference),trigger:{type:'LOW_BALANCE',belowMinor:1000,reloadMinor:recharge.denominationsMinor[0],targetBalanceMinor:10000}},
    {...base,operation:'FINE_PAYMENT',target:target('police'),trigger:{type:'NEW_FINE'},fineTypes:['Parking overstay']},
    {...base,operation:'SUBSCRIPTION_RENEWAL',target:target('du',sub.reference),trigger:{type:'CALENDAR',dayOfMonth:31,hour:9,minute:0,monthEnd:'LAST_DAY'}},
    {...base,operation:'PARKING_EXTENSION',target:{kind:'PARKING',ticketId:meter.ticketId,zoneId:meter.zoneId,plateNumber:plate,maximumHours:4,endAt:new Date(now+7200000).toISOString()},trigger:{type:'PARKING_ENDING',minutesBefore:10}}];
  const approved:PaymentMandate[]=[];
  for(const policy of policies){
    const key=randomUUID(),input={accountId,requestKey:key,policy},url:string=`${env.coreUrl}/api/payments/mandates`,created=await request(url,input);assert.equal(created.status,200,JSON.stringify(created.data));let m=created.data.mandate as PaymentMandate;assert.equal(m.state,'AWAITING_APPROVAL');
    assert.deepEqual((await request(url,input)).data.mandate,m);assert.equal((await request(url,{...input,policy:{...policy,purpose:'Changed terms'}})).status,409);
    assert.equal((await api('mandates/approve',{mandateId:m.id,expectedVersion:m.version,approvalDigest:'0'.repeat(64)})).status,409);
    const result=await api('mandates/approve',{mandateId:m.id,expectedVersion:m.version,approvalDigest:m.approvalDigest});assert.equal(result.status,200,JSON.stringify(result.data));m=result.data.mandate;assert.equal(m.state,'APPROVED');assert.equal(m.executionEnabled,false);approved.push(m);
    console.log(`PASS: ${policy.operation} exact reviewed consent, retry identity and no execution authority.`);
  }
  const m=approved[0];assert.equal((await api('mandates')).data.mandates.length,6);assert.equal((await api('mandates',undefined,token,household)).data.mandates.length,0);
  assert.equal((await api('mandates',undefined,other)).status,403);assert.equal((await provider('payments',`/payment-mandates/${m.id}`,undefined,other)).status,403);
  assert.equal((await api('methods/status',{methodId:card.id,expectedVersion:1,status:'REMOVED'})).status,409);
  const revised=await api('mandates/revise',{mandateId:m.id,expectedVersion:m.version,policy:{...m.policy,purpose:'New explicit purpose',sources:[{methodId:'wallet',expectedVersion:1}]}});assert.equal(revised.status,200);const pending=revised.data.mandate as PaymentMandate;assert.equal(pending.state,'AWAITING_APPROVAL');assert.equal(pending.policyVersion,2);
  assert.equal((await api('mandates/approve',{mandateId:m.id,expectedVersion:pending.version,approvalDigest:m.approvalDigest})).status,409);
  const history=await request(`${env.coreUrl}/api/payments/mandates/history?accountId=${accountId}&mandateId=${m.id}`);assert.equal(history.status,200,JSON.stringify(history.data));assert.equal(history.data.history.length,3);assert.equal(history.data.history[1].sourceSnapshots[0].id,card.id);
  await env.restartPayments();assert.equal((await api('mandates')).data.mandates.length,6);assert.equal((await request(`${env.coreUrl}/api/payments/mandates/history?accountId=${accountId}&mandateId=${m.id}`)).data.history.length,3);
  const invalid={...policies[0],target:{...policies[0].target,reference:'unowned-target'}};assert.equal((await api('mandates',{policy:invalid})).status,409);
  assert.equal((await api('mandates',{policy:{...policies[0],grantId:'five-minute-read-grant'}})).status,400);
  const disabled=await api('methods/status',{methodId:card.id,expectedVersion:1,status:'DISABLED'});assert.equal(disabled.status,200);
  const newDraft=await api('mandates',{policy:policies[1]});assert.equal(newDraft.status,409);
  for(const current of (await api('mandates')).data.mandates){const r=await api('mandates/revoke',{mandateId:current.id,expectedVersion:current.version});assert.equal(r.status,200);assert.equal(r.data.mandate.state,'REVOKED');}
  assert.equal((await api('methods/status',{methodId:card.id,expectedVersion:disabled.data.method.version,status:'REMOVED'})).status,200);
  assert.deepEqual((await provider('payments','/wallet')).data,beforeWallet);assert.deepEqual((await provider('payments','/transactions')).data,beforeTransactions);
  console.log('PASS: source/provider/owner/version/digest boundaries, six operation families, revoke/release, immutable history and actual provider restart. Consent produced no capture, wallet change or transaction.');
}finally{await env?.cleanup();}
