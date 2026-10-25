import { removeTemp } from '../../test/support/temp-cleanup.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Ajv } from 'ajv';
import { AccountDatabase } from '../provider-simulator/src/database.ts';
import { ProviderEngine } from '../provider-simulator/src/engine.ts';
import { PaymentLedger } from '../provider-simulator/src/payment-ledger.ts';
import { PaymentResourceUses } from '../provider-simulator/src/payment-resource-uses.ts';
import { PaymentOrders,PaymentOrderError } from '../provider-simulator/src/payment-orders.ts';
import { PaymentIssuer,IssuerError,type IssuerBinding } from '../provider-simulator/src/payment-issuer.ts';
import { paymentRegistry } from '../provider-simulator/src/payment-registry.ts';
import { actorFor } from '../../packages/backend-kit/src/context.ts';
import { operations } from '../provider-simulator/src/contracts.ts';
import { validateRequest } from '../../packages/protocol-core/src/request-validation.ts';
function setup(t:any,path=':memory:'){
  const db=new AccountDatabase(path),source=new AccountDatabase(':memory:');t.after(()=>{db.close();source.close();});
  const actor=actorFor({sub:'authorize-owner'},undefined,'Bearer signed-owner');db.accounts(actor.sub);source.accounts(actor.sub);
  const paymentEngine=new ProviderEngine('payments',db);paymentEngine.seed(actor);
  const sourceEngine=new ProviderEngine('dewa',source);sourceEngine.seed(actor);const payable=sourceEngine.payables!.list(actor.accountId)[0];
  let time=Date.now();const clock=()=>time,ledger=new PaymentLedger(db,clock),uses=new PaymentResourceUses(db),issuer=new PaymentIssuer(db,clock),orders=new PaymentOrders(db,issuer,ledger,uses,clock);
  const registry=(path:string,body:any)=>db.transaction(()=>paymentRegistry(db,actor.accountId,'POST',path,body,uses)) as any;
  registry('/billing-accounts',{provider:'dewa',reference:payable.reference,nickname:'Home'});
  const card=(preset='approved')=>registry('/payment-methods',{preset,nickname:'Bound demo card'}).method;
  const create=(method=card(),snapshot=payable)=>orders.create(actor,{provider:'dewa',payableId:snapshot.id,expectedPayableRevision:snapshot.revision,methodId:method.id,expectedMethodVersion:method.version},snapshot);
  return {db,source,actor,payable,ledger,uses,issuer,orders,card,create,registry,clock,advance:(ms:number)=>{time+=ms;}};
}
const orderError=(code:string)=>(e:unknown)=>e instanceof PaymentOrderError&&e.code===code;
const issuerError=(code:string)=>(e:unknown)=>e instanceof IssuerError&&e.code===code;
const decision=(order:{version:number;approvalDigest:string})=>({expectedVersion:order.version,approvalDigest:order.approvalDigest});

test('stored owner approval creates one finite card hold, locks real dependencies and cancels without a financial effect',t=>{
  const {db,actor,payable,orders,issuer,uses,create,registry,ledger}=setup(t),order=create();
  assert.equal(order.state,'AWAITING_APPROVAL');assert.equal(uses.list(actor.accountId).length,2);assert.equal(issuer.summary(actor.accountId,order.quote.source.id).heldMinor,0);
  const body=operations.payments.find(op=>op.id==='createAuthorizationOrder')!.result.order;assert.equal(new Ajv({strict:false}).compile(body)(order),true);
  assert.throws(()=>registry('/payment-methods/status',{methodId:order.quote.source.id,expectedVersion:1,status:'REMOVED'}),/active payment/);
  const approved=orders.approve(actor,order.id,decision(order),payable);assert.equal(approved.state,'AUTHORIZED');assert.equal(approved.fundsCaptured,false);
  assert.deepEqual(issuer.summary(actor.accountId,order.quote.source.id),{sourceId:order.quote.source.id,limitMinor:200000,refundedMinor:0,heldMinor:42040,spentMinor:0,availableMinor:157960,currency:'AED'});
  assert.equal(uses.list(actor.accountId).filter(d=>d.dependentKind==='HOLD').length,1);
  assert.throws(()=>orders.approve(actor,order.id,decision(order),payable),orderError('APPROVAL_CHANGED'));
  orders.cancel(actor,approved.id,approved.version);assert.equal(issuer.summary(actor.accountId,order.quote.source.id).heldMinor,0);assert.equal(uses.list(actor.accountId).length,0);
  assert.equal(ledger.summary(actor.accountId).balanceMinor,150000);assert.equal(db.list(actor.accountId,'transaction').length,0);
});

