/** Source-owned recharge occurrences. A quote is not a credit; application requires an admitted captured order. */
import { createHash,randomUUID } from 'node:crypto';
import type { AccountDatabase } from './database.ts';
import { MAX_PAYMENT_MINOR,type Payable,type PaymentReceipt,type RechargeProvider,type RechargeTarget } from '../../../packages/protocol-core/src/payments.ts';
import { PayableError } from './payables.ts';
import { assertPayableUnreserved,rechargeTargetKey } from './payable-admissions.ts';
const deny=(code:string,message:string,status=409):never=>{throw new PayableError(status,code,message);};
const hash=(v:unknown)=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
const amount=(n:number)=>Number.isSafeInteger(n)&&n>=0&&n<=MAX_PAYMENT_MINOR;
type Quote={payable:Payable;intentId:string;expiresAt:string;receipt?:PaymentReceipt};
export class ProviderRecharges {
  readonly store:AccountDatabase;readonly provider:RechargeProvider;readonly clock:()=>number;private sequence=0;
  constructor(store:AccountDatabase,provider:RechargeProvider,clock=Date.now){this.store=store;this.provider=provider;this.clock=clock;store.db.exec(`CREATE TABLE IF NOT EXISTS provider_recharge_quotes(id TEXT PRIMARY KEY,account_id TEXT NOT NULL REFERENCES accounts(id),intent_id TEXT NOT NULL,body TEXT NOT NULL,UNIQUE(account_id,intent_id));`);}
  private atomic<T>(fn:()=>T):T{if(!this.store.db.isTransaction)return this.store.transaction(fn);const name=`recharges_${++this.sequence}`;this.store.db.exec(`SAVEPOINT ${name}`);try{const result=fn();this.store.db.exec(`RELEASE ${name}`);return result;}catch(e){this.store.db.exec(`ROLLBACK TO ${name}`);this.store.db.exec(`RELEASE ${name}`);throw e;}}
  targets(account:string):RechargeTarget[]{
    const raw=this.provider==='rta'?[this.store.get(account,'salik')].filter(Boolean):this.store.list(account,'prepaid-line');
    return raw.map(value=>{
      const balanceMinor=this.provider==='rta'?Math.round(value.balance*100):value.balanceMinor,version=value.version??1;
      const denominationsMinor=this.provider==='rta'?[5000,10000,20000]:value.denominationsMinor;
      if(value.currency!=='AED'||!amount(balanceMinor)||this.provider==='rta'&&Math.abs(balanceMinor/100-value.balance)>1e-8||!Number.isSafeInteger(version)||version<1||version>1000000||!Array.isArray(denominationsMinor)||!denominationsMinor.length||denominationsMinor.length>20||!denominationsMinor.every(n=>amount(n)&&n>0)||new Set(denominationsMinor).size!==denominationsMinor.length)return deny('INVALID_RECHARGE_TARGET','The provider target has invalid balance/version/denominations.');
      return {provider:this.provider,reference:this.provider==='rta'?value.tagNumber:value.lineId,label:this.provider==='rta'?'Salik toll tag':`${this.provider} prepaid mobile`,kind:this.provider==='rta'?'TOLL':'PREPAID',status:value.status,version,balanceMinor,currency:'AED',denominationsMinor:[...denominationsMinor]};
    });
  }
  private target(account:string,reference:string){const target=this.targets(account).find(t=>t.reference===reference);if(!target)return deny('RECHARGE_TARGET_NOT_FOUND','Recharge target not found in this workspace.',404);return target;}
  private saved(account:string,id:string):Quote{const row=this.store.db.prepare('SELECT body FROM provider_recharge_quotes WHERE account_id=? AND id=?').get(account,id);if(!row)return deny('PAYABLE_NOT_FOUND','Recharge quote not found in this workspace.',404);return JSON.parse(String(row.body));}
  byIntent(account:string,intentId:string){const row=this.store.db.prepare('SELECT body FROM provider_recharge_quotes WHERE account_id=? AND intent_id=?').get(account,intentId);if(!row)return deny('RECHARGE_INTENT_NOT_FOUND','Recharge intent not found in this workspace.',404);const q=JSON.parse(String(row.body)) as Quote;return {payable:q.payable};}
  private save(account:string,q:Quote){this.store.db.prepare('UPDATE provider_recharge_quotes SET body=? WHERE account_id=? AND id=?').run(JSON.stringify(q),account,q.payable.id);}
  quote(account:string,input:{targetReference:string;amountMinor:number;expectedTargetVersion:number;intentId:string}):Payable{return this.atomic(()=>{
    const previous=this.store.db.prepare('SELECT id,body FROM provider_recharge_quotes WHERE account_id=? AND intent_id=?').get(account,input.intentId);
    if(previous){const q=JSON.parse(String(previous.body)) as Quote;if(q.payable.reference!==input.targetReference||q.payable.amountMinor!==input.amountMinor||q.payable.recharge!.targetVersion!==input.expectedTargetVersion)return deny('RECHARGE_INTENT_CONFLICT','This recharge intent already has different target or amount terms.');return this.get(account,String(previous.id));}
    const target=this.target(account,input.targetReference);if(target.version>=1000000)return deny('VERSION_LIMIT','The target reached its demo version limit.');if(target.status!=='ACTIVE'||target.version!==input.expectedTargetVersion)return deny('RECHARGE_TARGET_CHANGED','The target changed or is closed. Refresh its current state.');
    if(!target.denominationsMinor.includes(input.amountMinor))return deny('RECHARGE_DENOMINATION','Choose one of the displayed provider denominations.',400);
    if(!amount(target.balanceMinor+input.amountMinor))return deny('RECHARGE_BALANCE_LIMIT','The provider balance limit would be exceeded.');
    assertPayableUnreserved(this.store,account,rechargeTargetKey(this.provider,target.reference),this.clock);
    if(Number(this.store.db.prepare('SELECT count(*) n FROM provider_recharge_quotes WHERE account_id=?').get(account)!.n)>=100)return deny('RECHARGE_HISTORY_LIMIT','This demo workspace reached its recharge quote limit.');
    const id=`${this.provider}:recharge:${randomUUID()}`,expiresAt=new Date(this.clock()+300000).toISOString();
    const p:Payable={id,obligationId:id,provider:this.provider,reference:target.reference,kind:'RECHARGE',recharge:{kind:target.kind,targetVersion:target.version,balanceBeforeMinor:target.balanceMinor},version:target.version,label:`${target.label} · ${target.reference}`,amountMinor:input.amountMinor,originalAmountMinor:input.amountMinor,discountMinor:0,discountEligible:false,currency:'AED',status:'UNPAID',dueState:'CURRENT',expiresAt,revision:hash([account,id,target,input.amountMinor,expiresAt])};
    this.store.db.prepare('INSERT INTO provider_recharge_quotes VALUES(?,?,?,?)').run(id,account,input.intentId,JSON.stringify({payable:p,intentId:input.intentId,expiresAt}));return p;
  });}
  get(account:string,id:string):Payable{
    const q=this.saved(account,id),p=q.payable;if(q.receipt)return {...p,status:'PAID',dueState:'CLOSED',revision:hash([p.revision,'PAID'])};
    let changed=false;try{const t=this.target(account,p.reference);changed=t.status!=='ACTIVE'||t.version!==p.recharge!.targetVersion||t.balanceMinor!==p.recharge!.balanceBeforeMinor||!t.denominationsMinor.includes(p.amountMinor)||!amount(t.balanceMinor+p.amountMinor);}catch(e){if(!(e instanceof PayableError))throw e;changed=true;}
    const status=this.clock()>=Date.parse(q.expiresAt)?'EXPIRED':changed?'CANCELLED':'UNPAID';return status==='UNPAID'?p:{...p,status,dueState:status==='EXPIRED'?'EXPIRED':'CLOSED',revision:hash([p.revision,status])};
  }
  inspect(account:string,id:string,revision:string){const p=this.get(account,id);if(p.revision!==revision||p.status!=='UNPAID')return deny('PAYABLE_CHANGED','The recharge terms changed or expired. Review a new current quote.');return p;}
  applyAdmitted(account:string,p:Payable,paymentId:string,_at:number){return this.atomic(()=>{
    const q=this.saved(account,p.id),target=this.target(account,p.reference);
    if(q.receipt||q.payable.revision!==p.revision||target.status!=='ACTIVE'||target.version!==p.recharge!.targetVersion||target.balanceMinor!==p.recharge!.balanceBeforeMinor||!amount(target.balanceMinor+p.amountMinor))return deny('RECHARGE_TARGET_CHANGED','The admitted recharge needs source reconciliation.');
    const next=target.balanceMinor+p.amountMinor;
    if(this.provider==='rta'){const raw=this.store.get(account,'salik');this.store.put(account,'salik',{...raw,balance:next/100,version:target.version+1});}
    else{const raw=this.store.get(account,'prepaid-line',p.reference);this.store.put(account,'prepaid-line',{...raw,balanceMinor:next,version:target.version+1},p.reference);}
    q.receipt={receiptNumber:paymentId,obligationId:p.id,amountMinor:p.amountMinor,currency:'AED',targetReference:p.reference,providerBalanceMinor:next};this.save(account,q);return {payable:this.get(account,p.id),receipt:q.receipt};
  });}
}
