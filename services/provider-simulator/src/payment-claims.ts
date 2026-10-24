/** Gateway serialization point for provider settlement versus refunds. Never expires an unknown/applied claim into refundable funds. */
import { existsSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import type { AccountDatabase } from './database.ts';
export const settlementProviders=['rta','dewa','etisalat','du','police'] as const;
export type SettlementProvider=typeof settlementProviders[number];
export type PaymentClaim={claimId:string;paymentId:string;provider:SettlementProvider;attemptId:string;reference:string;amountMinor:number;currency:'AED';orderId:string;captureAttemptId:string;state:'LEGACY_UNKNOWN'|'CLAIMED'|'APPLIED'|'RELEASED';createdAt:string;receiptDigest?:string};
export class SettlementError extends Error{
  readonly status:number;readonly code:string;
  constructor(status:number,code:string,message:string){super(message);this.status=status;this.code=code;}
}
export const settlementFailure=(code:string,message:string,status=409):never=>{throw new SettlementError(status,code,message);};
export function claimantFor(claims:{azp?:string;realm_access?:{roles?:string[]}}):SettlementProvider|undefined{return settlementProviders.find(provider=>claims.azp===`provider-${provider}-settlement`&&claims.realm_access?.roles?.includes(`payment-settlement:${provider}`));}
export class PaymentClaims{
  readonly store:AccountDatabase;private sequence=0;
  constructor(store:AccountDatabase){
    this.store=store;
    const existing=store.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='payment_claim_schema'").get();
    if(existing){if(store.db.prepare('SELECT max(version) version FROM payment_claim_schema').get()?.version!==1)throw new Error('Unsupported payment claim schema.');return;}
    const legacy=store.db.prepare("SELECT account_id,id,body FROM resources WHERE kind='charge' AND json_extract(body,'$.status')='CAPTURED' AND json_extract(body,'$.refunded')=0").all().filter(row=>settlementProviders.includes(JSON.parse(String(row.body)).merchant));
    if(legacy.length&&store.path!==':memory:'&&!existsSync(store.path+'.before-settlement-claims-v1.sqlite'))store.db.prepare('VACUUM INTO ?').run(store.path+'.before-settlement-claims-v1.sqlite');
    this.atomic(()=>{
      store.db.exec(`CREATE TABLE payment_claim_schema(version INTEGER PRIMARY KEY,applied_at TEXT NOT NULL);
        CREATE TABLE payment_settlement_claims(account_id TEXT NOT NULL REFERENCES accounts(id),payment_id TEXT NOT NULL,provider TEXT NOT NULL,
          claim_id TEXT NOT NULL UNIQUE,attempt_id TEXT NOT NULL,state TEXT NOT NULL CHECK(state IN ('LEGACY_UNKNOWN','CLAIMED','APPLIED','RELEASED')),body TEXT NOT NULL,PRIMARY KEY(account_id,payment_id));`);
      for(const row of legacy){const charge=JSON.parse(String(row.body));if(charge.id!==row.id||charge.accountId!==row.account_id)throw new Error('Legacy capture identity is inconsistent; migration refused.');this.insert(String(row.account_id),this.shape(charge,`legacy:${charge.id}`,'LEGACY_UNKNOWN'));}
      store.db.prepare('INSERT INTO payment_claim_schema VALUES(1,?)').run(new Date().toISOString());
    });
  }
  private atomic<T>(fn:()=>T):T{if(!this.store.db.isTransaction)return this.store.transaction(fn);const name=`claim_${++this.sequence}`;this.store.db.exec(`SAVEPOINT ${name}`);try{const r=fn();this.store.db.exec(`RELEASE ${name}`);return r;}catch(e){this.store.db.exec(`ROLLBACK TO ${name}`);this.store.db.exec(`RELEASE ${name}`);throw e;}}
  private shape(charge:any,attemptId:string,state:PaymentClaim['state']):PaymentClaim{return {claimId:`claim_${randomUUID()}`,paymentId:charge.id,provider:charge.merchant,attemptId,reference:charge.reference,amountMinor:charge.amountMinor,currency:'AED',orderId:charge.orderId||`legacy:${charge.id}`,captureAttemptId:charge.attemptId||charge.id,state,createdAt:new Date().toISOString()};}
  private insert(account:string,claim:PaymentClaim){this.store.db.prepare('INSERT INTO payment_settlement_claims VALUES(?,?,?,?,?,?,?)').run(account,claim.paymentId,claim.provider,claim.claimId,claim.attemptId,claim.state,JSON.stringify(claim));return claim;}
  private save(account:string,claim:PaymentClaim){this.store.db.prepare('UPDATE payment_settlement_claims SET attempt_id=?,state=?,body=? WHERE account_id=? AND payment_id=?').run(claim.attemptId,claim.state,JSON.stringify(claim),account,claim.paymentId);return claim;}
  get(account:string,paymentId:string):PaymentClaim|undefined{const row=this.store.db.prepare('SELECT body FROM payment_settlement_claims WHERE account_id=? AND payment_id=?').get(account,paymentId);return row?JSON.parse(String(row.body)):undefined;}
  private charge(account:string,paymentId:string,provider:SettlementProvider){const charge=this.store.get(account,'charge',paymentId);if(!charge)return settlementFailure('PAYMENT_NOT_FOUND','Captured payment not found.',404);if(charge.merchant!==provider)return settlementFailure('CLAIM_PROVIDER_FORBIDDEN','This provider cannot claim another merchant’s payment.',403);return charge;}
  claim(account:string,paymentId:string,provider:SettlementProvider,input:{attemptId:string;reference:string;amountMinor:number}){
    return this.atomic(()=>{
      const charge=this.charge(account,paymentId,provider);
      if(charge.status!=='CAPTURED'||charge.refunded||charge.currency!=='AED')return settlementFailure('PAYMENT_UNAVAILABLE','The payment is not a current unrefunded capture.');
      if(charge.reference!==input.reference||charge.amountMinor!==input.amountMinor)return settlementFailure('CLAIM_TERMS_CHANGED','The claim must match the exact capture terms.');
      const prior=this.get(account,paymentId);
      if(prior){
        if(prior.state==='LEGACY_UNKNOWN'){prior.state='CLAIMED';prior.attemptId=input.attemptId;return {claim:this.save(account,prior),charge};}
        if(prior.attemptId!==input.attemptId||prior.reference!==input.reference||prior.amountMinor!==input.amountMinor)return settlementFailure('CLAIM_CONFLICT','This capture has another settlement attempt.');
        if(prior.state==='RELEASED')return settlementFailure('CLAIM_RELEASED','A released capture cannot be reapplied; reconcile or refund it.');
        return {claim:prior,charge};
      }
      return {claim:this.insert(account,this.shape(charge,input.attemptId,'CLAIMED')),charge};
    });
  }
  private bound(account:string,paymentId:string,provider:SettlementProvider,input:{claimId:string;attemptId:string}){this.charge(account,paymentId,provider);const claim=this.get(account,paymentId);if(!claim||claim.provider!==provider||claim.claimId!==input.claimId||claim.attemptId!==input.attemptId)return settlementFailure('CLAIM_MISMATCH','The claim is not bound to this provider attempt.');return claim;}
  acknowledge(account:string,paymentId:string,provider:SettlementProvider,input:{claimId:string;attemptId:string;receiptDigest:string}){return this.atomic(()=>{const claim=this.bound(account,paymentId,provider,input);if(claim.state==='APPLIED'){if(claim.receiptDigest!==input.receiptDigest)return settlementFailure('RECEIPT_CONFLICT','The applied receipt cannot be changed.');return {claim};}if(claim.state!=='CLAIMED')return settlementFailure('CLAIM_CLOSED','Only an admitted claim can be acknowledged.');claim.state='APPLIED';claim.receiptDigest=input.receiptDigest;return {claim:this.save(account,claim)};});}
  release(account:string,paymentId:string,provider:SettlementProvider,input:{claimId:string;attemptId:string;reason:'NOT_APPLIED'}){return this.atomic(()=>{const claim=this.bound(account,paymentId,provider,input);if(claim.state==='RELEASED')return {claim};if(claim.state!=='CLAIMED'||input.reason!=='NOT_APPLIED')return settlementFailure('CLAIM_NOT_RELEASABLE','An applied or unknown claim cannot be released as non-application.');claim.state='RELEASED';return {claim:this.save(account,claim)};});}
  assertRefundable(account:string,paymentId:string){const claim=this.get(account,paymentId);if(claim&&claim.state!=='RELEASED')settlementFailure(claim.state==='LEGACY_UNKNOWN'?'SETTLEMENT_STATUS_UNKNOWN':'SETTLEMENT_IN_USE','Settlement is pending, applied or unknown. Refund requires verified non-application or a supported provider reversal.');}
}
