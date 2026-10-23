import test from 'node:test';
import assert from 'node:assert/strict';
import { executeCoreRequest as core, getOrCreateSession, sseClients, server } from '../agent-core/src/index.ts';
import { domainHandlers, callDomain, trackDomainOperations, type Step } from '../agent-core/src/domain-operations.ts';
import { executeWalletRequest as wallet, balance, transactions, policeFines } from '../service-wallet/src/index.ts';
import { activeOrders } from '../service-food/src/index.ts';
import { activeRides } from '../service-ride/src/index.ts';
import { readEventStream } from '../../packages/protocol-core/src/sse-client.ts';

const composite = 'Book a ride downtown and order pizza, pay with my wallet';
const intent = (sid: string, text = composite) => core('POST', '/api/a2ui/intent', {}, { sessionId: sid, text });
const action = (sid: string, action = 'confirm_composite_checkout') => core('POST', '/api/a2ui/action', {}, { sessionId: sid, action, payload: {} });
function ensureFunds() { if (balance < 50) assert.equal(wallet('POST', '/wallet/topup', {}, { amount: 100 }).status, 200); }

test('P0-12: insufficient funds returns failure JSON and failure SSE surface without clearing fines', async () => {
  const sid = 'failure_fines_session';
  assert.equal((await intent(sid, 'Check my police fines')).status, 200);
  const before = JSON.stringify({ balance, transactions, policeFines });
  const events: any[] = [];
  sseClients.set(sid, new Set([event => events.push(event)]));
  try {
    const result = await action(sid, 'pay_police_fines');
    assert.equal(result.status, 400);
    assert.equal(result.data.success, false);
    assert.equal(result.data.code, 'DOMAIN_REJECTED');
    assert.equal(result.data.outcome, 'FAILED');
    assert.equal(result.data.surface.view.id, 'execution_outcome_card');
    assert.equal(result.data.steps[0].state, 'FAILED');
    assert.equal(JSON.stringify({ balance, transactions, policeFines }), before);
    const render = events.filter(event => event.type === 'A2UI_RENDER_SURFACE').at(-1);
    assert.equal(render.data.surface.view.id, 'execution_outcome_card');
    assert.equal(render.data.outcome, result.data.outcome);
    assert.equal(render.data.code, result.data.code);
    assert.ok(!getOrCreateSession(sid).messages.some(message => message.content.includes('All traffic fines cleared')));
  } finally { sseClients.delete(sid); }
});

test('P0-12: composite stops at rejected second effect and records exact partial outcome', async t => {
  ensureFunds();
  const sid = 'failure_partial_session';
  assert.equal((await intent(sid)).status, 200);
  const realRide = domainHandlers.ride, realFood = domainHandlers.food;
  let foodEffects = 0;
  t.mock.method(domainHandlers, 'ride', (method, path, query, body) => method === 'POST'
    ? { status: 409, data: { error: 'Ride no longer available' } } : realRide(method, path, query, body));
  t.mock.method(domainHandlers, 'food', (method, path, query, body) => {
    if (method === 'POST') foodEffects++;
    return realFood(method, path, query, body);
  });
  const before = balance, rides = activeRides.size, orders = activeOrders.size, ledger = transactions.length;
  const result = await action(sid);
  assert.equal(result.status, 409);
  assert.equal(result.data.outcome, 'PARTIALLY_COMPLETED');
  assert.equal(result.data.code, 'PARTIAL_EXECUTION');
  assert.deepEqual(result.data.steps.map((step: Step) => [step.service, step.state]), [['wallet', 'SUCCEEDED'], ['ride', 'FAILED']]);
  assert.equal(balance, Math.round((before - 40) * 100) / 100);
  assert.equal(transactions.length, ledger + 1);
  assert.equal(activeRides.size, rides); assert.equal(activeOrders.size, orders); assert.equal(foodEffects, 0);
  assert.deepEqual(result.data.retry, { allowed: false, next: 'reconcile' });
  assert.equal(result.data.surface.view.style.variant, 'warning');
});

test('P0-12: effect applied then exception yields UNKNOWN; no later effect or unsafe retry', async t => {
  ensureFunds();
  const sid = 'failure_unknown_session';
  assert.equal((await intent(sid)).status, 200);
  const realWallet = domainHandlers.wallet;
  t.mock.method(domainHandlers, 'wallet', (method, path, query, body) => {
    const result = realWallet(method, path, query, body);
    if (method === 'POST') throw new Error('Internal credential=never-expose');
    return result;
  });
  const before = balance, rides = activeRides.size, orders = activeOrders.size;
  const result = await action(sid);
  assert.equal(result.status, 502);
  assert.equal(result.data.outcome, 'UNKNOWN');
  assert.equal(result.data.code, 'DOMAIN_OUTCOME_UNKNOWN');
  assert.equal(result.data.steps[0].state, 'UNKNOWN');
  assert.equal(balance, Math.round((before - 40) * 100) / 100);
  assert.equal(activeRides.size, rides); assert.equal(activeOrders.size, orders);
  assert.ok(!JSON.stringify(result).includes('never-expose'));
  assert.deepEqual(result.data.retry, { allowed: false, next: 'reconcile' });
  assert.equal((await action(sid)).status, 403);
  assert.equal(balance, Math.round((before - 40) * 100) / 100);
});

