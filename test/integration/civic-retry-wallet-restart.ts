import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { executeGatewayRequest } from '../../services/agent-core/src/index.ts';
import { SuperAppAgentGraph } from '../../services/agent-core/src/langgraph/graph.ts';
import { domainHandlers } from '../../services/agent-core/src/domain-operations.ts';
import { RedisSessionStore, redisSessions } from '../../services/agent-core/src/session-store.ts';
import { actorContext, actorFor } from '../../packages/backend-kit/src/context.ts';
import { executeFoodRequest } from '../../services/service-food/src/index.ts';
import { executeRideRequest, salikBalance } from '../../services/service-ride/src/index.ts';
import { toMinor } from '../../packages/protocol-core/src/request-validation.ts';

test('wallet service restart refuses retry and leaves the original debit unknown', async t => {
  process.env.DOMAIN_TRANSPORT = 'http'; process.env.SESSION_STORE = 'redis'; process.env.REDIS_URL = process.env.TEST_REDIS_URL || 'redis://127.0.0.1:6379';
  const store = new RedisSessionStore(process.env.REDIS_URL), key = 'superapp:offline-civic-fence'; await store.connect(); assert.equal(await store.client.exists(key), 0);
  const serviceCode = `import http from 'node:http'; import { executeWalletRequest } from './services/service-wallet/src/index.ts'; const server=http.createServer(async(req,res)=>{const chunks=[];for await(const chunk of req)chunks.push(chunk);const body=chunks.length?JSON.parse(Buffer.concat(chunks).toString()):{};const result=executeWalletRequest(req.method,new URL(req.url,'http://localhost').pathname,{},body);res.writeHead(result.status,{'content-type':'application/json'});res.end(JSON.stringify(result.data));});server.listen(0,'127.0.0.1',()=>process.stdout.write(String(server.address().port)+'\\n'));`;
  let service: ChildProcess | undefined, walletBase = '', walletPosts = 0, lastWalletStatus = 0, laterWrites = 0;
  const startService = async () => {
    const child = spawn(process.execPath, ['--experimental-strip-types', '--input-type=module', '-e', serviceCode], { cwd: process.cwd(), env: process.env, stdio: ['ignore', 'pipe', 'ignore'] }); service = child;
    const ready = once(child.stdout!, 'data').then(([chunk]) => Number(String(chunk).trim()));
    const failure = once(child, 'exit').then(() => { throw new Error('Wallet fixture stopped before becoming ready'); });
    const port = await Promise.race([ready, failure]); assert.ok(port > 0); walletBase = `http://127.0.0.1:${port}`;
  };
  const stopService = async () => { if (service && service.exitCode === null && service.signalCode === null) { const exited = once(service, 'exit'); service.kill(); await exited; } };
  await startService();
  const server = http.createServer(async (req, res) => {
    const chunks: Buffer[] = []; for await (const chunk of req) chunks.push(Buffer.from(chunk));
    const path = new URL(req.url!, 'http://localhost').pathname, method = req.method!, body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : {};
    if (method === 'POST' && ['/utilities/pay', '/fines/pay', '/mobility/salik/recharge'].includes(path)) laterWrites++;
    if (!path.startsWith('/utilities/') && !path.startsWith('/mobility/')) {
      const response = await fetch(`${walletBase}${path}`, { method, headers: { 'content-type': 'application/json' }, ...(method === 'POST' ? { body: JSON.stringify(body) } : {}) });
      const data = await response.json();
      if (method === 'POST' && path === '/pay/unified') { walletPosts++; lastWalletStatus = response.status; if (walletPosts === 1) { req.socket.destroy(); return; } }
      res.writeHead(response.status, { 'content-type': 'application/json' }); res.end(JSON.stringify(data)); return;
    }
    const handler = path.startsWith('/utilities/') ? domainHandlers.food : domainHandlers.ride, result = handler(method, path, {}, body);
    res.writeHead(result.status, { 'content-type': 'application/json' }); res.end(JSON.stringify(result.data));
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve)); const address = server.address(); assert.ok(address && typeof address !== 'string');
  const base = `http://127.0.0.1:${address.port}`; Object.assign(process.env, { SERVICE_WALLET_URL: base, SERVICE_FOOD_URL: base, SERVICE_RIDE_URL: base });
  t.after(async () => { await new Promise<void>(resolve => server.close(() => resolve())); await stopService(); await store.client.del(key); await store.close(); await redisSessions()?.close(); });
  assert.equal((await fetch(`${walletBase}/wallet/topup`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ amount: 5000 }) })).status, 200);
  const bill = executeFoodRequest('GET', '/utilities/bill').data.bill, fines = await (await fetch(`${walletBase}/fines/check`)).json(), salik = executeRideRequest('GET', '/mobility/salik/balance').data;
  const review = { billId: bill.billId, billAmountMinor: toMinor(bill.totalAmount), fines: fines.fines.map((fine: { fineId: string; payableAmount: number }) => ({ fineId: fine.fineId, amountMinor: toMinor(fine.payableAmount) })).sort((a: { fineId: string }, b: { fineId: string }) => a.fineId.localeCompare(b.fineId)), tagNumber: salik.tagNumber };
  const actor = actorFor({ sub: 'local-demo-user' }, undefined, 'Bearer test'), tollBefore = salikBalance; actor.requestId = `${randomUUID()}:confirm_smartcity_checkout`;
  await assert.rejects(actorContext.run(actor, () => SuperAppAgentGraph.resumeWithAction({ sessionId: `wallet_restart_${randomUUID()}`, messages: [], activeDomain: 'composite' }, 'confirm_smartcity_checkout', { offlineReview: review })), /did not complete successfully/);
  assert.equal(walletPosts, 1); assert.equal(lastWalletStatus, 200); assert.equal(laterWrites, 0);
  const oldLedger = await (await fetch(`${walletBase}/wallet/transactions`)).json(); assert.ok(oldLedger.transactions.some((item: { operationId?: string }) => item.operationId));
  const headers = { authorization: 'Bearer demo-local' }, unknown = await executeGatewayRequest('GET', '/api/civic/reconciliation', {}, {}, headers); const epoch = unknown.data.civicSteps[0].serviceEpoch; assert.match(epoch, /^[0-9a-f-]{36}$/);
  await stopService(); await startService(); const nextEpoch = await (await fetch(`${walletBase}/wallet/unified-epoch`)).json(); assert.notEqual(nextEpoch.serviceEpoch, epoch);
  const before = await (await fetch(`${walletBase}/wallet/balance`)).json(), retry = await executeGatewayRequest('POST', '/api/civic/reconciliation/retry', {}, { revision: unknown.data.revision }, headers);
  assert.equal(retry.status, 503); assert.equal(retry.data.code, 'CIVIC_OUTCOME_UNKNOWN'); assert.equal(lastWalletStatus, 409); assert.equal(walletPosts, 2);
  const after = await (await fetch(`${walletBase}/wallet/balance`)).json(); assert.equal(after.balance, before.balance);
  const current = await executeGatewayRequest('GET', '/api/civic/reconciliation', { verify: '1' }, {}, headers);
  assert.equal(current.data.civicSteps[0].state, 'UNKNOWN'); assert.equal(current.data.civicEvidence[0].assessment, 'UNVERIFIABLE'); assert.equal(current.data.civicSteps[0].serviceEpoch, epoch);
  assert.equal(await store.client.exists(key), 1); assert.equal(laterWrites, 0); assert.equal(salikBalance, tollBefore);
});
