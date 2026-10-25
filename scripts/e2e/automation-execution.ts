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
import { JobStore } from '../../services/automation-worker/src/jobs.ts';
import { AutomationWorker } from '../../services/automation-worker/src/worker.ts';
import { HttpRuleSource } from '../../services/automation-worker/src/http-rules.ts';
import { Scheduler } from '../../services/automation-worker/src/scheduler.ts';
import { HttpExecutionGateway } from '../../services/automation-worker/src/http-gateway.ts';
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
  // ---- Qualification: races, outage, revocation and restart. Each scenario prepares a fresh execution. ----
  let n = 1;
  const paymentsUrl = `http://localhost:${env.corePort + 107}/v1/accounts/${accountId}`;
  // The 60-second minimum cooldown is per mandate, so each scenario owns its own approved rule.
  const newMandate = async () => {
    const made = await api('mandates', { policy: { ...policy, purpose: `Pay my DEWA bill automatically (${++n})` } });
    assert.equal(made.status, 200, JSON.stringify(made.data));
    const approved = await api('mandates/approve', { mandateId: made.data.mandate.id, expectedVersion: made.data.mandate.version, approvalDigest: made.data.mandate.approvalDigest });
    assert.equal(approved.status, 200, JSON.stringify(approved.data));
    return approved.data.mandate;
  };
  const newExecution = async (forMandate?: { id: string }) => {
    const target = forMandate ?? await newMandate();
    n++;
    const id = `e2e-auto-bill-${n}`;
    env!.providerStores.get('dewa')!.put(accountId, 'bill', { billId: id, accountNumber: dewa.reference, totalAmount: 150, status: 'UNPAID', dueDate: due }, id);
    const p = await call(`${run}/prepare`, worker, { mandateId: target.id, occurrenceKey: `occ-e2e-${n}`, requestKey: randomUUID() });
    assert.equal(p.status, 200, JSON.stringify(p.data));
    return { ...p.data, billId: id, mandateId: target.id };
  };
  const credentialFor = (id: string) => call(`${brokerUrl}/api/delegation/automation/executions/${id}/credential`, worker, { runId: env!.automationRunId });
  const paid = (billId: string) => env!.providerStores.get('dewa')!.get(accountId, 'bill', billId).status === 'PAID';

  // Two workers ask at once: exactly one token is bound; the loser's token (if one was minted) is useless.
  const raced = await newExecution(), start = await wallet();
  const pair = await Promise.all([credentialFor(raced.id), credentialFor(raced.id)]);
  assert.deepEqual(pair.map(r => r.status).sort(), [200, 403], JSON.stringify(pair.map(r => r.data.code)));
  const winner = pair.find(r => r.status === 200)!.data.accessToken as string;
  // Three concurrent executes with the one bound token: the permit admits once, the rest resume or are refused, money moves once.
  const executeUrl = (id: string) => `${run}/execution/${id}/execute`;
  const burst = await Promise.all([1, 2, 3].map(() => call(executeUrl(raced.id), winner, {})));
  assert.ok(burst.some(r => r.status === 200 && r.data.order.state === 'SETTLED'), JSON.stringify(burst.map(r => [r.status, r.data.code])));
  assert.ok(burst.every(r => [200, 403, 409, 503].includes(r.status)), JSON.stringify(burst.map(r => r.status)));
  assert.equal(await wallet(), start - 15000, 'concurrent executes debited the wallet exactly once');
  assert.ok(paid(raced.billId));
  console.log('PASS: two workers and three concurrent executes yield one credential, one admission and one debit.');

  // Authority outage fails closed, moves nothing, and the same bound token completes after recovery.
  const outage = await newExecution(), outageToken = (await credentialFor(outage.id)).data.accessToken as string, beforeOutage = await wallet();
  execFileSync('docker', [...compose, '-f', override, 'stop', 'delegation-broker'], { stdio: 'ignore' });
  const down = await call(executeUrl(outage.id), outageToken, {});
  assert.ok(down.status >= 400, JSON.stringify(down.data));
  assert.equal(await wallet(), beforeOutage, 'an unreachable authority moved no money');
  assert.equal(paid(outage.billId), false);
  execFileSync('docker', [...compose, '-f', override, 'up', '-d', '--wait', 'delegation-broker'], { stdio: 'ignore' });
  const recovered = await call(executeUrl(outage.id), outageToken, {});
  assert.equal(recovered.status, 200, JSON.stringify(recovered.data));
  assert.equal(recovered.data.order.state, 'SETTLED');
  assert.equal(await wallet(), beforeOutage - 15000);
  console.log('PASS: broker outage fails closed with no effect; the original credential completes once after recovery.');

  // A provider restart keeps the settled outcome and the permit session; a replay moves nothing.
  const afterOutage = await wallet();
  await env.restartPayments();
  const restarted = await call(executeUrl(outage.id), outageToken, {});
  assert.equal(restarted.status, 200, JSON.stringify(restarted.data));
  assert.equal(restarted.data.order.id, recovered.data.order.id);
  assert.equal(restarted.data.order.state, 'SETTLED');
  assert.equal(await wallet(), afterOutage, 'restart plus replay charged nothing');
  console.log('PASS: payments restart preserves the settled order and a replay is idempotent.');

  // Owner pauses the rule after the credential was issued: admission re-reads authority and moves nothing.
  const revoked = await newExecution(), revokedToken = (await credentialFor(revoked.id)).data.accessToken as string, beforePause = await wallet();
  const current = (await call(`${paymentsUrl}/payment-mandates/${revoked.mandateId}`, owner)).data.mandate;
  const pause = await call(`${paymentsUrl}/payment-mandates/${revoked.mandateId}/pause`, owner, { expectedVersion: current.version });
  assert.equal(pause.status, 200, JSON.stringify(pause.data));
  const refused = await call(executeUrl(revoked.id), revokedToken, {});
  assert.ok(refused.status >= 400, JSON.stringify(refused.data));
  assert.equal(refused.data.code, 'AUTOMATION_ADMISSION_REJECTED');
  assert.equal(await wallet(), beforePause);
  assert.equal(paid(revoked.billId), false);
  const retry = await call(executeUrl(revoked.id), revokedToken, {});
  assert.ok(retry.status >= 400 && await wallet() === beforePause, 'a rejected execution cannot be revived');
  assert.equal((await call(`${paymentsUrl}/payment-orders/${revoked.orderId}`, owner)).data.order.state, 'CANCELLED');
  console.log('PASS: pausing the rule before admission denies the held credential; the order is closed, its reservation released and no money moves.');
  // ---- The persistent worker drives the same path from a leased job; two workers race over one job file. ----
  const jobsPath = join(scratch, 'jobs.sqlite'), storeA = new JobStore(jobsPath), storeB = new JobStore(jobsPath);
  const gatewayConfig = { runId: env.automationRunId!, paymentsUrl: `http://localhost:${env.corePort + 107}`, brokerUrl, clientSecret: readFileSync('.data/delegation/automation-worker-secret', 'utf8').trim() };
  const workerMandate = await newMandate();
  n++;
  const workerBill = `e2e-auto-bill-${n}`;
  env.providerStores.get('dewa')!.put(accountId, 'bill', { billId: workerBill, accountNumber: dewa.reference, totalAmount: 150, status: 'UNPAID', dueDate: due }, workerBill);
  const job = storeA.enqueue({ mandateId: workerMandate.id, policyVersion: workerMandate.policyVersion, occurrenceKey: 'occ-worker-1', target: `dewa-${billing.id}` });
  assert.equal(storeB.enqueue({ mandateId: workerMandate.id, policyVersion: workerMandate.policyVersion, occurrenceKey: 'occ-worker-1', target: `dewa-${billing.id}` }).id, job.id);
  const beforeWorker = await wallet();
  const results = await Promise.all([
    new AutomationWorker(storeA, new HttpExecutionGateway(gatewayConfig), { workerId: 'worker-a' }).runOnce(),
    new AutomationWorker(storeB, new HttpExecutionGateway(gatewayConfig), { workerId: 'worker-b' }).runOnce(),
  ]);
  assert.equal(results.filter(Boolean).length, 1, 'only one worker obtained the leased job');
  const finished = storeA.get(job.id)!;
  assert.equal(finished.state, 'SETTLED', JSON.stringify(finished));
  assert.equal(await wallet(), beforeWorker - 15000, 'the worker-driven job debited the wallet once');
  assert.ok(paid(workerBill));
  assert.deepEqual(storeA.outbox(job.id).map(e => e.kind), ['PREPARED', 'SETTLED']);
  assert.equal(await new AutomationWorker(storeB, new HttpExecutionGateway(gatewayConfig), { workerId: 'worker-c' }).runOnce(), undefined, 'a settled job is never run again');
  assert.equal(await wallet(), beforeWorker - 15000);
  // A job whose rule has since been paused fails definitively: nothing moves and the reservation is released.
  n++;
  const stoppedBill = `e2e-auto-bill-${n}`, stoppedRule = await newMandate();
  env.providerStores.get('dewa')!.put(accountId, 'bill', { billId: stoppedBill, accountNumber: dewa.reference, totalAmount: 150, status: 'UNPAID', dueDate: due }, stoppedBill);
  const beforeStopped = await wallet();
  const stoppedJob = storeA.enqueue({ mandateId: stoppedRule.id, policyVersion: stoppedRule.policyVersion, occurrenceKey: 'occ-worker-2', target: `dewa-${billing.id}` });
  const ruleNow = (await call(`${paymentsUrl}/payment-mandates/${stoppedRule.id}`, owner)).data.mandate;
  assert.equal((await call(`${paymentsUrl}/payment-mandates/${stoppedRule.id}/pause`, owner, { expectedVersion: ruleNow.version })).status, 200);
  const stopped = await new AutomationWorker(storeA, new HttpExecutionGateway(gatewayConfig), { workerId: 'worker-a' }).runOnce();
  assert.equal(stopped!.id, stoppedJob.id);
  assert.equal(stopped!.state, 'SKIPPED', JSON.stringify(stopped));
  assert.equal(await wallet(), beforeStopped);
  assert.equal(paid(stoppedBill), false);
  storeA.close(); storeB.close();
  console.log('PASS: the persistent worker settles a leased job once under a two-worker race, never reruns it, and skips a paused rule without moving money.');
  // ---- The scheduler reads the run over HTTP, enqueues the due invoice once, and the worker settles it. ----
  const schedulerStore = new JobStore(join(scratch, 'scheduled.sqlite'));
  const scheduled = await newMandate();
  n++;
  const scheduledBill = `e2e-auto-bill-${n}`;
  env.providerStores.get('dewa')!.put(accountId, 'bill', { billId: scheduledBill, accountNumber: dewa.reference, totalAmount: 150, status: 'UNPAID', dueDate: due }, scheduledBill);
  const rules = new HttpRuleSource(gatewayConfig), scheduler = new Scheduler(schedulerStore, rules);
  assert.ok((await rules.rules()).some(r => r.mandateId === scheduled.id && r.state === 'APPROVED'));
  assert.deepEqual((await new HttpRuleSource({ ...gatewayConfig, clientSecret: 'wrong' }).rules().then(() => 'read', () => 'denied')), 'denied', 'only the worker identity reads the scheduling view');
  const beforeScheduled = await wallet();
  const ticked = await Promise.all([scheduler.tick(Date.now()), scheduler.tick(Date.now())]);
  const mine = (r: { enqueued: string[] }) => r.enqueued.filter(k => k.startsWith(`${scheduled.id}:`));
  assert.ok(ticked.flatMap(mine).length >= 1);
  const scheduledJobs = schedulerStore.list().filter(j => j.mandateId === scheduled.id);
  assert.equal(scheduledJobs.length, 1, 'duplicate ticks produced one job for the due invoice');
  assert.match(scheduledJobs[0]!.occurrenceKey, /^INV:/);
  assert.equal(await wallet(), beforeScheduled, 'scheduling alone moves no money');
  await new AutomationWorker(schedulerStore, new HttpExecutionGateway(gatewayConfig), { workerId: 'worker-sched' }).drain();
  assert.equal(schedulerStore.get(scheduledJobs[0]!.id)!.state, 'SETTLED', JSON.stringify(schedulerStore.list().map(j => [j.mandateId === scheduled.id, j.state, j.reason])));
  assert.equal(await wallet(), beforeScheduled - 15000, 'exactly one invoice was paid');
  await scheduler.tick(Date.now());
  assert.equal(schedulerStore.list().filter(j => j.mandateId === scheduled.id).length, 1, 'a settled occurrence is never scheduled again');
  schedulerStore.close();
  console.log('PASS: the scheduler reads rules over HTTP, enqueues the due invoice once under duplicate ticks, and the worker settles it once.');
} finally {
  if (restoreBroker) execFileSync('docker', ['compose', '-f', 'docker-compose.demo.yml', 'up', '-d', '--force-recreate', '--wait', 'delegation-broker'], { stdio: 'ignore' });
  try { await env?.cleanup(); } catch { /* Windows may briefly hold SQLite files */ }
  try { rmSync(scratch, { recursive: true, force: true }); } catch { /* Windows may briefly hold the directory */ }
}
