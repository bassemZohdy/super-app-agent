import { paymentObject } from './payments.ts';
import type { PaymentAuthorizationReview, WalletFundingOrder } from './payments.ts';
export type HistoryKind='PAYMENT'|'FUNDING'|'REFUND'|'LEGACY'|'GROUP';
export type HistorySource={id:string;kind:'wallet'|'card'|'legacy-external';label:string;last4?:string};
export type HistoryOperation={kind:HistoryKind;id:string;accountId:string;title:string;createdAt:string;state:string;currency:'AED';source:HistorySource;
  biller:{label:string;provider:string;reference:string};amountMinor:number;feeMinor:number;totalMinor:number;capturedMinor:number;settledMinor:number;refundedMinor:number;
  captureState:'NOT_CAPTURED'|'CAPTURED'|'INCONSISTENT';settlementState:'CONFIRMED'|'PENDING'|'UNKNOWN'|'NOT_APPLIED'|'PARTIAL';refundState:string;completeReceipt:boolean;receiptReference?:string;
  correlationReference:string;related:{kind:HistoryKind;id:string}[];failureCode?:string};
export type StatementEntry={id:string;sequence:number;kind:string;reference:string;createdAt:string;currency:'AED';amountMinor:number;walletDeltaMinor:number;balanceAfterMinor:number;
  postings:{account:'wallet'|'external-clearing'|'merchant-clearing';amountMinor:number}[];operation?:HistoryOperation};
export type StatementSummary={entryCount:number;openingMinor:number;creditsMinor:number;debitsMinor:number;balanceMinor:number;walletMinor:number;externalClearingMinor:number;merchantClearingMinor:number;balanced:boolean};
export type StatementPage={entries:StatementEntry[];summary:StatementSummary;nextCursor:string|null};
/** A confirmed provider receipt must not be inferred from capture or a pending final acknowledgement. */
export function paymentReceiptReady(o:PaymentAuthorizationReview|WalletFundingOrder):boolean{
  return o.state==='SETTLED'&&o.fundsCaptured&&!!o.receipt&&o.receipt.currency==='AED'&&o.receipt.amountMinor===o.quote.totalMinor&&
    ('payable' in o.quote?!(o as PaymentAuthorizationReview).sourceFinalizationPending&&o.receipt.receiptNumber===(o as PaymentAuthorizationReview).paymentId:o.receipt.receiptNumber===o.id);
}
const text={type:'string',minLength:1,maxLength:400},id={type:'string',minLength:1,maxLength:160,pattern:'^[A-Za-z0-9][A-Za-z0-9_.:-]*$'},kind={enum:['PAYMENT','FUNDING','REFUND','LEGACY','GROUP']};
const money={type:'integer',minimum:0,maximum:100000000},integer={type:'integer',minimum:-Number.MAX_SAFE_INTEGER,maximum:Number.MAX_SAFE_INTEGER};
export const historyKindSchema=kind;
export const historyIdSchema=id;
export const historyCursorSchema={type:'string',minLength:1,maxLength:2000,pattern:'^[A-Za-z0-9_-]+$'};
export const historyOperationSchema=paymentObject({kind,id,accountId:id,title:text,createdAt:text,state:text,currency:{const:'AED'},source:paymentObject({id,kind:{enum:['wallet','card','legacy-external']},label:text,last4:{type:'string',pattern:'^[0-9]{4}$'}},['id','kind','label']),
  biller:paymentObject({label:text,provider:text,reference:text}),amountMinor:money,feeMinor:money,totalMinor:money,capturedMinor:money,settledMinor:money,refundedMinor:money,
  captureState:{enum:['NOT_CAPTURED','CAPTURED','INCONSISTENT']},settlementState:{enum:['CONFIRMED','PENDING','UNKNOWN','NOT_APPLIED','PARTIAL']},refundState:text,completeReceipt:{type:'boolean'},receiptReference:text,correlationReference:text,
  related:{type:'array',maxItems:20,items:paymentObject({kind,id})},failureCode:text},['kind','id','accountId','title','createdAt','state','currency','source','biller','amountMinor','feeMinor','totalMinor','capturedMinor','settledMinor','refundedMinor','captureState','settlementState','refundState','completeReceipt','correlationReference','related']);
export const statementEntrySchema=paymentObject({id,sequence:{type:'integer',minimum:1,maximum:Number.MAX_SAFE_INTEGER},kind:text,reference:text,createdAt:text,currency:{const:'AED'},amountMinor:money,walletDeltaMinor:integer,balanceAfterMinor:money,
  postings:{type:'array',minItems:2,maxItems:2,items:paymentObject({account:{enum:['wallet','external-clearing','merchant-clearing']},amountMinor:integer})},operation:historyOperationSchema},['id','sequence','kind','reference','createdAt','currency','amountMinor','walletDeltaMinor','balanceAfterMinor','postings']);
export const statementSummarySchema=paymentObject({entryCount:{type:'integer',minimum:0,maximum:Number.MAX_SAFE_INTEGER},openingMinor:money,creditsMinor:{...integer,minimum:0},debitsMinor:{...integer,minimum:0},balanceMinor:money,walletMinor:integer,externalClearingMinor:integer,merchantClearingMinor:integer,balanced:{type:'boolean'}});

/** Signed display values and cumulative totals; never use this to validate a payment request. */
export function formatStatementAED(minor:number):string{
  if(!Number.isSafeInteger(minor))throw new Error('Invalid statement AED fils');
  const value=BigInt(Math.abs(minor));return `AED ${minor<0?'-':''}${value/100n}.${String(value%100n).padStart(2,'0')}`;
}
