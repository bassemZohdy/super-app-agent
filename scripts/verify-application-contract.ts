import { demoPortOffset, gatewayUrl, keycloakIssuerUrl } from './endpoints.ts';
/** Live contract check (P1-14): the running application services answer as their OpenAPI document says. Every documented operation
 *  refuses a request with no token using the documented `Error` shape, and every read that needs no path or query input answers 200
 *  with the keys the document lists as required. Reads only unless `--writes` is given (see section 5); then it also makes one valid write to every mutating operation. Needs the Compose stack (`npm run demo:up`). */
import assert from 'node:assert/strict';
import { accountIdFor } from '../packages/backend-kit/src/context.ts';
import { buildApplicationOpenApi, APPLICATION_OPERATIONS, APPLICATION_SERVICES } from '../packages/backend-kit/src/application-openapi.ts';
import { toMinor, fromMinor } from '../packages/protocol-core/src/request-validation.ts';

const document = buildApplicationOpenApi() as { paths: Record<string, Record<string, { responses: Record<string, { content?: Record<string, { schema?: { required?: string[] } }> }> }>>; components: { schemas: { Error: { required: string[] } } } };
const errorKeys = document.components.schemas.Error.required;
const base = (service: keyof typeof APPLICATION_SERVICES) => `http://localhost:${APPLICATION_SERVICES[service] + demoPortOffset}`;

const login = await fetch(`${keycloakIssuerUrl}/protocol/openid-connect/token`, {
  method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams({ grant_type: 'password', client_id: 'superapp-shell', username: 'demo-commuter', password: 'demo123' }),
});
const session = await login.json() as { access_token?: string };
assert.ok(session.access_token, 'a resident can sign in');
const claims = JSON.parse(Buffer.from(session.access_token.split('.')[1], 'base64url').toString()) as { sub: string };
const accountId = accountIdFor(claims.sub);

const WRITES = process.argv.includes('--writes');
const fill = (path: string) => path.replace(/\{[^}]+\}/g, 'x1');
const failures: string[] = [];
const TELECOM_PROVIDERS = ['etisalat', 'du'];
let refused = 0, read = 0, invalid = 0, missing = 0, telecomReads = 0;
const hasErrorShape = (body: Record<string, unknown> | undefined) => !!body && errorKeys.every(key => typeof body[key] === 'string');
const signedIn = { Authorization: `Bearer ${session.access_token}`, 'X-Account-Id': accountId, 'Content-Type': 'application/json' };
for (const operation of APPLICATION_OPERATIONS) {
  const url = base(operation.service) + fill(operation.path);
  const documented = document.paths[operation.path]?.[operation.method.toLowerCase()];
  assert.ok(documented, `${operation.operationId} is in the document`);

  // 1. With no token the service refuses, and the body has the documented error keys.
  const anonymous = await fetch(url, { method: operation.method, headers: { 'Content-Type': 'application/json' }, body: operation.method === 'POST' ? '{}' : undefined });
  const anonymousBody = await anonymous.json().catch(() => undefined) as Record<string, unknown> | undefined;
  if (anonymous.status !== 401) failures.push(`${operation.method} ${operation.path}: no token gave ${anonymous.status}, not 401`);
  else if (!anonymousBody || errorKeys.some(key => typeof anonymousBody[key] !== 'string')) failures.push(`${operation.method} ${operation.path}: the 401 body lacks ${errorKeys.join(' and ')}`);
  else refused++;

  // 2. A signed-in write with a body the contract does not allow is refused with a documented 400 before anything happens.
  const signedUrl = base(operation.service) + fill(operation.contract ?? operation.path);
  // (A write on a specific bill or subscription looks the resource up first, so it is left out: a made-up id is a 404.)
  if (operation.method === 'POST' && !/\{(?!provider\})[^}]+\}/.test(operation.path)) {
    const bad = await fetch(signedUrl, { method: 'POST', headers: signedIn, body: JSON.stringify({ zz_unknown_field: 1 }) });
    const badBody = await bad.json().catch(() => undefined) as Record<string, unknown> | undefined;
    if (bad.status !== 400) failures.push(`${operation.method} ${operation.path}: an invalid body gave ${bad.status}, not 400`);
    else if (!hasErrorShape(badBody)) failures.push(`${operation.method} ${operation.path}: the 400 body lacks ${errorKeys.join(' and ')}`);
    else invalid++;
  }

  // 3. A read of a resource that does not exist answers the documented 404 with the error shape.
  if (operation.method === 'GET' && operation.path.includes('{') && documented.responses['404']) {
    const gone = await fetch(base(operation.service) + operation.path.replace(/\{[^}]+\}/g, 'does-not-exist'), { headers: signedIn });
    const goneBody = await gone.json().catch(() => undefined) as Record<string, unknown> | undefined;
    if (gone.status !== 404) failures.push(`${operation.method} ${operation.path}: an unknown resource gave ${gone.status}, not 404`);
    else if (!hasErrorShape(goneBody)) failures.push(`${operation.method} ${operation.path}: the 404 body lacks ${errorKeys.join(' and ')}`);
    else missing++;
  }

  // 4. A read whose only path parameter is the telecom provider (or that has none) answers 200 with the documented required keys,
  //    once for each provider the service offers.
  if (operation.method !== 'GET' || /\{(?!provider\})[^}]+\}/.test(operation.path)) continue;
  const required = documented.responses['200']?.content?.['application/json']?.schema?.required ?? [];
  for (const provider of operation.path.includes('{provider}') ? TELECOM_PROVIDERS : [undefined]) {
    const target = base(operation.service) + operation.path.replace('{provider}', provider ?? '');
    const answer = await fetch(target, { headers: signedIn });
    if (answer.status !== 200) { failures.push(`${operation.method} ${operation.path}${provider ? ` (${provider})` : ''}: a signed-in read gave ${answer.status}`); continue; }
    const body = await answer.json() as Record<string, unknown>;
    const absent = required.filter(key => !(key in body));
    if (absent.length) failures.push(`${operation.method} ${operation.path}${provider ? ` (${provider})` : ''}: the 200 body lacks ${absent.join(', ')}`);
    else if (provider) telecomReads++;
    else read++;
  }
}

