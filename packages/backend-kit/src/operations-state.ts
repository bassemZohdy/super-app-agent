/** Aggregate durable work only: no owners, payloads, tokens, resource IDs or amounts leave SQLite. */
import type { DatabaseSync } from 'node:sqlite';
export function durableWork(db:DatabaseSync){
  const tables=new Set(db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(r=>String(r.name)));
  let reconciliation=0,pending=0,oldestStartedAt:number|undefined;
  if(tables.has('payment_capture_attempts')){const row=db.prepare("SELECT min(json_extract(body,'$.createdAt')) at FROM payment_capture_attempts WHERE state IN ('PREPARING','UNKNOWN','CAPTURED')").get();if(row?.at)oldestStartedAt=Date.parse(String(row.at));reconciliation+=Number(db.prepare("SELECT count(*) n FROM payment_capture_attempts WHERE state IN ('PREPARING','UNKNOWN','CAPTURED')").get()!.n);}
  if(tables.has('payment_authorization_orders'))pending+=Number(db.prepare("SELECT count(*) n FROM payment_authorization_orders WHERE state IN ('AUTHORIZATION_PENDING','CAPTURING','CAPTURED','RECONCILIATION_REQUIRED')").get()!.n);
  if(tables.has('jobs')){pending+=Number(db.prepare("SELECT count(*) n FROM jobs WHERE state!='completed'").get()!.n);const row=db.prepare("SELECT min(at) at FROM audit WHERE event='execution.started' AND json_extract(body,'$.operationId') IN (SELECT id FROM jobs WHERE state!='completed')").get();if(row?.at)oldestStartedAt=Number(row.at);}
  return {pending,reconciliation,oldestAgeMs:oldestStartedAt?Math.max(0,Date.now()-oldestStartedAt):0};
}
