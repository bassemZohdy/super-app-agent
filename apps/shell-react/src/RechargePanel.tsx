import { useState } from 'react';
import { translate, type CatalogKey, type Locale } from '../../../packages/protocol-core/src/i18n.ts';
import { formatAED,type RechargeTarget,type PaymentMethod,type BillingAccount } from '../../../packages/protocol-core/src/payments.ts';
type Props={targets:RechargeTarget[];methods:PaymentMethod[];links:BillingAccount[];busy:boolean;review(input:Record<string,unknown>):void;locale?:Locale};
export function RechargePanel({targets,methods,links,busy,review,locale='en'}:Props){
  const t=(key:CatalogKey,values?:Record<string,string|number>)=>translate(locale,key,values);
  const [targetKey,setTargetKey]=useState(''),[amount,setAmount]=useState(''),[source,setSource]=useState('');
  const owned=targets.filter(t=>t.status==='ACTIVE'&&links.some(l=>l.status==='ACTIVE'&&l.provider===t.provider&&l.reference===t.reference));
  const target=owned.find(t=>`${t.provider}:${t.reference}`===targetKey),method=methods.find(m=>m.id===source&&m.status==='ACTIVE');
  const amountMinor=Number(amount),valid=target?.denominationsMinor.includes(amountMinor)&&!!method;
  return <section className="payment-review" aria-label={t('recharge.section')}><h3>{t('recharge.title')}</h3>
    <p>{t('recharge.intro')}</p>
    <form onSubmit={e=>{e.preventDefault();if(target&&method&&valid)review({provider:target.provider,targetReference:target.reference,expectedTargetVersion:target.version,amountMinor,methodId:method.id,expectedMethodVersion:method.version});}}>
      <label>{t('recharge.target')}<select required disabled={busy} value={target?.provider?targetKey:''} onChange={e=>{setTargetKey(e.target.value);setAmount('');}}><option value="">{t('recharge.chooseTarget')}</option>{owned.map(t=><option key={`${t.provider}:${t.reference}`} value={`${t.provider}:${t.reference}`}>{t.label} · {t.reference} · {formatAED(t.balanceMinor)}</option>)}</select></label>
      {target&&<p>{t(target.kind==='TOLL'?'recharge.balanceToll':'recharge.balancePrepaid',{balance:formatAED(target.balanceMinor),reference:target.reference})}</p>}
      <label>{t('recharge.denomination')}<select required disabled={busy||!target} value={target?.denominationsMinor.includes(amountMinor)?amount:''} onChange={e=>setAmount(e.target.value)}><option value="">{t('recharge.chooseDenomination')}</option>{target?.denominationsMinor.map(n=><option key={n} value={n}>{formatAED(n)}</option>)}</select></label>
      <label>{t('recharge.source')}<select required disabled={busy} value={method?.id||''} onChange={e=>setSource(e.target.value)}><option value="">{t('recharge.chooseSource')}</option>{methods.filter(m=>m.status==='ACTIVE').map(m=><option key={m.id} value={m.id}>{m.nickname}{m.last4?` ·•••• ${m.last4}`:''}</option>)}</select></label>
      <button disabled={busy||!valid}>{t('recharge.review')}</button>
    </form>
    {!owned.length&&<p>{t('recharge.none')}</p>}
  </section>;
}
