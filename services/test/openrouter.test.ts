import test from 'node:test';
import assert from 'node:assert/strict';
import { getOpenRouterConfig, invokeOpenRouterChat } from '../agent-core/src/openrouter.ts';

test('OpenRouter defaults to free router and never charges without explicit opt-in', async t => {
  const previous = {
    OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY,
    OPENROUTER_MODEL: process.env.OPENROUTER_MODEL,
    OPENROUTER_ALLOW_PAID_MODELS: process.env.OPENROUTER_ALLOW_PAID_MODELS,
  };
  const oldFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = oldFetch;
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
  delete process.env.OPENROUTER_MODEL;
  delete process.env.OPENROUTER_ALLOW_PAID_MODELS;
  assert.strictEqual(getOpenRouterConfig().model, 'openrouter/free');
  process.env.OPENROUTER_API_KEY = '';
  const mock = await invokeOpenRouterChat([{ role: 'user', content: 'hello' }]);
  assert.match(mock, /demo_fallback/);

  process.env.OPENROUTER_API_KEY = 'fake-test-key';
  process.env.OPENROUTER_MODEL = 'anthropic/claude-sonnet-4';
  await assert.rejects(() => invokeOpenRouterChat([{ role: 'user', content: 'hello' }]), /Paid model blocked/);

  process.env.OPENROUTER_MODEL = 'openrouter/free';
  let chosen = '';
  globalThis.fetch = async (_input, init) => {
    const body = JSON.parse(String(init?.body));
    chosen = body.model;
    assert.ok(body.max_tokens <= 300);
    return new Response(JSON.stringify({ choices: [{ message: { content: 'Hello' } }] }), { status: 200 });
  };
  assert.strictEqual(await invokeOpenRouterChat([{ role: 'user', content: 'hello' }]), 'Hello');
  assert.strictEqual(chosen, 'openrouter/free');
});
