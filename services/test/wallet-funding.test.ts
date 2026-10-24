import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync,rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { actorFor } from '../../packages/backend-kit/src/context.ts';
import { AccountDatabase } from '../provider-simulator/src/database.ts';
import { ProviderEngine } from '../provider-simulator/src/engine.ts';
import type { WalletFundingOrder } from '../../packages/protocol-core/src/payments.ts';
function fixture(t:any,preset='approved',path=':memory:'){
  let now=Date.now();const db=new AccountDatabase(path);t.after(()=>db.close());const engine=new ProviderEngine('payments',db,{authorizationClock:()=>now}),actor=actorFor({sub:'funding-owner'},undefined,'Bearer current-owner');db.accounts(actor.sub);engine.seed(actor);
  const card=db.transaction(()=>engine.execute(actor,'POST','/payment-methods',{preset,nickname:'Selected funding card'})).data.method,funding=engine.funding!;
  const create=(amountMinor=5000)=>funding.create(actor,{amountMinor,methodId:card.id,expectedMethodVersion:card.version});
  return {db,engine,actor,card,funding,create,advance:(ms:number)=>{now+=ms;}};
}
const input=(o:WalletFundingOrder)=>({expectedVersion:o.version,approvalDigest:o.approvalDigest});
test('wallet funding review and authorization do not credit; capture and exact retries credit once with balanced postings',t=>{
  const f=fixture(t),review=f.create();assert.equal(review.quote.walletAccountId,f.actor.accountId);assert.equal(review.quote.feeMinor,0);
  assert.equal(f.engine.ledger!.summary(f.actor.accountId).balanceMinor,150000);assert.throws(()=>f.funding.execute(f.actor,review.id,input(review)),(e:any)=>e.code==='FUNDING_NOT_AUTHORIZED');
  const authorized=f.funding.approve(f.actor,review.id,input(review));assert.equal(authorized.state,'AUTHORIZED');assert.equal(f.engine.issuer!.summary(f.actor.accountId,f.card.id).heldMinor,5000);assert.equal(f.engine.ledger!.summary(f.actor.accountId).balanceMinor,150000);
  assert.throws(()=>f.funding.execute(f.actor,review.id,{...input(authorized),approvalDigest:'a'.repeat(64)}));
  const settled=f.funding.execute(f.actor,review.id,input(authorized));assert.equal(settled.state,'SETTLED');assert.equal(settled.receipt!.balanceMinor,155000);assert.equal(settled.fundsCaptured,true);
  assert.deepEqual(f.funding.execute(f.actor,review.id,input(authorized)),settled);assert.equal(f.engine.issuer!.summary(f.actor.accountId,f.card.id).spentMinor,5000);assert.equal(f.engine.ledger!.summary(f.actor.accountId).balanceMinor,155000);assert.equal(f.db.list(f.actor.accountId,'transaction').length,1);assert.equal(f.engine.resourceUses!.list(f.actor.accountId).length,0);
  const entries=f.db.db.prepare("SELECT p.entry_id,sum(p.amount_minor) n FROM payment_journal_postings p GROUP BY p.entry_id").all();assert.ok(entries.every(e=>e.n===0));assert.equal(entries.length,2);assert.throws(()=>f.funding.cancel(f.actor,settled.id,settled.version));
});
test('invalid amount, self-funding, cross-owner/source and duplicate open reviews cannot move funds',t=>{
  const f=fixture(t);for(const amount of [0,99,50001,100.5,NaN])assert.throws(()=>f.create(amount));
  assert.throws(()=>f.funding.create(f.actor,{amountMinor:5000,methodId:'wallet',expectedMethodVersion:1}),(e:any)=>e.code==='WALLET_SELF_FUNDING');
  assert.throws(()=>f.funding.create(f.actor,{amountMinor:5000,methodId:'foreign-card',expectedMethodVersion:1}));
  const o=f.create();assert.throws(()=>f.create(),(e:any)=>e.code==='FUNDING_IN_PROGRESS');assert.throws(()=>f.funding.get({...f.actor,sub:'another-owner'},o.id));assert.throws(()=>f.funding.approve(f.actor,o.id,{...input(o),expectedVersion:2}));
  f.funding.cancel(f.actor,o.id,o.version);assert.equal(f.engine.ledger!.summary(f.actor.accountId).balanceMinor,150000);assert.equal(f.db.list(f.actor.accountId,'transaction').length,0);
});
test('funding challenges bind owner, amount and order; only a one-time interactive decision permits capture',t=>{
  const f=fixture(t,'challenge'),o=f.create(),pending=f.funding.approve(f.actor,o.id,input(o));assert.equal(pending.state,'REQUIRES_ACTION');
  const answer={...input(pending),challengeId:pending.authorization!.challengeId!,decision:'APPROVE' as const};assert.throws(()=>f.funding.challenge(f.actor,o.id,answer,false));assert.throws(()=>f.funding.challenge(f.actor,o.id,{...answer,challengeId:'other'},true));assert.throws(()=>f.funding.execute(f.actor,o.id,input(pending)));
  assert.equal(f.engine.ledger!.summary(f.actor.accountId).balanceMinor,150000);const approved=f.funding.challenge(f.actor,o.id,answer,true);assert.throws(()=>f.funding.challenge(f.actor,o.id,answer,true));assert.equal(f.funding.execute(f.actor,o.id,input(approved)).state,'SETTLED');
});
test('rejecting a wallet funding challenge releases the source without a wallet credit',t=>{
  const f=fixture(t,'challenge'),o=f.create(),pending=f.funding.approve(f.actor,o.id,input(o));
  const rejected=f.funding.challenge(f.actor,o.id,{...input(pending),challengeId:pending.authorization!.challengeId!,decision:'REJECT'},true);
  assert.equal(rejected.state,'FAILED');assert.equal(rejected.failureCode,'CHALLENGE_REJECTED');assert.equal(f.engine.issuer!.summary(f.actor.accountId,f.card.id).heldMinor,0);assert.equal(f.engine.ledger!.summary(f.actor.accountId).balanceMinor,150000);
});
for(const preset of ['declined','limited','expired'])test(`${preset} source never creates an unbacked wallet credit`,t=>{
  const f=fixture(t,preset);if(preset==='expired'){assert.throws(()=>f.create());return;}
  const o=f.create(preset==='limited'?20000:5000),result=f.funding.approve(f.actor,o.id,input(o));assert.equal(result.state,'FAILED');assert.equal(result.fundsCaptured,false);assert.equal(f.engine.ledger!.summary(f.actor.accountId).balanceMinor,150000);assert.equal(f.engine.issuer!.summary(f.actor.accountId,f.card.id).heldMinor,0);
});
test('expiry and source changes release issuer capacity without credit or fallback',t=>{
  const f=fixture(t);let o=f.create();o=f.funding.approve(f.actor,o.id,input(o));f.advance(120001);assert.equal(f.funding.get(f.actor,o.id).state,'FAILED');assert.equal(f.engine.issuer!.summary(f.actor.accountId,f.card.id).heldMinor,0);
  o=f.create();o=f.funding.approve(f.actor,o.id,input(o));f.db.transaction(()=>f.engine.execute(f.actor,'POST','/payment-methods/status',{methodId:f.card.id,expectedVersion:1,status:'DISABLED'}));const failed=f.funding.execute(f.actor,o.id,input(o));assert.equal(failed.state,'FAILED');assert.equal(f.engine.issuer!.summary(f.actor.accountId,f.card.id).spentMinor,0);assert.equal(f.engine.ledger!.summary(f.actor.accountId).balanceMinor,150000);
});
test('wallet capacity is checked at execution even if its balance changed after approval',t=>{
  const f=fixture(t),o=f.create(50000),authorized=f.funding.approve(f.actor,o.id,input(o));f.engine.ledger!.record(f.actor.accountId,'TOPUP','trusted-prior-funding',840000,'external');
  const failed=f.funding.execute(f.actor,o.id,input(authorized));assert.equal(failed.state,'FAILED');assert.equal(failed.failureCode,'WALLET_BALANCE_LIMIT');assert.equal(f.engine.issuer!.summary(f.actor.accountId,f.card.id).spentMinor,0);assert.equal(f.engine.ledger!.summary(f.actor.accountId).balanceMinor,990000);
});
test('a persistence failure after local issuer capture rolls back card spend, journal credit and receipt together',t=>{
  const f=fixture(t),o=f.create(),authorized=f.funding.approve(f.actor,o.id,input(o)),put=f.db.put.bind(f.db);
  const mock=t.mock.method(f.db,'put',(account:string,kind:string,value:any,id?:string)=>{if(kind==='transaction')throw new Error('injected funding persistence failure');return put(account,kind,value,id);});
  assert.throws(()=>f.funding.execute(f.actor,o.id,input(authorized)),/injected funding persistence/);mock.mock.restore();assert.equal(f.funding.get(f.actor,o.id).state,'AUTHORIZED');assert.equal(f.engine.issuer!.summary(f.actor.accountId,f.card.id).spentMinor,0);assert.equal(f.engine.ledger!.summary(f.actor.accountId).balanceMinor,150000);
  assert.equal(f.funding.execute(f.actor,o.id,input(authorized)).state,'SETTLED');assert.equal(f.db.list(f.actor.accountId,'transaction').length,1);
});
test('reopen and a lost post-commit response restore the original receipt without another issuer charge or wallet credit',t=>{
  const dir=mkdtempSync(join(tmpdir(),'cityside-funding-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));const f=fixture(t,'approved',join(dir,'payments.sqlite')),o=f.create(),authorized=f.funding.approve(f.actor,o.id,input(o));
  const reopened=new AccountDatabase(f.db.path);t.after(()=>reopened.close());const e=new ProviderEngine('payments',reopened),settled=e.funding!.execute(f.actor,o.id,input(authorized));
  const last=new AccountDatabase(f.db.path);t.after(()=>last.close());const final=new ProviderEngine('payments',last);assert.deepEqual(final.funding!.execute(f.actor,o.id,input(authorized)),settled);assert.equal(final.ledger!.summary(f.actor.accountId).balanceMinor,155000);assert.equal(final.issuer!.summary(f.actor.accountId,f.card.id).spentMinor,5000);assert.equal(last.list(f.actor.accountId,'transaction').length,1);
});
test('separate connections serialize open funding reviews and share the finite issuer limit',t=>{
  const dir=mkdtempSync(join(tmpdir(),'cityside-funding-race-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));const f=fixture(t,'approved',join(dir,'payments.sqlite')),other=new AccountDatabase(f.db.path);t.after(()=>other.close());const e=new ProviderEngine('payments',other),o=f.create();
  assert.throws(()=>e.funding!.create(f.actor,{amountMinor:5000,methodId:f.card.id,expectedMethodVersion:1}),(error:any)=>error.code==='FUNDING_IN_PROGRESS');
  const authorized=e.funding!.approve(f.actor,o.id,input(o));f.funding.execute(f.actor,o.id,input(authorized));assert.equal(e.ledger!.summary(f.actor.accountId).balanceMinor,155000);assert.equal(e.issuer!.summary(f.actor.accountId,f.card.id).spentMinor,5000);
});
test('legacy funding flag consumes one persistent finite card and cannot reset its spent limit',t=>{
  const f=fixture(t),post=()=>f.db.transaction(()=>f.engine.execute(f.actor,'POST','/topups',{amountMinor:50000,source:'demo_approved'}));
  for(let i=0;i<4;i++)assert.equal(post().status,200);assert.equal(post().status,402);const id=f.db.get<string>(f.actor.accountId,'legacy-topup-demo_approved')!;assert.equal(f.engine.issuer!.summary(f.actor.accountId,id).spentMinor,200000);assert.equal(f.engine.ledger!.summary(f.actor.accountId).balanceMinor,350000);
  f.db.transaction(()=>f.engine.execute(f.actor,'POST','/payment-methods/status',{methodId:id,expectedVersion:1,status:'REMOVED'}));assert.throws(post,(e:any)=>e.code==='METHOD_CHANGED');assert.equal(f.db.get(f.actor.accountId,'legacy-topup-demo_approved'),id);assert.equal(f.engine.ledger!.summary(f.actor.accountId).balanceMinor,350000);
});
