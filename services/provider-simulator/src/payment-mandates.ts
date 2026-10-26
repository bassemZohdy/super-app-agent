/** Versioned owner consent records. This module grants no execution credential or spending permit. */
import { createHash, randomUUID } from 'node:crypto';
import { Ajv } from 'ajv';
import { mandatePolicySchema, MANDATE_CONTRACT_VERSION, type MandatePolicy, type PaymentMandate } from '../../../packages/protocol-core/src/payment-mandates.ts';
import { WALLET_FUNDING_LIMITS, type BillingAccount, type PaymentMethod } from '../../../packages/protocol-core/src/payments.ts';
import type { Actor } from '../../../packages/backend-kit/src/context.ts';
import type { AccountDatabase } from './database.ts';
import type { PaymentResourceUses } from './payment-resource-uses.ts';
import { walletMethod } from './payment-registry.ts';

export class MandateError extends Error {
  readonly status:number;readonly code:string;
  constructor(status:number,code:string,message:string){super(message);this.status=status;this.code=code;}
}
const deny=(code:string,message:string,status=409):never=>{throw new MandateError(status,code,message);};
const validate=new Ajv({strict:false,allErrors:true}).compile(mandatePolicySchema);
const canonical=(v:unknown):string=>Array.isArray(v)?`[${v.map(canonical).join(',')}]`:v&&typeof v==='object'?`{${Object.entries(v).sort(([a],[b])=>a.localeCompare(b)).map(([k,x])=>`${JSON.stringify(k)}:${canonical(x)}`).join(',')}}`:JSON.stringify(v);
const digest=(v:unknown)=>createHash('sha256').update(canonical(v)).digest('hex');
const active=(m:PaymentMandate)=>m.state==='AWAITING_APPROVAL'||m.state==='APPROVED';
/** Still holds consent and references: a paused rule is open, so it can be revoked and it still expires. */
const open=(m:PaymentMandate)=>active(m)||m.state==='PAUSED';
export class PaymentMandates {
  private sequence=0;
  readonly store:AccountDatabase;readonly uses:PaymentResourceUses;readonly clock:()=>number;
  constructor(store:AccountDatabase,uses:PaymentResourceUses,clock=Date.now){
    this.store=store;this.uses=uses;this.clock=clock;
    this.atomic(()=>store.db.exec(`CREATE TABLE IF NOT EXISTS payment_mandates(
      id TEXT PRIMARY KEY,account_id TEXT NOT NULL REFERENCES accounts(id),version INTEGER NOT NULL CHECK(version BETWEEN 1 AND 1000));
      CREATE TABLE IF NOT EXISTS payment_mandate_versions(
      id TEXT NOT NULL REFERENCES payment_mandates(id),version INTEGER NOT NULL,body TEXT NOT NULL CHECK(json_valid(body)),
      PRIMARY KEY(id,version));
      CREATE TRIGGER IF NOT EXISTS mandate_versions_no_update BEFORE UPDATE ON payment_mandate_versions BEGIN SELECT RAISE(ABORT,'Mandate history is immutable'); END;
      CREATE TRIGGER IF NOT EXISTS mandate_versions_no_delete BEFORE DELETE ON payment_mandate_versions BEGIN SELECT RAISE(ABORT,'Mandate history is immutable'); END;
      CREATE INDEX IF NOT EXISTS mandates_account ON payment_mandates(account_id,id);`));
  }
  private atomic<T>(fn:()=>T):T {
    if(!this.store.db.isTransaction)return this.store.transaction(fn);
    const name=`mandates_${++this.sequence}`;this.store.db.exec(`SAVEPOINT ${name}`);
    try{const value=fn();this.store.db.exec(`RELEASE ${name}`);return value;}catch(e){this.store.db.exec(`ROLLBACK TO ${name}`);this.store.db.exec(`RELEASE ${name}`);throw e;}
  }
  private owner(actor:Actor){if(!this.store.owns(actor.sub,actor.accountId))deny('ACCOUNT_FORBIDDEN','This workspace does not belong to the owner.',403);}
  private interactive(actor:Actor){this.owner(actor);if(!actor.authorization)deny('INTERACTIVE_CONSENT_REQUIRED','A signed interactive owner must manage consent.',403);}
  private load(actor:Actor,id:string):PaymentMandate {
    this.owner(actor);const row=this.store.db.prepare('SELECT v.body FROM payment_mandates m JOIN payment_mandate_versions v ON v.id=m.id AND v.version=m.version WHERE m.account_id=? AND m.id=?').get(actor.accountId,id);
    if(!row)return deny('MANDATE_NOT_FOUND','Mandate not found for this workspace.',404);
    const m=JSON.parse(String(row.body)) as PaymentMandate;if(m.ownerSub!==actor.sub)return deny('MANDATE_NOT_FOUND','Mandate not found.',404);return m;
  }
  private save(m:PaymentMandate){
    if(m.version>=1000)deny('MANDATE_VERSION_LIMIT','This mandate reached its version limit.');
    const before=m.version;m.version++;m.updatedAt=new Date(this.clock()).toISOString();
    const result=this.store.db.prepare('UPDATE payment_mandates SET version=? WHERE id=? AND account_id=? AND version=?').run(m.version,m.id,m.accountId,before);
    if(result.changes!==1)deny('MANDATE_CHANGED','The mandate changed. Refresh before continuing.');
    this.store.db.prepare('INSERT INTO payment_mandate_versions VALUES(?,?,?)').run(m.id,m.version,JSON.stringify(m));return m;
  }
  private bind(m:PaymentMandate){
    const dependentId=`${m.id}:${m.policyVersion}`;
    for(const s of m.sourceSnapshots)this.uses.bind(m.accountId,{resourceType:'METHOD',resourceId:s.id,resourceVersion:s.version,dependentKind:'MANDATE',dependentId});
    if(m.billerSnapshot)this.uses.bind(m.accountId,{resourceType:'BILLER',resourceId:m.billerSnapshot.id,resourceVersion:m.billerSnapshot.version,dependentKind:'MANDATE',dependentId});
  }
  private release(m:PaymentMandate){
    const dependentId=`${m.id}:${m.policyVersion}`;
    for(const s of m.sourceSnapshots)this.uses.release(m.accountId,'METHOD',s.id,'MANDATE',dependentId);
    if(m.billerSnapshot)this.uses.release(m.accountId,'BILLER',m.billerSnapshot.id,'MANDATE',dependentId);
  }
  private sync(m:PaymentMandate){
    if(open(m)&&(Date.parse(m.policy.expiresAt)<=this.clock()||m.state==='AWAITING_APPROVAL'&&Date.parse(m.reviewExpiresAt)<=this.clock())){this.release(m);m.state='EXPIRED';return this.save(m);}return m;
  }
  get(actor:Actor,id:string){return this.atomic(()=>this.sync(this.load(actor,id)));}
  list(actor:Actor){return this.atomic(()=>{this.owner(actor);return this.store.db.prepare('SELECT id FROM payment_mandates WHERE account_id=? ORDER BY rowid DESC LIMIT 100').all(actor.accountId).map(r=>this.sync(this.load(actor,String(r.id))));});}
  history(actor:Actor,id:string){this.get(actor,id);return this.store.db.prepare('SELECT body FROM payment_mandate_versions WHERE id=? ORDER BY version').all(id).map(r=>JSON.parse(String(r.body)) as PaymentMandate);}
  private snapshot(actor:Actor,policy:MandatePolicy){
    if(!validate(policy))deny('INVALID_MANDATE','Provide a complete finite mandate policy without extra fields.',400);
    const now=this.clock(),start=Date.parse(policy.startsAt),end=Date.parse(policy.expiresAt),l=policy.limits;
    if(!Number.isFinite(start)||!Number.isFinite(end)||new Date(start).toISOString()!==policy.startsAt||new Date(end).toISOString()!==policy.expiresAt||end<=Math.max(start,now)||start<now-300000||end-start>366*86400000)deny('INVALID_MANDATE_WINDOW','Use a current time window of at most 366 days.',400);
    try{new Intl.DateTimeFormat('en',{timeZone:policy.timezone});}catch{deny('INVALID_TIMEZONE','Use an explicit IANA time zone.',400);}
    if(!policy.timezone.includes('/')&&policy.timezone!=='UTC')deny('INVALID_TIMEZONE','Use an explicit IANA time zone.',400);
    if(l.perPaymentMinor>l.periodMinor||l.periodMinor>l.lifetimeMinor||l.perPeriodCount>l.lifetimeCount)deny('INVALID_MANDATE_LIMITS','Per-payment, period and lifetime bounds must be ordered.',400);
    if(new Set(policy.sources.map(s=>s.methodId)).size!==policy.sources.length||policy.sources.length===1&&policy.fallback.mode!=='NONE'||policy.sources.length>1&&policy.fallback.mode!=='ORDERED')deny('INVALID_MANDATE_SOURCES','Use distinct exact sources and an explicit ordered fallback policy.',400);
    const sources=policy.sources.map(s=>{
      const method=s.methodId==='wallet'?walletMethod(actor.accountId):this.store.get<PaymentMethod>(actor.accountId,'payment-method',s.methodId);
      if(!method||method.status!=='ACTIVE'||method.version!==s.expectedVersion) return deny('MANDATE_SOURCE_CHANGED','An approved source is missing, disabled or changed.');
      const date=new Date(now);if(method.kind==='card'&&(!method.expiresYear||!method.expiresMonth||method.expiresYear<date.getUTCFullYear()||method.expiresYear===date.getUTCFullYear()&&method.expiresMonth<date.getUTCMonth()+1))deny('MANDATE_SOURCE_EXPIRED','The selected card is expired.');return structuredClone(method);
    });
    const op=policy.operation,t=policy.target,trigger=policy.trigger.type;
    const triggers={BILL_PAYMENT:['INVOICE_DUE','CALENDAR'],WALLET_RELOAD:['LOW_BALANCE'],RECHARGE:['LOW_BALANCE'],FINE_PAYMENT:['NEW_FINE'],PARKING_EXTENSION:['PARKING_ENDING'],SUBSCRIPTION_RENEWAL:['CALENDAR']};
    if(!triggers[op].includes(trigger))deny('INVALID_MANDATE_TRIGGER','The trigger does not match the approved operation.',400);
    if((op==='WALLET_RELOAD')!==(t.kind==='WALLET')||(op==='PARKING_EXTENSION')!==(t.kind==='PARKING'))deny('INVALID_MANDATE_TARGET','The target does not match the operation.',400);
    if((op==='FINE_PAYMENT')!==!!policy.fineTypes)deny('INVALID_FINE_POLICY','Only explicit fine mandates require a finite list of eligible fine types.',400);
    if(policy.trigger.type==='LOW_BALANCE'){
      const b=policy.trigger;if(b.reloadMinor>l.perPaymentMinor||b.belowMinor>=b.targetBalanceMinor||b.reloadMinor>b.targetBalanceMinor)deny('INVALID_RELOAD_POLICY','Reload amount and threshold must fit the approved target and caps.',400);
      if(op==='WALLET_RELOAD'&&(sources.some(s=>s.kind!=='card')||b.reloadMinor<WALLET_FUNDING_LIMITS.minMinor||b.reloadMinor>WALLET_FUNDING_LIMITS.maxMinor||b.targetBalanceMinor>WALLET_FUNDING_LIMITS.balanceMaxMinor))deny('INVALID_WALLET_RELOAD','Wallet reloads need a saved card and bounded funding amount/target.',400);
    }
    let biller:BillingAccount|undefined;
    if(t.kind==='BILLER'){
      biller=this.store.get<BillingAccount>(actor.accountId,'billing-account',t.billingAccountId);
      if(!biller||biller.status!=='ACTIVE'||biller.version!==t.expectedVersion||biller.provider!==t.provider||biller.reference!==t.reference)deny('MANDATE_TARGET_CHANGED','The linked target is missing, changed or belongs to another workspace.');
      if(op==='BILL_PAYMENT'&&!['dewa','etisalat','du'].includes(t.provider)||op==='FINE_PAYMENT'&&t.provider!=='police'||op==='RECHARGE'&&!['rta','etisalat','du'].includes(t.provider)||op==='SUBSCRIPTION_RENEWAL'&&!['etisalat','du'].includes(t.provider))deny('INVALID_MANDATE_PROVIDER','The provider does not support this operation.',400);
    }
    if(t.kind==='PARKING'&&(Date.parse(t.endAt)<=Math.max(start,now)||Date.parse(t.endAt)>end||t.maximumHours*3600<l.cooldownSeconds))deny('INVALID_PARKING_POLICY','Parking needs a bounded end time and duration within the mandate window.',400);
    return {sourceSnapshots:sources,...(biller?{billerSnapshot:structuredClone(biller)}:{})};
  }
  private approval(m:PaymentMandate){return digest({...(m.eligibilityEpoch?{eligibilityEpoch:m.eligibilityEpoch}:{}),contractVersion:MANDATE_CONTRACT_VERSION,id:m.id,accountId:m.accountId,ownerSub:m.ownerSub,policyVersion:m.policyVersion,policy:m.policy,sourceSnapshots:m.sourceSnapshots,billerSnapshot:m.billerSnapshot||null,reviewExpiresAt:m.reviewExpiresAt});}
  create(actor:Actor,policy:MandatePolicy){return this.atomic(()=>{
    this.interactive(actor);const eligibility=this.store.eligibility!.require(actor);this.list(actor);const count=this.store.db.prepare('SELECT count(*) n FROM payment_mandates WHERE account_id=?').get(actor.accountId)!.n;
    if(Number(count)>=100)deny('MANDATE_LIMIT','This workspace supports at most 100 retained mandates.');
    const snapshot=this.snapshot(actor,policy),now=new Date(this.clock()).toISOString();
    const m:PaymentMandate={eligibilityEpoch:eligibility.epoch,id:`mandate_${randomUUID()}`,accountId:actor.accountId,ownerSub:actor.sub,version:1,policyVersion:1,state:'AWAITING_APPROVAL',executionEnabled:false,policy:structuredClone(policy),...snapshot,approvalDigest:'',reviewExpiresAt:new Date(this.clock()+300000).toISOString(),createdAt:now,updatedAt:now};
    m.approvalDigest=this.approval(m);this.store.db.prepare('INSERT INTO payment_mandates VALUES(?,?,?)').run(m.id,m.accountId,m.version);this.bind(m);this.store.db.prepare('INSERT INTO payment_mandate_versions VALUES(?,?,?)').run(m.id,m.version,JSON.stringify(m));return m;
  });}
  revise(actor:Actor,id:string,expectedVersion:number,policy:MandatePolicy){return this.atomic(()=>{
    this.interactive(actor);const eligibility=this.store.eligibility!.require(actor);const m=this.sync(this.load(actor,id));this.expected(m,expectedVersion);if(m.version>=997)deny('MANDATE_VERSION_LIMIT','Create a new mandate after closing this version-limited policy.');if(!active(m))deny('MANDATE_CLOSED','Create a new mandate after revocation or expiry.');
    const snapshot=this.snapshot(actor,policy);this.release(m);m.eligibilityEpoch=eligibility.epoch;m.policyVersion++;m.state='AWAITING_APPROVAL';m.policy=structuredClone(policy);m.sourceSnapshots=snapshot.sourceSnapshots;delete m.billerSnapshot;if(snapshot.billerSnapshot)m.billerSnapshot=snapshot.billerSnapshot;delete m.approvedAt;
    m.reviewExpiresAt=new Date(this.clock()+300000).toISOString();m.approvalDigest=this.approval(m);this.bind(m);return this.save(m);
  });}
  approve(actor:Actor,id:string,expectedVersion:number,approvalDigest:string){return this.atomic(()=>{
    this.interactive(actor);const m=this.sync(this.load(actor,id));this.expected(m,expectedVersion);if(m.version>=998)deny('MANDATE_VERSION_LIMIT','Close this version-limited policy before creating another.');
    this.store.eligibility!.require(actor,m.eligibilityEpoch||'1:1');if(m.state!=='AWAITING_APPROVAL'||m.approvalDigest!==approvalDigest||this.approval(m)!==approvalDigest)deny('MANDATE_APPROVAL_INVALID','Approve the exact current unexpired mandate review.');
    this.snapshot(actor,m.policy);m.state='APPROVED';m.approvedAt=new Date(this.clock()).toISOString();return this.save(m);
  });}
  /** Pause keeps the consent and its binds; preparation refuses anything not APPROVED. */
  pause(actor:Actor,id:string,expectedVersion:number){return this.atomic(()=>{
    this.interactive(actor);const m=this.sync(this.load(actor,id));this.expected(m,expectedVersion);
    if(m.state!=='APPROVED')deny('MANDATE_NOT_APPROVED','Only an approved rule can pause.');
    m.state='PAUSED';return this.save(m);});}
  /** Resume revalidates the current consent, sources and target exactly like approval. */
  resume(actor:Actor,id:string,expectedVersion:number){return this.atomic(()=>{
    this.interactive(actor);const m=this.sync(this.load(actor,id));this.expected(m,expectedVersion);
    if(m.state!=='PAUSED')deny('MANDATE_NOT_PAUSED','Resume a paused rule.');
    this.snapshot(actor,m.policy);m.state='APPROVED';m.approvedAt=new Date(this.clock()).toISOString();return this.save(m);});}
  /** One-shot operator skip: the next due occurrence is skipped with a recorded reason. */
  skipNext(actor:Actor,id:string,expectedVersion:number){return this.atomic(()=>{
    this.interactive(actor);const m=this.sync(this.load(actor,id));this.expected(m,expectedVersion);
    if(!active(m))deny('MANDATE_CLOSED','Skip-next applies to an active rule.');
    m.skipNext=!m.skipNext;return this.save(m);});}
  /** The execution authority consumes the one-shot skip before preparing an occurrence. */
  consumeSkipNext(id:string):boolean{return this.atomic(()=>{
    const row=this.store.db.prepare('SELECT account_id FROM payment_mandates WHERE id=?').get(id);
    if(!row)return false;
    const body=this.store.db.prepare('SELECT v.body FROM payment_mandates m JOIN payment_mandate_versions v ON v.id=m.id AND v.version=m.version WHERE m.id=?').get(id);
    if(!body)return false;
    const m=JSON.parse(String(body!.body)) as PaymentMandate;
    if(!m.skipNext||m.state!=='APPROVED')return false;
    m.skipNext=false;
    const before=m.version;m.version++;m.updatedAt=new Date(this.clock()).toISOString();
    const result=this.store.db.prepare('UPDATE payment_mandates SET version=? WHERE id=? AND account_id=? AND version=?').run(m.version,m.id,m.accountId,before);
    if(result.changes!==1)return false;
    this.store.db.prepare('INSERT INTO payment_mandate_versions VALUES(?,?,?)').run(m.id,m.version,JSON.stringify(m));return true;
  });}
  revoke(actor:Actor,id:string,expectedVersion:number){return this.atomic(()=>{
    this.interactive(actor);const m=this.sync(this.load(actor,id));this.expected(m,expectedVersion);if(open(m)){this.release(m);m.state='REVOKED';return this.save(m);}return m;
  });}
  private expected(m:PaymentMandate,version:number){if(m.version!==version)deny('MANDATE_CHANGED','The mandate changed. Refresh before continuing.');}
}
