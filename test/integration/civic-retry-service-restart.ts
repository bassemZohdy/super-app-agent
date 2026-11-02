import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { createHash, randomUUID } from 'node:crypto';
import { executeGatewayRequest } from '../../services/agent-core/src/index.ts';
import { SuperAppAgentGraph } from '../../services/agent-core/src/langgraph/graph.ts';
import { domainHandlers } from '../../services/agent-core/src/domain-operations.ts';
import { RedisSessionStore, redisSessions } from '../../services/agent-core/src/session-store.ts';
import { actorContext, actorFor, accountIdFor } from '../../packages/backend-kit/src/context.ts';
import { executeWalletRequest, balance, transactions } from '../../services/service-wallet/src/index.ts';
import { executeFoodRequest } from '../../services/service-food/src/index.ts';
import { executeRideRequest, salikBalance } from '../../services/service-ride/src/index.ts';
import { toMinor } from '../../packages/protocol-core/src/request-validation.ts';

test('a restarted fixture refuses retry without treating the original utility outcome as rejected', async t => {
  process.env.DOMAIN_TRANSPORT = 'http'; process.env.SESSION_STORE = 'redis'; process.env.REDIS_URL = process.env.TEST_REDIS_URL || 'redis://127.0.0.1:6379';
  const store = new RedisSessionStore(process.env.REDIS_URL), key = 'superapp:offline-civic-fence';
  await store.connect(); assert.equal(await store.client.exists(key), 0);
  const sessionId = `retry_restart_${randomUUID()}`, surfaceRevision = randomUUID(), account = accountIdFor('local-demo-user');
  const owner = createHash('sha256').update(JSON.stringify(['local-demo-user', account])).digest('hex');
  const retired = `superapp:civic-retired:${createHash('sha256').update(JSON.stringify([owner, sessionId, surfaceRevision])).digest('hex')}`;
  const serviceCode = `import http from 'node:http'; import { executeFoodRequest } from './services/service-food/src/index.ts'; const server=http.createServer(async(req,res)=>{const chunks=[];for await(const chunk of req)chunks.push(chunk);const body=chunks.length?JSON.parse(Buffer.concat(chunks).toString()):{};const result=executeFoodRequest(req.method,new URL(req.url,'http://localhost').pathname,{},body);res.writeHead(result.status,{'content-type':'application/json'});res.end(JSON.stringify(result.data));});server.listen(0,'127.0.0.1',()=>process.stdout.write(String(server.address().port)+'\\n'));`;
  let service: ChildProcess | undefined, utilityBase = '', utilityPosts = 0, lastUtilityStatus = 0, laterWrites = 0;
  const startService = async () => {
    const child = spawn(process.execPath, ['--experimental-strip-types', '--input-type=module', '-e', serviceCode], { cwd: process.cwd(), env: process.env, stdio: ['ignore', 'pipe', 'ignore'] });
    service = child;
    const ready = once(child.stdout!, 'data').then(([chunk]) => Number(String(chunk).trim()));
    const failure = once(child, 'exit').then(() => { throw new Error('Fixture stopped before becoming ready'); });
    const port = await Promise.race([ready, failure]); assert.ok(port > 0); utilityBase = `http://127.0.0.1:${port}`;
  };
  const stopService = async () => { if (service && service.exitCode === null && service.signalCode === null) { const exited = once(service, 'exit'); service.kill(); await exited; } };
  await startService();
  const server = http.createServer(async (req, res) => {
    const chunks: Buffer[] = []; for await (const chunk of req) chunks.push(Buffer.from(chunk));
    const path = new URL(req.url!, 'http://localhost').pathname, method = req.method!, body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : {};
    if (method === 'POST' && ['/fines/pay', '/mobility/salik/recharge'].includes(path)) laterWrites++;
    if (path.startsWith('/utilities/')) {
      const response = await fetch(`${utilityBase}${path}`, { method, headers: { 'content-type': 'application/json' }, ...(method === 'POST' ? { body: JSON.stringify(body) } : {}) });
      const data = await response.json();
      if (method === 'POST' && path === '/utilities/pay') { utilityPosts++; lastUtilityStatus = response.status; if (utilityPosts === 1) { req.socket.destroy(); return; } }
      res.writeHead(response.status, { 'content-type': 'application/json' }); res.end(JSON.stringify(data)); return;
    }
    const handler = path.startsWith('/mobility/') ? domainHandlers.ride : domainHandlers.wallet, result = handler(method, path, {}, body);
    if (method === 'POST' && path === '/pay/unified') { req.socket.destroy(); return; }
    res.writeHead(result.status, { 'content-type': 'application/json' }); res.end(JSON.stringify(result.data));
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address(); assert.ok(address && typeof address !== 'string'); const base = `http://127.0.0.1:${address.port}`;
  Object.assign(process.env, { SERVICE_WALLET_URL: base, SERVICE_FOOD_URL: base, SERVICE_RIDE_URL: base });
  t.after(async () => { await new Promise<void>(resolve => server.close(() => resolve())); await stopService(); await store.client.del([key, retired]); await store.close(); await redisSessions()?.close(); });
  assert.equal(executeWalletRequest('POST', '/wallet/topup', {}, { amount: 5000 }).status, 200);
  const bill = executeFoodRequest('GET', '/utilities/bill').data.bill, fines = executeWalletRequest('GET', '/fines/check').data, salik = executeRideRequest('GET', '/mobility/salik/balance').data;
  const review = { billId: bill.billId, billAmountMinor: toMinor(bill.totalAmount), fines: fines.fines.map((fine: { fineId: string; payableAmount: number }) => ({ fineId: fine.fineId, amountMinor: toMinor(fine.payableAmount) })).sort((a: { fineId: string }, b: { fineId: string }) => a.fineId.localeCompare(b.fineId)), tagNumber: salik.tagNumber };
  const actor = actorFor({ sub: 'local-demo-user' }, undefined, 'Bearer test'), before = balance, ledger = transactions.length, tollBefore = salikBalance; actor.requestId = `${surfaceRevision}:confirm_smartcity_checkout`;
  await assert.rejects(actorContext.run(actor, () => SuperAppAgentGraph.resumeWithAction({ sessionId, messages: [], activeDomain: 'composite' }, 'confirm_smartcity_checkout', { offlineReview: review })), /did not complete successfully/);
  const headers = { authorization: 'Bearer demo-local' }, status = await executeGatewayRequest('GET', '/api/civic/reconciliation', { verify: '1' }, {}, headers);
  assert.equal(status.data.civicEvidence[0].assessment, 'OBSERVED');
  const wallet = await executeGatewayRequest('POST', '/api/civic/reconciliation/observe-wallet', {}, { revision: status.data.revision }, headers); assert.equal(wallet.status, 200);
  const attempted = await executeGatewayRequest('POST', '/api/civic/reconciliation/continue', {}, { revision: wallet.data.revision }, headers); assert.equal(attempted.data.code, 'CIVIC_OUTCOME_UNKNOWN');
  const oldBill = await (await fetch(`${utilityBase}/utilities/bill`)).json(); assert.equal(oldBill.bill.status, 'PAID'); assert.equal(utilityPosts, 1); assert.equal(lastUtilityStatus, 200);
  const unknown = await executeGatewayRequest('GET', '/api/civic/reconciliation', {}, {}, headers); const oldEpoch = unknown.data.civicSteps[1].serviceEpoch; assert.match(oldEpoch, /^[0-9a-f-]{36}$/);
  await stopService(); await startService();
  const newEpoch = await (await fetch(`${utilityBase}/utilities/payment-epoch`)).json(); assert.notEqual(newEpoch.serviceEpoch, oldEpoch);
  const retry = await executeGatewayRequest('POST', '/api/civic/reconciliation/retry', {}, { revision: unknown.data.revision }, headers);
  assert.equal(retry.status, 503); assert.equal(retry.data.code, 'CIVIC_OUTCOME_UNKNOWN'); assert.equal(lastUtilityStatus, 409); assert.equal(utilityPosts, 2);
  const current = await executeGatewayRequest('GET', '/api/civic/reconciliation', { verify: '1' }, {}, headers);
  assert.equal(current.data.civicSteps[1].state, 'UNKNOWN'); assert.equal(current.data.civicEvidence[1].assessment, 'UNVERIFIABLE'); assert.equal(current.data.civicSteps[1].serviceEpoch, oldEpoch);
  const newBill = await (await fetch(`${utilityBase}/utilities/bill`)).json(); assert.equal(newBill.bill.status, 'UNPAID'); assert.equal(await store.client.exists(key), 1); assert.ok(balance < before); assert.equal(transactions.length, ledger + 1); assert.equal(salikBalance, tollBefore); assert.equal(laterWrites, 0);
});
