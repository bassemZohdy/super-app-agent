import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Plan, Quote, quoteFor, digest, Message, AgentError, type ExecutionContext } from '../agent-core/src/orchestrator/contracts.ts';
import { FixturePlanner, CompatiblePlanner } from '../agent-core/src/orchestrator/planner.ts';
import { invokeTool } from '../agent-core/src/orchestrator/fines-adapter.ts';
import { config } from '../agent-core/src/orchestrator/config.ts';
import { harness } from '../agent-core/test/support.ts';
import http from 'node:http';

test('strict plan/input schemas refuse invented tools, permissions and credential-like text', () => {
  assert.throws(() => Plan.parse({ intent: 'pay_fines', fineIds: [], permissions: ['admin'] }));
  assert.throws(() => Plan.parse({ intent: 'loop', fineIds: [] }));
  assert.throws(() => Plan.parse({ intent: 'pay_fines', fineIds: Array(11).fill('fine-1') }));
  assert.throws(() => Message.parse('Authorization: Bearer sensitive'));
  assert.throws(() => Message.parse('token=credential'));
  assert.throws(() => Quote.parse({ fineIds: ['fine-1'], amountMinor: -1, currency: 'AED', versions: [1] }));
});
test('fixture intent and multi-turn routing; canonical quote produces stable keys', async () => {
  const planner = new FixturePlanner();
  assert.equal((await planner.plan([{ role: 'user', content: 'show my fines' }])).intent, 'list_fines');
  assert.equal((await planner.plan([{ role: 'assistant', content: 'Your fines' }, { role: 'user', content: 'pay them' }])).intent, 'pay_fines');
  const fines = [{ id: 'fine-2', description: 'b', amountMinor: 200, version: 1 }, { id: 'fine-1', description: 'a', amountMinor: 100, version: 1 }];
  assert.equal(digest(quoteFor(fines)), digest(quoteFor(fines.reverse())));
});
test('fixture planner recognizes explicit Arabic fines and renewal requests without inferring negated payment', async () => {
  const planner = new FixturePlanner();
  for (const [message, intent] of [
    ['عرض المخالفات المستحقة', 'list_fines'],
    ['مراجعة دفع المخالفات المستحقة', 'pay_fines'],
    ['تجديد تسجيل المركبة', 'renew_registration'],
    ['لا تدفع المخالفات', 'out_of_scope'],
    ['عرض المخالفات المستحقة ولا تدفع', 'out_of_scope'],
  ] as const) assert.equal((await planner.plan([{ role: 'user', content: message }])).intent, intent);
});
test('Arabic fixture requests bind selected resources and reject negated mixed-language payment', async () => {
  const planner = new FixturePlanner();
  for (const [message, intent] of [
    ['عرض المخالفة fine-1', 'list_fines'],
    ['مراجعة دفع المخالفة fine-1', 'pay_fines'],
    ['تجديد تسجيل المركبة veh-1', 'renew_registration'],
    ['لا تدفع fine-1 pay', 'out_of_scope'],
    ['مراجعة دفع المخالفة fine-1 ولا تدفع', 'out_of_scope'],
    ['أريد دفعها', 'clarify'],
  ] as const) assert.equal((await planner.plan([{ role: 'user', content: message }])).intent, intent);
  const followup = await planner.plan([{ role: 'user', content: 'عرض المخالفة fine-1' }, { role: 'assistant', content: 'fine-1' }, { role: 'user', content: 'أريد دفعها' }]);
  assert.equal(followup.intent, 'pay_fines');
});
test('configuration fails closed without authority, model configuration or on production mocks', () => {
  assert.throws(() => config({}));
  assert.throws(() => config({ AGENT_WORKLOAD_KEY: 'x'.repeat(32), AGENT_PLANNER: 'compatible' }));
  assert.throws(() => config({ NODE_ENV: 'production', AGENT_WORKLOAD_KEY: 'x'.repeat(32), AGENT_PLANNER: 'fixture', AGENT_AUTH: 'test' }));
});
test('unavailable OpenAI-compatible provider returns a safe bounded error', async () => {
  await assert.rejects(new CompatiblePlanner(new URL('http://127.0.0.1:1/v1/'), 'test', 'never-echo-this', 50).plan([{ role: 'user', content: 'fines' }], []), /MODEL_UNAVAILABLE_OR_INVALID_PLAN/);
});
test('OpenAI-compatible planner calls configured HTTP endpoint and validates its response', async () => {
  let called = false;
  const server = http.createServer((req, res) => {
    assert.equal(req.url, '/v1/chat/completions');
    called = true;
    req.resume(); res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ intent: 'pay_fines', fineIds: ['fine-1'] }) } }] }));
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const planner = new CompatiblePlanner(new URL(`http://127.0.0.1:${(server.address() as { port: number }).port}/v1/`), 'mock-model');
    const plan = await planner.plan([{ role: 'user', content: 'pay fine-1' }], [{ id: 'fines.pay', description: 'Simulated fines' }]);
    assert.deepEqual(plan, { intent: 'pay_fines', fineIds: ['fine-1'] }); assert.equal(called, true);
  } finally { await new Promise<void>(resolve => { server.close(() => resolve()); server.closeIdleConnections(); }); }
});
test('planner withholds complete embedded fine and vehicle references from the model', async () => {
  let request = '';
  const server = http.createServer((req, res) => {
    req.setEncoding('utf8');
    req.on('data', chunk => { request += chunk; });
    req.on('end', () => {
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ intent: 'pay_fines', fineIds: [] }) } }] }));
    });
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const planner = new CompatiblePlanner(new URL(`http://127.0.0.1:${(server.address() as { port: number }).port}/v1/`), 'mock-model');
    const plan = await planner.plan([{ role: 'user', content: 'pay prefix_fine-1- for prefix_veh-2-' }], []);
    assert.deepEqual(plan.fineIds, ['prefix_fine-1-']);
    assert.doesNotMatch(request, /prefix_fine-1-|prefix_veh-2-/);
    assert.match(request, /the selected fine/);
    assert.match(request, /the selected vehicle/);
  } finally { await new Promise<void>(resolve => { server.close(() => resolve()); server.closeIdleConnections(); }); }
});
test('tool timeout and schema failures are safe; consequential calls require key', async () => {
  const h = await harness({ timeoutMs: 10 });
  try {
    const ctx: ExecutionContext = { principal: { subject: 'alice', workload: 'super-app-agent', permissions: ['fines:read', 'fines:pay'], expiresAt: Date.now() + 10000 }, authorization: `Bearer ${h.identities[0].token}`, correlationId: randomUUID(), revalidate: async () => ctx.principal };
    await assert.rejects(invokeTool(h.tools.pay, { quote: quoteFor(h.store.fines('alice')), consentId: randomUUID() }, ctx), /IDEMPOTENCY_KEY_REQUIRED/);
    const slow = { ...h.tools.list, invoke: async (_i: unknown, _c: unknown, signal: AbortSignal) => new Promise<never>((_resolve, reject) => signal.addEventListener('abort', () => reject(new Error('timeout')), { once: true })) };
    await assert.rejects(invokeTool(slow, {}, ctx), /TOOL_TIMEOUT_OR_INVALID_RESPONSE/);
    await assert.rejects(invokeTool({ ...h.tools.list, invoke: async () => { throw new AgentError('PROVIDER_FAILURE', 503); } }, {}, ctx), /PROVIDER_FAILURE/);
  } finally { await h.close(); }
});
