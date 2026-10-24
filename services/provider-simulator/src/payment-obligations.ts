/** Gateway business-obligation exclusion, independent of transport/session identity. */
import { createHash } from 'node:crypto';
import type { ObligationView,CaptureAttemptView } from '../../../packages/protocol-core/src/payment-obligations.ts';
import type { Actor } from '../../../packages/backend-kit/src/context.ts';
import type { Payable,PaymentAuthorizationReview as Order } from '../../../packages/protocol-core/src/payments.ts';
import type { AccountDatabase } from './database.ts';
export class ObligationError extends Error {
  readonly status:number;readonly code:string;
  constructor(code:string,message:string,status=409){super(message);this.status=status;this.code=code;}
}
const deny=(code:string,message:string,status=409):never=>{throw new ObligationError(code,message,status);};
const digest=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
type Resource={key:string;kind:'OBLIGATION'|'RECHARGE_INTENT'|'RECHARGE_TARGET_VERSION'|'LEGACY';resourceId:string;reference:string};
const liveStates=['AWAITING_APPROVAL','AUTHORIZATION_PENDING','REQUIRES_ACTION','AUTHORIZED','CAPTURING','CAPTURED','RECONCILIATION_REQUIRED','SETTLED'];
const bounded=(v:unknown):v is string=>typeof v==='string'&&v.length>0&&v.length<=200&&!/[\x00-\x1f\x7f]/.test(v);
function resources(p:Payable):Resource[]{
  if(!p||!bounded(p.id)||!bounded(p.reference)||!['dewa','etisalat','du','police','rta'].includes(p.provider))return deny('INVALID_OBLIGATION','An authoritative bounded obligation identity is required.');
  const item=(part:Payable):Resource=>{const prefix=[`${part.provider}:bill:`,`${part.provider}:fine:`].find(prefix=>part.id.startsWith(prefix)),id=part.obligationId||(prefix?part.id.slice(prefix.length):part.id);if(!bounded(id)||part.provider!==p.provider||part.reference!==p.reference)return deny('INVALID_OBLIGATION','Constituent ownership or business identity does not match the quote.');return {kind:'OBLIGATION',resourceId:id,reference:part.reference,key:digest(['OBLIGATION',id])};};
  if(p.kind==='FINE_SET'){
    if(!Array.isArray(p.items)||p.items.length<1||p.items.length>20||p.items.some(i=>i.kind!=='FINE'||i.items||i.status!=='UNPAID'||i.paymentRestricted||i.currency!=='AED'||!Number.isSafeInteger(i.amountMinor)||i.amountMinor<1)||p.items.reduce((n,i)=>n+i.amountMinor,0)!==p.amountMinor)return deny('INVALID_OBLIGATION','An exact current set of fine obligations is required.');
    const result=p.items.map(item);if(new Set(result.map(r=>r.key)).size!==result.length)return deny('INVALID_OBLIGATION','A business obligation cannot occur twice in one order.');return result;
  }
  if(p.items!==undefined)return deny('INVALID_OBLIGATION','Only a verified fine set may contain constituent obligations.');
  if(p.kind==='RECHARGE'){
    const version=p.recharge?.targetVersion,id=p.obligationId||p.id;
    if(!bounded(id)||typeof version!=='number'||!Number.isSafeInteger(version)||version<1||version>1000000)return deny('INVALID_OBLIGATION','The recharge intent and target version must be authoritative.');
    return [{kind:'RECHARGE_INTENT',resourceId:id,reference:p.reference,key:digest(['RECHARGE_INTENT',id])},{kind:'RECHARGE_TARGET_VERSION',resourceId:`${p.reference}@${version}`,reference:p.reference,key:digest(['RECHARGE_TARGET_VERSION',p.reference,version])}];
  }
  return [item(p)];
}
export class PaymentObligations {
  readonly store:AccountDatabase;readonly clock:()=>number;private sequence=0;
  constructor(store:AccountDatabase,clock=Date.now){
    this.store=store;this.clock=clock;
    this.atomic(()=>{
      store.db.exec(`CREATE TABLE IF NOT EXISTS payment_order_obligations(
        account_id TEXT NOT NULL REFERENCES accounts(id),provider TEXT NOT NULL,obligation_key TEXT NOT NULL,
        order_id TEXT NOT NULL REFERENCES payment_authorization_orders(id),state TEXT NOT NULL CHECK(state IN ('RESERVED','COMMITTED','BLOCKED','RELEASED')),body TEXT NOT NULL CHECK(json_valid(body)),
        PRIMARY KEY(account_id,provider,obligation_key,order_id));
        CREATE UNIQUE INDEX IF NOT EXISTS gateway_active_obligation ON payment_order_obligations(account_id,provider,obligation_key) WHERE state IN ('RESERVED','COMMITTED');
        CREATE TRIGGER IF NOT EXISTS obligation_identity_immutable BEFORE UPDATE OF account_id,provider,obligation_key,order_id,body ON payment_order_obligations BEGIN SELECT RAISE(ABORT,'Obligation identity is immutable');END;
        CREATE TABLE IF NOT EXISTS payment_capture_attempts(
          id TEXT PRIMARY KEY,account_id TEXT NOT NULL REFERENCES accounts(id),order_id TEXT NOT NULL UNIQUE REFERENCES payment_authorization_orders(id),payment_id TEXT NOT NULL UNIQUE,
          state TEXT NOT NULL CHECK(state IN ('PREPARING','UNKNOWN','CAPTURED','SETTLED','FAILED','CANCELLED')),body TEXT NOT NULL CHECK(json_valid(body)));
        CREATE TRIGGER IF NOT EXISTS capture_identity_immutable BEFORE UPDATE OF id,account_id,order_id,payment_id,body ON payment_capture_attempts BEGIN SELECT RAISE(ABORT,'Capture attempt identity is immutable');END;`);
      // Captured history wins exclusion; overlapping older reviews are retained, blocked and cancellable.
      for(const row of store.db.prepare("SELECT * FROM payment_authorization_orders ORDER BY CASE WHEN json_extract(body,'$.fundsCaptured')=1 THEN 0 ELSE 1 END,rowid").all()){
        const order=JSON.parse(String(row.body)) as Order;
        if(!store.db.prepare('SELECT order_id FROM payment_order_obligations WHERE order_id=?').get(order.id)){
          let keys:Resource[];
          try{keys=resources(order.quote?.payable);}catch{const id=String(row.payable_id);keys=[{kind:'LEGACY',key:digest(['LEGACY',id]),resourceId:id,reference:'Unknown legacy reference'}];}
          this.insert(order,String(row.provider),keys,true);
        }
        this.sync(order,true);
      }
    });
  }
  private atomic<T>(fn:()=>T):T{
    if(!this.store.db.isTransaction)return this.store.transaction(fn);const savepoint=`obligations_${++this.sequence}`;this.store.db.exec(`SAVEPOINT ${savepoint}`);
    try{const value=fn();this.store.db.exec(`RELEASE ${savepoint}`);return value;}catch(e){this.store.db.exec(`ROLLBACK TO ${savepoint}`);this.store.db.exec(`RELEASE ${savepoint}`);throw e;}
  }
  private desired(o:Order){return o.fundsCaptured?'COMMITTED':liveStates.includes(o.state)?'RESERVED':'RELEASED';}
  private insert(o:Order,provider:string,keys:Resource[],legacy:boolean){
    const desired=this.desired(o);
    for(const key of keys){
      const collision=this.store.db.prepare("SELECT order_id FROM payment_order_obligations WHERE account_id=? AND provider=? AND state!='RELEASED' AND (obligation_key=? OR json_extract(body,'$.kind')='LEGACY') AND order_id<>? LIMIT 1").get(o.accountId,provider,key.key,o.id);
      if(collision&&desired!=='RELEASED'&&!legacy)return deny('PAYABLE_RESERVED',`This business obligation is reserved by ${String(collision.order_id)}. Inspect or cancel that original review first.`);
      const state=desired==='RELEASED'?'RELEASED':key.kind==='LEGACY'||collision?'BLOCKED':desired;
      this.store.db.prepare('INSERT INTO payment_order_obligations VALUES(?,?,?,?,?,?)').run(o.accountId,provider,key.key,o.id,state,JSON.stringify({...key,legacy}));
    }
  }
  reserve(o:Order){return this.atomic(()=>this.insert(o,o.quote.payable.provider,resources(o.quote.payable),false));}
  assertHeld(o:Order){
    const keys=resources(o.quote.payable),rows=this.store.db.prepare('SELECT obligation_key,state FROM payment_order_obligations WHERE account_id=? AND provider=? AND order_id=?').all(o.accountId,o.quote.payable.provider,o.id);
    if(rows.length!==keys.length||keys.some(k=>!rows.some(r=>r.obligation_key===k.key&&r.state==='RESERVED')))return deny('OBLIGATION_RECONCILIATION_REQUIRED','This original review has a conflicting or unavailable business reservation. Cancel unspent work or reconcile its original capture.');
  }
  /** Runs in the order mutation transaction; no network or financial effect is introduced. */
  sync(o:Order,inferred=false){return this.atomic(()=>{
    const desired=this.desired(o);
    if(desired==='RELEASED')this.store.db.prepare("UPDATE payment_order_obligations SET state='RELEASED' WHERE order_id=? AND state IN ('RESERVED','BLOCKED')").run(o.id);
    else if(desired==='COMMITTED')this.store.db.prepare("UPDATE payment_order_obligations SET state='COMMITTED' WHERE order_id=? AND state='RESERVED'").run(o.id);
    if(!o.paymentId)return;
    if(!bounded(o.paymentId)||!o.quote?.source||!Number.isSafeInteger(o.quote.totalMinor))return deny('INVALID_CAPTURE_ATTEMPT','The original capture identity requires inspection.');
    const id=`capture_${o.id}`,state:CaptureAttemptView['state']=o.state==='SETTLED'?'SETTLED':o.fundsCaptured?o.state==='RECONCILIATION_REQUIRED'?'UNKNOWN':'CAPTURED':o.state==='FAILED'?'FAILED':o.state==='CANCELLED'?'CANCELLED':'PREPARING';
    const previous=this.store.db.prepare('SELECT payment_id,state,body FROM payment_capture_attempts WHERE order_id=?').get(o.id);
    if(previous){const body=JSON.parse(String(previous.body));if(previous.payment_id!==o.paymentId||body.approvalDigest!==o.approvalDigest||body.amountMinor!==o.quote.totalMinor||body.sourceId!==o.quote.source.id)return deny('CAPTURE_ATTEMPT_CONFLICT','The original attempt cannot be rebound.');
      if(previous.state==='SETTLED'&&state!=='SETTLED'||['FAILED','CANCELLED'].includes(String(previous.state))&&state!==previous.state)return deny('CAPTURE_ATTEMPT_CLOSED','A closed capture attempt cannot be reopened.');
      if(!(state==='PREPARING'&&previous.state==='UNKNOWN'))this.store.db.prepare('UPDATE payment_capture_attempts SET state=? WHERE order_id=?').run(state,o.id);
    }else this.store.db.prepare('INSERT INTO payment_capture_attempts VALUES(?,?,?,?,?,?)').run(id,o.accountId,o.id,o.paymentId,state,JSON.stringify({approvalDigest:o.approvalDigest,amountMinor:o.quote.totalMinor,currency:'AED',sourceId:o.quote.source.id,createdAt:inferred?o.approvedAt||o.createdAt:new Date(this.clock()).toISOString(),inferred}));
  });}
  unknown(o:Order){return this.atomic(()=>{const attempt=this.store.db.prepare('SELECT state FROM payment_capture_attempts WHERE order_id=?').get(o.id);if(attempt&&['PREPARING','CAPTURED','UNKNOWN'].includes(String(attempt.state)))this.store.db.prepare("UPDATE payment_capture_attempts SET state='UNKNOWN' WHERE order_id=?").run(o.id);});}
  list(actor:Actor):{obligations:ObligationView[];attempts:CaptureAttemptView[]}{
    if(!this.store.owns(actor.sub,actor.accountId))return deny('ACCOUNT_FORBIDDEN','This workspace does not belong to the owner.',403);
    return paymentObligationSnapshot(this.store,actor.accountId);
  }
}
export function paymentObligationSnapshot(store:AccountDatabase,accountId:string):{obligations:ObligationView[];attempts:CaptureAttemptView[]}{
    const obligations=store.db.prepare('SELECT order_id,provider,state,body FROM payment_order_obligations WHERE account_id=? ORDER BY order_id,obligation_key').all(accountId).map(row=>{const b=JSON.parse(String(row.body)) as Resource&{legacy:boolean};return {orderId:String(row.order_id),provider:String(row.provider),kind:b.kind,resourceId:b.resourceId,reference:b.reference,state:String(row.state) as ObligationView['state'],legacy:b.legacy};});
    const attempts=store.db.prepare("SELECT c.*,json_extract(o.body,'$.fundsCaptured') AS funds_captured FROM payment_capture_attempts c JOIN payment_authorization_orders o ON o.id=c.order_id WHERE c.account_id=? ORDER BY c.rowid DESC").all(accountId).map(r=>{const b=JSON.parse(String(r.body));return {id:String(r.id),orderId:String(r.order_id),paymentId:String(r.payment_id),state:String(r.state),amountMinor:b.amountMinor,currency:'AED',sourceId:b.sourceId,createdAt:b.createdAt,inferred:b.inferred,fundsCaptured:r.funds_captured===1} as CaptureAttemptView;});
    return {obligations,attempts};
}