test('challenge decisions bind owner, exact order, source and approval; unattended, substituted and repeated responses fail',t=>{
  const {actor,payable,orders,issuer,card,create}=setup(t),order=create(card('challenge'));
  const pending=orders.approve(actor,order.id,decision(order),payable);assert.equal(pending.state,'REQUIRES_ACTION');
  const input={...decision(pending),challengeId:pending.authorization!.challengeId!,decision:'APPROVE' as const};
  assert.throws(()=>orders.challenge(actor,pending.id,input,payable,false),issuerError('INTERACTIVE_CHALLENGE_REQUIRED'));
  assert.throws(()=>orders.challenge(actor,pending.id,{...input,challengeId:'another-challenge'},payable,true),issuerError('CHALLENGE_MISMATCH'));
  assert.throws(()=>orders.challenge(actor,pending.id,{...input,approvalDigest:'f'.repeat(64)},payable,true),orderError('APPROVAL_CHANGED'));
  const authorized=orders.challenge(actor,pending.id,input,payable,true);assert.equal(authorized.state,'AUTHORIZED');assert.equal(issuer.summary(actor.accountId,order.quote.source.id).heldMinor,42040);
  assert.throws(()=>orders.challenge(actor,pending.id,input,payable,true),orderError('APPROVAL_CHANGED'));
  assert.throws(()=>orders.get(actorFor({sub:'different-owner'}),pending.id),orderError('ACCOUNT_FORBIDDEN'));
});

test('challenge rejection and expiration persist terminal outcomes and release holds, payable reservation and lifecycle uses',t=>{
  const {actor,payable,orders,issuer,uses,card,create,advance}=setup(t),method=card('challenge');
  const order=create(method),pending=orders.approve(actor,order.id,decision(order),payable);
  const rejected=orders.challenge(actor,pending.id,{...decision(pending),challengeId:pending.authorization!.challengeId!,decision:'REJECT'},payable,true);
  assert.equal(rejected.failureCode,'CHALLENGE_REJECTED');assert.equal(issuer.summary(actor.accountId,method.id).heldMinor,0);assert.equal(uses.list(actor.accountId).length,0);
  const next=create(method),waiting=orders.approve(actor,next.id,decision(next),payable);advance(120001);
  const expired=orders.get(actor,waiting.id);assert.equal(expired.state,'FAILED');assert.equal(expired.failureCode,'AUTHORIZATION_EXPIRED');assert.equal(issuer.summary(actor.accountId,method.id).heldMinor,0);assert.equal(uses.list(actor.accountId).length,0);
  assert.throws(()=>orders.challenge(actor,expired.id,{...decision(expired),challengeId:waiting.authorization!.challengeId!,decision:'APPROVE'},payable,true),orderError('ORDER_CLOSED'));
});

test('hard decline, finite limit and disabled/expired source outcomes are persisted without wallet fallback',t=>{
  const {actor,payable,orders,issuer,card,create,registry,db,ledger}=setup(t);
  for(const preset of ['declined','limited']){
    const method=card(preset),order=create(method),result=orders.approve(actor,order.id,decision(order),payable);
    assert.equal(result.state,'FAILED');assert.equal(result.failureCode,preset==='declined'?'CARD_DECLINED':'CARD_LIMIT_EXCEEDED');assert.equal(issuer.summary(actor.accountId,method.id).heldMinor,0);assert.equal(orders.get(actor,result.id).failureCode,result.failureCode);
  }
  const disabled=card(),review=create(disabled);registry('/payment-methods/status',{methodId:disabled.id,expectedVersion:1,status:'DISABLED'});
  assert.equal(orders.approve(actor,review.id,decision(review),payable).failureCode,'METHOD_CHANGED');
  const expired=card(),expiring=create(expired);db.put(actor.accountId,'payment-method',{...expired,expiresYear:2001},expired.id);
  assert.equal(orders.approve(actor,expiring.id,decision(expiring),payable).failureCode,'METHOD_EXPIRED');
  assert.equal(ledger.summary(actor.accountId).balanceMinor,150000);assert.equal(db.list(actor.accountId,'transaction').length,0);
});

test('different request identities cannot reserve the same obligation; stale prices and approval changes cannot hold funds',t=>{
  const {actor,payable,orders,issuer,card,create,advance}=setup(t),method=card(),order=create(method);
  assert.throws(()=>create(method),orderError('PAYABLE_RESERVED'));
  assert.throws(()=>orders.approve(actor,order.id,{...decision(order),approvalDigest:'0'.repeat(64)},payable),orderError('APPROVAL_CHANGED'));
  assert.throws(()=>orders.approve(actor,order.id,decision(order),{...payable,amountMinor:42041}),orderError('PAYABLE_CHANGED'));
  assert.throws(()=>orders.approve(actor,order.id,decision(order),{...payable,revision:'f'.repeat(64)}),orderError('PAYABLE_CHANGED'));
  assert.equal(issuer.summary(actor.accountId,method.id).heldMinor,0);
  advance(300001);assert.equal(orders.get(actor,order.id).failureCode,'APPROVAL_EXPIRED');assert.ok(create(method).id!==order.id);
});

