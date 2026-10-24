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
const payableSchema = object({id:text,provider:{enum:['dewa','etisalat','du','police','rta']},reference:text,obligationId:text,kind:{enum:['BILL','FINE']},version:{type:'integer',minimum:1,maximum:1000000},label:text,amountMinor:money,originalAmountMinor:money,discountMinor:{type:'integer',minimum:0,maximum:100000000},discountEligible:{type:'boolean'},currency:{const:'AED'},status:{enum:['UNPAID','PAID','CANCELLED','EXPIRED']},dueState:{enum:['CURRENT','DUE','OVERDUE','EXPIRED','CLOSED']},revision,dueDate:{type:'string',pattern:'^\\d{4}-\\d{2}-\\d{2}$'},expiresAt:text,discountExpiresAt:text,period:text,openingFixture:{type:'boolean'},paymentRestricted:{type:'boolean'}},['id','provider','reference','obligationId','kind','version','label','amountMinor','originalAmountMinor','discountMinor','discountEligible','currency','status','dueState','revision']);
const fineItemSchema=structuredClone(payableSchema);fineItemSchema.properties.kind={const:'FINE'};
payableSchema.properties.kind={enum:['BILL','FINE','FINE_SET','RECHARGE']};payableSchema.properties.items={type:'array',minItems:1,maxItems:20,items:fineItemSchema};
payableSchema.properties.recharge=object({kind:{enum:['TOLL','PREPAID']},targetVersion:{type:'integer',minimum:1,maximum:1000000},balanceBeforeMinor:{type:'integer',minimum:0,maximum:100000000}});
const receiptSchema=object({receiptNumber:text,obligationId:text,amountMinor:money,currency:{const:'AED'},targetReference:text,providerBalanceMinor:{type:'integer',minimum:0,maximum:100000000}},['receiptNumber','obligationId','amountMinor','currency']);
const rechargeOperations=[
  op('GET','/recharge-intents/{intentId}','getRechargeIntent',{payable:payableSchema},'Read the original immutable quote for one owned recharge intent to resume its stored payment after a lost response.'),
  op('GET','/recharge-targets','listRechargeTargets',{targets:{type:'array',maxItems:100,items:object({provider:{enum:['rta','etisalat','du']},reference:text,label:text,kind:{enum:['TOLL','PREPAID']},status:text,version:{type:'integer',minimum:1,maximum:1000000},balanceMinor:{type:'integer',minimum:0,maximum:100000000},currency:{const:'AED'},denominationsMinor:{type:'array',minItems:1,maxItems:20,items:money,uniqueItems:true}})}},'Read owned toll/prepaid targets, versions, balances and current denominations.'),
  op('POST','/recharge-quotes','createRechargeQuote',{payable:payableSchema},'Persist one explicit recharge intent bound to a current owned target and allowed denomination. No credit or capture occurs.',paymentSchemas.rechargeQuote),
];
const payableOperations = [
  op('GET','/payables','listVersionedPayables',{payables:{type:'array',items:payableSchema,maxItems:100}},'Read provider-owned revisioned obligations, including settled/withdrawn history and effective discounts.'),
  op('GET','/payables/{payableId}','getVersionedPayable',{payable:payableSchema,settlementReference:text},'Read the current owned obligation and revision-bound reference without cached POST retry results.'),
  op('POST','/payables/{payableId}/reviews','reviewVersionedPayable',{payable:payableSchema,settlementReference:text},'Require the current payable revision. This preflight does not authorize or capture funds.',object({expectedRevision:revision})),
  op('POST','/payables/{payableId}/payments','settleVersionedPayable',{payable:payableSchema,receipt:receiptSchema},'Settle the current revision with an owned revision-bound captured payment. Durable order/claim orchestration remains a separate gate.',object({expectedRevision:revision,paymentId:text})),
];
const authorizationSchema=object({id:text,orderId:text,sourceId:text,amountMinor:money,currency:{const:'AED'},state:{enum:['REQUIRES_ACTION','AUTHORIZED','DECLINED','EXPIRED','VOIDED','CAPTURED']},expiresAt:text,challengeId:text,failureCode:text},['id','orderId','sourceId','amountMinor','currency','state','expiresAt']);
const reviewSchema=object({id:text,accountId:text,ownerSub:text,version:{type:'integer',minimum:1},state:{enum:['AWAITING_APPROVAL','REQUIRES_ACTION','AUTHORIZED','CAPTURING','CAPTURED','RECONCILIATION_REQUIRED','SETTLED','FAILED','CANCELLED']},approvalDigest:revision,expiresAt:text,createdAt:text,approvedAt:text,failureCode:text,fundsCaptured:{type:'boolean'},sourceFinalizationPending:{type:'boolean'},admissionId:text,paymentId:text,receipt:receiptSchema,authorization:authorizationSchema,
  quote:object({payable:payableSchema,source:paymentMethodSchema,billingAccount:billingAccountSchema,amountMinor:money,feeMinor:{type:'integer',minimum:0,maximum:100000000},totalMinor:money,currency:{const:'AED'},createdAt:text,expiresAt:text})},['id','accountId','ownerSub','version','state','approvalDigest','expiresAt','createdAt','fundsCaptured','quote']);
