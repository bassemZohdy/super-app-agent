import type { PaymentEventStatus } from './payment-events.ts';
/** Payment contract v1. Additive, synthetic-account APIs; previews never authorize execution. */
export const PAYMENT_CONTRACT_VERSION = '1.11.0';
export const MAX_PAYMENT_MINOR = 100_000_000;
export const WALLET_FUNDING_LIMITS = { minMinor: 100, maxMinor: 50000, balanceMaxMinor: 1000000, feeMinor: 0 } as const;
export const cardPresets = [
  { id: 'approved', name: 'Everyday demo card', last4: '4242', behavior: 'APPROVE', limitMinor:200000 },
  { id: 'declined', name: 'Declined demo card', last4: '0002', behavior: 'DECLINE', limitMinor:200000 },
  { id: 'challenge', name: 'Challenge demo card', last4: '3155', behavior: 'CHALLENGE', limitMinor:200000 },
  { id: 'expired', name: 'Expired demo card', last4: '0069', behavior: 'EXPIRED', limitMinor:200000 },
  { id: 'limited', name: 'Limited demo card', last4: '1000', behavior: 'APPROVE', limitMinor:10000 },
] as const;
export type CardPreset = typeof cardPresets[number]['id'];
export type BillerProvider = 'dewa' | 'etisalat' | 'du' | 'rta' | 'police';
export type RechargeProvider='rta'|'etisalat'|'du';
export type RechargeTarget={provider:RechargeProvider;reference:string;label:string;kind:'TOLL'|'PREPAID';status:string;version:number;balanceMinor:number;currency:'AED';denominationsMinor:number[]};
export type PaymentReceipt={receiptNumber:string;obligationId:string;amountMinor:number;currency:'AED';targetReference?:string;providerBalanceMinor?:number};
export type PaymentMethod = {
  id: string; accountId: string; kind: 'wallet' | 'card'; nickname: string; version: number;
  status: 'ACTIVE' | 'DISABLED' | 'EXPIRED' | 'REMOVED'; currency: 'AED';
  preset?: CardPreset; last4?: string; expiresMonth?: number; expiresYear?: number; createdAt?: string;
};
export type BillingAccount = { id: string; accountId: string; provider: BillerProvider; reference: string; nickname: string; status: 'ACTIVE' | 'ARCHIVED'; version: number; createdAt: string };
export type BillerCandidate = { provider: BillerProvider; reference: string; label: string; balanceMinor?: number };
export type Payable = { id: string; provider: BillerProvider; reference: string; label: string; amountMinor: number; currency: 'AED'; revision: string; status: 'UNPAID' | 'PAID' | 'CANCELLED' | 'EXPIRED'; dueDate?: string;
  obligationId?: string; kind?: 'BILL'|'FINE'|'FINE_SET'|'RECHARGE'; recharge?:{kind:'TOLL'|'PREPAID';targetVersion:number;balanceBeforeMinor:number};items?:Payable[]; version?:number; dueState?:'CURRENT'|'DUE'|'OVERDUE'|'EXPIRED'|'CLOSED'; originalAmountMinor?:number; discountMinor?:number; discountEligible?:boolean; discountExpiresAt?:string; expiresAt?:string; period?:string; openingFixture?:boolean; paymentRestricted?:boolean };
