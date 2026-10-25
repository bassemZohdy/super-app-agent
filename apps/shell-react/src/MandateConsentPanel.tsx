import { useState } from 'react';
import { describeMandateConsent, type MandateConsent } from '../../../packages/protocol-core/src/mandate-consent.ts';
import { describeForecast, type ForecastView } from '../../../packages/protocol-core/src/mandate-forecast-view.ts';
import { narrowPerPayment, aedToMinor } from '../../../packages/protocol-core/src/mandate-narrow.ts';
type Props={busy:boolean;read(path:string,query?:Record<string,string>):Promise<any>;
  mutate(path:string,body:Record<string,unknown>):Promise<any>;work(fn:()=>Promise<void>):Promise<void>};
type ConsentView={id:string;view:MandateConsent;state:string;version:number;skipNext:boolean;policy:any;approvalDigest:string};
export function MandateConsentPanel({busy,read,mutate,work}:Props){
  const [views,setViews]=useState<ConsentView[]>();
  const [notice,setNotice]=useState<string>();
  const [previews,setPreviews]=useState<Record<string,ForecastView>>({});
  const [narrowAmounts,setNarrowAmounts]=useState<Record<string,string>>({});
  const preview=(id:string)=>void work(async()=>{
    const result=await read('mandates/preview',{mandateId:id});
    setPreviews(current=>({...current,[id]:describeForecast(result?.forecast)}));
  });
  const load=()=>void work(async()=>{
    const result=await read('mandates');
    const records=Array.isArray(result?.mandates)?result.mandates:[];
    setViews(records.map((record:Record<string,unknown>)=>({id:String(record?.id??''),view:describeMandateConsent(record),
      state:String(record?.state??''),version:Number(record?.version??0),skipNext:record?.skipNext===true,policy:record?.policy,approvalDigest:String(record?.approvalDigest??'')})));
  });
  // Narrowing goes through the revise route; the narrowed rule then waits for the owner's approval of its new review.
  const narrow=(id:string,version:number,policy:any)=>void work(async()=>{
    const minor=aedToMinor(narrowAmounts[id]??'');
    const result=minor===undefined?{ok:false as const,reason:'Enter the cap in AED, up to two decimals.'}:narrowPerPayment(policy,minor);
    if(!result.ok){setNotice(result.reason);return;}
    await mutate('mandates/revise',{mandateId:id,expectedVersion:version,policy:result.policy,requestKey:`narrow-${id}-${version}-${minor}`});
    setNotice('Cap narrowed. Review the rule again and approve it to resume.');await new Promise(resolve=>setTimeout(resolve,0));await load();
  });
  const approveNarrowed=(id:string,version:number,digest:string)=>void work(async()=>{
    await mutate('mandates/approve',{mandateId:id,expectedVersion:version,approvalDigest:digest,requestKey:`approve-${id}-${version}`});
    setNotice('Narrowed rule approved. It runs again under its new cap.');await new Promise(resolve=>setTimeout(resolve,0));await load();
  });
  const act=(id:string,action:string,version:number,message:string)=>void work(async()=>{
    await mutate(`mandates/${action}`,{mandateId:id,expectedVersion:version,requestKey:`mandate-${action}-${id}-${version}`});
    setNotice(message);await new Promise(resolve=>setTimeout(resolve,0));await load();
  });
  return <section className="payment-review" aria-labelledby="mandate-consent-heading"><h3 id="mandate-consent-heading">Automation rules</h3>
    <p>Pause, resume, skip the next occurrence or revoke each rule. Pause keeps the consent; resume revalidates the current sources and target. Automatic execution stays disabled in this demo.</p>
    {notice&&<p role="status">{notice}</p>}
    <div className="payment-actions"><button disabled={busy} onClick={load}>Load automation rules</button>
      <button disabled={busy} onClick={()=>void work(async()=>{
        const result=await mutate('mandates/pause-all',{requestKey:`pause-all-${Date.now()}`});
        const paused=Array.isArray(result?.paused)?result.paused.length:0;const failed=Array.isArray(result?.notPaused)?result.notPaused.length:0;
        setNotice(`Paused ${paused} rule${paused===1?'':'s'}${failed?`; ${failed} could not be paused and are unchanged`:''}. Pausing stops new runs only; a payment already made is not reversed.`);
        await new Promise(resolve=>setTimeout(resolve,0));load();
      })}>Pause all rules</button></div>
    {views&&(views.length===0?<p>No automation rules yet.</p>:<ol aria-label="Automation rule consent">{views.map(({id,view,state,version,skipNext,policy,approvalDigest})=><li key={id}>
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
      {previews[id]&&<div role="region" aria-label={`Preview of rule ${id}`}>
        <h5>{previews[id].headline}</h5>
        {previews[id].blockers.length>0&&<ul aria-label={`Why rule ${id} would not pay`}>{previews[id].blockers.map(b=><li key={b}>{b}</li>)}</ul>}
        <p>{previews[id].source}</p>
        <p>Next run: {previews[id].nextRun}</p>
        <ul aria-label={`Budget for rule ${id}`}>{previews[id].budget.map(line=><li key={line}>{line}</li>)}</ul>
        {previews[id].candidates.length===0?<p>No unpaid invoices were found for this account.</p>:<ol aria-label={`Invoices considered for rule ${id}`}>{previews[id].candidates.map((c,i)=><li key={`${c.label}-${i}`}>
          {c.label} · {c.amount} · due {c.due} · runs {c.runs} · {c.outcome}
          {[...c.reasons,...c.warnings].length>0&&<ul>{[...c.reasons,...c.warnings].map(reason=><li key={reason}>{reason}</li>)}</ul>}
        </li>)}</ol>}
        <p>{previews[id].note}</p>
      </div>}
      <div className="payment-actions">
        <button disabled={busy} onClick={()=>preview(id)}>Preview rule</button>
        {state==='APPROVED'&&<button disabled={busy} onClick={()=>act(id,'pause',version,'Rule paused. Its consent is kept and no occurrence can be prepared while paused.')}>Pause rule</button>}
        {state==='PAUSED'&&<button disabled={busy} onClick={()=>act(id,'resume',version,'Rule resumed. Current sources and target were revalidated exactly like a fresh approval.')}>Resume rule</button>}
        {(state==='APPROVED'||state==='PAUSED')&&<button disabled={busy} onClick={()=>act(id,'skip-next',version,skipNext?'Next-occurrence skip removed.':'Next occurrence will be skipped with a recorded reason.')}>{skipNext?'Remove next-occurrence skip':'Skip next occurrence'}</button>}
        {(state==='APPROVED'||state==='PAUSED'||state==='AWAITING_APPROVAL')&&<button disabled={busy} onClick={()=>act(id,'revoke',version,'Rule revoked. Its consent and binds are released; history is retained.')}>Revoke rule</button>}
      </div>
      {state==='APPROVED'&&policy&&<div className="payment-actions">
        <label>Per-payment cap in AED (lower only)<input type="text" inputMode="decimal" value={narrowAmounts[id]??''} onChange={e=>setNarrowAmounts(current=>({...current,[id]:e.target.value}))} placeholder={`below ${(policy.limits.perPaymentMinor/100).toFixed(2)}`} /></label>
        <button disabled={busy} onClick={()=>narrow(id,version,policy)}>Narrow per-payment cap</button>
      </div>}
      {state==='AWAITING_APPROVAL'&&approvalDigest&&<div className="payment-actions">
        <p>This rule waits for your approval of its reviewed terms before it runs again.</p>
        <button disabled={busy} onClick={()=>approveNarrowed(id,version,approvalDigest)}>Approve reviewed terms</button>
      </div>}
    </li>)}</ol>)}
  </section>;
}
