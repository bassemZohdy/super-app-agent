/** Run-scoped automatic execution preparation (AUTO-03 first checkpoint).
 *  Only explicitly isolated server instances install this capability. Preparation resolves the
 *  exact server-owned quote, reserves shared budget/count/cooldown/occurrence authority in one
 *  transaction and creates an immutable execution record. It issues no credential, creates no
 *  payment order and moves no funds; admission and effects remain later AUTO-03 checkpoints. */
import { realpathSync } from 'node:fs';
import { relative,isAbsolute } from 'node:path';
import { createHash,randomUUID } from 'node:crypto';
import type { AccountDatabase } from './database.ts';
import type { PaymentOrders } from './payment-orders.ts';
import type { WalletFunding } from './wallet-funding.ts';
import type { ProviderRecharges } from './recharges.ts';
import { PayableError } from './payables.ts';
import { WALLET_FUNDING_LIMITS } from '../../../packages/protocol-core/src/payments.ts';
import type { Actor } from '../../../packages/backend-kit/src/context.ts';
import type { Payable } from '../../../packages/protocol-core/src/payments.ts';
import type { PaymentMandate } from '../../../packages/protocol-core/src/payment-mandates.ts';
import { paymentObject } from '../../../packages/protocol-core/src/payments.ts';
import { automationOperation } from '../../../packages/protocol-core/src/automation-operation.ts';

export type AutomationRunContext={runId:string;operatorSub:string;workerSub:string;root:string};
export type AutomationRunIo={
  /** Server-owned payable lookup for the mandate's provider; caller-supplied quotes are never accepted. */
  readPayables:(accountId:string,provider:string)=>Payable[];
  /** The isolated provider store that owns the payable, for the shared exclusion claim. */
  providerStore:(provider:string)=>AccountDatabase;
  /** Consumes the owner's one-shot skip-next consent marker before preparing. */
  consumeMandateSkip?:(mandateId:string)=>boolean;
  /** Current wallet balance in integer fils, for the scheduler's threshold read. */
  walletBalanceMinor?:(accountId:string)=>number;
  /** The source provider's recharge book (tolls and prepaid), for exact-target balance reads and on-demand recharge quotes. */
  recharges?:(provider:string)=>ProviderRecharges|undefined;
};
export type AutomationPreparation={
  id:string;runId:string;accountId:string;mandateId:string;policyVersion:number;occurrenceKey:string;
  state:'PREPARED';provider:string;payableId:string;payableRevision:string;amountMinor:number;currency:'AED';
  sourceId:string;sourceVersion:number;purpose:string;boundDigest:string;periodKey:string;orderId?:string;kind?:'BILL_PAYMENT'|'WALLET_RELOAD'|'RECHARGE';
  reservedPeriodMinor:number;reservedPeriodCount:number;reservedLifetimeMinor:number;reservedLifetimeCount:number;
  preparedAt:string;admissionExpiresAt:string;
};
export type AutomationSkip={mandateId:string;occurrenceKey:string;skipped:true;reason:string};
export type AutomationExecutionView={id:string;accountId:string;mandateId:string;policyVersion:number;occurrenceKey:string;state:'PREPARED';provider:string;payableId:string;amountMinor:number;sourceId:string;preparedAt:string;admissionExpiresAt:string;boundDigest:string};

export class AutomationRunError extends Error{readonly status:number;readonly code:string;
  constructor(status:number,code:string,message:string){super(message);this.status=status;this.code=code;}}
const deny=(code:string,message:string,status=409):never=>{throw new AutomationRunError(status,code,message);};

const automationId={type:'string',minLength:1,maxLength:160,pattern:'^[A-Za-z0-9][A-Za-z0-9_.:-]*$'};
export const automationRunSchemas={
  prepare:paymentObject({mandateId:automationId,occurrenceKey:automationId,requestKey:{type:'string',pattern:'^[A-Za-z0-9_-]{8,100}$',minLength:8,maxLength:100}},
    ['mandateId','occurrenceKey','requestKey']),
};

const CLAIMS_DDL=`CREATE TABLE IF NOT EXISTS automation_payable_claims(account_id TEXT NOT NULL,payable_key TEXT NOT NULL,execution_id TEXT NOT NULL,PRIMARY KEY(account_id,payable_key));`;
const ADMISSION_WINDOW_MS=600000;

/** Shared human/worker obligation exclusion, claimed on the provider store that owns the payable. */
export function claimAutomationPayable(store:AccountDatabase,accountId:string,payableKey:string,executionId:string):'CLAIMED'|'HELD_MANUAL'|'HELD_AUTOMATION'{
  return store.transaction(()=>{
    store.db.exec(CLAIMS_DDL);
    if(store.db.prepare("SELECT id FROM provider_payable_admissions WHERE account_id=? AND payable_id=? AND state IN ('PREPARED','ADMITTED','APPLIED')").get(accountId,payableKey))return 'HELD_MANUAL';
    const existing=store.db.prepare('SELECT execution_id FROM automation_payable_claims WHERE account_id=? AND payable_key=?').get(accountId,payableKey);
    if(existing)return String(existing!.execution_id)===executionId?'CLAIMED':'HELD_AUTOMATION';
    store.db.prepare('INSERT INTO automation_payable_claims VALUES(?,?,?)').run(accountId,payableKey,executionId);
    return 'CLAIMED';
  });
}
export function releaseAutomationPayable(store:AccountDatabase,executionId:string){
  store.db.exec(CLAIMS_DDL);
  store.db.prepare('DELETE FROM automation_payable_claims WHERE execution_id=?').run(executionId);
}

