import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { SuperAppAgentGraph } from '../../services/agent-core/src/langgraph/graph.ts';
import { domainHandlers, trackDomainOperations, type Step } from '../../services/agent-core/src/domain-operations.ts';
import { RedisSessionStore, redisSessions } from '../../services/agent-core/src/session-store.ts';
import { actorContext, actorFor, accountIdFor } from '../../packages/backend-kit/src/context.ts';
import { executeWalletRequest, balance, transactions } from '../../services/service-wallet/src/index.ts';
import { executeFoodRequest } from '../../services/service-food/src/index.ts';
import { executeRideRequest } from '../../services/service-ride/src/index.ts';
import { toMinor } from '../../packages/protocol-core/src/request-validation.ts';

const execFileAsync = promisify(execFile);
test('a lost separate-service wallet response leaves a shared fence for a fresh agent process', async t => {
  process.env.DOMAIN_TRANSPORT = 'http'; process.env.SESSION_STORE = 'redis';
  process.env.REDIS_URL = process.env.TEST_REDIS_URL || 'redis://127.0.0.1:6379';
  const check = new RedisSessionStore(process.env.REDIS_URL), key = 'superapp:offline-civic-fence';
  await check.connect(); assert.equal(await check.client.exists(key), 0, 'test requires an isolated empty fence');
  let dropped = false, refuseWallet = true, recordedBeforeDebit = false;
  const server = http.createServer(async (req, res) => {
    const chunks: Buffer[] = []; for await (const chunk of req) chunks.push(Buffer.from(chunk));
    const path = new URL(req.url!, 'http://localhost').pathname, method = req.method!, body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : {};
    if (refuseWallet && method === 'POST' && path === '/pay/unified') { res.writeHead(409, { 'content-type': 'application/json' }); res.end(JSON.stringify({ success: false, error: 'No debit made' })); return; }
    if (method === 'POST' && path === '/pay/unified') {
      const snapshot = await check.inspectCivicFence('http-civic-owner', accountIdFor('http-civic-owner'));
      recordedBeforeDebit = snapshot.civicSteps?.[0]?.state === 'STARTED' && JSON.stringify(snapshot.civicReview) === JSON.stringify({ ...review, tollAmountMinor: 10000 });
    }
    const handler = path.startsWith('/utilities/') ? domainHandlers.food : path.startsWith('/mobility/') ? domainHandlers.ride : domainHandlers.wallet;
    const result = handler(method, path, {}, body);
    if (method === 'POST' && path === '/pay/unified') { dropped = true; req.socket.destroy(); return; }
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
  const actor = actorFor({ sub: 'http-civic-owner' }, undefined, 'Bearer test'), steps: Step[] = [];
  const before = balance, ledger = transactions.length;
  await assert.rejects(actorContext.run(actor, () => SuperAppAgentGraph.resumeWithAction({ sessionId: 'civic-refused', messages: [], activeDomain: 'composite' }, 'confirm_smartcity_checkout', { offlineReview: review })), /did not complete successfully/);
  assert.equal(await check.client.exists(key), 0, 'a definite refusal releases the shared fence');
  assert.equal(balance, before); assert.equal(transactions.length, ledger); refuseWallet = false;
  await assert.rejects(actorContext.run(actor, () => trackDomainOperations(steps, () => SuperAppAgentGraph.resumeWithAction({ sessionId: 'civic-http', messages: [], activeDomain: 'composite' }, 'confirm_smartcity_checkout', { offlineReview: review }))), /did not complete successfully/);
  assert.equal(dropped, true); assert.equal(recordedBeforeDebit, true, 'the attempt is recorded before the wallet is called'); assert.equal(steps[0].state, 'UNKNOWN'); assert.ok(balance < before); assert.equal(transactions.length, ledger + 1);
  assert.equal(await check.client.exists(key), 1); assert.equal(await check.client.ttl(key), -1);
  const recorded = await check.inspectCivicFence(actor.sub, actor.accountId);
  assert.deepEqual(recorded.civicSteps, [{ name: 'WALLET', state: 'UNKNOWN' }]);
  assert.deepEqual(recorded.civicReview, { ...review, tollAmountMinor: 10000 });
  assert.deepEqual(await check.inspectCivicFence('different-owner', actor.accountId), { status: 'BLOCKED' });
  const childCode = `import { SuperAppAgentGraph } from './services/agent-core/src/langgraph/graph.ts'; import { redisSessions } from './services/agent-core/src/session-store.ts'; import { actorContext, actorFor, accountIdFor } from './packages/backend-kit/src/context.ts'; try { await actorContext.run(actorFor({sub:'other-user'},undefined,'Bearer test'),()=>SuperAppAgentGraph.resumeWithAction({sessionId:'fresh-session',messages:[],activeDomain:'composite'},'confirm_smartcity_checkout',{})); process.exitCode=2; } catch(e) { if(e.code!=='CIVIC_RECONCILIATION_REQUIRED') process.exitCode=3; } finally { await redisSessions()?.close(); }`;
  await execFileAsync(process.execPath, ['--experimental-strip-types', '--input-type=module', '-e', childCode], { cwd: process.cwd(), env: process.env, timeout: 15000 });
  assert.equal(transactions.length, ledger + 1);
});
