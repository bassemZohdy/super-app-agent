/** Owned, read-only history. Financial pagination is anchored to immutable journal rowids, never timestamp guesses. */
import type { Actor } from '../../../packages/backend-kit/src/context.ts';
import type { AccountDatabase } from './database.ts';
import { PaymentOrderError } from './payment-orders.ts';
import { legacyPaymentState } from '../../../packages/backend-kit/src/legacy-payment-binding.ts';
import { paymentReceiptReady, type HistoryKind, type HistoryOperation, type HistorySource, type StatementEntry, type StatementSummary } from '../../../packages/protocol-core/src/payment-history.ts';
const fail=(code:string,message:string,status=409):never=>{throw new PaymentOrderError(status,code,message);};
const tables={PAYMENT:'payment_authorization_orders',FUNDING:'wallet_funding_orders',REFUND:'payment_refunds',GROUP:'payment_checkout_groups',LEGACY:'resources'} as const;
type Cursor={v:1;owner:string;account:string;stream:'statement'|'activity';ceil:number[];after:number|string};
export class PaymentHistory {
  readonly store:AccountDatabase;
  constructor(store:AccountDatabase){this.store=store;}
  private owner(a:Actor){if(!this.store.owns(a.sub,a.accountId))fail('ACCOUNT_FORBIDDEN','History belongs to the signed-in workspace.',403);}
  private safe(n:number){if(!Number.isSafeInteger(n))fail('STATEMENT_OVERFLOW','Statement totals exceed the exact integer limit.');return n;}
  private row(a:Actor,kind:HistoryKind,id:string):any{
    this.owner(a);if(!Object.hasOwn(tables,kind))fail('HISTORY_KIND_INVALID','Choose a supported original record.',400);
    const table=tables[kind],row=this.store.db.prepare(`SELECT body FROM ${table} WHERE account_id=? AND id=?${kind==='LEGACY'?" AND kind='charge' AND json_extract(body,'$.orderId') IS NULL":''}`).get(a.accountId,id);
    if(!row)fail('HISTORY_NOT_FOUND','This original operation was not found in the workspace.',404);const o=JSON.parse(String(row!.body));
    if(kind!=='LEGACY'&&o.ownerSub!==a.sub)fail('HISTORY_NOT_FOUND','History not found.',404);return o;
  }
  private source(s:any):HistorySource{return typeof s==='string'?{id:s,kind:s==='wallet'?'wallet':'legacy-external',label:s==='wallet'?'Cityside wallet':'Legacy external simulation'}:{id:s.id,kind:s.kind,label:s.nickname,...(s.last4?{last4:s.last4}:{})};}
  private posted(account:string,reference:string,amount:number){const row=this.store.db.prepare('SELECT id,finalized FROM payment_journal_entries WHERE account_id=? AND reference=?').get(account,reference);if(!row||row.finalized!==1)return false;const p=this.store.db.prepare('SELECT amount_minor FROM payment_journal_postings WHERE entry_id=?').all(String(row.id));return p.length===2&&p.every(p=>Math.abs(Number(p.amount_minor))===amount)&&p.reduce((n,p)=>n+Number(p.amount_minor),0)===0;}
  detail(a:Actor,kind:HistoryKind,id:string):HistoryOperation{
    const o=this.row(a,kind,id),q=o.quote,source=this.source(kind==='GROUP'?o.source:kind==='LEGACY'?o.source:q.source);
    const total=kind==='GROUP'?o.totalMinor:kind==='LEGACY'?o.amountMinor:kind==='REFUND'?q.amountMinor:q.totalMinor;
    const v:HistoryOperation={kind,id,accountId:a.accountId,title:kind==='GROUP'?'Grouped checkout':kind==='LEGACY'?`${o.merchant} payment`:kind==='FUNDING'?'Wallet funding':kind==='REFUND'?`Refund · ${q.payable?.label||'Wallet funding'}`:q.payable.label,
      createdAt:o.createdAt,state:o.state||o.status,currency:'AED',source,biller:{label:kind==='GROUP'?'Multiple provider accounts':kind==='LEGACY'?o.merchant:kind==='FUNDING'?'Cityside wallet':q.payable?.label||'Cityside wallet',provider:kind==='GROUP'?'multiple':kind==='LEGACY'?o.merchant:q.payable?.provider||'payments',reference:kind==='GROUP'?id:kind==='LEGACY'?o.reference:q.payable?.reference||a.accountId},
      amountMinor:kind==='PAYMENT'||kind==='FUNDING'?q.amountMinor:total,feeMinor:kind==='PAYMENT'||kind==='FUNDING'?q.feeMinor:0,totalMinor:total,capturedMinor:0,settledMinor:0,refundedMinor:o.refundedMinor||0,captureState:'NOT_CAPTURED',settlementState:'PENDING',refundState:o.refundState||'NONE',completeReceipt:false,correlationReference:o.paymentId||id,related:[],...(o.failureCode?{failureCode:o.failureCode}:{})};
    if(kind==='GROUP'){
      const children=o.orderIds.map((id:string)=>this.detail(a,'PAYMENT',id)) as HistoryOperation[];
      v.related=children.map(c=>({kind:c.kind,id:c.id}));v.feeMinor=children.reduce((n,c)=>n+c.feeMinor,0);v.amountMinor=total-v.feeMinor;v.capturedMinor=children.reduce((n,c)=>n+c.capturedMinor,0);v.settledMinor=children.reduce((n,c)=>n+c.settledMinor,0);v.refundedMinor=children.reduce((n,c)=>n+c.refundedMinor,0);
      v.captureState=children.some(c=>c.captureState==='INCONSISTENT')?'INCONSISTENT':v.capturedMinor?'CAPTURED':'NOT_CAPTURED';v.completeReceipt=children.every(c=>c.completeReceipt);
      const next=children.find(c=>!c.completeReceipt);v.state=v.completeReceipt?'COMPLETED':o.cancelledAt?'CANCELLED':next?.state==='REQUIRES_ACTION'?'REQUIRES_ACTION':next?.state==='AUTHORIZATION_PENDING'?'AUTHORIZATION_PENDING':children.some(c=>c.settlementState==='UNKNOWN')?'RECONCILIATION_REQUIRED':v.settledMinor?'PARTIAL':next?.state||'AWAITING_APPROVAL';
      v.settlementState=v.completeReceipt?'CONFIRMED':v.settledMinor?'PARTIAL':children.some(c=>c.settlementState==='UNKNOWN')?'UNKNOWN':'PENDING';v.refundState=v.refundedMinor===total?'REFUNDED':v.refundedMinor?'PARTIALLY_REFUNDED':'NONE';
    }else if(kind==='PAYMENT'||kind==='FUNDING'){
      const reference=kind==='PAYMENT'?`charge:${o.paymentId}`:`wallet-funding:${id}`,posted=this.posted(a.accountId,reference,total);
      const charge=kind==='PAYMENT'&&o.paymentId?this.store.get(a.accountId,'charge',o.paymentId):undefined;
      const exact=kind==='FUNDING'?o.authorization?.state==='CAPTURED':!!charge&&charge.orderId===id&&charge.quoteDigest===o.approvalDigest&&charge.amountMinor===total&&charge.source===q.source.id&&charge.sourceVersion===q.source.version&&charge.admissionId===o.admissionId;
      v.captureState=o.fundsCaptured?(posted&&exact?'CAPTURED':'INCONSISTENT'):posted||charge?'INCONSISTENT':'NOT_CAPTURED';v.capturedMinor=v.captureState==='CAPTURED'?total:0;
      v.completeReceipt=paymentReceiptReady(o)&&v.captureState==='CAPTURED';v.settledMinor=v.completeReceipt?total:0;
      v.settlementState=v.completeReceipt?'CONFIRMED':o.fundsCaptured||['CAPTURING','CAPTURED','RECONCILIATION_REQUIRED'].includes(o.state)?'UNKNOWN':['FAILED','CANCELLED'].includes(o.state)?'NOT_APPLIED':'PENDING';
      if(v.completeReceipt)v.receiptReference=o.receipt.receiptNumber;
      if(kind==='PAYMENT')v.biller={label:q.billingAccount.nickname,provider:q.billingAccount.provider,reference:q.billingAccount.reference};
    }else if(kind==='REFUND'){
      const reference=`${q.origin==='PAYMENT'?'order-refund':'funding-refund'}:${id}`,posted=this.posted(a.accountId,reference,total);
      const original=this.detail(a,q.origin==='PAYMENT'?'PAYMENT':'FUNDING',q.orderId);v.captureState=original.captureState;v.capturedMinor=original.capturedMinor;v.biller=original.biller;v.correlationReference=id;v.related=[{kind:original.kind,id:original.id}];
      v.completeReceipt=o.state==='REFUNDED'&&posted&&o.receipt?.refundId===id&&o.receipt?.amountMinor===total&&o.receipt?.currency==='AED'&&o.receipt?.paymentId===q.paymentId&&o.receipt?.orderId===q.orderId&&o.receipt?.approvalDigest===o.approvalDigest&&o.receipt?.cumulativeMinor===q.expectedRefundedMinor+total&&original.captureState==='CAPTURED';v.refundedMinor=v.completeReceipt?total:0;v.refundState=o.state;v.settledMinor=v.completeReceipt?total:0;
      v.settlementState=v.completeReceipt?'CONFIRMED':['REVERSING','RECONCILIATION_REQUIRED'].includes(o.state)?'UNKNOWN':['FAILED','CANCELLED'].includes(o.state)?'NOT_APPLIED':'PENDING';if(v.completeReceipt)v.receiptReference=id;
    }else{
      const claim=this.store.db.prepare('SELECT body FROM payment_settlement_claims WHERE account_id=? AND payment_id=?').get(a.accountId,id);const c=claim?JSON.parse(String(claim.body)):undefined;
      v.state=legacyPaymentState(o,c);const captured=this.posted(a.accountId,`charge:${id}`,total);v.captureState=o.status==='CAPTURED'?(captured?'CAPTURED':'INCONSISTENT'):'NOT_CAPTURED';v.capturedMinor=v.captureState==='CAPTURED'?total:0;
      v.completeReceipt=v.captureState==='CAPTURED'&&c?.state==='APPLIED';v.settledMinor=v.completeReceipt?total:0;v.refundedMinor=o.refunded&&this.posted(a.accountId,`refund:${id}`,total)?total:0;v.refundState=v.refundedMinor?'REFUNDED':'NONE';
      v.settlementState=v.completeReceipt?'CONFIRMED':o.status==='DECLINED'||c?.state==='RELEASED'||v.refundedMinor?'NOT_APPLIED':'UNKNOWN';if(v.completeReceipt)v.receiptReference=id;
    }
    return v;
  }
  private cursor(a:Actor,stream:Cursor['stream'],encoded?:string):Cursor{
    this.owner(a);if(encoded){let c:Cursor;try{if(encoded.length>2000||!/^[A-Za-z0-9_-]+$/.test(encoded))throw Error();c=JSON.parse(Buffer.from(encoded,'base64url').toString());}catch{return fail('HISTORY_CURSOR_INVALID','Invalid history cursor.',400);}
      if(!c||typeof c!=='object'||c.v!==1||c.owner!==a.sub||c.account!==a.accountId||c.stream!==stream||!Array.isArray(c.ceil)||c.ceil.length!==(stream==='statement'?1:5)||c.ceil.some(n=>!Number.isSafeInteger(n)||n<0)||stream==='statement'&&(!Number.isSafeInteger(c.after)||Number(c.after)<0||Number(c.after)>c.ceil[0])||stream==='activity'&&(typeof c.after!=='string'||c.after.length>400))return fail('HISTORY_CURSOR_INVALID','Use this workspace and stream’s own cursor.',400);return c;
    }
    const tableNames=stream==='statement'?['payment_journal_entries']:Object.values(tables);
    return{v:1,owner:a.sub,account:a.accountId,stream,ceil:tableNames.map(table=>Number(this.store.db.prepare(`SELECT coalesce(max(rowid),0) n FROM ${table} WHERE account_id=?`).get(a.accountId)!.n)),after:stream==='statement'?0:'~'};
  }
  private encode(c:Cursor){return Buffer.from(JSON.stringify(c)).toString('base64url');}
  activity(a:Actor,encoded?:string){
    const c=this.cursor(a,'activity',encoded),keys=Object.keys(tables) as HistoryKind[],params:unknown[]=[];
    const union=keys.map((kind,i)=>{params.push(a.accountId,c.ceil[i]);return `SELECT '${kind}' kind,id,json_extract(body,'$.createdAt')||':${kind}:'||id position FROM ${tables[kind]} WHERE account_id=? AND rowid<=?${kind==='LEGACY'?" AND kind='charge' AND json_extract(body,'$.orderId') IS NULL":''}`;}).join(' UNION ALL ');
    const rows=this.store.db.prepare(`SELECT * FROM (${union}) WHERE position<? ORDER BY position DESC LIMIT 26`).all(...params as any[],String(c.after));
    return {operations:rows.slice(0,25).map(r=>this.detail(a,String(r.kind) as HistoryKind,String(r.id))),nextCursor:rows.length>25?this.encode({...c,after:String(rows[24].position)}):null};
  }
  statement(a:Actor,encoded?:string){
    const c=this.cursor(a,'statement',encoded),ceiling=c.ceil[0];
    const totals=this.store.db.prepare(`SELECT count(*) entryCount,coalesce(sum(CASE WHEN kind='OPENING' THEN wallet_delta ELSE 0 END),0) openingMinor,
      coalesce(sum(CASE WHEN kind<>'OPENING' AND wallet_delta>0 THEN wallet_delta ELSE 0 END),0) creditsMinor,
      coalesce(sum(CASE WHEN wallet_delta<0 THEN -wallet_delta ELSE 0 END),0) debitsMinor,coalesce(sum(wallet_delta),0) balanceMinor FROM payment_journal_entries WHERE account_id=? AND rowid<=? AND finalized=1`).get(a.accountId,ceiling)!;
    const sum=(account:string)=>this.safe(Number(this.store.db.prepare('SELECT coalesce(sum(p.amount_minor),0) n FROM payment_journal_entries e JOIN payment_journal_postings p ON e.id=p.entry_id WHERE e.account_id=? AND e.rowid<=? AND e.finalized=1 AND p.ledger_account=?').get(a.accountId,ceiling,account)!.n));
    const walletMinor=sum('wallet'),externalClearingMinor=sum('external-clearing'),merchantClearingMinor=sum('merchant-clearing');
    const summary:StatementSummary={entryCount:Number(totals.entryCount),openingMinor:this.safe(Number(totals.openingMinor)),creditsMinor:this.safe(Number(totals.creditsMinor)),debitsMinor:this.safe(Number(totals.debitsMinor)),balanceMinor:this.safe(Number(totals.balanceMinor)),walletMinor,externalClearingMinor,merchantClearingMinor,balanced:walletMinor+externalClearingMinor+merchantClearingMinor===0};
    const rows=this.store.db.prepare('SELECT rowid sequence,* FROM payment_journal_entries WHERE account_id=? AND rowid>? AND rowid<=? AND finalized=1 ORDER BY rowid LIMIT 26').all(a.accountId,Number(c.after),ceiling);
    let balance=Number(this.store.db.prepare('SELECT coalesce(sum(wallet_delta),0) n FROM payment_journal_entries WHERE account_id=? AND rowid<=? AND finalized=1').get(a.accountId,Number(c.after))!.n);
    const entries:StatementEntry[]=rows.slice(0,25).map(row=>{
      const postings=this.store.db.prepare('SELECT ledger_account account,amount_minor amountMinor FROM payment_journal_postings WHERE entry_id=? ORDER BY line').all(String(row.id)) as StatementEntry['postings'];
      if(postings.length!==2||postings.reduce((n,p)=>n+Number(p.amountMinor),0)!==0)fail('STATEMENT_UNBALANCED','This journal entry needs reconciliation.');
      balance=this.safe(balance+Number(row.wallet_delta));const entry:StatementEntry={id:String(row.id),sequence:Number(row.sequence),kind:String(row.kind),reference:String(row.reference),createdAt:String(row.created_at),currency:'AED',amountMinor:Math.abs(Number(postings[0].amountMinor)),walletDeltaMinor:Number(row.wallet_delta),balanceAfterMinor:balance,postings};
      const [prefix,...parts]=entry.reference.split(':'),id=parts.join(':');let kind:HistoryKind|undefined,op=id;
      if(prefix==='charge'||prefix==='refund'){const charge=this.store.get(a.accountId,'charge',id);if(charge){kind=charge.orderId?'PAYMENT':'LEGACY';op=charge.orderId||id;}}
      else if(prefix==='wallet-funding')kind='FUNDING';else if(prefix==='order-refund'||prefix==='funding-refund')kind='REFUND';
      if(kind)entry.operation=this.detail(a,kind,op);return entry;
    });
    return {entries,summary,nextCursor:rows.length>25?this.encode({...c,after:Number(rows[24].sequence)}):null};
  }
}
