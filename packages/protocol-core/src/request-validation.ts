import { historyKindSchema,historyIdSchema,historyCursorSchema } from './payment-history.ts';
import { recoverySchemas,recoveryInspectionIdSchema } from './payment-reconciliation.ts';
import { mandateSchemas } from './payment-mandates.ts';
import { fineSelectionItemsSchema, paymentSchemas, paymentObject, withPaymentAccount, withOrderId } from './payments.ts';
import { Ajv, type ValidateFunction } from 'ajv';

type Schema = Record<string, any>;
export type ApiResult = { status: number; data: any };
export const MAX_MONEY = 1_000_000; // Demo transaction/balance ceiling, not agency policy.
export const MAX_DURATION_HOURS = 720;
const text = (maxLength = 500): Schema => ({ type: 'string', minLength: 1, maxLength, pattern: '\\S' });
const id: Schema = { type: 'string', minLength: 1, maxLength: 128, pattern: '^[A-Za-z0-9][A-Za-z0-9_.:-]*$' };
const list = (items: Schema, maxItems = 100): Schema => ({ type: 'array', items, minItems: 1, maxItems, uniqueItems: true });
const object = (properties: Record<string, Schema> = {}, required: string[] = []): Schema =>
  ({ type: 'object', properties, required, additionalProperties: false });
export const moneySchema: Schema = { type: 'number', minimum: 0.01, maximum: MAX_MONEY, multipleOf: 0.01 };
const hours: Schema = { type: 'integer', minimum: 1, maximum: MAX_DURATION_HOURS };
const currency = (value: string): Schema => ({ type: 'string', const: value });
export const preferencesSchema = object({
  dietary: { ...list({ enum: ['Vegetarian', 'Vegan', 'Gluten-Free', 'Halal', 'Spicy Lover', 'Spicy'] }, 10), minItems: 0 },
  mobility: object({ preferredTier: id, preferredTierName: text(100), ecoFriendlyOnly: { type: 'boolean' }, quietRide: { type: 'boolean' } }),
  ui: object({ theme: { enum: ['light', 'dark', 'system'] }, denseMode: { type: 'boolean' },
    accentColor: { type: 'string', pattern: '^#[a-fA-F0-9]{6}$' } }),
  conciergeTone: { enum: ['concise', 'friendly', 'formal', 'vip'] },
});
const handshake = object({
  platform: { enum: ['react', 'angular', 'flutter', 'web_responsive'] },
  viewport: object({ width: { type: 'integer', minimum: 1, maximum: 20000 },
    height: { type: 'integer', minimum: 1, maximum: 20000 }, category: { enum: ['mobile', 'tablet', 'desktop'] } }, ['width', 'height', 'category']),
  supportedComponents: list(text(64), 100), locale: text(64),
}, ['platform', 'viewport', 'supportedComponents']);
const sessionId: Schema = { type: 'string', pattern: '^[a-zA-Z0-9_-]{8,128}$' };
const paymentSurfaceTerms={flowId:id,orderId:id,expectedVersion:{type:'integer',minimum:1,maximum:1000000},approvalDigest:{type:'string',pattern:'^[a-f0-9]{64}$'}};
const actionSchemas: Record<string, Schema> = {
  payment_surface_choose:object({flowId:id,selectedChoice:id},['flowId','selectedChoice']),
  payment_surface_refresh:object({flowId:id,selectedChoice:id},['flowId']),
  payment_surface_cancel:object({flowId:id,selectedChoice:id},['flowId']),
  payment_surface_authorize:paymentObject(paymentSurfaceTerms),
  payment_surface_execute:paymentObject(paymentSurfaceTerms),
  payment_surface_challenge:paymentObject({...paymentSurfaceTerms,challengeId:id,decision:{enum:['APPROVE','REJECT']}}),
  activate_parking: object({ selectedChoice: id, zoneId: id, durationHours: hours, plateNumber: text(128) }),
  extend_parking: object({ ticketId: id, additionalHours: hours }, ['ticketId']),
  pay_utilities_bill: object({ billId: id,expectedPayableRevision:{type:'string',pattern:'^[a-f0-9]{64}$'},expectedAmountMinor:{type:'integer',minimum:1,maximum:100000000} }), pay_police_fines: object({ fineIds: {...list(id,20),minItems:1,uniqueItems:true},expectedPayables:fineSelectionItemsSchema,expectedAmountMinor:{type:'integer',minimum:1,maximum:100000000} }, ['fineIds']),
  confirm_smartcity_checkout: object({expectedPayables:{type:'array',minItems:0,maxItems:30,items:paymentObject({provider:{enum:['dewa','police']},payableId:id,expectedRevision:{type:'string',pattern:'^[a-f0-9]{64}$'}})},expectedAmountMinor:{type:'integer',minimum:1,maximum:100000000},targetReference:text(160),expectedTargetVersion:{type:'integer',minimum:1,maximum:1000000}}), confirm_movein: object({ contractNumber: id, unit: text() }),
  book_ride: object({ selectedChoice: id, driverId: id }), order_food: object({ selectedChoice: id }),
  confirm_composite_checkout: object(), topup_wallet: object({ amount: moneySchema }, ['amount']),
  pay_telecom_bill: object({ provider: { enum: ['etisalat', 'du'] }, billId: id,expectedPayableRevision:{type:'string',pattern:'^[a-f0-9]{64}$'},expectedAmountMinor:{type:'integer',minimum:1,maximum:100000000} }, ['provider','billId']),
  update_preferences: object({ ...preferencesSchema.properties }),
};
for (const [action, schema] of Object.entries(actionSchemas)) {
  // Renderers may echo the advertised action. It must agree with the envelope action.
  schema.properties = { ...schema.properties, action: { const: action } };
}
const coreIntent = object({ sessionId, accountId: id, text: text(4000), handshake }, ['sessionId', 'text']);
const coreAction = object({ sessionId, accountId: id, surfaceRevision: { type: 'string', pattern: '^[0-9a-f-]{36}$' }, action: text(128), payload: { type: 'object' } }, ['sessionId', 'surfaceRevision', 'action', 'payload']);
const coreTts = object({ text: text(480), voice: { enum: ['Jasper','Bruno','Hugo','Luna'] }, speed: { type: 'number', minimum: 0.8, maximum: 1.2 }, language: { enum: ['en-US','ar-AE'] } }, ['text']);

