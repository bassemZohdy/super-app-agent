/** Dedicated execution route for automatic orders (AUTO-03 step 3).
 *  The broker-bound token is consumed once for the operation derived from the stored preparation;
 *  only then is current authority re-read, the order decided and the existing capture driver run.
 *  A card challenge stays visible as Requires action: the worker never answers one. */
import type { Actor } from '../../../packages/backend-kit/src/context.ts';
import type { ProviderClient } from '../../../packages/backend-kit/src/provider-client.ts';
import type { AutomationRuns } from './automation-runs.ts';
import { AutomationRunError } from './automation-runs.ts';
import type { PaymentOrders } from './payment-orders.ts';
import type { PaymentCheckout } from './payment-checkout.ts';

export type PermitAuthority=(authorization:string|undefined,operation:Record<string,unknown>)=>Promise<unknown>;
/** Confirms an already-admitted token still has its session for this execution, without spending anything. */
export type SessionCheck=(authorization:string|undefined)=>Promise<{executionId:string}>;

export async function executeAutomaticOrder(deps:{runs:AutomationRuns;orders:PaymentOrders;checkout:PaymentCheckout;client:ProviderClient;authority:PermitAuthority;session:SessionCheck},
  caller:{sub:string;authorization:string},executionId:string){
  const target=deps.runs.target(executionId);
  if(caller.sub!==target.ownerSub)throw new AutomationRunError(403,'AUTOMATION_OWNER_MISMATCH',"The credential does not belong to this execution's owner.");
  const dispatched=deps.runs.dispatchState(executionId);
  if(dispatched==='REJECTED')throw new AutomationRunError(409,'AUTOMATION_ALREADY_DISPATCHED','Current authority already rejected this execution; it cannot be revived.');
  let preparation=target.preparation;
  if(!dispatched){
    // Consumption is the first irreversible step; an outage or denial here executes nothing.
    try{await deps.authority(caller.authorization,target.operation);}
    catch{throw new AutomationRunError(403,'AUTOMATION_PERMIT_DENIED','The execution permit is missing, consumed, expired or does not match this operation.');}
    preparation=deps.runs.admit(executionId,caller.sub);
  }else{
    // The permit is already spent. The same token may only resume this execution's own order, never start another effect.
    let session:{executionId:string}|undefined;
    try{session=await deps.session(caller.authorization);}catch{/* falls through to the denial below */}
    if(session?.executionId!==executionId)throw new AutomationRunError(403,'AUTOMATION_PERMIT_DENIED','The execution session is missing, expired or belongs to another execution.');
  }
  const actor:Actor={sub:target.ownerSub,username:target.ownerSub,name:'Automation owner',accountId:preparation.accountId,requestId:`automation:${executionId}`,authorization:caller.authorization};
  const order=deps.orders.get(actor,target.orderId);
  const snapshot=(await deps.client.call(order.quote.payable.provider,actor,'GET',`/payables/${encodeURIComponent(order.quote.payable.id)}`)).payable;
  const decided=deps.orders.admitAutomatic(actor,target.orderId,{executionId,mandateId:preparation.mandateId,boundDigest:preparation.boundDigest},snapshot);
  if(decided.state!=='CAPTURING')return decided;
  return deps.checkout.recover(actor,target.orderId);
}
