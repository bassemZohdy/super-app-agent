import { existsSync } from 'node:fs';
/** Local finite issuer. Only trusted order code admits authorizations; there is no free-standing HTTP authorization API. */
import { createHash, randomUUID } from 'node:crypto';
import type { AccountDatabase } from './database.ts';
import { cardPresets, MAX_PAYMENT_MINOR, type PaymentMethod, type CardBalance, type CardAuthorization } from '../../../packages/protocol-core/src/payments.ts';
export type IssuerBinding={accountId:string;ownerSub:string;orderId:string;sourceId:string;sourceVersion:number;amountMinor:number;approvalDigest:string;expiresAt:number};
export class IssuerError extends Error {
  readonly status:number;readonly code:string;
  constructor(status:number,code:string,message:string){super(message);this.status=status;this.code=code;}
}
const deny=(code:string,message:string):never=>{throw new IssuerError(409,code,message);};
const fingerprint=(b:IssuerBinding)=>createHash('sha256').update(JSON.stringify([b.accountId,b.ownerSub,b.orderId,b.sourceId,b.sourceVersion,b.amountMinor,b.approvalDigest,b.expiresAt])).digest('hex');
export class PaymentIssuer {
  readonly store:AccountDatabase;readonly clock:()=>number;private sequence=0;
  constructor(store:AccountDatabase,clock=Date.now){
    this.store=store;this.clock=clock;
    const old=store.db.prepare("SELECT sql FROM sqlite_master WHERE name='payment_card_authorizations'").get(),migrate=!!old&&!String(old.sql).includes("'PENDING'");
    if(migrate&&store.path!==':memory:'&&!existsSync(store.path+'.before-issuer-pending-v2.sqlite'))store.db.prepare('VACUUM INTO ?').run(store.path+'.before-issuer-pending-v2.sqlite');

    this.atomic(()=>{if(migrate)store.db.exec('ALTER TABLE payment_card_authorizations RENAME TO payment_card_authorizations_v1;DROP INDEX IF EXISTS issuer_source;');store.db.exec(`CREATE TABLE IF NOT EXISTS payment_card_authorizations(
      id TEXT PRIMARY KEY,account_id TEXT NOT NULL REFERENCES accounts(id),order_id TEXT NOT NULL,source_id TEXT NOT NULL,
      amount_minor INTEGER NOT NULL CHECK(typeof(amount_minor)='integer' AND amount_minor BETWEEN 1 AND 100000000),
      state TEXT NOT NULL CHECK(state IN ('PENDING','REQUIRES_ACTION','AUTHORIZED','DECLINED','EXPIRED','VOIDED','CAPTURED')),expires_at INTEGER NOT NULL,
      binding_digest TEXT NOT NULL,body TEXT NOT NULL,UNIQUE(account_id,order_id));
      CREATE TABLE IF NOT EXISTS payment_card_refunds(id TEXT PRIMARY KEY,account_id TEXT NOT NULL REFERENCES accounts(id),order_id TEXT NOT NULL,source_id TEXT NOT NULL,amount_minor INTEGER NOT NULL CHECK(typeof(amount_minor)='integer' AND amount_minor BETWEEN 1 AND 100000000));
      CREATE INDEX IF NOT EXISTS issuer_source ON payment_card_authorizations(account_id,source_id,state);`);if(migrate)store.db.exec('INSERT INTO payment_card_authorizations SELECT * FROM payment_card_authorizations_v1;DROP TABLE payment_card_authorizations_v1;');});
  }
  private atomic<T>(fn:()=>T):T{
    if(!this.store.db.isTransaction)return this.store.transaction(fn);
    const name=`issuer_${++this.sequence}`;this.store.db.exec(`SAVEPOINT ${name}`);
    try{const r=fn();this.store.db.exec(`RELEASE ${name}`);return r;}catch(e){this.store.db.exec(`ROLLBACK TO ${name}`);this.store.db.exec(`RELEASE ${name}`);throw e;}
  }
  private save(auth:CardAuthorization){this.store.db.prepare('UPDATE payment_card_authorizations SET state=?,body=? WHERE id=?').run(auth.state,JSON.stringify(auth),auth.id);return auth;}
  private expire(account:string){
    const rows=this.store.db.prepare("SELECT body FROM payment_card_authorizations WHERE account_id=? AND state IN ('PENDING','REQUIRES_ACTION','AUTHORIZED') AND expires_at<=?").all(account,this.clock());
    for(const row of rows){const auth=JSON.parse(String(row.body)) as CardAuthorization;auth.state='EXPIRED';auth.failureCode='AUTHORIZATION_EXPIRED';this.save(auth);}
  }
  summary(account:string,sourceId:string):CardBalance{
    return this.atomic(()=>{
      this.expire(account);
      const method=this.store.get<PaymentMethod>(account,'payment-method',sourceId);
      if(!method||method.kind!=='card')return deny('METHOD_NOT_FOUND','Card not found for this account.');
      const preset=cardPresets.find(p=>p.id===method.preset);if(!preset)return deny('METHOD_UNAVAILABLE','Unknown synthetic issuer preset.');
      const row=this.store.db.prepare("SELECT coalesce(sum(CASE WHEN state IN ('PENDING','REQUIRES_ACTION','AUTHORIZED') THEN amount_minor ELSE 0 END),0) held,coalesce(sum(CASE WHEN state='CAPTURED' THEN amount_minor ELSE 0 END),0) spent FROM payment_card_authorizations WHERE account_id=? AND source_id=?").get(account,sourceId) as {held:number;spent:number};
      const refunded=Number(this.store.db.prepare('SELECT coalesce(sum(amount_minor),0) n FROM payment_card_refunds WHERE account_id=? AND source_id=?').get(account,sourceId)!.n);
      if(refunded>row.spent)return deny('ISSUER_INCONSISTENT','Card refunds exceed captured value.');row.spent-=refunded;
      const limitMinor=this.store.issuerScenarios?.limit(account,sourceId,preset.limitMinor)??preset.limitMinor;
      if(row.held+row.spent>limitMinor)return deny('ISSUER_INCONSISTENT','The issuer limit needs reconciliation.');
      return {sourceId,refundedMinor:refunded,limitMinor,heldMinor:row.held,spentMinor:row.spent,availableMinor:limitMinor-row.held-row.spent,currency:'AED'};
    });
  }
  private card(binding:IssuerBinding){
    if(!this.store.owns(binding.ownerSub,binding.accountId))return deny('OWNER_CHANGED','This order does not belong to the owner.');
    const method=this.store.get<PaymentMethod>(binding.accountId,'payment-method',binding.sourceId),at=new Date(this.clock());
    if(!method||method.kind!=='card'||method.version!==binding.sourceVersion||method.status!=='ACTIVE')return deny('METHOD_UNAVAILABLE','This card is unavailable or changed.');
    if(!method.expiresYear||!method.expiresMonth||method.expiresYear<at.getUTCFullYear()||method.expiresYear===at.getUTCFullYear()&&method.expiresMonth<at.getUTCMonth()+1)return deny('METHOD_EXPIRED','This card is expired.');
    return method;
  }
  authorize(binding:IssuerBinding):CardAuthorization{
    return this.atomic(()=>{
      if(!Number.isSafeInteger(binding.amountMinor)||binding.amountMinor<1||binding.amountMinor>MAX_PAYMENT_MINOR||!Number.isSafeInteger(binding.expiresAt)||binding.expiresAt<=this.clock()||binding.expiresAt>this.clock()+300000||!/^[a-f0-9]{64}$/.test(binding.approvalDigest))return deny('INVALID_AUTHORIZATION','A bounded, current order authorization is required.');
      this.expire(binding.accountId);
      const prior=this.store.db.prepare('SELECT body,binding_digest FROM payment_card_authorizations WHERE account_id=? AND order_id=?').get(binding.accountId,binding.orderId);
      if(prior){if(prior.binding_digest!==fingerprint(binding))return deny('AUTHORIZATION_CONFLICT','This order already has a different issuer authorization.');return JSON.parse(String(prior.body));}
      const method=this.card(binding),balance=this.summary(binding.accountId,binding.sourceId);
      const count=this.store.db.prepare('SELECT count(*) n FROM payment_card_authorizations WHERE account_id=?').get(binding.accountId) as {n:number};if(count.n>=500)return deny('ISSUER_HISTORY_LIMIT','The local issuer history limit was reached.');
      const scenario=this.store.issuerScenarios?.decision(binding.accountId,binding.sourceId),behavior=scenario?.preset||method.preset;
      if(this.store.issuerScenarios&&!scenario)return deny('SCENARIO_NOT_CONFIGURED','The run operator must configure this source before authorization.');
      const declined=behavior==='declined'||balance.availableMinor<binding.amountMinor;
      const auth:CardAuthorization={id:`auth_${randomUUID()}`,orderId:binding.orderId,sourceId:binding.sourceId,amountMinor:binding.amountMinor,currency:'AED',state:declined?'DECLINED':behavior==='pending'?'PENDING':behavior==='challenge'?'REQUIRES_ACTION':'AUTHORIZED',expiresAt:new Date(binding.expiresAt).toISOString(),
        ...(scenario?{scenario}:{}),...(declined?{failureCode:behavior==='declined'?'CARD_DECLINED':'CARD_LIMIT_EXCEEDED'}:behavior==='challenge'?{challengeId:`challenge_${randomUUID()}`}:{})};
      this.store.db.prepare('INSERT INTO payment_card_authorizations VALUES(?,?,?,?,?,?,?,?,?)').run(auth.id,binding.accountId,binding.orderId,binding.sourceId,binding.amountMinor,auth.state,binding.expiresAt,fingerprint(binding),JSON.stringify(auth));return auth;
    });
  }
  private bound(binding:IssuerBinding){
    this.expire(binding.accountId);
    const row=this.store.db.prepare('SELECT body,binding_digest FROM payment_card_authorizations WHERE account_id=? AND order_id=?').get(binding.accountId,binding.orderId);
    if(!row||row.binding_digest!==fingerprint(binding))return deny('AUTHORIZATION_CONFLICT','This authorization is not bound to the exact order.');
    if(!this.store.owns(binding.ownerSub,binding.accountId))return deny('OWNER_CHANGED','This order does not belong to the owner.');
    return JSON.parse(String(row.body)) as CardAuthorization;
  }
  get(binding:IssuerBinding){return this.atomic(()=>this.bound(binding));}
  challenge(binding:IssuerBinding,challengeId:string,decision:'APPROVE'|'REJECT',interactive:boolean):CardAuthorization{
    return this.atomic(()=>{
      if(!interactive)return deny('INTERACTIVE_CHALLENGE_REQUIRED','An unattended actor cannot answer a human challenge.');
      const auth=this.bound(binding);
      if(auth.challengeId!==challengeId)return deny('CHALLENGE_MISMATCH','The challenge does not belong to this order.');
      if(auth.state!=='REQUIRES_ACTION')return deny('CHALLENGE_USED','The challenge is closed or expired.');
      this.card(binding);
      if(!['APPROVE','REJECT'].includes(decision))return deny('INVALID_CHALLENGE','Choose an explicit demo challenge decision.');
      auth.state=decision==='APPROVE'?'AUTHORIZED':'DECLINED';if(decision==='REJECT')auth.failureCode='CHALLENGE_REJECTED';return this.save(auth);
    });
  }
  void(binding:IssuerBinding){return this.atomic(()=>{const auth=this.bound(binding);if(auth.state==='CAPTURED')return deny('ALREADY_CAPTURED','Captured funds require the refund workflow.');if(['PENDING','REQUIRES_ACTION','AUTHORIZED'].includes(auth.state)){auth.state='VOIDED';this.save(auth);}return auth;});}
  resolvePending(operator:string,account:string,orderId:string,decision:'APPROVE'|'DECLINE',requestKey:string) {return this.atomic(()=>{
    const scenarios=this.store.issuerScenarios;if(!scenarios)return deny('SCENARIO_DISABLED','Issuer run controls are not installed.');scenarios.operator(operator);
    if(!/^[A-Za-z0-9_-]{8,100}$/.test(requestKey))return deny('INVALID_REQUEST_KEY','Use a bounded operator request key.');
    const fingerprint=createHash('sha256').update(JSON.stringify(['pending',account,orderId,decision])).digest('hex'),previous=this.store.db.prepare('SELECT fingerprint,body FROM issuer_scenario_requests WHERE key=?').get(requestKey);
    if(previous){if(previous.fingerprint!==fingerprint)return deny('SCENARIO_REQUEST_CONFLICT','This key already has different operator terms.');return JSON.parse(String(previous.body)) as CardAuthorization;}
    const row=this.store.db.prepare('SELECT body FROM payment_card_authorizations WHERE account_id=? AND order_id=?').get(account,orderId);if(!row)return deny('AUTHORIZATION_NOT_FOUND','Pending authorization not found in this run.');
    const auth=JSON.parse(String(row.body)) as CardAuthorization;
    if(auth.state!=='PENDING'||!auth.scenario||auth.scenario.runId!==scenarios.context.runId||Date.parse(auth.expiresAt)<=this.clock())return deny('PENDING_DECISION_CLOSED','This issuer decision is closed or expired.');
    if(!['APPROVE','DECLINE'].includes(decision))return deny('INVALID_PENDING_DECISION','Resolve only a pending issuer decision.');
    const originalRow=this.store.db.prepare('SELECT body FROM payment_authorization_orders WHERE account_id=? AND id=? UNION ALL SELECT body FROM wallet_funding_orders WHERE account_id=? AND id=?').get(account,orderId,account,orderId);
    const original=originalRow?JSON.parse(String(originalRow.body)):undefined;
    if(!original||original.state!=='AUTHORIZATION_PENDING'||original.authorization?.id!==auth.id)return deny('PENDING_DECISION_CLOSED','The original owner-approved pending review is required.');
    const binding:IssuerBinding={accountId:account,ownerSub:original.ownerSub,orderId,sourceId:auth.sourceId,sourceVersion:original.quote.source.version,amountMinor:auth.amountMinor,approvalDigest:original.approvalDigest,expiresAt:Date.parse(auth.expiresAt)};
    if(this.bound(binding).state!=='PENDING')return deny('PENDING_DECISION_CLOSED','The exact pending authorization is no longer current.');this.card(binding);
    auth.state=decision==='APPROVE'?'AUTHORIZED':'DECLINED';if(decision==='DECLINE')auth.failureCode='CARD_DECLINED';this.save(auth);
    this.store.db.prepare('INSERT INTO issuer_scenario_audit(body) VALUES(?)').run(JSON.stringify({operatorSub:operator,runId:scenarios.context.runId,accountId:account,orderId,decision,at:new Date(this.clock()).toISOString()}));this.store.db.prepare('INSERT INTO issuer_scenario_requests VALUES(?,?,?)').run(requestKey,fingerprint,JSON.stringify(auth));return auth;
  });}
  /** Refund the original captured source, including a subsequently disabled/removed card. No new authorization is granted. */
  refund(account:string,owner:string,orderId:string,sourceId:string,amountMinor:number,refundId:string){return this.atomic(()=>{
    if(!this.store.owns(owner,account))return deny('OWNER_CHANGED','Refund owner mismatch.');
    if(!Number.isSafeInteger(amountMinor)||amountMinor<1||amountMinor>MAX_PAYMENT_MINOR)return deny('INVALID_REFUND_AMOUNT','Refund must use bounded integer fils.');
    const prior=this.store.db.prepare('SELECT * FROM payment_card_refunds WHERE id=?').get(refundId);
    if(prior){if(prior.account_id!==account||prior.order_id!==orderId||prior.source_id!==sourceId||prior.amount_minor!==amountMinor)return deny('REFUND_CONFLICT','This refund has different source or amount terms.');return;}
    const auth=this.store.db.prepare('SELECT state,source_id,amount_minor,body FROM payment_card_authorizations WHERE account_id=? AND order_id=?').get(account,orderId);
    if(!auth||auth.state!=='CAPTURED'||auth.source_id!==sourceId)return deny('CAPTURE_NOT_FOUND','The original captured card authorization is required.');
    if(JSON.parse(String(auth.body)).scenario?.preset==='refund-failure')return deny('ISSUER_REFUND_DECLINED','The configured synthetic issuer refused this original-source return. Reconcile the refund.');
    const refunded=Number(this.store.db.prepare('SELECT coalesce(sum(amount_minor),0) n FROM payment_card_refunds WHERE account_id=? AND order_id=?').get(account,orderId)!.n);
    if(refunded+amountMinor>Number(auth.amount_minor))return deny('REFUND_LIMIT','Refunds cannot exceed the original card capture.');
    this.store.db.prepare('INSERT INTO payment_card_refunds VALUES(?,?,?,?,?)').run(refundId,account,orderId,sourceId,amountMinor);
  });}
  /** Trusted capture seam for PAY-09; no public route is enabled before settlement claim admission exists. */
  capture(binding:IssuerBinding){return this.atomic(()=>{const auth=this.bound(binding);if(auth.state==='CAPTURED')return auth;if(auth.state!=='AUTHORIZED')return deny('AUTHORIZATION_UNAVAILABLE','A current authorized hold is required.');this.card(binding);auth.state='CAPTURED';return this.save(auth);});}
}