type Route = { owner: string; method: string; path: string; aliases?: string[]; schema: Schema; tool?: string };
const routes: Route[] = [];
const route = (owner: string, method: string, path: string, schema: Schema = object(), aliases: string[] = [], tool?: string) =>
  routes.push({ owner, method, path, schema, aliases, tool });
for (const owner of ['service-ride', 'service-food', 'service-wallet', 'service-profile', 'service-catalog', 'agent-core']) {
  route(owner, 'GET', '/health');
  if (owner !== 'agent-core' && owner !== 'service-catalog') route(owner, 'GET', '/mcp');
}
route('agent-core', 'POST', '/api/a2ui/intent', coreIntent);
route('agent-core', 'POST', '/api/manual/prepare', object({ sessionId, accountId: id, serviceId: { enum: ['parking','salik','utilities','fines','wallet','housing','etisalat','du','ride','food','profile'] } }, ['sessionId','serviceId']));
route('agent-core', 'POST', '/api/a2ui/action', coreAction);
route('agent-core', 'POST', '/api/a2ui/cancel', object({ sessionId, accountId: id, surfaceRevision: coreAction.properties.surfaceRevision }, ['sessionId','surfaceRevision']));
route('agent-core', 'GET', '/api/services', object({ accountId: id }));
route('agent-core', 'GET', '/api/payments/overview', object({ accountId: id }, ['accountId']));
for(const path of ['eligibility','lifecycle'])route('agent-core','GET',`/api/payments/${path}`,object({accountId:id},['accountId']));
route('agent-core','GET','/api/payments/wallet-funding-orders',object({accountId:id},['accountId']));
route('agent-core','POST','/api/payments/wallet-funding-orders',withPaymentAccount(paymentSchemas.createWalletFunding));
for(const [action,schema] of Object.entries({approve:paymentSchemas.approveOrder,challenge:paymentSchemas.challengeOrder,cancel:paymentSchemas.cancelOrder,execute:paymentSchemas.executeOrder}))route('agent-core','POST',`/api/payments/wallet-funding-orders/${action}`,withPaymentAccount(withOrderId(schema)));
route('agent-core','POST','/api/payments/refunds',withPaymentAccount(paymentSchemas.createRefund));
for(const [action,schema] of Object.entries({execute:paymentSchemas.executeOrder,recover:paymentSchemas.recoverOrder,cancel:paymentSchemas.cancelOrder}))route('agent-core','POST',`/api/payments/refunds/${action}`,withPaymentAccount(withOrderId(schema)));
route('agent-core','POST','/api/payments/checkout-groups',withPaymentAccount(paymentSchemas.createCheckoutGroup));
for(const [action,schema] of Object.entries({approve:paymentSchemas.approveOrder,execute:paymentSchemas.executeOrder,cancel:paymentSchemas.cancelOrder}))route('agent-core','POST',`/api/payments/checkout-groups/${action}`,withPaymentAccount(withOrderId(schema)));
route('agent-core','GET','/api/payments/mandates',object({accountId:id},['accountId']));
route('agent-core','GET','/api/payments/automation-inbox',object({accountId:id},['accountId']));
route('agent-core','POST','/api/payments/mandates/pause-all',withPaymentAccount(mandateSchemas.pauseAll));
route('agent-core','GET','/api/payments/automation-kill-switch',object({accountId:id},['accountId']));
route('agent-core','POST','/api/payments/automation-kill-switch',withPaymentAccount(paymentObject({engaged:{type:'boolean'},reason:{type:'string',maxLength:120}},['engaged'])));
route('agent-core','POST','/api/payments/mandates',withPaymentAccount(mandateSchemas.create));
for(const [action,schema] of Object.entries({revise:mandateSchemas.revise,approve:mandateSchemas.approve,revoke:mandateSchemas.revoke,pause:mandateSchemas.pause,resume:mandateSchemas.resume,skipNext:mandateSchemas.skipNext}))route('agent-core','POST',`/api/payments/mandates/${action}`,withPaymentAccount(paymentObject({...schema.properties,mandateId:id},[...schema.required,'mandateId'])));
route('agent-core','GET','/api/payments/mandates/history',object({accountId:id,mandateId:id},['accountId','mandateId']));
route('agent-core','GET','/api/payments/mandates/preview',object({accountId:id,mandateId:id},['accountId','mandateId']));
route('agent-core','GET','/api/payments/orders',object({accountId:id},['accountId']));
for(const path of ['history','statement'])route('agent-core','GET',`/api/payments/${path}`,object({accountId:id,cursor:historyCursorSchema},['accountId']));
route('agent-core','GET','/api/payments/history/detail',object({accountId:id,kind:historyKindSchema,operationId:historyIdSchema},['accountId','kind','operationId']));
route('agent-core','GET','/api/payments/reconciliation',object({accountId:id,cursor:{type:'string',minLength:1,maxLength:200,pattern:'^(PAYMENT|FUNDING|REFUND|LEGACY):[A-Za-z0-9_.:-]+$'}},['accountId']));
route('agent-core','GET','/api/payments/reconciliation/inspection',object({accountId:id,inspectionId:recoveryInspectionIdSchema},['accountId','inspectionId']));
route('agent-core','GET','/api/payments/reconciliation/audit',object({accountId:id,...recoverySchemas.inspect.properties},['accountId','kind','operationId']));
route('agent-core','POST','/api/payments/reconciliation/inspect',withPaymentAccount(recoverySchemas.inspect));
route('agent-core','POST','/api/payments/reconciliation/act',withPaymentAccount(paymentObject({...recoverySchemas.act.properties,inspectionId:recoveryInspectionIdSchema})));
route('agent-core','GET','/api/payments/legacy-status',object({accountId:id,paymentId:id},['accountId','paymentId']));
for (const [path, schema] of Object.entries({
  methods: paymentSchemas.createMethod, 'methods/status': paymentSchemas.methodStatus, 'methods/default': paymentSchemas.defaultMethod,
  'billing-accounts': paymentSchemas.linkAccount, 'billing-accounts/archive': paymentSchemas.archiveAccount,
})) route('agent-core', 'POST', `/api/payments/${path}`, withPaymentAccount(schema));
route('agent-core','POST','/api/payments/recharge-preview',withPaymentAccount(paymentSchemas.rechargePreview));
route('agent-core','POST','/api/payments/fine-selection-preview',withPaymentAccount(paymentSchemas.fineSelectionPreview,false));
route('agent-core', 'POST', '/api/payments/preview', withPaymentAccount(paymentSchemas.preview, false));
route('agent-core','POST','/api/payments/orders',withPaymentAccount(paymentSchemas.createOrder));
route('agent-core','POST','/api/payments/orders/approve',withPaymentAccount(withOrderId(paymentSchemas.approveOrder)));
route('agent-core','POST','/api/payments/orders/challenge',withPaymentAccount(withOrderId(paymentSchemas.challengeOrder)));
route('agent-core','POST','/api/payments/orders/cancel',withPaymentAccount(withOrderId(paymentSchemas.cancelOrder)));
route('agent-core','POST','/api/payments/orders/execute',withPaymentAccount(withOrderId(paymentSchemas.executeOrder)));
route('agent-core','POST','/api/payments/orders/recover',withPaymentAccount(withOrderId(paymentSchemas.recoverOrder)));
route('agent-core', 'POST', '/api/a2ui/tts', coreTts);
route('agent-core', 'GET', '/api/voice/config', object());
route('agent-core', 'POST', '/api/voice/transcribe', object({ audioBase64: { type: 'string', minLength: 16, maxLength: 60000 }, format: { enum: ['audio/webm','audio/ogg','audio/mp4','audio/wav'] }, language: { enum: ['en-US','ar-AE'] } }, ['audioBase64','format']));
for (const path of ['/api/auth/config', '/api/accounts', '/api/sessions']) route('agent-core', 'GET', path, object({ accountId: id }));
route('agent-core', 'GET', '/api/sessions/{sessionId}', object({ sessionId, accountId: id }, ['sessionId']));
route('agent-core', 'DELETE', '/api/sessions/{sessionId}', object({ sessionId }, ['sessionId']));
route('service-ride', 'GET', '/rides/options', object({ destination: text() }), [], 'ride_getOptions');
route('service-ride', 'POST', '/rides/book', object({ driverId: id, pickup: text(), dropoff: text() }, ['driverId']), [], 'ride_bookCab');
route('service-ride', 'GET', '/rides/track/{bookingId}', object({ bookingId: id }, ['bookingId']), [], 'ride_trackStatus');
route('service-ride', 'GET', '/mobility/parking/zones', object(), ['/parking/zones'], 'mobility_getParkingZones');
route('service-ride', 'POST', '/mobility/parking/activate', object({ zoneId: id, durationHours: hours, plateNumber: text(128) }, ['zoneId', 'durationHours', 'plateNumber']), ['/parking/activate'], 'mobility_activateParking');
route('service-ride', 'POST', '/mobility/parking/extend', object({ ticketId: id, additionalHours: hours }, ['ticketId', 'additionalHours']), ['/parking/extend'], 'mobility_extendParking');
route('service-ride', 'GET', '/mobility/parking/active', object(), ['/parking/active'], 'mobility_getActiveParking');
route('service-ride', 'GET', '/mobility/salik/balance', object(), ['/salik/balance'], 'mobility_getTollBalance');
route('service-ride', 'POST', '/mobility/salik/recharge', object({ amount: moneySchema, currency: currency('AED') }, ['amount']), ['/salik/recharge'], 'mobility_rechargeToll');
route('service-ride', 'GET', '/mobility/salik/passings', object(), ['/salik/passings'], 'mobility_getTollPassings');
route('service-ride', 'GET', '/mobility/ev/chargers', object(), ['/ev/chargers'], 'mobility_getEVChargers');
route('service-ride', 'POST', '/mobility/ev/start', object({ chargerId: id, plateNumber: text(128) }, ['chargerId', 'plateNumber']), ['/ev/start'], 'mobility_startEVSession');
route('service-food', 'GET', '/restaurants/search', object({ query: text() }), [], 'food_searchRestaurants');
route('service-food', 'POST', '/orders/create', object({ restaurantId: id, items: list(id), deliveryAddress: text() }, ['restaurantId', 'items']), [], 'food_createOrder');
route('service-food', 'GET', '/orders/track/{orderId}', object({ orderId: id }, ['orderId']), [], 'food_trackOrder');
route('service-food', 'GET', '/utilities/consumption', object(), ['/consumption'], 'utilities_getConsumption');
route('service-food', 'GET', '/utilities/bill', object(), ['/bill'], 'utilities_getBill');
route('service-food', 'POST', '/utilities/pay', object({ billId: id,expectedPayableRevision:{type:'string',pattern:'^[a-f0-9]{64}$'},expectedAmountMinor:{type:'integer',minimum:1,maximum:100000000} }, ['billId']), ['/bill/pay'], 'utilities_payBill');
route('service-food', 'GET', '/utilities/eco-advice', object(), ['/eco-advice'], 'utilities_getEcoAdvice');
route('service-wallet', 'GET', '/wallet/balance', object(), [], 'wallet_getBalance');
route('service-wallet', 'GET', '/wallet/transactions', object(), [], 'wallet_getTransactions');
route('service-wallet', 'POST', '/wallet/pay', object({ amount: moneySchema, purpose: text(), referenceId: id, currency: currency('USD') }, ['amount', 'purpose']), [], 'wallet_authorizePayment');
route('service-wallet', 'POST', '/wallet/topup', object({ amount: moneySchema, source: text(), currency: currency('USD') }, ['amount']), [], 'wallet_topup');
route('service-wallet', 'GET', '/fines/check', object({ plateNumber: text(128) }), ['/fines'], 'citizenpay_getFines');
route('service-wallet', 'POST', '/fines/pay', object({ fineIds: {...list(id,20),minItems:1,uniqueItems:true},expectedPayables:fineSelectionItemsSchema,expectedAmountMinor:{type:'integer',minimum:1,maximum:100000000} }, ['fineIds']), ['/fines/settle'], 'citizenpay_payFines');
route('service-wallet', 'POST', '/pay/unified', { ...object({ items: list(object({ agency: text(128), purpose: text(), amount: moneySchema }, ['agency', 'purpose', 'amount'])), currency: currency('AED'),methodId:id,expectedMethodVersion:{type:'integer',minimum:1,maximum:1000000} }, ['items']),dependencies:{methodId:['expectedMethodVersion'],expectedMethodVersion:['methodId']} }, ['/pay/multi-agency'], 'citizenpay_unifiedPay');
for(const provider of ['etisalat','du']){
  route('service-telecom','GET',`/telecom/${provider}/prepaid`,object());
  route('service-telecom','POST',`/telecom/${provider}/prepaid/recharges`,object({lineId:id,amountMinor:{type:'integer',minimum:1,maximum:100000000},expectedTargetVersion:{type:'integer',minimum:1,maximum:1000000}},['lineId','amountMinor','expectedTargetVersion']));
  for(const resource of ['subscriptions','plans','bills'])route('service-telecom','GET',`/telecom/${provider}/${resource}`,object());
  route('service-telecom','POST',`/telecom/${provider}/bills/{billId}/payments`,object({billId:id,expectedPayableRevision:{type:'string',pattern:'^[a-f0-9]{64}$'},expectedAmountMinor:{type:'integer',minimum:1,maximum:100000000}}));
}
route('service-profile', 'GET', '/profile', object(), [], 'profile_getProfile');
route('service-profile', 'GET', '/profile/preferences', object(), [], 'profile_getPreferences');
route('service-profile', 'POST', '/profile/preferences', preferencesSchema, [], 'profile_updatePreferences');
route('service-profile', 'GET', '/profile/prompt-context', object(), [], 'profile_getPromptContext');
route('service-catalog', 'GET', '/housing/ejari', object(), ['/ejari'], 'housing_getEjari');
route('service-catalog', 'POST', '/housing/move-in', object({ contractNumber: id }, ['contractNumber']), ['/move-in'], 'housing_moveIn');
for (const path of ['/miniapps', '/tools', '/capabilities']) route('service-catalog', 'GET', path);
route('service-catalog', 'GET', '/miniapps/{id}', object({ id }, ['id']));
route('service-catalog', 'GET', '/capabilities/{id}', object({ id }, ['id']));

