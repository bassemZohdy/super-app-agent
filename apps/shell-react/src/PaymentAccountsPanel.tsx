import { useEffect, useRef, useState } from 'react';
import { formatAED, cardPresets, type PaymentMethod, type PaymentPreview, type BillingAccount, type PaymentOverview, type PaymentAuthorizationReview } from '../../../packages/protocol-core/src/payments.ts';
type Props = { gateway: string; accountId: string; getToken(): Promise<string>; onClose(): void };
export function PaymentAccountsPanel({ gateway, accountId, getToken, onClose }: Props) {
  const [data, setData] = useState<PaymentOverview>();
  const [busy, setBusy] = useState(false), [notice, setNotice] = useState('');
  const [preset, setPreset] = useState('approved'), [nickname, setNickname] = useState('My demo card');
  const [source, setSource] = useState(''), [payable, setPayable] = useState('');
  const [preview, setPreview] = useState<PaymentPreview>();
  const alive = useRef(true);
  const generation = useRef(0), loaded = useRef(false);
  const controller = useRef<AbortController>();
  const heading = useRef<HTMLHeadingElement>(null);
  async function api(path: string, input?: Record<string, unknown>, signal = controller.current?.signal) {
    const token = await getToken();
    if (signal?.aborted) throw new DOMException('Request cancelled', 'AbortError');
    const response = await fetch(`${gateway}/api/payments/${path}${input ? '' : `?accountId=${encodeURIComponent(accountId)}`}`, {
      method: input ? 'POST' : 'GET', signal,
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      ...(input ? { body: JSON.stringify({ ...input, accountId }) } : {}),
    });
    const result = await response.json();
    if (!response.ok || result.success !== true) throw new Error(result.error || 'Payment accounts unavailable.');
    return result;
  }
  async function load(signal = controller.current?.signal, expectedGeneration = generation.current) {
    const result = await api('overview', undefined, signal);
    if (alive.current && expectedGeneration === generation.current) {
      setData(result);
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
  const linkedBalance = (b: BillingAccount) => { const current=data?.candidates.find(c=>c.provider===b.provider&&c.reference===b.reference); return current?.balanceMinor === undefined ? '' : ` · Balance ${formatAED(current.balanceMinor)}`; };
  const related = (type: 'METHOD'|'BILLER', id: string) => data?.dependencies?.filter(d=>d.resourceType===type&&d.resourceId===id)||[];
  const relatedItems = (type: 'METHOD'|'BILLER', id: string) => related(type,id).length > 0 && <aside className="payment-related" aria-label="Related payment items"><p>Removal is blocked by active items. Complete, cancel or reconcile them first.</p><ul>{related(type,id).map(d=><li key={`${d.dependentKind}:${d.dependentId}`}>{d.dependentKind.toLowerCase()} · {d.dependentId}</li>)}</ul></aside>;
  const methodName = (m: PaymentMethod) => `${m.nickname}${m.last4 ? ` ·•••• ${m.last4}` : ''}`;
  const changeStatus = (m: PaymentMethod, status: string) => work(async () => { await mutate('methods/status', { methodId: m.id, expectedVersion: m.version, status }); setNotice('Card status saved. No funding fallback was selected.'); });
  const archive = (b: BillingAccount) => work(async () => { await mutate('billing-accounts/archive', { billingAccountId: b.id, expectedVersion: b.version }); setNotice('Biller link archived. Its history is retained.'); });
  const reviewAction=(order:PaymentAuthorizationReview,action:'approve'|'challenge'|'cancel',extra:Record<string,unknown>={})=>work(async()=>{
    const result=await mutate(`orders/${action}`,{orderId:order.id,expectedVersion:order.version,...(action==='cancel'?{}:{approvalDigest:order.approvalDigest}),...extra});
    setNotice(result.order.failureCode?`Authorization stopped: ${result.order.failureCode}. No payment was captured.`:result.order.state==='AUTHORIZED'?'Funds reserved temporarily. No payment captured or bill settled.':result.order.state==='REQUIRES_ACTION'?'Complete the bound demo card challenge to continue.':'Authorization review cancelled. Holds released.');
  });
  return <section id="payment-account-panel" className="payment-accounts" aria-label="Payment accounts">
    <header><div><p className="payment-eyebrow">Your payment setup</p><h2 ref={heading} tabIndex={-1}>Accounts &amp; funding</h2></div><button className="text-button" onClick={onClose}>Close payment accounts</button></header>
    <p>Add demo cards, link your own biller accounts and preview a payment. Previews do not move funds.</p>
    <p role="status" className={notice ? 'payment-notice' : ''}>{busy ? 'Loading payment accounts…' : notice}</p>
    <button disabled={busy} onClick={() => void work(load)}>Refresh payment accounts</button>
    {data && <>
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
            {data.cardBalances?.filter(b=>b.sourceId===m.id).map(b=><p key={b.sourceId}>Demo limit {formatAED(b.limitMinor)} · Available {formatAED(b.availableMinor)} · Held {formatAED(b.heldMinor)} · Spent {formatAED(b.spentMinor)}</p>)}
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
      <section className="payment-obligations" aria-label="Bills and fines"><h3>Bills &amp; fines</h3><p>Current provider amounts and earlier cycles for your linked accounts. Settled opening fixtures are labelled and do not represent a new payment.</p>
        <ul>{data.payables.filter(p=>linked(p.provider,p.reference)).map(p=><li key={p.id}>
          <strong>{p.label}</strong><p>{formatAED(p.amountMinor)} · {p.status} · {p.dueState || 'CURRENT'}{p.version ? ` · revision ${p.version}` : ''}</p>
          {p.dueDate && <p>Due {p.dueDate}{p.period ? ` · Cycle ${p.period}` : ''}</p>}
          {!!p.discountMinor && <p>Discount {formatAED(p.discountMinor)}{p.discountExpiresAt ? ` · until ${new Date(p.discountExpiresAt).toLocaleString()}` : ''}</p>}
          {p.paymentRestricted && <p>Additional review required before this fine can be paid.</p>}{p.openingFixture && <p>Seeded settled history · no new charge</p>}
        </li>)}</ul>
        {!data.payables.some(p=>linked(p.provider,p.reference)) && <p>Link a biller account to view its obligations.</p>}
      </section>
      <section className="payment-review" aria-label="Payment review"><h3>Review a payment</h3><p>Review the current bill or fine with your chosen source. This screen creates a preview only; existing wallet payments are available from the service navigation.</p>
        <label>Unpaid obligation<select value={payable} onChange={e => { setPayable(e.target.value); setPreview(undefined); }}><option value="">Choose a linked bill or fine</option>{currentPayables.map(p => <option key={p.id} value={p.id}>{p.label} · {formatAED(p.amountMinor)}</option>)}</select></label>
        <label>Payment source<select value={source} onChange={e => { setSource(e.target.value); setPreview(undefined); }}><option value="">Choose a funding source</option>{available.map(m => <option key={m.id} value={m.id}>{methodName(m)}</option>)}</select></label>
        <button disabled={busy || !payable || !currentMethod} onClick={() => void review()}>Review payment quote</button>
        {preview && <article aria-label="Payment quote preview"><h4>{preview.billingAccount.nickname}</h4><p>{preview.payable.label}</p><p>Funding: {methodName(preview.source)}</p><p>Amount: {formatAED(preview.amountMinor)} · Fees: {formatAED(preview.feeMinor)}</p><strong>Total: {formatAED(preview.totalMinor)}</strong><p>Review expires {new Date(preview.expiresAt).toLocaleTimeString()}. Preview only — this is not an approval or receipt.</p><button onClick={() => setPreview(undefined)}>Dismiss payment review</button><button disabled={busy} onClick={()=>void work(async()=>{await mutate('orders',{provider:preview.payable.provider,payableId:preview.payable.id,expectedPayableRevision:preview.payable.revision,methodId:preview.source.id,expectedMethodVersion:preview.source.version});setNotice('Authorization review saved. Read its exact terms before approving.');})}>Create authorization review</button></article>}
      </section>
      <section aria-label="Authorization reviews" className="payment-review"><h3>Authorization reviews</h3><p>Approval reserves finite funds temporarily. Payment capture and provider settlement are not enabled here. Refresh to inspect expiry and current status.</p>
        {!data.orders?.length&&<p>No stored authorization reviews yet.</p>}
        {data.orders?.map(order=><article key={order.id} aria-label={`Authorization review ${order.id}`}>
          <h4>{order.quote.billingAccount.nickname}</h4><p>{order.quote.payable.label}</p><p>Funding: {methodName(order.quote.source)} · source version {order.quote.source.version}</p>
          <p>Amount {formatAED(order.quote.amountMinor)} · Fees {formatAED(order.quote.feeMinor)} · Total {formatAED(order.quote.totalMinor)}</p><p>State: {order.state}{order.failureCode?` · ${order.failureCode}`:''}</p>
          <p>Review expires {new Date(order.expiresAt).toLocaleTimeString()}</p>
          {order.state==='AWAITING_APPROVAL'&&<button disabled={busy} onClick={()=>void reviewAction(order,'approve')}>Approve authorization for {formatAED(order.quote.totalMinor)}</button>}
          {order.state==='REQUIRES_ACTION'&&<div><p>Demo card challenge: explicitly approve or reject this order and amount. No code or real card details are required.</p><button disabled={busy} onClick={()=>void reviewAction(order,'challenge',{challengeId:order.authorization?.challengeId,decision:'APPROVE'})}>Approve demo card challenge</button><button disabled={busy} onClick={()=>void reviewAction(order,'challenge',{challengeId:order.authorization?.challengeId,decision:'REJECT'})}>Reject demo card challenge</button></div>}
          {order.state==='AUTHORIZED'&&<p>Funds reserved until {new Date(order.authorization!.expiresAt).toLocaleTimeString()}. No payment captured.</p>}
          {['AWAITING_APPROVAL','REQUIRES_ACTION','AUTHORIZED'].includes(order.state)&&<button disabled={busy} onClick={()=>void reviewAction(order,'cancel')}>Cancel authorization review</button>}
        </article>)}
      </section>
    </>}
  </section>;
}
