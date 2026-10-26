/** Guarded scenario controls (SIM-05): run-scoped failpoint arming for the isolated
 *  simulator run. Installed only where the issuer run anchor exists; only the run's
 *  exact operator may arm, clear or inspect; the failpoint registry is a fixed list,
 *  so no arbitrary operation, URL or body can be injected. Status output is redacted
 *  counters only; nothing here moves funds or touches normal demo data. */
import { randomUUID } from 'node:crypto';
import type { AccountDatabase } from './database.ts';
import { FAILPOINTS, armFailpoint, clearFailpoints, failpointFirings, failpointRemaining, type FailpointName } from './failpoints.ts';
import type { IssuerScenarios } from './issuer-scenarios.ts';
import { redact } from '../../../packages/backend-kit/src/redact.ts';

export type ScenarioArmInput = { name: string; times?: number; requestKey: string };

/** Request schema for asking the host to reset the run; only a bounded operator key is accepted. */
export const scenarioResetSchema={type:'object',properties:{requestKey:{type:'string',pattern:'^[A-Za-z0-9_-]{8,100}$',minLength:8,maxLength:100}},required:['requestKey'],additionalProperties:false};

export class ScenarioControlError extends Error { readonly status:number; readonly code:string;
  constructor(status:number,code:string,message:string){super(message);this.status=status;this.code=code;} }
const deny=(code:string,message:string,status=409):never=>{throw new ScenarioControlError(status,code,message);};

/** Request schema for arming a failpoint over HTTP; derived from the registry so a new failpoint is armable without a second edit. */
export const scenarioArmSchema={type:'object',properties:{name:{type:'string',enum:[...FAILPOINTS]},times:{type:'integer',minimum:1,maximum:100},requestKey:{type:'string',pattern:'^[A-Za-z0-9_-]{8,100}$',minLength:8,maxLength:100}},required:['name','requestKey'],additionalProperties:false};

