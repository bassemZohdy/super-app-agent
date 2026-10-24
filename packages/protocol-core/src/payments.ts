/** Payment contract v1. Additive, synthetic-account APIs; previews never authorize execution. */
export const PAYMENT_CONTRACT_VERSION = '1.0.0';
export const MAX_PAYMENT_MINOR = 100_000_000;
export const cardPresets = [
  { id: 'approved', name: 'Everyday demo card', last4: '4242', behavior: 'APPROVE' },
  { id: 'declined', name: 'Declined demo card', last4: '0002', behavior: 'DECLINE' },
  { id: 'challenge', name: 'Challenge demo card', last4: '3155', behavior: 'CHALLENGE' },
  { id: 'expired', name: 'Expired demo card', last4: '0069', behavior: 'EXPIRED' },
] as const;
export type CardPreset = typeof cardPresets[number]['id'];
export type BillerProvider = 'dewa' | 'etisalat' | 'du' | 'rta' | 'police';
export type PaymentMethod = {
  id: string; accountId: string; kind: 'wallet' | 'card'; nickname: string; version: number;
  status: 'ACTIVE' | 'DISABLED' | 'EXPIRED' | 'REMOVED'; currency: 'AED';
  preset?: CardPreset; last4?: string; expiresMonth?: number; expiresYear?: number; createdAt?: string;
};
export type BillingAccount = { id: string; accountId: string; provider: BillerProvider; reference: string; nickname: string; status: 'ACTIVE' | 'ARCHIVED'; version: number; createdAt: string };
export type BillerCandidate = { provider: BillerProvider; reference: string; label: string };
export type Payable = { id: string; provider: BillerProvider; reference: string; label: string; amountMinor: number; currency: 'AED'; revision: string; status: 'UNPAID' | 'PAID'; dueDate?: string };
export type PaymentPreview = {
  contractVersion: typeof PAYMENT_CONTRACT_VERSION; previewOnly: true; accountId: string; id: string;
  payable: Payable; billingAccount: BillingAccount; source: PaymentMethod; amountMinor: number; feeMinor: number;
  totalMinor: number; currency: 'AED'; createdAt: string; expiresAt: string; digest: string;
};
export type PaymentOverview = { contractVersion: string; accountId: string; previewOnly: true; methods: PaymentMethod[]; defaultMethodId: string; presets: unknown[]; billingAccounts: BillingAccount[]; candidates: BillerCandidate[]; payables: Payable[]; wallet: { balanceMinor: number; heldMinor: number; availableMinor: number; currency: 'AED' } };
export const orderStates = ['DRAFT','AWAITING_APPROVAL','READY','REQUIRES_ACTION','AUTHORIZED','CAPTURED','SETTLING','SETTLED','FAILED','CANCELLED','RECONCILIATION_REQUIRED','REFUNDING','PARTIALLY_REFUNDED','REFUNDED'] as const;
export const settlementStates = ['UNCLAIMED','CLAIMED','APPLIED','RELEASED','UNKNOWN'] as const;
export const attemptStates = ['PENDING','REQUIRES_ACTION','AUTHORIZED','CAPTURED','DECLINED','VOIDED','UNKNOWN'] as const;
const id = { type: 'string', minLength: 1, maxLength: 160, pattern: '^[A-Za-z0-9][A-Za-z0-9_.:-]*$' };
const nickname = { type: 'string', minLength: 1, maxLength: 64, pattern: '^[^\\x00-\\x1f\\x7f]*\\S[^\\x00-\\x1f\\x7f]*$' };
const reference = { type: 'string', minLength: 1, maxLength: 160, pattern: '^[^\\x00-\\x1f\\x7f]+$' };
const version = { type: 'integer', minimum: 1, maximum: 1_000_000 };
export const minorUnitSchema = { type: 'integer', minimum: 1, maximum: MAX_PAYMENT_MINOR };
export const paymentObject = (properties: Record<string, unknown>, required = Object.keys(properties)) => ({ type: 'object', properties, required, additionalProperties: false });
export const paymentSchemas = {
  createMethod: paymentObject({ preset: { enum: cardPresets.map(p => p.id) }, nickname }),
  methodStatus: paymentObject({ methodId: id, expectedVersion: version, status: { enum: ['ACTIVE','DISABLED','REMOVED'] } }),
  defaultMethod: paymentObject({ methodId: id, expectedVersion: version }),
  linkAccount: paymentObject({ provider: { enum: ['dewa','etisalat','du','rta','police'] }, reference, nickname }),
  archiveAccount: paymentObject({ billingAccountId: id, expectedVersion: version }),
  preview: paymentObject({ payableId: id, methodId: id, expectedMethodVersion: version }),
};
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
