import { PaymentReceiptFacts } from './PaymentReceiptFacts';
import { useState } from 'react';
import { formatAED,type PaymentAuthorizationReview,type WalletFundingOrder,type PaymentRefund } from '../../../packages/protocol-core/src/payments.ts';
import { translate, type CatalogKey, type Locale } from '../../../packages/protocol-core/src/i18n.ts';
type Props={orders:PaymentAuthorizationReview[];funding:WalletFundingOrder[];refunds:PaymentRefund[];busy:boolean;create(input:Record<string,unknown>):void;act(refund:PaymentRefund,action:'execute'|'recover'|'cancel'):void;locale?:Locale};
export function PaymentRefundsPanel({orders,funding,refunds,busy,create,act,locale='en'}:Props){
  const t=(key:CatalogKey,values?:Record<string,string|number>)=>translate(locale,key,values);
  const time=(at:number|string)=>new Date(at).toLocaleTimeString(locale==='ar'?'ar-AE-u-nu-latn':undefined);
  const [selected,setSelected]=useState(''),[amount,setAmount]=useState(''),[reason,setReason]=useState('Demo service cancellation');
  const options=[...orders.map(o=>({origin:'PAYMENT',order:o})),...funding.map(o=>({origin:'WALLET_FUNDING',order:o}))].filter(({order:o})=>o.state==='SETTLED'&&o.fundsCaptured&&(o.refundedMinor||0)<o.quote.totalMinor);
  const entry=options.find(e=>`${e.origin}:${e.order.id}`===selected),original=entry?.order;
  const partial=entry?.origin==='WALLET_FUNDING'||(original as PaymentAuthorizationReview)?.quote.payable?.kind==='RECHARGE';
  const remaining=original?original.quote.totalMinor-(original.refundedMinor||0):0,minor=partial&&/^\d+(\.\d{1,2})?$/.test(amount)?Math.round(Number(amount)*100):partial?0:remaining;
  const source=(r:PaymentRefund)=>`${r.quote.source.nickname}${r.quote.source.last4?` ·•••• ${r.quote.source.last4}`:''}`;
  return <section className="payment-review" aria-label={t('refund.label')}><h3>{t('refund.title')}</h3>
    <p>{t('refund.hint')}</p>
    <label>{t('refund.original')}<select value={original?selected:''} disabled={busy} onChange={e=>{setSelected(e.target.value);setAmount('');}}><option value="">{t('refund.choose')}</option>{options.map(({origin,order:o})=><option key={`${origin}:${o.id}`} value={`${origin}:${o.id}`}>{t('refund.option',{label:origin==='WALLET_FUNDING'?t('refund.walletTopUp'):(o as PaymentAuthorizationReview).quote.payable.label,remaining:formatAED(o.quote.totalMinor-(o.refundedMinor||0)),source:o.quote.source.nickname})}</option>)}</select></label>
    {original&&<p>{t('refund.originalSource',{source:`${original.quote.source.nickname}${original.quote.source.last4?` ·•••• ${original.quote.source.last4}`:''}`,refunded:formatAED(original.refundedMinor||0),remaining:formatAED(remaining)})}</p>}
    {partial?<label>{t('refund.amount')}<input type="number" min="0.01" max={remaining/100} step="0.01" value={amount} onChange={e=>setAmount(e.target.value)}/></label>:original&&<p>{t('refund.fullOnly',{remaining:formatAED(remaining)})}</p>}
    <label>{t('refund.reason')}<input maxLength={160} value={reason} onChange={e=>setReason(e.target.value)}/></label>
    <button disabled={busy||!entry||minor<1||minor>remaining||!reason.trim()} onClick={()=>create({origin:entry!.origin,orderId:original!.id,expectedVersion:original!.version,amountMinor:minor,reason})}>{t('refund.review')}</button>
    {refunds.map(r=><article key={r.id} aria-label={t('refund.reviewLabel',{id:r.id})}><h4>{t('refund.heading',{amount:formatAED(r.quote.amountMinor)})}</h4><p>{t('refund.returnTo',{source:source(r),fees:formatAED(0)})}</p><p>{t('refund.payment',{id:r.quote.paymentId})}</p><p>{t('refund.reasonLine',{reason:r.quote.reason})}</p><p>{t('refund.state',{state:r.state})}{r.failureCode?` · ${r.failureCode}`:''}</p>
      <p>{t('refund.cumulative',{cumulative:formatAED(r.quote.expectedRefundedMinor+r.quote.amountMinor),original:formatAED(r.quote.originalAmountMinor)})}</p>
      {r.state==='AWAITING_APPROVAL'&&<><p>{t('refund.expires',{time:time(r.expiresAt)})}</p><button disabled={busy} onClick={()=>act(r,'execute')}>{t('refund.approve',{amount:formatAED(r.quote.amountMinor)})}</button><button disabled={busy} onClick={()=>act(r,'cancel')}>{t('refund.cancel')}</button></>}
      {['REVERSING','RECONCILIATION_REQUIRED'].includes(r.state)&&<><p>{t('refund.unconfirmed')}</p><button disabled={busy} onClick={()=>act(r,'recover')}>{t('refund.inspect')}</button></>}
      {r.state==='FAILED'&&<p>{t('refund.failed')}</p>}
      {r.state==='REFUNDED'&&r.receipt&&<section aria-label={t('refund.receiptLabel')}><strong>{t('refund.confirmed',{amount:formatAED(r.quote.amountMinor)})}</strong><PaymentReceiptFacts source={r.quote.source} amountMinor={r.quote.amountMinor} feeMinor={0} target={r.quote.payable?.reference||r.accountId} reference={r.id} refundedMinor={r.quote.amountMinor} locale={locale} /><p>{t('refund.returned',{source:source(r),id:r.id})}</p>{r.receipt.providerBalanceMinor!==undefined&&<p>{t('refund.balanceAfter',{balance:formatAED(r.receipt.providerBalanceMinor)})}</p>}</section>}
    </article>)}
  </section>;
}
