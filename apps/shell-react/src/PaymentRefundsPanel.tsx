import { PaymentReceiptFacts } from './PaymentReceiptFacts';
import { useState } from 'react';
import { formatAED,type PaymentAuthorizationReview,type WalletFundingOrder,type PaymentRefund } from '../../../packages/protocol-core/src/payments.ts';
type Props={orders:PaymentAuthorizationReview[];funding:WalletFundingOrder[];refunds:PaymentRefund[];busy:boolean;create(input:Record<string,unknown>):void;act(refund:PaymentRefund,action:'execute'|'recover'|'cancel'):void};
export function PaymentRefundsPanel({orders,funding,refunds,busy,create,act}:Props){
  const [selected,setSelected]=useState(''),[amount,setAmount]=useState(''),[reason,setReason]=useState('Demo service cancellation');
  const options=[...orders.map(o=>({origin:'PAYMENT',order:o})),...funding.map(o=>({origin:'WALLET_FUNDING',order:o}))].filter(({order:o})=>o.state==='SETTLED'&&o.fundsCaptured&&(o.refundedMinor||0)<o.quote.totalMinor);
  const entry=options.find(e=>`${e.origin}:${e.order.id}`===selected),original=entry?.order;
  const partial=entry?.origin==='WALLET_FUNDING'||(original as PaymentAuthorizationReview)?.quote.payable?.kind==='RECHARGE';
  const remaining=original?original.quote.totalMinor-(original.refundedMinor||0):0,minor=partial&&/^\d+(\.\d{1,2})?$/.test(amount)?Math.round(Number(amount)*100):partial?0:remaining;
  const source=(r:PaymentRefund)=>`${r.quote.source.nickname}${r.quote.source.last4?` ·•••• ${r.quote.source.last4}`:''}`;
  return <section className="payment-review" aria-label="Payment refunds"><h3>Refund to the original source</h3>
    <p>Cancel a fully paid demo bill/fine selection, or return unused recharge/wallet-funding value. Refunds use the original wallet or card. Provider reversal must be confirmed before money returns.</p>
    <label>Original payment<select value={original?selected:''} disabled={busy} onChange={e=>{setSelected(e.target.value);setAmount('');}}><option value="">Choose a confirmed payment</option>{options.map(({origin,order:o})=><option key={`${origin}:${o.id}`} value={`${origin}:${o.id}`}>{origin==='WALLET_FUNDING'?'Wallet top-up':(o as PaymentAuthorizationReview).quote.payable.label} · {formatAED(o.quote.totalMinor-(o.refundedMinor||0))} remaining · {o.quote.source.nickname}</option>)}</select></label>
    {original&&<p>Original source: {original.quote.source.nickname}{original.quote.source.last4?` ·•••• ${original.quote.source.last4}`:''} · Already refunded {formatAED(original.refundedMinor||0)} · Remaining {formatAED(remaining)}</p>}
    {partial?<label>Refund amount (AED)<input type="number" min="0.01" max={remaining/100} step="0.01" value={amount} onChange={e=>setAmount(e.target.value)}/></label>:original&&<p>Full provider cancellation only: {formatAED(remaining)}. The cancelled bill/fines will not reopen for repayment.</p>}
    <label>Refund reason<input maxLength={160} value={reason} onChange={e=>setReason(e.target.value)}/></label>
    <button disabled={busy||!entry||minor<1||minor>remaining||!reason.trim()} onClick={()=>create({origin:entry!.origin,orderId:original!.id,expectedVersion:original!.version,amountMinor:minor,reason})}>Review original-source refund</button>
    {refunds.map(r=><article key={r.id} aria-label={`Refund review ${r.id}`}><h4>Refund · {formatAED(r.quote.amountMinor)}</h4><p>Return to {source(r)} · Fees AED 0.00</p><p>Original payment {r.quote.paymentId}</p><p>Reason: {r.quote.reason}</p><p>Refund state: {r.state}{r.failureCode?` · ${r.failureCode}`:''}</p>
      <p>Cumulative after this refund: {formatAED(r.quote.expectedRefundedMinor+r.quote.amountMinor)} of {formatAED(r.quote.originalAmountMinor)}</p>
      {r.state==='AWAITING_APPROVAL'&&<><p>Review expires {new Date(r.expiresAt).toLocaleTimeString()}. No reversal or money return yet.</p><button disabled={busy} onClick={()=>act(r,'execute')}>Approve refund of {formatAED(r.quote.amountMinor)}</button><button disabled={busy} onClick={()=>act(r,'cancel')}>Cancel refund review</button></>}
      {['REVERSING','RECONCILIATION_REQUIRED'].includes(r.state)&&<><p>Refund is not confirmed. Inspect the original reversal; do not start another refund.</p><button disabled={busy} onClick={()=>act(r,'recover')}>Inspect or resume refund</button></>}
      {r.state==='FAILED'&&<p>No money returned. The saved reversal decision prevents this request being applied later.</p>}
      {r.state==='REFUNDED'&&r.receipt&&<section aria-label="Confirmed refund receipt"><strong>Refund confirmed · {formatAED(r.quote.amountMinor)}</strong><PaymentReceiptFacts source={r.quote.source} amountMinor={r.quote.amountMinor} feeMinor={0} target={r.quote.payable?.reference||r.accountId} reference={r.id} refundedMinor={r.quote.amountMinor} /><p>Returned to {source(r)} · Reference {r.id}</p>{r.receipt.providerBalanceMinor!==undefined&&<p>Provider balance after reversal {formatAED(r.receipt.providerBalanceMinor)}</p>}</section>}
    </article>)}
  </section>;
}
