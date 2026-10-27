import { litellmSettings } from './litellm-config.ts';
import { tracedFetch } from '../../../packages/backend-kit/src/observability.ts';
import { conversationServiceUrl } from '../../../packages/backend-kit/src/local-endpoints.ts';
import { acquireModelBudget, boundedMessages } from './model-budget.ts';
import { requireFreeModel } from './orchestrator/planner.ts';
import { fetchViaModelRelay } from './model-relay.ts';

export class ConversationModelError extends Error {
  readonly code: string;
  constructor(code: string, message: string) { super(message); this.code = code; }
}
export const isConversationModelEnabled = () => process.env.ENABLE_LOCAL_LLM === 'true';
type ModelConfig = { provider: 'llama.cpp' | 'openrouter' | 'litellm'; model: string; endpoint: URL; key?: string; prefix: string; label: string; maxTokens: number };
let lastReply: { provider: string; model: string; at: number } | undefined;

/** Deployment-only endpoints and provider-specific keys never enter graph state. */
function configuration(): ModelConfig {
  const provider = process.env.CONVERSATION_PROVIDER || 'local';
  if (provider === 'openrouter') {
    const model = process.env.OPENROUTER_MODEL?.trim() || 'openrouter/free';
    try { requireFreeModel(model); } catch { throw new ConversationModelError('OPENROUTER_CONFIG', 'Choose a free model for OpenRouter.'); }
    const key = process.env.OPENROUTER_API_KEY?.trim();
    if (!key) throw new ConversationModelError('OPENROUTER_CONFIG', 'The OpenRouter key is not configured on the server.');
    return { provider: 'openrouter', model, endpoint: new URL('https://openrouter.ai/api/v1/chat/completions'), key, prefix: 'OPENROUTER', label: 'OpenRouter', maxTokens: 192 };
  }
  if (provider === 'litellm') {
    try {
      const { base, key, model, maxTokens } = litellmSettings();
      return { provider: 'litellm', model, endpoint: new URL('chat/completions', base), key, prefix: 'LITELLM', label: 'LiteLLM', maxTokens };
    } catch { throw new ConversationModelError('LITELLM_CONFIG', 'The LiteLLM endpoint, key or model is not configured.'); }
  }
  if (provider !== 'local') throw new ConversationModelError('MODEL_PROVIDER_CONFIG', 'The conversation provider is not configured.');
  let base: URL;
  try {
    base = new URL(conversationServiceUrl());
    if (!['localhost', '127.0.0.1', '[::1]', 'conversation'].includes(base.hostname) || base.protocol !== 'http:' || base.username || base.password || base.search || base.hash || base.pathname !== '/') throw new Error('Invalid endpoint');
  } catch { throw new ConversationModelError('LOCAL_MODEL_CONFIG', 'The local conversation endpoint is not configured.'); }
  return { provider: 'llama.cpp', model: 'cityside-local', endpoint: new URL('/v1/chat/completions', base), prefix: 'LOCAL_MODEL', label: 'The local conversation model', maxTokens: 192 };
}

export function getModelStatus() {
  const enabled = isConversationModelEnabled();
  try {
    const cfg = configuration();
    return { provider: cfg.provider, model: cfg.provider === 'llama.cpp' ? 'Qwen2.5-1.5B-Instruct' : cfg.model, enabled, configured: enabled,
      mode: enabled ? cfg.provider === 'llama.cpp' ? 'local' : cfg.provider : 'demo', localOnly: cfg.provider === 'llama.cpp', ...(cfg.provider === 'llama.cpp' ? { license: 'Apache-2.0' } : {}) };
  } catch {
    return { provider: ['openrouter', 'litellm'].includes(process.env.CONVERSATION_PROVIDER || '') ? process.env.CONVERSATION_PROVIDER! : 'unconfigured', model: 'Unavailable', enabled, configured: false, mode: enabled ? 'error' : 'demo', localOnly: false };
  }
}
export async function conversationModelStatus() {
  const status = getModelStatus();
  let ready = false;
  if (status.enabled && status.configured) {
    const cfg = configuration();
    if (cfg.provider === 'llama.cpp') {
      try { const url = new URL('/health', cfg.endpoint); ready = (await tracedFetch(url, { redirect: 'error', signal: AbortSignal.timeout(1500) })).ok; } catch {}
    } else ready = lastReply?.provider === cfg.provider && lastReply.model === cfg.model && Date.now() - lastReply.at < 300000;
  }
  return { ...status, ready };
}
export async function invokeConversationModel(messages: Array<{ role: string; content: string }>): Promise<string> {
  const cfg = configuration();
  const release = acquireModelBudget(messages, cfg.maxTokens);
  try {
    // Hosted requests contain no internal correlation, workflow, approval or user-token headers.
    const relay = cfg.provider === 'litellm' && cfg.endpoint.protocol === 'https:' ? process.env.LITELLM_TLS_RELAY : undefined;
    const request = relay ? (url: URL, init: RequestInit) => fetchViaModelRelay(url, init, relay) : cfg.provider === 'llama.cpp' ? tracedFetch : globalThis.fetch;
    const response = await request(cfg.endpoint, { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(45000),
      headers: { 'Content-Type': 'application/json', ...(cfg.key ? { Authorization: `Bearer ${cfg.key}` } : {}) },
      body: JSON.stringify({ model: cfg.model, messages: boundedMessages(messages), max_tokens: cfg.maxTokens, temperature: 0.35, stream: false,
        ...(cfg.provider === 'openrouter' ? { provider: { max_price: { prompt: 0, completion: 0 } }, reasoning: { enabled: false } } : {}) }) });
    if (!response.ok) { await response.body?.cancel(); throw new ConversationModelError(`${cfg.prefix}_HTTP_${response.status}`, `${cfg.label} is busy or unavailable. Service details remain on screen.`); }
    const reader = response.body?.getReader(); if (!reader) throw new Error('Empty reply');
    const chunks: Uint8Array[] = []; let bytes = 0;
    try { for (;;) { const { done, value } = await reader.read(); if (done) break; bytes += value.byteLength; if (bytes > 65536) { await reader.cancel(); throw new Error('Oversized reply'); } chunks.push(value); } } finally { reader.releaseLock(); }
    const data = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    const content = data.choices?.[0]?.message?.content;
    if (data.error || typeof content !== 'string' || !content.trim()) throw new ConversationModelError(`${cfg.prefix}_EMPTY_REPLY`, `${cfg.label} returned no reply. Please try a shorter question.`);
    lastReply = { provider: cfg.provider, model: cfg.model, at: Date.now() };
    return content.trim().slice(0, 4000);
  } catch (e) {
    if (e instanceof ConversationModelError) throw e;
    throw new ConversationModelError(`${cfg.prefix}_UNAVAILABLE`, `${cfg.label} could not reply. Service details remain on screen; you can try again.`);
  } finally { release(); }
}
