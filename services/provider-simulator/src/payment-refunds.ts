import { emitGatewaySnapshot } from './payment-events.ts';
import { initializeRecoveryAudit,appendRecoveryAudit } from './recovery-audit.ts';
/** Owner-approved, cumulative refunds. Provider reversal and original-source money return remain distinct stages. */
import { createHash,randomUUID } from 'node:crypto';
import type { Actor } from '../../../packages/backend-kit/src/context.ts';
import type { ProviderClient } from '../../../packages/backend-kit/src/provider-client.ts';
import type { PaymentRefund,ReversalReceipt,PaymentAuthorizationReview } from '../../../packages/protocol-core/src/payments.ts';
import { MAX_PAYMENT_MINOR } from '../../../packages/protocol-core/src/payments.ts';
import { PaymentOrderError } from './payment-orders.ts';
import type { PaymentOrders } from './payment-orders.ts';
import type { WalletFunding } from './wallet-funding.ts';
import type { PaymentClaims,SettlementProvider } from './payment-claims.ts';
const fail=(code:string,message:string,status=409):never=>{throw new PaymentOrderError(status,code,message);};
export class PaymentRefunds {
  readonly orders:PaymentOrders;readonly funding:WalletFunding;readonly claims:PaymentClaims;private sequence=0;
  constructor(orders:PaymentOrders,funding:WalletFunding,claims:PaymentClaims){this.orders=orders;this.funding=funding;this.claims=claims;orders.store.db.exec(`CREATE TABLE IF NOT EXISTS payment_refunds(id TEXT PRIMARY KEY,account_id TEXT NOT NULL REFERENCES accounts(id),origin TEXT NOT NULL,order_id TEXT NOT NULL,state TEXT NOT NULL CHECK(state IN ('AWAITING_APPROVAL','REVERSING','RECONCILIATION_REQUIRED','REFUNDED','FAILED','CANCELLED')),body TEXT NOT NULL);
    CREATE UNIQUE INDEX IF NOT EXISTS refund_active_order ON payment_refunds(account_id,origin,order_id) WHERE state IN ('AWAITING_APPROVAL','REVERSING','RECONCILIATION_REQUIRED');`);}
  private atomic<T>(fn:()=>T):T{const db=this.orders.store;if(!db.db.isTransaction)return db.transaction(fn);const name=`refund_${++this.sequence}`;db.db.exec(`SAVEPOINT ${name}`);try{const result=fn();db.db.exec(`RELEASE ${name}`);return result;}catch(e){db.db.exec(`ROLLBACK TO ${name}`);db.db.exec(`RELEASE ${name}`);throw e;}}
  /** Bind the payment-provider request key before any asynchronous dispatch, including failed/unknown responses. */
  reserveRequest(account:string,key:string,fingerprint:string){return this.atomic(()=>{
    const db=this.orders.store,cached=db.db.prepare('SELECT fingerprint FROM idempotency WHERE account_id=? AND key=?').get(account,key);
    if(cached){if(cached.fingerprint!==fingerprint)return fail('IDEMPOTENCY_CONFLICT','This key already has different payment terms.');return;}
    const prior=db.get<{fingerprint:string}>(account,'payment-request-reservation',key);
    if(prior&&prior.fingerprint!==fingerprint)return fail('IDEMPOTENCY_CONFLICT','This payment request key is already reserved for different terms.');
    if(!prior)db.put(account,'payment-request-reservation',{fingerprint},key);
  });}
  private owner(a:Actor){if(!this.orders.store.owns(a.sub,a.accountId))return fail('ACCOUNT_FORBIDDEN','This refund does not belong to the owner.',403);}
  get(a:Actor,id:string):PaymentRefund{this.owner(a);const row=this.orders.store.db.prepare('SELECT body FROM payment_refunds WHERE account_id=? AND id=?').get(a.accountId,id);if(!row)return fail('REFUND_NOT_FOUND','Refund not found in this workspace.',404);const r=JSON.parse(String(row.body));if(r.ownerSub!==a.sub)return fail('REFUND_NOT_FOUND','Refund not found.',404);return r;}
  list(a:Actor){this.owner(a);return this.orders.store.db.prepare('SELECT id FROM payment_refunds WHERE account_id=? ORDER BY rowid DESC LIMIT 100').all(a.accountId).map(row=>this.get(a,String(row.id)));}
  private save(r:PaymentRefund){r.version++;this.orders.store.db.prepare('UPDATE payment_refunds SET state=?,body=? WHERE id=? AND account_id=?').run(r.state,JSON.stringify(r),r.id,r.accountId);emitGatewaySnapshot(this.orders.store,'REFUND',r);return r;}
  private original(a:Actor,origin:PaymentRefund['quote']['origin'],id:string){return origin==='PAYMENT'?this.orders.get(a,id):this.funding.get(a,id);}
  create(a:Actor,input:{origin:PaymentRefund['quote']['origin'];orderId:string;expectedVersion:number;amountMinor:number;reason:string}):PaymentRefund{return this.atomic(()=>{
    this.owner(a);const eligibility=this.orders.store.eligibility!.require(a);const o=this.original(a,input.origin,input.orderId);
    if(o.version!==input.expectedVersion||o.state!=='SETTLED'||!o.fundsCaptured||!o.receipt)return fail('REFUND_ORIGINAL_CHANGED','Choose a current confirmed captured payment.');
    if(!Number.isSafeInteger(input.amountMinor)||input.amountMinor<1||input.amountMinor>MAX_PAYMENT_MINOR||input.amountMinor+(o.refundedMinor||0)>o.quote.totalMinor)return fail('REFUND_LIMIT','Refund cannot exceed the remaining captured amount.');
    if(!input.reason||input.reason.length>160||!input.reason.trim())return fail('REFUND_REASON_REQUIRED','Give a bounded reason for this demo reversal.',400);
    const p=input.origin==='PAYMENT'?(o as PaymentAuthorizationReview):undefined;
    if(p){
      if(p.sourceFinalizationPending||!p.admissionId||!p.paymentId)return fail('SETTLEMENT_STATUS_UNKNOWN','Finish original payment confirmation before requesting reversal.');
      const claim=this.claims.get(a.accountId,p.paymentId);if(claim?.state!=='APPLIED'||(claim.reversedMinor||0)!==(o.refundedMinor||0))return fail('SETTLEMENT_STATUS_UNKNOWN','Current provider application and cumulative reversal must be confirmed.');
      if(p.quote.payable.kind!=='RECHARGE'&&((o.refundedMinor||0)!==0||input.amountMinor!==o.quote.totalMinor))return fail('FULL_REVERSAL_REQUIRED','Bills and fine selections support full provider cancellation only.');
    }
    const db=this.orders.store;
    if(db.db.prepare("SELECT id FROM payment_refunds WHERE account_id=? AND origin=? AND order_id=? AND state IN ('AWAITING_APPROVAL','REVERSING','RECONCILIATION_REQUIRED')").get(a.accountId,input.origin,input.orderId))return fail('REFUND_IN_PROGRESS','Inspect or cancel the existing refund first.');
    if(this.list(a).length>=100)return fail('REFUND_HISTORY_LIMIT','This demo workspace reached its refund history limit.');
    const id=`refund_${randomUUID()}`,createdAt=new Date(this.orders.clock()).toISOString(),expiresAt=new Date(this.orders.clock()+300000).toISOString();
    const quote:PaymentRefund['quote']={origin:input.origin,orderId:o.id,paymentId:p?p.paymentId!:o.id,source:structuredClone(o.quote.source),amountMinor:input.amountMinor,originalAmountMinor:o.quote.totalMinor,expectedRefundedMinor:o.refundedMinor||0,currency:'AED',reason:input.reason.trim(),originalApprovalDigest:o.approvalDigest,...(p?{payable:structuredClone(p.quote.payable),admissionId:p.admissionId}:{})};
    const approvalDigest=createHash('sha256').update(JSON.stringify([a.sub,a.accountId,id,quote,expiresAt,eligibility.epoch])).digest('hex');
    const r:PaymentRefund={eligibilityEpoch:eligibility.epoch,id,accountId:a.accountId,ownerSub:a.sub,version:1,state:'AWAITING_APPROVAL',approvalDigest,quote,createdAt,expiresAt};db.db.prepare('INSERT INTO payment_refunds VALUES(?,?,?,?,?,?)').run(id,a.accountId,input.origin,o.id,r.state,JSON.stringify(r));emitGatewaySnapshot(db,'REFUND',r);return r;
  });}
  cancel(a:Actor,id:string,version:number){return this.atomic(()=>{const r=this.get(a,id);if(r.version!==version||r.state!=='AWAITING_APPROVAL')return fail('REFUND_CLOSED','Only an unstarted current refund can be cancelled.');r.state='CANCELLED';return this.save(r);});}
  private begin(a:Actor,id:string,input:{expectedVersion:number;approvalDigest:string}){return this.atomic(()=>{const r=this.get(a,id);this.orders.store.eligibility!.require(a,r.eligibilityEpoch||'1:1');if(r.version!==input.expectedVersion||r.approvalDigest!==input.approvalDigest)return fail('APPROVAL_CHANGED','Approve the exact original source and refund amount.');if(r.state!=='AWAITING_APPROVAL'||Date.parse(r.expiresAt)<=this.orders.clock())return fail('REFUND_CLOSED','This refund review is closed or expired.');r.state='REVERSING';return this.save(r);});}
  private failed(a:Actor,id:string,code:string){return this.atomic(()=>{const r=this.get(a,id);if(r.state==='REFUNDED')return r;r.state='FAILED';r.failureCode=code;return this.save(r);});}
  private complete(a:Actor,id:string,receipt:ReversalReceipt){return this.atomic(()=>{
    const r=this.get(a,id),q=r.quote;if(r.state==='REFUNDED')return r;
    if(!['REVERSING','RECONCILIATION_REQUIRED'].includes(r.state)||receipt.refundId!==r.id||receipt.approvalDigest!==r.approvalDigest||receipt.paymentId!==q.paymentId||receipt.orderId!==q.orderId||receipt.amountMinor!==q.amountMinor||receipt.cumulativeMinor!==q.expectedRefundedMinor+q.amountMinor||receipt.currency!=='AED'||receipt.provider!==(q.payable?.provider||'payments')||!Number.isFinite(Date.parse(receipt.reversedAt)))return fail('REVERSAL_MISMATCH','The provider reversal does not match this exact refund.');
    const original=this.original(a,q.origin,q.orderId);
    if(original.approvalDigest!==q.originalApprovalDigest||original.state!=='SETTLED'||!original.fundsCaptured||original.quote.source.id!==q.source.id||original.quote.totalMinor!==q.originalAmountMinor||(original.refundedMinor||0)!==q.expectedRefundedMinor)return fail('REFUND_ORIGINAL_CHANGED','Original capture or cumulative refund changed. Reconcile this refund.');
    const db=this.orders.store;
    if(q.origin==='WALLET_FUNDING')this.orders.ledger.reverseFunding(a.accountId,r.id,q.amountMinor);
    else{this.claims.recordReversal(a.accountId,q.paymentId,q.payable!.provider as SettlementProvider,q.amountMinor,q.expectedRefundedMinor);this.orders.ledger.record(a.accountId,'REFUND',`order-refund:${r.id}`,q.amountMinor,q.source.kind==='wallet'?'wallet':'external');}
    if(q.source.kind==='card')this.orders.issuer.refund(a.accountId,a.sub,q.orderId,q.source.id,q.amountMinor,r.id);
    const total=q.expectedRefundedMinor+q.amountMinor;original.refundedMinor=total;original.refundState=total===q.originalAmountMinor?'REFUNDED':'PARTIALLY_REFUNDED';original.version++;
    const table=q.origin==='PAYMENT'?'payment_authorization_orders':'wallet_funding_orders';db.db.prepare(`UPDATE ${table} SET body=? WHERE account_id=? AND id=?`).run(JSON.stringify(original),a.accountId,q.orderId);emitGatewaySnapshot(db,q.origin==='PAYMENT'?'PAYMENT':'FUNDING',original);
    if(q.origin==='PAYMENT'){const charge=db.get(a.accountId,'charge',q.paymentId);db.put(a.accountId,'charge',{...charge,refundedMinor:total,refunded:total===q.originalAmountMinor,refundState:original.refundState},q.paymentId);}
    const transaction=db.get(a.accountId,'transaction',q.paymentId);if(transaction)db.put(a.accountId,'transaction',{...transaction,refundedMinor:total,refundState:original.refundState},q.paymentId);
    db.put(a.accountId,'transaction',{id:r.id,type:'REFUND',amount:q.amountMinor/100,currency:'AED',status:'SETTLED',purpose:q.reason,timestamp:this.orders.clock(),orderId:q.orderId,originalPaymentId:q.paymentId,source:q.source,reversal:receipt},r.id);
    r.state='REFUNDED';r.receipt=receipt;delete r.failureCode;return this.save(r);
  });}
  async execute(a:Actor,id:string,input:{expectedVersion:number;approvalDigest:string},client:ProviderClient){this.begin(a,id,input);return this.recover(a,id,client);}
  async recover(a:Actor,id:string,client:ProviderClient){
    initializeRecoveryAudit(this.orders.store);const before=this.get(a,id);appendRecoveryAudit(this.orders.store,a,'REFUND',id,'RECOVERY_STARTED',{state:before.state,paymentId:before.quote.paymentId});
    try{const result=await this.runRecovery(a,id,client);appendRecoveryAudit(this.orders.store,a,'REFUND',id,'RECOVERY_OBSERVED',{state:result.state,paymentId:result.quote.paymentId});return result;}
    catch(e){appendRecoveryAudit(this.orders.store,a,'REFUND',id,'RECOVERY_UNKNOWN',{code:(e as {code?:string}).code||'UNKNOWN'});throw e;}
  }
  private async runRecovery(a:Actor,id:string,client:ProviderClient){
    const r=this.get(a,id);if(['REFUNDED','FAILED','CANCELLED'].includes(r.state))return r;
    if(!['REVERSING','RECONCILIATION_REQUIRED'].includes(r.state))return fail('REFUND_APPROVAL_REQUIRED','Explicitly approve the refund before reversal.');
    if(r.quote.origin==='WALLET_FUNDING'){
      try{return this.complete(a,id,{refundId:id,paymentId:r.quote.paymentId,orderId:r.quote.orderId,approvalDigest:r.approvalDigest,amountMinor:r.quote.amountMinor,cumulativeMinor:r.quote.expectedRefundedMinor+r.quote.amountMinor,currency:'AED',provider:'payments',reversedAt:new Date(this.orders.clock()).toISOString()});}
      catch(e){if(e instanceof PaymentOrderError||typeof (e as {code?:string}).code==='string')return this.failed(a,id,(e as {code:string}).code);throw e;}
    }
    try{
      const route=`/payment-reversals/${id}`,provider=r.quote.payable!.provider;let reversal;
      try{reversal=(await client.call(provider,a,'GET',route)).reversal;}catch(e){if((e as {status?:number}).status!==404)throw e;}
      if(!reversal){await client.call(provider,a,'POST',route,{},`payment-reversal:${id}`);reversal=(await client.call(provider,a,'GET',route)).reversal;}
      if(reversal.refundId!==id||reversal.approvalDigest!==r.approvalDigest)return fail('REVERSAL_MISMATCH','Provider returned another reversal.');
      if(reversal.state==='REJECTED')return this.failed(a,id,reversal.failureCode||'REVERSAL_REJECTED');
      if(reversal.state!=='APPLIED')return fail('REVERSAL_STATUS_UNKNOWN','Source reversal is not confirmed.');
      return this.complete(a,id,reversal.receipt);
    }catch(e){return this.atomic(()=>{const current=this.get(a,id);if(current.state==='REFUNDED')return current;current.state='RECONCILIATION_REQUIRED';current.failureCode=(e as {code?:string}).code||'REVERSAL_OUTCOME_UNKNOWN';return this.save(current);});}
  }
}
