import { Component, Input, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { translate, type Locale, type CatalogKey } from '../../../../packages/protocol-core/src/i18n.ts';
type Provider = { provider: string; ok: boolean; problem?: string; operations: Array<{ operationId: string; method: string; path: string }> };
type Call = { provider: string; method: string; path: string; status: number; ms: number };
@Component({ selector: 'cityside-connections', standalone: true, imports: [CommonModule], template: `
  <section aria-label="Connections"><h2>{{ t('connections.title') }}</h2><p>{{ t('connections.intro') }}</p><button [disabled]="busy()" (click)="load(true)">{{ t('connections.check') }}</button><p role="status">{{ error() || (busy() ? t('connections.checking') : '') }}</p>
    <article *ngFor="let item of providers()"><h3>{{ item.provider }}</h3><p>{{ item.ok ? t('connections.reachableMany', {count: item.operations.length}) : t('connections.refused', {reason: item.problem || t('connections.unknownProblem')}) }}</p><details *ngIf="item.ok"><summary>{{ t('connections.showOperations', {name: item.provider}) }}</summary><div class="scroll" role="region" [attr.aria-label]="item.provider + ' operations'" tabindex="0"><table><thead><tr><th>{{ t('connections.operation') }}</th><th>{{ t('connections.method') }}</th><th>{{ t('connections.path') }}</th></tr></thead><tbody><tr *ngFor="let op of item.operations"><td>{{ op.operationId }}</td><td>{{ op.method }}</td><td>{{ op.path }}</td></tr></tbody></table></div></details></article>
    <h3>{{ t('connections.recent') }}</h3><p *ngIf="!calls().length">{{ t('connections.noCalls') }}</p><ul><li *ngFor="let call of calls()">{{ call.provider }} · {{ call.method }} {{ call.path }} · {{ call.status }} · {{ call.ms }} ms</li></ul>
  </section>`, styles: [`:host { display: block; } section { padding: var(--spacing-medium); } button, summary { min-height: 44px; font-size: var(--font-size-control); } button { border: 1px solid var(--color-surface-border); background: var(--color-surface); color: var(--color-primary-text); border-radius: var(--radius-sm); padding: var(--spacing-small); } summary { display: flex; align-items: center; cursor: pointer; } .scroll { overflow: auto; } th, td { text-align: start; padding: var(--spacing-small); border-bottom: 1px solid var(--color-surface-border); } article { border-top: 1px solid var(--color-surface-border); padding-block: var(--spacing-small); } button:focus-visible, summary:focus-visible, .scroll:focus-visible { outline: 3px solid var(--color-focus-ring); outline-offset: 2px; }`],
})
export class ConnectionsComponent implements OnInit {
  @Input({ required: true }) gateway!: string;
  @Input({ required: true }) getToken!: () => Promise<string>;
  @Input() locale: Locale = 'en';
  busy = signal(false); error = signal(''); providers = signal<Provider[]>([]); calls = signal<Call[]>([]);
  t(key: CatalogKey, values?: Record<string, string | number>) { return translate(this.locale, key, values); }
  ngOnInit() { void this.load(false); }
  async load(refresh: boolean) {
    if (this.busy()) return; this.busy.set(true); this.error.set('');
    try { const response = await fetch(`${this.gateway}/api/connections${refresh ? '?refresh=1' : ''}`, { headers: { Authorization: `Bearer ${await this.getToken()}` }, redirect: 'error' }); if (!response.ok) throw new Error(); const value = await response.json(); if (!Array.isArray(value.providers) || !Array.isArray(value.calls)) throw new Error(); this.providers.set(value.providers); this.calls.set(value.calls); }
    catch { this.error.set(this.t('connections.unavailable')); }
    finally { this.busy.set(false); }
  }
}
