import { connectEventStream } from '../../../../packages/protocol-core/src/sse-client.ts';
import { Component, signal, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import type { AGUISurfacePayload, A2UIMessageEnvelope, UIComponentNode } from '../../../../packages/protocol-core/src/index.ts';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="angular-shell-container">
      <header class="header">
        <div style="display: flex; align-items: center; gap: 12px;">
          <div class="logo" style="background: #059669;">DXB</div>
          <div>
            <div style="font-weight: 700; font-size: 15px;">SmartCity Now • Angular 18</div>
            <div style="font-size: 11px; color: #94a3b8;">DubaiNow & TAMM Reference • A2-UI Protocol Engine</div>
          </div>
        </div>
        <div style="display: flex; align-items: center; gap: 8px; background: #064e3b; border: 1px solid #059669; border-radius: 20px; padding: 4px 12px; font-size: 12px; color: #f8fafc;">
          <span>🛡️ Bassem Zohdy</span>
          <span style="background: #f59e0b; color: #78350f; font-size: 10px; font-weight: 700; padding: 2px 6px; border-radius: 10px;">🌟 Golden Visa</span>
        </div>
        <div class="status">⚡ Connected to Gateway (:4000)</div>
        <div class="balance">💳 Wallet: 250.00 AED</div>
      </header>

      <div class="main-layout">
        <!-- Left Pane: Conversational Concierge -->
        <aside class="agent-pane">
          <div class="pane-header">💬 Rashid • Smart City Citizen Concierge (LangGraph)</div>

          <div class="messages">
            <div *ngFor="let m of messages()" class="msg" [class.user]="m.role === 'user'">
              {{ m.text }}
            </div>
            <div *ngIf="delta()" class="delta">⚡ {{ delta() }}</div>
          </div>

          <!-- Suggestion Chips -->
          <div class="suggestion-chips">
            <button (click)="sendIntent('Park in Zone 302A Downtown Dubai')">🅿️ Park in Zone 302A</button>
            <button (click)="sendIntent('Check my DEWA electricity and water bill for premise DEWA-201948201')">⚡ Settle DEWA Bill</button>
            <button (click)="sendIntent('Check my Dubai Police traffic radar fines for plate Dubai B-74892')">👮 Clear Police Fines</button>
            <button (click)="sendIntent('I just signed my Ejari lease, connect my utilities and issue parking for Unit 1402')">🏠 Ejari Move-In</button>
            <button (click)="sendIntent('Pay my DEWA electricity bill, settle my police radar fines, and recharge my Salik tag')">🏛️ Unified DubaiPay</button>
            <button (click)="sendIntent('Show my UAE PASS citizen profile and registered vehicles and premises')">🛡️ UAE PASS Profile</button>
          </div>

          <div class="input-row">
            <input #promptInput type="text" placeholder="Ask the concierge..." (keydown.enter)="sendIntent(promptInput.value); promptInput.value = ''" />
            <button (click)="sendIntent(promptInput.value); promptInput.value = ''">Send</button>
          </div>
        </aside>

        <!-- Right Pane: AG-UI Surface Canvas -->
        <section class="canvas-pane">
          <div class="canvas-header">
            <div>
              <h2 style="font-size: 20px; font-weight: 700; margin: 0 0 4px 0;">Dynamic AG-UI Canvas</h2>
              <div style="font-size: 13px; color: #64748b;">Server-driven generative UI rendered natively in Angular 18</div>
            </div>
            <span class="active-pill">● SSE Connected</span>
          </div>

          <div *ngIf="surface()" class="surface-container">
            <div class="surface-card" [id]="surface()?.view?.id">
              <div *ngFor="let child of surface()?.view?.children" class="node-wrapper">
                
                <!-- Heading -->
                <h2 *ngIf="child.type === 'Heading'" style="font-size: 18px; font-weight: 700; margin-bottom: 12px; color: #0f172a;">
                  {{ child.properties?.text }}
                </h2>

                <!-- Text -->
                <p *ngIf="child.type === 'Text'" style="color: #334155; font-size: 14px; line-height: 1.5; margin-bottom: 12px;">
                  {{ child.properties?.text }}
                </p>

                <!-- MetricWidget -->
                <div *ngIf="child.type === 'MetricWidget'" class="metric-widget">
                  <span class="metric-label">{{ child.properties?.label }}</span>
                  <span class="metric-val">{{ child.properties?.value }}</span>
                </div>

                <!-- ChoiceGroup -->
                <div *ngIf="child.type === 'ChoiceGroup'" class="choice-group">
                  <div *ngFor="let opt of child.properties?.options" 
                       class="choice-item" 
                       [class.selected]="selectedChoice() === opt.id"
                       (click)="selectedChoice.set(opt.id)">
                    <div>
                      <div style="font-weight: 600; font-size: 14px;">{{ opt.title }}</div>
                      <div style="font-size: 12px; color: #64748b;">{{ opt.subtitle }}</div>
                    </div>
                    <div style="font-weight: 800; font-size: 15px;">{{ opt.price }}</div>
                  </div>
                </div>

                <!-- MapViewer Simulated View -->
                <div *ngIf="child.type === 'MapViewer'" class="map-viewer">
                  <div class="map-tag">📍 Live Route Telemetry (GPS)</div>
                  <div style="display: flex; gap: 8px;">
                    <span *ngFor="let m of child.properties?.markers" class="map-pin">🚗 {{ m.title }}</span>
                  </div>
                </div>

                <!-- Button -->
                <button *ngIf="child.type === 'Button'" 
                        class="ag-action-btn"
                        (click)="dispatchAction(child.onEvents?.[0]?.payload?.action || 'submit')">
                  {{ child.properties?.label }}
                </button>
              </div>
            </div>
          </div>

          <div *ngIf="!surface()" class="empty">
            <div style="font-size: 36px; margin-bottom: 12px;">🪄</div>
            <div style="font-weight: 700; font-size: 16px; margin-bottom: 6px;">Ready for Your Instructions</div>
            <div style="font-size: 13px;">Type a query or tap a suggestion chip on the left to orchestrate multi-domain mini-apps.</div>
          </div>
        </section>
      </div>
    </div>
  `,
  styles: [`
    .angular-shell-container { display: flex; flex-direction: column; height: 100vh; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
    .header { height: 60px; background: #0f172a; color: white; display: flex; align-items: center; padding: 0 20px; justify-content: space-between; border-bottom: 1px solid #1e293b; }
    .logo { background: #2563eb; color: #fff; border-radius: 8px; padding: 6px 10px; font-weight: 800; font-size: 14px; }
    .status { font-size: 12px; color: #94a3b8; }
    .balance { background: #064e3b; color: #6ee7b7; padding: 6px 14px; border-radius: 20px; font-weight: 700; font-size: 13px; }
    .main-layout { display: flex; flex: 1; overflow: hidden; }
    .agent-pane { width: 38%; min-width: 320px; background: #f8fafc; border-right: 1px solid #e2e8f0; display: flex; flex-direction: column; }
    .pane-header { padding: 14px 18px; border-bottom: 1px solid #e2e8f0; background: #ffffff; font-weight: 700; font-size: 14px; color: #0f172a; }
    .canvas-pane { flex: 1; padding: 24px; background: white; overflow-y: auto; }
    .canvas-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px; max-width: 800px; margin-left: auto; margin-right: auto; }
    .active-pill { font-size: 11px; background: #dcfce7; color: #166534; padding: 4px 10px; border-radius: 12px; font-weight: 700; }
    .messages { flex: 1; padding: 16px; overflow-y: auto; display: flex; flex-direction: column; gap: 10px; }
    .msg { padding: 10px 14px; border-radius: 12px; background: white; border: 1px solid #e2e8f0; max-width: 85%; font-size: 13px; line-height: 1.5; }
    .msg.user { background: #2563eb; color: white; align-self: flex-end; border: none; }
    .delta { font-style: italic; color: #92400e; padding: 10px 14px; background: #fef3c7; border-radius: 10px; font-size: 12px; }
    .suggestion-chips { padding: 8px 14px; display: flex; gap: 6px; overflow-x: auto; background: #ffffff; border-top: 1px solid #f1f5f9; }
    .suggestion-chips button { padding: 5px 10px; font-size: 11px; font-weight: 600; border-radius: 14px; background: #f1f5f9; border: 1px solid #cbd5e1; color: #334155; white-space: nowrap; cursor: pointer; }
    .input-row { display: flex; gap: 8px; padding: 12px 14px; background: #ffffff; border-top: 1px solid #e2e8f0; }
    .input-row input { flex: 1; padding: 10px 14px; border-radius: 8px; border: 1px solid #cbd5e1; outline: none; font-size: 13px; }
    .input-row button { padding: 10px 16px; background: #2563eb; color: white; border: none; border-radius: 8px; cursor: pointer; font-weight: 700; }
    .surface-container { max-width: 800px; margin: 0 auto; }
    .surface-card { border: 1px solid #e2e8f0; border-radius: 16px; padding: 24px; box-shadow: 0 4px 12px -2px rgba(0,0,0,0.05); background: #ffffff; }
    .metric-widget { background: #f8fafc; border: 1px solid #e2e8f0; padding: 14px 18px; border-radius: 12px; margin-bottom: 12px; display: flex; justify-content: space-between; align-items: center; }
    .metric-label { color: #64748b; font-size: 12px; font-weight: 600; text-transform: uppercase; }
    .metric-val { font-weight: 800; font-size: 17px; color: #0f172a; }
    .choice-group { display: flex; flex-direction: column; gap: 8px; margin-bottom: 16px; }
    .choice-item { display: flex; justify-content: space-between; align-items: center; padding: 12px 16px; border-radius: 10px; border: 1px solid #e2e8f0; cursor: pointer; }
    .choice-item.selected { border: 2px solid #2563eb; background: #eff6ff; }
    .map-viewer { height: 140px; background: #e2e8f0; border: 1px solid #cbd5e1; border-radius: 12px; margin-bottom: 16px; display: flex; flex-direction: column; justify-content: center; align-items: center; gap: 10px; position: relative; }
    .map-tag { position: absolute; bottom: 8px; right: 12px; font-size: 10px; color: #64748b; background: rgba(255,255,255,0.8); padding: 2px 6px; border-radius: 4px; }
    .map-pin { background: white; padding: 6px 12px; border-radius: 20px; font-size: 12px; font-weight: 700; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
    .ag-action-btn { width: 100%; padding: 12px 18px; border-radius: 10px; font-weight: 700; font-size: 14px; background: #2563eb; color: #ffffff; border: none; cursor: pointer; margin-top: 10px; }
    .empty { max-width: 800px; margin: 40px auto; border: 2px dashed #cbd5e1; border-radius: 16px; padding: 80px 20px; text-align: center; color: #64748b; }
  `]
})
export class AppComponent implements OnInit, OnDestroy {
  private streamController = new AbortController();
  messages = signal<Array<{ role: string; text: string }>>([
    { role: 'assistant', text: 'Welcome to SuperApp Angular Shell! Ask me to book a ride, order food, or check your wallet.' }
  ]);
  delta = signal<string | null>(null);
  surface = signal<AGUISurfacePayload | null>(null);
  selectedChoice = signal<string>('drv_1');
  sessionId = `ng_${Date.now()}`;
  keycloakToken = 'demo-local'; // local demo only

  ngOnInit() {
    void connectEventStream({
      url: `http://localhost:4000/api/a2ui/stream?sessionId=${this.sessionId}`,
      getToken: () => this.keycloakToken,
      signal: this.streamController.signal,
      onMessage: (data) => {
        if (data.type === 'A2UI_STREAM_DELTA') this.delta.set(data.data.text);
        else if (data.type === 'A2UI_RENDER_SURFACE') {
          this.delta.set(null);
          this.surface.set(data.data.surface);
          this.messages.update(m => [...m, { role: 'assistant', text: 'Prepared interactive surface for your request.' }]);
        }
      },
      onError: error => console.warn('Event stream unavailable', error.message),
    });
  }

  ngOnDestroy() { this.streamController.abort(); }

  async sendIntent(text: string) {
    if (!text.trim()) return;
    this.messages.update((m) => [...m, { role: 'user', text }]);
    this.delta.set('🧠 Supervisor reasoning with LangGraph...');

    try {
      const res = await fetch('http://localhost:4000/api/a2ui/intent', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.keycloakToken}`
        },
        body: JSON.stringify({
          sessionId: this.sessionId,
          text,
          handshake: {
            platform: 'angular',
            viewport: { width: window.innerWidth, height: window.innerHeight, category: 'desktop' },
            supportedComponents: ['SurfaceCard', 'ChoiceGroup', 'Button', 'MetricWidget', 'MapViewer']
          }
        })
      });
      if (res.ok) {
        const data = await res.json();
        if (data.surface) {
          this.delta.set(null);
          this.surface.set(data.surface);
        }
      }
    } catch (e) {
      this.delta.set(null);
      this.messages.update((m) => [...m, { role: 'assistant', text: 'Error connecting to Gateway at :4000.' }]);
    }
  }

  async dispatchAction(action: string) {
    this.delta.set(`⚡ Executing action: ${action}...`);
    try {
      const res = await fetch('http://localhost:4000/api/a2ui/action', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.keycloakToken}`
        },
        body: JSON.stringify({
          sessionId: this.sessionId,
          action,
          surfaceRevision: this.surface()?.revision,
          payload: { selectedChoice: this.selectedChoice() }
        })
      });
      if (res.ok) {
        const data = await res.json();
        this.delta.set(null);
        if (data.surface) {
          this.surface.set(data.surface);
        }
      }
    } catch (e) {
      this.delta.set(null);
      console.error('Failed to dispatch action', e);
    }
  }
}

