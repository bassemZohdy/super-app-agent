import { emitGatewaySnapshot } from './payment-events.ts';
import { PaymentObligations } from './payment-obligations.ts';
/** Stored interactive authorization reviews. Capture/settlement remain separately gated. */
import { createHash, randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import type { PayableAdmission } from './payable-admissions.ts';
import type { Actor } from '../../../packages/backend-kit/src/context.ts';
import { AccountEligibility } from './account-eligibility.ts';
import { MAX_PAYMENT_MINOR, type PaymentAuthorizationReview as Review, type PaymentMethod, type BillingAccount, type Payable } from '../../../packages/protocol-core/src/payments.ts';
import type { AccountDatabase } from './database.ts';
import { PaymentLedger, PaymentLedgerError } from './payment-ledger.ts';
import { PaymentResourceUses } from './payment-resource-uses.ts';
import { PaymentIssuer, IssuerError, type IssuerBinding } from './payment-issuer.ts';
import { walletMethod } from './payment-registry.ts';
export class PaymentOrderError extends Error {
  readonly status:number;readonly code:string;
  constructor(status:number,code:string,message:string){super(message);this.status=status;this.code=code;}
}
const fail=(code:string,message:string,status=409):never=>{throw new PaymentOrderError(status,code,message);};
const active=(order:Review)=>['AWAITING_APPROVAL','AUTHORIZATION_PENDING','REQUIRES_ACTION','AUTHORIZED','CAPTURING','CAPTURED','RECONCILIATION_REQUIRED'].includes(order.state);
const parkingSession=(order:Review)=>order.quote.payable.kind==='PARKING_EXTENSION';
type OrderInput={provider:string;payableId:string;expectedPayableRevision:string;methodId:string;expectedMethodVersion:number};
export class PaymentOrders {
  readonly obligations:PaymentObligations;
  readonly store:AccountDatabase;readonly issuer:PaymentIssuer;readonly ledger:PaymentLedger;readonly uses:PaymentResourceUses;readonly clock:()=>number;private sequence=0;
  constructor(store:AccountDatabase,issuer:PaymentIssuer,ledger:PaymentLedger,uses:PaymentResourceUses,clock=Date.now){
    this.store=store;store.eligibility ||=new AccountEligibility(store);this.issuer=issuer;this.ledger=ledger;this.uses=uses;this.clock=clock;
    const old=store.db.prepare("SELECT sql FROM sqlite_master WHERE name='payment_authorization_orders'").get();
    const migrate=!!old&&!String(old.sql).includes("'AUTHORIZATION_PENDING'");
    const backup=store.path+(String(old?.sql).includes("'CAPTURING'")?'.before-issuer-order-pending-v3.sqlite':'.before-order-capture-v2.sqlite');
    if(migrate&&store.path!==':memory:'&&!existsSync(backup))store.db.prepare('VACUUM INTO ?').run(backup);
    this.atomic(()=>{if(migrate)store.db.exec('ALTER TABLE payment_authorization_orders RENAME TO payment_authorization_orders_v1;DROP INDEX IF EXISTS payment_active_obligation;DROP INDEX IF EXISTS payment_orders_account;');store.db.exec(`CREATE TABLE IF NOT EXISTS payment_authorization_orders(
      id TEXT PRIMARY KEY,account_id TEXT NOT NULL REFERENCES accounts(id),provider TEXT NOT NULL,payable_id TEXT NOT NULL,
      state TEXT NOT NULL CHECK(state IN ('AWAITING_APPROVAL','AUTHORIZATION_PENDING','REQUIRES_ACTION','AUTHORIZED','CAPTURING','CAPTURED','RECONCILIATION_REQUIRED','SETTLED','FAILED','CANCELLED')),expires_at INTEGER NOT NULL,body TEXT NOT NULL);
      CREATE UNIQUE INDEX IF NOT EXISTS payment_active_obligation ON payment_authorization_orders(account_id,provider,payable_id) WHERE state IN ('AWAITING_APPROVAL','AUTHORIZATION_PENDING','REQUIRES_ACTION','AUTHORIZED','CAPTURING','CAPTURED','RECONCILIATION_REQUIRED','SETTLED');
      CREATE INDEX IF NOT EXISTS payment_orders_account ON payment_authorization_orders(account_id);`);if(migrate)store.db.exec('INSERT INTO payment_authorization_orders SELECT * FROM payment_authorization_orders_v1;DROP TABLE payment_authorization_orders_v1;');});
    this.obligations=new PaymentObligations(store,clock);
  }
  private atomic<T>(fn:()=>T):T{
    if(!this.store.db.isTransaction)return this.store.transaction(fn);
    const name=`orders_${++this.sequence}`;this.store.db.exec(`SAVEPOINT ${name}`);
    try{const result=fn();this.store.db.exec(`RELEASE ${name}`);return result;}catch(e){this.store.db.exec(`ROLLBACK TO ${name}`);this.store.db.exec(`RELEASE ${name}`);throw e;}
  }
  private owned(actor:Actor,id:string):Review{
    if(!this.store.owns(actor.sub,actor.accountId))return fail('ACCOUNT_FORBIDDEN','This workspace does not belong to the owner.',403);
    const row=this.store.db.prepare('SELECT body FROM payment_authorization_orders WHERE account_id=? AND id=?').get(actor.accountId,id);
    if(!row)return fail('ORDER_NOT_FOUND','Authorization review not found for this account.',404);
    const order=JSON.parse(String(row.body)) as Review;if(order.ownerSub!==actor.sub)return fail('ORDER_NOT_FOUND','Authorization review not found.',404);return order;
  }
  private save(order:Review){order.version++;this.store.db.prepare('UPDATE payment_authorization_orders SET state=?,body=? WHERE id=? AND account_id=?').run(order.state,JSON.stringify(order),order.id,order.accountId);this.obligations.sync(order);emitGatewaySnapshot(this.store,'PAYMENT',order);return order;}
  private binding(order:Review):IssuerBinding{return {accountId:order.accountId,ownerSub:order.ownerSub,orderId:order.id,sourceId:order.quote.source.id,sourceVersion:order.quote.source.version,amountMinor:order.quote.totalMinor,approvalDigest:order.approvalDigest,expiresAt:Date.parse(order.authorization!.expiresAt)};}
  private close(order:Review,state:'CANCELLED'|'FAILED',code?:string){
    if(order.authorization){
      if(order.quote.source.kind==='card')order.authorization=this.issuer.void(this.binding(order));
      else {this.ledger.voidHold(order.accountId,order.id);order.authorization.state='VOIDED';}
      this.uses.release(order.accountId,'METHOD',order.quote.source.id,'HOLD',order.authorization.id);
    }
    this.uses.release(order.accountId,'METHOD',order.quote.source.id,'ORDER',order.id);
    if(!parkingSession(order))this.uses.release(order.accountId,'BILLER',order.quote.billingAccount.id,'ORDER',order.id);
    order.state=state;if(code)order.failureCode=code;return this.save(order);
  }
  private sync(order:Review){
    if(!['AWAITING_APPROVAL','AUTHORIZATION_PENDING','REQUIRES_ACTION','AUTHORIZED'].includes(order.state))return order;
    if(Date.parse(order.expiresAt)<=this.clock()||order.authorization&&Date.parse(order.authorization.expiresAt)<=this.clock())return this.close(order,'FAILED',order.authorization?'AUTHORIZATION_EXPIRED':'APPROVAL_EXPIRED');
    if(order.state==='AUTHORIZATION_PENDING'&&order.authorization){
      const auth=this.issuer.get(this.binding(order));order.authorization=auth;
      if(auth.state==='DECLINED'||auth.state==='EXPIRED')return this.close(order,'FAILED',auth.failureCode||'AUTHORIZATION_EXPIRED');
      if(auth.state==='AUTHORIZED'){order.state='AUTHORIZED';return this.save(order);}
    }
    return order;
  }
  refresh(actor:Actor){return this.atomic(()=>{if(!this.store.owns(actor.sub,actor.accountId))return fail('ACCOUNT_FORBIDDEN','This workspace does not belong to the owner.',403);const rows=this.store.db.prepare("SELECT body FROM payment_authorization_orders WHERE account_id=? AND state IN ('AWAITING_APPROVAL','AUTHORIZATION_PENDING','REQUIRES_ACTION','AUTHORIZED')").all(actor.accountId);for(const row of rows)this.sync(JSON.parse(String(row.body)));});}
  get(actor:Actor,id:string){return this.atomic(()=>this.sync(this.owned(actor,id)));}
  list(actor:Actor){return this.atomic(()=>{this.refresh(actor);return this.store.db.prepare('SELECT body FROM payment_authorization_orders WHERE account_id=? ORDER BY rowid DESC LIMIT 100').all(actor.accountId).map(row=>JSON.parse(String(row.body)) as Review);});}
  private source(account:string,id:string,version:number){
    const method=id==='wallet'?walletMethod(account):this.store.get<PaymentMethod>(account,'payment-method',id);
    if(!method||method.status!=='ACTIVE'||method.version!==version)return fail('METHOD_CHANGED','The selected source is unavailable or changed.');
    const now=new Date(this.clock());if(method.kind==='card'&&(!method.expiresYear||!method.expiresMonth||method.expiresYear<now.getUTCFullYear()||method.expiresYear===now.getUTCFullYear()&&method.expiresMonth<now.getUTCMonth()+1))return fail('METHOD_EXPIRED','The selected card is expired.');return method;
  }
  private fresh(payable:Payable|undefined,provider:string,id:string,revision:string){
    if(!payable||payable.provider!==provider||payable.id!==id||payable.revision!==revision||payable.status!=='UNPAID'||payable.paymentRestricted)return fail('PAYABLE_CHANGED','The current obligation changed or is unavailable. Review it again.');
    if(!Number.isSafeInteger(payable.amountMinor)||payable.amountMinor<1||payable.amountMinor>MAX_PAYMENT_MINOR||payable.currency!=='AED'||!/^[a-f0-9]{64}$/.test(payable.revision))return fail('INVALID_QUOTE','The source provider returned invalid payment terms.');return payable;
  }
  create(actor:Actor,input:OrderInput,snapshot:Payable|undefined):Review{return this.build(actor,input,snapshot);}
  /** An automatic order exists only to be admitted by the dedicated execution route; ordinary approve/challenge/capture/cancel refuse it. */
  createAutomatic(actor:Actor,input:OrderInput,snapshot:Payable|undefined,automation:NonNullable<Review['automation']>):Review{return this.build(actor,input,snapshot,automation);}
  private build(actor:Actor,input:OrderInput,snapshot:Payable|undefined,automation?:Review['automation']):Review{
    return this.atomic(()=>{
      const eligibility=this.store.eligibility!.require(actor);this.refresh(actor);const payable=this.fresh(snapshot,input.provider,input.payableId,input.expectedPayableRevision),source=this.source(actor.accountId,input.methodId,input.expectedMethodVersion);
      // A parking extension is bound to the session the source quoted, not to a linked biller, and only an automatic order may carry one.
      if(payable.kind==='PARKING_EXTENSION'&&!automation)return fail('PAYABLE_NOT_SUPPORTED','Parking extensions are paid by an approved automation rule only.');
      const links=this.store.list(actor.accountId,'billing-account') as BillingAccount[],link=payable.kind==='PARKING_EXTENSION'
        ?{id:`parking:${payable.reference}`,accountId:actor.accountId,provider:payable.provider as BillingAccount['provider'],reference:payable.reference,nickname:'Parking session',status:'ACTIVE' as const,version:1,createdAt:new Date(this.clock()).toISOString()}
        :links.find(b=>b.status==='ACTIVE'&&b.provider===payable.provider&&b.reference===payable.reference);
      if(!link)return fail('BILLER_NOT_LINKED','Link this owned biller before creating an authorization review.');
      if(this.store.db.prepare("SELECT id FROM payment_authorization_orders WHERE account_id=? AND provider=? AND payable_id=? AND state IN ('AWAITING_APPROVAL','AUTHORIZATION_PENDING','REQUIRES_ACTION','AUTHORIZED','CAPTURING','CAPTURED','RECONCILIATION_REQUIRED','SETTLED')").get(actor.accountId,input.provider,input.payableId))return fail('PAYABLE_RESERVED','An active or settled order already reserves this obligation. Inspect it first.');
      const count=this.store.db.prepare('SELECT count(*) n FROM payment_authorization_orders WHERE account_id=?').get(actor.accountId) as {n:number};if(count.n>=100)return fail('ORDER_HISTORY_LIMIT','The local authorization-review history limit was reached.');
      const id=`order_${randomUUID()}`,createdAt=new Date(this.clock()).toISOString(),expiresAt=new Date(this.clock()+300000).toISOString();
      const quote={payable:structuredClone(payable),source:structuredClone(source),billingAccount:structuredClone(link),amountMinor:payable.amountMinor,feeMinor:0,totalMinor:payable.amountMinor,currency:'AED' as const,createdAt,expiresAt};
      const approvalDigest=createHash('sha256').update(JSON.stringify(automation?[actor.sub,actor.accountId,id,quote,eligibility.epoch,automation]:[actor.sub,actor.accountId,id,quote,eligibility.epoch])).digest('hex');
      const order:Review={eligibilityEpoch:eligibility.epoch,id,accountId:actor.accountId,ownerSub:actor.sub,quote,approvalDigest,expiresAt,createdAt,state:'AWAITING_APPROVAL',version:1,fundsCaptured:false,...(automation?{automation}:{})};
      this.uses.bind(actor.accountId,{resourceType:'METHOD',resourceId:source.id,resourceVersion:source.version,dependentKind:'ORDER',dependentId:id});
      if(payable.kind!=='PARKING_EXTENSION')this.uses.bind(actor.accountId,{resourceType:'BILLER',resourceId:link.id,resourceVersion:link.version,dependentKind:'ORDER',dependentId:id});
      this.store.db.prepare('INSERT INTO payment_authorization_orders VALUES(?,?,?,?,?,?,?)').run(id,actor.accountId,input.provider,input.payableId,order.state,Date.parse(expiresAt),JSON.stringify(order));this.obligations.reserve(order);emitGatewaySnapshot(this.store,'PAYMENT',order);return order;
    });
  }
  /** The only way to decide an automatic order: approve, authorize and begin capture for the stored execution. Callers must hold a consumed permit. */
  admitAutomatic(actor:Actor,id:string,automation:NonNullable<Review['automation']>,snapshot:Payable):Review{return this.atomic(()=>{
    const order=this.sync(this.owned(actor,id));
    if(!order.automation||order.automation.executionId!==automation.executionId||order.automation.mandateId!==automation.mandateId||order.automation.boundDigest!==automation.boundDigest)return fail('ORDER_AUTOMATIC','This order does not belong to the presented execution.',403);
    if(order.state==='AWAITING_APPROVAL'){const approved=this.approve(actor,id,{expectedVersion:order.version,approvalDigest:order.approvalDigest},snapshot,true);if(approved.state!=='AUTHORIZED')return approved;}
    const ready=this.owned(actor,id);if(ready.state!=='AUTHORIZED')return ready;
    return this.beginCapture(actor,id,{expectedVersion:ready.version,approvalDigest:ready.approvalDigest},snapshot,true);
  });}
  private decision(actor:Actor,id:string,input:{expectedVersion:number;approvalDigest:string},snapshot:Payable|undefined,automatic=false){
    const order=this.sync(this.owned(actor,id));if(!!order.automation!==automatic)return fail('ORDER_AUTOMATIC','This order belongs to an automation mandate and is admitted only by its dedicated execution route.',403);this.store.eligibility!.require(actor,order.eligibilityEpoch||'1:1');
    if(order.version!==input.expectedVersion||order.approvalDigest!==input.approvalDigest)return fail('APPROVAL_CHANGED','The stored review changed or its approval does not match.');
    if(!active(order))return fail('ORDER_CLOSED','This authorization review is closed.');
    this.obligations.assertHeld(order);
    const current=this.fresh(snapshot,order.quote.payable.provider,order.quote.payable.id,order.quote.payable.revision);
    if(current.amountMinor!==order.quote.totalMinor||current.reference!==order.quote.payable.reference)return fail('PAYABLE_CHANGED','The provider terms changed.');
    if(!parkingSession(order)){const link=this.store.get<BillingAccount>(actor.accountId,'billing-account',order.quote.billingAccount.id);
    if(!link||link.status!=='ACTIVE'||link.version!==order.quote.billingAccount.version)return fail('BILLER_CHANGED','The linked biller is unavailable or changed.');}
    return order;
  }
  approve(actor:Actor,id:string,input:{expectedVersion:number;approvalDigest:string},snapshot:Payable|undefined,automatic=false){
    return this.atomic(()=>{
      const order=this.decision(actor,id,input,snapshot,automatic);if(order.state!=='AWAITING_APPROVAL')return fail('ALREADY_DECIDED','This review has already been approved.');
      try{
        this.source(actor.accountId,order.quote.source.id,order.quote.source.version);
        const expiresAt=Math.min(Date.parse(order.expiresAt),this.clock()+120000);
        if(order.quote.source.kind==='wallet'){
          this.ledger.reserve(actor.accountId,order.id,order.quote.totalMinor,expiresAt);
          order.authorization={id:`hold_${order.id}`,orderId:order.id,sourceId:'wallet',amountMinor:order.quote.totalMinor,currency:'AED',state:'AUTHORIZED',expiresAt:new Date(expiresAt).toISOString()};
        }else{
          const binding:IssuerBinding={accountId:order.accountId,ownerSub:order.ownerSub,orderId:order.id,sourceId:order.quote.source.id,sourceVersion:order.quote.source.version,amountMinor:order.quote.totalMinor,approvalDigest:order.approvalDigest,expiresAt};
          const authorization=this.issuer.authorize(binding);
          if(authorization.state==='DECLINED')return this.close(order,'FAILED',authorization.failureCode);
          order.authorization=authorization;
        }
      }catch(e){if(e instanceof IssuerError||e instanceof PaymentOrderError||e instanceof PaymentLedgerError)return this.close(order,'FAILED',e.code);throw e;}
      order.approvedAt=new Date(this.clock()).toISOString();order.state=order.authorization!.state==='PENDING'?'AUTHORIZATION_PENDING':order.authorization!.state==='REQUIRES_ACTION'?'REQUIRES_ACTION':'AUTHORIZED';
      this.uses.bind(actor.accountId,{resourceType:'METHOD',resourceId:order.quote.source.id,resourceVersion:order.quote.source.version,dependentKind:'HOLD',dependentId:order.authorization!.id});return this.save(order);
    });
  }
  challenge(actor:Actor,id:string,input:{expectedVersion:number;approvalDigest:string;challengeId:string;decision:'APPROVE'|'REJECT'},snapshot:Payable|undefined,interactive:boolean){
    return this.atomic(()=>{
      const order=this.decision(actor,id,input,snapshot);this.source(actor.accountId,order.quote.source.id,order.quote.source.version);if(order.state!=='REQUIRES_ACTION'||!order.authorization)return fail('CHALLENGE_CLOSED','This order has no pending challenge.');
      const auth=this.issuer.challenge(this.binding(order),input.challengeId,input.decision,interactive);
      order.authorization=auth;if(auth.state==='DECLINED')return this.close(order,'FAILED',auth.failureCode);
      order.state='AUTHORIZED';return this.save(order);
    });
  }
  /** Closes an automatic order that provably never reached funds, so its reservations can be released. Captured work is never touched. */
  cancelAutomatic(actor:Actor,id:string,automation:NonNullable<Review['automation']>):Review{return this.atomic(()=>{
    const order=this.sync(this.owned(actor,id));
    if(!order.automation||order.automation.executionId!==automation.executionId)return fail('ORDER_AUTOMATIC','This order does not belong to the presented execution.',403);
    if(order.fundsCaptured||!['AWAITING_APPROVAL'].includes(order.state))return order;
    return this.close(order,'CANCELLED','AUTOMATION_RELEASED');
  });}
  cancel(actor:Actor,id:string,expectedVersion:number){return this.atomic(()=>{const order=this.sync(this.owned(actor,id));if(order.automation)return fail('ORDER_AUTOMATIC','Revoke or pause the mandate instead; an automatic order is not cancelled directly.',403);if(order.version!==expectedVersion)return fail('ORDER_CHANGED','Refresh this review before cancelling.');if(!active(order)||order.fundsCaptured)return fail('ORDER_CLOSED','Captured or closed orders cannot be cancelled.');return this.close(order,'CANCELLED');});}
  beginCapture(actor:Actor,id:string,input:{expectedVersion:number;approvalDigest:string},snapshot:Payable,automatic=false){return this.atomic(()=>{
    const order=this.decision(actor,id,input,snapshot,automatic);if(order.state!=='AUTHORIZED'||!order.authorization)return fail('ORDER_NOT_AUTHORIZED','Authorize this exact order before payment.');
    if(!['BILL','FINE','FINE_SET','RECHARGE','PARKING_EXTENSION'].includes(order.quote.payable.kind||''))return fail('PAYABLE_NOT_SUPPORTED','This payment flow supports utility/telecom bills and exact fine selections.');
    this.source(actor.accountId,order.quote.source.id,order.quote.source.version);order.state='CAPTURING';order.paymentId=`payment_${randomUUID()}`;return this.save(order);
  });}
  private sameAdmission(order:Review,admission:PayableAdmission){return admission.orderId===order.id&&admission.approvalDigest===order.approvalDigest&&admission.payable.id===order.quote.payable.id&&admission.payable.revision===order.quote.payable.revision&&admission.payable.provider===order.quote.payable.provider&&admission.payable.reference===order.quote.payable.reference&&admission.payable.amountMinor===order.quote.totalMinor&&admission.payable.currency==='AED'&&admission.sourceId===order.quote.source.id&&admission.sourceVersion===order.quote.source.version&&Number.isFinite(Date.parse(admission.expiresAt))&&Date.parse(admission.expiresAt)<=Date.parse(order.authorization!.expiresAt);}
  attachAdmission(actor:Actor,id:string,admission:PayableAdmission){return this.atomic(()=>{const order=this.owned(actor,id);if(order.state!=='CAPTURING'||order.fundsCaptured||!this.sameAdmission(order,admission))return fail('ADMISSION_MISMATCH','Provider reservation does not match the pending capture.');order.admissionId=admission.id;return this.save(order);});}
  abortCapture(actor:Actor,id:string,code:string){return this.atomic(()=>{const order=this.owned(actor,id);if(order.fundsCaptured)return this.unresolved(actor,id,code);if(order.state==='CAPTURING')return this.close(order,'FAILED',code);return order;});}
  unresolved(actor:Actor,id:string,code:string){return this.atomic(()=>{const order=this.owned(actor,id);if(order.state==='SETTLED')return order;if(order.fundsCaptured){order.state='RECONCILIATION_REQUIRED';order.failureCode=code;return this.save(order);}if(order.state==='CAPTURING')this.obligations.unknown(order);return order;});}
  capture(actor:Actor,id:string,admission:PayableAdmission){return this.atomic(()=>{
    const order=this.owned(actor,id);if(order.fundsCaptured)return order;this.store.eligibility!.require(actor,order.eligibilityEpoch||'1:1');
    if(order.state!=='CAPTURING'||!order.authorization||order.admissionId!==admission.id||admission.state!=='ADMITTED'||!this.sameAdmission(order,admission)||Date.parse(admission.expiresAt)<=this.clock()||Date.parse(order.authorization.expiresAt)<=this.clock()||Date.parse(order.expiresAt)<=this.clock())return fail('CAPTURE_NOT_ADMITTED','A current exact provider admission and funding hold are required.');
    this.obligations.assertHeld(order);
    this.source(actor.accountId,order.quote.source.id,order.quote.source.version);
    if(!parkingSession(order)){const link=this.store.get<BillingAccount>(actor.accountId,'billing-account',order.quote.billingAccount.id);if(!link||link.status!=='ACTIVE'||link.version!==order.quote.billingAccount.version)return fail('BILLER_CHANGED','The biller link changed.');}
    if(order.quote.source.kind==='wallet'){this.ledger.captureHold(actor.accountId,id,order.paymentId!,order.quote.totalMinor);order.authorization.state='CAPTURED';}
    else{order.authorization=this.issuer.capture(this.binding(order));this.ledger.record(actor.accountId,'PAYMENT',`charge:${order.paymentId}`,order.quote.totalMinor,'external');}
    const charge={id:order.paymentId,accountId:actor.accountId,amountMinor:order.quote.totalMinor,merchant:order.quote.payable.provider,reference:`payable:${order.quote.payable.revision}`,source:order.quote.source.id,sourceVersion:order.quote.source.version,status:'CAPTURED',currency:'AED',createdAt:new Date(this.clock()).toISOString(),refunded:false,orderId:id,attemptId:`capture_${id}`,admissionId:admission.id,quoteDigest:order.approvalDigest};
    this.store.put(actor.accountId,'charge',charge,order.paymentId!);this.store.put(actor.accountId,'transaction',{id:order.paymentId,type:'PAYMENT',amount:order.quote.totalMinor/100,currency:'AED',purpose:order.quote.payable.label,status:'CAPTURED',timestamp:this.clock(),orderId:id,source:order.quote.source},order.paymentId!);
    this.uses.release(actor.accountId,'METHOD',order.quote.source.id,'HOLD',order.authorization.id);order.fundsCaptured=true;order.state='CAPTURED';return this.save(order);
  });}
  finalized(actor:Actor,id:string){return this.atomic(()=>{const o=this.owned(actor,id);if(o.state!=='SETTLED'||o.quote.payable.kind!=='RECHARGE')return fail('RECHARGE_NOT_CONFIRMED','This recharge is not settled.');if(o.sourceFinalizationPending){o.sourceFinalizationPending=false;return this.save(o);}return o;});}
  complete(actor:Actor,id:string,admission:PayableAdmission){return this.atomic(()=>{
    const order=this.owned(actor,id);if(order.state==='SETTLED')return order;
    if(!order.fundsCaptured||admission.id!==order.admissionId||!this.sameAdmission(order,admission)||admission.state!=='APPLIED'||admission.receipt?.receiptNumber!==order.paymentId||admission.receipt?.amountMinor!==order.quote.totalMinor||admission.receipt?.currency!=='AED'||admission.receipt?.obligationId!==order.quote.payable.obligationId)return fail('SETTLEMENT_NOT_CONFIRMED','The provider has not confirmed this exact payment.');
    if(order.quote.payable.kind==='RECHARGE'&&(admission.receipt.targetReference!==order.quote.payable.reference||admission.receipt.providerBalanceMinor!==order.quote.payable.recharge!.balanceBeforeMinor+order.quote.totalMinor))return fail('SETTLEMENT_NOT_CONFIRMED','The provider has not confirmed this exact target credit.');
    order.state='SETTLED';order.receipt=admission.receipt;if(order.quote.payable.kind==='RECHARGE')order.sourceFinalizationPending=true;delete order.failureCode;
    const transaction=this.store.get(actor.accountId,'transaction',order.paymentId!);this.store.put(actor.accountId,'transaction',{...transaction,status:'SETTLED'},order.paymentId!);
    this.uses.release(actor.accountId,'METHOD',order.quote.source.id,'ORDER',id);if(!parkingSession(order))this.uses.release(actor.accountId,'BILLER',order.quote.billingAccount.id,'ORDER',id);return this.save(order);
  });}
}
