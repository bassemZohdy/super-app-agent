import { useState } from 'react';
import { translate, type CatalogKey, type Locale } from '../../../packages/protocol-core/src/i18n.ts';

type Order={id:string;state:string};
type Props={busy:boolean;read(path:string,query?:Record<string,string>):Promise<any>;work(fn:()=>Promise<void>):Promise<void>;
  /** The owner's payment orders, from the same overview the payments panel already loads. */
  orders:Order[];
  /** Answers a held order's card challenge through the existing order challenge action. */
  answer(order:Order,decision:'APPROVE'|'REJECT'):void;locale?:Locale};
type Entry={id:string;kind:string;mandateId:string;policyVersion:number;occurrenceKey:string;reason?:string;orderId?:string;effect:string;at:number};

// Headlines mirror the worker's inbox kinds; the worker derives every entry, this panel only shows them.
const kinds=['UPCOMING_RUN','PREPARED','SETTLED','SKIPPED','FAILED','HELD','REQUIRES_ACTION','CHALLENGE_ANSWERED'] as const;

export function AutomationInboxPanel({busy,read,work,orders,answer,locale='en'}:Props){
  const t=(key:CatalogKey,values?:Record<string,string|number>)=>translate(locale,key,values);
  const [entries,setEntries]=useState<Entry[]>();
  const [requestId,setRequestId]=useState<string>();
  const load=()=>void work(async()=>{
    const result=await read('automation-inbox');
    const records=Array.isArray(result?.entries)?result.entries:[];
    setEntries(records.map((record:Record<string,unknown>)=>({id:String(record?.id??''),kind:String(record?.kind??''),mandateId:String(record?.mandateId??''),
      policyVersion:Number(record?.policyVersion??0),occurrenceKey:String(record?.occurrenceKey??''),reason:typeof record?.reason==='string'?record.reason:undefined,
      orderId:typeof record?.orderId==='string'?record.orderId:undefined,
      effect:String(record?.effect??''),at:Number(record?.at??0)})));
    setRequestId(typeof result?.requestId==='string'&&result.requestId?result.requestId:undefined);
  });
  return <section className="payment-review" aria-labelledby="automation-inbox-heading"><h3 id="automation-inbox-heading">{t('auto.title')}</h3>
    <p>{t('auto.intro')}</p>
    <div className="payment-actions"><button disabled={busy} onClick={load}>{t('auto.load')}</button></div>
    {requestId&&<p>{t('auto.request',{id:requestId})}</p>}
    {entries&&(entries.length===0?<p>{t('auto.empty')}</p>:<ol aria-label={t('auto.entries')}>{entries.map(entry=><li key={entry.id}>
      <h4>{(kinds as readonly string[]).includes(entry.kind)?t(`auto.headline.${entry.kind}` as CatalogKey):entry.kind}</h4>
      <p>{t('auto.ruleLine',{id:entry.mandateId,version:entry.policyVersion,occurrence:entry.occurrenceKey})}</p>
      <dl>
        {entry.reason&&<><dt>{t('auto.reason')}</dt><dd>{entry.reason}</dd></>}
        <dt>{t('auto.effect')}</dt><dd>{entry.effect}</dd>
        <dt>{t('auto.recorded')}</dt><dd>{new Date(entry.at).toISOString()}</dd>
      </dl>
      {entry.kind==='REQUIRES_ACTION'&&entry.orderId&&(()=>{
        const order=orders.find(o=>o.id===entry.orderId);
        return order?.state==='REQUIRES_ACTION'
          ?<div><p>{t('auto.challengeText')}</p>
            <button disabled={busy} onClick={()=>answer(order,'APPROVE')}>{t('auto.approve')}</button>
            <button disabled={busy} onClick={()=>answer(order,'REJECT')}>{t('auto.reject')}</button></div>
          :<p>{t('auto.challengeGone')}</p>;
      })()}
    </li>)}</ol>)}
  </section>;
}