const groupSchema=object({id:text,accountId:text,ownerSub:text,version:{type:'integer',minimum:1},approvalDigest:revision,createdAt:text,expiresAt:text,approvedAt:text,cancelledAt:text,lastFailureCode:text,source:paymentMethodSchema,totalMinor:money,currency:{const:'AED'},orderIds:{type:'array',minItems:1,maxItems:10,items:text},excluded:{type:'array',maxItems:10,items:object({provider:{enum:['dewa','etisalat','du','police','rta']},payableId:text,reason:{const:'ALREADY_PAID'}})},orders:{type:'array',minItems:1,maxItems:10,items:reviewSchema},settledMinor:{type:'integer',minimum:0,maximum:100000000},state:{enum:['AWAITING_APPROVAL','READY','REQUIRES_ACTION','RECONCILIATION_REQUIRED','PARTIAL','STOPPED','CANCELLED','COMPLETED']}},['id','accountId','ownerSub','version','approvalDigest','createdAt','expiresAt','source','totalMinor','currency','orderIds','excluded','orders','settledMinor','state']);
reviewSchema.properties.refundedMinor={type:'integer',minimum:0,maximum:100000000};reviewSchema.properties.refundState={enum:['PARTIALLY_REFUNDED','REFUNDED']};
const fundingSchema=object({id:text,accountId:text,ownerSub:text,version:{type:'integer',minimum:1},state:{enum:['AWAITING_APPROVAL','REQUIRES_ACTION','AUTHORIZED','SETTLED','FAILED','CANCELLED']},approvalDigest:revision,createdAt:text,expiresAt:text,fundsCaptured:{type:'boolean'},failureCode:text,authorization:authorizationSchema,
  quote:object({source:paymentMethodSchema,amountMinor:money,feeMinor:{const:0},totalMinor:money,currency:{const:'AED'},walletAccountId:text}),
  receipt:object({receiptNumber:text,amountMinor:money,feeMinor:{const:0},currency:{const:'AED'},balanceMinor:{type:'integer',minimum:0,maximum:1000000},capturedAt:text})},['id','accountId','ownerSub','version','state','approvalDigest','createdAt','expiresAt','fundsCaptured','quote']);
fundingSchema.properties.refundedMinor={type:'integer',minimum:0,maximum:100000000};fundingSchema.properties.refundState={enum:['PARTIALLY_REFUNDED','REFUNDED']};
const reversalReceiptSchema=object({refundId:text,paymentId:text,orderId:text,approvalDigest:revision,amountMinor:money,cumulativeMinor:money,currency:{const:'AED'},provider:{enum:['payments','dewa','etisalat','du','police','rta']},reversedAt:text,providerBalanceMinor:{type:'integer',minimum:0,maximum:100000000}},['refundId','paymentId','orderId','approvalDigest','amountMinor','cumulativeMinor','currency','provider','reversedAt']);
const refundSchema=object({id:text,accountId:text,ownerSub:text,version:{type:'integer',minimum:1},state:{enum:['AWAITING_APPROVAL','REVERSING','RECONCILIATION_REQUIRED','REFUNDED','FAILED','CANCELLED']},approvalDigest:revision,createdAt:text,expiresAt:text,failureCode:text,receipt:reversalReceiptSchema,
 quote:object({origin:{enum:['PAYMENT','WALLET_FUNDING']},orderId:text,paymentId:text,source:paymentMethodSchema,amountMinor:money,originalAmountMinor:money,expectedRefundedMinor:{type:'integer',minimum:0,maximum:100000000},currency:{const:'AED'},reason:text,originalApprovalDigest:revision,payable:payableSchema,admissionId:text},['origin','orderId','paymentId','source','amountMinor','originalAmountMinor','expectedRefundedMinor','currency','reason','originalApprovalDigest'])},['id','accountId','ownerSub','version','state','approvalDigest','createdAt','expiresAt','quote']);
