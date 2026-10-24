import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, existsSync, copyFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { AccountDatabase } from '../provider-simulator/src/database.ts';
import { ProviderEngine } from '../provider-simulator/src/engine.ts';
import { PaymentLedger } from '../provider-simulator/src/payment-ledger.ts';
import { actorFor } from '../../packages/backend-kit/src/context.ts';
const actor=actorFor({sub:'journal-owner'});
function setup(t:test.TestContext) {
  const db=new AccountDatabase(':memory:');t.after(()=>db.close());const engine=new ProviderEngine('payments',db);db.accounts(actor.sub);engine.seed(actor);
  return {db,engine,ledger:engine.ledger!,post:(path:string,body:Record<string,unknown>)=>db.transaction(()=>engine.execute(actor,'POST',path,body))};
}
const count=(db:AccountDatabase)=>Number((db.db.prepare('SELECT count(*) AS count FROM payment_journal_entries').get() as {count:number}).count);

test('ledger migration preserves legacy balances/charges/idempotency, backs up once and never reseeds', t=>{
  const dir=mkdtempSync(join(tmpdir(),'cityside-ledger-migration-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));const path=join(dir,'payments.sqlite');
  let db=new AccountDatabase(path);db.accounts(actor.sub);db.put(actor.accountId,'wallet',{balanceMinor:123456,currency:'AED'});
  db.put(actor.accountId,'charge',{id:'old_charge',amountMinor:100,source:'wallet',status:'CAPTURED'},'old_charge');
  db.db.prepare('INSERT INTO idempotency VALUES(?,?,?,?,?)').run(actor.accountId,'legacy-key','legacy-hash',200,'{"success":true,"old":true}');db.close();
  db=new AccountDatabase(path);let engine=new ProviderEngine('payments',db);engine.seed(actor);
  assert.equal(engine.ledger!.summary(actor.accountId).balanceMinor,123456);assert.equal(count(db),1);
  assert.ok(existsSync(path+'.before-ledger-v1.sqlite'));const backup=readFileSync(path+'.before-ledger-v1.sqlite');
  assert.equal(db.get(actor.accountId,'charge','old_charge').id,'old_charge');assert.ok(db.db.prepare('SELECT key FROM idempotency WHERE key=?').get('legacy-key'));
  db.transaction(()=>engine.execute(actor,'POST','/topups',{amountMinor:100,source:'demo_approved'}));db.close();
  db=new AccountDatabase(path);engine=new ProviderEngine('payments',db);engine.seed(actor);assert.equal(engine.ledger!.summary(actor.accountId).balanceMinor,123556);assert.equal(count(db),2);db.close();
  assert.deepEqual(readFileSync(path+'.before-ledger-v1.sqlite'),backup);
  // Offline pre-traffic rollback uses a separate restored copy; it never overwrites an active database.
  const restored=join(dir,'restored.sqlite');copyFileSync(path+'.before-ledger-v1.sqlite',restored);const old=new AccountDatabase(restored);const migrated=new ProviderEngine('payments',old);
  assert.equal(migrated.ledger!.summary(actor.accountId).balanceMinor,123456);assert.ok(old.db.prepare('SELECT key FROM idempotency WHERE key=?').get('legacy-key'));old.close();
});

test('legacy wallet/card captures, topups and refunds write balanced postings with correct source effects', t=>{
  const {db,ledger,post}=setup(t);
  post('/topups',{amountMinor:5000,source:'demo_approved'});assert.equal(ledger.summary(actor.accountId).balanceMinor,155000);
  const wallet=post('/charges',{amountMinor:1234,source:'wallet',merchant:'dewa',reference:'bill:test'}).data.charge;
  assert.equal(ledger.summary(actor.accountId).balanceMinor,153766);
  const card=post('/charges',{amountMinor:1200,source:'demo_approved',merchant:'dewa',reference:'bill:card'}).data.charge;
  assert.equal(ledger.summary(actor.accountId).balanceMinor,153766);
  post(`/charges/${card.id}/refunds`,{reason:'Demo refund'});assert.equal(ledger.summary(actor.accountId).balanceMinor,153766);
  post(`/charges/${wallet.id}/refunds`,{reason:'Demo refund'});assert.equal(ledger.summary(actor.accountId).balanceMinor,155000);
  assert.equal(post('/charges',{amountMinor:100,source:'demo_declined',merchant:'dewa',reference:'bill:decline'}).status,402);
  assert.equal(count(db),6);
  const sums=db.db.prepare('SELECT entry_id,sum(amount_minor) AS total FROM payment_journal_postings GROUP BY entry_id').all();assert.ok(sums.every(row=>row.total===0));
  assert.equal(Number((db.db.prepare('SELECT count(*) AS count FROM payment_journal_entries WHERE finalized=0').get() as {count:number}).count),0);
  assert.throws(()=>post(`/charges/${wallet.id}/refunds`,{reason:'Duplicate'}),/cannot be refunded/);
});

test('holds reduce available funds, expire/void safely and cannot be bypassed by a legacy wallet charge',t=>{
  const {db,engine,ledger,post}=setup(t);const now=Date.now();const clocked=new PaymentLedger(db,()=>now);
  const held=clocked.reserve(actor.accountId,'hold-a',125000,now+60000);assert.equal(held.availableMinor,25000);assert.equal(held.heldMinor,125000);
  assert.equal(clocked.reserve(actor.accountId,'hold-a',125000,now+60000).heldMinor,125000);
  assert.throws(()=>clocked.reserve(actor.accountId,'hold-a',125001,now+60000),/another payload/);
  assert.throws(()=>clocked.reserve(actor.accountId,'hold-b',25001,now+60000),/Insufficient/);
  assert.equal(post('/charges',{amountMinor:25001,source:'wallet',merchant:'dewa',reference:'held'}).status,402);assert.equal(count(db),1);
  assert.equal(clocked.voidHold(actor.accountId,'hold-a').availableMinor,150000);assert.equal(clocked.voidHold(actor.accountId,'hold-a').availableMinor,150000);
  clocked.reserve(actor.accountId,'hold-expire',50000,now+1000);const later=new PaymentLedger(db,()=>now+1001);
  assert.equal(later.summary(actor.accountId).availableMinor,150000);assert.equal(later.reserve(actor.accountId,'hold-expire',50000,now+1000).heldMinor,0);
  assert.equal(engine.execute(actor,'GET','/wallet',{}).data.availableMinor,ledger.summary(actor.accountId).availableMinor);
});

test('failed transaction persistence rolls back journal, projection and effect records together',t=>{
  const {db,ledger,post}=setup(t),before=count(db);
  db.db.exec("CREATE TRIGGER reject_test_transaction BEFORE INSERT ON resources WHEN NEW.kind='transaction' BEGIN SELECT RAISE(ABORT,'injected persistence failure');END;");
  assert.throws(()=>post('/topups',{amountMinor:5000,source:'demo_approved'}),/injected persistence/);
  assert.equal(ledger.summary(actor.accountId).balanceMinor,150000);assert.equal(count(db),before);assert.equal(db.list(actor.accountId,'transaction').length,0);
});

test('SQL guards seal balanced entries; projection corruption and invalid amounts fail without adjustments',t=>{
  const {db,ledger}=setup(t),entry=db.db.prepare('SELECT id FROM payment_journal_entries').get() as {id:string};
  assert.throws(()=>db.db.prepare('INSERT INTO payment_journal_entries VALUES(?,?,?,?,?,?,?,?)').run('sealed',actor.accountId,'PAYMENT','sealed',0,'AED',new Date().toISOString(),1),/start unsealed/);
  assert.throws(()=>db.db.prepare('UPDATE payment_journal_entries SET wallet_delta=0 WHERE id=?').run(entry.id),/sealed/);
  assert.throws(()=>db.db.prepare('DELETE FROM payment_journal_postings WHERE entry_id=?').run(entry.id),/append only/);
  assert.throws(()=>db.transaction(()=>{db.db.prepare('INSERT INTO payment_journal_entries VALUES(?,?,?,?,?,?,?,?)').run('bad',actor.accountId,'PAYMENT','bad',0,'AED',new Date().toISOString(),0);db.db.prepare('UPDATE payment_journal_entries SET finalized=1 WHERE id=?').run('bad');}),/unbalanced/);
  for(const amount of [-1,0,1.5,Infinity,100000001])assert.throws(()=>ledger.record(actor.accountId,'TOPUP','invalid',amount,'external'),/integer/);
  assert.throws(()=>ledger.record(actor.accountId,'TOPUP','self',100,'wallet'),/cannot fund/);
  assert.throws(()=>ledger.record(actor.accountId,'TOPUP','overflow',100000000,'external'),/integer/);
  db.put(actor.accountId,'wallet',{balanceMinor:1,currency:'AED'});assert.throws(()=>ledger.summary(actor.accountId),/projection/);assert.equal(count(db),1);
});

test('migration failure rolls back its schema and preserves the original backup for repair',t=>{
  const dir=mkdtempSync(join(tmpdir(),'cityside-ledger-invalid-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));const path=join(dir,'invalid.sqlite');const db=new AccountDatabase(path);t.after(()=>db.close());db.accounts(actor.sub);db.put(actor.accountId,'wallet',{balanceMinor:-1,currency:'AED'});
  assert.throws(()=>new PaymentLedger(db),/integer/);assert.equal(db.db.prepare("SELECT name FROM sqlite_master WHERE name='payment_migrations'").get(),undefined);
  const original=readFileSync(path+'.before-ledger-v1.sqlite');db.put(actor.accountId,'wallet',{balanceMinor:500,currency:'AED'});const ledger=new PaymentLedger(db);assert.equal(ledger.summary(actor.accountId).balanceMinor,500);assert.deepEqual(readFileSync(path+'.before-ledger-v1.sqlite'),original);
});

test('two database connections enforce shared available funds and retain holds on reopen',t=>{
  const dir=mkdtempSync(join(tmpdir(),'cityside-ledger-holds-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));const path=join(dir,'holds.sqlite');const first=new AccountDatabase(path);first.accounts(actor.sub);const engine=new ProviderEngine('payments',first);engine.seed(actor);const second=new AccountDatabase(path);const other=new PaymentLedger(second);const expiry=Date.now()+60000;
  engine.ledger!.reserve(actor.accountId,'first',100000,expiry);assert.throws(()=>other.reserve(actor.accountId,'second',50001,expiry),/Insufficient/);assert.equal(other.reserve(actor.accountId,'second',50000,expiry).availableMinor,0);second.close();first.close();
  const reopened=new AccountDatabase(path);const restored=new PaymentLedger(reopened);assert.equal(restored.summary(actor.accountId).heldMinor,150000);assert.equal(count(reopened),1);reopened.close();
});
