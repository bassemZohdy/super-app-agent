import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ArrowLeftRight, Maximize2, Minimize2 } from 'lucide-react';
import './workspace-panes.css';

type Pane = 'conversation' | 'details';

/** Swapping moves DOM order and width roles together; each maximize button also restores. */
export function WorkspacePanes({ conversation, details, revealDetailsKey, chatLayout = false, conversationKey }: { conversation: ReactNode; details: ReactNode; revealDetailsKey?: string; chatLayout?: boolean; conversationKey?: string }) {
  const [first, setFirst] = useState<Pane>('conversation');
  const [maximized, setMaximized] = useState<Pane | null>(null);
  const [mobilePane, setMobilePane] = useState<Pane>('conversation');
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
  const order: Pane[] = first === 'conversation' ? ['conversation', 'details'] : ['details', 'conversation'];
  return <div className={`workspace-layout${chatLayout ? ' chat-layout' : ''}`}>
    {chatLayout && <div className="mobile-pane-tabs" role="group" aria-label="Workspace views">
      <button type="button" aria-pressed={mobilePane === 'conversation'} onClick={() => { setMaximized(null); setMobilePane('conversation'); }}>Chat</button>
      <button type="button" aria-pressed={mobilePane === 'details'} onClick={() => { setMaximized(null); setMobilePane('details'); }}>Service details{revealDetailsKey && <span className="details-ready">Updated</span>}</button>
    </div>}
    <div className={`workspace-pane-grid${maximized ? ' has-maximized-pane' : ''}`} style={{ gridTemplateColumns: maximized ? 'minmax(0, 1fr)' : order.map(pane => `var(--workspace-${pane}-width, minmax(0, 1fr))`).join(' ') }}>
      {order.map(pane => {
        const name = pane === 'conversation' ? 'conversation' : 'service details';
        const hidden = maximized !== null && maximized !== pane;
        const sizeLabel = `${maximized === pane ? 'Restore' : 'Maximize'} ${name}${maximized === pane ? ' size' : ''}`;
        return <section key={pane} ref={pane === 'details' ? detailsPane : undefined} className={`workspace-pane${chatLayout && mobilePane !== pane ? ' is-mobile-inactive' : ''}`} data-pane={pane} aria-label={`${name} pane`} hidden={hidden}>
          <header className="workspace-pane-heading">
            <strong>{pane === 'conversation' ? 'Conversation' : 'Service details'}</strong>
            <div role="group" aria-label={`${name} controls`}>
              {pane === 'conversation' && <button type="button" className="pane-control pane-icon" aria-label="Swap panes" title="Swap panes" onClick={() => { setFirst(first === 'conversation' ? 'details' : 'conversation'); setMaximized(null); }}><ArrowLeftRight size={18} aria-hidden="true" /></button>}
              <button type="button" className="pane-control pane-icon" aria-label={sizeLabel} title={sizeLabel} aria-pressed={maximized === pane} onClick={() => setMaximized(maximized === pane ? null : pane)}>{maximized === pane ? <Minimize2 size={18} aria-hidden="true" /> : <Maximize2 size={18} aria-hidden="true" />}</button>
            </div>
          </header>
          <div className="workspace-pane-body">{pane === 'conversation' ? conversation : details}</div>
        </section>;
      })}
    </div>
  </div>;
}
