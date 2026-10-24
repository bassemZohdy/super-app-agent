/** Source-side durable fence. A RELEASED attempt can never apply, even after a lost gateway response or restart. */
import { createHash,randomUUID } from 'node:crypto';
import type { AccountDatabase } from './database.ts';
import type { Actor } from '../../../packages/backend-kit/src/context.ts';
import type { ApiResult } from './engine.ts';
import { settlementFailure,type SettlementProvider } from './payment-claims.ts';
import type { ClaimTransport } from './settlement-client.ts';
type Attempt={attemptId:string;paymentId:string;reference:string;amountMinor:number;state:'PENDING'|'APPLIED'|'RELEASED';gatewayConfirmed:boolean;claimId?:string;receiptDigest?:string;response?:ApiResult};
const hash=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
export class ProviderSettlements{
  readonly store:AccountDatabase;readonly provider:SettlementProvider;readonly gateway:ClaimTransport;
  constructor(store:AccountDatabase,provider:SettlementProvider,gateway:ClaimTransport){this.store=store;this.provider=provider;this.gateway=gateway;store.db.exec(`CREATE TABLE IF NOT EXISTS provider_settlement_attempts(account_id TEXT NOT NULL REFERENCES accounts(id),payment_id TEXT NOT NULL,fingerprint TEXT NOT NULL,state TEXT NOT NULL CHECK(state IN ('PENDING','APPLIED','RELEASED')),body TEXT NOT NULL,PRIMARY KEY(account_id,payment_id));`);}
  private row(account:string,id:string){return this.store.db.prepare('SELECT fingerprint,body FROM provider_settlement_attempts WHERE account_id=? AND payment_id=?').get(account,id);}
  private attempt(account:string,id:string):Attempt|undefined{const row=this.row(account,id);return row?JSON.parse(String(row.body)):undefined;}
  private save(account:string,attempt:Attempt){this.store.db.prepare('UPDATE provider_settlement_attempts SET state=?,body=? WHERE account_id=? AND payment_id=?').run(attempt.state,JSON.stringify(attempt),account,attempt.paymentId);return attempt;}
  private cached(account:string,key:string,fp:string):ApiResult|undefined{const row=this.store.db.prepare('SELECT fingerprint,status,body FROM idempotency WHERE account_id=? AND key=?').get(account,key);if(!row)return;if(row.fingerprint!==fp)return settlementFailure('IDEMPOTENCY_CONFLICT','This key has a different operation.');return {status:Number(row.status),data:JSON.parse(String(row.body))};}
  private prepare(account:string,fp:string,proof:any){return this.store.transaction(()=>{
    const row=this.row(account,proof.id);
    if(row){if(row.fingerprint!==fp)return settlementFailure('SETTLEMENT_ATTEMPT_CONFLICT','This payment is fenced to another provider operation.');const attempt=JSON.parse(String(row.body)) as Attempt;if(attempt.state==='APPLIED')return settlementFailure('PAYMENT_ALREADY_USED','This payment was already applied.');return attempt;}
    if(this.store.get(account,'used-payment',proof.id))return settlementFailure('PAYMENT_ALREADY_USED','This historical payment was already applied; inspect settlement status to reconcile its gateway claim.');
    if(proof.accountId!==account||proof.merchant!==this.provider)return settlementFailure('INVALID_PAYMENT_PROOF','The payment is not owned by this account/provider.');
    const attempt:Attempt={attemptId:`settlement_${randomUUID()}`,paymentId:proof.id,reference:proof.reference,amountMinor:proof.amountMinor,state:'PENDING',gatewayConfirmed:false};
    this.store.db.prepare('INSERT INTO provider_settlement_attempts VALUES(?,?,?,?,?)').run(account,proof.id,fp,attempt.state,JSON.stringify(attempt));return attempt;
  });}
  private async confirm(account:string,attempt:Attempt){
    if(attempt.gatewayConfirmed||attempt.state==='PENDING')return;
    try{
      if(!attempt.claimId){const admitted=await this.gateway.call(account,attempt.paymentId,'claim',{attemptId:attempt.attemptId,reference:attempt.reference,amountMinor:attempt.amountMinor});if(!['CLAIMED','APPLIED'].includes(admitted.claim.state))return;attempt.claimId=admitted.claim.claimId;}
      const reply=await this.gateway.call(account,attempt.paymentId,attempt.state==='APPLIED'?'ack':'release',{attemptId:attempt.attemptId,claimId:attempt.claimId,...(attempt.state==='APPLIED'?{receiptDigest:attempt.receiptDigest}:{reason:'NOT_APPLIED'})});
      if(reply.claim.state!==(attempt.state==='APPLIED'?'APPLIED':'RELEASED'))return;
      this.store.transaction(()=>{const current=this.attempt(account,attempt.paymentId);if(current?.state===attempt.state&&current.attemptId===attempt.attemptId){current.claimId=attempt.claimId;current.gatewayConfirmed=true;this.save(account,current);}});
    }catch{/* Preserve the admitted/unknown claim. Current status or an exact retry can safely retry confirmation. */}
  }
  async retryConfirmation(account:string,paymentId:string){const attempt=this.attempt(account,paymentId);if(attempt)await this.confirm(account,attempt);}
  async inspect(actor:Actor,paymentId:string,proof?:any){
    if(!this.store.owns(actor.sub,actor.accountId))return settlementFailure('ACCOUNT_FORBIDDEN','This account does not belong to the owner.',403);
    let attempt=this.attempt(actor.accountId,paymentId);
    if(!attempt&&this.store.get(actor.accountId,'used-payment',paymentId)&&proof?.id===paymentId&&proof.accountId===actor.accountId&&proof.merchant===this.provider){
      attempt=this.store.transaction(()=>{
        const prior=this.attempt(actor.accountId,paymentId);if(prior)return prior;
        const legacy:Attempt={attemptId:`settlement_legacy_${hash([actor.accountId,paymentId]).slice(0,32)}`,paymentId,reference:proof.reference,amountMinor:proof.amountMinor,state:'APPLIED',gatewayConfirmed:false,receiptDigest:hash(['legacy-used-payment',actor.accountId,paymentId])};
        this.store.db.prepare('INSERT INTO provider_settlement_attempts VALUES(?,?,?,?,?)').run(actor.accountId,paymentId,`legacy:${paymentId}`,legacy.state,JSON.stringify(legacy));return legacy;
      });
    }
    if(!attempt)return settlementFailure('SETTLEMENT_NOT_FOUND','No settlement attempt is recorded for this account.',404);
    await this.confirm(actor.accountId,attempt);const current=this.attempt(actor.accountId,paymentId)!;
    return {attemptId:current.attemptId,paymentId,state:current.state,gatewayConfirmed:current.gatewayConfirmed,...(current.response?.data.code?{failureCode:current.response.data.code}:{})};
  }
  async execute(actor:Actor,key:string,fp:string,proof:any,effect:(claimedProof:any)=>ApiResult):Promise<ApiResult>{
    if(!this.store.owns(actor.sub,actor.accountId))return settlementFailure('ACCOUNT_FORBIDDEN','This account does not belong to the owner.',403);
    const cached=this.cached(actor.accountId,key,fp);if(cached){await this.retryConfirmation(actor.accountId,proof.id);return cached;}
    const attempt=this.prepare(actor.accountId,fp,proof);
    if(attempt.state==='RELEASED'){await this.confirm(actor.accountId,attempt);return attempt.response!;}
    const reply=await this.gateway.call(actor.accountId,proof.id,'claim',{attemptId:attempt.attemptId,reference:attempt.reference,amountMinor:attempt.amountMinor});
    if(reply.claim.state!=='CLAIMED'||!reply.charge||reply.charge.id!==proof.id)return settlementFailure('SETTLEMENT_RECONCILIATION_REQUIRED','The gateway no longer admits this settlement; inspect its original attempt.');
    let result:ApiResult;
    try{
      result=this.store.transaction(()=>{
        const previous=this.cached(actor.accountId,key,fp);if(previous)return previous;
        const current=this.attempt(actor.accountId,proof.id)!;
        if(current.state==='RELEASED')return current.response!;
        if(current.state==='APPLIED'||this.store.get(actor.accountId,'used-payment',proof.id))return settlementFailure('PAYMENT_ALREADY_USED','This payment was already applied.');
        const response=effect(reply.charge);
        if(response.status!==200||response.data.success!==true)return settlementFailure('PROVIDER_REJECTED','The provider rejected settlement.');
        this.store.put(actor.accountId,'used-payment',true,proof.id);
        this.store.db.prepare('INSERT INTO idempotency VALUES(?,?,?,?,?)').run(actor.accountId,key,fp,response.status,JSON.stringify(response.data));
        current.state='APPLIED';current.claimId=reply.claim.claimId;current.response=response;current.receiptDigest=hash(response);this.save(actor.accountId,current);return response;
      });
    }catch(error){
      const known=error as {status?:number;code?:string;message?:string};
      if(![400,402,403,404,409].includes(known.status||0)||!known.code)throw error;
      const released=this.store.transaction(()=>{
        const current=this.attempt(actor.accountId,proof.id)!;
        if(current.state==='APPLIED'||this.store.get(actor.accountId,'used-payment',proof.id))return undefined;
        if(current.state==='RELEASED')return current;
        current.state='RELEASED';current.claimId=reply.claim.claimId;current.response={status:known.status!,data:{success:false,code:known.code,error:known.message||'Provider settlement was rejected.'}};return this.save(actor.accountId,current);
      });
      if(!released)throw error;
      await this.confirm(actor.accountId,released);return released.response!;
    }
    await this.retryConfirmation(actor.accountId,proof.id);return result;
  }
}
