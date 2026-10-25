import { paymentObject, minorUnitSchema, paymentMethodSchema, billingAccountSchema } from './payments.ts';
import type { BillerProvider, PaymentMethod, BillingAccount } from './payments.ts';

export const MANDATE_CONTRACT_VERSION = '1.0.0';
export const MANDATE_ACTOR = 'cityside-automation';
export type MandateOperation = 'BILL_PAYMENT'|'WALLET_RELOAD'|'RECHARGE'|'FINE_PAYMENT'|'PARKING_EXTENSION'|'SUBSCRIPTION_RENEWAL';
export type MandateTarget = {kind:'WALLET'} | {kind:'BILLER';billingAccountId:string;expectedVersion:number;provider:BillerProvider;reference:string} |
  {kind:'PARKING';ticketId:string;plateNumber:string;zoneId:string;maximumHours:number;endAt:string};
export type MandateTrigger = {type:'INVOICE_DUE';daysBefore:number} | {type:'CALENDAR';dayOfMonth:number;hour:number;minute:number;monthEnd:'LAST_DAY'|'SKIP'} |
  {type:'LOW_BALANCE';belowMinor:number;reloadMinor:number;targetBalanceMinor:number} | {type:'NEW_FINE'} | {type:'PARKING_ENDING';minutesBefore:number};
export type MandatePolicy = {
  actorClientId:typeof MANDATE_ACTOR;audience:'provider-api';operation:MandateOperation;purpose:string;currency:'AED';target:MandateTarget;
  sources:{methodId:string;expectedVersion:number}[];
  fallback:{mode:'NONE'}|{mode:'ORDERED';on:('INSUFFICIENT_FUNDS'|'CARD_DECLINED')[]};
  trigger:MandateTrigger;timezone:string;startsAt:string;expiresAt:string;
  limits:{perPaymentMinor:number;periodMinor:number;lifetimeMinor:number;period:'DAY'|'MONTH';perPeriodCount:number;lifetimeCount:number;cooldownSeconds:number};
  fineTypes?:string[];
};
export type PaymentMandate = {
  eligibilityEpoch?:string;  id:string;accountId:string;ownerSub:string;version:number;policyVersion:number;
  state:'AWAITING_APPROVAL'|'APPROVED'|'PAUSED'|'REVOKED'|'EXPIRED';executionEnabled:false;skipNext?:boolean;
  policy:MandatePolicy;sourceSnapshots:PaymentMethod[];billerSnapshot?:BillingAccount;
  approvalDigest:string;reviewExpiresAt:string;createdAt:string;updatedAt:string;approvedAt?:string;
};
const id={type:'string',minLength:1,maxLength:160,pattern:'^[A-Za-z0-9][A-Za-z0-9_.:-]*$'};
const version={type:'integer',minimum:1,maximum:1000};
const text={type:'string',minLength:1,maxLength:160,pattern:'^[^\\x00-\\x1f\\x7f]*\\S[^\\x00-\\x1f\\x7f]*$'};
const date={type:'string',pattern:'^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}\\.\\d{3}Z$'};
const integer=(minimum:number,maximum:number)=>({type:'integer',minimum,maximum});
export const mandatePolicySchema=paymentObject({
  actorClientId:{const:MANDATE_ACTOR},audience:{const:'provider-api'},operation:{enum:['BILL_PAYMENT','WALLET_RELOAD','RECHARGE','FINE_PAYMENT','PARKING_EXTENSION','SUBSCRIPTION_RENEWAL']},purpose:text,currency:{const:'AED'},
  target:{oneOf:[paymentObject({kind:{const:'WALLET'}}),paymentObject({kind:{const:'BILLER'},billingAccountId:id,expectedVersion:integer(1,1000000),provider:{enum:['dewa','etisalat','du','rta','police']},reference:text}),
    paymentObject({kind:{const:'PARKING'},ticketId:id,plateNumber:text,zoneId:id,maximumHours:integer(1,24),endAt:date})]},
  sources:{type:'array',minItems:1,maxItems:3,uniqueItems:true,items:paymentObject({methodId:id,expectedVersion:integer(1,1000000)})},
  fallback:{oneOf:[paymentObject({mode:{const:'NONE'}}),paymentObject({mode:{const:'ORDERED'},on:{type:'array',minItems:1,maxItems:2,uniqueItems:true,items:{enum:['INSUFFICIENT_FUNDS','CARD_DECLINED']}}})]},
  trigger:{oneOf:[paymentObject({type:{const:'INVOICE_DUE'},daysBefore:integer(0,14)}),paymentObject({type:{const:'CALENDAR'},dayOfMonth:integer(1,31),hour:integer(0,23),minute:integer(0,59),monthEnd:{enum:['LAST_DAY','SKIP']}}),
    paymentObject({type:{const:'LOW_BALANCE'},belowMinor:minorUnitSchema,reloadMinor:minorUnitSchema,targetBalanceMinor:minorUnitSchema}),paymentObject({type:{const:'NEW_FINE'}}),paymentObject({type:{const:'PARKING_ENDING'},minutesBefore:integer(1,60)})]},
  timezone:{type:'string',minLength:1,maxLength:64},startsAt:date,expiresAt:date,
  limits:paymentObject({perPaymentMinor:minorUnitSchema,periodMinor:minorUnitSchema,lifetimeMinor:minorUnitSchema,period:{enum:['DAY','MONTH']},perPeriodCount:integer(1,100),lifetimeCount:integer(1,1000),cooldownSeconds:integer(60,2678400)}),
  fineTypes:{type:'array',minItems:1,maxItems:10,uniqueItems:true,items:{enum:['Speeding','Parking overstay']}},
},['actorClientId','audience','operation','purpose','currency','target','sources','fallback','trigger','timezone','startsAt','expiresAt','limits']);
export const mandateSchemas={
  create:paymentObject({policy:mandatePolicySchema}),
  pause:paymentObject({expectedVersion:version}),resume:paymentObject({expectedVersion:version}),skipNext:paymentObject({expectedVersion:version}),
  revise:paymentObject({expectedVersion:version,policy:mandatePolicySchema}),
  approve:paymentObject({expectedVersion:version,approvalDigest:{type:'string',pattern:'^[a-f0-9]{64}$'}}),
  revoke:paymentObject({expectedVersion:version}),
  pauseAll:paymentObject({}),
};
export const mandateRecordSchema=paymentObject({eligibilityEpoch:{type:'string',pattern:'^[1-9][0-9]{0,6}:[1-9][0-9]{0,6}$'},id,accountId:id,ownerSub:text,version,policyVersion:version,state:{enum:['AWAITING_APPROVAL','APPROVED','PAUSED','REVOKED','EXPIRED']},executionEnabled:{const:false},policy:mandatePolicySchema,
  sourceSnapshots:{type:'array',minItems:1,maxItems:3,items:paymentMethodSchema},billerSnapshot:billingAccountSchema,approvalDigest:{type:'string',pattern:'^[a-f0-9]{64}$'},reviewExpiresAt:date,createdAt:date,updatedAt:date,approvedAt:date},
  ['id','accountId','ownerSub','version','policyVersion','state','executionEnabled','policy','sourceSnapshots','approvalDigest','reviewExpiresAt','createdAt','updatedAt']);
