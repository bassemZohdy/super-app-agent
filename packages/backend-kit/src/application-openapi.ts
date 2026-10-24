// OpenAPI 3.1 description of the integrated application APIs (service-ride, service-food, service-wallet,
// service-catalog, service-telecom, service-profile). The document is built from APPLICATION_OPERATIONS, which
// mirrors the handlers in ./application.ts (integratedRequest and its legacy GET fallthrough). Request contracts
// for validated routes are read from protocol-core's route table via requestSchema, so the two cannot drift silently.
// The checked-in copy lives at packages/backend-kit/openapi/application-apis.openapi.json and is regenerated with
// `npm run openapi:generate:apps`.
//
// Scope: only the integrated (PROVIDER_INTEGRATION=true) surface, which is the only mode that enforces bearer auth.
// The legacy fixture mode, /health, /mcp and agent-core routes are not documented here.
import { requestSchema } from '../../protocol-core/src/request-validation.ts';

export const APPLICATION_SERVICES = {
  'service-ride': 4001,
  'service-food': 4002,
  'service-wallet': 4003,
  'service-catalog': 4004,
  'service-profile': 4005,
  'service-telecom': 4006,
} as const;
export type ApplicationService = keyof typeof APPLICATION_SERVICES;

type JsonSchema = Record<string, unknown>;
type ResponseSpec = { description: string; keys: string[] };
type ErrorStatuses = Partial<Record<'404' | '409' | '502', string>>;

export type ApplicationOperation = {
  service: ApplicationService;
  method: 'GET' | 'POST';
  path: string;
  operationId: string;
  summary: string;
  response: ResponseSpec;
  // Concrete path handed to requestSchema when it differs from the OpenAPI template (e.g. telecom provider).
  contract?: string;
  // Body schema for routes the validator does not cover (telecom passthroughs, /accounts).
  manualSchema?: JsonSchema;
  bodyRequired?: boolean;
  errors?: ErrorStatuses;
};

const ok = (description: string, keys: string[] = []): ResponseSpec => ({ description, keys });
const RAW = 'Provider data passed through unchanged. Shape is defined by the provider simulator contract.';
const ENVELOPE = (description: string, keys: string[]) => ok(description, ['success', ...keys]);
const providerBody = (required: string[], properties: Record<string, JsonSchema>) =>
  ({ type: 'object', required, properties, additionalProperties: false }) as JsonSchema;
const TELECOM_PROVIDER = ['etisalat', 'du'];
// Passthrough GETs forward no query parameters to the provider.
const NO_QUERY: JsonSchema = { type: 'object', properties: {} };
const PAYMENT_ERRORS: ErrorStatuses = { '409': 'Payable or checkout terms changed, or the request reuses an ID with different terms.', '502': 'Payment was captured but settlement needs reconciliation.' };

