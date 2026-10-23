import test from 'node:test';
import assert from 'node:assert/strict';
import { getOpenRouterConfig, getOpenRouterTTSConfig, invokeOpenRouterChat, invokeOpenRouterTTS } from '../agent-core/src/openrouter.ts';

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

test('OpenRouter TTS: defaults, fallback on missing key, and audio synthesis', async t => {
  const previous = {
    OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY,
    OPENROUTER_TTS_MODEL: process.env.OPENROUTER_TTS_MODEL,
    OPENROUTER_TTS_VOICE: process.env.OPENROUTER_TTS_VOICE,
  };
  const oldFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = oldFetch;
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  delete process.env.OPENROUTER_TTS_MODEL;
  delete process.env.OPENROUTER_TTS_VOICE;
  const ttsConfig = getOpenRouterTTSConfig();
  assert.strictEqual(ttsConfig.model, 'hexgrad/kokoro-82m');
  assert.strictEqual(ttsConfig.voice, 'alloy');

  process.env.OPENROUTER_API_KEY = '';
  assert.strictEqual(await invokeOpenRouterTTS('Hello world'), null);
  assert.strictEqual(await invokeOpenRouterTTS(''), null);
  assert.strictEqual(await invokeOpenRouterTTS('   '), null);

  process.env.OPENROUTER_API_KEY = 'sk-or-test-mock';
  let requestedBody: any = null;
  globalThis.fetch = async (_input, init) => {
    requestedBody = JSON.parse(String(init?.body));
    const fakeMp3Bytes = Buffer.from('FAKE_AUDIO_MP3_STREAM');
    return new Response(fakeMp3Bytes, {
      status: 200,
      headers: { 'Content-Type': 'audio/mpeg' },
    });
  };

  const result = await invokeOpenRouterTTS('Your parking session in Downtown Zone 302A is active.', {
    voice: 'heart',
  });
  assert.ok(result);
  assert.strictEqual(result.format, 'audio/mpeg');
  assert.strictEqual(result.voice, 'heart');
  assert.strictEqual(requestedBody.model, 'hexgrad/kokoro-82m');
  assert.strictEqual(requestedBody.voice, 'heart');
  assert.strictEqual(requestedBody.input, 'Your parking session in Downtown Zone 302A is active.');
  assert.strictEqual(Buffer.from(result.audioBase64, 'base64').toString(), 'FAKE_AUDIO_MP3_STREAM');
});
