import { PaymentHistoryPanel } from './PaymentHistoryPanel';
import type { AccountEligibility,PaymentLifecycle } from '../../../packages/protocol-core/src/account-eligibility.ts';
import { PaymentReceiptFacts } from './PaymentReceiptFacts';
import { paymentReceiptReady } from '../../../packages/protocol-core/src/payment-history.ts';
import { PaymentRecoveryPanel } from './PaymentRecoveryPanel';
import { PaymentEventUpdates } from './PaymentEventUpdates';
import type { LegacyPaymentInspection } from '../../../packages/protocol-core/src/payment-events.ts';
import { PaymentRefundsPanel } from './PaymentRefundsPanel';
import { CheckoutGroupsPanel } from './CheckoutGroupsPanel';
import { RechargePanel } from './RechargePanel';
import { WalletFundingPanel } from './WalletFundingPanel';
import { useEffect, useRef, useState } from 'react';
import { formatAED, cardPresets, type PaymentMethod, type PaymentPreview, type BillingAccount, type PaymentOverview, type PaymentAuthorizationReview } from '../../../packages/protocol-core/src/payments.ts';
type Props = { gateway: string; accountId: string; getToken(): Promise<string>; onClose(): void };
export function PaymentAccountsPanel({ gateway, accountId, getToken, onClose }: Props) {
  const [data, setData] = useState<PaymentOverview>();
  const [eligibility,setEligibility]=useState<AccountEligibility>(),[lifecycle,setLifecycle]=useState<PaymentLifecycle>();
  const [busy, setBusy] = useState(false), [notice, setNotice] = useState('');
  const [preset, setPreset] = useState('approved'), [nickname, setNickname] = useState('My demo card');
  const [source, setSource] = useState(''), [payable, setPayable] = useState('');
  const [selectedFines,setSelectedFines]=useState<string[]>([]);
  const [preview, setPreview] = useState<PaymentPreview>();
  const [legacyInspection,setLegacyInspection]=useState<LegacyPaymentInspection>();
  const alive = useRef(true);
  const generation = useRef(0), loaded = useRef(false);
  const controller = useRef<AbortController>();
  const heading = useRef<HTMLHeadingElement>(null);
  async function api(path: string, input?: Record<string, unknown>, signal = controller.current?.signal, query:Record<string,string>={}) {
    const token = await getToken();
    if (signal?.aborted) throw new DOMException('Request cancelled', 'AbortError');
    const response = await fetch(`${gateway}/api/payments/${path}${input ? '' : `?${new URLSearchParams({accountId,...query})}`}`, {
      method: input ? 'POST' : 'GET', signal,
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      ...(input ? { body: JSON.stringify({ ...input, accountId }) } : {}),
    });
    const result = await response.json();
    if (!response.ok || result.success !== true) {if(alive.current&&result.code==='ACCOUNT_RESTRICTED'){setData(undefined);setLifecycle(undefined);setPreview(undefined);}throw new Error(result.error || 'Payment accounts unavailable.');}
    return result;
  }
  async function load(signal = controller.current?.signal, expectedGeneration = generation.current) {
    const current=(await api('eligibility',undefined,signal)).eligibility as AccountEligibility;
    if(!alive.current||expectedGeneration!==generation.current)return;
    setEligibility(current);
    if(!current.active){setData(undefined);setLifecycle(undefined);setPreview(undefined);return;}
    const [result,impact]=await Promise.all([api('overview', undefined, signal),api('lifecycle',undefined,signal)]);
    if (alive.current && expectedGeneration === generation.current) {
      setLifecycle(impact);
      setData(result);setSelectedFines(current=>current.filter(id=>result.payables.some((p:{id:string;status:string})=>p.id===id&&p.status==='UNPAID')));setPayable(current=>result.payables.some((p:{id:string;status:string})=>p.id===current&&p.status==='UNPAID')?current:'');
      if (!loaded.current) { loaded.current = true; setSource(result.defaultMethodId); }
      else setSource(current => result.methods.some((m: PaymentMethod) => m.id === current && m.status === 'ACTIVE') ? current : '');
    }
  }
  async function work(fn: () => Promise<void>) {
    setBusy(true); setNotice(''); setPreview(undefined);
    try { await fn(); await load(); } catch (e) { if (alive.current) setNotice((e as Error).message); }
    finally { if (alive.current) setBusy(false); }
  }
  const mutate = (path: string, input: Record<string, unknown>) => api(path, { ...input, requestKey: crypto.randomUUID() });
  useEffect(() => {
    alive.current = true; controller.current = new AbortController();
    loaded.current=false;setData(undefined);setEligibility(undefined);setLifecycle(undefined);setPreview(undefined);
    const current = ++generation.current;
    heading.current?.focus();
    setBusy(true);
    void load(controller.current.signal, current).catch(e => { if (alive.current && current === generation.current) setNotice(e.message); }).finally(() => { if (alive.current && current === generation.current) setBusy(false); });
    return () => { alive.current = false; controller.current?.abort(); };
  }, [accountId]);
  const available = data?.methods.filter(m => m.status === 'ACTIVE') || [];
  const linked = (provider: string, reference: string) => data?.billingAccounts.some(b => b.status === 'ACTIVE' && b.provider === provider && b.reference === reference);
  const currentPayables = data?.payables.filter(p => p.status === 'UNPAID' && !p.paymentRestricted && linked(p.provider, p.reference)) || [];
  const currentMethod = available.find(m => m.id === source);
  async function review() {
    setBusy(true); setNotice(''); setPreview(undefined);
    try { const result = await api('preview', { payableId: payable, methodId: source, expectedMethodVersion: currentMethod?.version }); if (alive.current) setPreview(result.preview); }
    catch (e) { if (alive.current) setNotice((e as Error).message); }
    finally { if (alive.current) setBusy(false); }
  }
  async function reviewFines(){
    setBusy(true);setNotice('');setPreview(undefined);
    try{const result=await api('fine-selection-preview',{items:selectedFines.map(id=>({payableId:id,expectedRevision:currentPayables.find(p=>p.id===id)?.revision})),methodId:source,expectedMethodVersion:currentMethod?.version});if(alive.current)setPreview(result.preview);}
    catch(e){if(alive.current)setNotice((e as Error).message);}finally{if(alive.current)setBusy(false);}
  }
  const linkedBalance = (b: BillingAccount) => { const current=data?.candidates.find(c=>c.provider===b.provider&&c.reference===b.reference); return current?.balanceMinor === undefined ? '' : ` · Balance ${formatAED(current.balanceMinor)}`; };
  const related = (type: 'METHOD'|'BILLER', id: string) => data?.dependencies?.filter(d=>d.resourceType===type&&d.resourceId===id)||[];
  const relatedItems = (type: 'METHOD'|'BILLER', id: string) => related(type,id).length > 0 && <aside className="payment-related" aria-label="Related payment items"><p>Removal is blocked by active items. Complete, cancel or reconcile them first.</p><ul>{related(type,id).map(d=><li key={`${d.dependentKind}:${d.dependentId}`}>{d.dependentKind.toLowerCase()} · {d.dependentId}</li>)}</ul></aside>;
  const methodName = (m: PaymentMethod) => `${m.nickname}${m.last4 ? ` ·•••• ${m.last4}` : ''}`;
  const changeStatus = (m: PaymentMethod, status: string) => work(async () => { await mutate('methods/status', { methodId: m.id, expectedVersion: m.version, status }); setNotice('Card status saved. No funding fallback was selected.'); });
  const archive = (b: BillingAccount) => work(async () => { await mutate('billing-accounts/archive', { billingAccountId: b.id, expectedVersion: b.version }); setNotice('Biller link archived. Its history is retained.'); });
  const reviewAction=(order:PaymentAuthorizationReview,action:'approve'|'challenge'|'cancel'|'execute'|'recover',extra:Record<string,unknown>={})=>work(async()=>{
    const result=await mutate(`orders/${action}`,{orderId:order.id,...(action==='recover'?{}:{expectedVersion:order.version,...(action==='cancel'?{}:{approvalDigest:order.approvalDigest})}),...extra});
    setNotice(result.order.sourceFinalizationPending?'Provider credit confirmed. Finish recharge confirmation on the original order.':result.order.state==='SETTLED'?'Payment captured and confirmed by the provider.':result.order.fundsCaptured?'Funds captured; provider settlement needs reconciliation. Use the original order.':result.order.state==='CAPTURING'?'Capture admission is pending. Inspect or resume this same order; do not start another payment.':result.order.failureCode?`Authorization stopped: ${result.order.failureCode}. No payment was captured.`:result.order.state==='AUTHORIZED'?'Funds reserved temporarily. No payment captured yet.':result.order.state==='AUTHORIZATION_PENDING'?'Simulated issuer decision pending. Card capacity is reserved; no payment captured.':result.order.state==='REQUIRES_ACTION'?'Complete the bound demo card challenge to continue.':'Authorization review cancelled. Holds released.');
  });
  return <section id="payment-account-panel" className="payment-accounts" aria-label="Payment accounts">
    <header><div><p className="payment-eyebrow">Your payment setup</p><h2 ref={heading} tabIndex={-1}>Accounts &amp; funding</h2></div><button className="text-button" onClick={onClose}>Close payment accounts</button></header>
    <p>Add demo cards, link your own biller accounts and preview a payment. Previews do not move funds.</p>
    <p role="status" className={notice ? 'payment-notice' : ''}>{busy ? 'Loading payment accounts…' : notice}</p>
    <button disabled={busy} onClick={() => void work(load)}>Refresh payment accounts</button>
    {eligibility&&!eligibility.active&&<aside role="alert" aria-label="Workspace access restricted" className="payment-review"><h3>Workspace access restricted</h3><p>{eligibility.ownerEnabled?'Your membership in this workspace is restricted.':'The owner is disabled for payment and service access.'} New authorizations and private history access are blocked. Your history and original payment IDs are retained.</p><p>Access changes require the demo operator. Refresh after access is restored. Your workspace and funding source stay selected.</p><p>Workspace {accountId} · permission version {eligibility.epoch}</p></aside>}
    {data && <>
      {lifecycle&&<section aria-label="Payment lifecycle" className="payment-review"><h3>Access &amp; in-flight work</h3><p>Workspace access active · permission version {lifecycle.eligibility.epoch}. Restoring access does not renew old approvals or move a rule to another source.</p><p>Automatic execution remains disabled. Captured payments keep their original IDs for reconciliation.</p><ul>{lifecycle.orders.map(o=><li key={o.id}>Payment {o.id} · {o.state} · Source {o.sourceId}{o.paymentId&&` · Original capture ${o.paymentId}`} · {o.fundsCaptured?'Reconcile the original capture; do not pay again.':'Cancel or review again if access or funding changed.'}{o.blockedReasons.length>0&&` · Blocked for new authority: ${o.blockedReasons.join(', ')}`}</li>)}{lifecycle.funding.map(o=><li key={o.id}>Wallet funding {o.id} · {o.state} · Source {o.sourceId}{o.blockedReasons.length>0&&` · Blocked: ${o.blockedReasons.join(', ')}`}</li>)}{lifecycle.mandates.map(m=><li key={m.id}>Rule {m.id} · policy {m.policyVersion} · {m.state} · Automatic execution disabled{m.blockedReasons.length>0&&` · New consent required: ${m.blockedReasons.join(', ')}`}</li>)}</ul>{lifecycle.orders.length+lifecycle.funding.length+lifecycle.mandates.length===0&&<p>No active payment reviews or rules.</p>}</section>}
      <div className="payment-summary"><strong>{formatAED(data.wallet.balanceMinor)}</strong><span>Current wallet · simulated funds</span><span>Available {formatAED(data.wallet.availableMinor)} · Held {formatAED(data.wallet.heldMinor)}</span></div>
      <div className="payment-grid">
        <section aria-label="Saved funding methods"><h3>Wallet &amp; demo cards</h3><p>Choose a preset, never enter real card details.</p>
          <form onSubmit={e => { e.preventDefault(); void work(async () => { await mutate('methods', { preset, nickname }); setNotice('Demo card saved for this account.'); }); }}>
            <label>Card nickname<input value={nickname} maxLength={64} onChange={e => setNickname(e.target.value)} required /></label>
            <label>Demo card preset<select value={preset} onChange={e => setPreset(e.target.value)}>{cardPresets.map(p => <option key={p.id} value={p.id}>{p.name} · {p.last4}</option>)}</select></label>
            <button disabled={busy || !nickname.trim()}>Add demo card</button>
          </form>
          <ul>{data.methods.filter(m => m.status !== 'REMOVED').map(m => <li key={m.id}>
            <strong>{methodName(m)}</strong><p>{m.status}{data.defaultMethodId === m.id ? ' · Default for future drafts' : ''}{m.expiresYear ? ` · expires ${m.expiresMonth}/${m.expiresYear}` : ''}</p>
            {data.cardBalances?.filter(b=>b.sourceId===m.id).map(b=><p key={b.sourceId}>Refunded {formatAED(b.refundedMinor||0)} · Demo limit {formatAED(b.limitMinor)} · Available {formatAED(b.availableMinor)} · Held {formatAED(b.heldMinor)} · Spent {formatAED(b.spentMinor)}</p>)}
            <div className="payment-actions"><button disabled={busy || m.status !== 'ACTIVE' || data.defaultMethodId === m.id} onClick={() => void work(async () => { await mutate('methods/default', { methodId: m.id, expectedVersion: m.version }); setNotice('Default saved for future drafts. Existing approvals are unchanged.'); })}>Use {m.nickname} as default</button>
              {m.kind === 'card' && <>{m.status !== 'EXPIRED' && <button disabled={busy} onClick={() => void changeStatus(m, m.status === 'ACTIVE' ? 'DISABLED' : 'ACTIVE')}>{m.status === 'ACTIVE' ? 'Disable' : 'Enable'} {m.nickname}</button>}<button disabled={busy || data.defaultMethodId === m.id || related('METHOD',m.id).length > 0} onClick={() => void changeStatus(m, 'REMOVED')}>Remove {m.nickname}</button></>}
            </div>{relatedItems('METHOD',m.id)}
          </li>)}</ul>
        </section>
        <section aria-label="Linked biller accounts"><h3>Your biller accounts</h3><p>Only resources verified by their provider can be linked.</p>
          <ul>{data.candidates.filter(c => !linked(c.provider, c.reference)).map(c => <li key={`${c.provider}:${c.reference}`}><strong>{c.label}</strong><p>{c.reference}{c.balanceMinor !== undefined ? ` · Balance ${formatAED(c.balanceMinor)}` : ''}</p><button disabled={busy} onClick={() => void work(async () => { await mutate('billing-accounts', { provider: c.provider, reference: c.reference, nickname: c.label.slice(0,64) }); setNotice('Owned biller account linked.'); })}>Link {c.label}</button></li>)}</ul>
          <ul>{data.billingAccounts.filter(b => b.status === 'ACTIVE').map(b => <li key={b.id}><strong>{b.nickname}</strong><p>{b.reference} · verified owner{linkedBalance(b)}</p>{relatedItems('BILLER',b.id)}<button disabled={busy || related('BILLER',b.id).length > 0} onClick={() => void archive(b)}>Archive {b.nickname}</button></li>)}</ul>
          {!data.billingAccounts.some(b => b.status === 'ACTIVE') && <p>No biller accounts linked yet.</p>}
        </section>
      </div>
      <PaymentEventUpdates events={data.events} busy={busy} inspect={(kind,id)=>void work(async()=>{if(kind==='LEGACY_PAYMENT'){const result=await api('legacy-status',undefined,controller.current?.signal,{paymentId:id});if(alive.current)setLegacyInspection(result.inspection);setNotice('Original capture and provider attempt inspected. No new charge, refund or service effect requested.');}else{await mutate(kind==='REFUND'?'refunds/recover':'orders/recover',{orderId:id});setNotice('Original operation inspected using current payment/provider state. Review its order and receipt below.');}})} />
      {legacyInspection&&<section aria-label="Original capture inspection" className="payment-review"><h3>Original capture inspection</h3><p>{legacyInspection.merchant.toUpperCase()} · {formatAED(legacyInspection.amountMinor)} · Funding {legacyInspection.source}</p><p>Payment {legacyInspection.paymentId} · Reference {legacyInspection.reference}</p><p>Current capture state: {legacyInspection.state}</p><p>Gateway claim: {legacyInspection.gatewayClaim} · Provider attempt: {legacyInspection.sourceState} · Gateway confirmation: {legacyInspection.gatewayConfirmed?'confirmed':'not confirmed'}</p><p>These are current original-operation reads. They do not create a payment or a new service receipt.</p></section>}
      <PaymentHistoryPanel key={`history:${accountId}`} busy={busy} read={(path,query)=>api(path,undefined,controller.current?.signal,query)} work={work} />
      <PaymentRecoveryPanel key={accountId} busy={busy} read={(path,query)=>api(path,undefined,controller.current?.signal,query)} mutate={mutate} work={work} />
      <WalletFundingPanel methods={data.methods} orders={data.fundingOrders||[]} busy={busy}
        create={input=>void work(async()=>{await mutate('wallet-funding-orders',input);setNotice('Wallet top-up review saved. Approve its exact source and amount before adding funds.');})}
        act={(order,action,extra={})=>void work(async()=>{const result=await mutate(`wallet-funding-orders/${action}`,{orderId:order.id,expectedVersion:order.version,...(action==='cancel'?{}:{approvalDigest:order.approvalDigest}),...extra});setNotice(result.order.state==='SETTLED'?'Card captured and wallet credited once.':result.order.state==='FAILED'?`Top-up stopped: ${result.order.failureCode}. No wallet credit.`:result.order.state==='CANCELLED'?'Wallet top-up cancelled. No funds added.':result.order.state==='AUTHORIZATION_PENDING'?'Waiting for the simulated issuer decision; no wallet credit yet.':result.order.state==='REQUIRES_ACTION'?'Approve or reject this exact wallet top-up challenge.':'Card capacity reserved. Use Add to complete the top-up.');})} />
      <RechargePanel targets={data.rechargeTargets||[]} methods={data.methods} links={data.billingAccounts} busy={busy} review={input=>void work(async()=>{const result=await mutate('recharge-preview',input);setPreview(result.preview);setNotice('Recharge review ready. Confirm this exact target, amount and source before payment.');})} />
      <PaymentRefundsPanel orders={data.orders||[]} funding={data.fundingOrders||[]} refunds={data.refunds||[]} busy={busy}
        create={input=>void work(async()=>{await mutate('refunds',input);setNotice('Refund review saved. Read its original source, amount and provider cancellation before approving.');})}
        act={(refund,action)=>void work(async()=>{const result=await mutate(`refunds/${action}`,{orderId:refund.id,...(action==='recover'?{}:{expectedVersion:refund.version,...(action==='cancel'?{}:{approvalDigest:refund.approvalDigest})})});setNotice(result.refund.state==='REFUNDED'?'Reversal confirmed and funds returned once to the original source.':result.refund.state==='FAILED'?`Refund declined: ${result.refund.failureCode}. No money returned.`:result.refund.state==='CANCELLED'?'Unstarted refund cancelled.':'Reversal outcome needs reconciliation. Inspect this same refund before another request.');})} />
      <CheckoutGroupsPanel payables={preview?.payable.kind==='RECHARGE'?[...currentPayables,preview.payable]:currentPayables} methods={data.methods} groups={data.checkoutGroups||[]} busy={busy}
        create={input=>void work(async()=>{await mutate('checkout-groups',input);setNotice('Group saved with one funding source. Read every line and the exact total before approving.');})}
        act={(group,action)=>void work(async()=>{const result=await mutate(`checkout-groups/${action}`,{orderId:group.id,expectedVersion:group.version,...(action==='cancel'?{}:{approvalDigest:group.approvalDigest})});setNotice(result.group.state==='COMPLETED'?'Every included payment has a confirmed provider receipt.':result.group.state==='AUTHORIZATION_PENDING'?'Checkout is waiting for the simulated issuer; later lines remain unpaid.':result.group.state==='REQUIRES_ACTION'?'Checkout stopped for a demo card challenge. Answer the original child review, then continue the group.':result.group.state==='RECONCILIATION_REQUIRED'?'Checkout stopped. Inspect or resume the original child payment before later lines.':action==='approve'?'Exact group approved. Continue to pay each line sequentially.':action==='cancel'?'Remaining group payments stopped. Prior receipts and captured payment recovery are preserved.':'Checkout stopped. Review the original child statuses before continuing.');})} />
      <section className="payment-obligations" aria-label="Bills and fines"><h3>Bills &amp; fines</h3><p>Current provider amounts and earlier cycles for your linked accounts. Settled opening fixtures are labelled and do not represent a new payment.</p>
        <ul>{data.payables.filter(p=>linked(p.provider,p.reference)).map(p=><li key={p.id}>
          <strong>{p.label}</strong><p>{formatAED(p.amountMinor)} · {p.status} · {p.dueState || 'CURRENT'}{p.version ? ` · revision ${p.version}` : ''}</p>
          {p.dueDate && <p>Due {p.dueDate}{p.period ? ` · Cycle ${p.period}` : ''}</p>}
          {!!p.discountMinor && <p>Discount {formatAED(p.discountMinor)}{p.discountExpiresAt ? ` · until ${new Date(p.discountExpiresAt).toLocaleString()}` : ''}</p>}
          {p.paymentRestricted && <p>Additional review required before this fine can be paid.</p>}{p.openingFixture && <p>Seeded settled history · no new charge</p>}
        </li>)}</ul>
        {!data.payables.some(p=>linked(p.provider,p.reference)) && <p>Link a biller account to view its obligations.</p>}
      </section>
      <section className="payment-review" aria-label="Payment review"><h3>Review a payment</h3><p>Review the current bill or fine with your chosen source. Save and approve the exact bill or fine authorization review, then use Pay to complete payment. Select multiple fines below to pay that exact set together.</p>
        <label>Unpaid obligation<select value={payable} onChange={e => { setPayable(e.target.value); setPreview(undefined); }}><option value="">Choose a linked bill or fine</option>{currentPayables.map(p => <option key={p.id} value={p.id}>{p.label} · {formatAED(p.amountMinor)}</option>)}</select></label>
        <label>Payment source<select value={source} onChange={e => { setSource(e.target.value); setPreview(undefined); }}><option value="">Choose a funding source</option>{available.map(m => <option key={m.id} value={m.id}>{methodName(m)}</option>)}</select></label>
        <fieldset className="payment-fine-selection"><legend>Select traffic fines to pay together</legend><p>Choose up to 20 current fines for one linked vehicle.</p>{data.payables.filter(p=>p.kind==='FINE'&&p.status==='UNPAID'&&linked(p.provider,p.reference)).map(p=><label key={p.id}><input type="checkbox" checked={selectedFines.includes(p.id)} disabled={busy||p.paymentRestricted} onChange={e=>{setPreview(undefined);setSelectedFines(current=>e.target.checked?[...current,p.id]:current.filter(id=>id!==p.id));}} />{p.obligationId} · {formatAED(p.amountMinor)}{p.paymentRestricted?' · Additional review required':''}</label>)}<button disabled={busy||!selectedFines.length||selectedFines.length>20||!currentMethod} onClick={()=>void reviewFines()}>Review selected fines</button></fieldset>
        <button disabled={busy || !payable || !currentMethod} onClick={() => void review()}>Review payment quote</button>
        {preview && <article aria-label="Payment quote preview"><h4>{preview.billingAccount.nickname}</h4><p>{preview.payable.label}</p><p>Funding: {methodName(preview.source)}</p>{preview.payable.recharge&&<p>Provider target {preview.payable.reference} · Balance before {formatAED(preview.payable.recharge.balanceBeforeMinor)} · Credit {formatAED(preview.amountMinor)}</p>}{preview.payable.items&&<ul>{preview.payable.items.map(p=><li key={p.id}>{p.obligationId} · {formatAED(p.amountMinor)} · Discount {formatAED(p.discountMinor||0)}</li>)}</ul>}<p>Amount: {formatAED(preview.amountMinor)} · Fees: {formatAED(preview.feeMinor)}</p><strong>Total: {formatAED(preview.totalMinor)}</strong><p>Review expires {new Date(preview.expiresAt).toLocaleTimeString()}. Preview only — this is not an approval or receipt.</p><button onClick={() => setPreview(undefined)}>Dismiss payment review</button><button disabled={busy} onClick={()=>void work(async()=>{await mutate('orders',{provider:preview.payable.provider,payableId:preview.payable.id,expectedPayableRevision:preview.payable.revision,methodId:preview.source.id,expectedMethodVersion:preview.source.version});setNotice('Authorization review saved. Read its exact terms before approving.');})}>Create authorization review</button></article>}
      </section>
      <section aria-label="Authorization reviews" className="payment-review"><h3>Authorization reviews</h3><p>Approval reserves finite funds temporarily. For bills and fines, authorize first and then explicitly pay the exact total. Pending or captured operations retain their original identity for recovery. Refresh to inspect current status.</p>
        {!data.orders?.length&&<p>No stored authorization reviews yet.</p>}
        {data.orders?.map(order=><article key={order.id} aria-label={`Authorization review ${order.id}`}>
          <h4>{order.quote.billingAccount.nickname}</h4><p>{order.quote.payable.label}</p>{order.quote.payable.items&&<ul>{order.quote.payable.items.map(p=><li key={p.id}>{p.obligationId} · {formatAED(p.amountMinor)} · Discount {formatAED(p.discountMinor||0)}</li>)}</ul>}<p>Funding: {methodName(order.quote.source)} · source version {order.quote.source.version}</p>
          <p>Amount {formatAED(order.quote.amountMinor)} · Fees {formatAED(order.quote.feeMinor)} · Total {formatAED(order.quote.totalMinor)}</p><p>State: {order.state}{order.failureCode?` · ${order.failureCode}`:''}</p>
          <p>Review expires {new Date(order.expiresAt).toLocaleTimeString()}</p>
          {order.state==='AWAITING_APPROVAL'&&<button disabled={busy} onClick={()=>void reviewAction(order,'approve')}>Approve authorization for {formatAED(order.quote.totalMinor)}</button>}
          {order.state==='AUTHORIZATION_PENDING'&&<p>Waiting for the simulated card issuer. Capacity is reserved; no payment was captured. Refresh after the run operator resolves the issuer decision.</p>}
          {order.state==='REQUIRES_ACTION'&&<div><p>Demo card challenge: explicitly approve or reject this order and amount. No code or real card details are required.</p><button disabled={busy} onClick={()=>void reviewAction(order,'challenge',{challengeId:order.authorization?.challengeId,decision:'APPROVE'})}>Approve demo card challenge</button><button disabled={busy} onClick={()=>void reviewAction(order,'challenge',{challengeId:order.authorization?.challengeId,decision:'REJECT'})}>Reject demo card challenge</button></div>}
          {order.state==='AUTHORIZED'&&<p>Funds reserved until {new Date(order.authorization!.expiresAt).toLocaleTimeString()}. No payment captured yet.</p>}
          {order.state==='AUTHORIZED'&&['BILL','FINE','FINE_SET','RECHARGE'].includes(order.quote.payable.kind||'')&&<button disabled={busy} onClick={()=>void reviewAction(order,'execute')}>Pay {formatAED(order.quote.totalMinor)}</button>}
          {['CAPTURING','CAPTURED','RECONCILIATION_REQUIRED'].includes(order.state)&&<div><p>{order.fundsCaptured?'Funds captured; this is not yet a confirmed payment receipt.':'Capture status is pending. Do not start another payment.'}</p><button disabled={busy} onClick={()=>void reviewAction(order,'recover')}>Inspect or resume payment</button></div>}
          {order.refundState&&<p>Original payment {order.refundState} · Returned {formatAED(order.refundedMinor||0)} to {methodName(order.quote.source)}. The receipt below records the original capture.</p>}
          {paymentReceiptReady(order)&&order.receipt&&<section aria-label={order.quote.payable.kind==='RECHARGE'?'Confirmed recharge receipt':order.quote.payable.kind==='BILL'?'Confirmed bill receipt':'Confirmed fine receipt'}><strong>{order.quote.payable.kind==='RECHARGE'?'Recharge applied':order.quote.payable.kind==='BILL'?'Bill paid':'Fines paid'} · {formatAED(order.receipt.amountMinor)}</strong><p>Receipt {order.receipt.receiptNumber}</p><PaymentReceiptFacts source={order.quote.source} amountMinor={order.quote.amountMinor} feeMinor={order.quote.feeMinor} target={`${order.quote.billingAccount.nickname} · ${order.quote.billingAccount.reference}`} reference={order.paymentId!} refundedMinor={order.refundedMinor} /><p>Paid from {methodName(order.quote.source)} · Provider confirmed</p>{order.quote.payable.kind==='RECHARGE'&&<p>Target {order.receipt.targetReference} · Provider balance after {formatAED(order.receipt.providerBalanceMinor!)}</p>}</section>}
          {order.state==='SETTLED'&&order.sourceFinalizationPending&&<div><p>Provider credit is confirmed. Finish confirmation before another recharge to this target.</p><button disabled={busy} onClick={()=>void reviewAction(order,'recover')}>Finish recharge confirmation</button></div>}
          {['AWAITING_APPROVAL','AUTHORIZATION_PENDING','REQUIRES_ACTION','AUTHORIZED'].includes(order.state)&&<button disabled={busy} onClick={()=>void reviewAction(order,'cancel')}>Cancel authorization review</button>}
        </article>)}
      </section>
    </>}
  </section>;
}