export const APPLICATION_OPERATIONS: ApplicationOperation[] = [
  // service-ride (RTA, Salik, EV)
  { service: 'service-ride', method: 'GET', path: '/rides/options', operationId: 'getRideOptions', summary: 'List ride options', response: ok(RAW) },
  { service: 'service-ride', method: 'POST', path: '/rides/book', operationId: 'bookRide', summary: 'Book a ride', bodyRequired: true, response: ok(RAW) },
  { service: 'service-ride', method: 'GET', path: '/rides/track/{bookingId}', operationId: 'trackRide', summary: 'Track a ride booking', response: ok(RAW) },
  { service: 'service-ride', method: 'GET', path: '/mobility/parking/zones', operationId: 'getParkingZones', summary: 'List parking zones', response: ok(RAW) },
  { service: 'service-ride', method: 'GET', path: '/mobility/parking/active', operationId: 'getActiveParking', summary: 'List active parking sessions', response: ok(RAW) },
  { service: 'service-ride', method: 'POST', path: '/mobility/parking/activate', operationId: 'activateParking', summary: 'Pay for and start a parking session', bodyRequired: true, response: ok(RAW) },
  { service: 'service-ride', method: 'POST', path: '/mobility/parking/extend', operationId: 'extendParking', summary: 'Pay for and extend a parking session', bodyRequired: true, response: ok(RAW) },
  { service: 'service-ride', method: 'GET', path: '/mobility/salik/balance', operationId: 'getTollBalance', summary: 'Get Salik toll balance', response: ok(RAW) },
  { service: 'service-ride', method: 'GET', path: '/mobility/salik/passings', operationId: 'getTollPassings', summary: 'List Salik toll passings', response: ok(RAW) },
  { service: 'service-ride', method: 'POST', path: '/mobility/salik/recharge', operationId: 'rechargeToll', summary: 'Recharge the Salik toll tag', bodyRequired: true,
    response: ENVELOPE('Recharge receipt.', ['transactionId', 'newBalance', 'amountRecharged']), errors: { '404': 'Toll target not owned by the workspace.', ...PAYMENT_ERRORS } },
  { service: 'service-ride', method: 'GET', path: '/mobility/ev/chargers', operationId: 'getEvChargers', summary: 'List EV chargers', response: ok(RAW) },
  { service: 'service-ride', method: 'POST', path: '/mobility/ev/start', operationId: 'startEvSession', summary: 'Start an EV charging session', bodyRequired: true, response: ok(RAW) },

  // service-food (DEWA utilities and restaurants)
  { service: 'service-food', method: 'GET', path: '/restaurants/search', operationId: 'searchRestaurants', summary: 'Search restaurants', response: ENVELOPE('Matching restaurants.', ['count', 'restaurants']) },
  { service: 'service-food', method: 'GET', path: '/utilities/consumption', operationId: 'getUtilityConsumption', summary: 'Get utility consumption', response: ok(RAW) },
  { service: 'service-food', method: 'GET', path: '/utilities/bill', operationId: 'getUtilityBill', summary: 'Get the current utility bill', response: ENVELOPE('Current bill with its payable revision.', ['bill']) },
  { service: 'service-food', method: 'POST', path: '/utilities/pay', operationId: 'payUtilityBill', summary: 'Pay a utility bill', bodyRequired: true,
    response: ENVELOPE('Payment receipt.', ['bill', 'receipt', 'chargedAmount']), errors: { '404': 'Bill not found.', ...PAYMENT_ERRORS } },
  { service: 'service-food', method: 'GET', path: '/utilities/eco-advice', operationId: 'getEcoAdvice', summary: 'Get utility eco advice', response: ENVELOPE('Advice for the account premise.', ['premiseId', 'advice']) },
  { service: 'service-food', method: 'POST', path: '/orders/create', operationId: 'createFoodOrder', summary: 'Create a food order', bodyRequired: true,
    response: ENVELOPE('Confirmed order.', ['order']), errors: { '404': 'Restaurant or menu item not found.' } },
  { service: 'service-food', method: 'GET', path: '/orders/track/{orderId}', operationId: 'trackFoodOrder', summary: 'Track a food order', response: ENVELOPE('Order status.', ['order']), errors: { '404': 'Order not found for this account.' } },

  // service-wallet (payments gateway, fines, checkout)
  { service: 'service-wallet', method: 'GET', path: '/wallet/balance', operationId: 'getWalletBalance', summary: 'Get wallet balance', response: ok(RAW) },
  { service: 'service-wallet', method: 'GET', path: '/wallet/transactions', operationId: 'getWalletTransactions', summary: 'List wallet transactions', response: ok(RAW) },
  { service: 'service-wallet', method: 'GET', path: '/fines/check', operationId: 'checkFines', summary: 'Check traffic fines',
    response: ENVELOPE('Fines report for the account plate.', ['plateNumber', 'earlyDiscountAED', 'discountLabel']) },
  { service: 'service-wallet', method: 'POST', path: '/wallet/topup', operationId: 'topUpWallet', summary: 'Top up the wallet', bodyRequired: true, response: ok(RAW) },
  { service: 'service-wallet', method: 'POST', path: '/wallet/pay', operationId: 'authorizeWalletPayment', summary: 'Pay from the wallet', bodyRequired: true, response: ok(RAW) },
  { service: 'service-wallet', method: 'POST', path: '/fines/pay', operationId: 'payFines', summary: 'Pay selected traffic fines', bodyRequired: true,
    response: ENVELOPE('Fines receipt.', ['receiptNumber', 'finesCleared', 'amountPaid', 'remainingBalance']), errors: { '404': 'Unpaid fines not found.', ...PAYMENT_ERRORS } },
  { service: 'service-wallet', method: 'POST', path: '/pay/unified', operationId: 'payUnified', summary: 'Pay multiple agency items in one checkout', bodyRequired: true,
    response: ENVELOPE('Completed checkout group.', ['group', 'govTransactionHash', 'settlementPlatform', 'grandTotal', 'breakdown', 'remainingBalance', 'steps']), errors: PAYMENT_ERRORS },
  { service: 'service-wallet', method: 'POST', path: '/pay/multi-agency', operationId: 'payMultiAgency', summary: 'Alias of unified checkout', bodyRequired: true,
    response: ENVELOPE('Completed checkout group.', ['group', 'govTransactionHash', 'settlementPlatform', 'grandTotal', 'breakdown', 'remainingBalance', 'steps']), errors: PAYMENT_ERRORS },

  // service-catalog (DLD housing, mini-app and capability catalog)
  { service: 'service-catalog', method: 'GET', path: '/housing/ejari', operationId: 'getEjariContract', summary: 'Get the Ejari tenancy contract', response: ok(RAW) },
  { service: 'service-catalog', method: 'POST', path: '/housing/move-in', operationId: 'moveIn', summary: 'Start the move-in journey', bodyRequired: true,
    response: ENVELOPE('Move-in result with utility connection and parking permit.', ['dewaConnected', 'residentialParking']) },
  { service: 'service-catalog', method: 'GET', path: '/miniapps', operationId: 'listMiniApps', summary: 'List mini-apps', response: ENVELOPE('Mini-app catalog.', ['count', 'miniApps']) },
  { service: 'service-catalog', method: 'GET', path: '/miniapps/{id}', operationId: 'getMiniApp', summary: 'Get a mini-app', response: ENVELOPE('Mini-app.', ['miniApp']), errors: { '404': 'Mini-app not found.' } },
  { service: 'service-catalog', method: 'GET', path: '/tools', operationId: 'listFederatedTools', summary: 'List federated tools for the agent gateway', response: ENVELOPE('Mini-app endpoints and registered tools.', ['services', 'registeredTools']) },
  { service: 'service-catalog', method: 'GET', path: '/capabilities', operationId: 'listCapabilities', summary: 'List capabilities', response: ok('Versioned capability catalog.', ['schemaVersion', 'capabilities']) },
  { service: 'service-catalog', method: 'GET', path: '/capabilities/{id}', operationId: 'getCapability', summary: 'Get a capability', response: ok('Capability.', ['capability']), errors: { '404': 'Capability not found.' } },

  // service-profile
  { service: 'service-profile', method: 'GET', path: '/profile', operationId: 'getProfile', summary: 'Get the signed-in user profile', response: ENVELOPE('Profile.', ['profile']) },
  { service: 'service-profile', method: 'GET', path: '/profile/preferences', operationId: 'getPreferences', summary: 'Get profile preferences', response: ENVELOPE('Preferences and prompt context.', ['preferences', 'promptContext']) },
  { service: 'service-profile', method: 'POST', path: '/profile/preferences', operationId: 'updatePreferences', summary: 'Update profile preferences', response: ENVELOPE('Updated preferences and prompt context.', ['preferences', 'promptContext']) },
  { service: 'service-profile', method: 'GET', path: '/profile/prompt-context', operationId: 'getPromptContext', summary: 'Get profile prompt context', response: ENVELOPE('Profile, preferences and prompt context.', ['profile', 'preferences', 'promptContext']) },

  // service-telecom (Etisalat and du; paths are validated or passed through to the provider)
  { service: 'service-telecom', method: 'GET', path: '/telecom/{provider}/prepaid', operationId: 'getPrepaidLine', summary: 'Get the prepaid line', response: ENVELOPE('Prepaid line.', []), contract: '/telecom/etisalat/prepaid' },
  { service: 'service-telecom', method: 'POST', path: '/telecom/{provider}/prepaid/recharges', operationId: 'rechargePrepaidLine', summary: 'Recharge a prepaid line', bodyRequired: true, contract: '/telecom/etisalat/prepaid/recharges',
    response: ENVELOPE('Recharge receipt.', ['transactionId', 'newBalance', 'amountRecharged']), errors: { '404': 'Recharge target not owned by the workspace.', ...PAYMENT_ERRORS } },
  { service: 'service-telecom', method: 'GET', path: '/telecom/{provider}/subscriptions', operationId: 'listTelecomSubscriptions', summary: 'List subscriptions', manualSchema: NO_QUERY, response: ok(RAW) },
  { service: 'service-telecom', method: 'GET', path: '/telecom/{provider}/plans', operationId: 'listTelecomPlans', summary: 'List available plans', manualSchema: NO_QUERY, response: ok(RAW) },
  { service: 'service-telecom', method: 'GET', path: '/telecom/{provider}/bills', operationId: 'listTelecomBills', summary: 'List telecom bills', manualSchema: NO_QUERY, response: ENVELOPE('Bills with payable revisions.', ['bills']) },
  { service: 'service-telecom', method: 'POST', path: '/telecom/{provider}/bills/{billId}/payments', operationId: 'payTelecomBill', summary: 'Pay a telecom bill',
    manualSchema: { type: 'object', properties: { expectedPayableRevision: { type: 'string' }, expectedAmountMinor: { type: 'integer', minimum: 1 } } },
    response: ENVELOPE('Payment receipt.', ['receipt', 'chargedAmount']), errors: PAYMENT_ERRORS },
  { service: 'service-telecom', method: 'POST', path: '/telecom/{provider}/subscriptions/{subscriptionId}/plan', operationId: 'changeTelecomPlan', summary: 'Change a subscription plan', bodyRequired: true,
    manualSchema: providerBody(['planId'], { planId: { type: 'string', minLength: 1 } }), response: ok(RAW) },
];

