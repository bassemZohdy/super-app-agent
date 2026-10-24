import { useState } from 'react';
import { describeMandateConsent, type MandateConsent } from '../../../packages/protocol-core/src/mandate-consent.ts';
type Props={busy:boolean;read(path:string,query?:Record<string,string>):Promise<any>;work(fn:()=>Promise<void>):Promise<void>};
type ConsentView={id:string;view:MandateConsent};
export function MandateConsentPanel({busy,read,work}:Props){
  const [views,setViews]=useState<ConsentView[]>();
  const load=()=>void work(async()=>{
    const result=await read('mandates');
    const records=Array.isArray(result?.mandates)?result.mandates:[];
    setViews(records.map((record:{id?:string})=>({id:String(record?.id??''),view:describeMandateConsent(record)})));
  });
  return <section className="payment-review" aria-labelledby="mandate-consent-heading"><h3 id="mandate-consent-heading">Automation rules</h3>
    <p>View only: changes are not available in this release.</p>
    <p>Automatic execution is disabled for these rules. Each entry shows what the rule would cover if it were enabled.</p>
    <div className="payment-actions"><button disabled={busy} onClick={load}>Load automation rules</button></div>
    {views&&(views.length===0?<p>No automation rules yet.</p>:<ol aria-label="Automation rule consent">{views.map(({id,view})=><li key={id}>
      <h4>{view.title}</h4>
      <p>Rule {id} · {view.status}</p>
      <dl>
        <dt>Trigger</dt><dd>{view.trigger}</dd>
        <dt>Target</dt><dd>{view.target}</dd>
        <dt>Funding</dt><dd>{view.funding}</dd>
        <dt>Caps</dt><dd><ul aria-label={`Caps for rule ${id}`}>{view.caps.length>0?view.caps.map(cap=><li key={cap}>{cap}</li>):<li>No caps stated</li>}</ul></dd>
        <dt>Expiry</dt><dd>{view.expiry}</dd>
        <dt>Revocation</dt><dd>{view.revocation}</dd>
      </dl>
    </li>)}</ol>)}
  </section>;
}
