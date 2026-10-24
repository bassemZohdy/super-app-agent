/** Legacy provenance is an immutable capture fingerprint, never an approval or delegation grant. */
import { createHash } from 'node:crypto';
export function legacyCaptureDigest(c:{id:string;accountId:string;amountMinor:number;merchant:string;reference:string;source:string;currency:string;createdAt:string}){
  return createHash('sha256').update(JSON.stringify([c.id,c.accountId,c.amountMinor,c.merchant,c.reference,c.source,c.currency,c.createdAt])).digest('hex');
}
export function legacyPaymentState(charge:{status:string;refunded?:boolean},claim?:{state:string}){
  if(charge.refunded)return 'REFUNDED';
  if(charge.status!=='CAPTURED')return charge.status;
  if(claim?.state==='APPLIED')return 'SETTLED';
  if(claim?.state==='RELEASED')return 'RELEASED';
  if(claim?.state==='CLAIMED'||claim?.state==='LEGACY_UNKNOWN')return 'RECONCILIATION_REQUIRED';
  return 'CAPTURED';
}
