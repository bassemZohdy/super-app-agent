import { existsSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { MAX_PAYMENT_MINOR } from '../../../packages/protocol-core/src/payments.ts';
import type { AccountDatabase } from './database.ts';
export class PaymentLedgerError extends Error {
  readonly status: number; readonly code: string;
  constructor(status: number, code: string, message: string) { super(message);this.status=status;this.code=code; }
}
const fail=(code:string,message:string):never=>{throw new PaymentLedgerError(409,code,message);};
type LedgerAccount='wallet'|'external-clearing'|'merchant-clearing';
type Posting={account:LedgerAccount;amountMinor:number};
export class PaymentLedger {
  readonly store: AccountDatabase;
  private sequence=0;
  private clock:()=>number;
  constructor(store:AccountDatabase, clock=()=>Date.now()) {
    this.store=store;this.clock=clock;
    if(store.db.isTransaction) throw new Error('Initialize the payment ledger before opening a business transaction.');
    const exists=store.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='payment_migrations'").get();
    if(exists) {
      const version=store.db.prepare('SELECT MAX(version) AS version FROM payment_migrations').get() as {version:number|null};
      if(version.version!==1) throw new Error('Unsupported payment journal schema version.');
      return;
    }
    const legacy=store.db.prepare("SELECT account_id,body FROM resources WHERE kind='wallet' AND id='current'").all();
    if(legacy.length && store.path!==':memory:') {
      const backup=store.path+'.before-ledger-v1.sqlite';
      if(!existsSync(backup)) store.db.prepare('VACUUM INTO ?').run(backup);
    }
    this.atomic(()=>{
      store.db.exec(`
        CREATE TABLE payment_migrations(version INTEGER PRIMARY KEY,applied_at TEXT NOT NULL);
        CREATE TABLE payment_journal_entries(
          id TEXT PRIMARY KEY,account_id TEXT NOT NULL REFERENCES accounts(id),kind TEXT NOT NULL CHECK(kind IN ('OPENING','TOPUP','PAYMENT','REFUND')),
          reference TEXT NOT NULL,wallet_delta INTEGER NOT NULL CHECK(typeof(wallet_delta)='integer' AND abs(wallet_delta)<=100000000),
          currency TEXT NOT NULL CHECK(currency='AED'),created_at TEXT NOT NULL,finalized INTEGER NOT NULL DEFAULT 0 CHECK(finalized IN (0,1)),UNIQUE(account_id,reference));
        CREATE TABLE payment_journal_postings(
          entry_id TEXT NOT NULL REFERENCES payment_journal_entries(id),line INTEGER NOT NULL CHECK(line IN (0,1)),
          ledger_account TEXT NOT NULL CHECK(ledger_account IN ('wallet','external-clearing','merchant-clearing')),
          amount_minor INTEGER NOT NULL CHECK(typeof(amount_minor)='integer' AND abs(amount_minor)<=100000000),PRIMARY KEY(entry_id,line));
        CREATE TABLE payment_wallet_holds(
          account_id TEXT NOT NULL REFERENCES accounts(id),reference TEXT NOT NULL,amount_minor INTEGER NOT NULL CHECK(typeof(amount_minor)='integer' AND amount_minor BETWEEN 1 AND 100000000),
          status TEXT NOT NULL CHECK(status IN ('ACTIVE','VOIDED','EXPIRED')),expires_at INTEGER NOT NULL,created_at TEXT NOT NULL,PRIMARY KEY(account_id,reference));
        CREATE INDEX journal_account ON payment_journal_entries(account_id);
        CREATE INDEX hold_account ON payment_wallet_holds(account_id,status);
        CREATE TRIGGER journal_insert_unsealed BEFORE INSERT ON payment_journal_entries WHEN NEW.finalized<>0 BEGIN SELECT RAISE(ABORT,'journal must start unsealed');END;
        CREATE TRIGGER journal_sealed_update BEFORE UPDATE ON payment_journal_entries WHEN OLD.finalized=1 BEGIN SELECT RAISE(ABORT,'sealed journal');END;
        CREATE TRIGGER journal_sealed_delete BEFORE DELETE ON payment_journal_entries WHEN OLD.finalized=1 BEGIN SELECT RAISE(ABORT,'sealed journal');END;
        CREATE TRIGGER postings_sealed_insert BEFORE INSERT ON payment_journal_postings WHEN (SELECT finalized FROM payment_journal_entries WHERE id=NEW.entry_id)=1 BEGIN SELECT RAISE(ABORT,'sealed journal');END;
        CREATE TRIGGER postings_no_update BEFORE UPDATE ON payment_journal_postings BEGIN SELECT RAISE(ABORT,'append only postings');END;
        CREATE TRIGGER postings_no_delete BEFORE DELETE ON payment_journal_postings BEGIN SELECT RAISE(ABORT,'append only postings');END;
        CREATE TRIGGER journal_finalize BEFORE UPDATE OF finalized ON payment_journal_entries WHEN NEW.finalized=1 BEGIN
          SELECT CASE WHEN (SELECT count(*) FROM payment_journal_postings WHERE entry_id=NEW.id)<>2
            OR (SELECT coalesce(sum(amount_minor),0) FROM payment_journal_postings WHERE entry_id=NEW.id)<>0
            OR (SELECT coalesce(sum(amount_minor),0) FROM payment_journal_postings WHERE entry_id=NEW.id AND ledger_account='wallet')<>NEW.wallet_delta
            THEN RAISE(ABORT,'unbalanced journal') END;
        END;
      `);
      for(const row of legacy) this.initializeAccount(String(row.account_id));
      store.db.prepare('INSERT INTO payment_migrations VALUES(1,?)').run(new Date(this.clock()).toISOString());
    });
  }
  private atomic<T>(fn:()=>T):T {
    if(!this.store.db.isTransaction) return this.store.transaction(fn);
    const name=`payment_ledger_${++this.sequence}`;
    this.store.db.exec(`SAVEPOINT ${name}`);
    try {const result=fn();this.store.db.exec(`RELEASE ${name}`);return result;}
    catch(e){this.store.db.exec(`ROLLBACK TO ${name}`);this.store.db.exec(`RELEASE ${name}`);throw e;}
  }
  private amount(value:number,zero=false) {
    if(!Number.isSafeInteger(value)||value<(zero?0:1)||value>MAX_PAYMENT_MINOR) fail('INVALID_LEDGER_AMOUNT','Invalid bounded integer AED amount.');
  }
  private wallet(accountId:string):{balanceMinor:number;currency:'AED'} {
    const wallet=this.store.get<{balanceMinor:number;currency:'AED'}>(accountId,'wallet');
    if(!wallet||wallet.currency!=='AED') return fail('INVALID_WALLET','A valid account-owned AED wallet is required.');
    this.amount(wallet.balanceMinor,true);return wallet;
  }
  private append(accountId:string,kind:string,reference:string,postings:Posting[]) {
    if(!reference||reference.length>250||postings.length!==2||postings[0].amountMinor+postings[1].amountMinor!==0) fail('INVALID_JOURNAL','The journal requires two balanced postings.');
    const walletDelta=postings.filter(p=>p.account==='wallet').reduce((sum,p)=>sum+p.amountMinor,0);
    for(const p of postings)this.amount(Math.abs(p.amountMinor),kind==='OPENING');
    const existing=this.store.db.prepare('SELECT kind,wallet_delta FROM payment_journal_entries WHERE account_id=? AND reference=?').get(accountId,reference);
    if(existing) fail('DUPLICATE_LEDGER_EFFECT','This effect already has a journal entry. Reconcile its original operation.');
    const id=`journal_${randomUUID()}`;
    this.store.db.prepare('INSERT INTO payment_journal_entries(id,account_id,kind,reference,wallet_delta,currency,created_at) VALUES(?,?,?,?,?,?,?)').run(id,accountId,kind,reference,walletDelta,'AED',new Date(this.clock()).toISOString());
    const insert=this.store.db.prepare('INSERT INTO payment_journal_postings VALUES(?,?,?,?)');
    postings.forEach((p,line)=>insert.run(id,line,p.account,p.amountMinor));
    this.store.db.prepare('UPDATE payment_journal_entries SET finalized=1 WHERE id=?').run(id);
    return id;
  }
  initializeAccount(accountId:string) {
    return this.atomic(()=>{
      if(this.store.db.prepare("SELECT id FROM payment_journal_entries WHERE account_id=? AND reference='opening'").get(accountId))return;
      const wallet=this.wallet(accountId);
      this.append(accountId,'OPENING','opening',[{account:'wallet',amountMinor:wallet.balanceMinor},{account:'external-clearing',amountMinor:-wallet.balanceMinor}]);
    });
  }
  private posted(accountId:string) {
    const value=this.store.db.prepare("SELECT coalesce(sum(p.amount_minor),0) AS amount FROM payment_journal_postings p JOIN payment_journal_entries e ON p.entry_id=e.id WHERE e.account_id=? AND e.finalized=1 AND p.ledger_account='wallet'").get(accountId) as {amount:number};
    this.amount(value.amount,true);return value.amount;
  }
  summary(accountId:string) {
    return this.atomic(()=>{
      this.initializeAccount(accountId);const wallet=this.wallet(accountId),balanceMinor=this.posted(accountId);
      if(balanceMinor!==wallet.balanceMinor) fail('WALLET_PROJECTION_MISMATCH','The wallet projection requires reconciliation.');
      this.store.db.prepare("UPDATE payment_wallet_holds SET status='EXPIRED' WHERE account_id=? AND status='ACTIVE' AND expires_at<=?").run(accountId,this.clock());
      const value=this.store.db.prepare("SELECT coalesce(sum(amount_minor),0) AS amount FROM payment_wallet_holds WHERE account_id=? AND status='ACTIVE'").get(accountId) as {amount:number};
      this.amount(value.amount,true);
      if(value.amount>balanceMinor) fail('HOLDS_EXCEED_FUNDS','Wallet holds require reconciliation.');
      return {balanceMinor,heldMinor:value.amount,availableMinor:balanceMinor-value.amount,currency:'AED' as const};
    });
  }
  record(accountId:string,kind:'TOPUP'|'PAYMENT'|'REFUND',reference:string,amountMinor:number,source:'wallet'|'external') {
    return this.atomic(()=>{
      this.amount(amountMinor);
      if(kind==='TOPUP'&&source!=='external')fail('WALLET_SELF_FUNDING','A wallet cannot fund its own top-up.');
      const before=this.summary(accountId);
      const walletDelta=kind==='TOPUP'||kind==='REFUND'&&source==='wallet'?amountMinor:kind==='PAYMENT'&&source==='wallet'?-amountMinor:0;
      if(walletDelta<0&&before.availableMinor<amountMinor) fail('INSUFFICIENT_AVAILABLE_FUNDS','Active holds leave insufficient available wallet funds.');
      const next=before.balanceMinor+walletDelta;this.amount(next,true);
      const debit:LedgerAccount=kind==='TOPUP'?'external-clearing':kind==='PAYMENT'?(source==='wallet'?'wallet':'external-clearing'):'merchant-clearing';
      const credit:LedgerAccount=kind==='TOPUP'?'wallet':kind==='PAYMENT'?'merchant-clearing':source==='wallet'?'wallet':'external-clearing';
      const id=this.append(accountId,kind,reference,[{account:debit,amountMinor:-amountMinor},{account:credit,amountMinor}]);
      this.store.put(accountId,'wallet',{...this.wallet(accountId),balanceMinor:next});
      return {id,...this.summary(accountId)};
    });
  }
  reserve(accountId:string,reference:string,amountMinor:number,expiresAt:number) {
    return this.atomic(()=>{
      this.amount(amountMinor);
      if(!reference||reference.length>200||!Number.isSafeInteger(expiresAt))fail('INVALID_HOLD','A hold requires a valid reference and finite expiry.');
      const existing=this.store.db.prepare('SELECT amount_minor,expires_at,status FROM payment_wallet_holds WHERE account_id=? AND reference=?').get(accountId,reference) as {amount_minor:number;expires_at:number;status:string}|undefined;
      if(existing) {
        if(existing.amount_minor!==amountMinor||existing.expires_at!==expiresAt)fail('HOLD_CONFLICT','This hold reference has another payload.');
        return this.summary(accountId);
      }
      if(expiresAt<=this.clock()||expiresAt>this.clock()+3600000)fail('INVALID_HOLD','A new hold requires an expiry within one hour.');
      if(this.summary(accountId).availableMinor<amountMinor)fail('INSUFFICIENT_AVAILABLE_FUNDS','Insufficient available wallet funds.');
      this.store.db.prepare('INSERT INTO payment_wallet_holds VALUES(?,?,?,?,?,?)').run(accountId,reference,amountMinor,'ACTIVE',expiresAt,new Date(this.clock()).toISOString());
      return this.summary(accountId);
    });
  }
  voidHold(accountId:string,reference:string) {
    return this.atomic(()=>{
      if(!this.store.db.prepare('SELECT reference FROM payment_wallet_holds WHERE account_id=? AND reference=?').get(accountId,reference))fail('HOLD_NOT_FOUND','Hold not found for this account.');
      this.store.db.prepare("UPDATE payment_wallet_holds SET status='VOIDED' WHERE account_id=? AND reference=? AND status='ACTIVE'").run(accountId,reference);return this.summary(accountId);
    });
  }
}
