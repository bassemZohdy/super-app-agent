/** Provider-owned obligations. Lifecycle mutation is server-internal; HTTP callers cannot issue or amend bills. */
import { createHash } from 'node:crypto';
import type { AccountDatabase } from './database.ts';
import { MAX_PAYMENT_MINOR, type Payable } from '../../../packages/protocol-core/src/payments.ts';
import { assertPayableUnreserved } from './payable-admissions.ts';

export type PayableProvider = 'dewa' | 'etisalat' | 'du' | 'police';
export class PayableError extends Error {
  readonly status: number; readonly code: string;
  constructor(status: number, code: string, message: string) { super(message); this.status = status; this.code = code; }
}
const deny = (status: number, code: string, message: string): never => { throw new PayableError(status, code, message); };
const money = (n: number, zero = false) => {
  if (!Number.isSafeInteger(n) || n < (zero ? 0 : 1) || n > MAX_PAYMENT_MINOR) deny(409, 'INVALID_PAYABLE', 'The provider obligation has an invalid AED amount.');
  return n;
};
const fils = (n: number) => { const value = Math.round(n * 100); if (!Number.isFinite(n) || Math.abs(value / 100 - n) > 1e-8) deny(409, 'INVALID_PAYABLE', 'The provider amount must use whole AED fils.'); return money(value); };
const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const idPattern = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,100}$/;
const isoDay = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(`${value}T00:00:00.000Z`)) && new Date(`${value}T00:00:00.000Z`).toISOString().slice(0,10) === value;
const isoTime = (value: string) => Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
type Stored = { key: string; body: Record<string, any> };
export class ProviderPayables {
  readonly store: AccountDatabase; readonly provider: PayableProvider; readonly clock: () => number;
  constructor(store: AccountDatabase, provider: PayableProvider, clock = Date.now) { this.store = store; this.provider = provider; this.clock = clock; }
  private atomic<T>(fn: () => T): T {
    if (!this.store.db.isTransaction) return this.store.transaction(fn);
    this.store.db.exec('SAVEPOINT payable_write');
    try { const result = fn(); this.store.db.exec('RELEASE payable_write'); return result; }
    catch (e) { this.store.db.exec('ROLLBACK TO payable_write'); this.store.db.exec('RELEASE payable_write'); throw e; }
  }
  private records(account: string): Stored[] {
    const kind = this.provider === 'police' ? 'fine' : 'bill';
    return this.store.db.prepare("SELECT id,body FROM resources WHERE account_id=? AND kind=? ORDER BY CASE WHEN id='current' THEN 0 ELSE 1 END,rowid DESC").all(account,kind).map(row => ({ key: String(row.id), body: JSON.parse(String(row.body)) }));
  }
  private describe(account: string, record: Stored,at=this.clock()): Payable {
    const b = record.body, fine = this.provider === 'police', obligationId = fine ? b.fineId : b.billId;
    const reference = fine ? b.plateNumber : this.provider === 'dewa' ? b.accountNumber : b.subscriptionId;
    const version = b.payableVersion ?? 1;
    if (!idPattern.test(obligationId || '') || typeof reference !== 'string' || !reference || !Number.isSafeInteger(version) || version < 1 || version > 1_000_000 || !['UNPAID','PAID','CANCELLED'].includes(b.status) || b.currency && b.currency !== 'AED') return deny(409,'INVALID_PAYABLE','The provider obligation is invalid.');
    if (b.dueDate !== undefined && !isoDay(b.dueDate) || b.expiresAt !== undefined && !isoTime(b.expiresAt) || b.discountExpiresAt !== undefined && !isoTime(b.discountExpiresAt)) return deny(409,'INVALID_PAYABLE','The provider obligation has an invalid date.');
    const originalAmountMinor = fine ? fils(b.originalAmount) : b.amountMinor === undefined ? fils(b.totalAmount) : money(b.amountMinor);
    if (!fine && fils(b.totalAmount) !== originalAmountMinor) return deny(409,'INVALID_PAYABLE','Provider amount representations disagree.');
    const quotedDiscount = fine ? money(Math.round(b.discountAmount * 100),true) : 0;
    if (fine && (Math.abs(quotedDiscount / 100 - b.discountAmount) > 1e-8 || quotedDiscount >= originalAmountMinor || fils(b.payableAmount) !== originalAmountMinor - quotedDiscount)) return deny(409,'INVALID_PAYABLE','Provider fine amounts disagree.');
    const now = at, expired = b.status === 'UNPAID' && b.expiresAt !== undefined && Date.parse(b.expiresAt) <= now;
    const discountEligible = fine && b.status === 'UNPAID' && quotedDiscount > 0 && !expired && (b.discountExpiresAt === undefined || Date.parse(b.discountExpiresAt) > now);
    const discountMinor = fine && b.status === 'PAID' ? originalAmountMinor - fils(b.paidAmount ?? b.payableAmount) : discountEligible ? quotedDiscount : 0;
    // Historical paid amounts retain the discount that was actually applied.
    const amountMinor = fine ? b.status === 'PAID' ? fils(b.paidAmount ?? b.payableAmount) : originalAmountMinor - discountMinor : originalAmountMinor;
    const status = expired ? 'EXPIRED' : b.status as Payable['status'];
    const dueState: NonNullable<Payable['dueState']> = status !== 'UNPAID' ? status === 'EXPIRED' ? 'EXPIRED' : 'CLOSED' : b.dueDate ? b.dueDate < new Date(now).toISOString().slice(0,10) ? 'OVERDUE' : b.dueDate === new Date(now).toISOString().slice(0,10) ? 'DUE' : 'CURRENT' : 'CURRENT';
    const id = `${this.provider}:${fine ? 'fine' : 'bill'}:${obligationId}`;
    const revision = digest([account,id,reference,version,status,amountMinor,originalAmountMinor,discountMinor,b.dueDate || null,b.expiresAt || null,b.discountExpiresAt || null,b.period || null,b.blackPoints || 0,b.paymentRestricted === true]);
    return { id, provider:this.provider, reference, obligationId, kind:fine?'FINE':'BILL', version, label:fine?`${b.violation} · ${obligationId}`:`${this.provider.toUpperCase()} bill ${obligationId}`, amountMinor, originalAmountMinor, discountMinor, discountEligible, currency:'AED', status, dueState, revision,
      ...(b.dueDate ? {dueDate:b.dueDate}:{}), ...(b.expiresAt ? {expiresAt:b.expiresAt}:{}), ...(b.discountExpiresAt ? {discountExpiresAt:b.discountExpiresAt}:{}), ...(b.period ? {period:b.period}:{}), ...(b.openingFixture ? {openingFixture:true}:{}), ...(fine ? {paymentRestricted:b.paymentRestricted === true || b.blackPoints > 0}:{}),
    };
  }
  list(account: string): Payable[] { return this.records(account).map(record => this.describe(account,record)); }
  get(account: string, id: string): Payable { return id.startsWith('police:selection:')?this.selection(account,id):this.describe(account,this.locate(account,id)); }
  /** A bounded selection is a provider-owned quote; its amount/revision always derives from its constituent fines. */
  selectFines(account:string,items:{payableId:string;expectedRevision:string}[]):Payable {
    return this.atomic(()=>{
      if(this.provider!=='police'||!Array.isArray(items)||items.length<1||items.length>20||new Set(items.map(i=>i.payableId)).size!==items.length)return deny(400,'INVALID_FINE_SELECTION','Select one to twenty distinct owned fines.');
      const fines=items.map(i=>{if(!i.payableId.startsWith('police:fine:'))return deny(400,'INVALID_FINE_SELECTION','Only individual fines can be selected.');return this.inspect(account,i.payableId,i.expectedRevision);}).sort((a,b)=>a.id.localeCompare(b.id));
      if(fines.some(f=>f.reference!==fines[0].reference))return deny(409,'MIXED_VEHICLES','Select fines for one linked vehicle at a time.');
      const id=`police:selection:${digest([account,fines.map(f=>f.id)])}`;
      if(!this.store.get(account,'fine-selection',id)){
        if(Number(this.store.db.prepare("SELECT count(*) n FROM resources WHERE account_id=? AND kind='fine-selection'").get(account)!.n)>=100)return deny(409,'SELECTION_LIMIT','This demo account reached its selection history limit.');
        this.store.put(account,'fine-selection',{ids:fines.map(f=>f.id)},id);
      }
      return this.selection(account,id);
    });
  }
  private selection(account:string,id:string,at=this.clock()):Payable {
    const saved=this.provider==='police'?this.store.get<{ids:string[]}>(account,'fine-selection',id):undefined;
    if(!saved)return deny(404,'PAYABLE_NOT_FOUND','Fine selection not found in this account.');
    const items=saved.ids.map(fineId=>this.describe(account,this.locate(account,fineId),at));
    const sum=(key:'amountMinor'|'originalAmountMinor'|'discountMinor')=>items.reduce((n,p)=>n+(p[key]||0),0);
    const amountMinor=money(sum('amountMinor')),originalAmountMinor=money(sum('originalAmountMinor')),discountMinor=money(sum('discountMinor'),true);
    const status:Payable['status']=items.every(p=>p.status==='PAID')?'PAID':items.every(p=>p.status==='UNPAID')?'UNPAID':items.some(p=>p.status==='EXPIRED')?'EXPIRED':'CANCELLED';
    const earliest=(values:(string|undefined)[])=>values.filter((v):v is string=>!!v).sort()[0];
    const expiresAt=earliest(items.map(p=>p.expiresAt)),discountExpiresAt=earliest(items.filter(p=>p.discountEligible).map(p=>p.discountExpiresAt));
    return {id,provider:'police',reference:items[0].reference,obligationId:`FINESET-${id.slice(-64)}`,kind:'FINE_SET',items,version:Math.max(...items.map(p=>p.version!)),label:`${items.length} selected traffic fine${items.length===1?'':'s'}`,amountMinor,originalAmountMinor,discountMinor,discountEligible:items.some(p=>p.discountEligible),currency:'AED',status,dueState:status==='UNPAID'?'CURRENT':status==='EXPIRED'?'EXPIRED':'CLOSED',revision:digest([account,id,items.map(p=>[p.id,p.revision])]),paymentRestricted:items.some(p=>p.paymentRestricted),...(expiresAt?{expiresAt}:{}),...(discountExpiresAt?{discountExpiresAt}:{})};
  }
  /** Add a labelled previous-cycle fixture once; never rewrite an existing current bill or invent a new charge. */
  initializeHistory(account: string) {
    if(this.provider === 'police') return;
    return this.atomic(() => {
      if(this.store.get(account,'payable-history-v1')) return;
      const current=this.store.get(account,'bill');
      if(current && this.records(account).length < 100) {
        const anchor=current.dueDate && isoDay(current.dueDate) ? Date.parse(`${current.dueDate}T00:00:00.000Z`) : this.clock();
        const at=new Date(anchor); const previous=new Date(Date.UTC(at.getUTCFullYear(),at.getUTCMonth(),0));
        const billId=`HISTORY-${current.billId}`;
        if(!this.records(account).some(r=>r.body.billId===billId)) {
          const body={...current,billId,status:'PAID',payableVersion:1,period:previous.toISOString().slice(0,7),dueDate:previous.toISOString().slice(0,10),openingFixture:true,receiptNumber:`opening-${billId}`};
          this.describe(account,{key:billId,body});this.store.put(account,'bill',body,billId);
        }
      }
      this.store.put(account,'payable-history-v1',{version:1});
    });
  }
  private locate(account: string, id: string) {
    const found = this.records(account).find(record => `${this.provider}:${this.provider === 'police' ? 'fine' : 'bill'}:${record.body[this.provider === 'police' ? 'fineId' : 'billId']}` === id);
    if (!found) return deny(404,'PAYABLE_NOT_FOUND','The obligation was not found in this account.');
    return found;
  }
  private current(account: string, id: string, revision: string) {
    const record = this.locate(account,id), payable = this.describe(account,record);
    if (payable.revision !== revision) return deny(409,'PAYABLE_CHANGED','The obligation changed. Review its current revision.');
    if (payable.status !== 'UNPAID') return deny(409,'PAYABLE_UNAVAILABLE','This obligation is no longer payable.');
    if (payable.paymentRestricted) return deny(409,'PAYABLE_RESTRICTED','This synthetic fine requires additional review.');
    return {record,payable};
  }
  /** New execution flows must preflight this revision again before authorization/capture. */
  inspect(account: string, id: string, revision: string) {
    const p=this.get(account,id);if(p.revision!==revision)return deny(409,'PAYABLE_CHANGED','The obligation changed. Review its current revision.');
    if(p.status!=='UNPAID')return deny(409,'PAYABLE_UNAVAILABLE','This obligation is no longer payable.');
    if(p.paymentRestricted)return deny(409,'PAYABLE_RESTRICTED','This synthetic fine requires additional review.');
    if((p.items||[p]).some(item=>item.version!>=1_000_000))return deny(409,'VERSION_LIMIT','The obligation reached its demo revision limit.');return p;
  }
  settlementReference(payable: Payable) { return `payable:${payable.revision}`; }
  assertUnreserved(account:string,id:string){assertPayableUnreserved(this.store,account,id,this.clock);}
  applyAdmitted(account:string,payable:Payable,paymentId:string,at:number){
    if(payable.kind==='FINE_SET')return this.atomic(()=>{
      const frozen=this.selection(account,payable.id,at);if(frozen.status!=='UNPAID'||frozen.revision!==payable.revision)return deny(409,'PAYABLE_CHANGED','The admitted fine selection changed outside its reservation.');
      for(const fine of frozen.items!)this.applyAdmitted(account,fine,paymentId,at);
      return {payable:this.selection(account,payable.id),receipt:{receiptNumber:paymentId,obligationId:payable.obligationId!,amountMinor:payable.amountMinor,currency:'AED' as const}};
    });
    const record=this.locate(account,payable.id),frozen=this.describe(account,record,at);
    if(record.body.status!=='UNPAID'||frozen.revision!==payable.revision)return deny(409,'PAYABLE_CHANGED','The admitted obligation was changed outside its reservation.');
    const body={...record.body,status:'PAID',payableVersion:this.next(payable.version!),receiptNumber:paymentId,paidAt:new Date(this.clock()).toISOString(),...(this.provider==='police'?{paidAmount:payable.amountMinor/100}:{})};
    this.store.put(account,this.provider==='police'?'fine':'bill',body,record.key);return {payable:this.describe(account,{key:record.key,body}),receipt:{receiptNumber:paymentId,obligationId:payable.obligationId!,amountMinor:payable.amountMinor,currency:'AED' as const}};
  }
  /** Demo provider policy: full cancellation of the original settled bill/fine set; never partial settlement or reopening. */
  reverse(account:string,p:Payable,paymentId:string,amountMinor:number,expectedMinor:number,refundId:string){return this.atomic(()=>{
    if(expectedMinor!==0||amountMinor!==p.amountMinor)return deny(409,'FULL_REVERSAL_REQUIRED','Bills and fines require full cancellation of this original payment.');
    const parts=p.items||[p];
    for(const part of parts){const record=this.locate(account,part.id),current=this.describe(account,record);
      if(current.status!=='PAID'||record.body.receiptNumber!==paymentId||current.amountMinor!==part.amountMinor||current.version!==part.version!+1)return deny(409,'REVERSAL_TERMS_CHANGED','The original settled obligation cannot be cancelled under these terms.');
      const body={...record.body,status:'CANCELLED',payableVersion:this.next(current.version!),reversedAmountMinor:part.amountMinor,refundId,reversedAt:new Date(this.clock()).toISOString()};
      this.store.put(account,this.provider==='police'?'fine':'bill',body,record.key);
    }
    return {};
  });}
  settle(account: string, id: string, revision: string, paymentId: string, proof: any) {
    return this.atomic(() => {
      if(id.startsWith('police:selection:'))return deny(409,'ADMISSION_REQUIRED','Fine selections require their stored-order capture admission.');
      this.assertUnreserved(account,id);
      const {record,payable} = this.current(account,id,revision);
      if (!proof || proof.id !== paymentId || proof.accountId !== account || proof.currency !== 'AED' || proof.status !== 'CAPTURED' || proof.refunded || proof.merchant !== this.provider || proof.reference !== this.settlementReference(payable) || proof.amountMinor !== payable.amountMinor) return deny(409,'INVALID_PAYMENT_PROOF','A matching current-revision captured payment is required.');
      const body = {...record.body,status:'PAID',payableVersion:this.next(payable.version!),receiptNumber:paymentId,paidAt:new Date(this.clock()).toISOString(),...(this.provider === 'police'?{paidAmount:payable.amountMinor/100}:{})};
      this.store.put(account,this.provider === 'police'?'fine':'bill',body,record.key);
      return {payable:this.describe(account,{key:record.key,body}),receipt:{receiptNumber:paymentId,obligationId:payable.obligationId,amountMinor:payable.amountMinor,currency:'AED'}};
    });
  }
  private next(version: number) { if(version >= 1_000_000) return deny(409,'VERSION_LIMIT','The obligation reached its demo revision limit.'); return version+1; }
  /** Trusted scenario seam only. It never changes identity/ownership and cannot reopen a terminal obligation. */
  amend(account: string, id: string, revision: string, change: {amountMinor?:number;discountMinor?:number;discountExpiresAt?:string;dueDate?:string;expiresAt?:string;status?:'CANCELLED';paymentRestricted?:boolean}) {
    return this.atomic(() => {
      const record = this.locate(account,id), before = this.describe(account,record);
      this.assertUnreserved(account,id);
      if(before.revision !== revision) return deny(409,'PAYABLE_CHANGED','The obligation changed. Review its current revision.');
      if(before.status !== 'UNPAID') return deny(409,'PAYABLE_UNAVAILABLE','A closed obligation cannot be amended or reopened.');
      const permitted=['amountMinor','discountMinor','discountExpiresAt','dueDate','expiresAt','status','paymentRestricted'];
      if(!Object.keys(change).length || Object.keys(change).some(k=>!permitted.includes(k)) || change.status !== undefined && change.status !== 'CANCELLED' || change.paymentRestricted !== undefined && typeof change.paymentRestricted !== 'boolean') return deny(400,'INVALID_CHANGE','Unsupported obligation lifecycle change.');
      const body:Record<string,any>={...record.body,payableVersion:this.next(before.version!)};
      for(const key of ['discountExpiresAt','dueDate','expiresAt','status','paymentRestricted'] as const) if(change[key] !== undefined) body[key]=change[key];
      if(this.provider === 'police') {
        const original=change.amountMinor === undefined ? before.originalAmountMinor! : money(change.amountMinor), discount=change.discountMinor === undefined ? Math.round(record.body.discountAmount*100) : money(change.discountMinor,true);
        body.originalAmount=original/100;body.discountAmount=discount/100;body.payableAmount=(original-discount)/100;
      } else {
        if(change.discountMinor !== undefined || change.discountExpiresAt !== undefined || change.paymentRestricted !== undefined) return deny(400,'INVALID_CHANGE','Fine policies cannot be applied to a bill.');
        if(change.amountMinor !== undefined) {body.amountMinor=money(change.amountMinor);body.totalAmount=body.amountMinor/100;}
      }
      const payable=this.describe(account,{key:record.key,body});
      this.store.put(account,this.provider === 'police'?'fine':'bill',body,record.key);return payable;
    });
  }
  /** Trusted provider event admission. A bill ID cannot be reused, including after settlement/withdrawal. */
  issueBill(account: string, input: {billId:string;reference:string;amountMinor:number;dueDate:string;period:string}) {
    return this.atomic(() => {
      if(this.provider === 'police' || !idPattern.test(input.billId) || !isoDay(input.dueDate) || !/^\d{4}-(0[1-9]|1[0-2])$/.test(input.period)) return deny(400,'INVALID_BILL','Invalid provider invoice.');
      money(input.amountMinor);
      const owner=this.provider === 'dewa' ? this.store.get(account,'consumption')?.accountNumber === input.reference : this.store.get(account,'subscription',input.reference)?.status === 'ACTIVE';
      if(!owner) return deny(403,'BILLER_NOT_OWNED','The bill target is not an active resource in this account.');
      const records=this.records(account);
      if(records.some(r=>r.body.billId===input.billId)) return deny(409,'BILL_EXISTS','The invoice identity was already issued.');
      if(records.length >= 100) return deny(409,'BILL_LIMIT','This demo account reached its invoice limit.');
      const body={billId:input.billId,...(this.provider === 'dewa'?{accountNumber:input.reference}:{subscriptionId:input.reference}),amountMinor:input.amountMinor,totalAmount:input.amountMinor/100,currency:'AED',status:'UNPAID',dueDate:input.dueDate,period:input.period,payableVersion:1};
      const payable=this.describe(account,{key:input.billId,body}); this.store.put(account,'bill',body,input.billId);return payable;
    });
  }
}
