import { useState } from 'react';
import type { PaymentLifecycle } from '../../../packages/protocol-core/src/account-eligibility.ts';
import { formatAED } from '../../../packages/protocol-core/src/payments.ts';
export function PaymentReservations({lifecycle}:{lifecycle:PaymentLifecycle}){
  const [expanded,setExpanded]=useState(false);
  return <section aria-label="Business reservations and attempts">
    <button type="button" aria-expanded={expanded} onClick={()=>setExpanded(v=>!v)}>{expanded?'Hide':'Show'} business reservations and attempts</button>
    {expanded&&<><p>A reservation excludes another payment for the same invoice, individual fine or recharge target version. It does not approve spending. Unknown attempts retain their original payment ID.</p>
      <ul aria-label="Business obligation reservations">{(lifecycle.obligations||[]).map(r=><li key={`${r.orderId}:${r.kind}:${r.resourceId}`}>{r.kind.replace(/_/g,' ')} · {r.provider.toUpperCase()} · {r.resourceId} · {r.state} · Original order {r.orderId}{r.legacy?' · Derived from retained history':''}{r.state==='BLOCKED'?' · Overlapping historical work needs reconciliation; no new authorization.':''}</li>)}</ul>
      {!lifecycle.obligations?.length&&<p>No stored business reservations.</p>}
      <ul aria-label="Capture attempts">{(lifecycle.attempts||[]).map(a=><li key={a.id}>Attempt {a.id} · {a.state} · Planned {formatAED(a.amountMinor)} · Source {a.sourceId} · Original payment {a.paymentId} · {a.fundsCaptured?'Funds captured; reconcile the original settlement.':'No capture recorded; inspect this original attempt.'}{a.inferred?' · Inferred from retained history; original dispatch time was not recorded.':''}</li>)}</ul>
      {!lifecycle.attempts?.length&&<p>No capture attempt has been dispatched.</p>}
    </>}
  </section>;
}