const ajv = new Ajv({ strict: true, strictNumbers: true, coerceTypes: false,
  useDefaults: false, removeAdditional: false, multipleOfPrecision: 10 });
const validators = new WeakMap<Schema, ValidateFunction>();
export function invalidInput(message = 'Invalid request input'): ApiResult {
  return { status: 400, data: { error: message, code: 'VALIDATION_ERROR' } };
}
export function toMinor(amount: number): number {
  if (typeof amount !== 'number' || !Number.isFinite(amount) || amount < 0 || amount > MAX_MONEY ||
      !/^\d+(\.\d{1,2})?$/.test(String(amount))) throw new RangeError('Invalid minor-unit money amount');
  const [whole, fraction = ''] = String(amount).split('.');
  return Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
}
export function fromMinor(amount: number): number {
  if (!Number.isSafeInteger(amount) || amount < 0 || amount > MAX_MONEY * 100) throw new RangeError('Money balance exceeds demo limit');
  return amount / 100;
}
function jsonShape(value: unknown, depth = 0): boolean {
  if (depth > 20) return false;
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (Array.isArray(value)) return value.length <= 1000 && value.every(item => jsonShape(item, depth + 1));
  if (!value || typeof value !== 'object' || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) return false;
  return Object.entries(value).every(([key, item]) => !['__proto__', 'constructor', 'prototype'].includes(key) && jsonShape(item, depth + 1));
}
function monetaryPrecision(schema: Schema, value: any): boolean {
  if (schema.multipleOf === 0.01) { try { toMinor(value); } catch { return false; } }
  if (schema.properties && value) for (const [key, child] of Object.entries(schema.properties)) {
    if (Object.hasOwn(value, key) && !monetaryPrecision(child as Schema, value[key])) return false;
  }
  if (schema.items && Array.isArray(value)) return value.every(item => monetaryPrecision(schema.items, item));
  return true;
}
function validate(schema: Schema, value: unknown): boolean {
  let compiled = validators.get(schema);
  if (!compiled) { compiled = ajv.compile(schema); validators.set(schema, compiled); }
  return compiled(value) && monetaryPrecision(schema, value);
}
/** Match a route template with one or more `{param}` segments; returns raw (undecoded) captures. */
export function matchTemplate(template: string, path: string): Record<string, string> | undefined {
  const keys: string[] = [];
  const parts = template.split(/\{([^}]+)\}/);
  let source = '';
  parts.forEach((part, index) => {
    if (index % 2 === 0) source += part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    else { keys.push(part); source += '([^/]+)'; }
  });
  const match = new RegExp(`${source}$`).exec(path);
  if (!match) return undefined;
  const params: Record<string, string> = {};
  keys.forEach((key, index) => { params[key] = match[index + 1]; });
  return params;
}
function find(owner: string, method: string, path: string): Route | undefined {
  return routes.find(route => route.owner === owner && route.method === method &&
    [route.path, ...(route.aliases || [])].some(template => matchTemplate(template, path) !== undefined));
}
export function requestSchema(owner: string, method: string, path: string): Schema {
  const found = find(owner, method, path);
  if (!found) throw new Error(`Missing contract: ${owner} ${method} ${path}`);
  return found.schema;
}
export function toolSchema(owner: string, tool: string): Schema | undefined {
  return routes.find(route => route.owner === owner && route.tool === tool)?.schema;
}
export function validateRequest(owner: string, method: string, path: string, query: unknown, body: unknown): ApiResult | undefined {
  if (!jsonShape(body) || !jsonShape(query) || !body || !query || Array.isArray(body) || Array.isArray(query) ||
      typeof body !== 'object' || typeof query !== 'object') return invalidInput();
  const route = find(owner, method, path);
  if (!route) return undefined; // Unknown routes retain the handler's 404 behavior.
  let input = method === 'POST' ? body : query;
  if (route.path.includes('{')) {
    const raw = matchTemplate(route.path, path) ?? (route.aliases||[]).map(a=>matchTemplate(a,path)).find(Boolean)!;
    const sessionRead=owner==='agent-core'&&method==='GET'&&route.path==='/api/sessions/{sessionId}';
    try {
      const params: Record<string,string> = {};
      for (const [key, value] of Object.entries(raw)) params[key] = decodeURIComponent(value);
      input = {...(method === 'POST' ? body as Record<string, unknown> : (sessionRead?query:{})),...params};
    } catch { return invalidInput(); }
    if (Object.keys(query).length&&(!sessionRead||Object.keys(query).some(k=>k!=='accountId'))) return invalidInput('Query parameters are not accepted on this resource route');
  }
  if (!validate(route.schema, input) || (method === 'POST' && Object.keys(query).length) ||
      (method === 'GET' && Object.keys(body).length)) return invalidInput();
  if (owner === 'agent-core' && path === '/api/a2ui/action') {
    const { action, payload } = body as { action: string; payload: unknown };
    const schema = Object.hasOwn(actionSchemas, action) ? actionSchemas[action] : undefined;
    if (schema && !validate(schema, payload)) return invalidInput('Invalid action payload');
  }
  return undefined;
}
