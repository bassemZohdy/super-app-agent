import { demoPortOffset, keycloakIssuerUrl } from './endpoints.ts';
/** Live contract check (P1-14): the running application services answer as their OpenAPI document says. Every documented operation
 *  refuses a request with no token using the documented `Error` shape, and every read that needs no path or query input answers 200
 *  with the keys the document lists as required. Reads only; nothing is created or paid. Needs the Compose stack (`npm run demo:up`). */
import assert from 'node:assert/strict';
import { accountIdFor } from '../packages/backend-kit/src/context.ts';
import { buildApplicationOpenApi, APPLICATION_OPERATIONS, APPLICATION_SERVICES } from '../packages/backend-kit/src/application-openapi.ts';

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
assert.deepEqual(failures, [], failures.slice(0, 8).join('\n'));
assert.equal(refused, APPLICATION_OPERATIONS.length, 'every documented operation was checked for the refusal');
assert.ok(invalid >= 10, `at least 10 writes were checked for the invalid-body refusal (${invalid})`);
assert.equal(missing, APPLICATION_OPERATIONS.filter(operation => operation.method === 'GET' && operation.path.includes('{') && document.paths[operation.path]?.get?.responses['404']).length, 'every documented 404 on a read was checked');
assert.ok(telecomReads >= 4 && telecomReads % TELECOM_PROVIDERS.length === 0, `each telecom read was checked for every provider (${telecomReads})`);
assert.ok(read >= 15, `at least 15 parameter-free reads were checked (${read})`);
console.log(`PASS: all ${refused} documented operations refuse a request with no token using the documented error shape`);
console.log(`PASS: ${invalid} writes refuse an invalid body with a documented 400 before any effect`);
console.log(`PASS: ${missing} reads of an unknown resource answer the documented 404`);
console.log(`PASS: ${telecomReads} telecom reads (each provider) answer 200 with every key the document requires`);
console.log(`PASS: ${read} parameter-free reads answer 200 with every key the document requires`);
