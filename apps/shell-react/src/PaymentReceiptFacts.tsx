import { formatAED, type PaymentMethod } from '../../../packages/protocol-core/src/payments.ts';
/** Shared original-source facts across financial receipt renderers. */
export function PaymentReceiptFacts({source,amountMinor,feeMinor,target,reference,refundedMinor=0}:{source:PaymentMethod;amountMinor:number;feeMinor:number;target:string;reference:string;refundedMinor?:number}){
  return <><p>Original funding {source.nickname}{source.last4?` · •••• ${source.last4}`:''}</p><p>Linked target {target}</p><p>Amount {formatAED(amountMinor)} · Fees {formatAED(feeMinor)} · Total {formatAED(amountMinor+feeMinor)}</p><p>Correlation {reference} · Refunded {formatAED(refundedMinor)}</p></>;
}
