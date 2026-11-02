import test from 'node:test';
import { executeGatewayRequest } from '../../services/agent-core/src/index.ts';
import assert from 'node:assert/strict';
import http from 'node:http';
import { SuperAppAgentGraph } from '../../services/agent-core/src/langgraph/graph.ts';
import { domainHandlers } from '../../services/agent-core/src/domain-operations.ts';
import { RedisSessionStore, redisSessions } from '../../services/agent-core/src/session-store.ts';
import { actorContext, actorFor, accountIdFor } from '../../packages/backend-kit/src/context.ts';
import { executeWalletRequest, balance, transactions, policeFines } from '../../services/service-wallet/src/index.ts';
import { executeFoodRequest, activeUtilityBill } from '../../services/service-food/src/index.ts';
import { executeRideRequest, salikBalance } from '../../services/service-ride/src/index.ts';
import { toMinor } from '../../packages/protocol-core/src/request-validation.ts';

test('a lost fine response is identified by the saved operation and exact independent evidence', async t => {
  process.env.DOMAIN_TRANSPORT = 'http'; process.env.SESSION_STORE = 'redis';
  process.env.REDIS_URL = process.env.TEST_REDIS_URL || 'redis://127.0.0.1:6379';
  const check = new RedisSessionStore(process.env.REDIS_URL), key = 'superapp:offline-civic-fence';
  await check.connect(); assert.equal(await check.client.exists(key), 0, 'test requires an isolated empty fence');
  let laterWrites = 0, recordedBeforeFines = false;
  const server = http.createServer(async (req, res) => {
    const chunks: Buffer[] = []; for await (const chunk of req) chunks.push(Buffer.from(chunk));
    const path = new URL(req.url!, 'http://localhost').pathname, method = req.method!, body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : {};
    if (method === 'POST' && path === '/mobility/salik/recharge') laterWrites++;
    if (method === 'POST' && path === '/fines/pay') { const snapshot = await check.inspectCivicFence('local-demo-user', accountIdFor('local-demo-user')); recordedBeforeFines = snapshot.civicSteps?.[2]?.state === 'STARTED' && snapshot.civicSteps[2].operationId === body.operationId && typeof body.operationId === 'string'; }
    const handler = path.startsWith('/utilities/') ? domainHandlers.food : path.startsWith('/mobility/') ? domainHandlers.ride : domainHandlers.wallet;
    const result = handler(method, path, {}, body);
    if (method === 'POST' && path === '/fines/pay') { req.socket.destroy(); return; }
    res.writeHead(result.status, { 'content-type': 'application/json' }); res.end(JSON.stringify(result.data));
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address(); assert.ok(address && typeof address !== 'string');
  const base = `http://127.0.0.1:${address.port}`;
  Object.assign(process.env, { SERVICE_WALLET_URL: base, SERVICE_FOOD_URL: base, SERVICE_RIDE_URL: base });
  t.after(async () => { await new Promise<void>(resolve => server.close(() => resolve())); await check.client.del(key); await check.close(); await redisSessions()?.close(); });
  assert.equal(executeWalletRequest('POST', '/wallet/topup', {}, { amount: 5000 }).status, 200);
  const bill = executeFoodRequest('GET', '/utilities/bill').data.bill, fines = executeWalletRequest('GET', '/fines/check').data, salik = executeRideRequest('GET', '/mobility/salik/balance').data;
  const review = { billId: bill.billId, billAmountMinor: toMinor(bill.totalAmount), fines: fines.fines.map((fine: { fineId: string; payableAmount: number }) => ({ fineId: fine.fineId, amountMinor: toMinor(fine.payableAmount) })).sort((a: { fineId: string }, b: { fineId: string }) => a.fineId.localeCompare(b.fineId)), tagNumber: salik.tagNumber };
  const actor = actorFor({ sub: 'local-demo-user' }, undefined, 'Bearer test'), before = balance, ledger = transactions.length, tollBefore = salikBalance;
  await assert.rejects(actorContext.run(actor, () => SuperAppAgentGraph.resumeWithAction({ sessionId: 'civic-partial', messages: [], activeDomain: 'composite' }, 'confirm_smartcity_checkout', { offlineReview: review })), /did not complete successfully/);
  assert.equal(recordedBeforeFines, true); assert.ok(balance < before); assert.equal(transactions.length, ledger + 2); assert.equal(activeUtilityBill.status, 'PAID'); assert.equal(salikBalance, tollBefore); assert.equal(laterWrites, 0);
  const saved = await check.inspectCivicFence(actor.sub, actor.accountId);
  assert.equal(saved.civicSteps?.[2].name, 'FINES'); assert.equal(saved.civicSteps?.[2].state, 'UNKNOWN');
  assert.match(saved.civicSteps?.[2].operationId || '', /^CIVIC-/);
  const headers = { authorization: 'Bearer demo-local' };
  const status = await executeGatewayRequest('GET', '/api/civic/reconciliation', { verify: '1' }, {}, headers);
  assert.deepEqual(status.data.civicEvidence.map((item: { assessment: string }) => item.assessment), ['MATCH', 'MATCH', 'OBSERVED']);
  assert.equal(status.data.civicEvidence[2].observedReceiptReference, transactions.at(-1)?.id);
  const oldAmount = policeFines[0].payableAmount; policeFines[0].payableAmount += 1;
  const changed = await executeGatewayRequest('GET', '/api/civic/reconciliation', { verify: '1' }, {}, headers);
  policeFines[0].payableAmount = oldAmount;
  assert.equal(changed.data.civicEvidence[2].assessment, 'UNVERIFIABLE');
  const wrong = await executeGatewayRequest('GET', '/api/civic/reconciliation', { verify: '1', accountId: accountIdFor(actor.sub, 'household') }, {}, headers);
  assert.equal(wrong.data.status, 'BLOCKED'); assert.equal(wrong.data.civicSteps, undefined);
  const replay = executeWalletRequest('POST', '/fines/pay', {}, { fineIds: review.fines.map(fine => fine.fineId), expectedAmountMinor: review.fines.reduce((sum, fine) => sum + fine.amountMinor, 0), operationId: saved.civicSteps?.[2].operationId });
  assert.equal(replay.status, 200); assert.equal(replay.data.receiptNumber, transactions.at(-1)?.id); assert.equal(transactions.length, ledger + 2);
});
