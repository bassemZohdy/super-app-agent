import { Fragment, useEffect, useId, useRef, useState, type ReactNode, type PointerEvent } from 'react';
import { ArrowLeftRight, GripVertical, Maximize2, Minimize2 } from 'lucide-react';
import './workspace-panes.css';

type Pane = 'conversation' | 'details';

/** Pane state survives reordering, resizing and changes between continuous/folded displays. */
export function WorkspacePanes({ conversation, details, revealDetailsKey, chatLayout = false, conversationKey }: { conversation: ReactNode; details: ReactNode; revealDetailsKey?: string; chatLayout?: boolean; conversationKey?: string }) {
  const [first, setFirst] = useState<Pane>('conversation');
  const [maximized, setMaximized] = useState<Pane | null>(null);
  const [mobilePane, setMobilePane] = useState<Pane>('conversation');
  const [split, setSplit] = useState(50);
  const [minimum, setMinimum] = useState(25);
  const [dragging, setDragging] = useState(false);
  const grid = useRef<HTMLDivElement>(null);
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
    resize((event.clientX - box.left - 12) / Math.max(1, box.width - 24) * 100);
  }
  const order: Pane[] = first === 'conversation' ? ['conversation', 'details'] : ['details', 'conversation'];
  const track = (pane: Pane) => `minmax(0, ${pane === 'conversation' ? split : 100 - split}fr)`;
  return <div className={`workspace-layout${chatLayout ? ' chat-layout' : ''}`}>
    {chatLayout && <div className="mobile-pane-tabs" role="group" aria-label="Workspace views">
      <button type="button" aria-pressed={mobilePane === 'conversation'} onClick={() => { setMaximized(null); setMobilePane('conversation'); }}>Chat</button>
      <button type="button" aria-pressed={mobilePane === 'details'} onClick={() => { setMaximized(null); setMobilePane('details'); }}>Service details{revealDetailsKey && <span className="details-ready">Updated</span>}</button>
    </div>}
    <div ref={grid} className={`workspace-pane-grid${maximized ? ' has-maximized-pane' : ''}${dragging ? ' is-resizing' : ''}`} style={{ gridTemplateColumns: maximized ? 'minmax(0, 1fr)' : `var(--workspace-grid-template, ${track(order[0])} 24px ${track(order[1])})` }}>
      {order.map((pane, index) => {
        const name = pane === 'conversation' ? 'conversation' : 'service details';
        const hidden = maximized !== null && maximized !== pane;
        const sizeLabel = `${maximized === pane ? 'Restore' : 'Maximize'} ${name}${maximized === pane ? ' size' : ''}`;
        return <Fragment key={pane}>
          <section id={`${paneId}-${pane}`} ref={pane === 'details' ? detailsPane : undefined} className={`workspace-pane${chatLayout && mobilePane !== pane ? ' is-mobile-inactive' : ''}`} data-pane={pane} aria-label={`${name} pane`} hidden={hidden}>
            <header className="workspace-pane-heading">
              <strong>{pane === 'conversation' ? 'Conversation' : 'Service details'}</strong>
              <div role="group" aria-label={`${name} controls`}>
                {pane === 'conversation' && <button type="button" className="pane-control pane-icon" aria-label="Swap panes" title="Swap panes" onClick={() => { setFirst(first === 'conversation' ? 'details' : 'conversation'); setMaximized(null); }}><ArrowLeftRight size={18} aria-hidden="true" /></button>}
                <button type="button" className="pane-control pane-icon" aria-label={sizeLabel} title={sizeLabel} aria-pressed={maximized === pane} onClick={() => setMaximized(maximized === pane ? null : pane)}>{maximized === pane ? <Minimize2 size={18} aria-hidden="true" /> : <Maximize2 size={18} aria-hidden="true" />}</button>
              </div>
            </header>
            <div className="workspace-pane-body">{pane === 'conversation' ? conversation : details}</div>
          </section>
          {index === 0 && !maximized && <div className="pane-divider" role="separator" tabIndex={0} aria-label="Resize conversation and service details" aria-orientation="vertical" aria-controls={`${paneId}-conversation ${paneId}-details`} aria-valuemin={minimum} aria-valuemax={100 - minimum} aria-valuenow={Math.round(leftShare)} aria-valuetext={`${Math.round(split)}% conversation, ${Math.round(100 - split)}% service details`} title="Drag to resize. Double-click or press Enter for 50/50."
            onPointerDown={event => { if (event.button !== 0) return; event.preventDefault(); event.currentTarget.focus(); event.currentTarget.setPointerCapture(event.pointerId); setDragging(true); }}
            onPointerMove={move}
            onPointerUp={event => { if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); setDragging(false); }}
            onPointerCancel={() => setDragging(false)} onLostPointerCapture={() => setDragging(false)} onDoubleClick={() => setSplit(50)}
            onKeyDown={event => { const step = event.shiftKey ? 10 : 5; const value = event.key === 'ArrowLeft' ? leftShare - step : event.key === 'ArrowRight' ? leftShare + step : event.key === 'Home' ? minimum : event.key === 'End' ? 100 - minimum : undefined; if (event.key === 'Enter') { event.preventDefault(); setSplit(50); } else if (value !== undefined) { event.preventDefault(); resize(value); } }}><span aria-hidden="true"><GripVertical size={16} /></span></div>}
        </Fragment>;
      })}
    </div>
  </div>;
}
