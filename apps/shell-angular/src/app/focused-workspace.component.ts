import { Component, OnDestroy, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FocusedAgentClient, FOCUSED_REQUEST_TIMEOUT_MS, AgentClientError, type AgentAction, type AgentResult } from '../../../../packages/protocol-core/src/focused-agent-client.ts';
import { WorkspacePanesComponent } from './workspace-panes.component.ts';

@Component({
  selector: 'app-root', standalone: true, imports: [CommonModule, WorkspacePanesComponent],
  templateUrl: './focused-workspace.component.html',
  styles: [`:host { display: flex; flex-direction: column; height: 100dvh; min-height: 0; color: var(--color-text); background: var(--color-background); font-family: 'Avenir Next', system-ui, sans-serif; } header, nav { display: flex; flex-wrap: wrap; align-items: center; gap: var(--spacing-small); padding: var(--spacing-small); } h1, h2 { font-size: 22px; } button, input, textarea { min-height: 44px; font-size: var(--font-size-control); padding: var(--spacing-small); border: 1px solid var(--color-surface-border); border-radius: var(--radius-sm); background: var(--color-surface); color: var(--color-text); } button:focus-visible, input:focus-visible, textarea:focus-visible { outline: 3px solid var(--color-focus-ring); outline-offset: 2px; } button { cursor: pointer; } button:disabled { opacity: .55; cursor: default; } .content { display: flex; flex: 1; flex-direction: column; min-height: 0; min-width: 0; padding: var(--spacing-medium); overflow: auto; } .transcript { flex: 1; min-height: 0; overflow: auto; } article { padding-block: var(--spacing-small); } article p { white-space: pre-wrap; } form { display: flex; flex-direction: column; gap: var(--spacing-small); flex-shrink: 0; } table { width: 100%; border-collapse: collapse; } th, td { padding: var(--spacing-small); text-align: start; border-bottom: 1px solid var(--color-surface-border); } .error { color: var(--color-danger-text); } .login { max-width: 520px; margin: auto; padding: var(--spacing-medium); }`],
})
export class FocusedWorkspaceComponent implements OnDestroy {
  client: FocusedAgentClient | null = null;
  data = signal<AgentResult | null>(null); pending = signal(false); uncertain = signal(false); error = signal(''); progress = signal(''); draft = signal('');
  private controller?: AbortController;
  get active() { return this.data()?.approval ?? this.data()?.renewalApproval ?? null; }
  get needsRecovery() { return this.uncertain() || this.data()?.status === 'unknown' || (!!this.data()?.next.length && !this.active); }
  get canMessage() { return !!this.client && !this.pending() && !this.needsRecovery && !this.active && this.data()?.status !== 'cancelled'; }
  value(event: Event) { return (event.target as HTMLInputElement).value; }
  forgetSaved() { if (!this.client && !this.pending()) { sessionStorage.removeItem('cityside.fines.thread.v1'); this.error.set('Saved reference cleared. Sign in to start a new conversation.'); } }
  amount(minor: number) { return `AED ${(minor / 100).toFixed(2)}`; }
  async run(operation: (signal: AbortSignal) => Promise<void>, mutation = false) {
    if (this.pending()) return;
    this.pending.set(true); this.error.set(''); this.controller = new AbortController();
    const timer = setTimeout(() => this.controller?.abort(), FOCUSED_REQUEST_TIMEOUT_MS);
    try { await operation(this.controller.signal); }
    catch (error) { if (mutation) this.uncertain.set(true); this.error.set(error instanceof AgentClientError ? error.message : 'The connection was interrupted. Inspect or recover the original operation.'); }
    finally { clearTimeout(timer); this.pending.set(false); this.progress.set(''); }
  }
  signIn(event: Event, form: HTMLFormElement) {
    event.preventDefault(); const token = String(new FormData(form).get('token') || '').trim(); form.reset(); if (!token) return;
    void this.run(async signal => { const client = new FocusedAgentClient(token); const id = sessionStorage.getItem('cityside.fines.thread.v1') || await client.create(signal); const data = await client.inspect(id, signal); sessionStorage.setItem('cityside.fines.thread.v1', id); this.client = client; this.data.set(data); this.uncertain.set(false); });
  }
  transition(action: AgentAction, body: Record<string, unknown> = {}) {
    if (!this.client || !this.data()) return;
    void this.run(async signal => { this.data.set(await this.client!.transition(this.data()!.threadId, action, body, signal, node => this.progress.set(node))); this.uncertain.set(false); if (action === 'messages') this.draft.set(''); }, true);
  }
  inspect() { if (this.client && this.data()) void this.run(async signal => { this.data.set(await this.client!.inspect(this.data()!.threadId, signal)); }); }
  send(event?: Event) { event?.preventDefault(); if (this.canMessage && this.draft().trim()) this.transition('messages', { message: this.draft().trim() }); }
  start() { if (this.client) void this.run(async signal => { const id = await this.client!.create(signal); sessionStorage.setItem('cityside.fines.thread.v1', id); this.data.set(await this.client!.inspect(id, signal)); this.uncertain.set(false); this.draft.set(''); }); }
  decide(decision: string) { if (this.active && !this.needsRecovery && !this.pending()) this.transition('resume', { approvalId: this.active.id, decision }); }
  signOut() { this.controller?.abort(); this.client = null; this.data.set(null); this.draft.set(''); this.uncertain.set(false); }
  ngOnDestroy() { this.controller?.abort(); }
}
