import { PaymentAccountsPanel } from './PaymentAccountsPanel.tsx';
import { BrowserAuth, type BrowserAuthConfig } from '../../../packages/protocol-core/src/oidc-client.ts';
import { DelegationPanel } from './DelegationPanel.tsx';
import { useEffect, useRef, useState } from 'react';
import { ArrowUp, ArrowUpRight, AudioLines, Building2, CarFront, Check, ChevronDown, CircleHelp, Compass, CreditCard, House, MapPin, Menu, MessageSquare, Mic, Plus, Settings2, ShieldCheck, Sparkles, Square, Volume2, Wifi, X, Zap } from 'lucide-react';
import { VoiceClient, type VoiceState } from '../../../packages/protocol-core/src/voice-client.ts';
import { LocalVoiceApi, type LocalVoiceConfig } from '../../../packages/protocol-core/src/voice-api.ts';
import { checkedSurface, readCoreResponse } from '../../../packages/protocol-core/src/surface-client.ts';
import { connectEventStream } from '../../../packages/protocol-core/src/sse-client.ts';
import type { AGUISurfacePayload } from '../../../packages/protocol-core/src/index.ts';
import { A2UIRenderer } from './components/A2UIRenderer.tsx';

const GATEWAY_URL = import.meta.env.VITE_GATEWAY_URL || 'http://localhost:4000';
const services = [
  { id: 'mobility', name: 'Getting around', short: 'Mobility', detail: 'Parking, rides & Salik', icon: CarFront, color: 'blue', prompt: 'Show me parking zones and my Salik balance' },
  { id: 'utilities', name: 'Home essentials', short: 'Utilities', detail: 'Electricity & water', icon: Zap, color: 'amber', prompt: 'Check my DEWA electricity and water bill' },
  { id: 'citizenpay', name: 'Payments & wallet', short: 'Payments', detail: 'Balances, bills & fines', icon: CreditCard, color: 'violet', prompt: 'Show my wallet balance and recent transactions' },
  { id: 'telecom', name: 'Stay connected', short: 'Telecom', detail: 'Etisalat & du', icon: Wifi, color: 'blue', prompt: 'Show my Etisalat subscriptions and bills' },
  { id: 'housing', name: 'A place to call home', short: 'Housing', detail: 'Ejari & moving in', icon: House, color: 'teal', prompt: 'I just signed my Ejari lease, help me move in' },
];
type ModelStatus = { ready?: boolean; model: string; enabled: boolean; configured: boolean; mode: string };
type ChatMessage = { id: string; role: 'user' | 'assistant'; text: string; error?: boolean; retry?: string };


