import { Component, Input, Output, EventEmitter } from '@angular/core';
import { CommonModule } from '@angular/common';
import type { UIComponentNode } from '../../../../packages/protocol-core/src/ag-ui.ts';

@Component({ selector: 'cityside-surface-node', standalone: true, imports: [CommonModule], template: `
  <ng-container [ngSwitch]="node.type">
    <section *ngSwitchCase="'SurfaceCard'" class="card"><cityside-surface-node *ngFor="let child of node.children" [node]="child" [pending]="pending" [choices]="choices" [formValues]="formValues" (dispatch)="dispatch.emit($event)" (choiceChanged)="choiceChanged.emit($event)" (formChanged)="formChanged.emit($event)" (launch)="launch.emit($event)" /></section>
    <h2 *ngSwitchCase="'Heading'">{{ node.properties?.text }}</h2>
    <p *ngSwitchCase="'Text'" dir="auto">{{ node.properties?.text }}</p>
    <span *ngSwitchCase="'Badge'" class="badge">{{ node.properties?.text || node.properties?.label }}</span>
    <div *ngSwitchCase="'MetricWidget'" class="metric"><span>{{ node.properties?.label }}</span><strong>{{ node.properties?.value }}</strong><small>{{ node.properties?.subtext }}</small></div>
    <fieldset *ngSwitchCase="'ChoiceGroup'"><legend>{{ node.properties?.label || 'Choose an option' }}</legend><label *ngFor="let option of node.properties?.options" class="choice"><input type="radio" [name]="node.id" [checked]="choices[node.id] === option.id" [disabled]="pending || node.properties?.disabled" (change)="choiceChanged.emit({group: node.id, id: option.id})"/><span>{{ option.title }}<small>{{ option.subtitle }}</small></span><strong>{{ option.price }}</strong></label></fieldset>
    <div *ngSwitchCase="'DataTable'" class="scroll" role="region" aria-label="Service data" tabindex="0"><table><thead><tr><th *ngFor="let column of node.properties?.columns">{{ column.title }}</th></tr></thead><tbody><tr *ngFor="let row of node.properties?.rows"><td *ngFor="let column of node.properties?.columns">{{ cell(row[column.key]) }}</td></tr></tbody></table></div>
    <label *ngSwitchCase="'FormInput'" class="field">{{ node.properties?.label }}<input [attr.aria-label]="node.properties?.label || node.properties?.name || node.id" [type]="node.properties?.inputType || 'text'" [value]="formValues[node.properties?.name || node.id] ?? node.properties?.defaultValue ?? ''" [placeholder]="node.properties?.placeholder || ''" [disabled]="pending || node.properties?.disabled" (input)="input($event)"/></label>
    <div *ngSwitchCase="'MapViewer'" class="map"><p>Simulated locations</p><ul><li *ngFor="let marker of node.properties?.markers">{{ marker.title }}</li></ul></div>
    <button *ngSwitchCase="'MiniAppEmbed'" type="button" [disabled]="pending" (click)="launch.emit(node.properties?.miniAppId || '')">Open {{ node.properties?.label || node.properties?.miniAppId }}</button>
    <button *ngSwitchCase="'Button'" type="button" [disabled]="pending || node.properties?.disabled" (click)="dispatch.emit(node)">{{ node.properties?.label }}</button>
    <p *ngSwitchDefault role="alert">Unsupported component: {{ node.type }}</p>
  </ng-container>`, styles: [`:host { display: block; min-width: 0; } .card { border: 1px solid var(--color-surface-border); border-radius: var(--radius-md); padding: var(--spacing-medium); background: var(--color-surface); } p { white-space: pre-wrap; line-height: 1.6; } fieldset { min-width: 0; border: 0; padding: 0; margin-block: var(--spacing-medium); } legend { font-weight: 600; } .choice { display: flex; align-items: center; gap: var(--spacing-small); padding: var(--spacing-small); border: 1px solid var(--color-surface-border); border-radius: var(--radius-sm); min-height: 44px; } small { display: block; } .choice span { flex: 1; } .metric { display: flex; flex-wrap: wrap; justify-content: space-between; gap: var(--spacing-small); padding-block: var(--spacing-medium); } .metric strong { font-size: 22px; } .scroll { overflow-x: auto; } table { border-collapse: collapse; width: 100%; } th, td { padding: var(--spacing-small); text-align: start; border-bottom: 1px solid var(--color-surface-border); } .field { display: flex; flex-direction: column; gap: var(--spacing-small); margin-block: var(--spacing-small); } input:not([type=radio]), button { min-height: 44px; font-size: var(--font-size-control); border: 1px solid var(--color-surface-border); border-radius: var(--radius-sm); padding: var(--spacing-small); } button { width: 100%; cursor: pointer; color: var(--color-background); background: var(--color-primary); margin-block: var(--spacing-small); } input:focus-visible, button:focus-visible, .scroll:focus-visible { outline: 3px solid var(--color-focus-ring); outline-offset: 2px; } .badge { display: inline-block; border-radius: var(--radius-sm); background: var(--color-background); padding: var(--spacing-small); } .map { padding: var(--spacing-medium); background: var(--color-background); }`],
})
export class SurfaceNodeComponent {
  @Input({ required: true }) node!: UIComponentNode;
  @Input() pending = false;
  @Input() choices: Record<string, string> = {};
  @Input() formValues: Record<string, string> = {};
  @Output() dispatch = new EventEmitter<UIComponentNode>();
  @Output() choiceChanged = new EventEmitter<{ group: string; id: string }>();
  @Output() formChanged = new EventEmitter<{ name: string; value: string }>();
  @Output() launch = new EventEmitter<string>();
  cell(value: unknown) { return value === null || value === undefined ? '' : typeof value === 'object' ? JSON.stringify(value) : String(value); }
  input(event: Event) { this.formChanged.emit({ name: this.node.properties?.name || this.node.id, value: (event.target as HTMLInputElement).value }); }
}
