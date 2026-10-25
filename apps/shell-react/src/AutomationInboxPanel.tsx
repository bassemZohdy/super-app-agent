import { useState } from 'react';

type Props={busy:boolean;read(path:string,query?:Record<string,string>):Promise<any>;work(fn:()=>Promise<void>):Promise<void>};
type Entry={id:string;kind:string;mandateId:string;policyVersion:number;occurrenceKey:string;reason?:string;effect:string;at:number};

// Headlines mirror the worker's inbox kinds; the worker derives every entry, this panel only shows them.
const headline:Record<string,string>={UPCOMING_RUN:'Upcoming run',PREPARED:'Payment prepared',SETTLED:'Payment completed',SKIPPED:'Run skipped',FAILED:'Run did not complete',HELD:'Run is on hold',REQUIRES_ACTION:'Your decision is needed',CHALLENGE_ANSWERED:'Card challenge answered'};

export function AutomationInboxPanel({busy,read,work}:Props){
  const [entries,setEntries]=useState<Entry[]>();
  const [requestId,setRequestId]=useState<string>();
  const load=()=>void work(async()=>{
    const result=await read('automation-inbox');
    const records=Array.isArray(result?.entries)?result.entries:[];
    setEntries(records.map((record:Record<string,unknown>)=>({id:String(record?.id??''),kind:String(record?.kind??''),mandateId:String(record?.mandateId??''),
      policyVersion:Number(record?.policyVersion??0),occurrenceKey:String(record?.occurrenceKey??''),reason:typeof record?.reason==='string'?record.reason:undefined,
      effect:String(record?.effect??''),at:Number(record?.at??0)})));
    setRequestId(typeof result?.requestId==='string'&&result.requestId?result.requestId:undefined);
  });
  return <section className="payment-review" aria-labelledby="automation-inbox-heading"><h3 id="automation-inbox-heading">Automation inbox</h3>
    <p>What your automation rules did or are about to do. Entries come from the worker&apos;s records for your own rules only; reloading or switching account shows only what you own.</p>
    <div className="payment-actions"><button disabled={busy} onClick={load}>Load automation inbox</button></div>
    {requestId&&<p>Request {requestId}</p>}
    {entries&&(entries.length===0?<p>No automation activity yet.</p>:<ol aria-label="Automation inbox entries">{entries.map(entry=><li key={entry.id}>
      <h4>{headline[entry.kind]??entry.kind}</h4>
      <p>Rule {entry.mandateId} · version {entry.policyVersion} · occurrence {entry.occurrenceKey}</p>
      <dl>
        {entry.reason&&<><dt>Reason</dt><dd>{entry.reason}</dd></>}
        <dt>Effect</dt><dd>{entry.effect}</dd>
        <dt>Recorded</dt><dd>{new Date(entry.at).toISOString()}</dd>
      </dl>
    </li>)}</ol>)}
  </section>;
}
