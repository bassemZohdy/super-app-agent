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
  const [activeTab, setActiveTab] = useState<SmartCityTab>('agent');
  const [walletBalance, setWalletBalance] = useState<number>(250.0);

  const chatBottomRef = useRef<HTMLDivElement>(null);
  const miniAppMountRef = useRef<HTMLDivElement>(null);

  const GATEWAY_URL = import.meta.env.VITE_GATEWAY_URL || 'http://localhost:4000';
  const DEMO_KEYCLOAK_TOKEN = 'demo-local'; // local demo only, not a production credential

  // 1. Establish A2-UI Protocol SSE Stream
  useEffect(() => {
    const controller = new AbortController();
    void connectEventStream({
      url: `${GATEWAY_URL}/api/a2ui/stream?sessionId=${sessionId}`,
      getToken: () => DEMO_KEYCLOAK_TOKEN,
      signal: controller.signal,
      onMessage: (envelope: A2UIMessageEnvelope) => {
          if (envelope.type === 'A2UI_STREAM_DELTA') {
            setThinkingDelta(envelope.data.text);
          } else if (envelope.type === 'A2UI_RENDER_SURFACE') {
            setThinkingDelta(null);
            setCurrentSurface(envelope.data.surface);
            setActiveTab('agent');
            setMessages((prev) => [
              ...prev,
              { role: 'assistant', text: 'Prepared interactive Smart City surface for your request.' },
            ]);
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
    if (!query.trim()) return;

    setMessages((prev) => [...prev, { role: 'user', text: query }]);
    setPrompt('');
    setThinkingDelta('🧠 Rashid (LangGraph) reasoning with smart city services...');

    try {
      const res = await fetch(`${GATEWAY_URL}/api/a2ui/intent`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${DEMO_KEYCLOAK_TOKEN}`,
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

      if (res.ok) {
        const data = await res.json();
        if (data.surface) {
          setThinkingDelta(null);
          setCurrentSurface(data.surface);
          setActiveTab('agent');
        }
      }
    } catch (err) {
      setThinkingDelta(null);
      setMessages((prev) => [
        ...prev,
        {
          role: 'assistant',
          text: 'Error connecting to Agent Gateway. Please verify services are running on port 4000.',
        },
      ]);
    }
  };

  // 4. Dispatch Interactive Action
  const handleDispatchAction = async (action: string, payload: Record<string, any>) => {
    if (action === 'LAUNCH_MINIAPP') {
      const miniAppId = payload.miniAppId || '';
      if (miniAppId.includes('mobility') || miniAppId.includes('ride')) setActiveTab('mobility');
      else if (miniAppId.includes('utilities') || miniAppId.includes('food')) setActiveTab('utilities');
      else if (miniAppId.includes('citizenpay') || miniAppId.includes('wallet')) setActiveTab('citizenpay');
      else if (miniAppId.includes('housing')) setActiveTab('housing');
      return;
    }

    setThinkingDelta(`⚡ Processing Smart City action: ${action}...`);
    try {
      const res = await fetch(`${GATEWAY_URL}/api/a2ui/action`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${DEMO_KEYCLOAK_TOKEN}`,
        },
        body: JSON.stringify({ sessionId, surfaceRevision: currentSurface?.revision, action, payload }),
      });

      if (res.ok) {
        const data = await res.json();
        setThinkingDelta(null);
        if (data.surface) {
          setCurrentSurface(data.surface);
          setActiveTab('agent');
        }
      }
    } catch (err) {
      setThinkingDelta(null);
      console.error('Failed to dispatch action', err);
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
          <div
            style={{
              padding: '14px 18px',
              borderBottom: '1px solid #e2e8f0',
              background: '#ffffff',
              fontWeight: 700,
              fontSize: '14px',
              color: '#0f172a',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
            }}
          >
            <span>💬 Rashid • Smart City Citizen Concierge</span>
            <span
              style={{
                fontSize: '10px',
                background: '#ecfdf5',
                color: '#065f46',
                padding: '2px 6px',
                borderRadius: '4px',
                fontWeight: 700,
              }}
            >
              UAE PASS VERIFIED
            </span>
          </div>

          <div
            style={{
              flex: 1,
              padding: '16px',
              overflowY: 'auto',
              display: 'flex',
              flexDirection: 'column',
              gap: '10px',
            }}
          >
            {messages.map((m, idx) => (
              <div
                key={idx}
                style={{
                  display: 'flex',
                  justifyContent: m.role === 'user' ? 'flex-end' : 'flex-start',
                }}
              >
                <div
                  style={{
                    maxWidth: '85%',
                    padding: '10px 14px',
                    borderRadius: '12px',
                    fontSize: '13px',
                    lineHeight: '1.5',
                    background: m.role === 'user' ? '#059669' : '#ffffff',
                    color: m.role === 'user' ? '#ffffff' : '#0f172a',
                    border: m.role === 'user' ? 'none' : '1px solid #e2e8f0',
                    boxShadow: '0 1px 3px rgba(0,0,0,0.05)',
                  }}
                >
                  {m.text}
                </div>
              </div>
            ))}

            {thinkingDelta && (
              <div
                style={{
                  padding: '10px 14px',
                  borderRadius: '10px',
                  background: '#fef3c7',
                  color: '#92400e',
                  fontSize: '12px',
                  fontStyle: 'italic',
                }}
              >
                ⚡ {thinkingDelta}
              </div>
            )}
            <div ref={chatBottomRef} />
          </div>

          {/* Smart City Suggestion Chips */}
          <div
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
                  padding: '5px 10px',
                  fontSize: '11px',
                  fontWeight: 600,
                  borderRadius: '14px',
                  background: '#f0fdf4',
                  border: '1px solid #bbf7d0',
                  color: '#065f46',
                  whiteSpace: 'nowrap',
                  cursor: 'pointer',
                  transition: 'background 0.15s ease',
                }}
              >
                {chip}
              </button>
            ))}
          </div>

          {/* Bottom Chat Prompt Input */}
          <div
            style={{
              padding: '12px 14px',
              background: '#ffffff',
              borderTop: '1px solid #e2e8f0',
              display: 'flex',
              gap: '8px',
            }}
          >
            <input
              type="text"
              placeholder="Ask about parking, utilities, fines, or Ejari..."
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSend()}
              style={{
                flex: 1,
                padding: '10px 14px',
                borderRadius: '8px',
                border: '1px solid #cbd5e1',
                outline: 'none',
                fontSize: '13px',
              }}
            />
            <button
              onClick={() => handleSend()}
              style={{
                background: '#059669',
                color: '#fff',
                border: 'none',
                borderRadius: '8px',
                padding: '10px 16px',
                fontWeight: 700,
                fontSize: '13px',
                cursor: 'pointer',
              }}
            >
              Send
            </button>
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
                    : 'Independently mounted microfrontend module verified under UAE PASS sovereign identity'}
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