export type PaymentPreview = {
  contractVersion: typeof PAYMENT_CONTRACT_VERSION; previewOnly: true; accountId: string; id: string;
  payable: Payable; billingAccount: BillingAccount; source: PaymentMethod; amountMinor: number; feeMinor: number;
  totalMinor: number; currency: 'AED'; createdAt: string; expiresAt: string; digest: string;
};
export type CardBalance={refundedMinor?:number;sourceId:string;limitMinor:number;heldMinor:number;spentMinor:number;availableMinor:number;currency:'AED'};
export type CardAuthorization={id:string;orderId:string;sourceId:string;amountMinor:number;currency:'AED';state:'PENDING'|'REQUIRES_ACTION'|'AUTHORIZED'|'DECLINED'|'EXPIRED'|'VOIDED'|'CAPTURED';scenario?:{runId:string;revision:number;preset:string};expiresAt:string;challengeId?:string;failureCode?:string};
export type RefundedPayment={refundedMinor?:number;refundState?:'PARTIALLY_REFUNDED'|'REFUNDED'};
export type ReversalReceipt={refundId:string;paymentId:string;orderId:string;approvalDigest:string;amountMinor:number;cumulativeMinor:number;currency:'AED';provider:string;reversedAt:string;providerBalanceMinor?:number};
export type PaymentRefund={id:string;accountId:string;ownerSub:string;version:number;state:'AWAITING_APPROVAL'|'REVERSING'|'RECONCILIATION_REQUIRED'|'REFUNDED'|'FAILED'|'CANCELLED';approvalDigest:string;createdAt:string;expiresAt:string;failureCode?:string;receipt?:ReversalReceipt;
 quote:{origin:'PAYMENT'|'WALLET_FUNDING';orderId:string;paymentId:string;source:PaymentMethod;amountMinor:number;originalAmountMinor:number;expectedRefundedMinor:number;currency:'AED';reason:string;originalApprovalDigest:string;payable?:Payable;admissionId?:string}};
export type PaymentAuthorizationReview=RefundedPayment & {id:string;accountId:string;ownerSub:string;version:number;state:'AWAITING_APPROVAL'|'AUTHORIZATION_PENDING'|'REQUIRES_ACTION'|'AUTHORIZED'|'CAPTURING'|'CAPTURED'|'RECONCILIATION_REQUIRED'|'SETTLED'|'FAILED'|'CANCELLED';approvalDigest:string;expiresAt:string;createdAt:string;approvedAt?:string;failureCode?:string;fundsCaptured:boolean;admissionId?:string;paymentId?:string;receipt?:PaymentReceipt;sourceFinalizationPending?:boolean;
  quote:{payable:Payable;billingAccount:BillingAccount;source:PaymentMethod;amountMinor:number;feeMinor:number;totalMinor:number;currency:'AED';createdAt:string;expiresAt:string};authorization?:CardAuthorization};
export type PaymentDependency = { resourceType:'METHOD'|'BILLER';resourceId:string;dependentKind:'ORDER'|'HOLD'|'MANDATE';dependentId:string;status:'ACTIVE' };
export type CheckoutGroup = {
  id:string;accountId:string;ownerSub:string;version:number;approvalDigest:string;createdAt:string;expiresAt:string;approvedAt?:string;cancelledAt?:string;lastFailureCode?:string;
  source:PaymentMethod;totalMinor:number;currency:'AED';orderIds:string[];
  excluded:{provider:BillerProvider;payableId:string;reason:'ALREADY_PAID'}[];
};
export type CheckoutGroupView = CheckoutGroup & {orders:PaymentAuthorizationReview[];settledMinor:number;
  state:'AWAITING_APPROVAL'|'AUTHORIZATION_PENDING'|'READY'|'REQUIRES_ACTION'|'RECONCILIATION_REQUIRED'|'PARTIAL'|'STOPPED'|'CANCELLED'|'COMPLETED'};
