import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createInterface } from 'node:readline';
const moduleUrl=new URL('../../packages/backend-kit/src/shutdown.ts',import.meta.url).href;
for(const hang of [false,true])test(`SIGTERM ${hang?'rejects a checkpoint after drain timeout':'drains the original request before successful exit'}`,async t=>{
 const code=`import http from 'node:http';import {shutdownOnSignal} from ${JSON.stringify(moduleUrl)};const s=http.createServer((q,r)=>{console.log('held');${hang?'':'setTimeout(()=>r.end("confirmed-original"),100);'}});shutdownOnSignal(s,()=>{},${hang?100:2000});s.listen(0,'127.0.0.1',()=>console.log(s.address().port));`;
 const child=spawn(process.execPath,['--experimental-strip-types','--input-type=module','-e',code],{stdio:['ignore','pipe','pipe']});t.after(()=>child.kill('SIGKILL'));const lines=createInterface({input:child.stdout});const iterator=lines[Symbol.asyncIterator]();const port=Number((await iterator.next()).value);const exited=once(child,'exit');const request=fetch(`http://127.0.0.1:${port}`).then(async r=>await r.text()).catch(()=>undefined);assert.equal((await iterator.next()).value,'held');child.kill('SIGTERM');if(!hang)assert.equal(await request,'confirmed-original');else await request;const [status]=await exited;assert.equal(status,hang?1:0);lines.close();
});
