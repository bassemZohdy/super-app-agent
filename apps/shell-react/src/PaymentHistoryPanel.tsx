import { useState } from 'react';
import { formatDateTime, translate, type CatalogKey, type Locale } from '../../../packages/protocol-core/src/i18n.ts';
import { formatStatementAED as formatAED } from '../../../packages/protocol-core/src/payment-history.ts';
import type { HistoryOperation, StatementEntry, StatementSummary } from '../../../packages/protocol-core/src/payment-history.ts';
type Props={busy:boolean;read(path:string,query?:Record<string,string>):Promise<any>;work(fn:()=>Promise<void>):Promise<void>;locale?:Locale};
export function PaymentHistoryPanel({busy,read,work,locale='en'}:Props){
  const t=(key:CatalogKey,values?:Record<string,string|number>)=>translate(locale,key,values);
  const [entries,setEntries]=useState<StatementEntry[]>(),[summary,setSummary]=useState<StatementSummary>(),[statementCursor,setStatementCursor]=useState<string|null>(null);
  const [operations,setOperations]=useState<HistoryOperation[]>(),[activityCursor,setActivityCursor]=useState<string|null>(null),[detail,setDetail]=useState<HistoryOperation>();
  const open=(o:HistoryOperation)=>void work(async()=>setDetail((await read('history/detail',{kind:o.kind,operationId:o.id})).operation));
  return <section className="payment-review" aria-label={t('history.section')}><h3>{t('history.title')}</h3>
    <p>{t('history.intro')}</p>
    <div className="payment-actions"><button disabled={busy} onClick={()=>void work(async()=>{const result=await read('statement');setEntries(result.entries);setSummary(result.summary);setStatementCursor(result.nextCursor);})}>{t('history.loadStatement')}</button>
      <button disabled={busy} onClick={()=>void work(async()=>{const result=await read('history');setOperations(result.operations);setActivityCursor(result.nextCursor);})}>{t('history.loadActivity')}</button></div>
    {summary&&<section aria-label={t('history.totals')}><h4>{t('history.snapshot',{count:summary.entryCount})}</h4><p>{t('history.equation',{opening:formatAED(summary.openingMinor),credits:formatAED(summary.creditsMinor),debits:formatAED(summary.debitsMinor),balance:formatAED(summary.balanceMinor)})}</p><p>{t(summary.balanced?'history.balanced':'history.unbalanced')}</p><p>{t('history.clearing',{wallet:formatAED(summary.walletMinor),external:formatAED(summary.externalClearingMinor),merchant:formatAED(summary.merchantClearingMinor)})}</p></section>}
    {entries&&<><ol aria-label={t('history.entries')}>{entries.map(e=><li key={e.id}><strong>{e.kind} · {formatAED(e.amountMinor)}</strong><p>{formatDateTime(locale,new Date(e.createdAt))} · {e.reference}</p><p>{t('history.walletMove',{move:formatAED(e.walletDeltaMinor),balance:formatAED(e.balanceAfterMinor)})}</p>
      {e.operation?<><p>{t('history.opState',{source:`${e.operation.source.label}${e.operation.source.last4?` · •••• ${e.operation.source.last4}`:''}`,biller:e.operation.biller.label,state:e.operation.state})}</p><button disabled={busy} onClick={()=>open(e.operation!)}>{t('history.viewEntry',{id:e.operation.id})}</button></>:<p>{t('history.retained')}</p>}</li>)}</ol>
      {statementCursor&&<button disabled={busy} onClick={()=>void work(async()=>{const result=await read('statement',{cursor:statementCursor});setEntries(current=>[...(current||[]),...result.entries]);setStatementCursor(result.nextCursor);})}>{t('history.moreEntries')}</button>}</>}
    {operations&&<><ol aria-label={t('history.activity')}>{operations.map(o=><li key={`${o.kind}:${o.id}`}><strong>{o.title} · {formatAED(o.totalMinor)}</strong><p>{t('history.states',{state:o.state,capture:o.captureState,settlement:o.settlementState,refund:o.refundState})}</p><p>{t('history.from',{source:`${o.source.label}${o.source.last4?` · •••• ${o.source.last4}`:''}`})}</p><button disabled={busy} onClick={()=>open(o)}>{t('history.viewActivity',{id:o.id})}</button></li>)}</ol>
      {activityCursor&&<button disabled={busy} onClick={()=>void work(async()=>{const result=await read('history',{cursor:activityCursor});setOperations(current=>[...(current||[]),...result.operations]);setActivityCursor(result.nextCursor);})}>{t('history.moreActivity')}</button>}</>}
    {detail&&<article aria-label={t('history.detail')}><h4>{detail.title}</h4><p>{t('history.originalOp',{id:detail.id,kind:detail.kind})}</p><p>{t('history.states',{state:detail.state,capture:detail.captureState,settlement:detail.settlementState,refund:detail.refundState})}</p>
      <p>{t('history.fundingFrom',{source:`${detail.source.label}${detail.source.last4?` · •••• ${detail.source.last4}`:''}`})}</p><p>{t('history.biller',{label:detail.biller.label,provider:detail.biller.provider,reference:detail.biller.reference})}</p>
      <p>{t('history.amounts',{amount:formatAED(detail.amountMinor),fees:formatAED(detail.feeMinor),total:formatAED(detail.totalMinor)})}</p><p>{t('history.moneyStates',{captured:formatAED(detail.capturedMinor),settled:formatAED(detail.settledMinor),refunded:formatAED(detail.refundedMinor)})}</p>
      <p>{t('history.correlation',{reference:detail.correlationReference})}</p>{detail.failureCode&&<p>{t('history.reason',{code:detail.failureCode})}</p>}
      {detail.completeReceipt?<section aria-label={t('history.receiptLabel')}><strong>{t(detail.kind==='REFUND'?'history.confirmedRefund':detail.kind==='GROUP'?'history.confirmedGroup':'history.confirmedPayment')} · {formatAED(detail.settledMinor)}</strong>{detail.receiptReference&&<p>{t('history.receiptRef',{reference:detail.receiptReference})}</p>}<p>{t('history.historical')}</p></section>:<p>{t('history.noReceipt')}</p>}
      {detail.related.map(r=><button key={`${r.kind}:${r.id}`} disabled={busy} onClick={()=>void work(async()=>setDetail((await read('history/detail',{kind:r.kind,operationId:r.id})).operation))}>{t('history.related',{id:r.id})}</button>)}
    </article>}
  </section>;
}
