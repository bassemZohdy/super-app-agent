/** Owned inspection of an existing legacy capture. No new capture, provider effect or refund is dispatched. */
import type { Actor } from '../../../packages/backend-kit/src/context.ts';
import { ProviderClient, UpstreamError } from '../../../packages/backend-kit/src/provider-client.ts';
import { legacyPaymentState } from '../../../packages/backend-kit/src/legacy-payment-binding.ts';
import type { LegacyPaymentInspection } from '../../../packages/protocol-core/src/payment-events.ts';
const providers=['rta','dewa','etisalat','du','police'];
export async function inspectLegacyPayment(actor:Actor,paymentId:string,source:ProviderClient):Promise<LegacyPaymentInspection>{
  let charge=(await source.call('payments',actor,'GET',`/charges/${encodeURIComponent(paymentId)}`)).charge;
  if(charge.orderId)throw new UpstreamError(409,'STORED_ORDER_REQUIRED','Inspect this payment through its original stored order.');
  let sourceState='NOT_TRACKED',gatewayConfirmed=false;
  if(providers.includes(charge.merchant))try{
    const {settlement}=await source.call(charge.merchant,actor,'GET',`/settlement-attempts/${encodeURIComponent(paymentId)}`);
    sourceState=settlement.state;gatewayConfirmed=settlement.gatewayConfirmed;
  }catch(e){if(!(e instanceof UpstreamError))throw e;sourceState=e.status===404?'NOT_FOUND':'UNAVAILABLE';}
  charge=(await source.call('payments',actor,'GET',`/charges/${encodeURIComponent(paymentId)}`)).charge;
  return {paymentId:charge.id,amountMinor:charge.amountMinor,currency:'AED' as const,merchant:charge.merchant,reference:charge.reference,source:charge.source,
    state:legacyPaymentState(charge,charge.settlement),gatewayClaim:charge.settlement?.state||'NONE',sourceState,gatewayConfirmed};
}
