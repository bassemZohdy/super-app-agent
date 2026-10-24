import { paymentObject } from './payments.ts';
export type RecoveryKind='PAYMENT'|'FUNDING'|'REFUND'|'LEGACY';
export type RecoveryAction='RECOVER_ORIGINAL'|'REQUEST_REFUND_REVIEW'|'REFUND_UNAPPLIED_LEGACY';
export type RecoveryCase={kind:RecoveryKind;operationId:string;state:string;amountMinor:number;sourceLabel:string;provider:string};
export type RecoveryInspection=RecoveryCase&{id:string;ownerSub:string;accountId:string;createdAt:string;expiresAt:string;decisionDigest:string;termsDigest:string;localDigest:string;sourceDigest:string;
  classification:'BEFORE_CAPTURE'|'CAPTURE_COMMITTED'|'PROVIDER_APPLIED'|'RETURN_PENDING'|'CONFIRMED'|'NOT_APPLIED'|'REVIEW_REQUIRED'|'BLOCKED'|'INCONSISTENT';
  captureState:'COMMITTED'|'NOT_CAPTURED'|'INCONSISTENT';sourceState:string;reason:string;actions:RecoveryAction[];
  status:'OPEN'|'RUNNING'|'COMPLETED'|'UNKNOWN';action?:RecoveryAction;lease?:string;leaseUntil?:number;attempts:number;resultId?:string;resultKind?:RecoveryKind;resultState?:string};
export type RecoveryAudit={id:string;kind:RecoveryKind;operationId:string;ownerSub:string;at:string;phase:string;inspectionId?:string;state?:string;code?:string;paymentId?:string;resultId?:string};
const id={type:'string',minLength:1,maxLength:160,pattern:'^[A-Za-z0-9][A-Za-z0-9_.:-]*$'};
export const recoverySchemas={
  inspect:paymentObject({kind:{enum:['PAYMENT','FUNDING','REFUND','LEGACY']},operationId:id}),
  act:paymentObject({decisionDigest:{type:'string',pattern:'^[a-f0-9]{64}$'},action:{enum:['RECOVER_ORIGINAL','REQUEST_REFUND_REVIEW','REFUND_UNAPPLIED_LEGACY']}}),
};
export const recoveryInspectionIdSchema=id;

const text={type:'string',minLength:1,maxLength:400};
const digest={type:'string',pattern:'^[a-f0-9]{64}$'};
export const recoveryCaseSchema=paymentObject({kind:{enum:['PAYMENT','FUNDING','REFUND','LEGACY']},operationId:id,state:text,amountMinor:{type:'integer',minimum:1,maximum:100000000},sourceLabel:text,provider:text});
export const recoveryInspectionSchema=paymentObject({...recoveryCaseSchema.properties,id,ownerSub:text,accountId:id,createdAt:text,expiresAt:text,decisionDigest:digest,termsDigest:digest,localDigest:digest,sourceDigest:digest,
  classification:{enum:['BEFORE_CAPTURE','CAPTURE_COMMITTED','PROVIDER_APPLIED','RETURN_PENDING','CONFIRMED','NOT_APPLIED','REVIEW_REQUIRED','BLOCKED','INCONSISTENT']},captureState:{enum:['COMMITTED','NOT_CAPTURED','INCONSISTENT']},sourceState:text,reason:text,
  actions:{type:'array',maxItems:3,uniqueItems:true,items:{enum:['RECOVER_ORIGINAL','REQUEST_REFUND_REVIEW','REFUND_UNAPPLIED_LEGACY']}},status:{enum:['OPEN','RUNNING','COMPLETED','UNKNOWN']},action:{enum:['RECOVER_ORIGINAL','REQUEST_REFUND_REVIEW','REFUND_UNAPPLIED_LEGACY']},
  lease:id,leaseUntil:{type:'integer',minimum:0},attempts:{type:'integer',minimum:0,maximum:20},resultId:id,resultKind:{enum:['PAYMENT','FUNDING','REFUND','LEGACY']},resultState:text},
  [...recoveryCaseSchema.required,'id','ownerSub','accountId','createdAt','expiresAt','decisionDigest','termsDigest','localDigest','sourceDigest','classification','captureState','sourceState','reason','actions','status','attempts']);
export const recoveryAuditSchema=paymentObject({id,kind:{enum:['PAYMENT','FUNDING','REFUND','LEGACY']},operationId:id,ownerSub:text,at:text,phase:text,inspectionId:id,state:text,code:text,paymentId:id,resultId:id},['id','kind','operationId','ownerSub','at','phase']);