export function App() {
  const [sessionId, setSessionId] = useState(() => `sess_${crypto.randomUUID()}`);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const auth = useRef<BrowserAuth>();
  const [authReady, setAuthReady] = useState(false);
  const [loginRequired, setLoginRequired] = useState(false);
  const [authError, setAuthError] = useState('');
  const [userName, setUserName] = useState('Demo citizen');
  const [accountId, setAccountId] = useState('');
  const [accounts, setAccounts] = useState<Array<{id: string; label: string}>>([]);
  const [recentSessions, setRecentSessions] = useState<Array<{sessionId: string; accountId: string; title: string}>>([]);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [draft, setDraft] = useState('');
  const [surface, setSurface] = useState<AGUISurfacePayload | null>(null);
  const [pending, setPending] = useState(false);
  const [progress, setProgress] = useState('');
  const [model, setModel] = useState<ModelStatus | null>(null);
  const [connection, setConnection] = useState<'checking' | 'online' | 'offline'>('checking');
  const [inference, setInference] = useState<'connected' | 'error' | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [delegationOpen, setDelegationOpen] = useState(false);
  const [paymentAccountsOpen, setPaymentAccountsOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [mobilePanel, setMobilePanel] = useState(false);
  const [readReplies, setReadReplies] = useState(false);
  const [voiceProfile, setVoiceProfile] = useState('Jasper');
  const [voiceSpeed, setVoiceSpeed] = useState(1);
  const [voiceConfig, setVoiceConfig] = useState<LocalVoiceConfig | null>(null);
  const voiceApi = useRef<LocalVoiceApi | null>(null);
  const [language, setLanguage] = useState('en-US');
  const [voiceState, setVoiceState] = useState<VoiceState>('idle');
  const [voiceError, setVoiceError] = useState('');
  const [canListen, setCanListen] = useState(false);
  const [canSpeak, setCanSpeak] = useState(false);
  const voice = useRef<VoiceClient>();
  const voiceOptions = useRef({ readReplies, language, voiceProfile, voiceSpeed });
  voiceOptions.current = { readReplies, language, voiceProfile, voiceSpeed };
  const busy = useRef(false);
  const revision = useRef<string>();
  const messagesEnd = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const paymentAccountsButton = useRef<HTMLButtonElement>(null);
  const sessionRef = useRef(sessionId);
  sessionRef.current = sessionId;
  const append = (message: Omit<ChatMessage, 'id'>) => setMessages(prev => [...prev, { ...message, id: crypto.randomUUID() }]);

  const getToken = async () => auth.current ? auth.current.token() : 'demo-local';
  const resetConversation = (nextAccount = accountId) => {
    revision.current = undefined; setMessages([]); setSurface(null); setDraft(''); setInference(null);
    const sid = `sess_${crypto.randomUUID()}`;
    sessionStorage.setItem(`cityside.session.${nextAccount}`, sid);
    setSessionId(sid); sessionRef.current = sid; setMenuOpen(false); setMobilePanel(false);
    return sid;
  };
  const restoredService = useRef<string>();
  const restoreConversation = async (sid: string, selectedAccount: string) => {
    const response = await fetch(`${GATEWAY_URL}/api/sessions/${encodeURIComponent(sid)}`, { headers: { Authorization: `Bearer ${await getToken()}` } });
    if (!response.ok) { resetConversation(selectedAccount); return; }
    const data = await response.json();
    if (data.accountId && data.accountId !== selectedAccount) return;
    restoredService.current=data.serviceId;
    setSessionId(sid); sessionRef.current = sid;
    sessionStorage.setItem(`cityside.session.${selectedAccount}`, sid);
    revision.current = data.surface?.revision;
    setSurface(data.surface || null);
    setInference(data.inference?.status === 'error' ? 'error' : data.inference?.status === 'connected' ? 'connected' : null);
    setMessages((data.messages || []).filter((m: any) => ['user','assistant'].includes(m.role)).map((m: any) => ({ id: m.id, role: m.role, text: m.content })));
    setHistoryOpen(false);
  };
  const switchAccount = async (selected: string) => {
    if (busy.current || selected === accountId) return;
    setAccountId(selected); sessionStorage.setItem('cityside.account', selected);
    const previous = sessionStorage.getItem(`cityside.session.${selected}`);
    if (previous) await restoreConversation(previous, selected); else resetConversation(selected);
  };
  const loadHistory = async () => {
    try {
      const response = await fetch(`${GATEWAY_URL}/api/sessions`, { headers: { Authorization: `Bearer ${await getToken()}` } });
      if (!response.ok) throw new Error('Could not load conversations.');
      setRecentSessions((await response.json()).sessions); setHistoryOpen(true);
    } catch (error) { setAuthError((error as Error).message); }
  };
  useEffect(() => {
    let disposed = false;
    void (async () => {
      try {
        const response = await fetch(`${GATEWAY_URL}/api/auth/config`);
        if (!response.ok) throw new Error('Could not load sign-in settings.');
        const config: BrowserAuthConfig = await response.json();
        const client = new BrowserAuth(config); auth.current = client;
        await client.completeLogin();
        if (disposed) return;
        if (config.enabled && !client.signedIn) { setLoginRequired(true); setAuthReady(true); return; }
        const accountResponse = await fetch(`${GATEWAY_URL}/api/accounts`, { headers: { Authorization: `Bearer ${await client.token()}` } });
        if (!accountResponse.ok) throw new Error('Could not load your accounts. Sign in again.');
        const data = await accountResponse.json();
        if (disposed) return;
        setAccounts(data.accounts); setUserName(data.user?.name || data.user?.preferred_username || 'Demo citizen');
        const selected = data.accounts.find((a: any) => a.id === sessionStorage.getItem('cityside.account'))?.id || data.accounts[0]?.id || '';
        setAccountId(selected);
        const previous = sessionStorage.getItem(`cityside.session.${selected}`);
        if (previous) await restoreConversation(previous, selected); else resetConversation(selected);
        setAuthReady(true);
      } catch (error) { if (!disposed) { setAuthError((error as Error).message); setLoginRequired(true); setAuthReady(true); } }
    })();
    return () => { disposed = true; };
  }, []);

  const checkConnection = async (signal?: AbortSignal) => {
    try {
      const response = await fetch(`${GATEWAY_URL}/health`, { signal });
      if (!response.ok) throw new Error('Gateway unavailable');
      const data = await response.json();
      setModel(data.llm || null);
      setConnection('online');
    } catch { if (!signal?.aborted) setConnection('offline'); }
  };
  useEffect(() => {
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { setMenuOpen(false); setSettingsOpen(false); setMobilePanel(false); }
    };
    window.addEventListener('keydown', escape);
    return () => window.removeEventListener('keydown', escape);
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    void checkConnection(controller.signal);
    const timer = setInterval(() => void checkConnection(controller.signal), 30000);
    return () => { controller.abort(); clearInterval(timer); };
  }, []);

  useEffect(() => {
    const api = new LocalVoiceApi(GATEWAY_URL, getToken); voiceApi.current = api;
    const client = new VoiceClient({
      onTranscript: text => setDraft(text),
      onState: setVoiceState,
      onError: setVoiceError,
      allowBrowserFallback: false,
      fetchAudio: (text, language, signal) => api.speech(text, language, voiceOptions.current.voiceProfile, voiceOptions.current.voiceSpeed, signal),
      transcribeAudio: (input, signal) => api.transcribe(input, signal),
    });
    voice.current = client;
    setCanListen(false); setCanSpeak(false);
    const hidden = () => { if (document.hidden) client.cancel(); };
    document.addEventListener('visibilitychange', hidden);
    return () => { client.dispose(); document.removeEventListener('visibilitychange', hidden); };
  }, []);
  const refreshVoice = async () => {
    try { const config = await voiceApi.current!.config(); setVoiceConfig(config); setCanListen(Boolean(voice.current?.canListen && config.asrReady)); setCanSpeak(Boolean(voice.current?.canSpeak && config.ttsReady)); setVoiceError(''); }
    catch (e) { setCanListen(false); setCanSpeak(false); setVoiceError((e as Error).message); }
  };
  useEffect(() => { if (authReady && !loginRequired) void refreshVoice(); }, [authReady, loginRequired]);

  const applySurface = (value: unknown) => {
    const next = checkedSurface(value, sessionRef.current);
    if (next.revision === revision.current) return;
    revision.current = next.revision;
    setSurface(next);
    if (next.assistantMessage) {
      append({ role: 'assistant', text: next.assistantMessage.text });
      if (voiceOptions.current.readReplies && voiceOptions.current.language === 'en-US') voice.current?.speak(next.assistantMessage.text, voiceOptions.current.language);
    }
  };
  useEffect(() => {
    if (!authReady || loginRequired) return;
    const controller = new AbortController();
    void connectEventStream({
      url: `${GATEWAY_URL}/api/a2ui/stream?sessionId=${sessionId}${accountId ? `&accountId=${encodeURIComponent(accountId)}` : ''}`,
      getToken, signal: controller.signal,
      onMessage: envelope => {
        if (envelope.type === 'A2UI_STREAM_DELTA') setProgress(envelope.data.text);
        if (envelope.type === 'A2UI_RENDER_SURFACE') {
          try { applySurface(envelope.data.surface); } catch (error) { append({ role: 'assistant', text: (error as Error).message, error: true }); }
        }
      },
      onError: () => { /* HTTP responses remain authoritative when the stream reconnects. */ },
    });
    return () => controller.abort();
  }, [sessionId, accountId, authReady, loginRequired]);
  useEffect(() => { messagesEnd.current?.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth', block: 'end' }); }, [messages, pending]);

  const request = async (path: string, body: Record<string, unknown>, retry?: string, targetSession = sessionId) => {
    if (busy.current) return;
    busy.current = true; setPending(true); setProgress('Preparing your request…'); voice.current?.cancel();
    const requestedSession = targetSession;
    try {
      const response = await fetch(path.startsWith('manual/') ? `${GATEWAY_URL}/api/${path}` : `${GATEWAY_URL}/api/a2ui/${path}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${await getToken()}` },
        body: JSON.stringify({ sessionId: requestedSession, ...(accountId ? { accountId } : {}), ...body }),
      });
      if (requestedSession !== sessionRef.current) return;
      const data = await response.clone().json();
      if (data.inference) setInference(data.inference.status);
      const result = await readCoreResponse(response, requestedSession);
      if (result.surface) applySurface(result.surface);
      if (data.inference?.status === 'error' && result.surface?.assistantMessage) {
        const text = result.surface.assistantMessage.text;
        setMessages(prev => prev.map(message => message.role === 'assistant' && message.text === text
          ? { ...message, error: true, retry } : message));
      }
      if (result.error && result.error !== result.surface?.assistantMessage?.text) append({ role: 'assistant', text: result.error, error: true, retry });
      setConnection('online');
    } catch (error) {
      if (auth.current && !auth.current.signedIn && accounts.length) setLoginRequired(true);
      append({ role: 'assistant', error: true, retry, text: error instanceof TypeError
        ? 'The concierge is offline. Start the backend, then try your message again.'
        : (error as Error).message });
      if (error instanceof TypeError) setConnection('offline');
    } finally { busy.current = false; setPending(false); setProgress(''); input.current?.focus(); }
  };
  const openService = (service: string) => {
    setPaymentAccountsOpen(false);
    if (busy.current || !authReady || loginRequired) return;
    const route = ({ mobility: 'parking', citizenpay: 'wallet', telecom: 'etisalat' } as Record<string,string>)[service] || service;
    const sid = resetConversation(accountId);
    history.replaceState(null, '', `/services/${route}`);
    void request('manual/prepare', { serviceId: route }, undefined, sid);
  };
  const initialRoute = useRef(false);
  useEffect(() => {
    if (!authReady || loginRequired || !accountId || initialRoute.current) return;
    initialRoute.current = true;
    const route = /^\/services\/([a-z]+)$/.exec(location.pathname)?.[1];
    if (route && route!==restoredService.current) openService(route);
  }, [authReady, loginRequired, accountId]);
  const send = (text = draft) => {
    setPaymentAccountsOpen(false);
    if (!text.trim() || busy.current || !authReady || loginRequired) return;
    const query = text.trim();
    append({ role: 'user', text: query }); setDraft(''); setMenuOpen(false); setMobilePanel(false);
    void request('intent', { text: query }, query);
  };
  const dispatch = (action: string, payload: Record<string, unknown>) => {
    if (action === 'CLIENT_ERROR') { append({ role: 'assistant', text: String(payload.error || 'Choose an option before continuing.'), error: true }); return; }
    if (action === 'LAUNCH_MINIAPP') {
      const route = ({ 'org.superapp.ride': 'ride', 'org.superapp.food': 'food', 'org.superapp.wallet': 'wallet', 'org.superapp.housing': 'housing', 'gov.smartcity.mobility': 'parking', 'gov.smartcity.utilities': 'utilities', 'gov.smartcity.citizenpay': 'wallet', 'gov.smartcity.housing': 'housing' } as Record<string,string>)[String(payload.miniAppId)];
      if (route) openService(route);
      return;
    }
    void request('action', { surfaceRevision: surface?.revision, action, payload });
  };
  const newConversation = () => {
    if (busy.current) return;
    setPaymentAccountsOpen(false); setDelegationOpen(false);
    voice.current?.cancel(); resetConversation(); history.replaceState(null, '', '/'); input.current?.focus();
  };
  const statusLabel = connection === 'offline' ? 'Gateway offline' : connection === 'checking' ? 'Connecting…'
    : inference === 'error' ? 'Model needs attention' : model?.enabled ? inference === 'connected' ? 'Local model connected' : model.ready ? 'Local model ready' : 'Local model warming up' : 'Demo mode';

  if (loginRequired) return <main className="login-screen"><div className="login-card"><span className="brand-mark"><Building2 size={30} /></span><h1>Your city.<br />Your account.</h1><p>Sign in to manage your personal and household services with Rashid.</p>{authError && <p role="alert" className="login-error">{authError}</p>}<button className="login-button" onClick={() => void auth.current?.login().catch(error => setAuthError(error.message))}>Sign in with Keycloak</button><small>Demo accounts: bassem or demo-commuter.<br />Password: demo123</small></div></main>;
  if (!authReady) return <main className="login-screen"><p role="status">Preparing your city workspace…</p></main>;
  const initials = userName.split(' ').map(part => part[0]).slice(0,2).join('').toUpperCase();
  return (
    <div className="city-app">
      <aside id="city-navigation" className={`sidebar ${menuOpen ? 'is-open' : ''}`} aria-label="Main navigation">
        <button className="icon-button close-sidebar" aria-label="Close navigation menu" onClick={() => setMenuOpen(false)}><X size={18} /></button>
        <a href="#main" className="brand"><span className="brand-mark"><Building2 size={24} strokeWidth={1.6} /></span><span>city<span className="brand-light">side</span><small>Your everyday, connected.</small></span></a>
        <button className="new-chat" onClick={newConversation} disabled={pending}><Plus size={17} /> New conversation </button>
        <div className="nav-label">Your space</div>
        <button className="nav-item active" onClick={() => { setMobilePanel(false); setMenuOpen(false); input.current?.focus(); }}><Sparkles size={18} /> Your concierge <span className="nav-dot" /></button>
        <button className="nav-item" disabled={pending} onClick={() => void loadHistory()}><MessageSquare size={18} /> Conversations</button>
        <div className="nav-label services-label">Explore services</div>
        <nav>{services.map(service => <button key={service.id} className="nav-item" disabled={pending} onClick={() => openService(service.id)}><service.icon size={18} /> {service.short}<ArrowUpRight size={13} className="nav-arrow" /></button>)}</nav>
        <button className="nav-item" disabled={pending} onClick={() => send('Show my citizen profile and registered vehicles and premises')}><ShieldCheck size={18} /> My profile</button>
        <div className="sidebar-bottom">
          {accounts.length > 0 && <label className="account-selector">Current account<select aria-label="Current account" disabled={pending} value={accountId} onChange={e => void switchAccount(e.target.value)}>{accounts.map(account => <option key={account.id} value={account.id}>{account.label}</option>)}</select></label>}
          {auth.current?.signedIn && <button className="text-button" onClick={() => { voice.current?.cancel(); auth.current?.logout(); }}>Sign out</button>}
          <div className="city-location"><MapPin size={17} /><div>Made for life in Dubai<small>City services, one conversation.</small></div></div>
          <button className="profile-button" disabled={pending} onClick={() => send('Show my citizen profile')}><span className="avatar">{initials}</span><span>{userName}<small>{accounts.find(a => a.id === accountId)?.label || 'Demo account'}</small></span><ChevronDown size={15} /></button>
        </div>
      </aside>
      {menuOpen && <button className="menu-scrim" aria-label="Close navigation" onClick={() => setMenuOpen(false)} />}
      <main id="main" className="main-workspace">
        <header className="topbar">
          <div className="breadcrumb"><button className="icon-button mobile-menu" aria-label="Open navigation" aria-controls="city-navigation" aria-expanded={menuOpen} onClick={() => setMenuOpen(true)}><Menu size={20} /></button><span>Your space</span><span className="breadcrumb-slash">/</span><strong>{paymentAccountsOpen ? 'Payment accounts' : 'Concierge'}</strong></div>
          <div className="topbar-actions"><span className={`connection-status ${connection === 'offline' || inference === 'error' ? 'is-error' : ''}`} role="status"><i />{statusLabel}</span><button className="icon-button" aria-label="Conversation settings" aria-expanded={settingsOpen} onClick={() => setSettingsOpen(!settingsOpen)}><Settings2 size={18} /></button></div>
        </header>
        <nav className="workspace-tools" aria-label="Workspace tools"><button className="text-button" aria-expanded={delegationOpen} onClick={() => { setPaymentAccountsOpen(false); setDelegationOpen(!delegationOpen); }}>Delegated access</button>
        <button ref={paymentAccountsButton} className="text-button" disabled={pending || !accountId} aria-controls="payment-account-panel" aria-expanded={paymentAccountsOpen} onClick={() => { voice.current?.cancel(); setDelegationOpen(false); setPaymentAccountsOpen(!paymentAccountsOpen); }}>Payment accounts</button></nav>
        {paymentAccountsOpen && <PaymentAccountsPanel key={accountId} gateway={GATEWAY_URL} accountId={accountId} getToken={getToken} onClose={() => { setPaymentAccountsOpen(false); paymentAccountsButton.current?.focus(); }} />}
        {delegationOpen && <DelegationPanel gateway={GATEWAY_URL} accountId={accountId} getToken={getToken} />}
        {settingsOpen && <section className="settings-panel" aria-label="Conversation settings"><div className="settings-title"><strong>Conversation settings</strong><button className="icon-button" aria-label="Close settings" onClick={() => setSettingsOpen(false)}><X size={17} /></button></div><p>Model: {model?.model || 'Unavailable'}</p><p>{model?.enabled ? 'Private replies from the local open-source model.' : 'Demo replies. Enable live inference in the server environment.'}</p><label>Voice language<select value={language} onChange={e => { voice.current?.cancel(); setLanguage(e.target.value); if (e.target.value !== 'en-US') setReadReplies(false); }}><option value="en-US">English</option><option value="ar-AE">Arabic dictation · text replies</option></select></label><label className="checkbox-label"><input type="checkbox" checked={readReplies} disabled={!canSpeak || language !== 'en-US'} onChange={e => { setReadReplies(e.target.checked); if (!e.target.checked) voice.current?.cancel(); }} />Read replies aloud</label><h3>Voice studio</h3><p>{voiceConfig?.ttsReady && voiceConfig?.asrReady ? 'Local open-source speech is ready.' : 'Local voice is not ready. Text chat remains available.'}</p><label>Voice preset<select aria-label="Voice preset" value={voiceProfile} onChange={e => { voice.current?.cancel(); setVoiceProfile(e.target.value); }}>{(voiceConfig?.voices || [{id:'Jasper', name:'Jasper'}]).map(v => <option key={v.id} value={v.id}>{v.name}</option>)}</select></label><label>Speaking speed · {voiceSpeed.toFixed(2)}×<input aria-label="Speaking speed" type="range" min="0.8" max="1.2" step="0.05" value={voiceSpeed} onChange={e => { voice.current?.cancel(); setVoiceSpeed(Number(e.target.value)); }} /></label><button className="text-button" disabled={!canSpeak || voiceState !== 'idle'} onClick={() => voice.current?.speak('Marhaba. I am Rashid, your city concierge. Tell me what you need, and we will take it one step at a time.', 'en-US')}>Preview voice</button><button className="text-button" onClick={() => voice.current?.cancel()}>Stop voice</button><button className="text-button" onClick={() => void refreshVoice()}>Refresh local voice</button><small>Speech runs on the local app server using open-source models. Short microphone recordings become editable drafts; review them before Send. Sent messages follow your chat settings.</small><button className="text-button" onClick={() => void checkConnection()}>Check connection again</button></section>}
        {historyOpen && <section className="settings-panel history-panel" aria-label="Saved conversations"><div className="settings-title"><strong>Saved conversations</strong><button className="icon-button" aria-label="Close conversations" onClick={() => setHistoryOpen(false)}><X size={17}/></button></div>{recentSessions.filter(item => item.accountId === accountId).map(item => <div className="history-row" key={item.sessionId}><button className="text-button" onClick={() => void restoreConversation(item.sessionId, accountId)}>{item.title}</button><button className="icon-button" aria-label={`Delete ${item.title}`} onClick={() => void (async () => { const response = await fetch(`${GATEWAY_URL}/api/sessions/${item.sessionId}`, { method: 'DELETE', headers: { Authorization: `Bearer ${await getToken()}` } }); if (response.ok) { if (item.sessionId === sessionId) resetConversation(); void loadHistory(); } })()}><X size={14}/></button></div>)}{!recentSessions.some(item => item.accountId === accountId) && <p>No saved conversations for this account yet.</p>}</section>}
        {!paymentAccountsOpen && <div className="workspace-content">
          <section className={`conversation ${mobilePanel ? 'mobile-hidden' : ''}`} aria-label="Concierge conversation">
            <div className="conversation-scroll">
              {messages.length === 0 ? <div className="welcome">
                <div className="concierge-emblem"><Sparkles size={28} strokeWidth={1.4} /></div>
                <p className="welcome-greeting">Marhaba, {userName.split(' ')[0]}</p>
                <h1>A little help.<br />A lot more city.</h1>
                <p className="welcome-description">I’m Rashid, your city concierge. From your morning commute to your next move, let’s take care of it.</p>
                <div className="suggestion-grid">
                  <button disabled={pending} onClick={() => send('Find parking in Downtown Dubai')}><span className="suggestion-icon blue"><CarFront size={20} /></span><span>Find a parking spot<small>A smoother arrival in Downtown</small></span><ArrowUpRight size={16} /></button>
                  <button disabled={pending} onClick={() => openService('utilities')}><span className="suggestion-icon amber"><Zap size={20} /></span><span>Take care of my bills<small>Your electricity & water, together</small></span><ArrowUpRight size={16} /></button>
                  <button disabled={pending} onClick={() => openService('wallet')}><span className="suggestion-icon violet"><CreditCard size={20} /></span><span>Check my wallet<small>Keep an eye on your everyday</small></span><ArrowUpRight size={16} /></button>
                  <button disabled={pending} onClick={() => openService('housing')}><span className="suggestion-icon teal"><House size={20} /></span><span>Make my move easier<small>Settle into your new home</small></span><ArrowUpRight size={16} /></button>
                </div>
                <button className="browse-services" onClick={() => send('Show all available city services')}><Compass size={15} /> Explore all city services <ArrowUpRight size={14} /></button>
              </div> : <div className="message-list" aria-live="polite" aria-relevant="additions">{messages.map(message => <article key={message.id} className={`message ${message.role} ${message.error ? 'message-error' : ''}`}><div className="message-avatar">{message.role === 'assistant' ? <Sparkles size={17} /> : initials}</div><div className="message-body"><span className="message-author">{message.role === 'assistant' ? 'Rashid' : 'You'}</span><p dir="auto">{message.text}</p>{message.retry && <button className="text-button" disabled={pending} onClick={() => send(message.retry)}>Try again</button>}</div></article>)}</div>}
              {pending && <div className="thinking" role="status"><span className="thinking-dots"><i /><i /><i /></span><span>{progress}</span></div>}
              <div ref={messagesEnd} />
            </div>
            <div className="composer-area">
              {surface && <button className="mobile-surface-toggle" onClick={() => setMobilePanel(true)}><Check size={15} /> View service details <ArrowUpRight size={15} /></button>}
              {(voiceError || voiceState !== 'idle') && <div className="voice-status" role="status">{voiceError || (voiceState === 'listening' ? 'Listening… stop when you are done (up to 15 seconds).' : voiceState === 'transcribing' ? 'Transcribing locally… review the draft before sending.' : 'Reading the reply aloud.')}<button onClick={() => { voice.current?.cancel(); setVoiceError(''); }}>Dismiss</button></div>}
              <form className={`composer ${pending ? 'is-pending' : ''}`} onSubmit={e => { e.preventDefault(); send(); }}>
                <textarea ref={input} aria-label="Message Rashid" placeholder="Ask Rashid anything about your city…" value={draft} maxLength={4000} rows={2} onChange={e => setDraft(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); send(); } }} />
                <div className="composer-toolbar"><span><Sparkles size={13} /> Your city, simplified</span><div><button type="button" className={`icon-button ${voiceState === 'listening' ? 'recording' : ''}`} disabled={pending || !canListen || voiceState === 'transcribing'} title={canListen ? 'Dictate a message' : 'Voice input is unavailable in this browser'} aria-label={voiceState === 'listening' ? 'Stop microphone' : 'Use microphone'} onClick={() => { setVoiceError(''); voiceState === 'listening' ? voice.current?.stopListening() : voice.current?.startListening(language); }}>{voiceState === 'listening' ? <Square size={17} /> : <Mic size={18} />}</button>{voiceState === 'speaking' && <button type="button" className="icon-button" aria-label="Stop reading" onClick={() => voice.current?.cancel()}><Volume2 size={18} /></button>}<button type="submit" className="send-button" disabled={pending || !draft.trim()} aria-label="Send message">{pending ? <AudioLines size={18} /> : <ArrowUp size={19} />}</button></div></div>
              </form>
              <p className="composer-note"><ShieldCheck size={12} /> You’re in control. Review and confirm before any service action.</p>
            </div>
          </section>
          <aside className={`service-panel ${mobilePanel ? 'mobile-visible' : ''}`} aria-label="Service details">
            <div className="service-panel-heading"><span><Compass size={18} /> {surface ? 'Your service workspace' : 'A city within reach'}</span><button className="icon-button mobile-close" aria-label="Back to conversation" onClick={() => setMobilePanel(false)}><X size={18} /></button><span className="preview-pill">Demo</span>{surface?.revision && JSON.stringify(surface.view).includes('AGENT_ACTION_DISPATCH') && <button className="text-button" disabled={pending} onClick={() => void request('cancel', { surfaceRevision: surface.revision })}>Cancel approval</button>}</div>
            {surface ? <div className="surface-content"><div className="surface-context"><span className="context-dot" /> Prepared for you <span>Review the details below</span></div><A2UIRenderer key={surface.revision} node={surface.view} isPending={pending} onDispatchAction={dispatch} /><p className="demo-note">City services use simulated data. No real bookings or payments are made.</p></div> : <>
              <div className="city-scene" aria-hidden="true"><div className="scene-sun" /><div className="scene-cloud cloud-one" /><div className="scene-cloud cloud-two" /><div className="skyline"><div className="building b1" /><div className="building b2" /><div className="building b3" /><div className="burj"><i /><b /><span /></div><div className="building b4" /><div className="building b5" /><div className="frame-building" /></div><div className="scene-ground" /><div className="scene-caption"><MapPin size={13} /> Dubai, United Arab Emirates</div></div>
              <div className="panel-intro"><h2>More living.<br />Less life admin.</h2><p>Everything you need for the everyday, in one place. Start with a conversation.</p></div>
              <div className="service-directory">{services.map(service => <button key={service.id} disabled={pending} onClick={() => openService(service.id)}><span className={`directory-icon ${service.color}`}><service.icon size={19} /></span><span>{service.short}<small>{service.detail}</small></span><ArrowUpRight size={15} /></button>)}</div>
              <div className="workspace-tip"><MessageSquare size={19} /><div>One request. A few things, sorted.<p>Try “Help me move in and set up my utilities.” I’ll bring the steps together.</p></div></div>
              <p className="demo-note">A working preview with simulated city services.<br />{model?.enabled ? 'Local open-source conversations.' : 'Local demo conversations.'}</p>
            </>}
          </aside>
        </div>}
        <footer className="app-footer"><span><Building2 size={12} /> Life happens. We help.</span><button onClick={() => send('How does this work?')} disabled={pending}><CircleHelp size={13} /> How it works</button></footer>
      </main>
    </div>
  );
}
