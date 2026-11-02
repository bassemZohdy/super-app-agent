import test from 'node:test';
import { createHash, randomUUID } from 'node:crypto';
import { executeGatewayRequest } from '../../services/agent-core/src/index.ts';
import assert from 'node:assert/strict';
import http from 'node:http';
import { SuperAppAgentGraph } from '../../services/agent-core/src/langgraph/graph.ts';
import { domainHandlers } from '../../services/agent-core/src/domain-operations.ts';
import { RedisSessionStore, redisSessions } from '../../services/agent-core/src/session-store.ts';
import { actorContext, actorFor, accountIdFor } from '../../packages/backend-kit/src/context.ts';
import { executeWalletRequest, balance, transactions } from '../../services/service-wallet/src/index.ts';
import { executeFoodRequest, activeUtilityBill } from '../../services/service-food/src/index.ts';
import { executeRideRequest, salikBalance } from '../../services/service-ride/src/index.ts';
import { toMinor } from '../../packages/protocol-core/src/request-validation.ts';

test('an initial wallet dispatch can be retried using the original identity', async t => {
  process.env.DOMAIN_TRANSPORT = 'http'; process.env.SESSION_STORE = 'redis';
  process.env.REDIS_URL = process.env.TEST_REDIS_URL || 'redis://127.0.0.1:6379';
  const check = new RedisSessionStore(process.env.REDIS_URL), key = 'superapp:offline-civic-fence';
  await check.connect(); assert.equal(await check.client.exists(key), 0, 'test requires an isolated empty fence');
  let laterWrites = 0, recordedBeforeUtility = false, resolutionKey = '';
  let utilityCalls = 0, walletCalls = 0;
  const walletOperations: string[] = [];
  const surfaceRevision = randomUUID(), sessionId = 'civic-partial';
  const digest = createHash('sha256').update(JSON.stringify(['local-demo-user', accountIdFor('local-demo-user')])).digest('hex');
  const retiredKey = `superapp:civic-retired:${createHash('sha256').update(JSON.stringify([digest, sessionId, surfaceRevision])).digest('hex')}`;
  const server = http.createServer(async (req, res) => {
    const chunks: Buffer[] = []; for await (const chunk of req) chunks.push(Buffer.from(chunk));
    const path = new URL(req.url!, 'http://localhost').pathname, method = req.method!, body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : {};
    if (method === 'POST' && ['/fines/pay', '/mobility/salik/recharge'].includes(path)) laterWrites++;
    if (method === 'POST' && path === '/utilities/pay') {
      const snapshot = await check.inspectCivicFence('local-demo-user', accountIdFor('local-demo-user'));
      recordedBeforeUtility = snapshot.civicSteps?.[1]?.state === 'STARTED' && snapshot.civicSteps[1].operationId === body.operationId && typeof body.operationId === 'string';
    }
    if (method === 'POST' && path === '/pay/unified') { walletCalls++; walletOperations.push(body.operationId); if (walletCalls === 1) { req.socket.destroy(); return; } }
    const handler = path.startsWith('/utilities/') ? domainHandlers.food : path.startsWith('/mobility/') ? domainHandlers.ride : domainHandlers.wallet;
    const result = handler(method, path, {}, body);

    if (method === 'POST' && path === '/utilities/pay') utilityCalls++;
    res.writeHead(result.status, { 'content-type': 'application/json' }); res.end(JSON.stringify(result.data));
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address(); assert.ok(address && typeof address !== 'string');
  const base = `http://127.0.0.1:${address.port}`;
  Object.assign(process.env, { SERVICE_WALLET_URL: base, SERVICE_FOOD_URL: base, SERVICE_RIDE_URL: base });
  t.after(async () => { await new Promise<void>(resolve => server.close(() => resolve())); await check.client.del([key, retiredKey, ...(resolutionKey ? [resolutionKey] : [])]); await check.close(); await redisSessions()?.close(); });
  assert.equal(executeWalletRequest('POST', '/wallet/topup', {}, { amount: 5000 }).status, 200);
  const bill = executeFoodRequest('GET', '/utilities/bill').data.bill, fines = executeWalletRequest('GET', '/fines/check').data, salik = executeRideRequest('GET', '/mobility/salik/balance').data;
  const review = { billId: bill.billId, billAmountMinor: toMinor(bill.totalAmount), fines: fines.fines.map((fine: { fineId: string; payableAmount: number }) => ({ fineId: fine.fineId, amountMinor: toMinor(fine.payableAmount) })).sort((a: { fineId: string }, b: { fineId: string }) => a.fineId.localeCompare(b.fineId)), tagNumber: salik.tagNumber };
  const actor = actorFor({ sub: 'local-demo-user' }, undefined, 'Bearer test'), before = balance, ledger = transactions.length, tollBefore = salikBalance;
  actor.requestId = `${surfaceRevision}:confirm_smartcity_checkout`;
  await assert.rejects(actorContext.run(actor, () => SuperAppAgentGraph.resumeWithAction({ sessionId: 'civic-partial', messages: [], activeDomain: 'composite' }, 'confirm_smartcity_checkout', { offlineReview: review })), /did not complete successfully/);
  assert.equal(recordedBeforeUtility, false); assert.equal(balance, before); assert.equal(transactions.length, ledger); assert.equal(activeUtilityBill.status, 'UNPAID');
  const headers = { authorization: 'Bearer demo-local' };
  const wallet = await executeGatewayRequest('GET', '/api/civic/reconciliation', { verify: '1' }, {}, headers);
  assert.equal(wallet.data.civicEvidence[0].assessment, 'UNVERIFIABLE'); assert.equal(wallet.data.civicSteps[0].state, 'UNKNOWN');
  const originalRaw = await check.client.get(key); assert.ok(originalRaw);
  const oldRecord = JSON.parse(originalRaw); delete oldRecord.steps[0].serviceEpoch;
  await check.client.set(key, JSON.stringify(oldRecord));
  const oldStatus = await executeGatewayRequest('GET', '/api/civic/reconciliation', {}, {}, headers);
  const oldRetry = await executeGatewayRequest('POST', '/api/civic/reconciliation/retry', {}, { revision: oldStatus.data.revision }, headers);
  assert.equal(oldRetry.status, 409); assert.equal(walletCalls, 1);
  await check.client.set(key, originalRaw);
  const attempts = await Promise.all(Array.from({ length: 2 }, () => executeGatewayRequest('POST', '/api/civic/reconciliation/retry', {}, { revision: wallet.data.revision }, headers)));
  assert.equal(attempts.filter(item => item.status === 200 && item.data.step === 'WALLET').length, 1); assert.ok(attempts.every(item => item.status === 200 || item.status === 409));
  assert.equal(walletCalls, 2); assert.equal(walletOperations[0], walletOperations[1]); assert.equal(transactions.length, ledger + 1); assert.ok(balance < before);
  const recorded = await executeGatewayRequest('GET', '/api/civic/reconciliation', { verify: '1' }, {}, headers);
  assert.equal(recorded.data.civicEvidence[0].assessment, 'MATCH');
  const result = await executeGatewayRequest('POST', '/api/civic/reconciliation/continue', {}, { revision: recorded.data.revision }, headers);
  assert.equal(result.status, 200); assert.equal(result.data.step, 'UTILITY'); assert.equal(utilityCalls, 1); assert.equal(recordedBeforeUtility, true); assert.equal(laterWrites, 0);
  const after = await executeGatewayRequest('GET', '/api/civic/reconciliation', {}, {}, headers);
  const fine = await executeGatewayRequest('POST', '/api/civic/reconciliation/continue', {}, { revision: after.data.revision }, headers);
  assert.equal(fine.status, 200); assert.equal(fine.data.step, 'FINES');
  const toll = await executeGatewayRequest('POST', '/api/civic/reconciliation/continue', {}, { revision: fine.data.revision }, headers);
  assert.equal(toll.status, 200); assert.equal(toll.data.step, 'TOLL'); assert.equal(salikBalance, tollBefore + 100);
  const final = await executeGatewayRequest('GET', '/api/civic/reconciliation', { verify: '1' }, {}, headers);
  assert.ok(final.data.civicEvidence.every((item: { assessment: string }) => item.assessment === 'MATCH'));
  const resolved = await executeGatewayRequest('POST', '/api/civic/reconciliation/resolve', {}, { revision: final.data.revision }, headers);
  assert.equal(resolved.status, 200); resolutionKey = `superapp:civic-resolution:${final.data.revision}`; assert.equal(await check.client.exists(key), 0);
});
