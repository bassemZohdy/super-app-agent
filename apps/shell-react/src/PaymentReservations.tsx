import { useState } from 'react';
import type { PaymentLifecycle } from '../../../packages/protocol-core/src/account-eligibility.ts';
import { translate, type CatalogKey, type Locale } from '../../../packages/protocol-core/src/i18n.ts';
import { formatAED } from '../../../packages/protocol-core/src/payments.ts';
export function PaymentReservations({lifecycle,locale='en'}:{lifecycle:PaymentLifecycle;locale?:Locale}){
  const t=(key:CatalogKey,values?:Record<string,string|number>)=>translate(locale,key,values);
  const [expanded,setExpanded]=useState(false);
  return <section aria-label={t('reservations.section')}>
    <button type="button" aria-expanded={expanded} onClick={()=>setExpanded(v=>!v)}>{t(expanded?'reservations.hide':'reservations.show')}</button>
    {expanded&&<><p>{t('reservations.intro')}</p>
      <ul aria-label={t('reservations.listLabel')}>{(lifecycle.obligations||[]).map(r=><li key={`${r.orderId}:${r.kind}:${r.resourceId}`}>{r.kind.replace(/_/g,' ')} · {r.provider.toUpperCase()} · {r.resourceId} · {r.state} · {t('reservations.original',{id:r.orderId})}{r.legacy?` · ${t('reservations.legacy')}`:''}{r.state==='BLOCKED'?` · ${t('reservations.blocked')}`:''}</li>)}</ul>
      {!lifecycle.obligations?.length&&<p>{t('reservations.noneStored')}</p>}
      <ul aria-label={t('reservations.attemptsLabel')}>{(lifecycle.attempts||[]).map(a=><li key={a.id}>{t('reservations.attempt',{id:a.id,state:a.state,amount:formatAED(a.amountMinor),source:a.sourceId,payment:a.paymentId})} · {t(a.fundsCaptured?'reservations.captured':'reservations.notCaptured')}{a.inferred?` · ${t('reservations.inferred')}`:''}</li>)}</ul>
      {!lifecycle.attempts?.length&&<p>{t('reservations.noAttempts')}</p>}
    </>}
  </section>;
}
