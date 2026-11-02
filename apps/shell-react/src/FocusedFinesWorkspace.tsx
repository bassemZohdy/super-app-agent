import { useEffect, useRef, useState } from 'react';
import { Building2, ShieldCheck } from 'lucide-react';
import { FocusedAgentClient, FOCUSED_REQUEST_TIMEOUT_MS, AgentClientError, type AgentAction, type AgentResult } from '../../../packages/protocol-core/src/focused-agent-client.ts';
import { WorkspacePanes } from './components/WorkspacePanes.tsx';
import { A2UIRenderer } from './components/A2UIRenderer.tsx';
import { useLocale } from './locale.ts';
import { formatMoney, formatTime, type CatalogKey } from '../../../packages/protocol-core/src/i18n.ts';
import './focused-fines.css';

const savedThread = 'cityside.fines.thread.v1';
const progressText: Record<string, CatalogKey> = {
  understand: 'fines.progressUnderstand', list: 'fines.progressList', prepare: 'fines.progressPrepare',
  approval: 'fines.progressApproval', execute: 'fines.progressExecute', respond: 'fines.progressRespond',
  listVehicles: 'fines.progressVehicles', renewPrepare: 'fines.progressRenewPrepare', renewApproval: 'fines.progressRenewApproval', renewExecute: 'fines.progressRenewExecute',
};
const amount = (minor: number) => new Intl.NumberFormat('en-AE', { style: 'currency', currency: 'AED' }).format(minor / 100);