const reversalSchema=object({refundId:text,approvalDigest:revision,state:{enum:['APPLIED','REJECTED']},receipt:reversalReceiptSchema,failureCode:text},['refundId','approvalDigest','state']);
const reversalOperations=[op('GET','/payment-reversals/{refundId}','getPaymentReversal',{reversal:reversalSchema},'Read an owned source reversal result after a lost response. No money return is inferred from a request alone.'),op('POST','/payment-reversals/{refundId}','applyPaymentReversal',{reversal:reversalSchema},'Fetch and verify the current gateway refund, reverse only the exact applied original payment, and persist an APPLIED or REJECTED decision atomically.',object({}))];
const cardBalances={type:'array',maxItems:100,items:object({sourceId:text,refundedMinor:{type:'integer',minimum:0,maximum:100000000},limitMinor:money,heldMinor:{type:'integer',minimum:0},spentMinor:{type:'integer',minimum:0},availableMinor:{type:'integer',minimum:0},currency:{const:'AED'}},['sourceId','limitMinor','heldMinor','spentMinor','availableMinor','currency'])};
const claimSchema=object({claimId:text,paymentId:text,provider:{enum:['rta','dewa','etisalat','du','police']},attemptId:text,reference:text,amountMinor:money,currency:{const:'AED'},orderId:text,captureAttemptId:text,state:{enum:['LEGACY_UNKNOWN','CLAIMED','APPLIED','RELEASED']},createdAt:text,receiptDigest:revision},['claimId','paymentId','provider','attemptId','reference','amountMinor','currency','orderId','captureAttemptId','state','createdAt']);
claimSchema.properties.reversedMinor={type:'integer',minimum:0,maximum:100000000};
const settlementStatus=op('GET','/settlement-attempts/{paymentId}','inspectSettlementAttempt',{settlement:object({attemptId:text,paymentId:text,state:{enum:['PENDING','APPLIED','RELEASED']},gatewayConfirmed:{type:'boolean'},failureCode:text},['attemptId','paymentId','state','gatewayConfirmed'])},'Inspect an owned persisted settlement fence and safely retry its gateway acknowledgement/release. Historical used-payment records can reconcile as applied.');
const admissionSchema=object({id:text,orderId:text,payable:payableSchema,approvalDigest:revision,sourceId:text,sourceVersion:{type:'integer',minimum:1},preparedAt:text,expiresAt:text,state:{enum:['PREPARED','ADMITTED','APPLIED','CANCELLED']},receipt:receiptSchema,targetReleased:{type:'boolean'}},['id','orderId','payable','approvalDigest','sourceId','sourceVersion','preparedAt','expiresAt','state']);
const admissionOperations=[
  op('POST','/payables/{payableId}/admissions/{admissionId}/finish','finishRechargeAdmission',{admission:admissionSchema},'Release only a recharge target fence after this exact applied credit is SETTLED at the gateway. Other obligation locks remain intact.',object({})),
  op('POST','/payables/{payableId}/admissions','preparePayableAdmission',{admission:admissionSchema},'Freeze current source terms for one owned stored order.',object({orderId:text,expectedRevision:revision,approvalDigest:revision,sourceId:text,sourceVersion:{type:'integer',minimum:1,maximum:1000000},expiresAt:text})),
  op('GET','/payables/{payableId}/admissions/{admissionId}','getPayableAdmission',{admission:admissionSchema},'Inspect the current provider reservation and receipt.'),
  op('POST','/payables/{payableId}/admissions/{admissionId}/admit','admitPayableCapture',{admission:admissionSchema},'Verify the current gateway CAPTURING order before admitting its exact capture.',object({})),
  op('POST','/payables/{payableId}/admissions/{admissionId}/cancel','cancelPayableAdmission',{admission:admissionSchema},'Release only after the gateway permanently fences capture as cancelled/failed.',object({})),
  op('POST','/payables/{payableId}/admissions/{admissionId}/payments','settleAdmittedPayable',{payable:payableSchema,receipt:receiptSchema},'Apply the exact admitted captured order through gateway settlement claims.',paymentProof),
];
const telecom = [
  ...reversalOperations,
  ...rechargeOperations,
  ...admissionOperations,
  settlementStatus,
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
    ...reversalOperations,
    ...rechargeOperations,
    ...admissionOperations,
    ...payableOperations,
    settlementStatus,
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
    ...reversalOperations,
    ...admissionOperations,
    settlementStatus,
    ...payableOperations,
    op('GET', '/consumption', 'getConsumption', { account: opaque, ecoStatus: text }, 'Read an account-owned smart meter and consumption snapshot.'),
    op('GET', '/bills', 'listUtilityBills', { bills: list }, 'Read this account’s utility bills.'),
    op('POST', '/bills/{billId}/payments', 'settleUtilityBill', { bill: opaque, receipt: opaque }, 'Settle a bill after checking its captured payment reference and amount.', paymentProof),
    op('POST', '/connections', 'activateConnection', { connection: opaque }, 'Activate a simulated utility connection for the current account.', object({ contractNumber: text })),
  ],
  etisalat: telecom, du: telecom,
  police: [
    ...reversalOperations,
    op('POST','/fine-selections','quoteFineSelection',{payable:payableSchema},'Review one to twenty distinct owned current fines for one vehicle; revisions, discounts and restrictions derive from source state.',paymentSchemas.fineSelection),
    ...admissionOperations,
    settlementStatus,
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
    op('GET','/payment-refunds','listPaymentRefunds',{refunds:{type:'array',maxItems:100,items:refundSchema}},'List owned original-source refund reviews, pending reversals and confirmed results.'),
    op('GET','/payment-refunds/{refundId}','getPaymentRefund',{refund:refundSchema},'Read current refund authority/outcome using its original identity.'),
    op('POST','/payment-refunds','createPaymentRefund',{refund:refundSchema},'Freeze original source, capture, current cumulative amount and reason. Full bill/fine cancellation or bounded partial unused-credit/funding reversal.',paymentSchemas.createRefund),
    op('POST','/payment-refunds/{refundId}/execute','executePaymentRefund',{refund:refundSchema},'Explicitly approve source reversal, then return confirmed value only to the original funding source.',paymentSchemas.executeOrder),
    op('POST','/payment-refunds/{refundId}/recover','recoverPaymentRefund',{refund:refundSchema},'Inspect the same provider reversal before completing its original-source refund. Unknown outcomes remain blocked.',paymentSchemas.recoverOrder),
    op('POST','/payment-refunds/{refundId}/cancel','cancelPaymentRefund',{refund:refundSchema},'Cancel only before reversal starts.',paymentSchemas.cancelOrder),
    op('GET','/checkout-groups','listCheckoutGroups',{groups:{type:'array',maxItems:100,items:groupSchema}},'List owned sequential checkout groups with authoritative child receipts and partial outcomes.'),
    op('GET','/checkout-groups/{groupId}','getCheckoutGroup',{group:groupSchema},'Inspect original child payments after reload or an uncertain response.'),
    op('POST','/checkout-groups','createCheckoutGroup',{group:groupSchema},'Freeze one selected source for up to ten current obligations. Already-paid items are excluded; no funds move.',paymentSchemas.createCheckoutGroup),
    op('POST','/checkout-groups/{groupId}/approve','approveCheckoutGroup',{group:groupSchema},'Explicitly approve this exact source and total for sequential child execution. No funds move.',paymentSchemas.approveOrder),
    op('POST','/checkout-groups/{groupId}/execute','executeCheckoutGroup',{group:groupSchema},'Authorize and pay each child sequentially; stop on failure/challenge/unknown and resume original children without recharging settled ones.',paymentSchemas.executeOrder),
    op('POST','/checkout-groups/{groupId}/cancel','cancelCheckoutGroup',{group:groupSchema},'Stop new group dispatch and cancel not-started child orders. Existing captures retain recovery; prior receipts remain.',paymentSchemas.cancelOrder),
    op('GET','/wallet-funding-orders','listWalletFundingOrders',{orders:{type:'array',items:fundingSchema,maxItems:100}},'List owned saved-card wallet funding reviews and confirmed credits.'),
    op('GET','/wallet-funding-orders/{orderId}','getWalletFundingOrder',{order:fundingSchema},'Read authoritative funding status after a lost response, without another credit.'),
    op('POST','/wallet-funding-orders','createWalletFundingOrder',{order:fundingSchema},'Review AED 1–500 from an owned saved card into this wallet, with zero fee and an AED 10000 wallet cap. No funds move.',paymentSchemas.createWalletFunding),
    op('POST','/wallet-funding-orders/{orderId}/approve','approveWalletFundingOrder',{order:fundingSchema},'Approve the exact source, version and amount; reserve finite issuer capacity only.',paymentSchemas.approveOrder),
    op('POST','/wallet-funding-orders/{orderId}/challenge','challengeWalletFundingOrder',{order:fundingSchema},'Only the signed-in owner may answer this order-bound demo card challenge.',paymentSchemas.challengeOrder),
    op('POST','/wallet-funding-orders/{orderId}/execute','executeWalletFundingOrder',{order:fundingSchema},'Capture the authorized card and credit its owner wallet atomically once.',paymentSchemas.executeOrder),
    op('POST','/wallet-funding-orders/{orderId}/cancel','cancelWalletFundingOrder',{order:fundingSchema},'Cancel before capture and release the finite card hold.',paymentSchemas.cancelOrder),
    op('POST','/payment-orders/{orderId}/execute','executeBillOrder',{order:reviewSchema},'Explicitly capture the exact approved hold and settle the provider-admitted bill or exact fine selection; unknown outcomes stay on the same order.',paymentSchemas.executeOrder),
    op('POST','/payment-orders/{orderId}/recover','recoverBillOrder',{order:reviewSchema},'Reconcile or resume the original admitted payment without another charge.',paymentSchemas.recoverOrder),
    op('POST','/charges/{chargeId}/settlement/claim','claimSettlement',{claim:claimSchema,charge:opaque},'Exact provider workload only. Admit one attempt against a current capture; current claim state is returned even on exact retries.',object({attemptId:text,reference:text,amountMinor:money})),
    op('POST','/charges/{chargeId}/settlement/ack','acknowledgeSettlement',{claim:claimSchema},'Exact provider workload only. Confirm a committed provider effect with its immutable receipt digest.',object({attemptId:text,claimId:text,receiptDigest:revision})),
    op('POST','/charges/{chargeId}/settlement/release','releaseSettlement',{claim:claimSchema},'Exact provider workload only. Release only after the provider has durably fenced the attempt as not applied. Applied/unknown claims cannot be blindly released.',object({attemptId:text,claimId:text,reason:{const:'NOT_APPLIED'}})),
    op('GET','/payment-orders','listAuthorizationOrders',{orders:{type:'array',items:reviewSchema,maxItems:100}},'List owned stored authorization reviews and current expiry/hold states; no capture.'),
    op('GET','/payment-orders/{orderId}','getAuthorizationOrder',{order:reviewSchema},'Inspect a current owned authorization review.'),
    op('POST','/payment-orders','createAuthorizationOrder',{order:reviewSchema},'Read source-owned terms, store an immutable review and reserve the obligation; no funds held until approval.',paymentSchemas.createOrder),
    op('POST','/payment-orders/{orderId}/approve','approveAuthorizationOrder',{order:reviewSchema},'Require explicit exact-review owner approval before finite wallet/card authorization. Capture requires a separate explicit bill execution.',paymentSchemas.approveOrder),
    op('POST','/payment-orders/{orderId}/challenge','answerAuthorizationChallenge',{order:reviewSchema},'The signed-in owner answers this exact synthetic card challenge; unattended actors are denied.',paymentSchemas.challengeOrder),
    op('POST','/payment-orders/{orderId}/cancel','cancelAuthorizationOrder',{order:reviewSchema},'Cancel a current authorization review and void its holds without a debit.',paymentSchemas.cancelOrder),
    op('GET', '/payment-methods', 'listPaymentMethods', { methods: { type: 'array', items: paymentMethodSchema, maxItems: 101 }, dependencies: { type: 'array', items: object({resourceType:{enum:['METHOD','BILLER']},resourceId:text,dependentKind:{enum:['ORDER','HOLD','MANDATE']},dependentId:text,status:{const:'ACTIVE'}}),maxItems:200 }, defaultMethodId: text, presets: { type: 'array', items: opaque },cardBalances }, 'List owned synthetic funding methods. Wallet/card management does not move money.'),
    op('POST', '/payment-methods', 'createPaymentMethod', { method: paymentMethodSchema }, 'Save an owned synthetic card preset; never submit card numbers or security codes.', paymentSchemas.createMethod),
    op('POST', '/payment-methods/status', 'changePaymentMethodStatus', { method: paymentMethodSchema }, 'Version-checked card disable/reactivate/tombstone; no automatic funding fallback.', paymentSchemas.methodStatus),
    op('POST', '/payment-methods/default', 'setDefaultPaymentMethod', { defaultMethodId: text }, 'Select an active default for future drafts, without changing existing approvals.', paymentSchemas.defaultMethod),
    op('GET', '/billing-accounts', 'listBillingAccounts', { billingAccounts: { type: 'array', items: billingAccountSchema, maxItems: 100 }, dependencies: { type: 'array', items: object({resourceType:{enum:['METHOD','BILLER']},resourceId:text,dependentKind:{enum:['ORDER','HOLD','MANDATE']},dependentId:text,status:{const:'ACTIVE'}}),maxItems:200 } }, 'List owned linked biller references.'),
    op('POST', '/billing-accounts', 'linkBillingAccount', { billingAccount: billingAccountSchema }, 'Verify provider ownership then link a synthetic biller account.', paymentSchemas.linkAccount),
    op('POST', '/billing-accounts/archive', 'archiveBillingAccount', { billingAccount: billingAccountSchema }, 'Archive an owned biller link while retaining its historical reference.', paymentSchemas.archiveAccount),
    op('GET', '/wallet', 'getWallet', { balance: { type: 'number' }, balanceMinor: { type: 'integer', minimum: 0 }, heldMinor: { type: 'integer', minimum: 0 }, availableMinor: { type: 'integer', minimum: 0 }, currency: { const: 'AED' } }, 'Read posted, held and available AED wallet funds from the balanced journal.'),
    op('GET', '/transactions', 'listTransactions', { transactions: list, count: { type: 'integer' } }, 'List the latest 100 account-owned payment transactions.'),
    op('POST', '/topups', 'topUpWallet', { transaction: opaque, newBalance: { type: 'number' } }, 'Compatibility top-up: a flag resolves to one persisted finite demo card. Disabled/removed/exhausted cards cannot be replaced implicitly; saved-card funding reviews are the new interactive API.', object({ amountMinor: money, source: { enum: ['demo_approved', 'demo_declined'] } })),
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
  return { openapi: '3.1.0', info: { title: `${providerNames[provider]} Simulator`, version: provider === 'payments' ? '2.10.0' : provider==='rta'?'2.3.0':provider==='police'?'2.6.0':['etisalat','du'].includes(provider)?'2.6.0':provider==='dewa'?'2.5.0' : '2.0.0', description: 'Local synthetic API. Signed interactive user identity or broker-issued user token with current exact-operation grant required. JWT subject owns the account; caller user headers do not grant authority. A separate read-only settlement machine lane retrieves captured charge proofs. Legacy fixture mode is outside this reference security profile.' },
    servers: [{ url: `http://localhost:${4101 + providerIds.indexOf(provider)}` }], security: [{ accessToken: [] }],
    paths, components: { securitySchemes: { accessToken: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' } },
      responses: { Unauthorized: { description: 'Missing or invalid Keycloak access token' }, Error: { description: 'Validation, ownership, delegation, payment, conflict or availability error', content: { 'application/json': { schema: object({ success: { const: false }, error: { type: 'string' }, code: { type: 'string' } }) } } } } },
    'x-demo-provider': provider, 'x-idempotency-policy': 'Persisted per account for the lifetime of the demo database. Reusing a key with a different method, path or body returns 409.' };
}
