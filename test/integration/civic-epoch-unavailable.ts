import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { SuperAppAgentGraph } from '../../services/agent-core/src/langgraph/graph.ts';
import { domainHandlers } from '../../services/agent-core/src/domain-operations.ts';
import { RedisSessionStore, redisSessions } from '../../services/agent-core/src/session-store.ts';
import { actorContext, actorFor } from '../../packages/backend-kit/src/context.ts';
import { executeWalletRequest, balance, transactions } from '../../services/service-wallet/src/index.ts';
import { executeFoodRequest } from '../../services/service-food/src/index.ts';
import { executeRideRequest } from '../../services/service-ride/src/index.ts';
import { toMinor } from '../../packages/protocol-core/src/request-validation.ts';

test('unavailable fixture lifetime stops dispatch and preserves any earlier payment', async t => {
  process.env.DOMAIN_TRANSPORT = 'http'; process.env.SESSION_STORE = 'redis'; process.env.REDIS_URL = process.env.TEST_REDIS_URL || 'redis://127.0.0.1:6379';
  const store = new RedisSessionStore(process.env.REDIS_URL), key = 'superapp:offline-civic-fence'; await store.connect(); assert.equal(await store.client.exists(key), 0);
  let failWallet = true, failUtility = false, walletWrites = 0, utilityWrites = 0;
  const server = http.createServer(async (req, res) => {
    const chunks: Buffer[] = []; for await (const chunk of req) chunks.push(Buffer.from(chunk));
    const path = new URL(req.url!, 'http://localhost').pathname, method = req.method!, body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : {};
    if (method === 'GET' && ((failWallet && path === '/wallet/unified-epoch') || (failUtility && path === '/utilities/payment-epoch'))) { res.writeHead(503, { 'content-type': 'application/json' }); res.end(JSON.stringify({ success: false, error: 'Unavailable' })); return; }
    if (method === 'POST' && path === '/pay/unified') walletWrites++;
    if (method === 'POST' && path === '/utilities/pay') utilityWrites++;
    const handler = path.startsWith('/utilities/') ? domainHandlers.food : path.startsWith('/mobility/') ? domainHandlers.ride : domainHandlers.wallet, result = handler(method, path, {}, body);
    res.writeHead(result.status, { 'content-type': 'application/json' }); res.end(JSON.stringify(result.data));
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve)); const address = server.address(); assert.ok(address && typeof address !== 'string'); const base = `http://127.0.0.1:${address.port}`;
  Object.assign(process.env, { SERVICE_WALLET_URL: base, SERVICE_FOOD_URL: base, SERVICE_RIDE_URL: base });
  t.after(async () => { await new Promise<void>(resolve => server.close(() => resolve())); await store.client.del(key); await store.close(); await redisSessions()?.close(); });
  assert.equal(executeWalletRequest('POST', '/wallet/topup', {}, { amount: 5000 }).status, 200);
  const bill = executeFoodRequest('GET', '/utilities/bill').data.bill, fines = executeWalletRequest('GET', '/fines/check').data, salik = executeRideRequest('GET', '/mobility/salik/balance').data;
  const review = { billId: bill.billId, billAmountMinor: toMinor(bill.totalAmount), fines: fines.fines.map((fine: { fineId: string; payableAmount: number }) => ({ fineId: fine.fineId, amountMinor: toMinor(fine.payableAmount) })).sort((a: { fineId: string }, b: { fineId: string }) => a.fineId.localeCompare(b.fineId)), tagNumber: salik.tagNumber };
  const actor = actorFor({ sub: 'local-demo-user' }, undefined, 'Bearer test'), before = balance, ledger = transactions.length; actor.requestId = `${randomUUID()}:confirm_smartcity_checkout`;
  await assert.rejects(actorContext.run(actor, () => SuperAppAgentGraph.resumeWithAction({ sessionId: 'epoch-first', messages: [], activeDomain: 'composite' }, 'confirm_smartcity_checkout', { offlineReview: review })), /did not complete successfully/);
  assert.equal(walletWrites, 0); assert.equal(utilityWrites, 0); assert.equal(balance, before); assert.equal(transactions.length, ledger); assert.equal(await store.client.exists(key), 0);
  failWallet = false; failUtility = true; actor.requestId = `${randomUUID()}:confirm_smartcity_checkout`;
  await assert.rejects(actorContext.run(actor, () => SuperAppAgentGraph.resumeWithAction({ sessionId: 'epoch-later', messages: [], activeDomain: 'composite' }, 'confirm_smartcity_checkout', { offlineReview: review })), /did not complete successfully/);
  const status = await store.inspectCivicFence(actor.sub, actor.accountId);
  assert.deepEqual(status.civicSteps?.map(step => [step.name, step.state]), [['WALLET', 'CONFIRMED']]); assert.equal(walletWrites, 1); assert.equal(utilityWrites, 0); assert.ok(balance < before); assert.equal(transactions.length, ledger + 1); assert.equal(await store.client.exists(key), 1);
});
