import { useState } from 'react';
import { formatAED,type RechargeTarget,type PaymentMethod,type BillingAccount } from '../../../packages/protocol-core/src/payments.ts';
type Props={targets:RechargeTarget[];methods:PaymentMethod[];links:BillingAccount[];busy:boolean;review(input:Record<string,unknown>):void};
export function RechargePanel({targets,methods,links,busy,review}:Props){
  const [targetKey,setTargetKey]=useState(''),[amount,setAmount]=useState(''),[source,setSource]=useState('');
  const owned=targets.filter(t=>t.status==='ACTIVE'&&links.some(l=>l.status==='ACTIVE'&&l.provider===t.provider&&l.reference===t.reference));
  const target=owned.find(t=>`${t.provider}:${t.reference}`===targetKey),method=methods.find(m=>m.id===source&&m.status==='ACTIVE');
  const amountMinor=Number(amount),valid=target?.denominationsMinor.includes(amountMinor)&&!!method;
  return <section className="payment-review" aria-label="Toll and mobile recharge"><h3>Recharge a toll tag or prepaid mobile</h3>
    <p>Choose an owned linked target and its displayed denomination. This credits the provider's balance after payment; it does not add funds to your Cityside wallet.</p>
    <form onSubmit={e=>{e.preventDefault();if(target&&method&&valid)review({provider:target.provider,targetReference:target.reference,expectedTargetVersion:target.version,amountMinor,methodId:method.id,expectedMethodVersion:method.version});}}>
      <label>Recharge target<select required disabled={busy} value={target?.provider?targetKey:''} onChange={e=>{setTargetKey(e.target.value);setAmount('');}}><option value="">Choose a linked toll tag or prepaid line</option>{owned.map(t=><option key={`${t.provider}:${t.reference}`} value={`${t.provider}:${t.reference}`}>{t.label} · {t.reference} · {formatAED(t.balanceMinor)}</option>)}</select></label>
      {target&&<p>Current {target.kind==='TOLL'?'toll':'prepaid'} balance {formatAED(target.balanceMinor)} · Target {target.reference}</p>}
      <label>Recharge denomination<select required disabled={busy||!target} value={target?.denominationsMinor.includes(amountMinor)?amount:''} onChange={e=>setAmount(e.target.value)}><option value="">Choose a provider denomination</option>{target?.denominationsMinor.map(n=><option key={n} value={n}>{formatAED(n)}</option>)}</select></label>
      <label>Recharge funding source<select required disabled={busy} value={method?.id||''} onChange={e=>setSource(e.target.value)}><option value="">Choose wallet or a saved demo card</option>{methods.filter(m=>m.status==='ACTIVE').map(m=><option key={m.id} value={m.id}>{m.nickname}{m.last4?` ·•••• ${m.last4}`:''}</option>)}</select></label>
      <button disabled={busy||!valid}>Review provider recharge</button>
    </form>
    {!owned.length&&<p>Link your own Salik tag or Etisalat/du prepaid line above to recharge it.</p>}
  </section>;
}
