/** Central current entitlement/epoch authority. Defaults preserve pre-existing ownership, never rewrite history. */
import { randomUUID,createHash } from 'node:crypto';
import type { Actor } from '../../../packages/backend-kit/src/context.ts';
import type { AccountEligibility as Snapshot,EligibilityChange,PaymentLifecycle } from '../../../packages/protocol-core/src/account-eligibility.ts';
import type { AccountDatabase } from './database.ts';
export class EligibilityError extends Error{readonly status:number;readonly code:string;constructor(status:number,code:string,message:string){super(message);this.status=status;this.code=code;}}
const deny=(code:string,message:string,status=403):never=>{throw new EligibilityError(status,code,message);};
export class AccountEligibility {
  readonly store:AccountDatabase;
  constructor(store:AccountDatabase){this.store=store;store.db.exec(`CREATE TABLE IF NOT EXISTS payment_owner_eligibility(owner TEXT PRIMARY KEY,enabled INTEGER NOT NULL CHECK(enabled IN (0,1)),version INTEGER NOT NULL CHECK(version BETWEEN 1 AND 1000000));
    CREATE TABLE IF NOT EXISTS payment_membership_eligibility(account_id TEXT PRIMARY KEY REFERENCES accounts(id),enabled INTEGER NOT NULL CHECK(enabled IN (0,1)),version INTEGER NOT NULL CHECK(version BETWEEN 1 AND 1000000));
    CREATE TABLE IF NOT EXISTS payment_eligibility_audit(id TEXT PRIMARY KEY,account_id TEXT NOT NULL REFERENCES accounts(id),body TEXT NOT NULL CHECK(json_valid(body)));
    CREATE TRIGGER IF NOT EXISTS eligibility_audit_no_update BEFORE UPDATE ON payment_eligibility_audit BEGIN SELECT RAISE(ABORT,'Eligibility audit is immutable');END;
    CREATE TRIGGER IF NOT EXISTS eligibility_audit_no_delete BEFORE DELETE ON payment_eligibility_audit BEGIN SELECT RAISE(ABORT,'Eligibility audit is immutable');END;
    CREATE TABLE IF NOT EXISTS payment_eligibility_requests(key TEXT PRIMARY KEY,fingerprint TEXT NOT NULL,body TEXT NOT NULL);`);}
  snapshot(accountId:string):Snapshot{
    const account=this.store.db.prepare('SELECT owner FROM accounts WHERE id=?').get(accountId);if(!account)deny('ACCOUNT_NOT_FOUND','The authority has no such workspace.',404);
    const ownerSub=String(account!.owner),o=this.store.db.prepare('SELECT enabled,version FROM payment_owner_eligibility WHERE owner=?').get(ownerSub),m=this.store.db.prepare('SELECT enabled,version FROM payment_membership_eligibility WHERE account_id=?').get(accountId);
    const ownerEnabled=o?o.enabled===1:true,membershipEnabled=m?m.enabled===1:true,ownerVersion=o?Number(o.version):1,membershipVersion=m?Number(m.version):1;
    return {accountId,ownerSub,ownerEnabled,membershipEnabled,ownerVersion,membershipVersion,epoch:`${ownerVersion}:${membershipVersion}`,active:ownerEnabled&&membershipEnabled};
  }
  require(actor:Actor,expectedEpoch?:string){const s=this.snapshot(actor.accountId);if(s.ownerSub!==actor.sub)deny('ACCOUNT_FORBIDDEN','The workspace does not belong to this owner.');if(!s.active)deny('ACCOUNT_RESTRICTED','Current owner or workspace membership prevents new payment authority.');
    if(actor.eligibilityEpoch&&actor.eligibilityEpoch!==s.epoch||expectedEpoch&&expectedEpoch!==s.epoch)deny('ELIGIBILITY_CHANGED','Owner or workspace permission changed; create a new exact review.',409);return s;
  }
  change(accountId:string,input:EligibilityChange,operator:string,key:string){
    if(!/^[A-Za-z0-9_-]{8,100}$/.test(key)||!operator||!['OWNER','MEMBERSHIP'].includes(input.kind)||!Number.isSafeInteger(input.expectedVersion)||input.expectedVersion<1||typeof input.enabled!=='boolean'||typeof input.reason!=='string'||input.reason.length<5||input.reason.length>160||/[\r\n]/.test(input.reason))deny('INVALID_ELIGIBILITY_CHANGE','Use an exact versioned operator decision.',400);
    const fingerprint=createHash('sha256').update(JSON.stringify([accountId,input.kind,input.expectedVersion,input.enabled,input.reason,operator])).digest('hex');
    return this.store.transaction(()=>{
      const prior=this.store.db.prepare('SELECT fingerprint,body FROM payment_eligibility_requests WHERE key=?').get(key);if(prior){if(prior.fingerprint!==fingerprint)deny('ELIGIBILITY_REQUEST_CONFLICT','This operator key has different terms.',409);return JSON.parse(String(prior.body)) as Snapshot;}
      const s=this.snapshot(accountId),version=input.kind==='OWNER'?s.ownerVersion:s.membershipVersion;if(version!==input.expectedVersion)deny('ELIGIBILITY_CHANGED','Read current eligibility before changing it.',409);if(version>=1000000)deny('ELIGIBILITY_VERSION_LIMIT','The eligibility version limit was reached.',409);
      const table=input.kind==='OWNER'?'payment_owner_eligibility':'payment_membership_eligibility',column=input.kind==='OWNER'?'owner':'account_id',id=input.kind==='OWNER'?s.ownerSub:accountId;
      this.store.db.prepare(`INSERT INTO ${table} VALUES(?,?,?) ON CONFLICT(${column}) DO UPDATE SET enabled=excluded.enabled,version=excluded.version`).run(id,input.enabled?1:0,version+1);
      const after=this.snapshot(accountId);this.store.db.prepare('INSERT INTO payment_eligibility_audit VALUES(?,?,?)').run(`eligibility_${randomUUID()}`,accountId,JSON.stringify({at:new Date().toISOString(),operator,kind:input.kind,reason:input.reason,before:s,after}));
      this.store.db.prepare('INSERT INTO payment_eligibility_requests VALUES(?,?,?)').run(key,fingerprint,JSON.stringify(after));return after;
    });
  }
  impact(accountId:string):PaymentLifecycle{
    const eligibility=this.snapshot(accountId);
    const blocked=(epoch:string|undefined,sources:{id:string;version:number}[],link?:{id:string;version:number})=>{
      const reasons:string[]=[];
      if(!eligibility.active)reasons.push('ACCOUNT_RESTRICTED');
      if((epoch||'1:1')!==eligibility.epoch)reasons.push('ELIGIBILITY_CHANGED');
      for(const source of sources){
        if(source.id==='wallet')continue;
        const current=this.store.get<{status:string;version:number;expiresYear?:number;expiresMonth?:number}>(accountId,'payment-method',source.id),now=new Date();
        if(!current||current.status!=='ACTIVE'||current.version!==source.version)reasons.push('SOURCE_CHANGED');
        else if(!current.expiresYear||!current.expiresMonth||current.expiresYear<now.getUTCFullYear()||current.expiresYear===now.getUTCFullYear()&&current.expiresMonth<now.getUTCMonth()+1)reasons.push('SOURCE_EXPIRED');
      }
      if(link){const current=this.store.get<{status:string;version:number}>(accountId,'billing-account',link.id);if(!current||current.status!=='ACTIVE'||current.version!==link.version)reasons.push('BILLER_CHANGED');}
      return [...new Set(reasons)];
    };
    const orders=this.store.db.prepare("SELECT body FROM payment_authorization_orders WHERE account_id=? AND state IN ('AWAITING_APPROVAL','AUTHORIZATION_PENDING','REQUIRES_ACTION','AUTHORIZED','CAPTURING','CAPTURED','RECONCILIATION_REQUIRED')").all(accountId).map(r=>{
      const o=JSON.parse(String(r.body));return {id:o.id,state:o.state,fundsCaptured:o.fundsCaptured,...(o.paymentId?{paymentId:o.paymentId}:{}),sourceId:o.quote.source.id,blockedReasons:blocked(o.eligibilityEpoch,[o.quote.source],o.quote.billingAccount),action:o.fundsCaptured?'PRESERVE_ORIGINAL_CAPTURE' as const:'CANCEL_OR_REVIEW_AGAIN' as const};
    });
    const funding=this.store.db.prepare("SELECT body FROM wallet_funding_orders WHERE account_id=? AND state IN ('AWAITING_APPROVAL','AUTHORIZATION_PENDING','REQUIRES_ACTION','AUTHORIZED')").all(accountId).map(r=>{const o=JSON.parse(String(r.body));return {id:o.id,state:o.state,fundsCaptured:o.fundsCaptured,sourceId:o.quote.source.id,blockedReasons:blocked(o.eligibilityEpoch,[o.quote.source])};});
    const mandates=this.store.db.prepare("SELECT v.body FROM payment_mandates m JOIN payment_mandate_versions v ON v.id=m.id AND v.version=m.version WHERE m.account_id=?").all(accountId).map(r=>JSON.parse(String(r.body))).filter(m=>['APPROVED','AWAITING_APPROVAL'].includes(m.state)).map(m=>({id:m.id,policyVersion:m.policyVersion,state:m.state,executionEnabled:false as const,eligibilityCurrent:(m.eligibilityEpoch||'1:1')===eligibility.epoch,blockedReasons:blocked(m.eligibilityEpoch,m.sourceSnapshots,m.billerSnapshot)}));
    return{eligibility,orders,funding,mandates};
  }
}
