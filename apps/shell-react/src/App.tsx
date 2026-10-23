import { VoiceClient, type VoiceState } from '../../../packages/protocol-core/src/voice-client.ts';
import { checkedSurface, readCoreResponse } from '../../../packages/protocol-core/src/surface-client.ts';
import { connectEventStream } from '../../../packages/protocol-core/src/sse-client.ts';
import React, { useState, useEffect, useRef } from 'react';
import type { AGUISurfacePayload, A2UIMessageEnvelope } from '../../../packages/protocol-core/src/index.ts';
import { A2UIRenderer } from './components/A2UIRenderer.tsx';
import { mountRideMiniApp, unmountRideMiniApp } from '../../../mini-apps/miniapp-ride/src/index.tsx';
import { mountFoodMiniApp, unmountFoodMiniApp } from '../../../mini-apps/miniapp-food/src/index.tsx';
import { mountWalletMiniApp, unmountWalletMiniApp } from '../../../mini-apps/miniapp-wallet/src/index.tsx';
import { mountHousingMiniApp, unmountHousingMiniApp } from '../../../mini-apps/miniapp-housing/src/index.tsx';

export type SmartCityTab = 'agent' | 'mobility' | 'utilities' | 'citizenpay' | 'housing';

export interface ChatActionOption {
  label: string;
  action: () => void;
  primary?: boolean;
}

export interface ChatMessage {
  id?: string;
  role: 'assistant' | 'user' | 'system';
  text: string;
  isError?: boolean;
  errorInfo?: {
    title: string;
    description: string;
    technicalCode?: string;
    retryAction?: () => void;
    retryLabel?: string;
    alternatives?: ChatActionOption[];
  };
}

