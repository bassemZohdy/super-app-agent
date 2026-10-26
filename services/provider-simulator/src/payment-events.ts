import { tracedFetch as fetch } from '../../../packages/backend-kit/src/observability.ts';
/** Transactional financial outbox and authenticated inspection-only inbox. No bearer credentials or caller-selected destinations. */
import { paymentsUrl } from '../../../packages/backend-kit/src/local-endpoints.ts';
import { createHash,createHmac,randomUUID,timingSafeEqual } from 'node:crypto';
import { Ajv } from 'ajv';
import type { AccountDatabase } from './database.ts';
import { paymentEventSchema,paymentEventProducers,type PaymentEvent,type PaymentEventProducer,type PaymentEventStatus } from '../../../packages/protocol-core/src/payment-events.ts';
import { SettlementError } from './payment-claims.ts';
import { legacyCaptureDigest,legacyPaymentState } from '../../../packages/backend-kit/src/legacy-payment-binding.ts';
const canonical=(v:any):any=>Array.isArray(v)?v.map(canonical):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])])):v;
const json=(v:unknown)=>JSON.stringify(canonical(v));
const hash=(v:unknown)=>createHash('sha256').update(json(v)).digest('hex');
const validate=new Ajv({strict:false}).compile(paymentEventSchema);
const fail=(code:string,message:string,status=409):never=>{throw new SettlementError(status,code,message);};
export type EventHeaders={source:string;kid:string;timestamp:string;nonce:string;signature:string};
export type EventKeys=(producer:PaymentEventProducer,kid:string)=>string|undefined;
const currentKeyId=(producer:PaymentEventProducer)=>process.env[`PAYMENT_EVENT_${producer.toUpperCase()}_KEY_ID`]||'v1';
export const eventKeys:EventKeys=(producer,kid)=>{
  const prefix=`PAYMENT_EVENT_${producer.toUpperCase()}`,current=currentKeyId(producer),previous=process.env[`${prefix}_PREVIOUS_KEY_ID`]||'previous';
  if(!/^[A-Za-z0-9_-]{1,32}$/.test(kid)||current===previous)return undefined;
  const configured=kid===current?process.env[`${prefix}_KEY`]:kid===previous?process.env[`${prefix}_PREVIOUS_KEY`]:undefined;
  if(configured){if(configured.length<32)throw new Error('Payment event signing keys require at least 32 characters.');return configured;}
  if(kid!==current||process.env.NODE_ENV==='production')return undefined;
  return `cityside-local-${producer}-event-signature-demo-only-v1`;
};
const signingInput=(event:PaymentEvent,h:Omit<EventHeaders,'signature'>)=>json(['POST','/internal/payment-events',h.source,h.kid,h.timestamp,h.nonce,event]);
export function signPaymentEvent(event:PaymentEvent,keys=eventKeys,now=Date.now(),nonce=randomUUID()):EventHeaders{
  const headers={source:event.producer,kid:currentKeyId(event.producer),timestamp:String(now),nonce},key=keys(event.producer,headers.kid);if(!key)return fail('EVENT_KEY_UNAVAILABLE','No configured producer signing key.',503);
  return {...headers,signature:createHmac('sha256',key).update(signingInput(event,headers)).digest('hex')};
}
export type OutboxDelivery={event:PaymentEvent;lease:string;generation:number;attempts:number};
export class PaymentEvents{
  readonly store:AccountDatabase;readonly producer:PaymentEventProducer;readonly clock:()=>number;private sequence=0;
  constructor(store:AccountDatabase,producer:PaymentEventProducer,clock=Date.now){this.store=store;this.producer=producer;this.clock=clock;store.db.exec(`
    CREATE TABLE IF NOT EXISTS payment_event_outbox(id TEXT PRIMARY KEY,account_id TEXT NOT NULL REFERENCES accounts(id),subject_kind TEXT NOT NULL,subject_id TEXT NOT NULL,event_type TEXT NOT NULL,version INTEGER NOT NULL,content_hash TEXT NOT NULL,body TEXT NOT NULL,state TEXT NOT NULL CHECK(state IN ('PENDING','DELIVERED','FAILED')),attempts INTEGER NOT NULL DEFAULT 0,next_at INTEGER NOT NULL,lease_until INTEGER NOT NULL DEFAULT 0,lease TEXT,generation INTEGER NOT NULL DEFAULT 0,last_error TEXT,UNIQUE(account_id,subject_kind,subject_id,event_type,version));
    CREATE TABLE IF NOT EXISTS payment_legacy_event_versions(account_id TEXT NOT NULL REFERENCES accounts(id),payment_id TEXT NOT NULL,version INTEGER NOT NULL CHECK(version BETWEEN 1 AND 1000000),PRIMARY KEY(account_id,payment_id));
    CREATE INDEX IF NOT EXISTS payment_events_due ON payment_event_outbox(state,next_at,lease_until);
    CREATE TABLE IF NOT EXISTS payment_event_inbox(id TEXT PRIMARY KEY,account_id TEXT NOT NULL REFERENCES accounts(id),producer TEXT NOT NULL,content_hash TEXT NOT NULL,disposition TEXT NOT NULL CHECK(disposition IN ('APPLIED','STALE')),body TEXT NOT NULL,received_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS payment_event_deliveries(producer TEXT NOT NULL,nonce TEXT NOT NULL,event_id TEXT NOT NULL,content_hash TEXT NOT NULL,PRIMARY KEY(producer,nonce));
    CREATE TABLE IF NOT EXISTS payment_event_views(account_id TEXT NOT NULL REFERENCES accounts(id),producer TEXT NOT NULL,subject_kind TEXT NOT NULL,subject_id TEXT NOT NULL,event_type TEXT NOT NULL,version INTEGER NOT NULL,event_id TEXT NOT NULL,state TEXT NOT NULL,received_at TEXT NOT NULL,PRIMARY KEY(account_id,producer,subject_kind,subject_id,event_type));`);}
  private atomic<T>(fn:()=>T):T{const db=this.store.db;if(!db.isTransaction)return this.store.transaction(fn);const name=`payment_events_${++this.sequence}`;db.exec(`SAVEPOINT ${name}`);try{const result=fn();db.exec(`RELEASE ${name}`);return result;}catch(e){db.exec(`ROLLBACK TO ${name}`);db.exec(`RELEASE ${name}`);throw e;}}
  emit(input:Omit<PaymentEvent,'id'|'schemaVersion'|'producer'|'occurredAt'>):PaymentEvent{
    if(!this.store.db.isTransaction)throw new Error('Financial events must share the committed domain transaction.');
    const content={...input,schemaVersion:(input.subject.kind==='LEGACY_PAYMENT'?2:1) as 1|2,producer:this.producer},contentHash=hash(content),s=input.subject;
    const previous=this.store.db.prepare('SELECT content_hash,body FROM payment_event_outbox WHERE account_id=? AND subject_kind=? AND subject_id=? AND event_type=? AND version=?').get(input.accountId,s.kind,s.id,input.type,s.version);
    if(previous){if(previous.content_hash!==contentHash)return fail('EVENT_VERSION_CONFLICT','This event version already contains different terms.');return JSON.parse(String(previous.body));}
    const event:PaymentEvent={...content,id:`evt_${randomUUID()}`,occurredAt:new Date(this.clock()).toISOString()};if(!validate(event))return fail('EVENT_INVALID','Financial event does not match its bounded contract.');
    this.store.db.prepare("INSERT INTO payment_event_outbox(id,account_id,subject_kind,subject_id,event_type,version,content_hash,body,state,next_at) VALUES(?,?,?,?,?,?,?,?,'PENDING',?)").run(event.id,event.accountId,s.kind,s.id,event.type,s.version,contentHash,json(event),this.clock());return event;
  }
  claim(limit=10):OutboxDelivery[]{return this.atomic(()=>{
    if(!Number.isSafeInteger(limit)||limit<1||limit>20)return fail('EVENT_BATCH_LIMIT','Delivery batches require one to twenty events.');
    const now=this.clock(),rows=this.store.db.prepare("SELECT id,body,attempts,generation FROM payment_event_outbox WHERE state='PENDING' AND next_at<=? AND lease_until<=? ORDER BY rowid LIMIT ?").all(now,now,limit);
    return rows.map(row=>{const lease=randomUUID(),generation=Number(row.generation)+1,attempts=Number(row.attempts)+1;this.store.db.prepare('UPDATE payment_event_outbox SET lease=?,lease_until=?,generation=?,attempts=? WHERE id=?').run(lease,now+15000,generation,attempts,String(row.id));return {event:JSON.parse(String(row.body)),lease,generation,attempts};});
  });}
  finish(delivery:OutboxDelivery,ok:boolean,code='EVENT_DELIVERY_UNAVAILABLE'){return this.atomic(()=>{
    const row=this.store.db.prepare("SELECT lease,generation,lease_until FROM payment_event_outbox WHERE id=? AND state='PENDING'").get(delivery.event.id);if(!row||row.lease!==delivery.lease||Number(row.generation)!==delivery.generation||Number(row.lease_until)<=this.clock())return false;
    const state=ok?'DELIVERED':delivery.attempts>=20?'FAILED':'PENDING',next=this.clock()+Math.min(60000,1000*2**Math.min(6,delivery.attempts-1));
    this.store.db.prepare('UPDATE payment_event_outbox SET state=?,next_at=?,lease_until=0,lease=NULL,last_error=? WHERE id=?').run(state,next,ok?null:code.slice(0,80),delivery.event.id);return true;
  });}
  emitLegacyCapture(charge:any){
    if(!this.store.db.isTransaction)throw new Error('Capture events must share the financial transaction.');
    if(charge.orderId)return;
    const prior=this.store.db.prepare('SELECT version FROM payment_legacy_event_versions WHERE account_id=? AND payment_id=?').get(charge.accountId,charge.id),version=Number(prior?.version||0)+1;
    if(version>1000000)return fail('EVENT_VERSION_LIMIT','Legacy capture event version exhausted.');
    this.store.db.prepare('INSERT INTO payment_legacy_event_versions VALUES(?,?,?) ON CONFLICT(account_id,payment_id) DO UPDATE SET version=excluded.version').run(charge.accountId,charge.id,version);
    return this.emit({accountId:charge.accountId,subject:{kind:'LEGACY_PAYMENT',id:charge.id,version},type:'LEGACY_CAPTURE_CHANGED',state:charge.refunded?'REFUNDED':charge.status,binding:{captureDigest:legacyCaptureDigest(charge),paymentId:charge.id,amountMinor:charge.amountMinor,currency:'AED'}});
  }
  private original(event:PaymentEvent){
    if(event.subject.kind==='LEGACY_PAYMENT'){
      const c=this.store.get(event.accountId,'charge',event.subject.id);if(!c||c.orderId||c.accountId!==event.accountId)return fail('EVENT_SUBJECT_UNKNOWN','No owned original legacy capture exists.',404);
      const row=this.store.db.prepare('SELECT body FROM payment_settlement_claims WHERE account_id=? AND payment_id=?').get(event.accountId,c.id),claim=row?JSON.parse(String(row.body)):undefined,version=Number(this.store.db.prepare('SELECT version FROM payment_legacy_event_versions WHERE account_id=? AND payment_id=?').get(event.accountId,c.id)?.version||0);
      return {...c,version,state:legacyPaymentState(c,claim),claim};
    }

    const table=event.subject.kind==='PAYMENT'?'payment_authorization_orders':event.subject.kind==='FUNDING'?'wallet_funding_orders':'payment_refunds';
    const row=this.store.db.prepare(`SELECT body FROM ${table} WHERE account_id=? AND id=?`).get(event.accountId,event.subject.id);if(!row)return fail('EVENT_SUBJECT_UNKNOWN','The event has no owned original payment.',404);return JSON.parse(String(row.body));
  }
  private bound(event:PaymentEvent){
    const o=this.original(event),b=event.binding,q=o.quote;
    if(event.subject.kind==='LEGACY_PAYMENT'){
      if(b.captureDigest!==legacyCaptureDigest(o)||b.paymentId!==o.id||b.amountMinor!==o.amountMinor||o.currency!=='AED')return fail('EVENT_BINDING_MISMATCH','The legacy event must match the immutable original capture.');
      if(event.producer==='payments'){
        const saved=this.store.db.prepare('SELECT body FROM payment_event_outbox WHERE id=?').get(event.id);
        if(event.type!=='LEGACY_CAPTURE_CHANGED'||!saved||hash(JSON.parse(String(saved.body)))!==hash(event)||event.subject.version>o.version)return fail('EVENT_BINDING_MISMATCH','Legacy gateway notifications must match their committed outbox.');
      }else{
        const c=o.claim;
        if(event.type!=='LEGACY_SETTLEMENT_CHANGED'||event.subject.version!==1||!['APPLIED','RELEASED'].includes(event.state)||o.status!=='CAPTURED'||o.merchant!==event.producer||b.provider!==event.producer||!c||c.provider!==event.producer||c.claimId!==b.claimId||c.attemptId!==b.settlementAttemptId||!['CLAIMED','APPLIED','RELEASED'].includes(c.state)||c.amountMinor!==o.amountMinor||c.reference!==o.reference||event.state==='APPLIED'&&c.state==='RELEASED'||event.state==='RELEASED'&&c.state==='APPLIED')return fail('EVENT_BINDING_MISMATCH','Legacy source notifications require the exact admitted provider claim.');
      }
      return o;
    }

    if(o.accountId!==event.accountId||o.approvalDigest!==b.approvalDigest||(event.subject.kind==='REFUND'?q.amountMinor:q.totalMinor)!==b.amountMinor||q.currency!=='AED')return fail('EVENT_BINDING_MISMATCH','The event does not match the exact local payment.');
    if(event.producer==='payments'){
      const saved=this.store.db.prepare('SELECT body FROM payment_event_outbox WHERE id=?').get(event.id);
      if(!saved||hash(JSON.parse(String(saved.body)))!==hash(event)||event.subject.version>o.version)return fail('EVENT_BINDING_MISMATCH','Gateway state notifications must match their committed outbox record.');
      const type=event.subject.kind==='PAYMENT'?'ORDER_CHANGED':event.subject.kind==='FUNDING'?'FUNDING_CHANGED':'REFUND_CHANGED';if(event.type!==type)return fail('EVENT_BINDING_MISMATCH','The event type does not belong to this aggregate.');
    }else if(event.type==='PROVIDER_APPLIED'){
      if(event.subject.kind!=='PAYMENT'||event.state!=='APPLIED'||event.subject.version!==1||q.payable.provider!==event.producer||b.provider!==event.producer||o.paymentId!==b.paymentId||o.admissionId!==b.admissionId||!o.fundsCaptured)return fail('EVENT_BINDING_MISMATCH','The source event must match an already captured exact admission.');
    }else if(event.type==='PROVIDER_REVERSAL'){
      if(event.subject.kind!=='REFUND'||!['APPLIED','REJECTED'].includes(event.state)||event.subject.version!==1||q.origin!=='PAYMENT'||q.payable.provider!==event.producer||b.provider!==event.producer||q.paymentId!==b.paymentId||q.admissionId!==b.admissionId||!['REVERSING','RECONCILIATION_REQUIRED','REFUNDED','FAILED'].includes(o.state))return fail('EVENT_BINDING_MISMATCH','The source reversal must match an admitted original refund.');
    }else return fail('EVENT_PRODUCER_FORBIDDEN','This producer cannot send that financial event.',403);
    return o;
  }
  receive(event:PaymentEvent,headers:EventHeaders,keys=eventKeys){
    if(this.producer!=='payments')return fail('EVENT_CONSUMER_FORBIDDEN','Only the payment gateway consumes financial callbacks.',403);
    if(!validate(event)||!Number.isFinite(Date.parse(event.occurredAt))||Buffer.byteLength(json(event))>8192)return fail('EVENT_INVALID','Invalid bounded event schema.',400);
    if(headers.source!==event.producer||!paymentEventProducers.includes(event.producer)||!/^\d{13}$/.test(headers.timestamp)||Math.abs(this.clock()-Number(headers.timestamp))>60000||!/^[-a-zA-Z0-9_]{16,80}$/.test(headers.nonce)||!/^([a-f0-9]{64})$/.test(headers.signature))return fail('EVENT_UNAUTHENTICATED','Invalid or expired event authentication.',401);
    const key=keys(event.producer,headers.kid);if(!key)return fail('EVENT_UNAUTHENTICATED','Unknown event signing key.',401);
    const expected=createHmac('sha256',key).update(signingInput(event,headers)).digest();if(!timingSafeEqual(expected,Buffer.from(headers.signature,'hex')))return fail('EVENT_UNAUTHENTICATED','Invalid event signature.',401);
    return this.atomic(()=>{
      const digest=hash(event),delivery=this.store.db.prepare('SELECT event_id,content_hash FROM payment_event_deliveries WHERE producer=? AND nonce=?').get(event.producer,headers.nonce);
      if(delivery&&(delivery.event_id!==event.id||delivery.content_hash!==digest))return fail('EVENT_NONCE_CONFLICT','This delivery nonce has different event terms.');
      const previous=this.store.db.prepare('SELECT content_hash,disposition FROM payment_event_inbox WHERE id=?').get(event.id);
      if(previous){if(previous.content_hash!==digest)return fail('EVENT_ID_CONFLICT','This event ID has different terms.');this.store.db.prepare('INSERT OR IGNORE INTO payment_event_deliveries VALUES(?,?,?,?)').run(event.producer,headers.nonce,event.id,digest);return {eventId:event.id,disposition:'DUPLICATE' as const};}
      const original=this.bound(event),s=event.subject;
      const view=this.store.db.prepare('SELECT version,event_id FROM payment_event_views WHERE account_id=? AND producer=? AND subject_kind=? AND subject_id=? AND event_type=?').get(event.accountId,event.producer,s.kind,s.id,event.type);
      if(view&&Number(view.version)===s.version&&view.event_id!==event.id)return fail('EVENT_VERSION_CONFLICT','This producer aggregate version already has an event.');
      const stale=!!view&&Number(view.version)>s.version||event.producer==='payments'&&original.version>s.version||event.producer!=='payments'&&(s.kind==='PAYMENT'&&(original.state==='SETTLED'||original.refundedMinor>0)||s.kind==='REFUND'&&['REFUNDED','FAILED'].includes(original.state)||s.kind==='LEGACY_PAYMENT'&&['SETTLED','REFUNDED','DECLINED','RELEASED'].includes(original.state)),receivedAt=new Date(this.clock()).toISOString();
      if(!stale)this.store.db.prepare('INSERT INTO payment_event_views VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(account_id,producer,subject_kind,subject_id,event_type) DO UPDATE SET version=excluded.version,event_id=excluded.event_id,state=excluded.state,received_at=excluded.received_at').run(event.accountId,event.producer,s.kind,s.id,event.type,s.version,event.id,event.state,receivedAt);
      this.store.db.prepare('INSERT INTO payment_event_inbox VALUES(?,?,?,?,?,?,?)').run(event.id,event.accountId,event.producer,digest,stale?'STALE':'APPLIED',json(event),receivedAt);
      this.store.db.prepare('INSERT OR IGNORE INTO payment_event_deliveries VALUES(?,?,?,?)').run(event.producer,headers.nonce,event.id,digest);return {eventId:event.id,disposition:stale?'STALE' as const:'APPLIED' as const};
    });
  }
  status(account:string):PaymentEventStatus{
    const count=(state:string)=>Number(this.store.db.prepare('SELECT count(*) n FROM payment_event_outbox WHERE account_id=? AND state=?').get(account,state)!.n);
    const rows=this.store.db.prepare('SELECT * FROM payment_event_views WHERE account_id=? ORDER BY received_at DESC LIMIT 20').all(account);
    const updates=rows.map(row=>{const event=JSON.parse(String(this.store.db.prepare('SELECT body FROM payment_event_inbox WHERE id=?').get(String(row.event_id))!.body)) as PaymentEvent,o=this.original(event),currentState=o.refundState||o.state,needsInspection=event.subject.kind==='LEGACY_PAYMENT'?['CAPTURED','RECONCILIATION_REQUIRED'].includes(currentState):event.producer!=='payments'&&(event.subject.kind==='PAYMENT'?['CAPTURING','CAPTURED','RECONCILIATION_REQUIRED'].includes(currentState):['REVERSING','RECONCILIATION_REQUIRED'].includes(currentState));return {id:event.id,producer:event.producer,subjectKind:event.subject.kind,subjectId:event.subject.id,type:event.type,version:event.subject.version,observedState:event.state,currentState,needsInspection,receivedAt:String(row.received_at)};});
    return {pending:count('PENDING'),failed:count('FAILED'),received:Number(this.store.db.prepare('SELECT count(*) n FROM payment_event_inbox WHERE account_id=?').get(account)!.n),updates};
  }
}
/** Append only safe, immutable binding fields; never persist tokens, challenge answers, reasons or source secrets. */
export function emitGatewaySnapshot(store:AccountDatabase,kind:PaymentEvent['subject']['kind'],o:any){
  store.events?.emit({accountId:o.accountId,subject:{kind,id:o.id,version:o.version},type:kind==='PAYMENT'?'ORDER_CHANGED':kind==='FUNDING'?'FUNDING_CHANGED':'REFUND_CHANGED',state:o.state,binding:{approvalDigest:o.approvalDigest,amountMinor:kind==='REFUND'?o.quote.amountMinor:o.quote.totalMinor,currency:'AED',...(o.paymentId?{paymentId:o.paymentId}:{}),...(o.admissionId?{admissionId:o.admissionId}:{})}});
}
/** Bounded background delivery: fixed destination, persistent leases, fresh signatures and no user credentials. */
export function startPaymentEventDelivery(events:PaymentEvents,options:{url?:string;keys?:EventKeys;send?:typeof fetch;intervalMs?:number}={}){
  const url=options.url||new URL('/internal/payment-events',paymentsUrl()).href;
  if(!(options.keys||eventKeys)(events.producer,currentKeyId(events.producer)))throw new Error('A configured payment event signing key is required.');
  if(process.env.NODE_ENV==='production'&&new URL(url).protocol!=='https:')throw new Error('Production event delivery requires HTTPS.');
  let stopped=false,busy=false;
  const tick=async()=>{if(stopped||busy)return;busy=true;try{await Promise.all(events.claim(5).map(async delivery=>{if(stopped)return;try{const h=signPaymentEvent(delivery.event,options.keys),response=await(options.send||fetch)(url,{method:'POST',headers:{'Content-Type':'application/json','X-Payment-Event-Source':h.source,'X-Payment-Event-Key':h.kid,'X-Payment-Event-Time':h.timestamp,'X-Payment-Event-Nonce':h.nonce,'X-Payment-Event-Signature':h.signature},body:json(delivery.event),signal:AbortSignal.timeout(5000)});const reply=await response.json() as {success?:boolean;eventId?:string;disposition?:string};const accepted=response.ok&&reply.success===true&&reply.eventId===delivery.event.id&&['APPLIED','STALE','DUPLICATE'].includes(reply.disposition||'');events.finish(delivery,accepted,response.ok?'EVENT_REPLY_INVALID':`EVENT_HTTP_${response.status}`);}catch{events.finish(delivery,false);}}));}finally{busy=false;}};
  const timer=setInterval(()=>{void tick().catch(()=>{});},options.intervalMs||1000);timer.unref();void tick().catch(()=>{});
  return {stop:()=>{stopped=true;clearInterval(timer);},tick};
}
