/** Historical text connector for explicit diagnostics/tests; application inference uses local-conversation.ts. */
import { acquireModelBudget, boundedMessages } from './model-budget.ts';
/**
 * Server-side inference. No API key: explicit local demo mode.
 * A paid model must be explicitly allowed; free model outages never cause
 * an implicit paid fallback.
 */
export interface OpenRouterConfig {
  apiKey: string;
  model: string;
  baseUrl: string;
}

export function getOpenRouterConfig(): OpenRouterConfig {
  return {
    apiKey: process.env.OPENROUTER_API_KEY || '',
    model: process.env.OPENROUTER_MODEL || 'openrouter/free',
    baseUrl: process.env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1',
  };
}

export function isLiveLLMEnabled(): boolean {
  return Boolean(getOpenRouterConfig().apiKey) && process.env.ENABLE_LIVE_LLM !== 'false';
}

export class OpenRouterError extends Error {
  readonly code: string;
  constructor(code: string, message: string) { super(message); this.code = code; }
}

export function getModelStatus() {
  const config = getOpenRouterConfig();
  return { provider: 'openrouter', model: config.model, enabled: isLiveLLMEnabled(),
    configured: Boolean(config.apiKey), mode: isLiveLLMEnabled() ? 'live' : 'demo' };
}

export async function invokeOpenRouterChat(messages: Array<{ role: string; content: string }>): Promise<string> {
  const config = getOpenRouterConfig();
  if (!config.apiKey) {
    return JSON.stringify({ status: 'demo_fallback', message: 'No OpenRouter key configured; using deterministic simulated journey.' });
  }
  if (config.model !== 'openrouter/free' && !config.model.endsWith(':free') &&
      process.env.OPENROUTER_ALLOW_PAID_MODELS !== 'true') {
    throw new Error('Paid model blocked. Choose openrouter/free or a :free model, or explicitly allow paid models.');
  }
  const base = new URL(config.baseUrl);
  if (base.hostname !== 'openrouter.ai' || base.protocol !== 'https:' || base.username || base.password) throw new Error('Only the official HTTPS OpenRouter endpoint is allowed');
  const url = new URL(config.baseUrl.replace(/\/$/, '') + '/chat/completions');
  const release = acquireModelBudget(messages);
  try {
    const response = await fetch(url, {
      method: 'POST',
      signal: AbortSignal.timeout(60_000),
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.apiKey}`,
        'HTTP-Referer': 'https://superapp-agent.internal',
        'X-Title': 'SuperApp Agent Platform',
      },
      body: JSON.stringify({
        model: config.model, messages: boundedMessages(messages),
        provider: { max_price: { prompt: 0, completion: 0 } },
        temperature: 0.3, max_tokens: 1200,
        reasoning: { effort: 'none' },
      }),
    });
    if (!response.ok) {
      const messages: Record<number, string> = {
        401: 'OpenRouter rejected the API key. Check OPENROUTER_API_KEY on the server.',
        402: 'OpenRouter has insufficient credits for this model. Check your account or choose a free model.',
        429: 'OpenRouter is rate limited. Wait a moment and send your message again.',
        404: 'The configured OpenRouter model is unavailable. Choose an available model.',
      };
      throw new OpenRouterError(`OPENROUTER_HTTP_${response.status}`, messages[response.status] ||
        'OpenRouter is temporarily unavailable. Send your message again in a moment.');
    }
    const data: any = await response.json();
    const content = data?.choices?.[0]?.message?.content;
    if (data?.error || typeof content !== 'string' || !content.trim()) {
      throw new OpenRouterError('OPENROUTER_EMPTY_RESPONSE', 'OpenRouter returned no reply. Try again or choose another model.');
    }
    if (content.length > 4000) throw new OpenRouterError('OPENROUTER_OUTPUT_LIMIT', 'The generated reply exceeded the display limit. Request a shorter reply.');
    return content.trim();
  } finally { release(); }
}
