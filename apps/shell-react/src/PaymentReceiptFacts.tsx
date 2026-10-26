import { formatAED, type PaymentMethod } from '../../../packages/protocol-core/src/payments.ts';
import { translate, type Locale } from '../../../packages/protocol-core/src/i18n.ts';
/** Shared original-source facts across financial receipt renderers. */
export function PaymentReceiptFacts({source,amountMinor,feeMinor,target,reference,refundedMinor=0,locale='en'}:{source:PaymentMethod;amountMinor:number;feeMinor:number;target:string;reference:string;refundedMinor?:number;locale?:Locale}){
  return <><p>{translate(locale,'receipt.originalFunding',{source:`${source.nickname}${source.last4?` · •••• ${source.last4}`:''}`})}</p><p>{translate(locale,'receipt.linkedTarget',{target})}</p><p>{translate(locale,'receipt.amounts',{amount:formatAED(amountMinor),fees:formatAED(feeMinor),total:formatAED(amountMinor+feeMinor)})}</p><p>{translate(locale,'receipt.correlation',{reference,refunded:formatAED(refundedMinor)})}</p></>;
}
