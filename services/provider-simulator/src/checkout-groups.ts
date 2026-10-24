/** Sequential checkout orchestration. Child orders remain the authority for every money effect. */
import { createHash, randomUUID } from 'node:crypto';
import type { Actor } from '../../../packages/backend-kit/src/context.ts';
import type { ProviderClient } from '../../../packages/backend-kit/src/provider-client.ts';
import type { BillerProvider, CheckoutGroup, CheckoutGroupView, Payable } from '../../../packages/protocol-core/src/payments.ts';
import { MAX_PAYMENT_MINOR } from '../../../packages/protocol-core/src/payments.ts';
import { PaymentOrders, PaymentOrderError } from './payment-orders.ts';
import type { PaymentCheckout } from './payment-checkout.ts';
export type CheckoutGroupInput={items:{provider:BillerProvider;payableId:string;expectedPayableRevision:string}[];methodId:string;expectedMethodVersion:number};
const fail=(code:string,message:string,status=409):never=>{throw new PaymentOrderError(status,code,message);};
export class CheckoutGroups {
  readonly orders:PaymentOrders;
  constructor(orders:PaymentOrders){this.orders=orders;orders.store.db.exec(`CREATE TABLE IF NOT EXISTS payment_checkout_groups(
    id TEXT PRIMARY KEY,account_id TEXT NOT NULL REFERENCES accounts(id),body TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS checkout_groups_account ON payment_checkout_groups(account_id);`);}
  private atomic<T>(fn:()=>T):T{return this.orders.store.db.isTransaction?fn():this.orders.store.transaction(fn);}
  private owned(actor:Actor,id:string):CheckoutGroup{
    if(!this.orders.store.owns(actor.sub,actor.accountId))return fail('ACCOUNT_FORBIDDEN','This workspace does not belong to the owner.',403);
    const row=this.orders.store.db.prepare('SELECT body FROM payment_checkout_groups WHERE account_id=? AND id=?').get(actor.accountId,id);
    if(!row)return fail('CHECKOUT_NOT_FOUND','Checkout group not found.',404);
    const group=JSON.parse(String(row.body)) as CheckoutGroup;
    if(group.ownerSub!==actor.sub)return fail('CHECKOUT_NOT_FOUND','Checkout group not found.',404);return group;
  }
  private save(group:CheckoutGroup){group.version++;this.orders.store.db.prepare('UPDATE payment_checkout_groups SET body=? WHERE id=? AND account_id=?').run(JSON.stringify(group),group.id,group.accountId);}
  create(actor:Actor,input:CheckoutGroupInput,snapshots:Payable[]):CheckoutGroupView{
    return this.atomic(()=>{
      if(!this.orders.store.owns(actor.sub,actor.accountId))return fail('ACCOUNT_FORBIDDEN','This workspace does not belong to the owner.',403);
      if(!input.items.length||input.items.length>10||snapshots.length!==input.items.length)return fail('INVALID_CHECKOUT','Choose one to ten current obligations.');
      const excluded:CheckoutGroup['excluded']=[],orders:CheckoutGroupView['orders']=[],seen=new Set<string>();
      for(const [i,item] of input.items.entries()){
        const p=snapshots[i];
        if(p.provider!==item.provider||p.id!==item.payableId)return fail('PAYABLE_CHANGED','The source returned another obligation.');
        for(const part of p.items||[p]){const key=`${part.provider}:${part.id}`;if(seen.has(key))return fail('DUPLICATE_CHECKOUT_ITEM','An obligation cannot appear twice, including within a fine selection.');seen.add(key);}
        if(p.status==='PAID'){excluded.push({provider:p.provider,payableId:p.id,reason:'ALREADY_PAID'});continue;}
        orders.push(this.orders.create(actor,{...item,methodId:input.methodId,expectedMethodVersion:input.expectedMethodVersion},p));
      }
      if(!orders.length)return fail('CHECKOUT_EMPTY','All selected obligations are already paid. No checkout or charge was created.');
      const totalMinor=orders.reduce((sum,o)=>sum+o.quote.totalMinor,0);
      if(!Number.isSafeInteger(totalMinor)||totalMinor>MAX_PAYMENT_MINOR)return fail('CHECKOUT_LIMIT','The combined amount exceeds the demo checkout limit.');
      const id=`checkout_${randomUUID()}`,createdAt=new Date(this.orders.clock()).toISOString(),expiresAt=orders.map(o=>o.expiresAt).sort()[0];
      const approvalDigest=createHash('sha256').update(JSON.stringify([id,actor.sub,actor.accountId,orders.map(o=>[o.id,o.approvalDigest]),excluded,totalMinor])).digest('hex');
      const group:CheckoutGroup={id,accountId:actor.accountId,ownerSub:actor.sub,version:1,source:orders[0].quote.source,totalMinor,currency:'AED',orderIds:orders.map(o=>o.id),excluded,createdAt,expiresAt,approvalDigest};
      this.orders.store.db.prepare('INSERT INTO payment_checkout_groups VALUES(?,?,?)').run(id,actor.accountId,JSON.stringify(group));return this.get(actor,id);
    });
  }
  get(actor:Actor,id:string):CheckoutGroupView{
    const group=this.owned(actor,id),orders=group.orderIds.map(id=>this.orders.get(actor,id)),settled=orders.filter(o=>o.state==='SETTLED'),next=orders.find(o=>o.state!=='SETTLED'||o.sourceFinalizationPending);
    let state:CheckoutGroupView['state']='READY';
    if(!next)state='COMPLETED';
    else if(group.cancelledAt)state='CANCELLED';
    else if(next.state==='AUTHORIZATION_PENDING')state='AUTHORIZATION_PENDING';
    else if(next.state==='REQUIRES_ACTION')state='REQUIRES_ACTION';
    else if(['CAPTURING','CAPTURED','RECONCILIATION_REQUIRED'].includes(next.state)||next.sourceFinalizationPending)state='RECONCILIATION_REQUIRED';
    else if(['FAILED','CANCELLED'].includes(next.state)||group.lastFailureCode)state=settled.length?'PARTIAL':'STOPPED';
    else if(!group.approvedAt)state='AWAITING_APPROVAL';
    return {...group,orders,settledMinor:settled.reduce((sum,o)=>sum+o.quote.totalMinor,0),state};
  }
  list(actor:Actor){
    if(!this.orders.store.owns(actor.sub,actor.accountId))return fail('ACCOUNT_FORBIDDEN','This workspace does not belong to the owner.',403);
    return this.orders.store.db.prepare('SELECT id FROM payment_checkout_groups WHERE account_id=? ORDER BY rowid DESC LIMIT 100').all(actor.accountId).map(row=>this.get(actor,String(row.id)));
  }
  approve(actor:Actor,id:string,input:{expectedVersion:number;approvalDigest:string}){
    return this.atomic(()=>{
      const g=this.get(actor,id);
      if(g.version!==input.expectedVersion||g.approvalDigest!==input.approvalDigest)return fail('CHECKOUT_CHANGED','Review this exact checkout before approving.');
      if(g.approvedAt||g.cancelledAt||Date.parse(g.expiresAt)<=this.orders.clock()||g.orders.some(o=>o.state!=='AWAITING_APPROVAL'))return fail('CHECKOUT_CLOSED','This group changed or expired. Review its original child orders.');
      const stored=this.owned(actor,id);stored.approvedAt=new Date(this.orders.clock()).toISOString();this.save(stored);return this.get(actor,id);
    });
  }
  async cancel(actor:Actor,id:string,expectedVersion:number,checkout:PaymentCheckout){
    // Fence new group dispatch before awaiting source cleanup. Captures retain their original recovery path.
    this.atomic(()=>{const g=this.owned(actor,id);if(g.version!==expectedVersion)return fail('CHECKOUT_CHANGED','Refresh the checkout before cancelling.');if(!g.cancelledAt){g.cancelledAt=new Date(this.orders.clock()).toISOString();this.save(g);}for(const child of g.orderIds){const o=this.orders.get(actor,child);if(['AWAITING_APPROVAL','AUTHORIZATION_PENDING','REQUIRES_ACTION','AUTHORIZED'].includes(o.state))this.orders.cancel(actor,o.id,o.version);}});
    for(const order of this.get(actor,id).orders)if(['CANCELLED','FAILED'].includes(order.state))await checkout.recover(actor,order.id);
    return this.get(actor,id);
  }
  async execute(actor:Actor,id:string,input:{expectedVersion:number;approvalDigest:string},checkout:PaymentCheckout,client:ProviderClient){
    const initial=this.get(actor,id);
    if(initial.version!==input.expectedVersion||initial.approvalDigest!==input.approvalDigest)return fail('CHECKOUT_CHANGED','Refresh the approved checkout before continuing.');
    if(!initial.approvedAt)return fail('CHECKOUT_APPROVAL_REQUIRED','Explicitly approve the exact group and source before payment.');
    for(const child of initial.orderIds){
      let group=this.get(actor,id),order=this.orders.get(actor,child);
      if(order.state==='SETTLED'&&!order.sourceFinalizationPending)continue;
      if(group.cancelledAt)break;
      try{
        if(['CAPTURING','CAPTURED','RECONCILIATION_REQUIRED','SETTLED'].includes(order.state))order=await checkout.recover(actor,child);
        else if(order.state==='AWAITING_APPROVAL'){
          const snapshot=(await client.call(order.quote.payable.provider,actor,'GET',`/payables/${encodeURIComponent(order.quote.payable.id)}`)).payable;
          group=this.get(actor,id);if(group.cancelledAt)break;
          order=this.orders.get(actor,child);
          if(order.state==='AWAITING_APPROVAL')order=this.orders.approve(actor,child,{expectedVersion:order.version,approvalDigest:order.approvalDigest},snapshot);
        }
        if(order.state==='AUTHORIZED')order=await checkout.execute(actor,child,{expectedVersion:order.version,approvalDigest:order.approvalDigest});
      }catch(error){
        const current=this.orders.get(actor,child);
        if(current.state==='SETTLED'&&!current.sourceFinalizationPending)continue;
        if(['APPROVAL_CHANGED','ALREADY_DECIDED','ORDER_NOT_AUTHORIZED'].includes((error as {code?:string}).code||'')&&current.state!==order.state)break;
        this.atomic(()=>{const g=this.owned(actor,id);g.lastFailureCode=(error as {code?:string}).code||'PROVIDER_UNAVAILABLE';this.save(g);});
        // Current child state is authoritative, including concurrent dispatch and ambiguous network results.
        // Keep later lines untouched. A retry revalidates or reconciles this original child.
        break;
      }
      if(order.state!=='SETTLED'||order.sourceFinalizationPending)break;
      this.atomic(()=>{const g=this.owned(actor,id);if(g.lastFailureCode){delete g.lastFailureCode;this.save(g);}});
    }
    return this.get(actor,id);
  }
}
