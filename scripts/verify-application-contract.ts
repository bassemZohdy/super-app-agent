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
let refused = 0, read = 0;
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

  // 2. A read with no path parameter answers 200 with the documented required keys.
  if (operation.method !== 'GET' || operation.path.includes('{')) continue;
  const answer = await fetch(url, { headers: { Authorization: `Bearer ${session.access_token}`, 'X-Account-Id': accountId } });
  if (answer.status !== 200) { failures.push(`${operation.method} ${operation.path}: a signed-in read gave ${answer.status}`); continue; }
  const body = await answer.json() as Record<string, unknown>;
  const required = documented.responses['200']?.content?.['application/json']?.schema?.required ?? [];
  const missing = required.filter(key => !(key in body));
  if (missing.length) failures.push(`${operation.method} ${operation.path}: the 200 body lacks ${missing.join(', ')}`);
  else read++;
}
assert.deepEqual(failures, [], failures.slice(0, 8).join('\n'));
assert.equal(refused, APPLICATION_OPERATIONS.length, 'every documented operation was checked for the refusal');
assert.ok(read >= 15, `at least 15 parameter-free reads were checked (${read})`);
console.log(`PASS: all ${refused} documented operations refuse a request with no token using the documented error shape`);
console.log(`PASS: ${read} parameter-free reads answer 200 with every key the document requires`);
