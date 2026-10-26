import { PaymentReservations } from './PaymentReservations';
import { PaymentHistoryPanel } from './PaymentHistoryPanel';
import { MandateConsentPanel } from './MandateConsentPanel';
import { AutomationInboxPanel } from './AutomationInboxPanel';
import { KillSwitchPanel } from './KillSwitchPanel';
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
import { translate, type CatalogKey, type Locale } from '../../../packages/protocol-core/src/i18n.ts';
import { formatAED, cardPresets, type PaymentMethod, type PaymentPreview, type BillingAccount, type PaymentOverview, type PaymentAuthorizationReview } from '../../../packages/protocol-core/src/payments.ts';
type Props = { gateway: string; accountId: string; getToken(): Promise<string>; onClose(): void; locale?: Locale };
export function PaymentAccountsPanel({ gateway, accountId, getToken, onClose, locale = 'en' }: Props) {
  const t = (key: CatalogKey, values?: Record<string, string | number>) => translate(locale, key, values);
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
  const linkedBalance = (b: BillingAccount) => { const current=data?.candidates.find(c=>c.provider===b.provider&&c.reference===b.reference); return current?.balanceMinor === undefined ? '' : t('payments.balance', { amount: formatAED(current.balanceMinor) }); };
  const related = (type: 'METHOD'|'BILLER', id: string) => data?.dependencies?.filter(d=>d.resourceType===type&&d.resourceId===id)||[];
  const relatedItems = (type: 'METHOD'|'BILLER', id: string) => related(type,id).length > 0 && <aside className="payment-related" aria-label="Related payment items"><p>Removal is blocked by active items. Complete, cancel or reconcile them first.</p><ul>{related(type,id).map(d=><li key={`${d.dependentKind}:${d.dependentId}`}>{d.dependentKind.toLowerCase()} · {d.dependentId}</li>)}</ul></aside>;
  const methodName = (m: PaymentMethod) => `${m.nickname}${m.last4 ? ` ·•••• ${m.last4}` : ''}`;
  const changeStatus = (m: PaymentMethod, status: string) => work(async () => { await mutate('methods/status', { methodId: m.id, expectedVersion: m.version, status }); setNotice('Card status saved. No funding fallback was selected.'); });
  const archive = (b: BillingAccount) => work(async () => { await mutate('billing-accounts/archive', { billingAccountId: b.id, expectedVersion: b.version }); setNotice('Biller link archived. Its history is retained.'); });
  const reviewAction=(order:PaymentAuthorizationReview,action:'approve'|'challenge'|'cancel'|'execute'|'recover',extra:Record<string,unknown>={})=>work(async()=>{
    const result=await mutate(`orders/${action}`,{orderId:order.id,...(action==='recover'?{}:{expectedVersion:order.version,...(action==='cancel'?{}:{approvalDigest:order.approvalDigest})}),...extra});
    setNotice(result.order.sourceFinalizationPending?t('payments.n.rechargeConfirmed'):result.order.state==='SETTLED'?t('payments.n.settled'):result.order.fundsCaptured?t('payments.n.reconcile'):result.order.state==='CAPTURING'?t('payments.n.capturing'):result.order.failureCode?t('payments.n.stopped',{code:result.order.failureCode}):result.order.state==='AUTHORIZED'?t('payments.n.authorized'):result.order.state==='AUTHORIZATION_PENDING'?t('payments.n.pending'):result.order.state==='REQUIRES_ACTION'?t('payments.n.action'):t('payments.n.cancelled'));
  });
  return <section id="payment-account-panel" className="payment-accounts" aria-label={t('tools.paymentAccounts')}>
    <header><div><p className="payment-eyebrow">{t('payments.eyebrow')}</p><h2 ref={heading} tabIndex={-1}>{t('payments.heading')}</h2></div><button className="text-button" onClick={onClose}>{t('payments.close')}</button></header>
    <p>{t('payments.intro')}</p>
    <p role="status" className={notice ? 'payment-notice' : ''}>{busy ? t('payments.loading') : notice}</p>
    <button disabled={busy} onClick={() => void work(load)}>{t('payments.refresh')}</button>
    {eligibility&&!eligibility.active&&<aside role="alert" aria-label="Workspace access restricted" className="payment-review"><h3>Workspace access restricted</h3><p>{eligibility.ownerEnabled?'Your membership in this workspace is restricted.':'The owner is disabled for payment and service access.'} New authorizations and private history access are blocked. Your history and original payment IDs are retained.</p><p>Access changes require the demo operator. Refresh after access is restored. Your workspace and funding source stay selected.</p><p>Workspace {accountId} · permission version {eligibility.epoch}</p></aside>}
    {data && <>
      {lifecycle&&<section aria-label="Payment lifecycle" className="payment-review"><h3>Access &amp; in-flight work</h3><p>Workspace access active · permission version {lifecycle.eligibility.epoch}. Restoring access does not renew old approvals or move a rule to another source.</p><p>Automatic execution remains disabled. Captured payments keep their original IDs for reconciliation.</p><ul>{lifecycle.orders.map(o=><li key={o.id}>Payment {o.id} · {o.state} · Source {o.sourceId}{o.paymentId&&` · Original payment ${o.paymentId}`} · {o.fundsCaptured?'Reconcile the original capture; do not pay again.':o.state==='CAPTURING'?'Inspect the original attempt; do not create another payment.':'Cancel or review again if access or funding changed.'}{o.blockedReasons.length>0&&` · Blocked for new authority: ${o.blockedReasons.join(', ')}`}</li>)}{lifecycle.funding.map(o=><li key={o.id}>Wallet funding {o.id} · {o.state} · Source {o.sourceId}{o.blockedReasons.length>0&&` · Blocked: ${o.blockedReasons.join(', ')}`}</li>)}{lifecycle.mandates.map(m=><li key={m.id}>Rule {m.id} · policy {m.policyVersion} · {m.state} · Automatic execution disabled{m.blockedReasons.length>0&&` · New consent required: ${m.blockedReasons.join(', ')}`}</li>)}</ul>{lifecycle.orders.length+lifecycle.funding.length+lifecycle.mandates.length===0&&<p>No active payment reviews or rules.</p>}<PaymentReservations lifecycle={lifecycle} /></section>}
      <div className="payment-summary"><strong>{formatAED(data.wallet.balanceMinor)}</strong><span>{t('payments.walletLabel')}</span><span>{t('payments.walletBreakdown', { available: formatAED(data.wallet.availableMinor), held: formatAED(data.wallet.heldMinor) })}</span></div>
      <div className="payment-grid">
        <section aria-label={t('payments.methodsLabel')}><h3>{t('payments.methodsTitle')}</h3><p>{t('payments.methodsHint')}</p>
          <form onSubmit={e => { e.preventDefault(); void work(async () => { await mutate('methods', { preset, nickname }); setNotice(t('payments.cardSaved')); }); }}>
            <label>{t('payments.cardNickname')}<input value={nickname} maxLength={64} onChange={e => setNickname(e.target.value)} required /></label>
            <label>{t('payments.cardPreset')}<select value={preset} onChange={e => setPreset(e.target.value)}>{cardPresets.map(p => <option key={p.id} value={p.id}>{p.name} · {p.last4}</option>)}</select></label>
            <button disabled={busy || !nickname.trim()}>{t('payments.addCard')}</button>
          </form>
          <ul>{data.methods.filter(m => m.status !== 'REMOVED').map(m => <li key={m.id}>
            <strong>{methodName(m)}</strong><p>{m.status}{data.defaultMethodId === m.id ? t('payments.defaultFlag') : ''}{m.expiresYear ? t('payments.expires', { month: m.expiresMonth ?? '', year: m.expiresYear }) : ''}</p>
            {data.cardBalances?.filter(b=>b.sourceId===m.id).map(b=><p key={b.sourceId}>Refunded {formatAED(b.refundedMinor||0)} · Demo limit {formatAED(b.limitMinor)} · Available {formatAED(b.availableMinor)} · Held {formatAED(b.heldMinor)} · Spent {formatAED(b.spentMinor)}</p>)}
            <div className="payment-actions"><button disabled={busy || m.status !== 'ACTIVE' || data.defaultMethodId === m.id} onClick={() => void work(async () => { await mutate('methods/default', { methodId: m.id, expectedVersion: m.version }); setNotice(t('payments.defaultSaved')); })}>{t('payments.useDefault', { name: m.nickname })}</button>
              {m.kind === 'card' && <>{m.status !== 'EXPIRED' && <button disabled={busy} onClick={() => void changeStatus(m, m.status === 'ACTIVE' ? 'DISABLED' : 'ACTIVE')}>{t(m.status === 'ACTIVE' ? 'payments.disable' : 'payments.enable', { name: m.nickname })}</button>}<button disabled={busy || data.defaultMethodId === m.id || related('METHOD',m.id).length > 0} onClick={() => void changeStatus(m, 'REMOVED')}>{t('payments.remove', { name: m.nickname })}</button></>}
            </div>{relatedItems('METHOD',m.id)}
          </li>)}</ul>
        </section>
        <section aria-label={t('payments.billersLabel')}><h3>{t('payments.billersTitle')}</h3><p>{t('payments.billersHint')}</p>
          <ul>{data.candidates.filter(c => !linked(c.provider, c.reference)).map(c => <li key={`${c.provider}:${c.reference}`}><strong>{c.label}</strong><p>{c.reference}{c.balanceMinor !== undefined ? t('payments.balance', { amount: formatAED(c.balanceMinor) }) : ''}</p><button disabled={busy} onClick={() => void work(async () => { await mutate('billing-accounts', { provider: c.provider, reference: c.reference, nickname: c.label.slice(0,64) }); setNotice(t('payments.linked')); })}>{t('payments.link', { name: c.label })}</button></li>)}</ul>
          <ul>{data.billingAccounts.filter(b => b.status === 'ACTIVE').map(b => <li key={b.id}><strong>{b.nickname}</strong><p>{b.reference}{t('payments.verifiedOwner')}{linkedBalance(b)}</p>{relatedItems('BILLER',b.id)}<button disabled={busy || related('BILLER',b.id).length > 0} onClick={() => void archive(b)}>{t('payments.archive', { name: b.nickname })}</button></li>)}</ul>
          {!data.billingAccounts.some(b => b.status === 'ACTIVE') && <p>{t('payments.noBillers')}</p>}
        </section>
      </div>
      <PaymentEventUpdates events={data.events} busy={busy} inspect={(kind,id)=>void work(async()=>{if(kind==='LEGACY_PAYMENT'){const result=await api('legacy-status',undefined,controller.current?.signal,{paymentId:id});if(alive.current)setLegacyInspection(result.inspection);setNotice('Original capture and provider attempt inspected. No new charge, refund or service effect requested.');}else{await mutate(kind==='REFUND'?'refunds/recover':'orders/recover',{orderId:id});setNotice('Original operation inspected using current payment/provider state. Review its order and receipt below.');}})} />
      {legacyInspection&&<section aria-label="Original capture inspection" className="payment-review"><h3>Original capture inspection</h3><p>{legacyInspection.merchant.toUpperCase()} · {formatAED(legacyInspection.amountMinor)} · Funding {legacyInspection.source}</p><p>Payment {legacyInspection.paymentId} · Reference {legacyInspection.reference}</p><p>Current capture state: {legacyInspection.state}</p><p>Gateway claim: {legacyInspection.gatewayClaim} · Provider attempt: {legacyInspection.sourceState} · Gateway confirmation: {legacyInspection.gatewayConfirmed?'confirmed':'not confirmed'}</p><p>These are current original-operation reads. They do not create a payment or a new service receipt.</p></section>}
      <PaymentHistoryPanel key={`history:${accountId}`} busy={busy} read={(path,query)=>api(path,undefined,controller.current?.signal,query)} work={work} />
      <AutomationInboxPanel key={`inbox:${accountId}`} busy={busy} read={(path,query)=>api(path,undefined,controller.current?.signal,query)} work={work} orders={data.orders||[]} answer={(order,decision)=>void reviewAction(order as PaymentAuthorizationReview,'challenge',{challengeId:(order as PaymentAuthorizationReview).authorization?.challengeId,decision})} />
      <KillSwitchPanel key={`kill-switch:${accountId}`} busy={busy} read={(path,query)=>api(path,undefined,controller.current?.signal,query)} mutate={mutate} work={work} />
      <MandateConsentPanel key={`mandates:${accountId}`} busy={busy} read={(path,query)=>api(path,undefined,controller.current?.signal,query)} mutate={mutate} work={work} />
      <PaymentRecoveryPanel key={accountId} busy={busy} read={(path,query)=>api(path,undefined,controller.current?.signal,query)} mutate={mutate} work={work} />
      <WalletFundingPanel methods={data.methods} orders={data.fundingOrders||[]} busy={busy} locale={locale}
        create={input=>void work(async()=>{await mutate('wallet-funding-orders',input);setNotice(t('wallet.n.saved'));})}
        act={(order,action,extra={})=>void work(async()=>{const result=await mutate(`wallet-funding-orders/${action}`,{orderId:order.id,expectedVersion:order.version,...(action==='cancel'?{}:{approvalDigest:order.approvalDigest}),...extra});setNotice(result.order.state==='SETTLED'?t('wallet.n.settled'):result.order.state==='FAILED'?t('wallet.n.failed',{code:result.order.failureCode??''}):result.order.state==='CANCELLED'?t('wallet.n.cancelled'):result.order.state==='AUTHORIZATION_PENDING'?t('wallet.n.pending'):result.order.state==='REQUIRES_ACTION'?t('wallet.n.action'):t('wallet.n.authorized'));})} />
      <RechargePanel targets={data.rechargeTargets||[]} methods={data.methods} links={data.billingAccounts} busy={busy} review={input=>void work(async()=>{const result=await mutate('recharge-preview',input);setPreview(result.preview);setNotice('Recharge review ready. Confirm this exact target, amount and source before payment.');})} />
      <PaymentRefundsPanel orders={data.orders||[]} funding={data.fundingOrders||[]} refunds={data.refunds||[]} busy={busy}
        create={input=>void work(async()=>{await mutate('refunds',input);setNotice('Refund review saved. Read its original source, amount and provider cancellation before approving.');})}
        act={(refund,action)=>void work(async()=>{const result=await mutate(`refunds/${action}`,{orderId:refund.id,...(action==='recover'?{}:{expectedVersion:refund.version,...(action==='cancel'?{}:{approvalDigest:refund.approvalDigest})})});setNotice(result.refund.state==='REFUNDED'?'Reversal confirmed and funds returned once to the original source.':result.refund.state==='FAILED'?`Refund declined: ${result.refund.failureCode}. No money returned.`:result.refund.state==='CANCELLED'?'Unstarted refund cancelled.':'Reversal outcome needs reconciliation. Inspect this same refund before another request.');})} />
      <CheckoutGroupsPanel payables={preview?.payable.kind==='RECHARGE'?[...currentPayables,preview.payable]:currentPayables} methods={data.methods} groups={data.checkoutGroups||[]} busy={busy}
        create={input=>void work(async()=>{await mutate('checkout-groups',input);setNotice('Group saved with one funding source. Read every line and the exact total before approving.');})}
        act={(group,action)=>void work(async()=>{const result=await mutate(`checkout-groups/${action}`,{orderId:group.id,expectedVersion:group.version,...(action==='cancel'?{}:{approvalDigest:group.approvalDigest})});setNotice(result.group.state==='COMPLETED'?'Every included payment has a confirmed provider receipt.':result.group.state==='AUTHORIZATION_PENDING'?'Checkout is waiting for the simulated issuer; later lines remain unpaid.':result.group.state==='REQUIRES_ACTION'?'Checkout stopped for a demo card challenge. Answer the original child review, then continue the group.':result.group.state==='RECONCILIATION_REQUIRED'?'Checkout stopped. Inspect or resume the original child payment before later lines.':action==='approve'?'Exact group approved. Continue to pay each line sequentially.':action==='cancel'?'Remaining group payments stopped. Prior receipts and captured payment recovery are preserved.':'Checkout stopped. Review the original child statuses before continuing.');})} />
      <section className="payment-obligations" aria-label={t('payments.obligationsLabel')}><h3>{t('payments.obligationsTitle')}</h3><p>{t('payments.obligationsHint')}</p>
        <ul>{data.payables.filter(p=>linked(p.provider,p.reference)).map(p=><li key={p.id}>
          <strong>{p.label}</strong><p>{formatAED(p.amountMinor)} · {p.status} · {p.dueState || 'CURRENT'}{p.version ? t('payments.revision', { version: p.version }) : ''}</p>
          {p.dueDate && <p>{t('payments.due', { date: p.dueDate })}{p.period ? t('payments.cycle', { period: p.period }) : ''}</p>}
          {!!p.discountMinor && <p>{t('payments.discount', { amount: formatAED(p.discountMinor) })}{p.discountExpiresAt ? t('payments.discountUntil', { time: new Date(p.discountExpiresAt).toLocaleString(locale === 'ar' ? 'ar-AE-u-nu-latn' : undefined) }) : ''}</p>}
          {p.paymentRestricted && <p>{t('payments.restricted')}</p>}{p.openingFixture && <p>{t('payments.seeded')}</p>}
        </li>)}</ul>
        {!data.payables.some(p=>linked(p.provider,p.reference)) && <p>{t('payments.linkToView')}</p>}
      </section>
      <section className="payment-review" aria-label={t('payments.reviewLabel')}><h3>{t('payments.reviewTitle')}</h3><p>{t('payments.reviewHint')}</p>
        <label>{t('payments.unpaid')}<select value={payable} onChange={e => { setPayable(e.target.value); setPreview(undefined); }}><option value="">{t('payments.chooseBill')}</option>{currentPayables.map(p => <option key={p.id} value={p.id}>{p.label} · {formatAED(p.amountMinor)}</option>)}</select></label>
        <label>{t('payments.source')}<select value={source} onChange={e => { setSource(e.target.value); setPreview(undefined); }}><option value="">{t('payments.chooseSource')}</option>{available.map(m => <option key={m.id} value={m.id}>{methodName(m)}</option>)}</select></label>
        <fieldset className="payment-fine-selection"><legend>{t('payments.finesLegend')}</legend><p>{t('payments.finesHint')}</p>{data.payables.filter(p=>p.kind==='FINE'&&p.status==='UNPAID'&&linked(p.provider,p.reference)).map(p=><label key={p.id}><input type="checkbox" checked={selectedFines.includes(p.id)} disabled={busy||p.paymentRestricted} onChange={e=>{setPreview(undefined);setSelectedFines(current=>e.target.checked?[...current,p.id]:current.filter(id=>id!==p.id));}} />{p.obligationId} · {formatAED(p.amountMinor)}{p.paymentRestricted?t('payments.finesRestricted'):''}</label>)}<button disabled={busy||!selectedFines.length||selectedFines.length>20||!currentMethod} onClick={()=>void reviewFines()}>{t('payments.reviewFines')}</button></fieldset>
        <button disabled={busy || !payable || !currentMethod} onClick={() => void review()}>{t('payments.reviewQuote')}</button>
        {preview && <article aria-label={t('payments.quoteLabel')}><h4>{preview.billingAccount.nickname}</h4><p>{preview.payable.label}</p><p>{t('payments.funding', { source: methodName(preview.source) })}</p>{preview.payable.recharge&&<p>{t('payments.rechargeTarget', { reference: preview.payable.reference, before: formatAED(preview.payable.recharge.balanceBeforeMinor), credit: formatAED(preview.amountMinor) })}</p>}{preview.payable.items&&<ul>{preview.payable.items.map(p=><li key={p.id}>{t('payments.itemLine', { obligation: p.obligationId ?? '', amount: formatAED(p.amountMinor), discount: formatAED(p.discountMinor||0) })}</li>)}</ul>}<p>{t('payments.amountFees', { amount: formatAED(preview.amountMinor), fees: formatAED(preview.feeMinor) })}</p><strong>{t('payments.total', { total: formatAED(preview.totalMinor) })}</strong><p>{t('payments.previewExpires', { time: new Date(preview.expiresAt).toLocaleTimeString(locale === 'ar' ? 'ar-AE-u-nu-latn' : undefined) })}</p><button onClick={() => setPreview(undefined)}>{t('payments.dismissReview')}</button><button disabled={busy} onClick={()=>void work(async()=>{await mutate('orders',{provider:preview.payable.provider,payableId:preview.payable.id,expectedPayableRevision:preview.payable.revision,methodId:preview.source.id,expectedMethodVersion:preview.source.version});setNotice(t('payments.reviewSaved'));})}>{t('payments.createReview')}</button></article>}
      </section>
      <section aria-label={t('payments.ordersLabel')} className="payment-review"><h3>{t('payments.ordersLabel')}</h3><p>{t('payments.ordersHint')}</p>
        {!data.orders?.length&&<p>{t('payments.noOrders')}</p>}
        {data.orders?.map(order=><article key={order.id} aria-label={t('payments.orderLabel', { id: order.id })}>
          <h4>{order.quote.billingAccount.nickname}</h4><p>{order.quote.payable.label}</p>{order.quote.payable.items&&<ul>{order.quote.payable.items.map(p=><li key={p.id}>{t('payments.itemLine', { obligation: p.obligationId ?? '', amount: formatAED(p.amountMinor), discount: formatAED(p.discountMinor||0) })}</li>)}</ul>}<p>{t('payments.orderFunding', { source: methodName(order.quote.source), version: order.quote.source.version })}</p>
          <p>{t('payments.orderAmounts', { amount: formatAED(order.quote.amountMinor), fees: formatAED(order.quote.feeMinor), total: formatAED(order.quote.totalMinor) })}</p><p>{t('payments.orderState', { state: order.state })}{order.failureCode?` · ${order.failureCode}`:''}</p>
          <p>{t('payments.orderExpires', { time: new Date(order.expiresAt).toLocaleTimeString(locale === 'ar' ? 'ar-AE-u-nu-latn' : undefined) })}</p>
          {order.state==='AWAITING_APPROVAL'&&<button disabled={busy} onClick={()=>void reviewAction(order,'approve')}>{t('payments.approveAuth', { total: formatAED(order.quote.totalMinor) })}</button>}
          {order.state==='AUTHORIZATION_PENDING'&&<p>{t('payments.issuerPending')}</p>}
          {order.state==='REQUIRES_ACTION'&&<div><p>{t('payments.challengeHint')}</p><button disabled={busy} onClick={()=>void reviewAction(order,'challenge',{challengeId:order.authorization?.challengeId,decision:'APPROVE'})}>{t('payments.challengeApprove')}</button><button disabled={busy} onClick={()=>void reviewAction(order,'challenge',{challengeId:order.authorization?.challengeId,decision:'REJECT'})}>{t('payments.challengeReject')}</button></div>}
          {order.state==='AUTHORIZED'&&<p>{t('payments.reserved', { time: new Date(order.authorization!.expiresAt).toLocaleTimeString(locale === 'ar' ? 'ar-AE-u-nu-latn' : undefined) })}</p>}
          {order.state==='AUTHORIZED'&&['BILL','FINE','FINE_SET','RECHARGE'].includes(order.quote.payable.kind||'')&&<button disabled={busy} onClick={()=>void reviewAction(order,'execute')}>{t('payments.pay', { total: formatAED(order.quote.totalMinor) })}</button>}
          {['CAPTURING','CAPTURED','RECONCILIATION_REQUIRED'].includes(order.state)&&<div><p>{order.fundsCaptured?t('payments.capturedPending'):t('payments.capturePending')}</p><button disabled={busy} onClick={()=>void reviewAction(order,'recover')}>{t('payments.inspect')}</button></div>}
          {order.refundState&&<p>{t('receipt.refundState',{state:order.refundState,amount:formatAED(order.refundedMinor||0),source:methodName(order.quote.source)})}</p>}
          {paymentReceiptReady(order)&&order.receipt&&<section aria-label={t(order.quote.payable.kind==='RECHARGE'?'receipt.recharge':order.quote.payable.kind==='BILL'?'receipt.bill':'receipt.fine')}><strong>{t(order.quote.payable.kind==='RECHARGE'?'receipt.rechargeApplied':order.quote.payable.kind==='BILL'?'receipt.billPaid':'receipt.finesPaid')} · {formatAED(order.receipt.amountMinor)}</strong><p>{t('receipt.number',{number:order.receipt.receiptNumber})}</p><PaymentReceiptFacts source={order.quote.source} amountMinor={order.quote.amountMinor} feeMinor={order.quote.feeMinor} target={`${order.quote.billingAccount.nickname} · ${order.quote.billingAccount.reference}`} reference={order.paymentId!} refundedMinor={order.refundedMinor} locale={locale} /><p>{t('receipt.paidFrom',{source:methodName(order.quote.source)})}</p>{order.quote.payable.kind==='RECHARGE'&&<p>{t('receipt.rechargeTarget',{reference:order.receipt.targetReference??'',balance:formatAED(order.receipt.providerBalanceMinor!)})}</p>}</section>}
          {order.state==='SETTLED'&&order.sourceFinalizationPending&&<div><p>{t('payments.finishRecharge')}</p><button disabled={busy} onClick={()=>void reviewAction(order,'recover')}>{t('payments.finishRechargeButton')}</button></div>}
          {['AWAITING_APPROVAL','AUTHORIZATION_PENDING','REQUIRES_ACTION','AUTHORIZED'].includes(order.state)&&<button disabled={busy} onClick={()=>void reviewAction(order,'cancel')}>{t('payments.cancelReview')}</button>}
        </article>)}
      </section>
    </>}
  </section>;
}
