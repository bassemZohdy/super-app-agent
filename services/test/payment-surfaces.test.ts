import test from 'node:test';
import assert from 'node:assert/strict';
import { actorFor } from '../../packages/backend-kit/src/context.ts';
import { UpstreamError, type ProviderClient } from '../../packages/backend-kit/src/provider-client.ts';
import { AccountDatabase } from '../provider-simulator/src/database.ts';
import { ProviderEngine } from '../provider-simulator/src/engine.ts';
import { handlePaymentSurfaceAction } from '../agent-core/src/payment-surfaces.ts';
import { issueApproval, actionIsApproved } from '../agent-core/src/approvals.ts';
import { validateAGUISurface, type UIComponentNode } from '../../packages/protocol-core/src/ag-ui.ts';
import { choiceDefaults, surfaceActionPayload } from '../../packages/protocol-core/src/surface-client.ts';
import { validateRequest } from '../../packages/protocol-core/src/request-validation.ts';
import type { SuperAppAgentState } from '../agent-core/src/langgraph/state.ts';
const nodes=(n:UIComponentNode):UIComponentNode[]=>[n,...(n.children||[]).flatMap(nodes)];
function fixture(t:any,preset='approved'){
  const old=process.env.PROVIDER_INTEGRATION;process.env.PROVIDER_INTEGRATION='true';t.after(()=>{process.env.PROVIDER_INTEGRATION=old;});
  const actor=actorFor({sub:'surface-owner'},undefined,'Bearer signed-owner'),engines=new Map<string,ProviderEngine>();
  for(const name of ['payments','dewa','etisalat','du','police','rta','dld'] as const){const db=new AccountDatabase(':memory:');db.accounts(actor.sub);const engine=new ProviderEngine(name,db);engine.seed(actor);engines.set(name,engine);t.after(()=>db.close());}
  const gateway=engines.get('payments')!,card=gateway.store.transaction(()=>gateway.execute(actor,'POST','/payment-methods',{preset,nickname:'Chosen card'})).data.method;
  const state:SuperAppAgentState={sessionId:'surface_payment_session',messages:[],activeDomain:'wallet',metadata:{accountId:actor.accountId}};(state as any).user={sub:actor.sub};
  let loseCreate=false,loseApprove=false;const writes:string[]=[];
  const source={call:async(provider:string,_actor:unknown,method:string,path:string,body:any={},key='read')=>{
    const engine=engines.get(provider)!;if(method==='GET')return engine.store.transaction(()=>engine.execute(actor,method,path,body)).data;
    writes.push(path);const prior=engine.store.get(actor.accountId,'test-response',key);if(prior)return prior;
    const id=path.split('/')[2],order=provider==='payments'&&path.startsWith('/payment-orders/')?gateway.orders!.get(actor,id):undefined;
    const p=path==='/payment-orders'?engines.get(body.provider)!.payables!.get(actor.accountId,body.payableId):order?engines.get(order.quote.payable.provider)!.payables!.get(actor.accountId,order.quote.payable.id):undefined;
    const result=engine.store.transaction(()=>{const data=engine.execute(actor,method,path,body,undefined,p).data;engine.store.put(actor.accountId,'test-response',data,key);return data;});
    if(loseApprove&&path.endsWith('/approve')){loseApprove=false;throw new UpstreamError(503,'PROVIDER_OUTCOME_UNKNOWN','Lost actual authorization response');}
    if(loseCreate&&path==='/payment-orders'){loseCreate=false;throw new UpstreamError(503,'PROVIDER_OUTCOME_UNKNOWN','Lost actual committed review response');}return result;
  }} as unknown as ProviderClient;
  const transport=source.call.bind(source);source.call=async(...args:Parameters<typeof transport>)=>{try{return await transport(...args);}catch(e){const error=e as {status?:number;code?:string;message:string};if(!(e instanceof UpstreamError)&&error.status)throw new UpstreamError(error.status,error.code||'REJECTED',error.message);throw e;}};
  const act=(action:string,payload:Record<string,unknown>)=>handlePaymentSurfaceAction(state,actor,action,payload,source);
  const offered=(action:string)=>{const n=nodes(state.currentSurface!.view).find(n=>n.onEvents?.some(e=>e.payload.action===action));assert.ok(n);const event=n.onEvents!.find(e=>e.payload.action===action)!;return surfaceActionPayload(state.currentSurface!.view,event,choiceDefaults(state.currentSurface!.view));};
  const choose=async(methodId=card.id)=>{const f=state.paymentFlow!;await act('payment_surface_choose',{flowId:f.id,selectedChoice:f.choices.find(c=>c.source.id===methodId)!.id});};
  const p=engines.get('dewa')!.payables!.list(actor.accountId).find(p=>p.status==='UNPAID')!;
  const start=()=>act('pay_utilities_bill',{billId:p.obligationId,expectedPayableRevision:p.revision,expectedAmountMinor:p.amountMinor});
  return {actor,state,gateway,engines,card,act,offered,choose,p,start,writes,lose:()=>loseCreate=true,loseAuthorization:()=>loseApprove=true};
}
test('funding selection is a nonfinancial choice, stored exact approval is separate and cancel releases a card hold',async t=>{
  const f=fixture(t);await f.start();assert.equal(f.state.currentSurface!.view.id,'payment_source_card');assert.equal(f.gateway.orders!.list(f.actor).length,0);assert.equal(f.gateway.issuer!.summary(f.actor.accountId,f.card.id).heldMinor,0);
  await f.choose();let o=f.state.paymentFlow!.record!;assert.equal(o.state,'AWAITING_APPROVAL');assert.equal('quote' in o&&o.quote.source.id,f.card.id);assert.equal(f.gateway.ledger!.summary(f.actor.accountId).balanceMinor,150000);
  await f.act('payment_surface_authorize',f.offered('payment_surface_authorize'));o=f.state.paymentFlow!.record!;assert.equal(o.state,'AUTHORIZED');assert.equal(f.gateway.issuer!.summary(f.actor.accountId,f.card.id).heldMinor,42040);assert.equal(f.gateway.store.list(f.actor.accountId,'charge').length,0);
  await f.act('payment_surface_cancel',f.offered('payment_surface_cancel'));assert.equal(f.state.paymentFlow,undefined);assert.equal(f.gateway.orders!.get(f.actor,o.id).state,'CANCELLED');assert.equal(f.gateway.issuer!.summary(f.actor.accountId,f.card.id).heldMinor,0);
});
test('every displayed funding/review binding is immutable and all shared action schemas accept renderer output',async t=>{
  const f=fixture(t);await f.start();f.state.currentSurface!.revision=crypto.randomUUID();issueApproval(f.state);const selection=f.offered('payment_surface_choose');
  assert.equal(actionIsApproved(f.state,'payment_surface_choose',selection,f.actor.sub,f.actor.accountId),true);assert.equal(actionIsApproved(f.state,'payment_surface_choose',{...selection,methodId:'wallet'},f.actor.sub,f.actor.accountId),false);
  for(const action of ['payment_surface_choose','payment_surface_cancel'])assert.equal(validateRequest('agent-core','POST','/api/a2ui/action',{},{sessionId:f.state.sessionId,surfaceRevision:f.state.currentSurface!.revision,action,payload:f.offered(action)}),undefined);
  await f.choose();f.state.currentSurface!.revision=crypto.randomUUID();issueApproval(f.state);const decision=f.offered('payment_surface_authorize');
  for(const mutation of [{...decision,expectedVersion:99},{...decision,approvalDigest:'0'.repeat(64)},{...decision,orderId:'other-order'},{...decision,amountMinor:1}])assert.equal(actionIsApproved(f.state,'payment_surface_authorize',mutation,f.actor.sub,f.actor.accountId),false);
  assert.equal(validateAGUISurface({...f.state.currentSurface,revision:crypto.randomUUID()}).success,true);assert.equal(validateRequest('agent-core','POST','/api/a2ui/action',{},{sessionId:f.state.sessionId,surfaceRevision:f.state.currentSurface!.revision,action:'payment_surface_authorize',payload:decision}),undefined);
});
test('a lost committed review response recovers the original idempotency identity and cannot switch sources',async t=>{
  const f=fixture(t);await f.start();f.lose();await f.choose();assert.ok(f.state.paymentFlow!.pendingCreate);assert.equal(f.state.paymentFlow!.record,undefined);assert.equal(f.gateway.orders!.list(f.actor).length,1);const id=f.gateway.orders!.list(f.actor)[0].id;
  await f.choose('wallet');assert.equal(f.gateway.orders!.list(f.actor).length,1);await f.act('payment_surface_refresh',f.offered('payment_surface_refresh'));assert.equal(f.state.paymentFlow!.record!.id,id);assert.equal(f.gateway.orders!.list(f.actor).length,1);
  await f.act('payment_surface_cancel',f.offered('payment_surface_cancel'));assert.equal(f.gateway.resourceUses!.list(f.actor.accountId).length,0);
});
test('source drift between selection and create cannot substitute wallet/default or reserve card capacity',async t=>{
  const f=fixture(t);await f.start();f.gateway.store.transaction(()=>f.gateway.execute(f.actor,'POST','/payment-methods/status',{methodId:f.card.id,expectedVersion:1,status:'DISABLED'}));await f.choose();assert.equal(f.state.paymentFlow!.record,undefined);assert.equal(f.gateway.orders!.list(f.actor).length,0);assert.match(JSON.stringify(f.state.currentSurface),/METHOD_UNAVAILABLE|SOURCE|changed|unavailable/i);assert.equal(f.gateway.store.list(f.actor.accountId,'charge').length,0);await f.act('payment_surface_cancel',f.offered('payment_surface_cancel'));assert.equal(f.state.paymentFlow,undefined);
});
test('stale displayed bill revisions, amount changes and unknown bill IDs never create an authorization review',async t=>{
  for(const change of [{expectedPayableRevision:'0'.repeat(64)},{expectedAmountMinor:1},{billId:'unowned-bill'}]){const f=fixture(t);await f.act('pay_utilities_bill',{billId:f.p.obligationId,expectedPayableRevision:f.p.revision,expectedAmountMinor:f.p.amountMinor,...change});assert.equal(f.state.paymentFlow,undefined);assert.match(JSON.stringify(f.state.currentSurface),/PAYABLE_CHANGED/);assert.equal(f.gateway.orders!.list(f.actor).length,0);}
});
test('funding-choice expiry and a different owner/workspace fail before a new order or hold',async t=>{
  const f=fixture(t);await f.start();f.state.paymentFlow!.expiresAt=Date.now()-1;await f.choose();assert.equal(f.gateway.orders!.list(f.actor).length,0);
  f.state.paymentFlow!.expiresAt=Date.now()+300000;const other=actorFor({sub:'other-owner'},undefined,'Bearer other');await handlePaymentSurfaceAction(f.state,other,'payment_surface_choose',{flowId:f.state.paymentFlow!.id,selectedChoice:f.state.paymentFlow!.choices[0].id},{} as ProviderClient);assert.equal(f.gateway.orders!.list(f.actor).length,0);
});
test('wallet reload requires an explicitly saved card and never advertises self-funding or a legacy free-credit flag',async t=>{
  const f=fixture(t);await f.act('topup_wallet',{amount:50});assert.equal(f.state.paymentFlow!.choices.some(c=>c.source.kind==='wallet'),false);await f.choose();const r=f.state.paymentFlow!.record!;assert.equal(r.state,'AWAITING_APPROVAL');await f.act('payment_surface_authorize',f.offered('payment_surface_authorize'));assert.equal(f.gateway.ledger!.summary(f.actor.accountId).balanceMinor,150000);await f.act('payment_surface_execute',f.offered('payment_surface_execute'));assert.equal(f.state.paymentFlow,undefined);assert.equal(f.gateway.ledger!.summary(f.actor.accountId).balanceMinor,155000);assert.equal(f.state.currentSurface!.view.id,'payment_receipt_card');assert.equal(f.writes.includes('/topups'),false);
});
test('card challenge is exact, human-visible and remains distinct from capture',async t=>{
  const f=fixture(t,'challenge');await f.start();await f.choose();await f.act('payment_surface_authorize',f.offered('payment_surface_authorize'));assert.equal(f.state.paymentFlow!.record!.state,'REQUIRES_ACTION');
  await f.act('payment_surface_challenge',f.offered('payment_surface_challenge'));assert.equal(f.state.paymentFlow!.record!.state,'AUTHORIZED');assert.equal(f.gateway.store.list(f.actor.accountId,'charge').length,0);assert.equal(f.gateway.issuer!.summary(f.actor.accountId,f.card.id).heldMinor,42040);
});
test('cancel remains a valid renderer action when the source choice group is present',async t=>{
  const f=fixture(t);await f.start();const payload=f.offered('payment_surface_cancel');assert.ok(payload.selectedChoice);await f.act('payment_surface_cancel',payload);assert.equal(f.state.paymentFlow,undefined);assert.equal(f.gateway.orders!.list(f.actor).length,0);assert.equal(f.gateway.ledger!.summary(f.actor.accountId).balanceMinor,150000);
});

