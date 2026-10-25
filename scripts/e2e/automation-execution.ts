import { keycloakIssuerUrl } from '../endpoints.ts';
/** Real Keycloak, real broker code and an armed isolated run: worker token → credential → execute → settled.
 *  The broker is the Compose container, recreated with its provider URL pointing at this run and restored afterwards. */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { startEnvironment } from './environment.ts';
import { MANDATE_ACTOR, type MandatePolicy } from '../../packages/protocol-core/src/payment-mandates.ts';

const scratch = mkdtempSync(join(tmpdir(), 'cityside-auto-broker-'));
let env: Awaited<ReturnType<typeof startEnvironment>> | undefined, restoreBroker = false;
try {
  const token = async (params: Record<string, string>) => {
    const r = await fetch(`${keycloakIssuerUrl}/protocol/openid-connect/token`, { method: 'POST', body: new URLSearchParams(params), signal: AbortSignal.timeout(10000) });
    assert.equal(r.status, 200, JSON.stringify(await r.clone().json()));
    return (await r.json() as { access_token: string }).access_token;
  };
  const subOf = (bearer: string) => JSON.parse(Buffer.from(bearer.split('.')[1], 'base64url').toString()).sub as string;
  const owner = await token({ grant_type: 'password', client_id: 'superapp-shell', username: 'bassem', password: 'demo123' });
  const other = await token({ grant_type: 'password', client_id: 'superapp-shell', username: 'demo-commuter', password: 'demo123' });
  const worker = await token({ grant_type: 'client_credentials', client_id: 'automation-worker', client_secret: readFileSync('.data/delegation/automation-worker-secret', 'utf8'), scope: 'automation.execute' });
  const runner = await token({ grant_type: 'client_credentials', client_id: 'delegation-runner', client_secret: readFileSync('.data/delegation/runner-secret', 'utf8') });

  env = await startEnvironment({ automation: { operatorSub: subOf(owner), workerSub: subOf(worker) } });
  assert.ok(env.automationRunId);
  const run = `http://localhost:${env.corePort + 107}/internal/automation-runs/${env.automationRunId}`;

  // The Compose broker (the real container, Keycloak-clock aligned) is pointed at this run's isolated payments provider.
  const override = join(scratch, 'broker.override.yml'), compose = ['compose', '-f', 'docker-compose.demo.yml'];
  writeFileSync(override, `services:
  delegation-broker:
    environment:
      PROVIDER_PAYMENTS_URL: http://host.docker.internal:${env.corePort + 107}
    extra_hosts: ['host.docker.internal:host-gateway']
`);
  restoreBroker = true;
  execFileSync('docker', [...compose, '-f', override, 'up', '-d', '--force-recreate', '--wait', 'delegation-broker'], { stdio: 'ignore' });
  process.env.DELEGATION_AUTHORITY_URL = 'http://127.0.0.1:4010';
  const brokerUrl = process.env.DELEGATION_AUTHORITY_URL;

  const call = async (url: string, bearer: string, body?: unknown) => {
    const r = await fetch(url, { method: body === undefined ? 'GET' : 'POST', headers: { Authorization: `Bearer ${bearer}`, 'Content-Type': 'application/json', 'Idempotency-Key': randomUUID() }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(20000) });
    return { status: r.status, data: await r.json().catch(() => ({})) as any };
  };
  const accounts = (await call(`${env.coreUrl}/api/accounts`, owner)).data.accounts;
  const accountId = accounts.find((a: any) => a.label === 'Personal account').id as string;
  const api = (path: string, body?: Record<string, unknown>) => call(`${env!.coreUrl}/api/payments/${path}${body ? '' : `?accountId=${accountId}`}`, owner, body ? { accountId, requestKey: randomUUID(), ...body } : undefined);
  const wallet = async () => (await call(`http://localhost:${env!.corePort + 107}/v1/accounts/${accountId}/wallet`, owner)).data.balanceMinor as number;

  // Owner consent: a linked DEWA biller, one due bill and an approved automatic rule.
  const overview = (await api('overview')).data, dewa = overview.candidates.find((c: any) => c.provider === 'dewa');
  const link = await api('billing-accounts', { provider: 'dewa', reference: dewa.reference, nickname: 'Home' });
  assert.equal(link.status, 200, JSON.stringify(link.data));
  const billing = link.data.billingAccount ?? (await api('overview')).data.billingAccounts.find((b: any) => b.reference === dewa.reference);
  const due = new Date(Date.now() + 86400000).toISOString().slice(0, 10), billId = 'e2e-auto-bill';
  env.providerStores.get('dewa')!.put(accountId, 'bill', { billId, accountNumber: dewa.reference, totalAmount: 150, status: 'UNPAID', dueDate: due }, billId);
  const now = Date.now();
  const policy: MandatePolicy = { actorClientId: MANDATE_ACTOR, audience: 'provider-api', operation: 'BILL_PAYMENT', purpose: 'Pay my DEWA bill automatically', currency: 'AED',
    target: { kind: 'BILLER', billingAccountId: billing.id, expectedVersion: billing.version, provider: 'dewa', reference: dewa.reference }, sources: [{ methodId: 'wallet', expectedVersion: 1 }], fallback: { mode: 'NONE' },
    trigger: { type: 'INVOICE_DUE', daysBefore: 3 }, timezone: 'Asia/Dubai', startsAt: new Date(now - 60000).toISOString(), expiresAt: new Date(now + 30 * 86400000).toISOString(),
    limits: { perPaymentMinor: 50000, periodMinor: 100000, lifetimeMinor: 200000, period: 'MONTH', perPeriodCount: 5, lifetimeCount: 20, cooldownSeconds: 60 } };
  const created = await api('mandates', { policy });
  assert.equal(created.status, 200, JSON.stringify(created.data));
  const mandate = (await api('mandates/approve', { mandateId: created.data.mandate.id, expectedVersion: created.data.mandate.version, approvalDigest: created.data.mandate.approvalDigest })).data.mandate;
  assert.equal(mandate.state, 'APPROVED');
  assert.equal(mandate.executionEnabled, false, 'the mandate itself still advertises no execution');

  // The workload prepares; users and other identities cannot.
  const prepareBody = { mandateId: mandate.id, occurrenceKey: 'occ-e2e-1', requestKey: randomUUID() };
  assert.equal((await call(`${run}/prepare`, other, prepareBody)).status, 403);
  assert.ok([401, 403].includes((await call(`${run}/prepare`, runner, prepareBody)).status), 'the delegation runner is not the automation worker');
  const prepared = await call(`${run}/prepare`, worker, prepareBody);
  assert.equal(prepared.status, 200, JSON.stringify(prepared.data));
  const execution = prepared.data;
  assert.ok(execution.id && execution.orderId, JSON.stringify(execution));
  console.log('PASS: only the automation worker prepares; the real gateway order exists and is closed to ordinary APIs.');

  // Ordinary owner APIs cannot decide the automatic order.
  const order = (await call(`http://localhost:${env.corePort + 107}/v1/accounts/${accountId}/payment-orders/${execution.orderId}`, owner)).data.order;
  assert.equal(order.state, 'AWAITING_APPROVAL');
  for (const action of ['approve', 'execute']) assert.equal((await call(`http://localhost:${env.corePort + 107}/v1/accounts/${accountId}/payment-orders/${execution.orderId}/${action}`, owner, { expectedVersion: order.version, approvalDigest: order.approvalDigest })).status, 403);

  // Broker: only the worker gets a credential, only for this execution, only once.
  const credentialUrl = `${brokerUrl}/api/delegation/automation/executions/${execution.id}/credential`;
  assert.ok([401, 403].includes((await call(credentialUrl, owner, { runId: env.automationRunId })).status), 'a signed-in owner cannot request an execution credential');
  assert.equal((await call(credentialUrl, runner, { runId: env.automationRunId })).status, 403, 'the delegation runner cannot request one either');
  const issued = await call(credentialUrl, worker, { runId: env.automationRunId });
  assert.equal(issued.status, 200, JSON.stringify(issued.data));
  const bearer = issued.data.accessToken as string;
  const claims = JSON.parse(Buffer.from(bearer.split('.')[1], 'base64url').toString());
  assert.equal(claims.sub, subOf(owner));
  assert.equal(claims.azp, 'delegation-broker');
  assert.ok(claims.exp - claims.iat <= 90);
  assert.equal(issued.data.operation.amountMinor, 15000);
  assert.equal((await call(credentialUrl, worker, { runId: env.automationRunId })).data.code, 'PERMIT_ALREADY_ISSUED');
  console.log('PASS: the worker obtains exactly one short-lived owner token bound to the prepared operation.');

  // Before admission the token buys nothing, anywhere.
  const before = await wallet();
  const exec = `${run}/execution/${execution.id}/execute`;
  assert.equal((await call(exec, owner, {})).status, 403);
  assert.equal((await call(exec, worker, {})).status, 403);
  assert.equal((await call(`http://localhost:${env.corePort + 107}/v1/accounts/${accountId}/wallet`, bearer)).status, 403, 'an unadmitted token cannot read the wallet');

  const settled = await call(exec, bearer, {});
  assert.equal(settled.status, 200, JSON.stringify(settled.data));
  assert.equal(settled.data.order.state, 'SETTLED', JSON.stringify(settled.data.order));
  assert.equal(settled.data.order.quote.totalMinor, 15000);
  assert.equal(env.providerStores.get('dewa')!.get(accountId, 'bill', billId).status, 'PAID');
  assert.equal(await wallet(), before - 15000);
  console.log('PASS: the admitted token settles the stored order once across the real providers.');

  // The permit is spent and the token covers nothing else.
  const replay = await call(exec, bearer, {});
  assert.equal(replay.status, 200);
  assert.equal(replay.data.order.id, settled.data.order.id, 'a replay returns the same settled order');
  const again = await call(credentialUrl, worker, { runId: env.automationRunId });
  assert.equal(again.status, 403, 'a paid execution can never be issued another credential');
  assert.equal(await wallet(), before - 15000, 'a replay charged nothing');
  for (const [path, body] of [['/wallet'], ['/transactions'], ['/topups', { amountMinor: 100, source: 'demo_approved' }]] as const) assert.equal((await call(`http://localhost:${env.corePort + 107}/v1/accounts/${accountId}${path}`, bearer, body)).status, 403, path);
  assert.equal((await call(`${env.coreUrl}/api/accounts`, bearer)).status === 200, false);
  console.log('PASS: replay moves no money and the token cannot reach any other operation.');
} finally {
  if (restoreBroker) execFileSync('docker', ['compose', '-f', 'docker-compose.demo.yml', 'up', '-d', '--force-recreate', '--wait', 'delegation-broker'], { stdio: 'ignore' });
  await env?.cleanup();
  try { rmSync(scratch, { recursive: true, force: true }); } catch { /* Windows may briefly hold the directory */ }
}