// Accounts are listed for every service in one document; the account handler has no per-account ownership check.
const ACCOUNTS_OPERATION = { method: 'GET' as const, path: '/accounts', operationId: 'listAccounts', summary: 'List the signed-in user accounts' };

// Returns the request contract for a validated route. Converts the validator's `dependencies` to `dependentRequired`.
function validatedSchema(service: ApplicationService, method: 'GET' | 'POST', contract: string): JsonSchema {
  const { dependencies, ...schema } = requestSchema(service, method, contract) as JsonSchema & { dependencies?: Record<string, string[]> };
  return dependencies ? { ...schema, dependentRequired: dependencies } : schema;
}

function requestParts(operation: ApplicationOperation) {
  const templateNames = [...operation.path.matchAll(/\{(\w+)\}/g)].map(match => match[1]);
  if (operation.manualSchema) {
    return { schema: operation.manualSchema, names: templateNames };
  }
  const schema = validatedSchema(operation.service, operation.method, operation.contract ?? operation.path);
  return { schema, names: templateNames };
}

function errorResponse(description: string) {
  return { description, content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } };
}

function responseFor(spec: ResponseSpec) {
  const properties: Record<string, JsonSchema> = {};
  for (const key of spec.keys) properties[key] = key === 'success' ? { type: 'boolean' } : {};
  const schema: JsonSchema = { type: 'object', properties, ...(spec.keys.length ? { required: spec.keys } : {}), additionalProperties: true };
  return { description: spec.description, content: { 'application/json': { schema } } };
}

