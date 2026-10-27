import { useEffect, useRef, useState } from 'react';
import { Building2, ShieldCheck } from 'lucide-react';
import { FocusedAgentClient, FOCUSED_REQUEST_TIMEOUT_MS, AgentClientError, type AgentAction, type AgentResult } from '../../../packages/protocol-core/src/focused-agent-client.ts';
import { WorkspacePanes } from './components/WorkspacePanes.tsx';
import { A2UIRenderer } from './components/A2UIRenderer.tsx';
import './focused-fines.css';

const savedThread = 'cityside.fines.thread.v1';
const progressText: Record<string, string> = {
  understand: 'Understanding your request…', list: 'Retrieving your fines…', prepare: 'Preparing your payment review…',
  approval: 'Preparing your confirmation…', execute: 'Confirming your simulated payment…', respond: 'Updating your conversation…',
  listVehicles: 'Checking your vehicles…', renewPrepare: 'Preparing your renewal review…', renewApproval: 'Preparing your renewal confirmation…', renewExecute: 'Confirming your simulated renewal…',
};
const amount = (minor: number) => new Intl.NumberFormat('en-AE', { style: 'currency', currency: 'AED' }).format(minor / 100);

/** The fines route shares Cityside's renderer and visual shell; other journeys retain their existing entry point. */
export default function FocusedFinesWorkspace() {
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
    busy.current = true; setPending(true); setError(''); setProgress('Connecting to your fines service…');
    const active = new AbortController(); controller.current = active;
    const timeout = setTimeout(() => active.abort(), FOCUSED_REQUEST_TIMEOUT_MS);
    try { await operation(active.signal); }
    catch (failure) {
      if (mutation) setUncertain(true);
      setError(failure instanceof AgentClientError ? failure.message : 'The connection was interrupted. Inspect or recover the saved conversation before continuing.');
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
      const next = await client.transition(data.threadId, action, body, signal, node => setProgress(progressText[node] || 'Updating your request…'));
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
      setError('This review changed. Inspect the conversation before confirming.'); return;
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
  const canMessage = !!client && !pending && !needsRecovery && !active && data?.status !== 'cancelled';
  const transcript = data ? [...data.messages, ...(data.reply && data.messages.at(-1)?.content !== data.reply ? [{ role: 'assistant' as const, content: data.reply }] : [])] : [];

  return <div className="city-app focused-fines">
    <main className="main-workspace" id="main">
      <header className="topbar">
        <a href="/" className="brand" aria-label="Cityside home"><span className="brand-mark"><Building2 size={24} /></span><span>city<span className="brand-light">side</span></span></a>
        <span>Fines</span>
        {client && <button className="text-button" disabled={pending} onClick={() => { controller.current?.abort(); setClient(null); setData(null); setDraft(''); setError(''); setUncertain(false); }}>Sign out</button>}
      </header>
      <nav className="workspace-tools" aria-label="Fines tools">
        <a href="/">All city services</a>
        <button className="text-button" disabled={pending || !!active || !!needsRecovery} onClick={newConversation}>Start a new conversation</button>
        {client && <><button className="text-button" disabled={pending} onClick={inspect}>Inspect saved conversation</button><button className="text-button" disabled={pending || data?.status === 'cancelled'} onClick={() => transition('recover', {})}>Recover saved operation</button></>}
      </nav>
      <p className="focused-notice"><ShieldCheck size={18} aria-hidden="true" /> Demo records and payments are simulated. You review the exact amount before confirming.</p>
      {error && <p className="focused-error" role="alert">{error}</p>}
      {pending && <p className="focused-notice" role="status">{progress}</p>}
      {!client ? <section className="focused-login" aria-labelledby="fines-heading">
        <h1 id="fines-heading">Your fines.<br />Your decision.</h1>
        <p>View outstanding fines and review a simulated payment. Sign in with your local demo access token.</p>
        <form onSubmit={event => { event.preventDefault(); signIn(event.currentTarget); }}>
          <label htmlFor="fines-access-token">Access token</label>
          <input id="fines-access-token" name="token" type="password" autoComplete="off" required disabled={pending} aria-describedby="fines-token-help" />
          <p id="fines-token-help">The local setup generates this token. It is kept only in this page’s memory; signing out clears it.</p>
          <button type="submit" className="login-button" disabled={pending}>Open my fines</button>
        </form>
      </section> : <WorkspacePanes revealDetailsKey={active?.id} conversation={<>
        <section className="focused-conversation" aria-labelledby="conversation-heading">
          <h1 id="conversation-heading">Let’s take care of your fines.</h1>
          <div className="focused-transcript" aria-live="polite" aria-relevant="additions text">
            {transcript.length ? transcript.map((message, index) => <article key={`${index}-${message.role}`} className={`message ${message.role}`}><div className="message-body"><span className="message-author">{message.role === 'user' ? 'You' : 'Rashid'}</span><p dir="auto">{message.content}</p></div></article>) : <p>Ask to see your outstanding fines. Nothing is paid until you use the confirmation button.</p>}
          </div>
          {needsRecovery && <p role="status">The last outcome needs checking. Inspect the saved conversation, then recover the original operation.</p>}
          {data?.status === 'cancelled' && <p role="status">This conversation is cancelled. Start a new conversation to continue.</p>}
          <form className="composer" onSubmit={event => { event.preventDefault(); if (canMessage && draft.trim()) transition('messages', { message: draft.trim() }); }}>
            <textarea ref={composer} aria-label="Message about fines" placeholder="Show outstanding fines" maxLength={2000} rows={3} value={draft} disabled={!canMessage} onChange={event => setDraft(event.target.value)} />
            <button type="submit" className="text-button" disabled={!canMessage || !draft.trim()}>Send message</button>
          </form>
          <div className="focused-suggestions"><button className="text-button" disabled={!canMessage} onClick={() => transition('messages', { message: 'Show outstanding fines' })}>Show outstanding fines</button><button className="text-button" disabled={!canMessage} onClick={() => transition('messages', { message: 'Pay my outstanding fines' })}>Review payment</button><button className="text-button" disabled={!canMessage} onClick={() => transition('messages', { message: 'Renew my car registration' })}>Renew vehicle registration</button></div>
          <button className="text-button" disabled={pending || !!needsRecovery || data?.status === 'cancelled'} onClick={() => transition('cancel', {})}>Cancel conversation</button>
        </section></>} details={<>
        <section className="focused-review" aria-labelledby="review-heading">
          <h2 id="review-heading" ref={review} tabIndex={-1} data-pane-focus>{renewing ? 'Review before you renew' : data?.approval ? 'Review before you pay' : data?.renewal ? 'Your simulated renewal' : data?.receipt ? 'Your simulated receipt' : 'Your fines'}</h2>
          {data && <A2UIRenderer key={`${data.threadId}-${data.status}-${active?.id || 'view'}`} node={data.surface.view} onDispatchAction={dispatch} isPending={pending || !!needsRecovery || data.status === 'cancelled'} />}
          {active && <p>Review expires at <time dateTime={new Date(active.expiresAt).toISOString()}>{new Date(active.expiresAt).toLocaleTimeString()}</time>. Typed “yes” does not confirm {renewing ? 'a renewal' : 'a payment'}.</p>}
          {data?.receipt && <dl className="focused-receipt"><dt>Total paid (simulated)</dt><dd>{amount(data.receipt.quote.amountMinor)}</dd><dt>Receipt</dt><dd>{data.receipt.id}</dd></dl>}
          {data?.renewal && <dl className="focused-receipt"><dt>Renewal fee paid (simulated)</dt><dd>{amount(data.renewal.quote.amountMinor)}</dd><dt>Renewal receipt</dt><dd>{data.renewal.id}</dd></dl>}
        </section></>} />}
    </main>
  </div>;
}
