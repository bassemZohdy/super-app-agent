/** Legacy provenance is an immutable capture fingerprint, never an approval or delegation grant. */
import { createHash } from 'node:crypto';
export function legacyCaptureDigest(c:{id:string;accountId:string;amountMinor:number;merchant:string;reference:string;source:string;currency:string;createdAt:string;operationId?:unknown}){
  const terms: unknown[] = [c.id,c.accountId,c.amountMinor,c.merchant,c.reference,c.source,c.currency,c.createdAt];
  if (Object.hasOwn(c,'operationId')) {
    if(typeof c.operationId!=='string'||!/^[A-Za-z0-9_.:-]{1,200}$/.test(c.operationId))throw new Error('Invalid capture operation identity.');
    terms.push('operation-id-v3',c.operationId);
  }
  return createHash('sha256').update(JSON.stringify(terms)).digest('hex');
}
export function legacyPaymentState(charge:{status:string;refunded?:boolean},claim?:{state:string}){
  if(charge.refunded)return 'REFUNDED';
  if(charge.status!=='CAPTURED')return charge.status;
  if(claim?.state==='APPLIED')return 'SETTLED';
  if(claim?.state==='RELEASED')return 'RELEASED';
  if(claim?.state==='CLAIMED'||claim?.state==='LEGACY_UNKNOWN')return 'RECONCILIATION_REQUIRED';
  return 'CAPTURED';
}
