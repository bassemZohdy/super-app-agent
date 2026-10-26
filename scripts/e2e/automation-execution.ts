import { delegationAuthorityUrl, keycloakIssuerUrl } from '../endpoints.ts';
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
import { armFailpoint, clearFailpoints, failpointFirings } from '../../services/provider-simulator/src/failpoints.ts';
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
  process.env.DELEGATION_AUTHORITY_URL = delegationAuthorityUrl;
  const brokerUrl = process.env.DELEGATION_AUTHORITY_URL;

  const call = async (url: string, bearer: string, body?: unknown) => {
    const r = await fetch(url, { method: body === undefined ? 'GET' : 'POST', headers: { Authorization: `Bearer ${bearer}`, 'Content-Type': 'application/json', 'Idempotency-Key': randomUUID() }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(20000) });
    return { status: r.status, data: await r.json().catch(() => ({})) as any };
  };
  const accounts = (await call(`${env.coreUrl}/api/accounts`, owner)).data.accounts;
  const accountId = accounts.find((a: any) => a.label === 'Personal account').id as string;
  const api = (path: string, body?: Record<string, unknown>) => call(`${env!.coreUrl}/api/payments/${path}${body ? '' : `?accountId=${accountId}`}`, owner, body ? { accountId, requestKey: randomUUID(), ...body } : undefined);
  const wallet = async () => (await call(`http://localhost:${env!.corePort + 107}/v1/accounts/${accountId}/wallet`, owner)).data.balanceMinor as number;
  // The ledger's own journal for the account, so a debit is proved against the entries and not only the balance (QA-04).
  const journal = () => {
    const db = env!.providerStores.get('payments')!.db;
    return (db.prepare("SELECT id, kind, reference, wallet_delta, finalized FROM payment_journal_entries WHERE account_id=? AND kind<>'OPENING' ORDER BY rowid").all(accountId) as Array<{ id: string; kind: string; reference: string; wallet_delta: number; finalized: number }>)
      .map(entry => ({ ...entry, postings: (db.prepare('SELECT ledger_account, amount_minor FROM payment_journal_postings WHERE entry_id=? ORDER BY line').all(entry.id) as Array<{ ledger_account: string; amount_minor: number }>).map(posting => ({ ...posting })) }));
  };
  const assertOnePayment = (entries: ReturnType<typeof journal>, minor: number, label: string) => {
    assert.equal(entries.length, 1, `${label}: exactly one journal entry`);
    assert.deepEqual([entries[0].kind, entries[0].wallet_delta, entries[0].finalized], ['PAYMENT', -minor, 1], label);
    assert.deepEqual(entries[0].postings, [{ ledger_account: 'wallet', amount_minor: -minor }, { ledger_account: 'merchant-clearing', amount_minor: minor }], `${label}: balanced against merchant clearing`);
  };

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
  assertOnePayment(journal(), 15000, 'the admitted token settles once');
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
  const newMandate = async (funding?: { id: string; version: number }) => {
    const made = await api('mandates', { policy: { ...policy, sources: funding ? [{ methodId: funding.id, expectedVersion: funding.version }] : policy.sources, purpose: `Pay my DEWA bill automatically (${++n})` } });
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
  const beforeWorker = await wallet(), journalBeforeWorker = journal().length;
  const results = await Promise.all([
    new AutomationWorker(storeA, new HttpExecutionGateway(gatewayConfig), { workerId: 'worker-a' }).runOnce(),
    new AutomationWorker(storeB, new HttpExecutionGateway(gatewayConfig), { workerId: 'worker-b' }).runOnce(),
  ]);
  assert.equal(results.filter(Boolean).length, 1, 'only one worker obtained the leased job');
  const finished = storeA.get(job.id)!;
  assert.equal(finished.state, 'SETTLED', JSON.stringify(finished));
  assert.equal(await wallet(), beforeWorker - 15000, 'the worker-driven job debited the wallet once');
  assert.equal(journal().length, journalBeforeWorker + 1, 'the worker-driven job wrote exactly one journal entry');
  assert.deepEqual([journal().at(-1)!.kind, journal().at(-1)!.wallet_delta, journal().at(-1)!.finalized], ['PAYMENT', -15000, 1]);
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
  // ---- AUTO-14: the owner's inbox shows the settled and paused outcomes once each, with reason, rule version and effect; another user sees none of them. ----
  // The core reads the worker's store per request, so pointing it at this run's file is enough.
  process.env.AUTOMATION_JOBS_DB = jobsPath;
  const inboxFor = async (bearer: string) => {
    const r = await fetch(`${env!.coreUrl}/api/payments/automation-inbox?accountId=${accountId}`, { headers: { Authorization: `Bearer ${bearer}` }, signal: AbortSignal.timeout(20000) });
    return { status: r.status, data: await r.json() as { entries?: Array<Record<string, any>>; requestId?: string } };
  };
  const feed = await inboxFor(owner);
  assert.equal(feed.status, 200, JSON.stringify(feed.data));
  assert.ok(feed.data.requestId, 'the feed names the request');
  const settledEntries = feed.data.entries!.filter(e => e.mandateId === workerMandate.id && e.kind === 'SETTLED');
  assert.equal(settledEntries.length, 1, 'the settled run appears exactly once');
  assert.equal(settledEntries[0].effect, 'Money moved once, as approved');
  assert.equal(settledEntries[0].policyVersion, workerMandate.policyVersion);
  const pausedEntries = feed.data.entries!.filter(e => e.mandateId === stoppedRule.id);
  assert.equal(pausedEntries.length, 1, 'the paused run appears exactly once');
  assert.equal(pausedEntries[0].kind, 'SKIPPED');
  assert.equal(pausedEntries[0].reason, 'MANDATE_NOT_ACTIVE', 'a paused rule says why it did not run');
  assert.equal(pausedEntries[0].effect, 'None');
  const reread = await inboxFor(owner);
  assert.equal(reread.data.entries!.length, feed.data.entries!.length, 're-reading the feed never duplicates an entry');
  const others = await inboxFor(other);
  const leaked = others.status === 200 ? (others.data.entries ?? []).filter(e => e.mandateId === workerMandate.id || e.mandateId === stoppedRule.id) : [];
  assert.equal(leaked.length, 0, 'another owner never sees these rules');
  assert.ok(others.status === 200 || others.status === 403 || others.status === 404, `another owner is refused or sees nothing (${others.status})`);
  delete process.env.AUTOMATION_JOBS_DB;
  console.log('PASS: the owner inbox shows the settled and paused outcomes once each with reason, rule version and effect, re-reads without duplicates, and hides them from another owner.');
  // ---- The scheduler reads the run over HTTP, enqueues the due invoice once, and the worker settles it. ----
  const schedulerStore = new JobStore(join(scratch, 'scheduled.sqlite'));
  const scheduled = await newMandate();
  n++;
  const scheduledBill = `e2e-auto-bill-${n}`;
  env.providerStores.get('dewa')!.put(accountId, 'bill', { billId: scheduledBill, accountNumber: dewa.reference, totalAmount: 150, status: 'UNPAID', dueDate: due }, scheduledBill);
  const rules = new HttpRuleSource(gatewayConfig), scheduler = new Scheduler(schedulerStore, rules);
  assert.ok((await rules.rules()).some(r => r.mandateId === scheduled.id && r.state === 'APPROVED'));
  assert.deepEqual((await new HttpRuleSource({ ...gatewayConfig, clientSecret: 'wrong' }).rules().then(() => 'read', () => 'denied')), 'denied', 'only the worker identity reads the scheduling view');
  const beforeScheduled = await wallet(), journalBeforeScheduled = journal().length;
  const ticked = await Promise.all([scheduler.tick(Date.now()), scheduler.tick(Date.now())]);
  const mine = (r: { enqueued: string[] }) => r.enqueued.filter(k => k.startsWith(`${scheduled.id}:`));
  assert.ok(ticked.flatMap(mine).length >= 1);
  const scheduledJobs = schedulerStore.list().filter(j => j.mandateId === scheduled.id);
  assert.equal(scheduledJobs.length, 1, 'duplicate ticks produced one job for the due invoice');
  assert.match(scheduledJobs[0]!.occurrenceKey, /^INV:/);
  assert.equal(await wallet(), beforeScheduled, 'scheduling alone moves no money');
  assert.equal(journal().length, journalBeforeScheduled, 'scheduling alone writes nothing to the journal');
  await new AutomationWorker(schedulerStore, new HttpExecutionGateway(gatewayConfig), { workerId: 'worker-sched' }).drain();
  assert.equal(schedulerStore.get(scheduledJobs[0]!.id)!.state, 'SETTLED', JSON.stringify(schedulerStore.list().map(j => [j.mandateId === scheduled.id, j.state, j.reason])));
  assert.equal(await wallet(), beforeScheduled - 15000, 'exactly one invoice was paid');
  assertOnePayment(journal().slice(journalBeforeScheduled), 15000, 'the scheduled run');
  await scheduler.tick(Date.now());
  assert.equal(schedulerStore.list().filter(j => j.mandateId === scheduled.id).length, 1, 'a settled occurrence is never scheduled again');
  assert.equal(journal().length, journalBeforeScheduled + 1, 'and writes no second journal entry');
  schedulerStore.close();
  // ---- AUTO-14: the owner is told once, ahead of a run that has not started, and nothing is queued until the run is due. ----
  const upcomingRule = await newMandate(); n++;
  const upcomingBill = `e2e-auto-bill-${n}-upcoming`;
  const upcomingDue = new Date(Date.now() + 10 * 86400000).toISOString().slice(0, 10);
  env!.providerStores.get('dewa')!.put(accountId, 'bill', { billId: upcomingBill, accountNumber: dewa.reference, totalAmount: 150, status: 'UNPAID', dueDate: upcomingDue }, upcomingBill);
  const upcomingStore = new JobStore(join(scratch, 'upcoming.sqlite'));
  const upcomingScheduler = new Scheduler(upcomingStore, new HttpRuleSource(gatewayConfig));
  // Step the scheduler's clock forward until this rule's run is inside the lead time; the run itself is still in the future.
  let noticeAt: number | undefined;
  for (let t = Date.now(); t < Date.now() + 12 * 86400000 && noticeAt === undefined; t += 6 * 3600000) {
    await upcomingScheduler.tick(t);
    if (upcomingStore.notices(upcomingRule.id).length > 0) noticeAt = t;
  }
  assert.ok(noticeAt !== undefined, 'the scheduler announced the upcoming run');
  const notice = upcomingStore.notices(upcomingRule.id)[0];
  assert.equal(notice.kind, 'UPCOMING_RUN');
  assert.ok(Date.parse(String(notice.body.runAt)) > noticeAt!, 'the announced run has not started yet');
  // Other unpaid bills on this account may already be due and queued; what must not happen is queuing the announced occurrence early.
  assert.equal(upcomingStore.list().filter(j => j.mandateId === upcomingRule.id && j.occurrenceKey === notice.occurrenceKey).length, 0, 'the announced run is not queued before it is due');
  process.env.AUTOMATION_JOBS_DB = join(scratch, 'upcoming.sqlite');
  const upcomingEntries = (await inboxFor(owner)).data.entries!.filter(e => e.mandateId === upcomingRule.id && e.kind === 'UPCOMING_RUN');
  assert.equal(upcomingEntries.length, 1, 'the owner is told once');
  assert.match(upcomingEntries[0].effect, /until the run itself/);
  await upcomingScheduler.tick(noticeAt!);
  assert.equal(upcomingStore.notices(upcomingRule.id).length, 1, 'a repeated tick never repeats the notice');
  delete process.env.AUTOMATION_JOBS_DB;
  upcomingStore.close();
  console.log('PASS: the scheduler tells the owner once, ahead of a run that has not started, and queues nothing until the run is due.');
  console.log('PASS: the scheduler reads rules over HTTP, enqueues the due invoice once under duplicate ticks, and the worker settles it once.');
  // ---- A preview is an owner-only read that changes nothing. ----
  n++;
  const previewBill = `e2e-auto-bill-${n}`, previewRule = await newMandate();
  env.providerStores.get('dewa')!.put(accountId, 'bill', { billId: previewBill, accountNumber: dewa.reference, totalAmount: 150, status: 'UNPAID', dueDate: due }, previewBill);
  const claimCount = () => Number(env!.providerStores.get('dewa')!.db.prepare('SELECT count(*) n FROM automation_payable_claims').get()!.n);
  const beforePreview = { wallet: await wallet(), claims: claimCount() };
  const previewUrl = `${env.coreUrl}/api/payments/mandates/preview?accountId=${accountId}&mandateId=${previewRule.id}`;
  const forecast = await call(previewUrl, owner);
  assert.equal(forecast.status, 200, JSON.stringify(forecast.data));
  assert.equal(forecast.data.forecast.zeroEffect, true);
  assert.equal(forecast.data.forecast.wouldRun, true);
  assert.ok(forecast.data.forecast.candidates.some((c: any) => c.amountMinor === 15000 && c.decision !== 'SKIP'));
  assert.equal(forecast.data.forecast.source.usable, true);
  assert.deepEqual((await call(previewUrl, owner)).data.forecast.candidates.map((c: any) => c.payableId), forecast.data.forecast.candidates.map((c: any) => c.payableId), 'asking again is the same read');
  assert.ok([401, 403, 404].includes((await call(previewUrl, other)).status), 'another user cannot preview this rule');
  assert.ok([401, 403].includes((await call(`${paymentsUrl}/payment-mandates/${previewRule.id}/preview`, worker)).status), 'the worker identity is not an owner');
  assert.equal(await wallet(), beforePreview.wallet, 'a preview moved no money');
  assert.equal(paid(previewBill), false);
  assert.equal(claimCount(), beforePreview.claims, 'a preview claimed no invoice');
  console.log('PASS: the owner previews a rule through the app route with zero effect; other identities cannot.');
  // ---- AUTO-08: card-funded and telecom invoices, and a decline that surfaces for the owner with no fallback. ----
  const cardStore = new JobStore(join(scratch, 'cards.sqlite'));
  const runJob = async (mandateRef: { id: string; policyVersion: number }, key: string) => {
    const queued = cardStore.enqueue({ mandateId: mandateRef.id, policyVersion: mandateRef.policyVersion, occurrenceKey: key, target: `dewa-${billing.id}` });
    await new AutomationWorker(cardStore, new HttpExecutionGateway(gatewayConfig), { workerId: 'worker-cards' }).runOnce();
    return { job: cardStore.get(queued.id)!, events: cardStore.outbox(queued.id).map(e => e.kind) };
  };
  const addBill = (suffix: string) => { n++; const id = `e2e-auto-bill-${n}-${suffix}`; env!.providerStores.get('dewa')!.put(accountId, 'bill', { billId: id, accountNumber: dewa.reference, totalAmount: 150, status: 'UNPAID', dueDate: due }, id); return id; };
  const approvedCard = (await api('methods', { preset: 'approved', nickname: 'Auto approved' })).data.method, declinedCard = (await api('methods', { preset: 'declined', nickname: 'Auto declined' })).data.method;
  const cardRule = await newMandate(approvedCard);
  addBill('card');
  const beforeCard = await wallet();
  const viaCard = await runJob(cardRule, 'occ-card-1');
  assert.equal(viaCard.job.state, 'SETTLED', JSON.stringify(viaCard.job));
  assert.deepEqual(viaCard.events, ['PREPARED', 'SETTLED']);
  assert.equal(await wallet(), beforeCard, 'a card-funded rule leaves the wallet alone');
  const declinedRule = await newMandate(declinedCard);
  addBill('declined');
  const beforeDecline = await wallet();
  const declined = await runJob(declinedRule, 'occ-decline-1');
  assert.equal(declined.job.state, 'FAILED', JSON.stringify(declined.job));
  assert.equal(declined.job.reason, 'CARD_DECLINED');
  // AUTO-14: the declined card reaches the owner's inbox as a decision with its reason, and nothing else.
  process.env.AUTOMATION_JOBS_DB = join(scratch, 'cards.sqlite');
  // The run is listed once per source event: the preparation, then the decline that needs the owner.
  const declinedFeed = (await inboxFor(owner)).data.entries!.filter(e => e.mandateId === declinedRule.id);
  assert.deepEqual(declinedFeed.map(e => e.kind).sort(), ['PREPARED', 'REQUIRES_ACTION'], JSON.stringify(declinedFeed));
  const decision = declinedFeed.find(e => e.kind === 'REQUIRES_ACTION')!;
  assert.equal(decision.reason, 'CARD_DECLINED');
  assert.equal(decision.effect, 'None');
  delete process.env.AUTOMATION_JOBS_DB;
  // ---- AUTO-14: a card challenge holds the run for its owner. Approve pays the same bill once; reject closes it with nothing paid. ----
  const challengeCard = (await api('methods', { preset: 'challenge', nickname: 'Auto challenge' })).data.method;
  const sleep = (ms: number) => new Promise(done => setTimeout(done, ms));
  const challengeWorker = (store: JobStore) => new AutomationWorker(store, new HttpExecutionGateway(gatewayConfig), { workerId: 'worker-challenge', challengeWaitMs: 1000, sleep: async () => {} });
  const answerChallenge = async (orderId: string, decision: 'APPROVE' | 'REJECT') => {
    const order = (await api('overview')).data.orders.find((o: any) => o.id === orderId);
    assert.equal(order.state, 'REQUIRES_ACTION', 'the order is waiting for the owner');
    const answered = await api('orders/challenge', { orderId, expectedVersion: order.version, approvalDigest: order.approvalDigest, challengeId: order.authorization.challengeId, decision });
    assert.equal(answered.status, 200, JSON.stringify(answered.data));
  };
  const challengeStore = new JobStore(join(scratch, 'challenge.sqlite'));
  const approveRule = await newMandate(challengeCard), approveBill = addBill('challenge-approve');
  const approveJob = challengeStore.enqueue({ mandateId: approveRule.id, policyVersion: approveRule.policyVersion, occurrenceKey: 'occ-challenge-approve', target: `dewa-${billing.id}` });
  const held = await challengeWorker(challengeStore).runOnce();
  assert.equal(held!.state, 'HELD', JSON.stringify(held));
  assert.equal(held!.reason, 'REQUIRES_ACTION');
  const approveOrder = challengeStore.outbox(approveJob.id).find(e => e.kind === 'REQUIRES_ACTION')!.body.orderId as string;
  assert.equal(paid(approveBill), false, 'a held challenge has not paid');
  process.env.AUTOMATION_JOBS_DB = join(scratch, 'challenge.sqlite');
  const heldEntry = (await inboxFor(owner)).data.entries!.find(e => e.mandateId === approveRule.id && e.kind === 'REQUIRES_ACTION');
  assert.ok(heldEntry, 'the held challenge is in the owner inbox');
  assert.equal(heldEntry!.orderId, approveOrder, 'the inbox names the order the owner answers');
  await sleep(1100);
  const stillWaiting = await challengeWorker(challengeStore).runOnce();
  assert.equal(stillWaiting!.state, 'HELD', 'an unanswered challenge stays held');
  assert.equal(paid(approveBill), false);
  await answerChallenge(approveOrder, 'APPROVE');
  await sleep(1100);
  const approved = await challengeWorker(challengeStore).runOnce();
  assert.equal(approved!.state, 'SETTLED', JSON.stringify(approved));
  // A card payment is settled on its order; the wallet stays as it was. The order's state is the record of the one payment.
  const approvedOrder = (await api('overview')).data.orders.find((o: any) => o.id === approveOrder);
  assert.equal(approvedOrder.state, 'SETTLED', JSON.stringify(approvedOrder.state));
  assert.deepEqual(challengeStore.outbox(approveJob.id).map(e => e.kind), ['PREPARED', 'REQUIRES_ACTION', 'CHALLENGE_ANSWERED', 'SETTLED']);
  const approvedFeed = (await inboxFor(owner)).data.entries!.filter(e => e.mandateId === approveRule.id).map(e => e.kind).sort();
  assert.deepEqual(approvedFeed, ['CHALLENGE_ANSWERED', 'PREPARED', 'REQUIRES_ACTION', 'SETTLED'], JSON.stringify(approvedFeed));
  const rejectRule = await newMandate(challengeCard), rejectBill = addBill('challenge-reject');
  const rejectJob = challengeStore.enqueue({ mandateId: rejectRule.id, policyVersion: rejectRule.policyVersion, occurrenceKey: 'occ-challenge-reject', target: `dewa-${billing.id}` });
  await challengeWorker(challengeStore).runOnce();
  const rejectOrder = challengeStore.outbox(rejectJob.id).find(e => e.kind === 'REQUIRES_ACTION')!.body.orderId as string;
  await answerChallenge(rejectOrder, 'REJECT');
  await sleep(1100);
  const rejected = await challengeWorker(challengeStore).runOnce();
  assert.equal(rejected!.state, 'FAILED', JSON.stringify(rejected));
  assert.equal(rejected!.reason, 'CHALLENGE_REJECTED');
  assert.equal(paid(rejectBill), false, 'a rejected challenge pays nothing');
  const rejectedAnswer = (await inboxFor(owner)).data.entries!.find(e => e.mandateId === rejectRule.id && e.kind === 'CHALLENGE_ANSWERED');
  assert.equal(rejectedAnswer?.reason, 'CHALLENGE_REJECTED', 'the rejection is in the owner inbox with its reason');
  delete process.env.AUTOMATION_JOBS_DB;
  challengeStore.close();
  console.log('PASS: a card challenge holds the run until the owner answers; approve pays the bill once, reject pays nothing, and both answers reach the owner inbox.');
  assert.deepEqual(declined.events, ['PREPARED', 'REQUIRES_ACTION'], 'the owner is told that action is needed');
  assert.equal(await wallet(), beforeDecline, 'a declined card never falls back to the wallet');
  assert.equal(cardStore.get(declined.job.id)!.state, 'FAILED');
  assert.equal(await new AutomationWorker(cardStore, new HttpExecutionGateway(gatewayConfig), { workerId: 'worker-cards' }).runOnce(), undefined, 'the failed occurrence is not retried');
  const telecom = new (await import('../../services/provider-simulator/src/engine.ts')).ProviderEngine('etisalat', env.providerStores.get('etisalat')!);
  const subscription = (env.providerStores.get('etisalat')!.list(accountId, 'subscription').find((x: { status?: string }) => x.status === 'ACTIVE') as { subscriptionId: string } | undefined);
  assert.ok(subscription, 'the owner has an active Etisalat subscription');
  telecom.lifecycle!.ingest(accountId, { kind: 'INVOICE_ISSUED', eventId: `e2e-issue-${n}`, billId: `e2e-tele-${n}`, reference: subscription!.subscriptionId, amountMinor: 15000, dueDate: due, period: due.slice(0, 7) });
  const telecomLink = await api('billing-accounts', { provider: 'etisalat', reference: subscription!.subscriptionId, nickname: 'Mobile' });
  assert.equal(telecomLink.status, 200, JSON.stringify(telecomLink.data));
  const telecomPolicy = { ...policy, target: { kind: 'BILLER', billingAccountId: telecomLink.data.billingAccount.id, expectedVersion: telecomLink.data.billingAccount.version, provider: 'etisalat', reference: subscription!.subscriptionId }, purpose: 'Pay my Etisalat bill automatically' };
  const telecomMade = await api('mandates', { policy: telecomPolicy });
  assert.equal(telecomMade.status, 200, JSON.stringify(telecomMade.data));
  const telecomRule = (await api('mandates/approve', { mandateId: telecomMade.data.mandate.id, expectedVersion: telecomMade.data.mandate.version, approvalDigest: telecomMade.data.mandate.approvalDigest })).data.mandate;
  const beforeTelecom = await wallet();
  const telecomJob = cardStore.enqueue({ mandateId: telecomRule.id, policyVersion: telecomRule.policyVersion, occurrenceKey: 'occ-tele-1', target: `etisalat-${telecomLink.data.billingAccount.id}` });
  await new AutomationWorker(cardStore, new HttpExecutionGateway(gatewayConfig), { workerId: 'worker-cards' }).runOnce();
  assert.equal(cardStore.get(telecomJob.id)!.state, 'SETTLED', JSON.stringify(cardStore.get(telecomJob.id)));
  assert.equal(await wallet(), beforeTelecom - 15000, 'the telecom invoice was paid once from the wallet');
  cardStore.close();
  console.log('PASS: card-funded and telecom invoices settle once; a declined card needs the owner and never falls back to the wallet.');
  // ---- AUTO-09: a low wallet balance reloads once from the approved card, and a balance that stays low does not reload again. ----
  const reloadStore = new JobStore(join(scratch, 'reload.sqlite'));
  const reloadPolicy = { ...policy, operation: 'WALLET_RELOAD', target: { kind: 'WALLET' }, sources: [{ methodId: approvedCard.id, expectedVersion: approvedCard.version }], purpose: 'Keep my wallet topped up',
    trigger: { type: 'LOW_BALANCE', belowMinor: 900000, reloadMinor: 5000, targetBalanceMinor: 1000000 } };
  const reloadMade = await api('mandates', { policy: reloadPolicy });
  assert.equal(reloadMade.status, 200, JSON.stringify(reloadMade.data));
  const reloadRule = (await api('mandates/approve', { mandateId: reloadMade.data.mandate.id, expectedVersion: reloadMade.data.mandate.version, approvalDigest: reloadMade.data.mandate.approvalDigest })).data.mandate;
  const allRules = new HttpRuleSource(gatewayConfig);
  const reloadOnly: typeof allRules = Object.assign(Object.create(allRules), { rules: async () => (await allRules.rules()).filter(r => r.mandateId === reloadRule.id) });
  const reloadScheduler = new Scheduler(reloadStore, reloadOnly);
  const beforeReload = await wallet();
  const reloadTicks = await Promise.all([reloadScheduler.tick(Date.now()), reloadScheduler.tick(Date.now())]);
  assert.equal(reloadTicks.flatMap(r => r.enqueued).length, 1, 'concurrent evaluations of one dip fire once');
  assert.equal(await wallet(), beforeReload, 'scheduling alone moves no money');
  await new AutomationWorker(reloadStore, new HttpExecutionGateway(gatewayConfig), { workerId: 'worker-reload' }).drain();
  const reloadJob = reloadStore.list()[0]!;
  assert.equal(reloadJob.state, 'SETTLED', JSON.stringify(reloadJob));
  assert.equal(reloadJob.occurrenceKey, 'THR:1');
  assert.equal(await wallet(), beforeReload + 5000, 'exactly one finite reload reached the wallet');
  for (let i = 0; i < 3; i++) { await reloadScheduler.tick(Date.now()); await new AutomationWorker(reloadStore, new HttpExecutionGateway(gatewayConfig), { workerId: 'worker-reload' }).drain(); }
  assert.equal(reloadStore.list().length, 1, 'a balance that stays below the threshold does not reload again');
  assert.equal(await wallet(), beforeReload + 5000);
  const orders = (await call(`${paymentsUrl}/wallet-funding-orders`, owner)).data.orders as { automation?: unknown; state: string; id: string; version: number; approvalDigest: string }[];
  const automatic = orders.find(o => o.automation)!;
  assert.equal(automatic.state, 'SETTLED');
  assert.equal((await call(`${paymentsUrl}/wallet-funding-orders/${automatic.id}/approve`, owner, { expectedVersion: automatic.version, approvalDigest: automatic.approvalDigest })).status, 403);
  assert.equal((await call(`${paymentsUrl}/wallet-funding-orders/${automatic.id}/cancel`, owner, { expectedVersion: automatic.version })).status, 403);
  // Replaying execute on the settled order only returns it; it cannot credit again.
  const replayed = await call(`${paymentsUrl}/wallet-funding-orders/${automatic.id}/execute`, owner, { expectedVersion: automatic.version, approvalDigest: automatic.approvalDigest });
  assert.equal(replayed.data.order?.state ?? 'SETTLED', 'SETTLED');
  assert.equal(await wallet(), beforeReload + 5000);
  reloadStore.close();
  console.log('PASS: a low balance reloads once from the approved card, never loops while it stays low, and the automatic funding order is closed to ordinary APIs.');
  // ---- AUTO-10: usage on the exact prepaid line triggers one recharge; another line's usage and a settled recharge do not. ----
  const rechargeStore = new JobStore(join(scratch, 'recharge.sqlite'));
  const prepaid = telecom.recharges!.targets(accountId)[0]!;
  const prepaidLink = await api('billing-accounts', { provider: 'etisalat', reference: prepaid.reference, nickname: 'Prepaid line' });
  assert.equal(prepaidLink.status, 200, JSON.stringify(prepaidLink.data));
  const rechargePolicy = { ...policy, operation: 'RECHARGE', purpose: 'Keep my prepaid line recharged',
    target: { kind: 'BILLER', billingAccountId: prepaidLink.data.billingAccount.id, expectedVersion: prepaidLink.data.billingAccount.version, provider: 'etisalat', reference: prepaid.reference },
    trigger: { type: 'LOW_BALANCE', belowMinor: 1000, reloadMinor: prepaid.denominationsMinor[0], targetBalanceMinor: 100000 } };
  const rechargeMade = await api('mandates', { policy: rechargePolicy });
  assert.equal(rechargeMade.status, 200, JSON.stringify(rechargeMade.data));
  const rechargeRule = (await api('mandates/approve', { mandateId: rechargeMade.data.mandate.id, expectedVersion: rechargeMade.data.mandate.version, approvalDigest: rechargeMade.data.mandate.approvalDigest })).data.mandate;
  const rechargeRules = new HttpRuleSource(gatewayConfig);
  const rechargeOnly: typeof rechargeRules = Object.assign(Object.create(rechargeRules), { rules: async () => (await rechargeRules.rules()).filter(r => r.mandateId === rechargeRule.id) });
  const rechargeScheduler = new Scheduler(rechargeStore, rechargeOnly);
  const lineBalance = () => telecom.recharges!.targets(accountId).find(x => x.reference === prepaid.reference)!.balanceMinor;
  await rechargeScheduler.tick(Date.now());
  assert.equal(rechargeStore.list().length, 0, 'a healthy prepaid line schedules nothing');
  telecom.lifecycle!.ingest(accountId, { kind: 'USAGE_RECORDED', eventId: `e2e-use-${n}`, targetReference: prepaid.reference, usageMinor: lineBalance() - 500 });
  assert.equal(lineBalance(), 500);
  const beforeRecharge = { wallet: await wallet(), line: lineBalance() };
  const rechargeTicks = await Promise.all([rechargeScheduler.tick(Date.now()), rechargeScheduler.tick(Date.now())]);
  assert.equal(rechargeTicks.flatMap(r => r.enqueued).length, 1, 'concurrent evaluations of one dip fire once');
  await new AutomationWorker(rechargeStore, new HttpExecutionGateway(gatewayConfig), { workerId: 'worker-recharge' }).drain();
  const rechargeJob = rechargeStore.list()[0]!;
  assert.equal(rechargeJob.state, 'SETTLED', JSON.stringify(rechargeJob));
  assert.equal(lineBalance(), beforeRecharge.line + prepaid.denominationsMinor[0], 'the exact line was recharged once');
  assert.equal(await wallet(), beforeRecharge.wallet - prepaid.denominationsMinor[0], 'the wallet paid for it exactly once');
  for (let i = 0; i < 2; i++) { await rechargeScheduler.tick(Date.now()); await new AutomationWorker(rechargeStore, new HttpExecutionGateway(gatewayConfig), { workerId: 'worker-recharge' }).drain(); }
  assert.equal(rechargeStore.list().length, 1, 'the recharge never triggers another');
  rechargeStore.close();
  console.log('PASS: usage on the exact prepaid line triggers one recharge from the wallet, and the settled recharge triggers nothing more.');
  // ---- AUTO-11: only the fine types the owner approved are paid; the others ask for review and nothing moves. ----
  const fineStore = new JobStore(join(scratch, 'fines.sqlite'));
  const police = new (await import('../../services/provider-simulator/src/engine.ts')).ProviderEngine('police', env.providerStores.get('police')!);
  const myFines = police.payables!.list(accountId).filter(p => p.kind === 'FINE' && p.status === 'UNPAID');
  const speeding = myFines.find(p => p.violation === 'Speeding')!, overstay = myFines.find(p => p.violation === 'Parking overstay')!;
  assert.ok(speeding && overstay, 'the owner has both kinds of fine');
  const plateLink = await api('billing-accounts', { provider: 'police', reference: speeding.reference, nickname: 'My car' });
  assert.equal(plateLink.status, 200, JSON.stringify(plateLink.data));
  const finePolicy = { ...policy, operation: 'FINE_PAYMENT', purpose: 'Pay my speeding fines', fineTypes: ['Speeding'], trigger: { type: 'NEW_FINE' },
    target: { kind: 'BILLER', billingAccountId: plateLink.data.billingAccount.id, expectedVersion: plateLink.data.billingAccount.version, provider: 'police', reference: speeding.reference } };
  const fineMade = await api('mandates', { policy: finePolicy });
  assert.equal(fineMade.status, 200, JSON.stringify(fineMade.data));
  const fineRule = (await api('mandates/approve', { mandateId: fineMade.data.mandate.id, expectedVersion: fineMade.data.mandate.version, approvalDigest: fineMade.data.mandate.approvalDigest })).data.mandate;
  const fineRules = new HttpRuleSource(gatewayConfig);
  const fineOnly: typeof fineRules = Object.assign(Object.create(fineRules), { rules: async () => (await fineRules.rules()).filter(r => r.mandateId === fineRule.id) });
  const fineScheduler = new Scheduler(fineStore, fineOnly);
  const beforeFines = await wallet();
  await Promise.all([fineScheduler.tick(Date.now()), fineScheduler.tick(Date.now())]);
  assert.equal(fineStore.list().length, myFines.length, 'each unpaid fine is announced exactly once');
  await new AutomationWorker(fineStore, new HttpExecutionGateway(gatewayConfig), { workerId: 'worker-fines' }).drain();
  const byFine = (fine: { obligationId?: string }) => fineStore.list().find(j => j.occurrenceKey === `FINE:${fine.obligationId}`)!;
  assert.equal(byFine(speeding).state, 'SETTLED', JSON.stringify(byFine(speeding)));
  assert.equal(byFine(overstay).state, 'SKIPPED');
  assert.equal(byFine(overstay).reason, 'FINE_TYPE_NOT_APPROVED');
  assert.deepEqual(fineStore.outbox(byFine(overstay).id).map(e => e.kind), ['REQUIRES_ACTION'], 'the excluded fine asks the owner to review it');
  assert.equal(await wallet(), beforeFines - speeding.amountMinor, 'only the approved fine was paid, once');
  assert.equal(env.providerStores.get('police')!.get(accountId, 'fine', speeding.obligationId!).status, 'PAID');
  assert.equal(env.providerStores.get('police')!.get(accountId, 'fine', overstay.obligationId!).status, 'UNPAID');
  await fineScheduler.tick(Date.now());
  assert.equal(fineStore.list().length, myFines.length, 'a paid or reviewed fine is not announced again');
  fineStore.close();
  console.log('PASS: only the approved fine type is paid automatically; the other fine waits for the owner and nothing else moves.');
  // ---- AUTO-12: only the bound parking session is extended, one hour at a time, and departure ends it. ----
  const parkingStore = new JobStore(join(scratch, 'parking.sqlite'));
  const rtaStore = env.providerStores.get('rta')!, rtaEngine = new (await import('../../services/provider-simulator/src/engine.ts')).ProviderEngine('rta', rtaStore);
  const { parkingZones } = await import('../../services/provider-simulator/src/fixtures.ts');
  const zone = parkingZones[0]!, tariffMinor = Math.round(zone.tariffPerHour * 100), ticketId = `e2e-ticket-${n}`, plate = 'DXB E2E-1';
  const startedAt = Date.now();
  rtaStore.put(accountId, 'parking', { ticketId, zoneId: zone.id, zoneCode: zone.code, zoneName: zone.name, plateNumber: plate, durationHours: 1, totalFee: zone.tariffPerHour, startTime: startedAt - 1800000, expiresAt: startedAt + 5 * 60000, status: 'ACTIVE' }, ticketId);
  const meterNow = () => rtaStore.get(accountId, 'parking', ticketId) as { expiresAt: number; durationHours: number; status: string };
  const parkingPolicy = { ...policy, operation: 'PARKING_EXTENSION', purpose: 'Keep this parking session running', trigger: { type: 'PARKING_ENDING', minutesBefore: 10 },
    target: { kind: 'PARKING', ticketId, plateNumber: plate, zoneId: zone.id, maximumHours: 3, endAt: new Date(startedAt + 6 * 3600000).toISOString() } };
  const parkingMade = await api('mandates', { policy: parkingPolicy });
  assert.equal(parkingMade.status, 200, JSON.stringify(parkingMade.data));
  const parkingRule = (await api('mandates/approve', { mandateId: parkingMade.data.mandate.id, expectedVersion: parkingMade.data.mandate.version, approvalDigest: parkingMade.data.mandate.approvalDigest })).data.mandate;
  const parkingRules = new HttpRuleSource(gatewayConfig);
  const parkingOnly: typeof parkingRules = Object.assign(Object.create(parkingRules), { rules: async () => (await parkingRules.rules()).filter(r => r.mandateId === parkingRule.id) });
  const parkingScheduler = new Scheduler(parkingStore, parkingOnly);
  const beforeParking = { wallet: await wallet(), expiresAt: meterNow().expiresAt };
  await Promise.all([parkingScheduler.tick(Date.now()), parkingScheduler.tick(Date.now())]);
  assert.equal(parkingStore.list().length, 1, 'the ending session is announced once');
  assert.equal(await wallet(), beforeParking.wallet, 'scheduling alone moves no money');
  await new AutomationWorker(parkingStore, new HttpExecutionGateway(gatewayConfig), { workerId: 'worker-parking' }).drain();
  assert.equal(parkingStore.list()[0]!.state, 'SETTLED', JSON.stringify(parkingStore.list()[0]));
  assert.equal(meterNow().expiresAt, beforeParking.expiresAt + 3600000, 'the session grew by exactly one hour');
  assert.equal(meterNow().durationHours, 2);
  assert.equal(await wallet(), beforeParking.wallet - tariffMinor, 'the wallet paid for it once');
  await parkingScheduler.tick(Date.now());
  assert.equal(parkingStore.list().length, 1, 'the extended session is not ending yet, so nothing more is announced');
  const manualExtension = await call(`http://localhost:${env.corePort + 101}/v1/accounts/${accountId}/parking/sessions/${ticketId}/extensions`, owner, { additionalHours: 1, paymentId: 'none', reference: 'manual-1' });
  assert.ok(manualExtension.status >= 400, 'a manual extension still needs its own proof of payment');
  // Departure ends the session for good: even if it were near its end again, nothing extends it.
  rtaEngine.lifecycle!.ingest(accountId, { kind: 'PARKING_DEPARTED', eventId: `e2e-depart-${n}`, ticketId });
  assert.equal(meterNow().status, 'ENDED');
  await parkingScheduler.tick(Date.now());
  assert.equal(parkingStore.list().length, 1, 'an ended session is never announced');
  parkingStore.close();
  console.log('PASS: the bound parking session is extended by one hour exactly once, paid once, and departure stops any further extension.');
  // ---- AUTO-14 step 6: a lost response the worker cannot resolve is held as unknown, captures nothing, is never retried under a new identity, and says so in the owner inbox. ----
  const unknownRule = await newMandate(), unknownBill = addBill('unknown');
  const unknownStore = new JobStore(join(scratch, 'unknown.sqlite'));
  unknownStore.enqueue({ mandateId: unknownRule.id, policyVersion: unknownRule.policyVersion, occurrenceKey: 'occ-unknown', target: `dewa-${billing.id}` });
  const unknownWorker = new AutomationWorker(unknownStore, new HttpExecutionGateway(gatewayConfig), { workerId: 'worker-unknown', retryDelayMs: 1, sleep: async () => {} });
  const beforeUnknown = await wallet();
  // The provider loses its response after the admission is created and before any capture. Recovery marks the order unresolved,
  // which the worker sees as the order still capturing: it cannot tell whether money moved.
  armFailpoint('checkout.after-admission', 100);
  let unknownHeld;
  try {
    unknownHeld = await unknownWorker.runOnce();
    assert.ok(failpointFirings('checkout.after-admission') >= 1, 'the provider lost its response before any capture');
  } finally { clearFailpoints(); }
  assert.equal(unknownHeld!.state, 'HELD', JSON.stringify(unknownHeld));
  assert.ok(['OUTCOME_UNKNOWN', 'ORDER_CAPTURING'].includes(unknownHeld!.reason!), JSON.stringify(unknownHeld));
  assert.equal(await wallet(), beforeUnknown, 'nothing was captured that the owner can see');
  assert.equal(paid(unknownBill), false);
  // The held outcome is never retried under a new identity, even though the failpoint is now cleared.
  assert.equal(await unknownWorker.runOnce(), undefined, 'the held outcome is not run again');
  process.env.AUTOMATION_JOBS_DB = join(scratch, 'unknown.sqlite');
  const unknownEntry = (await inboxFor(owner)).data.entries!.find(e => e.mandateId === unknownRule.id && e.kind === 'HELD');
  assert.ok(unknownEntry, 'the unknown outcome is in the owner inbox');
  assert.match(unknownEntry!.effect, /may have moved/);
  delete process.env.AUTOMATION_JOBS_DB;
  unknownStore.close();
  console.log('PASS: a lost response the worker cannot resolve is held as unknown, captures nothing it can see, is never retried under a new identity, and says so in the owner inbox.');
} finally {
  if (restoreBroker) execFileSync('docker', ['compose', '-f', 'docker-compose.demo.yml', 'up', '-d', '--force-recreate', '--wait', 'delegation-broker'], { stdio: 'ignore' });
  try { await env?.cleanup(); } catch { /* Windows may briefly hold SQLite files */ }
  try { rmSync(scratch, { recursive: true, force: true }); } catch { /* Windows may briefly hold the directory */ }
}