export type WalletFundingOrder = RefundedPayment & {
  id:string; accountId:string; ownerSub:string; version:number;
  state:'AWAITING_APPROVAL'|'AUTHORIZATION_PENDING'|'REQUIRES_ACTION'|'AUTHORIZED'|'SETTLED'|'FAILED'|'CANCELLED';
  approvalDigest:string; createdAt:string; expiresAt:string; fundsCaptured:boolean; failureCode?:string;
  quote:{source:PaymentMethod;amountMinor:number;feeMinor:number;totalMinor:number;currency:'AED';walletAccountId:string};
  authorization?:CardAuthorization;
  receipt?:{receiptNumber:string;amountMinor:number;feeMinor:number;currency:'AED';balanceMinor:number;capturedAt:string};
};
export type PaymentOverview = { contractVersion: string; accountId: string; previewOnly: boolean; dependencies: PaymentDependency[]; methods: PaymentMethod[]; defaultMethodId: string; presets: unknown[]; billingAccounts: BillingAccount[]; candidates: BillerCandidate[]; payables: Payable[];rechargeTargets?:RechargeTarget[];orders?:PaymentAuthorizationReview[];checkoutGroups?:CheckoutGroupView[];refunds?:PaymentRefund[];events?:PaymentEventStatus;fundingOrders?:WalletFundingOrder[];cardBalances?:CardBalance[];wallet: { balanceMinor: number; heldMinor: number; availableMinor: number; currency: 'AED' } };
export const orderStates = ['DRAFT','AWAITING_APPROVAL','AUTHORIZATION_PENDING','READY','REQUIRES_ACTION','AUTHORIZED','CAPTURED','SETTLING','SETTLED','FAILED','CANCELLED','RECONCILIATION_REQUIRED','REFUNDING','PARTIALLY_REFUNDED','REFUNDED'] as const;
export const settlementStates = ['UNCLAIMED','CLAIMED','APPLIED','RELEASED','UNKNOWN'] as const;
export const attemptStates = ['PENDING','REQUIRES_ACTION','AUTHORIZED','CAPTURED','DECLINED','VOIDED','UNKNOWN'] as const;
const id = { type: 'string', minLength: 1, maxLength: 160, pattern: '^[A-Za-z0-9][A-Za-z0-9_.:-]*$' };
const nickname = { type: 'string', minLength: 1, maxLength: 64, pattern: '^[^\\x00-\\x1f\\x7f]*\\S[^\\x00-\\x1f\\x7f]*$' };
const reference = { type: 'string', minLength: 1, maxLength: 160, pattern: '^[^\\x00-\\x1f\\x7f]+$' };
const version = { type: 'integer', minimum: 1, maximum: 1_000_000 };
const digestSchema={type:'string',pattern:'^[a-f0-9]{64}$'};
export const fineSelectionItemsSchema={type:'array',minItems:1,maxItems:20,items:{type:'object',properties:{payableId:id,expectedRevision:digestSchema},required:['payableId','expectedRevision'],additionalProperties:false}};
export const minorUnitSchema = { type: 'integer', minimum: 1, maximum: MAX_PAYMENT_MINOR };
export const paymentObject = (properties: Record<string, unknown>, required = Object.keys(properties)) => ({ type: 'object', properties, required, additionalProperties: false });
export const paymentSchemas = {
  createRefund:paymentObject({origin:{enum:['PAYMENT','WALLET_FUNDING']},orderId:id,expectedVersion:version,amountMinor:minorUnitSchema,reason:{type:'string',minLength:1,maxLength:160,pattern:'\\S'}}),
  createCheckoutGroup:paymentObject({items:{type:'array',minItems:1,maxItems:10,uniqueItems:true,items:paymentObject({provider:{enum:['dewa','etisalat','du','police','rta']},payableId:id,expectedPayableRevision:digestSchema})},methodId:id,expectedMethodVersion:version}),
  createMethod: paymentObject({ preset: { enum: cardPresets.map(p => p.id) }, nickname }),
  methodStatus: paymentObject({ methodId: id, expectedVersion: version, status: { enum: ['ACTIVE','DISABLED','REMOVED'] } }),
  defaultMethod: paymentObject({ methodId: id, expectedVersion: version }),
  linkAccount: paymentObject({ provider: { enum: ['dewa','etisalat','du','rta','police'] }, reference, nickname }),
  archiveAccount: paymentObject({ billingAccountId: id, expectedVersion: version }),
  preview: paymentObject({ payableId: id, methodId: id, expectedMethodVersion: version }),
  fineSelection:paymentObject({items:fineSelectionItemsSchema}),
  fineSelectionPreview:paymentObject({items:fineSelectionItemsSchema,methodId:id,expectedMethodVersion:version}),
  rechargeQuote:paymentObject({targetReference:reference,amountMinor:minorUnitSchema,expectedTargetVersion:version,intentId:id}),
  rechargePreview:paymentObject({provider:{enum:['rta','etisalat','du']},targetReference:reference,amountMinor:minorUnitSchema,expectedTargetVersion:version,methodId:id,expectedMethodVersion:version}),
  createOrder:paymentObject({provider:{enum:['dewa','etisalat','du','police','rta']},payableId:id,expectedPayableRevision:digestSchema,methodId:id,expectedMethodVersion:version}),
  createWalletFunding:paymentObject({amountMinor:{type:'integer',minimum:WALLET_FUNDING_LIMITS.minMinor,maximum:WALLET_FUNDING_LIMITS.maxMinor},methodId:id,expectedMethodVersion:version}),
  approveOrder:paymentObject({expectedVersion:version,approvalDigest:digestSchema}),
  challengeOrder:paymentObject({expectedVersion:version,approvalDigest:digestSchema,challengeId:id,decision:{enum:['APPROVE','REJECT']}}),
  cancelOrder:paymentObject({expectedVersion:version}),
  executeOrder:paymentObject({expectedVersion:version,approvalDigest:digestSchema}),
  recoverOrder:paymentObject({}),
};
export const withOrderId=(schema:ReturnType<typeof paymentObject>)=>paymentObject({...schema.properties,orderId:id},[...schema.required,'orderId']);
export const withPaymentAccount = (schema: ReturnType<typeof paymentObject>, write = true) => paymentObject({
  ...schema.properties, accountId: id, ...(write ? { requestKey: { type: 'string', pattern: '^[A-Za-z0-9_-]{8,100}$' } } : {}),
}, [...schema.required, 'accountId', ...(write ? ['requestKey'] : [])]);
export function formatAED(minor: number): string {
  if (!Number.isSafeInteger(minor) || minor < 0 || minor > MAX_PAYMENT_MINOR) throw new Error('Invalid AED fils');
  return `AED ${(minor / 100).toFixed(2)}`;
}

