import { PaymentReceiptFacts } from './PaymentReceiptFacts';
import { paymentReceiptReady } from '../../../packages/protocol-core/src/payment-history.ts';
import { useState } from 'react';
import { formatAED, WALLET_FUNDING_LIMITS as limits, type PaymentMethod, type WalletFundingOrder } from '../../../packages/protocol-core/src/payments.ts';
type Props={methods:PaymentMethod[];orders:WalletFundingOrder[];busy:boolean;create(input:Record<string,unknown>):void;act(order:WalletFundingOrder,action:'approve'|'challenge'|'cancel'|'execute',extra?:Record<string,unknown>):void};
const name=(m:PaymentMethod)=>`${m.nickname} ·•••• ${m.last4}`;
export function WalletFundingPanel({methods,orders,busy,create,act}:Props){
  const [amount,setAmount]=useState('50.00'),[methodId,setMethodId]=useState('');
  const cards=methods.filter(m=>m.kind==='card'&&m.status==='ACTIVE'),selected=cards.find(m=>m.id===methodId);
  const minor=/^\d+(\.\d{1,2})?$/.test(amount)?Math.round(Number(amount)*100):0;
  const pending=orders.some(o=>['AWAITING_APPROVAL','AUTHORIZATION_PENDING','REQUIRES_ACTION','AUTHORIZED'].includes(o.state));
  return <section className="payment-review" aria-label="Add wallet funds"><h3>Add wallet funds</h3>
    <p>Select a saved demo card and review an exact top-up. AED 1–500 per payment, zero fee, maximum wallet balance AED 10000. Approval reserves card capacity; the separate Add action captures and credits once.</p>
    <form onSubmit={e=>{e.preventDefault();if(selected)create({amountMinor:minor,methodId:selected.id,expectedMethodVersion:selected.version});}}>
      <label>Wallet top-up amount (AED)<input type="number" min="1" max="500" step="0.01" required value={amount} onChange={e=>setAmount(e.target.value)} /></label>
      <label>Wallet top-up card<select required value={selected?.id||''} onChange={e=>setMethodId(e.target.value)}><option value="">Choose a saved demo card</option>{cards.map(m=><option key={m.id} value={m.id}>{name(m)}</option>)}</select></label>
      <button disabled={busy||pending||!selected||minor<limits.minMinor||minor>limits.maxMinor}>Review wallet top-up</button>
    </form>
    {!cards.length&&<p>Add an active demo card above to fund your wallet.</p>}
    {pending&&<p>Inspect or cancel the existing top-up before starting another.</p>}
    {orders.map(o=><article key={o.id} aria-label={`Wallet funding review ${o.id}`}>
      <h4>Wallet top-up · {formatAED(o.quote.amountMinor)}</h4><p>From {name(o.quote.source)} · source version {o.quote.source.version}</p>
      <p>To this account's wallet · Fees {formatAED(o.quote.feeMinor)} · Card total {formatAED(o.quote.totalMinor)}</p>
      <p>State: {o.state}{o.failureCode?` · ${o.failureCode}`:''}</p>
      {['AWAITING_APPROVAL','AUTHORIZATION_PENDING','REQUIRES_ACTION','AUTHORIZED'].includes(o.state)&&<p>Review expires {new Date(o.expiresAt).toLocaleTimeString()}. No wallet funds added yet.</p>}
      {o.state==='AWAITING_APPROVAL'&&<button disabled={busy} onClick={()=>act(o,'approve')}>Authorize wallet top-up of {formatAED(o.quote.totalMinor)}</button>}
      {o.state==='AUTHORIZATION_PENDING'&&<p>Waiting for the simulated issuer. No card capture or wallet credit yet. Refresh after the run operator resolves this decision.</p>}
      {o.state==='REQUIRES_ACTION'&&<div><p>This card requires an explicit demo challenge decision for this top-up.</p><button disabled={busy} onClick={()=>act(o,'challenge',{challengeId:o.authorization?.challengeId,decision:'APPROVE'})}>Approve wallet top-up challenge</button><button disabled={busy} onClick={()=>act(o,'challenge',{challengeId:o.authorization?.challengeId,decision:'REJECT'})}>Reject wallet top-up challenge</button></div>}
      {o.state==='AUTHORIZED'&&<button disabled={busy} onClick={()=>act(o,'execute')}>Add {formatAED(o.quote.amountMinor)} to wallet</button>}
      {['AWAITING_APPROVAL','AUTHORIZATION_PENDING','REQUIRES_ACTION','AUTHORIZED'].includes(o.state)&&<button disabled={busy} onClick={()=>act(o,'cancel')}>Cancel wallet top-up</button>}
      {o.refundState&&<p>Original top-up {o.refundState} · Returned {formatAED(o.refundedMinor||0)} from wallet to the original card. The receipt below records the original credit.</p>}
      {paymentReceiptReady(o)&&o.receipt&&<section aria-label="Confirmed wallet funding receipt"><strong>Wallet credited · {formatAED(o.receipt.amountMinor)}</strong><PaymentReceiptFacts source={o.quote.source} amountMinor={o.quote.amountMinor} feeMinor={o.quote.feeMinor} target={`Cityside wallet · ${o.accountId}`} reference={o.id} refundedMinor={o.refundedMinor} /><p>Receipt {o.receipt.receiptNumber} · From {name(o.quote.source)}</p><p>Balance after this top-up {formatAED(o.receipt.balanceMinor)} · Card captured and wallet credit confirmed</p></section>}
    </article>)}
  </section>;
}