// Errors every integrated operation can return: readJsonBody and HttpPolicy run before routing, and bearer auth runs first.
function sharedErrors(method: 'GET' | 'POST') {
  const responses: Record<string, unknown> = {
    '400': errorResponse('Invalid JSON body, or input rejected by the route contract (code VALIDATION_ERROR).'),
    '401': errorResponse('Missing, malformed or unverifiable bearer token, or the token lacks the superapp-user role.'),
    '403': errorResponse('X-Account-Id is not owned by the signed-in user (ACCOUNT_FORBIDDEN), or eligibility enforcement restricts the account (ACCOUNT_RESTRICTED).'),
    '408': errorResponse('Request body timed out.'),
    '413': errorResponse('Request body too large.'),
    '429': errorResponse('Concurrency, rate or key capacity limit reached.'),
    '503': errorResponse('Provider or eligibility service unavailable (PROVIDER_UNAVAILABLE, ELIGIBILITY_UNAVAILABLE or REQUEST_FAILED).'),
  };
  if (method === 'POST') responses['415'] = errorResponse('Content-Type must be application/json.');
  return responses;
}

function operationObject(
  operation: { method: 'GET' | 'POST'; path: string; operationId: string; summary: string },
  parts: { schema: JsonSchema; names: string[] } | undefined,
  response: ReturnType<typeof responseFor>,
  errors: ErrorStatuses | undefined,
  bodyRequired: boolean | undefined,
  servers?: { url: string }[],
) {
  const parameters: unknown[] = [
    { $ref: '#/components/parameters/XAccountId' },
    { $ref: '#/components/parameters/XRequestId' },
  ];
  const properties = (parts?.schema.properties ?? {}) as Record<string, JsonSchema>;
  const required = (parts?.schema.required ?? []) as string[];
  for (const name of parts?.names ?? []) {
    const schema = name === 'provider' ? { enum: TELECOM_PROVIDER } : properties[name] ?? { type: 'string' };
    parameters.push({ name, in: 'path', required: true, schema });
  }
  const pathNames = new Set(parts?.names ?? []);
  let requestBody: unknown;
  if (operation.method === 'GET') {
    for (const [name, schema] of Object.entries(properties)) {
      if (pathNames.has(name)) continue;
      parameters.push({ name, in: 'query', required: required.includes(name), schema });
    }
  } else {
    requestBody = { required: bodyRequired === true, content: { 'application/json': { schema: stripPathNames(parts?.schema ?? { type: 'object' }, pathNames) } } };
  }
  const responses: Record<string, unknown> = { '200': response };
  Object.assign(responses, sharedErrors(operation.method));
  for (const [status, description] of Object.entries(errors ?? {})) responses[status] = errorResponse(description);
  return {
    operationId: operation.operationId,
    summary: operation.summary,
    ...(servers ? { servers } : {}),
    parameters,
    ...(requestBody ? { requestBody } : {}),
    responses,
    security: [{ bearerAuth: [] }],
  };
}

