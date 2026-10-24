/** Isolated preview scenarios. Business time is instance data, never a global/security clock. */
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
const DAY=86400000,MAX_ADVANCE=31*DAY,MAX_DURATION=366*DAY;
export class SimulationError extends Error {
  readonly status:number;readonly code:string;
  constructor(status:number,code:string,message:string){super(message);this.status=status;this.code=code;}
}
const fail=(status:number,code:string,message:string):never=>{throw new SimulationError(status,code,message);};
export type PreviewFixture={id:string;kind:'bill-due'|'toll-low'|'parking-expiring'|'renewal-due';provider:string;reference:string;amountMinor:number;dueAt:string};
export type PreviewEvent={id:string;kind:PreviewFixture['kind'];dueAt:string;fixture:PreviewFixture;previewOnly:true};
export type SimulationSnapshot={id:string;seed:string;previewOnly:true;businessAt:string;initialAt:string;revision:number;generation:number;fixtures:PreviewFixture[];events:PreviewEvent[];replayed?:boolean};
type RunRow={id:string;owner:string;seed:string;initial_at:number;business_at:number;revision:number;generation:number};
const digest=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const validKey=(key:string)=>{if(typeof key!=='string'||!/^[A-Za-z0-9_-]{8,100}$/.test(key))fail(400,'INVALID_REQUEST_KEY','Use a request key of 8–100 letters, digits, underscores or hyphens.');};
export class SimulationRuns {
  readonly db:DatabaseSync;
  constructor(path:string){
    if(path!==':memory:')mkdirSync(dirname(path),{recursive:true});this.db=new DatabaseSync(path);
    this.db.exec('PRAGMA foreign_keys=ON;PRAGMA journal_mode=WAL;PRAGMA busy_timeout=5000;');
    if(this.db.prepare("SELECT name FROM sqlite_master WHERE name='simulation_meta'").get()){
      const v=this.db.prepare('SELECT version FROM simulation_meta').get();if(v?.version!==1)throw new Error('Unsupported preview scenario schema.');return;
    }
    this.atomic(()=>this.db.exec(`
      CREATE TABLE simulation_meta(version INTEGER PRIMARY KEY CHECK(version=1));INSERT INTO simulation_meta VALUES(1);
      CREATE TABLE simulation_runs(id TEXT PRIMARY KEY,owner TEXT NOT NULL,seed TEXT NOT NULL,initial_at INTEGER NOT NULL,business_at INTEGER NOT NULL,revision INTEGER NOT NULL,generation INTEGER NOT NULL);
      CREATE TABLE simulation_create_keys(owner TEXT NOT NULL,key TEXT NOT NULL,fingerprint TEXT NOT NULL,run_id TEXT NOT NULL REFERENCES simulation_runs(id),PRIMARY KEY(owner,key));
      CREATE TABLE simulation_fixtures(run_id TEXT NOT NULL REFERENCES simulation_runs(id),id TEXT NOT NULL,due_at INTEGER NOT NULL,body TEXT NOT NULL,PRIMARY KEY(run_id,id));
      CREATE TABLE simulation_events(run_id TEXT NOT NULL REFERENCES simulation_runs(id),id TEXT NOT NULL,body TEXT NOT NULL,PRIMARY KEY(run_id,id));
      CREATE TABLE simulation_requests(run_id TEXT NOT NULL REFERENCES simulation_runs(id),key TEXT NOT NULL,fingerprint TEXT NOT NULL,result TEXT NOT NULL,PRIMARY KEY(run_id,key));
    `));
  }
  private atomic<T>(fn:()=>T):T {this.db.exec('BEGIN IMMEDIATE');try{const r=fn();this.db.exec('COMMIT');return r;}catch(e){this.db.exec('ROLLBACK');throw e;}}
  private owner(owner:string){if(typeof owner!=='string'||!owner||owner.length>200||/[\x00-\x1f\x7f]/.test(owner))fail(400,'INVALID_OWNER','A trusted owner identity is required.');}
  private run(owner:string,id:string):RunRow {
    this.owner(owner);const row=this.db.prepare('SELECT * FROM simulation_runs WHERE id=? AND owner=?').get(id,owner) as RunRow|undefined;
    if(!row) return fail(404,'RUN_NOT_FOUND','Preview run not found for this owner.');return row;
  }
  private seedFixtures(run:RunRow) {
    const hash=digest(run.seed).slice(0,12),variation=parseInt(hash.slice(0,4),16)%1000;
    const definitions:Array<[PreviewFixture['kind'],string,number,number]>=[['bill-due','dewa',42040+variation,60000],['toll-low','rta',10000,120000],['parking-expiring','rta',400,180000],['renewal-due','etisalat',29900,DAY]];
    const insert=this.db.prepare('INSERT INTO simulation_fixtures VALUES(?,?,?,?)');
    for(const [kind,provider,amountMinor,offset] of definitions){const fixture:PreviewFixture={id:`fixture_${hash}_${kind}`,kind,provider,reference:`PREVIEW-${hash}-${kind}`,amountMinor,dueAt:new Date(run.initial_at+offset).toISOString()};insert.run(run.id,fixture.id,run.initial_at+offset,JSON.stringify(fixture));}
  }
  create(owner:string,seed:string,initialAt:number,key:string):SimulationSnapshot {
    this.owner(owner);validKey(key);
    if(typeof seed!=='string'||!/^[A-Za-z0-9_-]{1,64}$/.test(seed)||!Number.isSafeInteger(initialAt)||initialAt<Date.UTC(2020,0,1)||initialAt>Date.UTC(2098,0,1))fail(400,'INVALID_SCENARIO','Use a bounded seed and a start date between 2020 and 2098.');
    return this.atomic(()=>{
      const fingerprint=digest([seed,initialAt]),existing=this.db.prepare('SELECT fingerprint,run_id FROM simulation_create_keys WHERE owner=? AND key=?').get(owner,key);
      if(existing){if(existing.fingerprint!==fingerprint)fail(409,'REQUEST_CONFLICT','This request key has a different scenario.');return {...this.snapshot(owner,String(existing.run_id)),replayed:true};}
      const count=this.db.prepare('SELECT count(*) AS count FROM simulation_runs WHERE owner=?').get(owner) as {count:number};if(count.count>=32)fail(409,'RUN_LIMIT','At most 32 preview runs per owner are supported.');
      const run:RunRow={id:`simrun_${randomUUID()}`,owner,seed,initial_at:initialAt,business_at:initialAt,revision:1,generation:1};
      this.db.prepare('INSERT INTO simulation_runs VALUES(?,?,?,?,?,?,?)').run(run.id,owner,seed,initialAt,initialAt,1,1);this.seedFixtures(run);
      this.db.prepare('INSERT INTO simulation_create_keys VALUES(?,?,?,?)').run(owner,key,fingerprint,run.id);return this.snapshot(owner,run.id);
    });
  }
  snapshot(owner:string,id:string):SimulationSnapshot {
    return this.db.isTransaction ? this.readSnapshot(owner,id) : this.atomic(()=>this.readSnapshot(owner,id));
  }
  clock(owner:string,id:string):()=>number { this.run(owner,id); return ()=>this.run(owner,id).business_at; }
  private readSnapshot(owner:string,id:string):SimulationSnapshot {
    const run=this.run(owner,id);
    const fixtures=this.db.prepare('SELECT body FROM simulation_fixtures WHERE run_id=? ORDER BY due_at,id').all(id).map(r=>JSON.parse(String(r.body)) as PreviewFixture);
    const events=this.db.prepare('SELECT body FROM simulation_events WHERE run_id=? ORDER BY rowid').all(id).map(r=>JSON.parse(String(r.body)) as PreviewEvent);
    return {id:run.id,seed:run.seed,previewOnly:true,businessAt:new Date(run.business_at).toISOString(),initialAt:new Date(run.initial_at).toISOString(),revision:run.revision,generation:run.generation,fixtures,events};
  }
  private mutate(owner:string,id:string,expectedRevision:number,key:string,operation:'advance'|'reset',seconds=0):SimulationSnapshot {
    validKey(key);if(!Number.isSafeInteger(expectedRevision)||expectedRevision<1)fail(400,'INVALID_REVISION','Use the current run revision.');
    if(operation==='advance'&&(!Number.isSafeInteger(seconds)||seconds<1||seconds*1000>MAX_ADVANCE))fail(400,'INVALID_ADVANCE','Advance by 1 second to 31 days per request.');
    return this.atomic(()=>{
      const run=this.run(owner,id),fingerprint=digest([operation,expectedRevision,seconds]);
      const existing=this.db.prepare('SELECT fingerprint,result FROM simulation_requests WHERE run_id=? AND key=?').get(id,key);
      if(existing){if(existing.fingerprint!==fingerprint)fail(409,'REQUEST_CONFLICT','This request key has a different operation.');return {...JSON.parse(String(existing.result)),replayed:true};}
      if(run.revision!==expectedRevision)fail(409,'RUN_CHANGED','The run changed. Read its current revision.');
      if(run.revision>=1000)fail(409,'PREVIEW_LIMIT','This preview run reached its operation limit.');
      if(operation==='reset'){
        this.db.prepare('DELETE FROM simulation_events WHERE run_id=?').run(id);this.db.prepare('DELETE FROM simulation_fixtures WHERE run_id=?').run(id);
        run.business_at=run.initial_at;run.generation++;this.seedFixtures(run);
      } else {
        const target=run.business_at+seconds*1000;if(target-run.initial_at>MAX_DURATION)fail(400,'DURATION_LIMIT','A preview run can span at most 366 business days.');
        const due=this.db.prepare('SELECT id,body FROM simulation_fixtures WHERE run_id=? AND due_at<=? ORDER BY due_at,id').all(id,target);
        const insert=this.db.prepare('INSERT OR IGNORE INTO simulation_events VALUES(?,?,?)');
        for(const row of due){const fixture=JSON.parse(String(row.body)) as PreviewFixture;const event:PreviewEvent={id:`${id}:${run.generation}:${fixture.id}`,kind:fixture.kind,dueAt:fixture.dueAt,fixture,previewOnly:true};insert.run(id,event.id,JSON.stringify(event));}
        run.business_at=target;
      }
      this.db.prepare('UPDATE simulation_runs SET business_at=?,revision=revision+1,generation=? WHERE id=?').run(run.business_at,run.generation,id);
      const result=this.snapshot(owner,id);this.db.prepare('INSERT INTO simulation_requests VALUES(?,?,?,?)').run(id,key,fingerprint,JSON.stringify(result));return result;
    });
  }
  advance(owner:string,id:string,expectedRevision:number,seconds:number,key:string){return this.mutate(owner,id,expectedRevision,key,'advance',seconds);}
  reset(owner:string,id:string,expectedRevision:number,key:string){return this.mutate(owner,id,expectedRevision,key,'reset');}
  close(){this.db.close();}
}
