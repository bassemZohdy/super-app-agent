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

export async function executeAutomaticOrder(deps:{runs:AutomationRuns;orders:PaymentOrders;checkout:PaymentCheckout;client:ProviderClient;authority:PermitAuthority},
  caller:{sub:string;authorization:string},executionId:string){
  const target=deps.runs.target(executionId);
  if(caller.sub!==target.ownerSub)throw new AutomationRunError(403,'AUTOMATION_OWNER_MISMATCH','The credential does not belong to this execution\'s owner.');
  const actor:Actor={sub:target.ownerSub,username:target.ownerSub,name:'Automation owner',accountId:target.preparation.accountId,requestId:`automation:${executionId}`};
  const order=deps.orders.get(actor,target.orderId);
  // A read-only snapshot is taken before the permit is spent so an outage here costs nothing.
  const snapshot=(await deps.client.call(order.quote.payable.provider,actor,'GET',`/payables/${encodeURIComponent(order.quote.payable.id)}`)).payable;
  // Consumption is the first irreversible step; an outage or denial here executes nothing.
  try{await deps.authority(caller.authorization,target.operation);}
  catch{throw new AutomationRunError(403,'AUTOMATION_PERMIT_DENIED','The execution permit is missing, consumed, expired or does not match this operation.');}
  const preparation=deps.runs.admit(executionId,caller.sub);
  const decided=deps.orders.admitAutomatic(actor,target.orderId,{executionId,mandateId:preparation.mandateId,boundDigest:preparation.boundDigest},snapshot);
  if(decided.state!=='CAPTURING')return decided;
  return deps.checkout.recover(actor,target.orderId);
}
