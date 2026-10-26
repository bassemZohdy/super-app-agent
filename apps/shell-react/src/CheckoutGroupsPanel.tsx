import { PaymentReceiptFacts } from './PaymentReceiptFacts';
import { paymentReceiptReady } from '../../../packages/protocol-core/src/payment-history.ts';
import { useState } from 'react';
import { formatAED, type Payable, type PaymentMethod, type CheckoutGroupView } from '../../../packages/protocol-core/src/payments.ts';
import { translate, type CatalogKey, type Locale } from '../../../packages/protocol-core/src/i18n.ts';
type Props={payables:Payable[];methods:PaymentMethod[];groups:CheckoutGroupView[];busy:boolean;create(input:Record<string,unknown>):void;act(group:CheckoutGroupView,action:'approve'|'execute'|'cancel'):void;locale?:Locale};
export function CheckoutGroupsPanel({payables,methods,groups,busy,create,act,locale='en'}:Props){
  const t=(key:CatalogKey,values?:Record<string,string|number>)=>translate(locale,key,values);
  const time=(at:number|string)=>new Date(at).toLocaleTimeString(locale==='ar'?'ar-AE-u-nu-latn':undefined);
  const [selected,setSelected]=useState<string[]>([]),[source,setSource]=useState('');
  const chosen=payables.filter(p=>selected.includes(p.id)),method=methods.find(m=>m.id===source&&m.status==='ACTIVE');
  const total=chosen.reduce((sum,p)=>sum+p.amountMinor,0);
  return <section className="payment-review" aria-label={t('group.label')}><h3>{t('group.title')}</h3>
    <p>{t('group.hint')}</p>
    <fieldset><legend>{t('group.items')}</legend>{payables.map(p=><label key={p.id}><input type="checkbox" checked={selected.includes(p.id)} disabled={busy} onChange={e=>setSelected(current=>e.target.checked?[...current,p.id]:current.filter(id=>id!==p.id))}/>{p.label} · {formatAED(p.amountMinor)}</label>)}</fieldset>
    <label>{t('group.source')}<select value={source} disabled={busy} onChange={e=>setSource(e.target.value)}><option value="">{t('group.chooseSource')}</option>{methods.filter(m=>m.status==='ACTIVE').map(m=><option key={m.id} value={m.id}>{m.nickname}{m.last4?` ·•••• ${m.last4}`:''}</option>)}</select></label>
    <button disabled={busy||!chosen.length||chosen.length>10||!method||total>100000000} onClick={()=>{create({items:chosen.map(p=>({provider:p.provider,payableId:p.id,expectedPayableRevision:p.revision})),methodId:method!.id,expectedMethodVersion:method!.version});setSelected([]);}}>{t('group.save')}</button>
    {groups.map(g=><article key={g.id} aria-label={t('group.groupLabel',{id:g.id})}><h4>{t('group.heading',{total:formatAED(g.totalMinor)})}</h4>
      <p>{t('group.funding',{source:`${g.source.nickname}${g.source.last4?` ·•••• ${g.source.last4}`:''}`,version:g.source.version})}</p><p>{t('group.state',{state:g.state})}</p><p>{t('group.settled',{settled:formatAED(g.settledMinor),total:formatAED(g.totalMinor),fees:formatAED(0)})}</p>
      <p>{t('group.expires',{time:time(g.expiresAt)})}</p>
      {g.state==='AUTHORIZATION_PENDING'&&<p>{t('group.issuerPending')}</p>}{g.lastFailureCode&&<p>{t('group.stopped',{code:g.lastFailureCode})}</p>}
      <ol>{g.orders.map(o=><li key={o.id}><strong>{o.quote.payable.label} · {formatAED(o.quote.totalMinor)}</strong><p>{o.state}{o.failureCode?` · ${o.failureCode}`:''}</p><p>{t('group.order',{id:o.id})}</p>{paymentReceiptReady(o)&&o.receipt&&<><p>{t('group.confirmed',{number:o.receipt.receiptNumber})}</p><PaymentReceiptFacts source={o.quote.source} amountMinor={o.quote.amountMinor} feeMinor={o.quote.feeMinor} target={`${o.quote.billingAccount.nickname} · ${o.quote.billingAccount.reference}`} reference={o.paymentId!} refundedMinor={o.refundedMinor} locale={locale} /></>}{o.refundState&&<p>{t('group.refunded',{state:o.refundState,amount:formatAED(o.refundedMinor||0)})}</p>}{o.sourceFinalizationPending&&<p>{t('group.finalizing')}</p>}{o.state==='REQUIRES_ACTION'&&<p>{t('group.challenge')}</p>}{o.fundsCaptured&&o.state!=='SETTLED'&&<p>{t('group.captured')}</p>}</li>)}</ol>
      {g.excluded.map(p=><p key={`${p.provider}:${p.payableId}`}>{t('group.excluded',{id:p.payableId})}</p>)}
      {g.state==='AWAITING_APPROVAL'&&<button disabled={busy} onClick={()=>act(g,'approve')}>{t('group.approve',{total:formatAED(g.totalMinor)})}</button>}
      {g.approvedAt&&!g.cancelledAt&&g.state!=='COMPLETED'&&<button disabled={busy||['AUTHORIZATION_PENDING','REQUIRES_ACTION'].includes(g.state)||g.orders.some(o=>o.state==='FAILED'||o.state==='CANCELLED')} onClick={()=>act(g,'execute')}>{t('group.continue')}</button>}
      {!g.cancelledAt&&g.state!=='COMPLETED'&&<button disabled={busy} onClick={()=>act(g,'cancel')}>{t('group.stop')}</button>}
      {g.state==='COMPLETED'&&<p>{t('group.completed')}</p>}{g.cancelledAt&&<p>{t('group.cancelled')}</p>}
    </article>)}
  </section>;
}
