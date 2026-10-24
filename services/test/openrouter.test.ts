import test from 'node:test';
import assert from 'node:assert/strict';
import { getOpenRouterConfig, invokeOpenRouterChat, isLiveLLMEnabled, getModelStatus } from '../agent-core/src/openrouter.ts';

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
    assert.ok(body.max_tokens <= 1200);
    return new Response(JSON.stringify({ choices: [{ message: { content: 'Hello' } }] }), { status: 200 });
  };
  assert.strictEqual(await invokeOpenRouterChat([{ role: 'user', content: 'hello' }]), 'Hello');
  assert.strictEqual(chosen, 'openrouter/free');
});

test('OpenRouter live mode follows key configuration and explicit opt-out without leaking secrets', t => {
  const previous = { OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY, ENABLE_LIVE_LLM: process.env.ENABLE_LIVE_LLM };
  t.after(() => { for (const [key, value] of Object.entries(previous)) {
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  } });
  process.env.OPENROUTER_API_KEY = 'private-test-key';
  delete process.env.ENABLE_LIVE_LLM;
  assert.equal(isLiveLLMEnabled(), true);
  assert.equal(getModelStatus().mode, 'live');
  assert.equal(JSON.stringify(getModelStatus()).includes('private-test-key'), false);
  process.env.ENABLE_LIVE_LLM = 'false';
  assert.equal(isLiveLLMEnabled(), false);
  delete process.env.OPENROUTER_API_KEY;
  process.env.ENABLE_LIVE_LLM = 'true';
  assert.equal(isLiveLLMEnabled(), false);
});

test('OpenRouter rejects empty, embedded-error and HTTP error replies', async t => {
  const previous = { OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY, OPENROUTER_MODEL: process.env.OPENROUTER_MODEL };
  t.after(() => { for (const [key, value] of Object.entries(previous)) {
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  } });
  process.env.OPENROUTER_API_KEY = 'test-key';
  process.env.OPENROUTER_MODEL = 'openrouter/free';
  for (const body of [{ choices: [] }, { choices: [{ message: { content: '  ' } }] }, { error: { message: 'private upstream details' } }]) {
    t.mock.method(globalThis, 'fetch', async () => Response.json(body));
    await assert.rejects(() => invokeOpenRouterChat([{ role: 'user', content: 'hello' }]), /returned no reply/);
  }
  t.mock.method(globalThis, 'fetch', async () => new Response('secret upstream error', { status: 401 }));
  await assert.rejects(() => invokeOpenRouterChat([{ role: 'user', content: 'hello' }]), /rejected the API key/);
});
