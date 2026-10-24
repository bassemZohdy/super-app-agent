import { providerPaymentsUrl } from './endpoints.ts';
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
type Snapshot={obligationInstalled:boolean;obligationHash:string;obligationCount:number;attemptCount:number;eligibilityHash:string;eligibilityRows:number;eligibilityInstalled:boolean;pendingSchema:boolean;scenarioInstalled:boolean;eventHash:string;eventCount:number;refundHash:string;cardRefundHash:string;refundCount:number;groupHash:string;groupCount:number;fundingHash:string;fundingCount:number;issuerHash:string;hash:string;wallets:number;journal:boolean;entries:number;opening:number;invalid:number;projectionMismatch:number;backupExists:boolean;claims:boolean;claimRows:number;unknownClaims:number;legacyCaptures:number;claimsBackupExists:boolean;orderHash:string;orderCount:number;captureSchema:boolean;orderBackupExists:boolean};
const inspect=String.raw`
import { DatabaseSync } from 'node:sqlite';import { existsSync } from 'node:fs';import { createHash } from 'node:crypto';
const base=process.env.PROVIDER_DB_PATH; if(!base)throw new Error('Provider database path required');
const path=process.argv[1]==='backup'?base+'.before-ledger-v1.sqlite':process.argv[1]==='claims-backup'?base+'.before-settlement-claims-v1.sqlite':process.argv[1]==='order-backup'?base+'.before-order-capture-v2.sqlite':base;const db=new DatabaseSync(path,{readOnly:true});
const rows=db.prepare('SELECT account_id,kind,id,body FROM resources ORDER BY account_id,kind,id').all();
const keys=db.prepare('SELECT account_id,key,fingerprint,status,body FROM idempotency ORDER BY account_id,key').all();
const journal=!!db.prepare("SELECT name FROM sqlite_master WHERE name='payment_journal_entries'").get();
const scalar=sql=>Number(db.prepare(sql).get().n);
const claims=!!db.prepare("SELECT name FROM sqlite_master WHERE name='payment_settlement_claims'").get();
const orderTable=db.prepare("SELECT sql FROM sqlite_master WHERE name='payment_authorization_orders'").get();const orderRows=orderTable?db.prepare('SELECT * FROM payment_authorization_orders ORDER BY id').all():[];
const fundingExists=!!db.prepare("SELECT name FROM sqlite_master WHERE name='wallet_funding_orders'").get(),fundingRows=fundingExists?db.prepare('SELECT * FROM wallet_funding_orders ORDER BY id').all():[];
const issuerExists=!!db.prepare("SELECT name FROM sqlite_master WHERE name='payment_card_authorizations'").get(),issuerRows=issuerExists?db.prepare('SELECT * FROM payment_card_authorizations ORDER BY id').all():[];
const groupsExist=!!db.prepare("SELECT name FROM sqlite_master WHERE name='payment_checkout_groups'").get(),groupRows=groupsExist?db.prepare('SELECT * FROM payment_checkout_groups ORDER BY id').all():[];
const refundsExist=!!db.prepare("SELECT name FROM sqlite_master WHERE name='payment_refunds'").get(),refundRows=refundsExist?db.prepare('SELECT * FROM payment_refunds ORDER BY id').all():[];
const cardRefundsExist=!!db.prepare("SELECT name FROM sqlite_master WHERE name='payment_card_refunds'").get(),cardRefundRows=cardRefundsExist?db.prepare('SELECT * FROM payment_card_refunds ORDER BY id').all():[];
const eventsExist=!!db.prepare("SELECT name FROM sqlite_master WHERE name='payment_event_outbox'").get(),eventRows=eventsExist?db.prepare('SELECT id,body,content_hash FROM payment_event_outbox ORDER BY id').all():[];
const pendingSchema=['payment_card_authorizations','payment_authorization_orders','wallet_funding_orders'].every(table=>{const row=db.prepare("SELECT sql FROM sqlite_master WHERE name=?").get(table);return !!row&&row.sql.includes(table==='payment_card_authorizations'?"'PENDING'":"'AUTHORIZATION_PENDING'");});
const scenarioInstalled=!!db.prepare("SELECT name FROM sqlite_master WHERE name='issuer_scenario_runs'").get();
const eligibilityTables=['payment_owner_eligibility','payment_membership_eligibility','payment_eligibility_audit','payment_eligibility_requests'];
const eligibilityRows=eligibilityTables.map(name=>db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(name)?db.prepare('SELECT * FROM '+name+' ORDER BY 1').all():[]);
const eligibilityHash=createHash('sha256').update(JSON.stringify(eligibilityRows)).digest('hex');
const obligationTables=['payment_order_obligations','payment_capture_attempts'];
const obligationRows=obligationTables.map(name=>db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(name)?db.prepare('SELECT * FROM '+name+' ORDER BY 1,2,3').all():[]);
const obligationInstalled=obligationTables.every(name=>!!db.prepare("SELECT name FROM sqlite_master WHERE name=?").get(name)),obligationHash=createHash('sha256').update(JSON.stringify(obligationRows)).digest('hex');
const value={obligationInstalled,obligationHash,obligationCount:obligationRows[0].length,attemptCount:obligationRows[1].length,eligibilityHash,eligibilityRows:eligibilityRows.reduce((n,r)=>n+r.length,0),eligibilityInstalled:eligibilityTables.every(name=>!!db.prepare("SELECT name FROM sqlite_master WHERE name=?").get(name)),pendingSchema,scenarioInstalled,eventHash:createHash('sha256').update(JSON.stringify(eventRows)).digest('hex'),eventCount:eventRows.length,refundHash:createHash('sha256').update(JSON.stringify(refundRows)).digest('hex'),cardRefundHash:createHash('sha256').update(JSON.stringify(cardRefundRows)).digest('hex'),refundCount:refundRows.length,groupHash:createHash('sha256').update(JSON.stringify(groupRows)).digest('hex'),groupCount:groupRows.length,fundingHash:createHash('sha256').update(JSON.stringify(fundingRows)).digest('hex'),fundingCount:fundingRows.length,issuerHash:createHash('sha256').update(JSON.stringify(issuerRows)).digest('hex'),orderHash:createHash('sha256').update(JSON.stringify(orderRows)).digest('hex'),orderCount:orderRows.length,captureSchema:!!orderTable&&orderTable.sql.includes("'CAPTURING'"),orderBackupExists:existsSync(base+'.before-order-capture-v2.sqlite'),claims,claimRows:claims?scalar('SELECT count(*) n FROM payment_settlement_claims'):0,unknownClaims:claims?scalar("SELECT count(*) n FROM payment_settlement_claims WHERE state='LEGACY_UNKNOWN'"):0,legacyCaptures:rows.filter(r=>{if(r.kind!=='charge')return false;const c=JSON.parse(r.body);return c.status==='CAPTURED'&&!c.refunded&&['rta','dewa','etisalat','du','police'].includes(c.merchant);}).length,claimsBackupExists:existsSync(base+'.before-settlement-claims-v1.sqlite'),hash:createHash('sha256').update(JSON.stringify([rows,keys])).digest('hex'),wallets:rows.filter(r=>r.kind==='wallet').length,journal,
entries:journal?scalar('SELECT count(*) n FROM payment_journal_entries'):0,opening:journal?scalar("SELECT count(*) n FROM payment_journal_entries WHERE kind='OPENING'"):0,
invalid:journal?scalar('SELECT count(*) n FROM (SELECT e.id FROM payment_journal_entries e LEFT JOIN payment_journal_postings p ON e.id=p.entry_id GROUP BY e.id HAVING e.finalized<>1 OR count(p.line)<>2 OR coalesce(sum(p.amount_minor),0)<>0)'):0,
projectionMismatch:journal?scalar("SELECT count(*) n FROM resources r WHERE r.kind='wallet' AND json_extract(r.body,'$.balanceMinor')<>(SELECT coalesce(sum(p.amount_minor),0) FROM payment_journal_entries e JOIN payment_journal_postings p ON e.id=p.entry_id WHERE e.account_id=r.account_id AND e.finalized=1 AND p.ledger_account='wallet')"):0,
backupExists:existsSync(base+'.before-ledger-v1.sqlite')};db.close();console.log(JSON.stringify(value));`;
async function snapshot(mode='live'):Promise<Snapshot> {
  return JSON.parse(await docker(['run','--rm','--no-deps','provider-payments','node','--input-type=module','-e',inspect,mode],true));
}
const financialProviders=['provider-payments','provider-rta','provider-dewa','provider-etisalat','provider-du','provider-police','service-ride','service-food','service-wallet','service-telecom'];
console.log('Serial local check: source/payment providers pause briefly; avoid concurrent money-changing demo actions.');
let resumed=false;
try {
  await docker(['stop',...financialProviders]);const before=await snapshot();
  await docker(['up','-d','--force-recreate',...financialProviders]);resumed=true;
  let ready=false;
  for(let i=0;i<40;i++) {try{ready=(await fetch(`${providerPaymentsUrl}/health`,{signal:AbortSignal.timeout(1500)})).ok;}catch{}if(ready)break;await delay(500);}
  assert.equal(ready,true,'Payment provider failed its migration/startup gate.');
  const after=await snapshot();assert.equal(after.hash,before.hash,'Migration/restart changed business or idempotency records.');
  assert.equal(after.obligationInstalled,true);if(before.obligationInstalled)assert.equal(after.obligationHash,before.obligationHash);console.log(`PASS: business obligation/capture-attempt tables contain ${after.obligationCount}/${after.attemptCount} rows; original financial/order bytes remain unchanged.`);
  assert.equal(after.eligibilityInstalled,true);assert.equal(after.eligibilityHash,before.eligibilityHash);console.log(`PASS: additive eligibility tables preserve ${after.eligibilityRows} existing permission/audit/request rows without reseeding owners or rewriting reviews.`);
  assert.equal(after.journal,true);assert.equal(after.opening,after.wallets);assert.equal(after.invalid,0);assert.equal(after.projectionMismatch,0);
  if(!before.journal&&before.wallets) {assert.equal(after.backupExists,true);const backup=await snapshot('backup');assert.equal(backup.hash,before.hash);assert.equal(after.entries,after.opening);console.log('PASS: live legacy migration preserves resource/idempotency rows and creates a matching readable pre-migration backup.');}
  else {assert.equal(after.entries,before.entries);console.log(before.journal ? 'PASS: journal restart preserves resource/idempotency rows without another opening or financial entry.' : 'PASS: an empty journal initializes without creating wallet funds.');}
  assert.equal(after.claims,true);
  if(!before.claims){assert.equal(after.claimRows,before.legacyCaptures);assert.equal(after.unknownClaims,before.legacyCaptures);if(before.legacyCaptures){assert.equal(after.claimsBackupExists,true);assert.equal((await snapshot('claims-backup')).hash,before.hash);}console.log(`PASS: ${after.unknownClaims} historical captures conservatively locked as unknown; matching claim-migration backup and financial/idempotency rows preserved.`);}
  else {assert.equal(after.claimRows,before.claimRows);assert.equal(after.unknownClaims,before.unknownClaims);console.log('PASS: settlement-claim restart does not duplicate or release historical claims.');}
  assert.equal(after.pendingSchema,true);assert.equal(after.scenarioInstalled,false);console.log('PASS: pending-aware schemas installed without arming issuer scenario controls in normal data.');
  assert.equal(after.eventHash,before.eventHash);assert.equal(after.eventCount,before.eventCount);console.log(`PASS: ${after.eventCount} immutable outbox events retained; no history backfill or new money effect.`);
  assert.equal(after.refundHash,before.refundHash);assert.equal(after.cardRefundHash,before.cardRefundHash);console.log(`PASS: ${after.refundCount} refunds and original-card returns preserved without a new reversal.`);
  assert.equal(after.groupHash,before.groupHash);console.log(`PASS: ${after.groupCount} checkout groups preserved without new child orders or money effects.`);
  assert.equal(after.fundingHash,before.fundingHash);assert.equal(after.issuerHash,before.issuerHash);console.log(`PASS: ${after.fundingCount} funding reviews and existing issuer authorizations preserved without a new capture/credit.`);
  assert.equal(after.captureSchema,true);assert.equal(after.orderHash,before.orderHash);assert.equal(after.orderCount,before.orderCount);
  if(!before.captureSchema&&before.orderCount){assert.equal(after.orderBackupExists,true);assert.equal((await snapshot('order-backup')).orderHash,before.orderHash);}
  console.log(`PASS: ${after.orderCount} stored reviews preserve exact IDs/snapshots through capture-schema migration/reopen.`);
  await docker(['up','-d','--no-deps','--force-recreate','agent-core','service-profile','service-catalog','provider-dld']);
  console.log(`PASS: ${after.wallets} wallets have one balanced opening each; sealed entries and wallet projections reconcile.`);
} finally {if(!resumed)await docker(['up','-d','--force-recreate',...financialProviders]);}
