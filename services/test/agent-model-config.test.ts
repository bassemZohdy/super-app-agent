import test from 'node:test';
import assert from 'node:assert/strict';
import { config } from '../agent-core/src/orchestrator/config.ts';
import { CompatiblePlanner } from '../agent-core/src/orchestrator/planner.ts';

const base = {
  AGENT_WORKLOAD_KEY: 'local-workload-test-value'.repeat(2),
  AGENT_LLM_BASE_URL: 'https://openrouter.ai/api/v1/',
  AGENT_LLM_MODEL: 'openrouter/free',
  OPENROUTER_API_KEY: 'private-provider-test-value',
};

test('the focused planner reuses the OpenRouter environment key only at its official endpoint', () => {
  assert.equal(config(base).AGENT_LLM_KEY, base.OPENROUTER_API_KEY);
  assert.equal(config({ ...base, AGENT_LLM_KEY: 'explicit-test-value' }).AGENT_LLM_KEY, 'explicit-test-value');
  for (const endpoint of ['http://127.0.0.1:8000/v1/', 'https://openrouter.ai.example/v1/']) {
    assert.equal(config({ ...base, AGENT_LLM_BASE_URL: endpoint }).AGENT_LLM_KEY, undefined);
  }
  for (const endpoint of ['http://openrouter.ai/api/v1/', 'https://openrouter.ai:8443/api/v1/', 'https://openrouter.ai/other/']) {
    assert.throws(() => config({ ...base, AGENT_LLM_BASE_URL: endpoint }), /OPENROUTER_ENDPOINT_REQUIRED/);
  }
});

test('OpenRouter requires a key and refuses paid models even with the historical opt-in set', () => {
  assert.throws(() => config({ ...base, OPENROUTER_API_KEY: '' }), /OPENROUTER_KEY_REQUIRED/);
  assert.throws(() => config({ ...base, AGENT_LLM_MODEL: 'paid/model', OPENROUTER_ALLOW_PAID_MODELS: 'true' }), /FREE_MODEL_REQUIRED/);
  assert.throws(() => new CompatiblePlanner(new URL(base.AGENT_LLM_BASE_URL), 'paid/model', base.OPENROUTER_API_KEY), /FREE_MODEL_REQUIRED/);
});

test('OpenRouter requests enforce zero-price routing and never follow redirects or expose provider errors', async t => {
  const planner = new CompatiblePlanner(new URL(base.AGENT_LLM_BASE_URL), base.AGENT_LLM_MODEL, base.OPENROUTER_API_KEY);
  t.mock.method(globalThis, 'fetch', async (url: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
    assert.equal(String(url), 'https://openrouter.ai/api/v1/chat/completions');
    assert.equal(init?.redirect, 'error');
    assert.equal(new Headers(init?.headers).get('Authorization'), `Bearer ${base.OPENROUTER_API_KEY}`);
    const body = JSON.parse(String(init?.body));
    assert.deepEqual(body.provider.max_price, { prompt: 0, completion: 0 });
    assert.equal(body.max_tokens, 200);
    assert.equal(JSON.stringify(body).includes(base.OPENROUTER_API_KEY), false);
    return Response.json({ choices: [{ message: { content: '{"intent":"list_fines","fineIds":[]}' } }] });
  });
  assert.deepEqual(await planner.plan([{ role: 'user', content: 'show fines' }], []), { intent: 'list_fines', fineIds: [] });
  t.mock.method(globalThis, 'fetch', async () => new Response('private provider failure', { status: 401 }));
  await assert.rejects(planner.plan([{ role: 'user', content: 'show fines' }], []), error => error instanceof Error && error.message === 'MODEL_UNAVAILABLE_OR_INVALID_PLAN');
});

test('the focused planner reuses the LiteLLM environment only for its explicitly selected endpoint', () => {
  const env = { AGENT_WORKLOAD_KEY: base.AGENT_WORKLOAD_KEY, AGENT_LLM_PROVIDER: 'litellm', LITELLM_BASE_URL: 'https://gateway.example.invalid/v1', LITELLM_MODEL: 'glm-5.3', LITELLM_API_KEY: 'synthetic-litellm-credential', OPENROUTER_API_KEY: base.OPENROUTER_API_KEY };
  const selected = config(env);
  assert.equal(selected.AGENT_LLM_BASE_URL?.href, 'https://gateway.example.invalid/v1/');
  assert.equal(selected.AGENT_LLM_MODEL, 'glm-5.3');
  assert.ok(selected.AGENT_LLM_KEY === env.LITELLM_API_KEY);
  assert.throws(() => config({ ...env, AGENT_LLM_BASE_URL: 'https://other.example.invalid/v1/' }), /LITELLM_ENDPOINT_REQUIRED/);
  assert.throws(() => config({ ...env, LITELLM_API_KEY: '' }), /LITELLM_KEY_REQUIRED/);
});
