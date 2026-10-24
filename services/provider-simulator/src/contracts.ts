import { paymentSchemas, paymentMethodSchema, billingAccountSchema } from '../../../packages/protocol-core/src/payments.ts';
export const providerIds = ['rta', 'dewa', 'etisalat', 'du', 'police', 'dld', 'payments'] as const;
export type ProviderId = typeof providerIds[number];
export const providerNames: Record<ProviderId, string> = { rta: 'RTA', dewa: 'DEWA', etisalat: 'Etisalat', du: 'du', police: 'Dubai Police', dld: 'Dubai Land Department', payments: 'Demo Payment Gateway' };
export const object = (properties: Record<string, any>, required = Object.keys(properties)) => ({ type: 'object', properties, required, additionalProperties: false });
const text = { type: 'string', minLength: 1, maxLength: 200 };
const money = { type: 'integer', minimum: 1, maximum: 100_000_000 };
const opaque = { type: 'object', additionalProperties: true };
const list = { type: 'array', items: opaque, maxItems: 100 };
export interface Operation { method: string; path: string; id: string; body?: Record<string, any>; result: Record<string, any>; description: string; }
const op = (method: string, path: string, id: string, result: Record<string, any>, description: string, body?: Record<string, any>): Operation => ({ method, path, id, result, description, body });
const paymentProof = object({ paymentId: text });
const revision = {type:'string',pattern:'^[a-f0-9]{64}$'};
const payableSchema = object({id:text,provider:{enum:['dewa','etisalat','du','police']},reference:text,obligationId:text,kind:{enum:['BILL','FINE']},version:{type:'integer',minimum:1,maximum:1000000},label:text,amountMinor:money,originalAmountMinor:money,discountMinor:{type:'integer',minimum:0,maximum:100000000},discountEligible:{type:'boolean'},currency:{const:'AED'},status:{enum:['UNPAID','PAID','CANCELLED','EXPIRED']},dueState:{enum:['CURRENT','DUE','OVERDUE','EXPIRED','CLOSED']},revision,dueDate:{type:'string',pattern:'^\\d{4}-\\d{2}-\\d{2}$'},expiresAt:text,discountExpiresAt:text,period:text,openingFixture:{type:'boolean'},paymentRestricted:{type:'boolean'}},['id','provider','reference','obligationId','kind','version','label','amountMinor','originalAmountMinor','discountMinor','discountEligible','currency','status','dueState','revision']);
const payableOperations = [
  op('GET','/payables','listVersionedPayables',{payables:{type:'array',items:payableSchema,maxItems:100}},'Read provider-owned revisioned obligations, including settled/withdrawn history and effective discounts.'),
  op('GET','/payables/{payableId}','getVersionedPayable',{payable:payableSchema,settlementReference:text},'Read the current owned obligation and revision-bound reference without cached POST retry results.'),
  op('POST','/payables/{payableId}/reviews','reviewVersionedPayable',{payable:payableSchema,settlementReference:text},'Require the current payable revision. This preflight does not authorize or capture funds.',object({expectedRevision:revision})),
  op('POST','/payables/{payableId}/payments','settleVersionedPayable',{payable:payableSchema,receipt:object({receiptNumber:text,obligationId:text,amountMinor:money,currency:{const:'AED'}})},'Settle the current revision with an owned revision-bound captured payment. Durable order/claim orchestration remains a separate gate.',object({expectedRevision:revision,paymentId:text})),
];
const telecom = [
  ...payableOperations,
  op('GET', '/prepaid', 'listPrepaidLines', { lines: list }, 'List owned synthetic prepaid mobile lines and current balances.'),
  op('GET', '/subscriptions', 'listSubscriptions', { subscriptions: list }, 'List subscriptions owned by this account.'),
  op('GET', '/plans', 'listPlans', { plans: list }, 'List available demo mobile and home internet plans.'),
  op('GET', '/bills', 'listBills', { bills: list }, 'List the account’s telecom bills in AED.'),
  op('POST', '/bills/{billId}/payments', 'settleBill', { bill: opaque, receipt: opaque }, 'Settle an unpaid bill with a captured payment proof.', paymentProof),
  op('POST', '/subscriptions/{subscriptionId}/plan', 'changePlan', { subscription: opaque }, 'Change a subscription to an available compatible plan.', object({ planId: text })),
];
export const operations: Record<ProviderId, Operation[]> = {
  rta: [
    op('GET', '/parking/zones', 'listParkingZones', { count: { type: 'integer' }, zones: list }, 'List simulated parking zones.'),
    op('GET', '/parking/sessions', 'listParkingSessions', { meters: list, count: { type: 'integer' } }, 'List this account’s parking sessions.'),
    op('POST', '/parking/sessions', 'activateParking', { meter: opaque }, 'Create a parking session for an account-owned plate.', object({ zoneId: text, durationHours: { type: 'integer', minimum: 1, maximum: 720 }, plateNumber: text, paymentId: text, reference: text })),
    op('POST', '/parking/sessions/{ticketId}/extensions', 'extendParking', { meter: opaque }, 'Extend an existing, owned parking session.', object({ additionalHours: { type: 'integer', minimum: 1, maximum: 720 }, paymentId: text, reference: text })),
    op('POST', '/residential-permits', 'issueResidentialPermit', { permit: opaque }, 'Issue an account-owned simulated residential permit.', object({ contractNumber: text })),
    op('GET', '/salik', 'getSalikBalance', { balance: { type: 'number' }, tagNumber: text, status: text, currency: { const: 'AED' } }, 'Read this account’s simulated toll tag balance.'),
    op('POST', '/salik/recharges', 'rechargeSalik', { transactionId: text, newBalance: { type: 'number' }, amountRecharged: { type: 'number' } }, 'Recharge the toll tag using a captured payment.', object({ amount: { type: 'number', exclusiveMinimum: 0, maximum: 1000000, multipleOf: 0.01 }, paymentId: text, reference: text })),
    op('GET', '/salik/passings', 'listTollPassings', { passings: list }, 'Read simulated toll passings.'),
    op('GET', '/ev/chargers', 'listChargers', { chargers: list }, 'List simulated EV charger availability.'),
    op('POST', '/ev/sessions', 'startCharging', { session: opaque }, 'Start a simulated charging session.', object({ chargerId: text, plateNumber: text })),
    op('GET', '/rides/options', 'listRideOptions', { options: list }, 'List demo vehicle and fare options.'),
    op('POST', '/rides/bookings', 'bookRide', { booking: opaque }, 'Create an account-owned demo ride.', object({ driverId: text, pickup: text, dropoff: text }, ['driverId'])),
    op('GET', '/rides/bookings/{bookingId}', 'getRide', { booking: opaque }, 'Read a booking owned by this account.'),
  ],
  dewa: [
    ...payableOperations,
    op('GET', '/consumption', 'getConsumption', { account: opaque, ecoStatus: text }, 'Read an account-owned smart meter and consumption snapshot.'),
    op('GET', '/bills', 'listUtilityBills', { bills: list }, 'Read this account’s utility bills.'),
    op('POST', '/bills/{billId}/payments', 'settleUtilityBill', { bill: opaque, receipt: opaque }, 'Settle a bill after checking its captured payment reference and amount.', paymentProof),
    op('POST', '/connections', 'activateConnection', { connection: opaque }, 'Activate a simulated utility connection for the current account.', object({ contractNumber: text })),
  ],
  etisalat: telecom, du: telecom,
  police: [
    ...payableOperations,
    op('GET', '/vehicles', 'listRegisteredVehicles', { vehicles: list }, 'List owned registered vehicles independently of unpaid fines.'),
    op('GET', '/fines', 'listTrafficFines', { fines: list, count: { type: 'integer' }, totalPayable: { type: 'number' }, totalOriginal: { type: 'number' }, totalDiscount: { type: 'number' } }, 'List unpaid account-owned traffic fines.'),
    op('POST', '/fine-payments', 'settleTrafficFines', { receiptNumber: text, finesCleared: { type: 'integer' }, amountPaid: { type: 'number' } }, 'Settle specified fines using a captured payment.', object({ fineIds: { type: 'array', items: text, minItems: 1, maxItems: 100, uniqueItems: true }, paymentId: text })),
  ],
  dld: [
    op('GET', '/tenancy', 'getTenancy', { contract: opaque }, 'Read the account-owned tenancy contract.'),
    op('POST', '/move-ins', 'registerMoveIn', { ejariContract: text, unit: text, residentialParking: opaque }, 'Register a move-in proposal. Utility and parking activation are separate operations.', object({ contractNumber: text })),
  ],
  payments: [
    op('GET', '/payment-methods', 'listPaymentMethods', { methods: { type: 'array', items: paymentMethodSchema, maxItems: 101 }, dependencies: { type: 'array', items: object({resourceType:{enum:['METHOD','BILLER']},resourceId:text,dependentKind:{enum:['ORDER','HOLD','MANDATE']},dependentId:text,status:{const:'ACTIVE'}}),maxItems:200 }, defaultMethodId: text, presets: { type: 'array', items: opaque } }, 'List owned synthetic funding methods. Wallet/card management does not move money.'),
    op('POST', '/payment-methods', 'createPaymentMethod', { method: paymentMethodSchema }, 'Save an owned synthetic card preset; never submit card numbers or security codes.', paymentSchemas.createMethod),
    op('POST', '/payment-methods/status', 'changePaymentMethodStatus', { method: paymentMethodSchema }, 'Version-checked card disable/reactivate/tombstone; no automatic funding fallback.', paymentSchemas.methodStatus),
    op('POST', '/payment-methods/default', 'setDefaultPaymentMethod', { defaultMethodId: text }, 'Select an active default for future drafts, without changing existing approvals.', paymentSchemas.defaultMethod),
    op('GET', '/billing-accounts', 'listBillingAccounts', { billingAccounts: { type: 'array', items: billingAccountSchema, maxItems: 100 }, dependencies: { type: 'array', items: object({resourceType:{enum:['METHOD','BILLER']},resourceId:text,dependentKind:{enum:['ORDER','HOLD','MANDATE']},dependentId:text,status:{const:'ACTIVE'}}),maxItems:200 } }, 'List owned linked biller references.'),
    op('POST', '/billing-accounts', 'linkBillingAccount', { billingAccount: billingAccountSchema }, 'Verify provider ownership then link a synthetic biller account.', paymentSchemas.linkAccount),
    op('POST', '/billing-accounts/archive', 'archiveBillingAccount', { billingAccount: billingAccountSchema }, 'Archive an owned biller link while retaining its historical reference.', paymentSchemas.archiveAccount),
    op('GET', '/wallet', 'getWallet', { balance: { type: 'number' }, balanceMinor: { type: 'integer', minimum: 0 }, heldMinor: { type: 'integer', minimum: 0 }, availableMinor: { type: 'integer', minimum: 0 }, currency: { const: 'AED' } }, 'Read posted, held and available AED wallet funds from the balanced journal.'),
    op('GET', '/transactions', 'listTransactions', { transactions: list, count: { type: 'integer' } }, 'List the latest 100 account-owned payment transactions.'),
    op('POST', '/topups', 'topUpWallet', { transaction: opaque, newBalance: { type: 'number' } }, 'Top up a wallet using a simulated approved or declined funding source.', object({ amountMinor: money, source: { enum: ['demo_approved', 'demo_declined'] } })),
    op('POST', '/charges', 'createCharge', { charge: opaque, transaction: opaque, remainingBalance: { type: 'number' } }, 'Capture or decline a simulated payment. Amounts use integer AED fils. Never submit card details.', object({ amountMinor: money, merchant: { enum: ['rta', 'dewa', 'police', 'etisalat', 'du', 'superapp'] }, reference: text, source: { enum: ['wallet', 'demo_approved', 'demo_declined'] } })),
    op('GET', '/charges/{chargeId}', 'getCharge', { charge: opaque }, 'Look up an account-owned captured or declined charge.'),
    op('POST', '/charges/{chargeId}/refunds', 'refundCharge', { refund: opaque, remainingBalance: { type: 'number' } }, 'Refund a captured charge at most once.', object({ reason: text })),
  ],
};
export function openApi(provider: ProviderId) {
  const paths: Record<string, any> = {
    '/health': { get: { operationId: 'health', security: [], responses: { '200': { description: 'Process health' } } } },
    '/v1/accounts': { get: { operationId: 'listAccounts', description: 'List personal and household accounts belonging to the trusted actor.', responses: { '200': { description: 'Accounts', content: { 'application/json': { schema: object({ success: { const: true }, accounts: list }) } } }, '401': { $ref: '#/components/responses/Unauthorized' } } } },
  };
  for (const operation of operations[provider]) {
    const path = `/v1/accounts/{accountId}${operation.path}`;
    paths[path] ||= {};
    const params = [...[...path.matchAll(/\{(\w+)\}/g)].map(m => ({ name: m[1], in: 'path', required: true, schema: text }))];
    if (operation.method === 'POST') params.push({ name: 'Idempotency-Key', in: 'header', required: true, schema: text });
    paths[path][operation.method.toLowerCase()] = {
      operationId: `${provider}_${operation.id}`, description: operation.description, parameters: params,
      ...(operation.body ? { requestBody: { required: true, content: { 'application/json': { schema: operation.body } } } } : {}),
      responses: { '200': { description: 'Success', content: { 'application/json': { schema: object({ success: { const: true }, ...operation.result }) } } },
        ...Object.fromEntries(['400','401','403','404','409','402','503'].map(status => [status, { $ref: '#/components/responses/Error' }])) },
    };
  }
  return { openapi: '3.1.0', info: { title: `${providerNames[provider]} Simulator`, version: provider === 'payments' ? '2.2.0' : ['dewa','etisalat','du','police'].includes(provider) ? '2.2.0' : '2.0.0', description: 'Local synthetic API. Signed interactive user identity or broker-issued user token with current exact-operation grant required. JWT subject owns the account; caller user headers do not grant authority. A separate read-only settlement machine lane retrieves captured charge proofs. Legacy fixture mode is outside this reference security profile.' },
    servers: [{ url: `http://localhost:${4101 + providerIds.indexOf(provider)}` }], security: [{ accessToken: [] }],
    paths, components: { securitySchemes: { accessToken: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' } },
      responses: { Unauthorized: { description: 'Missing or invalid Keycloak access token' }, Error: { description: 'Validation, ownership, delegation, payment, conflict or availability error', content: { 'application/json': { schema: object({ success: { const: false }, error: { type: 'string' }, code: { type: 'string' } }) } } } } },
    'x-demo-provider': provider, 'x-idempotency-policy': 'Persisted per account for the lifetime of the demo database. Reusing a key with a different method, path or body returns 409.' };
}