export function App() {
  const [sessionId] = useState(() => `sess_${Math.random().toString(36).substring(2, 9)}`);
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: 'msg_welcome',
      role: 'assistant',
      text: 'Marhaba Bassem! I am Rashid, your Autonomous Smart City Citizen Concierge. You can ask me to activate smart parking in Downtown, check DEWA electricity & water telemetry, settle Dubai Police traffic fines, or manage your Ejari lease.',
    },
  ]);
  const [prompt, setPrompt] = useState('');
  const [thinkingDelta, setThinkingDelta] = useState<string | null>(null);
  const [currentSurface, setCurrentSurface] = useState<AGUISurfacePayload | null>(null);
  const [actionPendingMessage, setActionPendingMessage] = useState<string | null>(null);
  const [isActionPending, setIsActionPending] = useState(false);
  const voice = useRef<VoiceClient>();
  const [voiceState, setVoiceState] = useState<VoiceState>('idle');
  const [voiceError, setVoiceError] = useState('');
  const [voiceAvailable, setVoiceAvailable] = useState({ input: false, output: false });
  const [voiceLanguage, setVoiceLanguage] = useState('en-US');
  const [readReplies, setReadReplies] = useState(false);
  const [autoListen, setAutoListen] = useState(false);
  const autoListenRef = useRef(false);
  autoListenRef.current = autoListen;
  const isSpeakingRef = useRef(false);
  const [voiceCountdown, setVoiceCountdown] = useState<string | null>(null);
  const voiceSilenceTimer = useRef<any>(null);
  const pendingVoiceText = useRef<string>('');
  const handleSendRef = useRef<(text?: string) => Promise<void>>(() => Promise.resolve());
  const voiceSettings = useRef({ readReplies, language: voiceLanguage });
  voiceSettings.current = { readReplies, language: voiceLanguage };

  useEffect(() => {
    const client = new VoiceClient({
      onTranscript: (text) => {
        const clean = text.trim();
        if (!clean) return;
        setPrompt(clean);
        pendingVoiceText.current = clean;
        setVoiceCountdown(`Heard: "${clean.slice(0, 42)}${clean.length > 42 ? '...' : ''}"`);
        if (voiceSilenceTimer.current) clearTimeout(voiceSilenceTimer.current);
        // User finished speaking this phrase: wait 750ms pause then auto-send immediately
        voiceSilenceTimer.current = setTimeout(() => {
          if (pendingVoiceText.current && !requestPending.current) {
            const query = pendingVoiceText.current;
            pendingVoiceText.current = '';
            setVoiceCountdown(null);
            void handleSendRef.current(query);
          }
        }, 750);
      },
      onState: (state) => {
        setVoiceState(state);
        if (state === 'speaking') {
          isSpeakingRef.current = true;
        } else if (state === 'idle') {
          const wasSpeaking = isSpeakingRef.current;
          isSpeakingRef.current = false;

          // 1. If user was dictating and finished speech utterance:
          if (pendingVoiceText.current) {
            if (voiceSilenceTimer.current) clearTimeout(voiceSilenceTimer.current);
            voiceSilenceTimer.current = setTimeout(() => {
              if (pendingVoiceText.current && !requestPending.current) {
                const query = pendingVoiceText.current;
                pendingVoiceText.current = '';
                setVoiceCountdown(null);
                void handleSendRef.current(query);
              }
            }, 350);
          } else if (wasSpeaking && autoListenRef.current && !requestPending.current) {
            // 2. Continuous Voice: Rashid finished speaking reply: automatically restart listening!
            setTimeout(() => {
              if (autoListenRef.current && !requestPending.current) {
                voice.current?.startListening(voiceSettings.current.language);
              }
            }, 450);
          }
        }
      },
      onError: (err) => {
        if (voiceSilenceTimer.current) clearTimeout(voiceSilenceTimer.current);
        pendingVoiceText.current = '';
        setVoiceCountdown(null);
        setVoiceError(err);
      },
    });
    voice.current = client;
    setVoiceAvailable({ input: client.canListen, output: client.canSpeak });
    const hidden = () => { if (document.hidden) client.cancel(); };
    document.addEventListener('visibilitychange', hidden);
    return () => {
      if (voiceSilenceTimer.current) clearTimeout(voiceSilenceTimer.current);
      document.removeEventListener('visibilitychange', hidden);
      client.dispose();
    };
  }, []);
  const lastRevision = useRef<string>();
  const requestPending = useRef(false);

  const showStructuredError = (opts: {
    title?: string;
    message: string;
    code?: string;
    retryAction?: () => void;
    retryLabel?: string;
    alternatives?: ChatActionOption[];
  }) => {
    const lower = opts.message.toLowerCase();
    const defaultAlternatives: ChatActionOption[] = [];

    if (lower.includes('balance') || lower.includes('fund') || lower.includes('insufficient') || lower.includes('wallet')) {
      defaultAlternatives.push({
        label: '💳 Instant Top-Up (+100 AED)',
        action: () => handleDispatchAction('topup_wallet', { amount: 100 }),
        primary: true,
      });
      defaultAlternatives.push({
        label: '🏛️ Unified Multi-Agency Pay',
        action: () => handleDispatchAction('confirm_smartcity_checkout', {}),
      });
      defaultAlternatives.push({
        label: '🛡️ Check Wallet Balance',
        action: () => handleSend('Show my wallet balance and recent transactions'),
      });
    } else if (lower.includes('choice') || lower.includes('option') || lower.includes('select') || lower.includes('valid')) {
      defaultAlternatives.push({
        label: '🅿️ Select Downtown Zone 302A (Recommended)',
        action: () => handleDispatchAction('activate_parking', { zoneId: 'zone_302a', durationHours: 2, plateNumber: 'Dubai B-74892' }),
        primary: true,
      });
      defaultAlternatives.push({
        label: '🚗 Switch to Business Bay Zone 101B',
        action: () => handleDispatchAction('activate_parking', { zoneId: 'zone_101b', durationHours: 2, plateNumber: 'Dubai B-74892' }),
      });
    } else if (lower.includes('gateway') || lower.includes('connect') || lower.includes('network') || lower.includes('4000')) {
      defaultAlternatives.push({
        label: '📦 Browse Municipal Catalog',
        action: () => handleSend('show all services'),
        primary: true,
      });
      defaultAlternatives.push({
        label: '🛡️ UAE PASS Identity Profile',
        action: () => handleSend('my profile'),
      });
      defaultAlternatives.push({
        label: '⚡ Check DEWA Smart Grid',
        action: () => handleSend('check my dewa electricity and water bill'),
      });
    } else {
      defaultAlternatives.push({
        label: '📦 Open Registered Services Catalog',
        action: () => handleSend('show all services'),
        primary: true,
      });
      defaultAlternatives.push({
        label: '💬 Ask Rashid for Alternative Paths',
        action: () => handleSend('What alternative options or ways can I solve this?'),
      });
    }

    const errorItem: ChatMessage = {
      id: `err_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      role: 'assistant',
      text: opts.message,
      isError: true,
      errorInfo: {
        title: opts.title || 'Municipal Service Notice',
        description: opts.message,
        technicalCode: opts.code,
        retryAction: opts.retryAction,
        retryLabel: opts.retryLabel || '🔄 Retry Action',
        alternatives: opts.alternatives && opts.alternatives.length > 0 ? opts.alternatives : defaultAlternatives,
      },
    };

    setMessages((prev) => [...prev, errorItem]);
  };

  const showError = (text: string) => {
    showStructuredError({
      message: text,
      retryAction: () => handleSend('retry'),
      retryLabel: '🔄 Retry Intent',
    });
  };

  const applySurface = (value: unknown) => {
    const surface = checkedSurface(value, sessionId);
    if (lastRevision.current === surface.revision) return;
    lastRevision.current = surface.revision;
    setCurrentSurface(surface);
    setActiveTab('agent');
    if (surface.assistantMessage) {
      setMessages(prev => [...prev, { id: `msg_${Date.now()}`, role: 'assistant', text: surface.assistantMessage!.text }]);
      if (voiceSettings.current.readReplies) {
        voice.current?.speak(surface.assistantMessage.text, voiceSettings.current.language);
      } else if (autoListenRef.current) {
        // Continuous voice: reply rendered without audio: restart listening automatically!
        setTimeout(() => {
          if (autoListenRef.current && !requestPending.current) {
            voice.current?.startListening(voiceSettings.current.language);
          }
        }, 650);
      }
    }
  };

  const applyResponse = async (res: Response) => {
    const result = await readCoreResponse(res, sessionId);
    if (result.surface) applySurface(result.surface);
    if (result.error && result.error !== result.surface?.assistantMessage?.text) {
      showStructuredError({
        title: 'Smart City Service Notice',
        message: result.error,
        code: `HTTP_${res.status}`,
        retryAction: () => handleSend(),
        retryLabel: '🔄 Retry Request',
      });
    }
  };
  const [activeTab, setActiveTab] = useState<SmartCityTab>('agent');
  const [walletBalance, setWalletBalance] = useState<number>(250.0);

  const chatBottomRef = useRef<HTMLDivElement>(null);
  const miniAppMountRef = useRef<HTMLDivElement>(null);

  const GATEWAY_URL = import.meta.env.VITE_GATEWAY_URL || 'http://localhost:4000';
  const getAuthToken = () => {
    try {
      const stored = localStorage.getItem('KEYCLOAK_ACCESS_TOKEN');
      if (stored && stored.trim().length > 0) return stored.trim();
    } catch {
      // sandbox/SSR fallback
    }
    return 'demo-local';
  };

  // 1. Establish A2-UI Protocol SSE Stream
  useEffect(() => {
    const controller = new AbortController();
    void connectEventStream({
      url: `${GATEWAY_URL}/api/a2ui/stream?sessionId=${sessionId}`,
      getToken: () => getAuthToken(),
      signal: controller.signal,
      onMessage: (envelope: A2UIMessageEnvelope) => {
          if (envelope.type === 'A2UI_STREAM_DELTA') {
            setThinkingDelta(envelope.data.text);
          } else if (envelope.type === 'A2UI_RENDER_SURFACE') {
            setThinkingDelta(null);
            try { applySurface(envelope.data.surface); }
            catch (error) { showError((error as Error).message); }
          } else if (envelope.type === 'A2UI_LAUNCH_MINIAPP') {
            const appId = envelope.data.miniAppId || '';
            if (appId.includes('mobility') || appId.includes('ride')) setActiveTab('mobility');
            else if (appId.includes('utilities') || appId.includes('food')) setActiveTab('utilities');
            else if (appId.includes('citizenpay') || appId.includes('wallet')) setActiveTab('citizenpay');
            else if (appId.includes('housing')) setActiveTab('housing');
          }
      },
      onError: (error) => console.warn('Event stream unavailable', error.message),
    });
    return () => controller.abort();
  }, [sessionId]);

  useEffect(() => {
    chatBottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, thinkingDelta]);

  // 2. Mount Mini-Apps dynamically when tab changes
  useEffect(() => {
    if (!miniAppMountRef.current) return;
    const container = miniAppMountRef.current;
    container.innerHTML = '';

    const context = {
      container,
      sessionId,
      onDispatchEvent: (eventName: string, payload: Record<string, any>) => {
        setMessages((prev) => [
          ...prev,
          { role: 'user', text: `Action from ${activeTab.toUpperCase()} Mini-App: ${eventName}` },
        ]);
        if (eventName === 'PARKING_ACTIVATED') {
          handleDispatchAction('activate_parking', payload);
        } else if (eventName === 'SALIK_RECHARGED') {
          handleDispatchAction('extend_parking', payload);
        } else if (eventName === 'DEWA_BILL_PAID') {
          handleDispatchAction('pay_utilities_bill', payload);
        } else if (eventName === 'POLICE_FINES_PAID') {
          handleDispatchAction('pay_police_fines', payload);
        } else if (eventName === 'WALLET_TOPPED_UP') {
          setWalletBalance((prev) => prev + payload.amount);
          handleDispatchAction('topup_wallet', payload);
        } else if (eventName === 'UNIFIED_PAY_SETTLED') {
          handleDispatchAction('confirm_smartcity_checkout', payload);
        } else if (eventName === 'MOVEIN_CONFIRMED') {
          handleDispatchAction('confirm_movein', payload);
        }
      },
    };

    if (activeTab === 'mobility') {
      mountRideMiniApp(context);
    } else if (activeTab === 'utilities') {
      mountFoodMiniApp(context);
    } else if (activeTab === 'citizenpay') {
      mountWalletMiniApp(context);
    } else if (activeTab === 'housing') {
      mountHousingMiniApp(context);
    }

    return () => {
      if (activeTab === 'mobility') unmountRideMiniApp(context);
      else if (activeTab === 'utilities') unmountFoodMiniApp(context);
      else if (activeTab === 'citizenpay') unmountWalletMiniApp(context);
      else if (activeTab === 'housing') unmountHousingMiniApp(context);
    };
  }, [activeTab, sessionId]);

  // 3. Dispatch User Intent to Gateway
  const handleSend = async (textToSend?: string) => {
    const query = textToSend || prompt;
    if (!query.trim() || requestPending.current) return;
    if (voiceSilenceTimer.current) clearTimeout(voiceSilenceTimer.current);
    pendingVoiceText.current = '';
    setVoiceCountdown(null);
    requestPending.current = true;
    setIsActionPending(true);
    voice.current?.cancel();

    setMessages((prev) => [...prev, { role: 'user', text: query }]);
    setPrompt('');
    setThinkingDelta('Preparing your request...');

    try {
      const res = await fetch(`${GATEWAY_URL}/api/a2ui/intent`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${getAuthToken()}`,
        },
        body: JSON.stringify({
          sessionId,
          text: query,
          handshake: {
            platform: 'react',
            viewport: {
              width: window.innerWidth,
              height: window.innerHeight,
              category: window.innerWidth >= 768 ? 'desktop' : 'mobile',
            },
            supportedComponents: [
              'SurfaceCard',
              'Heading',
              'Text',
              'Badge',
              'ChoiceGroup',
              'Button',
              'FormInput',
              'MetricWidget',
              'MapViewer',
              'DataTable',
              'MiniAppEmbed',
            ],
          },
        }),
      });

      await applyResponse(res);
    } catch (err) {
      setThinkingDelta(null);
      showStructuredError({
        title: 'Agent Gateway Unreachable',
        message: 'Could not connect to the Smart City Agent Gateway. Please verify services are operational on port 4000.',
        code: 'GATEWAY_CONNECTION_ERROR',
        retryAction: () => handleSend(query),
        retryLabel: '🔄 Retry Sending Instruction',
      });
    } finally {
      requestPending.current = false;
      setIsActionPending(false);
      setThinkingDelta(null);
    }
  };
  handleSendRef.current = handleSend;

  // 4. Dispatch Interactive Action
  const handleDispatchAction = async (action: string, payload: Record<string, any>) => {
    if (action === 'CLIENT_ERROR') {
      showStructuredError({
        title: 'Selection Required Before Proceeding',
        message: payload.error || 'Please choose an available option from the card above before confirming.',
        code: 'CLIENT_VALIDATION_ERROR',
        retryLabel: '🔄 Choose Recommended & Continue',
      });
      return;
    }
    if (action === 'LAUNCH_MINIAPP') {
      const miniAppId = payload.miniAppId || '';
      if (miniAppId.includes('mobility') || miniAppId.includes('ride')) setActiveTab('mobility');
      else if (miniAppId.includes('utilities') || miniAppId.includes('food')) setActiveTab('utilities');
      else if (miniAppId.includes('citizenpay') || miniAppId.includes('wallet')) setActiveTab('citizenpay');
      else if (miniAppId.includes('housing')) setActiveTab('housing');
      return;
    }

    if (requestPending.current) return;
    requestPending.current = true;
    setIsActionPending(true);
    setActionPendingMessage(`⚡ Processing Smart City action: ${action}...`);
    voice.current?.cancel();
    setThinkingDelta(`⚡ Processing Smart City action: ${action}...`);
    try {
      const res = await fetch(`${GATEWAY_URL}/api/a2ui/action`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${getAuthToken()}`,
        },
        body: JSON.stringify({ sessionId, surfaceRevision: currentSurface?.revision, action, payload }),
      });

      await applyResponse(res);
    } catch (err) {
      setThinkingDelta(null);
      showStructuredError({
        title: 'Municipal Action Confirmation Failed',
        message: 'Could not confirm the action result with the government service grid. Please verify status before retrying.',
        code: 'ACTION_CONFIRMATION_FAILED',
        retryAction: () => handleDispatchAction(action, payload),
        retryLabel: `🔄 Retry Action: ${action}`,
      });
    } finally {
      requestPending.current = false;
      setIsActionPending(false);
      setActionPendingMessage(null);
      setThinkingDelta(null);
    }
  };

  const navTabs: Array<{ id: SmartCityTab; label: string }> = [
    { id: 'agent', label: '🤖 AI CONCIERGE' },
    { id: 'mobility', label: '🚗 SMART MOBILITY' },
    { id: 'utilities', label: '⚡ UTILITIES (DEWA)' },
    { id: 'citizenpay', label: '💳 CITIZEN PAY' },
    { id: 'housing', label: '🏠 HOUSING (EJARI)' },
  ];

  return (
    <div
      className="superapp-container"
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100vh',
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      }}
    >
      {/* Top Header Chrome */}
      <header
        style={{
          height: '60px',
          background: '#064e3b',
          color: '#ffffff',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '0 20px',
          borderBottom: '1px solid #047857',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <div
            style={{
              background: '#059669',
              color: '#fff',
              borderRadius: '8px',
              padding: '6px 10px',
              fontWeight: 800,
              fontSize: '14px',
            }}
          >
            DXB
          </div>
          <div>
            <div style={{ fontWeight: 700, fontSize: '15px' }}>
              SmartCity Now • Unified Citizen Agent
            </div>
            <div style={{ fontSize: '11px', color: '#a7f3d0' }}>
              Unified Citizen Platform • UAE PASS Sovereign IAM
            </div>
          </div>
        </div>

        {/* Mini-App Quick Switcher */}
        <div style={{ display: 'flex', gap: '6px' }}>
          {navTabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              style={{
                padding: '6px 12px',
                borderRadius: '8px',
                border: activeTab === tab.id ? '1px solid #34d399' : '1px solid #065f46',
                background: activeTab === tab.id ? '#047857' : '#064e3b',
                color: activeTab === tab.id ? '#ffffff' : '#a7f3d0',
                fontWeight: 600,
                fontSize: '12px',
                cursor: 'pointer',
                transition: 'all 0.15s ease',
              }}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          {/* UAE PASS Authenticated Citizen Profile */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              background: '#047857',
              border: '1px solid #059669',
              borderRadius: '20px',
              padding: '4px 12px',
            }}
          >
            <span style={{ fontSize: '13px' }}>🛡️</span>
            <span style={{ fontSize: '12px', fontWeight: 600, color: '#f8fafc' }}>
              Bassem Zohdy
            </span>
            <span
              style={{
                background: '#f59e0b',
                color: '#78350f',
                fontSize: '10px',
                fontWeight: 700,
                padding: '2px 6px',
                borderRadius: '10px',
              }}
            >
              🌟 Golden Visa
            </span>
          </div>

          <div
            style={{
              background: '#022c22',
              color: '#6ee7b7',
              padding: '6px 14px',
              borderRadius: '20px',
              fontWeight: 700,
              fontSize: '13px',
              border: '1px solid #065f46',
            }}
          >
            💳 {walletBalance.toFixed(2)} AED
          </div>
        </div>
      </header>

      {/* Responsive Workspace Grid */}
      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
        {/* Left Pane: Persistent Conversational Agent Concierge */}
        <section
          style={{
            width: '38%',
            minWidth: '340px',
            borderRight: '1px solid #e2e8f0',
            background: '#f8fafc',
            display: 'flex',
            flexDirection: 'column',
          }}
        >
          {/* Modern Smart City Concierge Header */}
          <div
            style={{
              padding: '12px 18px',
              borderBottom: '1px solid #e2e8f0',
              background: '#ffffff',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              boxShadow: '0 1px 2px rgba(0,0,0,0.03)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <div
                style={{
                  width: '34px',
                  height: '34px',
                  borderRadius: '50%',
                  background: 'linear-gradient(135deg, #059669 0%, #10b981 100%)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: '18px',
                  boxShadow: '0 2px 6px rgba(5, 150, 105, 0.25)',
                  position: 'relative',
                }}
              >
                🏛️
                <span
                  style={{
                    position: 'absolute',
                    bottom: '-1px',
                    right: '-1px',
                    width: '9px',
                    height: '9px',
                    borderRadius: '50%',
                    background: '#10b981',
                    border: '2px solid #ffffff',
                  }}
                />
              </div>
              <div>
                <div style={{ fontWeight: 700, fontSize: '14px', color: '#0f172a', display: 'flex', alignItems: 'center', gap: '6px' }}>
                  Rashid
                  <span style={{ fontSize: '10px', background: '#ecfdf5', color: '#065f46', padding: '1px 6px', borderRadius: '4px', fontWeight: 700 }}>
                    CONCIERGE
                  </span>
                </div>
                <div style={{ fontSize: '11px', color: '#64748b' }}>
                  Smart City Voice & Living Agent
                </div>
              </div>
            </div>

            {/* Voice & Language Controls in Header */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              {/* Language Switcher Pill */}
              <button
                type="button"
                onClick={() => {
                  voice.current?.cancel();
                  setVoiceLanguage(prev => prev === 'en-US' ? 'ar-AE' : 'en-US');
                }}
                title="Switch voice & dictation language"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '4px',
                  padding: '4px 10px',
                  borderRadius: '16px',
                  background: '#f1f5f9',
                  border: '1px solid #cbd5e1',
                  color: '#334155',
                  fontSize: '11px',
                  fontWeight: 700,
                  cursor: 'pointer',
                  transition: 'all 0.15s ease',
                }}
              >
                {voiceLanguage === 'ar-AE' ? '🇦🇪 AR' : '🇺🇸 EN'}
              </button>

              {/* Read Aloud Audio Toggle */}
              <button
                type="button"
                disabled={!voiceAvailable.output}
                onClick={() => {
                  const next = !readReplies;
                  setReadReplies(next);
                  if (!next) voice.current?.cancel();
                }}
                title={readReplies ? 'Spoken replies enabled (click to mute)' : 'Muted (click to enable spoken replies)'}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '4px',
                  padding: '4px 10px',
                  borderRadius: '16px',
                  background: readReplies ? '#ecfdf5' : '#f8fafc',
                  border: readReplies ? '1px solid #6ee7b7' : '1px solid #e2e8f0',
                  color: readReplies ? '#065f46' : '#64748b',
                  fontSize: '11px',
                  fontWeight: 600,
                  cursor: voiceAvailable.output ? 'pointer' : 'not-allowed',
                  opacity: voiceAvailable.output ? 1 : 0.5,
                  transition: 'all 0.15s ease',
                }}
              >
                {readReplies ? '🔊 Read Aloud' : '🔇 Muted'}
              </button>

              {/* Hands-Free Voice Continuous Loop Toggle */}
              <button
                type="button"
                disabled={!voiceAvailable.input}
                onClick={() => {
                  const next = !autoListen;
                  setAutoListen(next);
                  autoListenRef.current = next;
                  if (next && voiceState === 'idle') {
                    voice.current?.startListening(voiceLanguage);
                  } else if (!next && voiceState === 'listening') {
                    voice.current?.stopListening();
                  }
                }}
                title={autoListen ? 'Hands-Free loop active (speaks and automatically listens back)' : 'Click to enable continuous hands-free voice'}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '4px',
                  padding: '4px 10px',
                  borderRadius: '16px',
                  background: autoListen ? '#ecfdf5' : '#f8fafc',
                  border: autoListen ? '1.5px solid #10b981' : '1px solid #cbd5e1',
                  color: autoListen ? '#065f46' : '#64748b',
                  fontSize: '11px',
                  fontWeight: 700,
                  cursor: voiceAvailable.input ? 'pointer' : 'not-allowed',
                  opacity: voiceAvailable.input ? 1 : 0.5,
                  transition: 'all 0.15s ease',
                  boxShadow: autoListen ? '0 1px 4px rgba(16, 185, 129, 0.2)' : 'none',
                }}
              >
                <span>{autoListen ? '🎙️ Hands-Free: ON' : '🎙️ Hands-Free: OFF'}</span>
              </button>
            </div>
          </div>

          {/* Conversation Stream */}
          <div
            className="modern-scroll"
            style={{
              flex: 1,
              padding: '16px',
              overflowY: 'auto',
              display: 'flex',
              flexDirection: 'column',
              gap: '12px',
              background: '#f8fafc',
            }}
          >
            {messages.map((m, idx) => (
              <div
                key={m.id || idx}
                className="chat-message-anim"
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: m.role === 'user' ? 'flex-end' : 'flex-start',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: '8px', maxWidth: '88%' }}>
                  {m.role !== 'user' && (
                    <div
                      style={{
                        width: '26px',
                        height: '26px',
                        borderRadius: '50%',
                        background: m.isError ? '#fef3c7' : 'linear-gradient(135deg, #059669 0%, #10b981 100%)',
                        border: m.isError ? '1px solid #f59e0b' : 'none',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontSize: '13px',
                        flexShrink: 0,
                        marginTop: '2px',
                      }}
                    >
                      {m.isError ? '⚠️' : '🏛️'}
                    </div>
                  )}

                  <div
                    style={{
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: m.role === 'user' ? 'flex-end' : 'flex-start',
                      width: '100%',
                    }}
                  >
                    <div
                      style={{
                        fontSize: '11px',
                        fontWeight: 600,
                        color: '#64748b',
                        marginBottom: '4px',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '6px',
                      }}
                    >
                      <span>{m.role === 'user' ? 'You' : m.isError ? 'Municipal Notice' : 'Rashid'}</span>
                      {m.role === 'user' && (
                        <span style={{ fontSize: '9px', background: '#dcfce7', color: '#166534', padding: '1px 5px', borderRadius: '4px', fontWeight: 700 }}>
                          UAE PASS
                        </span>
                      )}
                    </div>

                    {m.isError && m.errorInfo ? (
                      <div
                        style={{
                          padding: '14px 16px',
                          borderRadius: '14px',
                          background: 'linear-gradient(135deg, #fffbeb 0%, #fef3c7 100%)',
                          border: '1.5px solid #fde68a',
                          boxShadow: '0 4px 12px rgba(245, 158, 11, 0.12)',
                          width: '100%',
                          boxSizing: 'border-box',
                        }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
                          <span style={{ fontSize: '18px' }}>⚠️</span>
                          <strong style={{ fontSize: '14px', color: '#92400e' }}>
                            {m.errorInfo.title}
                          </strong>
                        </div>
                        <p style={{ fontSize: '13px', color: '#78350f', margin: '0 0 12px 0', lineHeight: '1.5' }}>
                          {m.errorInfo.description}
                        </p>

                        {/* Primary Retry Action */}
                        {m.errorInfo.retryAction && (
                          <div style={{ marginBottom: '10px' }}>
                            <button
                              type="button"
                              onClick={m.errorInfo.retryAction}
                              className="ag-btn"
                              style={{
                                padding: '8px 16px',
                                borderRadius: '8px',
                                background: '#059669',
                                color: '#ffffff',
                                border: 'none',
                                fontWeight: 700,
                                fontSize: '12.5px',
                                cursor: 'pointer',
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: '6px',
                              }}
                            >
                              <span>{m.errorInfo.retryLabel || '🔄 Retry Request'}</span>
                            </button>
                          </div>
                        )}

                        {/* Alternative Paths & Different Ways */}
                        {m.errorInfo.alternatives && m.errorInfo.alternatives.length > 0 && (
                          <div>
                            <div style={{ fontSize: '10.5px', fontWeight: 700, color: '#b45309', marginBottom: '6px', textTransform: 'uppercase', letterSpacing: '0.4px' }}>
                              Or Try Different Ways:
                            </div>
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                              {m.errorInfo.alternatives.map((alt, aIdx) => (
                                <button
                                  key={aIdx}
                                  type="button"
                                  onClick={alt.action}
                                  style={{
                                    padding: '5px 11px',
                                    borderRadius: '16px',
                                    background: '#ffffff',
                                    border: alt.primary ? '1.5px solid #059669' : '1px solid #cbd5e1',
                                    color: alt.primary ? '#065f46' : '#334155',
                                    fontSize: '11px',
                                    fontWeight: alt.primary ? 700 : 600,
                                    cursor: 'pointer',
                                    boxShadow: '0 1px 2px rgba(0,0,0,0.04)',
                                    transition: 'all 0.15s ease',
                                  }}
                                  onMouseEnter={(e) => (e.currentTarget.style.background = '#f0fdf4')}
                                  onMouseLeave={(e) => (e.currentTarget.style.background = '#ffffff')}
                                >
                                  {alt.label}
                                </button>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    ) : (
                      <div
                        style={{
                          padding: '11px 15px',
                          borderRadius: m.role === 'user' ? '16px 16px 4px 16px' : '16px 16px 16px 4px',
                          fontSize: '13.5px',
                          lineHeight: '1.6',
                          background: m.role === 'user' ? 'linear-gradient(135deg, #059669 0%, #047857 100%)' : '#ffffff',
                          color: m.role === 'user' ? '#ffffff' : '#1e293b',
                          border: m.role === 'user' ? 'none' : '1px solid #e2e8f0',
                          boxShadow: m.role === 'user' ? '0 2px 6px rgba(5, 150, 105, 0.2)' : '0 2px 5px rgba(0, 0, 0, 0.04)',
                          wordBreak: 'break-word',
                        }}
                      >
                        {m.text}
                      </div>
                    )}

                    {/* Quick Voice Playback for Assistant Replies */}
                    {m.role !== 'user' && voiceAvailable.output && (
                      <button
                        type="button"
                        onClick={() => voice.current?.speak(m.text, voiceLanguage)}
                        title="Listen to this reply aloud"
                        style={{
                          marginTop: '4px',
                          background: 'transparent',
                          border: 'none',
                          color: '#059669',
                          fontSize: '11px',
                          fontWeight: 600,
                          cursor: 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '3px',
                          padding: '2px 4px',
                          borderRadius: '4px',
                          opacity: 0.85,
                        }}
                      >
                        🔊 Listen
                      </button>
                    )}
                  </div>

                  {m.role === 'user' && (
                    <div
                      style={{
                        width: '26px',
                        height: '26px',
                        borderRadius: '50%',
                        background: '#047857',
                        color: '#ffffff',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontSize: '11px',
                        fontWeight: 700,
                        flexShrink: 0,
                        marginTop: '2px',
                      }}
                    >
                      BZ
                    </div>
                  )}
                </div>
              </div>
            ))}

            {thinkingDelta && (
              <div
                className="chat-message-anim"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  padding: '10px 14px',
                  borderRadius: '12px',
                  background: 'linear-gradient(135deg, #fffbeb 0%, #fef3c7 100%)',
                  border: '1px solid #fde68a',
                  color: '#92400e',
                  fontSize: '12px',
                  boxShadow: '0 2px 6px rgba(245, 158, 11, 0.1)',
                }}
              >
                <span>⚡</span>
                <span style={{ fontWeight: 600 }}>{thinkingDelta}</span>
                <span style={{ display: 'inline-flex', gap: '3px', marginLeft: 'auto' }}>
                  <span className="thinking-dot-1" style={{ width: '5px', height: '5px', background: '#d97706', borderRadius: '50%' }} />
                  <span className="thinking-dot-2" style={{ width: '5px', height: '5px', background: '#d97706', borderRadius: '50%' }} />
                  <span className="thinking-dot-3" style={{ width: '5px', height: '5px', background: '#d97706', borderRadius: '50%' }} />
                </span>
              </div>
            )}
            <div ref={chatBottomRef} />
          </div>

          {/* Smart City Suggestion Chips */}
          <div
            className="modern-scroll"
            style={{
              padding: '8px 14px',
              display: 'flex',
              gap: '6px',
              overflowX: 'auto',
              background: '#ffffff',
              borderTop: '1px solid #f1f5f9',
            }}
          >
            {[
              '🅿️ Park in Zone 302A (Burj Khalifa)',
              '⚡ Settle DEWA Bill (420.40 AED)',
              '👮 Pay Dubai Police Fines (-10% Discount)',
              '🏠 Connect Ejari & Move-In for Unit 1402',
              '🏛️ Unified DubaiPay Settlement (DEWA + Police + Salik)',
              '🛣️ Check Salik Balance & Recharge',
              '🛡️ My UAE PASS Citizen Profile',
            ].map((chip) => (
              <button
                key={chip}
                onClick={() => handleSend(chip)}
                style={{
                  padding: '5px 11px',
                  fontSize: '11px',
                  fontWeight: 600,
                  borderRadius: '16px',
                  background: '#f0fdf4',
                  border: '1px solid #bbf7d0',
                  color: '#065f46',
                  whiteSpace: 'nowrap',
                  cursor: 'pointer',
                  transition: 'all 0.15s ease',
                  boxShadow: '0 1px 2px rgba(0,0,0,0.02)',
                }}
                onMouseEnter={(e) => (e.currentTarget.style.background = '#dcfce7')}
                onMouseLeave={(e) => (e.currentTarget.style.background = '#f0fdf4')}
              >
                {chip}
              </button>
            ))}
          </div>

          {/* Floating Voice Active Wave Banner */}
          {voiceState === 'listening' && (
            <div
              style={{
                margin: '8px 14px 0 14px',
                padding: '8px 14px',
                borderRadius: '12px',
                background: 'linear-gradient(135deg, #fef2f2 0%, #fee2e2 100%)',
                border: '1px solid #fca5a5',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                boxShadow: '0 2px 8px rgba(239, 68, 68, 0.12)',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span
                  style={{
                    width: '8px',
                    height: '8px',
                    borderRadius: '50%',
                    background: '#ef4444',
                    display: 'inline-block',
                    animation: 'micPulse 1.4s infinite',
                  }}
                />
                <span style={{ fontSize: '12px', fontWeight: 600, color: '#991b1b' }}>
                  Listening in {voiceLanguage === 'ar-AE' ? 'Arabic' : 'English'}... Speak now
                </span>
                <div style={{ display: 'flex', alignItems: 'center', gap: '3px', marginLeft: '4px' }}>
                  <span className="wave-bar-1" style={{ width: '3px', background: '#ef4444', borderRadius: '2px', display: 'inline-block' }} />
                  <span className="wave-bar-2" style={{ width: '3px', background: '#ef4444', borderRadius: '2px', display: 'inline-block' }} />
                  <span className="wave-bar-3" style={{ width: '3px', background: '#ef4444', borderRadius: '2px', display: 'inline-block' }} />
                  <span className="wave-bar-4" style={{ width: '3px', background: '#ef4444', borderRadius: '2px', display: 'inline-block' }} />
                  <span className="wave-bar-5" style={{ width: '3px', background: '#ef4444', borderRadius: '2px', display: 'inline-block' }} />
                </div>
              </div>
              <button
                type="button"
                onClick={() => {
                  voice.current?.stopListening();
                  if (pendingVoiceText.current) {
                    const toSend = pendingVoiceText.current;
                    pendingVoiceText.current = '';
                    setVoiceCountdown(null);
                    void handleSendRef.current(toSend);
                  }
                }}
                style={{
                  padding: '3px 8px',
                  fontSize: '11px',
                  fontWeight: 700,
                  borderRadius: '6px',
                  background: '#ffffff',
                  border: '1px solid #f87171',
                  color: '#b91c1c',
                  cursor: 'pointer',
                }}
              >
                Done ⏹
              </button>
            </div>
          )}

          {voiceState === 'speaking' && (
            <div
              style={{
                margin: '8px 14px 0 14px',
                padding: '8px 14px',
                borderRadius: '12px',
                background: 'linear-gradient(135deg, #f0fdf4 0%, #dcfce7 100%)',
                border: '1px solid #86efac',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                boxShadow: '0 2px 8px rgba(16, 185, 129, 0.12)',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ fontSize: '13px' }}>🔊</span>
                <span style={{ fontSize: '12px', fontWeight: 600, color: '#166534' }}>
                  Rashid is speaking reply...
                </span>
              </div>
              <button
                type="button"
                onClick={() => voice.current?.cancel()}
                style={{
                  padding: '3px 8px',
                  fontSize: '11px',
                  fontWeight: 700,
                  borderRadius: '6px',
                  background: '#ffffff',
                  border: '1px solid #86efac',
                  color: '#15803d',
                  cursor: 'pointer',
                }}
              >
                Mute 🔇
              </button>
            </div>
          )}

          {voiceError && (
            <div
              style={{
                margin: '8px 14px 0 14px',
                padding: '8px 12px',
                borderRadius: '10px',
                background: '#fffbeb',
                border: '1px solid #fde68a',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                fontSize: '12px',
                color: '#92400e',
              }}
            >
              <span>⚠️ {voiceError}</span>
              <button
                type="button"
                onClick={() => setVoiceError('')}
                style={{
                  background: 'none',
                  border: 'none',
                  color: '#b45309',
                  fontWeight: 700,
                  cursor: 'pointer',
                }}
              >
                ✕
              </button>
            </div>
          )}

          {/* Hands-Free Loop Status Banner */}
          {autoListen && (
            <div
              style={{
                margin: '8px 14px 0 14px',
                padding: '7px 12px',
                borderRadius: '10px',
                background: voiceState === 'listening' ? '#fef2f2' : voiceState === 'speaking' ? '#f0fdf4' : '#f8fafc',
                border: voiceState === 'listening' ? '1px solid #fca5a5' : voiceState === 'speaking' ? '1px solid #86efac' : '1px solid #cbd5e1',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                fontSize: '11.5px',
                color: voiceState === 'listening' ? '#991b1b' : voiceState === 'speaking' ? '#166534' : '#475569',
                boxShadow: '0 1px 3px rgba(0,0,0,0.03)',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <span>{voiceState === 'listening' ? '🔴' : voiceState === 'speaking' ? '🔊' : '🟢'}</span>
                <span style={{ fontWeight: 700 }}>
                  {voiceState === 'listening'
                    ? 'Hands-Free: Listening to you now... Speak anytime'
                    : voiceState === 'speaking'
                    ? 'Hands-Free: Rashid speaking reply (will resume listening)'
                    : 'Hands-Free Active: Speak anytime, auto-submits on pause'}
                </span>
              </div>
              <button
                type="button"
                onClick={() => {
                  setAutoListen(false);
                  autoListenRef.current = false;
                  voice.current?.cancel();
                }}
                style={{
                  background: '#ffffff',
                  border: '1px solid #cbd5e1',
                  borderRadius: '6px',
                  padding: '2px 8px',
                  fontSize: '10.5px',
                  fontWeight: 700,
                  color: '#475569',
                  cursor: 'pointer',
                }}
              >
                Pause Loop ⏸
              </button>
            </div>
          )}

          {/* Voice Auto-Submitting Banner */}
          {voiceCountdown && (
            <div
              style={{
                margin: '8px 14px 0 14px',
                padding: '8px 14px',
                borderRadius: '10px',
                background: 'linear-gradient(135deg, #ecfdf5 0%, #d1fae5 100%)',
                border: '1px solid #6ee7b7',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                fontSize: '12px',
                color: '#065f46',
                boxShadow: '0 2px 6px rgba(5, 150, 105, 0.08)',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span className="spin-loader">⚡</span>
                <span style={{ fontWeight: 600 }}>{voiceCountdown}</span>
                <span style={{ fontSize: '11px', color: '#047857' }}>— sending immediately</span>
              </div>
              <button
                type="button"
                onClick={() => {
                  if (voiceSilenceTimer.current) clearTimeout(voiceSilenceTimer.current);
                  pendingVoiceText.current = '';
                  setVoiceCountdown(null);
                }}
                style={{
                  background: '#ffffff',
                  border: '1px solid #a7f3d0',
                  color: '#047857',
                  fontSize: '11px',
                  fontWeight: 700,
                  borderRadius: '6px',
                  padding: '2px 8px',
                  cursor: 'pointer',
                }}
              >
                Cancel
              </button>
            </div>
          )}

          {/* Unified Modern Input & Microphone Bar */}
          <div
            style={{
              padding: '12px 14px',
              background: '#ffffff',
              borderTop: '1px solid #f1f5f9',
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                background: '#f8fafc',
                border: '1.5px solid #e2e8f0',
                borderRadius: '24px',
                padding: '4px 6px 4px 16px',
                transition: 'all 0.2s ease',
                boxShadow: '0 1px 3px rgba(0, 0, 0, 0.03)',
              }}
            >
              <input
                type="text"
                aria-label="Chat message"
                maxLength={4000}
                placeholder="Ask about parking, utilities, fines, or Ejari..."
                value={prompt}
                onChange={(e) => {
                  if (voiceSilenceTimer.current) clearTimeout(voiceSilenceTimer.current);
                  pendingVoiceText.current = '';
                  setVoiceCountdown(null);
                  voice.current?.cancel();
                  setPrompt(e.target.value);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    if (voiceSilenceTimer.current) clearTimeout(voiceSilenceTimer.current);
                    pendingVoiceText.current = '';
                    setVoiceCountdown(null);
                    handleSend();
                  }
                }}
                style={{
                  flex: 1,
                  border: 'none',
                  background: 'transparent',
                  outline: 'none',
                  fontSize: '13.5px',
                  color: '#0f172a',
                }}
              />

              {/* Modern Mic Button Integrated in Input */}
              <button
                type="button"
                disabled={!voiceAvailable.input}
                aria-pressed={voiceState === 'listening'}
                title={voiceState === 'listening' ? 'Stop listening & send' : 'Start hands-free voice'}
                onClick={() => {
                  setVoiceError('');
                  if (voiceState === 'listening') {
                    voice.current?.stopListening();
                    if (pendingVoiceText.current) {
                      const toSend = pendingVoiceText.current;
                      pendingVoiceText.current = '';
                      setVoiceCountdown(null);
                      void handleSendRef.current(toSend);
                    }
                  } else {
                    setAutoListen(true);
                    autoListenRef.current = true;
                    if (voiceSilenceTimer.current) clearTimeout(voiceSilenceTimer.current);
                    pendingVoiceText.current = '';
                    setVoiceCountdown(null);
                    voice.current?.startListening(voiceLanguage);
                  }
                }}
                className={voiceState === 'listening' ? 'mic-active-pulse' : ''}
                style={{
                  width: '34px',
                  height: '34px',
                  borderRadius: '50%',
                  border: voiceState === 'listening' ? '1px solid #ef4444' : '1px solid #cbd5e1',
                  background: voiceState === 'listening' ? '#ef4444' : '#ffffff',
                  color: voiceState === 'listening' ? '#ffffff' : '#059669',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: '15px',
                  cursor: voiceAvailable.input ? 'pointer' : 'not-allowed',
                  opacity: voiceAvailable.input ? 1 : 0.4,
                  transition: 'all 0.15s ease',
                  flexShrink: 0,
                }}
              >
                🎙️
              </button>

              {/* Modern Send Button */}
              <button
                type="button"
                onClick={() => handleSend()}
                disabled={!prompt.trim()}
                title="Send message"
                style={{
                  width: '34px',
                  height: '34px',
                  borderRadius: '50%',
                  border: 'none',
                  background: prompt.trim() ? '#059669' : '#e2e8f0',
                  color: prompt.trim() ? '#ffffff' : '#94a3b8',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: '13px',
                  fontWeight: 700,
                  cursor: prompt.trim() ? 'pointer' : 'default',
                  transition: 'all 0.15s ease',
                  flexShrink: 0,
                }}
              >
                ➤
              </button>
            </div>
          </div>
        </section>

        {/* Right Pane: Contextual Mini-App Canvas & AG-UI Dynamic Cards */}
        <main style={{ flex: 1, background: '#ffffff', overflowY: 'auto', padding: '24px' }}>
          <div style={{ maxWidth: '820px', margin: '0 auto' }}>
            <div
              style={{
                marginBottom: '20px',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
              }}
            >
              <div>
                <h1
                  style={{
                    fontSize: '20px',
                    fontWeight: 700,
                    color: '#0f172a',
                    margin: '0 0 4px 0',
                  }}
                >
                  {activeTab === 'agent'
                    ? 'Dynamic Smart City AG-UI Canvas'
                    : activeTab === 'mobility'
                    ? 'Smart Mobility & Parking Mini-App'
                    : activeTab === 'utilities'
                    ? 'DEWA Smart Utilities Mini-App'
                    : activeTab === 'citizenpay'
                    ? 'Citizen Pay & Police Fines Mini-App'
                    : 'Ejari Housing & Move-In Mini-App'}
                </h1>
                <p style={{ fontSize: '13px', color: '#64748b', margin: 0 }}>
                  {activeTab === 'agent'
                    ? 'Generative civic UI cards compiled on-the-fly by Rashid (LangGraph Supervisor)'
                    : 'Local demo mini-app; production identity integration is pending'}
                </p>
              </div>
              <span
                style={{
                  fontSize: '11px',
                  background: '#dcfce7',
                  color: '#166534',
                  padding: '4px 10px',
                  borderRadius: '12px',
                  fontWeight: 700,
                }}
              >
                ● Smart City Grid Active
              </span>
            </div>

            {/* If tab is a specific Mini-App, render mounted DOM container */}
            <div style={{ display: activeTab === 'agent' ? 'none' : 'block' }}>
              <div ref={miniAppMountRef} />
            </div>

            {/* Real-Time Municipal Action Progress Banner */}
            {actionPendingMessage && (
              <div
                style={{
                  marginBottom: '18px',
                  padding: '12px 18px',
                  borderRadius: '12px',
                  background: 'linear-gradient(135deg, #ecfdf5 0%, #d1fae5 100%)',
                  border: '1.5px solid #6ee7b7',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '12px',
                  boxShadow: '0 4px 12px rgba(5, 150, 105, 0.12)',
                }}
              >
                <span className="spin-loader" style={{ fontSize: '20px' }}>⏳</span>
                <div>
                  <div style={{ fontSize: '13.5px', fontWeight: 700, color: '#065f46' }}>
                    {actionPendingMessage}
                  </div>
                  <div style={{ fontSize: '11px', color: '#047857', marginTop: '2px' }}>
                    Reconciling state across municipal services & UAE PASS sovereign digital ledger...
                  </div>
                </div>
              </div>
            )}

            {/* If tab is Agent, render AG-UI Surface */}
            {activeTab === 'agent' &&
              (currentSurface ? (
                <A2UIRenderer key={currentSurface.revision} node={currentSurface.view} onDispatchAction={handleDispatchAction} isPending={isActionPending} />
              ) : (
                <div
                  style={{
                    border: '2px dashed #cbd5e1',
                    borderRadius: '16px',
                    padding: '80px 20px',
                    textAlign: 'center',
                    color: '#64748b',
                  }}
                >
                  <div style={{ fontSize: '40px', marginBottom: '14px' }}>🏛️</div>
                  <div
                    style={{
                      fontWeight: 700,
                      fontSize: '17px',
                      color: '#0f172a',
                      marginBottom: '6px',
                    }}
                  >
                    SmartCity Now Citizen Concierge Ready
                  </div>
                  <div style={{ fontSize: '13px', maxWidth: '440px', margin: '0 auto', lineHeight: '1.6' }}>
                    Tap a suggestion chip on the left or enter instructions to manage your RTA parking meters, DEWA smart utilities, Dubai Police fines, and Ejari tenancy.
                  </div>
                </div>
              ))}
          </div>
        </main>
      </div>
    </div>
  );
}

export default App;

