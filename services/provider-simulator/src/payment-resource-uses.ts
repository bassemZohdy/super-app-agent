/** Server-internal dependency registry. A dependency is a lifecycle lock, never payment authority. */
import type { AccountDatabase } from './database.ts';
import type { PaymentDependency, PaymentMethod, BillingAccount } from '../../../packages/protocol-core/src/payments.ts';
export class PaymentResourceError extends Error {
  readonly status:number;readonly code:string;
  constructor(status:number,code:string,message:string){super(message);this.status=status;this.code=code;}
}
const fail=(status:number,code:string,message:string):never=>{throw new PaymentResourceError(status,code,message);};
type Binding=Omit<PaymentDependency,'status'> & {resourceVersion:number};
export class PaymentResourceUses {
  readonly store:AccountDatabase;
  private sequence=0;
  constructor(store:AccountDatabase){
    this.store=store;
    this.atomic(()=>store.db.exec(`CREATE TABLE IF NOT EXISTS payment_resource_uses(
      account_id TEXT NOT NULL REFERENCES accounts(id),resource_type TEXT NOT NULL CHECK(resource_type IN ('METHOD','BILLER')),resource_id TEXT NOT NULL,
      resource_version INTEGER NOT NULL CHECK(resource_version BETWEEN 1 AND 1000000),dependent_kind TEXT NOT NULL CHECK(dependent_kind IN ('ORDER','HOLD','MANDATE')),
      dependent_id TEXT NOT NULL,status TEXT NOT NULL CHECK(status IN ('ACTIVE','RELEASED')),created_at TEXT NOT NULL,released_at TEXT,
      PRIMARY KEY(account_id,resource_type,resource_id,dependent_kind,dependent_id));
      CREATE INDEX IF NOT EXISTS payment_uses_active ON payment_resource_uses(account_id,status,resource_type,resource_id);`));
  }
  private atomic<T>(fn:()=>T):T{
    if(!this.store.db.isTransaction)return this.store.transaction(fn);
    const name=`payment_uses_${++this.sequence}`;this.store.db.exec(`SAVEPOINT ${name}`);
    try{const r=fn();this.store.db.exec(`RELEASE ${name}`);return r;}catch(e){this.store.db.exec(`ROLLBACK TO ${name}`);this.store.db.exec(`RELEASE ${name}`);throw e;}
  }
  list(accountId:string,type?:'METHOD'|'BILLER',resourceId?:string):PaymentDependency[]{
    return this.store.db.prepare(`SELECT resource_type,resource_id,dependent_kind,dependent_id,status FROM payment_resource_uses WHERE account_id=? AND status='ACTIVE' AND (? IS NULL OR resource_type=?) AND (? IS NULL OR resource_id=?) ORDER BY created_at,dependent_id`).all(accountId,type||null,type||null,resourceId||null,resourceId||null).map(r=>({resourceType:String(r.resource_type) as 'METHOD'|'BILLER',resourceId:String(r.resource_id),dependentKind:String(r.dependent_kind) as 'ORDER'|'HOLD'|'MANDATE',dependentId:String(r.dependent_id),status:'ACTIVE'}));
  }
  assertRemovable(accountId:string,type:'METHOD'|'BILLER',id:string){
    if(this.store.db.prepare("SELECT dependent_id FROM payment_resource_uses WHERE account_id=? AND resource_type=? AND resource_id=? AND status='ACTIVE' LIMIT 1").get(accountId,type,id))fail(409,'RESOURCE_IN_USE','This resource has active payment or automation references. Review its related items first.');
  }
  bind(accountId:string,input:Binding){
    return this.atomic(()=>{
      if(!['METHOD','BILLER'].includes(input.resourceType)||!['ORDER','HOLD','MANDATE'].includes(input.dependentKind)||!Number.isSafeInteger(input.resourceVersion)||input.resourceVersion<1||input.resourceVersion>1000000||![input.resourceId,input.dependentId].every(v=>typeof v==='string'&&/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,159}$/.test(v)))fail(400,'INVALID_RESOURCE_USE','A bounded server-verified resource reference is required.');
      const resource=input.resourceType==='METHOD'&&input.resourceId==='wallet'?{status:'ACTIVE',version:1}:this.store.get<PaymentMethod|BillingAccount>(accountId,input.resourceType==='METHOD'?'payment-method':'billing-account',input.resourceId);
      if(!resource)return fail(404,'RESOURCE_NOT_FOUND','Resource not found for this account.');
      if(resource.status!=='ACTIVE'||resource.version!==input.resourceVersion)fail(409,'RESOURCE_CHANGED','The resource is unavailable or changed.');
      const prior=this.store.db.prepare('SELECT status,resource_version FROM payment_resource_uses WHERE account_id=? AND resource_type=? AND resource_id=? AND dependent_kind=? AND dependent_id=?').get(accountId,input.resourceType,input.resourceId,input.dependentKind,input.dependentId);
      if(prior){if(prior.status!=='ACTIVE'||prior.resource_version!==input.resourceVersion)fail(409,'RESOURCE_USE_CLOSED','This use reference cannot be reopened or rebound.');return;}
      const count=this.store.db.prepare("SELECT count(*) n FROM payment_resource_uses WHERE account_id=? AND status='ACTIVE'").get(accountId) as {n:number};if(count.n>=200)fail(409,'RESOURCE_USE_LIMIT','Finish or reconcile active items before adding more.');
      this.store.db.prepare('INSERT INTO payment_resource_uses VALUES(?,?,?,?,?,?,?,?,NULL)').run(accountId,input.resourceType,input.resourceId,input.resourceVersion,input.dependentKind,input.dependentId,'ACTIVE',new Date().toISOString());
    });
  }
  release(accountId:string,type:'METHOD'|'BILLER',resourceId:string,kind:'ORDER'|'HOLD'|'MANDATE',dependentId:string){
    return this.atomic(()=>{
      const row=this.store.db.prepare('SELECT status FROM payment_resource_uses WHERE account_id=? AND resource_type=? AND resource_id=? AND dependent_kind=? AND dependent_id=?').get(accountId,type,resourceId,kind,dependentId);
      if(!row)fail(404,'RESOURCE_USE_NOT_FOUND','This use reference was not found for the account.');
      this.store.db.prepare("UPDATE payment_resource_uses SET status='RELEASED',released_at=? WHERE account_id=? AND resource_type=? AND resource_id=? AND dependent_kind=? AND dependent_id=? AND status='ACTIVE'").run(new Date().toISOString(),accountId,type,resourceId,kind,dependentId);
    });
  }
}