test('P0-12: unavailable read rejects the intent without fabricated surface or upstream details', async t => {
  t.mock.method(domainHandlers, 'profile', () => ({ status: 503, data: { error: 'private database connection string' } }));
  const result = await intent('failure_unavailable_session');
  assert.equal(result.status, 503);
  assert.equal(result.data.code, 'DOMAIN_UNAVAILABLE');
  assert.equal(result.data.outcome, 'FAILED');
  assert.deepEqual(result.data.steps, []);
  assert.equal(result.data.retry.allowed, true);
  assert.ok(!JSON.stringify(result).includes('database connection string'));
  assert.equal(result.data.surface.view.id, 'execution_outcome_card');
});

test('P0-12: nominal 200/error mutation response is not accepted as success', async t => {
  ensureFunds();
  const sid = 'failure_invalid_success';
  assert.equal((await intent(sid)).status, 200);
  const original = domainHandlers.wallet;
  t.mock.method(domainHandlers, 'wallet', (method, path, query, body) => method === 'POST'
    ? { status: 200, data: { success: true, error: 'conflicting result' } } : original(method, path, query, body));
  const before = balance, rides = activeRides.size;
  const result = await action(sid);
  assert.equal(result.status, 502); assert.equal(result.data.outcome, 'UNKNOWN');
  assert.equal(balance, before); assert.equal(activeRides.size, rides);
});

test('P0-12: incomplete mutation receipt is UNKNOWN rather than an undefined-value success card', async t => {
  ensureFunds();
  const sid = 'failure_missing_receipt';
  assert.equal((await intent(sid)).status, 200);
  const original = domainHandlers.wallet;
  t.mock.method(domainHandlers, 'wallet', (method, path, query, body) => method === 'POST'
    ? { status: 200, data: { success: true } } : original(method, path, query, body));
  const result = await action(sid);
  assert.equal(result.status, 502);
  assert.equal(result.data.outcome, 'UNKNOWN');
  assert.equal(result.data.surface.view.id, 'execution_outcome_card');
});

test('P0-12: operation tracking remains isolated between interleaved requests', async () => {
  const a: Step[] = [], b: Step[] = [];
  await Promise.all([
    trackDomainOperations(a, async () => { await Promise.resolve(); callDomain('wallet', 'POST', '/wallet/topup', {}, { amount: 0.01 }); }),
    trackDomainOperations(b, async () => { await Promise.resolve(); assert.throws(() => callDomain('ride', 'POST', '/rides/book', {}, { driverId: 'missing' })); }),
  ]);
  assert.deepEqual(a.map(step => step.state), ['SUCCEEDED']);
  assert.deepEqual(b.map(step => step.state), ['FAILED']);
});

test('P0-12: actual HTTP action and SSE render expose the same failed outcome', async t => {
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); });
  const sid = 'failure_http_fines_session';
  const base = `http://127.0.0.1:${(server.address() as any).port}`;
  const post = (path: string, body: any) => fetch(base + path, { method: 'POST',
    headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  assert.equal((await post('/api/a2ui/intent', { sessionId: sid, text: 'Check police fines' })).status, 200);
  const abort = new AbortController();
  const response = await fetch(base + '/api/a2ui/stream?sessionId=' + sid, { signal: AbortSignal.any([abort.signal, AbortSignal.timeout(5000)]) });
  const stream = readEventStream(response);
  await stream.next(); await stream.next(); // handshake + snapshot
  const actionResponse = await post('/api/a2ui/action', { sessionId: sid, action: 'pay_police_fines', payload: {} });
  assert.equal(actionResponse.status, 400);
  const result = await actionResponse.json();
  while (true) {
    const event = await stream.next(); assert.equal(event.done, false);
    const message = JSON.parse(event.value!.data);
    if (message.type === 'A2UI_RENDER_SURFACE') {
      assert.equal(message.data.surface.view.id, result.surface.view.id);
      assert.equal(message.data.surface.view.id, 'execution_outcome_card');
      break;
    }
  }
  abort.abort(); await stream.return(undefined);
});

test('P0-12: move-in planning does not claim activation before approval', async () => {
  const result = await intent('failure_movein_plan_session', 'I signed my Ejari lease; connect my utilities and parking');
  assert.equal(result.status, 200);
  assert.equal(result.data.outcome, 'SUCCEEDED');
  assert.deepEqual(result.data.steps, [], 'Planning must have no effects');
  assert.ok(result.data.surface.view.children.some((node: any) => node.id === 'dewa_connection_metric' && node.properties.value === 'Pending approval'));
});
