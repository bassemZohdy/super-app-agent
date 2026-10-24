/** Run-scoped issuer configuration. Only explicitly isolated server instances install this capability. */
import { realpathSync } from 'node:fs';
import { relative,isAbsolute } from 'node:path';
import { createHash } from 'node:crypto';
import type { AccountDatabase } from './database.ts';
import type { PaymentMethod } from '../../../packages/protocol-core/src/payments.ts';
import { PaymentResourceUses } from './payment-resource-uses.ts';
export { issuerScenarioPresets,type IssuerScenarioPreset } from '../../../packages/protocol-core/src/issuer-scenarios.ts';
import { issuerScenarioPresets,type IssuerScenarioPreset } from '../../../packages/protocol-core/src/issuer-scenarios.ts';
export type IssuerScenarioContext={runId:string;operatorSub:string;root:string};
export type IssuerScenarioDecision={runId:string;revision:number;preset:IssuerScenarioPreset};
export class IssuerScenarioError extends Error{readonly status:number;readonly code:string;constructor(status:number,code:string,message:string){super(message);this.status=status;this.code=code;}}
const deny=(code:string,message:string,status=409):never=>{throw new IssuerScenarioError(status,code,message);};
export class IssuerScenarios{
  readonly store:AccountDatabase;readonly context:IssuerScenarioContext;
  constructor(store:AccountDatabase,context:IssuerScenarioContext){
    if(process.env.NODE_ENV==='production')throw new Error('Issuer scenario controls are demo-only.');
    if(!/^simrun_[a-f0-9-]{36}$/.test(context.runId)||!context.operatorSub||context.operatorSub.length>200||store.path===':memory:')throw new Error('Issuer scenarios require a persisted isolated run and explicit operator.');
    const root=realpathSync(context.root),path=realpathSync(store.path),inside=relative(root,path);
    if(inside!=='payments.sqlite'||inside.startsWith('..')||isAbsolute(inside)||!/(^|[/\\])cityside-(?:e2e|issuer)-[A-Za-z0-9_-]+$/.test(root))throw new Error('Issuer scenario database must be within its dedicated isolated run directory.');
    this.store=store;this.context={...context,root};
    store.transaction(()=>{
    const registered=store.db.prepare("SELECT name FROM sqlite_master WHERE name='issuer_scenario_runs'").get();
    const prior=registered?store.db.prepare('SELECT run_id,operator_sub,root FROM issuer_scenario_runs WHERE id=1').get():undefined;
    if(prior&&(prior.run_id!==context.runId||prior.operator_sub!==context.operatorSub||prior.root!==root))throw new Error('Issuer run identity cannot be rebound.');
    if(!prior&&['accounts','resources','idempotency'].some(table=>Number(store.db.prepare(`SELECT count(*) n FROM ${table}`).get()!.n)>0))throw new Error('A new issuer run requires a pristine database; normal/copied financial data cannot be armed.');
    store.db.exec(`CREATE TABLE IF NOT EXISTS issuer_scenario_runs(id INTEGER PRIMARY KEY CHECK(id=1),run_id TEXT NOT NULL,operator_sub TEXT NOT NULL,root TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS issuer_scenario_config(account_id TEXT NOT NULL REFERENCES accounts(id),method_id TEXT NOT NULL,revision INTEGER NOT NULL,body TEXT NOT NULL,PRIMARY KEY(account_id,method_id));
      CREATE TABLE IF NOT EXISTS issuer_scenario_requests(key TEXT PRIMARY KEY,fingerprint TEXT NOT NULL,body TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS issuer_scenario_audit(id INTEGER PRIMARY KEY,body TEXT NOT NULL);`);
    if(!prior)store.db.prepare('INSERT INTO issuer_scenario_runs VALUES(1,?,?,?)').run(context.runId,context.operatorSub,root);});
  }
  operator(subject:string){if(subject!==this.context.operatorSub)return deny('SCENARIO_OPERATOR_REQUIRED','This isolated run belongs to another operator.',403);}
  decision(account:string,source:string):IssuerScenarioDecision|undefined{const row=this.store.db.prepare('SELECT body FROM issuer_scenario_config WHERE account_id=? AND method_id=?').get(account,source);return row?JSON.parse(String(row.body)).decision:undefined;}
  limit(account:string,source:string,normal:number){return this.decision(account,source)?.preset==='limit'?1000:normal;}
  status(subject:string){this.operator(subject);return {runId:this.context.runId,configurations:this.store.db.prepare('SELECT body FROM issuer_scenario_config ORDER BY rowid DESC LIMIT 100').all().map(row=>JSON.parse(String(row.body))),pending:this.store.db.prepare("SELECT account_id,order_id,source_id,body FROM payment_card_authorizations WHERE state='PENDING' ORDER BY rowid").all().map(row=>{const a=JSON.parse(String(row.body));return {accountId:String(row.account_id),orderId:String(row.order_id),methodId:String(row.source_id),amountMinor:a.amountMinor,expiresAt:a.expiresAt,scenario:a.scenario};})};}
  configure(subject:string,input:{accountId:string;methodId:string;expectedMethodVersion:number;expectedRevision:number;preset:IssuerScenarioPreset;requestKey:string}){
    this.operator(subject);const db=this.store;
    return db.transaction(()=>{
      if(!issuerScenarioPresets.includes(input.preset)||!Number.isSafeInteger(input.expectedRevision)||input.expectedRevision<0||!/^[A-Za-z0-9_-]{8,100}$/.test(input.requestKey))return deny('SCENARIO_CONFIG_INVALID','Use a named preset and bounded current revisions.',400);
      const fingerprint=createHash('sha256').update(JSON.stringify(['configuration',Object.fromEntries(Object.entries(input).sort(([a],[b])=>a.localeCompare(b)))])).digest('hex'),previous=db.db.prepare('SELECT fingerprint,body FROM issuer_scenario_requests WHERE key=?').get(input.requestKey);
      if(previous){if(previous.fingerprint!==fingerprint)return deny('SCENARIO_REQUEST_CONFLICT','This operator request key already has different terms.');return JSON.parse(String(previous.body));}
      const method=db.get<PaymentMethod>(input.accountId,'payment-method',input.methodId);
      if(!method||method.kind!=='card'||method.status==='REMOVED'||method.version!==input.expectedMethodVersion)return deny('METHOD_CHANGED','Choose a current synthetic card in this isolated run.');
      const old=this.decision(input.accountId,input.methodId);if(!old&&Number(db.db.prepare('SELECT count(*) n FROM issuer_scenario_config').get()!.n)>=100)return deny('SCENARIO_LIMIT','At most one hundred configured sources are supported per isolated run.');if((old?.revision||0)!==input.expectedRevision)return deny('SCENARIO_CHANGED','Read the current run configuration revision.');
      if((old?.revision||0)>=1000||method.version>=1000000)return deny('SCENARIO_LIMIT','This isolated configuration reached its revision limit.');
      new PaymentResourceUses(db).assertRemovable(input.accountId,'METHOD',method.id);
      const row=db.db.prepare("SELECT coalesce(sum(amount_minor),0) n FROM payment_card_authorizations WHERE account_id=? AND source_id=? AND state='CAPTURED'").get(input.accountId,method.id),returned=db.db.prepare('SELECT coalesce(sum(amount_minor),0) n FROM payment_card_refunds WHERE account_id=? AND source_id=?').get(input.accountId,method.id);
      if(input.preset==='limit'&&Number(row!.n)-Number(returned!.n)>1000)return deny('SCENARIO_LIMIT_IN_USE','Cannot reduce this issuer limit below captured net spend.');
      const decision:IssuerScenarioDecision={runId:this.context.runId,revision:(old?.revision||0)+1,preset:input.preset};
      const at=new Date();method.version++;method.preset='approved';method.status=input.preset==='expired'?'EXPIRED':input.preset==='disabled'?'DISABLED':'ACTIVE';method.expiresMonth=12;method.expiresYear=at.getUTCFullYear()+(input.preset==='expired'?-1:3);db.put(input.accountId,'payment-method',method,method.id);
      const result={decision,accountId:input.accountId,method};db.db.prepare('INSERT INTO issuer_scenario_config VALUES(?,?,?,?) ON CONFLICT(account_id,method_id) DO UPDATE SET revision=excluded.revision,body=excluded.body').run(input.accountId,method.id,decision.revision,JSON.stringify(result));
      db.db.prepare('INSERT INTO issuer_scenario_audit(body) VALUES(?)').run(JSON.stringify({operatorSub:subject,runId:this.context.runId,accountId:input.accountId,methodId:method.id,revision:decision.revision,preset:input.preset,at:at.toISOString()}));
      db.db.prepare('INSERT INTO issuer_scenario_requests VALUES(?,?,?)').run(input.requestKey,fingerprint,JSON.stringify(result));return result;
    });
  }
  assertUserPreset(preset:string){if(preset!=='approved')return deny('SCENARIO_OPERATOR_REQUIRED','Issuer behavior is selected by the isolated run operator, not a payment or card request.',403);}
  assertUserStatus(account:string,source:string,status:string){if(status==='ACTIVE'&&['expired','disabled'].includes(this.decision(account,source)?.preset||''))return deny('SCENARIO_OPERATOR_REQUIRED','The current run policy keeps this source unavailable.',403);}
}
export function hasIssuerScenarioRun(store:AccountDatabase){return !!store.db.prepare("SELECT name FROM sqlite_master WHERE name='issuer_scenario_runs'").get();}
