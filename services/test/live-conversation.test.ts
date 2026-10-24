import test from 'node:test';
import assert from 'node:assert/strict';
import { executeCoreRequest as core } from '../agent-core/src/index.ts';
import { balance } from '../service-wallet/src/index.ts';

function enableLive(t: test.TestContext) {
  const previous = process.env.ENABLE_LOCAL_LLM;
  t.after(() => { if (previous === undefined) delete process.env.ENABLE_LOCAL_LLM; else process.env.ENABLE_LOCAL_LLM = previous; });
  process.env.ENABLE_LOCAL_LLM = 'true';
}
const headers = { authorization: 'Bearer demo-local' };

test('live concierge displays actual model replies, includes service facts and remembers earlier turns', async t => {
  enableLive(t);
  const requests: any[] = [];
  t.mock.method(globalThis, 'fetch', async (_url, init) => {
    requests.push(JSON.parse(init.body));
    return Response.json({ choices: [{ message: { content: requests.length === 1 ? 'The model says hello, Bassem.' : 'Your wallet information is on the service panel.' } }] });
  });
  const sessionId = 'live_context_session';
  const greeting = await core('POST', '/api/a2ui/intent', {}, { sessionId, text: 'hello' }, headers);
  assert.equal(greeting.status, 200);
  assert.equal(greeting.data.surface.assistantMessage.text, 'The model says hello, Bassem.');
  assert.equal(greeting.data.inference.status, 'connected');
  const wallet = await core('POST', '/api/a2ui/intent', {}, { sessionId, text: 'Show my wallet balance' }, headers);
  assert.equal(wallet.data.surface.assistantMessage.text, 'Your wallet information is on the service panel.');
  assert.ok(requests[1].messages.some((m: any) => m.role === 'assistant' && m.content === 'The model says hello, Bassem.'));
  assert.match(requests[1].messages[0].content, /Current service surface/);
  assert.match(requests[1].messages[0].content, /SIMULATED/);
  assert.match(requests[1].messages[0].content, new RegExp(String(balance)));
});

test('live follow-ups preserve proposals and chat assent never executes a payment', async t => {
  enableLive(t);
  t.mock.method(globalThis, 'fetch', async () => Response.json({ choices: [{ message: { content: 'Please use the service confirmation button.' } }] }));
  const sessionId = 'live_approval_session';
  const initialBalance = balance;
  const proposal = await core('POST', '/api/a2ui/intent', {}, { sessionId, text: 'Show my wallet balance' }, headers);
  const followup = await core('POST', '/api/a2ui/intent', {}, { sessionId, text: 'Can you explain that a little differently?' }, headers);
  assert.deepEqual(followup.data.surface.view, proposal.data.surface.view);
  await core('POST', '/api/a2ui/intent', {}, { sessionId, text: 'yes' }, headers);
  assert.equal(balance, initialBalance);
});

test('live provider failure is visible, retains service results and never masquerades as a model reply', async t => {
  enableLive(t);
  t.mock.method(globalThis, 'fetch', async () => new Response('private provider details', { status: 429 }));
  const result = await core('POST', '/api/a2ui/intent', {}, { sessionId: 'live_failure_session', text: 'Show wallet balance' }, headers);
  assert.equal(result.data.inference.status, 'error');
  assert.equal(result.data.inference.code, 'LOCAL_MODEL_HTTP_429');
  assert.match(result.data.surface.assistantMessage.text, /busy or unavailable/);
  assert.ok(result.data.surface.view.children.some((node: any) => node.type === 'MetricWidget'));
  assert.equal(JSON.stringify(result.data).includes('private provider details'), false);
  const restored = await core('GET', '/api/sessions/live_failure_session', {}, {}, headers);
  assert.equal(restored.status, 200);
  assert.equal(restored.data.inference?.status, 'error');
  assert.equal(restored.data.inference?.code, 'LOCAL_MODEL_HTTP_429');
});
