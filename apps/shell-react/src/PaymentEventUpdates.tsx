import type { PaymentEventStatus } from '../../../packages/protocol-core/src/payment-events.ts';
type Props={events?:PaymentEventStatus;busy:boolean;inspect(kind:string,id:string):void};
export function PaymentEventUpdates({events,busy,inspect}:Props){
  if(!events)return null;
  return <section className="payment-review" aria-label="Payment updates"><h3>Payment updates</h3>
    <p>Signed status notifications arrive in the background. Refresh to inspect current updates. A notification does not authorize spending or replace a confirmed provider receipt.</p>
    <p>Gateway notifications pending: {events.pending} · Delivery needs attention: {events.failed} · Received notifications: {events.received}</p>
    {!events.updates.length&&<p>No current payment notifications. Existing history is preserved without invented events.</p>}
    {events.updates.map(u=><article key={u.id} aria-label={`Payment update ${u.id}`}><strong>{u.producer==='payments'?'Payment gateway update':`${u.producer.toUpperCase()} provider update`}</strong>
      <p>Notification: {u.observedState} · Current {u.subjectKind.toLowerCase()} state: {u.currentState}</p><p>Original reference {u.subjectId}</p>
      {u.needsInspection?<><p>The provider sent an update. Inspect the original operation before treating its outcome as confirmed.</p><button disabled={busy} onClick={()=>inspect(u.subjectKind,u.subjectId)}>Inspect or resume original {u.subjectKind==='REFUND'?'refund':'payment'}</button></>:<p>Read the original order and receipt below for its current outcome.</p>}
    </article>)}
  </section>;
}
