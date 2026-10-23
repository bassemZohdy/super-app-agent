import test from 'node:test';
import assert from 'node:assert/strict';
import { executeCoreRequest as core, getOrCreateSession, sseClients } from '../agent-core/src/index.ts';
import { SuperAppAgentGraph } from '../agent-core/src/langgraph/graph.ts';
import { domainHandlers } from '../agent-core/src/domain-operations.ts';
import { balance, transactions } from '../service-wallet/src/index.ts';

const intent = (sessionId: string, text = 'show my wallet') => core('POST', '/api/a2ui/intent', {}, { sessionId, text });
const action = (sessionId: string, surfaceRevision: string, payload = { amount: 50 }) =>
  core('POST', '/api/a2ui/action', {}, { sessionId, surfaceRevision, action: 'topup_wallet', payload });
function gate() {
  let release!: () => void;
  const promise = new Promise<void>(resolve => { release = resolve; });
  return { promise, release };
}

test('P0-10: running intent excludes intents/actions through the final broadcast; other sessions proceed', async t => {
  const sid = 'concurrency_intent_session';
  const initial = await intent(sid);
  const entered = gate(), resume = gate();
  const real = SuperAppAgentGraph.executeIntent;
  t.mock.method(SuperAppAgentGraph, 'executeIntent', async (...args: Parameters<typeof real>) => {
    if (args[0].sessionId === sid) { entered.release(); await resume.promise; }
    return real.apply(SuperAppAgentGraph, args);
  });
  const running = intent(sid, 'find a ride');
  await entered.promise;
  try {
    const count = getOrCreateSession(sid).messages.length;
    assert.equal((await intent(sid)).data.code, 'SESSION_BUSY');
    assert.equal((await action(sid, initial.data.surface.revision)).data.code, 'SESSION_BUSY');
    assert.equal(getOrCreateSession(sid).messages.length, count);
    assert.equal((await intent('concurrency_other_session')).status, 200);
  } finally { resume.release(); }
  assert.equal((await running).status, 200);
  assert.equal((await action(sid, initial.data.surface.revision)).data.code, 'STALE_SURFACE');
  assert.equal((await intent(sid)).status, 200);
});

test('P0-10: duplicate in-flight actions have one effect and old revisions cannot replay', async t => {
  const sid = 'concurrency_action_session';
  const revision = (await intent(sid)).data.surface.revision;
  const entered = gate(), resume = gate();
  const real = SuperAppAgentGraph.resumeWithAction;
  t.mock.method(SuperAppAgentGraph, 'resumeWithAction', async (...args: Parameters<typeof real>) => {
    entered.release(); await resume.promise; return real.apply(SuperAppAgentGraph, args);
  });
  const before = balance, count = transactions.length;
  const running = action(sid, revision);
  await entered.promise;
  try {
    assert.equal((await action(sid, revision)).data.code, 'SESSION_BUSY');
    assert.equal((await intent(sid)).data.code, 'SESSION_BUSY');
  } finally { resume.release(); }
  assert.equal((await running).status, 200);
  assert.equal(balance, before + 50); assert.equal(transactions.length, count + 1);
  assert.equal((await action(sid, revision)).data.code, 'STALE_SURFACE');
  assert.equal(balance, before + 50);
});

test('P0-10: equal timestamps still yield distinct revisions and SSE/HTTP share each revision', async t => {
  t.mock.method(Date, 'now', () => 123456789);
  const sid = 'concurrency_revision_session', events: any[] = [];
  sseClients.set(sid, new Set([event => events.push(event)]));
  try {
    const first = (await intent(sid)).data.surface;
    const second = (await intent(sid)).data.surface;
    assert.equal(first.timestamp, second.timestamp);
    assert.notEqual(first.revision, second.revision);
    assert.equal(events.filter(e => e.type === 'A2UI_RENDER_SURFACE').at(-1).data.surface.revision, second.revision);
    assert.equal((await action(sid, first.revision)).data.code, 'STALE_SURFACE');
    assert.equal((await action(sid, second.revision)).status, 200);
  } finally { sseClients.delete(sid); }
});

test('P0-10: invalid envelopes do not consume approval; definitive rejection permits fresh intent', async t => {
  const sid = 'concurrency_retry_session';
  const revision = (await intent(sid)).data.surface.revision;
  assert.equal((await core('POST', '/api/a2ui/action', {}, { sessionId: sid, action: 'topup_wallet', payload: { amount: 50 } })).status, 400);
  assert.equal((await action(sid, revision, { amount: 0 })).status, 400);
  const real = domainHandlers.wallet;
  const mock = t.mock.method(domainHandlers, 'wallet', (method, path, query, body) => method === 'POST'
    ? { status: 409, data: { success: false, error: 'rejected' } } : real(method, path, query, body));
  const failed = await action(sid, revision);
  assert.equal(failed.data.outcome, 'FAILED');
  assert.equal((await action(sid, revision)).data.code, 'STALE_SURFACE');
  mock.mock.restore();
  const refreshed = await intent(sid);
  assert.equal(refreshed.status, 200);
  assert.equal((await action(sid, refreshed.data.surface.revision)).status, 200);
});

test('P0-10: uncertain effects block both refresh and retry without additional writes', async t => {
  const sid = 'concurrency_unknown_session';
  const revision = (await intent(sid)).data.surface.revision;
  const real = domainHandlers.wallet;
  t.mock.method(domainHandlers, 'wallet', (method, path, query, body) => {
    const result = real(method, path, query, body);
    if (method === 'POST') throw new Error('response lost');
    return result;
  });
  const before = balance;
  const result = await action(sid, revision);
  assert.equal(result.data.outcome, 'UNKNOWN');
  const retry = await action(sid, revision), refresh = await intent(sid);
  assert.equal(retry.data.code, 'RECONCILIATION_REQUIRED');
  assert.equal(refresh.data.code, 'RECONCILIATION_REQUIRED');
  assert.deepEqual(refresh.data.steps, result.data.steps);
  assert.deepEqual(refresh.data.retry, { allowed: false, next: 'reconcile' });
  assert.equal(balance, before + 50);
});
