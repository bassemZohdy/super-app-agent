import { tracedFetch as fetch } from '../../../packages/backend-kit/src/observability.ts';
/** Narrow workload lane: never forwards a human identity header or persists a bearer token. */
import { paymentsUrl } from '../../../packages/backend-kit/src/local-endpoints.ts';
import { ClientCredentials } from '../../../packages/backend-kit/src/oauth.ts';
import { boundedJsonResponse } from '../../../packages/backend-kit/src/bounded-json.ts';
import { MAX_PAYMENT_MINOR } from '../../../packages/protocol-core/src/payments.ts';
import { SettlementError,type SettlementProvider,type PaymentClaim } from './payment-claims.ts';
export type ClaimReply={claim:PaymentClaim;charge?:any};
export interface ClaimTransport {call(account:string,paymentId:string,action:'claim'|'ack'|'release',body:Record<string,unknown>):Promise<ClaimReply>}
const object=(value:unknown):value is Record<string,unknown>=>!!value&&typeof value==='object'&&!Array.isArray(value);
const text=(value:unknown):value is string=>typeof value==='string'&&value.length>0&&value.length<=200&&!/[\x00-\x1f\x7f]/.test(value);
const identifier=(value:unknown):value is string=>typeof value==='string'&&/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,159}$/.test(value);
const unknown=()=>new SettlementError(503,'SETTLEMENT_OUTCOME_UNKNOWN','Settlement gateway outcome is unknown; preserve the original attempt.');
export class SettlementClient implements ClaimTransport{
  readonly credentials:ClientCredentials;readonly provider:SettlementProvider;
  constructor(provider:SettlementProvider){this.provider=provider;const secret=process.env[`PROVIDER_${provider.toUpperCase()}_CLAIM_SECRET`]||(process.env.NODE_ENV==='production'?'':`demo-${provider}-settlement-secret`);this.credentials=new ClientCredentials(`provider-${provider}-settlement`,secret);}
  async call(account:string,paymentId:string,action:'claim'|'ack'|'release',body:Record<string,unknown>):Promise<ClaimReply>{
    if(!['claim','ack','release'].includes(action)||!identifier(account)||!identifier(paymentId)||!object(body)||!identifier(body.attemptId)||
      (action==='claim'&&(!text(body.reference)||typeof body.amountMinor!=='number'||!Number.isSafeInteger(body.amountMinor)||body.amountMinor<1||body.amountMinor>MAX_PAYMENT_MINOR))||
      (action==='ack'&&(!identifier(body.claimId)||!text(body.receiptDigest)))||
      (action==='release'&&(!identifier(body.claimId)||body.reason!=='NOT_APPLIED')))
      throw new SettlementError(400,'SETTLEMENT_INPUT_INVALID','The original settlement terms are required.');
    const base=paymentsUrl(),url=new URL(`/v1/accounts/${encodeURIComponent(account)}/charges/${encodeURIComponent(paymentId)}/settlement/${action}`,base);
    if(url.username||url.password||!['http:','https:'].includes(url.protocol)||(process.env.NODE_ENV==='production'&&url.protocol!=='https:'))throw new SettlementError(503,'HTTPS_REQUIRED','Settlement HTTPS is required.');
    let response:Response;
    try{response=await fetch(url,{method:'POST',redirect:'error',headers:{Authorization:`Bearer ${await this.credentials.token()}`,'Content-Type':'application/json','Idempotency-Key':`settlement:${this.provider}:${body.attemptId}:${action}`},body:JSON.stringify(body),signal:AbortSignal.timeout(8000)});}catch{throw unknown();}
    if(!response.ok){if(response.status===401)this.credentials.invalidate();void response.body?.cancel().catch(()=>{});throw unknown();}
    let data:unknown;try{data=await boundedJsonResponse(response,65536);}catch{throw unknown();}
    if(!object(data)||data.success!==true||Object.hasOwn(data,'error')||!object(data.claim))throw unknown();
    const claim=data.claim;
    if(claim.provider!==this.provider||claim.paymentId!==paymentId||claim.attemptId!==body.attemptId||!identifier(claim.claimId)||!text(claim.reference)||
      typeof claim.amountMinor!=='number'||!Number.isSafeInteger(claim.amountMinor)||claim.amountMinor<1||claim.amountMinor>MAX_PAYMENT_MINOR||claim.currency!=='AED'||
      !text(claim.orderId)||!text(claim.captureAttemptId)||!text(claim.createdAt))throw unknown();
    if(action==='claim'){
      const charge=data.charge;
      if((claim.state!=='CLAIMED'&&claim.state!=='APPLIED')||claim.reference!==body.reference||claim.amountMinor!==body.amountMinor||!object(charge)||
        charge.id!==paymentId||charge.accountId!==account||charge.merchant!==this.provider||charge.reference!==claim.reference||charge.amountMinor!==claim.amountMinor||
        charge.currency!=='AED'||charge.status!=='CAPTURED'||charge.refunded!==false)throw unknown();
    }else if(claim.claimId!==body.claimId||claim.state!==(action==='ack'?'APPLIED':'RELEASED')||(action==='ack'&&claim.receiptDigest!==body.receiptDigest))throw unknown();
    return data as ClaimReply;
  }
}
