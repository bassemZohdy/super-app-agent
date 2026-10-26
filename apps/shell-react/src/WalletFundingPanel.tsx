import { PaymentReceiptFacts } from './PaymentReceiptFacts';
import { paymentReceiptReady } from '../../../packages/protocol-core/src/payment-history.ts';
import { useState } from 'react';
import { formatAED, WALLET_FUNDING_LIMITS as limits, type PaymentMethod, type WalletFundingOrder } from '../../../packages/protocol-core/src/payments.ts';
import { translate, type CatalogKey, type Locale } from '../../../packages/protocol-core/src/i18n.ts';
type Props={methods:PaymentMethod[];orders:WalletFundingOrder[];busy:boolean;create(input:Record<string,unknown>):void;act(order:WalletFundingOrder,action:'approve'|'challenge'|'cancel'|'execute',extra?:Record<string,unknown>):void;locale?:Locale};
const name=(m:PaymentMethod)=>`${m.nickname} ·•••• ${m.last4}`;
export function WalletFundingPanel({methods,orders,busy,create,act,locale='en'}:Props){
  const t=(key:CatalogKey,values?:Record<string,string|number>)=>translate(locale,key,values);
  const time=(at:number|string)=>new Date(at).toLocaleTimeString(locale==='ar'?'ar-AE-u-nu-latn':undefined);
  const [amount,setAmount]=useState('50.00'),[methodId,setMethodId]=useState('');
  const cards=methods.filter(m=>m.kind==='card'&&m.status==='ACTIVE'),selected=cards.find(m=>m.id===methodId);
  const minor=/^\d+(\.\d{1,2})?$/.test(amount)?Math.round(Number(amount)*100):0;
  const pending=orders.some(o=>['AWAITING_APPROVAL','AUTHORIZATION_PENDING','REQUIRES_ACTION','AUTHORIZED'].includes(o.state));
  return <section className="payment-review" aria-label={t('wallet.title')}><h3>{t('wallet.title')}</h3>
    <p>{t('wallet.hint')}</p>
    <form onSubmit={e=>{e.preventDefault();if(selected)create({amountMinor:minor,methodId:selected.id,expectedMethodVersion:selected.version});}}>
      <label>{t('wallet.amount')}<input type="number" min="1" max="500" step="0.01" required value={amount} onChange={e=>setAmount(e.target.value)} /></label>
      <label>{t('wallet.card')}<select required value={selected?.id||''} onChange={e=>setMethodId(e.target.value)}><option value="">{t('wallet.chooseCard')}</option>{cards.map(m=><option key={m.id} value={m.id}>{name(m)}</option>)}</select></label>
      <button disabled={busy||pending||!selected||minor<limits.minMinor||minor>limits.maxMinor}>{t('wallet.review')}</button>
    </form>
    {!cards.length&&<p>{t('wallet.noCards')}</p>}
    {pending&&<p>{t('wallet.pending')}</p>}
    {orders.map(o=><article key={o.id} aria-label={t('wallet.orderLabel',{id:o.id})}>
      <h4>{t('wallet.orderTitle',{amount:formatAED(o.quote.amountMinor)})}</h4><p>{t('wallet.from',{source:name(o.quote.source),version:o.quote.source.version})}</p>
      <p>{t('wallet.to',{fees:formatAED(o.quote.feeMinor),total:formatAED(o.quote.totalMinor)})}</p>
      <p>{t('wallet.state',{state:o.state})}{o.failureCode?` · ${o.failureCode}`:''}</p>
      {['AWAITING_APPROVAL','AUTHORIZATION_PENDING','REQUIRES_ACTION','AUTHORIZED'].includes(o.state)&&<p>{t('wallet.expires',{time:time(o.expiresAt)})}</p>}
      {o.state==='AWAITING_APPROVAL'&&<button disabled={busy} onClick={()=>act(o,'approve')}>{t('wallet.authorize',{total:formatAED(o.quote.totalMinor)})}</button>}
      {o.state==='AUTHORIZATION_PENDING'&&<p>{t('wallet.issuerPending')}</p>}
      {o.state==='REQUIRES_ACTION'&&<div><p>{t('wallet.challengeHint')}</p><button disabled={busy} onClick={()=>act(o,'challenge',{challengeId:o.authorization?.challengeId,decision:'APPROVE'})}>{t('wallet.challengeApprove')}</button><button disabled={busy} onClick={()=>act(o,'challenge',{challengeId:o.authorization?.challengeId,decision:'REJECT'})}>{t('wallet.challengeReject')}</button></div>}
      {o.state==='AUTHORIZED'&&<button disabled={busy} onClick={()=>act(o,'execute')}>{t('wallet.add',{amount:formatAED(o.quote.amountMinor)})}</button>}
      {['AWAITING_APPROVAL','AUTHORIZATION_PENDING','REQUIRES_ACTION','AUTHORIZED'].includes(o.state)&&<button disabled={busy} onClick={()=>act(o,'cancel')}>{t('wallet.cancel')}</button>}
      {o.refundState&&<p>{t('wallet.refunded',{state:o.refundState,amount:formatAED(o.refundedMinor||0)})}</p>}
      {paymentReceiptReady(o)&&o.receipt&&<section aria-label={t('wallet.receiptLabel')}><strong>{t('wallet.credited',{amount:formatAED(o.receipt.amountMinor)})}</strong><PaymentReceiptFacts source={o.quote.source} amountMinor={o.quote.amountMinor} feeMinor={o.quote.feeMinor} target={t('wallet.target',{account:o.accountId})} reference={o.id} refundedMinor={o.refundedMinor} locale={locale} /><p>{t('wallet.receiptFrom',{number:o.receipt.receiptNumber,source:name(o.quote.source)})}</p><p>{t('wallet.balanceAfter',{balance:formatAED(o.receipt.balanceMinor)})}</p></section>}
    </article>)}
  </section>;
}
