import { obligationSchema,captureAttemptSchema,type ObligationView,type CaptureAttemptView } from './payment-obligations.ts';
import { paymentObject } from './payments.ts';
export type AccountEligibility={accountId:string;ownerSub:string;ownerEnabled:boolean;membershipEnabled:boolean;ownerVersion:number;membershipVersion:number;epoch:string;active:boolean};
export type EligibilityChange={kind:'OWNER'|'MEMBERSHIP';expectedVersion:number;enabled:boolean;reason:string};
export type PaymentLifecycle={obligations?:ObligationView[];attempts?:CaptureAttemptView[];eligibility:AccountEligibility;orders:{id:string;state:string;fundsCaptured:boolean;paymentId?:string;sourceId:string;blockedReasons:string[];action:'PRESERVE_ORIGINAL_CAPTURE'|'CANCEL_OR_REVIEW_AGAIN'}[];funding:{id:string;state:string;fundsCaptured:boolean;sourceId:string;blockedReasons:string[]}[];mandates:{id:string;policyVersion:number;state:string;executionEnabled:false;eligibilityCurrent:boolean;blockedReasons:string[]}[]};
const id={type:'string',minLength:1,maxLength:160,pattern:'^[A-Za-z0-9][A-Za-z0-9_.:-]*$'},version={type:'integer',minimum:1,maximum:1000000};
export const eligibilitySchema=paymentObject({accountId:id,ownerSub:id,ownerEnabled:{type:'boolean'},membershipEnabled:{type:'boolean'},ownerVersion:version,membershipVersion:version,epoch:{type:'string',pattern:'^[1-9][0-9]{0,6}:[1-9][0-9]{0,6}$'},active:{type:'boolean'}});
export const eligibilityChangeSchema=paymentObject({kind:{enum:['OWNER','MEMBERSHIP']},expectedVersion:version,enabled:{type:'boolean'},reason:{type:'string',minLength:5,maxLength:160,pattern:'^[^\\r\\n]+$'}});
const text={type:'string',minLength:1,maxLength:200},reasons={type:'array',maxItems:12,items:text};
export const lifecycleSchema={obligations:{type:'array',maxItems:2100,items:obligationSchema},attempts:{type:'array',maxItems:100,items:captureAttemptSchema},eligibility:eligibilitySchema,
  orders:{type:'array',items:paymentObject({id:text,state:text,fundsCaptured:{type:'boolean'},paymentId:text,sourceId:text,blockedReasons:reasons,action:{enum:['PRESERVE_ORIGINAL_CAPTURE','CANCEL_OR_REVIEW_AGAIN']}},['id','state','fundsCaptured','sourceId','blockedReasons','action'])},
  funding:{type:'array',items:paymentObject({id:text,state:text,fundsCaptured:{type:'boolean'},sourceId:text,blockedReasons:reasons})},
  mandates:{type:'array',items:paymentObject({id:text,policyVersion:version,state:text,executionEnabled:{const:false},eligibilityCurrent:{type:'boolean'},blockedReasons:reasons})}};
