import { EventEmitter } from 'node:events';
import { StreamWriter } from '../agent-core/src/event-stream.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { Telemetry,correlation,enrichCorrelation,inSpan,tracedFetch,operationalEvent,diagnosticId } from '../../packages/backend-kit/src/observability.ts';
import { HttpPolicy,HttpError } from '../../packages/backend-kit/src/http-policy.ts';
async function listen(t:test.TestContext,telemetry:Telemetry,handler:Parameters<Telemetry['handler']>[0],ready?:()=>void){const server=http.createServer(telemetry.handler(handler,{ready}));await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));t.after(async()=>{telemetry.close();server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));});return `http://127.0.0.1:${(server.address() as import('node:net').AddressInfo).port}`;}
const opsKey='operations-test-credential-'.repeat(3);
test('partial journey joins server/client/tool spans across independently owned services; never stores payloads',async t=>{
 process.env.OPS_API_KEY=opsKey;
 const upstream=new Telemetry('upstream'),gateway=new Telemetry('gateway');
 const remote=await listen(t,upstream,(req,res)=>{res.writeHead(req.method==='POST'?503:200).end();});
 const workflowId=randomUUID(),approvalId=randomUUID(),requestId=randomUUID();
 const url=await listen(t,gateway,async(_req,res)=>{enrichCorrelation({workflowId,approvalId});await inSpan('DOMAIN bill','tool',async()=>{await tracedFetch(`${remote}/bills/private-customer?token=NEVER_STORE`);const r=await tracedFetch(`${remote}/pay`,{method:'POST',headers:{Authorization:'Bearer NEVER_STORE'},body:'4111111111111111 NEVER_STORE'});res.writeHead(r.status).end();});});
 const result=await fetch(url,{headers:{'X-Request-Id':requestId,traceparent:'00-11111111111111111111111111111111-2222222222222222-01'}});await result.text();
 assert.equal(result.status,503);assert.equal(result.headers.get('X-Request-Id'),requestId);
 const spans=[...gateway.snapshot().spans,...upstream.snapshot().spans];assert.equal(spans.length,6);assert.ok(spans.every(s=>s.traceId==='1'.repeat(32)&&s.requestId===requestId&&s.workflowId===workflowId&&s.approvalId===approvalId));
 const child=spans.find(s=>s.service==='upstream'&&s.status===503)!;assert.ok(spans.some(s=>s.kind==='client'&&s.spanId===child.parentSpanId&&s.toolId===child.toolId));assert.ok(child.toolId);assert.equal(spans.find(s=>s.service==='gateway'&&s.kind==='server')!.parentSpanId,'2'.repeat(16));
 const json=JSON.stringify(spans);assert.doesNotMatch(json,/NEVER_STORE|private-customer|4111111111111111|Authorization/);
 const metrics=gateway.prometheus();assert.match(metrics,/cityside_operation_errors_total\{[^\n]*kind="server",category="request",method="GET"\} 1/);assert.match(metrics,/le="\+Inf"/);assert.doesNotMatch(metrics,new RegExp(workflowId));
});
test('operations endpoints require a separate key, reject browser origins, never fall through; probes expose generic failures',async t=>{
 process.env.OPS_API_KEY=opsKey;let ready=true;const tel=new Telemetry('ops-test');const base=await listen(t,tel,(_q,r)=>r.end('business'),()=>{if(!ready)throw Error('sensitive path and password');});
 assert.equal((await fetch(`${base}/ops/state`)).status,403);assert.equal((await fetch(`${base}/ops/state`,{headers:{Authorization:`Bearer ${opsKey}`}})).status,403);
 assert.equal((await fetch(`${base}/ops/state`,{headers:{'X-Ops-Key':opsKey,Origin:'http://localhost:3000'}})).status,403);
 const headers={'X-Ops-Key':opsKey};assert.equal((await fetch(`${base}/ops/state?traceId=invalid`,{headers})).status,400);assert.equal((await fetch(`${base}/ops/metrics`,{method:'POST',headers})).status,405);
 assert.equal((await fetch(`${base}/ops/state`,{headers})).status,200);assert.equal((await fetch(`${base}/ready`)).status,200);ready=false;const failed=await fetch(`${base}/ready`);assert.equal(failed.status,503);assert.doesNotMatch(await failed.text(),/sensitive|password/);assert.equal((await fetch(`${base}/live`)).status,200);
 delete process.env.OPS_API_KEY;assert.equal((await fetch(`${base}/ops/state`)).status,404);
});
test('detects held work, retains bounded redacted IDs and exposes pressure counters while probes bypass saturation',async t=>{
 process.env.OPS_API_KEY=opsKey;process.env.OPS_STUCK_MS='1';let release:()=>void=()=>{};const held=new Promise<void>(r=>release=r),tel=new Telemetry('bounded',10),policy=new HttpPolicy(1,1000);const url=await listen(t,tel,async(req,res)=>{try{const done=policy.admit('local');res.once('close',done);res.once('finish',done);if(req.url==='/hold')await held;operationalEvent('sse_backpressure');res.end();}catch(e){res.writeHead(e instanceof HttpError?e.status:500).end();}});
 t.after(()=>{delete process.env.OPS_STUCK_MS;release();});const pending=fetch(`${url}/hold`,{headers:{'X-Request-Id':'private_customer_name'}});while(!tel.snapshot().active.length)await delay(2);await delay(5);assert.equal((await fetch(`${url}/hold`)).status,429);assert.equal((await fetch(`${url}/live`)).status,200);const state=tel.snapshot();assert.ok(state.alerts.includes('STUCK_WORK'));assert.ok(state.stuck.some(s=>s.requestId===diagnosticId('private_customer_name')));assert.doesNotMatch(JSON.stringify(state),/private_customer_name/);release();await (await pending).text();for(let i=0;i<15;i++)await (await fetch(url)).text();assert.equal(tel.snapshot().retention.stored,10);assert.ok(tel.snapshot().alerts.includes('SSE_BACKPRESSURE'));assert.match(tel.prometheus(),/cityside_capacity_rejections_total\{[^\n]*\} 1/);
});
test('concurrent trace contexts are isolated and invalid parents are replaced',async t=>{
 const tel=new Telemetry('isolation');const url=await listen(t,tel,async(_q,res)=>{const before={...correlation()};await delay(Math.random()*10);assert.deepEqual(correlation(),before);res.end();});
 const ids=Array.from({length:20},()=>randomUUID());await Promise.all(ids.map(id=>fetch(url,{headers:{'X-Request-Id':id,traceparent:'00-'+ '0'.repeat(32)+'-'+ '0'.repeat(16)+'-01'}}).then(r=>r.text())));const spans=tel.snapshot().spans;assert.equal(new Set(spans.map(s=>s.traceId)).size,20);assert.deepEqual(new Set(spans.map(s=>s.requestId)),new Set(ids));assert.ok(spans.every(s=>!s.parentSpanId));
});

test('real SSE writer overflow emits an operational signal before disconnecting',async t=>{
 const telemetry=new Telemetry('sse-writer');let destroyed=false;
 const response=Object.assign(new EventEmitter(),{writableLength:0,write:()=>false,destroy:()=>{destroyed=true;}}) as unknown as import('node:http').ServerResponse;
 const url=await listen(t,telemetry,(_req,res)=>{const writer=new StreamWriter(response,16);writer.send('queued');writer.send('x'.repeat(20));res.end();});await(await fetch(url)).text();assert.equal(destroyed,true);assert.equal(telemetry.snapshot().counters.sse_backpressure,1);
});
