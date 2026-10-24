/** Controlled local migration/restart proof. Hashes business rows, never prints their contents. */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
const compose=['compose','-f','docker-compose.demo.yml'];
async function docker(args:string[],quiet=false) {
  return new Promise<string>((resolve,reject)=>{
    const child=spawn('docker',[...compose,...args],{stdio:['ignore','pipe','pipe']});let stdout='',stderr='';
    child.stdout.on('data',d=>{stdout=(stdout+d).slice(-100000);if(!quiet)process.stdout.write(d);});child.stderr.on('data',d=>{stderr=(stderr+d).slice(-4000);if(!quiet)process.stderr.write(d);});
    child.once('error',reject);child.once('exit',code=>code===0?resolve(stdout):reject(new Error(`Payment journal verification command failed (${code}). ${stderr.includes('permission denied')?'Docker access was denied.':'Inspect the provider logs.'}`)));
  });
}
type Snapshot={hash:string;wallets:number;journal:boolean;entries:number;opening:number;invalid:number;projectionMismatch:number;backupExists:boolean};
const inspect=String.raw`
import { DatabaseSync } from 'node:sqlite';import { existsSync } from 'node:fs';import { createHash } from 'node:crypto';
const base=process.env.PROVIDER_DB_PATH; if(!base)throw new Error('Provider database path required');
const path=process.argv[1]==='backup'?base+'.before-ledger-v1.sqlite':base;const db=new DatabaseSync(path,{readOnly:true});
const rows=db.prepare('SELECT account_id,kind,id,body FROM resources ORDER BY account_id,kind,id').all();
const keys=db.prepare('SELECT account_id,key,fingerprint,status,body FROM idempotency ORDER BY account_id,key').all();
const journal=!!db.prepare("SELECT name FROM sqlite_master WHERE name='payment_journal_entries'").get();
const scalar=sql=>Number(db.prepare(sql).get().n);
const value={hash:createHash('sha256').update(JSON.stringify([rows,keys])).digest('hex'),wallets:rows.filter(r=>r.kind==='wallet').length,journal,
entries:journal?scalar('SELECT count(*) n FROM payment_journal_entries'):0,opening:journal?scalar("SELECT count(*) n FROM payment_journal_entries WHERE kind='OPENING'"):0,
invalid:journal?scalar('SELECT count(*) n FROM (SELECT e.id FROM payment_journal_entries e LEFT JOIN payment_journal_postings p ON e.id=p.entry_id GROUP BY e.id HAVING e.finalized<>1 OR count(p.line)<>2 OR coalesce(sum(p.amount_minor),0)<>0)'):0,
projectionMismatch:journal?scalar("SELECT count(*) n FROM resources r WHERE r.kind='wallet' AND json_extract(r.body,'$.balanceMinor')<>(SELECT coalesce(sum(p.amount_minor),0) FROM payment_journal_entries e JOIN payment_journal_postings p ON e.id=p.entry_id WHERE e.account_id=r.account_id AND e.finalized=1 AND p.ledger_account='wallet')"):0,
backupExists:existsSync(base+'.before-ledger-v1.sqlite')};db.close();console.log(JSON.stringify(value));`;
async function snapshot(mode='live'):Promise<Snapshot> {
  return JSON.parse(await docker(['run','--rm','--no-deps','provider-payments','node','--input-type=module','-e',inspect,mode],true));
}
console.log('Serial local check: payment provider pauses briefly; avoid concurrent money-changing demo actions.');
let resumed=false;
try {
  await docker(['stop','provider-payments']);const before=await snapshot();
  await docker(['up','-d','provider-payments']);resumed=true;
  let ready=false;
  for(let i=0;i<40;i++) {try{ready=(await fetch('http://localhost:4107/health',{signal:AbortSignal.timeout(1500)})).ok;}catch{}if(ready)break;await delay(500);}
  assert.equal(ready,true,'Payment provider failed its migration/startup gate.');
  const after=await snapshot();assert.equal(after.hash,before.hash,'Migration/restart changed business or idempotency records.');
  assert.equal(after.journal,true);assert.equal(after.opening,after.wallets);assert.equal(after.invalid,0);assert.equal(after.projectionMismatch,0);
  if(!before.journal&&before.wallets) {assert.equal(after.backupExists,true);const backup=await snapshot('backup');assert.equal(backup.hash,before.hash);assert.equal(after.entries,after.opening);console.log('PASS: live legacy migration preserves resource/idempotency rows and creates a matching readable pre-migration backup.');}
  else {assert.equal(after.entries,before.entries);console.log(before.journal ? 'PASS: journal restart preserves resource/idempotency rows without another opening or financial entry.' : 'PASS: an empty journal initializes without creating wallet funds.');}
  await docker(['restart','agent-core']);
  console.log(`PASS: ${after.wallets} wallets have one balanced opening each; sealed entries and wallet projections reconcile.`);
} finally {if(!resumed)await docker(['up','-d','provider-payments']);}
