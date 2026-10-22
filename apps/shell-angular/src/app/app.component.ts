import { Component, signal, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { AGUISurfacePayload, A2UIMessageEnvelope } from '@superapp/protocol-core';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="angular-shell-container">
      <header class="header">
        <div class="logo">SA Angular</div>
        <div class="title">SuperApp Agent • Angular 18 Host</div>
        <div class="status">⚡ Connected to Gateway (:4000)</div>
      </header>

      <div class="main-layout">
        <aside class="agent-pane">
          <h3>💬 Agent Concierge (Angular Signals)</h3>
          <div class="messages">
            <div *ngFor="let m of messages()" class="msg" [class.user]="m.role === 'user'">
              {{ m.text }}
            </div>
            <div *ngIf="delta()" class="delta">⚡ {{ delta() }}</div>
          </div>
          <div class="input-row">
            <button (click)="sendIntent('Book a comfort ride to airport')">Book Cab</button>
            <button (click)="sendIntent('Order pizza from menu')">Order Pizza</button>
          </div>
        </aside>

        <section class="canvas-pane">
          <h3>Canvas / AG-UI Surface</h3>
          <div *ngIf="surface()" class="surface-card">
            <h4>{{ surface()?.view?.type }} ({{ surface()?.view?.id }})</h4>
            <p>AG-UI Dynamic tree received via SSE stream.</p>
          </div>
          <div *ngIf="!surface()" class="empty">
            Select an action on the left to render AG-UI schema.
          </div>
        </section>
      </div>
    </div>
  `,
  styles: [`
    .angular-shell-container { display: flex; flex-direction: column; height: 100vh; font-family: sans-serif; }
    .header { height: 60px; background: #0f172a; color: white; display: flex; align-items: center; padding: 0 20px; justify-content: space-between; }
    .main-layout { display: flex; flex: 1; }
    .agent-pane { width: 40%; background: #f8fafc; border-right: 1px solid #e2e8f0; padding: 20px; display: flex; flex-direction: column; }
    .canvas-pane { width: 60%; padding: 24px; background: white; }
    .msg { padding: 10px; border-radius: 8px; background: white; margin-bottom: 8px; border: 1px solid #e2e8f0; }
    .msg.user { background: #3b82f6; color: white; }
    .delta { font-style: italic; color: #b45309; padding: 8px; }
    .surface-card { border: 1px solid #cbd5e1; border-radius: 12px; padding: 16px; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.1); }
    .empty { padding: 40px; border: 2px dashed #cbd5e1; text-align: center; color: #64748b; }
    .input-row { display: flex; gap: 8px; margin-top: auto; }
    button { padding: 8px 14px; background: #2563eb; color: white; border: none; border-radius: 6px; cursor: pointer; }
  `]
})
export class AppComponent implements OnInit {
  messages = signal<Array<{ role: string; text: string }>>([
    { role: 'assistant', text: 'Welcome to SuperApp Angular Shell!' }
  ]);
  delta = signal<string | null>(null);
  surface = signal<AGUISurfacePayload | null>(null);
  sessionId = `ng_${Date.now()}`;

  ngOnInit() {
    const sse = new EventSource(`http://localhost:4000/api/a2ui/stream?sessionId=${this.sessionId}`);
    sse.onmessage = (event) => {
      const data: A2UIMessageEnvelope = JSON.parse(event.data);
      if (data.type === 'A2UI_STREAM_DELTA') {
        this.delta.set(data.data.text);
      } else if (data.type === 'A2UI_RENDER_SURFACE') {
        this.delta.set(null);
        this.surface.set(data.data.surface);
      }
    };
  }

  async sendIntent(text: string) {
    this.messages.update((m) => [...m, { role: 'user', text }]);
    this.delta.set('Agent reasoning...');
    await fetch('http://localhost:4000/api/a2ui/intent', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sessionId: this.sessionId,
        text,
        handshake: { platform: 'angular', viewport: { width: 1024, height: 768, category: 'desktop' }, supportedComponents: ['SurfaceCard'] }
      })
    });
  }
}