test('lost authorization response exposes only original-status recovery and releases its actual hold on cancel',async t=>{
  const f=fixture(t);await f.start();await f.choose();const id=f.state.paymentFlow!.record!.id;f.loseAuthorization();await f.act('payment_surface_authorize',f.offered('payment_surface_authorize'));
  assert.equal(f.state.paymentFlow!.responseUnknown,true);assert.equal(f.gateway.orders!.get(f.actor,id).state,'AUTHORIZED');assert.equal(nodes(f.state.currentSurface!.view).some(n=>n.onEvents?.some(e=>e.payload.action==='payment_surface_execute')),false);
  await f.act('payment_surface_refresh',f.offered('payment_surface_refresh'));assert.equal(f.state.paymentFlow!.record!.id,id);assert.equal(f.state.paymentFlow!.record!.state,'AUTHORIZED');await f.act('payment_surface_cancel',f.offered('payment_surface_cancel'));assert.equal(f.gateway.issuer!.summary(f.actor.accountId,f.card.id).heldMinor,0);assert.equal(f.gateway.store.list(f.actor.accountId,'charge').length,0);
});
test('source-owned quote changes after funding review cannot be authorized or captured under the old digest',async t=>{
  const f=fixture(t);await f.start();await f.choose();f.engines.get('dewa')!.payables!.amend(f.actor.accountId,f.p.id,f.p.revision,{amountMinor:f.p.amountMinor+1});await f.act('payment_surface_authorize',f.offered('payment_surface_authorize'));assert.match(JSON.stringify(f.state.currentSurface),/PAYABLE_CHANGED/);assert.equal(f.gateway.issuer!.summary(f.actor.accountId,f.card.id).heldMinor,0);assert.equal(f.gateway.store.list(f.actor.accountId,'charge').length,0);await f.act('payment_surface_cancel',f.offered('payment_surface_cancel'));assert.equal(f.gateway.resourceUses!.list(f.actor.accountId).length,0);
});
