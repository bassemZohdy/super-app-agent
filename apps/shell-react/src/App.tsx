import React, { useState, useEffect, useRef } from 'react';
import { AGUISurfacePayload, A2UIMessageEnvelope } from '@superapp/protocol-core';
import { A2UIRenderer } from './components/A2UIRenderer.js';

export function App() {
  const [sessionId] = useState(() => `sess_${Math.random().toString(36).substring(2, 9)}`);
  const [messages, setMessages] = useState<Array<{ role: string; text: string }>>([
    { role: 'assistant', text: 'Hello! I am your SuperApp Concierge. Ask me to book a ride, order food, or check your wallet.' },
  ]);
  const [prompt, setPrompt] = useState('');
  const [thinkingDelta, setThinkingDelta] = useState<string | null>(null);
  const [currentSurface, setCurrentSurface] = useState<AGUISurfacePayload | null>(null);
  const [activeTab, setActiveTab] = useState<'agent' | 'ride' | 'food' | 'wallet'>('agent');
  const chatBottomRef = useRef<HTMLDivElement>(null);

  const GATEWAY_URL = 'http://localhost:4000';

  // 1. Establish A2-UI Protocol SSE Stream
  useEffect(() => {
    const eventSource = new EventSource(`${GATEWAY_URL}/api/a2ui/stream?sessionId=${sessionId}`);

    eventSource.onmessage = (event) => {
      try {
        const envelope: A2UIMessageEnvelope = JSON.parse(event.data);
        if (envelope.type === 'A2UI_STREAM_DELTA') {
          setThinkingDelta(envelope.data.text);
        } else if (envelope.type === 'A2UI_RENDER_SURFACE') {
          setThinkingDelta(null);
          setCurrentSurface(envelope.data.surface);
          setMessages((prev) => [...prev, { role: 'assistant', text: 'Generated interactive surface for your request.' }]);
        }
      } catch (err) {
        console.error('Failed to parse SSE payload', err);
      }
    };

    return () => {
      eventSource.close();
    };
  }, [sessionId]);

  useEffect(() => {
    chatBottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, thinkingDelta]);

  // 2. Dispatch User Intent
  const handleSend = async (textToSend?: string) => {
    const query = textToSend || prompt;
    if (!query.trim()) return;

    setMessages((prev) => [...prev, { role: 'user', text: query }]);
    setPrompt('');
    setThinkingDelta('Concierge reasoning with LangGraph...');

    try {
      await fetch(`${GATEWAY_URL}/api/a2ui/intent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId,
          text: query,
          handshake: {
            platform: 'react',
            viewport: {
              width: window.innerWidth,
              height: window.innerHeight,
              category: window.innerWidth > 768 ? 'desktop' : 'mobile',
            },
            supportedComponents: ['SurfaceCard', 'ChoiceGroup', 'Button', 'MetricWidget', 'MapViewer'],
          },
        }),
      });
    } catch (err) {
      setThinkingDelta(null);
      setMessages((prev) => [...prev, { role: 'assistant', text: 'Error connecting to Agent Gateway. Please verify services are running.' }]);
    }
  };

  // 3. Dispatch Interactive Action
  const handleDispatchAction = async (action: string, payload: Record<string, any>) => {
    setThinkingDelta(`Executing action: ${action}...`);
    try {
      await fetch(`${GATEWAY_URL}/api/a2ui/action`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId, action, payload }),
      });
    } catch (err) {
      setThinkingDelta(null);
      console.error('Failed to dispatch action', err);
    }
  };

  return (
    <div className="superapp-container">
      {/* SuperApp Top Chrome */}
      <header className="superapp-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <div style={{ background: '#3b82f6', color: '#fff', borderRadius: '8px', padding: '6px 10px', fontWeight: 800 }}>
            SA
          </div>
          <div>
            <div style={{ fontWeight: 700, fontSize: '16px' }}>SuperApp Agent</div>
            <div style={{ fontSize: '11px', color: '#64748b' }}>React 18 Host • A2-UI Protocol Engine</div>
          </div>
        </div>

        {/* Mini-App Quick Switcher */}
        <div style={{ display: 'flex', gap: '8px' }}>
          {(['agent', 'ride', 'food', 'wallet'] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => {
                setActiveTab(tab);
                if (tab !== 'agent') handleSend(`Open ${tab} mini-app`);
              }}
              style={{
                padding: '6px 14px',
                borderRadius: '8px',
                border: '1px solid #e2e8f0',
                background: activeTab === tab ? '#eff6ff' : '#ffffff',
                color: activeTab === tab ? '#2563eb' : '#475569',
                fontWeight: 600,
                fontSize: '13px',
                cursor: 'pointer',
              }}
            >
              {tab.toUpperCase()}
            </button>
          ))}
        </div>

        <div style={{ background: '#ecfdf5', color: '#065f46', padding: '6px 14px', borderRadius: '20px', fontWeight: 600, fontSize: '13px' }}>
          💳 Wallet: $142.50
        </div>
      </header>

      {/* Responsive Workspace Grid */}
      <div className="workspace-grid">
        {/* Left Pane: Conversational Agent Concierge */}
        <section className="concierge-pane">
          <div style={{ padding: '16px', borderBottom: '1px solid #e2e8f0', background: '#ffffff', fontWeight: 600, fontSize: '14px' }}>
            💬 Agent Concierge (LangGraph)
          </div>

          <div style={{ flex: 1, padding: '16px', overflowY: 'auto' }}>
            {messages.map((m, idx) => (
              <div
                key={idx}
                style={{
                  marginBottom: '12px',
                  display: 'flex',
                  justifyContent: m.role === 'user' ? 'flex-end' : 'flex-start',
                }}
              >
                <div
                  style={{
                    maxWidth: '85%',
                    padding: '10px 14px',
                    borderRadius: '12px',
                    fontSize: '14px',
                    lineHeight: '1.4',
                    background: m.role === 'user' ? '#2563eb' : '#ffffff',
                    color: m.role === 'user' ? '#ffffff' : '#0f172a',
                    border: m.role === 'user' ? 'none' : '1px solid #e2e8f0',
                    boxShadow: '0 2px 4px rgba(0,0,0,0.02)',
                  }}
                >
                  {m.text}
                </div>
              </div>
            ))}

            {thinkingDelta && (
              <div style={{ padding: '10px 14px', borderRadius: '12px', background: '#fef3c7', color: '#92400e', fontSize: '13px', fontStyle: 'italic', marginBottom: '10px' }}>
                ⚡ {thinkingDelta}
              </div>
            )}
            <div ref={chatBottomRef} />
          </div>

          {/* Prompt Suggestion Chips */}
          <div style={{ padding: '8px 16px', display: 'flex', gap: '6px', overflowX: 'auto', background: '#f8fafc' }}>
            {['Book a ride to JFK', 'Order spicy pizza', 'Check wallet balance'].map((chip) => (
              <button
                key={chip}
                onClick={() => handleSend(chip)}
                style={{
                  padding: '4px 10px',
                  fontSize: '12px',
                  borderRadius: '16px',
                  background: '#ffffff',
                  border: '1px solid #cbd5e1',
                  color: '#475569',
                  whiteSpace: 'nowrap',
                  cursor: 'pointer',
                }}
              >
                {chip}
              </button>
            ))}
          </div>

          {/* Bottom Chat Prompt Input */}
          <div style={{ padding: '12px 16px', background: '#ffffff', borderTop: '1px solid #e2e8f0', display: 'flex', gap: '8px' }}>
            <input
              type="text"
              placeholder="Ask the SuperApp agent..."
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSend()}
              style={{
                flex: 1,
                padding: '10px 14px',
                borderRadius: '8px',
                border: '1px solid #cbd5e1',
                outline: 'none',
                fontSize: '14px',
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
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              Send
            </button>
          </div>
        </section>

        {/* Right Pane: Contextual Mini-App Canvas & AG-UI Dynamic Cards */}
        <main className="canvas-pane">
          <div style={{ padding: '24px', maxWidth: '800px', margin: '0 auto', width: '100%' }}>
            <div style={{ marginBottom: '20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <h1 style={{ fontSize: '20px', fontWeight: 700 }}>Interactive Workspace Canvas</h1>
                <p style={{ fontSize: '13px', color: '#64748b' }}>Dynamic AG-UI declarative components managed by Backend Agent</p>
              </div>
              <span style={{ fontSize: '11px', background: '#dcfce7', color: '#166534', padding: '4px 8px', borderRadius: '6px', fontWeight: 600 }}>
                ● Protocol Connected
              </span>
            </div>

            {currentSurface ? (
              <A2UIRenderer node={currentSurface.view} onDispatchAction={handleDispatchAction} />
            ) : (
              <div style={{ border: '2px dashed #cbd5e1', borderRadius: '16px', padding: '60px 20px', textAlign: 'center', color: '#64748b' }}>
                <div style={{ fontSize: '32px', marginBottom: '12px' }}>🪄</div>
                <div style={{ fontWeight: 600, fontSize: '16px', marginBottom: '6px' }}>No Active AG-UI Surface</div>
                <div style={{ fontSize: '13px' }}>Ask the concierge a query on the left to generate dynamic interactive UI.</div>
              </div>
            )}
          </div>
        </main>
      </div>
    </div>
  );
}
export default App;
