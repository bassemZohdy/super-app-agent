/** Durable interactive capture driver. Network calls occur only between committed local transitions. */
import type { Actor } from '../../../packages/backend-kit/src/context.ts';
import type { ProviderClient } from '../../../packages/backend-kit/src/provider-client.ts';
import type { PaymentOrders } from './payment-orders.ts';
import type { PayableAdmission } from './payable-admissions.ts';
import { SettlementError } from './payment-claims.ts';
export class PaymentCheckout{
  readonly orders:PaymentOrders;readonly client:ProviderClient;
  constructor(orders:PaymentOrders,client:ProviderClient){this.orders=orders;this.client=client;}
  private async release(actor:Actor,id:string){const order=this.orders.get(actor,id);if(!order.admissionId||order.fundsCaptured||!['CANCELLED','FAILED'].includes(order.state))return;try{await this.client.call(order.quote.payable.provider,actor,'POST',`/payables/${encodeURIComponent(order.quote.payable.id)}/admissions/${order.admissionId}/cancel`,{},`order-cancel:${id}`);}catch{/* The gateway fence already prevents capture; recovery retries provider cleanup. */}}
  private async finish(actor:Actor,id:string){const o=this.orders.get(actor,id);if(o.quote.payable.kind!=='RECHARGE'||!o.sourceFinalizationPending)return o;try{await this.client.call(o.quote.payable.provider,actor,'POST',`/payables/${encodeURIComponent(o.quote.payable.id)}/admissions/${o.admissionId}/finish`,{},`order-finish:${id}`);return this.orders.finalized(actor,id);}catch{return this.orders.get(actor,id);}}
  async execute(actor:Actor,id:string,input:{expectedVersion:number;approvalDigest:string}){
    const previous=this.orders.get(actor,id),snapshot=(await this.client.call(previous.quote.payable.provider,actor,'GET',`/payables/${encodeURIComponent(previous.quote.payable.id)}`)).payable;
    this.orders.beginCapture(actor,id,input,snapshot);return this.recover(actor,id);
  }
  async cancel(actor:Actor,id:string,version:number){const order=this.orders.cancel(actor,id,version);await this.release(actor,id);return order;}
  async recover(actor:Actor,id:string){
    let order=this.orders.get(actor,id);if(['CANCELLED','FAILED'].includes(order.state)){await this.release(actor,id);return order;}if(order.state==='SETTLED')return this.finish(actor,id);
    if(!['CAPTURING','CAPTURED','RECONCILIATION_REQUIRED'].includes(order.state))throw new SettlementError(409,'ORDER_NOT_STARTED','Explicitly approve payment before recovery.');
    const base=`/payables/${encodeURIComponent(order.quote.payable.id)}/admissions`,provider=order.quote.payable.provider;
    try{
      let admission:PayableAdmission;
      if(!order.admissionId){
        const prepared=await this.client.call(provider,actor,'POST',base,{orderId:id,expectedRevision:order.quote.payable.revision,approvalDigest:order.approvalDigest,sourceId:order.quote.source.id,sourceVersion:order.quote.source.version,expiresAt:order.authorization!.expiresAt},`order-prepare:${id}`);
        admission=prepared.admission;order=this.orders.attachAdmission(actor,id,admission);
      }else admission=(await this.client.call(provider,actor,'GET',`${base}/${order.admissionId}`)).admission;
      if(!order.fundsCaptured){
        if(admission.state!=='ADMITTED')admission=(await this.client.call(provider,actor,'POST',`${base}/${admission.id}/admit`,{},`order-admit:${id}`)).admission;
        order=this.orders.capture(actor,id,admission);
      }
      admission=(await this.client.call(provider,actor,'GET',`${base}/${order.admissionId}`)).admission;
      if(admission.state!=='APPLIED'){
        await this.client.call(provider,actor,'POST',`${base}/${order.admissionId}/payments`,{paymentId:order.paymentId},`order-settlement:${id}`);
        admission=(await this.client.call(provider,actor,'GET',`${base}/${order.admissionId}`)).admission;
      }
      this.orders.complete(actor,id,admission);return this.finish(actor,id);
    }catch(error){
      order=this.orders.get(actor,id);const e=error as {status?:number;code?:string};
      if(order.fundsCaptured)return this.orders.unresolved(actor,id,e.code||'PROVIDER_OUTCOME_UNKNOWN');
      if(e.status&&e.status<500){const failed=this.orders.abortCapture(actor,id,e.code||'CAPTURE_REJECTED');await this.release(actor,id);return failed;}
      // Unknown admission is recoverable with the original order. It does not permit another charge.
      return order;
    }
  }
}
