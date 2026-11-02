import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash, randomUUID } from 'node:crypto';
import { domainHandlers } from '../../services/agent-core/src/domain-operations.ts';
import { RedisSessionStore } from '../../services/agent-core/src/session-store.ts';
import { accountIdFor } from '../../packages/backend-kit/src/context.ts';
import { executeWalletRequest, balance, transactions } from '../../services/service-wallet/src/index.ts';
import { executeFoodRequest, activeUtilityBill } from '../../services/service-food/src/index.ts';
import { executeRideRequest, salikBalance } from '../../services/service-ride/src/index.ts';
import { toMinor } from '../../packages/protocol-core/src/request-validation.ts';

test('fresh agent processes complete the original checkout after the first dies with a debit in flight', async t => {
  process.env.DOMAIN_TRANSPORT = 'http'; process.env.SESSION_STORE = 'redis';
  process.env.REDIS_URL = process.env.TEST_REDIS_URL || 'redis://127.0.0.1:6379';
  const store = new RedisSessionStore(process.env.REDIS_URL), key = 'superapp:offline-civic-fence';
  await store.connect(); assert.equal(await store.client.exists(key), 0, 'test requires an isolated empty fence');
  const sessionId = `restart_${randomUUID()}`, surfaceRevision = randomUUID(), account = accountIdFor('local-demo-user');
  const owner = createHash('sha256').update(JSON.stringify(['local-demo-user', account])).digest('hex');
  const retired = `superapp:civic-retired:${createHash('sha256').update(JSON.stringify([owner, sessionId, surfaceRevision])).digest('hex')}`;
  let unblock!: () => void, reached!: () => void, resolutionKey = '', writes = 0;
  const hold = new Promise<void>(resolve => { unblock = resolve; });
  const dispatched = new Promise<void>(resolve => { reached = resolve; });
  const server = http.createServer(async (req, res) => {
    const chunks: Buffer[] = []; for await (const chunk of req) chunks.push(Buffer.from(chunk));
    const path = new URL(req.url!, 'http://localhost').pathname, method = req.method!, body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : {};
    if (method === 'POST') writes++;
    const handler = path.startsWith('/utilities/') ? domainHandlers.food : path.startsWith('/mobility/') ? domainHandlers.ride : domainHandlers.wallet;
    const result = handler(method, path, {}, body);
    if (method === 'POST' && path === '/pay/unified') { reached(); await hold; }
    if (!res.destroyed) { res.writeHead(result.status, { 'content-type': 'application/json' }); res.end(JSON.stringify(result.data)); }
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address(); assert.ok(address && typeof address !== 'string');
  const base = `http://127.0.0.1:${address.port}`;
  Object.assign(process.env, { SERVICE_WALLET_URL: base, SERVICE_FOOD_URL: base, SERVICE_RIDE_URL: base });
  assert.equal(executeWalletRequest('POST', '/wallet/topup', {}, { amount: 5000 }).status, 200);
  const bill = executeFoodRequest('GET', '/utilities/bill').data.bill, fines = executeWalletRequest('GET', '/fines/check').data, salik = executeRideRequest('GET', '/mobility/salik/balance').data;
  const review = { billId: bill.billId, billAmountMinor: toMinor(bill.totalAmount), fines: fines.fines.map((fine: { fineId: string; payableAmount: number }) => ({ fineId: fine.fineId, amountMinor: toMinor(fine.payableAmount) })).sort((a: { fineId: string }, b: { fineId: string }) => a.fineId.localeCompare(b.fineId)), tagNumber: salik.tagNumber };
  const before = balance, ledger = transactions.length, tollBefore = salikBalance;
  const childCode = `import { SuperAppAgentGraph } from './services/agent-core/src/langgraph/graph.ts'; import { actorContext, actorFor } from './packages/backend-kit/src/context.ts'; const actor = actorFor({sub:'local-demo-user'}, undefined, 'Bearer test'); actor.requestId = process.env.TASK_CIVIC_SURFACE + ':confirm_smartcity_checkout'; await actorContext.run(actor, () => SuperAppAgentGraph.resumeWithAction({sessionId:process.env.TASK_CIVIC_SESSION,messages:[],activeDomain:'composite'},'confirm_smartcity_checkout',{offlineReview:JSON.parse(process.env.TASK_CIVIC_REVIEW)}));`;
  const child = spawn(process.execPath, ['--experimental-strip-types', '--input-type=module', '-e', childCode], { cwd: process.cwd(), env: { ...process.env, TASK_CIVIC_REVIEW: JSON.stringify(review), TASK_CIVIC_SESSION: sessionId, TASK_CIVIC_SURFACE: surfaceRevision }, stdio: 'ignore' });
  const exited = new Promise<{ code: number | null; signal: string | null }>((resolve, reject) => { child.once('error', reject); child.once('exit', (code, signal) => resolve({ code, signal })); });
  t.after(async () => { if (child.exitCode === null && child.signalCode === null) child.kill(); unblock(); await new Promise<void>(resolve => server.close(() => resolve())); await store.client.del([key, retired, ...(resolutionKey ? [resolutionKey] : [])]); await store.close(); });
  await Promise.race([dispatched, exited.then(result => { throw new Error(`Original agent exited before dispatch: ${result.code ?? result.signal}`); }), new Promise<never>((_, reject) => { const timer = setTimeout(() => reject(new Error('Original agent did not dispatch')), 15000); timer.unref(); })]);
  const inFlight = await store.inspectCivicFence('local-demo-user', account);
  assert.equal(inFlight.civicSteps?.[0].state, 'STARTED'); assert.ok(inFlight.civicSteps?.[0].operationId); assert.equal(writes, 1); assert.ok(balance < before); assert.equal(transactions.length, ledger + 1);
  assert.equal(child.kill(), true); const stopped = await exited; assert.notEqual(stopped.code, 0); unblock();
  const requestCode = `import { executeGatewayRequest } from './services/agent-core/src/index.ts'; import { redisSessions } from './services/agent-core/src/session-store.ts'; const input = JSON.parse(process.env.TASK_CIVIC_REQUEST); const response = await executeGatewayRequest(input.method, input.path, input.query, input.body, {authorization:'Bearer demo-local'}); process.stdout.write(JSON.stringify(response)); await redisSessions()?.close();`;
  const runRequest = async (method: string, path: string, query: Record<string, string> = {}, body: Record<string, string> = {}) => {
    const result = await promisify(execFile)(process.execPath, ['--experimental-strip-types', '--input-type=module', '-e', requestCode], { cwd: process.cwd(), env: { ...process.env, TASK_CIVIC_REQUEST: JSON.stringify({ method, path, query, body }) }, timeout: 20000 });
    return JSON.parse(result.stdout);
  };
  const status = await runRequest('GET', '/api/civic/reconciliation', { verify: '1' });
  assert.equal(status.data.civicEvidence[0].assessment, 'OBSERVED'); assert.equal(status.data.civicSteps[0].state, 'STARTED');
  const observed = await runRequest('POST', '/api/civic/reconciliation/observe-wallet', {}, { revision: status.data.revision });
  assert.equal(observed.status, 200);
  let revision = observed.data.revision;
  for (const step of ['UTILITY', 'FINES', 'TOLL']) {
    const next = await runRequest('POST', '/api/civic/reconciliation/continue', {}, { revision });
    assert.equal(next.status, 200, JSON.stringify(next.data)); assert.equal(next.data.step, step); revision = next.data.revision;
  }
  assert.equal(writes, 4); assert.equal(transactions.length, ledger + 2); assert.equal(activeUtilityBill.status, 'PAID'); assert.equal(salikBalance, tollBefore + 100);
  const final = await runRequest('GET', '/api/civic/reconciliation', { verify: '1' });
  assert.equal(final.data.revision, revision); assert.ok(final.data.civicEvidence.every((item: { assessment: string }) => item.assessment === 'MATCH'));
  const resolved = await runRequest('POST', '/api/civic/reconciliation/resolve', {}, { revision });
  assert.equal(resolved.status, 200); resolutionKey = `superapp:civic-resolution:${revision}`; assert.equal(await store.client.exists(key), 0);
  assert.equal(await store.civicApprovalResolved('local-demo-user', account, sessionId, surfaceRevision), true);
});