export class AutomationRuns{
  readonly store:AccountDatabase;readonly context:AutomationRunContext;readonly io:AutomationRunIo;
  constructor(store:AccountDatabase,context:AutomationRunContext,io:AutomationRunIo){
    if(process.env.NODE_ENV==='production')throw new Error('Automatic execution preparation is demo-only.');
    if(!/^autorn_[a-f0-9-]{36}$/.test(context.runId)||!context.operatorSub||!context.workerSub||
      context.workerSub===context.operatorSub||context.operatorSub.length>200||context.workerSub.length>200||
      store.path===':memory:')throw new Error('Automation runs require a persisted isolated run and distinct operator and workload identities.');
    if(!io||typeof io.readPayables!=='function'||typeof io.providerStore!=='function')throw new Error('Automation runs require a server-owned payable lookup and provider store; caller-supplied quotes are not accepted.');
    const root=realpathSync(context.root),path=realpathSync(store.path),inside=relative(root,path);
    if(inside!=='payments.sqlite'||inside.startsWith('..')||isAbsolute(inside)||!/(^|[/\\])cityside-auto-[A-Za-z0-9_-]+$/.test(root))throw new Error('Automation run database must be within its dedicated isolated run directory.');
    this.store=store;this.context={...context,root};this.io=io;
    store.transaction(()=>{
      const registered=store.db.prepare("SELECT name FROM sqlite_master WHERE name='automation_runs'").get();
      const prior=registered?store.db.prepare('SELECT run_id,operator_sub,worker_sub,root FROM automation_runs WHERE id=1').get():undefined;
      if(prior&&(prior.run_id!==context.runId||prior.operator_sub!==context.operatorSub||prior.worker_sub!==context.workerSub||prior.root!==root))throw new Error('Automation run identity cannot be rebound.');
      if(!prior&&['accounts','resources','idempotency'].some(table=>Number(store.db.prepare(`SELECT count(*) n FROM ${table}`).get()!.n)>0))throw new Error('A new automation run requires a pristine database; normal/copied financial data cannot be armed.');
      store.db.exec(`CREATE TABLE IF NOT EXISTS automation_runs(id INTEGER PRIMARY KEY CHECK(id=1),run_id TEXT NOT NULL,operator_sub TEXT NOT NULL,worker_sub TEXT NOT NULL,root TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS automation_executions(id TEXT PRIMARY KEY,account_id TEXT NOT NULL REFERENCES accounts(id),mandate_id TEXT NOT NULL,state TEXT NOT NULL CHECK(state='PREPARED'),body TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS automation_occurrences(mandate_id TEXT NOT NULL,occurrence_key TEXT NOT NULL,execution_id TEXT NOT NULL REFERENCES automation_executions(id),PRIMARY KEY(mandate_id,occurrence_key));
        CREATE TABLE IF NOT EXISTS automation_payable_claims(account_id TEXT NOT NULL,payable_key TEXT NOT NULL,execution_id TEXT NOT NULL REFERENCES automation_executions(id),PRIMARY KEY(account_id,payable_key));
        CREATE TABLE IF NOT EXISTS automation_dispatch(execution_id TEXT PRIMARY KEY REFERENCES automation_executions(id),state TEXT NOT NULL CHECK(state IN ('ADMITTED','REJECTED')),permit_owner TEXT NOT NULL,at TEXT NOT NULL,reason TEXT);
        CREATE TABLE IF NOT EXISTS automation_released(execution_id TEXT PRIMARY KEY REFERENCES automation_executions(id),reason TEXT NOT NULL,at TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS automation_audit(id INTEGER PRIMARY KEY,body TEXT NOT NULL);
        CREATE TRIGGER IF NOT EXISTS automation_audit_no_update BEFORE UPDATE ON automation_audit BEGIN SELECT RAISE(ABORT,'Automation audit is immutable');END;
        CREATE TRIGGER IF NOT EXISTS automation_audit_no_delete BEFORE DELETE ON automation_audit BEGIN SELECT RAISE(ABORT,'Automation audit is immutable');END;
        CREATE TABLE IF NOT EXISTS automation_requests(key TEXT PRIMARY KEY,fingerprint TEXT NOT NULL,body TEXT NOT NULL);`);
      if(!prior)store.db.prepare('INSERT INTO automation_runs VALUES(1,?,?,?,?)').run(context.runId,context.operatorSub,context.workerSub,root);
    });
  }
  private orders?:PaymentOrders;private funding?:WalletFunding;
  /** The gateway order stores, bound once by the engine after they exist; preparation cannot run without them. */
  attachOrders(orders:PaymentOrders,funding?:WalletFunding){this.orders=orders;this.funding=funding;}
  /** An execution of this rule whose order has not reached a final state and has not been released. */
  private activeExecution(mandateId:string):boolean{
    if(!this.orders||!this.funding)return false;
    const live=['AWAITING_APPROVAL','AUTHORIZATION_PENDING','REQUIRES_ACTION','AUTHORIZED','CAPTURING','CAPTURED','RECONCILIATION_REQUIRED'];
    for(const row of this.store.db.prepare('SELECT id,account_id,body FROM automation_executions WHERE mandate_id=? AND id NOT IN (SELECT execution_id FROM automation_released)').all(mandateId)){
      const p=JSON.parse(String(row.body)) as AutomationPreparation;if(!p.orderId)continue;
      const owner=this.store.db.prepare('SELECT owner FROM accounts WHERE id=?').get(p.accountId);if(!owner)continue;
      const actor:Actor={sub:String(owner.owner),username:String(owner.owner),name:'Automation owner',accountId:p.accountId,requestId:''};
      const order=p.kind==='WALLET_RELOAD'?this.funding.get(actor,p.orderId):this.orders.get(actor,p.orderId);
      if(live.includes(order.state))return true;
    }
    return false;
  }
  /** Finite reload: the configured amount, never past the target balance. */
  private reloadAmount(t:{reloadMinor:number;targetBalanceMinor:number},balance:number){return Math.max(0,Math.min(t.reloadMinor,t.targetBalanceMinor-balance,WALLET_FUNDING_LIMITS.maxMinor));}
  private worker(subject:string){if(subject!==this.context.workerSub)deny('AUTOMATION_WORKER_REQUIRED','Preparation belongs to this run\'s exact workload identity.',403);}
  private operator(subject:string){if(subject!==this.context.operatorSub)deny('AUTOMATION_OPERATOR_REQUIRED','This isolated run belongs to another operator.',403);}
  private mandate(mandateId:string):{m:PaymentMandate;accountId:string}{
    const row=this.store.db.prepare('SELECT account_id FROM payment_mandates WHERE id=?').get(mandateId);
    if(!row)return deny('AUTOMATION_MANDATE_NOT_FOUND','No such mandate exists in this run.',404);
    const accountId=String(row!.account_id);
    const body=this.store.db.prepare('SELECT v.body FROM payment_mandates m JOIN payment_mandate_versions v ON v.id=m.id AND v.version=m.version WHERE m.id=?').get(mandateId);
    if(!body)return deny('AUTOMATION_MANDATE_NOT_FOUND','No such mandate exists in this run.',404);
    return {m:JSON.parse(String(body!.body)) as PaymentMandate,accountId};
  }
  private periodKey(m:PaymentMandate,at:number):string{
    const options:Intl.DateTimeFormatOptions={timeZone:m.policy.timezone,year:'numeric',month:'2-digit'};
    if(m.policy.limits.period==='DAY')options.day='2-digit';
    return `${m.policy.limits.period}:${new Intl.DateTimeFormat('en-CA',options).format(new Date(at))}`;
  }
  private eligibleInvoices(m:PaymentMandate,accountId:string):Payable[]{
    const target=m.policy.target;
    if(target.kind!=='BILLER')return [];
    const now=Date.now(),horizon=new Date(now+(m.policy.trigger.type==='INVOICE_DUE'?m.policy.trigger.daysBefore:0)*86400000).toISOString().slice(0,10);
    const claimed=new Set(this.store.db.prepare('SELECT payable_key FROM automation_payable_claims WHERE account_id=?').all(accountId).map(r=>String(r!.payable_key)));
    return this.io.readPayables(accountId,target.provider)
      .filter(p=>p.reference===target.reference&&p.status==='UNPAID'&&typeof p.dueDate==='string'&&p.dueDate<=horizon&&!claimed.has(p.id))
      .sort((a,b)=>String(a.dueDate).localeCompare(String(b.dueDate))||a.id.localeCompare(b.id));
  }
  /** Resolve the exact server-owned due invoice and reserve shared authority in one transaction. */
  prepare(subject:string,input:{mandateId:string;occurrenceKey:string;requestKey:string}):AutomationPreparation|AutomationSkip{
    this.worker(subject);
    this.sweepExpired();
    if(!/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,100}$/.test(input.occurrenceKey))return deny('AUTOMATION_INPUT_INVALID','Use a bounded explicit occurrence key.',400);
    const fingerprint=createHash('sha256').update(JSON.stringify(['preparation',input])).digest('hex');
    return this.store.transaction(()=>{
      const prior=this.store.db.prepare('SELECT fingerprint,body FROM automation_requests WHERE key=?').get(input.requestKey);
      if(prior){if(prior.fingerprint!==fingerprint)return deny('AUTOMATION_REQUEST_CONFLICT','This workload request key already has different terms.');
        return JSON.parse(String(prior.body)) as AutomationPreparation|AutomationSkip;}
      const {m,accountId}=this.mandate(input.mandateId),now=Date.now();
      const record=<T extends AutomationPreparation|AutomationSkip>(body:T):T=>{this.store.db.prepare('INSERT OR IGNORE INTO automation_requests VALUES(?,?,?)').run(input.requestKey,fingerprint,JSON.stringify(body));return body;};
      const skip=(reason:string):AutomationSkip=>{
        const result=record({mandateId:m.id,occurrenceKey:input.occurrenceKey,skipped:true,reason});
        this.store.db.prepare('INSERT INTO automation_audit(body) VALUES(?)').run(JSON.stringify({at:new Date(now).toISOString(),runId:this.context.runId,workerSub:subject,mandateId:m.id,occurrenceKey:input.occurrenceKey,event:'SKIPPED',reason}));
        return result;
      };
      if(m.state!=='APPROVED')return skip('MANDATE_NOT_ACTIVE');
      if(m.skipNext&&this.io.consumeMandateSkip?.(m.id))return skip('OPERATOR_SKIP_NEXT');
      if(Date.parse(m.policy.startsAt)>now||Date.parse(m.policy.expiresAt)<=now)return skip('MANDATE_WINDOW_CLOSED');
      const eligibility=this.store.eligibility?.snapshot(accountId);
      if(!eligibility||!eligibility.active||eligibility.epoch!==(m.eligibilityEpoch||'1:1'))return skip('AUTHORITY_CHANGED');
      const policy=m.policy;
      const reload=policy.operation==='WALLET_RELOAD'&&policy.target.kind==='WALLET'&&policy.trigger.type==='LOW_BALANCE';
      const bill=policy.operation==='BILL_PAYMENT'&&policy.target.kind==='BILLER'&&['dewa','etisalat','du'].includes(policy.target.provider)&&policy.trigger.type==='INVOICE_DUE';
      const fine=policy.operation==='FINE_PAYMENT'&&policy.target.kind==='BILLER'&&policy.target.provider==='police'&&policy.trigger.type==='NEW_FINE'&&Array.isArray(policy.fineTypes);
      const recharge=policy.operation==='RECHARGE'&&policy.target.kind==='BILLER'&&['rta','etisalat','du'].includes(policy.target.provider)&&policy.trigger.type==='LOW_BALANCE';
      if(!reload&&!bill&&!recharge&&!fine)
        return deny('AUTOMATION_UNSUPPORTED','This checkpoint prepares due DEWA/Etisalat/du invoices, low-balance wallet reloads, low-balance toll or prepaid recharges and approved fines only; other operations fail closed until their own tasks.',409);
      const source=policy.sources[0],current=source.methodId==='wallet'
        ?{id:'wallet',kind:'wallet' as const,status:'ACTIVE' as const,version:1}
        :this.store.get<{id:string;status:string;version:number;kind:string;expiresMonth?:number;expiresYear?:number}>(accountId,'payment-method',source.methodId);
      if(!current||current.status!=='ACTIVE'||current.version!==source.expectedVersion)return skip('SOURCE_CHANGED');
      if(current.kind==='card'&&current.expiresYear!==undefined&&current.expiresMonth!==undefined){
        const date=new Date(now);
        if(current.expiresYear<date.getUTCFullYear()||current.expiresYear===date.getUTCFullYear()&&current.expiresMonth<date.getUTCMonth()+1)return skip('SOURCE_EXPIRED');
      }
      const existing=this.store.db.prepare('SELECT execution_id FROM automation_occurrences WHERE mandate_id=? AND occurrence_key=?').get(m.id,input.occurrenceKey);
      if(existing&&this.released(String(existing!.execution_id)))return deny('AUTOMATION_OCCURRENCE_RELEASED','This occurrence already failed definitively and released its reservation; it is not retried with a fresh identity.');
      if(existing){const stored=this.store.db.prepare('SELECT body FROM automation_executions WHERE id=?').get(String(existing!.execution_id));
        if(!stored)return deny('AUTOMATION_OCCURRENCE_CONFLICT','The recorded occurrence has no execution.');return record(JSON.parse(String(stored!.body)) as AutomationPreparation);}
      // What this occurrence would move: one invoice, or one finite wallet reload. Either way it is a single reserved item.
      let item:{provider:string;id:string;revision:string;amountMinor:number};
      if(reload){
        const trigger=policy.trigger as Extract<typeof policy.trigger,{type:'LOW_BALANCE'}>;
        if(current.kind!=='card')return skip('SOURCE_NOT_A_CARD');
        if(!this.io.walletBalanceMinor)return deny('AUTOMATION_BALANCE_UNAVAILABLE','This run exposes no wallet balance.',503);
        const balance=this.io.walletBalanceMinor(accountId);
        if(balance>=trigger.belowMinor)return skip('BALANCE_ABOVE_THRESHOLD');
        const amount=this.reloadAmount(trigger,balance);
        if(amount<WALLET_FUNDING_LIMITS.minMinor)return skip('NOTHING_TO_RELOAD');
        if(amount>policy.limits.perPaymentMinor)return skip('OVER_PER_PAYMENT_CAP');
        if(balance+amount>WALLET_FUNDING_LIMITS.balanceMaxMinor)return skip('WALLET_BALANCE_LIMIT');
        item={provider:'wallet',id:`wallet-reload:${m.id}:${input.occurrenceKey}`,revision:createHash('sha256').update(JSON.stringify(['wallet-reload',accountId,m.id,input.occurrenceKey,amount])).digest('hex'),amountMinor:amount};
      }else if(fine){
        // One occurrence per fine: `FINE:<fine id>`. Every restriction is read from the current record, never from the event that announced it.
        const target=policy.target as Extract<typeof policy.target,{kind:'BILLER'}>,named=/^FINE:([A-Za-z0-9][A-Za-z0-9_.:-]{0,100})$/.exec(input.occurrenceKey);
        if(!named)return deny('AUTOMATION_OCCURRENCE_INVALID','A fine rule runs once per fine: use FINE:<fine id> as the occurrence.',400);
        const payable=this.io.readPayables(accountId,'police').find(p=>p.obligationId===named[1]);
        if(!payable||payable.reference!==target.reference)return skip('FINE_NOT_FOUND');
        if(payable.status!=='UNPAID')return skip('FINE_NOT_PAYABLE');
        if(payable.paymentRestricted)return skip('FINE_REQUIRES_REVIEW');
        if(!policy.fineTypes!.includes(String(payable.violation)))return skip('FINE_TYPE_NOT_APPROVED');
        if(payable.amountMinor>policy.limits.perPaymentMinor)return skip('OVER_PER_PAYMENT_CAP');
        if(this.store.db.prepare("SELECT order_id FROM payment_order_obligations WHERE account_id=? AND provider=? AND state IN ('RESERVED','COMMITTED') AND json_extract(body,'$.resourceId') IN (?,?) LIMIT 1").get(accountId,payable.provider,payable.id,String(payable.obligationId??payable.id)))
          return deny('AUTOMATION_PAYABLE_RESERVED','This obligation is reserved by an original payment review. Inspect that order first.');
        item={provider:payable.provider,id:payable.id,revision:payable.revision,amountMinor:payable.amountMinor};
      }else if(recharge){
        const trigger=policy.trigger as Extract<typeof policy.trigger,{type:'LOW_BALANCE'}>,target=policy.target as Extract<typeof policy.target,{kind:'BILLER'}>;
        const book=this.io.recharges?.(target.provider);
        if(!book)return deny('AUTOMATION_RECHARGE_UNAVAILABLE','This run exposes no recharge book for the target provider.',503);
        // Only the exact approved tag or number is read; another target or provider can never trigger this rule.
        const found=book.targets(accountId).find(x=>x.reference===target.reference);
        if(!found||found.status!=='ACTIVE')return skip('TARGET_UNAVAILABLE');
        if(found.balanceMinor>=trigger.belowMinor)return skip('BALANCE_ABOVE_THRESHOLD');
        if(!found.denominationsMinor.includes(trigger.reloadMinor))return skip('DENOMINATION_UNAVAILABLE');
        if(found.balanceMinor+trigger.reloadMinor>trigger.targetBalanceMinor)return skip('WOULD_EXCEED_TARGET_BALANCE');
        if(trigger.reloadMinor>policy.limits.perPaymentMinor)return skip('OVER_PER_PAYMENT_CAP');
        if(this.activeExecution(m.id))return deny('AUTOMATION_RECHARGE_IN_PROGRESS','An earlier recharge for this rule has not finished or been released. Inspect it first.');
        // The quote is created after the budget checks below; this placeholder carries only the amount until then.
        item={provider:target.provider,id:'',revision:'',amountMinor:trigger.reloadMinor};
      }else{
        const due=this.eligibleInvoices(m,accountId);
        if(!due.length)return skip('NO_DUE_INVOICE');
        // The earliest-due invoice within the per-payment cap; an invoice above it is skipped, never lowered, and does not hold up the ones behind it.
        const payable=due.find(p=>p.amountMinor<=policy.limits.perPaymentMinor);
        if(!payable)return skip('OVER_PER_PAYMENT_CAP');
        if(this.store.db.prepare("SELECT order_id FROM payment_order_obligations WHERE account_id=? AND provider=? AND state IN ('RESERVED','COMMITTED') AND json_extract(body,'$.resourceId') IN (?,?) LIMIT 1").get(accountId,payable.provider,payable.id,String(payable.obligationId??payable.id)))
          return deny('AUTOMATION_PAYABLE_RESERVED','This obligation is reserved by an original payment review. Inspect that order first.');
        item={provider:payable.provider,id:payable.id,revision:payable.revision,amountMinor:payable.amountMinor};
      }
      const last=this.store.db.prepare('SELECT body FROM automation_executions WHERE mandate_id=? ORDER BY rowid DESC LIMIT 1').get(m.id);
      if(last&&now-Date.parse((JSON.parse(String(last!.body)) as AutomationPreparation).preparedAt)<policy.limits.cooldownSeconds*1000)
        return deny('AUTOMATION_COOLDOWN','The mandate cooldown between preparations has not elapsed.');
      const key=this.periodKey(m,now),rows=this.store.db.prepare('SELECT body FROM automation_executions WHERE mandate_id=? AND id NOT IN (SELECT execution_id FROM automation_released)').all(m.id).map(r=>JSON.parse(String(r.body)) as AutomationPreparation);
      const inPeriod=rows.filter(r=>r.periodKey===key),reservedPeriodMinor=inPeriod.reduce((n,r)=>n+r.amountMinor,0),reservedPeriodCount=inPeriod.length;
      const reservedLifetimeMinor=rows.reduce((n,r)=>n+r.amountMinor,0),reservedLifetimeCount=rows.length;
      if(reservedPeriodMinor+item.amountMinor>policy.limits.periodMinor||reservedPeriodCount+1>policy.limits.perPeriodCount)return skip('OVER_PERIOD_BUDGET');
      if(reservedLifetimeMinor+item.amountMinor>policy.limits.lifetimeMinor||reservedLifetimeCount+1>policy.limits.lifetimeCount)return skip('OVER_LIFETIME_BUDGET');
      let quoted:Payable|undefined;
      if(recharge){
        const target=policy.target as Extract<typeof policy.target,{kind:'BILLER'}>,found=this.io.recharges!(target.provider)!.targets(accountId).find(x=>x.reference===target.reference)!;
        try{quoted=this.io.recharges!(target.provider)!.quote(accountId,{targetReference:target.reference,amountMinor:item.amountMinor,expectedTargetVersion:found.version,intentId:`auto-${randomUUID()}`});}
        catch(error){if(error instanceof PayableError)return skip(error.code);throw error;}
        item={provider:target.provider,id:quoted.id,revision:quoted.revision,amountMinor:quoted.amountMinor};
      }
      const providerStore=reload?undefined:this.io.providerStore(policy.target.kind==='BILLER'?policy.target.provider:'');
      const preparation:AutomationPreparation={id:`autoexec_${randomUUID()}`,runId:this.context.runId,accountId,mandateId:m.id,policyVersion:m.policyVersion,
        occurrenceKey:input.occurrenceKey,state:'PREPARED',kind:reload?'WALLET_RELOAD':recharge?'RECHARGE':'BILL_PAYMENT',provider:item.provider,payableId:item.id,payableRevision:item.revision,
        amountMinor:item.amountMinor,currency:'AED',sourceId:current.id,sourceVersion:current.version,purpose:policy.purpose,
        boundDigest:createHash('sha256').update(JSON.stringify({mandateId:m.id,policyVersion:m.policyVersion,occurrenceKey:input.occurrenceKey,payableId:item.id,payableRevision:item.revision,amountMinor:item.amountMinor,sourceId:current.id,sourceVersion:current.version,purpose:policy.purpose})).digest('hex'),
        periodKey:key,reservedPeriodMinor:reservedPeriodMinor+item.amountMinor,reservedPeriodCount:reservedPeriodCount+1,
        reservedLifetimeMinor:reservedLifetimeMinor+item.amountMinor,reservedLifetimeCount:reservedLifetimeCount+1,
        preparedAt:new Date(now).toISOString(),admissionExpiresAt:new Date(Math.min(now+ADMISSION_WINDOW_MS,quoted?.expiresAt?Date.parse(quoted.expiresAt)-5000:Infinity)).toISOString()};
      // The provider-side claim runs first; a gateway failure releases it so no claim outlives its execution. A reload has no provider obligation to claim.
      if(providerStore&&claimAutomationPayable(providerStore,accountId,item.id,preparation.id)!=='CLAIMED')
        return deny('AUTOMATION_PAYABLE_RESERVED','This payable is already reserved by another execution or order.');
      try{
        if(!this.orders||!this.funding)return deny('AUTOMATION_ORDERS_UNAVAILABLE','The gateway order store is not attached; nothing was prepared.',503);
        const owner=this.store.db.prepare('SELECT owner FROM accounts WHERE id=?').get(accountId);
        if(!owner)return deny('AUTOMATION_EXECUTION_NOT_FOUND','The prepared execution has no workspace owner.',404);
        const actor:Actor={sub:String(owner!.owner),username:String(owner!.owner),name:'Automation owner',accountId,requestId:''};
        const automation={executionId:preparation.id,mandateId:m.id,boundDigest:preparation.boundDigest};
        // The real gateway order is created inside the same transaction; ordinary APIs refuse to decide it.
        if(reload){
          const funding=this.funding.createAutomatic(actor,{amountMinor:item.amountMinor,methodId:current.id,expectedMethodVersion:current.version},automation);
          preparation.orderId=funding.id;
        }else{
          const payable=quoted??this.io.readPayables(accountId,item.provider).find(p=>p.id===item.id)!;
          const order=this.orders.createAutomatic(actor,{provider:payable.provider,payableId:payable.id,expectedPayableRevision:payable.revision,methodId:current.id,expectedMethodVersion:current.version},payable,automation);
          preparation.orderId=order.id;
        }
        this.store.db.prepare('INSERT INTO automation_executions VALUES(?,?,?,?,?)').run(preparation.id,accountId,m.id,preparation.state,JSON.stringify(preparation));
        this.store.db.prepare('INSERT INTO automation_occurrences VALUES(?,?,?)').run(m.id,input.occurrenceKey,preparation.id);
        if(!reload)this.store.db.prepare('INSERT INTO automation_payable_claims VALUES(?,?,?)').run(accountId,item.id,preparation.id);
        this.store.db.prepare('INSERT INTO automation_audit(body) VALUES(?)').run(JSON.stringify({at:preparation.preparedAt,runId:this.context.runId,workerSub:subject,mandateId:m.id,occurrenceKey:input.occurrenceKey,event:'PREPARED',payableId:item.id,amountMinor:item.amountMinor}));
        return record(preparation);
      }catch(error){if(providerStore)releaseAutomationPayable(providerStore,preparation.id);throw error;}
    });
  }
  /** The immutable preparation plus current authority freshness, for the credential broker. */
  readExecution(worker:string,executionId:string){
    if(worker!==this.context.workerSub)return deny('AUTOMATION_WORKER_REQUIRED',"Only this run's exact workload identity reads a prepared execution.",403);
    return this.view(executionId);
  }
  private view(executionId:string){
    if(this.released(executionId))return deny('AUTOMATION_EXECUTION_RELEASED','This execution failed definitively and released its reservation; no credential or admission remains.');
    const row=this.store.db.prepare('SELECT body,account_id,mandate_id FROM automation_executions WHERE id=?').get(executionId);
    if(!row)return deny('AUTOMATION_EXECUTION_NOT_FOUND','No such prepared execution exists in this run.',404);
    const preparation=JSON.parse(String(row!.body)) as AutomationPreparation;
    if(preparation.runId!==this.context.runId)return deny('AUTOMATION_EXECUTION_NOT_FOUND','No such prepared execution exists in this run.',404);
    const mandate=this.mandate(preparation.mandateId).m;
    const owner=this.store.db.prepare('SELECT owner FROM accounts WHERE id=?').get(preparation.accountId);
    if(!owner)return deny('AUTOMATION_EXECUTION_NOT_FOUND','The prepared execution has no workspace owner.',404);
    const source=mandate.policy.sources[0],current=source.methodId==='wallet'
      ?{status:'ACTIVE' as const,version:1}
      :this.store.get<{status:string;version:number}>(preparation.accountId,'payment-method',source.methodId);
    const biller=mandate.policy.target.kind==='BILLER'
      ?this.store.get<{status:string;version:number}>(preparation.accountId,'billing-account',mandate.policy.target.billingAccountId)
      :undefined;
    // A bill is current while it is the same unpaid revision; a reload is current while the balance is still below the threshold and would reload the same amount.
    const trigger=mandate.policy.trigger,payableCurrent=preparation.kind==='RECHARGE'
      ?(()=>{try{const q=this.io.recharges?.(preparation.provider)?.get(preparation.accountId,preparation.payableId);return !!q&&q.revision===preparation.payableRevision&&q.status==='UNPAID';}catch{return false;}})()
      :preparation.kind==='WALLET_RELOAD'
      ?trigger.type==='LOW_BALANCE'&&!!this.io.walletBalanceMinor&&this.io.walletBalanceMinor(preparation.accountId)<trigger.belowMinor&&this.reloadAmount(trigger,this.io.walletBalanceMinor(preparation.accountId))===preparation.amountMinor
      :this.io.readPayables(preparation.accountId,preparation.provider)
        .some(payable=>payable.id===preparation.payableId&&payable.revision===preparation.payableRevision&&payable.status==='UNPAID');
    return {executionId:preparation.id,runId:this.context.runId,accountId:preparation.accountId,ownerSub:String(owner!.owner),
      mandate:{id:mandate.id,state:mandate.state,policyVersion:mandate.policyVersion,skipNext:mandate.skipNext===true},
      source:{id:preparation.sourceId,version:preparation.sourceVersion,current:current?.status==='ACTIVE'&&current?.version===source.expectedVersion},
      biller:mandate.policy.target.kind==='BILLER'?{id:mandate.policy.target.billingAccountId,current:biller?.status==='ACTIVE'&&biller?.version===mandate.policy.target.expectedVersion}:undefined,
      payable:{id:preparation.payableId,revision:preparation.payableRevision,amountMinor:preparation.amountMinor,current:payableCurrent},
      boundDigest:preparation.boundDigest,preparedAt:preparation.preparedAt,admissionExpiresAt:preparation.admissionExpiresAt,
      expired:Date.now()>Date.parse(preparation.admissionExpiresAt)};
  }
  /** Reservations the preview counts against the current budget period; a read of the same rows preparation sums. */
  usage(mandateId:string,at:number){
    const {m}=this.mandate(mandateId),key=this.periodKey(m,at);
    const rows=this.store.db.prepare('SELECT body FROM automation_executions WHERE mandate_id=? AND id NOT IN (SELECT execution_id FROM automation_released) ORDER BY rowid').all(mandateId).map(r=>JSON.parse(String(r.body)) as AutomationPreparation);
    const inPeriod=rows.filter(r=>r.periodKey===key),last=this.store.db.prepare('SELECT body FROM automation_executions WHERE mandate_id=? ORDER BY rowid DESC LIMIT 1').get(mandateId);
    return {periodMinor:inPeriod.reduce((n,r)=>n+r.amountMinor,0),periodCount:inPeriod.length,lifetimeMinor:rows.reduce((n,r)=>n+r.amountMinor,0),lifetimeCount:rows.length,
      lastPreparedAt:last?Date.parse((JSON.parse(String(last.body)) as AutomationPreparation).preparedAt):undefined};
  }
  claimedPayables(accountId:string):Set<string>{
    return new Set(this.store.db.prepare('SELECT payable_key FROM automation_payable_claims WHERE account_id=?').all(accountId).map(r=>String(r.payable_key)));
  }
  /** The scheduler's worker-scoped view of every mandate in this run: what to run, when, and against which target. Reads only. */
  rules(worker:string){
    this.worker(worker);
    return this.store.db.prepare('SELECT id FROM payment_mandates ORDER BY rowid').all().map(r=>{
      const {m}=this.mandate(String(r.id)),target=m.policy.target;
      return {mandateId:m.id,policyVersion:m.policyVersion,state:m.state,trigger:m.policy.trigger,timezone:m.policy.timezone,startsAt:m.policy.startsAt,expiresAt:m.policy.expiresAt,
        target:target.kind==='BILLER'?`${target.provider}-${target.billingAccountId}`:target.kind.toLowerCase()};
    });
  }
  /** Unpaid, unclaimed fines of the rule's plate, as the scheduler's per-fine occurrences; a read, nothing is reserved. */
  fines(worker:string,mandateId:string){
    this.worker(worker);
    const {m,accountId}=this.mandate(mandateId),target=m.policy.target;
    if(m.policy.operation!=='FINE_PAYMENT'||target.kind!=='BILLER')return [];
    const claimed=new Set(this.store.db.prepare('SELECT payable_key FROM automation_payable_claims WHERE account_id=?').all(accountId).map(r=>String(r!.payable_key)));
    return this.io.readPayables(accountId,target.provider).filter(p=>p.reference===target.reference&&p.status==='UNPAID'&&!claimed.has(p.id)).map(p=>({fineId:String(p.obligationId)}));
  }
  /** Unpaid, unclaimed invoices of the rule's biller by due date; a read, nothing is reserved. */
  dueInvoices(worker:string,mandateId:string){
    this.worker(worker);
    const {m,accountId}=this.mandate(mandateId),target=m.policy.target;
    if(target.kind!=='BILLER')return [];
    const claimed=new Set(this.store.db.prepare('SELECT payable_key FROM automation_payable_claims WHERE account_id=?').all(accountId).map(r=>String(r!.payable_key)));
    return this.io.readPayables(accountId,target.provider).filter(p=>p.reference===target.reference&&p.status==='UNPAID'&&typeof p.dueDate==='string'&&!claimed.has(p.id)).map(p=>({dueDate:String(p.dueDate)}));
  }
  /** The balance and how many wallet payments have ever debited it. Reloads, top-ups and refunds are not payments, so only a new payment re-arms a threshold. */
  balanceMinor(worker:string,mandateId:string){
    this.worker(worker);
    const {m,accountId}=this.mandate(mandateId);
    if(m.policy.operation==='RECHARGE'&&m.policy.target.kind==='BILLER'){
      // A recharge rule watches only its own tag or number; the qualifying event is usage recorded on exactly that target.
      const target=m.policy.target,book=this.io.recharges?.(target.provider);
      if(!book)return deny('AUTOMATION_RECHARGE_UNAVAILABLE','This run exposes no recharge book for the target provider.',503);
      const found=book.targets(accountId).find(x=>x.reference===target.reference);
      if(!found)return deny('AUTOMATION_TARGET_NOT_FOUND','The rule\'s target does not exist in this workspace.',404);
      const usage=this.io.providerStore(target.provider).db.prepare("SELECT count(*) n FROM provider_lifecycle_events WHERE account_id=? AND kind='USAGE_RECORDED' AND outcome='APPLIED' AND json_extract(result,'$.detail.targetReference')=?").get(accountId,target.reference);
      return {balanceMinor:found.balanceMinor,qualifyingDebits:Number(usage!.n)};
    }
    if(!this.io.walletBalanceMinor)return deny('AUTOMATION_BALANCE_UNAVAILABLE','This run exposes no wallet balance.',503);
    const debits=this.store.db.prepare("SELECT count(*) n FROM payment_journal_entries WHERE account_id=? AND kind='PAYMENT' AND wallet_delta<0").get(accountId);
    return {balanceMinor:this.io.walletBalanceMinor(accountId),qualifyingDebits:Number(debits!.n)};
  }
  /** The stored preparation, its owner and the exact operation a permit must authorize; nothing here comes from a caller. */
  target(executionId:string){
    const row=this.store.db.prepare('SELECT body FROM automation_executions WHERE id=?').get(executionId);
    if(!row)return deny('AUTOMATION_EXECUTION_NOT_FOUND','No such prepared execution exists in this run.',404);
    const p=JSON.parse(String(row!.body)) as AutomationPreparation;
    const owner=this.store.db.prepare('SELECT owner FROM accounts WHERE id=?').get(p.accountId);
    if(!owner||!p.orderId)return deny('AUTOMATION_EXECUTION_NOT_FOUND','The prepared execution has no owner or order.',404);
    return {preparation:p,ownerSub:String(owner!.owner),orderId:p.orderId,
      operation:automationOperation({executionId:p.id,runId:p.runId,accountId:p.accountId,boundDigest:p.boundDigest,payableId:p.payableId,payableRevision:p.payableRevision,amountMinor:p.amountMinor,sourceId:p.sourceId,sourceVersion:p.sourceVersion})};
  }
  released(executionId:string):boolean{return !!this.store.db.prepare('SELECT 1 FROM automation_released WHERE execution_id=?').get(executionId);}
  /** Releases the payable claim, occurrence budget and order reservation only when the order provably never reached funds.
   *  An order with captured or unknown funds, or one still awaiting a human challenge, is held untouched. */
  reconcile(executionId:string):'RELEASED'|'HELD'{
    if(this.released(executionId))return 'RELEASED';
    if(!this.orders||!this.funding)return 'HELD';
    const {preparation,ownerSub,orderId}=this.target(executionId),dispatch=this.dispatchState(executionId);
    const orders=preparation.kind==='WALLET_RELOAD'?this.funding:this.orders;
    const actor:Actor={sub:ownerSub,username:ownerSub,name:'Automation owner',accountId:preparation.accountId,requestId:`automation-release:${executionId}`};
    const automation={executionId,mandateId:preparation.mandateId,boundDigest:preparation.boundDigest};
    let order=orders.get(actor,orderId);
    if(order.fundsCaptured)return 'HELD';
    const pastWindow=Date.now()>Date.parse(preparation.admissionExpiresAt);
    if(order.state==='AWAITING_APPROVAL'&&(dispatch==='REJECTED'||!dispatch&&pastWindow))order=orders.cancelAutomatic(actor,orderId,automation);
    if(!['FAILED','CANCELLED'].includes(order.state))return 'HELD';
    const at=new Date().toISOString();
    this.store.transaction(()=>{
      this.store.db.prepare('INSERT OR IGNORE INTO automation_released VALUES(?,?,?)').run(executionId,order.failureCode||order.state,at);
      this.store.db.prepare('DELETE FROM automation_payable_claims WHERE execution_id=?').run(executionId);
      if(preparation.kind!=='WALLET_RELOAD')releaseAutomationPayable(this.io.providerStore(preparation.provider),executionId);
      this.store.db.prepare('INSERT INTO automation_audit(body) VALUES(?)').run(JSON.stringify({at,runId:this.context.runId,mandateId:preparation.mandateId,event:'RELEASED',executionId,reason:order.failureCode||order.state}));
    });
    return 'RELEASED';
  }
  /** Releases executions whose admission window passed without any admission. */
  sweepExpired(){
    const rows=this.store.db.prepare('SELECT id,body FROM automation_executions WHERE id NOT IN (SELECT execution_id FROM automation_released) AND id NOT IN (SELECT execution_id FROM automation_dispatch)').all();
    for(const row of rows)if(Date.now()>Date.parse((JSON.parse(String(row.body)) as AutomationPreparation).admissionExpiresAt)){try{this.reconcile(String(row.id));}catch{/* held until a later sweep */}}
  }
  /** 'ADMITTED' or 'REJECTED' once the permit has been spent for this execution; undefined before. */
  dispatchState(executionId:string):'ADMITTED'|'REJECTED'|undefined{
    const row=this.store.db.prepare('SELECT state FROM automation_dispatch WHERE execution_id=?').get(executionId);
    return row?row.state as 'ADMITTED'|'REJECTED':undefined;
  }
  /** After the broker consumed the permit: re-read current authority and record the one admission. A stale fact closes it for good. */
  admit(executionId:string,ownerSub:string):AutomationPreparation{
    const outcome=this.store.transaction(()=>{
      if(this.released(executionId))return deny('AUTOMATION_EXECUTION_RELEASED','This execution already released its reservation.');
      const {preparation}=this.target(executionId),prior=this.store.db.prepare('SELECT state FROM automation_dispatch WHERE execution_id=?').get(executionId);
      if(prior)return deny('AUTOMATION_ALREADY_DISPATCHED','This execution was already admitted or closed; recover its original order instead.');
      const v=this.view(executionId);
      const stale=v.expired?'ADMISSION_EXPIRED':v.mandate.state!=='APPROVED'?'MANDATE_NOT_ACTIVE':v.mandate.skipNext?'SKIP_PENDING':!v.source.current?'SOURCE_CHANGED':v.biller&&!v.biller.current?'BILLER_CHANGED':!v.payable.current?'PAYABLE_CHANGED':undefined;
      const at=new Date().toISOString();
      this.store.db.prepare('INSERT INTO automation_dispatch VALUES(?,?,?,?,?)').run(executionId,stale?'REJECTED':'ADMITTED',ownerSub,at,stale??null);
      this.store.db.prepare('INSERT INTO automation_audit(body) VALUES(?)').run(JSON.stringify({at,runId:this.context.runId,mandateId:preparation.mandateId,event:stale?'ADMISSION_REJECTED':'ADMITTED',executionId,reason:stale}));
      return {preparation,stale};
    });
    if(outcome.stale)return deny('AUTOMATION_ADMISSION_REJECTED',`Current authority no longer allows this execution (${outcome.stale}). Its reservation stays held until reconciled.`);
    return outcome.preparation;
  }
  /** Owned inspection: the interactive owner sees this workspace's reserved executions. */
  inspect(subject:string,accountId:string,mandateId?:string):AutomationExecutionView[]{
    const account=this.store.db.prepare('SELECT owner FROM accounts WHERE id=?').get(accountId);
    if(!account)return deny('ACCOUNT_NOT_FOUND','The authority has no such workspace.',404);
    if(String(account!.owner)!==subject)deny('ACCOUNT_FORBIDDEN','This workspace does not belong to the owner.',403);
    return this.store.db.prepare('SELECT body FROM automation_executions WHERE account_id=? ORDER BY rowid DESC LIMIT 100').all(accountId)
      .map(r=>JSON.parse(String(r.body)) as AutomationPreparation).filter(p=>!mandateId||p.mandateId===mandateId)
      .map(p=>({id:p.id,accountId:p.accountId,mandateId:p.mandateId,policyVersion:p.policyVersion,occurrenceKey:p.occurrenceKey,state:p.state,provider:p.provider,payableId:p.payableId,amountMinor:p.amountMinor,sourceId:p.sourceId,preparedAt:p.preparedAt,admissionExpiresAt:p.admissionExpiresAt,boundDigest:p.boundDigest}));
  }
  status(subject:string){this.operator(subject);
    const rows=this.store.db.prepare('SELECT body FROM automation_executions WHERE id NOT IN (SELECT execution_id FROM automation_released) ORDER BY rowid DESC LIMIT 100').all().map(r=>JSON.parse(String(r.body)) as AutomationPreparation);
    return {runId:this.context.runId,workerSub:this.context.workerSub,
      executions:rows.map(p=>({id:p.id,mandateId:p.mandateId,occurrenceKey:p.occurrenceKey,amountMinor:p.amountMinor,state:p.state,preparedAt:p.preparedAt})),
      reservedMinor:rows.reduce((n,p)=>n+p.amountMinor,0),executionCount:rows.length};}
}

export function hasAutomationRun(store:AccountDatabase){return !!store.db.prepare("SELECT name FROM sqlite_master WHERE name='automation_runs'").get();}
export const AUTOMATION_ADMISSION_WINDOW_MS=ADMISSION_WINDOW_MS;
