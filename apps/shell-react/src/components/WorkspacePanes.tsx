import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { ArrowLeftRight, Maximize2, Minimize2, PanelTopClose, PanelTopOpen } from 'lucide-react';
import './workspace-panes.css';

type Pane = 'conversation' | 'details';

/** Shared pane controls keep visual order, reading order and keyboard order together. */
export function WorkspacePanes({ conversation, details, revealDetailsKey }: { conversation: ReactNode; details: ReactNode; revealDetailsKey?: string }) {
  const [first, setFirst] = useState<Pane>('conversation');
  const [maximized, setMaximized] = useState<Pane | null>(null);
  const [minimized, setMinimized] = useState({ conversation: false, details: false });
  const paneId = useId();
  const detailsPane = useRef<HTMLElement>(null);
  const previousDetails = useRef(revealDetailsKey);
  const [focusReview, setFocusReview] = useState(false);
  useEffect(() => {
    if (!revealDetailsKey || previousDetails.current === revealDetailsKey) return;
    previousDetails.current = revealDetailsKey;
    setMaximized(null); setMinimized(value => ({ ...value, details: false })); setFocusReview(true);
  }, [revealDetailsKey]);
  useEffect(() => {
    if (!focusReview || minimized.details || maximized === 'conversation') return;
    const node = detailsPane.current?.querySelector<HTMLElement>('[data-pane-focus]');
    node?.focus(); node?.scrollIntoView({ block: 'nearest', behavior: 'instant' });
    setFocusReview(false);
  }, [focusReview, minimized.details, maximized]);
  function restore() { setMaximized(null); setMinimized({ conversation: false, details: false }); }
  const order: Pane[] = first === 'conversation' ? ['conversation', 'details'] : ['details', 'conversation'];
  return <div className="workspace-layout">
    <div className="pane-layout-tools" role="group" aria-label="Workspace layout">
      <button type="button" className="pane-control" onClick={() => { setFirst(first === 'conversation' ? 'details' : 'conversation'); restore(); }}><ArrowLeftRight size={17} aria-hidden="true" />Swap panes</button>
      <button type="button" className="pane-control" disabled={!maximized && !minimized.conversation && !minimized.details} onClick={restore}><Minimize2 size={17} aria-hidden="true" />Restore split view</button>
      <span role="status" className="pane-layout-status">{maximized ? `${maximized === 'details' ? 'Service details' : 'Conversation'} maximized` : first === 'conversation' ? 'Conversation first' : 'Service details first'}</span>
    </div>
    <div className={`workspace-pane-grid${maximized ? ' has-maximized-pane' : ''}`} style={{ gridTemplateColumns: maximized ? 'minmax(0, 1fr)' : order.map(pane => minimized[pane] ? 'minmax(12rem, max-content)' : 'minmax(0, 1fr)').join(' ') }}>
      {order.map(pane => {
        const name = pane === 'conversation' ? 'conversation' : 'service details';
        const hidden = maximized !== null && maximized !== pane;
        return <section key={pane} ref={pane === 'details' ? detailsPane : undefined} className={`workspace-pane${minimized[pane] ? ' is-minimized' : ''}`} data-pane={pane} aria-label={`${name} pane`} hidden={hidden}>
          <header className="workspace-pane-heading">
            <strong>{pane === 'conversation' ? 'Conversation' : 'Service details'}</strong>
            <div role="group" aria-label={`${name} layout`}>
              <button type="button" className="pane-control pane-icon" aria-label={`${minimized[pane] ? 'Restore' : 'Minimize'} ${name}`} title={`${minimized[pane] ? 'Restore' : 'Minimize'} ${name}`} aria-controls={`${paneId}-${pane}`} aria-expanded={!minimized[pane]} onClick={() => { setMaximized(null); setMinimized(value => ({ ...value, [pane]: !value[pane] })); }}>{minimized[pane] ? <PanelTopOpen size={18} /> : <PanelTopClose size={18} />}</button>
              <button type="button" className="pane-control pane-icon" aria-label={`${maximized === pane ? 'Restore' : 'Maximize'} ${name}${maximized === pane ? ' size' : ''}`} title={maximized === pane ? 'Restore split view' : `Maximize ${name}`} aria-pressed={maximized === pane} onClick={() => { setMaximized(maximized === pane ? null : pane); setMinimized(value => ({ ...value, [pane]: false })); }}>{maximized === pane ? <Minimize2 size={18} /> : <Maximize2 size={18} />}</button>
            </div>
          </header>
          <div className="workspace-pane-body" id={`${paneId}-${pane}`} hidden={minimized[pane]}>{pane === 'conversation' ? conversation : details}</div>
        </section>;
      })}
    </div>
  </div>;
}
