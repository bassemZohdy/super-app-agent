import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createHash, randomUUID } from 'node:crypto';
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
  let unavailableTollLookup = false;
  const server = http.createServer(async (req, res) => {
    const chunks: Buffer[] = []; for await (const chunk of req) chunks.push(Buffer.from(chunk));
    const path = new URL(req.url!, 'http://localhost').pathname, method = req.method!, body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : {};
    if (unavailableTollLookup && method === 'GET' && path.startsWith('/mobility/salik/recharges/')) { res.writeHead(503, { 'content-type': 'application/json' }); res.end(JSON.stringify({ success: false, error: 'Unavailable' })); return; }
    const handler = path.startsWith('/profile/') ? domainHandlers.profile : path.startsWith('/utilities/') ? domainHandlers.food : path.startsWith('/mobility/') ? domainHandlers.ride : domainHandlers.wallet;
    const result = handler(method, path, {}, body);
    res.writeHead(result.status, { 'content-type': 'application/json' }); res.end(JSON.stringify(result.data));
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address(); assert.ok(address && typeof address !== 'string');
  const base = `http://127.0.0.1:${address.port}`;
  Object.assign(process.env, { SERVICE_WALLET_URL: base, SERVICE_FOOD_URL: base, SERVICE_RIDE_URL: base, SERVICE_PROFILE_URL: base });
  const ids = [`civic_persist_success_${randomUUID()}`, `civic_persist_failure_${randomUUID()}`], auditKeys: string[] = [];
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
    await check.client.del([key, ...auditKeys]); await check.close(); await store.close();
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
  assert.equal(status.data.status, 'BLOCKED'); assert.equal(status.data.sessionId, ids[1]);
  assert.deepEqual(status.data.civicReview, { ...pending.payload.offlineReview, tollAmountMinor: 10000 });
  assert.equal(status.data.civicSteps[0].receiptReference, transactions.at(-1)?.id);
  assert.match(status.data.civicSteps[1].receiptReference, /^SLK-TX-/);
  assert.deepEqual(status.data.civicSteps.map((step: { name: string; state: string }) => [step.name, step.state]), [['WALLET', 'CONFIRMED'], ['TOLL', 'CONFIRMED']]);
  const beforeVerify = balance, ledgerBeforeVerify = transactions.length;
  const verified = await executeGatewayRequest('GET', '/api/civic/reconciliation', { verify: '1' }, {}, headers);
  assert.deepEqual(verified.data.civicEvidence, [{ name: 'WALLET', assessment: 'MATCH' }, { name: 'TOLL', assessment: 'MATCH' }]);
  assert.equal(balance, beforeVerify); assert.equal(transactions.length, ledgerBeforeVerify);
  const privateStatus = await executeGatewayRequest('GET', '/api/civic/reconciliation', { accountId: accountIdFor('local-demo-user', 'household'), verify: '1' }, {}, headers);
  assert.equal(privateStatus.data.civicEvidence, undefined);
  const other = await executeGatewayRequest('GET', '/api/civic/reconciliation', { accountId: accountIdFor('local-demo-user', 'household') }, {}, headers);
  assert.deepEqual(other.data, { success: true, status: 'BLOCKED', outcome: 'SUCCEEDED', steps: [] });
  assert.equal((await executeGatewayRequest('GET', '/api/civic/reconciliation', { accountId: accountIdFor('different-user') }, {}, headers)).status, 403);
  const revision = status.data.revision; assert.match(revision, /^[a-f0-9]{64}$/);
  const stale = await executeGatewayRequest('POST', '/api/civic/reconciliation/resolve', {}, { revision: 'a'.repeat(64) }, headers);
  assert.equal(stale.status, 409); assert.equal(await check.client.exists(key), 1);
  const otherResolution = await executeGatewayRequest('POST', '/api/civic/reconciliation/resolve', {}, { revision, accountId: accountIdFor('local-demo-user', 'household') }, headers);
  assert.equal(otherResolution.status, 409); assert.equal(await check.client.exists(key), 1);
  unavailableTollLookup = true;
  const unavailable = await executeGatewayRequest('POST', '/api/civic/reconciliation/resolve', {}, { revision }, headers);
  assert.equal(unavailable.status, 409); assert.equal(unavailable.data.code, 'CIVIC_EVIDENCE_INCOMPLETE'); assert.equal(await check.client.exists(key), 1);
  unavailableTollLookup = false;
  const tx = transactions.at(-1)!, savedAmount = tx.amount;
  tx.amount += 0.01;
  try {
    const changedEvidence = await executeGatewayRequest('POST', '/api/civic/reconciliation/resolve', {}, { revision }, headers);
    assert.equal(changedEvidence.status, 409); assert.equal(changedEvidence.data.code, 'CIVIC_EVIDENCE_INCOMPLETE'); assert.equal(await check.client.exists(key), 1);
  } finally { tx.amount = savedAmount; }
  const ownerDigest = createHash('sha256').update(JSON.stringify(['local-demo-user', accountIdFor('local-demo-user')])).digest('hex');
  const retiredDigest = createHash('sha256').update(JSON.stringify([ownerDigest, ids[1], pending.surfaceRevision])).digest('hex');
  auditKeys.push(`superapp:civic-resolution:${revision}`, `superapp:civic-retired:${retiredDigest}`);
  const activeRecord = await check.client.get(key); assert.ok(activeRecord);
  await check.client.set(auditKeys[0], activeRecord);
  assert.equal(await check.hasCivicResolution('local-demo-user', accountIdFor('local-demo-user'), revision), false, 'an archive alone is not a completed resolution');
  const concurrent = await Promise.all([1, 2].map(() => executeGatewayRequest('POST', '/api/civic/reconciliation/resolve', {}, { revision }, headers)));
  assert.equal(concurrent.filter(item => item.status === 200 && item.data.resolution === 'RESOLVED').length, 1);
  assert.ok(concurrent.every(item => item.status === 200 || item.status === 409));
  assert.equal(await check.client.exists(key), 0); assert.equal(await check.client.exists(auditKeys[0]), 1);
  await assert.rejects(() => check.acquireCivicFence({ subject: 'local-demo-user', accountId: accountIdFor('local-demo-user'), sessionId: ids[1], action: 'confirm_smartcity_checkout', surfaceRevision: pending.surfaceRevision }), /resolved/i, 'the old approval cannot start a replacement checkout');
  const oldReplay = await executeGatewayRequest('POST', '/api/a2ui/action', {}, pending, headers);
  assert.equal(oldReplay.status, 409); assert.equal(oldReplay.data.code, 'CIVIC_APPROVAL_RESOLVED'); assert.equal(balance, beforeVerify); assert.equal(transactions.length, ledgerBeforeVerify);

  const nextFence = await check.acquireCivicFence({ subject: 'another-owner', accountId: 'another-account', sessionId: 'another_session', action: 'confirm_smartcity_checkout' });
  try {
    const replay = await executeGatewayRequest('POST', '/api/civic/reconciliation/resolve', {}, { revision }, headers);
    assert.equal(replay.status, 200); assert.equal(replay.data.resolution, 'ALREADY_RESOLVED');
    assert.equal(await check.client.exists(key), 1, 'replay cannot clear a newer checkout');
    const otherReplay = await executeGatewayRequest('POST', '/api/civic/reconciliation/resolve', {}, { revision, accountId: accountIdFor('local-demo-user', 'household') }, headers);
    assert.equal(otherReplay.status, 409);
  } finally { await nextFence.release(); }
  assert.equal(balance, beforeVerify); assert.equal(transactions.length, ledgerBeforeVerify);

});
