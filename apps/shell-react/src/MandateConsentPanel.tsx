import { useState } from 'react';
import { describeMandateConsent, type MandateConsent } from '../../../packages/protocol-core/src/mandate-consent.ts';
type Props={busy:boolean;read(path:string,query?:Record<string,string>):Promise<any>;
  mutate(path:string,body:Record<string,unknown>):Promise<any>;work(fn:()=>Promise<void>):Promise<void>};
type ConsentView={id:string;view:MandateConsent;state:string;version:number;skipNext:boolean};
export function MandateConsentPanel({busy,read,mutate,work}:Props){
  const [views,setViews]=useState<ConsentView[]>();
  const [notice,setNotice]=useState<string>();
  const load=()=>void work(async()=>{
    const result=await read('mandates');
    const records=Array.isArray(result?.mandates)?result.mandates:[];
    setViews(records.map((record:Record<string,unknown>)=>({id:String(record?.id??''),view:describeMandateConsent(record),
      state:String(record?.state??''),version:Number(record?.version??0),skipNext:record?.skipNext===true})));
  });
  const act=(id:string,action:string,version:number,message:string)=>void work(async()=>{
    await mutate(`mandates/${action}`,{mandateId:id,expectedVersion:version,requestKey:`mandate-${action}-${id}-${version}`});
    setNotice(message);await new Promise(resolve=>setTimeout(resolve,0));await load();
  });
  return <section className="payment-review" aria-labelledby="mandate-consent-heading"><h3 id="mandate-consent-heading">Automation rules</h3>
    <p>Pause, resume, skip the next occurrence or revoke each rule. Pause keeps the consent; resume revalidates the current sources and target. Automatic execution stays disabled in this demo.</p>
    {notice&&<p role="status">{notice}</p>}
    <div className="payment-actions"><button disabled={busy} onClick={load}>Load automation rules</button></div>
    {views&&(views.length===0?<p>No automation rules yet.</p>:<ol aria-label="Automation rule consent">{views.map(({id,view,state,version,skipNext})=><li key={id}>
      <h4>{view.title}</h4>
      <p>Rule {id} · {view.status}{skipNext?' · next occurrence will be skipped':''}</p>
      <dl>
        <dt>Trigger</dt><dd>{view.trigger}</dd>
        <dt>Target</dt><dd>{view.target}</dd>
        <dt>Funding</dt><dd>{view.funding}</dd>
        <dt>Caps</dt><dd><ul aria-label={`Caps for rule ${id}`}>{view.caps.length>0?view.caps.map(cap=><li key={cap}>{cap}</li>):<li>No caps stated</li>}</ul></dd>
        <dt>Expiry</dt><dd>{view.expiry}</dd>
        <dt>Revocation</dt><dd>{view.revocation}</dd>
      </dl>
      <div className="payment-actions">
        {state==='APPROVED'&&<button disabled={busy} onClick={()=>act(id,'pause',version,'Rule paused. Its consent is kept and no occurrence can be prepared while paused.')}>Pause rule</button>}
        {state==='PAUSED'&&<button disabled={busy} onClick={()=>act(id,'resume',version,'Rule resumed. Current sources and target were revalidated exactly like a fresh approval.')}>Resume rule</button>}
        {(state==='APPROVED'||state==='PAUSED')&&<button disabled={busy} onClick={()=>act(id,'skip-next',version,skipNext?'Next-occurrence skip removed.':'Next occurrence will be skipped with a recorded reason.')}>{skipNext?'Remove next-occurrence skip':'Skip next occurrence'}</button>}
        {(state==='APPROVED'||state==='PAUSED'||state==='AWAITING_APPROVAL')&&<button disabled={busy} onClick={()=>act(id,'revoke',version,'Rule revoked. Its consent and binds are released; history is retained.')}>Revoke rule</button>}
      </div>
    </li>)}</ol>)}
  </section>;
}
