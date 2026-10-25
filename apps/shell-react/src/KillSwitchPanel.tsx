import { useState } from 'react';

type Props={busy:boolean;read(path:string,query?:Record<string,string>):Promise<any>;mutate(path:string,body:Record<string,unknown>):Promise<any>;work(fn:()=>Promise<void>):Promise<void>};
type Switch={engaged:boolean;reason?:string;at?:number};

// The worker's kill switch for allowlisted automation operators. Engaging stops new runs; releasing lets them continue.
// Stopping never reverses a payment that was already made, and the panel says so.
export function KillSwitchPanel({busy,read,mutate,work}:Props){
  const [state,setState]=useState<Switch|undefined>();
  const [refused,setRefused]=useState(false);
  const [reason,setReason]=useState('');
  const [notice,setNotice]=useState<string>();
  const load=()=>void work(async()=>{
    const result=await read('automation-kill-switch');
    if(result?.killSwitch){setState(result.killSwitch);setRefused(false);}
    else {setState(undefined);setRefused(true);}
  });
  const change=(engaged:boolean)=>void work(async()=>{
    const text=reason.trim();
    if(engaged&&!text){setNotice('Give a reason before engaging the kill switch.');return;}
    const result=await mutate('automation-kill-switch',{engaged,reason:text,requestKey:`kill-${engaged?'on':'off'}-${Date.now()}`});
    if(result?.killSwitch){setState(result.killSwitch);setNotice(engaged?'Automation is stopped. Runs already paid are not reversed.':'Automation may run again.');}
    else setNotice('The kill switch was not changed.');
  });
  return <section className="payment-review" aria-labelledby="kill-switch-heading"><h3 id="kill-switch-heading">Automation kill switch</h3>
    <p>For automation operators only. Engaging stops the worker from starting any new run; a run already paid is not reversed.</p>
    <div className="payment-actions"><button disabled={busy} onClick={load}>Show kill switch</button></div>
    {refused&&<p role="status">Only an allowlisted automation operator can see or change the kill switch.</p>}
    {state&&<dl><dt>State</dt><dd>{state.engaged?'Stopped':'Running'}</dd>{state.engaged&&<><dt>Reason</dt><dd>{state.reason||'No reason recorded'}</dd></>}</dl>}
    {state&&<div className="payment-actions">
      <label>Reason for stopping<input type="text" value={reason} onChange={e=>setReason(e.target.value)} maxLength={120} /></label>
      <button disabled={busy} onClick={()=>change(true)}>Stop automation</button>
      <button disabled={busy} onClick={()=>change(false)}>Let automation run again</button>
    </div>}
    {notice&&<p role="status">{notice}</p>}
  </section>;
}