/** The fines route shares Cityside's renderer and visual shell; other journeys retain their existing entry point. */
export default function FocusedFinesWorkspace() {
  const { t, locale } = useLocale();
  const [client, setClient] = useState<FocusedAgentClient | null>(null);
  const [data, setData] = useState<AgentResult | null>(null);
  const [draft, setDraft] = useState('');
  const [pending, setPending] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const [error, setError] = useState('');
  const [progress, setProgress] = useState('');
  const busy = useRef(false);
  const controller = useRef<AbortController>();
  const composer = useRef<HTMLTextAreaElement>(null);
  const review = useRef<HTMLHeadingElement>(null);
  const previousApproval = useRef<string>();
  // A fines-then-renewal request has two approvals in turn; only one is pending at a time.
  const active = data?.approval ?? data?.renewalApproval ?? null;
  const renewing = !data?.approval && !!data?.renewalApproval;
  useEffect(() => () => controller.current?.abort(), []);
  useEffect(() => {
    if (active && active.id !== previousApproval.current) {
      previousApproval.current = active.id;
      review.current?.focus();
      review.current?.scrollIntoView({ block: 'nearest', behavior: 'instant' });
    }
  }, [active?.id]);

  async function run(operation: (signal: AbortSignal) => Promise<void>, mutation = false) {
    if (busy.current) return;
    busy.current = true; setPending(true); setError(''); setProgress(t('fines.connecting'));
    const active = new AbortController(); controller.current = active;
    const timeout = setTimeout(() => active.abort(), FOCUSED_REQUEST_TIMEOUT_MS);
    try { await operation(active.signal); }
    catch (failure) {
      if (mutation) setUncertain(true);
      setError(locale === 'ar' ? t(failure instanceof AgentClientError && failure.code === 'ACCESS_UNAVAILABLE' ? 'fines.accessUnavailable' : 'fines.unconfirmed') : failure instanceof AgentClientError ? failure.message : 'The connection was interrupted. Inspect or recover the saved conversation before continuing.');
    } finally { clearTimeout(timeout); busy.current = false; setPending(false); setProgress(''); }
  }
  function signIn(form: HTMLFormElement) {
    const token = String(new FormData(form).get('token') || '').trim();
    form.reset();
    if (!token) return;
    void run(async signal => {
      const nextClient = new FocusedAgentClient(token);
      const id = sessionStorage.getItem(savedThread) || await nextClient.create(signal);
      sessionStorage.setItem(savedThread, id);
      const restored = await nextClient.inspect(id, signal);
      setClient(nextClient); setData(restored); setUncertain(false);
    });
  }
  function transition(action: AgentAction, body: Record<string, unknown>) {
    if (!client || !data || busy.current) return;
    void run(async signal => {
      const next = await client.transition(data.threadId, action, body, signal, node => setProgress(t(progressText[node] || 'fines.progressUpdating')));
      setData(next); setUncertain(false);
      if (action === 'messages') setDraft('');
    }, true);
  }
  function inspect() {
    if (!client || !data) return;
    void run(async signal => { setData(await client.inspect(data.threadId, signal)); });
  }
  function dispatch(action: string, payload: Record<string, unknown>) {
    if (action !== 'agent.resume' || !active || payload.approvalId !== active.id || !['approve', 'reject', 'cancel'].includes(String(payload.decision))) {
      setError(t('fines.reviewChanged')); return;
    }
    if (!uncertain) transition('resume', { approvalId: active.id, decision: payload.decision });
  }
  function newConversation() {
    if (!client) { sessionStorage.removeItem(savedThread); setError(''); return; }
    void run(async signal => {
      const id = await client.create(signal); sessionStorage.setItem(savedThread, id);
      setData(await client.inspect(id, signal)); setUncertain(false); setDraft('');
    });
  }
  const needsRecovery = uncertain || data?.status === 'unknown' || (!!data?.next.length && !active);
  const expiryText = t(renewing ? 'fines.expiresRenewal' : 'fines.expiresPayment', { time: '__TIME__' }).split('__TIME__');
  const canMessage = !!client && !pending && !needsRecovery && !active && data?.status !== 'cancelled';
  const transcript = data ? [...data.messages, ...(data.reply && data.messages.at(-1)?.content !== data.reply ? [{ role: 'assistant' as const, content: data.reply }] : [])] : [];

  return <div className="city-app focused-fines">
    <main className="main-workspace" id="main">
      <header className="topbar">
        <a href="/" className="brand" aria-label={t('fines.brandHome')}><span className="brand-mark"><Building2 size={24} /></span><span>city<span className="brand-light">side</span></span></a>
        <span>{t('fines.shortTitle')}</span>
        {client && <button className="text-button" disabled={pending} onClick={() => { controller.current?.abort(); setClient(null); setData(null); setDraft(''); setError(''); setUncertain(false); }}>{t('fines.signOut')}</button>}
      </header>
      <nav className="workspace-tools" aria-label={t('fines.tools')}>
        <a href="/">{t('fines.allServices')}</a>
        <button className="text-button" disabled={pending || !!active || !!needsRecovery} onClick={newConversation}>{t('fines.start')}</button>
        {client && <><button className="text-button" disabled={pending} onClick={inspect}>{t('fines.inspect')}</button><button className="text-button" disabled={pending || data?.status === 'cancelled'} onClick={() => transition('recover', {})}>{t('fines.recover')}</button></>}
      </nav>
      <p className="focused-notice"><ShieldCheck size={18} aria-hidden="true" /> {t('fines.simulatedReview')}</p>
      {error && <p className="focused-error" role="alert">{error}</p>}
      {pending && <p className="focused-notice" role="status">{progress}</p>}
      {!client ? <section className="focused-login" aria-labelledby="fines-heading">
        <h1 id="fines-heading">{t('fines.headline')}</h1>
        <p>{t('fines.loginIntro')}</p>
        <form onSubmit={event => { event.preventDefault(); signIn(event.currentTarget); }}>
          <label htmlFor="fines-access-token">{t('fines.token')}</label>
          <input id="fines-access-token" name="token" type="password" autoComplete="off" required disabled={pending} aria-describedby="fines-token-help" />
          <p id="fines-token-help">{t('fines.tokenHelp')}</p>
          <button type="submit" className="login-button" disabled={pending}>{t('fines.open')}</button>
        </form>
      </section> : <WorkspacePanes revealDetailsKey={active?.id} conversation={<>
        <section className="focused-conversation" aria-labelledby="conversation-heading">
          <h1 id="conversation-heading">{t('fines.chatTitle')}</h1>
          <div className="focused-transcript" aria-live="polite" aria-relevant="additions text">
            {transcript.length ? transcript.map((message, index) => <article key={`${index}-${message.role}`} className={`message ${message.role}`}><div className="message-body"><span className="message-author">{t(message.role === 'user' ? 'fines.you' : 'fines.assistant')}</span><p dir="auto">{message.content}</p></div></article>) : <p>{t('fines.emptyChat')}</p>}
          </div>
          {needsRecovery && <p role="status">{t('fines.recoveryNotice')}</p>}
          {data?.status === 'cancelled' && <p role="status">{t('fines.cancelledNotice')}</p>}
          <form className="composer" onSubmit={event => { event.preventDefault(); if (canMessage && draft.trim()) transition('messages', { message: draft.trim() }); }}>
            <textarea ref={composer} aria-label={t('fines.messageLabel')} placeholder={t('fines.showOutstanding')} maxLength={2000} rows={3} value={draft} disabled={!canMessage} onChange={event => setDraft(event.target.value)} />
            <button type="submit" className="text-button" disabled={!canMessage || !draft.trim()}>{t('fines.send')}</button>
          </form>
          <div className="focused-suggestions"><button className="text-button" disabled={!canMessage} onClick={() => transition('messages', { message: 'Show outstanding fines' })}>{t('fines.showOutstanding')}</button><button className="text-button" disabled={!canMessage} onClick={() => transition('messages', { message: 'Pay my outstanding fines' })}>{t('fines.reviewPayment')}</button><button className="text-button" disabled={!canMessage} onClick={() => transition('messages', { message: 'Renew my car registration' })}>{t('fines.renew')}</button></div>
          <button className="text-button" disabled={pending || !!needsRecovery || data?.status === 'cancelled'} onClick={() => transition('cancel', {})}>{t('fines.cancelConversation')}</button>
        </section></>} details={<>
        <section className="focused-review" aria-labelledby="review-heading">
          <h2 id="review-heading" ref={review} tabIndex={-1} data-pane-focus>{t(renewing ? 'fines.reviewRenew' : data?.approval ? 'fines.reviewPay' : data?.renewal ? 'fines.renewalDone' : data?.receipt ? 'fines.receipt' : 'fines.yourFines')}</h2>
          {data && <A2UIRenderer key={`${data.threadId}-${data.status}-${active?.id || 'view'}`} node={data.surface.view} onDispatchAction={dispatch} isPending={pending || !!needsRecovery || data.status === 'cancelled'} />}
          {active && <p>{expiryText[0]}<time dateTime={new Date(active.expiresAt).toISOString()}>{locale === 'ar' ? formatTime(locale, active.expiresAt) : new Date(active.expiresAt).toLocaleTimeString()}</time>{expiryText[1]}</p>}
          {data?.receipt && <dl className="focused-receipt"><dt>{t('fines.totalPaid')}</dt><dd>{locale === 'ar' ? formatMoney(locale, data.receipt.quote.amountMinor) : amount(data.receipt.quote.amountMinor)}</dd><dt>{t('fines.receiptLabel')}</dt><dd>{data.receipt.id}</dd></dl>}
          {data?.renewal && <dl className="focused-receipt"><dt>{t('fines.renewalPaid')}</dt><dd>{locale === 'ar' ? formatMoney(locale, data.renewal.quote.amountMinor) : amount(data.renewal.quote.amountMinor)}</dd><dt>{t('fines.renewalReceipt')}</dt><dd>{data.renewal.id}</dd></dl>}
        </section></>} />}
    </main>
  </div>;
}
