/** Actual signed local identity and isolated broker/provider authority. Never logs credentials; only the explicitly approved legacy control moves isolated synthetic money. */
import assert from 'node:assert/strict';
import { readFile,mkdtemp,writeFile,rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { startEnvironment } from './environment.ts';
import { MANDATE_ACTOR,type MandatePolicy } from '../../packages/protocol-core/src/payment-mandates.ts';
let env:Awaited<ReturnType<typeof startEnvironment>>|undefined,containerName:string|undefined,root:string|undefined;
const docker=(args:string[])=>new Promise<string>((done,fail)=>{const child=spawn('docker',args,{stdio:['ignore','pipe','pipe']});let out='',err='';child.stdout.on('data',d=>out=(out+d).slice(-20000));child.stderr.on('data',d=>err=(err+d).slice(-3000));child.once('error',fail);child.once('exit',code=>code===0?done(out):fail(new Error(`Isolated authority command failed (${code}): ${err}`)));});
const compose=['compose','-f','docker-compose.demo.yml'];
try{
  env=await startEnvironment();process.env.DELEGATION_AUTHORITY_URL=`http://127.0.0.1:${env.corePort+110}`;
  const current=(await docker([...compose,'ps','-q','delegation-broker'])).trim();assert.ok(current,'Start the existing local delegation broker first.');
  const mounts=JSON.parse(await docker(['inspect','--format','{{json .Mounts}}',current]));const keys=mounts.find((m:{Destination:string})=>m.Destination==='/data/delegation');assert.equal(keys?.Type,'volume');
  containerName=`cityside-authority-test-${crypto.randomUUID()}`;
  root=await mkdtemp(join(tmpdir(),'cityside-authority-config-'));
  const normalEnv=JSON.parse(await docker(['inspect','--format','{{json .Config.Env}}',current])) as string[];
  const names=new Set(['KEYCLOAK_ISSUER','KEYCLOAK_PUBLIC_ISSUER','KEYCLOAK_JWKS_URL','KEYCLOAK_TOKEN_URL','KEYCLOAK_INTROSPECTION_URL','KEYCLOAK_INTROSPECTION_CLIENT_ID','KEYCLOAK_INTROSPECTION_CLIENT_SECRET','KEYCLOAK_AUDIENCE','NODE_ENV','DELEGATION_ENABLED','DELEGATION_ISSUER','DELEGATION_KEY_DIR','ELIGIBILITY_ENFORCEMENT','ELIGIBILITY_READER_SECRET']);
  const selected=normalEnv.filter(v=>names.has(v.split('=')[0]));assert.ok(selected.every(v=>!/[\r\n]/.test(v)),'Invalid isolated authority environment');
  selected.push('ELIGIBILITY_ENFORCEMENT=true','DELEGATION_DB_PATH=/tmp/automation-security.sqlite','PORT=4010',...['rta','dewa','etisalat','du','police','dld','payments'].map((p,i)=>`PROVIDER_${p.toUpperCase()}_URL=http://host.docker.internal:${env!.corePort+101+i}`));
  const config=join(root,'authority.env');await writeFile(config,selected.join('\n')+'\n',{mode:0o600});
  const networks=JSON.parse(await docker(['inspect','--format','{{json .NetworkSettings.Networks}}',current]));const network=Object.keys(networks)[0];assert.ok(network);
  const image=(await docker(['inspect','--format','{{.Config.Image}}',current])).trim();
  await docker(['run','--rm','--detach','--name',containerName,'--network',network,'--publish',`127.0.0.1:${env.corePort+110}:4010`,'--workdir','/app','--mount',`type=bind,src=${process.cwd()},dst=/app,readonly`,'--mount',`type=volume,src=${keys.Name},dst=/data/delegation,readonly`,'--env-file',config,image,'node','--experimental-strip-types','services/delegation/src/index.ts']);
  const copiedMounts=JSON.parse(await docker(['inspect','--format','{{json .Mounts}}',containerName]));assert.equal(copiedMounts.find((m:{Destination:string})=>m.Destination==='/data/delegation')?.RW,false,'Issuer keys must be read-only inside this trusted issuer test container.');
  for(let n=0;n<30;n++){try{if((await fetch(`${process.env.DELEGATION_AUTHORITY_URL}/health`,{signal:AbortSignal.timeout(1000)})).ok)break;}catch{}if(n===29)throw Error('Isolated authority failed readiness');await new Promise(done=>setTimeout(done,200));}
  const endpoint='http://localhost:8085/realms/superapp/protocol/openid-connect/token';
  const token=async(body:Record<string,string>)=>{const r=await fetch(endpoint,{method:'POST',body:new URLSearchParams(body),signal:AbortSignal.timeout(10000)});assert.equal(r.status,200,'Local identity request failed');return(await r.json() as any).access_token as string;};
  const human=await token({grant_type:'password',client_id:'superapp-shell',username:'bassem',password:'demo123'}),other=await token({grant_type:'password',client_id:'superapp-shell',username:'demo-commuter',password:'demo123'});
  const realm=JSON.parse(await readFile('services/keycloak/realm-export.json','utf8')),machine=await token({grant_type:'client_credentials',client_id:'service-wallet',client_secret:realm.clients.find((c:any)=>c.clientId==='service-wallet').secret});
  const runner=await token({grant_type:'client_credentials',client_id:'delegation-runner',client_secret:await readFile('.data/delegation/runner-secret','utf8')});
  const call=async(url:string,method='GET',body?:unknown,bearer=human,headers:Record<string,string>={})=>{const r=await fetch(url,{method,headers:{Authorization:`Bearer ${bearer}`,'Content-Type':'application/json',...headers},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(15000)});return{status:r.status,data:await r.json() as any};};
  const accounts=(await call(`${env.coreUrl}/api/accounts`)).data.accounts,accountId=accounts.find((a:any)=>a.label==='Personal account').id,owner=JSON.parse(Buffer.from(human.split('.')[1],'base64url').toString()).sub as string;
  // Direct status probes use fresh sockets: restart deliberately closes every old provider connection. No money request is retried.
  const provider=(path:string,method='GET',body?:unknown,bearer=human)=>call(`http://127.0.0.1:${env!.corePort+107}/v1/accounts/${accountId}${path}`,method,body,bearer,{'Idempotency-Key':crypto.randomUUID(),'X-User-Subject':owner,Connection:'close'});
  const api=(path:string,body:Record<string,unknown>,bearer=human)=>call(`${env!.coreUrl}/api/payments/${path}`,'POST',{accountId,requestKey:crypto.randomUUID(),...body},bearer);
  const broker=(path:string,body?:unknown,bearer=human)=>call(`${process.env.DELEGATION_AUTHORITY_URL}/api/delegation${path}`,body?'POST':'GET',body,bearer);
  const before=(await provider('/wallet')).data,transactions=(await provider('/transactions')).data;
  const card=(await api('methods',{preset:'approved',nickname:'Security review source'})).data.method,now=Date.now();
  const policy:MandatePolicy={actorClientId:MANDATE_ACTOR,audience:'provider-api',operation:'WALLET_RELOAD',purpose:'Bounded owned reload security review',currency:'AED',target:{kind:'WALLET'},sources:[{methodId:card.id,expectedVersion:1}],fallback:{mode:'NONE'},trigger:{type:'LOW_BALANCE',belowMinor:1000,reloadMinor:5000,targetBalanceMinor:10000},timezone:'Asia/Dubai',startsAt:new Date(now).toISOString(),expiresAt:new Date(now+3600000).toISOString(),limits:{perPaymentMinor:5000,periodMinor:10000,lifetimeMinor:10000,period:'DAY',perPeriodCount:2,lifetimeCount:2,cooldownSeconds:3600}};
  let m=(await api('mandates',{policy})).data.mandate;m=(await api('mandates/approve',{mandateId:m.id,expectedVersion:m.version,approvalDigest:m.approvalDigest})).data.mandate;assert.equal(m.state,'APPROVED');assert.equal(m.executionEnabled,false);
  for(const [bearer,expectedStatus] of [[machine,403],[runner,401]] as const)for(const [path,method,body] of [['/payment-mandates','POST',{policy}],['/payment-orders','POST',{}],['/wallet-funding-orders','POST',{}],['/payment-refunds','POST',{}],['/payment-lifecycle','GET',undefined],['/payment-history','GET',undefined],['/payment-reconciliation','GET',undefined]] as const)assert.equal((await provider(path,method,body,bearer)).status,expectedStatus);
  assert.equal((await api('mandates/approve',{mandateId:m.id,expectedVersion:m.version,approvalDigest:m.approvalDigest},other)).status,403);assert.equal((await api('mandates',{policy,approved:true})).status,400);
  const read={accountId,provider:'payments',method:'GET',path:'/wallet',body:{},purpose:'Inspect the exact owned demo wallet',expiresInSeconds:300,maxOperations:1};
  for(const path of ['/payment-mandates','/payment-orders','/payment-history','/payment-statement','/payment-reconciliation'])assert.equal((await broker('/grants',{...read,path})).status,403);
  assert.equal((await broker('/grants',{...read,approved:true})).status,403);assert.equal((await broker('/grants',{...read,method:'POST',path:'/topups',body:{amountMinor:100,source:'demo_approved',mandateId:m.id}})).status,403);
  assert.equal((await broker('/grants',read,runner)).status,401);console.log('PASS: real user/workload tokens, forged owner headers, extra approval fields and legacy-profile escalation cannot enable scheduled money.');
  const granted=await broker('/grants',read);assert.equal(granted.status,201);const grant=granted.data.grant,key=crypto.randomUUID();
  const executed=await broker(`/grants/${grant.id}/execute`,{requestKey:key});assert.equal(executed.status,200,JSON.stringify(executed.data));assert.equal(executed.data.result.success,true);const replay=await broker(`/grants/${grant.id}/execute`,{requestKey:key});assert.equal(replay.status,200);assert.equal(replay.data.operationId,executed.data.operationId);
  for(const [providerName,path] of [['rta','/salik'],['dewa','/consumption'],['etisalat','/subscriptions'],['du','/prepaid'],['police','/vehicles'],['dld','/tenancy']] as const){
    const created=await broker('/grants',{...read,provider:providerName,path});assert.equal(created.status,201);const result=await broker(`/grants/${created.data.grant.id}/execute`,{requestKey:crypto.randomUUID()});assert.equal(result.status,200,`${providerName} exact delegated read failed`);assert.equal(result.data.result.success,true);
  }console.log('PASS: seven fixed provider read profiles execute only their exact owner-consented read.');
  const controlled=await docker(['exec',containerName,'node','--experimental-strip-types','scripts/verify-automation-authority.ts']);assert.ok(controlled.includes('PASS: already-issued token'));process.stdout.write(controlled);
  assert.deepEqual((await provider('/wallet')).data,before);assert.deepEqual((await provider('/transactions')).data,transactions);
  const oneWrite=(await broker('/grants',{...read,method:'POST',path:'/topups',body:{amountMinor:100,source:'demo_approved'}})).data.grant,writeKey=crypto.randomUUID();
  const written=await broker(`/grants/${oneWrite.id}/execute`,{requestKey:writeKey});assert.equal(written.status,200,JSON.stringify(written.data));const repeated=await broker(`/grants/${oneWrite.id}/execute`,{requestKey:writeKey});assert.equal(repeated.status,200);assert.equal(repeated.data.operationId,written.data.operationId);
  const after=(await provider('/wallet')).data,afterTransactions=(await provider('/transactions')).data;assert.equal(after.balanceMinor,before.balanceMinor+100);assert.equal(afterTransactions.count,transactions.count+1);console.log('PASS: negative probes move no money; separate explicit legacy one-AED consent still credits once, including replay.');
  const stopped=await api('methods/status',{methodId:card.id,expectedVersion:1,status:'DISABLED'});assert.equal(stopped.status,200);assert.equal((await api('mandates',{policy})).status,409);
  await env.restartPayments();assert.equal((await provider(`/payment-mandates/${m.id}`)).data.mandate.executionEnabled,false);assert.deepEqual((await provider('/wallet')).data,after);assert.deepEqual((await provider('/transactions')).data,afterTransactions);
  console.log('PASS: online revocation, stale source, actual provider restart and approved mandate remain conservative; no recurring mandate execution or replacement financial effect occurred.');
}finally{
  if(containerName)await docker(['rm','--force',containerName]).catch(()=>{});await env?.cleanup();if(root)await rm(root,{recursive:true,force:true});
}
