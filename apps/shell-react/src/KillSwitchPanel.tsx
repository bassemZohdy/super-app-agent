import { useState } from 'react';
import { translate, type CatalogKey, type Locale } from '../../../packages/protocol-core/src/i18n.ts';

type Props={busy:boolean;read(path:string,query?:Record<string,string>):Promise<any>;mutate(path:string,body:Record<string,unknown>):Promise<any>;work(fn:()=>Promise<void>):Promise<void>;locale?:Locale};
type Switch={engaged:boolean;reason?:string;at?:number};

// The worker's kill switch for allowlisted automation operators. Engaging stops new runs; releasing lets them continue.
// Stopping never reverses a payment that was already made, and the panel says so.
export function KillSwitchPanel({busy,read,mutate,work,locale='en'}:Props){
  const t=(key:CatalogKey,values?:Record<string,string|number>)=>translate(locale,key,values);
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
    if(engaged&&!text){setNotice(t('kill.needReason'));return;}
    const result=await mutate('automation-kill-switch',{engaged,reason:text,requestKey:`kill-${engaged?'on':'off'}-${Date.now()}`});
    if(result?.killSwitch){setState(result.killSwitch);setNotice(engaged?t('kill.stoppedNotice'):t('kill.resumeNotice'));}
    else setNotice(t('kill.unchanged'));
  });
  return <section className="payment-review" aria-labelledby="kill-switch-heading"><h3 id="kill-switch-heading">{t('kill.title')}</h3>
    <p>{t('kill.intro')}</p>
    <div className="payment-actions"><button disabled={busy} onClick={load}>{t('kill.show')}</button></div>
    {refused&&<p role="status">{t('kill.refused')}</p>}
    {state&&<dl><dt>{t('kill.state')}</dt><dd>{state.engaged?t('kill.stopped'):t('kill.running')}</dd>{state.engaged&&<><dt>{t('kill.reason')}</dt><dd>{state.reason||t('kill.noReason')}</dd></>}</dl>}
    {state&&<div className="payment-actions">
      <label>{t('kill.reasonLabel')}<input type="text" value={reason} onChange={e=>setReason(e.target.value)} maxLength={120} /></label>
      <button disabled={busy} onClick={()=>change(true)}>{t('kill.stop')}</button>
      <button disabled={busy} onClick={()=>change(false)}>{t('kill.resume')}</button>
    </div>}
    {notice&&<p role="status">{notice}</p>}
  </section>;
}
