import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { invokeConversationModel, getModelStatus, conversationModelStatus } from '../agent-core/src/conversation-model.ts';

function configure(t: test.TestContext, provider = 'openrouter') {
  const names = ['ENABLE_LOCAL_LLM', 'CONVERSATION_PROVIDER', 'CONVERSATION_SERVICE_URL', 'OPENROUTER_MODEL', 'OPENROUTER_API_KEY'];
  const previous = Object.fromEntries(names.map(name => [name, process.env[name]]));
  t.after(() => { for (const name of names) { if (previous[name] === undefined) delete process.env[name]; else process.env[name] = previous[name]; } });
  process.env.ENABLE_LOCAL_LLM = 'true'; process.env.CONVERSATION_PROVIDER = provider;
  process.env.OPENROUTER_MODEL = 'openrouter/free';
  process.env.OPENROUTER_API_KEY = randomBytes(32).toString('hex');
  process.env.CONVERSATION_SERVICE_URL = 'http://localhost:4201';
}

test('explicit OpenRouter uses only its official TLS endpoint, zero-price routing and minimized input', async t => {
  configure(t);
  process.env.CONVERSATION_SERVICE_URL = 'https://untrusted.invalid/';
  const key = process.env.OPENROUTER_API_KEY!;
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    assert.equal(String(url), 'https://openrouter.ai/api/v1/chat/completions');
    assert.equal(init?.redirect, 'error');
    assert.ok(new Headers(init?.headers).get('Authorization') === `Bearer ${key}`);
    const body = JSON.parse(String(init?.body));
    assert.equal(body.model, 'openrouter/free');
    assert.deepEqual(body.provider.max_price, { prompt: 0, completion: 0 });
    assert.equal(body.max_tokens, 192);
    assert.ok(!JSON.stringify(body).includes(key));
    assert.ok(!JSON.stringify(body).includes('resident@example.invalid'));
    return Response.json({ choices: [{ message: { content: 'Hello from the selected model.' } }] });
  });
  assert.equal(await invokeConversationModel([{ role: 'user', content: 'Hello resident@example.invalid' }]), 'Hello from the selected model.');
  const status = getModelStatus();
  assert.equal(status.provider, 'openrouter'); assert.equal(status.localOnly, false);
  assert.ok(!JSON.stringify(status).includes(key));
});

test('a key alone never switches local inference to OpenRouter or forwards that key locally', async t => {
  configure(t, 'local');
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    assert.equal(String(url), 'http://localhost:4201/v1/chat/completions');
    assert.equal(new Headers(init?.headers).has('Authorization'), false);
    return Response.json({ choices: [{ message: { content: 'Local reply.' } }] });
  });
  assert.equal(await invokeConversationModel([{ role: 'user', content: 'Hello' }]), 'Local reply.');
  assert.equal(getModelStatus().localOnly, true);
});

test('OpenRouter rejects missing keys, paid models and unknown providers before network access', async t => {
  configure(t);
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => { calls++; throw new Error('Unexpected network access'); });
  process.env.OPENROUTER_API_KEY = '';
  await assert.rejects(invokeConversationModel([{ role: 'user', content: 'Hello' }]), /key is not configured/);
  process.env.OPENROUTER_API_KEY = randomBytes(32).toString('hex');
  process.env.OPENROUTER_MODEL = 'paid/model';
  await assert.rejects(invokeConversationModel([{ role: 'user', content: 'Hello' }]), /free model/);
  process.env.CONVERSATION_PROVIDER = 'other-host';
  await assert.rejects(invokeConversationModel([{ role: 'user', content: 'Hello' }]), /provider is not configured/);
  assert.equal(calls, 0);
});

test('provider failures are sanitized and make one request without silently switching models', async t => {
  configure(t);
  const key = process.env.OPENROUTER_API_KEY!;
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => { calls++; return new Response(`private provider failure ${key}`, { status: 429 }); });
  await assert.rejects(invokeConversationModel([{ role: 'user', content: 'Hello' }]), error => {
    assert.ok(error instanceof Error && !error.message.includes(key));
    assert.ok(error instanceof Error && !error.message.includes('private provider failure'));
    return true;
  });
  assert.equal(calls, 1);
});

test('OpenRouter health metadata does not send credentials on a readiness probe', async t => {
  configure(t);
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => { calls++; throw new Error('No remote health requests'); });
  const status = await conversationModelStatus();
  assert.equal(status.provider, 'openrouter'); assert.equal(status.configured, true);
  assert.equal(status.localOnly, false); assert.equal(calls, 0);
});

test('LiteLLM uses its configured base and separate key without sending OpenRouter credentials', async t => {
  configure(t, 'litellm');
  const names = ['LITELLM_BASE_URL', 'LITELLM_URL', 'LITELLM_API_KEY', 'LITELLM_MODEL'];
  const previous = Object.fromEntries(names.map(name => [name, process.env[name]]));
  t.after(() => { for (const name of names) { if (previous[name] === undefined) delete process.env[name]; else process.env[name] = previous[name]; } });
  process.env.LITELLM_BASE_URL = 'https://gateway.example.invalid/v1';
  process.env.LITELLM_API_KEY = randomBytes(32).toString('hex'); process.env.LITELLM_MODEL = 'glm-5.3';
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    assert.equal(String(url), 'https://gateway.example.invalid/v1/chat/completions');
    assert.equal(init?.redirect, 'error');
    assert.ok(new Headers(init?.headers).get('Authorization') === `Bearer ${process.env.LITELLM_API_KEY}`);
    assert.ok(!JSON.stringify(init).includes(process.env.OPENROUTER_API_KEY!));
    const body = JSON.parse(String(init?.body)); assert.equal(body.model, 'glm-5.3');
    assert.equal(body.provider, undefined);
    return Response.json({ choices: [{ message: { content: 'Configured gateway reply.' } }] });
  });
  assert.equal(await invokeConversationModel([{ role: 'user', content: 'Hello' }]), 'Configured gateway reply.');
  assert.equal(getModelStatus().provider, 'litellm'); assert.equal(getModelStatus().localOnly, false);
  process.env.LITELLM_BASE_URL = 'http://external.invalid/v1';
  await assert.rejects(invokeConversationModel([{ role: 'user', content: 'Hello' }]), /LiteLLM endpoint/);
});
