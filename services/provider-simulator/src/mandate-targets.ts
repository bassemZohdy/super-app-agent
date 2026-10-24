import type { ProviderClient } from '../../../packages/backend-kit/src/provider-client.ts';
import type { Actor } from '../../../packages/backend-kit/src/context.ts';
import type { MandatePolicy } from '../../../packages/protocol-core/src/payment-mandates.ts';
import { MandateError } from './payment-mandates.ts';

/** Source-owned read paths only. Policy bodies cannot provide a URL, proof or ownership result. */
export async function verifyMandateTarget(client:ProviderClient,actor:Actor,policy:MandatePolicy){
  const target=policy.target;
  if(target.kind==='WALLET')return;
  let eligible=false;
  if(target.kind==='PARKING'){
    const {meters}=await client.call('rta',actor,'GET','/parking/sessions');
    eligible=meters.some((m:{ticketId:string;plateNumber:string;zoneId:string;status:string;expiresAt:number})=>m.ticketId===target.ticketId&&m.plateNumber===target.plateNumber&&m.zoneId===target.zoneId&&m.status==='ACTIVE'&&m.expiresAt>Date.now());
  }else if(policy.operation==='RECHARGE'){
    const {targets}=await client.call(target.provider,actor,'GET','/recharge-targets');
    eligible=targets.some((t:{reference:string;status:string;denominationsMinor:number[]})=>t.reference===target.reference&&t.status==='ACTIVE'&&policy.trigger.type==='LOW_BALANCE'&&t.denominationsMinor.includes(policy.trigger.reloadMinor));
  }else if(policy.operation==='FINE_PAYMENT'){
    const {vehicles}=await client.call('police',actor,'GET','/vehicles');
    eligible=vehicles.some((v:{plateNumber:string;status:string})=>v.plateNumber===target.reference&&v.status==='ACTIVE');
  }else if(target.provider==='dewa'&&policy.operation==='BILL_PAYMENT'){
    const {account}=await client.call('dewa',actor,'GET','/consumption');eligible=account.accountNumber===target.reference;
  }else if(['etisalat','du'].includes(target.provider)&&['BILL_PAYMENT','SUBSCRIPTION_RENEWAL'].includes(policy.operation)){
    const {subscriptions}=await client.call(target.provider,actor,'GET','/subscriptions');
    eligible=subscriptions.some((s:{subscriptionId:string;status:string})=>s.subscriptionId===target.reference&&s.status==='ACTIVE');
  }
  if(!eligible)throw new MandateError(409,'MANDATE_TARGET_UNAVAILABLE','The source provider cannot confirm this exact eligible owned target.');
}
