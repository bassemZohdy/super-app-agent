/** Payment contract v1. Additive, synthetic-account APIs; previews never authorize execution. */
export const PAYMENT_CONTRACT_VERSION = '1.2.0';
export const MAX_PAYMENT_MINOR = 100_000_000;
export const cardPresets = [
  { id: 'approved', name: 'Everyday demo card', last4: '4242', behavior: 'APPROVE', limitMinor:200000 },
  { id: 'declined', name: 'Declined demo card', last4: '0002', behavior: 'DECLINE', limitMinor:200000 },
  { id: 'challenge', name: 'Challenge demo card', last4: '3155', behavior: 'CHALLENGE', limitMinor:200000 },
  { id: 'expired', name: 'Expired demo card', last4: '0069', behavior: 'EXPIRED', limitMinor:200000 },
  { id: 'limited', name: 'Limited demo card', last4: '1000', behavior: 'APPROVE', limitMinor:10000 },
] as const;
export type CardPreset = typeof cardPresets[number]['id'];
export type BillerProvider = 'dewa' | 'etisalat' | 'du' | 'rta' | 'police';
export type PaymentMethod = {
  id: string; accountId: string; kind: 'wallet' | 'card'; nickname: string; version: number;
  status: 'ACTIVE' | 'DISABLED' | 'EXPIRED' | 'REMOVED'; currency: 'AED';
  preset?: CardPreset; last4?: string; expiresMonth?: number; expiresYear?: number; createdAt?: string;
};
export type BillingAccount = { id: string; accountId: string; provider: BillerProvider; reference: string; nickname: string; status: 'ACTIVE' | 'ARCHIVED'; version: number; createdAt: string };
export type BillerCandidate = { provider: BillerProvider; reference: string; label: string; balanceMinor?: number };
export type Payable = { id: string; provider: BillerProvider; reference: string; label: string; amountMinor: number; currency: 'AED'; revision: string; status: 'UNPAID' | 'PAID' | 'CANCELLED' | 'EXPIRED'; dueDate?: string;
  obligationId?: string; kind?: 'BILL'|'FINE'; version?:number; dueState?:'CURRENT'|'DUE'|'OVERDUE'|'EXPIRED'|'CLOSED'; originalAmountMinor?:number; discountMinor?:number; discountEligible?:boolean; discountExpiresAt?:string; expiresAt?:string; period?:string; openingFixture?:boolean; paymentRestricted?:boolean };
export type PaymentPreview = {
  contractVersion: typeof PAYMENT_CONTRACT_VERSION; previewOnly: true; accountId: string; id: string;
  payable: Payable; billingAccount: BillingAccount; source: PaymentMethod; amountMinor: number; feeMinor: number;
  totalMinor: number; currency: 'AED'; createdAt: string; expiresAt: string; digest: string;
};
export type CardBalance={sourceId:string;limitMinor:number;heldMinor:number;spentMinor:number;availableMinor:number;currency:'AED'};
export type CardAuthorization={id:string;orderId:string;sourceId:string;amountMinor:number;currency:'AED';state:'REQUIRES_ACTION'|'AUTHORIZED'|'DECLINED'|'EXPIRED'|'VOIDED'|'CAPTURED';expiresAt:string;challengeId?:string;failureCode?:string};
export type PaymentAuthorizationReview={id:string;accountId:string;ownerSub:string;version:number;state:'AWAITING_APPROVAL'|'REQUIRES_ACTION'|'AUTHORIZED'|'CAPTURING'|'CAPTURED'|'RECONCILIATION_REQUIRED'|'SETTLED'|'FAILED'|'CANCELLED';approvalDigest:string;expiresAt:string;createdAt:string;approvedAt?:string;failureCode?:string;fundsCaptured:boolean;admissionId?:string;paymentId?:string;receipt?:{receiptNumber:string;obligationId:string;amountMinor:number;currency:'AED'};
  quote:{payable:Payable;billingAccount:BillingAccount;source:PaymentMethod;amountMinor:number;feeMinor:number;totalMinor:number;currency:'AED';createdAt:string;expiresAt:string};authorization?:CardAuthorization};
export type PaymentDependency = { resourceType:'METHOD'|'BILLER';resourceId:string;dependentKind:'ORDER'|'HOLD'|'MANDATE';dependentId:string;status:'ACTIVE' };
export type PaymentOverview = { contractVersion: string; accountId: string; previewOnly: boolean; dependencies: PaymentDependency[]; methods: PaymentMethod[]; defaultMethodId: string; presets: unknown[]; billingAccounts: BillingAccount[]; candidates: BillerCandidate[]; payables: Payable[]; orders?:PaymentAuthorizationReview[];cardBalances?:CardBalance[];wallet: { balanceMinor: number; heldMinor: number; availableMinor: number; currency: 'AED' } };
export const orderStates = ['DRAFT','AWAITING_APPROVAL','READY','REQUIRES_ACTION','AUTHORIZED','CAPTURED','SETTLING','SETTLED','FAILED','CANCELLED','RECONCILIATION_REQUIRED','REFUNDING','PARTIALLY_REFUNDED','REFUNDED'] as const;
export const settlementStates = ['UNCLAIMED','CLAIMED','APPLIED','RELEASED','UNKNOWN'] as const;
export const attemptStates = ['PENDING','REQUIRES_ACTION','AUTHORIZED','CAPTURED','DECLINED','VOIDED','UNKNOWN'] as const;
const id = { type: 'string', minLength: 1, maxLength: 160, pattern: '^[A-Za-z0-9][A-Za-z0-9_.:-]*$' };
const nickname = { type: 'string', minLength: 1, maxLength: 64, pattern: '^[^\\x00-\\x1f\\x7f]*\\S[^\\x00-\\x1f\\x7f]*$' };
const reference = { type: 'string', minLength: 1, maxLength: 160, pattern: '^[^\\x00-\\x1f\\x7f]+$' };
const version = { type: 'integer', minimum: 1, maximum: 1_000_000 };
const digestSchema={type:'string',pattern:'^[a-f0-9]{64}$'};
export const minorUnitSchema = { type: 'integer', minimum: 1, maximum: MAX_PAYMENT_MINOR };
export const paymentObject = (properties: Record<string, unknown>, required = Object.keys(properties)) => ({ type: 'object', properties, required, additionalProperties: false });
export const paymentSchemas = {
  createMethod: paymentObject({ preset: { enum: cardPresets.map(p => p.id) }, nickname }),
  methodStatus: paymentObject({ methodId: id, expectedVersion: version, status: { enum: ['ACTIVE','DISABLED','REMOVED'] } }),
  defaultMethod: paymentObject({ methodId: id, expectedVersion: version }),
  linkAccount: paymentObject({ provider: { enum: ['dewa','etisalat','du','rta','police'] }, reference, nickname }),
  archiveAccount: paymentObject({ billingAccountId: id, expectedVersion: version }),
  preview: paymentObject({ payableId: id, methodId: id, expectedMethodVersion: version }),
  createOrder:paymentObject({provider:{enum:['dewa','etisalat','du','police']},payableId:id,expectedPayableRevision:digestSchema,methodId:id,expectedMethodVersion:version}),
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