// 5. Writes (only with --writes, on a disposable stack such as `npm run qualify -- run -- ...`): a valid write answers 200 with
//    the keys the document lists. These change demo balances and records and use up the resident's fines, bills and recharge target,
//    so the default run on the shared stack never does them, and they run once on a fresh stack (`qualify -- down`, then `up`).
let written = 0;
if (WRITES) {
  const call = async (service: keyof typeof APPLICATION_SERVICES, method: string, path: string, body?: unknown) => {
    const response = await fetch(base(service) + path, { method, headers: signedIn, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: response.status, data: await response.json() as Record<string, any> };
  };
  const requiredFor = (path: string) => document.paths[path]?.post?.responses['200']?.content?.['application/json']?.schema?.required ?? [];
  const check = (path: string, result: { status: number; data: Record<string, unknown> }) => {
    const absent = requiredFor(path).filter(key => !(key in result.data));
    if (result.status !== 200) failures.push(`POST ${path}: a valid write gave ${result.status} ${JSON.stringify(result.data).slice(0, 80)}`);
    else if (absent.length) failures.push(`POST ${path}: the 200 body lacks ${absent.join(', ')}`);
    else written++;
  };
  // The account's own plate and the Salik denominations it is offered are read, not guessed.
  const profile = await call('service-profile', 'GET', '/profile');
  const plateNumber = profile.data.profile?.smartCityAssets?.vehicles?.[0]?.plate as string | undefined;
  const overview = await (await fetch(`${gatewayUrl}/api/payments/overview?accountId=${accountId}`, { headers: signedIn })).json() as { rechargeTargets?: { kind: string; denominationsMinor: number[] }[] };
  const tollMinor = overview.rechargeTargets?.find(target => target.kind === 'TOLL')?.denominationsMinor[0];
  if (!plateNumber || !tollMinor) failures.push('the resident has no vehicle plate or no Salik denomination to write with');
  const drivers = await call('service-ride', 'GET', '/rides/options');
  check('/rides/book', await call('service-ride', 'POST', '/rides/book', { driverId: drivers.data.options[0].id, pickup: 'Business Bay', dropoff: 'Dubai Mall' }));
  const zones = await call('service-ride', 'GET', '/mobility/parking/zones');
  const parking = await call('service-ride', 'POST', '/mobility/parking/activate', { zoneId: zones.data.zones[0].id, durationHours: 1, plateNumber });
  check('/mobility/parking/activate', parking);
  const ticketId = parking.data.meter?.ticketId as string | undefined;
  if (ticketId) check('/mobility/parking/extend', await call('service-ride', 'POST', '/mobility/parking/extend', { ticketId, additionalHours: 1 }));
  else failures.push(`POST /mobility/parking/activate: the answer names no ticket to extend (keys: ${Object.keys(parking.data).join(', ')}; ${JSON.stringify(parking.data).slice(0, 160)})`);
  const chargers = await call('service-ride', 'GET', '/mobility/ev/chargers');
  const chargerId = chargers.data.chargers?.[0]?.id;
  if (chargerId) check('/mobility/ev/start', await call('service-ride', 'POST', '/mobility/ev/start', { chargerId, plateNumber }));
  else failures.push('GET /mobility/ev/chargers: no charger to start a session on');
  check('/mobility/salik/recharge', await call('service-ride', 'POST', '/mobility/salik/recharge', { amount: (tollMinor ?? 100) / 100 }));
  // A top-up is limited to AED 500, so top up in steps until the wallet can cover the payments below.
  check('/wallet/topup', await call('service-wallet', 'POST', '/wallet/topup', { amount: 500 }));
  for (let step = 0; step < 6; step++) {
    const wallet = await call('service-wallet', 'GET', '/wallet/balance');
    if (wallet.data.balanceMinor >= 200000) break;
    await call('service-wallet', 'POST', '/wallet/topup', { amount: 500 });
  }
  check('/wallet/pay', await call('service-wallet', 'POST', '/wallet/pay', { amount: 1, purpose: 'contract check', referenceId: 'contract-check-1' }));
  check('/profile/preferences', await call('service-profile', 'POST', '/profile/preferences', { dietary: ['Halal'] }));

  // Writes that pay or settle need a real payable: its id and revision are read from the service first.
  const ejari = await call('service-catalog', 'GET', '/housing/ejari');
  check('/housing/move-in', await call('service-catalog', 'POST', '/housing/move-in', { contractNumber: ejari.data.contract?.contractNumber }));
  const restaurants = await call('service-food', 'GET', '/restaurants/search');
  const restaurant = restaurants.data.restaurants?.[0];
  check('/orders/create', await call('service-food', 'POST', '/orders/create', { restaurantId: restaurant?.id, items: [restaurant?.items?.[0]?.id] }));
  const bill = await call('service-food', 'GET', '/utilities/bill');
  check('/utilities/pay', await call('service-food', 'POST', '/utilities/pay', { billId: bill.data.bill?.billId, expectedPayableRevision: bill.data.bill?.payableRevision }));
  const fines = await call('service-wallet', 'GET', '/fines/check');
  const fine = fines.data.fines?.find((item: { status: string }) => item.status === 'UNPAID');
  check('/fines/pay', await call('service-wallet', 'POST', '/fines/pay', { fineIds: [fine?.fineId], expectedPayables: [{ payableId: fine?.payableId, expectedRevision: fine?.payableRevision }] }));
  const remainingFines = await call('service-wallet', 'GET', '/fines/check');
  const currentBill = await call('service-food', 'GET', '/utilities/bill');
  const expectedTotal = fromMinor(10000 + toMinor(remainingFines.data.totalPayable || 0) + toMinor(currentBill.data.bill?.status === 'UNPAID' ? currentBill.data.bill.totalAmount : 0));
  const items = [{ agency: 'City services', purpose: 'Contract check', amount: expectedTotal }];
  check('/pay/unified', await call('service-wallet', 'POST', '/pay/unified', { items }));
  check('/pay/multi-agency', await call('service-wallet', 'POST', '/pay/multi-agency', { items: [{ agency: 'RTA', purpose: 'Contract check', amount: 100 }] }));
  const line = (await call('service-telecom', 'GET', '/telecom/etisalat/prepaid')).data.lines?.[0];
  check('/telecom/{provider}/prepaid/recharges', await call('service-telecom', 'POST', '/telecom/etisalat/prepaid/recharges', { lineId: line?.lineId, amountMinor: line?.denominationsMinor?.[0], expectedTargetVersion: 1 }));
  const telecomBill = (await call('service-telecom', 'GET', '/telecom/etisalat/bills')).data.bills?.find((item: { status: string }) => item.status === 'UNPAID');
  check('/telecom/{provider}/bills/{billId}/payments', await call('service-telecom', 'POST', `/telecom/etisalat/bills/${telecomBill?.billId}/payments`, { expectedPayableRevision: telecomBill?.payableRevision, expectedAmountMinor: telecomBill?.amountMinor }));
  const subscription = (await call('service-telecom', 'GET', '/telecom/etisalat/subscriptions')).data.subscriptions?.[0];
  const plans = (await call('service-telecom', 'GET', '/telecom/etisalat/plans')).data.plans as { planId: string }[] | undefined;
  check('/telecom/{provider}/subscriptions/{subscriptionId}/plan', await call('service-telecom', 'POST', `/telecom/etisalat/subscriptions/${subscription?.subscriptionId}/plan`, { planId: plans?.find(plan => plan.planId !== subscription?.planId)?.planId }));
}

assert.deepEqual(failures, [], failures.slice(0, 8).join('\n'));
assert.equal(refused, APPLICATION_OPERATIONS.length, 'every documented operation was checked for the refusal');
if (WRITES) assert.equal(written, APPLICATION_OPERATIONS.filter(operation => operation.method === 'POST').length, 'every mutating operation was written to and checked');
assert.ok(invalid >= 10, `at least 10 writes were checked for the invalid-body refusal (${invalid})`);
assert.equal(missing, APPLICATION_OPERATIONS.filter(operation => operation.method === 'GET' && operation.path.includes('{') && document.paths[operation.path]?.get?.responses['404']).length, 'every documented 404 on a read was checked');
assert.ok(telecomReads >= 4 && telecomReads % TELECOM_PROVIDERS.length === 0, `each telecom read was checked for every provider (${telecomReads})`);
assert.ok(read >= 15, `at least 15 parameter-free reads were checked (${read})`);
console.log(`PASS: all ${refused} documented operations refuse a request with no token using the documented error shape`);
if (WRITES) console.log(`PASS: ${written} valid writes answer 200 with every key the document requires`);
console.log(`PASS: ${invalid} writes refuse an invalid body with a documented 400 before any effect`);
console.log(`PASS: ${missing} reads of an unknown resource answer the documented 404`);
console.log(`PASS: ${telecomReads} telecom reads (each provider) answer 200 with every key the document requires`);
console.log(`PASS: ${read} parameter-free reads answer 200 with every key the document requires`);
