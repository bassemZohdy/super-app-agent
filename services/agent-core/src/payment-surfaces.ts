import { paymentReceiptReady } from '../../../packages/protocol-core/src/payment-history.ts';
/** Conversational payments use the same stored owner reviews as the payment panel. */
import { createHash, randomUUID } from 'node:crypto';
import { ProviderClient, UpstreamError } from '../../../packages/backend-kit/src/provider-client.ts';
import type { Actor } from '../../../packages/backend-kit/src/context.ts';
import type { UIComponentNode } from '../../../packages/protocol-core/src/index.ts';
import { formatAED, type Payable, type PaymentMethod, type PaymentAuthorizationReview, type WalletFundingOrder, type CheckoutGroupView, type PaymentOverview } from '../../../packages/protocol-core/src/payments.ts';
import type { SuperAppAgentState } from './langgraph/state.ts';
import { paymentOverview } from './payment-accounts.ts';

type RecordView=PaymentAuthorizationReview|WalletFundingOrder|CheckoutGroupView;
type SourceChoice={id:string;source:PaymentMethod;availableMinor:number;heldMinor:number};
export type SurfacePaymentFlow={id:string;ownerSub:string;accountId:string;kind:'PAYMENT'|'FUNDING'|'GROUP';expiresAt:number;
  payables:Payable[];amountMinor:number;choices:SourceChoice[];selectedChoice?:string;
  pendingCreate?:{route:string;body:Record<string,unknown>};record?:RecordView;notice?:string;responseUnknown?:boolean};
