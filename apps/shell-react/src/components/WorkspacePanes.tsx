import { Fragment, useEffect, useId, useRef, useState, type ReactNode, type PointerEvent } from 'react';
import { ArrowLeftRight, GripVertical, Maximize2, Minimize2 } from 'lucide-react';
import { translate, type Locale } from '../../../../packages/protocol-core/src/i18n.ts';
import './workspace-panes.css';

type Pane = 'conversation' | 'details';

/** Pane state survives reordering, resizing and changes between continuous/folded displays. */
export function WorkspacePanes({ conversation, details, revealDetailsKey, chatLayout = false, conversationKey, locale = 'en' }: { conversation: ReactNode; details: ReactNode; revealDetailsKey?: string; chatLayout?: boolean; conversationKey?: string; locale?: Locale }) {
  const t = (key: Parameters<typeof translate>[1], values?: Record<string, string | number>) => translate(locale, key, values);
  const [first, setFirst] = useState<Pane>('conversation');
  const [maximized, setMaximized] = useState<Pane | null>(null);
  const [mobilePane, setMobilePane] = useState<Pane>('conversation');
  const [split, setSplit] = useState(50);
  const [minimum, setMinimum] = useState(25);
  const [dragging, setDragging] = useState(false);
  const grid = useRef<HTMLDivElement>(null);
  const mobileTabs = useRef<HTMLDivElement>(null);
  const paneId = useId();
  const detailsPane = useRef<HTMLElement>(null);
  const previousDetails = useRef(revealDetailsKey);
  const [focusReview, setFocusReview] = useState(false);
  useEffect(() => {
    if (!chatLayout) return;
    setMobilePane('conversation'); setMaximized(null);
  }, [chatLayout, conversationKey]);
  useEffect(() => {
    if (!revealDetailsKey || previousDetails.current === revealDetailsKey) return;
    previousDetails.current = revealDetailsKey;
    setMaximized(null); setFocusReview(true);
  }, [revealDetailsKey]);
  useEffect(() => {
    if (!focusReview || maximized === 'conversation') return;
    const node = detailsPane.current?.querySelector<HTMLElement>('[data-pane-focus]');
    node?.focus(); node?.scrollIntoView({ block: 'nearest', behavior: 'instant' });
    setFocusReview(false);
  }, [focusReview, maximized]);
  useEffect(() => {
    if (!grid.current) return;
    const observer = new ResizeObserver(() => {
      const width = grid.current!.clientWidth - 24;
      const min = Math.max(25, Math.min(45, Math.ceil(280 / Math.max(1, width) * 100)));
      setMinimum(min); setSplit(value => Math.max(min, Math.min(100 - min, value)));
    });
    observer.observe(grid.current);
    return () => observer.disconnect();
  }, []);
  const leftShare = first === 'conversation' ? split : 100 - split;
  function resize(left: number) {
    const value = Math.max(minimum, Math.min(100 - minimum, left));
    setSplit(first === 'conversation' ? value : 100 - value);
  }
  function move(event: PointerEvent<HTMLDivElement>) {
    if (!event.currentTarget.hasPointerCapture(event.pointerId) || !grid.current) return;
    const box = grid.current.getBoundingClientRect();
    const distance = locale === 'ar' ? box.right - event.clientX : event.clientX - box.left;
    resize((distance - 12) / Math.max(1, box.width - 24) * 100);
  }
  const order: Pane[] = first === 'conversation' ? ['conversation', 'details'] : ['details', 'conversation'];
  const track = (pane: Pane) => `minmax(0, ${pane === 'conversation' ? split : 100 - split}fr)`;
  return <div className={`workspace-layout${chatLayout ? ' chat-layout' : ''}`}>
    {chatLayout && <div ref={mobileTabs} className="mobile-pane-tabs" role="group" aria-label={t('panes.views')}>
      <button type="button" aria-pressed={mobilePane === 'conversation'} onClick={() => { setMaximized(null); setMobilePane('conversation'); }}>{t('panes.chat')}</button>
      <button type="button" aria-pressed={mobilePane === 'details'} onClick={() => { setMaximized(null); setMobilePane('details'); }}>{t('panes.details')}{revealDetailsKey && <span className="details-ready">{t('panes.updated')}</span>}</button>
    </div>}
    <div ref={grid} className={`workspace-pane-grid${maximized ? ' has-maximized-pane' : ''}${dragging ? ' is-resizing' : ''}`} style={{ gridTemplateColumns: maximized ? 'minmax(0, 1fr)' : `var(--workspace-grid-template, ${track(order[0])} 24px ${track(order[1])})` }}>
      {order.map((pane, index) => {
        const hidden = maximized !== null && maximized !== pane;
        const sizeLabel = t(pane === 'conversation' ? maximized === pane ? 'panes.restoreConversation' : 'panes.maxConversation' : maximized === pane ? 'panes.restoreDetails' : 'panes.maxDetails');
        return <Fragment key={pane}>
          <section id={`${paneId}-${pane}`} ref={pane === 'details' ? detailsPane : undefined} className={`workspace-pane${chatLayout && mobilePane !== pane ? ' is-mobile-inactive' : ''}`} data-pane={pane} aria-label={t(pane === 'conversation' ? 'panes.conversationRegion' : 'panes.detailsRegion')} hidden={hidden}>
            <header className="workspace-pane-heading">
              <strong>{t(pane === 'conversation' ? 'panes.conversation' : 'panes.details')}</strong>
              <div role="group" aria-label={t(pane === 'conversation' ? 'panes.conversationControls' : 'panes.detailsControls')}>
                <button type="button" className={`pane-control pane-icon${pane === 'details' ? ' pane-swap-details' : ''}`} aria-label={t('panes.swap')} title={t('panes.swap')} onClick={() => {
                  setMaximized(null);
                  if (mobileTabs.current && getComputedStyle(mobileTabs.current).display !== 'none') {
                    setMobilePane(pane === 'conversation' ? 'details' : 'conversation');
                  } else {
                    const next = first === 'conversation' ? 'details' : 'conversation';
                    setFirst(next);
                    if (!chatLayout && matchMedia('(max-width: 800px)').matches) requestAnimationFrame(() => grid.current?.querySelector(`[data-pane="${next}"]`)?.scrollIntoView({ block: 'start', behavior: 'instant' }));
                  }
                }}><ArrowLeftRight size={18} aria-hidden="true" /></button>
                <button type="button" className="pane-control pane-icon" aria-label={sizeLabel} title={sizeLabel} aria-pressed={maximized === pane} onClick={() => setMaximized(maximized === pane ? null : pane)}>{maximized === pane ? <Minimize2 size={18} aria-hidden="true" /> : <Maximize2 size={18} aria-hidden="true" />}</button>
              </div>
            </header>
            <div className="workspace-pane-body">{pane === 'conversation' ? conversation : details}</div>
          </section>
          {index === 0 && !maximized && <div className="pane-divider" role="separator" tabIndex={0} aria-label={t('panes.resize')} aria-orientation="vertical" aria-controls={`${paneId}-conversation ${paneId}-details`} aria-valuemin={minimum} aria-valuemax={100 - minimum} aria-valuenow={Math.round(leftShare)} aria-valuetext={t('panes.split', { conversation: Math.round(split), details: Math.round(100 - split) })} title={t('panes.resizeHelp')}
            onPointerDown={event => { if (event.button !== 0) return; event.preventDefault(); event.currentTarget.focus(); event.currentTarget.setPointerCapture(event.pointerId); setDragging(true); }}
            onPointerMove={move}
            onPointerUp={event => { if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); setDragging(false); }}
            onPointerCancel={() => setDragging(false)} onLostPointerCapture={() => setDragging(false)} onDoubleClick={() => setSplit(50)}
            onKeyDown={event => { const step = (event.shiftKey ? 10 : 5) * (locale === 'ar' ? -1 : 1); const value = event.key === 'ArrowLeft' ? leftShare - step : event.key === 'ArrowRight' ? leftShare + step : event.key === 'Home' ? minimum : event.key === 'End' ? 100 - minimum : undefined; if (event.key === 'Enter') { event.preventDefault(); setSplit(50); } else if (value !== undefined) { event.preventDefault(); resize(value); } }}><span aria-hidden="true"><GripVertical size={16} /></span></div>}
        </Fragment>;
      })}
    </div>
  </div>;
}