const date = { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}\\.\\d{3}Z$' };
const commonMethod = { id, accountId: id, kind: { enum: ['wallet','card'] }, nickname, version, status: { enum: ['ACTIVE','DISABLED','EXPIRED','REMOVED'] }, currency: { const: 'AED' }, createdAt: date };
export const paymentMethodSchema = {
  ...paymentObject({ ...commonMethod, preset: { enum: cardPresets.map(p => p.id) }, last4: { type: 'string', pattern: '^\\d{4}$' }, expiresMonth: { type: 'integer', minimum: 1, maximum: 12 }, expiresYear: { type: 'integer', minimum: 2000, maximum: 2200 } }, ['id','accountId','kind','nickname','version','status','currency']),
  allOf: [{ if: { properties: { kind: { const: 'card' } } }, then: { required: ['preset','last4','expiresMonth','expiresYear','createdAt'] }, else: { properties: { id: { const: 'wallet' }, status: { const: 'ACTIVE' }, version: { const: 1 } }, not: { anyOf: [{ required: ['preset'] },{ required: ['last4'] }] } } }],
};
export const billingAccountSchema = paymentObject({ id, accountId: id, provider: { enum: ['dewa','etisalat','du','rta','police'] }, reference, nickname, status: { enum: ['ACTIVE','ARCHIVED'] }, version, createdAt: date });
/** Future order persistence contract, not an enabled creation/execution endpoint. */
export const paymentOrderSchema = paymentObject({
  id, accountId: id, ownerSub: id, quoteId: id, quoteDigest: { type: 'string', pattern: '^[a-f0-9]{64}$' },
  payableId: id, payableRevision: { type: 'string', minLength: 1, maxLength: 160 }, sourceId: id, sourceVersion: version,
  amountMinor: minorUnitSchema, feeMinor: { type: 'integer', minimum: 0, maximum: MAX_PAYMENT_MINOR }, totalMinor: minorUnitSchema,
  refundedMinor: { type: 'integer', minimum: 0, maximum: MAX_PAYMENT_MINOR }, currency: { const: 'AED' },
  state: { enum: orderStates }, settlementState: { enum: settlementStates }, createdAt: date, updatedAt: date,
});
