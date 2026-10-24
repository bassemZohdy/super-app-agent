/** Source-authoritative reversal tombstones. APPLIED and REJECTED decisions are durable and cannot be replayed as another effect. */
import type { AccountDatabase } from './database.ts';
import type { PaymentRefund,ReversalReceipt } from '../../../packages/protocol-core/src/payments.ts';
import type { PayableAdmissions } from './payable-admissions.ts';
import type { ProviderPayables } from './payables.ts';
import type { ProviderRecharges } from './recharges.ts';
import { settlementFailure } from './payment-claims.ts';
export type ProviderReversal={refundId:string;approvalDigest:string;state:'APPLIED'|'REJECTED';receipt?:ReversalReceipt;failureCode?:string};
export class ProviderReversals {
  readonly store:AccountDatabase;readonly provider:string;readonly admissions:PayableAdmissions;readonly payables?:ProviderPayables;readonly recharges?:ProviderRecharges;
  constructor(store:AccountDatabase,provider:string,admissions:PayableAdmissions,payables?:ProviderPayables,recharges?:ProviderRecharges){this.store=store;this.provider=provider;this.admissions=admissions;this.payables=payables;this.recharges=recharges;store.db.exec(`CREATE TABLE IF NOT EXISTS provider_payment_reversals(id TEXT PRIMARY KEY,account_id TEXT NOT NULL REFERENCES accounts(id),payment_id TEXT NOT NULL,amount_minor INTEGER NOT NULL CHECK(typeof(amount_minor)='integer' AND amount_minor BETWEEN 1 AND 100000000),state TEXT NOT NULL CHECK(state IN ('APPLIED','REJECTED')),body TEXT NOT NULL);`);}
  get(account:string,id:string):ProviderReversal{const row=this.store.db.prepare('SELECT body FROM provider_payment_reversals WHERE account_id=? AND id=?').get(account,id);if(!row)return settlementFailure('REVERSAL_NOT_FOUND','Provider reversal not found.',404);return JSON.parse(String(row.body));}
  apply(account:string,r:PaymentRefund):ProviderReversal{
    const owner=this.store.db.prepare('SELECT owner FROM accounts WHERE id=?').get(account)?.owner,q=r?.quote;
    if(!r||r.accountId!==account||r.ownerSub!==owner||q?.origin!=='PAYMENT'||q.payable?.provider!==this.provider||!['REVERSING','RECONCILIATION_REQUIRED'].includes(r.state))return settlementFailure('REFUND_NOT_ADMITTED','The gateway must admit this exact owned refund.');
    const previous=this.store.db.prepare('SELECT body FROM provider_payment_reversals WHERE account_id=? AND id=?').get(account,r.id);
    if(previous){const result=JSON.parse(String(previous.body)) as ProviderReversal;if(result.approvalDigest!==r.approvalDigest)return settlementFailure('REVERSAL_CONFLICT','This reversal has different terms.');return result;}
    const persist=(result:ProviderReversal)=>{this.store.db.prepare('INSERT INTO provider_payment_reversals VALUES(?,?,?,?,?,?)').run(r.id,account,q.paymentId,q.amountMinor,result.state,JSON.stringify(result));this.store.events?.emit({accountId:account,subject:{kind:'REFUND',id:r.id,version:1},type:'PROVIDER_REVERSAL',state:result.state,binding:{approvalDigest:r.approvalDigest,amountMinor:q.amountMinor,currency:'AED',paymentId:q.paymentId,admissionId:q.admissionId!,provider:this.provider}});return result;};
    this.store.db.exec('SAVEPOINT provider_reversal_effect');
    try{
      const admission=this.admissions.get(account,q.admissionId!);
      if(admission.state!=='APPLIED'||admission.orderId!==q.orderId||admission.approvalDigest!==q.originalApprovalDigest||admission.receipt?.receiptNumber!==q.paymentId||admission.payable.id!==q.payable!.id||admission.payable.revision!==q.payable!.revision||admission.payable.amountMinor!==q.originalAmountMinor||admission.sourceId!==q.source.id||admission.sourceVersion!==q.source.version||q.payable!.kind==='RECHARGE'&&!admission.targetReleased)return settlementFailure('REVERSAL_TERMS_CHANGED','The original provider application and completed acknowledgement are required.');
      const total=Number(this.store.db.prepare("SELECT coalesce(sum(amount_minor),0) n FROM provider_payment_reversals WHERE account_id=? AND payment_id=? AND state='APPLIED'").get(account,q.paymentId)!.n);
      if(total!==q.expectedRefundedMinor||!Number.isSafeInteger(q.amountMinor)||q.amountMinor<1||total+q.amountMinor>q.originalAmountMinor)return settlementFailure('REVERSAL_LIMIT','The reversal exceeds this capture or has another cumulative version.');
      const effect=q.payable!.kind==='RECHARGE'?this.recharges!.reverse(account,q.payable!,q.paymentId,q.amountMinor,total):this.payables!.reverse(account,q.payable!,q.paymentId,q.amountMinor,total,r.id);
      const receipt:ReversalReceipt={refundId:r.id,paymentId:q.paymentId,orderId:q.orderId,approvalDigest:r.approvalDigest,amountMinor:q.amountMinor,cumulativeMinor:total+q.amountMinor,currency:'AED',provider:this.provider,reversedAt:new Date().toISOString(),...effect};
      const result=persist({refundId:r.id,approvalDigest:r.approvalDigest,state:'APPLIED',receipt});this.store.db.exec('RELEASE provider_reversal_effect');return result;
    }catch(e){this.store.db.exec('ROLLBACK TO provider_reversal_effect');this.store.db.exec('RELEASE provider_reversal_effect');const error=e as {status?:number;code?:string};if(!error.status||error.status>=500||!error.code)throw e;return persist({refundId:r.id,approvalDigest:r.approvalDigest,state:'REJECTED',failureCode:error.code});}
  }
}
