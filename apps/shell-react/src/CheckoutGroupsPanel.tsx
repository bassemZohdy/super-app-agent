import { useState } from 'react';
import { formatAED, type Payable, type PaymentMethod, type CheckoutGroupView } from '../../../packages/protocol-core/src/payments.ts';
type Props={payables:Payable[];methods:PaymentMethod[];groups:CheckoutGroupView[];busy:boolean;create(input:Record<string,unknown>):void;act(group:CheckoutGroupView,action:'approve'|'execute'|'cancel'):void};
export function CheckoutGroupsPanel({payables,methods,groups,busy,create,act}:Props){
  const [selected,setSelected]=useState<string[]>([]),[source,setSource]=useState('');
  const chosen=payables.filter(p=>selected.includes(p.id)),method=methods.find(m=>m.id===source&&m.status==='ACTIVE');
  const total=chosen.reduce((sum,p)=>sum+p.amountMinor,0);
  return <section className="payment-review" aria-label="Grouped checkout"><h3>Pay several items</h3>
    <p>Choose up to ten linked bills or fines and one funding source. Each line is paid separately. A stopped payment preserves earlier receipts and leaves later lines unpaid.</p>
    <fieldset><legend>Group payment items</legend>{payables.map(p=><label key={p.id}><input type="checkbox" checked={selected.includes(p.id)} disabled={busy} onChange={e=>setSelected(current=>e.target.checked?[...current,p.id]:current.filter(id=>id!==p.id))}/>{p.label} · {formatAED(p.amountMinor)}</label>)}</fieldset>
    <label>Group funding source<select value={source} disabled={busy} onChange={e=>setSource(e.target.value)}><option value="">Choose one source for every line</option>{methods.filter(m=>m.status==='ACTIVE').map(m=><option key={m.id} value={m.id}>{m.nickname}{m.last4?` ·•••• ${m.last4}`:''}</option>)}</select></label>
    <button disabled={busy||!chosen.length||chosen.length>10||!method||total>100000000} onClick={()=>{create({items:chosen.map(p=>({provider:p.provider,payableId:p.id,expectedPayableRevision:p.revision})),methodId:method!.id,expectedMethodVersion:method!.version});setSelected([]);}}>Save group for review</button>
    {groups.map(g=><article key={g.id} aria-label={`Checkout group ${g.id}`}><h4>Grouped checkout · {formatAED(g.totalMinor)}</h4>
      <p>Funding for every line: {g.source.nickname}{g.source.last4?` ·•••• ${g.source.last4}`:''} · source version {g.source.version}</p><p>Group state: {g.state}</p><p>Confirmed original total {formatAED(g.settledMinor)} of {formatAED(g.totalMinor)} · Fees AED 0.00</p>
      <p>Approval expires {new Date(g.expiresAt).toLocaleTimeString()}</p>
      {g.state==='AUTHORIZATION_PENDING'&&<p>Checkout is waiting for the simulated issuer. Later lines remain unpaid. Refresh after the run operator resolves the original authorization.</p>}{g.lastFailureCode&&<p>Stopped: {g.lastFailureCode}. Inspect the affected line before continuing.</p>}
      <ol>{g.orders.map(o=><li key={o.id}><strong>{o.quote.payable.label} · {formatAED(o.quote.totalMinor)}</strong><p>{o.state}{o.failureCode?` · ${o.failureCode}`:''}</p><p>Order {o.id}</p>{o.state==='SETTLED'&&o.receipt&&<p>Provider confirmed · Receipt {o.receipt.receiptNumber}</p>}{o.refundState&&<p>Original payment {o.refundState} · Refunded {formatAED(o.refundedMinor||0)} to its original source.</p>}{o.sourceFinalizationPending&&<p>Credit confirmed; final acknowledgement is pending.</p>}{o.state==='REQUIRES_ACTION'&&<p>Use this order’s authorization review below to answer the demo card challenge, then continue this group.</p>}{o.fundsCaptured&&o.state!=='SETTLED'&&<p>Funds captured. Continue this group to inspect the original payment before any later line.</p>}</li>)}</ol>
      {g.excluded.map(p=><p key={`${p.provider}:${p.payableId}`}>Excluded already-paid item: {p.payableId} · No new charge</p>)}
      {g.state==='AWAITING_APPROVAL'&&<button disabled={busy} onClick={()=>act(g,'approve')}>Approve group for {formatAED(g.totalMinor)}</button>}
      {g.approvedAt&&!g.cancelledAt&&g.state!=='COMPLETED'&&<button disabled={busy||['AUTHORIZATION_PENDING','REQUIRES_ACTION'].includes(g.state)||g.orders.some(o=>o.state==='FAILED'||o.state==='CANCELLED')} onClick={()=>act(g,'execute')}>Continue grouped payment</button>}
      {!g.cancelledAt&&g.state!=='COMPLETED'&&<button disabled={busy} onClick={()=>act(g,'cancel')}>Stop remaining group payments</button>}
      {g.state==='COMPLETED'&&<p>Every included line has a confirmed provider receipt.</p>}{g.cancelledAt&&<p>Further group payments stopped. Earlier receipts remain valid. Recover any captured child payment using its authorization review.</p>}
    </article>)}
  </section>;
}
