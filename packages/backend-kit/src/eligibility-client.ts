import { tracedFetch as fetch } from './observability.ts';
/** Narrow server-only current-eligibility reader. No positive permission cache and no caller owner header. */
import { paymentsUrl } from './local-endpoints.ts';
import { ProviderClient } from './provider-client.ts';
import { ClientCredentials } from './oauth.ts';
import type { Actor } from './context.ts';
import type { AccountEligibility } from '../../protocol-core/src/account-eligibility.ts';
import { eligibilitySchema } from '../../protocol-core/src/account-eligibility.ts';
import { Ajv } from 'ajv';
const validEligibility=new Ajv({strict:false}).compile<AccountEligibility>(eligibilitySchema);
export class EligibilityReadError extends Error{readonly status:number;constructor(status:number,message:string){super(message);this.status=status;}}
export const eligibilityEnforced=()=>process.env.ELIGIBILITY_ENFORCEMENT==='true'||process.env.NODE_ENV==='production';
export class EligibilityClient {
  readonly credentials:ClientCredentials;
  constructor(){this.credentials=new ClientCredentials('provider-eligibility',process.env.ELIGIBILITY_READER_SECRET|| (process.env.NODE_ENV==='production'?'':'demo-eligibility-reader-secret'));}
  async read(accountId:string):Promise<AccountEligibility>{
    const url=new URL(`/internal/account-eligibility/${encodeURIComponent(accountId)}`,paymentsUrl());if(process.env.NODE_ENV==='production'&&url.protocol!=='https:')throw Error('Eligibility HTTPS required');
    const send=async()=>fetch(url,{headers:{Authorization:`Bearer ${await this.credentials.token()}`},signal:AbortSignal.timeout(5000),redirect:'error'});
    let response=await send();if(response.status===401){this.credentials.invalidate();response=await send();}
    if(!response.ok)throw new EligibilityReadError(response.status===404?404:503,'Current eligibility unavailable');const {eligibility,success}=await response.json() as {eligibility:unknown;success?:boolean};
    if(success!==true||!validEligibility(eligibility)||eligibility.accountId!==accountId||eligibility.epoch!==`${eligibility.ownerVersion}:${eligibility.membershipVersion}`||eligibility.active!==(eligibility.ownerEnabled&&eligibility.membershipEnabled))throw Error('Invalid current eligibility');return eligibility;
  }
  async bootstrap(actor:Actor){try{return await this.read(actor.accountId);}catch(e){if(!(e instanceof EligibilityReadError)||e.status!==404||!actor.authorization)throw e;await new ProviderClient('service-wallet','').call('payments',actor,'GET','/v1/accounts');return this.read(actor.accountId);}}
  async require(actor:Actor,epoch?:string){const s=await this.bootstrap(actor);if(!s.active||s.ownerSub!==actor.sub)throw new EligibilityReadError(403,'Current owner or workspace membership prevents access. History is retained.');if(epoch&&s.epoch!==epoch||actor.eligibilityEpoch&&s.epoch!==actor.eligibilityEpoch)throw new EligibilityReadError(409,'Owner or workspace permission changed. Start a new exact review.');return s;}
}
