import test from 'node:test';
import assert from 'node:assert/strict';
import { modelStatusLabel } from '../../packages/protocol-core/src/model-status.ts';

test('every shell identifies the selected provider and distinguishes configuration from availability', () => {
  for (const [provider, name] of [['litellm', 'LiteLLM'], ['openrouter', 'OpenRouter'], ['llama.cpp', 'Local model']]) {
    const model = { provider, enabled: true, configured: true };
    assert.equal(modelStatusLabel({ ...model, ready: true }), `${name} ready`);
    assert.equal(modelStatusLabel(model, { inference: 'connected' }), `${name} connected`);
    assert.equal(modelStatusLabel({ ...model, configured: false }), `${name} needs configuration`);
    assert.ok(modelStatusLabel(model, { locale: 'ar' }).length > 0);
  }
  assert.equal(modelStatusLabel({ provider: 'litellm', enabled: true }), 'LiteLLM configured');
  assert.equal(modelStatusLabel(null, { connection: 'offline' }), 'Gateway offline');
  assert.equal(modelStatusLabel({ enabled: false }), 'Demo mode');
});
