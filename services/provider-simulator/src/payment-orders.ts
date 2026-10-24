/** Stored interactive authorization reviews. Capture/settlement remain separately gated. */
import { createHash, randomUUID } from 'node:crypto';
import type { Actor } from '../../../packages/backend-kit/src/context.ts';
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
const active=(order:Review)=>['AWAITING_APPROVAL','REQUIRES_ACTION','AUTHORIZED'].includes(order.state);
export class PaymentOrders {
  readonly store:AccountDatabase;readonly issuer:PaymentIssuer;readonly ledger:PaymentLedger;readonly uses:PaymentResourceUses;readonly clock:()=>number;private sequence=0;
  constructor(store:AccountDatabase,issuer:PaymentIssuer,ledger:PaymentLedger,uses:PaymentResourceUses,clock=Date.now){
    this.store=store;this.issuer=issuer;this.ledger=ledger;this.uses=uses;this.clock=clock;
    this.atomic(()=>store.db.exec(`CREATE TABLE IF NOT EXISTS payment_authorization_orders(
      id TEXT PRIMARY KEY,account_id TEXT NOT NULL REFERENCES accounts(id),provider TEXT NOT NULL,payable_id TEXT NOT NULL,
      state TEXT NOT NULL CHECK(state IN ('AWAITING_APPROVAL','REQUIRES_ACTION','AUTHORIZED','FAILED','CANCELLED')),expires_at INTEGER NOT NULL,body TEXT NOT NULL);
      CREATE UNIQUE INDEX IF NOT EXISTS payment_active_obligation ON payment_authorization_orders(account_id,provider,payable_id) WHERE state IN ('AWAITING_APPROVAL','REQUIRES_ACTION','AUTHORIZED');
      CREATE INDEX IF NOT EXISTS payment_orders_account ON payment_authorization_orders(account_id);`));
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
  private save(order:Review){order.version++;this.store.db.prepare('UPDATE payment_authorization_orders SET state=?,body=? WHERE id=? AND account_id=?').run(order.state,JSON.stringify(order),order.id,order.accountId);return order;}
  private binding(order:Review):IssuerBinding{return {accountId:order.accountId,ownerSub:order.ownerSub,orderId:order.id,sourceId:order.quote.source.id,sourceVersion:order.quote.source.version,amountMinor:order.quote.totalMinor,approvalDigest:order.approvalDigest,expiresAt:Date.parse(order.authorization!.expiresAt)};}
  private close(order:Review,state:'CANCELLED'|'FAILED',code?:string){
    if(order.authorization){
      if(order.quote.source.kind==='card')order.authorization=this.issuer.void(this.binding(order));
      else {this.ledger.voidHold(order.accountId,order.id);order.authorization.state='VOIDED';}
      this.uses.release(order.accountId,'METHOD',order.quote.source.id,'HOLD',order.authorization.id);
    }
    this.uses.release(order.accountId,'METHOD',order.quote.source.id,'ORDER',order.id);
    this.uses.release(order.accountId,'BILLER',order.quote.billingAccount.id,'ORDER',order.id);
    order.state=state;if(code)order.failureCode=code;return this.save(order);
  }
  private sync(order:Review){
    if(!active(order))return order;
    if(Date.parse(order.expiresAt)<=this.clock()||order.authorization&&Date.parse(order.authorization.expiresAt)<=this.clock())return this.close(order,'FAILED',order.authorization?'AUTHORIZATION_EXPIRED':'APPROVAL_EXPIRED');
    return order;
  }
  refresh(actor:Actor){return this.atomic(()=>{if(!this.store.owns(actor.sub,actor.accountId))return fail('ACCOUNT_FORBIDDEN','This workspace does not belong to the owner.',403);const rows=this.store.db.prepare("SELECT body FROM payment_authorization_orders WHERE account_id=? AND state IN ('AWAITING_APPROVAL','REQUIRES_ACTION','AUTHORIZED')").all(actor.accountId);for(const row of rows)this.sync(JSON.parse(String(row.body)));});}
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
  create(actor:Actor,input:{provider:string;payableId:string;expectedPayableRevision:string;methodId:string;expectedMethodVersion:number},snapshot:Payable|undefined):Review{
    return this.atomic(()=>{
      this.refresh(actor);const payable=this.fresh(snapshot,input.provider,input.payableId,input.expectedPayableRevision),source=this.source(actor.accountId,input.methodId,input.expectedMethodVersion);
      const links=this.store.list(actor.accountId,'billing-account') as BillingAccount[],link=links.find(b=>b.status==='ACTIVE'&&b.provider===payable.provider&&b.reference===payable.reference);
      if(!link)return fail('BILLER_NOT_LINKED','Link this owned biller before creating an authorization review.');
      if(this.store.db.prepare("SELECT id FROM payment_authorization_orders WHERE account_id=? AND provider=? AND payable_id=? AND state IN ('AWAITING_APPROVAL','REQUIRES_ACTION','AUTHORIZED')").get(actor.accountId,input.provider,input.payableId))return fail('PAYABLE_RESERVED','An active authorization review already reserves this obligation. Open or cancel it first.');
      const count=this.store.db.prepare('SELECT count(*) n FROM payment_authorization_orders WHERE account_id=?').get(actor.accountId) as {n:number};if(count.n>=100)return fail('ORDER_HISTORY_LIMIT','The local authorization-review history limit was reached.');
      const id=`order_${randomUUID()}`,createdAt=new Date(this.clock()).toISOString(),expiresAt=new Date(this.clock()+300000).toISOString();
      const quote={payable:structuredClone(payable),source:structuredClone(source),billingAccount:structuredClone(link),amountMinor:payable.amountMinor,feeMinor:0,totalMinor:payable.amountMinor,currency:'AED' as const,createdAt,expiresAt};
      const approvalDigest=createHash('sha256').update(JSON.stringify([actor.sub,actor.accountId,id,quote])).digest('hex');
      const order:Review={id,accountId:actor.accountId,ownerSub:actor.sub,quote,approvalDigest,expiresAt,createdAt,state:'AWAITING_APPROVAL',version:1,fundsCaptured:false};
      this.uses.bind(actor.accountId,{resourceType:'METHOD',resourceId:source.id,resourceVersion:source.version,dependentKind:'ORDER',dependentId:id});
      this.uses.bind(actor.accountId,{resourceType:'BILLER',resourceId:link.id,resourceVersion:link.version,dependentKind:'ORDER',dependentId:id});
      this.store.db.prepare('INSERT INTO payment_authorization_orders VALUES(?,?,?,?,?,?,?)').run(id,actor.accountId,input.provider,input.payableId,order.state,Date.parse(expiresAt),JSON.stringify(order));return order;
    });
  }
  private decision(actor:Actor,id:string,input:{expectedVersion:number;approvalDigest:string},snapshot:Payable|undefined){
    const order=this.sync(this.owned(actor,id));
    if(order.version!==input.expectedVersion||order.approvalDigest!==input.approvalDigest)return fail('APPROVAL_CHANGED','The stored review changed or its approval does not match.');
    if(!active(order))return fail('ORDER_CLOSED','This authorization review is closed.');
    const current=this.fresh(snapshot,order.quote.payable.provider,order.quote.payable.id,order.quote.payable.revision);
    if(current.amountMinor!==order.quote.totalMinor||current.reference!==order.quote.payable.reference)return fail('PAYABLE_CHANGED','The provider terms changed.');
    const link=this.store.get<BillingAccount>(actor.accountId,'billing-account',order.quote.billingAccount.id);
    if(!link||link.status!=='ACTIVE'||link.version!==order.quote.billingAccount.version)return fail('BILLER_CHANGED','The linked biller is unavailable or changed.');
    return order;
  }
  approve(actor:Actor,id:string,input:{expectedVersion:number;approvalDigest:string},snapshot:Payable|undefined){
    return this.atomic(()=>{
      const order=this.decision(actor,id,input,snapshot);if(order.state!=='AWAITING_APPROVAL')return fail('ALREADY_DECIDED','This review has already been approved.');
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
      order.approvedAt=new Date(this.clock()).toISOString();order.state=order.authorization!.state==='REQUIRES_ACTION'?'REQUIRES_ACTION':'AUTHORIZED';
      this.uses.bind(actor.accountId,{resourceType:'METHOD',resourceId:order.quote.source.id,resourceVersion:order.quote.source.version,dependentKind:'HOLD',dependentId:order.authorization!.id});return this.save(order);
    });
  }
  challenge(actor:Actor,id:string,input:{expectedVersion:number;approvalDigest:string;challengeId:string;decision:'APPROVE'|'REJECT'},snapshot:Payable|undefined,interactive:boolean){
    return this.atomic(()=>{
      const order=this.decision(actor,id,input,snapshot);if(order.state!=='REQUIRES_ACTION'||!order.authorization)return fail('CHALLENGE_CLOSED','This order has no pending challenge.');
      const auth=this.issuer.challenge(this.binding(order),input.challengeId,input.decision,interactive);
      order.authorization=auth;if(auth.state==='DECLINED')return this.close(order,'FAILED',auth.failureCode);
      order.state='AUTHORIZED';return this.save(order);
    });
  }
  cancel(actor:Actor,id:string,expectedVersion:number){return this.atomic(()=>{const order=this.sync(this.owned(actor,id));if(order.version!==expectedVersion)return fail('ORDER_CHANGED','Refresh this review before cancelling.');if(!active(order))return fail('ORDER_CLOSED','This review is already closed.');return this.close(order,'CANCELLED');});}
}
