import { tracedFetch as fetch } from '../../../packages/backend-kit/src/observability.ts';
import { acquireModelBudget, boundedMessages } from './model-budget.ts';
export class LocalConversationError extends Error {
  readonly code: string;
  constructor(code: string, message: string) { super(message); this.code = code; }
}
export const isLocalModelEnabled = () => process.env.ENABLE_LOCAL_LLM === 'true';
export const getModelStatus = () => ({ provider: 'llama.cpp', model: 'Qwen2.5-1.5B-Instruct', enabled: isLocalModelEnabled(), configured: isLocalModelEnabled(), mode: isLocalModelEnabled() ? 'local' : 'demo', localOnly: true, license: 'Apache-2.0' });
export async function localModelStatus() {
  let ready = false;
  if (isLocalModelEnabled()) try { const url = endpoint(); url.pathname = '/health'; ready = (await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(1500) })).ok; } catch {}
  return { ...getModelStatus(), ready };
}
function endpoint() {
  const url = new URL(process.env.CONVERSATION_SERVICE_URL || 'http://127.0.0.1:4201');
  if (!['localhost', '127.0.0.1', '[::1]', 'conversation'].includes(url.hostname) || url.protocol !== 'http:' || url.username || url.password || url.search || url.hash || url.pathname !== '/') throw new LocalConversationError('LOCAL_MODEL_CONFIG', 'The local conversation endpoint is not configured.');
  return new URL('/v1/chat/completions', url);
}
export async function invokeLocalConversation(messages: Array<{ role: string; content: string }>): Promise<string> {
  const release = acquireModelBudget(messages);
  try {
    const response = await fetch(endpoint(), { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(45000), headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'cityside-local', messages: boundedMessages(messages), max_tokens: 192, temperature: 0.35, stream: false }) });
    if (!response.ok) throw new LocalConversationError(`LOCAL_MODEL_HTTP_${response.status}`, 'The local conversation model is busy or unavailable. Service details remain on screen.');
    const reader = response.body?.getReader(); if (!reader) throw new Error('Empty reply');
    const chunks: Uint8Array[] = []; let bytes = 0;
    try { for (;;) { const { done, value } = await reader.read(); if (done) break; bytes += value.byteLength; if (bytes > 65536) { await reader.cancel(); throw new Error('Oversized reply'); } chunks.push(value); } } finally { reader.releaseLock(); }
    const data = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    const content = data.choices?.[0]?.message?.content;
    if (data.error || typeof content !== 'string' || !content.trim()) throw new LocalConversationError('LOCAL_MODEL_EMPTY_REPLY', 'The local model returned no reply. Please try a shorter question.');
    return content.trim().slice(0, 4000);
  } catch (e) {
    if (e instanceof LocalConversationError) throw e;
    throw new LocalConversationError('LOCAL_MODEL_UNAVAILABLE', 'The local conversation model could not reply. Service details remain on screen; you can try again.');
  } finally { release(); }
}
