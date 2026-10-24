/** Card capture and wallet credit share one local transaction. No remote outcome or caller funding flag can mint money. */
import { createHash, randomUUID } from 'node:crypto';
import type { Actor } from '../../../packages/backend-kit/src/context.ts';
import { WALLET_FUNDING_LIMITS as limits, type WalletFundingOrder as Order, type PaymentMethod } from '../../../packages/protocol-core/src/payments.ts';
import type { AccountDatabase } from './database.ts';
import { PaymentIssuer, IssuerError, type IssuerBinding } from './payment-issuer.ts';
import { PaymentLedger, PaymentLedgerError } from './payment-ledger.ts';
import { PaymentOrderError } from './payment-orders.ts';
import { PaymentResourceUses } from './payment-resource-uses.ts';
import { paymentRegistry } from './payment-registry.ts';
const fail=(code:string,message:string,status=409):never=>{throw new PaymentOrderError(status,code,message);};
const active=['AWAITING_APPROVAL','REQUIRES_ACTION','AUTHORIZED'];
export class WalletFunding {
  readonly store:AccountDatabase;readonly issuer:PaymentIssuer;readonly ledger:PaymentLedger;readonly uses:PaymentResourceUses;readonly clock:()=>number;private sequence=0;
  constructor(store:AccountDatabase,issuer:PaymentIssuer,ledger:PaymentLedger,uses:PaymentResourceUses,clock=Date.now){
    this.store=store;this.issuer=issuer;this.ledger=ledger;this.uses=uses;this.clock=clock;
    store.db.exec(`CREATE TABLE IF NOT EXISTS wallet_funding_orders(id TEXT PRIMARY KEY,account_id TEXT NOT NULL REFERENCES accounts(id),state TEXT NOT NULL CHECK(state IN ('AWAITING_APPROVAL','REQUIRES_ACTION','AUTHORIZED','SETTLED','FAILED','CANCELLED')),body TEXT NOT NULL);
      CREATE UNIQUE INDEX IF NOT EXISTS wallet_funding_active ON wallet_funding_orders(account_id) WHERE state IN ('AWAITING_APPROVAL','REQUIRES_ACTION','AUTHORIZED');`);
  }
  private atomic<T>(fn:()=>T):T{if(!this.store.db.isTransaction)return this.store.transaction(fn);const name=`wallet_funding_${++this.sequence}`;this.store.db.exec(`SAVEPOINT ${name}`);try{const r=fn();this.store.db.exec(`RELEASE ${name}`);return r;}catch(e){this.store.db.exec(`ROLLBACK TO ${name}`);this.store.db.exec(`RELEASE ${name}`);throw e;}}
  private owner(actor:Actor){if(!this.store.owns(actor.sub,actor.accountId))fail('ACCOUNT_FORBIDDEN','This wallet does not belong to the owner.',403);}
  private owned(actor:Actor,id:string):Order{this.owner(actor);const row=this.store.db.prepare('SELECT body FROM wallet_funding_orders WHERE account_id=? AND id=?').get(actor.accountId,id);if(!row)return fail('FUNDING_NOT_FOUND','Wallet funding review not found.',404);const o=JSON.parse(String(row.body));if(o.ownerSub!==actor.sub)return fail('FUNDING_NOT_FOUND','Wallet funding review not found.',404);return o;}
  private save(o:Order){o.version++;this.store.db.prepare('UPDATE wallet_funding_orders SET state=?,body=? WHERE account_id=? AND id=?').run(o.state,JSON.stringify(o),o.accountId,o.id);return o;}
  private binding(o:Order):IssuerBinding{return {accountId:o.accountId,ownerSub:o.ownerSub,orderId:o.id,sourceId:o.quote.source.id,sourceVersion:o.quote.source.version,amountMinor:o.quote.totalMinor,approvalDigest:o.approvalDigest,expiresAt:Date.parse(o.authorization!.expiresAt)};}
  private release(o:Order){if(o.authorization&&this.uses.list(o.accountId,'METHOD',o.quote.source.id).some(d=>d.dependentKind==='HOLD'&&d.dependentId===o.authorization!.id))this.uses.release(o.accountId,'METHOD',o.quote.source.id,'HOLD',o.authorization.id);this.uses.release(o.accountId,'METHOD',o.quote.source.id,'ORDER',o.id);}
  private close(o:Order,state:'FAILED'|'CANCELLED',code?:string){if(o.authorization)o.authorization=this.issuer.void(this.binding(o));this.release(o);o.state=state;if(code)o.failureCode=code;return this.save(o);}
  private sync(o:Order){if(active.includes(o.state)&&(Date.parse(o.expiresAt)<=this.clock()||o.authorization&&Date.parse(o.authorization.expiresAt)<=this.clock()))return this.close(o,'FAILED','AUTHORIZATION_EXPIRED');return o;}
  refresh(actor:Actor){return this.atomic(()=>{this.owner(actor);for(const row of this.store.db.prepare("SELECT body FROM wallet_funding_orders WHERE account_id=? AND state IN ('AWAITING_APPROVAL','REQUIRES_ACTION','AUTHORIZED')").all(actor.accountId))this.sync(JSON.parse(String(row.body)));});}
  list(actor:Actor){return this.atomic(()=>{this.refresh(actor);return this.store.db.prepare('SELECT body FROM wallet_funding_orders WHERE account_id=? ORDER BY rowid DESC LIMIT 100').all(actor.accountId).map(r=>JSON.parse(String(r.body)) as Order);});}
  get(actor:Actor,id:string){return this.atomic(()=>this.sync(this.owned(actor,id)));}
  private method(account:string,id:string,version:number){const card=this.store.get<PaymentMethod>(account,'payment-method',id);if(id==='wallet')return fail('WALLET_SELF_FUNDING','Select a saved card; the wallet cannot fund itself.');if(!card||card.kind!=='card'||card.status!=='ACTIVE'||card.version!==version)return fail('METHOD_CHANGED','The selected card is unavailable or changed.');return card;}
  private capacity(account:string,amount:number){if(this.ledger.summary(account).balanceMinor+amount>limits.balanceMaxMinor)fail('WALLET_BALANCE_LIMIT','This top-up would exceed the AED 10000 wallet limit.');}
  create(actor:Actor,input:{amountMinor:number;methodId:string;expectedMethodVersion:number}):Order{return this.createInternal(actor,input,limits.minMinor);}
  private createInternal(actor:Actor,input:{amountMinor:number;methodId:string;expectedMethodVersion:number},minimum:number):Order{return this.atomic(()=>{
    this.refresh(actor);if(!Number.isSafeInteger(input.amountMinor)||input.amountMinor<minimum||input.amountMinor>limits.maxMinor)return fail('FUNDING_AMOUNT_LIMIT','Choose an amount from AED 1 to AED 500.',400);
    const source=this.method(actor.accountId,input.methodId,input.expectedMethodVersion);this.capacity(actor.accountId,input.amountMinor);
    if(this.store.db.prepare("SELECT id FROM wallet_funding_orders WHERE account_id=? AND state IN ('AWAITING_APPROVAL','REQUIRES_ACTION','AUTHORIZED')").get(actor.accountId))return fail('FUNDING_IN_PROGRESS','Inspect or cancel the existing wallet funding review first.');
    if(Number(this.store.db.prepare('SELECT count(*) n FROM wallet_funding_orders WHERE account_id=?').get(actor.accountId)!.n)>=100)return fail('FUNDING_HISTORY_LIMIT','This demo wallet reached its funding review limit.');
    const id=`funding_${randomUUID()}`,createdAt=new Date(this.clock()).toISOString(),expiresAt=new Date(this.clock()+300000).toISOString(),quote={source:structuredClone(source),amountMinor:input.amountMinor,feeMinor:limits.feeMinor,totalMinor:input.amountMinor,currency:'AED' as const,walletAccountId:actor.accountId};
    const approvalDigest=createHash('sha256').update(JSON.stringify([actor.sub,actor.accountId,id,quote,expiresAt])).digest('hex');const o:Order={id,accountId:actor.accountId,ownerSub:actor.sub,version:1,state:'AWAITING_APPROVAL',approvalDigest,quote,createdAt,expiresAt,fundsCaptured:false};
    this.uses.bind(actor.accountId,{resourceType:'METHOD',resourceId:source.id,resourceVersion:source.version,dependentKind:'ORDER',dependentId:id});this.store.db.prepare('INSERT INTO wallet_funding_orders VALUES(?,?,?,?)').run(id,actor.accountId,o.state,JSON.stringify(o));return o;
  });}
  private decision(actor:Actor,id:string,input:{expectedVersion:number;approvalDigest:string}){const o=this.sync(this.owned(actor,id));if(o.version!==input.expectedVersion||o.approvalDigest!==input.approvalDigest)return fail('APPROVAL_CHANGED','Refresh and approve the exact wallet funding review.');if(!active.includes(o.state))return fail('FUNDING_CLOSED','This funding review is closed.');return o;}
  approve(actor:Actor,id:string,input:{expectedVersion:number;approvalDigest:string}){return this.atomic(()=>{const o=this.decision(actor,id,input);if(o.state!=='AWAITING_APPROVAL')return fail('ALREADY_DECIDED','This funding review is already approved.');try{
    this.method(actor.accountId,o.quote.source.id,o.quote.source.version);this.capacity(actor.accountId,o.quote.amountMinor);const expiresAt=Math.min(Date.parse(o.expiresAt),this.clock()+120000);
    o.authorization=this.issuer.authorize({accountId:o.accountId,ownerSub:o.ownerSub,orderId:o.id,sourceId:o.quote.source.id,sourceVersion:o.quote.source.version,amountMinor:o.quote.totalMinor,approvalDigest:o.approvalDigest,expiresAt});
    if(o.authorization.state==='DECLINED')return this.close(o,'FAILED',o.authorization.failureCode);
    this.uses.bind(o.accountId,{resourceType:'METHOD',resourceId:o.quote.source.id,resourceVersion:o.quote.source.version,dependentKind:'HOLD',dependentId:o.authorization.id});o.state=o.authorization.state==='REQUIRES_ACTION'?'REQUIRES_ACTION':'AUTHORIZED';return this.save(o);
  }catch(e){if(e instanceof IssuerError||e instanceof PaymentOrderError||e instanceof PaymentLedgerError)return this.close(o,'FAILED',e.code);throw e;}});}
  challenge(actor:Actor,id:string,input:{expectedVersion:number;approvalDigest:string;challengeId:string;decision:'APPROVE'|'REJECT'},interactive:boolean){return this.atomic(()=>{const o=this.decision(actor,id,input);if(o.state!=='REQUIRES_ACTION')return fail('CHALLENGE_CLOSED','This review has no pending challenge.');o.authorization=this.issuer.challenge(this.binding(o),input.challengeId,input.decision,interactive);if(o.authorization.state==='DECLINED')return this.close(o,'FAILED',o.authorization.failureCode);o.state='AUTHORIZED';return this.save(o);});}
  cancel(actor:Actor,id:string,version:number){return this.atomic(()=>{const o=this.sync(this.owned(actor,id));if(o.version!==version||!active.includes(o.state))return fail('FUNDING_CLOSED','Refresh this current funding review before cancelling.');return this.close(o,'CANCELLED');});}
  execute(actor:Actor,id:string,input:{expectedVersion:number;approvalDigest:string}){return this.atomic(()=>{
    const existing=this.owned(actor,id);if(existing.state==='SETTLED'&&existing.approvalDigest===input.approvalDigest)return existing;
    const o=this.decision(actor,id,input);if(o.state!=='AUTHORIZED'||!o.authorization)return fail('FUNDING_NOT_AUTHORIZED','Authorize this exact card and amount before adding funds.');
    try{this.method(actor.accountId,o.quote.source.id,o.quote.source.version);this.capacity(actor.accountId,o.quote.amountMinor);o.authorization=this.issuer.capture(this.binding(o));}catch(e){if(e instanceof IssuerError||e instanceof PaymentOrderError||e instanceof PaymentLedgerError)return this.close(o,'FAILED',e.code);throw e;}
    const balance=this.ledger.record(actor.accountId,'TOPUP',`wallet-funding:${id}`,o.quote.amountMinor,'external'),capturedAt=new Date(this.clock()).toISOString();
    o.fundsCaptured=true;o.state='SETTLED';o.receipt={receiptNumber:id,amountMinor:o.quote.amountMinor,feeMinor:o.quote.feeMinor,currency:'AED',balanceMinor:balance.balanceMinor,capturedAt};
    this.store.put(actor.accountId,'transaction',{id,type:'TOPUP',amount:o.quote.amountMinor/100,currency:'AED',purpose:'Wallet funding from saved demo card',status:'SETTLED',timestamp:this.clock(),orderId:id,source:o.quote.source,issuerAuthorizationId:o.authorization.id},id);this.release(o);return this.save(o);
  });}
  /** Retained flags resolve to one persistent finite card per preset, never a fresh credit source on retry or removal. */
  compatibility(actor:Actor,amountMinor:number,source:string){return this.atomic(()=>{
    if(!['demo_approved','demo_declined'].includes(source))return fail('INVALID_FUNDING_SOURCE','Choose a supported synthetic funding source.',400);
    const key=`legacy-topup-${source}`,previous=this.store.get<string>(actor.accountId,key);
    const method=previous?this.store.get<PaymentMethod>(actor.accountId,'payment-method',previous):paymentRegistry(this.store,actor.accountId,'POST','/payment-methods',{preset:source==='demo_approved'?'approved':'declined',nickname:source==='demo_approved'?'Demo top-up card':'Declined top-up card'},this.uses)!.method as PaymentMethod;
    if(!method)return fail('METHOD_CHANGED','The original demo top-up card is unavailable.');if(!previous)this.store.put(actor.accountId,key,method.id);
    let o=this.createInternal(actor,{amountMinor,methodId:method.id,expectedMethodVersion:method.version},1);o=this.approve(actor,o.id,{expectedVersion:o.version,approvalDigest:o.approvalDigest});if(o.state==='AUTHORIZED')o=this.execute(actor,o.id,{expectedVersion:o.version,approvalDigest:o.approvalDigest});return o;
  });}
}
