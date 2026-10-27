import { SUPPORTED_COMPONENT_TYPES } from '../../../../packages/protocol-core/src/ag-ui.ts';
import { SurfaceNodeComponent } from './surface-node.component.ts';
import { ConnectionsComponent } from './connections.component.ts';
import { WorkspacePanesComponent } from './workspace-panes.component.ts';
import { modelStatusLabel, type ModelStatus } from '../../../../packages/protocol-core/src/model-status.ts';
import { BrowserAuth } from '../../../../packages/protocol-core/src/oidc-client.ts';
import { delegationResult } from '../../../../packages/protocol-core/src/delegation-client.ts';
import { VoiceClient, type VoiceState } from '../../../../packages/protocol-core/src/voice-client.ts';
import { LocalVoiceApi, type LocalVoiceConfig } from '../../../../packages/protocol-core/src/voice-api.ts';
import { checkedSurface, choiceDefaults, readCoreResponse, surfaceActionPayload } from '../../../../packages/protocol-core/src/surface-client.ts';
import { connectEventStream } from '../../../../packages/protocol-core/src/sse-client.ts';
import { Component, computed, signal, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import type { AGUISurfacePayload, UIComponentNode } from '../../../../packages/protocol-core/src/index.ts';
import { setAmountLocale } from '../../../../packages/protocol-core/src/payments.ts';
import { direction, isLocale, preferredLocale, translate, type CatalogKey, type Locale } from '../../../../packages/protocol-core/src/i18n.ts';
import { environment } from '../environments/environment.ts';

const GATEWAY_URL = environment.gatewayUrl;

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [CommonModule, WorkspacePanesComponent, ConnectionsComponent, SurfaceNodeComponent],
  template: `
    <div *ngIf="authReady() && loginRequired()" class="sign-in-screen"><h1>{{ t('ng.signin.title') }}</h1><p>{{ t('ng.signin.hint') }}</p><p *ngIf="authError()" role="alert">{{ authError() }}</p><button (click)="signIn()">{{ t('ng.signin.button') }}</button><small>{{ t('ng.signin.demo') }}</small></div>
    <div *ngIf="!authReady()" class="sign-in-screen" role="status">{{ t('ng.preparing') }}</div>
    <div *ngIf="authReady() && !loginRequired()" class="angular-shell-container">
      <header class="header">
        <a class="city-brand" href="#conversation">cityside<span>{{ t('ng.tagline') }}</span></a>
        <span class="header-caption">{{ t('ng.caption') }}</span>
        <select class="account-select" [attr.aria-label]="t('ng.account')" [value]="accountId" [disabled]="pending" (change)="switchAccount($any($event.target).value)"><option *ngFor="let account of accounts()" [value]="account.id">{{ account.label }}</option></select><select class="account-select" [attr.aria-label]="t('ng.language')" [value]="locale()" (change)="setLocale($any($event.target).value)"><option value="en">English</option><option value="ar">العربية</option></select><button *ngIf="auth?.signedIn" class="account" (click)="auth?.logout()">{{ t('ng.signOut') }}</button>
        <select class="account-select" aria-label="Explore services" [disabled]="pending || !serviceOptions().length" (change)="openService($any($event.target).value)"><option value="">{{ t('nav.exploreServices') }}</option><option *ngFor="let service of serviceOptions()" [value]="service.id">{{ service.name || service.id }}</option></select>
        <button class="account" (click)="connectionsOpen = !connectionsOpen">{{ t('tools.connections') }}</button>
        <a class="account" href="/services/fines">Fines &amp; renewal</a>
        <div class="status" role="status">{{ connectionLabel() }}</div>
        <button class="account" [disabled]="pending" (click)="sendIntent('Show my citizen profile')">{{ displayName().slice(0, 1) }} <span>{{ displayName() }}</span></button>
      </header>

      <cityside-workspace-panes [conversation]="conversationPane" [details]="detailsPane">
        <ng-template #conversationPane>
        <!-- Left Pane: Conversational Concierge -->
        <aside class="agent-pane" id="conversation">
          <div class="pane-header">{{ t('ng.pane') }}</div>

          <div class="messages">
            <div *ngFor="let m of messages()" class="msg" [class.user]="m.role === 'user'">
              {{ m.text }}
            </div>
            <div *ngIf="delta()" class="delta">⚡ {{ delta() }}</div>
          </div>

          <div class="suggestion-chips">
            <button [disabled]="pending" (click)="newConversation()">{{ t('app.newConversation') }}</button>
            <button [disabled]="pending" (click)="sendIntent('Show parking zones in Downtown Dubai')">{{ t('ng.chip.parking') }}</button>
            <button [disabled]="pending" (click)="sendIntent('Check my DEWA electricity and water bill')">{{ t('ng.chip.bills') }}</button>
            <button [disabled]="pending" (click)="sendIntent('Show my wallet balance')">{{ t('ng.chip.wallet') }}</button>
            <button [disabled]="pending" (click)="sendIntent('I signed my Ejari lease, help me move in')">{{ t('ng.chip.moving') }}</button>
          </div>
          <details class="voice-settings">
            <summary (click)="loadDelegations()">{{ t('ng.deleg.title') }}</summary>
            <p>{{ t('ng.deleg.intro') }}</p>
            <button [disabled]="delegationBusy" (click)="createDelegation(false)">{{ t('ng.deleg.allowReads') }}</button>
            <button [disabled]="delegationBusy" (click)="createDelegation(true)">{{ t('ng.deleg.approveCredit') }}</button>
            <p role="status">{{ delegationNotice() }}</p>
            <div *ngFor="let grant of delegationGrants()">
              <strong>{{ grant.purpose }}</strong><p>{{ t('ng.deleg.status', { used: grant.used, max: grant.maxOperations, state: grant.revokedAt ? t('ng.deleg.revoked') : grant.expiresAt <= now() ? t('ng.deleg.expired') : t('ng.deleg.active') }) }}</p>
              <button [disabled]="delegationBusy || grant.revokedAt || grant.expiresAt <= now() || grant.used >= grant.maxOperations" (click)="runDelegation(grant.id)">{{ t('ng.deleg.run') }}</button>
              <button [disabled]="delegationBusy || grant.revokedAt" (click)="revokeDelegation(grant.id)">{{ t('ng.deleg.revoke') }}</button>
              <button [disabled]="delegationBusy" (click)="delegationHistory(grant.id)">{{ t('ng.deleg.history') }}</button>
            </div>
          </details>
          <details class="voice-settings">
            <summary>{{ t('ng.voice.title') }}</summary>
            <label><input type="checkbox" [checked]="shareProfile()" [disabled]="pending" (change)="changeShareProfile($any($event.target).checked)" />{{ t('settings.shareProfile') }}</label>
            <p role="status">{{ privacyNotice() }}</p>
            <div class="voice-controls">
              <button [disabled]="pending || !voice?.canListen || !localVoice()?.asrReady || voiceState() === 'transcribing'" [attr.aria-pressed]="voiceState() === 'listening'" (click)="toggleMicrophone()">{{ voiceState() === 'listening' ? t('ng.voice.stopMic') : t('ng.voice.useMic') }}</button>
              <select [attr.aria-label]="t('ng.voice.language')" [value]="voiceLanguage" (change)="setVoiceLanguage($any($event.target).value)"><option value="en-US">English</option><option value="ar-AE">{{ t('ng.voice.arabic') }}</option></select>
              <label><input type="checkbox" [checked]="readReplies" [disabled]="!voice?.canSpeak || !localVoice()?.ttsReady || voiceLanguage !== 'en-US'" (change)="setReadReplies($any($event.target).checked)" /> {{ t('ng.voice.readAloud') }}</label>
              <label>{{ t('ng.voice.preset') }}<select [attr.aria-label]="t('ng.voice.preset')" [value]="voiceProfile" (change)="voice?.cancel(); voiceProfile = $any($event.target).value"><option *ngFor="let item of localVoice()?.voices" [value]="item.id">{{ item.name }}</option></select></label>
              <label>{{ t('ng.voice.speed', { speed: voiceSpeed }) }}<input [attr.aria-label]="t('ng.voice.speedLabel')" type="range" min="0.8" max="1.2" step="0.05" [value]="voiceSpeed" (input)="setVoiceSpeed($any($event.target).value)" /></label>
              <button [disabled]="!localVoice()?.ttsReady || voiceState() !== 'idle'" (click)="previewVoice()">{{ t('ng.voice.preview') }}</button><button (click)="voice?.cancel()">{{ t('ng.voice.stop') }}</button><button (click)="refreshVoice()">{{ t('ng.voice.refresh') }}</button>
              <button *ngIf="voiceState() !== 'idle'" (click)="voice?.cancel()">{{ t('ng.voice.cancel') }}</button>
              <p role="status">{{ voiceError() || (voiceState() === 'listening' ? t('ng.voice.listening') : voiceState() === 'transcribing' ? t('ng.voice.transcribing') : t('ng.voice.idle')) }}</p>
            </div>
          </details>
          <div class="input-row">
            <input type="text" [attr.aria-label]="t('ng.composer.label')" maxlength="4000" [attr.placeholder]="t('ng.composer.placeholder')" [value]="draft()" (input)="voice?.cancel(); draft.set($any($event.target).value)" (keydown.enter)="sendIntent(draft()); draft.set('')" />
            <button [disabled]="pending" (click)="sendIntent(draft()); draft.set('')">{{ t('ng.send') }}</button>
          </div>
        </aside>
        </ng-template><ng-template #detailsPane>

        <!-- Right Pane: AG-UI Surface Canvas -->
        <section class="canvas-pane">
          <cityside-connections *ngIf="connectionsOpen" [gateway]="gateway" [getToken]="getToken" [locale]="locale()" />
          <div class="canvas-header">
            <div>
              <h2 style="font-size: 20px; font-weight: 700; margin: 0 0 4px 0;">{{ t('ng.canvas.title') }}</h2>
              <div style="font-size: 13px; color: var(--primitive-color-slate-500);">{{ t('ng.canvas.hint') }}</div>
            </div>
            <span class="active-pill">{{ t('ng.canvas.pill') }}</span>
          </div>

          <div *ngIf="surface()" class="surface-container"><cityside-surface-node [node]="surface()!.view" [pending]="pending" [choices]="choices()" [formValues]="formValues()" (dispatch)="dispatchAction($event)" (choiceChanged)="selectChoice($event.group, $event.id)" (formChanged)="setForm($event.name, $event.value)" (launch)="openMiniApp($event)" /></div>

          <div *ngIf="!surface()" class="empty">
            <div class="empty-emblem">✧</div>
            <div style="font-weight: 700; font-size: 16px; margin-bottom: 6px;">{{ t('ng.empty.title') }}</div>
            <div style="font-size: 13px;">{{ t('ng.empty.body') }}</div>
          </div>
        </section>
        </ng-template>
      </cityside-workspace-panes>
    </div>
  `,
  styles: [`
    .sign-in-screen { min-height: 100dvh; padding: 40px; display: flex; align-items: center; justify-content: center; flex-direction: column; gap: 18px; background: var(--primitive-color-slate-50); text-align: center; }.sign-in-screen h1 { color: var(--primitive-color-teal-700); font-size: 36px; }.sign-in-screen button { border: none; border-radius: 9px; background: var(--primitive-color-teal-700); color: white; padding: 14px 24px; }.sign-in-screen small { color: var(--primitive-color-mist-62); }.account-select { border: 1px solid var(--primitive-color-slate-200); background: white; color: var(--primitive-color-mist-48); padding: 8px; border-radius: 7px; font-size: 11px; max-width: 140px; }
    :host { display: block; color: var(--primitive-color-blue-33); font-family: 'Avenir Next', Avenir, 'Segoe UI', sans-serif; }
    * { box-sizing: border-box; }
    button, input, select { font: inherit; } button { cursor: pointer; } button:disabled { opacity: .5; cursor: not-allowed; }
    button:focus-visible, [tabindex]:focus-visible, summary:focus-visible, a:focus-visible { outline: 3px solid var(--primitive-color-blue-63); outline-offset: 3px; }
    .angular-shell-container { display: flex; flex-direction: column; height: 100dvh; background: var(--primitive-color-white); }
    .header { min-height: 82px; display: flex; align-items: center; gap: 25px; padding: 0 32px; border-bottom: 1px solid var(--primitive-color-slate-200); }
    .city-brand { color: var(--primitive-color-teal-800); font-size: 29px; font-weight: 700; text-decoration: none; letter-spacing: -1.2px; }.city-brand span { display: block; font-size: 9px; letter-spacing: 0; font-weight: 400; color: var(--primitive-color-mist-62); margin-top: 1px; }
    .header-caption { font-size: 12px; color: var(--primitive-color-mist-62); border-inline-start: 1px solid var(--primitive-color-slate-200); padding-inline-start: 25px; }.status { margin-inline-start: auto; font-size: 10px; color: var(--primitive-color-green-55); }.account { border: none; border-radius: 20px; background: var(--primitive-color-slate-50); color: var(--primitive-color-blue-43); padding: 10px; font-size: 10px; }.account span { margin-inline-start: 6px; }
    .main-layout { display: flex; flex: 1; overflow: hidden; min-height: 0; }.agent-pane { width: 44%; min-width: 330px; display: flex; flex-direction: column; border-inline-end: 1px solid var(--primitive-color-slate-200); }.pane-header { padding: 24px; font-size: 13px; font-weight: 600; border-bottom: 1px solid var(--primitive-color-slate-50); }
    .messages { flex: 1; overflow-y: auto; padding: 26px; display: flex; flex-direction: column; gap: 22px; }.msg { font-size: 13px; line-height: 1.9; max-width: 92%; white-space: pre-wrap; overflow-wrap: anywhere; }.msg.user { align-self: flex-end; background: var(--primitive-color-slate-50); padding: 12px 16px; border-radius: 13px; border-end-end-radius: 3px; }.delta { font-size: 11px; color: var(--primitive-color-mist-56); line-height: 1.7; }
    .suggestion-chips { display: flex; gap: 7px; padding: 15px 22px; overflow-x: auto; }.suggestion-chips button { border: 1px solid var(--primitive-color-slate-200); background: white; color: var(--primitive-color-mist-53); border-radius: 7px; padding: 8px 11px; white-space: nowrap; font-size: 10px; }.suggestion-chips button:hover { background: var(--primitive-color-slate-50); }
    .voice-settings { margin: 0 24px 10px; font-size: 10px; color: var(--primitive-color-mist-62); }.voice-settings summary { cursor: pointer; padding: 7px 0; }.voice-controls { display: flex; flex-wrap: wrap; gap: 10px; padding: 12px 0; align-items: center; }.voice-controls button, .voice-controls select { border: 1px solid var(--primitive-color-slate-200); background: white; color: var(--primitive-color-mist-48); border-radius: 5px; padding: 7px; }.voice-controls p { font-size: 9px; line-height: 1.7; margin: 0; }
    .input-row { display: flex; gap: 8px; margin: 0 22px 22px; border: 1px solid var(--primitive-color-gray-88); border-radius: 12px; padding: 10px; }.input-row:focus-within { border-color: var(--primitive-color-blue-68); }.input-row input { flex: 1; min-width: 0; border: 0; outline: none; padding: 9px; font-size: 12px; color: var(--primitive-color-teal-700); }.input-row button { border: none; border-radius: 7px; background: var(--primitive-color-teal-700); color: white; padding: 9px 17px; font-size: 11px; }
    .canvas-pane { flex: 1; min-width: 0; padding: 30px; background: var(--primitive-color-slate-50); overflow-y: auto; }.canvas-header { display: flex; align-items: center; justify-content: space-between; gap: 15px; margin-bottom: 28px; }.canvas-header h2 { color: var(--primitive-color-blue-33); font-size: 19px !important; }.active-pill { background: var(--primitive-color-slate-200); color: var(--primitive-color-mist-56); border-radius: 5px; padding: 5px 9px; font-size: 9px; white-space: nowrap; }.surface-container { max-width: 730px; margin: auto; }.surface-card { border: 1px solid var(--primitive-color-slate-200); padding: 24px; border-radius: 14px; background: white; }.metric-widget { border-bottom: 1px solid var(--primitive-color-slate-200); padding: 16px 0; display: flex; justify-content: space-between; gap: 15px; margin-bottom: 10px; }.metric-label { color: var(--primitive-color-mist-62); font-size: 11px; }.metric-val { color: var(--primitive-color-blue-33); font-size: 19px; font-weight: 600; }.choice-group { display: flex; flex-direction: column; gap: 9px; margin: 17px 0; }.choice-item { display: flex; justify-content: space-between; gap: 12px; padding: 14px; border: 1px solid var(--primitive-color-slate-200); border-radius: 8px; cursor: pointer; }.choice-item.selected { border-color: var(--primitive-color-blue-58); background: var(--primitive-color-slate-50); }.map-viewer { min-height: 130px; background: var(--primitive-color-slate-200); border-radius: 10px; padding: 22px; color: var(--primitive-color-mist-56); margin-bottom: 18px; }.map-tag { font-size: 9px; margin-top: 15px; }.map-pin { font-size: 12px; }.ag-action-btn { width: 100%; padding: 13px; border: none; border-radius: 8px; color: white; background: var(--primitive-color-teal-700); font-size: 12px; margin-top: 10px; }.empty { max-width: 500px; margin: 60px auto; text-align: start; padding: 30px; color: var(--primitive-color-mist-62); line-height: 1.9; }.empty-emblem { display: grid; place-items: center; height: 60px; width: 60px; border-radius: 18px; background: var(--primitive-color-slate-200); color: var(--primitive-color-blue-58); font-size: 40px; margin-bottom: 26px; }.empty > div:nth-child(2) { font-size: 30px !important; line-height: 1.3; font-weight: 500 !important; color: var(--primitive-color-blue-33); letter-spacing: -.9px; }
    @media (max-width: 760px) { .header { padding: 15px 20px; min-height: 72px; gap: 14px; }.header-caption, .account span { display: none; }.header { flex-wrap: wrap; }.account-select { max-width: 135px; }.status { order: 3; width: 100%; text-align: end; }.main-layout { flex-direction: column; overflow-y: auto; }.agent-pane { width: 100%; min-width: 0; min-height: 50dvh; flex-shrink: 0; border-inline-end: none; border-bottom: 1px solid var(--primitive-color-slate-200); }.messages { min-height: 100px; max-height: 40dvh; padding: 20px; }.canvas-pane { min-height: 340px; flex-shrink: 0; padding: 25px 20px; overflow: visible; }.canvas-header h2 { font-size: 16px !important; }.canvas-header > div > div { font-size: 11px !important; }.empty { margin: 0 auto; padding: 20px 5px; }.surface-card { padding: 18px; }.input-row input { font-size: 16px; }.status { font-size: 9px; }.account { flex-shrink: 0; } }
    .angular-shell-container { height: 100dvh; min-height: 0; overflow: hidden; }
    cityside-workspace-panes { padding: var(--spacing-small); }
    .agent-pane, .canvas-pane { flex: 1; width: 100%; min-width: 0; min-height: 0; height: 100%; box-sizing: border-box; overflow: auto; }
    .agent-pane { border: 0; display: flex; flex-direction: column; }
    .messages { min-height: 0; max-height: none; flex: 1; overflow: auto; }
    .pane-header { display: none; }
    .canvas-pane { padding: var(--spacing-medium); }
    .canvas-header { margin-bottom: var(--spacing-medium); }
    @media (horizontal-viewport-segments: 2), (vertical-viewport-segments: 2) { cityside-workspace-panes { padding: 0; } }
    @media (horizontal-viewport-segments: 2) { .header { width: env(viewport-segment-width 0 0); flex-wrap: wrap; } .header-caption { display: none; } }
    @media (vertical-viewport-segments: 2) { .suggestion-chips { display: none; } }
    /* Touch and focus floor (P2-14): a control is at least 44px, its text is the control size, keyboard focus shows on the chat row,
       and the shared a11y.css stops motion for reduced motion. These selectors repeat the scoped class rules above because they must out-rank them. */
    button, select, input:not([type='checkbox']):not([type='radio']), summary { min-height: 44px; }
    button, summary, select { min-width: 44px; }
    .account-select, .account, .suggestion-chips button, .input-row input, .input-row button, .voice-settings summary, .voice-settings button, .voice-settings select, .voice-settings input { font-size: var(--font-size-control); }
    .input-row:focus-within { outline: 3px solid var(--color-focus-ring); outline-offset: 3px; }
    input:focus-visible, select:focus-visible { outline: 3px solid var(--color-focus-ring); outline-offset: 3px; }
  `]
})
export class AppComponent implements OnInit, OnDestroy {
  /** The resident's saved choice (shared with the React shell), else the browser's first language. */
  locale = signal<Locale>(this.initialLocale());
  t = (key: CatalogKey, values?: Record<string, string | number>) => translate(this.locale(), key, values);
  private initialLocale(): Locale {
    let saved: string | null = null;
    try { saved = localStorage.getItem('cityside.locale'); } catch { /* the browser language still applies */ }
    const locale = isLocale(saved) ? saved : preferredLocale(navigator.languages);
    this.applyLocale(locale);
    return locale;
  }
  private applyLocale(locale: Locale) { setAmountLocale(locale); document.documentElement.lang = locale; document.documentElement.dir = direction(locale); }
  setLocale(value: string) {
    if (!isLocale(value)) return;
    const previous = this.locale();
    this.locale.set(value); this.applyLocale(value);
    // Only the untouched welcome message is ours to re-word; later replies are the conversation.
    this.messages.update(list => list.length === 1 && list[0].text === translate(previous, 'ng.welcome') ? [{ role: 'assistant', text: translate(value, 'ng.welcome') }] : list);
    try { localStorage.setItem('cityside.locale', value); } catch { /* the choice still applies for this visit */ }
  }
  delegationGrants = signal<any[]>([]);
  delegationNotice = signal('');
  delegationBusy = false;
  now = () => Date.now();
  private async delegationApi(path = '', method = 'GET', body?: unknown) {
    const response = await fetch(`${GATEWAY_URL}/api/delegation/grants${path}`, { method, headers: { Authorization: `Bearer ${await this.auth?.token()}`, 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    const data = await response.json(); if (!response.ok) throw new Error(data.error || data.code); return data;
  }
  async loadDelegations() { try { const data = await this.delegationApi(); this.delegationGrants.set(data.grants.filter((g: any) => g.accountId === this.accountId)); } catch (e) { this.delegationNotice.set((e as Error).message); } }
  private async delegationWork(fn: () => Promise<void>) { this.delegationBusy = true; try { await fn(); await this.loadDelegations(); } catch (e) { this.delegationNotice.set((e as Error).message); } finally { this.delegationBusy = false; } }
  createDelegation(write: boolean) { void this.delegationWork(async () => { await this.delegationApi('', 'POST', { accountId: this.accountId, provider: 'payments', method: write ? 'POST' : 'GET', path: write ? '/topups' : '/wallet', body: write ? { amountMinor: 100, source: 'demo_approved' } : {}, purpose: write ? 'Approve one synthetic AED 1 wallet credit' : 'Check my synthetic wallet balance', expiresInSeconds: 300, maxOperations: write ? 1 : 3 }); this.delegationNotice.set(this.t('ng.deleg.n.saved')); }); }
  runDelegation(id: string) { void this.delegationWork(async () => { const data = await this.delegationApi(`/${id}/execute`, 'POST', { requestKey: crypto.randomUUID() }); this.delegationNotice.set(delegationResult(data.result)); }); }
  revokeDelegation(id: string) { void this.delegationWork(async () => { await this.delegationApi(`/${id}`, 'DELETE'); this.delegationNotice.set(this.t('ng.deleg.n.revoked')); }); }
  delegationHistory(id: string) { void this.delegationWork(async () => { const data = await this.delegationApi(`/${id}/history`); this.delegationNotice.set(data.history.map((e: any) => e.event).join(', ')); }); }
  serviceOptions = signal<Array<{ id: string; name?: string }>>([]);
  async openService(id: string) {
    if (!id || this.pending || !this.serviceOptions().some(item => item.id === id)) return;
    if (id === 'fines') { location.assign('/services/fines'); return; }
    this.pending = true;
    try { const response = await fetch(`${GATEWAY_URL}/api/manual/prepare`, { method: 'POST', headers: { Authorization: `Bearer ${await this.getToken()}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ sessionId: this.sessionId, accountId: this.accountId, serviceId: id }) }); await this.applyResponse(response); }
    catch { this.showError('The service could not be opened. Inspect the original conversation before retrying.'); }
    finally { this.pending = false; }
  }
  readonly gateway = GATEWAY_URL;
  getToken = () => Promise.resolve(this.auth?.token() || 'demo-local');
  connectionsOpen = false;
  auth?: BrowserAuth;
  authReady = signal(false);
  loginRequired = signal(false);
  authError = signal('');
  userName = signal('');
  displayName = computed(() => this.userName() || this.t('ng.demoCitizen'));
  accounts = signal<Array<{ id: string; label: string }>>([]);
  accountId = '';
  signIn() { void this.auth?.login().catch(error => this.authError.set(error.message)); }
  async switchAccount(id: string) {
    if (this.pending || this.delegationBusy) return;
    this.streamController.abort(); this.streamController = new AbortController();
    this.accountId = id; this.sessionId = `ng_${crypto.randomUUID()}`; this.shareProfile.set(true);
    this.delegationGrants.set([]); void this.loadDelegations();
    this.messages.set([]); this.surface.set(null); this.choices.set({});
    await this.restoreSession(); this.connectStream();
  }
  /** What happened, worded when shown, so the status follows a language change. */
  connection = signal<'connecting' | 'ready' | 'warming' | 'demo' | 'offline'>('connecting');
  model = signal<ModelStatus | null>(null);
  inference = signal<'connected' | 'error' | undefined>(undefined);
  connectionLabel = computed(() => modelStatusLabel(this.model(), { locale: this.locale(), inference: this.inference(), connection: this.connection() === 'offline' ? 'offline' : this.connection() === 'connecting' ? 'checking' : 'online' }));
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
  messages = signal<Array<{ role: string; text: string }>>([{ role: 'assistant', text: translate(this.locale(), 'ng.welcome') }]);
  delta = signal<string | null>(null);
  surface = signal<AGUISurfacePayload | null>(null);
  choices = signal<Record<string, string>>({});
  formValues = signal<Record<string, string>>({});
  setForm(name: string, value: string) { this.formValues.update(previous => ({...previous, [name]: value})); }
  openMiniApp(id: string) { const service = ({'org.superapp.ride':'parking','org.superapp.food':'food','org.superapp.wallet':'wallet','org.superapp.housing':'housing','gov.smartcity.mobility':'parking','gov.smartcity.utilities':'utilities','gov.smartcity.citizenpay':'wallet','gov.smartcity.housing':'housing'} as Record<string,string>)[id]; if (service) void this.openService(service); else this.showError('This service is unavailable.'); }
  shareProfile = signal(true);
  privacyNotice = signal('');
  async changeShareProfile(value: boolean) {
    if (this.pending) return;
    this.pending = true; this.privacyNotice.set('');
    try {
      const response = await fetch(`${GATEWAY_URL}/api/a2ui/model-privacy`, { method: 'POST', headers: { Authorization: `Bearer ${await this.auth?.token()}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ sessionId: this.sessionId, accountId: this.accountId, modelPersonalContext: value }) });
      if (!response.ok) throw new Error('Could not save privacy settings.');
      this.shareProfile.set((await response.json()).modelPersonalContext === true);
      sessionStorage.setItem(`cityside.angular.thread.${this.accountId}`, this.sessionId);
      this.privacyNotice.set(value ? 'The assistant may use your profile details.' : 'Your profile details are withheld from the assistant.');
    } catch { this.privacyNotice.set('Could not save privacy settings. Your previous setting remains active.'); }
    finally { this.pending = false; }
  }
  pending = false;
  selectChoice(group: string, choice: string) { this.choices.update(prev => ({ ...prev, [group]: choice })); }
  applySurface(value: unknown) {
    const surface = checkedSurface(value, this.sessionId);
    if (this.surface()?.revision === surface.revision) return;
    this.choices.set(choiceDefaults(surface.view)); this.formValues.set({});
    this.surface.set(surface);
    if (surface.assistantMessage) {
      this.messages.update(prev => [...prev, { role: 'assistant', text: surface.assistantMessage!.text }]);
      if (this.readReplies && this.voiceLanguage === 'en-US') this.voice?.speak(surface.assistantMessage.text, this.voiceLanguage);
    }
  }
  showError(text: string) { this.messages.update(prev => [...prev, { role: 'assistant', text }]); }
  async applyResponse(res: Response) {
    const result = await readCoreResponse(res, this.sessionId);
    this.inference.set(result.inference?.status === 'connected' || result.inference?.status === 'error' ? result.inference.status : undefined);
    if (result.surface) { this.applySurface(result.surface); sessionStorage.setItem(`cityside.angular.thread.${this.accountId}`, this.sessionId); }
    if (result.error && result.error !== result.surface?.assistantMessage?.text) this.showError(result.error);
  }
  async restoreSession() {
    const saved = sessionStorage.getItem(`cityside.angular.thread.${this.accountId}`);
    if (!saved) return;
    const response = await fetch(`${GATEWAY_URL}/api/sessions/${encodeURIComponent(saved)}`, { headers: { Authorization: `Bearer ${await this.auth?.token()}` } });
    if (!response.ok) { this.showError('The saved conversation is unavailable. Start a new conversation.'); return; }
    const data = await response.json();
    this.sessionId = saved; this.shareProfile.set(data.modelPersonalContext !== false);
    if (Array.isArray(data.messages)) this.messages.set(data.messages.filter((item: {role?: unknown; content?: unknown}) => ['user', 'assistant'].includes(String(item.role)) && typeof item.content === 'string').map((item: {role: string; content: string}) => ({role: item.role, text: item.content})));
    if (data.surface) { const surface = checkedSurface(data.surface, saved); this.surface.set(surface); this.choices.set(choiceDefaults(surface.view)); }
  }
  newConversation() {
    if (this.pending) return;
    this.streamController.abort(); this.streamController = new AbortController();
    this.sessionId = `ng_${crypto.randomUUID()}`; sessionStorage.removeItem(`cityside.angular.thread.${this.accountId}`);
    this.messages.set([{role: 'assistant', text: this.t('ng.welcome')}]); this.surface.set(null); this.choices.set({}); this.shareProfile.set(true); this.draft.set(''); this.connectStream();
  }
  sessionId = `ng_${Date.now()}`;
  keycloakToken = 'demo-local'; // local demo only

  async ngOnInit() {
    void fetch(`${GATEWAY_URL}/health`).then(r => r.json()).then(data => { this.model.set(data.llm || null); this.connection.set(data.llm?.enabled ? data.llm?.ready ? 'ready' : 'warming' : 'demo'); }).catch(() => this.connection.set('offline'));
    this.voiceApi = new LocalVoiceApi(GATEWAY_URL, () => this.auth?.token() || 'demo-local');
    this.voice = new VoiceClient({ onTranscript: text => this.draft.set(text), onState: state => this.voiceState.set(state), onError: error => this.voiceError.set(error), allowBrowserFallback: false,
      fetchAudio: (text, language, signal) => this.voiceApi!.speech(text, language, this.voiceProfile, this.voiceSpeed, signal), transcribeAudio: (input, signal) => this.voiceApi!.transcribe(input, signal) });
    document.addEventListener('visibilitychange', this.visibilityHandler);
    try {
      const config = await (await fetch(`${GATEWAY_URL}/api/auth/config`)).json();
      this.auth = new BrowserAuth(config); await this.auth.completeLogin();
      if (config.enabled && !this.auth.signedIn) { this.loginRequired.set(true); return; }
      const response = await fetch(`${GATEWAY_URL}/api/accounts`, { headers: { Authorization: `Bearer ${await this.auth.token()}` } });
      if (!response.ok) throw new Error(this.t('ng.err.accounts'));
      const data = await response.json(); this.accounts.set(data.accounts); this.accountId = data.accounts[0]?.id || ''; this.userName.set(data.user?.name || '');
      const listing = await fetch(`${GATEWAY_URL}/api/services`, { headers: { Authorization: `Bearer ${await this.getToken()}` } });
      if (listing.ok) { const value = await listing.json(); if (Array.isArray(value.services)) this.serviceOptions.set(value.services); }
      await this.restoreSession(); this.connectStream();
      void this.refreshVoice();
    } catch (error) { this.authError.set((error as Error).message); this.loginRequired.set(true); }
    finally { this.authReady.set(true); }
  }
  connectStream() {
    void connectEventStream({
      url: `${GATEWAY_URL}/api/a2ui/stream?sessionId=${this.sessionId}&accountId=${encodeURIComponent(this.accountId)}`,
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
    this.delta.set(this.t('ng.preparingRequest'));

    try {
      const res = await fetch(`${GATEWAY_URL}/api/a2ui/intent`, {
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
            supportedComponents: SUPPORTED_COMPONENT_TYPES
          }
        })
      });
      await this.applyResponse(res);
    } catch {
      this.delta.set(null);
      this.showError(this.t('ng.err.read'));
    } finally { this.pending = false; this.delta.set(null); }
  }

  async dispatchAction(node: UIComponentNode) {
    if (this.pending || node.properties?.disabled) return;
    const binding = node.onEvents?.find(event => event.event === 'onPress');
    if (!binding || !this.surface()) { this.showError(this.t('ng.err.noAction')); return; }
    let payload: Record<string, any>;
    try { payload = surfaceActionPayload(this.surface()!.view, binding, this.choices(), this.formValues()); }
    catch (error) { this.showError((error as Error).message); return; }
    const action = binding.payload.action;
    this.pending = true;
    this.voice?.cancel();
    this.delta.set(this.t('ng.executing', { action: String(action) }));
    try {
      const res = await fetch(`${GATEWAY_URL}/api/a2ui/action`, {
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
    } catch {
      this.delta.set(null);
      this.showError(this.t('ng.err.confirm'));
    } finally { this.pending = false; this.delta.set(null); }
  }
}

