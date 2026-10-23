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
const actionSchemas: Record<string, Schema> = {
  activate_parking: object({ selectedChoice: id, zoneId: id, durationHours: hours, plateNumber: text(128) }),
  extend_parking: object({ ticketId: id, additionalHours: hours }, ['ticketId']),
  pay_utilities_bill: object({ billId: id }), pay_police_fines: object({ fineIds: list(id) }),
  confirm_smartcity_checkout: object(), confirm_movein: object({ contractNumber: id, unit: text() }),
  book_ride: object({ selectedChoice: id, driverId: id }), order_food: object({ selectedChoice: id }),
  confirm_composite_checkout: object(), topup_wallet: object({ amount: moneySchema }, ['amount']),
  update_preferences: object({ ...preferencesSchema.properties }),
};
for (const [action, schema] of Object.entries(actionSchemas)) {
  // Renderers may echo the advertised action. It must agree with the envelope action.
  schema.properties = { ...schema.properties, action: { const: action } };
}
const coreIntent = object({ sessionId, text: text(4000), handshake }, ['sessionId', 'text']);
const coreAction = object({ sessionId, action: text(128), payload: { type: 'object' } }, ['sessionId', 'action', 'payload']);

type Route = { owner: string; method: string; path: string; aliases?: string[]; schema: Schema; tool?: string };
const routes: Route[] = [];
const route = (owner: string, method: string, path: string, schema: Schema = object(), aliases: string[] = [], tool?: string) =>
  routes.push({ owner, method, path, schema, aliases, tool });
for (const owner of ['service-ride', 'service-food', 'service-wallet', 'service-profile', 'service-catalog', 'agent-core']) {
  route(owner, 'GET', '/health');
  if (owner !== 'agent-core' && owner !== 'service-catalog') route(owner, 'GET', '/mcp');
}
route('agent-core', 'POST', '/api/a2ui/intent', coreIntent);
route('agent-core', 'POST', '/api/a2ui/action', coreAction);
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
route('service-food', 'POST', '/utilities/pay', object({ billId: id }, ['billId']), ['/bill/pay'], 'utilities_payBill');
route('service-food', 'GET', '/utilities/eco-advice', object(), ['/eco-advice'], 'utilities_getEcoAdvice');
route('service-wallet', 'GET', '/wallet/balance', object(), [], 'wallet_getBalance');
route('service-wallet', 'GET', '/wallet/transactions', object(), [], 'wallet_getTransactions');
route('service-wallet', 'POST', '/wallet/pay', object({ amount: moneySchema, purpose: text(), referenceId: id, currency: currency('USD') }, ['amount', 'purpose']), [], 'wallet_authorizePayment');
route('service-wallet', 'POST', '/wallet/topup', object({ amount: moneySchema, source: text(), currency: currency('USD') }, ['amount']), [], 'wallet_topup');
route('service-wallet', 'GET', '/fines/check', object({ plateNumber: text(128) }), ['/fines'], 'citizenpay_getFines');
route('service-wallet', 'POST', '/fines/pay', object({ fineIds: list(id) }, ['fineIds']), ['/fines/settle'], 'citizenpay_payFines');
route('service-wallet', 'POST', '/pay/unified', object({ items: list(object({ agency: text(128), purpose: text(), amount: moneySchema }, ['agency', 'purpose', 'amount'])), currency: currency('AED') }, ['items']), ['/pay/multi-agency'], 'citizenpay_unifiedPay');
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
function find(owner: string, method: string, path: string): Route | undefined {
  return routes.find(route => route.owner === owner && route.method === method &&
    [route.path, ...(route.aliases || [])].some(template => template.includes('{')
      ? path.startsWith(template.slice(0, template.indexOf('{'))) && !path.slice(template.indexOf('{')).includes('/')
      : path === template));
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
    const key = route.path.slice(route.path.indexOf('{') + 1, -1);
    const raw = path.slice(route.path.indexOf('{'));
    try { input = { [key]: decodeURIComponent(raw) }; } catch { return invalidInput(); }
    if (Object.keys(query).length) return invalidInput('Query parameters are not accepted on this resource route');
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
