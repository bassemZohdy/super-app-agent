import React, { useState, useEffect, useRef } from 'react';
import type { AGUISurfacePayload, A2UIMessageEnvelope } from '../../../packages/protocol-core/src/index.ts';
import { A2UIRenderer } from './components/A2UIRenderer.tsx';
import { mountRideMiniApp, unmountRideMiniApp } from '../../../mini-apps/miniapp-ride/src/index.tsx';
import { mountFoodMiniApp, unmountFoodMiniApp } from '../../../mini-apps/miniapp-food/src/index.tsx';
import { mountWalletMiniApp, unmountWalletMiniApp } from '../../../mini-apps/miniapp-wallet/src/index.tsx';

export function App() {
  const [sessionId] = useState(() => `sess_${Math.random().toString(36).substring(2, 9)}`);
  const [messages, setMessages] = useState<Array<{ role: string; text: string }>>([
    { role: 'assistant', text: 'Marhaba Bassem! I am your Smart City Citizen Concierge (DubaiNow / TAMM). You can ask me to park your car in Downtown, pay DEWA electricity bills, clear police traffic fines, or manage your Ejari tenancy.' },
  ]);
  const [prompt, setPrompt] = useState('');
  const [thinkingDelta, setThinkingDelta] = useState<string | null>(null);
  const [currentSurface, setCurrentSurface] = useState<AGUISurfacePayload | null>(null);
  const [activeTab, setActiveTab] = useState<'agent' | 'ride' | 'food' | 'wallet'>('agent');
  const [walletBalance, setWalletBalance] = useState<number>(250.0);
  const [mobileDrawerOpen, setMobileDrawerOpen] = useState(false);

  const chatBottomRef = useRef<HTMLDivElement>(null);
  const miniAppMountRef = useRef<HTMLDivElement>(null);

  const GATEWAY_URL = 'http://localhost:4000';
  const DEMO_KEYCLOAK_TOKEN = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCIsImtpZCI6ImtleWNsb2FrLXN1cGVyYXBwLWtleS0xIn0.eyJleHAiOjE5OTk5OTk5OTksInN1YiI6InVzcl9iYXNzZW1fb2lkYyIsInByZWZlcnJlZF91c2VybmFtZSI6ImJhc3NlbSIsImVtYWlsIjoiYmFzc2VtQHN1cGVyYXBwLmludGVybmFsIiwibmFtZSI6IkJhc3NlbSBab2hkeSIsInZpcFRpZXIiOiJHb2xkIFZJUCIsInJvbGVzIjpbInN1cGVyYXBwLXVzZXIiLCJzdXBlcmFwcC12aXAiXX0.sig_keycloak_verified';

  // 1. Establish A2-UI Protocol SSE Stream
  useEffect(() => {
    let eventSource: EventSource | null = null;
    try {
      eventSource = new EventSource(`${GATEWAY_URL}/api/a2ui/stream?sessionId=${sessionId}&token=${DEMO_KEYCLOAK_TOKEN}`);

      eventSource.onmessage = (event) => {
        try {
          const envelope: A2UIMessageEnvelope = JSON.parse(event.data);
          if (envelope.type === 'A2UI_STREAM_DELTA') {
            setThinkingDelta(envelope.data.text);
          } else if (envelope.type === 'A2UI_RENDER_SURFACE') {
            setThinkingDelta(null);
            setCurrentSurface(envelope.data.surface);
            setActiveTab('agent');
            setMessages((prev) => [...prev, { role: 'assistant', text: 'Prepared interactive surface for your request.' }]);
          } else if (envelope.type === 'A2UI_LAUNCH_MINIAPP') {
            const appId = envelope.data.miniAppId;
            if (appId.includes('ride')) setActiveTab('ride');
            else if (appId.includes('food')) setActiveTab('food');
            else if (appId.includes('wallet')) setActiveTab('wallet');
          }
        } catch (err) {
          console.error('Failed to parse SSE payload', err);
        }
      };
    } catch (e) {
      console.warn('SSE stream unavailable on local environment', e);
    }

    return () => {
      eventSource?.close();
    };
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
        if (eventName === 'RIDE_BOOKED') {
          handleDispatchAction('book_ride', payload);
        } else if (eventName === 'FOOD_ORDER_PLACED') {
          handleDispatchAction('order_food', payload);
        } else if (eventName === 'WALLET_TOPPED_UP') {
          setWalletBalance((prev) => prev + payload.amount);
          handleDispatchAction('topup_wallet', payload);
        }
      },
    };

    if (activeTab === 'ride') {
      mountRideMiniApp(context);
    } else if (activeTab === 'food') {
      mountFoodMiniApp(context);
    } else if (activeTab === 'wallet') {
      mountWalletMiniApp(context);
    }

    return () => {
      if (activeTab === 'ride') unmountRideMiniApp(context);
      else if (activeTab === 'food') unmountFoodMiniApp(context);
      else if (activeTab === 'wallet') unmountWalletMiniApp(context);
    };
  }, [activeTab, sessionId]);

  // 3. Dispatch User Intent to Gateway
  const handleSend = async (textToSend?: string) => {
    const query = textToSend || prompt;
    if (!query.trim()) return;

    setMessages((prev) => [...prev, { role: 'user', text: query }]);
    setPrompt('');
    setThinkingDelta('🧠 Supervisor reasoning with LangGraph...');

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
        { role: 'assistant', text: 'Error connecting to Agent Gateway. Please verify services are running on port 4000.' },
      ]);
    }
  };

  // 4. Dispatch Interactive Action
  const handleDispatchAction = async (action: string, payload: Record<string, any>) => {
    setThinkingDelta(`⚡ Executing action: ${action}...`);
    try {
      const res = await fetch(`${GATEWAY_URL}/api/a2ui/action`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${DEMO_KEYCLOAK_TOKEN}`,
        },
        body: JSON.stringify({ sessionId, action, payload }),
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

  return (
    <div className="superapp-container" style={{ display: 'flex', flexDirection: 'column', height: '100vh', fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif' }}>
      {/* SuperApp Top Chrome */}
      <header
        style={{
          height: '60px',
          background: '#0f172a',
          color: '#ffffff',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '0 20px',
          borderBottom: '1px solid #1e293b',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <div style={{ background: '#059669', color: '#fff', borderRadius: '8px', padding: '6px 10px', fontWeight: 800, fontSize: '14px' }}>
            DXB
          </div>
          <div>
            <div style={{ fontWeight: 700, fontSize: '15px' }}>SmartCity Now • Unified Citizen Agent</div>
            <div style={{ fontSize: '11px', color: '#94a3b8' }}>DubaiNow & TAMM Reference Architecture • UAE PASS Sovereign IAM</div>
          </div>
        </div>

        {/* Mini-App Quick Switcher */}
        <div style={{ display: 'flex', gap: '6px' }}>
          {[
            { id: 'agent', label: '🤖 AI CONCIERGE' },
            { id: 'ride', label: '🚗 SMART MOBILITY' },
            { id: 'food', label: '⚡ UTILITIES (DEWA)' },
            { id: 'wallet', label: '💳 CITIZEN PAY' },
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as any)}
              style={{
                padding: '6px 12px',
                borderRadius: '8px',
                border: activeTab === tab.id ? '1px solid #10b981' : '1px solid #334155',
                background: activeTab === tab.id ? '#064e3b' : '#1e293b',
                color: activeTab === tab.id ? '#6ee7b7' : '#cbd5e1',
                fontWeight: 600,
                fontSize: '12px',
                cursor: 'pointer',
              }}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          {/* UAE PASS Authenticated Citizen Profile */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', background: '#1e293b', border: '1px solid #334155', borderRadius: '20px', padding: '4px 12px' }}>
            <span style={{ fontSize: '13px' }}>🛡️</span>
            <span style={{ fontSize: '12px', fontWeight: 600, color: '#f8fafc' }}>Bassem Zohdy</span>
            <span style={{ background: '#f59e0b', color: '#78350f', fontSize: '10px', fontWeight: 700, padding: '2px 6px', borderRadius: '10px' }}>🌟 Golden Visa</span>
          </div>

          <div style={{ background: '#064e3b', color: '#6ee7b7', padding: '6px 14px', borderRadius: '20px', fontWeight: 700, fontSize: '13px' }}>
            💳 {walletBalance.toFixed(2)} AED
          </div>
        </div>
      </header>

      {/* Responsive Workspace Grid */}
      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
        {/* Left Pane: Persistent Conversational Agent Concierge (38% width on desktop) */}
        <section
          style={{
            width: '38%',
            minWidth: '320px',
            borderRight: '1px solid #e2e8f0',
            background: '#f8fafc',
            display: 'flex',
            flexDirection: 'column',
          }}
        >
          <div style={{ padding: '14px 18px', borderBottom: '1px solid #e2e8f0', background: '#ffffff', fontWeight: 700, fontSize: '14px', color: '#0f172a' }}>
            💬 Rashid • Smart City Citizen Concierge (LangGraph)
          </div>

          <div style={{ flex: 1, padding: '16px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '10px' }}>
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
                    background: m.role === 'user' ? '#2563eb' : '#ffffff',
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
              <div style={{ padding: '10px 14px', borderRadius: '10px', background: '#fef3c7', color: '#92400e', fontSize: '12px', fontStyle: 'italic' }}>
                ⚡ {thinkingDelta}
              </div>
            )}
            <div ref={chatBottomRef} />
          </div>

          {/* Quick-Prompt Suggestion Chips */}
          <div style={{ padding: '8px 14px', display: 'flex', gap: '6px', overflowX: 'auto', background: '#ffffff', borderTop: '1px solid #f1f5f9' }}>
            {[
              '🅿️ Park in Zone 302A & Find EV Charger',
              '⚡ Pay DEWA Bill & Police Fines',
              '🛣️ Check Salik Balance & Recharge',
              '🏠 Connect Ejari & Utilities for Unit 1402',
              '🛡️ My UAE PASS Citizen Profile',
              '🚗 Book Ride to Airport',
            ].map((chip) => (
              <button
                key={chip}
                onClick={() => handleSend(chip)}
                style={{
                  padding: '5px 10px',
                  fontSize: '11px',
                  fontWeight: 600,
                  borderRadius: '14px',
                  background: '#f1f5f9',
                  border: '1px solid #cbd5e1',
                  color: '#334155',
                  whiteSpace: 'nowrap',
                  cursor: 'pointer',
                }}
              >
                {chip}
              </button>
            ))}
          </div>

          {/* Bottom Chat Prompt Input */}
          <div style={{ padding: '12px 14px', background: '#ffffff', borderTop: '1px solid #e2e8f0', display: 'flex', gap: '8px' }}>
            <input
              type="text"
              placeholder="Ask the concierge..."
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
                background: '#2563eb',
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

        {/* Right Pane: Contextual Mini-App Canvas & AG-UI Dynamic Cards (62% width) */}
        <main style={{ flex: 1, background: '#ffffff', overflowY: 'auto', padding: '24px' }}>
          <div style={{ maxWidth: '800px', margin: '0 auto' }}>
            <div style={{ marginBottom: '20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <h1 style={{ fontSize: '20px', fontWeight: 700, color: '#0f172a', margin: '0 0 4px 0' }}>
                  {activeTab === 'agent' ? 'Dynamic AG-UI Canvas' : `${activeTab.toUpperCase()} Mini-App`}
                </h1>
                <p style={{ fontSize: '13px', color: '#64748b', margin: 0 }}>
                  {activeTab === 'agent'
                    ? 'Server-driven generative UI compiled on-the-fly by the backend agent'
                    : 'Independently mounted microfrontend module inside the host shell'}
                </p>
              </div>
              <span style={{ fontSize: '11px', background: '#dcfce7', color: '#166534', padding: '4px 10px', borderRadius: '12px', fontWeight: 700 }}>
                ● Protocol Stream Active
              </span>
            </div>

            {/* If tab is a specific Mini-App, render mounted DOM container */}
            <div style={{ display: activeTab === 'agent' ? 'none' : 'block' }}>
              <div ref={miniAppMountRef} />
            </div>

            {/* If tab is Agent, render AG-UI Surface */}
            {activeTab === 'agent' && (
              currentSurface ? (
                <A2UIRenderer node={currentSurface.view} onDispatchAction={handleDispatchAction} />
              ) : (
                <div style={{ border: '2px dashed #cbd5e1', borderRadius: '16px', padding: '80px 20px', textAlign: 'center', color: '#64748b' }}>
                  <div style={{ fontSize: '36px', marginBottom: '14px' }}>🪄</div>
                  <div style={{ fontWeight: 700, fontSize: '16px', color: '#0f172a', marginBottom: '6px' }}>Ready for Your Instructions</div>
                  <div style={{ fontSize: '13px', maxWidth: '420px', margin: '0 auto' }}>
                    Type a query or tap a suggestion chip on the left to orchestrate multi-domain mini-apps and render generative UI cards.
                  </div>
                </div>
              )
            )}
          </div>
        </main>
      </div>
    </div>
  );
}

export default App;
