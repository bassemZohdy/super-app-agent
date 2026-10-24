/** Real signed HTTP demo qualification. Isolated SQLite; owned Redis sessions are removed. */
import assert from 'node:assert/strict';
import { randomBytes,randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { setTimeout as delay } from 'node:timers/promises';
import { mkdir,writeFile } from 'node:fs/promises';
import { keycloakIssuerUrl } from './endpoints.ts';
import { startEnvironment } from './e2e/environment.ts';
import type { Span } from '../packages/backend-kit/src/observability.ts';
import type { UIComponentNode } from '../packages/protocol-core/src/index.ts';
process.env.OPS_API_KEY=randomBytes(32).toString('hex');process.env.OBSERVABILITY_LOGS='false';
const env=await startEnvironment(),headers={'X-Ops-Key':process.env.OPS_API_KEY},sessions:string[]=[];
let token='';
const evidence:Record<string,unknown>={executedAt:new Date().toISOString(),scope:'isolated local synthetic demo; real Keycloak and Redis; local model disabled',node:process.version};
try{
 const login=await fetch(`${keycloakIssuerUrl}/protocol/openid-connect/token`,{method:'POST',body:new URLSearchParams({grant_type:'password',client_id:'superapp-shell',username:'demo-commuter',password:'demo123'}),signal:AbortSignal.timeout(10000)});assert.equal(login.status,200);token=(await login.json()).access_token as string;
 const auth={Authorization:`Bearer ${token}`,'Content-Type':'application/json'};
 const call=async(path:string,body?:unknown,extra:Record<string,string>={})=>{const r=await fetch(`${env.coreUrl}${path}`,{method:body?'POST':'GET',headers:{...auth,...extra},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(15000)});return {status:r.status,data:await r.json(),trace:r.headers.get('traceparent')?.split('-')[1]};};
 const accounts=await call('/api/accounts');assert.equal(accounts.status,200);const accountId=accounts.data.accounts[0].id as string;
 const sid=`ops_${randomUUID()}`;sessions.push(sid);const prepare=await call('/api/manual/prepare',{sessionId:sid,accountId,serviceId:'housing'});assert.equal(prepare.status,200);
 const bindings=(node:UIComponentNode):Array<Record<string,unknown>>=>[...(node.onEvents||[]).filter(e=>e.actionType==='AGENT_ACTION_DISPATCH').map(e=>e.payload),...(node.children||[]).flatMap(bindings)];
 const binding=bindings(prepare.data.surface.view).find(b=>String(b.action).includes('move'));assert.ok(binding,'Housing must offer its reviewed move-in action');
 await env.pauseProvider('dewa');
 const requestId=randomUUID(),action=String(binding.action),payload=Object.fromEntries(Object.entries(binding).filter(([k])=>k!=='action'));
 const failed=await call('/api/a2ui/action',{sessionId:sid,accountId,action,payload,surfaceRevision:prepare.data.surface.revision},{'X-Request-Id':requestId});assert.ok(failed.status>=400);assert.equal(failed.data.success,false);assert.ok(['UNKNOWN','PARTIALLY_COMPLETED'].includes(failed.data.outcome));await env.resumeProvider('dewa');
 const bases=[env.coreUrl,...Array.from({length:6},(_,i)=>`http://localhost:${env.corePort+i+1}`),...Array.from({length:7},(_,i)=>`http://localhost:${env.corePort+i+101}`)];
 const states=await Promise.all(bases.map(async base=>{const r=await fetch(`${base}/ops/state?traceId=${failed.trace}`,{headers});assert.equal(r.status,200);return r.json();}));
 const spans:Span[]=states.flatMap(s=>s.spans);assert.ok(spans.some(s=>s.service==='dld'&&s.kind==='server'&&s.status===200));assert.ok(spans.some(s=>s.service==='service-catalog'&&s.kind==='client'&&s.status===503));assert.ok(spans.some(s=>s.kind==='tool'&&s.toolId&&s.approvalId&&s.workflowId));assert.ok(spans.filter(s=>s.kind==='server').every(s=>s.requestId===requestId));assert.doesNotMatch(JSON.stringify(spans),new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')));
 evidence.partialJourney={outcome:failed.data.outcome,spanCount:spans.length,services:[...new Set(spans.map(s=>s.service))],allFiveCorrelationIds:true};
 assert.equal((await fetch(`${env.coreUrl}/ops/state`,{headers:auth})).status,403);assert.equal((await fetch(`${env.coreUrl}/ops/state`,{headers:{...headers,Origin:env.appUrl}})).status,403);
 for(const base of bases){assert.equal((await fetch(`${base}/live`)).status,200);assert.equal((await fetch(`${base}/ready`)).status,200);}
 console.log('PASS: signed partial move-in journey correlated through tool/application/provider hops; operations access and all 14 Node probes verified.');
 // Fixed workloads, finite deadlines and explicit qualification thresholds; no writes under load.
 const target=`${env.coreUrl}/api/accounts`;
 async function measure(seconds:number,concurrency:number,paceMs:number){const deadline=performance.now()+seconds*1000,durations:number[]=[],statuses:Record<string,number>={},rssStart=process.memoryUsage().rss;let peakRss=rssStart;
  await Promise.all(Array.from({length:concurrency},async()=>{while(performance.now()<deadline){const before=performance.now();try{const r=await fetch(target,{headers:auth,signal:AbortSignal.timeout(5000)});await r.text();statuses[r.status]=(statuses[r.status]||0)+1;}catch{statuses.NETWORK=(statuses.NETWORK||0)+1;}durations.push(performance.now()-before);peakRss=Math.max(peakRss,process.memoryUsage().rss);if(paceMs)await delay(paceMs);}}));durations.sort((a,b)=>a-b);const total=durations.length,success=statuses[200]||0;return {seconds,concurrency,requests:total,throughputRps:total/seconds,p95Ms:durations[Math.min(total-1,Math.floor(total*.95))],errorRate:(total-success)/total,statuses,rssStartBytes:rssStart,peakRssBytes:peakRss,rssGrowthBytes:peakRss-rssStart};}
 const load=await measure(10,8,10);evidence.load=load;assert.ok(load.throughputRps>=5&&load.p95Ms<1000&&load.errorRate<=.01,JSON.stringify(load));console.log(`PASS: 10-second read load, ${load.throughputRps.toFixed(1)} req/s; p95 ${load.p95Ms.toFixed(1)} ms.`);
 const soak=await measure(60,1,200);evidence.soak=soak;assert.ok(soak.p95Ms<1000&&soak.errorRate<=.01&&soak.rssGrowthBytes<128*1024*1024,JSON.stringify(soak));console.log(`PASS: 60-second read soak; p95 ${soak.p95Ms.toFixed(1)} ms; RSS growth ${(soak.rssGrowthBytes/1024/1024).toFixed(1)} MiB.`);
 evidence.thresholds={readP95Ms:1000,minLoadRps:5,maxErrorRate:.01,maxSoakRssGrowthMiB:128};
 const path='.data/operations/latest.json';await mkdir('.data/operations',{recursive:true});await writeFile(path,JSON.stringify(evidence,null,2)+'\n');console.log(`Operations evidence: ${path}`);
}finally{
 // Restore fault first and remove only this run's session/graph/event keys through owned API cleanup.
 await env.resumeProvider('dewa').catch(()=>{});
 for(const sid of sessions)await fetch(`${env.coreUrl}/api/sessions/${sid}`,{method:'DELETE',headers:{Authorization:`Bearer ${token}`}}).catch(()=>{});
 const {redisSessions}=await import('../services/agent-core/src/session-store.ts');const store=redisSessions();if(store)for(const sid of sessions){const keys=await store.client.keys(`superapp:session:${sid}*`);if(keys.length)await store.client.del(keys);}
 await env.cleanup();
}
