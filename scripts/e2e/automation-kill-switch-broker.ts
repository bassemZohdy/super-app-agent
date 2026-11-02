/** Real Keycloak tokens against the Compose broker: the admin client sets the desired kill-switch state, the worker reads it,
 *  and every other caller is refused (AUTO-15 step 3b-ii). Leaves the desired state released when it finishes. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { delegationAuthorityUrl, keycloakIssuerUrl, providerPaymentsUrl } from '../endpoints.ts';
import { HttpExecutionGateway } from '../../services/automation-worker/src/http-gateway.ts';
import { boundedJsonResponse } from '../../packages/backend-kit/src/bounded-json.ts';
import { readAutomationToken } from './automation-token.ts';

const broker = `${delegationAuthorityUrl.replace('127.0.0.1', 'localhost')}/api/delegation/automation/kill-switch`;

const token = async (clientId: string, secretFile: string, scope: string) => {
  const r = await fetch(`${keycloakIssuerUrl}/protocol/openid-connect/token`, { method: 'POST', signal: AbortSignal.timeout(10000),
    body: new URLSearchParams({ grant_type: 'client_credentials', client_id: clientId, client_secret: readFileSync(secretFile, 'utf8').trim(), scope }) });
  return readAutomationToken(r);
};
const call = async (method: string, bearer: string, body?: unknown) => {
  const r = await fetch(broker, { method, signal: AbortSignal.timeout(10000), headers: { Authorization: `Bearer ${bearer}`, 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
  if (!r.ok) { void r.body?.cancel().catch(() => {}); return { status: r.status, data: {} as Record<string, unknown> }; }
  const data = await boundedJsonResponse(r, 65536).catch(() => ({}));
  return { status: r.status, data: data && typeof data === 'object' && !Array.isArray(data) ? data as Record<string, unknown> : {} };
};

const admin = await token('automation-admin', '.data/delegation/automation-admin-secret', 'automation.admin');
const worker = await token('automation-worker', '.data/delegation/automation-worker-secret', 'automation.execute');

const engaged = await call('POST', admin, { engaged: true, reason: 'stack check' });
assert.equal(engaged.status, 200);
assert.ok(engaged.data.engaged === true, 'admin engages the switch');
const read = await call('GET', worker);
assert.equal(read.status, 200);
assert.ok(read.data.engaged === true && read.data.reason === 'stack check', 'the worker reads what the admin set');

assert.equal((await call('POST', worker, { engaged: false })).status, 403, 'the worker cannot change the switch');
assert.equal((await call('GET', admin)).status, 403, 'the admin client cannot read through the worker route');
assert.equal((await call('POST', admin, { engaged: true })).status, 400, 'engaging needs a reason');

const released = await call('POST', admin, { engaged: false });
assert.equal(released.status, 200);
assert.ok((await call('GET', worker)).data.engaged === false, 'a released state reads back as released');
// The worker reads the same state through its own gateway client, the path the running worker uses. The client fetches its
// token from the Keycloak issuer in the environment, as the e2e environment sets it.
process.env.KEYCLOAK_ISSUER ??= keycloakIssuerUrl;
const gateway = new HttpExecutionGateway({ runId: 'autorn_00000000-0000-4000-8000-000000000000', paymentsUrl: providerPaymentsUrl, brokerUrl: delegationAuthorityUrl, clientSecret: readFileSync('.data/delegation/automation-worker-secret', 'utf8').trim() });
assert.ok(await gateway.killSwitch().then(d => d?.engaged === false), 'the gateway reads the released state');
await call('POST', admin, { engaged: true, reason: 'gateway check' });
const engagedRead = await gateway.killSwitch();
assert.ok(engagedRead?.engaged === true && engagedRead.reason === 'gateway check', 'the gateway reads an engaged state');
await call('POST', admin, { engaged: false });
console.log('PASS: the admin client sets the desired kill-switch state, the worker reads it, and every other caller is refused on the real stack.');