test('wallet authorizations hold available funds, reject competing spend and void on cancel without changing posted funds',t=>{
  const {db,actor,payable,orders,ledger,create}=setup(t),order=create({id:'wallet',version:1});
  const approved=orders.approve(actor,order.id,decision(order),payable);assert.equal(approved.state,'AUTHORIZED');
  assert.deepEqual(ledger.summary(actor.accountId),{balanceMinor:150000,heldMinor:42040,availableMinor:107960,currency:'AED'});
  assert.throws(()=>ledger.record(actor.accountId,'PAYMENT','concurrent-spend',120000,'wallet'),(e:any)=>e.code==='INSUFFICIENT_AVAILABLE_FUNDS');
  orders.cancel(actor,approved.id,approved.version);assert.equal(ledger.summary(actor.accountId).availableMinor,150000);assert.equal(db.list(actor.accountId,'transaction').length,0);
  ledger.record(actor.accountId,'PAYMENT','other-spend',120000,'wallet');const next=create({id:'wallet',version:1});const failed=orders.approve(actor,next.id,decision(next),payable);assert.equal(failed.state,'FAILED');assert.equal(failed.failureCode,'INSUFFICIENT_AVAILABLE_FUNDS');assert.equal(ledger.summary(actor.accountId).balanceMinor,30000);
});

test('reopen and competing database connections preserve stored approval, exclusive obligation and issuer hold',t=>{
  const dir=mkdtempSync(join(tmpdir(),'cityside-authorization-'));t.after(()=>removeTemp(dir));
  const path=join(dir,'payments.sqlite'),f=setup(t,path),order=f.create(),approved=f.orders.approve(f.actor,order.id,decision(order),f.payable);
  const other=new AccountDatabase(path);t.after(()=>other.close());const issuer=new PaymentIssuer(other),uses=new PaymentResourceUses(other),orders=new PaymentOrders(other,issuer,new PaymentLedger(other),uses);
  assert.equal(orders.get(f.actor,order.id).approvalDigest,order.approvalDigest);assert.equal(issuer.summary(f.actor.accountId,order.quote.source.id).heldMinor,42040);
  assert.throws(()=>orders.create(f.actor,{provider:'dewa',payableId:f.payable.id,expectedPayableRevision:f.payable.revision,methodId:order.quote.source.id,expectedMethodVersion:1},f.payable),orderError('PAYABLE_RESERVED'));
  assert.throws(()=>orders.cancel(f.actor,order.id,1),orderError('ORDER_CHANGED'));orders.cancel(f.actor,order.id,approved.version);
  assert.equal(f.issuer.summary(f.actor.accountId,order.quote.source.id).heldMinor,0);assert.equal(f.orders.get(f.actor,order.id).state,'CANCELLED');
});

test('issuer cumulative finite limit accounts for capture, expires unused holds and rejects binding substitution',t=>{
  const {actor,issuer,card,advance,clock}=setup(t),method=card();
  const binding:IssuerBinding={accountId:actor.accountId,ownerSub:actor.sub,orderId:'issuer-test-order-1',sourceId:method.id,sourceVersion:1,amountMinor:150000,approvalDigest:'a'.repeat(64),expiresAt:clock()+60000};
  const auth=issuer.authorize(binding);assert.equal(auth.state,'AUTHORIZED');assert.equal(issuer.authorize(binding).id,auth.id);
  assert.throws(()=>issuer.capture({...binding,amountMinor:1}),issuerError('AUTHORIZATION_CONFLICT'));
  issuer.capture(binding);issuer.capture(binding);assert.equal(issuer.summary(actor.accountId,method.id).spentMinor,150000);
  const second={...binding,orderId:'issuer-test-order-2',amountMinor:60000};assert.equal(issuer.authorize(second).failureCode,'CARD_LIMIT_EXCEEDED');
  const third={...binding,orderId:'issuer-test-order-3',amountMinor:50000};issuer.authorize(third);advance(60001);assert.equal(issuer.summary(actor.accountId,method.id).heldMinor,0);assert.equal(issuer.get(third).state,'EXPIRED');assert.equal(issuer.summary(actor.accountId,method.id).availableMinor,50000);
});

test('order request schemas reject client prices, source substitutions, automatic challenge flags and malformed approvals',()=>{
  const create={accountId:'acc_owner',requestKey:'unique_request_key',provider:'dewa',payableId:'dewa:bill:owned',expectedPayableRevision:'a'.repeat(64),methodId:'wallet',expectedMethodVersion:1};
  assert.equal(validateRequest('agent-core','POST','/api/payments/orders',{},create),undefined);
  for(const changed of [{...create,totalMinor:1},{...create,source:'demo_approved'},{...create,provider:'remote'},{...create,expectedPayableRevision:'stale'}])assert.equal(validateRequest('agent-core','POST','/api/payments/orders',{},changed)?.status,400);
  const challenge={accountId:'acc_owner',requestKey:'challenge_request',orderId:'order_1',expectedVersion:2,approvalDigest:'a'.repeat(64),challengeId:'challenge_1',decision:'APPROVE'};
  assert.equal(validateRequest('agent-core','POST','/api/payments/orders/challenge',{},challenge),undefined);
  assert.equal(validateRequest('agent-core','POST','/api/payments/orders/challenge',{}, {...challenge,automatic:true})?.status,400);
});
