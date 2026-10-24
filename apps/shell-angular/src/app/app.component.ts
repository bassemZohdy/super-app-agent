import { BrowserAuth } from '../../../../packages/protocol-core/src/oidc-client.ts';
import { delegationResult } from '../../../../packages/protocol-core/src/delegation-client.ts';
import { VoiceClient, type VoiceState } from '../../../../packages/protocol-core/src/voice-client.ts';
import { LocalVoiceApi, type LocalVoiceConfig } from '../../../../packages/protocol-core/src/voice-api.ts';
import { checkedSurface, choiceDefaults, readCoreResponse, surfaceActionPayload } from '../../../../packages/protocol-core/src/surface-client.ts';
import { connectEventStream } from '../../../../packages/protocol-core/src/sse-client.ts';
import { Component, signal, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import type { AGUISurfacePayload, A2UIMessageEnvelope, UIComponentNode } from '../../../../packages/protocol-core/src/index.ts';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div *ngIf="authReady() && loginRequired()" class="sign-in-screen"><h1>Your city. Your account.</h1><p>Sign in to manage personal and household services.</p><p *ngIf="authError()" role="alert">{{ authError() }}</p><button (click)="signIn()">Sign in with Keycloak</button><small>Demo users: bassem or demo-commuter. Password: demo123.</small></div>
    <div *ngIf="!authReady()" class="sign-in-screen" role="status">Preparing your city workspace…</div>
    <div *ngIf="authReady() && !loginRequired()" class="angular-shell-container">
      <header class="header">
        <a class="city-brand" href="#conversation">cityside<span>Your everyday, connected.</span></a>
        <span class="header-caption">Your city concierge</span>
        <select class="account-select" aria-label="Current account" [value]="accountId" [disabled]="pending" (change)="switchAccount($any($event.target).value)"><option *ngFor="let account of accounts()" [value]="account.id">{{ account.label }}</option></select><button *ngIf="auth?.signedIn" class="account" (click)="auth?.logout()">Sign out</button>
        <div class="status" role="status">{{ connectionLabel() }}</div>
        <button class="account" [disabled]="pending" (click)="sendIntent('Show my citizen profile')">{{ userName().slice(0, 1) }} <span>{{ userName() }}</span></button>
      </header>

      <div class="main-layout">
        <!-- Left Pane: Conversational Concierge -->
        <aside class="agent-pane" id="conversation">
          <div class="pane-header">Rashid, your city concierge</div>

          <div class="messages">
            <div *ngFor="let m of messages()" class="msg" [class.user]="m.role === 'user'">
              {{ m.text }}
            </div>
            <div *ngIf="delta()" class="delta">⚡ {{ delta() }}</div>
          </div>

          <div class="suggestion-chips">
            <button [disabled]="pending" (click)="sendIntent('Show parking zones in Downtown Dubai')">Find parking</button>
            <button [disabled]="pending" (click)="sendIntent('Check my DEWA electricity and water bill')">Check my bills</button>
            <button [disabled]="pending" (click)="sendIntent('Show my wallet balance')">My wallet</button>
            <button [disabled]="pending" (click)="sendIntent('I signed my Ejari lease, help me move in')">Moving in</button>
          </div>
          <details class="voice-settings">
            <summary (click)="loadDelegations()">Delegated access</summary>
            <p>Cityside demo broker · current account only · five-minute consent. Review the exact operation before allowing it.</p>
            <button [disabled]="delegationBusy" (click)="createDelegation(false)">Allow up to 3 wallet balance checks</button>
            <button [disabled]="delegationBusy" (click)="createDelegation(true)">Approve one AED 1 demo wallet credit</button>
            <p role="status">{{ delegationNotice() }}</p>
            <div *ngFor="let grant of delegationGrants()">
              <strong>{{ grant.purpose }}</strong><p>{{ grant.used }}/{{ grant.maxOperations }} executions · {{ grant.revokedAt ? 'Revoked' : grant.expiresAt <= now() ? 'Expired' : 'Active' }}</p>
              <button [disabled]="delegationBusy || grant.revokedAt || grant.expiresAt <= now() || grant.used >= grant.maxOperations" (click)="runDelegation(grant.id)">Run approved operation</button>
              <button [disabled]="delegationBusy || grant.revokedAt" (click)="revokeDelegation(grant.id)">Revoke consent</button>
              <button [disabled]="delegationBusy" (click)="delegationHistory(grant.id)">View audit history</button>
            </div>
          </details>
          <details class="voice-settings">
            <summary>Voice &amp; conversation settings</summary>
            <div class="voice-controls">
              <button [disabled]="pending || !voice?.canListen || !localVoice()?.asrReady || voiceState() === 'transcribing'" [attr.aria-pressed]="voiceState() === 'listening'" (click)="toggleMicrophone()">{{ voiceState() === 'listening' ? 'Stop microphone' : 'Use microphone' }}</button>
              <select aria-label="Voice language" [value]="voiceLanguage" (change)="setVoiceLanguage($any($event.target).value)"><option value="en-US">English</option><option value="ar-AE">Arabic dictation · text replies</option></select>
              <label><input type="checkbox" [checked]="readReplies" [disabled]="!voice?.canSpeak || !localVoice()?.ttsReady || voiceLanguage !== 'en-US'" (change)="setReadReplies($any($event.target).checked)" /> Read replies aloud</label>
              <label>Voice preset<select aria-label="Voice preset" [value]="voiceProfile" (change)="voice?.cancel(); voiceProfile = $any($event.target).value"><option *ngFor="let item of localVoice()?.voices" [value]="item.id">{{ item.name }}</option></select></label>
              <label>Speaking speed · {{ voiceSpeed }}×<input aria-label="Speaking speed" type="range" min="0.8" max="1.2" step="0.05" [value]="voiceSpeed" (input)="setVoiceSpeed($any($event.target).value)" /></label>
              <button [disabled]="!localVoice()?.ttsReady || voiceState() !== 'idle'" (click)="previewVoice()">Preview voice</button><button (click)="voice?.cancel()">Stop voice</button><button (click)="refreshVoice()">Refresh local voice</button>
              <button *ngIf="voiceState() !== 'idle'" (click)="voice?.cancel()">Cancel voice</button>
              <p role="status">{{ voiceError() || (voiceState() === 'listening' ? 'Listening. Stop when done; drafts are limited to 15 seconds.' : voiceState() === 'transcribing' ? 'Transcribing locally. Review your draft before sending.' : 'Open-source speech runs on the local app server. Dictation stays a draft until Send.') }}</p>
            </div>
          </details>
          <div class="input-row">
            <input type="text" aria-label="Chat message" maxlength="4000" placeholder="Ask Rashid about your city…" [value]="draft()" (input)="voice?.cancel(); draft.set($any($event.target).value)" (keydown.enter)="sendIntent(draft()); draft.set('')" />
            <button [disabled]="pending" (click)="sendIntent(draft()); draft.set('')">Send</button>
          </div>
        </aside>

        <!-- Right Pane: AG-UI Surface Canvas -->
        <section class="canvas-pane">
          <div class="canvas-header">
            <div>
              <h2 style="font-size: 20px; font-weight: 700; margin: 0 0 4px 0;">Your service workspace</h2>
              <div style="font-size: 13px; color: #64748b;">Options and details, ready for you to review.</div>
            </div>
            <span class="active-pill">Demo services</span>
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
                       class="choice-item" role="radio" tabindex="0" [attr.aria-checked]="choices()[child.id] === opt.id"
                       (keydown.enter)="selectChoice(child.id, opt.id)" (keydown.space)="$event.preventDefault(); selectChoice(child.id, opt.id)"
                       [class.selected]="choices()[child.id] === opt.id"
                       (click)="selectChoice(child.id, opt.id)">
                    <div>
                      <div style="font-weight: 600; font-size: 14px;">{{ opt.title }}</div>
                      <div style="font-size: 12px; color: #64748b;">{{ opt.subtitle }}</div>
                    </div>
                    <div style="font-weight: 800; font-size: 15px;">{{ opt.price }}</div>
                  </div>
                </div>

                <!-- MapViewer Simulated View -->
                <div *ngIf="child.type === 'MapViewer'" class="map-viewer">
                  <div class="map-tag">Simulated locations</div>
                  <div style="display: flex; gap: 8px;">
                    <span *ngFor="let m of child.properties?.markers" class="map-pin">🚗 {{ m.title }}</span>
                  </div>
                </div>

                <!-- Button -->
                <button *ngIf="child.type === 'Button'" 
                        class="ag-action-btn"
                        [disabled]="pending || child.properties?.disabled === true"
                        (click)="dispatchAction(child)">
                  {{ child.properties?.label }}
                </button>
              </div>
            </div>
          </div>

          <div *ngIf="!surface()" class="empty">
            <div class="empty-emblem">✧</div>
            <div style="font-weight: 700; font-size: 16px; margin-bottom: 6px;">A little help. A lot more city.</div>
            <div style="font-size: 13px;">From your morning commute to your next move, let’s take care of it. Choose a service to get started.</div>
          </div>
        </section>
      </div>
    </div>
  `,
  styles: [`
    .sign-in-screen { min-height: 100dvh; padding: 40px; display: flex; align-items: center; justify-content: center; flex-direction: column; gap: 18px; background: #f0f5f8; text-align: center; }.sign-in-screen h1 { color: #285c76; font-size: 36px; }.sign-in-screen button { border: none; border-radius: 9px; background: #285c76; color: white; padding: 14px 24px; }.sign-in-screen small { color: #7d94a4; }.account-select { border: 1px solid #dbe6ed; background: white; color: #52788f; padding: 8px; border-radius: 7px; font-size: 11px; max-width: 140px; }
    :host { display: block; color: #314d61; font-family: 'Avenir Next', Avenir, 'Segoe UI', sans-serif; }
    * { box-sizing: border-box; }
    button, input, select { font: inherit; } button { cursor: pointer; } button:disabled { opacity: .5; cursor: not-allowed; }
    button:focus-visible, [tabindex]:focus-visible, summary:focus-visible, a:focus-visible { outline: 3px solid #77a5bb; outline-offset: 3px; }
    .angular-shell-container { display: flex; flex-direction: column; height: 100dvh; background: #fff; }
    .header { min-height: 82px; display: flex; align-items: center; gap: 25px; padding: 0 32px; border-bottom: 1px solid #e3ebf0; }
    .city-brand { color: #254c64; font-size: 29px; font-weight: 700; text-decoration: none; letter-spacing: -1.2px; }.city-brand span { display: block; font-size: 9px; letter-spacing: 0; font-weight: 400; color: #8194a1; margin-top: 1px; }
    .header-caption { font-size: 12px; color: #8398a6; border-left: 1px solid #e0e8ed; padding-left: 25px; }.status { margin-left: auto; font-size: 10px; color: #618c7a; }.account { border: none; border-radius: 20px; background: #eef3f7; color: #496b80; padding: 10px; font-size: 10px; }.account span { margin-left: 6px; }
    .main-layout { display: flex; flex: 1; overflow: hidden; min-height: 0; }.agent-pane { width: 44%; min-width: 330px; display: flex; flex-direction: column; border-right: 1px solid #e3ebf0; }.pane-header { padding: 24px; font-size: 13px; font-weight: 600; border-bottom: 1px solid #edf1f4; }
    .messages { flex: 1; overflow-y: auto; padding: 26px; display: flex; flex-direction: column; gap: 22px; }.msg { font-size: 13px; line-height: 1.9; max-width: 92%; white-space: pre-wrap; overflow-wrap: anywhere; }.msg.user { align-self: flex-end; background: #edf4f8; padding: 12px 16px; border-radius: 13px 13px 3px 13px; }.delta { font-size: 11px; color: #6e8b9d; line-height: 1.7; }
    .suggestion-chips { display: flex; gap: 7px; padding: 15px 22px; overflow-x: auto; }.suggestion-chips button { border: 1px solid #dfe9ef; background: white; color: #658298; border-radius: 7px; padding: 8px 11px; white-space: nowrap; font-size: 10px; }.suggestion-chips button:hover { background: #f0f6fa; }
    .voice-settings { margin: 0 24px 10px; font-size: 10px; color: #8297a4; }.voice-settings summary { cursor: pointer; padding: 7px 0; }.voice-controls { display: flex; flex-wrap: wrap; gap: 10px; padding: 12px 0; align-items: center; }.voice-controls button, .voice-controls select { border: 1px solid #dae5ec; background: white; color: #52778e; border-radius: 5px; padding: 7px; }.voice-controls p { font-size: 9px; line-height: 1.7; margin: 0; }
    .input-row { display: flex; gap: 8px; margin: 0 22px 22px; border: 1px solid #d7e3eb; border-radius: 12px; padding: 10px; }.input-row:focus-within { border-color: #81a6bc; }.input-row input { flex: 1; min-width: 0; border: 0; outline: none; padding: 9px; font-size: 12px; color: #355a72; }.input-row button { border: none; border-radius: 7px; background: #285c76; color: white; padding: 9px 17px; font-size: 11px; }
    .canvas-pane { flex: 1; min-width: 0; padding: 30px; background: #f7fafc; overflow-y: auto; }.canvas-header { display: flex; align-items: center; justify-content: space-between; gap: 15px; margin-bottom: 28px; }.canvas-header h2 { color: #355a70; font-size: 19px !important; }.active-pill { background: #e6eff4; color: #7493a6; border-radius: 5px; padding: 5px 9px; font-size: 9px; white-space: nowrap; }.surface-container { max-width: 730px; margin: auto; }.surface-card { border: 1px solid #e0e8ee; padding: 24px; border-radius: 14px; background: white; }.metric-widget { border-bottom: 1px solid #e5edf2; padding: 16px 0; display: flex; justify-content: space-between; gap: 15px; margin-bottom: 10px; }.metric-label { color: #879aa7; font-size: 11px; }.metric-val { color: #31576f; font-size: 19px; font-weight: 600; }.choice-group { display: flex; flex-direction: column; gap: 9px; margin: 17px 0; }.choice-item { display: flex; justify-content: space-between; gap: 12px; padding: 14px; border: 1px solid #e0e8ed; border-radius: 8px; cursor: pointer; }.choice-item.selected { border-color: #6291ab; background: #f0f7fb; }.map-viewer { min-height: 130px; background: #eaf2f7; border-radius: 10px; padding: 22px; color: #7492a5; margin-bottom: 18px; }.map-tag { font-size: 9px; margin-top: 15px; }.map-pin { font-size: 12px; }.ag-action-btn { width: 100%; padding: 13px; border: none; border-radius: 8px; color: white; background: #285c76; font-size: 12px; margin-top: 10px; }.empty { max-width: 500px; margin: 60px auto; text-align: left; padding: 30px; color: #8499a7; line-height: 1.9; }.empty-emblem { display: grid; place-items: center; height: 60px; width: 60px; border-radius: 18px; background: #e5eff5; color: #6092ad; font-size: 40px; margin-bottom: 26px; }.empty > div:nth-child(2) { font-size: 30px !important; line-height: 1.3; font-weight: 500 !important; color: #355a70; letter-spacing: -.9px; }
    @media (max-width: 760px) { .header { padding: 15px 20px; min-height: 72px; gap: 14px; }.header-caption, .account span { display: none; }.header { flex-wrap: wrap; }.account-select { max-width: 135px; }.status { order: 3; width: 100%; text-align: right; }.main-layout { flex-direction: column; overflow-y: auto; }.agent-pane { width: 100%; min-width: 0; min-height: 50dvh; flex-shrink: 0; border-right: none; border-bottom: 1px solid #dfe8ee; }.messages { min-height: 100px; max-height: 40dvh; padding: 20px; }.canvas-pane { min-height: 340px; flex-shrink: 0; padding: 25px 20px; overflow: visible; }.canvas-header h2 { font-size: 16px !important; }.canvas-header > div > div { font-size: 11px !important; }.empty { margin: 0 auto; padding: 20px 5px; }.surface-card { padding: 18px; }.input-row input { font-size: 16px; }.status { font-size: 9px; }.account { flex-shrink: 0; } }
  `]
})
export class AppComponent implements OnInit, OnDestroy {
  delegationGrants = signal<any[]>([]);
  delegationNotice = signal('');
  delegationBusy = false;
  now = () => Date.now();
  private async delegationApi(path = '', method = 'GET', body?: unknown) {
    const response = await fetch(`http://localhost:4000/api/delegation/grants${path}`, { method, headers: { Authorization: `Bearer ${await this.auth?.token()}`, 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    const data = await response.json(); if (!response.ok) throw new Error(data.error || data.code); return data;
  }
  async loadDelegations() { try { const data = await this.delegationApi(); this.delegationGrants.set(data.grants.filter((g: any) => g.accountId === this.accountId)); } catch (e) { this.delegationNotice.set((e as Error).message); } }
  private async delegationWork(fn: () => Promise<void>) { this.delegationBusy = true; try { await fn(); await this.loadDelegations(); } catch (e) { this.delegationNotice.set((e as Error).message); } finally { this.delegationBusy = false; } }
  createDelegation(write: boolean) { void this.delegationWork(async () => { await this.delegationApi('', 'POST', { accountId: this.accountId, provider: 'payments', method: write ? 'POST' : 'GET', path: write ? '/topups' : '/wallet', body: write ? { amountMinor: 100, source: 'demo_approved' } : {}, purpose: write ? 'Approve one synthetic AED 1 wallet credit' : 'Check my synthetic wallet balance', expiresInSeconds: 300, maxOperations: write ? 1 : 3 }); this.delegationNotice.set('Consent saved. Review the grant before running it.'); }); }
  runDelegation(id: string) { void this.delegationWork(async () => { const data = await this.delegationApi(`/${id}/execute`, 'POST', { requestKey: crypto.randomUUID() }); this.delegationNotice.set(delegationResult(data.result)); }); }
  revokeDelegation(id: string) { void this.delegationWork(async () => { await this.delegationApi(`/${id}`, 'DELETE'); this.delegationNotice.set('Consent revoked. Further delegated operations will be denied.'); }); }
  delegationHistory(id: string) { void this.delegationWork(async () => { const data = await this.delegationApi(`/${id}/history`); this.delegationNotice.set(data.history.map((e: any) => e.event).join(', ')); }); }
  auth?: BrowserAuth;
  authReady = signal(false);
  loginRequired = signal(false);
  authError = signal('');
  userName = signal('Demo citizen');
  accounts = signal<Array<{ id: string; label: string }>>([]);
  accountId = '';
  signIn() { void this.auth?.login().catch(error => this.authError.set(error.message)); }
  async switchAccount(id: string) {
    if (this.pending || this.delegationBusy) return;
    this.streamController.abort(); this.streamController = new AbortController();
    this.accountId = id; this.sessionId = `ng_${crypto.randomUUID()}`;
    this.delegationGrants.set([]); void this.loadDelegations();
    this.messages.set([]); this.surface.set(null); this.choices.set({});
    this.connectStream();
  }
  connectionLabel = signal('Connecting…');
  voice?: VoiceClient;
  voiceState = signal<VoiceState>('idle');
  voiceError = signal('');
  draft = signal('');
  readReplies = false;
  voiceLanguage = 'en-US';
  voiceProfile = 'Jasper';
  voiceSpeed = 1;
  localVoice = signal<LocalVoiceConfig | null>(null);
  voiceApi?: LocalVoiceApi;
  setVoiceSpeed(value: string) { this.voice?.cancel(); this.voiceSpeed = Number(value); }
  previewVoice() { this.voice?.speak('Marhaba. I am Rashid, your city concierge. Tell me what you need, and we will take it one step at a time.', 'en-US'); }
  async refreshVoice() { try { this.localVoice.set(await this.voiceApi!.config()); this.voiceError.set(''); } catch (e) { this.voiceError.set((e as Error).message); } }
  private visibilityHandler = () => { if (document.hidden) this.voice?.cancel(); };
  toggleMicrophone() {
    this.voiceError.set('');
    if (this.voiceState() === 'listening') this.voice?.stopListening();
    else this.voice?.startListening(this.voiceLanguage);
  }
  setVoiceLanguage(value: string) { this.voice?.cancel(); this.voiceLanguage = value; if (value !== 'en-US') this.readReplies = false; }
  setReadReplies(value: boolean) { this.readReplies = value; if (!value) this.voice?.cancel(); }
  private streamController = new AbortController();
  messages = signal<Array<{ role: string; text: string }>>([
    { role: 'assistant', text: 'Marhaba. I’m Rashid, your city concierge. Ask me about getting around, home essentials, payments or moving in.' }
  ]);
  delta = signal<string | null>(null);
  surface = signal<AGUISurfacePayload | null>(null);
  choices = signal<Record<string, string>>({});
  pending = false;
  selectChoice(group: string, choice: string) { this.choices.update(prev => ({ ...prev, [group]: choice })); }
  applySurface(value: unknown) {
    const surface = checkedSurface(value, this.sessionId);
    if (this.surface()?.revision === surface.revision) return;
    this.choices.set(choiceDefaults(surface.view));
    this.surface.set(surface);
    if (surface.assistantMessage) {
      this.messages.update(prev => [...prev, { role: 'assistant', text: surface.assistantMessage!.text }]);
      if (this.readReplies && this.voiceLanguage === 'en-US') this.voice?.speak(surface.assistantMessage.text, this.voiceLanguage);
    }
  }
  showError(text: string) { this.messages.update(prev => [...prev, { role: 'assistant', text }]); }
  async applyResponse(res: Response) {
    const result = await readCoreResponse(res, this.sessionId);
    if (result.surface) this.applySurface(result.surface);
    if (result.error && result.error !== result.surface?.assistantMessage?.text) this.showError(result.error);
  }
  sessionId = `ng_${Date.now()}`;
  keycloakToken = 'demo-local'; // local demo only

  async ngOnInit() {
    void fetch('http://localhost:4000/health').then(r => r.json()).then(data => this.connectionLabel.set(data.llm?.enabled ? data.llm?.ready ? 'Local model ready' : 'Local model warming up' : 'Demo mode')).catch(() => this.connectionLabel.set('Gateway offline'));
    this.voiceApi = new LocalVoiceApi('http://localhost:4000', () => this.auth?.token() || 'demo-local');
    this.voice = new VoiceClient({ onTranscript: text => this.draft.set(text), onState: state => this.voiceState.set(state), onError: error => this.voiceError.set(error), allowBrowserFallback: false,
      fetchAudio: (text, language, signal) => this.voiceApi!.speech(text, language, this.voiceProfile, this.voiceSpeed, signal), transcribeAudio: (input, signal) => this.voiceApi!.transcribe(input, signal) });
    document.addEventListener('visibilitychange', this.visibilityHandler);
    try {
      const config = await (await fetch('http://localhost:4000/api/auth/config')).json();
      this.auth = new BrowserAuth(config); await this.auth.completeLogin();
      if (config.enabled && !this.auth.signedIn) { this.loginRequired.set(true); return; }
      const response = await fetch('http://localhost:4000/api/accounts', { headers: { Authorization: `Bearer ${await this.auth.token()}` } });
      if (!response.ok) throw new Error('Could not load your accounts. Sign in again.');
      const data = await response.json(); this.accounts.set(data.accounts); this.accountId = data.accounts[0]?.id || ''; this.userName.set(data.user?.name || 'Demo citizen');
      this.connectStream();
      void this.refreshVoice();
    } catch (error) { this.authError.set((error as Error).message); this.loginRequired.set(true); }
    finally { this.authReady.set(true); }
  }
  connectStream() {
    void connectEventStream({
      url: `http://localhost:4000/api/a2ui/stream?sessionId=${this.sessionId}&accountId=${encodeURIComponent(this.accountId)}`,
      getToken: () => this.auth?.token() || 'demo-local', signal: this.streamController.signal,
      onMessage: data => {
        if (data.type === 'A2UI_STREAM_DELTA') this.delta.set(data.data.text);
        else if (data.type === 'A2UI_RENDER_SURFACE') { this.delta.set(null); try { this.applySurface(data.data.surface); } catch (error) { this.showError((error as Error).message); } }
      }, onError: error => this.authError.set(error.message),
    });
  }

  ngOnDestroy() { this.streamController.abort(); this.voice?.dispose(); document.removeEventListener('visibilitychange', this.visibilityHandler); }

  async sendIntent(text: string) {
    if (!text.trim() || this.pending) return;
    this.pending = true;
    this.voice?.cancel();
    this.messages.update((m) => [...m, { role: 'user', text }]);
    this.delta.set('Preparing your request...');

    try {
      const res = await fetch('http://localhost:4000/api/a2ui/intent', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${await this.auth?.token() || 'demo-local'}`
        },
        body: JSON.stringify({
          sessionId: this.sessionId,
          accountId: this.accountId,
          text,
          handshake: {
            platform: 'angular',
            viewport: { width: window.innerWidth, height: window.innerHeight, category: 'desktop' },
            supportedComponents: ['SurfaceCard', 'ChoiceGroup', 'Button', 'MetricWidget', 'MapViewer']
          }
        })
      });
      await this.applyResponse(res);
    } catch (e) {
      this.delta.set(null);
      this.showError('Could not read the gateway response. Check status before retrying.');
    } finally { this.pending = false; this.delta.set(null); }
  }

  async dispatchAction(node: UIComponentNode) {
    if (this.pending || node.properties?.disabled) return;
    const binding = node.onEvents?.find(event => event.event === 'onPress');
    if (!binding || !this.surface()) { this.showError('No active action is available.'); return; }
    let payload: Record<string, any>;
    try { payload = surfaceActionPayload(this.surface()!.view, binding, this.choices()); }
    catch (error) { this.showError((error as Error).message); return; }
    const action = binding.payload.action;
    this.pending = true;
    this.voice?.cancel();
    this.delta.set(`⚡ Executing action: ${action}...`);
    try {
      const res = await fetch('http://localhost:4000/api/a2ui/action', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${await this.auth?.token() || 'demo-local'}`
        },
        body: JSON.stringify({
          sessionId: this.sessionId,
          accountId: this.accountId,
          action,
          surfaceRevision: this.surface()?.revision,
          payload
        })
      });
      await this.applyResponse(res);
    } catch (e) {
      this.delta.set(null);
      this.showError('Could not confirm the action result. Check status before retrying.');
    } finally { this.pending = false; this.delta.set(null); }
  }
}

