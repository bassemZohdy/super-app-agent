/** Owned evidence-first recovery. Inspections never grant authority for a new charge or a new service operation. */
import { createHash,randomUUID } from 'node:crypto';
import type { Actor } from '../../../packages/backend-kit/src/context.ts';
import { legacyCaptureDigest,legacyPaymentState } from '../../../packages/backend-kit/src/legacy-payment-binding.ts';
import { ProviderClient } from '../../../packages/backend-kit/src/provider-client.ts';
import type { RecoveryKind,RecoveryAction,RecoveryCase,RecoveryInspection,RecoveryAudit } from '../../../packages/protocol-core/src/payment-reconciliation.ts';
import type { PaymentOrders } from './payment-orders.ts';
import type { WalletFunding } from './wallet-funding.ts';
import type { PaymentRefunds } from './payment-refunds.ts';
import { PaymentCheckout } from './payment-checkout.ts';
import { SettlementError } from './payment-claims.ts';
import { initializeRecoveryAudit,appendRecoveryAudit } from './recovery-audit.ts';
const json=(v:any):string=>Array.isArray(v)?`[${v.map(json).join(',')}]`:v&&typeof v==='object'?`{${Object.entries(v).sort(([a],[b])=>a.localeCompare(b)).map(([k,x])=>`${JSON.stringify(k)}:${json(x)}`).join(',')}}`:JSON.stringify(v);
const hash=(v:unknown)=>createHash('sha256').update(json(v)).digest('hex');
const deny=(code:string,message:string,status=409):never=>{throw new SettlementError(status,code,message);};
type Evidence={record:any;remote:any;summary:RecoveryCase;termsDigest:string;localDigest:string;sourceDigest:string;classification:RecoveryInspection['classification'];captureState:RecoveryInspection['captureState'];sourceState:string;reason:string;actions:RecoveryAction[]};
export class PaymentReconciliation {
  readonly orders:PaymentOrders;readonly funding:WalletFunding;readonly refunds:PaymentRefunds;readonly clock:()=>number;
  private sequence=0;
  constructor(orders:PaymentOrders,funding:WalletFunding,refunds:PaymentRefunds,clock=Date.now){
    this.orders=orders;this.funding=funding;this.refunds=refunds;this.clock=clock;initializeRecoveryAudit(orders.store);
    orders.store.db.exec(`CREATE TABLE IF NOT EXISTS payment_recovery_inspections(id TEXT PRIMARY KEY,account_id TEXT NOT NULL REFERENCES accounts(id),kind TEXT NOT NULL,operation_id TEXT NOT NULL,body TEXT NOT NULL CHECK(json_valid(body)));
      CREATE INDEX IF NOT EXISTS recovery_inspection_operation ON payment_recovery_inspections(account_id,kind,operation_id);`);
  }
  private atomic<T>(fn:()=>T):T{const store=this.orders.store;if(!store.db.isTransaction)return store.transaction(fn);const name=`reconciliation_${++this.sequence}`;store.db.exec(`SAVEPOINT ${name}`);try{const value=fn();store.db.exec(`RELEASE ${name}`);return value;}catch(e){store.db.exec(`ROLLBACK TO ${name}`);store.db.exec(`RELEASE ${name}`);throw e;}}
  private owner(a:Actor){if(!this.orders.store.owns(a.sub,a.accountId))deny('ACCOUNT_FORBIDDEN','Recovery records belong to the signed-in workspace.',403);}
  private local(a:Actor,kind:RecoveryKind,id:string){this.owner(a);if(kind==='PAYMENT')return this.orders.get(a,id);if(kind==='FUNDING')return this.funding.get(a,id);if(kind==='REFUND')return this.refunds.get(a,id);
    const c=this.orders.store.get(a.accountId,'charge',id);if(!c||c.orderId)deny('LEGACY_CAPTURE_NOT_FOUND','An owned original raw capture is required.',404);return c;
  }
  private summary(kind:RecoveryKind,o:any):RecoveryCase{return {kind,operationId:o.id,state:kind==='LEGACY'?legacyPaymentState(o,o.settlement||this.refunds.claims.get(o.accountId,o.id)):o.refundState||o.state,amountMinor:kind==='LEGACY'?o.amountMinor:kind==='REFUND'?o.quote.amountMinor:o.quote.totalMinor,sourceLabel:kind==='LEGACY'?o.source:`${o.quote.source.nickname}${o.quote.source.last4?` · •••• ${o.quote.source.last4}`:''}`,provider:kind==='LEGACY'?o.merchant:o.quote.payable?.provider||'payments'};}
  list(a:Actor,cursor=''){
    this.owner(a);const rows=this.orders.store.db.prepare(`SELECT * FROM (
      SELECT 'PAYMENT' kind,id,body,'PAYMENT:'||id position FROM payment_authorization_orders WHERE account_id=?
      UNION ALL SELECT 'FUNDING',id,body,'FUNDING:'||id FROM wallet_funding_orders WHERE account_id=?
      UNION ALL SELECT 'REFUND',id,body,'REFUND:'||id FROM payment_refunds WHERE account_id=?
      UNION ALL SELECT 'LEGACY',id,body,'LEGACY:'||id FROM resources WHERE account_id=? AND kind='charge' AND json_extract(body,'$.orderId') IS NULL)
      WHERE position>? ORDER BY position LIMIT 26`).all(a.accountId,a.accountId,a.accountId,a.accountId,cursor);
    return {cases:rows.slice(0,25).map(row=>this.summary(String(row.kind) as RecoveryKind,JSON.parse(String(row.body)))),nextCursor:rows.length>25?String(rows[24].position):null};
  }
  get(a:Actor,id:string):RecoveryInspection{this.owner(a);const row=this.orders.store.db.prepare('SELECT body FROM payment_recovery_inspections WHERE id=? AND account_id=?').get(id,a.accountId);if(!row)deny('RECOVERY_INSPECTION_NOT_FOUND','This inspection is not owned by the workspace.',404);const i=JSON.parse(String(row!.body));if(i.ownerSub!==a.sub)deny('RECOVERY_INSPECTION_NOT_FOUND','Inspection not found.',404);if(i.decisionDigest!==hash(this.decision(i)))deny('RECOVERY_INSPECTION_CORRUPT','The persisted decision binding is inconsistent.');return i;}
  private decision(i:RecoveryInspection){const {id,ownerSub,accountId,kind,operationId,state,amountMinor,sourceLabel,provider,createdAt,expiresAt,termsDigest,localDigest,sourceDigest,classification,captureState,sourceState,reason,actions}=i;return {id,ownerSub,accountId,kind,operationId,state,amountMinor,sourceLabel,provider,createdAt,expiresAt,termsDigest,localDigest,sourceDigest,classification,captureState,sourceState,reason,actions};}
  private save(i:RecoveryInspection){this.orders.store.db.prepare('INSERT INTO payment_recovery_inspections VALUES(?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET body=excluded.body').run(i.id,i.accountId,i.kind,i.operationId,JSON.stringify(i));return i;}
  audit(a:Actor,kind:RecoveryKind,id:string):RecoveryAudit[]{this.local(a,kind,id);return this.orders.store.db.prepare('SELECT body FROM payment_recovery_audit WHERE account_id=? AND kind=? AND operation_id=? ORDER BY rowid DESC LIMIT 100').all(a.accountId,kind,id).map(row=>JSON.parse(String(row.body)));}
  private journal(account:string,reference:string,amount:number){
    const row=this.orders.store.db.prepare('SELECT id,finalized FROM payment_journal_entries WHERE account_id=? AND reference=?').get(account,reference);
    if(!row||row.finalized!==1)return false;const p=this.orders.store.db.prepare('SELECT amount_minor FROM payment_journal_postings WHERE entry_id=? ORDER BY line').all(String(row.id));return p.length===2&&p.reduce((n,r)=>n+Number(r.amount_minor),0)===0&&p.every(r=>Math.abs(Number(r.amount_minor))===amount);
  }
  private async read(source:ProviderClient,a:Actor,provider:string,path:string){try{return {state:'READ',data:await source.call(provider,a,'GET',path)};}catch(e){const status=(e as {status?:number}).status;return {state:status===404?'NOT_FOUND':'UNAVAILABLE',data:undefined};}}
  private async evidence(a:Actor,kind:RecoveryKind,id:string,source:ProviderClient):Promise<Evidence>{
    let o=this.local(a,kind,id),summary=this.summary(kind,o),remote:any={state:'NOT_REQUIRED'},classification:Evidence['classification']='REVIEW_REQUIRED',captureState:Evidence['captureState']='NOT_CAPTURED',sourceState='NOT_REQUIRED',reason='Use the exact existing review and its explicit approval/payment controls.',actions:RecoveryAction[]=[];
    const charge=kind==='PAYMENT'&&o.paymentId?this.orders.store.get(a.accountId,'charge',o.paymentId):kind==='LEGACY'?o:undefined;
    const termsDigest=hash(kind==='LEGACY'?[kind,id,a.accountId,legacyCaptureDigest(o)]:[kind,id,a.accountId,a.sub,o.approvalDigest,o.quote]);
    if(kind==='PAYMENT'){
      const journal=!!o.paymentId&&this.journal(a.accountId,`charge:${o.paymentId}`,o.quote.totalMinor);
      const exact=!!charge&&charge.orderId===o.id&&charge.quoteDigest===o.approvalDigest&&charge.source===o.quote.source.id&&charge.sourceVersion===o.quote.source.version&&charge.amountMinor===o.quote.totalMinor&&charge.admissionId===o.admissionId;
      captureState=o.fundsCaptured?(journal&&exact?'COMMITTED':'INCONSISTENT'):charge||journal?'INCONSISTENT':'NOT_CAPTURED';
      if(o.admissionId)remote=await this.read(source,a,o.quote.payable.provider,`/payables/${encodeURIComponent(o.quote.payable.id)}/admissions/${encodeURIComponent(o.admissionId)}`);
      else if(o.state==='CAPTURING')remote=await this.read(source,a,o.quote.payable.provider,`/payables/${encodeURIComponent(o.quote.payable.id)}`);
      sourceState=remote.data?.admission?.state||remote.state;
      const admission=remote.data?.admission;
      const admittedExact=!admission||admission.id===o.admissionId&&admission.orderId===o.id&&admission.approvalDigest===o.approvalDigest&&admission.sourceId===o.quote.source.id&&admission.sourceVersion===o.quote.source.version&&admission.payable.id===o.quote.payable.id&&admission.payable.revision===o.quote.payable.revision&&admission.payable.amountMinor===o.quote.totalMinor;
      if(captureState==='INCONSISTENT'||o.state==='SETTLED'&&captureState!=='COMMITTED'||!admittedExact){classification='INCONSISTENT';reason='Original capture/journal/admission bindings disagree. Keep funds blocked; no repair is authorized.';}
      else if(['CAPTURING','CAPTURED','RECONCILIATION_REQUIRED'].includes(o.state)||o.sourceFinalizationPending){
        classification=captureState==='COMMITTED'?(sourceState==='APPLIED'?'PROVIDER_APPLIED':'CAPTURE_COMMITTED'):'BEFORE_CAPTURE';reason=captureState==='COMMITTED'?'The original capture committed. Resolve its exact admitted provider operation; do not charge again.':'The original payment was admitted for execution, but no gateway capture committed. Resume only that original attempt.';
        if(remote.state==='UNAVAILABLE'||o.admissionId&&!admission||admission?.state==='CANCELLED'){classification='BLOCKED';reason='Current source admission is unavailable, missing or cancelled. Non-application is not authority for a new charge or an unsupported refund.';}else actions=['RECOVER_ORIGINAL'];
      }else if(o.state==='SETTLED'){
        classification='CONFIRMED';reason='The original provider-confirmed receipt and balanced capture are retained.';
        if((o.refundedMinor||0)<o.quote.totalMinor&&!o.sourceFinalizationPending&&sourceState==='APPLIED')actions=['REQUEST_REFUND_REVIEW'];
      }else if(['FAILED','CANCELLED'].includes(o.state)){classification='NOT_APPLIED';reason='No committed capture exists for this closed original review.';}
    }else if(kind==='FUNDING'){
      const posted=this.journal(a.accountId,`wallet-funding:${id}`,o.quote.totalMinor);captureState=o.fundsCaptured?(posted&&o.receipt&&o.authorization?.state==='CAPTURED'?'COMMITTED':'INCONSISTENT'):posted?'INCONSISTENT':'NOT_CAPTURED';
      classification=captureState==='INCONSISTENT'||o.state==='SETTLED'&&captureState!=='COMMITTED'?'INCONSISTENT':o.state==='SETTLED'?'CONFIRMED':['FAILED','CANCELLED'].includes(o.state)?'NOT_APPLIED':'REVIEW_REQUIRED';reason='Card capture and wallet credit share one transaction. Read the original state; inspection cannot add funds.';
      if(o.state==='SETTLED'&&captureState==='COMMITTED'&&(o.refundedMinor||0)<o.quote.totalMinor)actions=['REQUEST_REFUND_REVIEW'];
    }else if(kind==='REFUND'){
      const q=o.quote;captureState='COMMITTED';
      if(q.origin==='PAYMENT')remote=await this.read(source,a,q.payable.provider,`/payment-reversals/${encodeURIComponent(id)}`);
      sourceState=remote.data?.reversal?.state||remote.state;const reversal=remote.data?.reversal;
      const exact=!reversal||reversal.refundId===id&&reversal.approvalDigest===o.approvalDigest&&(!reversal.receipt||reversal.receipt.refundId===id&&reversal.receipt.approvalDigest===o.approvalDigest&&reversal.receipt.currency==='AED'&&reversal.receipt.provider===q.payable.provider&&Number.isFinite(Date.parse(reversal.receipt.reversedAt))&&reversal.receipt.paymentId===q.paymentId&&reversal.receipt.orderId===q.orderId&&reversal.receipt.amountMinor===q.amountMinor&&reversal.receipt.cumulativeMinor===q.expectedRefundedMinor+q.amountMinor);
      if(!exact){classification='INCONSISTENT';reason='The current source reversal does not match this original refund. No return is authorized.';}
      else if(['REVERSING','RECONCILIATION_REQUIRED'].includes(o.state)){
        classification=sourceState==='APPLIED'?'RETURN_PENDING':sourceState==='UNAVAILABLE'?'BLOCKED':'NOT_APPLIED';reason=sourceState==='APPLIED'?'Provider reversal committed; finish this same refund to its original source.':sourceState==='UNAVAILABLE'?'Provider outcome is unavailable. Keep money blocked.':'The refund was already approved. Inspect/reuse only its original reversal identity.';
        if(sourceState!=='UNAVAILABLE')actions=['RECOVER_ORIGINAL'];
      }else if(o.state==='REFUNDED'){const posted=this.journal(a.accountId,`${q.origin==='PAYMENT'?'order-refund':'funding-refund'}:${id}`,q.amountMinor);classification=posted&&o.receipt?'CONFIRMED':'INCONSISTENT';reason=posted&&o.receipt?'The original source return is confirmed; no second refund is offered.':'The original return and journal do not agree. Keep the case blocked.';}
      else if(['FAILED','CANCELLED'].includes(o.state)){classification='NOT_APPLIED';reason='This refund is closed. Its failure is not a completed money return.';}
    }else{
      let claim=this.refunds.claims.get(a.accountId,id);captureState=o.status==='CAPTURED'&&this.journal(a.accountId,`charge:${id}`,o.amountMinor)?'COMMITTED':o.status==='DECLINED'?'NOT_CAPTURED':'INCONSISTENT';
      if(['rta','dewa','etisalat','du','police'].includes(o.merchant))remote=await this.read(source,a,o.merchant,`/settlement-attempts/${encodeURIComponent(id)}`);
      o=this.local(a,kind,id);claim=this.refunds.claims.get(a.accountId,id);sourceState=remote.data?.settlement?.state||remote.state;const attempt=remote.data?.settlement;
      if(attempt&&(!claim||attempt.paymentId!==id||attempt.attemptId!==claim.attemptId)){classification='INCONSISTENT';reason='Provider attempt and gateway claim do not agree.';}
      else if(captureState==='INCONSISTENT'){classification='INCONSISTENT';reason='Capture and journal disagree. No balance repair is authorized.';}
      else if(o.refunded||claim?.state==='APPLIED'){classification='CONFIRMED';reason='The original capture/return or provider acknowledgement is already recorded.';}
      else if(claim?.state==='RELEASED'&&sourceState==='RELEASED'){classification='NOT_APPLIED';reason='The exact provider attempt and gateway fence both prove non-application. An explicit full original-source return is permitted.';actions=['REFUND_UNAPPLIED_LEGACY'];}
      else{classification=captureState==='NOT_CAPTURED'?'NOT_APPLIED':'BLOCKED';reason='A missing/unavailable source result is not proof of non-application. Keep the original capture blocked.';}
    }
    o=this.local(a,kind,id);summary=this.summary(kind,o);
    return {record:o,remote,summary,termsDigest,localDigest:hash([o,kind==='LEGACY'?this.refunds.claims.get(a.accountId,id):null]),sourceDigest:hash(remote),classification,captureState,sourceState,reason,actions};
  }
  async inspect(a:Actor,kind:RecoveryKind,id:string,source:ProviderClient){
    this.owner(a);const e=await this.evidence(a,kind,id,source),now=this.clock();const i:RecoveryInspection={...e.summary,id:`recovery_${randomUUID()}`,accountId:a.accountId,ownerSub:a.sub,createdAt:new Date(now).toISOString(),expiresAt:new Date(now+300000).toISOString(),decisionDigest:'',termsDigest:e.termsDigest,localDigest:e.localDigest,sourceDigest:e.sourceDigest,classification:e.classification,captureState:e.captureState,sourceState:e.sourceState,reason:e.reason,actions:e.actions,status:'OPEN',attempts:0};i.decisionDigest=hash(this.decision(i));
    return this.atomic(()=>{this.save(i);appendRecoveryAudit(this.orders.store,a,kind,id,'INSPECTED',{inspectionId:i.id,state:e.summary.state});return i;});
  }
  async act(a:Actor,id:string,input:{action:RecoveryAction;decisionDigest:string},source:ProviderClient,legacyRefund:(actor:Actor,id:string)=>any){
    const i=this.get(a,id);try{return await this.executeAction(a,id,input,source,legacyRefund);}catch(e){appendRecoveryAudit(this.orders.store,a,i.kind,i.operationId,'ACTION_ERROR',{inspectionId:id,code:(e as {code?:string}).code||'UNKNOWN'});throw e;}
  }
  private async executeAction(a:Actor,id:string,input:{action:RecoveryAction;decisionDigest:string},source:ProviderClient,legacyRefund:(actor:Actor,id:string)=>any){
    const original=this.get(a,id);if(original.status==='COMPLETED'){if(original.decisionDigest!==input.decisionDigest||original.action!==input.action)deny('RECOVERY_ACTION_CONFLICT','This inspection already has another action.');return original;}
    if(original.decisionDigest!==input.decisionDigest||!original.actions.includes(input.action)||original.action&&original.action!==input.action)deny('RECOVERY_ACTION_DENIED','Use the exact inspected permitted action.');
    if(original.status==='RUNNING'&&(original.leaseUntil||0)>this.clock())deny('RECOVERY_BUSY','This original recovery is already running.');
    const resumed=original.status==='RUNNING'||original.status==='UNKNOWN';
    if(!resumed&&Date.parse(original.expiresAt)<=this.clock())deny('RECOVERY_INSPECTION_EXPIRED','Inspect current evidence again.');
    const evidence=await this.evidence(a,original.kind,original.operationId,source);
    if(evidence.termsDigest!==original.termsDigest||evidence.classification==='INCONSISTENT'||!resumed&&(evidence.localDigest!==original.localDigest||evidence.sourceDigest!==original.sourceDigest))deny('RECOVERY_EVIDENCE_CHANGED','Original state or provider evidence changed. Inspect again.');
    const lease=randomUUID();this.atomic(()=>{const i=this.get(a,id);if(i.status==='COMPLETED')deny('RECOVERY_COMPLETED','Read the completed inspection.');if(i.status==='RUNNING'&&(i.leaseUntil||0)>this.clock())deny('RECOVERY_BUSY','This original recovery is already running.');if(i.attempts>=20)deny('RECOVERY_ATTEMPT_LIMIT','Inspect the current original operation before further recovery.');i.status='RUNNING';i.action=input.action;i.lease=lease;i.leaseUntil=this.clock()+120000;i.attempts++;this.save(i);appendRecoveryAudit(this.orders.store,a,i.kind,i.operationId,'ACTION_ADMITTED',{inspectionId:id,state:i.state});});
    const assert=()=>{const current=this.get(a,id);if(current.status!=='RUNNING'||current.lease!==lease||(current.leaseUntil||0)<=this.clock())deny('RECOVERY_LEASE_LOST','Recovery ownership changed; inspect the original operation.');};
    const timer=setInterval(()=>{try{this.atomic(()=>{const i=this.get(a,id);if(i.status==='RUNNING'&&i.lease===lease&&(i.leaseUntil||0)>this.clock()){i.leaseUntil=this.clock()+120000;this.save(i);}});}catch{/* Outcome remains unknown if the lease cannot be renewed. */}},30000);timer.unref();
    const safeClient={call:async(...args:Parameters<ProviderClient['call']>)=>{assert();const result=await source.call(...args);assert();return result;}} as ProviderClient;
    try{
      assert();const actor={...a,requestId:id};let resultId=original.operationId,resultKind=original.kind;
      if(input.action==='RECOVER_ORIGINAL'){
        if(['CONFIRMED','NOT_APPLIED'].includes(evidence.classification)&&!evidence.actions.includes('RECOVER_ORIGINAL')){/* A previous admitted dispatch already reached its terminal result. */}
        else if(original.kind==='PAYMENT')await new PaymentCheckout(this.orders,safeClient).recover(actor,original.operationId);
        else if(original.kind==='REFUND')await this.refunds.recover(actor,original.operationId,safeClient);
        else deny('RECOVERY_ACTION_DENIED','This record has no recoverable admitted money operation.');
      }else if(input.action==='REQUEST_REFUND_REVIEW'){
        this.atomic(()=>{assert();const o=this.local(a,original.kind,original.operationId);if(hash(o)!==hash(evidence.record))deny('RECOVERY_EVIDENCE_CHANGED','The original changed before review creation.');const r=this.refunds.create(actor,{origin:original.kind==='PAYMENT'?'PAYMENT':'WALLET_FUNDING',orderId:o.id,expectedVersion:o.version,amountMinor:o.quote.totalMinor-(o.refundedMinor||0),reason:'Owner-requested original-source recovery review'});resultId=r.id;resultKind='REFUND';this.finish(a,id,lease,'COMPLETED',resultKind,resultId,r.state);});return this.get(a,id);
      }else{
        this.atomic(()=>{assert();const c=this.local(a,'LEGACY',original.operationId),claim=this.refunds.claims.get(a.accountId,c.id);if(c.refunded||claim?.state!=='RELEASED'||evidence.sourceState!=='RELEASED')deny('RECOVERY_NOT_REFUNDABLE','Provider-confirmed non-application is required.');legacyRefund(actor,c.id);this.finish(a,id,lease,'COMPLETED','LEGACY',c.id,'REFUNDED');});return this.get(a,id);
      }
      assert();const result=this.local(a,resultKind,resultId),state=this.summary(resultKind,result).state;
      this.atomic(()=>this.finish(a,id,lease,['SETTLED','REFUNDED','CANCELLED','FAILED'].includes(result.state||state)?'COMPLETED':'UNKNOWN',resultKind,resultId,state));return this.get(a,id);
    }catch(e){this.atomic(()=>{const i=this.get(a,id);if(i.lease===lease&&i.status==='RUNNING'){i.status='UNKNOWN';i.leaseUntil=0;this.save(i);appendRecoveryAudit(this.orders.store,a,i.kind,i.operationId,'ACTION_UNKNOWN',{inspectionId:id,code:(e as {code?:string}).code||'UNKNOWN'});}});throw e;
    }finally{clearInterval(timer);}
  }
  private finish(a:Actor,id:string,lease:string,status:'COMPLETED'|'UNKNOWN',kind:RecoveryKind,resultId:string,state:string){const i=this.get(a,id);if(i.lease!==lease||i.status!=='RUNNING'||(i.leaseUntil||0)<=this.clock())deny('RECOVERY_LEASE_LOST','A stale recovery cannot acknowledge completion.');i.status=status;i.resultKind=kind;i.resultId=resultId;i.resultState=state;i.leaseUntil=0;this.save(i);appendRecoveryAudit(this.orders.store,a,i.kind,i.operationId,'ACTION_OBSERVED',{inspectionId:id,state,resultId});}
}
