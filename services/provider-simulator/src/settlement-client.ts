import { tracedFetch as fetch } from '../../../packages/backend-kit/src/observability.ts';
/** Narrow workload lane: never forwards a human identity header or persists a bearer token. */
import { ClientCredentials } from '../../../packages/backend-kit/src/oauth.ts';
import { SettlementError,type SettlementProvider,type PaymentClaim } from './payment-claims.ts';
export type ClaimReply={claim:PaymentClaim;charge?:any};
export interface ClaimTransport {call(account:string,paymentId:string,action:'claim'|'ack'|'release',body:Record<string,unknown>):Promise<ClaimReply>}
export class SettlementClient implements ClaimTransport{
  readonly credentials:ClientCredentials;readonly provider:SettlementProvider;
  constructor(provider:SettlementProvider){this.provider=provider;const secret=process.env[`PROVIDER_${provider.toUpperCase()}_CLAIM_SECRET`]||(process.env.NODE_ENV==='production'?'':`demo-${provider}-settlement-secret`);this.credentials=new ClientCredentials(`provider-${provider}-settlement`,secret);}
  async call(account:string,paymentId:string,action:'claim'|'ack'|'release',body:Record<string,unknown>):Promise<ClaimReply>{
    const base=process.env.PROVIDER_PAYMENTS_URL||'http://localhost:4107',url=new URL(`/v1/accounts/${encodeURIComponent(account)}/charges/${encodeURIComponent(paymentId)}/settlement/${action}`,base);
    if(process.env.NODE_ENV==='production'&&url.protocol!=='https:')throw new SettlementError(503,'HTTPS_REQUIRED','Settlement HTTPS is required.');
    const send=async()=>fetch(url,{method:'POST',headers:{Authorization:`Bearer ${await this.credentials.token()}`,'Content-Type':'application/json','Idempotency-Key':`settlement:${this.provider}:${body.attemptId}:${action}`},body:JSON.stringify(body),signal:AbortSignal.timeout(8000)});
    let response:Response;try{response=await send();if(response.status===401){this.credentials.invalidate();response=await send();}}catch{throw new SettlementError(503,'SETTLEMENT_OUTCOME_UNKNOWN','Settlement gateway outcome is unknown; preserve the original attempt.');}
    const data=await response.json() as any;if(!response.ok||data.success!==true)throw new SettlementError(response.status,data.code||'SETTLEMENT_DENIED',data.error||'Settlement was denied.');
    if(!data.claim||data.claim.provider!==this.provider||data.claim.paymentId!==paymentId||data.claim.attemptId!==body.attemptId)throw new SettlementError(503,'INVALID_CLAIM_REPLY','The gateway claim response needs reconciliation.');return data;
  }
}
