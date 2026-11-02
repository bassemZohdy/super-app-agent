import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { RedisGraphSaver } from '../../services/agent-core/src/langgraph/checkpointer.ts';
import { executeGatewayRequest } from '../../services/agent-core/src/index.ts';
import { domainHandlers } from '../../services/agent-core/src/domain-operations.ts';
import { accountIdFor } from '../../packages/backend-kit/src/context.ts';
import { redisSessions, RedisSessionStore, SessionError } from '../../services/agent-core/src/session-store.ts';
import { executeWalletRequest, balance, transactions } from '../../services/service-wallet/src/index.ts';

const headers = { authorization: 'Bearer demo-local' };
const text = 'Pay my DEWA electricity bill, settle my police radar fines, and recharge my Salik tag';
async function review(sessionId: string) {
  const result = await executeGatewayRequest('POST', '/api/a2ui/intent', {}, { sessionId, text }, headers);
  assert.equal(result.status, 200, JSON.stringify(result.data));
  const button = result.data.surface.view.children.find((node: { id: string }) => node.id === 'btn_confirm_smartcity_checkout');
  assert.ok(button);
  return { sessionId, surfaceRevision: result.data.surface.revision, action: 'confirm_smartcity_checkout', payload: button.onEvents[0].payload };
}

test('shared civic fence is released after session save and retained if session save fails', async t => {
  process.env.DOMAIN_TRANSPORT = 'http'; process.env.SESSION_STORE = 'redis';
  process.env.REDIS_URL = process.env.TEST_REDIS_URL || 'redis://127.0.0.1:6379';
  const check = new RedisSessionStore(process.env.REDIS_URL), key = 'superapp:offline-civic-fence';
  await check.connect(); assert.equal(await check.client.exists(key), 0, 'test needs a separate Redis database');
  const server = http.createServer(async (req, res) => {
    const chunks: Buffer[] = []; for await (const chunk of req) chunks.push(Buffer.from(chunk));
    const path = new URL(req.url!, 'http://localhost').pathname, method = req.method!, body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : {};
    const handler = path.startsWith('/profile/') ? domainHandlers.profile : path.startsWith('/utilities/') ? domainHandlers.food : path.startsWith('/mobility/') ? domainHandlers.ride : domainHandlers.wallet;
    const result = handler(method, path, {}, body);
    res.writeHead(result.status, { 'content-type': 'application/json' }); res.end(JSON.stringify(result.data));
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address(); assert.ok(address && typeof address !== 'string');
  const base = `http://127.0.0.1:${address.port}`;
  Object.assign(process.env, { SERVICE_WALLET_URL: base, SERVICE_FOOD_URL: base, SERVICE_RIDE_URL: base, SERVICE_PROFILE_URL: base });
  const ids = [`civic_persist_success_${randomUUID()}`, `civic_persist_failure_${randomUUID()}`];
  t.after(async () => {
    await new Promise<void>(resolve => server.close(() => resolve()));
    const store = redisSessions()!;
    for (const sid of ids) {
      try {
        const record = await store.read(sid, 'local-demo-user');
        const thread = record.state.metadata?.runtime?.threadId;
        if (typeof thread === 'string') await new RedisGraphSaver().deleteThread(thread);
        await store.remove(sid, 'local-demo-user');
      } catch (error) { if (!(error instanceof SessionError && error.status === 404)) throw error; }
    }
    await check.client.del(key); await check.close(); await store.close();
  });
  const clear = await executeGatewayRequest('GET', '/api/civic/reconciliation', {}, {}, headers);
  assert.equal(clear.status, 200); assert.equal(clear.data.status, 'CLEAR');
  assert.equal((await executeGatewayRequest('GET', '/api/civic/reconciliation', {}, {}, { authorization: 'Bearer invalid' })).status, 401);
  assert.equal(executeWalletRequest('POST', '/wallet/topup', {}, { amount: 5000 }).status, 200);
  const good = await review(ids[0]), store = redisSessions()!, acquire = store.acquire.bind(store);
  let observedDuringSave = false;
  const saveCheck = t.mock.method(store, 'acquire', async sid => {
    const lock = await acquire(sid);
    return { ...lock, save: async state => { observedDuringSave = await check.client.exists(key) === 1; await lock.save(state); } };
  });
  assert.equal((await executeGatewayRequest('POST', '/api/a2ui/action', {}, good, headers)).status, 200);
  saveCheck.mock.restore();
  assert.equal(observedDuringSave, true, 'fence remains while the session is being saved');
  assert.equal(await check.client.exists(key), 0, 'saved completion permits a new payment');
  const pending = await review(ids[1]);
  const mock = t.mock.method(store, 'acquire', async sid => {
    const lock = await acquire(sid);
    return { ...lock, save: async () => { throw new SessionError(503, 'SESSION_LOCK_LOST', 'Simulated save failure'); } };
  });
  const before = balance, ledger = transactions.length;
  await assert.rejects(executeGatewayRequest('POST', '/api/a2ui/action', {}, pending, headers), /Simulated save failure/);
  mock.mock.restore();
  assert.ok(balance < before); assert.equal(transactions.length, ledger + 1);
  assert.equal(await check.client.exists(key), 1, 'failed session save retains the fence after effects');
  await assert.rejects(() => check.acquireCivicFence({ subject: 'local-demo-user', accountId: 'account', sessionId: 'other_civic_session', action: 'confirm_smartcity_checkout' }), /civic payment/i);
  const status = await executeGatewayRequest('GET', '/api/civic/reconciliation', {}, {}, headers);
  assert.deepEqual(status.data, { success: true, status: 'BLOCKED', sessionId: ids[1], action: 'confirm_smartcity_checkout', outcome: 'SUCCEEDED', steps: [] });
  const other = await executeGatewayRequest('GET', '/api/civic/reconciliation', { accountId: accountIdFor('local-demo-user', 'household') }, {}, headers);
  assert.deepEqual(other.data, { success: true, status: 'BLOCKED', outcome: 'SUCCEEDED', steps: [] });
  assert.equal((await executeGatewayRequest('GET', '/api/civic/reconciliation', { accountId: accountIdFor('different-user') }, {}, headers)).status, 403);
});