// Path parameters are documented as path params, so they are removed from the JSON body schema.
function stripPathNames(schema: JsonSchema, names: Set<string>): JsonSchema {
  if (names.size === 0 || !schema.properties) return schema;
  const properties = Object.fromEntries(Object.entries(schema.properties as Record<string, JsonSchema>).filter(([name]) => !names.has(name)));
  const required = ((schema.required ?? []) as string[]).filter(name => !names.has(name));
  return { ...schema, properties, required };
}

const serverUrl = (service: ApplicationService) => ({ url: `http://localhost:${APPLICATION_SERVICES[service]}` });

const ERROR_SCHEMA = {
  type: 'object',
  required: ['code', 'error'],
  properties: {
    success: { type: 'boolean' },
    code: { type: 'string' },
    error: { type: 'string' },
  },
  additionalProperties: true,
};

export function buildApplicationOpenApi() {
  const paths: Record<string, Record<string, unknown>> = {};
  for (const operation of APPLICATION_OPERATIONS) {
    const parts = requestParts(operation);
    const method = operation.method.toLowerCase();
    const bodyRequired = operation.bodyRequired;
    const entry = operationObject(operation, parts, responseFor(operation.response), operation.errors, bodyRequired, [serverUrl(operation.service)]);
    paths[operation.path] = { ...(paths[operation.path] ?? {}), [method]: entry };
  }
  const accountsParts = { schema: { type: 'object', properties: {} } as JsonSchema, names: [] as string[] };
  const accountsResponse = responseFor(ENVELOPE('Accounts owned by the signed-in user. When eligibility enforcement is on, the payments provider account list is returned instead.', ['accounts']));
  const accountsServers = (Object.keys(APPLICATION_SERVICES) as ApplicationService[]).map(serverUrl);
  const accountsOp = operationObject(ACCOUNTS_OPERATION, accountsParts, accountsResponse, undefined, undefined, accountsServers);
  paths[ACCOUNTS_OPERATION.path] = { get: accountsOp };

  return {
    openapi: '3.1.0',
    info: {
      title: 'Cityside Application APIs',
      version: '1.0.0',
      description: 'Integrated application APIs for the six service backends. Documents the PROVIDER_INTEGRATION=true surface, where every route except /health requires a Keycloak bearer token. Each operation lists its own service port in servers.',
    },
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
          description: 'Keycloak-issued RS256 access token with typ Bearer, an audience that includes KEYCLOAK_AUDIENCE (default agent-core), the superapp-user realm role, and a non-service-account subject.',
        },
      },
      parameters: {
        XAccountId: { name: 'X-Account-Id', in: 'header', required: false, description: 'Account to act on. Defaults to the signed-in user personal account. Must be owned by the user.', schema: { type: 'string' } },
        XRequestId: { name: 'X-Request-Id', in: 'header', required: false, description: 'Caller correlation ID, truncated to 200 characters.', schema: { type: 'string', maxLength: 200 } },
      },
      schemas: { Error: ERROR_SCHEMA },
    },
    security: [{ bearerAuth: [] }],
    paths,
  };
}

export const APPLICATION_OPENAPI_PATH = 'packages/backend-kit/openapi/application-apis.openapi.json';