const client=new ProviderClient('service-wallet',process.env.SERVICE_WALLET_CLIENT_SECRET||'demo-wallet-secret');
const entries=['pay_utilities_bill','pay_telecom_bill','pay_police_fines','topup_wallet','confirm_smartcity_checkout'];
const fail=(code:string,message:string):never=>{throw new UpstreamError(409,code,message);};
const text=(id:string,value:string):UIComponentNode=>({type:'Text',id,properties:{text:value}});
const button=(id:string,label:string,action:string,payload:Record<string,unknown>):UIComponentNode=>({type:'Button',id,properties:{label,variant:'primary'},onEvents:[{event:'onPress',actionType:'AGENT_ACTION_DISPATCH',payload:{action,...payload}}]});
const methodName=(m:PaymentMethod)=>`${m.nickname}${m.last4?` · •••• ${m.last4}`:''}`;
const routeFor=(f:SurfacePaymentFlow)=>f.kind==='FUNDING'?'/wallet-funding-orders':f.kind==='GROUP'?'/checkout-groups':'/payment-orders';
const terms=(f:SurfacePaymentFlow,r:RecordView)=>({flowId:f.id,orderId:r.id,expectedVersion:r.version,approvalDigest:r.approvalDigest});
const terminal=(r:RecordView)=>['SETTLED','COMPLETED','FAILED','CANCELLED'].includes(r.state)&&!('sourceFinalizationPending' in r&&r.sourceFinalizationPending);
async function call(source:ProviderClient,actor:Actor,f:SurfacePaymentFlow,provider:string,method:string,path:string,body?:unknown){
  if(method==='POST')await actor.assertLease?.();
  const progress=f.kind==='GROUP'&&path.endsWith('/execute')&&f.record&&'orders' in f.record?f.record.orders.map(o=>[o.id,o.version,o.state]):[];
  return source.call(provider,actor,method,path,body,createHash('sha256').update(JSON.stringify([f.id,path,body||{},progress])).digest('hex'));
}
function assertOwner(f:SurfacePaymentFlow,actor:Actor){if(f.ownerSub!==actor.sub||f.accountId!==actor.accountId)fail('PAYMENT_OWNER_CHANGED','Start a payment review in the current owned workspace.');}
function current(state:SuperAppAgentState,actor:Actor,payload:Record<string,any>){const f=state.paymentFlow;if(!f||f.id!==payload.flowId)fail('PAYMENT_REVIEW_CHANGED','This payment review was replaced.');assertOwner(f!,actor);return f!;}
function validSources(data:PaymentOverview,cardsOnly:boolean,now:number):SourceChoice[]{
  const date=new Date(now);
  return data.methods.filter(m=>m.status==='ACTIVE'&&(!cardsOnly||m.kind==='card')&&(m.kind==='wallet'||m.expiresYear!>date.getUTCFullYear()||m.expiresYear===date.getUTCFullYear()&&m.expiresMonth!>=date.getUTCMonth()+1)).map(m=>{
    const b=data.cardBalances?.find(b=>b.sourceId===m.id);return{id:`${m.id}.v${m.version}`,source:structuredClone(m),availableMinor:m.kind==='wallet'?data.wallet.availableMinor:b?.availableMinor||0,heldMinor:m.kind==='wallet'?data.wallet.heldMinor:b?.heldMinor||0};
  });
}
function render(state:SuperAppAgentState,f:SurfacePaymentFlow){
  const r=f.record,confirmed=r?('orders' in r?r.state==='COMPLETED'&&r.orders.every(paymentReceiptReady):paymentReceiptReady(r)):false, children:UIComponentNode[]=[],items=(p:Payable)=>[text(`target_${p.id}`,`${p.label} · ${p.reference} · ${formatAED(p.amountMinor)} · revision ${p.version||p.revision.slice(0,12)}`),...(p.items||[]).map(i=>text(`item_${i.id}`,`${i.obligationId} · ${formatAED(i.amountMinor)} · Discount ${formatAED(i.discountMinor||0)}`))];
  children.push({type:'Heading',id:'payment_heading',properties:{text:r?'Exact payment review':'Choose payment funding'}});
  if(f.kind==='FUNDING')children.push(text('wallet_target',`Wallet funding target: ${f.accountId}. Saved-card capture must complete before wallet credit.`));
  if(f.notice)children.push(text('payment_notice',f.notice));
  for(const p of f.payables)children.push(...items(p));
  if(!r){
    children.push(text('draft_total',`Amount ${formatAED(f.amountMinor)} · Fees AED 0.00 · Total ${formatAED(f.amountMinor)}. No funds reserved or captured.`),text('draft_expiry',`Funding choice expires ${new Date(f.expiresAt).toISOString()}. Reviewing a bill also links its provider-verified account to this workspace.`));
    if(f.choices.length){children.push({type:'ChoiceGroup',id:'payment_funding_choices',properties:{name:'Payment funding source',selectedId:f.selectedChoice||f.choices[0].id,options:f.choices.map(c=>({id:c.id,title:methodName(c.source),subtitle:`Source version ${c.source.version} · Available ${formatAED(c.availableMinor)} · Held ${formatAED(c.heldMinor)}${c.source.kind==='card'?` · expires ${c.source.expiresMonth}/${c.source.expiresYear}`:''}`}))}});
      if(!f.pendingCreate)children.push(button('review_selected_funding','Review selected funding','payment_surface_choose',{flowId:f.id}));
    }else children.push(text('no_funding','Add an active synthetic saved card in Payment accounts, then reopen this service. No implicit card or fallback is selected.'));
    if(f.pendingCreate)children.push(button('resume_review','Inspect original review','payment_surface_refresh',{flowId:f.id}));
    children.push(button('cancel_payment','Cancel payment review','payment_surface_cancel',{flowId:f.id}));
  }else{
    const source='source' in r?r.source:r.quote.source,amount='totalMinor' in r?r.totalMinor:r.quote.totalMinor;
    children.push(text('exact_source',`Funding: ${methodName(source)} · source version ${source.version}${source.kind==='card'?` · card expires ${source.expiresMonth}/${source.expiresYear}`:''}`));
    if('quote' in r&&'billingAccount' in r.quote)children.push(text('exact_biller',`Biller: ${r.quote.billingAccount.nickname} · ${r.quote.billingAccount.reference} · biller version ${r.quote.billingAccount.version}`));
    const available=f.choices.find(c=>c.source.id===source.id);if(available)children.push(text('available_at_review',`At funding selection: available ${formatAED(available.availableMinor)} · held ${formatAED(available.heldMinor)}. Authorization rechecks current capacity.`));
    const fee='orders' in r?r.orders.reduce((n,o)=>n+o.quote.feeMinor,0):r.quote.feeMinor;
    children.push(text('exact_total',`Amount ${formatAED(amount-fee)} · Fees ${formatAED(fee)} · Total ${formatAED(amount)}`),text('review_reference',`Order ${r.id} · ${r.state} · review expires ${r.expiresAt}`));
    if('orders' in r){
      children.push(text('group_boundary','One source, sequential child payments. This is not atomic across providers.'));
      for(const child of r.orders)children.push(text(`child_${child.id}`,`${child.quote.payable.label} · ${formatAED(child.quote.totalMinor)} · ${child.state}${paymentReceiptReady(child)&&child.receipt?` · Receipt ${child.receipt.receiptNumber}`:''}`));
      if(!f.responseUnknown&&r.state==='AWAITING_APPROVAL')children.push(button('authorize_group',`Approve checkout for ${formatAED(amount)}`,'payment_surface_authorize',terms(f,r)));
      if(!f.responseUnknown&&['READY','RECONCILIATION_REQUIRED'].includes(r.state))children.push(button('execute_group',r.state==='READY'?`Pay checkout ${formatAED(amount)}`:'Inspect or resume original checkout','payment_surface_execute',terms(f,r)));
      const child=r.orders.find(o=>o.state==='REQUIRES_ACTION');if(child&&!f.responseUnknown)addChallenge(children,f,child);
      if(confirmed)children.push(text('confirmed_receipt',`Provider-confirmed checkout · ${formatAED(r.settledMinor)} · ${r.orders.length} receipts`));
      if(['PARTIAL','STOPPED','CANCELLED'].includes(r.state))children.push(text('partial_checkout',`Checkout stopped. Confirmed prior payments ${formatAED(r.settledMinor)} are retained; remaining lines are not a completed receipt.`));
    }else{
      if(!f.responseUnknown&&r.state==='AWAITING_APPROVAL')children.push(button('authorize_payment',`Approve authorization for ${formatAED(amount)}`,'payment_surface_authorize',terms(f,r)));
      if(!f.responseUnknown&&r.state==='AUTHORIZED'){children.push(text('authorization_only','Funds reserved temporarily. No payment captured yet.'));children.push(button('execute_payment',`${f.kind==='FUNDING'?'Add to wallet':'Pay'} ${formatAED(amount)}`,'payment_surface_execute',terms(f,r)));}
      if(!f.responseUnknown&&r.state==='REQUIRES_ACTION')addChallenge(children,f,r);
      if(['CAPTURING','CAPTURED','RECONCILIATION_REQUIRED'].includes(r.state)||'sourceFinalizationPending' in r&&r.sourceFinalizationPending)children.push(text('unknown_effect','Inspect or resume this original payment. An uncertain capture or provider response is not a completed receipt.'));
      if(r.state==='FAILED')children.push(text('payment_failed',`Payment stopped: ${r.failureCode||'FAILED'}. No completed payment receipt.`));
      if(paymentReceiptReady(r)&&r.receipt){children.push(text('confirmed_receipt',`Provider-confirmed payment · ${formatAED(amount)} · Receipt ${r.receipt.receiptNumber} · Paid from ${methodName(source)}`));if('quote' in r&&'billingAccount' in r.quote)children.push(text('confirmed_target',`Target ${r.quote.payable.reference}`));}
      if(r.state==='CANCELLED')children.push(text('cancelled_payment','Payment review cancelled before capture. Reserved funds released.'));
    }
    if(r.state==='AUTHORIZATION_PENDING')children.push(text('pending_issuer','Waiting for the simulated issuer decision. Capacity is reserved; no payment captured. An unattended actor cannot answer a human challenge.'));
    if(!terminal(r)){
      children.push(button('refresh_payment','Inspect or resume original payment','payment_surface_refresh',{flowId:f.id}));
      children.push(button('cancel_payment','Cancel payment review','payment_surface_cancel',{flowId:f.id}));
    }
  }
  state.currentSurface={version:'1.0.0',sessionId:state.sessionId,timestamp:Date.now(),view:{type:'SurfaceCard',id:confirmed?'payment_receipt_card':r?'payment_review_card':'payment_source_card',style:{variant:confirmed?'success':f.notice?'warning':'primary'},children}};
  const message=f.notice||(!r?'Choose a funding source and review its exact terms. No funds moved.':r.state==='AWAITING_APPROVAL'?'Review the exact source and total. Authorization reserves capacity; payment requires another explicit action.':r.state==='AUTHORIZED'?'Funds are reserved temporarily. Use the payment button to capture this exact order.':r.state==='REQUIRES_ACTION'?'The selected card needs your explicit challenge decision. No payment captured for this challenged order.':r.state==='AUTHORIZATION_PENDING'?'The simulated issuer decision is pending. Inspect this original order after the operator resolves it.':confirmed?'The provider has confirmed the payment. Review the original source and receipt on the surface.':r.state==='CANCELLED'?'The review is closed. Any confirmed earlier checkout payments remain recorded.':r.state==='FAILED'?'This payment stopped. Review the reason; no completed payment receipt is shown.':'Review the current original payment and child states before continuing. Do not create a replacement charge for an unknown result.');
  state.messages.push({id:randomUUID(),role:'assistant',content:message,timestamp:Date.now()});
  if(r&&terminal(r))state.paymentFlow=undefined;
}
function addChallenge(children:UIComponentNode[],f:SurfacePaymentFlow,r:PaymentAuthorizationReview|WalletFundingOrder){
  children.push(text('challenge_terms',`Demo challenge for ${formatAED(r.quote.totalMinor)} from ${methodName(r.quote.source)}. Only approve or reject this exact order.`));
  for(const decision of ['APPROVE','REJECT'])children.push(button(`challenge_${decision}`,`${decision==='APPROVE'?'Approve':'Reject'} demo card challenge`,'payment_surface_challenge',{...terms(f,r),challengeId:r.authorization!.challengeId,decision}));
}
async function ensureLinks(source:ProviderClient,actor:Actor,f:SurfacePaymentFlow){
  const {billingAccounts}=await call(source,actor,f,'payments','GET','/billing-accounts');
  const seen=new Set<string>();for(const p of f.payables){const key=`${p.provider}:${p.reference}`;if(seen.has(key))continue;seen.add(key);
    if(!billingAccounts.some((b:any)=>b.status==='ACTIVE'&&b.provider===p.provider&&b.reference===p.reference))try{await call(source,actor,f,'payments','POST','/billing-accounts',{provider:p.provider,reference:p.reference,nickname:`${p.provider.toUpperCase()} · ${p.reference}`.slice(0,64)});}catch(e){if(!(e instanceof UpstreamError)||e.code!=='BILLER_ALREADY_LINKED')throw e;}
  }
}
async function start(state:SuperAppAgentState,actor:Actor,action:string,payload:Record<string,any>,source:ProviderClient){
  if(state.paymentFlow)fail('PAYMENT_REVIEW_OPEN','Finish or cancel the current payment review first.');
  const overview=await paymentOverview(actor,source),now=Date.now();
  const f:SurfacePaymentFlow={id:randomUUID(),ownerSub:actor.sub,accountId:actor.accountId,kind:action==='topup_wallet'?'FUNDING':action==='confirm_smartcity_checkout'?'GROUP':'PAYMENT',expiresAt:now+300000,payables:[],amountMinor:0,choices:validSources(overview,action==='topup_wallet',now)};
  const currentBill=(provider:string,id:string,revision:string,amount:number)=>{const p=overview.payables.find(p=>p.provider===provider&&p.obligationId===id);if(!p||p.status!=='UNPAID'||p.revision!==revision||p.amountMinor!==amount)fail('PAYABLE_CHANGED','The displayed bill changed. Reopen the service for current terms.');return p!;};
  const fineSelection=async(items:{payableId:string;expectedRevision:string}[])=>{if(!items?.length)fail('PAYABLE_CHANGED','Reopen the fine review for exact current revisions.');return(await call(source,actor,f,'police','POST','/fine-selections',{items})).payable as Payable;};
  if(action==='topup_wallet')f.amountMinor=Math.round(payload.amount*100);
  else if(action==='pay_police_fines')f.payables=[await fineSelection(payload.expectedPayables)];
  else if(action==='confirm_smartcity_checkout'){
    if(!payload.expectedPayables||payload.expectedAmountMinor===undefined)fail('PAYABLE_CHANGED','Reopen the current checkout review.');
    for(const item of payload.expectedPayables){const p=overview.payables.find(p=>p.id===item.payableId&&p.provider===item.provider);if(!p||p.revision!==item.expectedRevision||p.status!=='UNPAID')fail('PAYABLE_CHANGED','A displayed checkout item changed. Reopen the service.');if(p!.provider!=='police')f.payables.push(p!);}
    const fines=payload.expectedPayables.filter((i:any)=>i.provider==='police');if(fines.length)f.payables.push(await fineSelection(fines.map((i:any)=>({payableId:i.payableId,expectedRevision:i.expectedRevision}))));
    const target=overview.rechargeTargets?.find(t=>t.provider==='rta'&&t.reference===payload.targetReference);if(!target||target.version!==payload.expectedTargetVersion)fail('RECHARGE_TARGET_CHANGED','The displayed toll target changed. Reopen the checkout.');
    f.payables.push((await call(source,actor,f,'rta','POST','/recharge-quotes',{targetReference:target!.reference,amountMinor:10000,expectedTargetVersion:target!.version,intentId:f.id})).payable);
  }else f.payables=[currentBill(action==='pay_utilities_bill'?'dewa':payload.provider,payload.billId,payload.expectedPayableRevision,payload.expectedAmountMinor)];
  if(f.payables.length)f.amountMinor=f.payables.reduce((sum,p)=>sum+p.amountMinor,0);
  if(payload.expectedAmountMinor!==undefined&&payload.expectedAmountMinor!==f.amountMinor)fail('PAYABLE_CHANGED','The displayed amount changed. Reopen the service for current terms.');
  state.paymentFlow=f;render(state,f);
}
async function readRecord(source:ProviderClient,actor:Actor,f:SurfacePaymentFlow){
  if(!f.record){if(!f.pendingCreate)fail('PAYMENT_REVIEW_MISSING','Choose funding before continuing.');const result=await call(source,actor,f,'payments','POST',f.pendingCreate!.route,f.pendingCreate!.body);f.record=result.order||result.group;}
  const result=await call(source,actor,f,'payments','GET',`${routeFor(f)}/${f.record!.id}`);f.record=result.order||result.group;return f.record!;
}
/** Returns false for unrelated actions and for the offline fixture implementation. */
export async function handlePaymentSurfaceAction(state:SuperAppAgentState,actor:Actor,action:string,payload:Record<string,any>,source=client){
  if(process.env.PROVIDER_INTEGRATION!=='true'||!entries.includes(action)&&!action.startsWith('payment_surface_'))return false;
  let creating=false;
  try{
    if(entries.includes(action)){await start(state,actor,action,payload,source);return true;}
    const f=current(state,actor,payload);f.notice=undefined;f.responseUnknown=false;
    if(action==='payment_surface_choose'){
      if(f.record||f.pendingCreate||Date.now()>=f.expiresAt)fail('PAYMENT_REVIEW_EXPIRED','Reopen an unexpired funding review.');
      const choice=f.choices.find(c=>c.id===payload.selectedChoice);if(!choice)fail('PAYMENT_SOURCE_CHANGED','Choose an advertised current funding source.');
      f.selectedChoice=choice!.id;await ensureLinks(source,actor,f);
      const method={methodId:choice!.source.id,expectedMethodVersion:choice!.source.version};
      f.pendingCreate={route:routeFor(f),body:f.kind==='FUNDING'?{...method,amountMinor:f.amountMinor}:f.kind==='GROUP'?{...method,items:f.payables.map(p=>({provider:p.provider,payableId:p.id,expectedPayableRevision:p.revision}))}:{...method,provider:f.payables[0].provider,payableId:f.payables[0].id,expectedPayableRevision:f.payables[0].revision}};
      creating=true;
      await readRecord(source,actor,f);
    }else if(action==='payment_surface_refresh'){
      const r=await readRecord(source,actor,f);
      if(f.kind==='PAYMENT'&&(['CAPTURING','CAPTURED','RECONCILIATION_REQUIRED'].includes(r.state)||'sourceFinalizationPending' in r&&r.sourceFinalizationPending))f.record=(await call(source,actor,f,'payments','POST',`${routeFor(f)}/${r.id}/recover`,{})).order;
    }else if(action==='payment_surface_cancel'){
      if(f.record||f.pendingCreate){const r=await readRecord(source,actor,f);if(!terminal(r)){const result=await call(source,actor,f,'payments','POST',`${routeFor(f)}/${r.id}/cancel`,{expectedVersion:r.version});f.record=result.order||result.group;}}
      else{state.paymentFlow=undefined;const message='Payment review cancelled. No funds reserved or captured.';state.messages.push({id:randomUUID(),role:'assistant',content:message,timestamp:Date.now()});state.currentSurface={version:'1.0.0',sessionId:state.sessionId,timestamp:Date.now(),view:{type:'Text',id:'payment_cancelled',properties:{text:message}}};return true;}
    }else{
      if(!f.record)fail('PAYMENT_REVIEW_MISSING','Inspect the original review before continuing.');
      const r=f.record!,bound='orders' in r&&action==='payment_surface_challenge'?r.orders.find(o=>o.id===payload.orderId):r;
      if(!bound||bound.id!==payload.orderId||bound.version!==payload.expectedVersion||bound.approvalDigest!==payload.approvalDigest)fail('PAYMENT_REVIEW_CHANGED','Act on the exact displayed order and version.');
      const op=action==='payment_surface_authorize'?'approve':action==='payment_surface_challenge'?'challenge':action==='payment_surface_execute'?'execute':fail('PAYMENT_ACTION_UNAVAILABLE','This payment action is unavailable.');
      const route=action==='payment_surface_challenge'&&f.kind==='GROUP'?'/payment-orders':routeFor(f);
      const result=await call(source,actor,f,'payments','POST',`${route}/${bound!.id}/${op}`,{expectedVersion:payload.expectedVersion,approvalDigest:payload.approvalDigest,...(op==='challenge'?{challengeId:payload.challengeId,decision:payload.decision}:{})});
      f.record=result.order||result.group;if(f.kind==='GROUP'&&op==='challenge')f.record=r;
      await readRecord(source,actor,f);
    }
    render(state,f);return true;
  }catch(e){
    const f=state.paymentFlow;
    if(creating&&f&&!f.record&&e instanceof UpstreamError&&e.status>=400&&e.status<500&&![401,403].includes(e.status))delete f.pendingCreate;
    const message=e instanceof UpstreamError&&e.status<500?`${e.code}: ${e.message}`:'Payment response unavailable. Inspect the original operation; do not start a replacement charge.';
    if(f){f.notice=message;f.responseUnknown=!(e instanceof UpstreamError)||e.status>=500;render(state,f);}else state.currentSurface={version:'1.0.0',sessionId:state.sessionId,timestamp:Date.now(),view:{type:'SurfaceCard',id:'payment_unavailable_card',style:{variant:'warning'},children:[text('payment_error',message)]}};
    return true;
  }
}
/** Header/chat cancellation calls this same original-order path before discarding a surface. */
export async function cancelSurfacePayment(state:SuperAppAgentState,actor:Actor){
  if(!state.paymentFlow)return false;
  await handlePaymentSurfaceAction(state,actor,'payment_surface_cancel',{flowId:state.paymentFlow.id});return true;
}
