import { Component, Input, TemplateRef, signal, computed, ElementRef, ViewChild, AfterViewInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';

type Pane = 'conversation' | 'details';
@Component({
  selector: 'cityside-workspace-panes', standalone: true, imports: [CommonModule],
  templateUrl: './workspace-panes.component.html', styleUrl: './workspace-panes.component.css',
})
export class WorkspacePanesComponent implements AfterViewInit, OnDestroy {
  private observer?: ResizeObserver;
  ngAfterViewInit() { if (this.grid) { this.observer = new ResizeObserver(() => { const grid = this.grid!.nativeElement; grid.style.setProperty('--workspace-top', `${grid.getBoundingClientRect().top}px`); this.resize(this.leftShare()); }); this.observer.observe(this.grid.nativeElement); } }
  ngOnDestroy() { this.observer?.disconnect(); }
  @Input({ required: true }) conversation!: TemplateRef<unknown>;
  @Input({ required: true }) details!: TemplateRef<unknown>;
  private previousReview?: string;
  @Input() set revealDetailsKey(value: string | undefined) {
    if (!value || value === this.previousReview) return;
    this.previousReview = value; this.maximized.set(null); this.mobile.set('details');
    setTimeout(() => this.grid?.nativeElement.querySelector<HTMLElement>('[data-pane="details"] h2')?.focus(), 0);
  }
  @ViewChild('grid') grid?: ElementRef<HTMLDivElement>;
  @ViewChild('mobileTabs') mobileTabs?: ElementRef<HTMLDivElement>;
  first = signal<Pane>('conversation'); maximized = signal<Pane | null>(null); mobile = signal<Pane>('conversation'); split = signal(50); minimum = signal(25);
  order = computed<Pane[]>(() => this.first() === 'conversation' ? ['conversation', 'details'] : ['details', 'conversation']);
  template = computed(() => this.maximized() ? 'minmax(0, 1fr)' : `var(--workspace-grid-template, minmax(0, ${this.leftShare()}fr) 24px minmax(0, ${100 - this.leftShare()}fr))`);
  leftShare = computed(() => this.first() === 'conversation' ? this.split() : 100 - this.split());
  name = (pane: Pane) => pane === 'conversation' ? 'conversation' : 'service details';
  title = (pane: Pane) => pane === 'conversation' ? 'Conversation' : 'Service details';
  track = (_index: number, pane: Pane) => pane;
  swap(pane: Pane) {
    if (this.mobileTabs && getComputedStyle(this.mobileTabs.nativeElement).display !== 'none') this.mobile.set(pane === 'conversation' ? 'details' : 'conversation');
    else this.first.set(this.first() === 'conversation' ? 'details' : 'conversation');
    this.maximized.set(null);
  }
  size(pane: Pane) { this.mobile.set(pane); this.maximized.set(this.maximized() === pane ? null : pane); }
  resize(left: number) {
    const width = (this.grid?.nativeElement.clientWidth || 1200) - 24;
    const minimum = Math.max(25, Math.min(45, Math.ceil(280 / Math.max(1, width) * 100)));
    this.minimum.set(minimum);
    const value = Math.max(minimum, Math.min(100 - minimum, left));
    this.split.set(this.first() === 'conversation' ? value : 100 - value);
  }
  start(event: PointerEvent) { if (event.button === 0) (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId); }
  move(event: PointerEvent) {
    if (!(event.currentTarget as HTMLElement).hasPointerCapture(event.pointerId) || !this.grid) return;
    const box = this.grid.nativeElement.getBoundingClientRect(); this.resize((event.clientX - box.left - 12) / Math.max(1, box.width - 24) * 100);
  }
  key(event: KeyboardEvent) {
    const step = event.shiftKey ? 10 : 5;
    if (event.key === 'Enter') this.split.set(50);
    else if (event.key === 'ArrowLeft') this.resize(this.leftShare() - step);
    else if (event.key === 'ArrowRight') this.resize(this.leftShare() + step);
    else if (event.key === 'Home') this.resize(0);
    else if (event.key === 'End') this.resize(100);
    else return;
    event.preventDefault();
  }
}