export class ScenarioControls{
  readonly store:AccountDatabase;readonly run:IssuerScenarios;
  constructor(store:AccountDatabase,run:IssuerScenarios){
    if(!store.issuerScenarios||store.issuerScenarios!==run)throw new Error('Scenario controls require the isolated issuer run anchor.');
    this.store=store;this.run=run;
    store.db.exec(`CREATE TABLE IF NOT EXISTS scenario_control_audit(id TEXT PRIMARY KEY,body TEXT NOT NULL);
      CREATE TRIGGER IF NOT EXISTS scenario_control_audit_no_update BEFORE UPDATE ON scenario_control_audit BEGIN SELECT RAISE(ABORT,'Scenario control audit is immutable');END;
      CREATE TRIGGER IF NOT EXISTS scenario_control_audit_no_delete BEFORE DELETE ON scenario_control_audit BEGIN SELECT RAISE(ABORT,'Scenario control audit is immutable');END;
      CREATE TABLE IF NOT EXISTS scenario_control_requests(key TEXT PRIMARY KEY,fingerprint TEXT NOT NULL,body TEXT NOT NULL);`);
  }
  private operator(subject:string){this.run.operator(subject);}
  private audit(subject:string,event:string,body:Record<string,unknown>){
    this.store.db.prepare('INSERT INTO scenario_control_audit VALUES(?,?)').run(`scenario_${randomUUID()}`,
      JSON.stringify({at:new Date().toISOString(),runId:this.run.context.runId,operatorSub:subject,event,...body}));
  }
  /** Arm one named failpoint for its next `times` hits. Exact request-key retries replay. */
  arm(subject:string,input:ScenarioArmInput){
    this.operator(subject);
    if(!FAILPOINTS.includes(input.name as FailpointName))return deny('SCENARIO_CONTROL_INVALID','Arm one of the named failpoints; arbitrary operations cannot be injected.',400);
    const times=input.times??1;
    if(!Number.isInteger(times)||times<1||times>100)return deny('SCENARIO_CONTROL_INVALID','Failpoint count must be 1 to 100.',400);
    if(!/^[A-Za-z0-9_-]{8,100}$/.test(input.requestKey))return deny('SCENARIO_CONTROL_INVALID','Use a bounded operator request key.',400);
    const fingerprint=JSON.stringify(['arm',input.name,times]);
    return this.store.transaction(()=>{
      const prior=this.store.db.prepare('SELECT fingerprint,body FROM scenario_control_requests WHERE key=?').get(input.requestKey);
      if(prior){if(prior.fingerprint!==fingerprint)return deny('SCENARIO_CONTROL_CONFLICT','This operator request key already has different terms.');return JSON.parse(String(prior.body));}
      armFailpoint(input.name as FailpointName,times);
      const result={armed:{name:input.name,times,fired:0}};
      this.audit(subject,'ARMED',{name:input.name,times});
      this.store.db.prepare('INSERT OR IGNORE INTO scenario_control_requests VALUES(?,?,?)').run(input.requestKey,fingerprint,JSON.stringify(result));
      return result;
    });
  }
  /** Clear every armed failpoint and fired counters. */
  clear(subject:string){
    this.operator(subject);
    return this.store.transaction(()=>{
      const before=FAILPOINTS.map(name=>({name,fired:failpointFirings(name)})).filter(entry=>entry.fired>0);
      clearFailpoints();
      this.audit(subject,'CLEARED',{fired:before});
      return {cleared:true};
    });
  }
  /** Ask the host to replace this run's database with a fresh, reseeded one. The server cannot swap its own store, so this only
   *  validates the operator, drops armed failpoints and records the request; `fresh` is true once per request key and the
   *  caller hands that to the host. Sealed journals block an in-place restore, so nothing here deletes rows. */
  reset(subject:string,requestKey:string){
    this.operator(subject);
    if(!/^[A-Za-z0-9_-]{8,100}$/.test(requestKey))return deny('SCENARIO_CONTROL_INVALID','Use a bounded operator request key.',400);
    return this.store.transaction(()=>{
      const prior=this.store.db.prepare('SELECT fingerprint,body FROM scenario_control_requests WHERE key=?').get(requestKey);
      if(prior){if(prior.fingerprint!==JSON.stringify(['reset']))return deny('SCENARIO_CONTROL_CONFLICT','This operator request key already has different terms.');return {...JSON.parse(String(prior.body)),fresh:false};}
      clearFailpoints();
      const result={resetRequested:true,runId:this.run.context.runId};
      this.audit(subject,'RESET_REQUESTED',{});
      this.store.db.prepare('INSERT OR IGNORE INTO scenario_control_requests VALUES(?,?,?)').run(requestKey,JSON.stringify(['reset']),JSON.stringify(result));
      return {...result,fresh:true};
    });
  }
  /** Redacted counters for the run: which boundaries are armed and how often they fired. */
  /** Run-wide funds, holds and orders belong to the run's operator alone: the route calls this before it builds the inspection. */
  authorizeInspection(subject:string){this.operator(subject);}
  /** The run's inspection for the operator to keep, with secrets redacted. It reads only: nothing here changes the run. */
  export(subject:string,inspection:Record<string,unknown>){
    this.operator(subject);
    return {runId:this.run.context.runId,exported:redact({...inspection,runId:this.run.context.runId})};
  }
  status(subject:string){
    this.operator(subject);
    return {runId:this.run.context.runId,
      armed:FAILPOINTS.map(name=>({name,fired:failpointFirings(name),remaining:failpointRemaining(name)})),
      audit:this.store.db.prepare('SELECT body FROM scenario_control_audit ORDER BY rowid DESC LIMIT 50').all().map(r=>JSON.parse(String(r.body)))};
  }
}

export function hasScenarioControls(store:AccountDatabase){return !!store.db.prepare("SELECT name FROM sqlite_master WHERE name='scenario_control_audit'").get();}
