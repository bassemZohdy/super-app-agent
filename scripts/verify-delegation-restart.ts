/** Controlled normal broker upgrade. Hashes authority records without exposing their content or touching funds. */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
const docker=(args:string[])=>new Promise<string>((done,fail)=>{const child=spawn('docker',['compose','-f','docker-compose.demo.yml',...args],{stdio:['ignore','pipe','pipe']});let out='',err='';child.stdout.on('data',d=>out=(out+d).slice(-50000));child.stderr.on('data',d=>err=(err+d).slice(-3000));child.once('error',fail);child.once('exit',code=>code===0?done(out):fail(new Error(`Broker preservation command failed (${code}): ${err}`)));});
const inspect=String.raw`import {DatabaseSync} from 'node:sqlite';import {createHash} from 'node:crypto';
const db=new DatabaseSync(process.env.DELEGATION_DB_PATH,{readOnly:true}),tables=['grants','bindings','jobs','audit'],rows=tables.map(t=>db.prepare('SELECT * FROM '+t+' ORDER BY rowid').all());
console.log(JSON.stringify({counts:Object.fromEntries(tables.map((t,i)=>[t,rows[i].length])),hash:createHash('sha256').update(JSON.stringify(rows)).digest('hex')}));db.close();`;
const snapshot=async()=>JSON.parse(await docker(['run','--rm','--no-deps','delegation-broker','node','--input-type=module','-e',inspect]));
let resumed=false;
try{
  console.log('Brief broker restart: preserve the existing authority database and issuer keys; avoid concurrent delegation actions.');
  await docker(['stop','delegation-broker']);const before=await snapshot();await docker(['up','-d','--no-deps','delegation-broker']);resumed=true;
  let ready=false;for(let n=0;n<40;n++){try{ready=(await fetch('http://127.0.0.1:4010/health',{signal:AbortSignal.timeout(1000)})).ok;}catch{}if(ready)break;await new Promise(done=>setTimeout(done,250));}assert.equal(ready,true,'Broker readiness failed');
  const after=await snapshot();assert.deepEqual(after,before,'Broker restart changed an existing grant, binding, job or audit record.');
  console.log(`PASS: existing grants (${after.counts.grants}), token bindings (${after.counts.bindings}), jobs (${after.counts.jobs}) and audit records (${after.counts.audit}) are byte-preserved; no consent or money effect was created.`);
}finally{if(!resumed)await docker(['up','-d','--no-deps','delegation-broker']);}
