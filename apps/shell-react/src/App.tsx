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

export function App() {
  const [sessionId] = useState(() => `sess_${Math.random().toString(36).substring(2, 9)}`);
  const [messages, setMessages] = useState<Array<{ role: string; text: string }>>([
    {
      role: 'assistant',
      text: 'Marhaba Bassem! I am Rashid, your Smart City Citizen Concierge (DubaiNow / TAMM). You can ask me to activate smart parking in Downtown, check DEWA electricity & water telemetry, settle Dubai Police traffic fines, or manage your Ejari lease.',
    },
  ]);
  const [prompt, setPrompt] = useState('');
  const [thinkingDelta, setThinkingDelta] = useState<string | null>(null);
  const [currentSurface, setCurrentSurface] = useState<AGUISurfacePayload | null>(null);
  const voice = useRef<VoiceClient>();
  const [voiceState, setVoiceState] = useState<VoiceState>('idle');
  const [voiceError, setVoiceError] = useState('');
  const [voiceAvailable, setVoiceAvailable] = useState({ input: false, output: false });
  const [voiceLanguage, setVoiceLanguage] = useState('en-US');
  const [readReplies, setReadReplies] = useState(false);
  const voiceSettings = useRef({ readReplies, language: voiceLanguage });
  voiceSettings.current = { readReplies, language: voiceLanguage };
  useEffect(() => {
    const client = new VoiceClient({ onTranscript: text => setPrompt(text), onState: setVoiceState, onError: setVoiceError });
    voice.current = client;
    setVoiceAvailable({ input: client.canListen, output: client.canSpeak });
    const hidden = () => { if (document.hidden) client.cancel(); };
    document.addEventListener('visibilitychange', hidden);
    return () => { document.removeEventListener('visibilitychange', hidden); client.dispose(); };
  }, []);
  const lastRevision = useRef<string>();
  const requestPending = useRef(false);
  const applySurface = (value: unknown) => {
    const surface = checkedSurface(value, sessionId);
    if (lastRevision.current === surface.revision) return;
    lastRevision.current = surface.revision;
    setCurrentSurface(surface);
    setActiveTab('agent');
    if (surface.assistantMessage) {
      setMessages(prev => [...prev, { role: 'assistant', text: surface.assistantMessage!.text }]);
      if (voiceSettings.current.readReplies) voice.current?.speak(surface.assistantMessage.text, voiceSettings.current.language);
    }
  };
  const showError = (text: string) => setMessages(prev => [...prev, { role: 'assistant', text }]);
  const applyResponse = async (res: Response) => {
    const result = await readCoreResponse(res, sessionId);
    if (result.surface) applySurface(result.surface);
    if (result.error && result.error !== result.surface?.assistantMessage?.text) showError(result.error);
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
    requestPending.current = true;
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
      setMessages((prev) => [
        ...prev,
        {
          role: 'assistant',
          text: 'Error connecting to Agent Gateway. Please verify services are running on port 4000.',
        },
      ]);
    } finally {
      requestPending.current = false;
      setThinkingDelta(null);
    }
  };

  // 4. Dispatch Interactive Action
  const handleDispatchAction = async (action: string, payload: Record<string, any>) => {
    if (action === 'CLIENT_ERROR') { showError(payload.error); return; }
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
      showError('Could not confirm the action result. Check status before retrying.');
    } finally {
      requestPending.current = false;
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
              DubaiNow & TAMM Reference Architecture • UAE PASS Sovereign IAM
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
                key={idx}
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
                        background: 'linear-gradient(135deg, #059669 0%, #10b981 100%)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontSize: '13px',
                        flexShrink: 0,
                        marginTop: '2px',
                      }}
                    >
                      🏛️
                    </div>
                  )}

                  <div
                    style={{
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: m.role === 'user' ? 'flex-end' : 'flex-start',
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
                      <span>{m.role === 'user' ? 'You' : 'Rashid'}</span>
                      {m.role === 'user' && (
                        <span style={{ fontSize: '9px', background: '#dcfce7', color: '#166534', padding: '1px 5px', borderRadius: '4px', fontWeight: 700 }}>
                          UAE PASS
                        </span>
                      )}
                    </div>

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
                onClick={() => voice.current?.stopListening()}
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
                  voice.current?.cancel();
                  setPrompt(e.target.value);
                }}
                onKeyDown={(e) => e.key === 'Enter' && handleSend()}
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
                title={voiceState === 'listening' ? 'Stop listening' : 'Dictate with microphone'}
                onClick={() => {
                  setVoiceError('');
                  if (voiceState === 'listening') {
                    voice.current?.stopListening();
                  } else {
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

            {/* If tab is Agent, render AG-UI Surface */}
            {activeTab === 'agent' &&
              (currentSurface ? (
                <A2UIRenderer key={currentSurface.revision} node={currentSurface.view} onDispatchAction={handleDispatchAction} />
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

